"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import ItemThumb from "@/components/ItemThumb";
import { CountTo } from "@/components/motion/RollingNumber";
import { BAG_EVENT } from "@/lib/bag/client";
import { MAX_QTY } from "@/lib/bag/core";
import type { BagLine, BagView } from "@/lib/bag/service";
import { reducedFade, springs } from "@/lib/motion";
import s from "./bag.module.css";

const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;
const keyOf = (l: Pick<BagLine, "itemId" | "size">) => `${l.itemId}:${l.size}`;

export default function BagList({ initial }: { initial: BagView }) {
  const reduce = useReducedMotion() === true;
  const [bag, setBag] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "PATCH" | "DELETE", line: BagLine, body: Record<string, unknown>) {
    setBusy(keyOf(line));
    setError(null);
    const res = await fetch("/api/bag", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: line.itemId, size: line.size, ...body }),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError("没有保存成功，请再试一次");
      return;
    }
    const next = (await res.json()) as BagView;
    setBag(next);
    window.dispatchEvent(new CustomEvent(BAG_EVENT, { detail: { count: next.count } }));
  }

  if (!bag.lines.length) {
    return (
      <>
        <section className="sc-glass card stack sc-rise">
          <p className="serif-note" style={{ margin: 0 }}>购物袋还是空的。逛衣橱时，单品、整套或勾选的几件都可以加进来。</p>
        </section>
        <div className="cta-bar">
          <Link href="/" className="sc-cta">
            去逛衣橱
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="stack">
      <section className="sc-glass card stack sc-rise" aria-label="购物袋中的单品">
        <ul className={s.lines}>
          <AnimatePresence initial={false}>
            {bag.lines.map((l) => (
              <motion.li
                key={keyOf(l)}
                layout={reduce ? false : "position"}
                className={`sc-glass sc-glass--row ${s.line}`}
                initial={false}
                exit={reduce ? { opacity: 0, transition: reducedFade } : { opacity: 0, scale: 0.97, transition: { duration: 0.22 } }}
                transition={springs.rise}
                aria-busy={busy === keyOf(l) || undefined}
              >
                <ItemThumb name={l.name} image={l.image} color={l.color} href={`/item/${l.itemId}`} />
                <div className={s.info}>
                  <Link href={`/item/${l.itemId}`} className={s.name}>
                    {l.name}
                  </Link>
                  <span className="sc-meta">
                    {l.category} · {l.color}
                  </span>
                  <div className={s.controls}>
                    {l.sizes.length > 1 ? (
                      <select
                        className={s.select}
                        aria-label={`${l.name}的尺码`}
                        value={l.size}
                        disabled={busy !== null}
                        onChange={(e) => void send("PATCH", l, { toSize: e.target.value })}
                      >
                        {!l.size ? <option value="">选择尺码</option> : null}
                        {l.sizes.map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </select>
                    ) : l.sizes.length === 1 ? (
                      <span className={s.fixed}>{l.sizes[0]}</span>
                    ) : (
                      <span className={s.fixed}>均码</span>
                    )}
                    <div className={s.stepper} role="group" aria-label={`${l.name}的数量`}>
                      <button
                        type="button"
                        aria-label="减少一件"
                        disabled={busy !== null || l.qty <= 1}
                        onClick={() => void send("PATCH", l, { qty: l.qty - 1 })}
                      >
                        −
                      </button>
                      <span aria-live="polite">{l.qty}</span>
                      <button
                        type="button"
                        aria-label="增加一件"
                        disabled={busy !== null || l.qty >= MAX_QTY}
                        onClick={() => void send("PATCH", l, { qty: l.qty + 1 })}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
                <div className={s.end}>
                  <span className="price">{yuan(l.price * l.qty)}</span>
                  {l.qty > 1 ? <span className="sc-meta">单价 {yuan(l.price)}</span> : null}
                  <button type="button" className="link-btn" disabled={busy !== null} onClick={() => void send("DELETE", l, {})}>
                    移除
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      <section className={`sc-glass card ${s.summary}`} aria-label="合计">
        <span className="sc-meta">共 {bag.count} 件</span>
        <span className={s.totalRow}>
          <span className="sc-kicker">合计</span>
          <CountTo className="total sc-foil" value={bag.total} format={(n) => yuan(Math.round(n))} />
        </span>
      </section>
    </div>
  );
}
