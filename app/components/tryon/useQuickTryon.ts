"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/types";
import type { TryonView } from "@/lib/tryon/service";
import { fetchView, preload, readError, sleep, waitErrors, waitFirst } from "./shared";

// 单件“一键试穿”的状态与请求（D63 / D65 两段式），商品详情页的上身效果区与浏览时的一键试穿面板共用：
// POST /api/tryon/quick 只提交到队列就返回 → 轮询到第一张图 → 预解码后展示 → 还在细化时每 2 秒查一次，清晰版好了原地替换。

// 等待节奏：衣服先由 Kolors 快出图（约 20 秒），鞋包配饰只跑 nano-banana（约 45 秒）。只是叙述，不对应真实进度，也不显示百分比。
// 文案在字典 tryon.quickStages 里，显示时用 useQuickStageText()（或 t(`quickStages.${stage.key}`)）。
export type QuickStageKey = keyof Messages["tryon"]["quickStages"];
export type QuickStage = { from: number; key: QuickStageKey };
const stage = (from: number, key: QuickStageKey): QuickStage => ({ from, key });
export const QUICK_STAGES: QuickStage[] = [stage(0, "reading"), stage(4, "dressing"), stage(12, "lighting"), stage(20, "finishing")];
export const NANO_STAGES: QuickStage[] = [stage(0, "reading"), stage(6, "dressing"), stage(22, "lighting"), stage(38, "finishing")];

/** 阶段文案（当前语言）：const stageText = useQuickStageText(); stageText(stages[stageAt(elapsed, stages)]) */
export function useQuickStageText() {
  const t = useT("tryon");
  return useCallback((s: Pick<QuickStage, "key">) => t(`quickStages.${s.key}`), [t]);
}

export function stageAt(seconds: number, stages: { from: number }[]): number {
  let i = 0;
  while (i + 1 < stages.length && seconds >= stages[i + 1].from) i++;
  return i;
}

/** 运行中每秒 +1 的计时。 */
export function useTicker(running: boolean) {
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

export type QuickTryonEvents = {
  /** 请求被接受：服务端已记下同意、底图存在。 */
  onAccepted?: () => void;
  /** 请求失败但不是“未同意 / 未登录”：服务端已在调用模型前记下同意。 */
  onConsentRecorded?: () => void;
  /** 409：还没有形象（底图被删或过期）。 */
  onNoBase?: () => void;
};

export function useQuickTryon(initial: TryonView | null = null, events: QuickTryonEvents = {}) {
  const t = useT("tryon");
  const [view, setView] = useState<TryonView | null>(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const ev = useRef(events);
  ev.current = events;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
          if (alive.current) setView((cur) => (cur?.id === id ? v : cur));
        }
        return;
      }
    } finally {
      if (alive.current) setRefining(false);
    }
  }, []);

  // 首屏带来的结果还在细化（刷新了页面）：接着轮询。
  const initialRefine = useRef(initial?.refining ? initial.id : null);
  useEffect(() => {
    if (initialRefine.current) void refine(initialRefine.current);
  }, [refine]);

  /** 把 itemId 穿到本人形象上。consent：本次一并记录同意（首次）。成功返回结果，失败返回 null（error 已设置）。 */
  const run = useCallback(
    async (itemId: string, consent: boolean): Promise<TryonView | null> => {
      if (busy.current) return null;
      busy.current = true;
      setRunning(true);
      setError(null);
      try {
        const res = await fetch("/api/tryon/quick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, consent }),
        }).catch(() => null);
        if (!res?.ok) {
          if (res && res.status !== 403 && res.status !== 401 && consent) ev.current.onConsentRecorded?.();
          if (res?.status === 409) ev.current.onNoBase?.();
          setError(await readError(res, t("errors.failed"), t("errors.network")));
          return null;
        }
        ev.current.onAccepted?.();
        // 只提交到队列就返回：轮询到出第一张图（或失败）。
        const first = await waitFirst((await res.json()) as TryonView, { alive: () => alive.current, pollMs: 1200, errors: waitErrors(t) });
        if (!alive.current) return null;
        if (first.status === "failed" || !first.resultUrl) {
          setError(first.error ?? t("errors.failed"));
          return null;
        }
        await preload(first.resultUrl);
        setView(first);
        if (first.refining) void refine(first.id);
        return first;
      } finally {
        busy.current = false;
        if (alive.current) setRunning(false);
      }
    },
    [refine, t],
  );

  return { view, setView, running, error, setError, refining, run };
}

export type QuickTryon = ReturnType<typeof useQuickTryon>;
