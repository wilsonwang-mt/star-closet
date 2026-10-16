"use client";
/* eslint-disable @next/next/no-img-element -- 用 <picture> 按屏宽切换竖屏/横屏场景，并与共享元素过渡共用同一张图 */

// 首页「想走进谁的衣橱」：浅弧形立体轮播（视觉规范 §7.1）。
// - 一个连续的位置值 pos（单位：间），每张卡的位移、远近、转向、缩放、模糊、雾化都由「与中心的距离」连续插值，逐帧不触发 React 渲染。
// - 拖拽跟手：竖向手势交给浏览器滚动页面（touch-action: pan-y + 方向锁定），横向才接管；松手按速度惯性吸附到最近一间（弹簧，可打断）。
// - 键盘左右键 / Home / End、底部按钮、触控板横向滑动、点侧卡都能切换；只播放中央那一间的视频。
// - 文字、头像与按钮在透视层之外，始终正面清晰；「走进衣橱」用共享元素过渡推进到 /closet/[id]。
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClosetView } from "@/components/closet/data";
import ChatHint from "@/components/chat/ChatHint";
import SceneVideo from "@/components/closet/SceneVideo";
import {
  captureHandoff,
  navigateWithHero,
  peekArrival,
  peekHandoff,
  signalHeroReady,
  warmCloset,
} from "@/components/closet/transition";
import { RollingDigits } from "@/components/motion/RollingNumber";
import { REDUCED_QUERY, WIDE_QUERY, useMedia } from "@/components/closet/useMedia";
import { clamp, reducedFade, springs } from "@/lib/motion";
import styles from "./ClosetCarousel.module.css";

const STORE_KEY = "sc-home-closet";
const GENDERS = ["女装", "男装", "中性"] as const;
const TYPE_ORDER = ["风格主题", "穿搭博主", "个人主理人", "品牌主题", "明星"];
const two = (n: number) => String(n).padStart(2, "0");

// ---------- 几何：距离 d（间）→ 画面 ----------
type Geo = { u: number; wide: boolean };
function place(d: number, g: Geo) {
  const a = Math.abs(d);
  const s = Math.sign(d);
  const near = Math.min(a, 1);
  const far = clamp(a - 1, 0, 2);
  const k1 = g.wide ? 0.5 : 0.42; // 相邻一间离中心的距离（卡宽的比例）
  const k2 = g.wide ? 0.15 : 0.12; // 更远的几间继续收拢在后面
  return {
    x: s * (near * k1 + far * k2) * g.u,
    z: -(near * 0.3 + far * 0.12) * g.u,
    // 浅弧：侧卡外缘朝向观众，像一段内凹的弧墙，而不是旋转圆盘
    rotateY: -s * (near * 18 + far * 6),
    scale: 1 - near * 0.04 - far * 0.03,
    blur: near * 2.4 + far * 2,
    shade: near * 0.34 + far * 0.22,
    opacity: a <= 2 ? 1 : clamp(3 - a, 0, 1),
    zIndex: 100 - Math.round(a * 10),
  };
}

function rubber(raw: number, max: number) {
  const lim = (o: number) => (1 - 1 / (o * 0.9 + 1)) * 0.55;
  if (raw < 0) return -lim(-raw);
  if (raw > max) return max + lim(raw - max);
  return raw;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function ClosetCarousel({ closets, initialId }: { closets: ClosetView[]; initialId?: string }) {
  const router = useRouter();
  const wide = useMedia(WIDE_QUERY);
  const reduced = useMedia(REDUCED_QUERY) === true;

  // ---------- 筛选 ----------
  const [gender, setGender] = useState<string | null>(null);
  const [ctype, setCtype] = useState<string | null>(null);
  const types = useMemo(() => TYPE_ORDER.filter((t) => closets.some((c) => c.closetType === t)), [closets]);
  const genders = useMemo(() => GENDERS.filter((g) => closets.some((c) => c.gender === g)), [closets]);
  const list = useMemo(
    () => closets.filter((c) => (!gender || c.gender === gender) && (!ctype || c.closetType === ctype)),
    [closets, gender, ctype],
  );
  const listKey = `${gender ?? "*"}|${ctype ?? "*"}`;
  // 每个筛选项与另一组当前选择组合后的数量：为 0 的置灰不可选，避免筛出空结果
  const countWith = (g: string | null, t: string | null) =>
    closets.filter((c) => (!g || c.gender === g) && (!t || c.closetType === t)).length;
  const n = list.length;

  const startIndex = Math.max(0, list.findIndex((c) => c.id === initialId));
  const pos = useMotionValue(startIndex);
  const [active, setActive] = useState(startIndex);
  const activeRef = useRef(startIndex);
  activeRef.current = active;
  // 上一次渲染时的列表：筛选变化时据此找出“当前是哪一间”
  const prevListRef = useRef(list);

  useMotionValueEvent(pos, "change", (v) => {
    const i = clamp(Math.round(v), 0, Math.max(0, n - 1));
    if (i !== activeRef.current) {
      activeRef.current = i;
      setActive(i);
    }
  });

  // ---------- 尺寸：卡宽 u 驱动所有几何；透视距离随卡宽缩放，手机与桌面观感一致 ----------
  const unit = useMotionValue(280);
  const wideMv = useMotionValue(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [perspective, setPerspective] = useState(900);
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (!w) return;
      unit.set(w);
      wideMv.set(w > h ? 1 : 0);
      setPerspective(Math.round(w * (w > h ? 2.2 : 3.2)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [unit, wideMv, n]);

  // ---------- 动画 ----------
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const trackOpacity = useMotionValue(1);
  const stop = useCallback(() => {
    anim.current?.stop();
    anim.current = null;
  }, []);

  const commit = useCallback(
    (i: number) => {
      const c = list[i];
      if (!c) return;
      try {
        sessionStorage.setItem(STORE_KEY, c.id);
      } catch {}
      // 记在 URL 里：从衣橱页返回（含浏览器返回键）时回到这一间
      const url = new URL(window.location.href);
      if (url.searchParams.get("c") !== c.id) {
        url.searchParams.set("c", c.id);
        window.history.replaceState(null, "", `${url.pathname}${url.search}`);
      }
    },
    [list],
  );

  const snapTo = useCallback(
    (target: number, velocity = 0, kind: "snap" | "step" = "snap") => {
      if (!n) return;
      const t = clamp(target, 0, n - 1);
      stop();
      if (reduced) {
        pos.set(t);
        animate(trackOpacity, [0.4, 1], reducedFade);
        commit(t);
        return;
      }
      const a = animate(pos, t, { ...springs[kind], velocity });
      anim.current = a;
      a.then(() => {
        // 被手势打断（stop）时不提交
        if (anim.current !== a) return;
        anim.current = null;
        commit(t);
      });
    },
    [n, pos, reduced, stop, commit, trackOpacity],
  );

  const go = useCallback((delta: number) => snapTo(activeRef.current + delta, 0, "step"), [snapTo]);

  // ---------- 恢复上次选中的那一间（URL 优先，其次 sessionStorage），在首帧绘制前完成 ----------
  useLayoutEffect(() => {
    let id = new URLSearchParams(window.location.search).get("c");
    if (!id) {
      try {
        id = sessionStorage.getItem(STORE_KEY);
      } catch {}
    }
    const i = id ? list.findIndex((c) => c.id === id) : -1;
    if (i >= 0 && i !== Math.round(pos.get())) {
      pos.set(i);
      activeRef.current = i;
      setActive(i);
    }
    // 从衣橱页返回时，中央卡片已就位：放行共享元素过渡
    signalHeroReady();
    // 只在挂载时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选变化：留在同一间（若仍在结果里），否则回到第一间；整条轨道淡入
  useEffect(() => {
    if (prevListRef.current === list) return;
    stop();
    const prevId = prevListRef.current[activeRef.current]?.id;
    prevListRef.current = list;
    const i = Math.max(0, list.findIndex((c) => c.id === prevId));
    pos.set(i);
    activeRef.current = i;
    setActive(i);
    trackOpacity.set(0);
    animate(trackOpacity, 1, reduced ? reducedFade : { duration: 0.45, ease: "easeOut" });
    commit(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // ---------- 手势：方向锁定 + 跟手 + 惯性吸附 ----------
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x0: number;
    y0: number;
    p0: number;
    i0: number;
    axis: "x" | "y" | null;
    samples: { t: number; x: number }[];
  } | null>(null);
  const suppressClick = useRef(false);
  const stepPx = () => unit.get() * (wideMv.get() ? 0.5 : 0.42);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !n) return;
    const wasMoving = anim.current !== null;
    stop();
    drag.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      p0: pos.get(),
      i0: Math.round(pos.get()),
      axis: null,
      samples: [{ t: e.timeStamp, x: e.clientX }],
    };
    // 正在吸附时按下：视为“抓住”，不触发点击
    suppressClick.current = wasMoving;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "y") {
        // 竖向：放手给页面滚动；若刚才打断了吸附，接着吸附回去
        drag.current = null;
        if (Math.abs(pos.get() - Math.round(pos.get())) > 1e-4) snapTo(Math.round(pos.get()));
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      suppressClick.current = true;
    }
    pos.set(rubber(d.p0 - dx / stepPx(), n - 1));
    d.samples.push({ t: e.timeStamp, x: e.clientX });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 100) d.samples.shift();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") {
      // 轻点：交给 click；若按下时打断了吸附，先接着吸附回最近一间
      if (Math.abs(pos.get() - Math.round(pos.get())) > 1e-4) snapTo(Math.round(pos.get()));
      return;
    }
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(16, last.t - first.t);
    // 停顿超过 100ms 再松手视为没有甩动
    const stale = e.timeStamp - last.t > 100;
    const vx = e.type === "pointercancel" || stale ? 0 : (last.x - first.x) / dt; // px/ms
    const v = clamp((-vx * 1000) / stepPx(), -6, 6); // 间/秒，限幅避免弹簧冲过头
    let target = Math.round(pos.get() + v * 0.16);
    // 轻快一甩至少走一间；一次最多走两间
    if (target === d.i0 && Math.abs(vx) > 0.3) target = d.i0 - Math.sign(vx);
    target = clamp(target, d.i0 - 2, d.i0 + 2);
    snapTo(target, v);
  };

  // 点击：侧卡 → 转到它；中央 → 走进衣橱
  const enterRef = useRef<() => void>(() => {});
  const onCardClick = useCallback(
    (i: number) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      if (i === activeRef.current && Math.abs(pos.get() - i) < 0.05) enterRef.current();
      else snapTo(i, 0, "step");
    },
    [pos, snapTo],
  );

  // 触控板横向滑动（桌面）：跟手，停下后吸附
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let timer = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || !n) return;
      e.preventDefault();
      stop();
      pos.set(rubber(pos.get() + e.deltaX / stepPx() / 1.6, n - 1));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => snapTo(Math.round(pos.get())), 110);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, snapTo, stop, pos]);

  // 键盘：焦点在轮播区域内时，左右键切换，Home / End 到两端（焦点在筛选、Index 等别处时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      const stage = stageRef.current;
      if (!stage || !(e.target instanceof Node) || !stage.contains(e.target)) return;
      if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "Home" && e.target === stageRef.current) snapTo(0, 0, "step");
      else if (e.key === "End" && e.target === stageRef.current) snapTo(n - 1, 0, "step");
      else if (e.key === "Enter" && e.target === stageRef.current) enterRef.current();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, snapTo, n]);

  // 筛选工具栏：左右键在 chip 之间移动焦点（不会带动上方轮播）
  const onToolbarKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    const chips = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = chips.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? chips.length - 1 : clamp(i + (e.key === "ArrowRight" ? 1 : -1), 0, chips.length - 1);
    chips[next].focus();
    chips[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  // ---------- 走进衣橱 ----------
  const heroRef = useRef<HTMLDivElement | null>(null);
  // 从衣橱页返回：那一间先显示衣橱页定格的那一帧，视频从同一时刻接着播
  const [handoff] = useState(() => {
    if (typeof window === "undefined") return null;
    const c = list[startIndex];
    const h = c ? peekHandoff(c.id) : null;
    return h && c ? { ...h, id: c.id } : null;
  });
  const current = list[active];
  // 从衣橱页返回：画面收回到卡片的途中，标题、信息与切换按钮先隐去，卡片到位后再依次浮起（CSS，见 .arriveBack）
  const [arrivedBack] = useState(() => typeof window !== "undefined" && peekArrival() === "back");
  const enter = useCallback(() => {
    const c = list[activeRef.current];
    if (!c) return;
    stop();
    pos.set(activeRef.current);
    commit(activeRef.current);
    captureHandoff(c.id, heroRef.current);
    navigateWithHero(router, `/closet/${c.id}`, "enter", heroRef.current);
  }, [list, pos, stop, commit, router]);
  enterRef.current = enter;

  // 环境光跟随当前衣橱，停稳 220ms 后再换，快速滑动时不闪
  const [ambientId, setAmbientId] = useState(current?.id);
  useEffect(() => {
    const t = window.setTimeout(() => setAmbientId(current?.id), 220);
    return () => window.clearTimeout(t);
  }, [current?.id]);
  const ambient = closets.find((c) => c.id === ambientId) ?? current;
  // 中央卡片停稳后预取这一间的衣橱页并预加载场景海报：点“走进衣橱”时多半已在缓存里，过渡不必等网络
  useEffect(() => {
    if (!ambient) return;
    const t = window.setTimeout(() => warmCloset(router, `/closet/${ambient.id}`, ambient.poster, ambient.wide), 400);
    return () => window.clearTimeout(t);
  }, [ambient, router]);

  const progress = useTransform(pos, (p) => (n ? (clamp(p, 0, n - 1) + 1) / n : 0));
  const geo = useMemo(() => ({ unit, wideMv }), [unit, wideMv]);

  // 筛选衣橱：桌面放在标题右侧；手机（<900px）移出首屏，放到下方「全部衣橱」索引区头部，
  // 首屏留给刊头、标题与轮播，定位交给右下角的悬浮对话（D66，标题旁有引导胶囊）。两处同一份状态，另一处用 CSS display:none 隐藏（不进焦点与读屏）。
  const renderFilters = (placement: "top" | "index") => (
    <div className={`${styles.filters} ${placement === "top" ? styles.filtersTop : styles.filtersIndex}`} role="toolbar" aria-label="筛选衣橱" onKeyDown={onToolbarKey}>
            <button type="button" className={styles.chip} aria-pressed={!gender} onClick={() => setGender(null)}>
              全部
            </button>
            {genders.map((g) => (
              <button
                key={g}
                type="button"
                className={styles.chip}
                aria-pressed={gender === g}
                aria-disabled={(gender !== g && countWith(g, ctype) === 0) || undefined}
                title={gender !== g && countWith(g, ctype) === 0 ? "这个组合下暂时没有衣橱" : undefined}
                onClick={() => {
                  if (gender !== g && countWith(g, ctype) === 0) return;
                  setGender(gender === g ? null : g);
                }}
              >
                {g}
              </button>
            ))}
            <span className={styles.sep} aria-hidden="true" />
            {types.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.chip}
                aria-pressed={ctype === t}
                aria-disabled={(ctype !== t && countWith(gender, t) === 0) || undefined}
                title={ctype !== t && countWith(gender, t) === 0 ? "这个组合下暂时没有衣橱" : undefined}
                onClick={() => {
                  if (ctype !== t && countWith(gender, t) === 0) return;
                  setCtype(ctype === t ? null : t);
                }}
              >
                {t}
              </button>
            ))}
          </div>
  );

  return (
    <>
      <div className={styles.ambient} aria-hidden="true">
        <AnimatePresence initial={false}>
          {ambient ? (
            <motion.div
              key={ambient.id}
              className={styles.ambientLayer}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, ease: "easeOut" }}
            >
              <picture>
                <source media={WIDE_QUERY} srcSet={ambient.wide} />
                <img src={ambient.poster} alt="" />
              </picture>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className={styles.veil} />
        <div className="sc-grain" />
      </div>

      <section className={`${styles.root} ${arrivedBack ? styles.arriveBack : ""}`} aria-labelledby="closets-title">
        <header className={styles.head}>
          <div>
            <span className="sc-kicker">
              {n ? (
                <>
                  N°<RollingDigits value={active + 1} /> —{" "}
                </>
              ) : null}
              The Closets
            </span>
            <h1 id="closets-title" className={styles.title}>
              想走进谁的衣橱？
            </h1>
          </div>
          {/* 用对话定位衣橱（D51、D66）：手机上取代首屏筛选行，桌面在标题与筛选之间 */}
          <ChatHint />
          {renderFilters("top")}
        </header>

        {n === 0 ? (
          <div className={styles.empty}>
            <p className="serif-note">这个组合下暂时没有衣橱。</p>
            <button
              type="button"
              className="sc-cta sc-cta--ghost compact"
              onClick={() => {
                setGender(null);
                setCtype(null);
              }}
            >
              查看全部
            </button>
          </div>
        ) : (
          <div
            ref={stageRef}
            className={styles.stage}
            style={{ perspective }}
            tabIndex={0}
            role="region"
            aria-roledescription="轮播"
            aria-label={`衣橱，共 ${n} 间。左右方向键切换，回车走进当前衣橱`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDragStart={(e) => e.preventDefault()}
          >
            <motion.div ref={trackRef} className={styles.track} style={{ opacity: trackOpacity }}>
              {list.map((c, i) => (
                <Card
                  key={`${listKey}-${c.id}`}
                  c={c}
                  i={i}
                  n={n}
                  pos={pos}
                  geo={geo}
                  isActive={i === active}
                  playVideo={i === active && wide === false && !reduced && Boolean(c.video)}
                  perspective={perspective}
                  eager={Math.abs(i - startIndex) <= 2}
                  heroRef={heroRef}
                  handoff={handoff && handoff.id === c.id ? handoff : null}
                  onClick={onCardClick}
                />
              ))}
            </motion.div>
          </div>
        )}

        {current ? (
          <div className={styles.info}>
            <div className={styles.who} aria-live="polite">
              <AnimatePresence initial={false}>
                <motion.div
                  key={current.id}
                  className={styles.whoItem}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0, transition: reducedFade } : { opacity: 0, y: -6, transition: { duration: 0.14 } }}
                  transition={reduced ? reducedFade : springs.text}
                >
                  <span className={styles.avatar}>
                    {current.avatar ? <img src={current.avatar} alt="" /> : current.displayName.slice(0, 1)}
                  </span>
                  <span className={styles.names}>
                    <span className={styles.kicker}>
                      {current.displayName} · {current.closetType}
                    </span>
                    <span className={styles.closetName}>{current.closetName}</span>
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>
            <div className={styles.tag}>
              <AnimatePresence initial={false}>
                <motion.p
                  key={current.id}
                  className={styles.tagline}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={reduced ? reducedFade : { duration: 0.35, ease: "easeOut", delay: 0.04 }}
                >
                  {current.tagline}
                </motion.p>
              </AnimatePresence>
            </div>
            <Link
              href={`/closet/${current.id}`}
              prefetch
              className={`sc-cta ${styles.enter}`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                enter();
              }}
            >
              走进衣橱
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                <path d="M1 5h11M8.5 1.5 12 5 8.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        ) : null}

        {n > 1 ? (
          <div className={styles.controls}>
            <button type="button" className={styles.arrow} onClick={() => go(-1)} disabled={active === 0} aria-label="上一间">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className={styles.counter} aria-live="off">
              <span className={styles.count}>
                <b>
                  <RollingDigits value={active + 1} />
                </b>{" "}
                / {two(n)}
              </span>
              <span className={styles.progress} aria-hidden="true">
                <motion.span className={styles.progressFill} style={{ scaleX: progress }} />
              </span>
            </div>
            <button type="button" className={styles.arrow} onClick={() => go(1)} disabled={active === n - 1} aria-label="下一间">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        ) : null}

        {n > 0 ? (
          <section className={styles.index} aria-label="全部衣橱">
            <div className={styles.indexHead}>
              <span className="sc-kicker">Index</span>
              <span className="sc-meta">{n} 间衣橱</span>
            </div>
            {renderFilters("index")}
            <div className={styles.rows}>
              {list.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className={`sc-glass sc-glass--row ${styles.row}`}
                  aria-current={i === active ? "true" : undefined}
                  onClick={() => {
                    snapTo(i, 0, "step");
                    stageRef.current?.focus({ preventScroll: true });
                    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
                  }}
                >
                  <span className={styles.rowNo}>{two(i + 1)}</span>
                  <span className={styles.rowAvatar}>{c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : null}</span>
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{c.closetName}</span>
                    <span className={styles.rowTag}>
                      {c.displayName} · {c.tagline}
                    </span>
                  </span>
                  <span className={styles.rowMeta}>{c.outfitCount} 套</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </>
  );
}

// ---------- 单张卡：全部样式由 pos 派生，React 只在“是否中央”变化时重渲染 ----------
const Card = memo(function Card({
  c,
  i,
  n,
  pos,
  geo,
  isActive,
  playVideo,
  perspective,
  eager,
  heroRef,
  handoff,
  onClick,
}: {
  c: ClosetView;
  i: number;
  n: number;
  pos: MotionValue<number>;
  geo: { unit: MotionValue<number>; wideMv: MotionValue<number> };
  isActive: boolean;
  playVideo: boolean;
  perspective: number;
  eager: boolean;
  heroRef: React.RefObject<HTMLDivElement | null>;
  handoff: { frame: string | null; startAt: number } | null;
  onClick: (i: number) => void;
}) {
  const inputs = [pos, geo.unit, geo.wideMv];
  const at = ([p, u, w]: number[]) => place(i - p, { u, wide: w === 1 });
  const x = useTransform(inputs, (v: number[]) => at(v).x);
  const z = useTransform(inputs, (v: number[]) => at(v).z);
  const rotateY = useTransform(inputs, (v: number[]) => at(v).rotateY);
  const scale = useTransform(inputs, (v: number[]) => at(v).scale);
  const opacity = useTransform(inputs, (v: number[]) => at(v).opacity);
  const zIndex = useTransform(inputs, (v: number[]) => at(v).zIndex);
  const filter = useTransform(inputs, (v: number[]) => {
    const b = at(v).blur;
    return b < 0.05 ? "none" : `blur(${b.toFixed(2)}px)`;
  });
  const shade = useTransform(inputs, (v: number[]) => at(v).shade);
  const visibility = useTransform(pos, (p) => (Math.abs(i - p) > 3 ? "hidden" : "visible"));

  return (
    <motion.div
      className={`${styles.card} ${isActive ? styles.isActive : ""}`}
      style={{ x, z, rotateY, scale, opacity, zIndex, filter, visibility, transformPerspective: perspective }}
      role="group"
      aria-roledescription="衣橱"
      aria-label={`${i + 1} / ${n}：${c.closetName}`}
      aria-hidden={!isActive}
      onClick={() => onClick(i)}
    >
      <div
        className={styles.media}
        ref={isActive ? heroRef : undefined}
        data-vt-hero={isActive ? "" : undefined}
      >
        <picture>
          <source media={WIDE_QUERY} srcSet={c.wide} />
          <img src={handoff?.frame ?? c.poster} alt="" draggable={false} loading={eager ? "eager" : "lazy"} decoding="async" />
        </picture>
        {/* 切换中央时视频交叉淡化：新中央的视频真正开始播放后才淡入（SceneVideo），离开的那一间淡出 0.45 秒后再卸载，不硬切回首帧 */}
        <AnimatePresence>
          {playVideo && c.video ? (
            <motion.div key="video" className={styles.videoWrap} exit={{ opacity: 0, transition: { duration: 0.45, ease: "easeOut" } }}>
              <SceneVideo className={styles.video} src={c.video} poster={handoff?.frame ?? c.poster} startAt={handoff?.startAt ?? 0} />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <motion.span className={styles.shade} style={{ opacity: shade }} />
      </div>
    </motion.div>
  );
});
