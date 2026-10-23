"use client";

// 客户端组件取当前语言与翻译。根布局用 <I18nProvider> 把当前语言的字典（只有一种语言）与目录词表传下来；
// 切换语言时写 cookie 再 router.refresh()，根布局重新渲染，换上新字典。
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./config";
import { createTranslator } from "./translator";
import type { Messages, Namespace, Translator } from "./types";

type I18nValue = {
  locale: Locale;
  messages: Messages;
  /** 目录固定词（品类、颜色、材质、风格与场合标签等）中文 → 当前语言；中文时为空表。 */
  terms: Record<string, string>;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  terms,
  children,
}: I18nValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, messages, terms }), [locale, messages, terms]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useT / useLocale 必须在 <I18nProvider> 里使用（根布局已挂好）");
  return v;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

/** const t = useT("tryon"); t("stage.queued", { n: 2 }) */
export function useT<N extends Namespace>(ns: N): Translator<N> {
  const { locale, messages } = useI18n();
  return useMemo(() => createTranslator(locale, messages, ns), [locale, messages, ns]);
}

/** 目录固定词的显示名：term("上装") → "Tops"（英文）/ "上装"（中文）。没有译文时原样返回。 */
export function useTerm(): (zh: string | null | undefined) => string {
  const { terms } = useI18n();
  return useMemo(() => (zh) => (zh ? (terms[zh] ?? zh) : ""), [terms]);
}
