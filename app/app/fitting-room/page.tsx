import Link from "next/link";
import LookCard from "@/components/LookCard";
import { getCurrentUser } from "@/lib/auth";
import { listLooks } from "@/lib/looks";

export const dynamic = "force-dynamic";

export default async function FittingRoom() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="card stack">
        <h1>个人试衣间</h1>
        <p className="muted" style={{ margin: 0 }}>登录后，加入试衣间的搭配会保存在你的账号里。</p>
        <Link href="/login?next=/fitting-room" className="btn" style={{ justifySelf: "start" }}>
          登录 / 注册
        </Link>
      </div>
    );
  }
  const looks = await listLooks(user.id);
  return (
    <div className="stack">
      <section>
        <h1>个人试衣间</h1>
        <p className="muted" style={{ margin: 0 }}>
          {looks.length ? `${looks.length} 套搭配。勾选想买的单品，生成购物清单。` : "还是空的，去衣橱里挑一套吧。"}
        </p>
      </section>
      {looks.map((l) => (
        <LookCard key={l.id} look={l} />
      ))}
      {looks.length === 0 ? (
        <Link href="/" className="btn" style={{ justifySelf: "start" }}>
          去逛衣橱
        </Link>
      ) : null}
    </div>
  );
}
