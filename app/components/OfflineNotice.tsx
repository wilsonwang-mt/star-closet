"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reducedFade, springs } from "@/lib/motion";
import s from "./OfflineNotice.module.css";

// 站内离线提示（工作站 T5 报告 E1）。不用 Service Worker：
// - 监听 online / offline，断网时底部浮起一枚玻璃胶囊“网络已断开，恢复后自动继续”。
// - 断网时点站内链接：在 window 捕获阶段标记 preventDefault（早于 Next 的 Link 处理），不让 Next 取页面数据失败后整页跳到浏览器离线页；
//   记下最后一次想去的地址，恢复网络后自动前往，胶囊短暂显示“已恢复连接”后收起。
// - 只动 transform / opacity；减弱动态时只淡入淡出。

type Phase = "online" | "offline" | "back";

const BACK_MS = 1800;

/** 能在站内客户端跳转的链接：同源、无 target / download、不是纯锚点、没有按修饰键。 */
function internalHref(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  return url.pathname + url.search + url.hash;
}

export default function OfflineNotice() {
  const router = useRouter();
  const reduced = useReducedMotion() === true;
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("online");
  const [nudge, setNudge] = useState(0);
  const pending = useRef<string | null>(null);
  // 监听只挂一次：跳转后 router 引用可能变化，不能因此重挂监听、丢掉计时。
  const routerRef = useRef(router);
  routerRef.current = router;

  // “已恢复连接”停留片刻后收起；跳转、重渲染都不打断这段计时。
  useEffect(() => {
    if (phase !== "back") return;
    const t = setTimeout(() => setPhase((p) => (p === "back" ? "online" : p)), BACK_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    setMounted(true);

    const goOffline = () => setPhase("offline");
    const goOnline = () => {
      const next = pending.current;
      pending.current = null;
      setPhase((p) => (p === "offline" ? "back" : p));
      if (next) routerRef.current.push(next);
    };
    const onClick = (e: MouseEvent) => {
      if (navigator.onLine) return;
      const href = internalHref(e);
      if (!href) return;
      // 只 preventDefault：Next 的 Link 见到 defaultPrevented 就不跳转，链接上其他处理器（如收起菜单）照常执行
      e.preventDefault();
      pending.current = href;
      setPhase("offline");
      setNudge((n) => n + 1);
    };

    if (!navigator.onLine) goOffline();
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  if (!mounted) return null;

  const visible = phase !== "online";
  return createPortal(
    <div className={s.dock} role="status" aria-live="polite">
      <AnimatePresence>
        {visible ? (
          <motion.div
            key="offline"
            className={`sc-glass ${s.pill}`}
            data-back={phase === "back" || undefined}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={reduced ? reducedFade : springs.rise}
          >
            <span className={s.dot} aria-hidden="true" />
            {/* 断网时再点链接：胶囊轻轻一跳，告诉用户点击已收到、会在恢复后继续 */}
            <motion.span
              key={nudge}
              className={s.text}
              initial={reduced || nudge === 0 ? false : { y: -3 }}
              animate={{ y: 0 }}
              transition={springs.press}
            >
              {phase === "back" ? "已恢复连接" : "网络已断开，恢复后自动继续"}
            </motion.span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
