"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import ItemThumb from "@/components/ItemThumb";
import { CountTo } from "@/components/motion/RollingNumber";
import { BAG_EVENT } from "@/lib/bag/client";
import { MAX_QTY } from "@/lib/bag/core";
import type { BagLine, BagView } from "@/lib/bag/service";
import { useLocale, useT, useTerm } from "@/lib/i18n/client";
import { LOCALE_META } from "@/lib/i18n/config";
import { reducedFade, springs } from "@/lib/motion";
import s from "./bag.module.css";

const keyOf = (l: Pick<BagLine, "itemId" | "size">) => `${l.itemId}:${l.size}`;
/** 目录里“均码”是尺码值（存库、提交都用原值），只在显示时换成当前语言。 */
const ONE_SIZE = "均码";

export default function BagList({ initial }: { initial: BagView }) {
  const reduce = useReducedMotion() === true;
  const t = useT("bag");
  const term = useTerm();
  const locale = useLocale();
  const yuan = (n: number) => `¥${n.toLocaleString(LOCALE_META[locale].intl)}`;
  const sizeLabel = (z: string) => (z === ONE_SIZE ? t("line.oneSize") : z);
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
      setError(t("errors.saveFailed"));
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
          <p className="serif-note" style={{ margin: 0 }}>{t("empty")}</p>
        </section>
        <div className="cta-bar">
          <Link href="/" className="sc-cta">
            {t("browse")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="stack">
      <section className="sc-glass card stack sc-rise" aria-label={t("line.listAria")}>
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
                    {term(l.category)} · {term(l.color)}
                  </span>
                  <div className={s.controls}>
                    {l.sizes.length > 1 ? (
                      <select
                        className={s.select}
                        aria-label={t("line.sizeAria", { name: l.name })}
                        value={l.size}
                        disabled={busy !== null}
                        onChange={(e) => void send("PATCH", l, { toSize: e.target.value })}
                      >
                        {!l.size ? <option value="">{t("line.chooseSize")}</option> : null}
                        {l.sizes.map((z) => (
                          <option key={z} value={z}>
                            {sizeLabel(z)}
                          </option>
                        ))}
                      </select>
                    ) : l.sizes.length === 1 ? (
                      <span className={s.fixed}>{sizeLabel(l.sizes[0])}</span>
                    ) : (
                      <span className={s.fixed}>{t("line.oneSize")}</span>
                    )}
                    <div className={s.stepper} role="group" aria-label={t("line.qtyAria", { name: l.name })}>
                      <button
                        type="button"
                        aria-label={t("line.decrease")}
                        disabled={busy !== null || l.qty <= 1}
                        onClick={() => void send("PATCH", l, { qty: l.qty - 1 })}
                      >
                        −
                      </button>
                      <span aria-live="polite">{l.qty}</span>
                      <button
                        type="button"
                        aria-label={t("line.increase")}
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
                  {l.qty > 1 ? <span className="sc-meta">{t("line.unitPrice", { price: yuan(l.price) })}</span> : null}
                  <button type="button" className="link-btn" disabled={busy !== null} onClick={() => void send("DELETE", l, {})}>
                    {t("line.remove")}
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
      <section className={`sc-glass card ${s.summary}`} aria-label={t("summary.aria")}>
        <span className="sc-meta">{t("summary.count", { n: bag.count })}</span>
        <span className={s.totalRow}>
          <span className="sc-kicker">{t("summary.total")}</span>
          <CountTo className="total sc-foil" value={bag.total} format={(n) => yuan(Math.round(n))} />
        </span>
      </section>
    </div>
  );
}
