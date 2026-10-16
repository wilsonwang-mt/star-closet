"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TryonContext, TryonView } from "@/lib/tryon/service";
import { compress, preload, readError } from "./shared";

// 试衣间一套搭配的逐件试穿状态。放在 LookCard 里（而不是面板里）：生成途中关掉面板也不丢，
// 穿好后卡片上的单品直接标“已穿上”。
// - frames：这套搭配上本人成功的试穿结果，按先后排列（服务端首屏带来，之后本地追加 / 移除）。
// - selectedId：正在看的那张（null 为本人正面照）。下一件就穿在正在看的这张上；默认是最新一张。
// - pending：正在穿的那一件；同一套同一时间只穿一件。

export type Pending = { itemId: string; baseId: string | null; startedAt: number };

/** 结果来得太快（如本地拦截）时也留出一点等待，过渡不显得突兀。 */
const MIN_WAIT_MS = 900;

export function useLookTryon({ lookId, ctx, initial }: { lookId: string; ctx?: TryonContext; initial?: TryonView[] }) {
  const enabled = !!ctx?.enabled && !!ctx?.signedIn;
  const [frames, setFrames] = useState<TryonView[]>(() => (initial ?? []).filter((f) => !!f.resultUrl));
  const [selectedId, setSelectedId] = useState<string | null>(() => frames.at(-1)?.id ?? null);
  // photoUrl：试穿底图（数字分身正面照优先，否则正面全身照，D63）。
  const [photoUrl, setPhotoUrl] = useState<string | null>(ctx?.frontPhotoUrl ?? null);
  const [baseSource, setBaseSource] = useState<"twin" | "photo" | null>(ctx?.baseSource ?? null);
  const isTwin = baseSource === "twin";
  const providerName = ctx?.providerName ?? "fal.ai（可灵 Kolors）";
  const [consented, setConsented] = useState(!!ctx?.consented);
  const [agree, setAgree] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** 刚穿好的那张：卡片上的“已穿上”只对它做一次入场动画。 */
  const [fresh, setFresh] = useState<string | null>(null);
  const busy = useRef(false);

  const selected = useMemo(() => frames.find((f) => f.id === selectedId) ?? null, [frames, selectedId]);
  const wornIds = useMemo(() => new Set(selected?.appliedItemIds ?? []), [selected]);

  // 选中的那张被删掉或加载失败后：退回最新一张（没有就回到正面照）。
  useEffect(() => {
    if (selectedId && !frames.some((f) => f.id === selectedId)) setSelectedId(frames.at(-1)?.id ?? null);
  }, [frames, selectedId]);

  /** 底图就绪：穿在某张结果上不需要正面照；穿在照片上需要先有照片。 */
  const hasBase = selectedId !== null || !!photoUrl;
  const canAutoStart = hasBase && consented && !uploading;

  const run = useCallback(
    async (itemId: string) => {
      if (busy.current) return;
      busy.current = true;
      const baseId = selectedId;
      const started = Date.now();
      setPending({ itemId, baseId, startedAt: started });
      setQueued(null);
      setError(null);
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookId, itemIds: [itemId], ...(baseId ? { baseTryonId: baseId } : {}), consent: !consented && agree }),
      }).catch(() => null);
      try {
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
          return;
        }
        const view = (await res.json()) as TryonView;
        setConsented(true);
        if (view.resultUrl) await preload(view.resultUrl);
        const wait = MIN_WAIT_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        setFrames((f) => [...f, view]);
        setSelectedId(view.id);
        setFresh(view.id);
      } finally {
        setPending(null);
        busy.current = false;
      }
    },
    [agree, consented, lookId, selectedId],
  );

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
      await preload(url);
      setPhotoUrl(url);
      setBaseSource("photo");
      setSelectedId(null);
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
