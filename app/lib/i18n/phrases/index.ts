// 服务端提示的翻译（见 phrases/en.ts 的说明）。中文原样返回；没有译文时返回原文并在开发环境提示。
import type { Locale } from "../config";
import * as en from "./en";

type PhraseBook = { phrases: Record<string, string>; patterns: ReadonlyArray<readonly [RegExp, string]> };

const BOOKS: Partial<Record<Locale, PhraseBook>> = { en };

export function localizeServerText(locale: Locale, text: string): string;
export function localizeServerText(locale: Locale, text: string | null | undefined): string | null | undefined;
export function localizeServerText(locale: Locale, text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  const book = BOOKS[locale];
  if (!book) return text;
  const exact = book.phrases[text];
  if (exact !== undefined) return exact;
  for (const [re, replacement] of book.patterns) {
    if (re.test(text)) return text.replace(re, replacement);
  }
  if (process.env.NODE_ENV !== "production" && /[一-鿿]/.test(text)) {
    console.warn(`[i18n] 服务端提示缺少 ${locale} 译文：${text}`);
  }
  return text;
}
