"use client";

// 单品列表。传入 reveal 时是改编结果的“换装”编排（视觉规范 §7.1「一句话改编」）：
// 结果卡以改编前的样子开场（被换掉的那件还在原位），约 0.5 秒后被换单品淡出、新单品从上方落入并回弹（重力），依次间隔 90ms。
// 每个位置是一个单格 grid：旧单品与新单品叠在同一格里交接，位置高度从一开始就按新单品排好，换装过程中不塌陷、不跳动。
// 手动逐件替换走同一条路径（AnimatePresence 按单品 id 做 key：旧的淡出，新的稍后落入）。
// 只动 transform / opacity；减弱动态时只淡入淡出。
import { AnimatePresence, motion, useReducedMotion, type Transition } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import ItemThumb from "./ItemThumb";
import type { Item } from "@/lib/catalog";
import { springs } from "@/lib/motion";

export type ListedItem = Item & { reason?: string | null };

/** 结果卡出现后停留多久再开始换装（先让人看清“原来是这一套”） */
export const REVEAL_DELAY = 0.5;
const STAGGER = 0.09;
/** 手动替换：旧的先淡出一点，新的再落入 */
const SWAP_DELAY = 0.12;

const HIDDEN = { opacity: 0, y: -44, scale: 0.98 };
const SHOWN = { opacity: 1, y: 0, scale: 1 };

export default function ItemList({
  items,
  catalog,
  onSwap,
  originalIds,
  reveal,
}: {
  items: ListedItem[];
  catalog?: Item[];
  onSwap?: (fromId: string, toId: string) => void;
  originalIds?: Set<string>;
  /** 改编前的单品：据此找出每个被换位置原来是哪一件，先显示它再换掉 */
  reveal?: ListedItem[];
}) {
  const reduced = useReducedMotion() === true;
  const used = new Set(items.map((i) => i.id));
  const [revealed, setRevealed] = useState(!reveal);

  useEffect(() => {
    if (revealed) return;
    const t = window.setTimeout(() => setRevealed(true), (reduced ? 0.15 : REVEAL_DELAY) * 1000);
    return () => window.clearTimeout(t);
  }, [revealed, reduced]);

  // 这次结果里每个位置：是否需要换装、换装前显示改编前同类别的哪一件、第几个落下
  const plan = useMemo(() => {
    if (!reveal) return null;
    const baseIds = new Set(reveal.map((i) => i.id));
    const resultIds = new Set(items.map((i) => i.id));
    const taken = new Set<string>();
    let order = 0;
    return items.map((it) => {
      if (baseIds.has(it.id)) return { id: it.id, prev: null as ListedItem | null, order: -1 };
      const prev = reveal.find((b) => b.category === it.category && !resultIds.has(b.id) && !taken.has(b.id)) ?? null;
      if (prev) taken.add(prev.id);
      return { id: it.id, prev, order: order++ };
    });
    // 只在这次结果出现时计算；之后的手动替换不再回放换装
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const enterT = (delay: number): Transition =>
    reduced
      ? { duration: 0.24, delay }
      : { y: { ...springs.drop, delay }, scale: { ...springs.drop, delay }, opacity: { duration: 0.16, delay } };
  const exit = reduced
    ? { opacity: 0, transition: { duration: 0.18 } }
    : { opacity: 0, y: 6, scale: 0.97, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] as const } };
  const hidden = reduced ? { opacity: 0 } : HIDDEN;

  return (
    <div className="rows">
      {items.map((it, i) => {
        const p = plan?.[i];
        // 这次换装涉及的位置（仍是结果里原来的那件）：换装前隐藏在格子里占好高度，换装时按顺序落入
        const staged = Boolean(p && p.order >= 0 && p.id === it.id);
        const waiting = staged && !revealed;
        return (
          <div key={i} className="item-slot">
            <AnimatePresence initial={false}>
              {waiting && p?.prev ? (
                <motion.div key={`prev-${p.prev.id}`} className="item-slot__prev" exit={exit} aria-hidden="true">
                  <Row it={p.prev} changed={originalIds ? !originalIds.has(p.prev.id) : false} alts={[]} />
                </motion.div>
              ) : null}
              <motion.div
                key={it.id}
                initial={hidden}
                animate={waiting ? hidden : SHOWN}
                exit={exit}
                transition={enterT(staged ? (p?.order ?? 0) * STAGGER : SWAP_DELAY)}
                aria-hidden={waiting || undefined}
              >
                <Row
                  it={it}
                  changed={originalIds ? !originalIds.has(it.id) : false}
                  alts={catalog?.filter((c) => c.category === it.category && !used.has(c.id)) ?? []}
                  onSwap={waiting ? undefined : onSwap}
                />
              </motion.div>
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function Row({
  it,
  changed,
  alts,
  onSwap,
}: {
  it: ListedItem;
  changed: boolean;
  alts: Item[];
  onSwap?: (fromId: string, toId: string) => void;
}) {
  return (
    <div className={`sc-glass sc-glass--row item-row${changed ? " sc-glass--changed" : ""}`}>
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
          <select className="swap" aria-label={`替换${it.name}`} value="" onChange={(e) => e.target.value && onSwap(it.id, e.target.value)}>
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
}
