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
export const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
