// 商品详情页上身效果的视图在响应边界按界面语言本地化（D70）。接口与服务端页面共用：
//   json(localizeSceneState(state, await getLocale()))
// 场景标题与存库的失败说明都是固定文案，查 lib/i18n/phrases。
import type { Locale } from "@/lib/i18n/config";
import { localizeServerText } from "@/lib/i18n/phrases";
import type { SceneRenderView, SceneState } from "./service";

export function localizeSceneRender(r: SceneRenderView, locale: Locale): SceneRenderView {
  return { ...r, title: localizeServerText(locale, r.title), error: localizeServerText(locale, r.error) ?? null };
}

export function localizeSceneState<T extends SceneState>(state: T, locale: Locale): T {
  return { ...state, renders: state.renders.map((r) => localizeSceneRender(r, locale)) };
}
