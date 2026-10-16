"use client";
/* eslint-disable @next/next/no-img-element -- 卡片缩略图来自本站 public/，尺寸固定，不经过 next/image */

// 对话里的 Gen UI 卡片：衣橱卡、搭配卡（横向一排）、功能页卡。只按服务端校验过的数据渲染，点击即跳转。
import Link from "next/link";
import { motion } from "motion/react";
import type { ChatCard, ClosetCard, OutfitCard, PageCard } from "@/lib/chat/protocol";
import { reducedFade, springs } from "@/lib/motion";
import styles from "./ChatDock.module.css";

const two = (n: number) => String(n).padStart(2, "0");

function Arrow() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
      <path d="M1 5h11M8.5 1.5 12 5 8.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClosetView({ c, onNavigate }: { c: ClosetCard; onNavigate: () => void }) {
  return (
    <Link href={`/closet/${c.id}`} prefetch={false} className={`sc-glass sc-glass--row ${styles.closet}`} onClick={onNavigate}>
      <span className={styles.closetCover}>
        <img src={c.cover} alt="" loading="lazy" />
        {c.avatar ? (
          <span className={styles.closetAvatar}>
            <img src={c.avatar} alt="" loading="lazy" />
          </span>
        ) : null}
      </span>
      <span className={styles.closetText}>
        <span className={styles.cardKicker}>
          {c.displayName} · {c.closetType}
        </span>
        <span className={styles.closetName}>{c.closetName}</span>
        <span className={styles.closetTag}>{c.tagline}</span>
        <span className={styles.closetGo}>
          走进衣橱 <Arrow />
        </span>
      </span>
    </Link>
  );
}

function OutfitView({ o, onNavigate }: { o: OutfitCard; onNavigate: () => void }) {
  return (
    <Link href={`/outfit/${o.id}`} prefetch={false} className={styles.outfit} onClick={onNavigate} aria-label={`${o.closetName} · ${o.name}，¥${o.total}`}>
      <span className={styles.outfitCover}>
        {o.cover ? <img src={o.cover} alt="" loading="lazy" /> : null}
        <span className={`${styles.outfitNo} sc-foil`}>N°{two(o.no)}</span>
      </span>
      <span className={styles.outfitName}>{o.name}</span>
      <span className={styles.outfitMeta}>
        <span>{o.closetName}</span>
        <b>¥{o.total}</b>
      </span>
    </Link>
  );
}

function PageView({ p, onNavigate }: { p: PageCard; onNavigate: () => void }) {
  return (
    <Link href={p.href} prefetch={false} className={`sc-glass sc-glass--row ${styles.page}`} onClick={onNavigate}>
      <span className={styles.pageText}>
        <span className={styles.cardKicker}>{p.kicker}</span>
        <span className={styles.pageTitle}>{p.title}</span>
        <span className={styles.pageDesc}>{p.desc}</span>
      </span>
      <span className={styles.pageGo} aria-hidden="true">
        <Arrow />
      </span>
    </Link>
  );
}

export default function ChatCards({
  cards,
  reduced,
  onNavigate,
}: {
  cards: ChatCard[];
  reduced: boolean;
  onNavigate: () => void;
}) {
  if (!cards.length) return null;
  const closets = cards.filter((c): c is ClosetCard => c.kind === "closet");
  const outfits = cards.filter((c): c is OutfitCard => c.kind === "outfit");
  const pages = cards.filter((c): c is PageCard => c.kind === "page");
  // 卡片组按 id 作 key：AI 精排换了卡片时整组重新浮起，而不是逐张闪动
  const key = cards.map((c) => (c.kind === "page" ? c.page : c.id)).join(",");
  const rise = (i: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: reducedFade }
      : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { ...springs.rise, delay: i * 0.05 } };
  let i = 0;
  return (
    <div className={styles.cards} key={key}>
      {closets.map((c) => (
        <motion.div key={c.id} {...rise(i++)}>
          <ClosetView c={c} onNavigate={onNavigate} />
        </motion.div>
      ))}
      {outfits.length ? (
        <motion.div className={styles.strip} role="list" aria-label="推荐搭配" {...rise(i++)}>
          {outfits.map((o) => (
            <div role="listitem" key={o.id}>
              <OutfitView o={o} onNavigate={onNavigate} />
            </div>
          ))}
        </motion.div>
      ) : null}
      {pages.map((p) => (
        <motion.div key={p.page} {...rise(i++)}>
          <PageView p={p} onNavigate={onNavigate} />
        </motion.div>
      ))}
    </div>
  );
}
