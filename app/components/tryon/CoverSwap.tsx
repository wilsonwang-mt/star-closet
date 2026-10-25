"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Scene from "@/components/Scene";
import { useT } from "@/lib/i18n/client";
import type { CoverState, ShotView } from "@/lib/scene/shots";
import type { TryonContext } from "@/lib/tryon/service";
import { preload, readError } from "./shared";
import TryOn, { type TryOnItem } from "./TryOn";
import s from "./CoverSwap.module.css";

// 封面「模特 / 我」（D75 方案 B）：搭配页的整页场景就是这套的封面；切到「我」时，换成本人在同一场景、同一姿势里的那张。
// - 生成需要这套已有一张整套标准试穿图（衣服以它为准）；没有时如实提示，并就地给出整套试穿（TryOn，原搭配全部单品）。
// - 每次生成扣一次当日额度；同一套只保留最新一张。结果私有，只给本人看，并标注“AI 场景示意 · 合身以标准图为准”。
// - 默认显示模特（主理人选的封面）；整套试穿完成时（seen:tryon 事件）重新读取状态。
// - 服务未开启、未迁移或接口出错时不渲染。

export default function CoverSwap({ outfitId, tryon, items }: { outfitId: string; tryon: TryonContext; items: TryOnItem[] }) {
  const tx = useT("tryon");
  const pathname = usePathname();
  const [state, setState] = useState<CoverState | null>(null);
  const [me, setMe] = useState(false);
  const [busyAt, setBusyAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // 就地整套试穿的面板开着时，即使标准图已经有了也不切换提示（否则 TryOn 被卸载，结果面板会直接消失）。
  const [lookOpen, setLookOpen] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setMounted(true);
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/scene/shots?outfitId=${encodeURIComponent(outfitId)}`, { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as CoverState | null) : null;
    if (alive.current && data) setState(data);
  }, [outfitId]);

  useEffect(() => {
    void load();
    const onTryon = (e: Event) => {
      if ((e as CustomEvent<{ outfitId?: string }>).detail?.outfitId === outfitId) void load();
    };
    window.addEventListener("seen:tryon", onTryon);
    return () => window.removeEventListener("seen:tryon", onTryon);
  }, [load, outfitId]);

  useEffect(() => {
    if (busyAt === null) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - busyAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [busyAt]);

  if (!state?.enabled) return null;

  const shot = state.shot?.imageUrl ? state.shot : null;
  const showMe = me && !!shot;
  const out = state.quota.remaining <= 0;

  async function make() {
    if (busyAt !== null) return;
    setBusyAt(Date.now());
    setError(null);
    const res = await fetch("/api/scene/shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "cover", outfitId }),
    }).catch(() => null);
    if (!alive.current) return;
    if (!res || !res.ok) {
      setError(await readError(res, tx("shots.failed"), tx("errors.network")));
      setBusyAt(null);
      return;
    }
    const { shot: made } = (await res.json()) as { shot: ShotView };
    if (made.imageUrl) await preload(made.imageUrl);
    if (!alive.current) return;
    setState((st) => (st ? { ...st, shot: made, quota: { ...st.quota, remaining: Math.max(0, st.quota.remaining - 1) } } : st));
    setBusyAt(null);
    setMe(true);
  }

  // 切到「我」但还不能显示时，说明差哪一步。
  let panel: React.ReactNode = null;
  if (me && !shot) {
    if (!state.signedIn) {
      panel = (
        <>
          <span>{tx("shots.coverSignIn")}</span>
          <Link className="sc-cta compact" href={`/login?next=${encodeURIComponent(pathname)}`}>
            {tx("shots.signIn")}
          </Link>
        </>
      );
    } else if (!state.hasBase) {
      panel = (
        <>
          <span>{tx("shots.coverNoAvatar")}</span>
          <Link className="sc-cta compact" href="/profile/avatar">
            {tx("shots.createAvatar")}
          </Link>
        </>
      );
    } else if (!state.standard || lookOpen) {
      panel = (
        <>
          <span>{tx("shots.coverNeedLook")}</span>
          <TryOn ctx={tryon} source={{ outfitId }} items={items} primary onOpenChange={setLookOpen} />
        </>
      );
    } else {
      panel = (
        <>
          <span>{busyAt !== null ? tx("shots.coverRunning", { sec: seconds }) : out ? tx("shots.none") : tx("shots.coverHint")}</span>
          <button type="button" className="sc-cta compact" disabled={busyAt !== null || out} aria-busy={busyAt !== null} onClick={() => void make()}>
            {tx("shots.coverMake")}
          </button>
          {!out && busyAt === null ? <span className="sc-meta">{tx("shots.left", { n: state.quota.remaining })}</span> : null}
        </>
      );
    }
  }

  return (
    <div className={s.wrap}>
      <div className={s.row}>
        <div className={`sc-glass ${s.seg}`} role="group" aria-label={tx("shots.switchLabel")}>
          <button type="button" className={s.segBtn} aria-pressed={!me} onClick={() => setMe(false)}>
            {tx("shots.model")}
          </button>
          <button type="button" className={s.segBtn} aria-pressed={me} onClick={() => setMe(true)}>
            {tx("shots.me")}
          </button>
        </div>
        {showMe ? (
          <span className={s.badge}>
            {tx("shots.badge")}
            {state.standard && !out ? (
              <button type="button" className="link-btn" disabled={busyAt !== null} onClick={() => void make()}>
                {busyAt !== null ? tx("shots.coverRunning", { sec: seconds }) : tx("shots.coverAgain")}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {panel ? (
        <div className={`sc-glass ${s.panel}`} aria-live="polite">
          {panel}
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {/* 本人的场景图铺成整页场景，盖在原封面之上（同一层级、后渲染者在上）；切回模特时淡出 */}
      {mounted && shot
        ? createPortal(
            <div className={s.layer} data-on={showMe} aria-hidden="true">
              <Scene dim cover={shot.imageUrl} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
