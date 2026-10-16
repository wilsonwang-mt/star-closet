import { runFashn, TryonError, type FashnInput } from "./fashn";
import { runKolors } from "./kolors";
import { runNanoTryon, type Gender, type NanoKind } from "./nano";

// 试穿模型切换：TRYON_PROVIDER=nano_fal（默认，nano-banana 多参考，衣服最准确）| kolors_fal（可灵 Kolors，D62）| fashn_fal（FASHN v1.6 备选）。
// 三家都在 fal.ai 上、共用 FAL_KEY；其他取值视为未开放。
// nano_fal 失败或超时（>100 秒）时，上装 / 下装 / 外套 / 连衣裙自动回退到 Kolors；鞋包配饰 Kolors 不支持，不回退。
// 同意（D47）按处理方 fal.ai 记录：tryon-consent-v2:fal，切换 fal 上的模型不需要重新同意。

export type TryonProviderId = "nano_fal" | "kolors_fal" | "fashn_fal";

/** 同意文案里写的处理方（不写死具体模型）。 */
export const PROCESSOR_LABEL = "fal.ai 上的 AI 模型";

export function providerId(): TryonProviderId | null {
  const p = process.env.TRYON_PROVIDER?.trim() || "nano_fal";
  return p === "nano_fal" || p === "kolors_fal" || p === "fashn_fal" ? p : null;
}

export function providerName(): string {
  return PROCESSOR_LABEL;
}

export function isTryonEnabled(): boolean {
  return !!process.env.FAL_KEY && providerId() !== null;
}

export type StepInput = FashnInput & {
  /** nano：正脸参考（分身的正脸），有则作为第 2 张参考。 */
  face?: string | null;
  gender?: Gender;
  /** nano：鞋 / 包 / 配饰把动词改成穿 / 拿；默认 garment。 */
  kind?: NanoKind;
};

/** 换上一件：按当前模型调用一次，返回结果图地址与实际使用的模型。 */
export async function runTryonStep(input: StepInput, signal?: AbortSignal): Promise<string> {
  return (await runTryonStepWithProvider(input, signal)).url;
}

export async function runTryonStepWithProvider(input: StepInput, signal?: AbortSignal): Promise<{ url: string; provider: string }> {
  const p = providerId();
  if (!isTryonEnabled() || !p) throw new TryonError(503, "试穿服务未开放");
  if (p === "fashn_fal") return { url: await runFashn(input, signal), provider: p };
  if (p === "kolors_fal") return { url: await runKolors({ humanImage: input.modelImage, garmentImage: input.garmentImage }, signal), provider: p };
  try {
    const url = await runNanoTryon({ base: input.modelImage, face: input.face, garment: input.garmentImage, gender: input.gender, kind: input.kind }, signal);
    return { url, provider: "nano_fal" };
  } catch (e) {
    const garment = (input.kind ?? "garment") === "garment";
    // 整体时限已到、服务未开放或不是可回退的品类：直接报错。
    if (!garment || signal?.aborted || (e instanceof TryonError && e.status === 503)) throw e;
    console.error("[tryon] nano 失败，回退 Kolors", e instanceof TryonError ? e.status : "unknown");
    return { url: await runKolors({ humanImage: input.modelImage, garmentImage: input.garmentImage }, signal), provider: "kolors_fal" };
  }
}
