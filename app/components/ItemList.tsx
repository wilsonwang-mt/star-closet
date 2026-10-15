"use client";

import ItemThumb from "./ItemThumb";
import type { Item } from "@/lib/catalog";

export type ListedItem = Item & { reason?: string | null };

export default function ItemList({
  items,
  catalog,
  onSwap,
  originalIds,
}: {
  items: ListedItem[];
  catalog?: Item[];
  onSwap?: (fromId: string, toId: string) => void;
  originalIds?: Set<string>;
}) {
  const used = new Set(items.map((i) => i.id));
  return (
    <div className="rows">
      {items.map((it) => {
        const alts = catalog?.filter((c) => c.category === it.category && !used.has(c.id)) ?? [];
        const changed = originalIds ? !originalIds.has(it.id) : false;
        return (
          <div key={it.id} className={`sc-glass sc-glass--row item-row${changed ? " sc-glass--changed" : ""}`}>
            <ItemThumb name={it.name} image={it.image} color={it.color} />
            <div>
              <div className="item-name">{it.name.replace(/^占位：/, "")}</div>
              <div className="sc-meta">
                {it.category} · {it.color}
                {it.sizeNote ? ` · ${it.sizeNote}` : ""}
              </div>
              {it.reason ? (
                <div className="small" style={{ color: changed ? "var(--sc-champ-text)" : "var(--sc-ink-2)", marginTop: 2 }}>
                  {it.reason}
                </div>
              ) : null}
              {onSwap && alts.length > 0 ? (
                <select
                  className="swap"
                  aria-label={`替换${it.name}`}
                  value=""
                  onChange={(e) => e.target.value && onSwap(it.id, e.target.value)}
                >
                  <option value="">换一件{it.category}…</option>
                  {alts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name.replace(/^占位：/, "")} ¥{a.price}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            <div className="price">¥{it.price}</div>
          </div>
        );
      })}
    </div>
  );
}
