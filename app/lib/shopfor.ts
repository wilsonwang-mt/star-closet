// 「为谁选」（探索中，explore/shop-for 分支，未定稿）：女士 / 男士 / 全部，写在 cookie 里，访客也能记住。
// 中性的衣橱与搭配在女士、男士两边都出现。
export type ShopFor = "women" | "men" | "all";
export type ShopForVariant = "a" | "b" | "c";

export const SHOP_FOR_COOKIE = "sc-shopfor";
export const SHOP_FOR_VARIANT_COOKIE = "sc-sfx";

const GENDER: Record<"women" | "men", string> = { women: "女装", men: "男装" };

export function parseShopFor(v: string | undefined): ShopFor | null {
  return v === "women" || v === "men" || v === "all" ? v : null;
}

export function parseShopForVariant(v: string | undefined): ShopForVariant | null {
  return v === "a" || v === "b" || v === "c" ? v : null;
}

/** 目录里的性别值（女装 / 男装 / 中性）是否属于当前的「为谁选」 */
export function fitsShopFor(gender: string | null | undefined, s: ShopFor | null): boolean {
  if (!s || s === "all") return true;
  return gender === GENDER[s] || gender === "中性";
}

/** 全部衣橱页的默认性别条件（单选，只取女装 / 男装） */
export function shopForGender(s: ShopFor | null): string | null {
  return s === "women" || s === "men" ? GENDER[s] : null;
}
