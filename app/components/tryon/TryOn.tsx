"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ItemThumb from "@/components/ItemThumb";
import { useT, useTerm } from "@/lib/i18n/client";
import { reducedFade, springs } from "@/lib/motion";
import { notWornLabels, planTryon } from "@/lib/tryon/plan";
import type { TryonContext, TryonView } from "@/lib/tryon/service";
import SceneShots, { type ShotSelection } from "./SceneShots";
import { cleanName, CloseIcon, compress, HangerIcon, preload, readError, stageLabel, useConsentLabel, waitErrors, waitFirst } from "./shared";
import shotStyles from "./SceneShots.module.css";
import s from "./TryOn.module.css";

// “穿在我身上”（整套）：把这一整套依次换到用户自己的形象上（默认可灵 Kolors on fal.ai；底图优先数字分身正面照，D63）。
// 搭配页改编结果卡在用；试衣间改为逐件试穿（LookTryOn.tsx）。
// 没有配置试穿服务时不渲染入口（服务端传入 ctx.enabled = false），不访问网络。
// 流程：准备（正面照 + 首次同意）→ 生成（光束扫过，显示第几件与排队 / 生成阶段）→ 结果（淡入 + 轻微推近，与原搭配并排，可放大）。
// 生成走队列（D62）：提交后立即返回，这里轮询 /api/tryon/<id>，服务端每次轮询推进一步。
// 结果下方是「换个场景与姿势」（D75 方案 A，SceneShots）：选中的场景图替换大图，标准图仍排第一。
// 整套试穿成功后广播 seen:tryon，搭配页封面的「模特 / 我」（CoverSwap）据此刷新。

export type TryOnItem = {
  id: string;
  name: string;
  category: string;
  displayCategory: string | null;
  image: string | null;
  color: string;
  price: number;
};

type Source = { lookId: string } | { outfitId: string };
type Phase = "prep" | "running" | "done" | "error";

const MIN_WAIT_MS = 900;

export default function TryOn({
  ctx,
  source,
  items,
  primary = false,
  onOpenChange,
}: {
  ctx: TryonContext;
  source: Source;
  items: TryOnItem[];
  primary?: boolean;
  /** 面板打开 / 关闭时通知（封面「模特 / 我」据此在面板关闭前保持入口不卸载）。 */
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tx = useT("tryon");
  const steps = planTryon(items);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => onOpenChange?.(open), [open, onOpenChange]);

  if (!ctx.enabled || steps.length === 0) return null;

  function launch() {
    if (!ctx.signedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        className={`sc-cta ${primary ? "" : "sc-cta--ghost"} compact ${s.trigger}`}
        onClick={launch}
        aria-haspopup="dialog"
      >
        <HangerIcon />
        {tx("onMe")}
      </button>
      {mounted
        ? createPortal(
            <AnimatePresence>
              {open ? <TryOnSheet key="sheet" ctx={ctx} source={source} items={items} onClose={() => setOpen(false)} /> : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}

function TryOnSheet({ ctx, source, items, onClose }: { ctx: TryonContext; source: Source; items: TryOnItem[]; onClose: () => void }) {
  const reduce = useReducedMotion();
  const tx = useT("tryon");
  const tc = useT("common");
  const term = useTerm();
  const consentLabel = useConsentLabel(ctx.providerName);
  const steps = planTryon(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const pieces = steps.map((st) => ({ ...st, item: byId.get(st.itemId)! }));
  // 品类名（上装、下装…）是目录固定词：逻辑用中文，显示时换成当前语言。
  const labels = steps.map((st) => term(st.label));
  const chain = labels.join(" → ");
  const list = (xs: readonly string[]) => xs.map((x) => term(x)).join(tx("listSep"));

  const [photoUrl, setPhotoUrl] = useState<string | null>(ctx.frontPhotoUrl);
  const isTwin = ctx.baseSource === "twin" && photoUrl === ctx.frontPhotoUrl;
  const [consented, setConsented] = useState(ctx.consented);
  const [agree, setAgree] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phase, setPhase] = useState<Phase>("prep");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<TryonView | null>(null);
  // 没有逐件记录（appliedItemIds 为空）的旧结果不列，免得把已上身的也算成“未上身”
  const notWorn = view?.appliedItemIds.length ? notWornLabels(items, view.appliedItemIds) : [];
  const [seconds, setSeconds] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [live, setLive] = useState<TryonView | null>(null);
  const [shot, setShot] = useState<ShotSelection>(null);
  const [shotBusy, setShotBusy] = useState(false);
  const shownUrl = shot?.imageUrl ?? view?.resultUrl ?? null;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const autoStarted = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const ready = !!photoUrl && (consented || agree) && !uploading;

  // 打开时锁住页面滚动、聚焦面板；Esc 关闭（放大查看时先退出放大）。
  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, []);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (zoomRef.current) setZoom(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (phase !== "running") return;
    const started = Date.now();
    setSeconds(0);
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [phase]);

  async function start() {
    if (!photoUrl || !(consented || agree)) return;
    setPhase("running");
    setError(null);
    setLive(null);
    const started = Date.now();
    const res = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...source, itemIds: items.map((i) => i.id), consent: !consented && agree }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(await readError(res, tx("errors.failed"), tx("errors.network")));
      setPhase("error");
      return;
    }
    let data = (await res.json()) as TryonView;
    setConsented(true);
    setLive(data);
    if (!data.resultUrl && data.status === "processing")
      data = await waitFirst(data, { alive: () => alive.current, onStage: setLive, pollMs: 1000, errors: waitErrors(tx) });
    if (!alive.current) return;
    if (data.status === "failed" || !data.resultUrl) {
      setError(data.error ?? tx("errors.failed"));
      setPhase("error");
      return;
    }
    await preload(data.resultUrl);
    const wait = MIN_WAIT_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setShot(null);
    setView(data);
    setPhase("done");
    if ("outfitId" in source) window.dispatchEvent(new CustomEvent("seen:tryon", { detail: { outfitId: source.outfitId } }));
  }

  // 已有正面照且已同意：打开即开始，不再多点一步。
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    if (ctx.frontPhotoUrl && ctx.consented) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await compress(file).catch(() => file);
      const form = new FormData();
      form.append("file", blob, "front.jpg");
      const res = await fetch("/api/tryon/photo", { method: "POST", body: form }).catch(() => null);
      if (!res || !res.ok) {
        setError(await readError(res, tx("errors.uploadFailed"), tx("errors.network")));
        return;
      }
      const data = (await res.json()) as { frontPhotoUrl: string };
      setPhotoUrl(`${data.frontPhotoUrl}?v=${Date.now()}`);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    if (!view) return;
    const res = await fetch(`/api/tryon/${view.id}`, { method: "DELETE" }).catch(() => null);
    if (!res || (!res.ok && res.status !== 404)) {
      setError(await readError(res, tx("errors.deleteFailed"), tx("errors.network")));
      return;
    }
    setView(null);
    setShot(null);
    setZoom(false);
    setPhase("prep");
    if ("outfitId" in source) window.dispatchEvent(new CustomEvent("seen:tryon", { detail: { outfitId: source.outfitId } }));
  }

  const appear = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: reducedFade }
    : {
        initial: { opacity: 0, y: 28, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 16, scale: 0.98 },
        transition: { ...springs.rise, opacity: { duration: 0.3 } },
      };
  const swap = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: reducedFade }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { ...springs.text, opacity: { duration: 0.25 } } };

  return (
    <motion.div
      className={s.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={panelRef}
        className={`sc-glass ${s.panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tryon-title"
        tabIndex={-1}
        {...appear}
      >
        <div className={s.head}>
          <div>
            <span className="sc-kicker">{phase === "done" ? "On You" : "Try It On"}</span>
            <h2 id="tryon-title" className="section-title">
              {phase === "done" ? tx("outfit.titleDone") : phase === "running" ? tx("outfit.titleRunning") : tx("onMe")}
            </h2>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label={tc("close")}>
            <CloseIcon />
          </button>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {phase === "prep" || phase === "error" ? (
            <motion.div key="prep" className="stack" {...swap}>
              <div className={s.prep}>
                <div className={s.photoWrap}>
                  {photoUrl ? (
                    <>
                      <figure className={s.stage}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoUrl} alt={isTwin ? tx("avatar.twinAlt") : tx("avatar.photoAlt")} />
                        <span className={s.stageLabel}>You</span>
                      </figure>
                      <div className={s.photoActions}>
                        {isTwin ? (
                          <Link href="/profile/avatar" className="link-btn">
                            {tx("avatar.manage")}
                          </Link>
                        ) : (
                          <label className={`link-btn ${s.fileBtn}`}>
                            {uploading ? tx("actions.uploading") : tx("outfit.changePhoto")}
                            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <label className={s.upload}>
                        <span>
                          <strong>{uploading ? tx("actions.uploading") : tx("outfit.uploadPhoto")}</strong>
                          {tx("outfit.uploadHint")}
                        </span>
                        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                      </label>
                      <Link href="/profile/avatar" className="sc-cta compact">
                        {tx("avatar.createFirst")}
                      </Link>
                    </>
                  )}
                </div>
                <div className="stack" style={{ gap: 10 }}>
                  <span className="sc-meta">{tx("outfit.thisLook", { chain })}</span>
                  <div className={s.pieces}>
                    {pieces.map((p) => (
                      <div key={p.itemId} className={`sc-glass sc-glass--row ${s.piece}`}>
                        <ItemThumb name={p.item.name} image={p.item.image} color={p.item.color} />
                        <span>
                          <span className="item-name" style={{ display: "block" }}>{cleanName(p.item.name)}</span>
                          <span className="sc-meta">{term(p.label)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {!consented ? (
                <label className={s.consent}>
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>{consentLabel}</span>
                </label>
              ) : null}
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className={s.actions}>
                <button type="button" className="sc-cta" disabled={!ready} onClick={() => void start()}>
                  {phase === "error" ? tx("actions.tryAgain") : tx("actions.start")}
                </button>
              </div>
            </motion.div>
          ) : phase === "running" ? (
            <motion.div key="running" className="stack" {...swap} aria-live="polite" aria-busy="true">
              <div className={s.waitGrid}>
                <figure className={`${s.stage} adapt-scan`}>
                  {photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl} alt="" className={s.waitPhoto} />
                  ) : null}
                  <div className={s.waitVeil}>
                    <p>{seconds}s</p>
                  </div>
                </figure>
                <div className="stack" style={{ gap: 10 }}>
                  <p className="note-text wait-step">{tx("outfit.puttingOn", { list: labels.join(tx("listSep")) })}</p>
                  <span className="sc-meta" aria-live="polite">
                    {live?.progress
                      ? tx("outfit.progress", {
                          step: live.progress.step,
                          total: live.progress.total,
                          stage: stageLabel(tx, live.stage, live.queuePosition),
                        })
                      : stageLabel(tx, "sending")}
                  </span>
                  <div className={`${s.pieces} adapt-scan`}>
                    {pieces.map((p) => (
                      <div key={p.itemId} className={`sc-glass sc-glass--row ${s.piece}`}>
                        <ItemThumb name={p.item.name} image={p.item.image} color={p.item.color} />
                        <span>
                          <span className="item-name" style={{ display: "block" }}>{cleanName(p.item.name)}</span>
                          <span className="sc-meta">{term(p.label)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : view?.resultUrl ? (
            <motion.div key="done" className="stack" {...swap}>
              <div className={s.compare}>
                <div>
                  <span className={`sc-meta ${s.colLabel}`}>{tx("outfit.lookLabel")}</span>
                  <div className={s.collage}>
                    {items
                      .filter((i) => i.image)
                      .slice(0, 6)
                      .map((i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i.id} src={i.image!} alt={cleanName(i.name)} />
                      ))}
                  </div>
                </div>
                <div>
                  <span className={`sc-meta ${s.colLabel}`} style={{ color: "var(--sc-champ-text)" }}>
                    {tx("outfit.onYou")}
                  </span>
                  <motion.button
                    type="button"
                    className={s.result}
                    onClick={() => setZoom(true)}
                    aria-label={tx("zoom.enlargeResult")}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(14px)" }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
                    transition={reduce ? reducedFade : { scale: springs.enter, opacity: { duration: 0.9, ease: "easeOut" }, filter: { duration: 1.1, ease: "easeOut" } }}
                  >
                    <figure className={s.stage}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shownUrl ?? view.resultUrl} alt={tx("outfit.resultAlt")} />
                      {shot ? <span className={shotStyles.badge}>{tx("shots.badge")}</span> : null}
                    </figure>
                  </motion.button>
                </div>
              </div>
              <p className={`sc-meta ${s.applied}`}>
                {tx("outfit.applied", { list: list(view.applied) })}
              </p>
              {/* 鞋、包、配饰不会上身：如实列出，避免与“这一套”的拼图对照时观感矛盾 */}
              {notWorn.length ? <p className={`sc-meta ${s.applied} ${s.notWorn}`}>{tx("outfit.notWorn", { list: list(notWorn) })}</p> : null}
              <SceneShots tryonId={view.id} standardUrl={view.resultUrl} selectedId={shot?.id ?? null} onSelect={setShot} onBusy={setShotBusy} />
              {error ? <p className="error">{error}</p> : null}
              <div className={s.actions}>
                <button type="button" className="sc-cta" onClick={onClose}>
                  {tx("actions.done")}
                </button>
                <button type="button" className="sc-cta sc-cta--ghost compact" disabled={shotBusy} onClick={() => void remove()}>
                  {tx("actions.deleteImage")}
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {zoom && shownUrl ? (
          <motion.div
            key="zoom"
            className={s.lightbox}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setZoom(false)}
            role="dialog"
            aria-label={tx("zoom.dialog")}
          >
            <motion.img
              src={shownUrl}
              alt={tx("outfit.resultAlt")}
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
