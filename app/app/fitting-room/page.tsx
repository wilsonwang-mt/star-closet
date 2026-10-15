import Link from "next/link";
import AutoVideo from "@/components/AutoVideo";
import LookCard from "@/components/LookCard";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { listLooks } from "@/lib/looks";

export const dynamic = "force-dynamic";

function LifeScene() {
  return (
    <figure className="sc-glass card sc-rise" style={{ margin: 0, padding: 10 }}>
      <div role="img" aria-label="AI 生成的咖啡馆生活场景示意" style={{ borderRadius: 16, overflow: "hidden" }}>
        <AutoVideo className="life-video" src="/scenes/life-cafe-web.mp4" poster="/scenes/life-cafe.jpg" />
      </div>
      <figcaption className="row" style={{ justifyContent: "space-between", padding: "10px 6px 2px" }}>
        <span className="sc-meta">生活场景 · 即将上线</span>
        <span className="sc-badge">AI 生成场景示意 · 合身未验证</span>
      </figcaption>
    </figure>
  );
}

export default async function FittingRoom() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <Scene dim />
        <section className="hero sc-rise" style={{ minHeight: "50dvh" }}>
          <span className="sc-kicker">The Fitting Room</span>
          <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>个人试衣间</h1>
          <p className="serif-note">登录后，加入试衣间的搭配会保存在你的账号里。</p>
        </section>
        <div className="cta-bar">
          <Link href="/login?next=/fitting-room" className="sc-cta">
            登录 / 注册
          </Link>
        </div>
      </>
    );
  }
  const looks = await listLooks(user.id);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "36dvh" }}>
        <span className="sc-kicker">The Fitting Room</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>个人试衣间</h1>
        <p className="serif-note">
          {looks.length ? `${looks.length} 套搭配。勾选想买的单品，生成购物清单。` : "还是空的，去衣橱里挑一套吧。"}
        </p>
      </section>
      <div className="stack">
        {looks.map((l) => (
          <LookCard key={l.id} look={l} />
        ))}
        <LifeScene />
      </div>
      {looks.length === 0 ? (
        <div className="cta-bar">
          <Link href="/" className="sc-cta">
            去逛衣橱
          </Link>
        </div>
      ) : null}
    </>
  );
}
