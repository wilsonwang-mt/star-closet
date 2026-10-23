"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

export type ThemePref = "dark" | "light" | "system";

const NEXT: Record<ThemePref, ThemePref> = { dark: "light", light: "system", system: "dark" };

function Icon({ pref }: { pref: ThemePref }) {
  if (pref === "dark") {
    return <path d="M15.5 13.6A6.5 6.5 0 0 1 8.4 4.5a6.5 6.5 0 1 0 7.1 9.1Z" />;
  }
  if (pref === "light") {
    return (
      <>
        <circle cx="10" cy="10" r="3.2" />
        <path d="M10 2.6v1.6M10 15.8v1.6M2.6 10h1.6M15.8 10h1.6M4.8 4.8l1.1 1.1M14.1 14.1l1.1 1.1M4.8 15.2l1.1-1.1M14.1 5.9l1.1-1.1" />
      </>
    );
  }
  return (
    <>
      <circle cx="10" cy="10" r="6.4" />
      <path d="M10 3.6a6.4 6.4 0 0 1 0 12.8Z" fill="currentColor" stroke="none" />
    </>
  );
}

// 深色默认；按 夜 → 日 → 跟随系统 循环。偏好存在 cookie，服务端渲染时直接写到 <html data-theme>。
// 圆形图标按钮，放在顶部胶囊导航里；图标切换时带一次弹簧旋入。
export default function ThemeToggle({ initial, className = "" }: { initial: ThemePref; className?: string }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  const t = useT("nav");
  const label = (p: ThemePref) => t(`theme.${p}`);
  function cycle() {
    const next = NEXT[pref];
    setPref(next);
    document.cookie = `sc-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }
  return (
    <button
      type="button"
      className={`sc-nav__icon-btn theme-toggle ${className}`}
      onClick={cycle}
      aria-label={t("theme.aria", { current: label(pref), next: label(NEXT[pref]) })}
      title={t("theme.title", { current: label(pref) })}
    >
      <svg
        key={pref}
        className="theme-toggle__icon"
        viewBox="0 0 20 20"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <Icon pref={pref} />
      </svg>
    </button>
  );
}
