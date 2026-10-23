// 2D 试穿视图在响应边界按界面语言本地化（D70）。接口与服务端页面共用：
//   json(localizeTryonView(view, await getLocale()))
// lib 里的视图始终是中文原文（品类判断与测试按中文工作）；这里只换给人看的文字：
// 存库的失败说明查 lib/i18n/phrases，单品名按编号查英文目录；类别标签（applied）是固定词，前端用 useTerm 显示。
import { localizeItem } from "@/lib/i18n/catalog";
import type { Locale } from "@/lib/i18n/config";
import { localizeServerText } from "@/lib/i18n/phrases";
import type { TryonContext, TryonView } from "./service";

export function localizeTryonView<T extends TryonView>(view: T, locale: Locale): T {
  return {
    ...view,
    error: localizeServerText(locale, view.error) ?? null,
    items: view.items.map((i) => localizeItem(i, locale)),
  };
}

export function localizeTryonContext<T extends TryonContext>(ctx: T, locale: Locale): T {
  return { ...ctx, providerName: localizeServerText(locale, ctx.providerName) };
}
