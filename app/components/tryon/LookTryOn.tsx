"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ItemThumb from "@/components/ItemThumb";
import { reducedFade, springs } from "@/lib/motion";
import { wearableInOrder } from "@/lib/tryon/plan";
import type { TryonView } from "@/lib/tryon/service";
import type { TryOnItem } from "./TryOn";
import { cleanName, CloseIcon, HangerIcon } from "./shared";
import type { LookTryon } from "./useLookTryon";
import base from "./TryOn.module.css";
import s from "./LookTryOn.module.css";

// 试衣间逐件试穿：用户自己的形象穿着选中的衣服，一件一件来。
// - 卡片上每件可上身的单品（上装、下装、外套、连衣裙）有“试穿这件”；鞋、包、配饰不出现这个按钮。
// - 面板：舞台（正在看的那张）+ 穿搭进度（正面照 → 第 1 件 → 第 2 件……，点哪张看哪张，下一件就穿在那张上）+ 这一套的单品。
// - 生成中：底图压暗虚化，光束扫过，写明正在穿上哪一件与已用时间；可以关掉面板，穿好后出现在这一套里。
// - 结果：新图在同一位置从上一张交叉淡入（只动 opacity / transform），穿上的单品标“已穿上”；减弱动态时只淡入淡出。

const EASE_CINE = [0.22, 0.61, 0.2, 1] as const;

function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

const fmtElapsed = (sec: number) => (sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${String(sec % 60).padStart(2, "0")} 秒`);

function frameCaption(f: TryonView) {
  return f.kind === "outfit" ? "整套" : `第 ${Math.max(1, f.appliedItemIds.length)} 件`;
}

function Chevron() {
  return (
    <svg width="7" height="12" viewBox="0 0 7 12" fill="none" aria-hidden="true">
      <path d="m1 1 5 5-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m2.2 6.4 2.4 2.3 5.2-5.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 缩略图外包一层：穿在当前这张试穿图上的单品，左下角浮出“已穿上”。 */
export function WornMark({ worn, children, className = "" }: { worn: boolean; children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span className={`${s.thumbWrap} ${className}`}>
      {children}
      <AnimatePresence initial={false}>
        {worn ? (
          <motion.span
            key="worn"
            className={s.worn}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 4 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={reduce ? reducedFade : { ...springs.drop, opacity: { duration: 0.25 } }}
          >
            已穿上
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

/** 卡片单品行下方的试穿操作：试穿这件 / 正在穿上 · 已用时间 / 查看试穿。 */
export function TryOnRowAction({ t, item }: { t: LookTryon; item: TryOnItem }) {
  const busyThis = t.pending?.itemId === item.id;
  const elapsed = useElapsed(busyThis ? t.pending!.startedAt : null);
  const name = cleanName(item.name);
  if (busyThis) {
    return (
      <button type="button" className={`${s.rowAction} ${s.rowBusy}`} onClick={t.openPanel} aria-label={`正在穿上${name}，查看`}>
        <span className={s.pulse} aria-hidden="true" />
        正在穿上 · {fmtElapsed(elapsed)}
      </button>
    );
  }
  if (t.wornIds.has(item.id)) {
    return (
      <button type="button" className={`${s.rowAction} ${s.rowWorn}`} onClick={t.openPanel}>
        查看试穿
        <Chevron />
      </button>
    );
  }
  return (
    <button
      type="button"
      className={s.rowAction}
      disabled={!!t.pending}
      onClick={() => t.tryItem(item.id)}
      aria-haspopup="dialog"
      aria-label={`试穿这件：${name}`}
    >
      <HangerIcon size={14} />
      试穿这件
    </button>
  );
}

/** 卡片上的“穿搭进度”入口：有试穿结果或正在穿时出现，点开面板。 */
export function TryOnPeek({ t, items }: { t: LookTryon; items: TryOnItem[] }) {
  const elapsed = useElapsed(t.pending?.startedAt ?? null);
  if (!t.enabled || (!t.frames.length && !t.pending)) return null;
  const pendingItem = t.pending ? items.find((i) => i.id === t.pending!.itemId) : null;
  const shown = t.selected?.resultUrl ?? t.frames.at(-1)?.resultUrl ?? t.photoUrl;
  const wornCount = items.filter((i) => t.wornIds.has(i.id)).length;
  return (
    <button type="button" className={`sc-glass sc-glass--row ${s.peek}`} onClick={t.openPanel} aria-haspopup="dialog">
      <span className={`${s.peekImg} ${t.pending ? "adapt-scan" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown ? <img src={shown} alt="" /> : null}
      </span>
      <span className={s.peekText}>
        <span className="sc-kicker">On You</span>
        <span className={s.peekTitle}>
          {pendingItem ? `正在为你穿上 ${cleanName(pendingItem.name)}` : wornCount ? `已穿上 ${wornCount} 件` : "从你的照片开始"}
        </span>
        <span className="sc-meta">{pendingItem ? `已用 ${fmtElapsed(elapsed)}` : `穿搭进度 · ${t.frames.length} 张`}</span>
      </span>
      <Chevron />
    </button>
  );
}

/** 逐件试穿面板（每套搭配挂一份，渲染到 body）。 */
export function LookTryOnSheet({ t, items }: { t: LookTryon; items: TryOnItem[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !t.enabled) return null;
  return createPortal(<AnimatePresence>{t.open ? <Sheet key="sheet" t={t} items={items} /> : null}</AnimatePresence>, document.body);
}

function Sheet({ t, items }: { t: LookTryon; items: TryOnItem[] }) {
  const reduce = useReducedMotion();
  const [zoom, setZoom] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLOListElement | null>(null);
  const byId = new Map(items.map((i) => [i.id, i]));
  const pieces = wearableInOrder(items);
  const pendingItem = t.pending ? (byId.get(t.pending.itemId) ?? null) : null;
  const queuedItem = t.queued && !t.pending ? (byId.get(t.queued) ?? null) : null;
  const elapsed = useElapsed(t.pending?.startedAt ?? null);
  const baseFrame = t.pending?.baseId ? t.frames.find((f) => f.id === t.pending!.baseId) : null;
  const waitUrl = t.pending ? (baseFrame?.resultUrl ?? t.photoUrl) : null;
  const shownUrl = t.selected?.resultUrl ?? t.photoUrl;
  const shownKey = t.selected ? t.selected.id : `photo:${t.photoUrl ?? ""}`;
  const ready = t.hasBase && (t.consented || t.agree) && !t.uploading;
  const wornName = (f: TryonView) => {
    const it = f.wornItemId ? byId.get(f.wornItemId) : null;
    return it ? cleanName(it.name) : f.applied.join("、");
  };

  // 打开时锁住页面滚动、聚焦面板；Esc 关闭（放大时先退出放大）；左右方向键在穿搭进度里前后翻看。
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);
  const keyState = useRef({ zoom, t });
  keyState.current = { zoom, t };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { zoom: z, t: ctl } = keyState.current;
      if (e.key === "Escape") {
        if (z) setZoom(false);
        else ctl.close();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement | null;
      if (z || ctl.pending || el?.closest("input, textarea, select")) return;
      const order = [null, ...ctl.frames.map((f) => f.id)];
      const idx = order.indexOf(ctl.selectedId);
      const next = order[idx + (e.key === "ArrowRight" ? 1 : -1)];
      if (next !== undefined) {
        e.preventDefault();
        ctl.select(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 新的一张或“穿上中”出现时，进度条滚到最右。
  const frameCount = t.frames.length;
  const isPending = !!t.pending;
  useEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: reduce ? "auto" : "smooth" });
  }, [frameCount, isPending, reduce]);

  const appear = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: reducedFade }
    : {
        initial: { opacity: 0, y: 28, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 16, scale: 0.98 },
        transition: { ...springs.rise, opacity: { duration: 0.3 } },
      };
  // 舞台交叉过渡：新图在上层淡入（轻微推近），旧图留在下层，等新图基本不透明后再退场。
  const crossfade = reduce
    ? {
        initial: { opacity: 0, zIndex: 1 },
        animate: { opacity: 1, zIndex: 1 },
        exit: { opacity: 0, zIndex: 0, transition: { opacity: { delay: 0.2, duration: 0.1 } } },
        transition: reducedFade,
      }
    : {
        initial: { opacity: 0, scale: 1.025, zIndex: 1 },
        animate: { opacity: 1, scale: 1, zIndex: 1 },
        exit: { opacity: 0, zIndex: 0, transition: { opacity: { delay: 0.6, duration: 0.25 } } },
        transition: { opacity: { duration: 0.7, ease: EASE_CINE }, scale: springs.roll },
      };
  const stripItem = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: reducedFade }
    : {
        initial: { opacity: 0, scale: 0.82 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.82 },
        transition: { ...springs.drop, opacity: { duration: 0.25 } },
      };

  const photoInput = (label: string, className: string) => (
    <label className={className}>
      {label}
      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={t.uploading} onChange={(e) => void t.upload(e.target.files?.[0])} />
    </label>
  );

  return (
    <motion.div
      className={`${base.overlay} ${s.overlay}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) t.close();
      }}
    >
      <motion.div
        ref={panelRef}
        className={`sc-glass ${base.panel} ${s.panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`look-tryon-${t.lookId}`}
        tabIndex={-1}
        {...appear}
      >
        <div className={base.head}>
          <div>
            <span className="sc-kicker">{t.selected ? "On You" : "Try It On"}</span>
            <h2 id={`look-tryon-${t.lookId}`} className="section-title">
              穿在我身上
            </h2>
          </div>
          <button type="button" className={base.close} onClick={t.close} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className={s.body}>
          <div className={s.stageCol}>
            <div className={`${base.stage} ${s.stage}`}>
              <AnimatePresence initial={false}>
                {shownUrl ? (
                  <motion.img
                    key={shownKey}
                    src={shownUrl}
                    alt={t.selected ? `穿上${wornName(t.selected)}的你` : "你的正面全身照"}
                    className={s.frame}
                    onError={t.selected ? () => t.drop(t.selected!.id) : undefined}
                    {...crossfade}
                  />
                ) : null}
              </AnimatePresence>

              {!shownUrl ? (
                <label className={`${base.upload} ${s.stageUpload}`}>
                  <span>
                    <strong>{t.uploading ? "上传中…" : "上传正面全身照"}</strong>
                    站直、正面、光线充足
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={t.uploading}
                    onChange={(e) => void t.upload(e.target.files?.[0])}
                  />
                </label>
              ) : null}

              {shownUrl && !t.pending ? (
                <button type="button" className={s.zoomHit} onClick={() => setZoom(true)} aria-label="放大查看" />
              ) : null}
              {shownUrl && !t.selected && !t.pending ? <span className={base.stageLabel}>You</span> : null}

              <AnimatePresence>
                {t.pending ? (
                  <motion.div
                    key="wait"
                    className={s.wait}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduce ? 0.2 : 0.55, ease: "easeOut" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {waitUrl ? <img src={waitUrl} alt="" className={s.waitBlur} /> : null}
                    <div className={`${s.waitBeam} adapt-scan`} aria-hidden="true" />
                    <div className={s.waitCopy}>
                      {pendingItem?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={s.waitGarment} src={pendingItem.image} alt="" />
                      ) : null}
                      <p className={s.waitKicker} role="status">
                        正在为你穿上 <span className={s.waitName}>{pendingItem ? cleanName(pendingItem.name) : ""}</span>
                      </p>
                      <p className={s.waitTime} aria-hidden="true">
                        {fmtElapsed(elapsed)}
                      </p>
                      <AnimatePresence>
                        {elapsed >= 50 ? (
                          <motion.p
                            key="slow"
                            className={s.waitNote}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.6 }}
                          >
                            比平时稍久，仍在进行
                          </motion.p>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* 固定两行（说明 + 操作），切换选中或开始生成时高度不变，面板不跳动 */}
            <div className={s.stageBar}>
              <span className="sc-meta">
                {t.pending
                  ? "可以先关掉，穿好后会出现在这一套里"
                  : t.selected
                    ? "下一件穿在这一张上"
                    : t.photoUrl
                      ? "从你的照片开始"
                      : "先放一张正面全身照"}
              </span>
              <span className={s.stageActions}>
                {t.pending ? null : t.selected ? (
                  <>
                    {t.photoUrl ? (
                      <button type="button" className="link-btn" onClick={() => t.select(null)}>
                        从我的照片重新开始
                      </button>
                    ) : (
                      photoInput("上传照片重新开始", `link-btn ${base.fileBtn}`)
                    )}
                    <button type="button" className="link-btn" onClick={() => void t.remove(t.selected!.id)}>
                      删除这张
                    </button>
                  </>
                ) : t.photoUrl ? (
                  photoInput(t.uploading ? "上传中…" : "换一张照片", `link-btn ${base.fileBtn}`)
                ) : null}
              </span>
            </div>
          </div>

          <div className={s.side}>
            <div className={s.block}>
              <span className="sc-meta">穿搭进度</span>
              <ol className={s.strip} ref={stripRef} aria-label="穿搭进度">
                <li className={s.stripItem}>
                  <button
                    type="button"
                    className={s.frameBtn}
                    aria-pressed={t.selectedId === null}
                    aria-label="你的照片"
                    disabled={!!t.pending}
                    onClick={() => t.select(null)}
                  >
                    <span className={s.frameImg}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {t.photoUrl ? <img className={s.frameShot} src={t.photoUrl} alt="" /> : <span className={s.framePlaceholder}>+</span>}
                    </span>
                    <span className={s.frameCap}>照片</span>
                  </button>
                </li>
                {/* popLayout：退场的“穿上中”立刻让出位置，新的一张在同一格里接替 */}
                <AnimatePresence initial={false} mode="popLayout">
                  {t.frames.map((f) => {
                    const worn = f.wornItemId ? byId.get(f.wornItemId) : null;
                    return (
                      <motion.li key={f.id} className={s.stripItem} layout={reduce ? false : "position"} {...stripItem}>
                        <button
                          type="button"
                          className={s.frameBtn}
                          aria-pressed={t.selectedId === f.id}
                          aria-label={`${frameCaption(f)}：${wornName(f)}`}
                          disabled={!!t.pending}
                          onClick={() => t.select(f.id)}
                        >
                          <span className={s.frameImg}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img className={s.frameShot} src={f.resultUrl!} alt="" onError={() => t.drop(f.id)} />
                            {worn?.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={s.frameGarment} src={worn.image} alt="" />
                            ) : null}
                          </span>
                          <span className={s.frameCap}>{frameCaption(f)}</span>
                        </button>
                      </motion.li>
                    );
                  })}
                  {t.pending ? (
                    <motion.li key="pending" className={s.stripItem} {...stripItem}>
                      <span className={s.frameBtn} aria-hidden="true">
                        <span className={`${s.frameImg} ${s.framePending} adapt-scan`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {pendingItem?.image ? <img className={s.framePendingGarment} src={pendingItem.image} alt="" /> : null}
                        </span>
                        <span className={s.frameCap}>穿上中</span>
                      </span>
                    </motion.li>
                  ) : null}
                </AnimatePresence>
              </ol>
            </div>

            <div className={s.block}>
              <span className="sc-meta">这一套 · 一件一件穿上</span>
              <ul className={s.pieces}>
                {pieces.map(({ item, step }) => {
                  const worn = t.wornIds.has(item.id);
                  const busyThis = t.pending?.itemId === item.id;
                  const name = cleanName(item.name);
                  return (
                    <li key={item.id} className={`sc-glass sc-glass--row ${s.piece} ${queuedItem?.id === item.id ? s.pieceQueued : ""}`}>
                      <WornMark worn={worn}>
                        <ItemThumb name={name} image={item.image} color={item.color} />
                      </WornMark>
                      <span className={s.pieceText}>
                        <span className="item-name">{name}</span>
                        <span className="sc-meta">{step.label}</span>
                      </span>
                      {busyThis ? (
                        <span className={s.pieceBusy}>
                          <span className={s.pulse} aria-hidden="true" />
                          穿上中
                        </span>
                      ) : worn ? (
                        <span className={s.pieceDone} role="img" aria-label="已穿上">
                          <Check />
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={s.pieceBtn}
                          disabled={!!t.pending}
                          onClick={() => t.tryItem(item.id)}
                          aria-label={`穿上${name}`}
                        >
                          穿上
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {!t.consented ? (
              <label className={base.consent}>
                <input type="checkbox" checked={t.agree} onChange={(e) => t.setAgree(e.target.checked)} />
                <span>同意把我的正面照发送给 FASHN（fal.ai）生成试穿图</span>
              </label>
            ) : null}
            {t.error ? (
              <p className="error" role="alert">
                {t.error}
              </p>
            ) : null}
            <div className={`${base.actions} ${queuedItem ? s.actionsBar : ""}`}>
              {queuedItem ? (
                <button type="button" className="sc-cta" disabled={!ready} onClick={t.startQueued}>
                  {t.error ? "再试一次" : `穿上 ${cleanName(queuedItem.name)}`}
                </button>
              ) : (
                <button type="button" className="sc-cta sc-cta--ghost" onClick={t.close}>
                  完成
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {zoom && shownUrl ? (
          <motion.div
            key="zoom"
            className={base.lightbox}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setZoom(false)}
            role="dialog"
            aria-label="试穿图大图"
          >
            <motion.img
              src={shownUrl}
              alt={t.selected ? `穿上${wornName(t.selected)}的你` : "你的正面全身照"}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={reduce ? reducedFade : { scale: springs.enter, opacity: { duration: 0.3 } }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
