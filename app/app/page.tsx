import Link from "next/link";
import ItemThumb from "@/components/ItemThumb";
import { getCurator, getOutfits } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [curator, outfits] = await Promise.all([getCurator(), getOutfits()]);
  if (!curator) {
    return <p className="muted">目录还没有写入数据库。请先在 app/ 下运行 npm run db:setup。</p>;
  }
  return (
    <div className="stack">
      <section>
        <span className="tag">{curator.closetType}衣橱</span>
        <h1 style={{ marginTop: 8 }}>{curator.closetName}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {curator.displayName} · {curator.intro}
        </p>
      </section>
      <p className="small muted" style={{ margin: 0 }}>
        选一套喜欢的搭配，用一句话说出你的预算、场合或想换的单品，就能改编成适合你的一整套。
      </p>
      <div className="grid">
        {outfits.map((o) => (
          <Link key={o.id} href={`/outfit/${o.id}`} className="card" style={{ textDecoration: "none" }}>
            <div className="thumbs" style={{ overflowX: "auto" }}>
              {o.items.map((i) => (
                <ItemThumb key={i.id} name={i.name} image={i.image} color={i.color} />
              ))}
            </div>
            <div className="spread" style={{ marginTop: 12 }}>
              <h2 style={{ margin: 0 }}>{o.name}</h2>
              <span className="price">¥{o.total}</span>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              {o.occasionTags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
