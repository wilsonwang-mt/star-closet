"use client";

// 首屏方案探索（explore/home-hero 分支）：在页面底部切换方案，写 cookie sc-hero 后整页刷新。定稿后删除。
export type Hero = "a" | "b" | "c";

const OPTIONS: { v: Hero | null; short: string; label: string }[] = [
  { v: null, short: "现状", label: "现状" },
  { v: "a", short: "A", label: "A 主张压在图上" },
  { v: "b", short: "B", label: "B 一行小字" },
  { v: "c", short: "C", label: "C 只换文案" },
];

export default function HeroSwitcher({ current }: { current: Hero | null }) {
  function pick(v: Hero | null) {
    document.cookie = v ? `sc-hero=${v}; path=/; max-age=31536000; samesite=lax` : "sc-hero=; path=/; max-age=0; samesite=lax";
    window.location.reload();
  }
  return (
    <div className="hero-switcher" data-hero-switcher="" role="group" aria-label="首屏方案">
      {OPTIONS.map((o) => (
        <button key={o.short} type="button" aria-pressed={current === o.v} onClick={() => pick(o.v)}>
          <span className="hero-switcher__long">{o.label}</span>
          <span className="hero-switcher__short">{o.short}</span>
        </button>
      ))}
    </div>
  );
}
