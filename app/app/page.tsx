import ClosetCarousel from "@/components/home/ClosetCarousel";
import { toClosetView } from "@/components/closet/data";
import { getCurators } from "@/lib/catalog";
import { getCatalogL10n, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// 首页：先选择“想走进谁的衣橱”，用空间预览引起好奇再进入（/closet/[id]）。
// ?c=C03 记住当前选中的那一间：从衣橱页返回时回到原处。
export default async function Home({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const [curators, sp, l10n, t] = await Promise.all([getCurators(), searchParams, getCatalogL10n(), getT("home")]);
  if (curators.length === 0) {
    return <p className="muted">{t("dbEmpty")}</p>;
  }
  const initialId = typeof sp.c === "string" ? sp.c : undefined;
  // 衣橱名、简介等自由文本按当前语言换；性别、衣橱类型保持中文（筛选按中文值工作），显示时再翻译。
  return <ClosetCarousel closets={curators.map((c) => toClosetView(l10n.curator(c)))} initialId={initialId} />;
}
