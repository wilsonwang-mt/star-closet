// 整套试穿的叠加顺序（纯函数，便于单测）。FASHN 每次只能换一件，按以下顺序依次叠加，
// 上一步的结果图作为下一步的 model_image：
// - 有连衣裙：连衣裙（one-pieces）→ 外套（tops，若有）。连衣裙之外的内搭与下装不再叠加。
// - 否则：上装内搭（tops，取第一件）→ 下装（bottoms，取第一件）→ 外套（tops，取第一件，最后叠加）。
// - 鞋、包、配饰不支持，不进入计划。

export type FashnCategory = "tops" | "bottoms" | "one-pieces";
export type TryonLabel = "上装" | "下装" | "连衣裙" | "外套";

export type PlanItem = { id: string; category: string; displayCategory?: string | null; image?: string | null };
export type PlanStep = { itemId: string; category: FashnCategory; label: TryonLabel };

const isDress = (i: PlanItem) => i.displayCategory === "连衣裙";

export function planTryon(items: PlanItem[]): PlanStep[] {
  const usable = items.filter((i) => !!i.image);
  const steps: PlanStep[] = [];
  const dress = usable.find(isDress);
  if (dress) {
    steps.push({ itemId: dress.id, category: "one-pieces", label: "连衣裙" });
  } else {
    const top = usable.find((i) => i.category === "上装");
    if (top) steps.push({ itemId: top.id, category: "tops", label: "上装" });
    const bottom = usable.find((i) => i.category === "下装");
    if (bottom) steps.push({ itemId: bottom.id, category: "bottoms", label: "下装" });
  }
  const outer = usable.find((i) => i.category === "外套");
  if (outer) steps.push({ itemId: outer.id, category: "tops", label: "外套" });
  return steps;
}
