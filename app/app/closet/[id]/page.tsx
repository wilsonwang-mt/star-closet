import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClosetExperience, { type LookView } from "@/components/closet/ClosetExperience";
import { toClosetView } from "@/components/closet/data";
import { getCloset, getCuratorById } from "@/lib/catalog";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getCuratorById(id);
  return { title: c ? `${c.closetName.replace(/^占位：/, "")} · Star Closet` : "Star Closet" };
}

// 衣橱页：全屏场景 + 衣橱信息 + 这间衣橱的全部搭配（核心路径：选择衣橱 → 进入空间 → 点搭配 → 详情 → 商家页面）。
export default async function ClosetPage({ params }: Props) {
  const { id } = await params;
  const closet = await getCloset(id);
  if (!closet) notFound();
  const looks: LookView[] = closet.outfits.map((o) => ({
    id: o.id,
    name: o.name,
    cover: o.cover,
    coverNote: o.coverNote,
    occasionTags: o.occasionTags,
    budgetTier: o.budgetTier,
    season: o.season,
    total: o.total,
    items: o.items.map((i) => ({ id: i.id, name: i.name, image: i.image, color: i.color })),
  }));
  return <ClosetExperience closet={toClosetView(closet.curator, looks.length)} looks={looks} />;
}
