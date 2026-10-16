"use client";

// 商品详情页“上身效果”（T3）：横向画廊，每张 3:4 竖图，悬停或长按变成实况（LivePhoto）。
// 数据优先级：本人结果（“你的上身效果”）→ 演示模特（“模特上身”，如实写明是模特）→ 生成入口。
// 生成：已登录、有本人正面全身照、已同意（与 2D 试穿同一项）时点“生成我的上身效果”，约 30–45 秒出 2 张场景图；
// Live 视频在后台生成，就绪前卡片用纯前端效果代替，就绪后才显示 LIVE 标（每 5 秒查询一次）。
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import LivePhoto from "@/components/live/LivePhoto";
import { compress, readError } from "@/components/tryon/shared";
import { springs } from "@/lib/motion";
import type { DemoScene } from "@/lib/scene/scenes";
import type { SceneState } from "@/lib/scene/service";
import s from "./LookGallery.module.css";

type Phase = "idle" | "uploading" | "running" | "error";

// 生成约 30 秒：按时间推进的阶段文案，让等待有节奏。只是叙述，不对应真实进度，也不显示百分比。
const STAGES: { from: number; text: string }[] = [
  { from: 0, text: "正在布景" },
  { from: 8, text: "正在为你换上这件" },
  { from: 18, text: "正在调光" },
  { from: 28, text: "正在收尾" },
];

function stageAt(seconds: number): number {
  let i = 0;
  while (i + 1 < STAGES.length && seconds >= STAGES[i + 1].from) i++;
  return i;
}

export default function LookGallery({
  itemId,
  itemName,
  initial,
  demo,
  demoModelLabel,
}: {
  itemId: string;
  itemName: string;
  initial: SceneState;
  demo: DemoScene[];
  /** 演示模特的说明，如“演示模特 · 虚构 AI 人物”。 */
  demoModelLabel: string;
}) {
  const reduced = useReducedMotion() === true;
  const [state, setState] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showPrep, setShowPrep] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const own = state.renders.filter((r) => r.status === "succeeded" && r.imageUrl);
  const anyPending = state.renders.some((r) => r.videoPending);
  const nextPath = `/item/${itemId}`;

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
    if (phase !== "running") return;
    const t0 = Date.now();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

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
    setElapsed(0);
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

  const canGenerate = state.enabled && state.signedIn && state.hasFrontPhoto && (state.consented || agree);
  const running = phase === "running";

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

  const entry = (() => {
    if (!state.enabled) return null;
    if (!state.signedIn) {
      return (
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="sc-cta sc-cta--ghost compact">
          登录后生成我的上身效果
        </Link>
      );
    }
    if (running) return null;
    const needsPrep = !state.hasFrontPhoto || !state.consented;
    if (!needsPrep) {
      // 照片与同意都已就绪：直接生成；已有本人结果时是次要的“重新生成”。
      return (
        <button type="button" className={`sc-cta ${own.length ? "sc-cta--ghost " : ""}compact`} onClick={() => void generate()}>
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
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} disabled={phase === "uploading"}>
              {phase === "uploading" ? "正在上传…" : "上传一张正面全身照"}
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
        {!state.consented ? (
          <label className={s.consent}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>同意把我的正面照发送给 fal.ai 生成上身效果图</span>
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
            <p className="sc-meta">用你的正面全身照，看这件穿在你身上、走进不同场景的样子</p>
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
    </section>
  );
}
