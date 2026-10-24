"use client";
/* eslint-disable @next/next/no-img-element -- 目录图已是固定尺寸的 webp，与首页、衣橱页同样用原生 img */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LinkPending from "@/components/LinkPending";
import type { ClosetView } from "@/components/closet/data";
import { useT, useTerm } from "@/lib/i18n/client";
import s from "./ClosetDirectory.module.css";

// 全部衣橱目录页（/closets，D71）：首页改为“轮播 + 按场合整套”后，仍要能一眼看到全部衣橱并筛选。
// 按性别、衣橱类型（F01 五类发现入口）、风格筛选；条件写进网址（可分享、返回时还原），只在浏览器端过滤，不重新请求。
// 与另一组条件组合后没有结果的选项置灰（与首页筛选同一规则）。

const GENDERS = ["女装", "男装", "中性"];
const TYPE_ORDER = ["风格主题", "穿搭博主", "个人主理人", "品牌主题", "明星"];

export type DirectoryFilters = { gender: string | null; type: string | null; style: string | null };

export default function ClosetDirectory({ closets, initial }: { closets: ClosetView[]; initial: DirectoryFilters }) {
  const t = useT("home");
  const term = useTerm();
  const [gender, setGender] = useState(initial.gender);
  const [ctype, setCtype] = useState(initial.type);
  const [style, setStyle] = useState(initial.style);

  const genders = useMemo(() => GENDERS.filter((g) => closets.some((c) => c.gender === g)), [closets]);
  const types = useMemo(() => TYPE_ORDER.filter((x) => closets.some((c) => c.closetType === x)), [closets]);
  // 风格：按出现次数排，最多 10 个，避免一长串
  const styles = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of closets) for (const st of c.styleTags) n.set(st, (n.get(st) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([st]) => st);
  }, [closets]);

  const match = (c: ClosetView, f: DirectoryFilters) =>
    (!f.gender || c.gender === f.gender) && (!f.type || c.closetType === f.type) && (!f.style || c.styleTags.includes(f.style));
  const countWith = (f: DirectoryFilters) => closets.filter((c) => match(c, f)).length;
  const current = { gender, type: ctype, style };
  const list = closets.filter((c) => match(c, current));

  // 条件写进网址：只替换当前历史记录，不新增一条
  useEffect(() => {
    const q = new URLSearchParams();
    if (gender) q.set("gender", gender);
    if (ctype) q.set("type", ctype);
    if (style) q.set("style", style);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `/closets?${qs}` : "/closets");
  }, [gender, ctype, style]);

  function chip(label: string, active: boolean, disabled: boolean, onClick: () => void, key: string) {
    return (
      <button
        key={key}
        type="button"
        className={s.chip}
        aria-pressed={active}
        aria-disabled={disabled || undefined}
        title={disabled ? t("filters.noMatch") : undefined}
        onClick={() => {
          if (!disabled) onClick();
        }}
      >
        {label}
      </button>
    );
  }

  const filtered = Boolean(gender || ctype || style);
  return (
    <section className={s.root} aria-labelledby="directory-title">
      <header className={s.head}>
        <span className="sc-kicker">The Closets</span>
        <h1 id="directory-title" className={s.title}>
          {t("directory.title")}
        </h1>
        <p className={s.lead}>{t("directory.lead")}</p>
      </header>

      <div className={s.filters} role="group" aria-label={t("filters.aria")}>
        <div className={s.row} role="toolbar" aria-label={t("directory.byGenderType")}>
          {chip(t("filters.all"), !gender && !ctype, false, () => {
            setGender(null);
            setCtype(null);
          }, "all")}
          {genders.map((g) =>
            chip(term(g), gender === g, gender !== g && countWith({ ...current, gender: g }) === 0, () => setGender(gender === g ? null : g), g),
          )}
          <span className={s.sep} aria-hidden="true" />
          {types.map((x) =>
            chip(term(x), ctype === x, ctype !== x && countWith({ ...current, type: x }) === 0, () => setCtype(ctype === x ? null : x), x),
          )}
        </div>
        <div className={s.row} role="toolbar" aria-label={t("directory.byStyle")}>
          <span className={s.rowLabel}>{t("directory.style")}</span>
          {styles.map((st) =>
            chip(term(st), style === st, style !== st && countWith({ ...current, style: st }) === 0, () => setStyle(style === st ? null : st), st),
          )}
        </div>
      </div>

      <div className={s.status} aria-live="polite">
        <span>{filtered ? t("directory.countFiltered", { shown: list.length, total: closets.length }) : t("directory.count", { n: closets.length })}</span>
        {filtered ? (
          <button
            type="button"
            className={s.reset}
            onClick={() => {
              setGender(null);
              setCtype(null);
              setStyle(null);
            }}
          >
            {t("directory.reset")}
          </button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <p className={s.empty}>{t("empty.note")}</p>
      ) : (
        <ul className={s.grid}>
          {list.map((c, i) => (
            <li key={c.id}>
              <Link href={`/closet/${c.id}`} className={s.card} aria-label={t("directory.enterAria", { name: c.closetName })}>
                <span className={s.media}>
                  <img src={c.poster} alt="" loading={i < 3 ? "eager" : "lazy"} decoding="async" />
                  <span className={s.avatar}>{c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : null}</span>
                </span>
                <span className={s.text}>
                  <span className={s.meta}>
                    {c.displayName} · {term(c.closetType)}
                  </span>
                  <span className={s.name}>{c.closetName}</span>
                  {c.tagline ? <span className={s.tagline}>{c.tagline}</span> : null}
                  <span className={s.foot}>
                    <span>{t("directory.looks", { n: c.outfitCount })}</span>
                    <span className={s.tags}>{c.styleTags.slice(0, 3).map(term).join(" · ")}</span>
                  </span>
                </span>
                <LinkPending />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
