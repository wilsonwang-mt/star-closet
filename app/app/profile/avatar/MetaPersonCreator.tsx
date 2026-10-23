"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { AvatarState } from "@/lib/avatar/service";
import {
  creatorUrl,
  exportMessage,
  fallbackUiMessage,
  generateAvatarMessage,
  idleExportParamsMessage,
  mpGenderOf,
  parseMpMessage,
  setupMessages,
  type MpGender,
} from "@/lib/avatar/metaperson-protocol";
import { engineProgress, flowReducer, initialFlow, msUntilFallback, shouldSend, type FlowPhase } from "@/lib/avatar/metaperson-flow";
import { useT } from "@/lib/i18n/client";
import s from "./AvatarStudio.module.css";

// 嵌入 MetaPerson 创建器（D56）：
// - 挂载即开始预加载：iframe 放在 document.body 的浮层里，隐藏时固定在视口内（opacity 0、不可交互、inert），
//   不放进玻璃卡里——卡片的 backdrop-filter 会改变 fixed 的定位基准，移出视口的跨域 iframe 会被浏览器节流，拖慢加载。
//   显示时把同一个浮层对齐到卡片里的“舞台”占位（只改样式，不移动节点，iframe 不会重新加载）。
// - 父组件给出生成请求（正脸照 base64 + 性别 + 体型参数）后，引擎就绪即发送 generate_avatar；
//   等待期间舞台上是本站自己的等待态，收到 model_generated 再淡入创建器供用户微调。
// - 兜底：generate_avatar 发出 90 秒没有 model_generated，或认证失败，直接显示创建器原生界面并放回“选择照片”按钮。
// - 可导出时显示「保存为我的 3D 形象」，收到 model_exported 后交给 /api/avatar/metaperson/import 由服务端下载转存。
// 令牌从 /api/avatar/metaperson/token 获取，只把 accessToken 发给创建器。

export type CreatorPayload = { gender: MpGender; image: string; blends: Partial<Record<string, number>> | null };
/** id 每次点击生成时递增；payload 为 null 表示照片还在准备。 */
export type CreatorRequest = { id: number; payload: CreatorPayload | null };
export type EngineState = "loading" | "ready" | "error";

/** 认证结果迟迟不来时，setup 发出后多久视为可以生成。 */
const AUTH_GRACE_MS = 8000;

async function readError(res: Response | null, fallback: string, offline: string) {
  if (!res) return offline;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

type Box = { top: number; left: number; width: number; height: number };

/** 把舞台（含上方主按钮）滚进视口：放得下就居中，放不下就顶部对齐（留出悬浮导航的高度）。返回取消函数。 */
function revealStage(el: HTMLElement | null): () => void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
      if (r.height <= window.innerHeight - 96) el.scrollIntoView({ behavior, block: "center" });
      else window.scrollTo({ top: window.scrollY + r.top - 80, behavior });
    });
  });
  return () => cancelAnimationFrame(raf);
}
type Target = { win: MessageEventSource; origin: string } | null;

/** 只回发给创建器自己的来源。 */
function postTo(t: Target, msg: Record<string, unknown> | null) {
  if (t && msg) (t.win as Window).postMessage(msg, t.origin);
}

export default function MetaPersonCreator({
  request,
  stillUrl,
  summary,
  onPhase,
  onImported,
}: {
  request: CreatorRequest | null;
  /** 等待态里被光扫过的那张照片（本人全身正面照或正脸照，同源私有地址） */
  stillUrl: string | null;
  /** 体型概括（可空），显示在等待态与生成结果下方 */
  summary: string | null;
  onPhase?: (phase: FlowPhase, engine: EngineState) => void;
  onImported: (state: AvatarState) => void;
}) {
  const tr = useT("avatar");
  const tc = useT("common");
  // 挂载时注册的消息与请求回调读最新的翻译函数（切换语言后不用重建 iframe）。
  const trRef = useRef({ tr, tc });
  trRef.current = { tr, tc };
  const frame = useRef<HTMLIFrameElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  // 主按钮 + 舞台的外层：滚动定位以它为准，让“保存”按钮与创建器同屏可见。
  const stageWrap = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<{ url: string; mobile: boolean } | null>(null);
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [engineError, setEngineError] = useState(false);
  const [busy, setBusy] = useState<"exporting" | "importing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 导出可用：收到 action_availability_changed(avatar_export) 为准；手机版若不发该事件，以 model_generated 为准。
  const [canExport, setCanExport] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [box, setBox] = useState<Box | null>(null);
  const target = useRef<Target>(null);
  const token = useRef<string | null>(null);
  const loadedPending = useRef(false);
  const sawAvailability = useRef(false);
  const importing = useRef(false);
  const exportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const importedUrl = useRef<string | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 形象性别：发出 generate_avatar 时取请求里的，model_generated 带回的为准（用户可能在创建器里改）。用于选待机动画。
  const gender = useRef<MpGender | null>(null);
  const onImportedRef = useRef(onImported);
  onImportedRef.current = onImported;
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;

  const engine: EngineState = engineError ? "error" : flow.engineReady ? "ready" : "loading";
  const shown = flow.phase === "revealed" || flow.phase === "fallback";
  const open = flow.phase !== "standby";

  useEffect(() => {
    const chosen = creatorUrl(window.innerWidth);
    setSrc(chosen);
    let alive = true;

    const setup = () => {
      if (!token.current || !target.current) return;
      loadedPending.current = false;
      for (const m of setupMessages(token.current, chosen.mobile)) postTo(target.current, m);
      if (graceTimer.current) clearTimeout(graceTimer.current);
      graceTimer.current = setTimeout(() => dispatch({ type: "engine_ready" }), AUTH_GRACE_MS);
    };

    fetch("/api/avatar/metaperson/token", { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) {
          setError(await readError(res, trRef.current.tr("metaperson.connectFailed"), trRef.current.tc("networkError")));
          setEngineError(true);
          return;
        }
        const body = (await res.json()) as { accessToken: string };
        token.current = body.accessToken;
        if (loadedPending.current) setup();
      })
      .catch(() => {
        if (!alive) return;
        setError(trRef.current.tc("networkError"));
        setEngineError(true);
      });

    async function importExport(url: string, avatarCode: string) {
      if (exportTimer.current) clearTimeout(exportTimer.current);
      // 重发 export_avatar 可能收到多次 model_exported：同一个导出地址只导入一次
      if (importing.current || importedUrl.current === url) return;
      importing.current = true;
      importedUrl.current = url;
      setBusy("importing");
      setError(null);
      const res = await fetch("/api/avatar/metaperson/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, avatarCode }),
      }).catch(() => null);
      importing.current = false;
      if (!alive) return;
      if (!res || !res.ok) {
        importedUrl.current = null;
        setError(await readError(res, trRef.current.tr("metaperson.saveFailed"), trRef.current.tc("networkError")));
        setBusy(null);
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
          if (graceTimer.current) clearTimeout(graceTimer.current);
          dispatch(e.isAuthenticated ? { type: "engine_ready" } : { type: "auth_failed" });
          break;
        case "model_generated": {
          dispatch({ type: "model_generated" });
          gender.current = mpGenderOf(e.gender) ?? gender.current;
          // 桌面版：知道性别后把导出参数换成带待机动画的版本，导出的 GLB 是自然站姿而不是 T 字。
          postTo(target.current, idleExportParamsMessage(gender.current, chosen.mobile));
          if (!sawAvailability.current) setCanExport(true);
          break;
        }
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
      if (graceTimer.current) clearTimeout(graceTimer.current);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  // 新的生成请求：切到等待态，把舞台滚到视口中间。
  const requestId = request?.id ?? null;
  useEffect(() => {
    if (requestId === null) return;
    dispatch({ type: "request" });
    setRequestedAt(Date.now());
    setNow(Date.now());
    if (!sawAvailability.current) setCanExport(false);
    return revealStage(stageWrap.current);
  }, [requestId]);

  // 创建器显示出来时（保存按钮出现在舞台上方）再对齐一次，桌面 1440×900 首屏同时看到按钮与创建器。
  useEffect(() => {
    if (shown) return revealStage(stageWrap.current);
  }, [shown]);

  // 请求被父组件撤回（读取照片失败等）：还没发出就回到上传。
  const withdrawn = request === null;
  useEffect(() => {
    if (withdrawn) dispatch({ type: "cancel" });
  }, [withdrawn]);

  // 引擎就绪且照片备好：发送 generate_avatar。
  const payload = request?.payload ?? null;
  useEffect(() => {
    if (!payload || !src || !shouldSend(flow)) return;
    gender.current = payload.gender;
    postTo(target.current, generateAvatarMessage({ ...payload, mobile: src.mobile }));
    dispatch({ type: "sent", at: Date.now() });
  }, [flow, payload, src]);

  // 90 秒兜底计时。
  useEffect(() => {
    const wait = msUntilFallback(flow, Date.now());
    if (wait === null) return;
    const t = setTimeout(() => dispatch({ type: "tick", now: Date.now() }), wait + 50);
    return () => clearTimeout(t);
  }, [flow]);

  // 进入兜底：放回创建器自己的“选择照片”按钮。
  const fallback = flow.phase === "fallback";
  useEffect(() => {
    if (fallback && src) postTo(target.current, fallbackUiMessage(src.mobile));
  }, [fallback, src]);

  useEffect(() => {
    onPhaseRef.current?.(flow.phase, engine);
  }, [flow.phase, engine]);

  // 引擎加载与等待态的计时。
  const ticking = flow.phase === "generating" || (flow.phase === "standby" && engine === "loading");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  // 浮层对齐舞台占位：舞台尺寸、页面高度或窗口变化时重新测量。
  useLayoutEffect(() => {
    const el = dock.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const next = { top: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
      setBox((b) => (b && b.top === next.top && b.left === next.left && b.width === next.width && b.height === next.height ? b : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, shown]);

  function save() {
    const t = target.current;
    if (!t || !canExport) return;
    setError(null);
    setBusy("exporting");
    // 创建器在形象还没完全显示时会静默丢掉 export_avatar（工作站实测：报 “Viewer scene isn't loaded” 且不回消息），
    // 所以每 8 秒重发一次，直到收到 model_exported（importing）；累计 120 秒仍无回应才恢复按钮。
    const started = Date.now();
    const send = () => {
      if (importing.current) return;
      if (Date.now() - started >= 120_000) {
        setBusy((b) => (b === "exporting" ? null : b));
        setError(trRef.current.tr("metaperson.exportTimeout"));
        return;
      }
      (t.win as Window).postMessage(exportMessage({ gender: gender.current, mobile: src?.mobile ?? true }), t.origin);
      exportTimer.current = setTimeout(send, 8_000);
    };
    if (exportTimer.current) clearTimeout(exportTimer.current);
    send();
  }

  const floatStyle: CSSProperties =
    shown && box
      ? { position: "absolute", top: box.top, left: box.left, width: box.width, height: box.height }
      : { position: "fixed", top: 0, left: 0, width: box?.width || "100%" };

  const progress = engineProgress(now - mountedAt, engine === "ready");

  return (
    <div className="stack" style={{ gap: 12 }}>
      {flow.phase === "standby" && engine !== "error" ? (
        <div className={s.engine} data-ready={engine === "ready" || undefined} role="status" aria-live="polite">
          <span className={s.engineBar} aria-hidden="true">
            <i style={{ transform: `scaleX(${progress})` }} />
          </span>
          <span className="sc-meta">{engine === "ready" ? tr("metaperson.engineReady") : tr("metaperson.engineLoading", { time: clock(now - mountedAt) })}</span>
        </div>
      ) : null}

      {fallback ? <p className="serif-note">{tr("metaperson.pickFace")}</p> : null}

      <div ref={stageWrap} className="stack" style={{ gap: 12 }}>
      {/* 创建器是跨域 iframe，鼠标停在上面时滚轮被它接走：主按钮放在舞台上方，不需要滚过创建器才能保存。 */}
      {shown ? (
        <div className={s.actions}>
          <button type="button" className="sc-cta" disabled={!canExport || busy !== null} onClick={save}>
            {busy === "exporting" ? tr("metaperson.exporting") : busy === "importing" ? tr("metaperson.saving") : tr("metaperson.saveAs")}
          </button>
          {flow.phase === "revealed" ? <span className="sc-meta">{tr("metaperson.adjustHint")}</span> : null}
        </div>
      ) : null}
      <div ref={dock} className={s.dock} data-open={open || undefined}>
        {open ? (
          <div className={s.waitStage} data-on={flow.phase === "generating" || undefined} aria-hidden={shown || undefined}>
            <div className={s.waitPortrait}>
              {stillUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={stillUrl} alt="" />
              ) : (
                <span className={s.creatorFigure} />
              )}
              <i className={s.waitSweep} aria-hidden="true" />
            </div>
            <div className={s.waitText} role="status" aria-live="polite">
              <p className={s.waitTitle}>{tr("metaperson.shaping")}</p>
              {summary ? <p className="serif-note">{summary}</p> : null}
              <span className="sc-meta">{tr("metaperson.elapsed", { time: clock(now - (requestedAt ?? now)) })}</span>
              {engine === "loading" ? <span className="sc-meta">{tr("metaperson.engineStillLoading")}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {shown && summary && flow.phase === "revealed" ? <p className="sc-meta">{tr("metaperson.basedOn", { summary })}</p> : null}

      {src
        ? createPortal(
            <div
              className={s.stageFloat}
              data-shown={shown || undefined}
              style={floatStyle}
              inert={!shown}
              aria-hidden={!shown || undefined}
            >
              <iframe ref={frame} src={src.url} title={tr("metaperson.creatorTitle")} allow="fullscreen" className={s.creatorFrame} />
              {busy === "importing" ? (
                <div className={s.creatorBusy} role="status" aria-live="polite">
                  <div className="wait-bar" aria-hidden="true" style={{ width: 160 }}>
                    <i />
                  </div>
                  <span className="sc-meta">{tr("metaperson.savingAvatar")}</span>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
