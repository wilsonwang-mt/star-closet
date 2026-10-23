"use client";

// 商品详情页：选尺码 + 加入购物袋（D67，替代原来的外链购买）。未登录时去登录并带回。
// 加入成功后按钮短暂变成“已加入购物袋”，导航角标同步更新。
import Link from "next/link";
import { useState } from "react";
import { addItemsToBag, useBagErrors } from "@/lib/bag/client";
import { useT, useTerm } from "@/lib/i18n/client";
import s from "./AddToBag.module.css";

// 尺码值保持目录原文（发给接口）；只把显示的标签按当前语言翻译（如“均码”）。
export default function AddToBag({ itemId, sizes }: { itemId: string; sizes: string[] }) {
  const t = useT("item");
  const term = useTerm();
  const bagErrors = useBagErrors();
  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const needSize = sizes.length > 1 && !size;

  async function add() {
    if (needSize) {
      setError(t("bag.pickSize"));
      return;
    }
    setState("busy");
    setError(null);
    const r = await addItemsToBag([{ itemId, size, qty: 1 }], bagErrors);
    if (r.ok) {
      setState("done");
      window.setTimeout(() => setState("idle"), 2400);
    } else {
      setState("idle");
      if ("error" in r) setError(r.error);
    }
  }

  return (
    <div className={s.wrap}>
      {sizes.length > 1 ? (
        <div className={s.sizes} role="radiogroup" aria-label={t("bag.sizes")}>
          {sizes.map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={size === z}
              className={s.size}
              onClick={() => {
                setSize(z);
                setError(null);
              }}
            >
              {term(z)}
            </button>
          ))}
        </div>
      ) : null}
      <div className={s.row}>
        <button type="button" className={`sc-cta sc-cta--ghost ${s.add}`} disabled={state === "busy"} onClick={() => void add()}>
          {state === "done" ? t("bag.added") : t("bag.add")}
        </button>
        {state === "done" ? (
          <Link href="/bag" className="link-btn fade-in">
            {t("bag.view")}
          </Link>
        ) : null}
      </div>
      {error ? (
        <p className="sc-meta" role="alert" style={{ margin: 0, color: "var(--sc-champ-text)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
