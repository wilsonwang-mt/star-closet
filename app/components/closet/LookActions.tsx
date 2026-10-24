"use client";

// 一套搭配的“加入”操作（D67），衣橱页的搭配卡与搭配页共用：
// - 主按钮（大号金色）：整套加入试衣间；进入多选并勾了一部分时变成“加入试衣间（N 件）”。
// - 次按钮：加入购物袋（整套 / N 件）。
// - “多选”开关：打开后单品上出现勾选框（由使用方渲染，见 usePick）。
// 试衣间沿用现有 look 数据模型：整套 = 一个 look；多选 = 只含选中几件的 look；单件 = 只含一件的 look（mode "pick"）。
// 未登录时两个按钮都会去登录并带回当前页面。
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useState } from "react";
import { addItemsToBag, addToFittingRoom, useBagErrors } from "@/lib/bag/client";
import { useT } from "@/lib/i18n/client";
import { reducedFade, springs } from "@/lib/motion";
import s from "./LookActions.module.css";

export type PickItem = { id: string; name: string };

export function usePick() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setMode = useCallback((on: boolean) => {
    setSelecting(on);
    if (!on) setSelected(new Set());
  }, []);
  return { selecting, selected, toggle, setMode };
}

export type Pick = ReturnType<typeof usePick>;

/** 多选时单品上的勾选圆钮。 */
export function PickCheck({ pick, item, className = "" }: { pick: Pick; item: PickItem; className?: string }) {
  const reduce = useReducedMotion() === true;
  const t = useT("closet");
  const on = pick.selected.has(item.id);
  return (
    <AnimatePresence initial={false}>
      {pick.selecting ? (
        <motion.button
          key="check"
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={t("actions.select", { name: item.name.replace(/^占位：/, "") })}
          className={`${s.check} ${on ? s.checkOn : ""} ${className}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            pick.toggle(item.id);
          }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          transition={reduce ? reducedFade : springs.drop}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="m2.2 6.4 2.4 2.3 5.2-5.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

export default function LookActions({
  items,
  pick,
  outfitId,
  compactBag = false,
}: {
  items: PickItem[];
  pick: Pick;
  outfitId: string | null;
  /** 卡片里空间窄：购物袋按钮只放图标与件数。 */
  compactBag?: boolean;
}) {
  const t = useT("closet");
  const bagErrors = useBagErrors();
  const [room, setRoom] = useState<"idle" | "busy" | "done">("idle");
  const [bag, setBag] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const chosen = items.filter((i) => pick.selected.has(i.id));
  const partial = pick.selecting && chosen.length > 0 && chosen.length < items.length;
  const target = pick.selecting && chosen.length > 0 ? chosen : items;
  const emptyPick = pick.selecting && chosen.length === 0;

  async function toRoom() {
    setRoom("busy");
    setError(null);
    const r = await addToFittingRoom(
      {
        kind: partial ? (target.length === 1 ? "single" : "pick") : "outfit",
        sourceOutfitId: outfitId,
        items: target,
      },
      bagErrors,
    );
    if (r.ok) {
      setRoom("done");
      pick.setMode(false);
    } else {
      setRoom("idle");
      if ("error" in r) setError(r.error);
    }
  }

  async function toBag() {
    setBag("busy");
    setError(null);
    const r = await addItemsToBag(
      target.map((i) => ({ itemId: i.id })),
      bagErrors,
    );
    if (r.ok) {
      setBag("done");
      pick.setMode(false);
      window.setTimeout(() => setBag("idle"), 2400);
    } else {
      setBag("idle");
      if ("error" in r) setError(r.error);
    }
  }

  const roomLabel =
    room === "done" && !pick.selecting
      ? t("actions.added")
      : partial
        ? t("actions.addPicked", { n: chosen.length })
        : t("actions.addLook");
  const bagLabel =
    bag === "done"
      ? t("actions.addedToBag")
      : partial
        ? t("actions.addPickedToBag", { n: chosen.length })
        : compactBag
          ? t("actions.bag")
          : t("actions.addLookToBag");

  return (
    <div className={s.wrap}>
      <div className={s.row}>
        <button
          type="button"
          className={`sc-cta ${s.room}`}
          disabled={room === "busy" || emptyPick || (room === "done" && !pick.selecting)}
          onClick={() => void toRoom()}
        >
          {roomLabel}
        </button>
        <button
          type="button"
          className={`sc-cta sc-cta--ghost ${s.bag}`}
          disabled={bag === "busy" || emptyPick}
          onClick={() => void toBag()}
          aria-label={compactBag && !partial ? t("actions.addLookToBag") : undefined}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M3.6 6.2h10.8l-.8 9H4.4l-.8-9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M6.4 6.2V5a2.6 2.6 0 0 1 5.2 0v1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span>{bagLabel}</span>
        </button>
      </div>
      <div className={s.meta}>
        <button type="button" className="link-btn" onClick={() => pick.setMode(!pick.selecting)} aria-pressed={pick.selecting}>
          {pick.selecting ? t("actions.cancelSelect") : t("actions.selectPieces")}
        </button>
        {emptyPick ? <span className="sc-meta fade-in">{t("actions.pickHint")}</span> : null}
        {room === "done" && !pick.selecting ? (
          <Link href="/fitting-room" className="link-btn fade-in">
            {t("actions.goToRoom")}
          </Link>
        ) : null}
        {bag === "done" ? (
          <Link href="/bag" className="link-btn fade-in">
            {t("actions.viewBag")}
          </Link>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
