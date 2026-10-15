"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type CSSProperties } from "react";
import styles from "./avatar-viewer/AvatarViewer.module.css";

// three.js 只在浏览器端按需加载，不进首屏包。
const Viewer = dynamic(() => import("./avatar-viewer/Viewer"), {
  ssr: false,
  loading: () => (
    <div className={styles.overlay} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span className="sc-meta">正在准备 3D 查看器…</span>
    </div>
  ),
});

export type AvatarViewerProps = {
  /** GLB 文件地址（同源或允许跨域的 URL） */
  src: string;
  /** 左上角常驻徽章，例如 ["AI 生成", "合身未验证"] */
  badges: string[];
  /** 降级时显示的图片（WebGL 不可用、减弱动态） */
  poster?: string;
  /** 容器高度，数字按 px；默认 420 */
  height?: number | string;
  /** 无障碍描述，默认“可旋转的 3D 形象” */
  label?: string;
  /** 显示“复位视角”按钮（转动或缩放后出现在右下角），默认 true */
  showReset?: boolean;
  /** 用户点了“复位视角”后回调（可选） */
  onReset?: () => void;
};

type Mode = "pending" | "webgl" | "reduced" | "no-webgl";

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export default function AvatarViewer({
  src,
  badges,
  poster,
  height = 420,
  label = "可旋转的 3D 形象",
  showReset = true,
  onReset,
}: AvatarViewerProps) {
  const [mode, setMode] = useState<Mode>("pending");
  const [resetSignal, setResetSignal] = useState(0);
  const [moved, setMoved] = useState(false);
  // 减弱动态时用户仍可主动打开 3D，此时不做下落和自转
  const [staticOptIn, setStaticOptIn] = useState(false);

  useEffect(() => {
    const webgl = hasWebGL();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setMode(!webgl ? "no-webgl" : reduce.matches ? "reduced" : "webgl");
    sync();
    reduce.addEventListener("change", sync);
    return () => reduce.removeEventListener("change", sync);
  }, []);

  const style: CSSProperties = { height: typeof height === "number" ? `${height}px` : height };
  const show3D = mode === "webgl" || (mode === "reduced" && staticOptIn);

  return (
    <div className={styles.root} style={style} role="group" aria-label={label}>
      {show3D ? (
        <Viewer key={src} src={src} animate={mode === "webgl"} resetSignal={resetSignal} onMoved={setMoved} />
      ) : (
        <Fallback mode={mode} poster={poster} onOpen3D={mode === "reduced" ? () => setStaticOptIn(true) : undefined} />
      )}
      {show3D && showReset && (
        <button
          type="button"
          className={styles.reset}
          data-visible={moved || undefined}
          aria-hidden={!moved}
          tabIndex={moved ? 0 : -1}
          onClick={() => {
            setResetSignal((n) => n + 1);
            onReset?.();
          }}
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path
              d="M4.5 10a5.5 5.5 0 1 0 1.7-3.98M4.5 3.5v3h3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          复位视角
        </button>
      )}
      {badges.length > 0 && (
        <div className={styles.badges}>
          {badges.map((b) => (
            <span key={b} className="sc-badge">
              {b}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Fallback({ mode, poster, onOpen3D }: { mode: Mode; poster?: string; onOpen3D?: () => void }) {
  if (mode === "pending") {
    // 首屏与服务端渲染：先放海报或空白占位，不阻塞页面
    // eslint-disable-next-line @next/next/no-img-element
    return poster ? <img className={styles.poster} src={poster} alt="" /> : null;
  }
  const text =
    mode === "no-webgl"
      ? "当前浏览器或设备不支持 3D 显示，以下为静态预览。"
      : "已开启“减弱动态效果”，默认显示静态预览。";
  const textNoPoster =
    mode === "no-webgl" ? "当前浏览器或设备不支持 3D 显示。" : "已开启“减弱动态效果”，3D 形象默认不自动播放。";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster && <img className={styles.poster} src={poster} alt="" />}
      <div className={poster ? styles.posterNote : styles.overlay}>
        <p className={styles.message}>{poster ? text : textNoPoster}</p>
        {onOpen3D && (
          <button type="button" className="sc-cta sc-cta--ghost" onClick={onOpen3D}>
            查看 3D（无动画）
          </button>
        )}
      </div>
    </>
  );
}
