"use client";

// 首页预览 ⇄ 衣橱页的共享元素过渡（视觉规范 §7.1「走进衣橱」）。
// - 支持 View Transitions：document.startViewTransition 包住路由跳转；新页面把场景挂进 DOM 后调用 signalHeroReady()，
//   浏览器才截取新画面，同名元素 closet-hero（首页中央预览 ⇄ 衣橱页全屏场景）用弹簧 linear() 放大推进。
// - 不支持：用 Motion 在页面最上层放一张同图的覆盖层，从卡片位置弹簧放大到全屏，新页面就绪后淡出。
// - 减弱动态：不做放大，只整页淡入淡出（CSS 里 closet-hero 的命名只在 no-preference 下生效）。
import { animate } from "motion/react";
import { springCss, springs } from "@/lib/motion";

type Router = { push: (href: string, options?: { scroll?: boolean }) => void };
type Kind = "enter" | "back";

let pendingReady: (() => void) | null = null;
let arrival: { kind: Kind; at: number } | null = null;
type Handoff = { id: string; t: number; frame: string | null; at: number };
let handoff: Handoff | null = null;

/** 目标页面的场景（或首页中央卡片）已挂进 DOM：放行截图。 */
export function signalHeroReady() {
  pendingReady?.();
}

/** 刚刚是不是经过共享元素过渡进来的（1.5 秒内有效）。只读不清，避免开发模式下 StrictMode 双调用读空。 */
export function peekArrival(): Kind | null {
  if (!arrival || performance.now() - arrival.at > 1500) return null;
  return arrival.kind;
}

/**
 * 跳转前把正在播放的视频定格成一帧交给下一页：新页面先显示这一帧，视频从同一时刻接着播放并淡入。
 * 这样过渡前后的两张截图是同一画面，放大推进时不会出现两帧重影。
 */
export function captureHandoff(id: string, source: HTMLElement | null) {
  const v = source?.querySelector("video");
  let frame: string | null = null;
  let t = 0;
  if (v && !v.paused && v.readyState >= 2 && v.videoWidth && v.currentTime > 0) {
    t = v.currentTime;
    try {
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")?.drawImage(v, 0, 0);
      frame = c.toDataURL("image/jpeg", 0.86);
    } catch {
      frame = null;
    }
  }
  handoff = { id, t, frame, at: performance.now() };
}

/** 读取交接帧（2.5 秒内、同一间衣橱有效）。只读不清，StrictMode 双调用也安全。 */
export function peekHandoff(id: string): { frame: string | null; startAt: number } | null {
  if (!handoff || handoff.id !== id || performance.now() - handoff.at > 2500) return null;
  return { frame: handoff.frame, startAt: handoff.t };
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type VTDocument = Document & { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } };

export function navigateWithHero(router: Router, href: string, kind: Kind, source: HTMLElement | null) {
  const doc = document as VTDocument;
  arrival = { kind, at: performance.now() };

  if (typeof doc.startViewTransition === "function") {
    const root = document.documentElement;
    const { easing, duration } = springCss(springs.enter);
    root.style.setProperty("--vt-spring", easing);
    root.style.setProperty("--vt-dur", `${duration}ms`);
    root.dataset.vt = kind;
    const vt = doc.startViewTransition(
      () =>
        new Promise<void>((resolve) => {
          // 新页面迟迟不来时（网络慢）最多冻结 2.5 秒，之后照常显示。
          const timer = window.setTimeout(done, 2500);
          function done() {
            window.clearTimeout(timer);
            pendingReady = null;
            // 注意：过渡的更新阶段浏览器暂停渲染，requestAnimationFrame 不会触发，这里直接放行
            resolve();
          }
          pendingReady = done;
          router.push(href);
        }),
    );
    vt.finished.finally(() => {
      delete root.dataset.vt;
    });
    return;
  }

  if (kind === "enter" && source && !reducedMotion()) {
    overlayEnter(source);
  }
  router.push(href);
}

// 无 View Transitions 时的模拟：覆盖层铺满视口、图片 cover；起点用等比缩放 + clip-path 裁成卡片的位置和圆角。
function overlayEnter(source: HTMLElement) {
  const img = source.querySelector("img");
  const src = img?.currentSrc || img?.src;
  if (!src) return;
  const r = source.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const radius = parseFloat(getComputedStyle(source).borderTopLeftRadius) || 0;
  // 等比缩放让覆盖层的一条边与卡片对齐，另一条边多出的部分用 clip-path 裁掉
  const s = Math.max(r.width / vw, r.height / vh);
  const clipX = (vw - r.width / s) / 2;
  const clipY = (vh - r.height / s) / 2;
  const tx = r.left + r.width / 2 - vw / 2;
  const ty = r.top + r.height / 2 - vh / 2;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "60",
    pointerEvents: "none",
    background: `center / cover no-repeat url("${src}")`,
    transformOrigin: "50% 50%",
    willChange: "transform, clip-path",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(layer);

  const from = `inset(${clipY}px ${clipX}px ${clipY}px ${clipX}px round ${radius / s}px)`;
  const grow = animate(
    layer,
    {
      transform: [`translate(${tx}px, ${ty}px) scale(${s})`, "translate(0px, 0px) scale(1)"],
      clipPath: [from, "inset(0px 0px 0px 0px round 0px)"],
    },
    springs.enter,
  );

  let ready = false;
  let grown = false;
  const finish = () => {
    if (!ready || !grown) return;
    animate(layer, { opacity: [1, 0] }, { duration: 0.45, ease: "easeOut" }).then(() => layer.remove());
  };
  pendingReady = () => {
    pendingReady = null;
    ready = true;
    finish();
  };
  grow.then(() => {
    grown = true;
    finish();
  });
  // 保险：无论如何 3 秒后移除
  window.setTimeout(() => layer.remove(), 3000);
}
