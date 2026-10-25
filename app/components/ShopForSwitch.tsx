"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SHOP_FOR_COOKIE, type ShopFor } from "@/lib/shopfor";
import { useT } from "@/lib/i18n/client";
import s from "./ShopForSwitch.module.css";

// 「为谁选」开关（探索中）：三种放法共用一个组件——nav 导航顶层、segment 首屏分段、prompt 首访轻问。
// 选择写进 cookie 后刷新服务端数据（首页轮播、搭配区、全部衣橱页默认条件跟着变）。
const OPTIONS: ShopFor[] = ["all", "women", "men"];

export default function ShopForSwitch({ kind, current }: { kind: "nav" | "segment" | "prompt"; current: ShopFor | null }) {
  const t = useT("nav");
  const router = useRouter();
  const [value, setValue] = useState<ShopFor | null>(current);
  const [asking, setAsking] = useState(current === null);

  function pick(v: ShopFor) {
    setValue(v);
    setAsking(false);
    document.cookie = `${SHOP_FOR_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const label = (v: ShopFor) => t(`shopFor.${v}`);
  const active = value ?? "all";

  if (kind === "prompt") {
    if (!asking) {
      return (
        <p className={`${s.chosen} sf-prompt`}>
          <span>{t("shopFor.current", { who: label(active) })}</span>
          <button type="button" className={s.change} onClick={() => setAsking(true)}>
            {t("shopFor.change")}
          </button>
        </p>
      );
    }
    return (
      <div className={`${s.prompt} sf-prompt`} role="group" aria-label={t("shopFor.ask")}>
        <span className={s.ask}>{t("shopFor.ask")}</span>
        <span className={s.answers}>
          <button type="button" onClick={() => pick("women")}>{label("women")}</button>
          <button type="button" onClick={() => pick("men")}>{label("men")}</button>
          <button type="button" className={s.quiet} onClick={() => pick("all")}>{t("shopFor.browse")}</button>
        </span>
      </div>
    );
  }

  return (
    <div className={`${kind === "nav" ? s.nav : s.segment} ${kind === "nav" ? "sf-nav" : "sf-segment"}`} role="group" aria-label={t("shopFor.label")}>
      {OPTIONS.map((v) => (
        <button key={v} type="button" aria-pressed={active === v} onClick={() => pick(v)}>
          {label(v)}
        </button>
      ))}
    </div>
  );
}
