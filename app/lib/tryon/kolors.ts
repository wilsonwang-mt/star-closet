import { submitQueue, type FashnJob } from "./fashn";

// 可灵 Kolors 虚拟试衣（fal.ai 托管，D62）：两段式里的“快出图”一段（队列接口，指挥台实测约 20 秒）。
// 模型 fal-ai/kling/v1-5/kolors-virtual-try-on；输入（以 fal OpenAPI 为准）human_image_url、garment_image_url、sync_mode，
// 一次只换一件，没有 category / mode；输出 image.url（单个对象，fashnResult 已兼容）。
// sync_mode=true：结果以 data URI 返回，fal 不留 CDN 副本（D47）；整套叠加的中间步骤要把地址交给下一步，用 false。

export const KOLORS_MODEL = "fal-ai/kling/v1-5/kolors-virtual-try-on";

export type KolorsInput = { humanImage: string; garmentImage: string; syncMode?: boolean };

export function kolorsBody(input: KolorsInput): Record<string, unknown> {
  return { human_image_url: input.humanImage, garment_image_url: input.garmentImage, sync_mode: input.syncMode ?? true };
}

/** 提交一次 Kolors 到 fal 队列（不等待生成）。 */
export function submitKolors(input: KolorsInput, signal?: AbortSignal): Promise<FashnJob> {
  return submitQueue(KOLORS_MODEL, kolorsBody(input), signal);
}
