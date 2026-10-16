"use client";

// 商品详情页：选尺码 + 加入购物袋（D67，替代原来的外链购买）。未登录时去登录并带回。
// 加入成功后按钮短暂变成“已加入购物袋”，导航角标同步更新。
import Link from "next/link";
import { useState } from "react";
import { addItemsToBag } from "@/lib/bag/client";
import s from "./AddToBag.module.css";

export default function AddToBag({ itemId, sizes }: { itemId: string; sizes: string[] }) {
  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const needSize = sizes.length > 1 && !size;

  async function add() {
    if (needSize) {
      setError("先选一个尺码");
      return;
    }
    setState("busy");
    setError(null);
    const r = await addItemsToBag([{ itemId, size, qty: 1 }]);
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
        <div className={s.sizes} role="radiogroup" aria-label="尺码">
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
              {z}
            </button>
          ))}
        </div>
      ) : null}
      <div className={s.row}>
        <button type="button" className={`sc-cta sc-cta--ghost ${s.add}`} disabled={state === "busy"} onClick={() => void add()}>
          {state === "done" ? "已加入购物袋" : "加入购物袋"}
        </button>
        {state === "done" ? (
          <Link href="/bag" className="link-btn fade-in">
            查看购物袋
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
