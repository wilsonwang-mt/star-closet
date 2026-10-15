import Link from "next/link";
import { notFound } from "next/navigation";
import Adapter from "@/components/Adapter";
import { getAllItems, getOutfit } from "@/lib/catalog";
import { hasAiKey } from "@/lib/adapt/ai";

export const dynamic = "force-dynamic";

export default async function OutfitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [outfit, catalog] = await Promise.all([getOutfit(id), getAllItems()]);
  if (!outfit) notFound();
  return (
    <div className="stack">
      <Link href="/" className="small muted">
        ← 返回衣橱
      </Link>
      <section>
        <h1>{outfit.name}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {outfit.styleNote}
        </p>
      </section>
      <Adapter outfit={outfit} catalog={catalog} aiEnabled={hasAiKey()} />
    </div>
  );
}
