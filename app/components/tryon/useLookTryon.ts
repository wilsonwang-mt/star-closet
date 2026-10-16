"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wearableInOrder, type PlanItem } from "@/lib/tryon/plan";
import type { TryonContext, TryonStage, TryonView } from "@/lib/tryon/service";
import { compress, fetchView, pollDelay, preload, readError, sleep, waitFirst } from "./shared";

// 试衣间一套搭配的逐件试穿状态。放在 LookCard 里（而不是面板里）：生成途中关掉面板也不丢，
// 穿好后卡片上的单品直接标“已穿上”。
// - frames：这套搭配上本人成功的试穿结果，按先后排列（服务端首屏带来，之后本地追加 / 移除 / 细化后替换）。
// - selectedId：正在看的那张（null 为本人正面照）。下一件就穿在正在看的这张上；默认是最新一张。
// - pending：正在穿的那一件（还没出第一张图）；同一套同一时间只穿一件。出图后在后台等细化，不挡下一件。
// - 两段式（D62）：先出 performance 的一张，quality 好了以后同一张原地换成清晰的；界面写“正在细化”。
// - 预热：本次上传正面照、且已同意后，先跑这一套里要穿的那件（只跑 performance），点“穿上”时命中缓存。

/** 整套试穿（D67）：按建议顺序把这一套可上身的单品依次穿上，上一步的结果作下一步的底图。 */
export type Chain = { step: number; total: number; itemId: string; itemIds: string[] };

export type Pending = { itemId: string; baseId: string | null; startedAt: number; stage: TryonStage | "sending"; queuePosition: number | null };

/** 结果来得太快（如命中缓存）时也留出一点等待，过渡不显得突兀。 */
const MIN_WAIT_MS = 600;
const REFINE_POLL_MS = 1500;

/** 已出图、还要等细化：细化前是 performance 的一张，或服务端明确说还在细化。 */
const needsRefine = (v: TryonView) => v.refining || (v.kind === "item" && v.mode === "performance" && v.status === "succeeded");

export function useLookTryon({ lookId, ctx, initial, items }: { lookId: string; ctx?: TryonContext; initial?: TryonView[]; items?: PlanItem[] }) {
  const enabled = !!ctx?.enabled && !!ctx?.signedIn;
  const [frames, setFrames] = useState<TryonView[]>(() => (initial ?? []).filter((f) => !!f.resultUrl));
  const [selectedId, setSelectedId] = useState<string | null>(() => frames.at(-1)?.id ?? null);
  // photoUrl：试穿底图（数字分身正面照优先，否则正面全身照，D63）。
  const [photoUrl, setPhotoUrl] = useState<string | null>(ctx?.frontPhotoUrl ?? null);
  const [baseSource, setBaseSource] = useState<"twin" | "photo" | null>(ctx?.baseSource ?? null);
  const isTwin = baseSource === "twin";
  const providerName = ctx?.providerName ?? "fal.ai 上的 AI 模型";
  const [consented, setConsented] = useState(!!ctx?.consented);
  const [agree, setAgree] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [open, setOpen] = useState(false);
  /** 刚穿好的那张：卡片上的“已穿上”只对它做一次入场动画。 */
  const [fresh, setFresh] = useState<string | null>(null);
  /** 本次会话里刚上传的正面照（预热只对它做一次）。 */
  const [freshPhoto, setFreshPhoto] = useState<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const refiningIds = useRef(new Set<string>());
  const prewarmedFor = useRef<string | null>(null);
  /** 预热请求：posted 在服务端写好记录后完成（之后同一件的试穿请求才能命中）。 */
  const prewarmTask = useRef<{ itemId: string; posted: Promise<void> } | null>(null);
  /** 预热静默轮询拿到的第一张（data URI），点“穿上”时直接用，不再下载。 */
  const instant = useRef(new Map<string, TryonView>());
  /** 已经由“穿上”接手轮询的记录：预热的静默轮询让出。 */
  const claimed = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selected = useMemo(() => frames.find((f) => f.id === selectedId) ?? null, [frames, selectedId]);
  const wornIds = useMemo(() => new Set(selected?.appliedItemIds ?? []), [selected]);

  // 选中的那张被删掉或加载失败后：退回最新一张（没有就回到正面照）。
  useEffect(() => {
    if (selectedId && !frames.some((f) => f.id === selectedId)) setSelectedId(frames.at(-1)?.id ?? null);
  }, [frames, selectedId]);

  /** 后台等细化：好了以后把同一张换成清晰的（id 不变，舞台原地交叉淡入）。 */
  const refine = useCallback((id: string) => {
    if (refiningIds.current.has(id)) return;
    refiningIds.current.add(id);
    void (async () => {
      let misses = 0;
      let lastMs = 0;
      try {
        while (alive.current) {
          await sleep(pollDelay(REFINE_POLL_MS, lastMs));
          if (!alive.current) return;
          const startedAt = Date.now();
          const r = await fetchView(id);
          lastMs = Date.now() - startedAt;
          if (r.kind === "gone") {
            setFrames((f) => f.filter((x) => x.id !== id));
            return;
          }
          if (r.kind === "error") {
            if (++misses >= 5) return;
            continue;
          }
          misses = 0;
          const v = r.view;
          if (v.refining || v.status === "processing") continue;
          // 细化失败时服务端保留快速出的那张（mode 仍是 performance），不必换图。
          if (v.mode !== "quality" || !v.resultUrl) {
            setFrames((f) => f.map((x) => (x.id === id ? { ...x, refining: false, stage: v.stage } : x)));
            return;
          }
          await preload(v.resultUrl);
          if (!alive.current) return;
          setFrames((f) => f.map((x) => (x.id === id ? v : x)));
          return;
        }
      } finally {
        refiningIds.current.delete(id);
      }
    })();
  }, []);

  // 服务端首屏带来的、还在细化的结果：接着等。
  const initialRefining = useRef(frames.filter((f) => f.refining).map((f) => f.id));
  useEffect(() => {
    for (const id of initialRefining.current) refine(id);
  }, [refine]);

  /** 底图就绪：穿在某张结果上不需要正面照；穿在照片上需要先有照片。 */
  const hasBase = selectedId !== null || !!photoUrl;
  /** 整套试穿等形象或同意就绪：面板里显示“整套试穿”开始按钮。 */
  const [chainReady, setChainReady] = useState<string[] | null>(null);
  const hasBaseRef = useRef(false);
  hasBaseRef.current = !!photoUrl;
  const consentedRef = useRef(consented);
  consentedRef.current = consented;
  const agreeRef = useRef(agree);
  agreeRef.current = agree;
  const canAutoStart = hasBase && consented && !uploading;

  const run = useCallback(
    async (itemId: string, baseOverride?: string | null): Promise<TryonView | null> => {
      if (busy.current) return null;
      busy.current = true;
      const baseId = baseOverride !== undefined ? baseOverride : selectedId;
      const started = Date.now();
      setPending({ itemId, baseId, startedAt: started, stage: "sending", queuePosition: null });
      setQueued(null);
      setError(null);
      try {
        // 同一件的预热请求还在路上：等它写好记录，下面的请求才能命中缓存，不会重复生成。
        if (!baseId && prewarmTask.current?.itemId === itemId) await prewarmTask.current.posted;
        const res = await fetch("/api/tryon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookId, itemIds: [itemId], ...(baseId ? { baseTryonId: baseId } : {}), consent: !consented && agree }),
        }).catch(() => null);
        if (!res || !res.ok) {
          const message = await readError(res, "试穿失败，请稍后再试");
          // 服务端在调用 FASHN 之前就记下了同意：只要不是“未同意”，下次不用再勾。
          if (res && res.status !== 403 && res.status !== 401 && agree) setConsented(true);
          if (res?.status === 404 && baseId) setFrames((f) => f.filter((x) => x.id !== baseId));
          if (res?.status === 409 && !baseId) {
            setPhotoUrl(null);
            setBaseSource(null);
          }
          setError(message);
          setQueued(itemId);
          return null;
        }
        let view = (await res.json()) as TryonView;
        setConsented(true);
        claimed.current.add(view.id);
        const onStage = (v: TryonView) => setPending((p) => (p ? { ...p, stage: v.stage, queuePosition: v.queuePosition } : p));
        // 预热已经拿到第一张：直接用。
        const early = instant.current.get(view.id);
        if (early?.resultUrl && view.status !== "failed") {
          view = { ...view, status: "succeeded", resultUrl: early.resultUrl, mode: early.mode, stage: view.refining ? "refining" : view.stage };
        }
        if (!view.resultUrl && view.status === "processing") {
          onStage(view);
          view = await waitFirst(view, { alive: () => alive.current, onStage });
        }
        if (!alive.current) return null;
        if (view.status === "failed" || !view.resultUrl) {
          setError(view.error ?? "试穿失败，请稍后再试");
          setQueued(itemId);
          return null;
        }
        await preload(view.resultUrl);
        const wait = MIN_WAIT_MS - (Date.now() - started);
        if (wait > 0) await sleep(wait);
        const shown = view;
        // 命中缓存时可能是已有的一张：原地更新并选中，不重复追加。
        setFrames((f) => (f.some((x) => x.id === shown.id) ? f.map((x) => (x.id === shown.id ? shown : x)) : [...f, shown]));
        setSelectedId(shown.id);
        setFresh(shown.id);
        if (needsRefine(shown)) refine(shown.id);
        return shown;
      } finally {
        setPending(null);
        busy.current = false;
      }
    },
    [agree, consented, lookId, refine, selectedId],
  );

  const runRef = useRef(run);
  runRef.current = run;

  /** 预热：只跑这一件的 performance；结果先留在本地，不进穿搭进度，等用户点“穿上”。 */
  const prewarm = useCallback(
    (itemId: string) => {
      let markPosted = () => {};
      const posted = new Promise<void>((r) => (markPosted = r));
      prewarmTask.current = { itemId, posted };
      void (async () => {
        const res = await fetch("/api/tryon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lookId, itemIds: [itemId], prewarm: true, consent: !consented && agree }),
        }).catch(() => null);
        markPosted();
        if (!res?.ok) return;
        setConsented(true);
        const view = (await res.json()) as TryonView;
        const got = await waitFirst(view, { alive: () => alive.current && !claimed.current.has(view.id), pollMs: 1000 });
        if (got.resultUrl) {
          instant.current.set(got.id, got);
          void preload(got.resultUrl);
        }
      })();
    },
    [agree, consented, lookId],
  );

  // 正面照刚上传、且已同意：在用户点“穿上”之前先跑要穿的那一件（点了“试穿这件”的那件，否则按建议顺序的第一件）。
  const firstPiece = useMemo(() => wearableInOrder(items ?? [])[0]?.item.id ?? null, [items]);
  useEffect(() => {
    if (!enabled || !freshPhoto || prewarmedFor.current === freshPhoto || !(consented || agree) || pending || selectedId !== null) return;
    const target = queued ?? firstPiece;
    if (!target) return;
    prewarmedFor.current = freshPhoto;
    prewarm(target);
  }, [agree, consented, enabled, firstPiece, freshPhoto, pending, prewarm, queued, selectedId]);

  /** “试穿这件”：打开面板；底图与同意都已就绪时直接开始，否则先在面板里补上照片或同意。 */
  const tryItem = useCallback(
    (itemId: string) => {
      if (!enabled || busy.current) return;
      setOpen(true);
      setError(null);
      if (canAutoStart) void run(itemId);
      else setQueued(itemId);
    },
    [canAutoStart, enabled, run],
  );

  /**
   * 整套试穿：从本人形象开始，按建议顺序（内搭 / 连衣裙 → 下装 → 外套）一件一件穿上，
   * 每一步都是逐件试穿（baseTryonId 链式），穿搭进度里可以左右回看每一步。中途失败就停下，已穿好的保留。
   */
  const wearAll = useCallback(async () => {
    if (!enabled || busy.current) return;
    const ids = wearableInOrder(items ?? []).map((x) => x.item.id);
    if (!ids.length) return;
    setOpen(true);
    setError(null);
    if (!(hasBaseRef.current && (consentedRef.current || agreeRef.current))) {
      // 形象或同意还没就绪：先在面板里补上，再点“整套试穿”。
      setQueued(null);
      setChainReady(ids);
      return;
    }
    let base: string | null = null;
    for (let i = 0; i < ids.length; i++) {
      if (!alive.current) break;
      setChain({ step: i + 1, total: ids.length, itemId: ids[i], itemIds: ids });
      const v: TryonView | null = await runRef.current(ids[i], base);
      if (!v) break;
      base = v.id;
    }
    setChain(null);
    setChainReady(null);
  }, [enabled, items]);

  const startQueued = useCallback(() => {
    if (queued && hasBase && (consented || agree) && !uploading) void run(queued);
  }, [agree, consented, hasBase, queued, run, uploading]);

  const select = useCallback((id: string | null) => {
    if (busy.current) return;
    setSelectedId(id);
    setError(null);
  }, []);

  /** 加载失败的结果图（文件已被清理）：只从本地进度里拿掉。 */
  const drop = useCallback((id: string) => setFrames((f) => f.filter((x) => x.id !== id)), []);

  const remove = useCallback(
    async (id: string) => {
      if (busy.current) return;
      const res = await fetch(`/api/tryon/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
      if (!res || (!res.ok && res.status !== 404)) {
        setError(await readError(res, "删除失败，请稍后再试"));
        return;
      }
      setError(null);
      const idx = frames.findIndex((x) => x.id === id);
      const gone = frames[idx];
      const next = frames.filter((x) => x.id !== id);
      setFrames(next);
      // 删掉正在看的那张：回到它的底图（还在的话），否则前一张，否则正面照。
      if (selectedId === id) {
        const back = gone?.baseTryonId && next.some((x) => x.id === gone.baseTryonId) ? gone.baseTryonId : (next[idx - 1]?.id ?? null);
        setSelectedId(back);
      }
    },
    [frames, selectedId],
  );

  const upload = useCallback(async (file: File | undefined) => {
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
      const url = `${data.frontPhotoUrl}?v=${Date.now()}`;
      // 先预热（不等照片回读），再显示照片。
      setSelectedId(null);
      setFreshPhoto(url);
      await preload(url);
      setPhotoUrl(url);
      setBaseSource("photo");
    } finally {
      setUploading(false);
    }
  }, []);

  const openPanel = useCallback(() => {
    if (enabled) setOpen(true);
  }, [enabled]);
  const close = useCallback(() => {
    setOpen(false);
    if (!busy.current) {
      setQueued(null);
      setError(null);
    }
  }, []);

  return {
    enabled,
    chain,
    chainReady,
    wearAll,
    lookId,
    frames,
    selectedId,
    selected,
    wornIds,
    photoUrl,
    isTwin,
    providerName,
    consented,
    agree,
    setAgree,
    uploading,
    pending,
    queued,
    error,
    open,
    fresh,
    hasBase,
    tryItem,
    startQueued,
    select,
    drop,
    remove,
    upload,
    openPanel,
    close,
  };
}

export type LookTryon = ReturnType<typeof useLookTryon>;
