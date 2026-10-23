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
import { compress, readError } from "@/components/tryon/shared";
import { NANO_STAGES, QUICK_STAGES, stageAt, useQuickStageText, useQuickTryon, useTicker } from "@/components/tryon/useQuickTryon";
import { useT } from "@/lib/i18n/client";
import type { NsKey } from "@/lib/i18n/types";
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

// 生成约 30 秒：按时间推进的阶段文案，让等待有节奏。只是叙述，不对应真实进度，也不显示百分比。文案在 item 字典 gallery.stages。
const STAGES: { from: number; key: NsKey<"item"> }[] = [
  { from: 0, key: "gallery.stages.staging" },
  { from: 8, key: "gallery.stages.dressing" },
  { from: 18, key: "gallery.stages.lighting" },
  { from: 28, key: "gallery.stages.finishing" },
];
function sceneStage(seconds: number) {
  return stageAt(seconds, STAGES);
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
  const t = useT("item");
  const tt = useT("tryon");
  const stageText = useQuickStageText();
  const [state, setState] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [showPrep, setShowPrep] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [zoom, setZoom] = useState(false);
  // 一键试穿的请求与两段式轮询与浏览时的一键试穿面板共用（components/tryon/useQuickTryon）。
  const q = useQuickTryon(quick?.initial ?? null, {
    onAccepted: () => setState((st) => ({ ...st, consented: true, hasFrontPhoto: true })),
    onConsentRecorded: () => setState((st) => ({ ...st, consented: true })),
    onNoBase: () => setState((st) => ({ ...st, hasFrontPhoto: false })),
  });
  const quickView = q.view;
  const quickRunning = q.running;
  const quickError = q.error;
  const refining = q.refining;
  const elapsed = useTicker(phase === "running");
  const quickElapsed = useTicker(quickRunning);

  const own = state.renders.filter((r) => r.status === "succeeded" && r.imageUrl);
  const anyPending = state.renders.some((r) => r.videoPending);
  const nextPath = `/item/${itemId}`;
  const quickOn = !!quick?.enabled && quick.supported;
  // 同意文案如实写明处理方：试穿与上身效果都经 fal.ai 上的 AI 模型（与试衣间同一项，D47）。
  const consentLabel = tt("consent.agree", { provider: quick?.providerName ?? tt("consent.provider") });

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
      setError(await readError(res, t("gallery.uploadError")));
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
      setError(await readError(res, t("gallery.generateError")));
      setPhase("error");
      return;
    }
    setState((await res.json()) as SceneState);
    setShowPrep(false);
    setPhase("idle");
  }

  function tryOn() {
    if (!quickRunning) void q.run(itemId, !state.consented && agree);
  }

  const canGenerate = state.enabled && state.signedIn && state.hasFrontPhoto && (state.consented || agree);
  const running = phase === "running";
  const hasBase = state.hasFrontPhoto || !!quick?.baseUrl;

  // 卡片列表：生成中显示两张等待卡；有本人结果显示本人；否则演示模特。
  let title = t("gallery.title");
  let note: string | null = null;
  let cards: { key: string; image: string; video: string | null; caption: string }[] = [];
  if (own.length) {
    title = t("gallery.titleOwn");
    cards = own.map((r) => ({ key: r.id, image: r.imageUrl!, video: r.videoUrl, caption: r.title }));
  } else if (demo.length) {
    title = t("gallery.titleDemo");
    note = demoModelLabel;
    cards = demo.map((d) => ({ key: d.id, image: d.image, video: d.live, caption: d.title }));
  }

  const quickBlock = (() => {
    if (!quickOn || !quick) return null;
    const result = quickView?.resultUrl ?? null;
    const shown = result ?? quick.baseUrl;
    const stages = quick.accessory ? NANO_STAGES : QUICK_STAGES;
    // 穿戴（鞋包配饰）/ 穿上（衣服）：字典里用 select 按 kind 分支
    const kind = quick.accessory ? "accessory" : "clothing";
    const quickStage = stages[stageAt(quickElapsed, stages)];
    let action: React.ReactNode;
    if (!state.signedIn) {
      action = (
        <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="sc-cta compact">
          {t("quick.signIn")}
        </Link>
      );
    } else if (!hasBase) {
      action = (
        <Link href="/profile/avatar" className="sc-cta compact">
          {t("quick.buildAvatar")}
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
            onClick={tryOn}
          >
            {result ? t("quick.again") : t("quick.tryOn")}
          </button>
        </>
      );
    }
    const desc = !state.signedIn
      ? t("quick.descSignedOut")
      : !hasBase
        ? t("quick.descNoBase")
        : result
          ? t("quick.descResult", { kind, name: itemName })
          : t("quick.descReady", { base: quick.isTwin ? "twin" : "photo", kind });
    return (
      <div className={s.quick}>
        <div className={s.quickStage}>
          <AnimatePresence initial={false}>
            {shown ? (
              <motion.img
                key={shown}
                src={shown}
                alt={result ? t("quick.altResult", { kind, name: itemName }) : quick.isTwin ? t("quick.altTwin") : t("quick.altPhoto")}
                className={`${s.quickImg} ${quickRunning ? s.quickBlur : ""}`}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.025 }}
                animate={{ opacity: 1, scale: quickRunning ? 1.08 : 1 }}
                exit={{ opacity: 0, transition: { delay: 0.4, duration: 0.25 } }}
                transition={{ opacity: { duration: 0.7 }, scale: springs.roll }}
              />
            ) : null}
          </AnimatePresence>
          {!shown ? <div className={s.quickEmpty}>{state.signedIn ? t("quick.emptySignedIn") : t("quick.emptySignedOut")}</div> : null}
          {quickRunning ? <span className={s.beam} aria-hidden="true" /> : null}
          {result && !quickRunning ? (
            <button type="button" className={s.quickZoom} onClick={() => setZoom(true)} aria-label={t("quick.zoom")} />
          ) : null}
          {shown && !quickRunning ? (
            <span className={s.quickLabel} role={refining ? "status" : undefined}>
              {result ? (refining ? t("quick.labelRefining") : "On You") : quick.isTwin ? t("quick.labelTwin") : "You"}
            </span>
          ) : null}
        </div>
        <div className={s.quickText}>
          <span className="sc-kicker">Try It On</span>
          <h2 className={s.quickTitle}>{quickRunning ? t("quick.titleRunning", { kind }) : result ? t("quick.titleResult") : t("quick.title")}</h2>
          {quickRunning ? (
            <>
              <p className={`serif-note wait-step ${s.stage}`} key={quickStage.key} role="status" aria-live="polite">
                {stageText(quickStage)}…
              </p>
              <p className="sc-meta">{t("quick.running", { name: itemName, kind, s: quickElapsed })}</p>
            </>
          ) : (
            <p className="sc-meta">{result && refining ? t("quick.refining") : desc}</p>
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
          {t("gallery.signIn")}
        </Link>
      );
    }
    if (running) return null;
    const needsPrep = !state.hasFrontPhoto || !state.consented;
    if (!needsPrep) {
      // 形象与同意都已就绪：直接生成；已有本人结果时是次要的“重新生成”。
      return (
        <button type="button" className={`sc-cta ${own.length || quickOn ? "sc-cta--ghost " : ""}compact`} disabled={quickRunning} onClick={() => void generate()}>
          {own.length ? t("gallery.regenerate") : t("gallery.generate")}
        </button>
      );
    }
    if (!showPrep) {
      return (
        <button type="button" className="sc-cta sc-cta--ghost compact" onClick={() => setShowPrep(true)}>
          {t("gallery.generate")}
        </button>
      );
    }
    return (
      <div className={s.prep}>
        {!state.hasFrontPhoto ? (
          <div className={s.prepRow}>
            <Link href="/profile/avatar" className="sc-cta compact">
              {t("quick.buildAvatar")}
            </Link>
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()} disabled={phase === "uploading"}>
              {phase === "uploading" ? t("gallery.uploading") : t("gallery.uploadPhoto")}
            </button>
            <span className="sc-meta">{t("gallery.photoTips")}</span>
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
          {own.length ? t("gallery.regenerateMine") : t("gallery.generate")}
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
            {running ? t("gallery.titleRunning") : title}
          </h2>
          {running ? (
            <>
              {/* key 随阶段变化：每换一段文案就用 .wait-step 淡入浮起一次 */}
              <p className={`serif-note wait-step ${s.stage}`} key={sceneStage(elapsed)} role="status" aria-live="polite">
                {t(STAGES[sceneStage(elapsed)].key)}…
              </p>
              <p className="sc-meta">{t("gallery.running", { name: itemName, s: elapsed })}</p>
            </>
          ) : note ? (
            <p className="sc-meta">{note}</p>
          ) : own.length ? (
            <p className="sc-meta">{anyPending ? t("gallery.livePending") : t("gallery.liveReady")}</p>
          ) : demo.length ? null : (
            <p className="sc-meta">{t("gallery.empty")}</p>
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
            aria-label={t("gallery.lightbox")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={quickView.resultUrl} alt={t("gallery.lightboxAlt", { name: itemName })} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
