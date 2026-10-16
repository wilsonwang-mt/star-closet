// 试穿的品类映射与叠加规则（纯函数，前后端共用，便于单测）。
// - 单件能否上身（stepFor）：连衣裙（display_category）→ one-pieces；上装 → tops；下装（含半身裙）→ bottoms；
//   外套 → tops。鞋、包、配饰与没有单品图的单品不能试穿——界面不显示“试穿这件”，接口返回 422。
// - 整套（planTryon，旧的一次请求整套叠加）：FASHN 每次只能换一件，按以下顺序依次叠加，上一步的结果图作为下一步的 model_image：
//   有连衣裙：连衣裙 → 外套（若有），连衣裙之外的内搭与下装不再叠加；否则：上装内搭（取第一件）→ 下装（取第一件）→ 外套（取第一件，最后叠加）。
// - 逐件（wearOn）：在某张试穿图上再穿一件时，算出新图上“穿着”的单品，用于标“已穿上”。

export type FashnCategory = "tops" | "bottoms" | "one-pieces";
export type TryonLabel = "上装" | "下装" | "连衣裙" | "外套";

export type PlanItem = { id: string; category: string; displayCategory?: string | null; image?: string | null };
export type PlanStep = { itemId: string; category: FashnCategory; label: TryonLabel };
export type WornPiece = { itemId: string; label: TryonLabel };

/** 单件的试穿方式；不能上身（鞋、包、配饰）或没有单品图时返回 null。 */
export function stepFor(item: PlanItem): PlanStep | null {
  if (!item.image) return null;
  if (item.displayCategory === "连衣裙") return { itemId: item.id, category: "one-pieces", label: "连衣裙" };
  if (item.category === "上装") return { itemId: item.id, category: "tops", label: "上装" };
  if (item.category === "下装") return { itemId: item.id, category: "bottoms", label: "下装" };
  if (item.category === "外套") return { itemId: item.id, category: "tops", label: "外套" };
  return null;
}

export const isWearable = (item: PlanItem) => stepFor(item) !== null;

export function planTryon(items: PlanItem[]): PlanStep[] {
  const usable = items.map(stepFor).filter((s): s is PlanStep => s !== null);
  const steps: PlanStep[] = [];
  const dress = usable.find((s) => s.label === "连衣裙");
  if (dress) {
    steps.push(dress);
  } else {
    const top = usable.find((s) => s.label === "上装");
    if (top) steps.push(top);
    const bottom = usable.find((s) => s.label === "下装");
    if (bottom) steps.push(bottom);
  }
  const outer = usable.find((s) => s.label === "外套");
  if (outer) steps.push(outer);
  return steps;
}

// 新穿上的一件会盖掉哪些已穿着的单品（FASHN 换的是整块区域）：
// 连衣裙换掉全身（含外套）；上装换掉上半身（原上装、连衣裙、外套）；下装换掉下装与连衣裙；外套只换掉原外套（内搭保留）。
const REPLACES: Record<TryonLabel, readonly TryonLabel[]> = {
  连衣裙: ["连衣裙", "上装", "下装", "外套"],
  上装: ["上装", "连衣裙", "外套"],
  下装: ["下装", "连衣裙"],
  外套: ["外套"],
};

/** 在已穿着 worn 的图上再穿 next：返回新图上穿着的单品（按穿上的先后，next 在最后）。 */
export function wearOn(worn: WornPiece[], next: WornPiece): WornPiece[] {
  const drop = new Set(REPLACES[next.label]);
  return [...worn.filter((w) => w.itemId !== next.itemId && !drop.has(w.label)), { itemId: next.itemId, label: next.label }];
}

const ORDER: Record<TryonLabel, number> = { 连衣裙: 0, 上装: 0, 下装: 1, 外套: 2 };

/** 可上身的单品，按建议的穿着顺序（内搭 / 连衣裙 → 下装 → 外套），同类保持原顺序。 */
export function wearableInOrder<T extends PlanItem>(items: T[]): { item: T; step: PlanStep }[] {
  return items
    .map((item) => ({ item, step: stepFor(item) }))
    .filter((x): x is { item: T; step: PlanStep } => x.step !== null)
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => ORDER[a.step.label] - ORDER[b.step.label] || a.i - b.i)
    .map(({ item, step }) => ({ item, step }));
}
