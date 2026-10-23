"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ItemThumb from "./ItemThumb";
import { addItemsToBag, useBagErrors } from "@/lib/bag/client";
import { useLocale, useT, useTerm } from "@/lib/i18n/client";
import { LOCALE_META } from "@/lib/i18n/config";
import type { Look } from "@/lib/looks";
import { isWearable } from "@/lib/tryon/plan";
import type { TryonContext, TryonView } from "@/lib/tryon/service";
import { LookTryOnSheet, TryOnPeek, TryOnRowAction, WearAllButton, WornMark } from "./tryon/LookTryOn";
import { cleanName } from "./tryon/shared";
import { useLookTryon } from "./tryon/useLookTryon";
import tr from "./tryon/LookTryOn.module.css";

const MODES = ["original", "ai", "offline", "pick"] as const;
const isMode = (m: string): m is (typeof MODES)[number] => (MODES as readonly string[]).includes(m);

export default function LookCard({ look, tryon, tryons }: { look: Look; tryon?: TryonContext; tryons?: TryonView[] }) {
  const router = useRouter();
  const tf = useT("fittingRoom");
  const term = useTerm();
  const locale = useLocale();
  const bagErrors = useBagErrors();
  const yuan = (n: number) => `¥${n.toLocaleString(LOCALE_META[locale].intl)}`;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(look.items.map((i) => i.id)));
  const [deleting, setDeleting] = useState(false);
  const [bag, setBag] = useState<"idle" | "busy" | "done">("idle");
  const [bagError, setBagError] = useState<string | null>(null);
  // 逐件试穿：可上身的单品（上装、下装、外套、连衣裙）每件一个“试穿这件”，一件一件穿到本人照片上。
  const t = useLookTryon({ lookId: look.id, ctx: tryon, initial: tryons, items: look.items });
  const chosen = look.items.filter((i) => selected.has(i.id));
  const chosenTotal = chosen.reduce((s, i) => s + i.price, 0);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  // 勾选的单品加入购物袋（D67，替代原来的外链购物清单）；尺码在购物袋里选。
  async function toBag() {
    setBag("busy");
    setBagError(null);
    const r = await addItemsToBag(
      chosen.map((i) => ({ itemId: i.id })),
      bagErrors,
    );
    if (r.ok) setBag("done");
    else {
      setBag("idle");
      if ("error" in r) setBagError(r.error);
    }
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
          <span className="sc-kicker">{isMode(look.mode) ? tf(`card.mode.${look.mode}`) : look.mode}</span>
          <h2 className="section-title">{look.title}</h2>
        </div>
        <button className="link-btn" onClick={remove} disabled={deleting}>
          {tf("card.remove")}
        </button>
      </div>
      {look.request ? <p className="serif-note">“{look.request}”</p> : null}
      <WearAllButton t={t} items={look.items} />
      <div className="rows">
        {look.items.map((it) => {
          const wearable = t.enabled && isWearable(it);
          return (
            <div key={it.id} className={`sc-glass sc-glass--row item-row ${tr.lookRow} ${wearable ? tr.lookRowAction : ""}`}>
              {/* 整行（除试穿按钮外）都是勾选热区；label 用 display: contents，子元素直接参与行的网格 */}
              <label style={{ display: "contents", color: "inherit", cursor: "pointer", fontSize: "inherit", letterSpacing: 0 }}>
                <WornMark worn={wearable && t.wornIds.has(it.id)} className={tr.rowThumb}>
                  <ItemThumb name={it.name} image={it.image} color={it.color} />
                </WornMark>
                <span className={tr.rowText}>
                  <span className="item-name" style={{ display: "block" }}>{cleanName(it.name)}</span>
                  <span className="sc-meta">
                    {term(it.displayCategory || it.category)} · {term(it.color)}
                  </span>
                </span>
                <span className={`row ${tr.rowEnd}`} style={{ justifyContent: "flex-end" }}>
                  <span className="price">{yuan(it.price)}</span>
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggle(it.id)}
                    aria-label={tf("card.selectAria", { name: cleanName(it.name) })}
                  />
                </span>
              </label>
              {wearable ? (
                <span className={tr.rowActionCell}>
                  <TryOnRowAction t={t} item={it} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <TryOnPeek t={t} items={look.items} />
      <LookTryOnSheet t={t} items={look.items} />
      <div className="spread">
        <span className="sc-meta">{tf("card.selected", { n: chosen.length, total: look.items.length })}</span>
        <span className="total sc-foil">{yuan(chosenTotal)}</span>
      </div>
      {chosen.length ? (
        <button className="sc-cta sc-cta--ghost" disabled={bag === "busy"} onClick={() => void toBag()}>
          {bag === "done" ? tf("card.added") : tf("card.addToBag", { n: chosen.length })}
        </button>
      ) : null}
      {bag === "done" ? (
        <Link href="/bag" className="link-btn fade-in" style={{ justifySelf: "start" }}>
          {tf("card.viewBag")}
        </Link>
      ) : null}
      {bagError ? (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {bagError}
        </p>
      ) : null}
    </section>
  );
}
