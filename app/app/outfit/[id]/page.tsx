import Link from "next/link";
import { notFound } from "next/navigation";
import Adapter from "@/components/Adapter";
import Scene from "@/components/Scene";
import { getAllItems, getOutfit, getOutfits } from "@/lib/catalog";
import { hasAiKey } from "@/lib/adapt/ai";

export const dynamic = "force-dynamic";

export default async function OutfitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [outfit, catalog, all] = await Promise.all([getOutfit(id), getAllItems(), getOutfits()]);
  if (!outfit) notFound();
  const idx = all.findIndex((o) => o.id === outfit.id);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "42dvh" }}>
        <Link href="/" className="sc-meta" style={{ textDecoration: "none", marginBottom: "auto" }}>
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
