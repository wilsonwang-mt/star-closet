"use client";
/* eslint-disable @next/next/no-img-element -- 用 <picture> 按屏宽切换竖屏/横屏场景，并与共享元素过渡共用同一张图 */

// /closet/[id] 衣橱页：全屏场景（视频）+ 衣橱信息，下方是这间衣橱的全部搭配。
// 滚动叙事：场景固定在最底层，随滚动缓慢推近并压暗，第一屏文字随之淡出上移；搭配卡随滚动依次浮起；点卡片进入 /outfit/[id]。
// 滚动驱动优先用 CSS scroll-driven animations（scroll() / view()，见 ClosetExperience.module.css，合成线程执行，滚动停下画面就停下）；
// 不支持的浏览器（目前 Safari、Firefox）在挂载后改用 Motion 的 useScroll 驱动同样的 transform / opacity。服务端与首帧不带内联样式，两条路径不打架。
// 经由首页「走进衣橱」进来时，场景已由共享元素过渡放大到位：跳过进场虚焦，文字等画面到位后再浮起。
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useScroll, useTransform, type MotionValue } from "motion/react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import ItemThumb from "@/components/ItemThumb";
import LinkPending from "@/components/LinkPending";
import { QuickTryButton, QuickTryonProvider } from "@/components/tryon/QuickTryOn";
import { useLocale, useT, useTerm } from "@/lib/i18n/client";
import type { TryonContext } from "@/lib/tryon/service";
import LookActions, { PickCheck, usePick } from "./LookActions";
import type { ClosetView } from "./data";
import SceneVideo from "./SceneVideo";
import { captureHandoff, navigateWithHero, peekArrival, peekHandoff, signalHeroReady } from "./transition";
import { COLS3_QUERY, REDUCED_QUERY, WIDE_QUERY, useMedia } from "./useMedia";
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
  items: { id: string; name: string; image: string | null; color: string; category: string; displayCategory: string | null; price: number }[];
};

// 回退路径（无 CSS scroll-driven animations）的浮起区间：同一行里越靠右越晚，形成先后（与 CSS 里 animation-range 对应）
const STAGGER: Record<2 | 3, Offset[]> = {
  2: [["start end", "0.5 1"], ["-0.12 1", "0.45 1"]],
  3: [["start end", "0.5 1"], ["-0.08 1", "0.46 1"], ["-0.16 1", "0.42 1"]],
};
const two = (n: number) => String(n).padStart(2, "0");
const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;

export default function ClosetExperience({
  closet,
  looks,
  tryon = null,
}: {
  closet: ClosetView;
  looks: LookView[];
  /** 一键试穿的上下文（D67）：服务未开放时为 null 或 enabled = false，按钮不出现。 */
  tryon?: TryonContext | null;
}) {
  const router = useRouter();
  const t = useT("closet");
  const term = useTerm();
  const wide = useMedia(WIDE_QUERY);
  const reduced = useMedia(REDUCED_QUERY) === true;
  const cols = useMedia(COLS3_QUERY) ? 3 : 2;
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

  // CSS scroll-driven animations 是否可用：null = 未知（服务端与首帧），此时只靠 CSS（不支持的浏览器会忽略那些规则）
  const [cssScroll, setCssScroll] = useState<boolean | null>(null);
  useEffect(() => {
    setCssScroll(typeof CSS !== "undefined" && CSS.supports("animation-timeline: scroll()"));
  }, []);
  const jsScroll = cssScroll === false;

  // 回退路径：第一屏内镜头缓推 8%，同时压暗，让下方搭配卡清楚（与 CSS 关键帧同一组数值）
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
  const copyP = useTransform(scrollY, (y) => clamp((y - vh.current * 0.15) / (vh.current * 0.5), 0, 1));
  const copyOpacity = useTransform(copyP, (p) => 1 - p);
  const copyY = useTransform(copyP, (p) => (reduced ? 0 : p * -24));

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
    <QuickTryonProvider ctx={tryon}>
      <div className={styles.scene} aria-hidden="true">
        <div ref={heroRef} className={styles.hero} data-vt-hero="">
          <motion.div className={styles.media} style={jsScroll ? { scale: sceneScale } : undefined}>
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
          <motion.div className={styles.dim} style={jsScroll ? { opacity: sceneDim } : undefined} />
          <div className="sc-grain" />
        </div>
      </div>

      <section className={`wide-col ${styles.first}`} aria-labelledby="closet-title">
        <motion.div {...rise(0)}>
          <Link href={`/?c=${closet.id}`} className={styles.back} onClick={back}>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M13 5H2M5.5 1.5 2 5l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t("backAll")}
          </Link>
        </motion.div>
        <motion.div className={styles.copy} style={jsScroll ? { opacity: copyOpacity, y: copyY } : undefined}>
          <motion.span className="sc-kicker" {...rise(1)}>
            The Closet · {term(closet.closetType)} · {term(closet.gender)}
          </motion.span>
          <motion.h1 id="closet-title" className={`sc-display ${styles.title}`} {...rise(2)}>
            {closet.closetName}
          </motion.h1>
          <motion.div className={styles.byline} {...rise(3)}>
            <span className={styles.avatar}>
              {closet.avatar ? <img src={closet.avatar} alt="" /> : closet.displayName.slice(0, 1)}
            </span>
            <span className="sc-meta">
              {t("byline", { name: closet.displayName, n: closet.outfitCount || looks.length })}
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
            {closet.styleTags.map((tag) => (
              <span key={tag} className={styles.tag}>
                {term(tag)}
              </span>
            ))}
            {closet.palette.length ? <span className={styles.palette}>{closet.palette.map(term).join(" · ")}</span> : null}
          </motion.div>
        </motion.div>
        <motion.a href="#looks" className={styles.cue} {...rise(8)}>
          <span>{t("cue", { n: looks.length })}</span>
          <i aria-hidden="true" />
        </motion.a>
      </section>

      <section id="looks" className={`wide-col ${styles.looks}`} aria-labelledby="looks-title">
        <ScrollRise as="header" className={styles.looksHead} js={jsScroll} reduced={reduced} offset={["start end", "end 0.8"]}>
          <span className="sc-kicker">The Looks</span>
          <h2 id="looks-title" className="section-title">
            {t("looks.title", { n: looks.length })}
          </h2>
          <p className="sc-meta" style={{ margin: "6px 0 0" }}>
            {t("looks.note")}
          </p>
        </ScrollRise>
        <div className={styles.grid}>
          {looks.map((o, i) => (
            <ScrollRise
              key={o.id}
              id={`look-${o.id}`}
              className={styles.lookWrap}
              js={jsScroll}
              reduced={reduced}
              offset={STAGGER[cols][i % cols]}
            >
              <LookTile look={o} index={i} />
            </ScrollRise>
          ))}
        </div>
      </section>
    </QuickTryonProvider>
  );
}

// 一张搭配卡（D67）：封面与标题是进入搭配页的链接；下面每件单品一个缩略图，可上身的单品下方是“一键试穿”；
// 底部是放大的“整套加入试衣间”、加入购物袋与多选。交互元素都不嵌在链接里。
function LookTile({ look: o, index: i }: { look: LookView; index: number }) {
  const pick = usePick();
  const t = useT("closet");
  const term = useTerm();
  const en = useLocale() === "en";
  const name = o.name.replace(/^占位：/, "");
  const tags = [...o.occasionTags.slice(0, 3), o.budgetTier].filter(Boolean);
  return (
    <div className={`sc-glass ${styles.look}`}>
      <Link href={`/outfit/${o.id}`} className={styles.lookLink}>
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
        </div>
        <div className={`spread ${styles.lookHead}`}>
          <div className={styles.lookTitle} style={{ minWidth: 0 }}>
            <span className="sc-kicker">The Look</span>
            <h3 className={`section-title ${styles.lookName}`}>{name}</h3>
          </div>
          <span className={styles.total}>{yuan(o.total)}</span>
        </div>
        <LinkPending label={t("look.opening", { name })} />
      </Link>
      <div className={styles.body}>
        <ul className={styles.pieces} aria-label={t("look.pieces", { name })}>
          {o.items.map((it) => (
            <li key={it.id} className={`${styles.piece} ${pick.selected.has(it.id) ? styles.pieceOn : ""}`}>
              <span className={styles.pieceThumb}>
                <ItemThumb name={it.name} image={it.image} color={it.color} href={`/item/${it.id}`} />
                <PickCheck pick={pick} item={it} />
              </span>
              <QuickTryButton item={it} source={{ outfitId: o.id }} className={styles.pieceTry} />
            </li>
          ))}
        </ul>
        <div className={`spread ${styles.metaRow}`}>
          {/* 英文每个词包一层不拆行的 span（如 “Mid-range”）；中文仍是一整段文字，渲染与原来逐像素一致 */}
          <span className="sc-meta">
            {en
              ? tags.map((tag, k) => (
                  <Fragment key={k}>
                    {k ? " · " : ""}
                    <span className={styles.metaTerm}>{term(tag)}</span>
                  </Fragment>
                ))
              : tags.map(term).join(" · ")}
          </span>
          <Link href={`/outfit/${o.id}`} className={styles.go}>
            {t("look.go")}
            <svg width="12" height="9" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M1 5h11M8.5 1.5 12 5 8.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
        <LookActions items={o.items} pick={pick} outfitId={o.id} compactBag />
      </div>
    </div>
  );
}

// 随滚动浮起：CSS 支持时只输出带类名的普通元素（动画在 CSS 里，animation-timeline: view()）；
// 不支持时用 useScroll 跟踪元素进入视口的进度，驱动同样的位移、缩放与透明度。减弱动态时只改透明度。
type Offset = NonNullable<Parameters<typeof useScroll>[0]>["offset"];
function ScrollRise({
  as = "div",
  js,
  reduced,
  offset,
  className,
  id,
  children,
}: {
  as?: "div" | "header";
  js: boolean;
  reduced: boolean;
  offset: Offset;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  const Tag = as;
  if (!js) {
    return (
      <Tag id={id} className={className}>
        {children}
      </Tag>
    );
  }
  return (
    <ScrollRiseJs as={as} reduced={reduced} offset={offset} className={className} id={id}>
      {children}
    </ScrollRiseJs>
  );
}

function ScrollRiseJs({
  as,
  reduced,
  offset,
  className,
  id,
  children,
}: {
  as: "div" | "header";
  reduced: boolean;
  offset: Offset;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset });
  // 与 CSS 里 look-rise 的 cubic-bezier(.2,.7,.2,1) 近似的缓出
  const eased: MotionValue<number> = useTransform(scrollYProgress, (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3));
  const opacity = eased;
  const y = useTransform(eased, (e) => (reduced ? 0 : (1 - e) * 56));
  const scale = useTransform(eased, (e) => (reduced ? 1 : 0.96 + e * 0.04));
  const Comp = as === "header" ? motion.header : motion.div;
  return (
    <Comp ref={ref as React.RefObject<HTMLDivElement>} id={id} className={className} style={{ opacity, y, scale }}>
      {children}
    </Comp>
  );
}
