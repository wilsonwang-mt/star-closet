// 悬浮对话的 AI 层（D66）：Claude 流式输出一两句话，并用工具调用选出要展示的卡片（Gen UI）。
// - 模型只返回 id，服务端按目录与性别校验后才解析成卡片；目录外的 id 一律丢弃，不重试。
// - 规则层已经先给了结果，这里慢一点、失败了都不影响首个反馈；调用方负责超时与回退。
// - 目录放在系统提示末尾并开启缓存（Opus 5.5 最小可缓存前缀 512 token），多轮对话只付一次目录的输入。
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { genderAllows, PAGE_KEYS, type LocateCatalog, type LocateQuery, type LocateResult, type PageKey } from "../locate/core";
import { availablePages, closetCard, outfitCard, pageCard, pagesForPrompt } from "./catalog";
import type { ChatCard, ChatTurn } from "./protocol";

// Opus 5.5（effort low）+ fast mode（2026-10-16 用户决定，D66）：同一个模型，输出速度更快，价格为标准的 2 倍。
// fast mode 是 Claude API 的研究预览（beta `fast-mode-2026-02-01`），只支持 Opus 5.5 / Opus 5 / Opus 4.8；
// CHAT_SPEED=standard 可关掉，CHAT_MODEL 可换模型，都不改代码。
const MODEL = process.env.CHAT_MODEL || "claude-opus-5-5";
const FAST = process.env.CHAT_SPEED !== "standard" && /^claude-opus-(5-5|5|4-8)$/.test(MODEL);
// 服务端拒绝时自动换模型重试（Haiku 不支持该参数）。fast mode 下不带：回退目标未必支持 fast，组合可能被拒；
// 对话场景几乎不会触发拒绝，真被拒时调用方本来就停在规则结果。
const WITH_FALLBACKS = /^claude-(opus|fable|sonnet-5-5)/.test(MODEL);
// fast mode 未开通（400/403/404）或其独立限流（429）时，在还没流出文字的前提下改用标准速度重试一次
const FAST_UNAVAILABLE = new Set([400, 403, 404, 429]);

export function hasChatAi() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const RULES = `你是线上买手店 Star Closet 的搭配助手，住在网站右下角的对话窗里。用户会说出场合、风格、预算、性别，或者想穿得像谁；你在下面的目录里帮他找到合适的衣橱和整套搭配，或者带他去对应的功能页。

怎么回答：
1. 先用中文写一到两句话，合计不超过 50 个字，像懂行的朋友一样直接给判断、说清为什么是它。提到搭配或衣橱时用名称（如「户外草坪婚礼」），不要写 id；不要列清单，不要 Markdown，不要寒暄。
2. 然后调用工具，把结果展示成卡片：show_outfits 放 1–4 套搭配（最合适的在前）；需要时用 show_closets 放 1–2 间衣橱；用户想做某件事（看试衣间、生成 3D 形象、试穿、登录、改档案）时用 open_page。最后调用 suggest_replies，给 2–3 句用户可能想接着说的话（每句不超过 12 个字）。
3. 只能使用目录里的 id，不得编造衣橱、搭配、单品或价格。用户说了性别，只推荐对应性别和中性的搭配。
4. 目录以秋冬为主。用户要的场合或季节目录里没有时如实说，再给最接近的。
5. 用户提到真实的明星或名人时，只把它理解成一种风格描述；回答里不要出现这个名字，也不要暗示任何衣橱与其有关。
6. 不要说精准合身、尺寸准确；不要替用户下单或加入试衣间。总价超出预算时，告诉用户进到搭配页可以用「一句话改编」按预算改。
7. 用户消息末尾的「初筛参考」是规则给的候选，可以采纳也可以推翻，以用户的话为准。和穿搭、本站无关的问题，用一句话礼貌带回到穿搭上。`;

const catalogText = new WeakMap<LocateCatalog, string>();

function catalogForPrompt(c: LocateCatalog) {
  let s = catalogText.get(c);
  if (s) return s;
  const closets = c.closets
    .map((x) => `${x.id}｜${x.closetName}｜${x.displayName}｜${x.closetType}｜${x.gender}｜${x.styleTags.join("/")}｜${x.tagline}`)
    .join("\n");
  const outfits = c.outfits
    .map(
      (o) =>
        `${o.id}｜${o.curatorId}｜${o.name}｜${o.occasionTags.join("/")}｜${o.season ?? ""}｜${o.gender}｜¥${o.total}｜${o.styleNote.slice(0, 48)}`,
    )
    .join("\n");
  s = `目录（币种人民币；价格为单品参考价合计）。

衣橱（id｜衣橱名｜主理人｜类型｜性别｜风格｜一句话）：
${closets}

搭配（id｜所属衣橱｜名称｜场合｜季节｜性别｜总价｜说明）：
${outfits}

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
      description: "在对话里展示整套搭配卡片（封面、编号、总价）。用户点卡片会进入搭配页。",
      input_schema: {
        type: "object",
        properties: { outfit_ids: ids("搭配 id，如 O31；1–4 个，最合适的在前") },
        required: ["outfit_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "show_closets",
      description: "展示衣橱卡片（封面、主理人、一句话）。用户点卡片会走进这间衣橱。",
      input_schema: {
        type: "object",
        properties: { closet_ids: ids("衣橱 id，如 C06；1–2 个") },
        required: ["closet_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "open_page",
      description: "展示功能页入口卡片，用户点了会跳过去。",
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
      description: "给 2–3 句用户可能想接着说的短句，显示为可点的追问。",
      input_schema: {
        type: "object",
        properties: { replies: ids("每句不超过 12 个字") },
        required: ["replies"],
        additionalProperties: false,
      },
    },
  ];
}

function toMessages(history: ChatTurn[], hint: string): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const t of history.slice(-12)) {
    const text = (t.role === "assistant" && t.shown?.length ? `${t.text}\n（已展示：${t.shown.join("、")}）` : t.text).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  const last = out[out.length - 1];
  if (last?.role === "user" && hint) last.content = `${last.content as string}\n\n（初筛参考：${hint}）`;
  return out;
}

function hintFor(r: LocateResult) {
  const picks = r.outfits.slice(0, 6).map((s) => `${s.outfit.id} ${s.outfit.name}`);
  const parts = [
    r.query.labels.length ? `识别到 ${r.query.labels.join("、")}` : "没有识别到明确条件",
    picks.length ? `候选 ${picks.join("、")}` : null,
    r.query.gender ? `性别 ${r.query.gender}` : null,
  ];
  return parts.filter(Boolean).join("；");
}

export type AiOutcome = { cards: ChatCard[]; chips: string[]; speed: "standard" | "fast" | null };

/**
 * 流式调用：每段文字回调 onText；结束后返回校验过的卡片与追问。
 * 失败（含拒绝、超时、目录外 id 全部被丢弃）时抛错，由调用方回退到规则结果。
 */
export async function streamChatAi(opts: {
  catalog: LocateCatalog;
  history: ChatTurn[];
  rules: LocateResult;
  query: LocateQuery;
  signal: AbortSignal;
  onText: (d: string) => void;
}): Promise<AiOutcome> {
  const { catalog, history, rules, query, signal, onText } = opts;
  const client = new Anthropic({ maxRetries: 0 });
  const messages = toMessages(history, hintFor(rules));
  if (!messages.length) throw new Error("没有用户消息");

  let streamed = false;
  const run = async (fast: boolean) => {
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
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
        streamed = true;
        onText(ev.delta.text);
      }
    }
    return stream.finalMessage();
  };

  let final;
  try {
    final = await run(FAST);
  } catch (e) {
    if (!FAST || streamed || signal.aborted || !(e instanceof Anthropic.APIError) || !FAST_UNAVAILABLE.has(e.status ?? 0)) throw e;
    console.error(`chat fast mode unavailable (${e.status}), retrying at standard speed`);
    final = await run(false);
  }
  if (final.stop_reason === "refusal") throw new Error("模型拒绝了这次请求");

  const closets = new Map(catalog.closets.map((c) => [c.id, c]));
  const outfits = new Map(catalog.outfits.map((o) => [o.id, o]));
  const allowedPages = new Set(availablePages());
  const closetCards: ChatCard[] = [];
  const outfitCards: ChatCard[] = [];
  const pageCards: ChatCard[] = [];
  let chips: string[] = [];
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

  for (const block of final.content) {
    if (block.type !== "tool_use") continue;
    const input = (block.input ?? {}) as Record<string, unknown>;
    if (block.name === "show_outfits") {
      for (const id of strs(input.outfit_ids)) {
        const o = outfits.get(id.trim());
        if (o && genderAllows(query, o.gender) && !outfitCards.some((c) => c.kind === "outfit" && c.id === o.id) && outfitCards.length < 4)
          outfitCards.push(outfitCard(o, catalog.closets));
      }
    } else if (block.name === "show_closets") {
      for (const id of strs(input.closet_ids)) {
        const c = closets.get(id.trim());
        if (c && genderAllows(query, c.gender) && !closetCards.some((x) => x.kind === "closet" && x.id === c.id) && closetCards.length < 2)
          closetCards.push(closetCard(c));
      }
    } else if (block.name === "open_page") {
      for (const p of strs(input.pages)) {
        if ((PAGE_KEYS as readonly string[]).includes(p) && allowedPages.has(p as PageKey) && pageCards.length < 2)
          pageCards.push(pageCard(p as PageKey));
      }
    } else if (block.name === "suggest_replies") {
      chips = strs(input.replies)
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 20)
        .slice(0, 3);
    }
  }
  return { cards: [...closetCards, ...outfitCards, ...pageCards], chips, speed: final.usage.speed ?? null };
}
