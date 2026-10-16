"use client";

// 全站悬浮对话（D56）：右下角圆形入口，点开后手机是底部抽屉（模态），桌面是右下角浮窗（非模态，可以边聊边看页面）。
// - 挂在根布局，路由切换不卸载；对话与上一轮解析的条件存 sessionStorage，刷新后还在。
// - 一次发送 = 一条 NDJSON 流：先到规则结果（卡片 + 一句话），再流式替换成 AI 的话与卡片（见 app/api/chat/route.ts）。
// - 入口会抬到吸底操作条（.cta-bar、[data-dock-avoid]）上方，不盖住主按钮。
// - 其他地方用 window 事件 `sc-chat:open` 打开（首页标题旁的引导胶囊）。
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { REDUCED_QUERY, useMedia } from "@/components/closet/useMedia";
import type { ChatCard, ChatEvent, ChatTurn } from "@/lib/chat/protocol";
import { CHAT_MAX_INPUT } from "@/lib/chat/protocol";
import type { LocateQuery } from "@/lib/locate/core";
import { reducedFade, springs } from "@/lib/motion";
import ChatCards from "./ChatCards";
import styles from "./ChatDock.module.css";

export const CHAT_OPEN_EVENT = "sc-chat:open";
const STORE_KEY = "sc-chat-v1";
const SHEET_QUERY = "(max-width: 639px)";
const EXAMPLES = ["下周户外婚礼，1500 以内", "男生第一次约会，别太正式", "周末看展，想要暖一点的颜色"];

type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  cards: ChatCard[];
  chips: string[];
  /** pending：还没收到任何结果；live：正在流式；done：结束 */
  status: "pending" | "live" | "done";
  /** 规则那句话；AI 中途失败时恢复它 */
  rulesText?: string;
  aiStarted?: boolean;
};

type Stored = { msgs: Msg[]; query: LocateQuery | null };

const uid = () => Math.random().toString(36).slice(2, 10);
const cardId = (c: ChatCard) => (c.kind === "page" ? c.page : c.id);

function load(): Stored {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      // 刷新前没跑完的那一轮按已收到的内容结束
      return { msgs: s.msgs.map((m) => (m.status === "done" ? m : { ...m, status: "done" })), query: s.query };
    }
  } catch {}
  return { msgs: [], query: null };
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, (new () => SpeechRecognitionLike) | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * 入口避让吸底操作条（.cta-bar、[data-dock-avoid]）：
 * - 手机上操作条横跨整屏，入口“停靠”进操作条最右侧，与主按钮垂直居中，成为它旁边的圆形次按钮（视觉规范 §2 第 4 层）；
 *   操作条加 data-dock-reserve，由 globals.css 给它留出右侧位置，主按钮不被盖住。
 * - 操作条横向不重叠（桌面上居中的 720px 栏）时不动。
 * 返回需要上移的像素，以及是否处于停靠状态（停靠时跟随滚动，不做弹簧，避免拖影）。
 */
function useDockLift(active: boolean, fabRef: React.RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ lift: 0, docked: false });
  const pathname = usePathname();
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const reserved = new Set<HTMLElement>();
    const measure = () => {
      frame = 0;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const fab = fabRef.current;
      // 入口未上移时的中心（CSS bottom 已含安全区），取不到时按 16px 估算
      const bottom = fab ? parseFloat(getComputedStyle(fab).bottom) || 16 : 16;
      const size = fab?.offsetHeight || 54;
      const fabLeft = vw - 16 - size;
      const naturalCenter = vh - bottom - size / 2;
      let lift = 0;
      let docked = false;
      const keep = new Set<HTMLElement>();
      document.querySelectorAll<HTMLElement>(".cta-bar, [data-dock-avoid]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.top >= vh || r.bottom <= 0) return;
        if (r.right < fabLeft - 8) return; // 横向不重叠
        if (r.bottom < vh - 160) return; // 不在底部区域
        const cta = el.classList.contains("cta-bar") ? el.querySelector<HTMLElement>(".sc-cta") : null;
        if (cta && r.left < vw / 2) {
          const c = cta.getBoundingClientRect();
          lift = Math.max(lift, naturalCenter - (c.top + c.height / 2));
          docked = true;
          keep.add(el);
        } else {
          lift = Math.max(lift, vh - r.top + 8 - bottom); // 抬到它上方，留 8px
        }
      });
      for (const el of keep) if (!el.hasAttribute("data-dock-reserve")) el.setAttribute("data-dock-reserve", "");
      for (const el of reserved) if (!keep.has(el)) el.removeAttribute("data-dock-reserve");
      reserved.clear();
      keep.forEach((el) => reserved.add(el));
      const next = { lift: Math.max(0, Math.round(lift)), docked };
      setState((s) => (s.lift === next.lift && s.docked === next.docked ? s : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    schedule();
    const t = window.setTimeout(schedule, 400); // 路由切换后新页面的操作条稍晚挂载
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(t);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      mo.disconnect();
      for (const el of reserved) el.removeAttribute("data-dock-reserve");
    };
  }, [active, pathname, fabRef]);
  return state;
}

function StarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="sc-chat-star" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2dcaa" />
          <stop offset=".55" stopColor="#c9a96e" />
          <stop offset="1" stopColor="#8a6a36" />
        </linearGradient>
      </defs>
      <path
        d="M12 1.5c.5 4.6 1.6 7.4 3.2 8.9 1.6 1.5 4.3 2.2 7.3 2.6-3 .4-5.7 1.1-7.3 2.6-1.6 1.5-2.7 4.3-3.2 8.9-.5-4.6-1.6-7.4-3.2-8.9C7.2 14.1 4.5 13.4 1.5 13c3-.4 5.7-1.1 7.3-2.6C10.4 8.9 11.5 6.1 12 1.5Z"
        fill="url(#sc-chat-star)"
      />
    </svg>
  );
}

export default function ChatDock() {
  const reduced = useMedia(REDUCED_QUERY) === true;
  const sheet = useMedia(SHEET_QUERY) === true;
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [query, setQuery] = useState<LocateQuery | null>(null);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const queryRef = useRef(query);
  queryRef.current = query;
  const { lift, docked } = useDockLift(!open, fabRef);
  const busy = msgs.some((m) => m.status !== "done");

  // 恢复上次对话（只在客户端）
  useLayoutEffect(() => {
    const s = load();
    setMsgs(s.msgs);
    setQuery(s.query);
    setVoiceOk(Boolean(speechCtor()));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ msgs: msgs.slice(-40), query } satisfies Stored));
    } catch {}
  }, [msgs, query, hydrated]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    recRef.current?.stop();
    if (returnFocus) requestAnimationFrame(() => fabRef.current?.focus({ preventScroll: true }));
  }, []);

  // 打开：聚焦输入框；手机抽屉打开时锁住页面滚动
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), reduced ? 0 : 120);
    let restore: (() => void) | null = null;
    if (sheet) {
      const html = document.documentElement;
      const prev = html.style.overflow;
      html.style.overflow = "hidden";
      restore = () => {
        html.style.overflow = prev;
      };
    }
    return () => {
      window.clearTimeout(t);
      restore?.();
    };
  }, [open, sheet, reduced]);

  // 新内容出现时滚到底（用户正往上翻时不打扰）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [msgs, open, reduced]);

  const patch = useCallback((id: string, f: (m: Msg) => Msg) => {
    setMsgs((list) => list.map((m) => (m.id === id ? f(m) : m)));
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, CHAT_MAX_INPUT);
      if (!text) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const history: ChatTurn[] = msgsRef.current
        .filter((m) => m.text || m.cards.length)
        .slice(-12)
        .map((m) => ({ role: m.role, text: m.text, ...(m.role === "assistant" ? { shown: m.cards.map(cardId).slice(0, 12) } : {}) }));
      const user: Msg = { id: uid(), role: "user", text, cards: [], chips: [], status: "done" };
      const bot: Msg = { id: uid(), role: "assistant", text: "", cards: [], chips: [], status: "pending" };
      // 上一轮如果还在流式，按已收到的内容结束
      setMsgs((list) => [...list.map((m) => (m.status === "done" ? m : { ...m, status: "done" as const })), user, bot]);
      setInput("");
      setAnnounce("");
      // 桌面：点了追问 chip 后焦点回到输入框，键盘可以接着打字；手机不聚焦，免得键盘挡住结果
      if (!window.matchMedia(SHEET_QUERY).matches) inputRef.current?.focus({ preventScroll: true });

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...history, { role: "user", text }], query: queryRef.current }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // 这一轮回复的最新内容：每个事件都在它上面改，再整体写回列表
        let cur: Msg = bot;
        const commit = (next: Partial<Msg>) => {
          cur = { ...cur, ...next };
          const snap = cur;
          setMsgs((list) => list.map((m) => (m.id === bot.id ? snap : m)));
        };
        const apply = (ev: ChatEvent) => {
          if (ev.t === "rules") {
            setQuery(ev.query);
            commit({ text: cur.aiStarted ? cur.text : ev.text, rulesText: ev.text, cards: ev.cards, chips: ev.chips, status: "live" });
          } else if (ev.t === "delta") {
            commit({ text: cur.aiStarted ? cur.text + ev.d : ev.d, aiStarted: true, status: "live" });
          } else if (ev.t === "cards") {
            commit({ cards: ev.cards });
          } else if (ev.t === "chips") {
            commit({ chips: ev.chips });
          } else if (ev.t === "revert") {
            commit({ text: cur.rulesText ?? "", aiStarted: false });
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) apply(JSON.parse(line) as ChatEvent);
          }
        }
        if (ctrl.signal.aborted) return;
        commit({ status: "done" });
        setAnnounce(`${cur.text}${cur.cards.length ? `。下面有 ${cur.cards.length} 张卡片。` : ""}`);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const msg = (e as Error).message;
        patch(bot.id, (m) =>
          m.cards.length || m.text
            ? { ...m, status: "done" }
            : { ...m, text: msg || "暂时没连上，稍后再试一次。", status: "done" },
        );
      }
    },
    [patch],
  );

  // 外部打开（首页引导胶囊等）：可带一句话直接发送
  useEffect(() => {
    const onOpen = (e: Event) => {
      setOpen(true);
      const text = (e as CustomEvent<{ text?: string } | undefined>).detail?.text;
      if (text) void send(text);
    };
    window.addEventListener(CHAT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CHAT_OPEN_EVENT, onOpen);
  }, [send]);

  const reset = () => {
    abortRef.current?.abort();
    setMsgs([]);
    setQuery(null);
    setAnnounce("");
    inputRef.current?.focus();
  };

  const toggleVoice = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    let heard = "";
    rec.onresult = (e) => {
      heard = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      setInput(heard);
    };
    rec.onend = () => {
      setListening(false);
      if (heard.trim()) void send(heard);
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  // 点卡片跳转：手机收起抽屉，让页面露出来；桌面浮窗留着，方便接着问
  const onNavigate = useCallback(() => {
    if (sheet) close(false);
  }, [sheet, close]);

  // Esc 关闭：焦点在面板里，或者焦点已落回页面本身（点了追问后按钮被替换）时都生效；页面上别的输入框里不抢
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const a = document.activeElement;
      if (sheet || !a || a === document.body || panelRef.current?.contains(a)) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, sheet, close]);

  // 手机抽屉内 Tab 循环
  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !sheet) return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1'])");
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const lastId = msgs[msgs.length - 1]?.id;
  const panelMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: reducedFade }, transition: reducedFade }
    : sheet
      ? { initial: { y: "100%" }, animate: { y: 0 }, exit: { y: "100%", transition: { duration: 0.28, ease: [0.4, 0, 1, 1] as const } }, transition: springs.rise }
      : {
          initial: { opacity: 0, scale: 0.94, y: 14 },
          animate: { opacity: 1, scale: 1, y: 0 },
          exit: { opacity: 0, scale: 0.96, y: 10, transition: { duration: 0.18, ease: "easeIn" as const } },
          transition: springs.rise,
        };

  return (
    <>
      <AnimatePresence>
        {!open ? (
          <motion.button
            key="fab"
            ref={fabRef}
            type="button"
            className={styles.fab}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1, y: -lift }}
            exit={reduced ? { opacity: 0, transition: reducedFade } : { opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
            // 停靠在操作条里时跟随滚动，不用弹簧
            transition={reduced ? reducedFade : docked ? { y: { duration: 0 }, default: springs.rise } : springs.rise}
            whileTap={reduced ? undefined : { scale: 0.92 }}
            onClick={() => setOpen(true)}
            aria-label="打开搭配助手：说场合和预算，帮你找衣橱"
            aria-haspopup="dialog"
          >
            <StarIcon />
            {busy ? <span className={styles.fabDot} aria-hidden="true" /> : null}
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open && sheet ? (
          <motion.div
            key="scrim"
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => close()}
            aria-hidden="true"
          />
        ) : null}
        {open ? (
          <motion.section
            key="panel"
            ref={panelRef}
            className={`${styles.panel} ${sheet ? styles.sheet : styles.float}`}
            role="dialog"
            aria-modal={sheet}
            aria-labelledby={titleId}
            onKeyDown={onPanelKey}
            {...panelMotion}
          >
            {sheet ? <span className={styles.grabber} aria-hidden="true" /> : null}
            <header className={styles.head}>
              <div>
                <span className="sc-kicker">Ask Star Closet</span>
                <h2 id={titleId} className={styles.title}>
                  想穿去哪儿？
                </h2>
              </div>
              <div className={styles.headActions}>
                {msgs.length ? (
                  <button type="button" className={styles.iconBtn} onClick={reset} aria-label="开始新对话" title="新对话">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : null}
                <button type="button" className={styles.iconBtn} onClick={() => close()} aria-label="关闭搭配助手">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </header>

            <div className={styles.list} ref={listRef}>
              {msgs.length === 0 ? (
                <div className={styles.welcome}>
                  <p className={styles.welcomeText}>告诉我场合、风格和预算，我帮你找到合适的衣橱和整套搭配；也可以带你去试衣间、生成 3D 形象。</p>
                  <div className={styles.chips}>
                    {EXAMPLES.map((ex) => (
                      <button key={ex} type="button" className={styles.chip} onClick={() => void send(ex)}>
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {msgs.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className={styles.userRow}>
                    <p className={styles.user}>{m.text}</p>
                  </div>
                ) : (
                  <div key={m.id} className={styles.bot}>
                    {m.status === "pending" && !m.text ? (
                      <p className={styles.thinking} aria-label="正在找">
                        <span />
                        <span />
                        <span />
                      </p>
                    ) : (
                      <p className={`${styles.botText} ${m.status === "live" && m.aiStarted ? styles.streaming : ""}`}>{m.text}</p>
                    )}
                    <ChatCards cards={m.cards} reduced={reduced} onNavigate={onNavigate} />
                    {m.id === lastId && m.status === "done" && m.chips.length ? (
                      <div className={styles.chips}>
                        {m.chips.map((c) => (
                          <button key={c} type="button" className={styles.chip} onClick={() => void send(c)}>
                            {c}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ),
              )}
            </div>

            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <label className="sr-only" htmlFor={`${titleId}-input`}>
                说一句你要去哪儿、什么风格、预算多少
              </label>
              <input
                id={`${titleId}-input`}
                ref={inputRef}
                className={styles.input}
                type="text"
                enterKeyHint="send"
                autoComplete="off"
                maxLength={CHAT_MAX_INPUT}
                placeholder={listening ? "正在听…" : "场合、风格、预算，说一句"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              {voiceOk ? (
                <button
                  type="button"
                  className={`${styles.iconBtn} ${listening ? styles.listening : ""}`}
                  onClick={toggleVoice}
                  aria-label={listening ? "停止语音输入" : "语音输入"}
                  aria-pressed={listening}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" stroke="currentColor" strokeWidth="1.2" />
                    <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              ) : null}
              <button type="submit" className={styles.send} aria-label="发送" disabled={!input.trim()}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
            <div className="sr-only" aria-live="polite">
              {announce}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </>
  );
}
