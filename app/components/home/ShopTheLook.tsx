"use client";
/* eslint-disable @next/next/no-img-element -- 目录图已是固定尺寸的 webp，与衣橱页、轮播同样用原生 img */

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { CHAT_OPEN_EVENT } from "@/components/chat/ChatDock";
import LookActions, { PickCheck, usePick } from "@/components/closet/LookActions";
import ItemThumb from "@/components/ItemThumb";
import { QuickTryButton, QuickTryonProvider } from "@/components/tryon/QuickTryOn";
import { useT, useTerm } from "@/lib/i18n/client";
import { reducedFade } from "@/lib/motion";
import type { TryonContext } from "@/lib/tryon/service";
import type { EditGroup, EditLook } from "@/lib/home/edit";
import s from "./ShopTheLook.module.css";

// 首页第二部分「按场合，整套穿走」（D71）：取代原来的衣橱索引列表（与上方轮播重复、不能直接行动）。
// 按场合切换；每个场合一套主推（大图 + 逐件单品、价格、一键试穿 + 整套加入试衣间 / 购物袋），其余几套做成卡片。
// 一键试穿与加入试衣间沿用衣橱页同一套组件（QuickTryButton、LookActions，D67），行为一致。

const yuan = (n: number) => `¥${n.toLocaleString("zh-CN")}`;

function SparkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5 9.5 6.5 14.5 8 9.5 9.5 8 14.5 6.5 9.5 1.5 8 6.5 6.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

export default function ShopTheLook({ groups, tryon }: { groups: EditGroup[]; tryon: TryonContext | null }) {
  const t = useT("home");
  const term = useTerm();
  const reduced = useReducedMotion() === true;
  const [active, setActive] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);
  if (groups.length === 0) return null;
  const index = Math.min(active, groups.length - 1);
  const group = groups[index];
  const [feature, ...more] = group.looks;
  const occasion = term(group.occasion);

  // 标签页键盘：左右方向键切换并移动焦点，Home / End 到两端（WAI-ARIA tabs）
  function onTabsKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: groups.length - 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const next = (keys[e.key] + groups.length) % groups.length;
    setActive(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <QuickTryonProvider ctx={tryon}>
      <section id="looks" className={s.root} aria-labelledby="edit-title">
        <div className={s.inner}>
          <header className={s.head}>
            <div className={s.headText}>
              <span className="sc-kicker">The Edit</span>
              <h2 id="edit-title" className={s.title}>
                {t("edit.title")}
              </h2>
              <p className={s.lead}>{t("edit.lead")}</p>
            </div>
            <button type="button" className={s.ask} onClick={() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT))}>
              <SparkIcon />
              {t("edit.ask")}
            </button>
          </header>

          <div ref={tabsRef} role="tablist" aria-label={t("edit.tabsAria")} className={s.tabs} onKeyDown={onTabsKey}>
            {groups.map((g, i) => (
              <button
                key={g.occasion}
                type="button"
                role="tab"
                id={`edit-tab-${i}`}
                aria-selected={i === index}
                aria-controls="edit-panel"
                tabIndex={i === index ? 0 : -1}
                className={s.tab}
                onClick={() => setActive(i)}
              >
                {term(g.occasion)}
              </button>
            ))}
          </div>

          <div id="edit-panel" role="tabpanel" aria-labelledby={`edit-tab-${index}`} className={s.panel}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={group.occasion}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0, transition: reducedFade } : { opacity: 0, y: -6, transition: { duration: 0.16 } }}
                transition={reduced ? reducedFade : { duration: 0.42, ease: [0.2, 0.7, 0.2, 1] }}
              >
                <Feature look={feature} />
                {more.length ? (
                  <>
                    <div className={s.moreHead}>
                      <span className={s.moreTitle}>{t("edit.more", { occasion })}</span>
                    </div>
                    <ul className={s.more}>
                      {more.map((l) => (
                        <li key={l.id}>
                          <MoreCard look={l} />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>
    </QuickTryonProvider>
  );
}

/** 主推的一套：左大图，右边主理人、名称、搭配说明、逐件单品（价格 + 一键试穿 + 多选）与整套操作。 */
function Feature({ look }: { look: EditLook }) {
  const t = useT("home");
  const term = useTerm();
  const pick = usePick();
  return (
    <article className={`sc-glass ${s.feature}`}>
      <Link href={`/outfit/${look.id}`} className={s.cover} aria-label={t("edit.viewLookAria", { name: look.name })}>
        {look.cover ? <img src={look.cover} alt="" loading="lazy" decoding="async" /> : null}
      </Link>
      <div className={s.body}>
        <Link href={`/closet/${look.curator.id}`} className={s.curator}>
          <span className={s.avatar}>{look.curator.avatar ? <img src={look.curator.avatar} alt="" loading="lazy" /> : null}</span>
          <span className={s.curatorText}>
            <span className={s.curatorName}>{look.curator.displayName}</span>
            <span className={s.curatorMeta}>
              {look.curator.closetName} · {term(look.curator.closetType)}
            </span>
          </span>
        </Link>
        <h3 className={s.lookName}>
          <Link href={`/outfit/${look.id}`}>{look.name}</Link>
        </h3>
        <p className={s.note}>{look.styleNote}</p>

        <div className={s.piecesHead}>
          <span className={s.piecesTitle}>{t("edit.pieces", { n: look.items.length })}</span>
        </div>
        <ul className={s.pieces} aria-label={t("edit.piecesAria", { name: look.name })}>
          {look.items.map((it) => (
            <li key={it.id} className={`${s.piece} ${pick.selected.has(it.id) ? s.pieceOn : ""}`}>
              <span className={s.pieceThumb}>
                <ItemThumb name={it.name} image={it.image} color={it.color} href={`/item/${it.id}`} />
                <PickCheck pick={pick} item={it} />
              </span>
              <span className={s.pieceText}>
                <Link href={`/item/${it.id}`} className={s.pieceName}>
                  {it.name}
                </Link>
                <span className={s.piecePrice}>{yuan(it.price)}</span>
                <QuickTryButton item={it} source={{ outfitId: look.id, outfitName: look.name }} className={s.pieceTry} />
              </span>
            </li>
          ))}
        </ul>

        <div className={s.totalRow}>
          <span className={s.totalLabel}>{t("edit.total")}</span>
          <span className={`sc-foil ${s.total}`}>{yuan(look.total)}</span>
        </div>
        <LookActions items={look.items} pick={pick} outfitId={look.id} outfitName={look.name} />
        <Link href={`/outfit/${look.id}`} className={s.view}>
          {t("edit.viewLook")}
          <svg width="12" height="9" viewBox="0 0 14 10" fill="none" aria-hidden="true">
            <path d="M1 5h11M8.5 1.5 12 5 8.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </article>
  );
}

/** 同一场合的其他几套：封面、所属衣橱、名称、件数与总价，整张卡进入搭配页。 */
function MoreCard({ look }: { look: EditLook }) {
  const t = useT("home");
  return (
    <Link href={`/outfit/${look.id}`} className={s.card}>
      <span className={s.cardImg}>{look.cover ? <img src={look.cover} alt="" loading="lazy" decoding="async" /> : null}</span>
      <span className={s.cardText}>
        <span className={s.cardCloset}>{look.curator.closetName}</span>
        <span className={s.cardName}>{look.name}</span>
        <span className={s.cardMeta}>
          {t("edit.cardPieces", { n: look.items.length })}
          <b>{yuan(look.total)}</b>
        </span>
      </span>
    </Link>
  );
}
