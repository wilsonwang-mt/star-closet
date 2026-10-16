import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Item } from "@/lib/catalog";
import { avatarKey, getStorage } from "@/lib/storage";
import { sniffImage } from "@/lib/avatar/image";
import { CONSENT_VERSION as TRYON_CONSENT_VERSION, recordConsent } from "@/lib/tryon/service";
import { isSceneId, pickScenes, SCENES, type SceneId } from "./scenes";

// 商品详情页“上身效果”（T3）：本人穿着这件单品出现在 2 个场景里，并在后台生成 Live 视频。
// - 前提：已登录；有本人正面全身照（avatar_photo.slot = front，与 2D 试穿共用）；已勾选试穿同意（tryon_consent，D47）；设置了 FAL_KEY。
// - 场景图：fal-ai/nano-banana-pro/edit，输入本人正面照 + 单品图 + 场景描述；要求单品颜色款式材质与商品图一致、人物长相不变。
// - Live：场景图生成后提交 fal queue（Kling 2.5 Turbo Pro image-to-video，5 秒、细微动作、无声）；GET 时推进一次轮询。
// - 存储：`<userId>/avatars/scene-<id>.jpg|mp4`（一键删除 3D 形象时随用户前缀清理，见 lib/avatar/service.ts deleteAll）。
// - 同一用户同一件单品只保留最新一组：重新生成前删除旧记录与文件。
// - 请求头 X-Fal-Store-IO: 0：请 fal 不保存本次请求的输入输出（与 2D 试穿一致）。

export class SceneError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const IMAGE_MODEL = "fal-ai/nano-banana-pro/edit";
const VIDEO_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const IMAGE_TIMEOUT_MS = 100_000;

const VIDEO_PROMPT =
  "Living photo: the person stays almost still, only subtle natural motion — a gentle breath, hair and clothing hem moving softly in a light breeze, warm light gently shimmering, a very slow subtle camera push-in. Calm, cinematic, photorealistic. The clothing keeps exactly the same color, pattern and shape. The last frame closely matches the first frame for a seamless loop.";
const VIDEO_NEGATIVE = "fast motion, walking away, turning around, face distortion, changing clothes, morphing, text, watermark, blur";

export function sceneEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

export type SceneRenderView = {
  id: string;
  sceneId: string;
  title: string;
  status: string;
  imageUrl: string | null;
  /** Live 视频就绪后才有值。 */
  videoUrl: string | null;
  /** 视频仍在后台生成。 */
  videoPending: boolean;
  error: string | null;
};

export type SceneState = {
  enabled: boolean;
  signedIn: boolean;
  hasFrontPhoto: boolean;
  consented: boolean;
  renders: SceneRenderView[];
};

const fileUrl = (key: string) => `/api/avatar/files/${key.split("/").map(encodeURIComponent).join("/")}`;

function toView(row: typeof schema.sceneRender.$inferSelect): SceneRenderView {
  const scene = isSceneId(row.sceneId) ? SCENES[row.sceneId] : null;
  return {
    id: row.id,
    sceneId: row.sceneId,
    title: scene?.title ?? "",
    status: row.status,
    imageUrl: row.status === "succeeded" && row.imageKey ? fileUrl(row.imageKey) : null,
    videoUrl: row.videoKey ? `/api/scene/video/${row.id}` : null,
    videoPending: !!row.videoStatusUrl && !row.videoKey,
    error: row.error,
  };
}

/** 本人正面照（与 2D 试穿同一规则：未删除、未过 30 天期限）。 */
async function frontPhoto(userId: string) {
  const rows = await db
    .select()
    .from(schema.avatarPhoto)
    .where(
      and(
        eq(schema.avatarPhoto.userId, userId),
        eq(schema.avatarPhoto.slot, "front"),
        isNull(schema.avatarPhoto.deletedAt),
        or(isNull(schema.avatarPhoto.expiresAt), gt(schema.avatarPhoto.expiresAt, new Date())),
      ),
    )
    .orderBy(desc(schema.avatarPhoto.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function hasConsent(userId: string): Promise<boolean> {
  const rows = await db.select().from(schema.tryonConsent).where(eq(schema.tryonConsent.userId, userId)).limit(1);
  return rows[0]?.consentVersion === TRYON_CONSENT_VERSION;
}

async function rowsFor(userId: string, itemId: string) {
  return db
    .select()
    .from(schema.sceneRender)
    .where(and(eq(schema.sceneRender.userId, userId), eq(schema.sceneRender.itemId, itemId)))
    .orderBy(asc(schema.sceneRender.createdAt), asc(schema.sceneRender.sceneId));
}

export async function getSceneState(userId: string | null, itemId: string): Promise<SceneState> {
  const enabled = sceneEnabled();
  if (!userId) return { enabled, signedIn: false, hasFrontPhoto: false, consented: false, renders: [] };
  const [photo, consented, rows] = await Promise.all([frontPhoto(userId), hasConsent(userId), rowsFor(userId, itemId)]);
  const ticked = enabled ? await Promise.all(rows.map((r) => tickVideo(r).catch(() => r))) : rows;
  return { enabled, signedIn: true, hasFrontPhoto: !!photo, consented, renders: ticked.map(toView) };
}

// ---- fal ----

function falHeaders() {
  const key = process.env.FAL_KEY;
  if (!key) throw new SceneError(503, "上身效果暂未开放");
  return { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" };
}

function falError(status: number): SceneError {
  if (status === 422 || status === 400) return new SceneError(422, "这张照片无法生成，请换一张光线充足的正面全身照");
  if (status === 429) return new SceneError(429, "生成的人有点多，请稍后再试");
  return new SceneError(502, "生成服务暂时不可用，请稍后再试");
}

async function storedImage(key: string, mime?: string): Promise<string> {
  const storage = getStorage();
  const signed = await storage.signedUrl(key, 900).catch(() => null);
  if (signed) return signed;
  const obj = await storage.get(key);
  if (!obj) throw new SceneError(409, "没有找到你的正面全身照，请重新上传");
  return `data:${mime ?? obj.contentType};base64,${Buffer.from(obj.bytes).toString("base64")}`;
}

async function garmentImage(image: string | null): Promise<string> {
  if (!image) throw new SceneError(422, "这件单品没有可用的图片");
  if (image.startsWith("https://")) return image;
  if (!/^\/catalog\/items\/[A-Za-z0-9_-]{1,80}\.(webp|png|jpg|jpeg)$/.test(image)) throw new SceneError(422, "这件单品没有可用的图片");
  const bytes = await readFile(path.join(process.cwd(), "public", image)).catch(() => null);
  if (!bytes) throw new SceneError(422, "这件单品没有可用的图片");
  const ext = image.split(".").pop()!;
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function scenePrompt(item: Item, sceneId: SceneId): string {
  const kind = [item.color, item.material, item.subcategory ?? item.displayCategory ?? item.category].filter(Boolean).join(" ");
  return [
    `Image 1 is the person. Image 2 is the garment: "${item.name.replace(/^占位：/, "")}" (${kind}).`,
    "Create a cinematic editorial photo of the exact same person from image 1 — keep their face, hair, skin tone, body shape and identity unchanged — wearing exactly the garment from image 2; keep its color, cut, pattern, details and material exactly the same as image 2.",
    "Complete the outfit with simple understated pieces that suit it; the garment from image 2 must be the clear hero of the look.",
    `Setting: ${SCENES[sceneId].prompt}. Natural candid moment, the person walking or pausing naturally, full body or three-quarter body framing.`,
    "Warm champagne-gold cinematic light, shallow depth of field, subtle film grain, photorealistic, vertical 3:4 composition. No text, no logos.",
  ].join(" ");
}

async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new SceneError(502, "生成结果无法读取");
  const res = await fetch(url, { signal, cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) throw new SceneError(502, "生成结果下载失败，请稍后再试");
  return new Uint8Array(await res.arrayBuffer());
}

async function generateImage(model: string, garment: string, item: Item, sceneId: SceneId, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(`https://fal.run/${IMAGE_MODEL}`, {
    method: "POST",
    headers: falHeaders(),
    body: JSON.stringify({ prompt: scenePrompt(item, sceneId), image_urls: [model, garment], aspect_ratio: "3:4", resolution: "2K", num_images: 1, output_format: "jpeg" }),
    signal,
    cache: "no-store",
  }).catch((e: Error) => {
    if (signal.aborted || e?.name === "TimeoutError" || e?.name === "AbortError") throw new SceneError(504, "生成超时，请稍后再试");
    throw new SceneError(502, "生成服务暂时连不上，请稍后再试");
  });
  if (!res.ok) throw falError(res.status);
  const data = (await res.json().catch(() => null)) as { images?: { url?: unknown }[] } | null;
  const url = data?.images?.[0]?.url;
  if (typeof url !== "string") throw new SceneError(502, "生成服务没有返回图片，请稍后再试");
  return fetchBytes(url, signal);
}

/** 提交 Live 视频到 fal queue，返回状态查询地址；失败返回 null（不影响场景图）。 */
async function submitVideo(imageDataUri: string): Promise<string | null> {
  try {
    const res = await fetch(`https://queue.fal.run/${VIDEO_MODEL}`, {
      method: "POST",
      headers: falHeaders(),
      body: JSON.stringify({ prompt: VIDEO_PROMPT, negative_prompt: VIDEO_NEGATIVE, image_url: imageDataUri, duration: "5", cfg_scale: 0.5 }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { status_url?: unknown } | null;
    const u = data?.status_url;
    return typeof u === "string" && u.startsWith("https://queue.fal.run/") ? u : null;
  } catch {
    return null;
  }
}

/** 推进一次视频轮询：完成则取回视频存储；失败则清掉状态地址（卡片退回纯前端效果）。 */
async function tickVideo(row: typeof schema.sceneRender.$inferSelect) {
  if (!row.videoStatusUrl || row.videoKey) return row;
  const headers = falHeaders();
  const st = await fetch(row.videoStatusUrl, { headers, cache: "no-store" }).catch(() => null);
  if (!st) return row;
  const status = ((await st.json().catch(() => null)) as { status?: string } | null)?.status;
  if (status === "IN_QUEUE" || status === "IN_PROGRESS") return row;
  if (status === "COMPLETED") {
    const responseUrl = row.videoStatusUrl.replace(/\/status$/, "");
    const r = await fetch(responseUrl, { headers, cache: "no-store" }).catch(() => null);
    const url = ((await r?.json().catch(() => null)) as { video?: { url?: unknown } } | null)?.video?.url;
    if (typeof url === "string") {
      const bytes = await fetchBytes(url).catch(() => null);
      if (bytes) {
        const key = avatarKey(row.userId, `scene-${row.id}`, "mp4");
        await getStorage().put(key, bytes, "video/mp4");
        const [next] = await db
          .update(schema.sceneRender)
          .set({ videoKey: key, videoStatusUrl: null })
          .where(eq(schema.sceneRender.id, row.id))
          .returning();
        return next ?? row;
      }
    }
  }
  // 失败或返回格式不对：不再轮询，卡片继续用纯前端效果。
  const [next] = await db.update(schema.sceneRender).set({ videoStatusUrl: null }).where(eq(schema.sceneRender.id, row.id)).returning();
  return next ?? row;
}

async function removeRows(rows: (typeof schema.sceneRender.$inferSelect)[]) {
  if (!rows.length) return;
  const keys = rows.flatMap((r) => [r.imageKey, r.videoKey]).filter((k): k is string => !!k);
  if (keys.length) await getStorage().remove(keys).catch(() => undefined);
  for (const r of rows) await db.delete(schema.sceneRender).where(eq(schema.sceneRender.id, r.id));
}

/** 生成本人的上身效果：2 张场景图（并行，约 30–45 秒），随后在后台提交 Live 视频。 */
export async function createScenes(userId: string, item: Item, opts: { consent?: boolean } = {}): Promise<SceneState> {
  if (!sceneEnabled()) throw new SceneError(503, "上身效果暂未开放");
  if (opts.consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new SceneError(403, "请先勾选同意，再生成上身效果");
  const photo = await frontPhoto(userId);
  if (!photo) throw new SceneError(409, "先上传一张正面全身照");

  const [model, garment] = await Promise.all([storedImage(photo.storageKey, photo.mime), garmentImage(item.image)]);
  // 同一件单品只保留最新一组。
  await removeRows(await rowsFor(userId, item.id));

  const scenes = pickScenes(item);
  const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
  const created = await Promise.all(
    scenes.map(async (sceneId) => {
      const id = randomUUID();
      await db.insert(schema.sceneRender).values({ id, userId, itemId: item.id, sceneId, status: "processing" });
      try {
        const bytes = await generateImage(model, garment, item, sceneId, signal);
        const info = sniffImage(bytes);
        if (!info) throw new SceneError(502, "生成结果无法读取，请稍后再试");
        const key = avatarKey(userId, `scene-${id}`, info.ext);
        await getStorage().put(key, bytes, info.mime);
        const videoStatusUrl = await submitVideo(`data:${info.mime};base64,${Buffer.from(bytes).toString("base64")}`);
        await db.update(schema.sceneRender).set({ status: "succeeded", imageKey: key, videoStatusUrl }).where(eq(schema.sceneRender.id, id));
        return null;
      } catch (e) {
        const message = e instanceof SceneError ? e.message : "生成失败，请稍后再试";
        if (!(e instanceof SceneError)) console.error("[scene]", e instanceof Error ? e.message : "unknown error");
        await db.update(schema.sceneRender).set({ status: "failed", error: message }).where(eq(schema.sceneRender.id, id));
        return e instanceof SceneError ? e : new SceneError(500, message);
      }
    }),
  );
  const state = await getSceneState(userId, item.id);
  const errors = created.filter((x): x is SceneError => !!x);
  if (errors.length === scenes.length) throw errors[0];
  return state;
}

/** 一键删除 3D 形象时调用：删掉本人全部上身效果记录与文件。 */
export async function deleteAllSceneRenders(userId: string): Promise<void> {
  await removeRows(await db.select().from(schema.sceneRender).where(eq(schema.sceneRender.userId, userId)));
}

/** 读取本人的 Live 视频（他人或不存在返回 null）。 */
export async function readSceneVideo(userId: string, id: string) {
  const rows = await db
    .select()
    .from(schema.sceneRender)
    .where(and(eq(schema.sceneRender.id, id), eq(schema.sceneRender.userId, userId)))
    .limit(1);
  const key = rows[0]?.videoKey;
  if (!key) return null;
  return getStorage().get(key);
}
