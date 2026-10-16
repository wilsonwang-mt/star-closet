import type { FashnCategory } from "./plan";

// fal 队列接口（通用：提交 / 状态 / 结果 / 取消，FASHN、可灵 Kolors、nano-banana 共用）+ FASHN v1.6 的提交。
// 只在服务端调用，浏览器拿不到 key。是否启用、用哪个模型由 provider.ts 决定；没有 FAL_KEY 时不发起任何外部请求。
// FASHN 自 D62 起为备选（TRYON_PROVIDER=fashn_fal）。
// 文档：https://fal.ai/models/fal-ai/fashn/tryon/v1.6 ——输入 model_image / garment_image（URL 或 base64 data URI）、
// category、mode、garment_photo_type、output_format、sync_mode；输出 images[0].url（864×1296）。
// 走队列接口（D62）：提交后立刻返回，由前端轮询 /api/tryon/<id> 时服务端查询状态、取回结果，不再占着一个长请求。
// 2026-10-17 本机实测（虚构模特图，n=1）：performance 在队列里生成约 8 秒、quality 约 20 秒；
// PNG 结果约 1.5MB、JPEG 约 260KB，经本机链路下载 PNG 要 8–21 秒、JPEG 约 2 秒，所以输出改 JPEG。

export const FASHN_MODEL = "fal-ai/fashn/tryon/v1.6";
export const QUEUE_ENDPOINT = `https://queue.fal.run/${FASHN_MODEL}`;

export class TryonError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 生成模式（D62 两段式）：逐件试穿先用 performance 出图立刻展示，同一件再用 quality 细化后替换；
 * 整套叠加每步用 balanced。旧记录里的 quality 是改造前的单段逐件试穿。
 */
export type FashnMode = "performance" | "balanced" | "quality";

export type FashnInput = {
  modelImage: string;
  garmentImage: string;
  category: FashnCategory;
  mode: FashnMode;
  /** true：结果以 data URI 放在响应里，fal 不留 CDN 副本（D47）；整套叠加的中间步骤要把结果地址交给下一步，用 false。 */
  syncMode?: boolean;
};

/** 队列里的一次请求。带子路径的模型，status / response 地址与提交地址不同，必须用提交时 fal 返回的地址。 */
export type FashnJob = { statusUrl: string; responseUrl: string; cancelUrl: string | null; submittedAt: number };

export type FashnStatus = { state: "queued"; position: number | null } | { state: "running" } | { state: "completed" };

/** 网络抖动等暂时性错误：调用方下次轮询再试，不把这一步记为失败。 */
export class FashnTransientError extends Error {}

function falKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new TryonError(503, "试穿服务未开放");
  return key;
}

// 只按状态码给出中文说明，不回显第三方响应体。
function httpError(status: number): TryonError {
  if (status === 401 || status === 403) return new TryonError(502, "试穿服务配置有误，请稍后再试");
  if (status === 422 || status === 400) return new TryonError(422, "这张照片无法试穿，请换一张光线充足的正面全身照");
  if (status === 429) return new TryonError(429, "试穿的人有点多，请稍后再试");
  return new TryonError(502, "试穿服务暂时不可用，请稍后再试");
}

// key 只发给 fal 的队列域名：提交响应里的地址不是 https://queue.fal.run/ 开头时拒绝使用。
const isQueueUrl = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://queue.fal.run/");

/** 提交一次 FASHN 到 fal 队列，返回查询地址（不等待生成）。 */
export async function submitFashn(input: FashnInput, signal?: AbortSignal): Promise<FashnJob> {
  return submitQueue(
    FASHN_MODEL,
    {
      model_image: input.modelImage,
      garment_image: input.garmentImage,
      category: input.category,
      mode: input.mode,
      garment_photo_type: "flat-lay",
      output_format: "jpeg",
      sync_mode: input.syncMode ?? true,
    },
    signal,
  );
}

/** 提交任意 fal 模型到队列（https://queue.fal.run/<model>），返回查询地址（不等待生成）。 */
export async function submitQueue(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<FashnJob> {
  const key = falKey();
  let res: Response;
  try {
    res = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
        // 请求 fal 不保存本次请求的输入输出（与 3D 形象一致，D47）。
        "X-Fal-Store-IO": "0",
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new TryonError(502, "试穿服务暂时连不上，请稍后再试");
  }
  if (!res.ok) throw httpError(res.status);
  const data = (await res.json().catch(() => null)) as { status_url?: unknown; response_url?: unknown; cancel_url?: unknown } | null;
  if (!isQueueUrl(data?.status_url) || !isQueueUrl(data?.response_url)) throw new TryonError(502, "试穿服务暂时不可用，请稍后再试");
  return {
    statusUrl: data.status_url,
    responseUrl: data.response_url,
    cancelUrl: isQueueUrl(data.cancel_url) ? data.cancel_url : null,
    submittedAt: Date.now(),
  };
}

async function queueGet(url: string, signal?: AbortSignal): Promise<Response> {
  const key = falKey();
  if (!isQueueUrl(url)) throw new TryonError(502, "试穿服务暂时不可用，请稍后再试");
  try {
    return await fetch(url, { headers: { Authorization: `Key ${key}` }, signal: signal ?? AbortSignal.timeout(15_000), cache: "no-store" });
  } catch {
    throw new FashnTransientError("network");
  }
}

/** 查询一次队列状态。网络错误或 5xx 抛 FashnTransientError；4xx 视为这次请求已失效。 */
export async function fashnStatus(job: FashnJob, signal?: AbortSignal): Promise<FashnStatus> {
  const res = await queueGet(job.statusUrl, signal);
  if (res.status >= 500) throw new FashnTransientError(String(res.status));
  if (!res.ok) throw httpError(res.status);
  const data = (await res.json().catch(() => null)) as { status?: unknown; queue_position?: unknown } | null;
  if (data?.status === "COMPLETED") return { state: "completed" };
  if (data?.status === "IN_PROGRESS") return { state: "running" };
  if (data?.status === "IN_QUEUE") return { state: "queued", position: typeof data.queue_position === "number" ? data.queue_position : null };
  throw new FashnTransientError("unknown status");
}

/** 取回已完成请求的结果图地址（sync_mode 下是 data URI）。生成失败时 fal 在这里返回 4xx。 */
export async function fashnResult(job: FashnJob, signal?: AbortSignal): Promise<string> {
  const res = await queueGet(job.responseUrl, signal ?? AbortSignal.timeout(30_000));
  if (res.status >= 500) throw new FashnTransientError(String(res.status));
  if (!res.ok) throw httpError(res.status);
  // FASHN / nano-banana 返回 images[0].url；可灵 Kolors 返回 image.url（单个对象）。
  const data = (await res.json().catch(() => null)) as { images?: { url?: unknown }[]; image?: { url?: unknown } } | null;
  const url = data?.images?.[0]?.url ?? data?.image?.url;
  if (typeof url !== "string" || !(url.startsWith("https://") || url.startsWith("data:image/"))) {
    throw new TryonError(502, "试穿服务没有返回图片，请稍后再试");
  }
  return url;
}

/** 尽力取消（超时或不再需要时）；失败忽略。 */
export async function cancelFashn(job: { cancelUrl?: string | null }): Promise<void> {
  const key = process.env.FAL_KEY;
  if (!key || !isQueueUrl(job.cancelUrl)) return;
  await fetch(job.cancelUrl, { method: "PUT", headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(5_000) }).catch(() => {});
}

/** 把结果图取回本站（https 下载或解码 data URI）。 */
export async function fetchResultImage(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (url.startsWith("data:image/")) {
    const comma = url.indexOf(",");
    if (comma < 0 || !url.slice(0, comma).endsWith(";base64")) throw new TryonError(502, "试穿结果无法读取");
    return new Uint8Array(Buffer.from(url.slice(comma + 1), "base64"));
  }
  try {
    const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    throw new FashnTransientError("download");
  }
}
