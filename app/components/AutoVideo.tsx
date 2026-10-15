"use client";

import { useEffect, useRef } from "react";

// 静音循环的场景视频：只播放当前可见的那一个（夜/日/宽屏由 CSS 决定显示哪个），
// 开启“减弱动态效果”时不播放，只显示 poster（视频第一帧）。
export default function AutoVideo({ src, poster, className }: { src: string; poster: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      const visible = getComputedStyle(video).display !== "none";
      if (visible && !reduce.matches) {
        if (video.preload !== "auto") video.preload = "auto";
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const queries = [reduce, window.matchMedia("(prefers-color-scheme: dark)"), window.matchMedia("(min-width: 900px)")];
    queries.forEach((q) => q.addEventListener("change", sync));
    return () => {
      observer.disconnect();
      queries.forEach((q) => q.removeEventListener("change", sync));
    };
  }, []);

  return <video ref={ref} className={className} src={src} poster={poster} muted loop playsInline preload="none" aria-hidden="true" />;
}
