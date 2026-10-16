"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ItemThumb from "@/components/ItemThumb";
import { reducedFade, springs } from "@/lib/motion";
import { notWornLabels, planTryon } from "@/lib/tryon/plan";
import type { TryonContext, TryonView } from "@/lib/tryon/service";
import { cleanName, CloseIcon, compress, HangerIcon, preload, readError } from "./shared";
import s from "./TryOn.module.css";

// “穿在我身上”（整套）：把这一整套依次换到用户自己的形象上（默认可灵 Kolors on fal.ai；底图优先数字分身正面照，D63）。
// 搭配页改编结果卡在用；试衣间改为逐件试穿（LookTryOn.tsx）。
// 没有配置试穿服务时不渲染入口（服务端传入 ctx.enabled = false），不访问网络。
// 流程：准备（正面照 + 首次同意）→ 生成（光束扫过）→ 结果（淡入 + 轻微推近，与原搭配并排，可放大）。

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
}: {
  ctx: TryonContext;
  source: Source;
  items: TryOnItem[];
  primary?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const steps = planTryon(items);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
        穿在我身上
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
  const steps = planTryon(items);
  const byId = new Map(items.map((i) => [i.id, i]));
  const pieces = steps.map((st) => ({ ...st, item: byId.get(st.itemId)! }));
  const chain = steps.map((st) => st.label).join(" → ");

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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const autoStarted = useRef(false);

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
    const started = Date.now();
    const res = await fetch("/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...source, itemIds: items.map((i) => i.id), consent: !consented && agree }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setError(await readError(res, "试穿失败，请稍后再试"));
      setPhase("error");
      return;
    }
    const data = (await res.json()) as TryonView;
    setConsented(true);
    if (data.resultUrl) await preload(data.resultUrl);
    const wait = MIN_WAIT_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setView(data);
    setPhase("done");
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
        setError(await readError(res, "上传失败，请稍后再试"));
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
      setError(await readError(res, "删除失败，请稍后再试"));
      return;
    }
    setView(null);
    setZoom(false);
    setPhase("prep");
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
              {phase === "done" ? "穿上这一身" : phase === "running" ? "正在为你换上这一身" : "穿在我身上"}
            </h2>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="关闭">
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
                        <img src={photoUrl} alt={isTwin ? "你的数字分身" : "你的正面全身照"} />
                        <span className={s.stageLabel}>You</span>
                      </figure>
                      <div className={s.photoActions}>
                        {isTwin ? (
                          <Link href="/profile/avatar" className="link-btn">
                            管理我的形象
                          </Link>
                        ) : (
                          <label className={`link-btn ${s.fileBtn}`}>
                            {uploading ? "上传中…" : "换一张"}
                            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <label className={s.upload}>
                        <span>
                          <strong>{uploading ? "上传中…" : "上传正面全身照"}</strong>
                          站直、正面、光线充足
                        </span>
                        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
                      </label>
                      <Link href="/profile/avatar" className="sc-cta compact">
                        先建立你的形象
                      </Link>
                    </>
                  )}
                </div>
                <div className="stack" style={{ gap: 10 }}>
                  <span className="sc-meta">这一套 · {chain}</span>
                  <div className={s.pieces}>
                    {pieces.map((p) => (
                      <div key={p.itemId} className={`sc-glass sc-glass--row ${s.piece}`}>
                        <ItemThumb name={p.item.name} image={p.item.image} color={p.item.color} />
                        <span>
                          <span className="item-name" style={{ display: "block" }}>{cleanName(p.item.name)}</span>
                          <span className="sc-meta">{p.label}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {!consented ? (
                <label className={s.consent}>
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <span>同意把我的形象照片发送给 {ctx.providerName} 生成试穿图</span>
                </label>
              ) : null}
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className={s.actions}>
                <button type="button" className="sc-cta" disabled={!ready} onClick={() => void start()}>
                  {phase === "error" ? "再试一次" : "开始试穿"}
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
                  <p className="serif-note wait-step">依次换上{chain.replaceAll(" → ", "、")}</p>
                  <div className={`${s.pieces} adapt-scan`}>
                    {pieces.map((p) => (
                      <div key={p.itemId} className={`sc-glass sc-glass--row ${s.piece}`}>
                        <ItemThumb name={p.item.name} image={p.item.image} color={p.item.color} />
                        <span>
                          <span className="item-name" style={{ display: "block" }}>{cleanName(p.item.name)}</span>
                          <span className="sc-meta">{p.label}</span>
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
                  <span className={`sc-meta ${s.colLabel}`}>这一套</span>
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
                    穿在你身上
                  </span>
                  <motion.button
                    type="button"
                    className={s.result}
                    onClick={() => setZoom(true)}
                    aria-label="放大查看试穿图"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(14px)" }}
                    animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
                    transition={reduce ? reducedFade : { scale: springs.enter, opacity: { duration: 0.9, ease: "easeOut" }, filter: { duration: 1.1, ease: "easeOut" } }}
                  >
                    <figure className={s.stage}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={view.resultUrl} alt="穿上这一身的你" />
                    </figure>
                  </motion.button>
                </div>
              </div>
              <p className={`sc-meta ${s.applied}`}>
                已试穿：{view.applied.join("、")}
              </p>
              {/* 鞋、包、配饰不会上身：如实列出，避免与“这一套”的拼图对照时观感矛盾 */}
              {notWorn.length ? <p className={`sc-meta ${s.applied} ${s.notWorn}`}>未上身：{notWorn.join("、")}</p> : null}
              {error ? <p className="error">{error}</p> : null}
              <div className={s.actions}>
                <button type="button" className="sc-cta" onClick={onClose}>
                  完成
                </button>
                <button type="button" className="sc-cta sc-cta--ghost compact" onClick={() => void remove()}>
                  删除这张
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {zoom && view?.resultUrl ? (
          <motion.div
            key="zoom"
            className={s.lightbox}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setZoom(false)}
            role="dialog"
            aria-label="试穿图大图"
          >
            <motion.img
              src={view.resultUrl}
              alt="穿上这一身的你"
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
