import { reserveSpend } from "@/lib/spend";
import { FASHN_MODEL, submitFashn, type FashnJob } from "./fashn";
import { KOLORS_MODEL, submitKolors } from "./kolors";
import { NANO_MODEL, submitNano, type Gender, type NanoKind } from "./nano";
import type { FashnCategory } from "./plan";

// 试穿模型编排（两段式框架见 service.ts）：
// - TRYON_PROVIDER=kolors_nano（默认）：先用可灵 Kolors 快出图（约 20 秒），再用 nano-banana 多参考细化（约 45 秒），好了原地替换。
// - nano_fal：只跑 nano-banana 一段；kolors_fal：只跑 Kolors 一段；fashn_fal：FASHN performance → quality（备选，保留）。
// - 鞋、包、配饰：Kolors / FASHN 不支持，无论哪种设置都只跑 nano-banana 一段。
// 都在 fal.ai 上、共用 FAL_KEY；其他取值视为未开放。同意（D47）按处理方 fal.ai 记录，切换 fal 上的模型不需要重新同意。

export type TryonProviderId = "kolors_nano" | "nano_fal" | "kolors_fal" | "fashn_fal";
export type StageModel = "kolors" | "nano" | "fashn_performance" | "fashn_quality" | "fashn_balanced";

/** 同意文案里写的处理方（不写死具体模型）。 */
export const PROCESSOR_LABEL = "fal.ai 上的 AI 模型";

export function providerId(): TryonProviderId | null {
  const p = process.env.TRYON_PROVIDER?.trim() || "kolors_nano";
  return p === "kolors_nano" || p === "nano_fal" || p === "kolors_fal" || p === "fashn_fal" ? p : null;
}

export function providerName(): string {
  return PROCESSOR_LABEL;
}

export function isTryonEnabled(): boolean {
  return !!process.env.FAL_KEY && providerId() !== null;
}

/** 逐件的两段：fast 先出图，fine 细化后替换（null 表示只有一段）。nanoKind 为鞋包配饰时只跑 nano。 */
export function stagePlan(nanoKind?: NanoKind | null): { fast: StageModel; fine: StageModel | null } {
  if (nanoKind && nanoKind !== "garment") return { fast: "nano", fine: null };
  switch (providerId()) {
    case "fashn_fal":
      return { fast: "fashn_performance", fine: "fashn_quality" };
    case "kolors_fal":
      return { fast: "kolors", fine: null };
    case "nano_fal":
      return { fast: "nano", fine: null };
    default:
      return { fast: "kolors", fine: "nano" };
  }
}

/** 整套叠加每一步用的模型（每步一段）。 */
export function chainModel(): StageModel {
  const p = providerId();
  if (p === "fashn_fal") return "fashn_balanced";
  if (p === "nano_fal") return "nano";
  return "kolors";
}

/** 从提交起最多等多久：nano 约 45 秒，给到 150 秒；其余 90 秒。 */
export function stageDeadline(model: StageModel | undefined, fallback: number): number {
  if (model === "nano") return 150_000;
  if (model === "kolors" || model === "fashn_performance" || model === "fashn_balanced") return 90_000;
  return fallback;
}

/** “正在细化”只用于 fine 段；结果的 mode 映射：fast → performance，fine → quality（沿用旧字段）。 */
export type StageInput = {
  modelImage: string;
  garmentImage: string;
  category: FashnCategory;
  face?: string | null;
  gender?: Gender;
  nanoKind?: NanoKind | null;
  syncMode?: boolean;
};

/**
 * 每一段提交的估价（全站每日总闸 lib/spend.ts，D76），单位百万分之一美元；fal 官网标价，按张计：
 * - 可灵 Kolors 虚拟试衣 0.07 美元（docs/调研-现场试穿与实时渲染.md 表中“已复核”）；
 * - nano-banana-pro/edit 2K 0.15 美元（1K、2K 同价，docs/design/场景姿态试穿探索-20261025.md §七）；
 * - FASHN v1.6 0.075 美元（三种模式同价，docs/调研-现场试穿与实时渲染.md）。
 * 以 fal 账单为准再校正。总额已满时抛 BudgetError（503）且不提交：快出图一段在 withQuota 里，会退回用户额度；
 * 细化一段在响应之后提交，失败时记为“细化失败”、保留快出的那张；整套叠加的下一步失败时整条记为失败。
 */
export const STAGE_MICRO_USD: Record<StageModel, number> = {
  kolors: 70_000,
  nano: 150_000,
  fashn_performance: 75_000,
  fashn_quality: 75_000,
  fashn_balanced: 75_000,
};

const STAGE_ENDPOINT: Record<StageModel, string> = {
  kolors: KOLORS_MODEL,
  nano: NANO_MODEL,
  fashn_performance: FASHN_MODEL,
  fashn_quality: FASHN_MODEL,
  fashn_balanced: FASHN_MODEL,
};

/** 按模型提交一段到 fal 队列（先向全站每日总额预留这一段的估价）。 */
export async function submitStage(model: StageModel, input: StageInput, signal?: AbortSignal): Promise<FashnJob & { model: StageModel }> {
  await reserveSpend(`tryon:${STAGE_ENDPOINT[model]}`, STAGE_MICRO_USD[model]);
  let job: FashnJob;
  switch (model) {
    case "kolors":
      job = await submitKolors({ humanImage: input.modelImage, garmentImage: input.garmentImage, syncMode: input.syncMode }, signal);
      break;
    case "nano":
      job = await submitNano(
        { base: input.modelImage, face: input.face, garment: input.garmentImage, gender: input.gender, kind: input.nanoKind ?? "garment", syncMode: input.syncMode },
        signal,
      );
      break;
    default: {
      const mode = model === "fashn_quality" ? "quality" : model === "fashn_balanced" ? "balanced" : "performance";
      job = await submitFashn({ modelImage: input.modelImage, garmentImage: input.garmentImage, category: input.category, mode, syncMode: input.syncMode }, signal);
    }
  }
  return { ...job, model };
}
