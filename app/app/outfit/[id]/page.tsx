import Link from "next/link";
import { notFound } from "next/navigation";
import Adapter from "@/components/Adapter";
import Scene from "@/components/Scene";
import { getAllItems, getOutfit, getOutfits } from "@/lib/catalog";
import { hasAiKey } from "@/lib/adapt/ai";
import { buildCandidatePool } from "@/lib/adapt/rules";

export const dynamic = "force-dynamic";

export default async function OutfitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [outfit, allItems, all] = await Promise.all([getOutfit(id), getAllItems(), getOutfits()]);
  if (!outfit) notFound();
  // 逐件替换只从候选池里选（同衣橱 + 同性别/中性），与改编规则一致。
  const catalog = buildCandidatePool(outfit, allItems);
  const idx = all.findIndex((o) => o.id === outfit.id);
  return (
    <>
      {/* 场景用这套搭配自己的封面照片，与衣橱页的搭配卡衔接 */}
      <Scene dim cover={outfit.cover} />
      <section className="hero sc-rise" style={{ minHeight: "42dvh" }}>
        {/* 回到这套搭配所在的衣橱，并定位到这张搭配卡 */}
        <Link
          href={`/closet/${outfit.curatorId}#look-${outfit.id}`}
          className="sc-meta back-link"
          style={{ marginBottom: "auto" }}
        >
          ← 返回衣橱
        </Link>
        <div className="spread">
          <div>
            <span className="sc-kicker">The Look</span>
            <h1 className="sc-display" style={{ margin: "6px 0 0" }}>
              {outfit.name.replace(/^占位：/, "")}
            </h1>
          </div>
          <span className="sc-number sc-foil">N°{String(idx + 1).padStart(2, "0")}</span>
        </div>
        <p className="serif-note" style={{ marginTop: 10 }}>
          {outfit.styleNote}
        </p>
      </section>
      <Adapter outfit={outfit} catalog={catalog} aiEnabled={hasAiKey()} />
    </>
  );
}
