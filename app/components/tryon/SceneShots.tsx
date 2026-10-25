"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { POSE_IDS, type PoseId } from "@/lib/scene/poses";
import type { SceneId } from "@/lib/scene/scenes";
import type { ShotQuota, ShotsState, ShotView } from "@/lib/scene/shots";
import { readError } from "./shared";
import s from "./SceneShots.module.css";

// 场景与姿势（D75 方案 A）：在一张已完成的标准试穿图下方，选「场景 × 姿势」生成一张静态图。
// - 标准图永远排第一、默认选中；场景图只是示意，统一标注“合身以标准图为准”（由父组件在大图上显示）。
// - 一次只生成一张（服务端每人同时只允许一张，429）；每张扣一次当日额度，剩余次数来自服务端。
// - 服务未开启、未迁移或接口出错时整块不渲染，不影响试穿本身。
// 父组件负责大图：onSelect 传回选中的场景图（null 为标准图）。

const SCENE_IDS: readonly SceneId[] = ["cafe", "street", "wedding", "gallery", "seaside", "market"];

export type ShotSelection = Pick<ShotView, "id" | "imageUrl" | "sceneId" | "pose"> | null;

export default function SceneShots({
  tryonId,
  standardUrl,
  selectedId,
  onSelect,
  onBusy,
}: {
  tryonId: string;
  standardUrl: string;
  selectedId: string | null;
  onSelect: (shot: ShotSelection) => void;
  /** 生成中时通知父组件（例如锁住删除按钮）。 */
  onBusy?: (busy: boolean) => void;
}) {
  const tx = useT("tryon");
  const [state, setState] = useState<{ enabled: boolean; quota: ShotQuota; shots: ShotView[] } | null>(null);
  const [scene, setScene] = useState<SceneId>("cafe");
  const [pose, setPose] = useState<PoseId>("sit");
  const [busy, setBusy] = useState<{ scene: SceneId; pose: PoseId; startedAt: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let off = false;
    setState(null);
    fetch(`/api/scene/shots?tryonId=${encodeURIComponent(tryonId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ShotsState>) : null))
      .catch(() => null)
      .then((d) => {
        if (!off && d) setState({ enabled: d.enabled, quota: d.quota, shots: d.shots.filter((x) => x.status === "succeeded" && x.imageUrl) });
      });
    return () => {
      off = true;
    };
  }, [tryonId]);

  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - busy.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => onBusy?.(!!busy), [busy, onBusy]);

  if (!state?.enabled) return null;

  const sceneName = (id: string | null) => (id && (SCENE_IDS as readonly string[]).includes(id) ? tx(`shots.scenes.${id as SceneId}`) : "");
  const poseName = (id: string | null) => (id && (POSE_IDS as readonly string[]).includes(id) ? tx(`shots.poses.${id as PoseId}`) : "");
  const existing = state.shots.find((x) => x.sceneId === scene && x.pose === pose);
  const names = { scene: sceneName(scene), pose: poseName(pose) };
  const out = state.quota.remaining <= 0;

  async function generate() {
    if (busy || out) return;
    const job = { scene, pose, startedAt: Date.now() };
    setBusy(job);
    setError(null);
    const res = await fetch("/api/scene/shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "pose", tryonId, sceneId: job.scene, pose: job.pose }),
    }).catch(() => null);
    if (!alive.current) return;
    if (!res || !res.ok) {
      const msg = await readError(res, tx("shots.failed"), tx("errors.network"));
      setError(msg);
      if (res?.status === 429 && /次数|limit/i.test(msg)) setState((st) => (st ? { ...st, quota: { ...st.quota, remaining: 0 } } : st));
      setBusy(null);
      return;
    }
    const { shot } = (await res.json()) as { shot: ShotView };
    setState((st) =>
      st
        ? {
            ...st,
            quota: { ...st.quota, remaining: Math.max(0, st.quota.remaining - 1) },
            shots: [...st.shots.filter((x) => !(x.sceneId === shot.sceneId && x.pose === shot.pose)), shot],
          }
        : st,
    );
    setBusy(null);
    onSelect(shot);
  }

  return (
    <section className={s.wrap} aria-labelledby={`shots-${tryonId}`}>
      <div className={s.head}>
        <h3 id={`shots-${tryonId}`} className={s.title}>
          {tx("shots.title")}
        </h3>
        <span className="sc-meta">{out ? tx("shots.none") : tx("shots.left", { n: state.quota.remaining })}</span>
      </div>

      <ol className={s.strip} aria-label={tx("shots.stripLabel")}>
        <li>
          <button type="button" className={s.tile} aria-pressed={selectedId === null} onClick={() => onSelect(null)}>
            <span className={s.tileImg}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={standardUrl} alt="" />
            </span>
            <span className={s.tileCap}>{tx("shots.standard")}</span>
          </button>
        </li>
        {state.shots.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              className={s.tile}
              aria-pressed={selectedId === x.id}
              aria-label={tx("shots.alt", { scene: sceneName(x.sceneId), pose: poseName(x.pose) })}
              onClick={() => onSelect(x)}
            >
              <span className={s.tileImg}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={x.imageUrl!} alt="" />
              </span>
              <span className={s.tileCap}>
                {sceneName(x.sceneId)} · {poseName(x.pose)}
              </span>
            </button>
          </li>
        ))}
        {busy ? (
          <li aria-hidden="true">
            <span className={s.tile}>
              <span className={`${s.tileImg} ${s.tilePending} adapt-scan`} />
              <span className={s.tileCap}>{tx("shots.pending")}</span>
            </span>
          </li>
        ) : null}
      </ol>

      <div className={s.group} role="group" aria-label={tx("shots.sceneLabel")}>
        <span className={s.groupLabel} aria-hidden="true">
          {tx("shots.sceneLabel")}
        </span>
        {SCENE_IDS.map((id) => (
          <button key={id} type="button" className={`chip ${s.chip}`} aria-pressed={scene === id} disabled={!!busy} onClick={() => setScene(id)}>
            {sceneName(id)}
          </button>
        ))}
      </div>
      <div className={s.group} role="group" aria-label={tx("shots.poseLabel")}>
        <span className={s.groupLabel} aria-hidden="true">
          {tx("shots.poseLabel")}
        </span>
        {POSE_IDS.map((id) => (
          <button key={id} type="button" className={`chip ${s.chip}`} aria-pressed={pose === id} disabled={!!busy} onClick={() => setPose(id)}>
            {poseName(id)}
          </button>
        ))}
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={s.foot}>
        <button type="button" className="sc-cta compact" disabled={!!busy || out} aria-busy={!!busy} onClick={() => void generate()}>
          {busy ? tx("shots.running", { sec: seconds }) : existing ? tx("shots.again", names) : tx("shots.generate", names)}
        </button>
        <span className={`sc-meta ${s.note}`}>{tx("shots.eta")}</span>
      </div>
    </section>
  );
}
