import type { FashnCategory } from "./plan";

// FASHN v1.6 虚拟试穿（fal.ai 托管）：D62 起为备选（TRYON_PROVIDER=fashn_fal），默认改用可灵 Kolors（kolors.ts）。
// 只在服务端调用，浏览器拿不到 key。是否启用、用哪家由 provider.ts 决定；没有 key 时不发起任何外部请求。
// 文档：https://fal.ai/models/fal-ai/fashn/tryon/v1.6 ——输入 model_image / garment_image（URL 或 base64 data URI）、
// category、mode、garment_photo_type、output_format；输出 images[0].url（864×1296）。未实测（没有 key）。

export const FASHN_ENDPOINT = "https://fal.run/fal-ai/fashn/tryon/v1.6";
export const PROVIDER_ID = "fashn_fal";
export const PROVIDER_NAME = "FASHN（fal.ai）";

export class TryonError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 生成模式：逐件试穿用 quality（针织纹理、领口更清楚，单件约 30–45 秒）；
 * 旧的整套叠加一次请求最多调用 3 次，用 quality 会超过 120 秒的服务端上限，保持 balanced。
 */
export type FashnMode = "balanced" | "quality";

export type FashnInput = { modelImage: string; garmentImage: string; category: FashnCategory; mode?: FashnMode };

/** 调用一次 FASHN，返回结果图地址（https URL 或 data URI）。 */
export async function runFashn(input: FashnInput, signal?: AbortSignal): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new TryonError(503, "试穿服务未开放");
  let res: Response;
  try {
    res = await fetch(FASHN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
        // 请求 fal 不保存本次请求的输入输出（与 3D 形象一致，D47）。
        "X-Fal-Store-IO": "0",
      },
      body: JSON.stringify({
        model_image: input.modelImage,
        garment_image: input.garmentImage,
        category: input.category,
        mode: input.mode ?? "balanced",
        garment_photo_type: "flat-lay",
        output_format: "png",
      }),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (signal?.aborted || (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") {
      throw new TryonError(504, "试穿超时，请稍后再试");
    }
    throw new TryonError(502, "试穿服务暂时连不上，请稍后再试");
  }
  if (!res.ok) {
    // 只按状态码给出中文说明，不回显第三方响应体。
    if (res.status === 401 || res.status === 403) throw new TryonError(502, "试穿服务配置有误，请稍后再试");
    if (res.status === 422 || res.status === 400) throw new TryonError(422, "这张照片无法试穿，请换一张光线充足的正面全身照");
    if (res.status === 429) throw new TryonError(429, "试穿的人有点多，请稍后再试");
    throw new TryonError(502, "试穿服务暂时不可用，请稍后再试");
  }
  const data = (await res.json().catch(() => null)) as { images?: { url?: unknown }[] } | null;
  const url = data?.images?.[0]?.url;
  if (typeof url !== "string" || !(url.startsWith("https://") || url.startsWith("data:image/"))) {
    throw new TryonError(502, "试穿服务没有返回图片，请稍后再试");
  }
  return url;
}

/** 把结果图取回本站（https 下载或解码 data URI）。 */
export async function fetchResultImage(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (url.startsWith("data:image/")) {
    const comma = url.indexOf(",");
    if (comma < 0 || !url.slice(0, comma).endsWith(";base64")) throw new TryonError(502, "试穿结果无法读取");
    return new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));
  }
  try {
    const res = await fetch(url, { signal, cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    if (signal?.aborted) throw new TryonError(504, "试穿超时，请稍后再试");
    throw new TryonError(502, "试穿结果下载失败，请稍后再试");
  }
}
