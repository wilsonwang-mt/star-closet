import type { Metadata } from "next";
import Link from "next/link";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { listBag, localizeBag } from "@/lib/bag/service";
import { getLocale, getT } from "@/lib/i18n/server";
import BagList from "./BagList";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("bag");
  return { title: t("title") };
}

// 购物袋（D67）：站内下单的前一步。列出单品（图、名、尺码、单价、数量）与合计；结算与付款这次不做，页面底部只有合计。
export default async function BagPage() {
  const [user, t] = await Promise.all([getCurrentUser(), getT("bag")]);
  if (!user) {
    return (
      <>
        <Scene dim />
        <section className="hero sc-rise" style={{ minHeight: "50dvh" }}>
          <span className="sc-kicker">The Bag</span>
          <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>{t("title")}</h1>
          <p className="note-text">{t("signedOut")}</p>
        </section>
        <div className="cta-bar">
          <Link href="/login?next=/bag" className="sc-cta">
            {t("signIn")}
          </Link>
        </div>
      </>
    );
  }
  // 单品名按当前语言换成译名，与 /api/bag 的返回一致（品类、颜色是固定词，在 BagList 里用 useTerm 显示）。
  const [raw, locale] = await Promise.all([listBag(user.id), getLocale()]);
  const bag = localizeBag(raw, locale);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "30dvh" }}>
        <span className="sc-kicker">The Bag</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>{t("title")}</h1>
      </section>
      <BagList initial={bag} />
    </>
  );
}
