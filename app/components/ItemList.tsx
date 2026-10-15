"use client";

import ItemThumb from "./ItemThumb";
import type { Item } from "@/lib/catalog";

export type ListedItem = Item & { reason?: string | null };

export default function ItemList({
  items,
  catalog,
  onSwap,
}: {
  items: ListedItem[];
  catalog?: Item[];
  onSwap?: (fromId: string, toId: string) => void;
}) {
  const used = new Set(items.map((i) => i.id));
  return (
    <div>
      {items.map((it) => {
        const alts = catalog?.filter((c) => c.category === it.category && !used.has(c.id)) ?? [];
        return (
          <div key={it.id} className="item-row">
            <ItemThumb name={it.name} image={it.image} color={it.color} />
            <div>
              <div className="item-name">{it.name}</div>
              <div className="small muted">
                {it.category} · {it.color}
                {it.sizeNote ? ` · ${it.sizeNote}` : ""}
              </div>
              {it.reason ? <div className="small">{it.reason}</div> : null}
              {onSwap && alts.length > 0 ? (
                <select
                  aria-label={`替换${it.name}`}
                  value=""
                  onChange={(e) => e.target.value && onSwap(it.id, e.target.value)}
                  style={{ marginTop: 6, maxWidth: 260, padding: "4px 8px", fontSize: 13 }}
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
