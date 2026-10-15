"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ItemThumb from "./ItemThumb";
import type { Look } from "@/lib/looks";

const MODE_LABEL: Record<string, string> = { original: "主理人原搭配", ai: "AI 改编", offline: "规则改编（非 AI）" };

export default function LookCard({ look }: { look: Look }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(look.items.map((i) => i.id)));
  const [deleting, setDeleting] = useState(false);
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
    <section className="card stack">
      <div className="spread">
        <div>
          <h2 style={{ marginBottom: 2 }}>{look.title}</h2>
          <span className="tag">{MODE_LABEL[look.mode] ?? look.mode}</span>
        </div>
        <button className="link-btn" onClick={remove} disabled={deleting}>
          移出试衣间
        </button>
      </div>
      {look.request ? <p className="small muted" style={{ margin: 0 }}>你的要求：{look.request}</p> : null}
      <div>
        {look.items.map((it) => (
          <label key={it.id} className="item-row" style={{ color: "inherit", cursor: "pointer" }}>
            <ItemThumb name={it.name} image={it.image} color={it.color} />
            <span>
              <span className="item-name" style={{ display: "block" }}>{it.name}</span>
              <span className="small muted">
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
        <span className="small muted">已选 {chosen.length} / {look.items.length} 件</span>
        <span className="price">合计 ¥{chosenTotal}</span>
      </div>
      {chosen.length ? (
        <details>
          <summary className="btn" style={{ listStyle: "none" }}>
            {chosen.length === look.items.length ? "整套购买" : `购买所选 ${chosen.length} 件`}
          </summary>
          <ol className="small" style={{ paddingLeft: 18 }}>
            {chosen.map((it) => (
              <li key={it.id}>
                <a href={it.buyUrl} target="_blank" rel="noopener noreferrer">
                  {it.name.replace(/^占位：/, "")} · ¥{it.price} ↗
                </a>
              </li>
            ))}
          </ol>
          <p className="small muted">外链到商家页面购买，价格与库存以商家页面为准。</p>
        </details>
      ) : null}
    </section>
  );
}
