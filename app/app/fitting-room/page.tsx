import Link from "next/link";
import AutoVideo from "@/components/AutoVideo";
import LookCard from "@/components/LookCard";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { getCatalogL10n, getT } from "@/lib/i18n/server";
import { listLooks } from "@/lib/looks";
import { localizeLook } from "@/lib/looks-l10n";
import { localizeTryonContext, localizeTryonView } from "@/lib/tryon/l10n";
import { getTryonContext, listLookTryons } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

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
          <p className="note-text">{t("signedOut")}</p>
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
  // 自动标题（存的是中文）按当前语言重算，单品名等自由文本换成当前语言（lib/looks-l10n.ts）；
  // 品类、颜色等固定词保持中文（试穿的品类判断按中文工作），显示时由组件翻译。
  const looks = rawLooks.map((l) => localizeLook(l, l10n.locale));
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
        <p className="note-text">
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
