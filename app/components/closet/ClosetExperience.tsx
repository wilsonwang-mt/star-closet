"use client";
/* eslint-disable @next/next/no-img-element -- 用 <picture> 按屏宽切换竖屏/横屏场景，并与共享元素过渡共用同一张图 */

// /closet/[id] 衣橱页：全屏场景（视频）+ 衣橱信息，下方是这间衣橱的全部搭配。
// 滚动叙事：场景固定在最底层，随滚动缓慢推近并压暗；搭配卡按顺序浮起；点卡片进入 /outfit/[id]。
// 经由首页「走进衣橱」进来时，场景已由共享元素过渡放大到位：跳过进场虚焦，文字等画面到位后再浮起。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useScroll, useTransform } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import ItemThumb from "@/components/ItemThumb";
import type { ClosetView } from "./data";
import SceneVideo from "./SceneVideo";
import { captureHandoff, navigateWithHero, peekArrival, peekHandoff, signalHeroReady } from "./transition";
import { REDUCED_QUERY, WIDE_QUERY, useMedia } from "./useMedia";
import { clamp, reducedFade, springCss, springs } from "@/lib/motion";
import styles from "./ClosetExperience.module.css";

export type LookView = {
  id: string;
  name: string;
  cover: string | null;
  coverNote: string | null;
  occasionTags: string[];
  budgetTier: string | null;
  season: string | null;
  total: number;
  items: { id: string; name: string; image: string | null; color: string }[];
};

const two = (n: number) => String(n).padStart(2, "0");
const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;

export default function ClosetExperience({ closet, looks }: { closet: ClosetView; looks: LookView[] }) {
  const router = useRouter();
  const wide = useMedia(WIDE_QUERY);
  const reduced = useMedia(REDUCED_QUERY) === true;
  // 只在客户端导航时有值；服务端与首次加载都是 null，不会造成水合不一致
  const [arrival] = useState(() => (typeof window === "undefined" ? null : peekArrival()));
  // 首页定格的那一帧：先显示它，视频从同一时刻接着播（过渡前后同一画面，没有重影）
  const [handoff] = useState(() => (typeof window === "undefined" ? null : peekHandoff(closet.id)));
  const poster = handoff?.frame ?? closet.poster;
  const heroRef = useRef<HTMLDivElement>(null);

  // 场景已挂进 DOM：放行共享元素过渡的截图
  useLayoutEffect(() => {
    signalHeroReady();
  }, []);

  // 滚动驱动：第一屏内镜头缓推 8%，同时压暗，让下方搭配卡清楚
  const { scrollY } = useScroll();
  const vh = useRef(800);
  useLayoutEffect(() => {
    const set = () => (vh.current = window.innerHeight || 800);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);
  const sceneScale = useTransform(scrollY, (y) => (reduced ? 1 : 1 + clamp(y / vh.current, 0, 1.4) * 0.08));
  const sceneDim = useTransform(scrollY, (y) => clamp((y - vh.current * 0.1) / (vh.current * 0.8), 0, 1) * 0.66);

  const viaHero = arrival === "enter";
  // 经由共享元素过渡进来：等画面放大到位（过渡结束）后文字再浮起；过渡期间场景盖在最上层
  const base = viaHero ? springCss(springs.enter).duration / 1000 + 0.05 : 0.35;
  const rise = (i: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { ...reducedFade, delay: 0.1 } }
      : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { ...springs.rise, delay: base + i * 0.07 } };

  const back = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    captureHandoff(closet.id, heroRef.current);
    navigateWithHero(router, `/?c=${closet.id}`, "back", heroRef.current);
  };

  return (
    <>
      <div className={styles.scene} aria-hidden="true">
        <div ref={heroRef} className={styles.hero} data-vt-hero="">
          <motion.div className={styles.media} style={{ scale: sceneScale }}>
            <div className={`${styles.layer} ${viaHero || reduced ? "" : styles.introScene}`}>
              <picture>
                <source media={WIDE_QUERY} srcSet={closet.wide} />
                <img src={poster} alt="" />
              </picture>
              {wide === false && !reduced && closet.video ? (
                <SceneVideo className={styles.video} src={closet.video} poster={poster} startAt={handoff?.startAt ?? 0} />
              ) : null}
            </div>
          </motion.div>
          {/* 氛围层放在共享元素里面：过渡期间与画面一起放大，结束时不会突然盖上来 */}
          <div className="sc-scene__vignette" />
          <div className="sc-beam scene-night-only" />
          <div className="sc-scene__fade-top" />
          <div className="sc-scene__fade-bottom" />
          <div className={styles.scrim} />
          <motion.div className={styles.dim} style={{ opacity: sceneDim }} />
          <div className="sc-grain" />
        </div>
      </div>

      <section className={styles.first} aria-labelledby="closet-title">
        <motion.div {...rise(0)}>
          <Link href={`/?c=${closet.id}`} className={styles.back} onClick={back}>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M13 5H2M5.5 1.5 2 5l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            全部衣橱
          </Link>
        </motion.div>
        <div className={styles.copy}>
          <motion.span className="sc-kicker" {...rise(1)}>
            The Closet · {closet.closetType} · {closet.gender}
          </motion.span>
          <motion.h1 id="closet-title" className={`sc-display ${styles.title}`} {...rise(2)}>
            {closet.closetName}
          </motion.h1>
          <motion.div className={styles.byline} {...rise(3)}>
            <span className={styles.avatar}>
              {closet.avatar ? <img src={closet.avatar} alt="" /> : closet.displayName.slice(0, 1)}
            </span>
            <span className="sc-meta">
              主理人 · {closet.displayName} · {closet.outfitCount || looks.length} 套搭配
            </span>
          </motion.div>
          <motion.p className={styles.tagline} {...rise(4)}>
            {closet.tagline}
          </motion.p>
          {closet.intro && closet.intro !== closet.tagline ? (
            <motion.p className={`serif-note ${styles.intro}`} {...rise(5)}>
              {closet.intro}
            </motion.p>
          ) : null}
          <motion.div className={styles.tags} {...rise(6)}>
            {closet.styleTags.map((t) => (
              <span key={t} className={styles.tag}>
                {t}
              </span>
            ))}
            {closet.palette.length ? <span className={styles.palette}>{closet.palette.join(" · ")}</span> : null}
          </motion.div>
          <motion.span className={`sc-badge ${styles.badge}`} {...rise(7)}>
            {closet.personaNote || "虚构示例主理人 · AI 生成场景示意"}
          </motion.span>
        </div>
        <motion.a href="#looks" className={styles.cue} {...rise(8)}>
          <span>向下浏览 {looks.length} 套搭配</span>
          <i aria-hidden="true" />
        </motion.a>
      </section>

      <section id="looks" className={styles.looks} aria-labelledby="looks-title">
        <motion.header
          className={styles.looksHead}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "0px 0px -10% 0px" }}
          transition={reduced ? reducedFade : springs.rise}
        >
          <span className="sc-kicker">The Looks</span>
          <h2 id="looks-title" className="section-title">
            这间衣橱的 {looks.length} 套搭配
          </h2>
          <p className="sc-meta" style={{ margin: "6px 0 0" }}>
            点一套，查看单品、一句话改编，再去商家页面购买。
          </p>
        </motion.header>
        <div className={styles.grid}>
          {looks.map((o, i) => (
            <motion.div
              key={o.id}
              id={`look-${o.id}`}
              className={styles.lookWrap}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, margin: "0px 0px -8% 0px" }}
              transition={reduced ? reducedFade : { ...springs.rise, delay: (i % 2) * 0.08 }}
            >
              <Link href={`/outfit/${o.id}`} className={`sc-glass ${styles.look}`}>
                <div className={styles.cover}>
                  {o.cover ? (
                    <img src={o.cover} alt="" loading={i < 2 ? "eager" : "lazy"} decoding="async" />
                  ) : (
                    <div className={styles.coverEmpty}>
                      {o.items.slice(0, 4).map((it) => (
                        <ItemThumb key={it.id} name={it.name} image={it.image} color={it.color} />
                      ))}
                    </div>
                  )}
                  <span className={`sc-number sc-foil ${styles.no}`}>N°{two(i + 1)}</span>
                  {o.coverNote ? <span className={styles.coverNote}>{o.coverNote}</span> : null}
                </div>
                <div className={styles.body}>
                  <div className="spread">
                    <div style={{ minWidth: 0 }}>
                      <span className="sc-kicker">The Look</span>
                      <h3 className={`section-title ${styles.lookName}`}>{o.name.replace(/^占位：/, "")}</h3>
                    </div>
                    <span className={styles.total}>{yuan(o.total)}</span>
                  </div>
                  <div className={`thumbs ${styles.thumbs}`}>
                    {o.items.map((it) => (
                      <ItemThumb key={it.id} name={it.name} image={it.image} color={it.color} />
                    ))}
                  </div>
                  <div className="spread">
                    <span className="sc-meta">{[...o.occasionTags.slice(0, 3), o.budgetTier].filter(Boolean).join(" · ")}</span>
                    <span className={styles.go}>
                      查看与改编
                      <svg width="12" height="9" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                        <path d="M1 5h11M8.5 1.5 12 5 8.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </>
  );
}
