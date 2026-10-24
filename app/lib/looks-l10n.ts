// 试衣间（look）里自动生成的文字按界面语言显示（D70 补充）。只在服务端使用（引用了全部语言的字典）。
// - 存库：自动标题与“你手动替换”理由始终是中文，由服务端按目录中文原文生成（createLook），与保存时的界面语言无关。
//   自动标题完全由存库字段决定：模式（mode）、来源搭配（sourceOutfitId）与单品，规则同 fittingRoom 字典的 lookTitle：
//   原搭配 → 搭配名；改编 → “X · 我的版本”；挑一件 → 单品名；挑几件 → “X · 挑选 N 件”，没有来源搭配时“挑选的 N 件”；
//   没有来源搭配的整套 → “整套搭配”。
// - 显示：存库标题等于“任一语言的名称 × 任一语言的模板”算出的候选，就按当前语言重算；都不等则是用户自己写的，原样显示。
//   这样也认得修复前按界面语言存下的旧记录：英文标题、英文理由，以及英文搭配名拼中文后缀的混合标题。
//   AI 与规则改编写的说明、每件理由是生成时的语言，不在此重写。
import { catalogText, localizeItem } from "./i18n/catalog";
import { LOCALES, type Locale } from "./i18n/config";
import { MESSAGES } from "./i18n/messages";
import { createTranslator } from "./i18n/translator";

/** 与 POST /api/looks 的标题长度上限一致。 */
export const LOOK_TITLE_MAX = 60;
/** 一套最多 12 件（POST /api/looks），“挑选 N 件”的 N 不会更大。 */
const MAX_PICK = 12;

const cleanName = (n: string) => n.replace(/^占位：/, "");

/** 算自动标题所需的存库字段；名称都是目录中文原文。 */
export type LookTitleSource = {
  mode: string;
  sourceOutfitId: string | null;
  sourceOutfitName: string | null;
  items: { id: string; name: string }[];
};

function nameIn(locale: Locale, kind: "outfits" | "items", id: string, zh: string) {
  return cleanName(catalogText(locale, kind, id, "name") ?? zh);
}

/** 名称取 names 语言、模板取 words 语言的自动标题；n 是“挑选 N 件”的件数。 */
function render(src: LookTitleSource, n: number, names: Locale, words: Locale): string {
  const t = createTranslator(words, MESSAGES[words], "fittingRoom");
  const outfit =
    src.sourceOutfitId && src.sourceOutfitName ? nameIn(names, "outfits", src.sourceOutfitId, src.sourceOutfitName) : null;
  const first = src.items[0];
  let title: string;
  if (src.mode === "pick" && n === 1 && first) title = nameIn(names, "items", first.id, first.name);
  else if (src.mode === "pick") title = outfit ? t("lookTitle.pickedFrom", { name: outfit, n }) : t("lookTitle.picked", { n });
  else if (src.mode === "original") title = outfit ?? t("lookTitle.outfit");
  else title = outfit ? t("lookTitle.myVersion", { name: outfit }) : t("lookTitle.outfit");
  return title.slice(0, LOOK_TITLE_MAX);
}

/** 存库用的规范标题（中文）；n 是实际保存的件数。 */
export function canonicalLookTitle(src: LookTitleSource): string {
  return render(src, src.items.length, "zh", "zh");
}

/** 标题是不是这套的自动标题（任一语言、含混合写法）；是则返回其中的件数，否则 null。 */
export function matchAutoTitle(title: string, src: LookTitleSource): number | null {
  const counts = src.mode === "pick" ? Array.from({ length: MAX_PICK }, (_, i) => i + 1) : [src.items.length];
  for (const n of counts) {
    for (const names of LOCALES) {
      for (const words of LOCALES) {
        if (render(src, n, names, words) === title) return n;
      }
    }
  }
  return null;
}

/** 显示用标题：自动标题按 locale 重算，用户自己写的原样返回。 */
export function lookTitle(title: string, src: LookTitleSource, locale: Locale): string {
  const n = matchAutoTitle(title, src);
  return n === null ? title : render(src, n, locale, locale);
}

const MANUAL_REASON_ZH = MESSAGES.zh.outfit.manualReason;
const isManualReason = (reason: string) => LOCALES.some((l) => MESSAGES[l].outfit.manualReason === reason);

/** 存库用的单品理由：手动替换（manual，或旧客户端发来的任一语言的“你手动替换”）存中文，其余原样。 */
export function canonicalReason(reason: string | null, manual?: boolean): string | null {
  if (manual || (reason !== null && isManualReason(reason))) return MANUAL_REASON_ZH;
  return reason;
}

/** 显示用单品理由：“你手动替换”换成 locale 的说法，其余原样。 */
export function localizeReason(reason: string | null, locale: Locale): string | null {
  return reason !== null && isManualReason(reason) ? MESSAGES[locale].outfit.manualReason : reason;
}

type LookText = Omit<LookTitleSource, "items"> & { title: string; items: { id: string; name: string; reason: string | null }[] };

/** 一套的标题、来源搭配名、单品名与理由换成 locale（页面与 GET /api/looks 共用）。 */
export function localizeLook<T extends LookText>(look: T, locale: Locale): T {
  return {
    ...look,
    title: lookTitle(look.title, look, locale),
    sourceOutfitName:
      look.sourceOutfitId && look.sourceOutfitName
        ? (catalogText(locale, "outfits", look.sourceOutfitId, "name") ?? look.sourceOutfitName)
        : look.sourceOutfitName,
    items: look.items.map((i) => ({ ...localizeItem(i, locale), reason: localizeReason(i.reason, locale) })),
  } as T;
}
