"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ItemThumb from "./ItemThumb";
import type { Look } from "@/lib/looks";

const MODE_LABEL: Record<string, string> = { original: "主理人原搭配", ai: "AI 改编", offline: "规则改编 · 非 AI" };

export default function LookCard({ look }: { look: Look }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(look.items.map((i) => i.id)));
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const chosen = look.items.filter((i) => selected.has(i.id));
  const chosenTotal = chosen.reduce((s, i) => s + i.price, 0);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function remove() {
    setDeleting(true);
    await fetch(`/api/looks/${look.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="sc-glass card stack sc-rise">
      <div className="spread">
        <div>
          <span className="sc-kicker">{MODE_LABEL[look.mode] ?? look.mode}</span>
          <h2 className="section-title">{look.title}</h2>
        </div>
        <button className="link-btn" onClick={remove} disabled={deleting}>
          移出
        </button>
      </div>
      {look.request ? <p className="serif-note">“{look.request}”</p> : null}
      <div className="rows">
        {look.items.map((it) => (
          <label key={it.id} className="sc-glass sc-glass--row item-row" style={{ color: "inherit", cursor: "pointer", fontSize: "inherit", letterSpacing: 0 }}>
            <ItemThumb name={it.name} image={it.image} color={it.color} />
            <span>
              <span className="item-name" style={{ display: "block" }}>{it.name.replace(/^占位：/, "")}</span>
              <span className="sc-meta">
                {it.category} · {it.color}
              </span>
            </span>
            <span className="row" style={{ justifyContent: "flex-end" }}>
              <span className="price">¥{it.price}</span>
              <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)} aria-label={`选择${it.name}`} />
            </span>
          </label>
        ))}
      </div>
      <div className="spread">
        <span className="sc-meta">已选 {chosen.length} / {look.items.length} 件</span>
        <span className="total sc-foil">¥{chosenTotal}</span>
      </div>
      {chosen.length ? (
        <button className="sc-cta" onClick={() => setOpen(!open)} aria-expanded={open}>
          {/* 站内没有支付：按钮只生成去商家页面的购物清单，文案与页面说明一致 */}
          {open ? "收起购物清单" : `生成购物清单（${chosen.length} 件）`}
        </button>
      ) : null}
      {open && chosen.length ? (
        <div className="stack" style={{ gap: 8 }}>
          <ol className="small" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
            {chosen.map((it) => (
              <li key={it.id}>
                <a href={it.buyUrl} target="_blank" rel="noopener noreferrer">
                  {it.name.replace(/^占位：/, "")} · ¥{it.price} ↗
                </a>
              </li>
            ))}
          </ol>
          <p className="sc-meta" style={{ margin: 0 }}>外链到商家页面购买，价格与库存以商家页面为准。</p>
        </div>
      ) : null}
    </section>
  );
}
