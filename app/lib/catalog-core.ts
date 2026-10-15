// 不依赖数据库的目录常量与工具（改编规则与单元测试直接引用，避免加载数据库连接）。
// lib/catalog.ts 会原样再导出这些名字。
export const CATEGORY_ORDER = ["上装", "下装", "外套", "鞋", "包", "配饰"] as const;
export type Category = (typeof CATEGORY_ORDER)[number];

export function sumPrice(items: { price: number }[]) {
  return items.reduce((s, i) => s + i.price, 0);
}
