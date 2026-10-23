// 悬浮对话的 AI 层（D66；D68 动态化）：Claude 按用户这句话的意图决定怎么回——闲聊、给建议、找搭配、答细节、指路、先追问，
// 文字流式输出，需要时用工具调用选出卡片（Gen UI）。
// - 模型只返回 id，服务端按目录与性别校验后才解析成卡片；目录外的 id 一律丢弃，不重试。每完成一次工具调用就把卡片推给前端。
// - 系统提示 = 规则 + 完整目录（衣橱、搭配、单品），整块缓存（Opus 5.5 最小可缓存前缀 512 token）。
// - 每轮的“页面与用户”说明以括注附在用户这句话末尾（标明是系统附注）。试过放成对话中途的 system 消息：
//   fast mode + effort low 下约一半回复开头漏出英文推理或乱码，附在用户消息里则没有（2026-10-23 实测 8 次对比）。
// - 调用方负责超时与回退（规则层结果）。
// - 多语言（D70）：英文站用整套英文规则（RULES_EN，含“只用英文回复”）、英文工具说明、英文目录快照（目录译名 + 英文固定词）
//   与英文附注；中文站与原来逐字相同。每种语言的系统提示各自稳定，分别命中提示缓存；目录快照按语言分开缓存。
//   工具名与参数两种语言一致，卡片仍按 id 校验，只在生成卡片时换成译名。
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaTextBlockParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { localizeCurator, localizeItem, localizeOutfit, term, terms } from "../i18n/catalog";
import type { Locale } from "../i18n/config";
import { genderAllows, PAGE_KEYS, type LocateQuery, type PageKey } from "../locate/core";
import { availablePages, closetCard, outfitCard, pageCard, pagesForPrompt, type ChatCatalog } from "./cards";
import { formatYuan, type ChatCard, type ChatTurn } from "./protocol";
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

// 英文站的规则：与 RULES 同一套意图与边界，语言要求换成英文。按钮名与英文界面一致（outfit / tryon 字典）。
const RULES_EN = `You are the styling advisor for SEEN., an online boutique (always write the name as "SEEN."), living in the chat window at the bottom right of the site. Act like a knowledgeable shop assistant who is easy to talk to: first work out what the user really wants from this message, then decide how to reply. Let the shape of each reply follow what the user said; don't fall into one fixed format.

Language: the user is on the English version of the site. Always reply in English, including suggested replies, even if the catalog below or earlier messages contain Chinese. Refer to closets, looks and pieces by the English names in the catalog; if a name there is still in Chinese, translate it naturally instead of quoting the Chinese. Refer to curators by the Latin-letter part of their name when there is one (for example Vera); otherwise use the name as written.

What you can see:
- The full catalog below: every closet, every look, and the pieces in each look (name, category, color, material, price).
- A bracketed "Page & user" note at the end of each user message (a system note, not something the user said): which page the user is on, whether they are signed in, the preferences in their profile (style, colors, sizes, budget), whether they have a digital twin, and how many things are in their Fitting Room and Bag. When the message itself contains shopping criteria, the note also lists a rule-based shortlist. When the user says "this look", "this piece", "it" or "the shoes", read it against the current page.

Decide how to reply by intent:
- Greetings, small talk, mood: respond naturally, then ask one question that helps you pick clothes for them. Usually no cards.
- Styling knowledge or advice (how to wear something, which colors go together, looking slimmer or taller, what a piece suits): give concrete advice directly; two or three sentences is fine. If a look in the catalog illustrates it well, show 1–2 as examples with show_outfits.
- Looking for clothes (occasion, style, budget, dressing like someone): say in a sentence or two why you chose them, and show 1–4 looks with show_outfits, best first; use show_closets when a whole closet is worth browsing.
- Details about a look or piece (what the shoes are, the material, the price, why it's recommended, how it compares with another look): answer with the specifics from the catalog; don't send the user off to look it up.
- Wanting to do something (add to the Fitting Room, try on, view the Bag, create a digital twin, sign in, edit the profile): say where and how, and give an entry with open_page or a look card. You can't add to the Fitting Room, try on or place orders for the user, but tell them which button to tap.
- Too vague, or conflicting criteria: ask the one most important question first, and offer 2–3 tappable answers with suggest_replies.

How to write:
- Every turn, write a sentence or two to the user first (even if it's just a greeting), then call tools. Cards and suggested replies always go through tool calls; never write tool calls, XML or any angle-bracket tags in the text.
- Write only what the user should read: natural, conversational English, like talking to a friend in person. Don't show your reasoning; no lists, headings, bold or other Markdown; no ids or tags. Mention closets, looks and pieces by name.
- Let length follow the question: one or two sentences for simple ones; when explaining, pick the two or three points that matter most, usually under 80 words and never more than 130. The chat window is small, so let the user ask for more. Don't open every reply the same way (such as "My top pick is…").
- When you use profile preferences, mention them in passing ("in your usual M", "the oatmeal you like"); don't recite the whole profile.
- Only give suggest_replies when a follow-up really helps: 0–3 replies, each at most 5 words, written from the user's point of view; not every turn.
- Prices are in RMB; write them like ¥1,280.

Boundaries:
- Use only the closets, looks, pieces and prices in the catalog; don't make anything up. When the user states a gender, recommend only looks for that gender or unisex looks.
- The catalog is mostly autumn and winter; if nothing fits the requested occasion or season, say so honestly and offer the closest match.
- If the user mentions a real celebrity, treat it only as a description of a style; don't use the name in your reply or suggest that any closet is connected to them.
- Never promise a precise fit or exact sizing. When a total is over budget, tell the user they can open the look and use "Make it yours, in a sentence" to fit it to their budget.
- For questions unrelated to clothes or this site, steer back to styling politely in one sentence.

A few sketches of reply shapes (shape only; don't copy the wording):
- User: "Hi" → a one- or two-sentence greeting that asks where they're dressing for next; no cards, 2–3 suggested replies.
- User: "What trousers go with a camel coat?" → two or three sentences of specific pairings, then 1–2 looks with a camel coat as examples.
- User on a look page: "What are the shoes in this look?" → name the shoes in this look, their color and price and what makes them work; no card needed.
- User: "Add it to my Fitting Room" → explain that the "Add to Fitting Room" button is at the bottom of the look page, and give this look's card.`;

const RULES_BY_LOCALE: Record<Locale, string> = { zh: RULES, en: RULES_EN };

// 目录快照按目录对象与语言缓存：同一份目录在同一语言下得到同一个字符串（提示缓存的前缀保持稳定）
const catalogText = new WeakMap<ChatCatalog, Partial<Record<Locale, string>>>();

export function catalogForPrompt(c: ChatCatalog, locale: Locale = "zh"): string {
  let byLocale = catalogText.get(c);
  if (!byLocale) {
    byLocale = {};
    catalogText.set(c, byLocale);
  }
  const hit = byLocale[locale];
  if (hit) return hit;
  const s = locale === "zh" ? catalogZh(c) : catalogLocalized(c, locale);
  byLocale[locale] = s;
  return s;
}

function catalogZh(c: ChatCatalog) {
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
  return `目录（币种人民币；单品价格为参考价，搭配总价为单品合计）。

衣橱（id｜衣橱名｜主理人｜类型｜性别｜风格｜一句话）：
${closets}

搭配（id｜所属衣橱｜编号与名称｜场合｜季节｜性别｜总价｜单品 id｜主理人的搭配说明）：
${outfits}

单品（id｜名称｜类目｜颜色｜材质｜价格）：
${items}

功能页（page｜名称｜说明）：
${pagesForPrompt()}`;
}

/** 非中文的目录快照：名称、说明用目录译名，固定词用 term()；没有译文的保持中文（规则里让模型自己译）。 */
function catalogLocalized(c: ChatCatalog, locale: Locale) {
  const list = (xs: string[]) => terms(locale, xs).join("/");
  const closets = c.closets
    .map((raw) => {
      const x = localizeCurator(raw, locale);
      return [x.id, x.closetName, x.displayName, term(locale, x.closetType), term(locale, x.gender), list(x.styleTags), x.tagline].join(" | ");
    })
    .join("\n");
  const outfits = c.outfits
    .map((raw) => {
      const o = localizeOutfit(raw, locale);
      return [
        o.id,
        o.curatorId,
        `N°${String(o.no).padStart(2, "0")} ${o.name}`,
        list(o.occasionTags),
        term(locale, o.season),
        term(locale, o.gender),
        formatYuan(o.total, locale),
        o.itemIds.join(","),
        o.styleNote,
      ].join(" | ");
    })
    .join("\n");
  const items = c.items
    .map((raw) => {
      const i = localizeItem(raw, locale);
      const category = `${term(locale, i.category)}${i.subcategory ? `/${term(locale, i.subcategory)}` : ""}`;
      return [i.id, i.name, category, term(locale, i.color), term(locale, i.material), formatYuan(i.price, locale)].join(" | ");
    })
    .join("\n");
  return `Catalog (currency RMB; piece prices are reference prices, and a look's total is the sum of its pieces).

Closets (id | closet name | curator | type | gender | styles | tagline):
${closets}

Looks (id | closet | number and name | occasions | season | gender | total | piece ids | curator's styling note):
${outfits}

Pieces (id | name | category | color | material | price):
${items}

Feature pages (page | name | description):
${pagesForPrompt(locale)}`;
}

/** 系统提示：规则 + 目录快照（整块缓存）。按语言各自稳定。 */
export function systemPrompt(catalog: ChatCatalog, locale: Locale = "zh"): BetaTextBlockParam[] {
  return [
    { type: "text", text: RULES_BY_LOCALE[locale] },
    { type: "text", text: catalogForPrompt(catalog, locale), cache_control: { type: "ephemeral" } },
  ];
}

const ids = (description: string) => ({
  type: "array" as const,
  items: { type: "string" as const },
  description,
});

const TOOL_TEXT: Record<Locale, Record<"outfits" | "outfitIds" | "closets" | "closetIds" | "page" | "pages" | "replies" | "replyItems", string>> = {
  zh: {
    outfits: "需要给用户看整套搭配时，在对话里展示搭配卡片（封面、编号、总价），用户点卡片会进入搭配页。只是回答问题时不必调用。",
    outfitIds: "搭配 id，如 O31；1–4 个，最合适的在前",
    closets: "值得让用户逛整间衣橱时，展示衣橱卡片（封面、主理人、一句话），用户点卡片会走进这间衣橱。",
    closetIds: "衣橱 id，如 C06；1–2 个",
    page: "用户想做某件事时，展示功能页入口卡片，用户点了会跳过去。",
    pages: "1–2 个功能页",
    replies: "追问真的有帮助时，给 2–3 句用户可能想接着说的短句，显示为可点的选项。不需要时不调用。",
    replyItems: "每句不超过 12 个字，用用户的口吻",
  },
  en: {
    outfits:
      "When the user should see whole looks, show look cards in the chat (cover, number, total price); tapping a card opens the look page. Not needed when you are only answering a question.",
    outfitIds: "Look ids such as O31; 1–4, best first",
    closets: "When a whole closet is worth browsing, show closet cards (cover, curator, tagline); tapping a card walks into that closet.",
    closetIds: "Closet ids such as C06; 1–2",
    page: "When the user wants to do something, show an entry card for a feature page; tapping it goes there.",
    pages: "1–2 feature pages",
    replies:
      "When a follow-up really helps, give 2–3 short things the user might say next, shown as tappable options. Don't call it otherwise.",
    replyItems: "Each at most 5 words, in English, in the user's voice",
  },
};

/** 工具定义：名称与参数各语言一致，只换说明文字。 */
export function chatTools(locale: Locale = "zh"): BetaTool[] {
  const d = TOOL_TEXT[locale];
  return [
    {
      name: "show_outfits",
      description: d.outfits,
      input_schema: {
        type: "object",
        properties: { outfit_ids: ids(d.outfitIds) },
        required: ["outfit_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "show_closets",
      description: d.closets,
      input_schema: {
        type: "object",
        properties: { closet_ids: ids(d.closetIds) },
        required: ["closet_ids"],
        additionalProperties: false,
      },
    },
    {
      name: "open_page",
      description: d.page,
      input_schema: {
        type: "object",
        properties: {
          pages: { type: "array", items: { type: "string", enum: availablePages() }, description: d.pages },
        },
        required: ["pages"],
        additionalProperties: false,
      },
    },
    {
      name: "suggest_replies",
      description: d.replies,
      input_schema: {
        type: "object",
        properties: { replies: ids(d.replyItems) },
        required: ["replies"],
        additionalProperties: false,
      },
    },
  ];
}

const NOTES: Record<Locale, { shown: (ids: string[]) => string; context: (c: string) => string }> = {
  zh: {
    shown: (ids) => `（已展示：${ids.join("、")}）`,
    context: (c) => `（页面与用户，系统附注，不是用户说的话：${c}）`,
  },
  en: {
    shown: (ids) => `(Shown: ${ids.join(", ")})`,
    context: (c) => `(Page & user: a system note, not said by the user; reply in English. ${c})`,
  },
};

export function toMessages(history: ChatTurn[], context: string, locale: Locale = "zh"): BetaMessageParam[] {
  const note = NOTES[locale];
  const out: BetaMessageParam[] = [];
  for (const t of history.slice(-12)) {
    const text = (t.role === "assistant" && t.shown?.length ? `${t.text}\n${note.shown(t.shown)}` : t.text).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content as string}\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  // 页面与用户：括注在用户这句话末尾（不用对话中途的 system 消息，原因见文件头）
  const last = out[out.length - 1];
  if (last?.role === "user" && context) last.content = `${last.content as string}\n\n${note.context(context)}`;
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

// 追问 chip 的长度上限（字符）：中文 12 个字左右，英文按词数换算放宽
const CHIP_MAX: Record<Locale, number> = { zh: 20, en: 48 };

/** 把工具调用逐个转成校验过的卡片与追问。 */
function makeCollector(catalog: ChatCatalog, query: LocateQuery, locale: Locale) {
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
            outfitCards.push(outfitCard(o, catalog.closets, locale));
        }
        return "cards";
      }
      if (block.name === "show_closets") {
        for (const id of strs(input.closet_ids)) {
          const c = closets.get(id.trim());
          if (c && genderAllows(query, c.gender) && !closetCards.some((x) => x.kind === "closet" && x.id === c.id) && closetCards.length < 2)
            closetCards.push(closetCard(c, locale));
        }
        return "cards";
      }
      if (block.name === "open_page") {
        for (const p of strs(input.pages)) {
          if ((PAGE_KEYS as readonly string[]).includes(p) && allowedPages.has(p as PageKey) && !pageCards.some((x) => x.kind === "page" && x.page === p) && pageCards.length < 2)
            pageCards.push(pageCard(p as PageKey, locale));
        }
        return "cards";
      }
      if (block.name === "suggest_replies") {
        chips = strs(input.replies)
          .map((s) => s.trim())
          .filter((s) => s && s.length <= CHIP_MAX[locale])
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
  /** 回复语言（界面语言）；默认中文 */
  locale?: Locale;
  signal: AbortSignal;
  onText: (d: string) => void;
  onCards: (cards: ChatCard[]) => void;
  onChips: (chips: string[]) => void;
}): Promise<AiOutcome> {
  const { catalog, history, context, query, signal, onText, onCards, onChips } = opts;
  const locale = opts.locale ?? "zh";
  const client = new Anthropic({ maxRetries: 0 });
  const messages = toMessages(history, context, locale);
  if (!messages.length) throw new Error("没有用户消息");

  let streamed = false;
  let rescued = 0;
  const run = async (fast: boolean) => {
    const collect = makeCollector(catalog, query, locale);
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
        system: systemPrompt(catalog, locale),
        tools: chatTools(locale),
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
