import { reserveSpend } from "@/lib/spend";
import { SceneError } from "./errors";

// 场景出图（D75）：商品详情页“上身效果”、场景与姿势（方案 A）、封面换成我（方案 B）共用。
// - 主模型：fal 上的 Nano Banana 2.1（fal-ai/nano-banana-2.1/edit），1K、3:4、JPEG。
//   选型依据（docs/design/场景姿态试穿探索-20261025.md §七）：同一组输入下 2.1 的人脸与衣服还原与 Pro 相当，
//   价格约为 Pro 的三分之一，速度相近；2 Lite 更便宜但人脸会走样，不用。
// - 分辨率 1K：入库前会压到长边 1600（compress.ts），2K 的多出的像素会被丢掉、却要多付钱。要改 2K 先改那边的上限。
// - 主模型报错（5xx、429）或没返回图片时，用 Nano Banana Pro 重试一次；超时与 4xx（输入被拒）不重试。
// - 每次调用前按估价向全站每日总额预留（lib/spend.ts），总额满了直接拒绝，不调用 fal。
// - 请求头 X-Fal-Store-IO: 0：请 fal 不保存本次请求的输入输出（与 2D 试穿一致）。
// - SCENE_IMAGE_MODEL 可换主模型（fal 的 endpoint id）；不在下表里的模型按 Pro 的价格估算。

type ModelSpec = { endpoint: string; microUsd: number; body?: Record<string, unknown> };

/**
 * 估价（用于每日总额，宁高勿低）：Pro 为 fal 标价 0.15 美元 / 张（1K、2K 同价）。
 * 2.1 在 fal 按用量计费、没有单张标价：Google 官方 1K 价 0.034 美元；fal 全站历史均价 0.085 美元 / 次（含 2K、4K）；
 * 同期 Pro、2 的历史均价约为各自 1K 标价的 2 倍、1.5 倍，据此按 0.06 美元记。以 fal 账单为准再校正。
 * 2.1 的 thinking_level 用 minimal：实测（2026-10-26，同一组输入、1K）比默认 medium 快约 6 秒（21 秒对 28 秒），人脸与衣服无差别。
 */
export const SCENE_MODELS = {
  nb21: { endpoint: "fal-ai/nano-banana-2.1/edit", microUsd: 60_000, body: { thinking_level: "minimal" } },
  pro: { endpoint: "fal-ai/nano-banana-pro/edit", microUsd: 150_000 },
} satisfies Record<string, ModelSpec>;

export function primaryModel(env: NodeJS.ProcessEnv = process.env): ModelSpec {
  const id = env.SCENE_IMAGE_MODEL?.trim();
  if (!id || id === SCENE_MODELS.nb21.endpoint) return SCENE_MODELS.nb21;
  if (id === SCENE_MODELS.pro.endpoint) return SCENE_MODELS.pro;
  return /^fal-ai\/[a-z0-9.\-/]{1,80}$/.test(id) ? { endpoint: id, microUsd: SCENE_MODELS.pro.microUsd } : SCENE_MODELS.nb21;
}

export function falHeaders(closedMessage = "上身效果暂未开放") {
  const key = process.env.FAL_KEY;
  if (!key) throw new SceneError(503, closedMessage);
  return { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" };
}

export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new SceneError(502, "生成结果无法读取");
  const res = await fetch(url, { signal, cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) throw new SceneError(502, "生成结果下载失败，请稍后再试");
  return new Uint8Array(await res.arrayBuffer());
}

/** 主模型这次失败后值得换 Pro 重试吗：服务端错误、限流、没返回图片可以；超时和输入被拒（4xx）不行。 */
class Retryable extends Error {}

async function callModel(model: ModelSpec, images: string[], prompt: string, signal: AbortSignal, rejected: string): Promise<Uint8Array> {
  await reserveSpend(`scene:${model.endpoint}`, model.microUsd);
  const res = await fetch(`https://fal.run/${model.endpoint}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ prompt, image_urls: images, aspect_ratio: "3:4", resolution: "1K", num_images: 1, output_format: "jpeg", ...model.body }),
    signal,
    cache: "no-store",
  }).catch((e: Error) => {
    if (signal.aborted || e?.name === "TimeoutError" || e?.name === "AbortError") throw new SceneError(504, "生成超时，请稍后再试");
    throw new Retryable("network");
  });
  if (res.status === 400 || res.status === 422) throw new SceneError(422, rejected);
  if (!res.ok) throw new Retryable(String(res.status));
  const data = (await res.json().catch(() => null)) as { images?: { url?: unknown }[] } | null;
  const url = data?.images?.[0]?.url;
  if (typeof url !== "string") throw new Retryable("no image");
  return fetchBytes(url, signal);
}

/**
 * 生成一张场景图，返回原始字节（调用方负责压缩入库）。images 为 https 地址或 data URI，顺序与 prompt 里的编号一致。
 * rejected：输入被模型拒绝（4xx）时给用户的提示。
 */
export async function generateSceneImage(images: string[], prompt: string, opts: { signal: AbortSignal; rejected: string }): Promise<Uint8Array> {
  const primary = primaryModel();
  try {
    return await callModel(primary, images, prompt, opts.signal, opts.rejected);
  } catch (e) {
    if (!(e instanceof Retryable)) throw e;
    if (primary === SCENE_MODELS.pro) throw new SceneError(502, "生成服务暂时不可用，请稍后再试");
    console.warn(`[scene] ${primary.endpoint} 失败（${e.message}），改用 Pro 重试一次`);
  }
  try {
    return await callModel(SCENE_MODELS.pro, images, prompt, opts.signal, opts.rejected);
  } catch (e) {
    if (e instanceof Retryable) throw new SceneError(502, "生成服务暂时不可用，请稍后再试");
    throw e;
  }
}
