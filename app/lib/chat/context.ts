// 悬浮对话的页面与用户上下文（D68）：告诉模型“用户正在看什么、是谁”，回答才能接住“这套”“这件”“我的尺码”。
// 纯函数，服务端与测试共用。用户数据只取档案里的偏好（风格、颜色、尺码、预算、城市）与状态计数；
// 身高、体重等身体数据不进这里，也就不会发给 Claude（2026-10-23 用户决定）。
// 多语言（D70）：这些说明是给模型看的，locale 为 en 时写英文、用目录译名与英文固定词，模型才会用英文名称回答；默认中文。
import { localizeCurator, localizeItem, localizeOutfit, term, terms } from "../i18n/catalog";
import type { Locale } from "../i18n/config";
import { isRecognized, localizeLabels, parseQuery, type LocateResult } from "../locate/core";
import type { ChatCatalog } from "./cards";
import { normalizeEnglish } from "./english";
import { formatYuan } from "./protocol";

export type PageContext =
  | { kind: "home"; closetId: string | null }
  | { kind: "closet"; closetId: string }
  | { kind: "outfit"; outfitId: string }
  | { kind: "item"; itemId: string }
  | { kind: "fitting-room" }
  | { kind: "bag" }
  | { kind: "avatar" }
  | { kind: "profile" }
  | { kind: "login" }
  | { kind: "other" };

/** 由客户端传来的当前地址（路径 + 查询串）得出用户正在看哪一页。地址不可信：只认目录里存在的 id。 */
export function resolvePage(path: string | null | undefined, catalog: ChatCatalog): PageContext {
  let url: URL;
  try {
    url = new URL(path || "/", "http://local");
  } catch {
    return { kind: "other" };
  }
  const [a, b] = url.pathname.split("/").filter(Boolean);
  const has = <T extends { id: string }>(list: T[], id: string | undefined) => (id && list.some((x) => x.id === id) ? id : null);
  if (!a) return { kind: "home", closetId: has(catalog.closets, url.searchParams.get("c") ?? undefined) };
  if (a === "closet") {
    const id = has(catalog.closets, b);
    return id ? { kind: "closet", closetId: id } : { kind: "other" };
  }
  if (a === "outfit") {
    const id = has(catalog.outfits, b);
    return id ? { kind: "outfit", outfitId: id } : { kind: "other" };
  }
  if (a === "item") {
    const id = has(catalog.items, b);
    return id ? { kind: "item", itemId: id } : { kind: "other" };
  }
  if (a === "fitting-room") return { kind: "fitting-room" };
  if (a === "bag") return { kind: "bag" };
  if (a === "profile") return b === "avatar" ? { kind: "avatar" } : { kind: "profile" };
  if (a === "login") return { kind: "login" };
  return { kind: "other" };
}

const yuan = (n: number) => `¥${n}`;
const no2 = (n: number) => String(n).padStart(2, "0");

export function describePage(page: PageContext, catalog: ChatCatalog, locale: Locale = "zh"): string {
  if (locale !== "zh") return describePageEn(page, catalog, locale);
  const closet = (id: string) => catalog.closets.find((c) => c.id === id);
  switch (page.kind) {
    case "home": {
      const c = page.closetId ? closet(page.closetId) : null;
      return c ? `用户在首页，轮播停在衣橱 ${c.id}「${c.closetName}」。` : "用户在首页。";
    }
    case "closet": {
      const c = closet(page.closetId)!;
      return `用户正在看衣橱 ${c.id}「${c.closetName}」（${c.displayName}，${c.outfitCount} 套搭配）；用户说“这间”时指它。`;
    }
    case "outfit": {
      const o = catalog.outfits.find((x) => x.id === page.outfitId)!;
      const c = closet(o.curatorId);
      return `用户正在看搭配 ${o.id}「${o.name}」（衣橱 ${o.curatorId}「${c?.closetName ?? ""}」的 N°${String(o.no).padStart(2, "0")}，总价 ${yuan(o.total)}）；用户说“这套”“它”时指这套，说“这件”“鞋子”等时指这套里的单品。`;
    }
    case "item": {
      const i = catalog.items.find((x) => x.id === page.itemId)!;
      const inOutfits = catalog.outfits.filter((o) => o.itemIds.includes(i.id)).map((o) => `${o.id}「${o.name}」`);
      return `用户正在看单品 ${i.id}「${i.name}」（${i.category}，${i.color}，${yuan(i.price)}）${inOutfits.length ? `，它出现在搭配 ${inOutfits.join("、")} 里` : ""}；用户说“这件”“它”时指它。`;
    }
    case "fitting-room":
      return "用户在个人试衣间。";
    case "bag":
      return "用户在购物袋页面。";
    case "avatar":
      return "用户在数字分身页面。";
    case "profile":
      return "用户在个人档案页面。";
    case "login":
      return "用户在登录页。";
    default:
      return "";
  }
}

function describePageEn(page: PageContext, catalog: ChatCatalog, locale: Locale): string {
  const closet = (id: string) => {
    const c = catalog.closets.find((x) => x.id === id);
    return c ? localizeCurator(c, locale) : undefined;
  };
  const outfitName = (o: ChatCatalog["outfits"][number]) => localizeOutfit(o, locale).name;
  const price = (n: number) => formatYuan(n, locale);
  switch (page.kind) {
    case "home": {
      const c = page.closetId ? closet(page.closetId) : null;
      return c ? `The user is on the home page; the carousel is showing closet ${c.id} "${c.closetName}".` : "The user is on the home page.";
    }
    case "closet": {
      const c = closet(page.closetId)!;
      return `The user is viewing closet ${c.id} "${c.closetName}" (${c.displayName}, ${c.outfitCount} looks); "this closet" means it.`;
    }
    case "outfit": {
      const o = catalog.outfits.find((x) => x.id === page.outfitId)!;
      const c = closet(o.curatorId);
      return `The user is viewing look ${o.id} "${outfitName(o)}" (N°${no2(o.no)} in closet ${o.curatorId} "${c?.closetName ?? ""}", total ${price(o.total)}); "this look" or "it" means this look, and "this piece", "the shoes" and so on mean pieces in it.`;
    }
    case "item": {
      const raw = catalog.items.find((x) => x.id === page.itemId)!;
      const i = localizeItem(raw, locale);
      const inOutfits = catalog.outfits.filter((o) => o.itemIds.includes(i.id)).map((o) => `${o.id} "${outfitName(o)}"`);
      return `The user is viewing piece ${i.id} "${i.name}" (${term(locale, i.category)}, ${term(locale, i.color)}, ${price(i.price)})${inOutfits.length ? `, which appears in the looks ${inOutfits.join(", ")}` : ""}; "this piece" or "it" means it.`;
    }
    case "fitting-room":
      return "The user is in their Fitting Room.";
    case "bag":
      return "The user is on the Bag page.";
    case "avatar":
      return "The user is on the digital twin page.";
    case "profile":
      return "The user is on their Profile page.";
    case "login":
      return "The user is on the sign-in page.";
    default:
      return "";
  }
}

/** 发给模型的用户状态。刻意没有身高、体重等身体数据字段。 */
export type ChatUser = {
  signedIn: boolean;
  styleTags: string[];
  favoriteColors: string[];
  sizeTop: string | null;
  sizeBottom: string | null;
  sizeShoe: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  city: string | null;
  /** 试穿底图：twin = 数字分身，photo = 只有正面照，null = 还没有形象 */
  avatar: "twin" | "photo" | null;
  tryonEnabled: boolean;
  looks: number;
  bag: number;
};

export function describeUser(u: ChatUser | null, locale: Locale = "zh"): string {
  if (locale !== "zh") return describeUserEn(u, locale);
  if (!u?.signedIn) return "用户未登录：加入试衣间、一键试穿、购物袋都需要先登录。";
  const prefs = [
    u.styleTags.length ? `喜欢的风格 ${u.styleTags.join("、")}` : null,
    u.favoriteColors.length ? `喜欢的颜色 ${u.favoriteColors.join("、")}` : null,
    u.sizeTop || u.sizeBottom || u.sizeShoe
      ? `尺码 ${[u.sizeTop && `上装 ${u.sizeTop}`, u.sizeBottom && `下装 ${u.sizeBottom}`, u.sizeShoe && `鞋 ${u.sizeShoe}`].filter(Boolean).join(" / ")}`
      : null,
    u.budgetMin !== null || u.budgetMax !== null
      ? `平时预算 ${u.budgetMin !== null ? yuan(u.budgetMin) : ""}–${u.budgetMax !== null ? yuan(u.budgetMax) : ""}`
      : null,
    u.city ? `城市 ${u.city}` : null,
  ].filter(Boolean);
  const avatar = !u.tryonEnabled
    ? "本站暂未开放试穿"
    : u.avatar === "twin"
      ? "已建立数字分身，可以一键试穿"
      : u.avatar === "photo"
        ? "上传过正面照，可以一键试穿；还没有数字分身"
        : "还没有数字分身，一键试穿前要先建立";
  return [
    "用户已登录。",
    prefs.length ? `档案：${prefs.join("；")}。` : "档案里还没有填偏好。",
    `${avatar}。试衣间里 ${u.looks} 套，购物袋里 ${u.bag} 件。`,
  ].join("");
}

function describeUserEn(u: ChatUser | null, locale: Locale): string {
  if (!u?.signedIn) return "The user is not signed in: adding to the Fitting Room, one-tap try-on and the Bag all require signing in first.";
  const price = (n: number) => formatYuan(n, locale);
  const prefs = [
    u.styleTags.length ? `favorite styles ${terms(locale, u.styleTags).join(", ")}` : null,
    u.favoriteColors.length ? `favorite colors ${terms(locale, u.favoriteColors).join(", ")}` : null,
    u.sizeTop || u.sizeBottom || u.sizeShoe
      ? `sizes ${[u.sizeTop && `tops ${u.sizeTop}`, u.sizeBottom && `bottoms ${u.sizeBottom}`, u.sizeShoe && `shoes ${u.sizeShoe}`].filter(Boolean).join(" / ")}`
      : null,
    u.budgetMin !== null || u.budgetMax !== null
      ? `usual budget ${u.budgetMin !== null ? price(u.budgetMin) : ""}–${u.budgetMax !== null ? price(u.budgetMax) : ""}`
      : null,
    u.city ? `city ${u.city}` : null,
  ].filter(Boolean);
  const avatar = !u.tryonEnabled
    ? "Try-on isn't available on this site yet"
    : u.avatar === "twin"
      ? "Has a digital twin and can use one-tap try-on"
      : u.avatar === "photo"
        ? "Has uploaded a front-facing photo and can use one-tap try-on; no digital twin yet"
        : "No digital twin yet; one is needed before one-tap try-on";
  return [
    "The user is signed in. ",
    prefs.length ? `Profile: ${prefs.join("; ")}. ` : "No preferences in the profile yet. ",
    `${avatar}. Fitting Room: ${u.looks} looks; Bag: ${u.bag} pieces.`,
  ].join("");
}

/**
 * 这一句本身有没有找衣服的信号（场合、风格、预算、性别、像谁、功能页）；追问“为什么”“鞋子是什么”没有。
 * 英文说法先换成规则层认得的中文词（见 ./english.ts）。
 */
export function hasOwnSignal(text: string, catalog: ChatCatalog): boolean {
  const q = parseQuery(normalizeEnglish(text), catalog.closets);
  return isRecognized(q) || q.pages.length > 0;
}

/** 规则层给模型的初筛提示：只在这句本身有找衣服信号时给，追问时不给（旧候选会把回答拉回老路）。 */
export function rulesHint(r: LocateResult, closets: ChatCatalog["closets"] = [], locale: Locale = "zh"): string {
  if (locale !== "zh") {
    const labels = localizeLabels(r.query, closets, locale);
    const picks = r.outfits.slice(0, 6).map((s) => `${s.outfit.id} ${localizeOutfit(s.outfit, locale).name}`);
    return [labels.length ? `recognized ${labels.join(", ")}` : null, picks.length ? `rule-based shortlist ${picks.join(", ")}` : null]
      .filter(Boolean)
      .join("; ");
  }
  const picks = r.outfits.slice(0, 6).map((s) => `${s.outfit.id} ${s.outfit.name}`);
  return [
    r.query.labels.length ? `识别到 ${r.query.labels.join("、")}` : null,
    picks.length ? `规则初筛候选 ${picks.join("、")}` : null,
  ]
    .filter(Boolean)
    .join("；");
}

