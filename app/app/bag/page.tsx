import type { Metadata } from "next";
import Link from "next/link";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { listBag } from "@/lib/bag/service";
import BagList from "./BagList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "购物袋" };

// 购物袋（D67）：站内下单的前一步。列出单品（图、名、尺码、单价、数量）与合计；结算与付款这次不做，页面底部只有合计。
export default async function BagPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <Scene dim />
        <section className="hero sc-rise" style={{ minHeight: "50dvh" }}>
          <span className="sc-kicker">The Bag</span>
          <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>购物袋</h1>
          <p className="serif-note">登录后，加入购物袋的单品会保存在你的账号里。</p>
        </section>
        <div className="cta-bar">
          <Link href="/login?next=/bag" className="sc-cta">
            登录 / 注册
          </Link>
        </div>
      </>
    );
  }
  const bag = await listBag(user.id);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "30dvh" }}>
        <span className="sc-kicker">The Bag</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>购物袋</h1>
      </section>
      <BagList initial={bag} />
    </>
  );
}
