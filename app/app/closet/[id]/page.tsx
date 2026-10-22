import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClosetExperience, { type LookView } from "@/components/closet/ClosetExperience";
import { toClosetView } from "@/components/closet/data";
import { getCurrentUser } from "@/lib/auth";
import { getCloset, getCuratorById } from "@/lib/catalog";
import { getTryonContext } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const c = await getCuratorById(id);
  return c ? { title: c.closetName.replace(/^占位：/, "") } : {};
}

// 衣橱页：全屏场景 + 衣橱信息 + 这间衣橱的全部搭配（核心路径：选择衣橱 → 进入空间 → 一键试穿 / 加入试衣间 → 购物袋，D67）。
export default async function ClosetPage({ params }: Props) {
  const { id } = await params;
  const [closet, user] = await Promise.all([getCloset(id), getCurrentUser()]);
  if (!closet) notFound();
  // 一键试穿的上下文：查询失败（如迁移未执行）不影响衣橱页，只是不显示试穿按钮。
  const tryon = await getTryonContext(user?.id ?? null).catch(() => null);
  const looks: LookView[] = closet.outfits.map((o) => ({
    id: o.id,
    name: o.name,
    cover: o.cover,
    coverNote: o.coverNote,
    occasionTags: o.occasionTags,
    budgetTier: o.budgetTier,
    season: o.season,
    total: o.total,
    items: o.items.map((i) => ({
      id: i.id,
      name: i.name,
      image: i.image,
      color: i.color,
      category: i.category,
      displayCategory: i.displayCategory,
      price: i.price,
    })),
  }));
  return <ClosetExperience closet={toClosetView(closet.curator, looks.length)} looks={looks} tryon={tryon} />;
}
