import ClosetCarousel from "@/components/home/ClosetCarousel";
import { buildEdit } from "@/lib/home/edit";
import ShopTheLook from "@/components/home/ShopTheLook";
import { toClosetView } from "@/components/closet/data";
import { getCurrentUser } from "@/lib/auth";
import { getCurators, getOutfits } from "@/lib/catalog";
import { getCatalogL10n, getT } from "@/lib/i18n/server";
import { SHOP_FOR_COOKIE, SHOP_FOR_VARIANT_COOKIE, fitsShopFor, parseShopFor, parseShopForVariant } from "@/lib/shopfor";
import { cookies } from "next/headers";
import { localizeTryonContext } from "@/lib/tryon/l10n";
import { getTryonContext } from "@/lib/tryon/service";

export const dynamic = "force-dynamic";

// 首页：先选择“想走进谁的衣橱”（浅弧轮播，F01），再按场合看可以直接试穿、加入试衣间的整套（D71，取代原衣橱索引列表）。
// ?c=C03 记住当前选中的那一间：从衣橱页返回时回到原处。
export default async function Home({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const [curators, outfits, sp, l10n, t, user] = await Promise.all([
    getCurators(),
    getOutfits(),
    searchParams,
    getCatalogL10n(),
    getT("home"),
    getCurrentUser(),
  ]);
  if (curators.length === 0) {
    return <p className="muted">{t("dbEmpty")}</p>;
  }
  const initialId = typeof sp.c === "string" ? sp.c : undefined;
  // 「为谁选」探索：只在探索方案打开时按 cookie 过滤衣橱与搭配（中性两边都出现）
  const jar = await cookies();
  const sfx = parseShopForVariant(jar.get(SHOP_FOR_VARIANT_COOKIE)?.value);
  const shopFor = sfx ? parseShopFor(jar.get(SHOP_FOR_COOKIE)?.value) : null;
  // 一键试穿的上下文：查询失败（如迁移未执行）不影响首页，只是不显示试穿按钮（与衣橱页同一做法）。
  const ctx = await getTryonContext(user?.id ?? null).catch(() => null);
  const tryon = ctx ? localizeTryonContext(ctx, l10n.locale) : null;
  // 衣橱名、搭配名、单品名等自由文本按当前语言换；性别、衣橱类型、场合、品类保持中文（筛选与试穿按中文工作），显示时再翻译。
  const localCurators = curators.filter((c) => fitsShopFor(c.gender, shopFor)).map(l10n.curator);
  const edit = buildEdit(outfits.filter((o) => fitsShopFor(o.gender, shopFor)).map(l10n.outfit), localCurators);
  return (
    <>
      <ClosetCarousel key={shopFor ?? "all"} closets={localCurators.map((c) => toClosetView(c))} initialId={initialId} shopFor={shopFor} />
      <ShopTheLook key={`edit-${shopFor ?? "all"}`} groups={edit} tryon={tryon} />
    </>
  );
}
