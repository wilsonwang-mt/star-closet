import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ClosetExperience, { type LookView } from "@/components/closet/ClosetExperience";
import { toClosetView } from "@/components/closet/data";
import { getCurrentUser } from "@/lib/auth";
import { getCloset, getCuratorById } from "@/lib/catalog";
import { getCatalogL10n } from "@/lib/i18n/server";
import { localizeTryonContext } from "@/lib/tryon/l10n";
import { getTryonContext } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [c, l10n] = await Promise.all([getCuratorById(id), getCatalogL10n()]);
  return c ? { title: l10n.curator(c).closetName.replace(/^占位：/, "") } : {};
}

// 衣橱页：全屏场景 + 衣橱信息 + 这间衣橱的全部搭配（核心路径：选择衣橱 → 进入空间 → 一键试穿 / 加入试衣间 → 购物袋，D67）。
export default async function ClosetPage({ params }: Props) {
  const { id } = await params;
  const [closet, user, l10n] = await Promise.all([getCloset(id), getCurrentUser(), getCatalogL10n()]);
  if (!closet) notFound();
  // 一键试穿的上下文：查询失败（如迁移未执行）不影响衣橱页，只是不显示试穿按钮。
  const ctx = await getTryonContext(user?.id ?? null).catch(() => null);
  const tryon = ctx ? localizeTryonContext(ctx, l10n.locale) : null;
  // 搭配名、单品名等自由文本按当前语言换；品类、颜色、场合标签保持中文（试穿与多选按中文判断），显示时再翻译。
  const looks: LookView[] = closet.outfits.map(l10n.outfit).map((o) => ({
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
  return <ClosetExperience closet={toClosetView(l10n.curator(closet.curator), looks.length)} looks={looks} tryon={tryon} />;
}
