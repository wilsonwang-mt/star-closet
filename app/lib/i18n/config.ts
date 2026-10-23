// 多语言（D70）：支持的语言、默认语言、cookie 与浏览器语言协商。纯函数，浏览器、服务端与测试共用。
// 新增一种语言：在 LOCALES 与 LOCALE_META 里登记，再补 lib/i18n/messages/<locale>/ 与 data/catalog.<locale>.json，
// 见 app/README.md「多语言」。

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** 没有 cookie、浏览器也没有可匹配的语言时使用。 */
export const DEFAULT_LOCALE: Locale = "zh";

/** 访客手动选择的语言，存一年；优先于浏览器语言。 */
export const LOCALE_COOKIE = "sc-locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_META: Record<Locale, { htmlLang: string; intl: string; label: string; short: string }> = {
  zh: { htmlLang: "zh-CN", intl: "zh-CN", label: "中文", short: "中" },
  en: { htmlLang: "en", intl: "en-US", label: "English", short: "EN" },
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** 把一个语言标签（如 en-GB、zh-Hant-TW）对到本站支持的语言；对不上返回 null。 */
export function matchLocale(tag: string): Locale | null {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(primary) ? primary : null;
}

/**
 * 按 Accept-Language 的权重顺序找第一个本站支持的语言（“跟随浏览器”）。
 * 例：“ja,en;q=0.8,zh;q=0.5” → en；“fr” → null（交给默认语言）。q=0 表示不接受，跳过。
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((r) => r.tag && r.tag !== "*" && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const r of ranked) {
    const locale = matchLocale(r.tag);
    if (locale) return locale;
  }
  return null;
}

/** 手动选择（cookie）优先，其次浏览器语言，最后默认语言。 */
export function resolveLocale(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  return negotiateLocale(acceptLanguage) ?? DEFAULT_LOCALE;
}
