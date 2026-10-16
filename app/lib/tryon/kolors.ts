import { TryonError } from "./fashn";

// 可灵 Kolors 虚拟试衣（fal.ai 托管，D62 起为默认试穿模型）。只在服务端调用，浏览器拿不到 key。
// 端点 fal-ai/kling/v1-5/kolors-virtual-try-on（同步 fal.run，工作站实测约 8.5 秒）。
// 输入（以 fal OpenAPI 为准）：human_image_url、garment_image_url（URL 或 data URI），一次只换一件，没有 category / mode。
// 输出：image.url（单个对象，不是 FASHN 的 images[]）。

export const KOLORS_ENDPOINT = "https://fal.run/fal-ai/kling/v1-5/kolors-virtual-try-on";
/** 单次调用上限：正常约 8.5 秒，留足排队余量；整体仍受服务端 120 秒上限约束。 */
export const KOLORS_TIMEOUT_MS = 60_000;

export type KolorsInput = { humanImage: string; garmentImage: string };

/** 调用一次 Kolors，返回结果图地址（https URL 或 data URI）。 */
export async function runKolors(input: KolorsInput, signal?: AbortSignal): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new TryonError(503, "试穿服务未开放");
  const timeout = AbortSignal.timeout(KOLORS_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(KOLORS_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
        // 请求 fal 不保存本次请求的输入输出（D47）。
        "X-Fal-Store-IO": "0",
      },
      body: JSON.stringify({ human_image_url: input.humanImage, garment_image_url: input.garmentImage }),
      signal: combined,
      cache: "no-store",
    });
  } catch (e) {
    if (combined.aborted || (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") {
      throw new TryonError(504, "试穿超时，请稍后再试");
    }
    throw new TryonError(502, "试穿服务暂时连不上，请稍后再试");
  }
  if (!res.ok) {
    // 只按状态码给出中文说明，不回显第三方响应体。
    if (res.status === 401 || res.status === 403) throw new TryonError(502, "试穿服务配置有误，请稍后再试");
    if (res.status === 422 || res.status === 400) throw new TryonError(422, "这张形象照无法试穿，请换一张光线充足的正面全身照");
    if (res.status === 429) throw new TryonError(429, "试穿的人有点多，请稍后再试");
    if (res.status === 504 || res.status === 408) throw new TryonError(504, "试穿超时，请稍后再试");
    throw new TryonError(502, "试穿服务暂时不可用，请稍后再试");
  }
  const data = (await res.json().catch(() => null)) as { image?: { url?: unknown } } | null;
  const url = data?.image?.url;
  if (typeof url !== "string" || !(url.startsWith("https://") || url.startsWith("data:image/"))) {
    throw new TryonError(502, "试穿服务没有返回图片，请稍后再试");
  }
  return url;
}
