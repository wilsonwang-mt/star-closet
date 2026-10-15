import Link from "next/link";
import ItemThumb from "@/components/ItemThumb";
import Scene from "@/components/Scene";
import { getCurator, getOutfits } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const no = (i: number) => `N°${String(i + 1).padStart(2, "0")}`;

export default async function Home() {
  const [curator, outfits] = await Promise.all([getCurator(), getOutfits()]);
  if (!curator) {
    return <p className="muted">目录还没有写入数据库。请先在 app/ 下运行 npm run db:setup。</p>;
  }
  return (
    <>
      <Scene />
      <section className="hero sc-rise">
        <span className="sc-kicker">The Closet · {curator.closetType}</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>
          {curator.closetName}
        </h1>
        <p className="serif-note">{curator.intro.replace(/^占位：/, "")}</p>
        <p className="sc-meta" style={{ margin: "10px 0 0" }}>
          主理人 · {curator.displayName} · {outfits.length} 套搭配
        </p>
      </section>

      <div className="stack">
        <p className="sc-meta" style={{ margin: "8px 0 0" }}>
          选一套，用一句话说出预算、场合或想换的单品，改编成你的那一套。
        </p>
        {outfits.map((o, idx) => (
          <Link key={o.id} href={`/outfit/${o.id}`} className="sc-glass card sc-rise" style={{ textDecoration: "none", display: "block" }}>
            <div className="spread">
              <div>
                <span className="sc-kicker">The Look</span>
                <h2 className="section-title">{o.name.replace(/^占位：/, "")}</h2>
              </div>
              <span className="sc-number sc-foil">{no(idx)}</span>
            </div>
            <div className="thumbs" style={{ marginTop: 14 }}>
              {o.items.map((i) => (
                <ItemThumb key={i.id} name={i.name} image={i.image} color={i.color} />
              ))}
            </div>
            <div className="spread" style={{ marginTop: 12 }}>
              <span className="sc-meta">{o.occasionTags.join(" · ")}</span>
              <span className="price">¥{o.total}</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
