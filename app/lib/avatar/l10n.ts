// 3D 形象 / 数字分身的视图在响应边界按界面语言本地化（D70）。接口与服务端页面共用：
//   const state = localizeAvatarState(await getAvatarState(userId), await getLocale());
// lib 里的视图始终是中文原文（逻辑与测试按中文工作）；这里只换给人看的文字：
// - 固定文案（处理方说明、质量提示、作业错误、徽标、照片角度…）查 lib/i18n/phrases；
// - AI 写的概括与特征标签只有一种语言（lang）：与界面语言不同时不显示，不夹带另一种语言。
import type { Locale } from "@/lib/i18n/config";
import { localizeServerText } from "@/lib/i18n/phrases";
import type { BodyAnalysisView } from "./body";
import type { AvatarState, JobView, ProviderView } from "./service";
import type { TwinView } from "./twin";

const tx = (locale: Locale, s: string) => localizeServerText(locale, s);

function localizeProvider(p: ProviderView, locale: Locale): ProviderView {
  return { ...p, name: tx(locale, p.name), processor: tx(locale, p.processor) };
}

export function localizeJobView(job: JobView, locale: Locale): JobView {
  return {
    ...job,
    fidelityNote: localizeServerText(locale, job.fidelityNote) ?? null,
    badges: job.badges.map((b) => tx(locale, b)),
    error: job.error ? { ...job.error, message: tx(locale, job.error.message) } : null,
  };
}

/** 体型分析：概括的语言与界面不同时不显示这句（参数照常返回）。 */
export function localizeBodyAnalysis(view: BodyAnalysisView, locale: Locale): BodyAnalysisView {
  return view.summary && view.lang !== locale ? { ...view, summary: null } : view;
}

export function localizeTwinView(twin: TwinView, locale: Locale): TwinView {
  const sameLang = twin.lang === locale;
  return {
    ...twin,
    shots: twin.shots.map((s) => ({ ...s, label: tx(locale, s.label) })),
    summary: sameLang ? twin.summary : null,
    tags: sameLang ? twin.tags : [],
  };
}

export function localizeAvatarState<T extends AvatarState>(state: T, locale: Locale): T {
  return {
    ...state,
    twin: state.twin ? localizeTwinView(state.twin, locale) : null,
    offer: {
      ...state.offer,
      thirdParty: state.offer.thirdParty ? localizeProvider(state.offer.thirdParty, locale) : null,
      bodyAnalysis: state.offer.bodyAnalysis ? { name: tx(locale, state.offer.bodyAnalysis.name) } : null,
    },
    provider: localizeProvider(state.provider, locale),
    photos: state.photos.map((p) => ({ ...p, hints: p.hints.map((h) => tx(locale, h)) })),
    job: state.job ? localizeJobView(state.job, locale) : null,
    bodyAnalysis: state.bodyAnalysis ? localizeBodyAnalysis(state.bodyAnalysis, locale) : null,
  };
}
