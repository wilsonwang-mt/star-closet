import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { getProfile } from "@/lib/profile";
import { avatarKey, getStorage, isValidKey } from "@/lib/storage";
import { cleanSummary } from "./body";
import { sniffImage } from "./image";
import { BODY_ANALYSIS_NAME, hasRequiredSlots, requiredSlotsMessage } from "./providers";
import { setPhotoExpiry } from "./purge";
import { AvatarError, removeOlderResults, requireTwinConsent, TWIN_STALE_MS } from "./service";

// 数字分身（D63）：不做 3D。
// 1. 用户上传 2–5 张照片（正脸、全身正面必传；侧脸、全身侧面、半身/其他选传）。
// 2. 用户单独同意由 Anthropic（Claude）分析照片且配置了 ANTHROPIC_API_KEY 时，Claude 给出一句体型概括与结构化外观特征
//    （发型、发色、脸型、肤色、身材类型、肩/腰/臀/腿相对比例、是否戴眼镜）；否则跳过。
// 3. fal.ai 上的 nano-banana-pro/edit 以该用户全部照片为参考图，并行生成正面、四分之三侧面、背面三张标准形象照
//    （统一素色贴身基础服装、浅米色影棚背景、自然光）。参考图按 正脸、侧脸、全身正面、全身侧面、半身/其他 排序，
//    压到长边 1536、JPEG q90 的 data URI。正面必须成功；侧面/背面失败允许为空。每张失败重试一次。
// 4. 结果存私有存储 `<userId>/avatars/twin-<jobId>-front.jpg` 等，写一条 avatar_job（provider = twin，result_images 存 key 与分析结果）。
//    新分身成功后才删除旧分身；一键删除（deleteAll）随用户前缀清理全部文件并清空 result_images。
// 试穿（另一个任务）通过 getTwin / readTwinImageDataUri / getIdentityRefs 使用这组照片。

const ANALYSIS_MODEL = "claude-opus-5-5";
const IMAGE_MODEL = "fal-ai/nano-banana-pro/edit";
/** 整个生成（含分析与重试）的上限；路由 maxDuration 为 120 秒。 */
/** 后台生成总预算：fal 排队时单张实测 40–120 秒，三张并行加一次重试。 */
const TOTAL_BUDGET_MS = 240_000;
const ANALYSIS_TIMEOUT_MS = 30_000;
/** 分析结果最多等这么久再开始生成（赶上了就写进提示词）。 */
const ANALYSIS_PROMPT_WAIT_MS = 12_000;
/** 第一次失败后，剩余时间不少于这么多才重试。 */
const RETRY_MIN_LEFT_MS = 60_000;

export type TwinGender = "female" | "male";
export type TwinAngle = "front" | "side" | "back";
export const TWIN_ANGLES: readonly TwinAngle[] = ["front", "side", "back"];

// ---------- 接口契约（试穿任务调用，签名不要改） ----------

export type TwinImages = { front: string; side: string | null; back: string | null }; // 私有存储 key

export type Twin = {
  jobId: string;
  images: TwinImages;
  summary: string | null;
  traits: Record<string, string> | null;
  gender: TwinGender | null;
};

// ---------- result_images 的形状 ----------

export type TwinRecord = TwinImages & {
  summary: string | null;
  traits: Record<string, string> | null;
  gender: TwinGender | null;
  /** 分析给出的英文外观描述（只用于提示词，不显示）。 */
  descriptor?: string | null;
};

const isGender = (g: unknown): g is TwinGender => g === "female" || g === "male";
const keyOrNull = (k: unknown) => (typeof k === "string" && isValidKey(k) ? k : null);

export function parseTwinRecord(raw: unknown): TwinRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const front = keyOrNull(r.front);
  if (!front) return null;
  const traits =
    r.traits && typeof r.traits === "object"
      ? Object.fromEntries(Object.entries(r.traits as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]))
      : null;
  return {
    front,
    side: keyOrNull(r.side),
    back: keyOrNull(r.back),
    summary: typeof r.summary === "string" ? r.summary : null,
    traits: traits && Object.keys(traits).length ? traits : null,
    gender: isGender(r.gender) ? r.gender : null,
    descriptor: typeof r.descriptor === "string" ? r.descriptor : null,
  };
}

/** result_images 里全部存储 key（删除用）。 */
export function twinImageKeys(raw: unknown): string[] {
  const r = parseTwinRecord(raw);
  return r ? [r.front, r.side, r.back].filter((k): k is string => !!k) : [];
}

// ---------- 页面视图 ----------

/** 特征标签的显示顺序与中文名。 */
export const TRAIT_LABELS: Record<string, string> = {
  hair: "发型",
  hairColor: "发色",
  faceShape: "脸型",
  skinTone: "肤色",
  bodyType: "身材",
  shoulders: "肩",
  waist: "腰",
  hips: "臀",
  legs: "腿",
  glasses: "眼镜",
};

export type TwinView = {
  jobId: string;
  /** 依次为正面、侧面、背面中已生成的照片 */
  shots: { angle: TwinAngle; label: string; url: string }[];
  summary: string | null;
  tags: string[];
  gender: TwinGender | null;
  createdAt: string;
};

const ANGLE_LABEL: Record<TwinAngle, string> = { front: "正面", side: "侧面", back: "背面" };
const fileUrl = (key: string) => `/api/avatar/files/${key}`;

export function twinViewOf(job: { id: string; resultImages: unknown; createdAt: Date }): TwinView | null {
  const r = parseTwinRecord(job.resultImages);
  if (!r) return null;
  return {
    jobId: job.id,
    shots: TWIN_ANGLES.filter((a) => r[a]).map((a) => ({ angle: a, label: ANGLE_LABEL[a], url: fileUrl(r[a]!) })),
    summary: r.summary,
    tags: Object.keys(TRAIT_LABELS)
      .map((k) => r.traits?.[k])
      .filter((v): v is string => !!v)
      .slice(0, 8),
    gender: r.gender,
    createdAt: job.createdAt.toISOString(),
  };
}

// ---------- 读取 ----------

const notExpired = () => or(isNull(schema.avatarPhoto.expiresAt), gt(schema.avatarPhoto.expiresAt, new Date()));

async function latestTwinRow(userId: string) {
  const rows = await db
    .select()
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), eq(schema.avatarJob.provider, "twin"), eq(schema.avatarJob.status, "succeeded")))
    .orderBy(desc(schema.avatarJob.createdAt))
    .limit(5);
  return rows.find((r) => parseTwinRecord(r.resultImages)) ?? null;
}

/** 本人最近一次成功生成的数字分身；没有返回 null。 */
export async function getTwin(userId: string): Promise<Twin | null> {
  const row = await latestTwinRow(userId);
  const r = row ? parseTwinRecord(row.resultImages) : null;
  if (!row || !r) return null;
  return { jobId: row.id, images: { front: r.front, side: r.side, back: r.back }, summary: r.summary, traits: r.traits, gender: r.gender };
}

/** 读私有存储转 data URI（发给 fal 用）。不存在时抛错。 */
export async function readTwinImageDataUri(key: string): Promise<string> {
  if (!isValidKey(key)) throw new AvatarError(400, "图片位置不对");
  const obj = await getStorage().get(key);
  if (!obj) throw new AvatarError(404, "形象照不存在，请重新生成");
  const mime = sniffImage(obj.bytes)?.mime ?? obj.contentType;
  return `data:${mime};base64,${Buffer.from(obj.bytes).toString("base64")}`;
}

async function livePhotos(userId: string) {
  return db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt), notExpired()))
    .orderBy(desc(schema.avatarPhoto.createdAt));
}

/** 可作身份参考的图片 data URI：分身正面 + 正脸 + 侧脸（存在的），最多 4 张。 */
export async function getIdentityRefs(userId: string): Promise<string[]> {
  const [twin, photos] = await Promise.all([getTwin(userId), livePhotos(userId)]);
  const out: string[] = [];
  if (twin) {
    const uri = await readTwinImageDataUri(twin.images.front).catch(() => null);
    if (uri) out.push(uri);
  }
  for (const slot of ["face", "extra"]) {
    const p = photos.find((x) => x.slot === slot);
    if (!p) continue;
    const uri = await readTwinImageDataUri(p.storageKey).catch(() => null);
    if (uri) out.push(uri);
  }
  return out.slice(0, 4);
}

// ---------- 分析（Claude） ----------

const TraitsSchema = z.object({
  summary: z.string().describe("不超过 30 字的中文体型与整体形象概括"),
  gender: z.enum(["female", "male"]).describe("最接近的服装版型"),
  hair: z.string().describe("发型，中文短语，如“齐肩直发”"),
  hairColor: z.string().describe("发色，中文短语"),
  faceShape: z.string().describe("脸型，中文短语"),
  skinTone: z.string().describe("肤色，中文短语"),
  bodyType: z.string().describe("身材类型，中文短语"),
  shoulders: z.string().describe("肩宽相对比例，中文短语"),
  waist: z.string().describe("腰线相对比例，中文短语"),
  hips: z.string().describe("臀胯相对比例，中文短语"),
  legs: z.string().describe("腿长相对比例，中文短语"),
  glasses: z.boolean().describe("是否戴眼镜"),
  descriptorEn: z.string().describe("给图像模型的英文外观描述，一到三句"),
});
export type ModelTraits = z.infer<typeof TraitsSchema>;

const ANALYSIS_SYSTEM = `你在为线上买手店 Star Closet 生成用户的“数字分身”标准形象照做准备。输入是同一个人的几张照片（正脸、全身正面，可能还有侧脸、全身侧面、半身照），以及可选的身高。
请描述这个人可见的外观特征，供图像模型保持一致：
- hair / hairColor / faceShape / skinTone：发型、发色、脸型、肤色，用简短中文短语；
- bodyType / shoulders / waist / hips / legs：身材类型与肩、腰、臀、腿的相对比例，用中性的服装版型语言（如“肩线偏窄”“腰线较高”“腿部比例修长”）；
- glasses：照片中是否戴眼镜；
- gender：选择更接近的服装版型 female 或 male；
- summary：一句不超过 30 字的中文概括，只描述比例、线条与整体气质；
- descriptorEn：用英文写给图像模型的外观描述（发型发色、脸型、肤色、眼镜、身材比例），一到三句。

规则：
1. 只依据照片里看得清的特征；看不清的填“看不清”。
2. 用中性、不评判的语言：不写体重数字，不用“胖”“瘦”“身材好/差”“美/丑”等评价词，不写“精准”“还原”“复刻”之类的说法。
3. 不识别、不猜测人物身份、姓名、年龄、民族或其他与穿搭无关的敏感特征。`;

export type TwinImage = { slot: string; mime: string; base64: string };
export type TraitsCall = (input: { images: TwinImage[]; heightCm: number | null }) => Promise<ModelTraits | null>;

const SLOT_TEXT: Record<string, string> = { face: "正脸：", front: "全身正面：", extra: "侧脸：", side: "全身侧面：", back: "半身或其他角度：" };

export const callTraitsClaude: TraitsCall = async ({ images, heightCm }) => {
  const client = new Anthropic({ timeout: ANALYSIS_TIMEOUT_MS, maxRetries: 0 });
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    content.push(
      { type: "text", text: SLOT_TEXT[img.slot] ?? "照片：" },
      { type: "image", source: { type: "base64", media_type: img.mime as "image/jpeg" | "image/png" | "image/webp", data: img.base64 } },
    );
  }
  content.push({ type: "text", text: heightCm ? `身高 ${heightCm} cm。` : "未提供身高。" });
  const response = await client.messages.parse({
    model: ANALYSIS_MODEL,
    max_tokens: 4000,
    system: ANALYSIS_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(TraitsSchema) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
};

const UNCLEAR = /看不清|不清楚|无法判断|未知/;
const short = (s: unknown, max = 12) => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, "").replace(/[。．.!！]+$/u, "");
  if (!t || UNCLEAR.test(t) || /精准|精确|还原|复刻/.test(t)) return null;
  return Array.from(t).slice(0, max).join("");
};

/** 把模型输出整理成可显示的特征标签（去掉看不清的项）与提示词描述。 */
export function normalizeTraits(out: ModelTraits): { summary: string | null; traits: Record<string, string> | null; gender: TwinGender | null; descriptor: string | null } {
  const traits: Record<string, string> = {};
  for (const k of ["hair", "hairColor", "faceShape", "skinTone", "bodyType", "shoulders", "waist", "hips", "legs"] as const) {
    const v = short(out[k]);
    if (v) traits[k] = v;
  }
  traits.glasses = out.glasses ? "戴眼镜" : "不戴眼镜";
  const descriptor = typeof out.descriptorEn === "string" ? out.descriptorEn.replace(/\s+/g, " ").trim().slice(0, 600) || null : null;
  return { summary: cleanSummary(out.summary), traits, gender: isGender(out.gender) ? out.gender : null, descriptor };
}

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

// ---------- fal ----------

function falHeaders() {
  const key = process.env.FAL_KEY;
  if (!key) throw new AvatarError(503, "形象生成服务未启用");
  // X-Fal-Store-IO: 0 —— 请 fal 不保存本次请求的输入输出。
  return { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" };
}

class GenError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function falError(status: number): GenError {
  if (status === 422 || status === 400) return new GenError(422, "照片无法用于生成，请换光线充足、五官清晰的照片");
  if (status === 429) return new GenError(429, "生成的人有点多，请稍后再试");
  return new GenError(502, "生成服务暂时不可用，请稍后再试");
}

/** 参考图：长边 1536、JPEG q90 的 data URI（指挥台实测参数）；sharp 不可用时原样转 data URI。 */
export const REFERENCE_MAX_EDGE = 1536;

async function referenceDataUri(key: string, mime: string): Promise<string> {
  const obj = await getStorage().get(key);
  if (!obj) throw new AvatarError(409, "照片文件不存在，请重新上传");
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(obj.bytes)
      .rotate()
      .resize({ width: REFERENCE_MAX_EDGE, height: REFERENCE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return `data:${mime};base64,${Buffer.from(obj.bytes).toString("base64")}`;
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new GenError(504, "生成超时，请稍后再试"))), { once: true });
  });

/** 走 fal 排队接口：提交 → 轮询状态 → 取结果（同步端点在 fal 排队时容易超时，实测 40–120 秒波动）。 */
async function generateOne(prompt: string, imageUrls: string[], signal: AbortSignal): Promise<Uint8Array> {
  const netErr = (e: Error) => {
    if (signal.aborted || e?.name === "TimeoutError" || e?.name === "AbortError") throw new GenError(504, "生成超时，请稍后再试");
    throw new GenError(502, "生成服务暂时连不上，请稍后再试");
  };
  const submit = await fetch(`https://queue.fal.run/${IMAGE_MODEL}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ prompt, image_urls: imageUrls, aspect_ratio: "3:4", resolution: "2K", num_images: 1, output_format: "jpeg" }),
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

/** 生成一张；失败且剩余时间足够时重试一次。 */
async function generateWithRetry(prompt: string, imageUrls: string[], signal: AbortSignal, deadline: number): Promise<Uint8Array> {
  try {
    return await generateOne(prompt, imageUrls, signal);
  } catch (e) {
    if (signal.aborted || deadline - Date.now() < RETRY_MIN_LEFT_MS) throw e;
    if (e instanceof GenError && e.status === 422) throw e; // 输入问题，重试无益
    return generateOne(prompt, imageUrls, signal);
  }
}

// ---------- 生成 ----------

const g = globalThis as unknown as { scTwinInflight?: Set<string> };
const inflight = (g.scTwinInflight ??= new Set());

export type GenerateDeps = { analyze?: TraitsCall };

/**
 * POST /api/avatar/twin 的实现。需已同意由 fal.ai 上的 AI 图像模型生成形象（requireTwinConsent）。
 * 返回新作业 id；失败时作业记为 failed 并抛 AvatarError。
 */
export async function generateTwin(userId: string, input: { gender?: unknown }, deps: GenerateDeps = {}): Promise<{ jobId: string }> {
  const { consent } = await requireTwinConsent(userId);
  if (inflight.has(userId)) throw new AvatarError(409, "正在生成你的形象，请稍候");
  // 进程内的 inflight 只管同一实例；多实例部署时再看数据库里是否有仍在进行的生成。
  const running = await db
    .select({ updatedAt: schema.avatarJob.updatedAt })
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), eq(schema.avatarJob.provider, "twin"), eq(schema.avatarJob.status, "processing")));
  if (running.some((r) => Date.now() - r.updatedAt.getTime() < TWIN_STALE_MS)) throw new AvatarError(409, "正在生成你的形象，请稍候");
  inflight.add(userId);
  const started = Date.now();
  const deadline = started + TOTAL_BUDGET_MS;
  const jobId = crypto.randomUUID();
  const writtenKeys: string[] = [];
  try {
    const photos = (await livePhotos(userId)).filter((p, i, all) => all.findIndex((x) => x.slot === p.slot) === i);
    if (!hasRequiredSlots("twin", photos)) throw new AvatarError(400, requiredSlotsMessage("twin"));
    const ordered = REFERENCE_ORDER
      .map((slot) => photos.find((p) => p.slot === slot))
      .filter((p): p is (typeof photos)[number] => !!p);

    const now = new Date();
    await db.insert(schema.avatarJob).values({
      id: jobId,
      userId,
      status: "processing",
      provider: "twin",
      inputPhotoIds: ordered.map((p) => p.id),
      consentVersion: consent.version,
      consentAt: new Date(consent.at),
      createdAt: now,
      updatedAt: now,
    });

    // 1. 分析（只在单独同意且配置了 key 时）与生成并行：分析最多先等 ANALYSIS_PROMPT_WAIT_MS，
    //    赶上了就把眼镜与外观描述写进提示词；没赶上就先生成（实测提示词不依赖分析也能还原本人），概括与标签等分析结束后再写入。
    type Analysis = { analysis: ReturnType<typeof normalizeTraits> | null; glasses: boolean | null };
    const analysisP: Promise<Analysis> = (async () => {
      if (!(consent.bodyAnalysis && process.env.ANTHROPIC_API_KEY)) return { analysis: null, glasses: null };
      try {
        const storage = getStorage();
        const images: TwinImage[] = [];
        for (const p of ordered) {
          const obj = await storage.get(p.storageKey).catch(() => null);
          if (obj) images.push({ slot: p.slot, mime: p.mime, base64: Buffer.from(obj.bytes).toString("base64") });
        }
        const { heightCm } = await getProfile(userId);
        const call = deps.analyze ?? callTraitsClaude;
        const out = await Promise.race([
          call({ images, heightCm }),
          new Promise<null>((r) => setTimeout(() => r(null), ANALYSIS_TIMEOUT_MS)),
        ]);
        if (out) return { analysis: normalizeTraits(out), glasses: !!out.glasses };
        console.warn(`[avatar] ${BODY_ANALYSIS_NAME} 分析未返回结果，跳过`);
      } catch (e) {
        // 只记错误类型，不记响应内容。
        console.warn(`[avatar] 形象分析失败，跳过：${e instanceof Error ? e.name : "unknown"}`);
      }
      return { analysis: null, glasses: null };
    })();
    const imageUrlsP = Promise.all(ordered.map((p) => referenceDataUri(p.storageKey, p.mime)));

    let gender: TwinGender | null = isGender(input.gender) ? input.gender : null;
    const early = gender
      ? await Promise.race([analysisP, new Promise<null>((r) => setTimeout(() => r(null), ANALYSIS_PROMPT_WAIT_MS))])
      : await analysisP; // 没选性别时只能等分析推断
    if (!gender) gender = early?.analysis?.gender ?? null;
    if (!gender) throw new AvatarError(400, "请先选择形象性别");
    const g2: TwinGender = gender;

    // 2. 三张并行生成
    const imageUrls = await imageUrlsP;
    const slots = ordered.map((p) => p.slot);
    const signal = AbortSignal.timeout(Math.max(10_000, deadline - Date.now()));
    const results = await Promise.allSettled(
      TWIN_ANGLES.map((angle) =>
        generateWithRetry(twinPrompt(angle, g2, { descriptor: early?.analysis?.descriptor, glasses: early?.glasses ?? null, slots }), imageUrls, signal, deadline),
      ),
    );
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        const e = r.reason;
        console.warn(`[avatar] twin ${jobId} ${TWIN_ANGLES[i]} 生成失败：${e instanceof GenError || e instanceof AvatarError ? `${e.status} ${e.message}` : e instanceof Error ? e.name : "unknown"}`);
      }
    }
    const front = results[0];
    if (front.status === "rejected") {
      const e = front.reason;
      throw e instanceof GenError || e instanceof AvatarError ? new AvatarError(e.status, e.message) : new AvatarError(502, "生成失败，请稍后再试");
    }
    const { analysis } = await analysisP;

    // 3. 存储
    const storage = getStorage();
    const keys: Partial<Record<TwinAngle, string>> = {};
    for (const [i, angle] of TWIN_ANGLES.entries()) {
      const r = results[i];
      if (r.status !== "fulfilled") continue;
      const info = sniffImage(r.value)!;
      const key = avatarKey(userId, `twin-${jobId}-${angle}`, info.ext);
      await storage.put(key, r.value, info.mime);
      writtenKeys.push(key);
      keys[angle] = key;
    }
    const record: TwinRecord = {
      front: keys.front!,
      side: keys.side ?? null,
      back: keys.back ?? null,
      summary: analysis?.summary ?? null,
      traits: analysis?.traits ?? null,
      gender,
      descriptor: analysis?.descriptor ?? null,
    };
    const done = new Date();
    const [row] = await db
      .update(schema.avatarJob)
      .set({ status: "succeeded", resultImages: record, fidelityNote: "AI 根据你的照片生成的形象照。", error: null, updatedAt: done })
      .where(and(eq(schema.avatarJob.id, jobId), eq(schema.avatarJob.status, "processing")))
      .returning();
    if (!row) {
      // 生成期间用户一键删除了全部数据：丢弃结果。
      await storage.remove(writtenKeys).catch(() => {});
      throw new AvatarError(409, "形象已被删除");
    }
    // 新分身就绪后再删旧分身（失败的重新生成不会让用户失去现有形象）。
    await removeOlderResults(userId, jobId);
    await setPhotoExpiry(userId, ordered.map((p) => p.id), done);
    const failed = results.filter((r) => r.status === "rejected").length;
    console.info(`[avatar] twin ${jobId} 完成：${3 - failed}/3 张，${Math.round((Date.now() - started) / 1000)} 秒`);
    return { jobId };
  } catch (e) {
    const err = e instanceof AvatarError ? e : new AvatarError(500, "生成失败，请稍后再试");
    if (!(e instanceof AvatarError)) console.error("[avatar] twin", e instanceof Error ? e.message : "unknown error");
    if (writtenKeys.length) await getStorage().remove(writtenKeys).catch(() => {});
    await db
      .update(schema.avatarJob)
      .set({ status: "failed", error: `PROVIDER_FAILED|${err.message}`, updatedAt: new Date() })
      .where(and(eq(schema.avatarJob.id, jobId), eq(schema.avatarJob.status, "processing")))
      .catch(() => {});
    throw err;
  } finally {
    inflight.delete(userId);
  }
}
