"use client";

import { useEffect, useRef, useState } from "react";
import type { AvatarState } from "@/lib/avatar/service";
import { creatorUrl, exportMessage, parseMpMessage, setupMessages } from "@/lib/avatar/metaperson-protocol";
import s from "./AvatarStudio.module.css";

// 嵌入 MetaPerson 创建器：用户在其中上传自拍、生成形象；可导出时显示本站主按钮「保存为我的 3D 形象」，
// 收到 model_exported 后把导出地址交给 /api/avatar/metaperson/import，由服务端下载转存。
// 令牌从 /api/avatar/metaperson/token 获取，只把 accessToken 发给创建器。

type Phase = "loading" | "ready" | "exporting" | "importing" | "error";

async function readError(res: Response | null, fallback: string) {
  if (!res) return "网络异常，请稍后再试";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export default function MetaPersonCreator({ onImported }: { onImported: (state: AvatarState) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<{ url: string; mobile: boolean } | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  // 导出可用：收到 action_availability_changed(avatar_export) 为准；手机版若不发该事件，以 model_generated 为准。
  const [canExport, setCanExport] = useState(false);
  const target = useRef<{ win: MessageEventSource; origin: string } | null>(null);
  const token = useRef<string | null>(null);
  const loadedPending = useRef(false);
  const sawAvailability = useRef(false);
  const importing = useRef(false);
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;

  useEffect(() => {
    const chosen = creatorUrl(window.innerWidth);
    setSrc(chosen);
    let alive = true;

    const post = (msg: Record<string, unknown>) => {
      const t = target.current;
      if (t) (t.win as Window).postMessage(msg, t.origin);
    };
    const setup = () => {
      if (!token.current || !target.current) return;
      loadedPending.current = false;
      for (const m of setupMessages(token.current, chosen.mobile)) post(m);
      setPhase((p) => (p === "loading" ? "ready" : p));
    };

    fetch("/api/avatar/metaperson/token", { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) {
          setError(await readError(res, "无法连接 MetaPerson，请稍后再试"));
          setPhase("error");
          return;
        }
        const body = (await res.json()) as { accessToken: string };
        token.current = body.accessToken;
        if (loadedPending.current) setup();
      })
      .catch(() => {
        if (!alive) return;
        setError("网络异常，请稍后再试");
        setPhase("error");
      });

    async function importExport(url: string, avatarCode: string) {
      if (exportTimer.current) clearTimeout(exportTimer.current);
      if (importing.current) return;
      importing.current = true;
      setPhase("importing");
      setError(null);
      const res = await fetch("/api/avatar/metaperson/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, avatarCode }),
      }).catch(() => null);
      importing.current = false;
      if (!alive) return;
      if (!res || !res.ok) {
        setError(await readError(res, "保存失败，请重试"));
        setPhase("ready");
        return;
      }
      onImportedRef.current((await res.json()) as AvatarState);
    }

    function onMessage(evt: MessageEvent) {
      // 只接受当前 iframe 发来的、来源在白名单内且 data.source 正确的消息。
      if (!frame.current || evt.source !== frame.current.contentWindow || !evt.source) return;
      const e = parseMpMessage(evt.origin, evt.data);
      if (!e) return;
      switch (e.eventName) {
        case "metaperson_creator_loaded":
          target.current = { win: evt.source, origin: evt.origin };
          loadedPending.current = true;
          setup();
          break;
        case "authentication_status":
          if (!e.isAuthenticated) {
            setError("MetaPerson 认证失败，请刷新页面重试");
            setPhase("error");
          }
          break;
        case "model_generated":
          if (!sawAvailability.current) setCanExport(true);
          break;
        case "action_availability_changed":
          if (e.actionName === "avatar_export") {
            sawAvailability.current = true;
            setCanExport(e.isAvailable);
          }
          break;
        case "model_exported":
          void importExport(e.url, e.avatarCode);
          break;
      }
    }

    window.addEventListener("message", onMessage);
    return () => {
      alive = false;
      if (exportTimer.current) clearTimeout(exportTimer.current);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  function save() {
    const t = target.current;
    if (!t || !canExport) return;
    setError(null);
    setPhase("exporting");
    (t.win as Window).postMessage(exportMessage(), t.origin);
    // 导出长时间没有回应时恢复按钮，允许重试。
    if (exportTimer.current) clearTimeout(exportTimer.current);
    exportTimer.current = setTimeout(() => {
      if (importing.current) return;
      setPhase((p) => (p === "exporting" ? "ready" : p));
      setError("导出没有响应，请重试");
    }, 120_000);
  }

  const busy = phase === "exporting" || phase === "importing";

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className={s.creator} data-loading={phase === "loading" || undefined}>
        {src ? (
          <iframe
            ref={frame}
            src={src.url}
            title="MetaPerson 形象创建器"
            allow="fullscreen"
            className={s.creatorFrame}
          />
        ) : null}
        {phase === "loading" ? (
          <div className={s.creatorSkeleton} role="status" aria-live="polite">
            <span className={s.creatorFigure} aria-hidden="true" />
            <span className="sc-meta">正在打开形象创建器…</span>
          </div>
        ) : null}
        {phase === "importing" ? (
          <div className={s.creatorBusy} role="status" aria-live="polite">
            <div className="wait-bar" aria-hidden="true" style={{ width: 160 }}>
              <i />
            </div>
            <span className="sc-meta">正在保存你的 3D 形象…</span>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {phase !== "error" ? (
        <div className={s.actions}>
          <button type="button" className="sc-cta" disabled={!canExport || busy || phase === "loading"} onClick={save}>
            {phase === "exporting" ? "正在导出…" : phase === "importing" ? "保存中…" : "保存为我的 3D 形象"}
          </button>
          {!canExport && phase === "ready" ? <span className="sc-meta">在上方上传一张自拍，生成后即可保存。</span> : null}
        </div>
      ) : null}
    </div>
  );
}
