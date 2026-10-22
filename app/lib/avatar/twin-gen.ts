import { sniffImage } from "./image";

// 数字分身（D63）的纯生成部分：提示词、参考图处理与 fal 排队调用。不碰数据库与私有存储，
// 供 twin.ts（线上生成）与 scripts/twin-eval-gen.ts（脸部相似度评估，D68）共用，保证评估测的就是线上的提示词与参数。

export const IMAGE_MODEL = "fal-ai/nano-banana-pro/edit";

export type TwinGender = "female" | "male";
export type TwinAngle = "front" | "side" | "back";
export const TWIN_ANGLES: readonly TwinAngle[] = ["front", "side", "back"];
export type TwinResolution = "1K" | "2K" | "4K";

// ---------- 提示词 ----------
// 2026-10-17 指挥台用真实 key 实测达标的模板（脸、发型、身材与参考一致，三张并行约 40 秒）。
// Claude 分析得到的外观描述只作为补充短句附在 “Reproduce …” 一句之后，不覆盖模板约束。

/** 参考图的顺序：正脸、侧脸、全身正面、全身侧面，最后是半身或其他。 */
export const REFERENCE_ORDER = ["face", "extra", "front", "side", "back"] as const;

const ROLE: Record<string, (pr: string) => string> = {
  face: (pr) => `${pr} frontal face close-up`,
  extra: (pr) => `${pr} side profile`,
  front: (pr) => `${pr} full body`,
  side: (pr) => `${pr} full body`,
  back: (pr) => `an additional photo of ${pr === "her" ? "her" : "him"}`,
};

/** “Reference 1 is her frontal face close-up, reference 2 her side profile, references 3 and 4 her full body.” */
export function referenceSentence(slots: readonly string[], pr: "her" | "his"): string {
  const groups: { role: string; idx: number[] }[] = [];
  slots.forEach((slot, i) => {
    const role = (ROLE[slot] ?? ROLE.back)(pr);
    const last = groups.at(-1);
    if (last && last.role === role) last.idx.push(i + 1);
    else groups.push({ role, idx: [i + 1] });
  });
  const list = (idx: number[]) => (idx.length === 1 ? `${idx[0]}` : `${idx.slice(0, -1).join(", ")} and ${idx.at(-1)}`);
  const parts = groups.map((g, k) => {
    const noun = g.idx.length === 1 ? "reference" : "references";
    const head = `${k === 0 ? noun[0].toUpperCase() + noun.slice(1) : noun} ${list(g.idx)}`;
    return k === 0 ? `${head} ${g.idx.length === 1 ? "is" : "are"} ${g.role}` : `${head} ${g.role}`;
  });
  return `${parts.join(", ")}.`;
}

const OUTFIT: Record<TwinGender, string> = {
  female: "a plain white fitted short-sleeve crew-neck t-shirt, slim light grey ankle-length trousers, plain white flat sneakers",
  male: "a plain white short-sleeve crew-neck t-shirt, light grey straight-leg trousers, plain white sneakers",
};

function view(angle: TwinAngle, pr: "her" | "his"): string {
  if (angle === "front") return "standing facing the camera directly, front view";
  if (angle === "side") return `standing in a three-quarter view, body turned about 45 degrees to ${pr} left, face still clearly visible`;
  return "standing with " + pr + " back to the camera, back view, head slightly turned so the hair is visible";
}

export function twinPrompt(
  angle: TwinAngle,
  gender: TwinGender,
  a: { descriptor?: string | null; glasses?: boolean | null; slots?: readonly string[] } = {},
): string {
  const noun = gender === "female" ? "woman" : "man";
  const pr = gender === "female" ? "her" : "his";
  const obj = gender === "female" ? "her" : "him";
  const subj = gender === "female" ? "she" : "he";
  const slots = a.slots?.length ? a.slots : ["face", "extra", "front", "side"];
  return [
    `Studio full-body identity photo of the SAME ${noun} shown in the reference photos.`,
    referenceSentence(slots, pr),
    `Reproduce ${pr} identity exactly: identical face shape, eyes, eyelids, eyebrows, nose, lips, jawline, skin tone and skin texture, identical hairstyle, hair length, parting and hair color, and identical body shape, height proportions, shoulder width, waist, hips and leg length as in the full-body references.`,
    a.descriptor ? `Additional notes: ${a.descriptor}` : "",
    a.glasses ? "Wearing the same glasses as in the reference." : "",
    `Do not beautify, slim or idealize ${obj}; ${subj} must be instantly recognizable as the same person.`,
    `Pose: ${view(angle, pr)}, natural relaxed standing posture, arms hanging naturally at ${pr} sides (not a T-pose), feet slightly apart, entire body visible from head to toe with some space above the head and below the feet.`,
    `Wardrobe: ${OUTFIT[gender]}, no accessories, no logos.`,
    "Seamless light warm-beige studio backdrop, soft even diffused daylight, subtle natural floor shadow, neutral white balance, photorealistic fashion catalog photography, sharp focus, 85mm lens look.",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------- 参考图 ----------

/** 参考图：长边 1536、JPEG q90 的 data URI（指挥台实测参数）；sharp 不可用时原样转 data URI。 */
export const REFERENCE_MAX_EDGE = 1536;

export async function referenceFromBytes(bytes: Uint8Array, mime: string): Promise<string> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: REFERENCE_MAX_EDGE, height: REFERENCE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  }
}

// ---------- fal ----------

export class GenError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function falHeaders() {
  const key = process.env.FAL_KEY;
  if (!key) throw new GenError(503, "形象生成服务未启用");
  // X-Fal-Store-IO: 0 —— 请 fal 不保存本次请求的输入输出。
  return { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" };
}

function falError(status: number): GenError {
  if (status === 422 || status === 400) return new GenError(422, "照片无法用于生成，请换光线充足、五官清晰的照片");
  if (status === 429) return new GenError(429, "生成的人有点多，请稍后再试");
  return new GenError(502, "生成服务暂时不可用，请稍后再试");
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new GenError(504, "生成超时，请稍后再试"))), { once: true });
  });

export type GenerateOptions = { resolution?: TwinResolution; aspectRatio?: "3:4" | "1:1" };

/** 走 fal 排队接口：提交 → 轮询状态 → 取结果（同步端点在 fal 排队时容易超时，实测 40–120 秒波动）。 */
export async function generateOne(prompt: string, imageUrls: string[], signal: AbortSignal, opts: GenerateOptions = {}): Promise<Uint8Array> {
  const netErr = (e: Error) => {
    if (signal.aborted || e?.name === "TimeoutError" || e?.name === "AbortError") throw new GenError(504, "生成超时，请稍后再试");
    throw new GenError(502, "生成服务暂时连不上，请稍后再试");
  };
  const submit = await fetch(`https://queue.fal.run/${IMAGE_MODEL}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ prompt, image_urls: imageUrls, aspect_ratio: opts.aspectRatio ?? "3:4", resolution: opts.resolution ?? "2K", num_images: 1, output_format: "jpeg" }),
    signal,
    cache: "no-store",
  }).catch(netErr);
  if (!submit.ok) throw falError(submit.status);
  const q = (await submit.json().catch(() => null)) as { status_url?: unknown; response_url?: unknown } | null;
  const statusUrl = typeof q?.status_url === "string" ? q.status_url : null;
  const responseUrl = typeof q?.response_url === "string" ? q.response_url : null;
  if (!statusUrl?.startsWith("https://") || !responseUrl?.startsWith("https://")) throw new GenError(502, "生成服务没有返回任务，请稍后再试");
  for (;;) {
    await sleep(Number(process.env.TWIN_QUEUE_POLL_MS ?? 3000), signal);
    const st = await fetch(statusUrl, { headers: falHeaders(), signal, cache: "no-store" }).catch(netErr);
    if (!st.ok) {
      if (st.status >= 500) continue; // 状态查询偶发失败，继续等
      throw falError(st.status);
    }
    const sd = (await st.json().catch(() => null)) as { status?: unknown } | null;
    if (sd?.status === "COMPLETED") break;
  }
  const res = await fetch(responseUrl, { headers: falHeaders(), signal, cache: "no-store" }).catch(netErr);
  if (!res.ok) throw falError(res.status);
  const data = (await res.json().catch(() => null)) as { images?: { url?: unknown }[] } | null;
  const url = data?.images?.[0]?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw new GenError(502, "生成服务没有返回图片，请稍后再试");
  const dl = await fetch(url, { signal, cache: "no-store" }).catch(() => null);
  if (!dl || !dl.ok) throw new GenError(502, "生成结果下载失败，请稍后再试");
  const bytes = new Uint8Array(await dl.arrayBuffer());
  if (!sniffImage(bytes)) throw new GenError(502, "生成结果无法读取，请稍后再试");
  return bytes;
}

/** 第一次失败后，剩余时间不少于这么多才重试。 */
const RETRY_MIN_LEFT_MS = 60_000;

/** 生成一张；失败且剩余时间足够时重试一次。 */
export async function generateWithRetry(
  prompt: string,
  imageUrls: string[],
  signal: AbortSignal,
  deadline: number,
  opts: GenerateOptions = {},
): Promise<Uint8Array> {
  try {
    return await generateOne(prompt, imageUrls, signal, opts);
  } catch (e) {
    if (signal.aborted || deadline - Date.now() < RETRY_MIN_LEFT_MS) throw e;
    if (e instanceof GenError && e.status === 422) throw e; // 输入问题，重试无益
    return generateOne(prompt, imageUrls, signal, opts);
  }
}
