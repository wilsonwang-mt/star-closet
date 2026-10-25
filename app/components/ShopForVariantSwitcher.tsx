"use client";

import type { ShopForVariant } from "@/lib/shopfor";

// 「为谁选」放法探索（explore/shop-for 分支）：页面底部切换方案，写 cookie sc-sfx 后整页刷新。定稿后删除。
const OPTIONS: { v: ShopForVariant | null; short: string; label: string }[] = [
  { v: null, short: "现状", label: "现状" },
  { v: "a", short: "A", label: "A 导航顶层" },
  { v: "b", short: "B", label: "B 首屏分段" },
  { v: "c", short: "C", label: "C 首访轻问" },
];

export default function ShopForVariantSwitcher({ current }: { current: ShopForVariant | null }) {
  function pick(v: ShopForVariant | null) {
    document.cookie = v ? `sc-sfx=${v}; path=/; max-age=31536000; samesite=lax` : "sc-sfx=; path=/; max-age=0; samesite=lax";
    window.location.reload();
  }
  function resetChoice() {
    document.cookie = "sc-shopfor=; path=/; max-age=0; samesite=lax";
    window.location.reload();
  }
  return (
    <div className="sfx-switcher" data-sfx-switcher="" role="group" aria-label="为谁选方案">
      {OPTIONS.map((o) => (
        <button key={o.short} type="button" aria-pressed={current === o.v} onClick={() => pick(o.v)}>
          <span className="sfx-switcher__long">{o.label}</span>
          <span className="sfx-switcher__short">{o.short}</span>
        </button>
      ))}
      <button type="button" className="sfx-switcher__reset" onClick={resetChoice} title="清除已选的女士 / 男士，回到第一次来访">
        <span className="sfx-switcher__long">重置选择</span>
        <span className="sfx-switcher__short">↺</span>
      </button>
    </div>
  );
}
