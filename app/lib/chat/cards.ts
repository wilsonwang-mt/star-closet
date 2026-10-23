// 悬浮对话的目录类型与卡片数据（纯函数，服务端与测试共用；不连数据库）。读取目录见 ./catalog.ts。
// 多语言（D70）：目录里永远是中文，规则层与 AI 的 id 校验都按中文目录工作；卡片在发给前端时按语言换成译名，
// 自由文本查目录覆盖表（localizeCurator / localizeOutfit），固定词（衣橱类型、场合）查 term()；没有译文时原样显示中文。
import { localizeCurator, localizeOutfit, terms, term } from "../i18n/catalog";
import type { Locale } from "../i18n/config";
import { MESSAGES } from "../i18n/messages";
import { createTranslator } from "../i18n/translator";
import type { LocateCloset, LocateOutfit, PageKey } from "../locate/core";
import type { ClosetCard, OutfitCard, PageCard } from "./protocol";

/** 单品的精简信息：给 AI 回答“鞋子是什么”“配什么裤子”这类细节问题用。 */
export type ChatItem = {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  color: string;
  material: string | null;
  price: number;
  gender: string;
};
export type ChatOutfit = LocateOutfit & { itemIds: string[] };
/** 规则层用到的部分（LocateCatalog）+ 单品明细。 */
export type ChatCatalog = { closets: LocateCloset[]; outfits: ChatOutfit[]; items: ChatItem[] };

export function closetCard(c: LocateCloset, locale: Locale = "zh"): ClosetCard {
  const l = localizeCurator(c, locale);
  return {
    kind: "closet",
    id: c.id,
    closetName: l.closetName,
    displayName: c.displayName,
    closetType: term(locale, c.closetType),
    tagline: l.tagline,
    avatar: c.avatar,
    cover: c.cover,
    outfitCount: c.outfitCount,
  };
}

export function outfitCard(o: LocateOutfit, closets: LocateCloset[], locale: Locale = "zh"): OutfitCard {
  const closet = closets.find((c) => c.id === o.curatorId);
  return {
    kind: "outfit",
    id: o.id,
    name: localizeOutfit(o, locale).name,
    closetName: closet ? localizeCurator(closet, locale).closetName : "",
    curatorId: o.curatorId,
    no: o.no,
    total: o.total,
    cover: o.cover,
    occasion: terms(locale, o.occasionTags.slice(0, 2)).join(" · "),
  };
}

/** 2D 试穿只在配置了 FAL_KEY 时才有入口（AGENTS.md D55）。 */
export function availablePages(): PageKey[] {
  const all: PageKey[] = ["closets", "fitting-room", "avatar", "tryon", "bag", "profile", "login"];
  return all.filter((p) => p !== "tryon" || Boolean(process.env.FAL_KEY));
}

// 标题与说明在 chat 字典的 pages.*；引题是英文，各语言相同
const PAGES: Record<PageKey, { href: string; kicker: string; key: keyof (typeof MESSAGES)["zh"]["chat"]["pages"] }> = {
  closets: { href: "/", kicker: "The Closets", key: "closets" },
  "fitting-room": { href: "/fitting-room", kicker: "Fitting Room", key: "fittingRoom" },
  avatar: { href: "/profile/avatar", kicker: "Avatar", key: "avatar" },
  tryon: { href: "/fitting-room", kicker: "Try On", key: "tryon" },
  bag: { href: "/bag", kicker: "Bag", key: "bag" },
  profile: { href: "/profile", kicker: "Profile", key: "profile" },
  login: { href: "/login", kicker: "Sign In", key: "login" },
};

function pageText(page: PageKey, locale: Locale) {
  const t = createTranslator(locale, MESSAGES[locale], "chat");
  const { key } = PAGES[page];
  return { title: t(`pages.${key}.title`), desc: t(`pages.${key}.desc`) };
}

export function pageCard(page: PageKey, locale: Locale = "zh"): PageCard {
  const { href, kicker } = PAGES[page];
  return { kind: "page", page, href, kicker, ...pageText(page, locale) };
}

/** 给 AI 看的功能页清单 */
export function pagesForPrompt(locale: Locale = "zh"): string {
  const sep = locale === "zh" ? "｜" : " | ";
  return availablePages()
    .map((p) => {
      const { title, desc } = pageText(p, locale);
      return [p, title, desc].join(sep);
    })
    .join("\n");
}
