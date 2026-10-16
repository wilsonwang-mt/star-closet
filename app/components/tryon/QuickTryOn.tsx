"use client";
/* eslint-disable @next/next/no-img-element -- 试穿图是鉴权地址或 data URI，不走 next/image */

// 浏览中的“一键试穿”（D67）：衣橱页、搭配页、改编结果、商品详情页首屏的每件可上身单品旁一个醒目的金色胶囊。
// - 未登录：去登录并带回当前页面。
// - 已登录、还没有形象（数字分身与正面照都没有）：面板里一句话引导去 /profile/avatar 建立数字分身。
// - 有形象：侧滑玻璃面板（手机为底部全屏），直接调用 POST /api/tryon/quick；未同意时先勾选同意（D47）。
//   沿用两段式：先出图 → 角标“正在细化” → 清晰版原地交叉淡入。面板里可“加入试衣间”“看完整详情”。
// 整页共用一个面板与一份试穿状态（QuickTryonProvider），请求与轮询逻辑与商品详情页共用 useQuickTryon。
// 动效只动 transform / opacity；减弱动态时只淡入淡出。
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { addToFittingRoom } from "@/lib/bag/client";
import { reducedFade, springs } from "@/lib/motion";
import { isAccessory } from "@/lib/tryon/accessory";
import { isWearable } from "@/lib/tryon/plan";
import type { TryonContext } from "@/lib/tryon/service";
import { cleanName, CloseIcon } from "./shared";
import { NANO_STAGES, QUICK_STAGES, stageAt, useQuickTryon, useTicker } from "./useQuickTryon";
import s from "./QuickTryOn.module.css";

export type QuickItem = {
  id: string;
  name: string;
  image: string | null;
  category: string;
  displayCategory?: string | null;
};

/** 这件能否一键试穿：有单品图，且是上装 / 下装 / 外套 / 连衣裙（Kolors）或鞋 / 包 / 配饰（nano 分支）。 */
export const canQuickTry = (item: QuickItem) =>
  !!item.image && (isWearable({ ...item, displayCategory: item.displayCategory ?? null }) || isAccessory({ category: item.category, displayCategory: item.displayCategory ?? null }));

type Ctl = {
  ctx: TryonContext;
  open: (item: QuickItem, source?: { outfitId?: string | null; outfitName?: string | null }) => void;
};

const QuickCtx = createContext<Ctl | null>(null);

export function QuickTryonProvider({ ctx, children }: { ctx: TryonContext | null; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [item, setItem] = useState<QuickItem | null>(null);
  const [source, setSource] = useState<{ outfitId?: string | null; outfitName?: string | null }>({});
  const [consented, setConsented] = useState(!!ctx?.consented);
  const [hasBase, setHasBase] = useState(!!ctx?.frontPhotoUrl);
  const [agree, setAgree] = useState(false);
  const q = useQuickTryon(null, {
    onAccepted: () => {
      setConsented(true);
      setHasBase(true);
    },
    onConsentRecorded: () => setConsented(true),
    onNoBase: () => setHasBase(false),
  });
  const { run, setView, setError } = q;

  const open = useCallback<Ctl["open"]>(
    (it, src) => {
      if (!ctx) return;
      if (!ctx.signedIn) {
        router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
        return;
      }
      setItem(it);
      setSource(src ?? {});
      setError(null);
      setView((v) => (v?.wornItemId === it.id ? v : null));
      // 形象与同意都已就绪：直接开始。
      if (hasBase && consented && !q.running) void run(it.id, false);
    },
    [consented, ctx, hasBase, pathname, q.running, router, run, setError, setView],
  );

  const value = useMemo<Ctl | null>(() => (ctx && ctx.enabled ? { ctx, open } : null), [ctx, open]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <QuickCtx.Provider value={value}>
      {children}
      {mounted && ctx
        ? createPortal(
            <AnimatePresence>
              {item ? (
                <Panel
                  key="quick-panel"
                  ctx={ctx}
                  item={item}
                  source={source}
                  q={q}
                  hasBase={hasBase}
                  consented={consented}
                  agree={agree}
                  setAgree={setAgree}
                  onStart={() => void run(item.id, !consented && agree)}
                  onClose={() => setItem(null)}
                />
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </QuickCtx.Provider>
  );
}

function SparkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5c.4 2.9 1.6 4.1 4.5 4.5-2.9.4-4.1 1.6-4.5 4.5-.4-2.9-1.6-4.1-4.5-4.5 2.9-.4 4.1-1.6 4.5-4.5ZM12.6 10.4c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** 一键试穿按钮：sm 用在单品行与缩略图上，lg 用在商品详情页首屏。不能试穿或服务未开放时不渲染。 */
export function QuickTryButton({
  item,
  size = "sm",
  source,
  className = "",
}: {
  item: QuickItem;
  size?: "sm" | "lg";
  source?: { outfitId?: string | null; outfitName?: string | null };
  className?: string;
}) {
  const ctl = useContext(QuickCtx);
  if (!ctl || !canQuickTry(item)) return null;
  const name = cleanName(item.name);
  return (
    <button
      type="button"
      className={`${s.btn} ${size === "lg" ? s.btnLg : ""} ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctl.open(item, source);
      }}
      aria-haspopup="dialog"
      aria-label={`一键试穿：${name}`}
    >
      <SparkIcon size={size === "lg" ? 16 : 13} />
      <span>一键试穿</span>
    </button>
  );
}

export const useQuickTryonEnabled = () => useContext(QuickCtx) !== null;

function Panel({
  ctx,
  item,
  source,
  q,
  hasBase,
  consented,
  agree,
  setAgree,
  onStart,
  onClose,
}: {
  ctx: TryonContext;
  item: QuickItem;
  source: { outfitId?: string | null; outfitName?: string | null };
  q: ReturnType<typeof useQuickTryon>;
  hasBase: boolean;
  consented: boolean;
  agree: boolean;
  setAgree: (v: boolean) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion() === true;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const elapsed = useTicker(q.running);
  const accessory = isAccessory({ category: item.category, displayCategory: item.displayCategory ?? null });
  const stages = accessory ? NANO_STAGES : QUICK_STAGES;
  const verb = accessory ? "穿戴" : "穿上";
  const name = cleanName(item.name);
  const result = q.view?.wornItemId === item.id ? q.view.resultUrl : null;
  const baseUrl = ctx.frontPhotoUrl;
  const shown = result ?? (hasBase ? baseUrl : null);
  const [saved, setSaved] = useState<"idle" | "busy" | "done">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function save() {
    setSaved("busy");
    setSaveError(null);
    const r = await addToFittingRoom({
      kind: "single",
      outfitName: source.outfitName ?? null,
      sourceOutfitId: source.outfitId ?? null,
      items: [{ id: item.id, name: item.name }],
    });
    if (r.ok) setSaved("done");
    else {
      setSaved("idle");
      if ("error" in r) setSaveError(r.error);
    }
  }

  // 宽屏从右侧滑入，手机从底部升起（面板只在客户端挂载，可以直接读媒体查询）。
  const [wide] = useState(() => window.matchMedia("(min-width: 720px)").matches);
  const off = wide ? { x: 48, y: 0 } : { x: 0, y: 56 };
  const sheet = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: reducedFade }
    : {
        initial: { opacity: 0, ...off },
        animate: { opacity: 1, x: 0, y: 0 },
        exit: { opacity: 0, ...off, transition: { duration: 0.28, ease: [0.4, 0, 1, 1] as const } },
        transition: { ...springs.rise, opacity: { duration: 0.3 } },
      };
  const crossfade = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: reducedFade }
    : {
        initial: { opacity: 0, scale: 1.03 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, transition: { delay: 0.5, duration: 0.25 } },
        transition: { opacity: { duration: 0.7, ease: [0.22, 0.61, 0.2, 1] as const }, scale: springs.roll },
      };

  // 不生成也能把这件单独加入试衣间（D67：单品直接加入个人试衣间）。
  const saveRow = (
    <div className={s.saveRow}>
      <button type="button" className="link-btn" disabled={saved !== "idle"} onClick={() => void save()}>
        {saved === "done" ? "已加入试衣间" : "先把这件加入试衣间"}
      </button>
      {saved === "done" ? (
        <Link href="/fitting-room" className="link-btn fade-in">
          去试衣间
        </Link>
      ) : null}
    </div>
  );

  let title: string;
  let body: ReactNode;
  if (!hasBase) {
    title = "先建立你的形象";
    body = (
      <>
        <p className="serif-note" style={{ margin: 0 }}>
          先建立你的形象，之后每件都能一键试穿。
        </p>
        <p className="sc-meta" style={{ margin: 0 }}>
          上传 3–5 张照片，生成你的数字分身。
        </p>
        <Link href="/profile/avatar" className={`sc-cta ${s.main}`}>
          建立我的数字分身
        </Link>
        {saveRow}
      </>
    );
  } else if (q.running) {
    title = `正在为你${verb}这件`;
    body = (
      <>
        <p className={`serif-note wait-step ${s.step}`} key={stageAt(elapsed, stages)} role="status" aria-live="polite">
          {stages[stageAt(elapsed, stages)].text}…
        </p>
        <p className="sc-meta" style={{ margin: 0 }}>
          把「{name}」{verb}到你身上 · {elapsed} 秒
        </p>
      </>
    );
  } else if (result) {
    title = "穿在你身上";
    body = (
      <>
        <p className="sc-meta" style={{ margin: 0 }} role={q.refining ? "status" : undefined}>
          {q.refining ? "正在细化：衣长、领型和细节会更贴近商品图，好了自动替换" : `这是你${verb}「${name}」的样子`}
        </p>
        <div className={s.actions}>
          <button type="button" className={`sc-cta ${s.main}`} disabled={saved !== "idle"} onClick={() => void save()}>
            {saved === "done" ? "已加入试衣间" : "加入试衣间"}
          </button>
          <Link href={`/item/${item.id}`} className={`sc-cta sc-cta--ghost ${s.main}`}>
            看完整详情
          </Link>
        </div>
        {saved === "done" ? (
          <Link href="/fitting-room" className="link-btn fade-in" style={{ justifySelf: "start" }}>
            去试衣间
          </Link>
        ) : null}
      </>
    );
  } else {
    title = "一键试穿";
    body = (
      <>
        <p className="sc-meta" style={{ margin: 0 }}>
          {ctx.baseSource === "twin" ? "用你的数字分身" : "用你的正面全身照"}，{accessory ? "约 45 秒" : "约 20 秒"}看「{name}」{accessory ? "穿戴" : "穿"}在你身上
        </p>
        {!consented ? (
          <label className={s.consent}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>同意把我的形象照片发送给 {ctx.providerName}生成试穿图</span>
          </label>
        ) : null}
        <div className={s.actions}>
          <button type="button" className={`sc-cta ${s.main}`} disabled={!(consented || agree)} onClick={onStart}>
            {q.error ? "再试一次" : "开始试穿"}
          </button>
          <Link href={`/item/${item.id}`} className={`sc-cta sc-cta--ghost ${s.main}`}>
            看完整详情
          </Link>
        </div>
        {saveRow}
      </>
    );
  }

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
        aria-labelledby="quick-tryon-title"
        tabIndex={-1}
        {...sheet}
      >
        <div className={s.head}>
          <div style={{ minWidth: 0 }}>
            <span className="sc-kicker">{result ? "On You" : "Try It On"}</span>
            <h2 id="quick-tryon-title" className={`section-title ${s.title}`}>
              {title}
            </h2>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className={s.stage}>
          <AnimatePresence initial={false}>
            {shown ? (
              <motion.img
                key={shown}
                src={shown}
                alt={result ? `${verb}${name}的你` : ctx.baseSource === "twin" ? "你的数字分身" : "你的正面全身照"}
                className={s.frame}
                {...crossfade}
              />
            ) : null}
          </AnimatePresence>
          {!shown ? (
            <div className={s.empty}>
              {item.image ? <img src={item.image} alt={name} className={s.product} /> : null}
            </div>
          ) : null}
          <span className={`${s.dim} ${q.running ? s.dimOn : ""}`} aria-hidden="true" />
          {q.running ? <span className={s.beam} aria-hidden="true" /> : null}
          {item.image && shown ? (
            <span className={s.chip} aria-hidden="true">
              <img src={item.image} alt="" />
            </span>
          ) : null}
          {result && !q.running ? <span className={s.label}>{q.refining ? "正在细化" : "On You"}</span> : null}
        </div>

        <div className={s.text}>
          {body}
          {q.error && !q.running ? (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {q.error}
            </p>
          ) : null}
          {saveError ? (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {saveError}
            </p>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
