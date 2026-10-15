"use client";

import { useSyncExternalStore } from "react";

/** 媒体查询；服务端与首帧返回 null（未知），避免在桌面上先挂载一次手机视频。 */
export function useMedia(query: string): boolean | null {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

export const WIDE_QUERY = "(min-width: 900px)";
/** 宽栏（--sc-col-wide）与三列搭配网格的断点，与 globals.css 一致 */
export const COLS3_QUERY = "(min-width: 1100px)";
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
