import type { Item } from "@/lib/catalog";
import type { NanoKind } from "./nano";

// 鞋、包、配饰的一键试穿：Kolors / FASHN 只换上身区域，不支持这些品类；它们始终走 nano-banana 多参考（nano.ts），
// 提示词与衣服同一套，只把动词改成 wearing / carrying the item。

const KINDS: Record<string, NanoKind> = { 鞋: "shoes", 包: "bag", 配饰: "accessory" };

export function accessoryKind(item: Pick<Item, "category" | "displayCategory">): NanoKind | null {
  return KINDS[item.category] ?? KINDS[item.displayCategory ?? ""] ?? null;
}

export function isAccessory(item: Pick<Item, "category" | "displayCategory">): boolean {
  return accessoryKind(item) !== null;
}
