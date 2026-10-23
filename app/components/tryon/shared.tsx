"use client";

import { useLocale, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/types";
import type { TryonStage, TryonView } from "@/lib/tryon/service";

// 试穿组件共用的小工具：照片压缩、轮询、错误读取、图片预解码、名称清理与衣架图标。

// FASHN 输出 864×1296，底图再大没有收益，只多传字节（D62）。这张照片同时是 3D 形象流程的正面照。
const MAX_EDGE = 1296;

/** 在本机压缩到最长边 1296px 并重新编码为 JPEG（顺带去掉 EXIF），服务端还会再剥离一次。 */
export async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("encode failed");
  return blob;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 两次轮询之间至少留这么久。 */
const MIN_POLL_GAP_MS = 150;

/**
 * 轮询间隔按两次请求的开始时间计：一次轮询本身就要 1–1.5 秒时（本机连 Supabase 实测），
 * 不再在响应之后整段再等，否则实际间隔被拉长到 2 秒以上，出图后要晚一两秒才看到。
 */
export const pollDelay = (intervalMs: number, lastRequestMs: number) => Math.max(MIN_POLL_GAP_MS, intervalMs - lastRequestMs);

export type Polled = { kind: "ok"; view: TryonView } | { kind: "gone" } | { kind: "error" };

/** 轮询一次试穿进度：404 视为已不存在；网络错误与其他状态交给调用方重试。 */
export async function fetchView(id: string): Promise<Polled> {
  const res = await fetch(`/api/tryon/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
  if (res?.status === 404) return { kind: "gone" };
  if (!res?.ok) return { kind: "error" };
  const view = (await res.json().catch(() => null)) as TryonView | null;
  return view ? { kind: "ok", view } : { kind: "error" };
}

/** 轮询失败时写进结果的提示（当前语言）；不传时 error 为 null，由调用方用自己的兜底提示。 */
export type WaitErrors = { gone: string; network: string };

/** 等到出第一张图（或失败）；每次拿到新进度时回调 onStage。 */
export async function waitFirst(
  view: TryonView,
  opts: { alive: () => boolean; onStage?: (v: TryonView) => void; pollMs?: number; errors?: WaitErrors },
) {
  let v = view;
  let misses = 0;
  let first = true;
  let lastMs = 0;
  while (opts.alive() && v.status === "processing" && !v.resultUrl) {
    await sleep(first ? 400 : pollDelay(opts.pollMs ?? 800, lastMs));
    first = false;
    const startedAt = Date.now();
    const r = await fetchView(v.id);
    lastMs = Date.now() - startedAt;
    if (r.kind === "gone") return { ...v, status: "failed", stage: "failed" as const, error: opts.errors?.gone ?? null };
    if (r.kind === "error") {
      if (++misses >= 8) return { ...v, status: "failed", stage: "failed" as const, error: opts.errors?.network ?? null };
      continue;
    }
    misses = 0;
    v = r.view;
    opts.onStage?.(v);
  }
  return v;
}

/** 当前语言的轮询失败提示，传给 waitFirst。 */
export function waitErrors(t: Translator<"tryon">): WaitErrors {
  return { gone: t("errors.notFound"), network: t("errors.network") };
}

/** 等待中的阶段文案。sending：请求还没回来。 */
export function stageLabel(t: Translator<"tryon">, stage: TryonStage | "sending", queuePosition?: number | null) {
  if (stage === "sending") return t("stage.sending");
  if (stage === "queued") return queuePosition ? t("stage.queuedAhead", { n: queuePosition }) : t("stage.queued");
  if (stage === "refining") return t("stage.refining");
  return t("stage.generating");
}

/** 读接口返回的 error（服务端已按当前语言翻译）；没有时用 fallback。network：请求没发出去时的提示，缺省同 fallback。 */
export async function readError(res: Response | null, fallback: string, network: string = fallback) {
  if (!res) return network;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** 预加载并解码图片：交叉过渡开始时新图已就绪，不会先闪一帧空白。 */
export function preload(src: string) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.src = src;
    img.decode().then(
      () => resolve(),
      () => resolve(),
    );
  });
}

// 去掉目录里占位单品名的前缀（数据约定，不是界面文案）。
export const cleanName = (n: string) => n.replace(/^占位：/, "");

/**
 * 同意文案（D47），如实写明处理方。处理方名称由服务端给出（lib/tryon/provider.ts 的中文常量“fal.ai 上的 AI 模型”）；
 * 非中文界面遇到中文名称时换成字典里的译名，已是译文时原样使用。
 */
export function useConsentLabel(providerName: string | null | undefined): string {
  const t = useT("tryon");
  const locale = useLocale();
  const provider = !providerName || (locale !== "zh" && /[\u3400-\u9fff]/.test(providerName)) ? t("consent.provider") : providerName;
  return t("consent.agree", { provider });
}

export function HangerIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 5.2V4.6a1.6 1.6 0 1 1 1.6-1.6M8 5.2 1.8 10.4c-.5.4-.2 1.1.4 1.1h11.6c.6 0 .9-.7.4-1.1L8 5.2Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 1l10 10M11 1 1 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
