"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AvatarState, Slot } from "@/lib/avatar/service";
import type { TwinView } from "@/lib/avatar/twin";
import { useLocale, useT } from "@/lib/i18n/client";
import { LOCALE_META } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/types";
import PhotoTile, { BodyFrontSilhouette, BodySideSilhouette, FaceSilhouette, type Requirement } from "./PhotoTile";
import s from "./AvatarStudio.module.css";
import css from "./TwinStudio.module.css";

// 数字分身（D63）：上传 2–5 张照片 → 生成一组标准形象照（正面、侧面、背面）→ 左右滑动查看。
// 生成走 POST /api/avatar/twin（后台执行，页面轮询；fal 排队时约 40–120 秒）；等待态只显示真实秒数与阶段文案，不伪造百分比。

type Gender = "female" | "male";

// 标签与拍摄提示见字典 avatar.twin.slots.<slot>。
const SLOT_META: { slot: Slot; required: Requirement; icon: ReactNode }[] = [
  { slot: "face", required: "must", icon: <FaceSilhouette /> },
  { slot: "front", required: "must", icon: <BodyFrontSilhouette /> },
  { slot: "extra", required: "may", icon: <FaceSilhouette /> },
  { slot: "side", required: "may", icon: <BodySideSilhouette /> },
  { slot: "back", required: "may", icon: <BodyFrontSilhouette /> },
];

const GENDERS: Gender[] = ["female", "male"];

async function readError(res: Response | null, fallback: string, offline: string) {
  if (!res) return offline;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** 阶段文案按真实经过的秒数切换（生成请求是同步的，服务端不回报进度）。 */
function phaseText(t: Translator<"avatar">, sec: number, analysis: boolean) {
  if (sec < 4) return t("twin.phase.reading");
  if (analysis && sec < 16) return t("twin.phase.understanding");
  if (sec < 40) return t("twin.phase.shooting");
  return t("twin.phase.refining"); // 正面出图后做脸部精修（D69），约在 30–40 秒开始
}

export default function TwinStudio({
  state,
  busy,
  errorAt,
  onUpload,
  onRemove,
  onState,
  onNote,
}: {
  state: AvatarState;
  busy: string | null;
  errorAt: (at: string) => string | undefined;
  onUpload: (slot: Slot, file: File) => void;
  onRemove: (id: string, at: string) => void;
  onState: (next: AvatarState) => void;
  /** 读屏播报 */
  onNote: (text: string) => void;
}) {
  const t = useT("avatar");
  const tc = useT("common");
  const intl = LOCALE_META[useLocale()].intl;
  const twin = state.twin;
  const [regenerating, setRegenerating] = useState(false);
  const [gender, setGender] = useState<Gender | null>(twin?.gender ?? null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 页面重新打开时，服务端可能仍在生成（例如刷新了页面）：显示等待态并每 3 秒查询一次，直到结束。
  const resumed = startedAt === null && state.job?.provider === "twin" && state.job.status === "processing";
  const generating = startedAt !== null || resumed;
  const analysis = !!state.consent?.bodyAnalysis && !!state.offer.bodyAnalysis;
  const resumeBase = resumed ? Date.now() - state.job!.elapsedSeconds * 1000 : null;
  const [resumeAt] = useState(() => resumeBase);

  useEffect(() => {
    if (!resumed) return;
    setNow(Date.now());
    let stop = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const res = await fetch("/api/avatar", { cache: "no-store" }).catch(() => null);
      if (stop || !res || !res.ok) return;
      const next = (await res.json()) as AvatarState;
      if (!(next.job?.provider === "twin" && next.job.status === "processing")) onState(next);
    }, 3000);
    return () => {
      stop = true;
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [resumed, onState]);

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const photo = (slot: Slot) => state.photos.find((p) => p.slot === slot);
  const face = photo("face");
  const front = photo("front");
  const count = state.photos.filter((p) => SLOT_META.some((m) => m.slot === p.slot)).length;
  const ready = !!face && !!front && !!gender;
  const missing = !face || !front ? t("twin.missingPhotos") : !gender ? t("gender.missing") : null;

  async function generate() {
    if (!ready || generating) return;
    setError(null);
    setStartedAt(Date.now());
    const res = await fetch("/api/avatar/twin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const text = await readError(res, t("twin.generateFailed"), tc("networkError"));
      setStartedAt(null);
      setError(text);
      return;
    }
    const next = (await res.json()) as AvatarState;
    setStartedAt(null);
    setRegenerating(false);
    onState(next); // 仍在生成时（processing）由上面的轮询接着显示等待态
    if (!(next.job?.provider === "twin" && next.job.status === "processing")) onNote(t("twin.ready"));
  }

  async function removeTwin(v: TwinView) {
    if (!confirm(t("twin.deleteConfirm"))) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/avatar/jobs/${v.jobId}/result`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setDeleting(false);
      setError(await readError(res, t("errors.delete"), tc("networkError")));
      return;
    }
    const full = await fetch("/api/avatar", { cache: "no-store" }).catch(() => null);
    setDeleting(false);
    if (full && full.ok) onState((await full.json()) as AvatarState);
    onNote(t("twin.deleted"));
  }

  // ---- 生成中 ----
  if (generating) {
    const base = startedAt ?? resumeAt ?? resumeBase ?? now;
    const sec = Math.max(0, Math.round((now - base) / 1000));
    return (
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">{t("twin.generatingTitle")}</h2>
        <div className={css.wait}>
          <div className={s.waitPortrait}>
            {front ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={front.url} alt="" />
            ) : (
              <span className={s.creatorFigure} />
            )}
            <i className={s.waitSweep} aria-hidden="true" />
          </div>
          <div className={s.waitText} role="status" aria-live="polite">
            <p key={phaseText(t, sec, analysis)} className={`${s.waitTitle} ${css.phase}`}>
              {phaseText(t, sec, analysis)}
            </p>
            <span className="sc-meta">{t("twin.elapsed", { sec })}</span>
          </div>
        </div>
      </section>
    );
  }

  // ---- 已有形象 ----
  if (twin && !regenerating) {
    return (
      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">{t("twin.resultTitle")}</h2>
          <span className="sc-meta">{new Date(twin.createdAt).toLocaleDateString(intl)}</span>
        </div>
        <TwinGallery shots={twin.shots} />
        {twin.summary ? <p className={`serif-note ${css.summary}`}>{twin.summary}</p> : null}
        {twin.tags.length ? (
          <ul className={css.tags} aria-label={t("twin.traitsAria")}>
            {twin.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}
        <div className={s.actions}>
          <Link href="/fitting-room" className="sc-cta">
            {t("twin.tryOn")}
          </Link>
          <button
            type="button"
            className="sc-cta sc-cta--ghost"
            onClick={() => {
              setError(null);
              setRegenerating(true);
            }}
          >
            {t("twin.regenerate")}
          </button>
          <button type="button" className={s.small} onClick={() => removeTwin(twin)} disabled={deleting}>
            {deleting ? t("twin.deleting") : t("twin.delete")}
          </button>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  // ---- 上传与生成 ----
  return (
    <section className="sc-glass card stack sc-rise">
      <h2 className="section-title">{t("twin.title")}</h2>
      <p className="serif-note">{t("twin.note")}</p>

      <div className={css.grid}>
        {SLOT_META.map((m) => {
          const p = photo(m.slot);
          return (
            <PhotoTile
              key={m.slot}
              label={t(`twin.slots.${m.slot}.label`)}
              tip={t(`twin.slots.${m.slot}.tip`)}
              icon={m.icon}
              noun="photo"
              photo={p}
              disabled={false}
              busy={busy === m.slot || (!!p && busy === p.id)}
              required={m.required}
              error={errorAt(m.slot)}
              onPick={(f) => onUpload(m.slot, f)}
              onDelete={p ? () => onRemove(p.id, m.slot) : undefined}
            />
          );
        })}
      </div>
      <span className={s.hint}>{t("twin.count", { n: count })}</span>

      <div className={s.choice}>
        <span className="sc-meta" id="twin-gender-label">
          {t("gender.label")}
        </span>
        <div className={s.segment} role="group" aria-labelledby="twin-gender-label">
          {GENDERS.map((g) => (
            <button key={g} type="button" aria-pressed={gender === g} onClick={() => setGender(g)}>
              {t(`gender.${g}`)}
            </button>
          ))}
        </div>
      </div>

      <div className={s.actions}>
        <button type="button" className="sc-cta" disabled={!ready} onClick={generate}>
          {twin ? t("twin.regenerateWith") : t("twin.start")}
        </button>
        {regenerating && twin ? (
          <button type="button" className={s.small} onClick={() => setRegenerating(false)}>
            {t("twin.backToCurrent")}
          </button>
        ) : null}
        {missing ? <span className="sc-meta">{missing}</span> : null}
      </div>
      {regenerating && twin ? <p className={s.hint}>{t("twin.replaceNote")}</p> : null}
      {state.job?.resultDeleted && !twin ? <p className="sc-meta">{t("twin.previousDeleted")}</p> : null}
      {!error && state.job?.provider === "twin" && state.job.status === "failed" ? (
        <p className="error" role="alert">
          {t("twin.lastFailed", { reason: state.job.error?.message ?? t("generate.failedDefault") })}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** 形象照画廊：左右拖动 / 方向键 / 圆点切换；交叉淡入 + 轻微视差，只动 transform 与 opacity。 */
function TwinGallery({ shots }: { shots: TwinView["shots"] }) {
  const t = useT("avatar");
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const n = shots.length;
  const i = Math.min(index, n - 1);

  const go = (next: number) => {
    if (n < 2) return;
    const wrapped = (next + n) % n;
    setDir(next > i ? 1 : -1);
    setIndex(wrapped);
  };

  return (
    <div className={css.gallery}>
      <div
        className={css.stage}
        role="group"
        aria-roledescription={t("twin.carousel")}
        aria-label={t("twin.galleryAria", { n })}
        tabIndex={0}
        data-dragging={drag.current ? true : undefined}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(i + 1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(i - 1);
          }
        }}
        onPointerDown={(e) => {
          if (n < 2) return;
          drag.current = { x: e.clientX, id: e.pointerId };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          const d = e.clientX - drag.current.x;
          drag.current = null;
          setDx(0);
          if (d < -40) go(i + 1);
          else if (d > 40) go(i - 1);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDx(0);
        }}
      >
        {shots.map((shot, k) => {
          const state = k === i ? "on" : (k - i) * dir > 0 ? "next" : "prev";
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={shot.url}
              src={shot.url}
              alt={k === i ? t("twin.shotAlt", { angle: t(`twin.angle.${shot.angle}`) }) : ""}
              aria-hidden={k === i ? undefined : true}
              className={css.shot}
              data-state={state}
              draggable={false}
              style={k === i && dx ? { transform: `translate3d(${dx * 0.35}px,0,0)`, transition: "none" } : undefined}
            />
          );
        })}
        <span className={css.angle} aria-hidden="true">
          {shots[i] ? t(`twin.angle.${shots[i].angle}`) : null}
        </span>
      </div>
      {n > 1 ? (
        <div className={css.dots}>
          {shots.map((shot, k) => (
            <button
              key={shot.url}
              type="button"
              aria-label={t("twin.viewShot", { angle: t(`twin.angle.${shot.angle}`) })}
              aria-current={k === i ? "true" : undefined}
              onClick={() => go(k)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
