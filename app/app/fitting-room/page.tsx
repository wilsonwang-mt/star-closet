import Link from "next/link";
import AutoVideo from "@/components/AutoVideo";
import LookCard from "@/components/LookCard";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { getCatalogL10n, getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/types";
import { listLooks, type Look } from "@/lib/looks";
import { localizeTryonContext, localizeTryonView } from "@/lib/tryon/l10n";
import { getTryonContext, listLookTryons } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

type CatalogL10n = Awaited<ReturnType<typeof getCatalogL10n>>;

const cleanName = (n: string) => n.replace(/^占位：/, "");

/**
 * 试衣间里一套的显示标题。标题是保存时按中文原文自动生成的（Adapter、lib/bag/core.ts lookPayload）：
 * 原搭配名、“X · 我的版本”、“X · 挑选 N 件”、“挑选的 N 件”、“整套搭配”或单品名。非中文界面按 sourceOutfitId / 单品编号
 * 换成译名后重拼；其他内容（用户自己写的）原样显示。下面的正则只用来识别这些自动生成的格式。
 */
function lookTitle(look: Look, l10n: CatalogL10n, t: Translator<"fittingRoom">): string {
  const title = look.title;
  if (l10n.locale === "zh") return title;
  const outfitName = look.sourceOutfitId ? l10n.outfit({ id: look.sourceOutfitId, name: "" }).name : "";
  if (outfitName) {
    if (look.mode === "original") return outfitName;
    if (/ · 我的版本$/.test(title)) return t("lookTitle.myVersion", { name: outfitName });
    const picked = title.match(/ · 挑选 (\d+) 件$/);
    if (picked) return t("lookTitle.pickedFrom", { name: outfitName, n: Number(picked[1]) });
  }
  if (title === "整套搭配") return t("lookTitle.outfit");
  const picked = title.match(/^挑选的 (\d+) 件$/);
  if (picked) return t("lookTitle.picked", { n: Number(picked[1]) });
  const only = look.items.length === 1 ? look.items[0] : null;
  if (only && title === cleanName(only.name)) return cleanName(l10n.item(only).name);
  return title;
}

function LifeScene({ label }: { label: string }) {
  return (
    <figure className="sc-glass card sc-rise" style={{ margin: 0, padding: 10 }}>
      <div role="img" aria-label={label} style={{ borderRadius: 16, overflow: "hidden" }}>
        <AutoVideo className="life-video" src="/scenes/life-cafe-web.mp4" poster="/scenes/life-cafe.jpg" />
      </div>
      <figcaption className="row" style={{ justifyContent: "space-between", padding: "10px 6px 2px" }}>
        <span className="sc-kicker">In Your Life</span>
        <span className="sc-meta">{label}</span>
      </figcaption>
    </figure>
  );
}

export default async function FittingRoom() {
  const [user, t] = await Promise.all([getCurrentUser(), getT("fittingRoom")]);
  if (!user) {
    return (
      <>
        <Scene dim />
        <section className="hero sc-rise" style={{ minHeight: "50dvh" }}>
          <span className="sc-kicker">The Fitting Room</span>
          <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>{t("title")}</h1>
          <p className="serif-note">{t("signedOut")}</p>
        </section>
        <div className="cta-bar">
          <Link href="/login?next=/fitting-room" className="sc-cta">
            {t("signIn")}
          </Link>
        </div>
      </>
    );
  }
  const [rawLooks, rawTryon, l10n] = await Promise.all([listLooks(user.id), getTryonContext(user.id), getCatalogL10n()]);
  // 试穿的处理方名称、错误说明与单品名按语言显示（D70）
  const tryon = localizeTryonContext(rawTryon, l10n.locale);
  // 单品名等自由文本换成当前语言；品类、颜色等固定词保持中文（试穿的品类判断按中文工作），显示时由组件翻译。
  const looks = rawLooks.map((l) => ({ ...l, title: lookTitle(l, l10n, t), items: l.items.map(l10n.item) }));
  // 逐件试穿的“穿搭进度”：一次查出本人在这些搭配上的试穿结果，按搭配分组交给每张卡片。
  const rawTryons = tryon.enabled ? await listLookTryons(user.id, looks.map((l) => l.id)) : {};
  const tryons = Object.fromEntries(
    Object.entries(rawTryons).map(([id, views]) => [id, views.map((v) => localizeTryonView(v, l10n.locale))]),
  ) as typeof rawTryons;
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "36dvh" }}>
        <span className="sc-kicker">The Fitting Room</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>{t("title")}</h1>
        <p className="serif-note">
          {looks.length ? t(tryon.enabled ? "summaryTryon" : "summary", { n: looks.length }) : t("empty")}
        </p>
      </section>
      <div className="stack">
        {looks.map((l) => (
          <LookCard key={l.id} look={l} tryon={tryon} tryons={tryons[l.id]} />
        ))}
        <LifeScene label={t("lifeScene")} />
      </div>
      {looks.length === 0 ? (
        <div className="cta-bar">
          <Link href="/" className="sc-cta">
            {t("browse")}
          </Link>
        </div>
      ) : null}
    </>
  );
}
