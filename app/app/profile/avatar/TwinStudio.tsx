"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AvatarState, Slot } from "@/lib/avatar/service";
import type { TwinView } from "@/lib/avatar/twin";
import PhotoTile, { BodyFrontSilhouette, BodySideSilhouette, FaceSilhouette, type Requirement } from "./PhotoTile";
import s from "./AvatarStudio.module.css";
import t from "./TwinStudio.module.css";

// 数字分身（D63）：上传 2–5 张照片 → 生成一组标准形象照（正面、侧面、背面）→ 左右滑动查看。
// 生成走 POST /api/avatar/twin（后台执行，页面轮询；fal 排队时约 40–120 秒）；等待态只显示真实秒数与阶段文案，不伪造百分比。

type Gender = "female" | "male";

const SLOT_META: { slot: Slot; label: string; tip: string; required: Requirement; icon: ReactNode }[] = [
  { slot: "face", label: "正脸", tip: "正对镜头，五官清晰", required: "必传", icon: <FaceSilhouette /> },
  { slot: "front", label: "全身正面", tip: "面向镜头，头到脚入镜", required: "必传", icon: <BodyFrontSilhouette /> },
  { slot: "extra", label: "侧脸", tip: "转头 45°–90°，发型清楚", required: "选传", icon: <FaceSilhouette /> },
  { slot: "side", label: "全身侧面", tip: "转身 90°，头到脚入镜", required: "选传", icon: <BodySideSilhouette /> },
  { slot: "back", label: "半身或其他", tip: "半身、背面或其他角度", required: "选传", icon: <BodyFrontSilhouette /> },
];

const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "女" },
  { value: "male", label: "男" },
];

async function readError(res: Response | null, fallback: string) {
  if (!res) return "网络异常，请稍后再试";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

/** 阶段文案按真实经过的秒数切换（生成请求是同步的，服务端不回报进度）。 */
function phaseText(sec: number, analysis: boolean) {
  if (sec < 4) return "正在读取你的照片";
  if (analysis && sec < 16) return "正在理解你的身材与发型";
  return "正在为你拍摄标准照";
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
  const missing = !face || !front ? "先上传正脸和全身正面照" : !gender ? "选择形象性别" : null;

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
      const text = await readError(res, "生成失败，请稍后再试");
      setStartedAt(null);
      setError(text);
      return;
    }
    const next = (await res.json()) as AvatarState;
    setStartedAt(null);
    setRegenerating(false);
    onState(next); // 仍在生成时（processing）由上面的轮询接着显示等待态
    if (!(next.job?.provider === "twin" && next.job.status === "processing")) onNote("你的形象已生成");
  }

  async function removeTwin(v: TwinView) {
    if (!confirm("删除这个形象吗？照片会保留，之后可以重新生成。")) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/avatar/jobs/${v.jobId}/result`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setDeleting(false);
      setError(await readError(res, "删除失败"));
      return;
    }
    const full = await fetch("/api/avatar", { cache: "no-store" }).catch(() => null);
    setDeleting(false);
    if (full && full.ok) onState((await full.json()) as AvatarState);
    onNote("已删除这个形象，照片仍保留");
  }

  // ---- 生成中 ----
  if (generating) {
    const base = startedAt ?? resumeAt ?? resumeBase ?? now;
    const sec = Math.max(0, Math.round((now - base) / 1000));
    return (
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">正在生成你的形象</h2>
        <div className={t.wait}>
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
            <p key={phaseText(sec, analysis)} className={`${s.waitTitle} ${t.phase}`}>
              {phaseText(sec, analysis)}
            </p>
            <span className="sc-meta">已用 {sec} 秒 · 通常需要 30–60 秒</span>
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
          <h2 className="section-title">你的形象</h2>
          <span className="sc-meta">{new Date(twin.createdAt).toLocaleDateString("zh-CN")}</span>
        </div>
        <TwinGallery shots={twin.shots} />
        {twin.summary ? <p className={`serif-note ${t.summary}`}>{twin.summary}</p> : null}
        {twin.tags.length ? (
          <ul className={t.tags} aria-label="形象特征">
            {twin.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}
        <div className={s.actions}>
          <Link href="/fitting-room" className="sc-cta">
            去试穿
          </Link>
          <button
            type="button"
            className="sc-cta sc-cta--ghost"
            onClick={() => {
              setError(null);
              setRegenerating(true);
            }}
          >
            重新生成
          </button>
          <button type="button" className={s.small} onClick={() => removeTwin(twin)} disabled={deleting}>
            {deleting ? "删除中…" : "删除这个形象"}
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
      <h2 className="section-title">生成你的形象</h2>
      <p className="serif-note">上传 3–5 张照片，越全越像你。正脸和全身正面必传，全身正面照同时用于试穿。</p>

      <div className={t.grid}>
        {SLOT_META.map((m) => {
          const p = photo(m.slot);
          return (
            <PhotoTile
              key={m.slot}
              label={m.label}
              tip={m.tip}
              icon={m.icon}
              noun="照片"
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
      <span className={s.hint}>已上传 {count} / 5 张</span>

      <div className={s.choice}>
        <span className="sc-meta" id="twin-gender-label">
          形象性别
        </span>
        <div className={s.segment} role="group" aria-labelledby="twin-gender-label">
          {GENDERS.map((g) => (
            <button key={g.value} type="button" aria-pressed={gender === g.value} onClick={() => setGender(g.value)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className={s.actions}>
        <button type="button" className="sc-cta" disabled={!ready} onClick={generate}>
          {twin ? "用这些照片重新生成" : "生成我的形象"}
        </button>
        {regenerating && twin ? (
          <button type="button" className={s.small} onClick={() => setRegenerating(false)}>
            返回当前形象
          </button>
        ) : null}
        {missing ? <span className="sc-meta">{missing}</span> : null}
      </div>
      {regenerating && twin ? <p className={s.hint}>新形象生成成功后，旧的形象照会被删除。</p> : null}
      {state.job?.resultDeleted && !twin ? <p className="sc-meta">之前的形象已删除，可以重新生成。</p> : null}
      {!error && state.job?.provider === "twin" && state.job.status === "failed" ? (
        <p className="error" role="alert">
          上次生成没有完成：{state.job.error?.message ?? "生成失败"}，可以重试。
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
    <div className={t.gallery}>
      <div
        className={t.stage}
        role="group"
        aria-roledescription="轮播"
        aria-label={`你的形象照，共 ${n} 张，可左右滑动或用方向键切换`}
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
              alt={k === i ? `你的形象：${shot.label}` : ""}
              aria-hidden={k === i ? undefined : true}
              className={t.shot}
              data-state={state}
              draggable={false}
              style={k === i && dx ? { transform: `translate3d(${dx * 0.35}px,0,0)`, transition: "none" } : undefined}
            />
          );
        })}
        <span className={t.angle} aria-hidden="true">
          {shots[i]?.label}
        </span>
      </div>
      {n > 1 ? (
        <div className={t.dots}>
          {shots.map((shot, k) => (
            <button
              key={shot.url}
              type="button"
              aria-label={`查看${shot.label}`}
              aria-current={k === i ? "true" : undefined}
              onClick={() => go(k)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
