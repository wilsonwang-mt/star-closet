import Link from "next/link";
import { notFound } from "next/navigation";
import Adapter from "@/components/Adapter";
import LinkPending from "@/components/LinkPending";
import Scene from "@/components/Scene";
import { getAllItems, getOutfit, getOutfitsByCurator } from "@/lib/catalog";
import { hasAiKey } from "@/lib/adapt/ai";
import { buildCandidatePool } from "@/lib/adapt/rules";
import { getCurrentUser } from "@/lib/auth";
import { getTryonContext } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

export default async function OutfitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [outfit, allItems, user] = await Promise.all([getOutfit(id), getAllItems(), getCurrentUser()]);
  if (!outfit) notFound();
  // N° 与衣橱页搭配卡一致：这套搭配在所属衣橱里的位置（与衣橱页同一查询、同一排序）
  const siblings = await getOutfitsByCurator(outfit.curatorId);
  // 逐件替换只从候选池里选（同性别/中性，本衣橱优先、其他衣橱单独分组），与改编规则一致。
  const catalog = buildCandidatePool(outfit, allItems);
  const idx = siblings.findIndex((o) => o.id === outfit.id);
  const tryon = await getTryonContext(user?.id ?? null);
  return (
    <>
      {/* 场景用这套搭配自己的封面照片，与衣橱页的搭配卡衔接 */}
      <Scene dim cover={outfit.cover} />
      <section className="hero sc-rise" style={{ minHeight: "42dvh" }}>
        {/* 回到这套搭配所在的衣橱，并定位到这张搭配卡 */}
        <Link
          href={`/closet/${outfit.curatorId}#look-${outfit.id}`}
          className="back-link"
          style={{ marginBottom: "auto" }}
        >
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
            <path d="M13 5H2M5.5 1.5 2 5l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          返回衣橱
          <LinkPending />
        </Link>
        <div className="spread">
          <div>
            <span className="sc-kicker">The Look</span>
            <h1 className="sc-display" style={{ margin: "6px 0 0" }}>
              {outfit.name.replace(/^占位：/, "")}
            </h1>
          </div>
          {idx >= 0 ? <span className="sc-number sc-foil">N°{String(idx + 1).padStart(2, "0")}</span> : null}
        </div>
        <p className="serif-note" style={{ marginTop: 10 }}>
          {outfit.styleNote}
        </p>
      </section>
      <Adapter outfit={outfit} catalog={catalog} aiEnabled={hasAiKey()} tryon={tryon} />
    </>
  );
}
