// 悬浮对话的 AI 层（D66；D68 动态化）：Claude 按用户这句话的意图决定怎么回——闲聊、给建议、找搭配、答细节、指路、先追问，
// 文字流式输出，需要时用工具调用选出卡片（Gen UI）。
// - 模型只返回 id，服务端按目录与性别校验后才解析成卡片；目录外的 id 一律丢弃，不重试。每完成一次工具调用就把卡片推给前端。
// - 系统提示 = 规则 + 完整目录（衣橱、搭配、单品），整块缓存（Opus 5.5 最小可缓存前缀 512 token）。
// - 每轮的“页面与用户”说明以括注附在用户这句话末尾（标明是系统附注）。试过放成对话中途的 system 消息：
//   fast mode + effort low 下约一半回复开头漏出英文推理或乱码，附在用户消息里则没有（2026-10-23 实测 8 次对比）。
// - 调用方负责超时与回退（规则层结果）。
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { genderAllows, PAGE_KEYS, type LocateQuery, type PageKey } from "../locate/core";
import { availablePages, closetCard, outfitCard, pageCard, pagesForPrompt, type ChatCatalog } from "./catalog";
import type { ChatCard, ChatTurn } from "./protocol";
import { createTextGuard } from "./textTools";

// Opus 5.5（effort low）+ fast mode（2026-10-16 用户决定，D66）：同一个模型，输出速度更快，价格为标准的 2 倍。
// fast mode 是 Claude API 的研究预览（beta `fast-mode-2026-02-01`），只支持 Opus 5.5 / Opus 5 / Opus 4.8；
// CHAT_SPEED=standard 可关掉，CHAT_MODEL 可换模型，都不改代码。
const MODEL = process.env.CHAT_MODEL || "claude-opus-5-5";
const FAST = process.env.CHAT_SPEED !== "standard" && /^claude-opus-(5-5|5|4-8)$/.test(MODEL);
// 服务端拒绝时自动换模型重试（Haiku 不支持该参数）。fast mode 下不带：回退目标未必支持 fast，组合可能被拒；
// 对话场景几乎不会触发拒绝，真被拒时调用方会回退到规则结果。
const WITH_FALLBACKS = /^claude-(opus|fable|sonnet-5-5)/.test(MODEL);
// fast mode 未开通（400/403/404）或其独立限流（429）时，在还没流出文字的前提下改用标准速度重试一次
const FAST_UNAVAILABLE = new Set([400, 403, 404, 429]);

export function hasChatAi() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const RULES = `你是线上买手店 SEEN. 的搭配顾问（站名写作 SEEN.），住在网站右下角的对话窗里。像一位懂行、会聊天的导购：先听懂用户这句话真正想要什么，再决定怎么回。每轮回复的样子应该跟着用户的话变，不要套同一个格式。

你能看到：
- 下面的完整目录：每间衣橱、每套搭配，以及每套里的单品（名称、类目、颜色、材质、价格）。
- 用户每句话末尾的括注「页面与用户」（系统附注，不是用户说的）：用户此刻在看哪一页、是否登录、档案里的偏好（风格、颜色、尺码、预算）、有没有数字分身、试衣间和购物袋里有几样；用户这句话里有找衣服的条件时，还会附规则初筛的候选。用户说“这套”“这件”“它”“鞋子”时，按当前页面理解。

按意图决定怎么回：
- 打招呼、闲聊、说心情：自然地接话，再问一个能帮他挑衣服的问题。通常不出卡片。
- 问穿搭知识或建议（怎么搭、配什么颜色、显瘦、显高、这件适合什么场合）：直接给具体的建议，可以说两三句。目录里正好有能说明的搭配时，再用 show_outfits 放 1–2 套当例子。
- 想找衣服（场合、风格、预算、像谁）：一两句讲清为什么选它们，用 show_outfits 放 1–4 套，最合适的在前；值得逛整间时再用 show_closets。
- 问某套或某件的细节（鞋子是什么、什么材质、多少钱、为什么推荐、和另一套比怎样）：照目录直接答出具体内容，不要让用户自己点进去看。
- 想做某件事（加入试衣间、试穿、看购物袋、建立数字分身、登录、改档案）：说清在哪里、怎么做，用 open_page 或搭配卡给入口。你不能替用户加入试衣间、试穿或下单，但要告诉他按哪个按钮。
- 说得太含糊或条件互相冲突：先问一个最关键的问题，用 suggest_replies 给 2–3 个可以直接点的回答。

写法：
- 每轮都先写一两句话给用户（哪怕只是打招呼），再调用工具；卡片和追问一律通过工具调用给出，不要在正文里写工具调用、XML 或任何尖括号标签。
- 只写给用户看的话：中文口语，像朋友当面说话；不写分析过程，除站名 SEEN. 和主理人的英文名外不用英文，不用列表、标题、加粗等 Markdown 记号，不写 id 和标签，提到衣橱、搭配、单品时用名称。
- 长度跟着问题走：简单的问题一两句；需要解释时挑最要紧的两三点说，整段一般不超过 120 个字，最多不超过 200 个字。对话窗很小，宁可让用户追问。不要每次都用同一种开头（比如“首选「…」”“推荐「…」”）。
- 用到档案偏好时自然带一句（比如“按你平时 M 码”“你喜欢的燕麦色”），不要复述整份档案。
- suggest_replies 只在追问真的有帮助时给，0–3 句，每句不超过 12 个字，站在用户的角度写；不要每轮都给。

边界：
- 只用目录里的衣橱、搭配、单品和价格，不编造。用户说了性别时，只推荐对应性别和中性的搭配。
- 目录以秋冬为主；没有用户要的场合或季节时如实说，再给最接近的。
- 用户提到真实明星或名人时，只当作风格描述来理解；回答里不出现这个名字，也不暗示任何衣橱与其有关。
- 不说精准合身、尺寸准确。总价超出预算时，告诉用户进到搭配页可以用「一句话改编」按预算改。
- 与穿搭和本站无关的问题，用一句话礼貌地带回到穿搭上。

几种回法的示意（只看形态，不要照抄措辞）：
- 用户：“你好” → 一两句招呼，问他接下来想穿去哪儿；不出卡片，给 2–3 个追问。
- 用户：“驼色大衣配什么裤子好看？” → 两三句具体搭法，再放 1–2 套含驼色大衣的搭配当例子。
- 用户在搭配页问：“这套的鞋子是什么？” → 直接说出这套里那双鞋的名称、颜色、价格和好在哪；不必出卡片。
- 用户：“帮我把它加入试衣间” → 说明在搭配页底部点「加入试衣间」，给这套的搭配卡。`;

const catalogText = new WeakMap<ChatCatalog, string>();

function catalogForPrompt(c: ChatCatalog) {
  let s = catalogText.get(c);
  if (s) return s;
  const closets = c.closets
    .map((x) => `${x.id}｜${x.closetName}｜${x.displayName}｜${x.closetType}｜${x.gender}｜${x.styleTags.join("/")}｜${x.tagline}`)
    .join("\n");
  const outfits = c.outfits
    .map(
      (o) =>
        `${o.id}｜${o.curatorId}｜N°${String(o.no).padStart(2, "0")} ${o.name}｜${o.occasionTags.join("/")}｜${o.season ?? ""}｜${o.gender}｜¥${o.total}｜${o.itemIds.join(",")}｜${o.styleNote}`,
    )
    .join("\n");
  const items = c.items
    .map((i) => `${i.id}｜${i.name}｜${i.category}${i.subcategory ? `/${i.subcategory}` : ""}｜${i.color}｜${i.material ?? ""}｜¥${i.price}`)
    .join("\n");
  s = `目录（币种人民币；单品价格为参考价，搭配总价为单品合计）。

衣橱（id｜衣橱名｜主理人｜类型｜性别｜风格｜一句话）：
${closets}

搭配（id｜所属衣橱｜编号与名称｜场合｜季节｜性别｜总价｜单品 id｜主理人的搭配说明）：
${outfits}

单品（id｜名称｜类目｜颜色｜材质｜价格）：
${items}

功能页（page｜名称｜说明）：
${pagesForPrompt()}`;
  catalogText.set(c, s);
  return s;
}

const ids = (description: string) => ({
  type: "array" as const,
  items: { type: "string" as const },
  description,
});

function tools(): BetaTool[] {
  return [
    {
      name: "show_outfits",
      description: "需要给用户看整套搭配时，在对话里展示搭配卡片（封面、编号、总价），用户点卡片会进入搭配页。只是回答问题时不必调用。",
      input_schema: {
        type: "object",
        properties: { outfit_ids: ids("搭配 id，如 O31；1–4 个，最合适的在前") },
        required: ["outfit_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "show_closets",
      description: "值得让用户逛整间衣橱时，展示衣橱卡片（封面、主理人、一句话），用户点卡片会走进这间衣橱。",
      input_schema: {
        type: "object",
        properties: { closet_ids: ids("衣橱 id，如 C06；1–2 个") },
        required: ["closet_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "open_page",
      description: "用户想做某件事时，展示功能页入口卡片，用户点了会跳过去。",
      input_schema: {
        type: "object",
        properties: {
          pages: { type: "array", items: { type: "string", enum: availablePages() }, description: "1–2 个功能页" },
        },
        required: ["pages"],
        additionalProperties: false,
      },
    },
    {
      name: "suggest_replies",
      description: "追问真的有帮助时，给 2–3 句用户可能想接着说的短句，显示为可点的选项。不需要时不调用。",
      input_schema: {
        type: "object",
        properties: { replies: ids("每句不超过 12 个字，用用户的口吻") },
        required: ["replies"],
        additionalProperties: false,
      },
    },
  ];
}

function toMessages(history: ChatTurn[], context: string): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const t of history.slice(-12)) {
    const text = (t.role === "assistant" && t.shown?.length ? `${t.text}\n（已展示：${t.shown.join("、")}）` : t.text).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  // 页面与用户：括注在用户这句话末尾（不用对话中途的 system 消息，原因见文件头）
  const last = out[out.length - 1];
  if (last?.role === "user" && context) last.content = `${last.content as string}\n\n（页面与用户，系统附注，不是用户说的话：${context}）`;
  return out;
}

export type AiOutcome = {
  /** 这一轮流出过正文没有（只出了卡片 / 追问时为 false，调用方补一句） */
  wroteText: boolean;
  cards: ChatCard[];
  chips: string[];
  speed: "standard" | "fast" | null;
  /** 有几次工具调用是从正文里的 XML 救回来的（监控用） */
  textToolCalls: number;
};

/** 把工具调用逐个转成校验过的卡片与追问。 */
function makeCollector(catalog: ChatCatalog, query: LocateQuery) {
  const closets = new Map(catalog.closets.map((c) => [c.id, c]));
  const outfits = new Map(catalog.outfits.map((o) => [o.id, o]));
  const allowedPages = new Set(availablePages());
  const closetCards: ChatCard[] = [];
  const outfitCards: ChatCard[] = [];
  const pageCards: ChatCard[] = [];
  let chips: string[] = [];
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    /** 返回这次调用改动了什么：cards / chips / null */
    add(block: BetaContentBlock): "cards" | "chips" | null {
      if (block.type !== "tool_use") return null;
      return this.call(block.name, (block.input ?? {}) as Record<string, unknown>);
    },
    call(name: string, input: Record<string, unknown>): "cards" | "chips" | null {
      const block = { name };
      if (block.name === "show_outfits") {
        for (const id of strs(input.outfit_ids)) {
          const o = outfits.get(id.trim());
          if (o && genderAllows(query, o.gender) && !outfitCards.some((c) => c.kind === "outfit" && c.id === o.id) && outfitCards.length < 4)
            outfitCards.push(outfitCard(o, catalog.closets));
        }
        return "cards";
      }
      if (block.name === "show_closets") {
        for (const id of strs(input.closet_ids)) {
          const c = closets.get(id.trim());
          if (c && genderAllows(query, c.gender) && !closetCards.some((x) => x.kind === "closet" && x.id === c.id) && closetCards.length < 2)
            closetCards.push(closetCard(c));
        }
        return "cards";
      }
      if (block.name === "open_page") {
        for (const p of strs(input.pages)) {
          if ((PAGE_KEYS as readonly string[]).includes(p) && allowedPages.has(p as PageKey) && !pageCards.some((x) => x.kind === "page" && x.page === p) && pageCards.length < 2)
            pageCards.push(pageCard(p as PageKey));
        }
        return "cards";
      }
      if (block.name === "suggest_replies") {
        chips = strs(input.replies)
          .map((s) => s.trim())
          .filter((s) => s && s.length <= 20)
          .slice(0, 3);
        return "chips";
      }
      return null;
    },
    cards: () => [...closetCards, ...outfitCards, ...pageCards],
    chips: () => chips,
  };
}

/**
 * 流式调用：文字逐段回调 onText；每完成一次工具调用回调 onCards / onChips（整组）。
 * 失败（含拒绝、超时）时抛错，由调用方回退。
 */
export async function streamChatAi(opts: {
  catalog: ChatCatalog;
  history: ChatTurn[];
  /** 页面与用户状态，以及（这句有找衣服条件时）规则初筛提示 */
  context: string;
  query: LocateQuery;
  signal: AbortSignal;
  onText: (d: string) => void;
  onCards: (cards: ChatCard[]) => void;
  onChips: (chips: string[]) => void;
}): Promise<AiOutcome> {
  const { catalog, history, context, query, signal, onText, onCards, onChips } = opts;
  const client = new Anthropic({ maxRetries: 0 });
  const messages = toMessages(history, context);
  if (!messages.length) throw new Error("没有用户消息");

  let streamed = false;
  let rescued = 0;
  const run = async (fast: boolean) => {
    const collect = makeCollector(catalog, query);
    const report = (changed: "cards" | "chips" | null) => {
      if (changed === "cards") onCards(collect.cards());
      else if (changed === "chips") onChips(collect.chips());
    };
    const guard = createTextGuard((t) => {
      streamed = true;
      onText(t);
    });
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 2048,
        ...(fast
          ? { betas: ["fast-mode-2026-02-01"], speed: "fast" as const }
          : WITH_FALLBACKS
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        output_config: { effort: "low" },
        system: [
          { type: "text", text: RULES },
          { type: "text", text: catalogForPrompt(catalog), cache_control: { type: "ephemeral" } },
        ],
        tools: tools(),
        tool_choice: { type: "auto" },
        messages,
      },
      { signal },
    );
    stream.on("contentBlock", (block) => report(collect.add(block)));
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) guard.push(ev.delta.text);
    }
    const final = await stream.finalMessage();
    // 正文里写成 XML 的工具调用：摘出来照常校验、出卡片，标签不给用户看
    for (const c of guard.finish()) {
      rescued++;
      report(collect.call(c.name, c.input));
    }
    return { final, collect };
  };

  let result;
  try {
    result = await run(FAST);
  } catch (e) {
    if (!FAST || streamed || signal.aborted || !(e instanceof Anthropic.APIError) || !FAST_UNAVAILABLE.has(e.status ?? 0)) throw e;
    console.error(`chat fast mode unavailable (${e.status}), retrying at standard speed`);
    onCards([]);
    result = await run(false);
  }
  const { final, collect } = result;
  if (final.stop_reason === "refusal") throw new Error("模型拒绝了这次请求");
  return { wroteText: streamed, cards: collect.cards(), chips: collect.chips(), speed: final.usage.speed ?? null, textToolCalls: rescued };
}
