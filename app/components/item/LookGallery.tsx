"use client";

// 商品详情页“上身效果”（T3 + D63）：
// - 顶部“一键试穿”：把这件穿到本人形象上（数字分身正面照优先，否则正面全身照），结果大图展示。
//   上装 / 下装 / 外套 / 连衣裙走可灵 Kolors（约 10 秒）；鞋、包、配饰走 nano-banana-pro（约 30 秒）。没有形象时引导去建立形象。
// - 横向画廊：每张 3:4 竖图，悬停或长按变成实况（LivePhoto）。数据优先级：本人结果（“你的上身效果”）→ 演示模特（“模特上身”，如实写明是模特）→ 生成入口。
// - 生成场景图：已登录、有本人形象、已同意（与试穿同一项）时点“生成我的上身效果”，约 30–45 秒出 2 张场景图（身份参考用分身多张，
//   已有一键试穿结果时一并作衣服参考）；Live 视频在后台生成，就绪前卡片用纯前端效果代替，就绪后才显示 LIVE 标（每 5 秒查询一次）。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import LivePhoto from "@/components/live/LivePhoto";
import { compress, fetchView, preload, readError, sleep, waitFirst } from "@/components/tryon/shared";
import { springs } from "@/lib/motion";
import type { DemoScene } from "@/lib/scene/scenes";
import type { SceneState } from "@/lib/scene/service";
import type { TryonView } from "@/lib/tryon/service";
import s from "./LookGallery.module.css";

type Phase = "idle" | "uploading" | "running" | "error";

/** 一键试穿的首屏数据（服务端给出）。 */
export type QuickTryonProps = {
  /** 试穿服务已开放（有 FAL_KEY 且模型可用）。 */
  enabled: boolean;
  /** 这件能否一键试穿（有单品图，且是上装 / 下装 / 外套 / 连衣裙 / 鞋 / 包 / 配饰）。 */
  supported: boolean;
  /** 鞋、包、配饰（走 nano-banana，耗时更长）。 */
  accessory: boolean;
  /** 底图展示地址（数字分身正面照优先）。 */
  baseUrl: string | null;
  isTwin: boolean;
  providerName: string;
  initial: TryonView | null;
};

// 生成约 30 秒：按时间推进的阶段文案，让等待有节奏。只是叙述，不对应真实进度，也不显示百分比。
const STAGES: { from: number; text: string }[] = [
  { from: 0, text: "正在布景" },
  { from: 8, text: "正在为你换上这件" },
  { from: 18, text: "正在调光" },
  { from: 28, text: "正在收尾" },
];
// 一键试穿的等待节奏：衣服先由 Kolors 快出图（约 20 秒），鞋包配饰只跑 nano-banana（约 45 秒）；之后的细化另有“正在细化”标签。
const QUICK_STAGES: { from: number; text: string }[] = [
  { from: 0, text: "正在读取你的形象" },
  { from: 4, text: "正在为你换上这件" },
  { from: 12, text: "正在调整光影" },
  { from: 20, text: "正在收尾" },
];
const NANO_STAGES: { from: number; text: string }[] = [
  { from: 0, text: "正在读取你的形象" },
  { from: 6, text: "正在为你换上这件" },
  { from: 22, text: "正在调整光影" },
  { from: 38, text: "正在收尾" },
];

function stageAt(seconds: number, stages = STAGES): number {
  let i = 0;
  while (i + 1 < stages.length && seconds >= stages[i + 1].from) i++;
  return i;
}

/** 运行中每秒 +1 的计时。 */
function useTicker(running: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t0 = Date.now();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return elapsed;
}

export default function LookGallery({
  itemId,
  itemName,
  initial,
  demo,
  demoModelLabel,
  quick,
}: {
  itemId: string;
  itemName: string;
  initial: SceneState;
  demo: DemoScene[];
  /** 演示模特的说明，如“演示模特 · 虚构 AI 人物”。 */
  demoModelLabel: string;
  quick?: QuickTryonProps | null;
}) {
  const reduced = useReducedMotion() === true;
  const [state, setState] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [quickView, setQuickView] = useState<TryonView | null>(quick?.initial ?? null);
  const [quickRunning, setQuickRunning] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [zoom, setZoom] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const elapsed = useTicker(phase === "running");
  const quickElapsed = useTicker(quickRunning);

  const own = state.renders.filter((r) => r.status === "succeeded" && r.imageUrl);
  const anyPending = state.renders.some((r) => r.videoPending);
  const nextPath = `/item/${itemId}`;
  const quickOn = !!quick?.enabled && quick.supported;
  // 同意文案如实写明处理方：试穿与上身效果都经 fal.ai 上的 AI 模型（与试衣间同一项，D47）。
  const consentLabel = `同意把我的形象照片发送给 ${quick?.providerName ?? "fal.ai 上的 AI 模型"}生成试穿图`;

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/scene?itemId=${encodeURIComponent(itemId)}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) setState((await res.json()) as SceneState);
  }, [itemId]);

  // Live 视频在后台生成：每 5 秒查一次，最多约 6 分钟。
  useEffect(() => {
    if (!anyPending) return;
    let n = 0;
    const t = window.setInterval(() => {
      n += 1;
      if (n > 72) window.clearInterval(t);
      void refresh();
    }, 5000);
    return () => window.clearInterval(t);
  }, [anyPending, refresh]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  async function upload(file: File) {
    setPhase("uploading");
    setError(null);
    const blob = await compress(file).catch(() => file);
    const form = new FormData();
    form.append("file", blob, "front.jpg");
    const res = await fetch("/api/tryon/photo", { method: "POST", body: form }).catch(() => null);
    if (!res?.ok) {
      setError(await readError(res, "照片上传失败，请再试一次"));
      setPhase("error");
      return;
    }
    setState((st) => ({ ...st, hasFrontPhoto: true }));
    setPhase("idle");
  }

  async function generate() {
    setPhase("running");
    setError(null);
    const res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, consent: !state.consented && agree }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(await readError(res, "生成失败，请稍后再试"));
      setPhase("error");
      return;
    }
    setState((await res.json()) as SceneState);
    setShowPrep(false);
    setPhase("idle");
  }

  async function tryOn() {
    if (quickRunning) return;
    setQuickRunning(true);
    setQuickError(null);
    try {
      const res = await fetch("/api/tryon/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, consent: !state.consented && agree }),
      }).catch(() => null);
      if (!res?.ok) {
        // 服务端在调用模型之前就记下了同意：只要不是“未同意”，下次不用再勾。
        if (res && res.status !== 403 && res.status !== 401 && agree) setState((st) => ({ ...st, consented: true }));
        if (res?.status === 409) setState((st) => ({ ...st, hasFrontPhoto: false }));
        setQuickError(await readError(res, "试穿失败，请稍后再试"));
        return;
      }
      setState((st) => ({ ...st, consented: true, hasFrontPhoto: true }));
      // 只提交到队列就返回：轮询到出第一张图（或失败）。
      const view = await waitFirst((await res.json()) as TryonView, { alive: () => alive.current, pollMs: 1200 });
      if (!alive.current) return;
      if (view.status === "failed" || !view.resultUrl) {
        setQuickError(view.error ?? "试穿失败，请稍后再试");
        return;
      }
      await preload(view.resultUrl);
      setQuickView(view);
      if (view.refining) void refine(view.id);
    } finally {
      setQuickRunning(false);
    }
  }

  /** 细化：每 2 秒查一次，清晰版好了原地替换；细化失败保留快出的那张。 */
  const refine = useCallback(async (id: string) => {
    setRefining(true);
    try {
      for (let i = 0; i < 100 && alive.current; i++) {
        await sleep(2000);
        const r = await fetchView(id);
        if (r.kind === "gone") return;
        if (r.kind === "error") continue;
        const v = r.view;
        if (v.refining || v.status === "processing") continue;
        if (v.status === "succeeded" && v.resultUrl) {
          await preload(v.resultUrl);
          if (alive.current) setQuickView((cur) => (cur?.id === id ? v : cur));
        }
        return;
      }
    } finally {
      if (alive.current) setRefining(false);
    }
  }, []);

  // 首屏带来的结果还在细化（刷新了页面）：接着轮询。
  const initialRefine = useRef(quick?.initial?.refining ? quick.initial.id : null);
  useEffect(() => {
    if (initialRefine.current) void refine(initialRefine.current);
  }, [refine]);

  const canGenerate = state.enabled && state.signedIn && state.hasFrontPhoto && (state.consented || agree);
  const running = phase === "running";
  const hasBase = state.hasFrontPhoto || !!quick?.baseUrl;

  // 卡片列表：生成中显示两张等待卡；有本人结果显示本人；否则演示模特。
  let title = "上身效果";
  let note: string | null = null;
  let cards: { key: string; image: string; video: string | null; caption: string }[] = [];
  if (own.length) {
    title = "你的上身效果";
    cards = own.map((r) => ({ key: r.id, image: r.imageUrl!, video: r.videoUrl, caption: r.title }));
  } else if (demo.length) {
    title = "模特上身";
    note = demoModelLabel;
    cards = demo.map((d) => ({ key: d.id, image: d.image, video: d.live, caption: d.title }));
  }

  const quickBlock = (() => {
    if (!quickOn || !quick) return null;
    const result = quickView?.resultUrl ?? null;
    const shown = result ?? quick.baseUrl;
    const stages = quick.accessory ? NANO_STAGES : QUICK_STAGES;
    const verb = quick.accessory ? "穿戴" : "穿上";
    let action: React.ReactNode;
    if (!state.signedIn) {
      action = (
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="sc-cta compact">
          登录后一键试穿
        </Link>
      );
    } else if (!hasBase) {
      action = (
        <Link href="/profile/avatar" className="sc-cta compact">
          先建立你的形象
        </Link>
      );
    } else if (quickRunning) {
      action = null;
    } else {
      action = (
        <>
          {!state.consented ? (
            <label className={s.consent}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>{consentLabel}</span>
            </label>
          ) : null}
          <button
            type="button"
            className={`sc-cta ${result ? "sc-cta--ghost " : ""}compact`}
            disabled={!(state.consented || agree) || running}
            onClick={() => void tryOn()}
          >
            {result ? "再试一次" : "一键试穿"}
          </button>
        </>
      );
    }
    const desc = !state.signedIn
      ? "用你的数字分身，一键看这件穿在你身上"
      : !hasBase
        ? "上传 3–5 张照片生成你的数字分身，之后每件衣服都能一键试穿"
        : result
          ? `这是你${verb}「${itemName}」的样子 · 点图放大`
          : `${quick.isTwin ? "用你的数字分身" : "用你的正面全身照"}，${quick.accessory ? "约 45 秒" : "约 20 秒"}看这件${quick.accessory ? "穿戴" : "穿"}在你身上`;
    return (
      <div className={s.quick}>
        <div className={s.quickStage}>
          <AnimatePresence initial={false}>
            {shown ? (
              <motion.img
                key={shown}
                src={shown}
                alt={result ? `${verb}${itemName}的你` : quick.isTwin ? "你的数字分身" : "你的正面全身照"}
                className={`${s.quickImg} ${quickRunning ? s.quickBlur : ""}`}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.025 }}
                animate={{ opacity: 1, scale: quickRunning ? 1.08 : 1 }}
                exit={{ opacity: 0, transition: { delay: 0.4, duration: 0.25 } }}
                transition={{ opacity: { duration: 0.7 }, scale: springs.roll }}
              />
            ) : null}
          </AnimatePresence>
          {!shown ? <div className={s.quickEmpty}>{state.signedIn ? "还没有你的形象" : "登录后在这里看到你自己"}</div> : null}
          {quickRunning ? <span className={s.beam} aria-hidden="true" /> : null}
          {result && !quickRunning ? (
            <button type="button" className={s.quickZoom} onClick={() => setZoom(true)} aria-label="放大查看" />
          ) : null}
          {shown && !quickRunning ? (
            <span className={s.quickLabel} role={refining ? "status" : undefined}>
              {result ? (refining ? "正在细化" : "On You") : quick.isTwin ? "你的分身" : "You"}
            </span>
          ) : null}
        </div>
        <div className={s.quickText}>
          <span className="sc-kicker">Try It On</span>
          <h2 className={s.quickTitle}>{quickRunning ? `正在为你${verb}这件` : result ? "穿在你身上" : "一键试穿"}</h2>
          {quickRunning ? (
            <>
              <p className={`serif-note wait-step ${s.stage}`} key={stageAt(quickElapsed, stages)} role="status" aria-live="polite">
                {stages[stageAt(quickElapsed, stages)].text}…
              </p>
              <p className="sc-meta">
                把「{itemName}」{verb}到你身上 · {quickElapsed} 秒
              </p>
            </>
          ) : (
            <p className="sc-meta">{result && refining ? "正在细化：衣长、领型和细节会更贴近商品图，好了自动替换" : desc}</p>
          )}
          {action}
          {quickError ? (
            <p className={s.error} role="alert">
              {quickError}
            </p>
          ) : null}
        </div>
      </div>
    );
  })();

  const entry = (() => {
    if (!state.enabled) return null;
    if (!state.signedIn) {
      // 一键试穿已给出登录入口时不重复。
      if (quickOn) return null;
      return (
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="sc-cta sc-cta--ghost compact">
          登录后生成我的上身效果
        </Link>
      );
    }
    if (running) return null;
    const needsPrep = !state.hasFrontPhoto || !state.consented;
    if (!needsPrep) {
      // 形象与同意都已就绪：直接生成；已有本人结果时是次要的“重新生成”。
      return (
        <button type="button" className={`sc-cta ${own.length || quickOn ? "sc-cta--ghost " : ""}compact`} disabled={quickRunning} onClick={() => void generate()}>
          {own.length ? "重新生成" : "生成我的上身效果"}
        </button>
      );
    }
    if (!showPrep) {
      return (
        <button type="button" className="sc-cta sc-cta--ghost compact" onClick={() => setShowPrep(true)}>
          生成我的上身效果
        </button>
      );
    }
    return (
      <div className={s.prep}>
        {!state.hasFrontPhoto ? (
          <div className={s.prepRow}>
            <Link href="/profile/avatar" className="sc-cta compact">
              先建立你的形象
            </Link>
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} disabled={phase === "uploading"}>
              {phase === "uploading" ? "正在上传…" : "或上传一张正面全身照"}
            </button>
            <span className="sc-meta">站直、正面、光线充足；与试穿共用，只传一次</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </div>
        ) : null}
        {!state.consented && !quickOn ? (
          <label className={s.consent}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{consentLabel}</span>
          </label>
        ) : null}
        {!state.consented && quickOn && state.hasFrontPhoto ? (
          <label className={s.consent}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{consentLabel}</span>
          </label>
        ) : null}
        <button type="button" className="sc-cta compact" disabled={!canGenerate} onClick={() => void generate()}>
          {own.length ? "重新生成我的上身效果" : "生成我的上身效果"}
        </button>
      </div>
    );
  })();

  return (
    <section className={s.section} aria-labelledby="look-gallery-title">
      {quickBlock}

      <div className={s.head}>
        <div>
          <span className="sc-kicker">On Me</span>
          <h2 id="look-gallery-title" className={s.title}>
            {running ? "正在为你生成上身效果" : title}
          </h2>
          {running ? (
            <>
              {/* key 随阶段变化：每换一段文案就用 .wait-step 淡入浮起一次 */}
              <p className={`serif-note wait-step ${s.stage}`} key={stageAt(elapsed)} role="status" aria-live="polite">
                {STAGES[stageAt(elapsed)].text}…
              </p>
              <p className="sc-meta">把你穿上「{itemName}」放进两个场景里 · {elapsed} 秒</p>
            </>
          ) : note ? (
            <p className="sc-meta">{note}</p>
          ) : own.length ? (
            <p className="sc-meta">{anyPending ? "实况效果正在生成，悬停或长按可先预览" : "悬停或长按，看它动起来"}</p>
          ) : demo.length ? null : (
            <p className="sc-meta">用你的形象，看这件穿在你身上、走进不同场景的样子</p>
          )}
        </div>
      </div>

      <div className={s.rail} role="list">
        <AnimatePresence initial={false} mode="popLayout">
          {running
            ? [0, 1].map((i) => (
                <motion.div
                  key={`wait-${i}`}
                  role="listitem"
                  className={s.cell}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.08 }}
                >
                  <div className={s.waiting} aria-hidden="true">
                    <span className={s.beam} />
                  </div>
                </motion.div>
              ))
            : cards.map((c, i) => (
                <motion.div
                  key={c.key}
                  role="listitem"
                  className={s.cell}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={reduced ? { duration: 0.24 } : { ...springs.rise, delay: i * 0.08 }}
                >
                  <LivePhoto image={c.image} video={c.video} alt={`${itemName} · ${c.caption}`} caption={c.caption} eager={i < 2} />
                </motion.div>
              ))}
        </AnimatePresence>
      </div>

      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {entry ? <div className={s.actions}>{entry}</div> : null}

      <AnimatePresence>
        {zoom && quickView?.resultUrl ? (
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={quickView.resultUrl} alt={`穿上${itemName}的你`} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
