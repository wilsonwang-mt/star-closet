// 服务端取当前语言（Server Component、Route Handler、Server Action 里用）。
// 顺序：cookie sc-locale（手动选择）→ Accept-Language（跟随浏览器）→ 默认中文。
// 在请求之外调用（单元测试、脚本）时拿不到 cookies()，回落到默认语言，所以 lib 里的中文输出与现有测试不变。
import { cookies, headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { catalogTerms, localizeCurator, localizeItem, localizeOutfit, term, terms } from "./catalog";
import { MESSAGES } from "./messages";
import { localizeServerText } from "./phrases";
import { createTranslator } from "./translator";
import type { Namespace, Translator } from "./types";

export async function getLocale(): Promise<Locale> {
  try {
    const [c, h] = await Promise.all([cookies(), headers()]);
    return resolveLocale(c.get(LOCALE_COOKIE)?.value, h.get("accept-language"));
  } catch (e) {
    // Next 用抛错来标记“这一页需要动态渲染”等内部流程，这类错误必须原样抛出，不能吞掉。
    unstable_rethrow(e);
    return DEFAULT_LOCALE;
  }
}

/** 当前请求语言的翻译函数：const t = await getT("closet"); t("title") */
export async function getT<N extends Namespace>(ns: N): Promise<Translator<N>> {
  const locale = await getLocale();
  return createTranslator(locale, MESSAGES[locale], ns);
}

/** 已知语言时直接取翻译函数（例如把语言作为参数传进 lib）。 */
export function tFor<N extends Namespace>(locale: Locale, ns: N): Translator<N> {
  return createTranslator(locale, MESSAGES[locale], ns);
}

/**
 * 当前请求语言的目录本地化工具，给页面在把数据交给组件前使用：
 *   const l10n = await getCatalogL10n();
 *   const outfits = (await getOutfits()).map(l10n.outfit);
 * 只换自由文本（名称、简介、说明）；品类、标签等固定词保持中文，显示时用 l10n.term() / useTerm() 翻译。
 */
export async function getCatalogL10n() {
  const locale = await getLocale();
  return {
    locale,
    term: (zh: string | null | undefined) => term(locale, zh),
    terms: (list: readonly string[] | null | undefined) => terms(locale, list),
    termTable: () => catalogTerms(locale),
    curator: <T extends Parameters<typeof localizeCurator>[0]>(c: T) => localizeCurator(c, locale),
    item: <T extends Parameters<typeof localizeItem>[0]>(i: T) => localizeItem(i, locale),
    outfit: <T extends Parameters<typeof localizeOutfit>[0]>(o: T) => localizeOutfit(o, locale),
  };
}

/** 服务端发出的中文提示按当前请求语言翻译（见 phrases/en.ts）。 */
export async function localizeServer(text: string): Promise<string> {
  return localizeServerText(await getLocale(), text);
}
