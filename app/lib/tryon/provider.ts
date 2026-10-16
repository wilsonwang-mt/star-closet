import { runFashn, TryonError, type FashnInput } from "./fashn";
import { runKolors } from "./kolors";

// 试穿模型切换（D62）：TRYON_PROVIDER=kolors_fal（默认，可灵 Kolors）| fashn_fal（FASHN v1.6，备选）。
// 两家都在 fal.ai 上、共用 FAL_KEY；其他取值视为未开放。模型名写进同意版本号，换模型需要用户重新同意（D47）。

export type TryonProviderId = "kolors_fal" | "fashn_fal";

const NAMES: Record<TryonProviderId, string> = {
  kolors_fal: "fal.ai（可灵 Kolors）",
  fashn_fal: "FASHN（fal.ai）",
};

export function providerId(): TryonProviderId | null {
  const p = process.env.TRYON_PROVIDER?.trim() || "kolors_fal";
  return p === "kolors_fal" || p === "fashn_fal" ? p : null;
}

/** 同意文案里写的处理方，如“fal.ai（可灵 Kolors）”。 */
export function providerName(): string {
  return NAMES[providerId() ?? "kolors_fal"];
}

export function isTryonEnabled(): boolean {
  return !!process.env.FAL_KEY && providerId() !== null;
}

/** 换上一件：按当前模型调用一次，返回结果图地址。只有 FASHN 用得到 category / mode。 */
export async function runTryonStep(input: FashnInput, signal?: AbortSignal): Promise<string> {
  const p = providerId();
  if (!isTryonEnabled() || !p) throw new TryonError(503, "试穿服务未开放");
  if (p === "fashn_fal") return runFashn(input, signal);
  return runKolors({ humanImage: input.modelImage, garmentImage: input.garmentImage }, signal);
}
