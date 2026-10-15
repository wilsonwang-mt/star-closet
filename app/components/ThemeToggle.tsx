"use client";

import { useState } from "react";

export type ThemePref = "dark" | "light" | "system";

const NEXT: Record<ThemePref, ThemePref> = { dark: "light", light: "system", system: "dark" };
const LABEL: Record<ThemePref, string> = { dark: "夜", light: "日", system: "自动" };

// 深色默认；可切换浅色或跟随系统。偏好存在 cookie，服务端渲染时直接写到 <html data-theme>。
export default function ThemeToggle({ initial }: { initial: ThemePref }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  function cycle() {
    const next = NEXT[pref];
    setPref(next);
    document.cookie = `sc-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }
  return (
    <button className="theme-toggle" onClick={cycle} aria-label={`切换显示模式，当前：${LABEL[pref]}`}>
      {LABEL[pref]}
    </button>
  );
}
