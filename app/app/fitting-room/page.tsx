import Link from "next/link";
import AutoVideo from "@/components/AutoVideo";
import LookCard from "@/components/LookCard";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { listLooks } from "@/lib/looks";
import { getTryonContext, listLookTryons } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

function LifeScene() {
  return (
    <figure className="sc-glass card sc-rise" style={{ margin: 0, padding: 10 }}>
      <div role="img" aria-label="穿着这一身，出现在周五的咖啡馆" style={{ borderRadius: 16, overflow: "hidden" }}>
        <AutoVideo className="life-video" src="/scenes/life-cafe-web.mp4" poster="/scenes/life-cafe.jpg" />
      </div>
      <figcaption className="row" style={{ justifyContent: "space-between", padding: "10px 6px 2px" }}>
        <span className="sc-kicker">In Your Life</span>
        <span className="sc-meta">穿着这一身，出现在周五的咖啡馆</span>
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
  const [looks, tryon] = await Promise.all([listLooks(user.id), getTryonContext(user.id)]);
  // 逐件试穿的“穿搭进度”：一次查出本人在这些搭配上的试穿结果，按搭配分组交给每张卡片。
  const tryons = tryon.enabled ? await listLookTryons(user.id, looks.map((l) => l.id)) : {};
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "36dvh" }}>
        <span className="sc-kicker">The Fitting Room</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>个人试衣间</h1>
        <p className="serif-note">
          {looks.length
            ? `${looks.length} 套搭配。${tryon.enabled ? "整套或一件一件穿到你身上，" : ""}勾选想要的单品，加入购物袋。`
            : "还是空的，去衣橱里挑一套吧。"}
        </p>
      </section>
      <div className="stack">
        {looks.map((l) => (
          <LookCard key={l.id} look={l} tryon={tryon} tryons={tryons[l.id]} />
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
