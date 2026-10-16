"use client";

// 实况照片（T3，视觉规范 §7.1）：静态图上悬停（桌面，约 150ms）或长按（手机，约 300ms，配一次轻震）变成动态，
// 松开或移出回到静态图。
// - 按下瞬间：画面弹簧放大到约 1.04 倍；一层预先模糊的同图淡入再淡出，形成“略虚化后清晰”；视频从第一帧淡入。
// - 有视频（live）：左上角 LIVE 标，圆环做一次描边动画；视频只在首次悬停或长按时才加载（preload="none"，不自动下载）。
// - 没有视频：同样的手感，换成轻微推镜 + 一道光影扫过，不显示 LIVE 标。
// - 减弱动态（prefers-reduced-motion）：只显示静态图，不放大、不播放。
// - 只动 transform 与 opacity（模糊层的 blur 是静态值，只改它的 opacity）。
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import s from "./LivePhoto.module.css";

const HOVER_DELAY = 150;
const PRESS_DELAY = 300;

export default function LivePhoto({
  image,
  video,
  alt,
  caption,
  eager = false,
}: {
  image: string;
  /** Live 视频地址；没有时用纯前端效果代替。 */
  video?: string | null;
  alt: string;
  /** 卡片底部的一行说明（如场景名）。 */
  caption?: string;
  eager?: boolean;
}) {
  const reduced = useReducedMotion() === true;
  const [active, setActive] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pulse, setPulse] = useState(0);
  const timer = useRef<number | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null);
  const hasLive = !!video;

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const start = useCallback(
    (haptic: boolean) => {
      if (reduced) return;
      setActive(true);
      setPulse((n) => n + 1);
      if (haptic && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(12);
      if (video) {
        setSrc((cur) => cur ?? video);
        const v = vid.current;
        if (v && v.getAttribute("src")) {
          v.currentTime = 0;
          void v.play().catch(() => undefined);
        }
      }
    },
    [reduced, video],
  );

  const stop = useCallback(() => {
    clear();
    setActive(false);
    setPlaying(false);
    const v = vid.current;
    if (v) v.pause();
  }, []);

  // 视频地址刚设置（首次激活）时开始播放。
  useEffect(() => {
    const v = vid.current;
    if (!v || !src || !active) return;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
    // 只在地址首次出现时触发；之后的播放由 start() 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => () => clear(), []);

  // 视频地址变化（例如后台生成好了）时重置。
  useEffect(() => {
    setSrc(null);
    setPlaying(false);
  }, [video]);

  return (
    <figure
      className={s.card}
      data-active={active || undefined}
      data-playing={playing || undefined}
      data-live={hasLive || undefined}
      tabIndex={0}
      aria-label={hasLive ? `${alt}（实况，悬停或长按播放）` : alt}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clear();
        timer.current = window.setTimeout(() => start(false), HOVER_DELAY);
      }}
      onPointerLeave={stop}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        clear();
        timer.current = window.setTimeout(() => start(true), PRESS_DELAY);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== "mouse") stop();
      }}
      onPointerCancel={stop}
      onContextMenu={(e) => {
        // 长按时不弹出系统菜单（保存图片等）
        if (active || timer.current) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start(false);
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onBlur={stop}
    >
      <div className={s.media}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={s.still} src={image} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} />
        {/* 预先模糊的同一张图：按下时淡入再淡出 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={`soft-${pulse}`} className={s.soft} src={image} alt="" aria-hidden="true" decoding="async" draggable={false} />
        {hasLive ? (
          <video
            ref={vid}
            className={s.video}
            src={src ?? undefined}
            poster={image}
            muted
            playsInline
            loop
            preload="none"
            aria-hidden="true"
            onPlaying={() => setPlaying(true)}
            disablePictureInPicture
          />
        ) : (
          <span className={s.sweep} aria-hidden="true" />
        )}
      </div>
      {hasLive ? (
        <span className={s.badge} aria-hidden="true">
          <svg key={`ring-${pulse}`} className={s.ring} width="14" height="14" viewBox="0 0 14 14">
            <circle cx="7" cy="7" r="2.2" fill="currentColor" />
            <circle className={s.ringStroke} cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
          LIVE
        </span>
      ) : null}
      {caption ? <figcaption className={s.caption}>{caption}</figcaption> : null}
    </figure>
  );
}
