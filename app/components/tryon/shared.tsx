"use client";

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

export type Polled = { kind: "ok"; view: TryonView } | { kind: "gone" } | { kind: "error" };

/** 轮询一次试穿进度：404 视为已不存在；网络错误与其他状态交给调用方重试。 */
export async function fetchView(id: string): Promise<Polled> {
  const res = await fetch(`/api/tryon/${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
  if (res?.status === 404) return { kind: "gone" };
  if (!res?.ok) return { kind: "error" };
  const view = (await res.json().catch(() => null)) as TryonView | null;
  return view ? { kind: "ok", view } : { kind: "error" };
}

/** 等到出第一张图（或失败）；每次拿到新进度时回调 onStage。 */
export async function waitFirst(view: TryonView, opts: { alive: () => boolean; onStage?: (v: TryonView) => void; pollMs?: number }) {
  let v = view;
  let misses = 0;
  let first = true;
  while (opts.alive() && v.status === "processing" && !v.resultUrl) {
    await sleep(first ? 400 : (opts.pollMs ?? 800));
    first = false;
    const r = await fetchView(v.id);
    if (r.kind === "gone") return { ...v, status: "failed", stage: "failed" as const, error: "没有找到这次试穿，请再试一次" };
    if (r.kind === "error") {
      if (++misses >= 8) return { ...v, status: "failed", stage: "failed" as const, error: "网络异常，请稍后再试" };
      continue;
    }
    misses = 0;
    v = r.view;
    opts.onStage?.(v);
  }
  return v;
}

/** 等待中的阶段文案。sending：请求还没回来。 */
export function stageLabel(stage: TryonStage | "sending", queuePosition?: number | null) {
  if (stage === "sending") return "正在提交";
  if (stage === "queued") return queuePosition ? `排队中 · 前面 ${queuePosition} 位` : "排队中";
  if (stage === "refining") return "正在细化";
  return "生成中";
}

export async function readError(res: Response | null, fallback: string) {
  if (!res) return "网络异常，请稍后再试";
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

export const cleanName = (n: string) => n.replace(/^占位：/, "");

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
