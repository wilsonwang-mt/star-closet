"use client";

import { useEffect, useRef, useState } from "react";

// 衣橱视频：静音循环。真正开始播放后才淡入，之前一直显示 poster（或上一页定格的那一帧），不闪。
// startAt > 0 时先跳到该时刻再播放，接上上一页的画面。
// 只有首页中央那一间 / 当前衣橱页会挂载它；减弱动态时调用方不挂载。
export default function SceneVideo({
  src,
  poster,
  className,
  startAt = 0,
}: {
  src: string;
  poster: string;
  className?: string;
  startAt?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const play = () => void v.play().catch(() => {});
    const start = () => {
      if (startAt > 0 && Number.isFinite(v.duration) && v.duration > 0) {
        v.addEventListener("seeked", play, { once: true });
        v.currentTime = startAt % v.duration;
      } else {
        play();
      }
    };
    if (v.readyState >= 1) start();
    else v.addEventListener("loadedmetadata", start, { once: true });
    const onVis = () => (document.hidden ? v.pause() : play());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      v.removeEventListener("loadedmetadata", start);
      v.removeEventListener("seeked", play);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [startAt]);

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="auto"
      aria-hidden="true"
      onPlaying={() => setPlaying(true)}
      style={{ opacity: playing ? 1 : 0, transition: "opacity .45s ease" }}
    />
  );
}
