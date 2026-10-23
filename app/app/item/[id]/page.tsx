import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddToBag from "@/components/item/AddToBag";
import LookGallery from "@/components/item/LookGallery";
import { QuickTryButton, QuickTryonProvider } from "@/components/tryon/QuickTryOn";
import LinkPending from "@/components/LinkPending";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { LOCALE_META } from "@/lib/i18n/config";
import { localizeServerText } from "@/lib/i18n/phrases";
import { getCatalogL10n, getT } from "@/lib/i18n/server";
import { localizeSceneState } from "@/lib/scene/l10n";
import { demoScenesFor, readDemoManifest } from "@/lib/scene/scenes";
import { getSceneState } from "@/lib/scene/service";
import { isAccessory } from "@/lib/tryon/accessory";
import { isWearable } from "@/lib/tryon/plan";
import { localizeTryonContext, localizeTryonView } from "@/lib/tryon/l10n";
import { getItemTryon, getTryonContext, type TryonView } from "@/lib/tryon/service";
import { getItemDetail } from "./data";
import s from "./page.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const clean = (n: string) => n.replace(/^占位：/, "");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const d = await getItemDetail(id).catch(() => null);
  return d ? { title: clean(d.item.name) } : {};
}

// 商品详情页（T3）：首屏商品大图与信息、一键试穿（D67 首屏可见）与加入购物袋；“上身效果”画廊（本人 / 演示模特）；这件出现在哪些搭配里。
export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const [detail, user, l10n, t] = await Promise.all([getItemDetail(id), getCurrentUser(), getCatalogL10n(), getT("item")]);
  if (!detail) notFound();
  const term = l10n.term;
  const yuan = (n: number) => `¥${n.toLocaleString(LOCALE_META[l10n.locale].intl)}`;
  const { item, curator, outfits } = detail;
  // 上身效果查询失败（如数据库还没有执行迁移 0004）时不影响页面：退回演示模特画廊，不显示生成入口。
  const sceneFallback = { enabled: false, signedIn: !!user, hasFrontPhoto: false, consented: false, renders: [] };
  const [rawScene, rawDemo, manifest, rawCtx, rawTryon] = await Promise.all([
    getSceneState(user?.id ?? null, item.id).catch((e: unknown) => {
      console.error("[scene]", e instanceof Error ? e.message : "unknown error");
      return sceneFallback;
    }),
    demoScenesFor(item.id),
    readDemoManifest(),
    getTryonContext(user?.id ?? null).catch(() => null),
    user ? getItemTryon(user.id, item.id).catch(() => null as TryonView | null) : Promise.resolve(null),
  ]);
  // 服务端给出的文字（处理方名称、场景标题、存库的失败说明、单品名）按当前语言换，与接口返回的一致。
  const { locale } = l10n;
  const sceneState = localizeSceneState(rawScene, locale);
  const demo = rawDemo.map((d) => ({ ...d, title: localizeServerText(locale, d.title) }));
  const tryonCtx = rawCtx ? localizeTryonContext(rawCtx, locale) : null;
  const itemTryon = rawTryon ? localizeTryonView(rawTryon, locale) : null;
  // 一键试穿（D63）：上装 / 下装 / 外套 / 连衣裙 / 鞋 / 包 / 配饰，有单品图才显示。
  const accessory = isAccessory(item);
  const quick = tryonCtx
    ? {
        enabled: tryonCtx.enabled,
        supported: !!item.image && (isWearable(item) || accessory),
        accessory,
        baseUrl: tryonCtx.frontPhotoUrl,
        isTwin: tryonCtx.baseSource === "twin",
        providerName: tryonCtx.providerName,
        initial: itemTryon,
      }
    : null;
  const demoModel = manifest?.items?.[item.id]?.model;
  const name = clean(item.name);
  // 颜色、材质、尺码、版型、季节都是目录固定词：显示时按当前语言翻译
  const facts: [string, string][] = [
    [t("facts.color"), term(item.color)],
    ...(item.material ? ([[t("facts.material"), term(item.material)]] as [string, string][]) : []),
    ...(item.sizes.length ? ([[t("facts.size"), item.sizes.map(term).join(" / ")]] as [string, string][]) : []),
    ...(item.fit ? ([[t("facts.fit"), term(item.fit)]] as [string, string][]) : []),
    ...(item.season ? ([[t("facts.season"), term(item.season)]] as [string, string][]) : []),
  ];

  return (
    <QuickTryonProvider ctx={tryonCtx}>
      <Scene dim cover={curator?.cover ?? null} />
      <div className={s.page}>
        {curator ? (
          <Link href={`/closet/${curator.id}`} className="back-link sc-rise">
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
              <path d="M13 5H2M5.5 1.5 2 5l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {clean(curator.closetName)}
            <LinkPending />
          </Link>
        ) : null}

        <section className={`${s.hero} sc-rise`} aria-labelledby="item-title">
          <div className={`sc-glass ${s.stage}`}>
            <span className={s.spot} aria-hidden="true" />
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={s.product} src={item.image} alt={name} fetchPriority="high" decoding="async" />
            ) : (
              <div className={s.swatch}>{term(item.color)}</div>
            )}
          </div>

          <div className={`sc-glass ${s.info}`}>
            <span className="sc-kicker">{term(item.subcategory ?? item.displayCategory ?? item.category)}</span>
            <h1 id="item-title" className={s.name}>
              {name}
            </h1>
            <div className={s.priceRow}>
              <span className={`sc-number sc-foil ${s.price}`}>{yuan(item.price)}</span>
              {item.priceNote ? <span className="sc-meta">{t("priceNote")}</span> : null}
            </div>
            <dl className={s.facts}>
              {facts.map(([k, v]) => (
                <div key={k} className={s.fact}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              {curator ? (
                <div className={s.fact}>
                  <dt>{t("facts.closet")}</dt>
                  <dd>
                    <Link href={`/closet/${curator.id}`} className={s.closetLink}>
                      {clean(curator.closetName)} · {curator.displayName}
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
            {item.sizeNote ? <p className="sc-meta">{item.sizeNote}</p> : null}
            <div className={s.buy}>
              <QuickTryButton item={item} size="lg" className={s.try} />
              <AddToBag itemId={item.id} sizes={item.sizes ?? []} />
            </div>
          </div>
        </section>

        <div className={s.block}>
          <LookGallery
            itemId={item.id}
            itemName={name}
            initial={sceneState}
            demo={demo}
            demoModelLabel={demoModel ? t("demoModelAi") : t("demoModel")}
            quick={quick}
          />
        </div>

        {outfits.length ? (
          <section className={s.block} aria-labelledby="item-outfits">
            <span className="sc-kicker">In The Looks</span>
            <h2 id="item-outfits" className={s.blockTitle}>
              {t("inLooks.title")}
            </h2>
            <ul className={s.looks}>
              {outfits.map((o) => (
                <li key={o.id}>
                  <Link href={`/outfit/${o.id}`} className={`sc-glass ${s.look}`}>
                    {o.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={s.lookCover} src={o.cover} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <span className={s.lookCover} aria-hidden="true" />
                    )}
                    <span className={s.lookText}>
                      <span className="sc-meta">
                        {o.closetName}
                        {o.number ? ` · N°${String(o.number).padStart(2, "0")}` : ""}
                      </span>
                      <span className={s.lookName}>{o.name}</span>
                      <span className="sc-meta">{t("inLooks.total", { price: yuan(o.total) })}</span>
                    </span>
                    <LinkPending />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </QuickTryonProvider>
  );
}
