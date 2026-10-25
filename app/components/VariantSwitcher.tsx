"use client";

// 字体与布局探索（explore/type-layout 分支）：在页面底部切换方案，写 cookie sc-variant 后整页刷新。定稿后删除。
export type Variant = "a" | "b" | "c";

const OPTIONS: { v: Variant | null; short: string; label: string }[] = [
  { v: null, short: "现状", label: "现状" },
  { v: "a", short: "A", label: "A 克制大写" },
  { v: "b", short: "B", label: "B 编辑大字" },
  { v: "c", short: "C", label: "C 只加留白" },
];

export default function VariantSwitcher({ current }: { current: Variant | null }) {
  function pick(v: Variant | null) {
    document.cookie = v ? `sc-variant=${v}; path=/; max-age=31536000; samesite=lax` : "sc-variant=; path=/; max-age=0; samesite=lax";
    window.location.reload();
  }
  return (
    <div className="variant-switcher" data-variant-switcher="" role="group" aria-label="探索方案">
      {OPTIONS.map((o) => (
        <button key={o.short} type="button" aria-pressed={current === o.v} onClick={() => pick(o.v)}>
          <span className="variant-switcher__long">{o.label}</span>
          <span className="variant-switcher__short">{o.short}</span>
        </button>
      ))}
    </div>
  );
}
