import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Outfit } from "@/lib/catalog";
import { avatarKey, getStorage } from "@/lib/storage";
import { sniffImage } from "@/lib/avatar/image";
import { baseInfo, fileUrl, identityRefs, storedImage } from "@/lib/tryon/base";
import { planTryon } from "@/lib/tryon/plan";
import { hasConsent, recordConsent } from "@/lib/tryon/service";
import { quotaRemaining } from "@/lib/usage";
import { compressSceneImage } from "./compress";
import { SceneError } from "./errors";
import { generateSceneImage } from "./image";
import { isPoseId, POSES, type PoseId } from "./poses";
import { isSceneId, SCENES, type SceneId } from "./scenes";

// 场景与姿势试穿（D75）：
// - 方案 A（kind = pose）：把一张已成功的标准试穿图（纯色背景、站姿）换到场景里、换姿势。用户选场景 × 姿势，一次一张。
// - 方案 B（kind = cover）：把搭配封面里的模特换成本人——同一场景、构图与姿势。前提是这套已经有一张“整套”的标准试穿图。
// 共同：标准试穿图始终是衣服与身份的输入（服务端从存储读取，不信任前端传来的图片）；只做静态图；
// 每张扣一次 scene 额度（lib/usage.ts，每人每日上限，平台承担费用）；结果私有，只给本人看。
// 出图走 lib/scene/image.ts（Nano Banana 2.1、1K，失败退 Pro；全站每日总额 lib/spend.ts）。
// 每人同时只生成一张（scene_shot 的部分唯一索引）；新图成功后才删掉同组合的旧图，失败时旧图还在。

export const SHOT_TIMEOUT_MS = 100_000;
/** 一条 processing 记录超过这个时长仍未结束，视为进程中断留下的残留，可被新请求顶掉。 */
const STALE_MS = SHOT_TIMEOUT_MS + 60_000;
const COVER_RE = /^\/catalog\/outfits\/[A-Za-z0-9_-]{1,80}\.(webp|png|jpg|jpeg)$/;

export type ShotKind = "pose" | "cover";

export type ShotView = {
  id: string;
  kind: ShotKind;
  sceneId: string | null;
  pose: string | null;
  /** 场景标题（中文，接口边界再按界面语言换） */
  sceneTitle: string | null;
  /** 姿势标题（同上） */
  poseTitle: string | null;
  status: string;
  imageUrl: string | null;
  error: string | null;
};

export type ShotQuota = { remaining: number; limit: number };

export type ShotsState = {
  enabled: boolean;
  consented: boolean;
  quota: ShotQuota;
  shots: ShotView[];
};

export type CoverState = {
  enabled: boolean;
  signedIn: boolean;
  consented: boolean;
  /** 有可用的形象（数字分身或正面全身照） */
  hasBase: boolean;
  /** 这套最新的整套标准试穿图；还没有整套试穿时为 null */
  standard: { tryonId: string; url: string } | null;
  /** 最新一张生成成功的封面同款 */
  shot: ShotView | null;
  /** 有一张正在生成（例如刷新了页面） */
  busy: boolean;
  quota: ShotQuota;
};

type ShotRow = typeof schema.sceneShot.$inferSelect;
type TryonRow = typeof schema.tryon.$inferSelect;

export function shotsEnabled(): boolean {
  return !!process.env.FAL_KEY;
}

function toView(row: ShotRow): ShotView {
  return {
    id: row.id,
    kind: row.kind === "cover" ? "cover" : "pose",
    sceneId: row.sceneId,
    pose: row.pose,
    sceneTitle: row.sceneId && isSceneId(row.sceneId) ? SCENES[row.sceneId].title : null,
    poseTitle: row.pose && isPoseId(row.pose) ? POSES[row.pose].title : null,
    status: row.status,
    imageUrl: row.status === "succeeded" && row.imageKey ? fileUrl(row.imageKey) : null,
    error: row.error,
  };
}

// ---- 标准试穿图 ----

/** 本人一张已成功的试穿结果；不属于本人、未完成或没有结果图时为 null。 */
async function ownTryon(userId: string, tryonId: string): Promise<TryonRow | null> {
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(and(eq(schema.tryon.id, tryonId), eq(schema.tryon.userId, userId), eq(schema.tryon.status, "succeeded")))
    .limit(1);
  const row = rows[0];
  return row?.resultKey ? row : null;
}

/** 整套的标准试穿图：这套最新一张成功的试穿，且身上已经穿着这套所有能上身的单品（鞋包配饰本来就不上身）。 */
export async function completeLookTryon(userId: string, outfit: Pick<Outfit, "id" | "items">): Promise<TryonRow | null> {
  const need = planTryon(outfit.items).map((s) => s.itemId);
  if (!need.length) return null;
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(and(eq(schema.tryon.userId, userId), eq(schema.tryon.sourceOutfitId, outfit.id), eq(schema.tryon.status, "succeeded")))
    .orderBy(desc(schema.tryon.createdAt))
    .limit(30);
  return rows.find((r) => r.resultKey && need.every((id) => (r.itemIds ?? []).includes(id))) ?? null;
}

// ---- 读取 ----

async function quotaOf(userId: string): Promise<ShotQuota> {
  return quotaRemaining(userId, "scene");
}

/** 一张标准试穿图上已生成的场景姿势图（方案 A），按生成先后排列；失败记录不返回（失败说明随 POST 的错误返回）。 */
export async function getShots(userId: string, tryonId: string): Promise<ShotsState> {
  const enabled = shotsEnabled();
  const [consented, quota, rows] = await Promise.all([
    hasConsent(userId),
    quotaOf(userId),
    db
      .select()
      .from(schema.sceneShot)
      .where(
        and(
          eq(schema.sceneShot.userId, userId),
          eq(schema.sceneShot.tryonId, tryonId),
          eq(schema.sceneShot.kind, "pose"),
          ne(schema.sceneShot.status, "failed"),
        ),
      )
      .orderBy(asc(schema.sceneShot.createdAt)),
  ]);
  return { enabled, consented, quota, shots: rows.map(toView) };
}

/** 一套搭配的封面同款（方案 B）。未登录时只返回 signedIn:false。 */
export async function getCoverState(userId: string | null, outfit: Pick<Outfit, "id" | "items">): Promise<CoverState> {
  const enabled = shotsEnabled();
  const empty: ShotQuota = { remaining: 0, limit: 0 };
  if (!userId) return { enabled, signedIn: false, consented: false, hasBase: false, standard: null, shot: null, busy: false, quota: empty };
  const [base, consented, quota, standard, rows] = await Promise.all([
    baseInfo(userId),
    hasConsent(userId),
    quotaOf(userId),
    completeLookTryon(userId, outfit),
    db
      .select()
      .from(schema.sceneShot)
      .where(
        and(
          eq(schema.sceneShot.userId, userId),
          eq(schema.sceneShot.outfitId, outfit.id),
          eq(schema.sceneShot.kind, "cover"),
          ne(schema.sceneShot.status, "failed"),
        ),
      )
      .orderBy(desc(schema.sceneShot.createdAt))
      .limit(3),
  ]);
  const done = rows.find((r) => r.status === "succeeded");
  return {
    enabled,
    signedIn: true,
    consented,
    hasBase: !!base.url,
    standard: standard?.resultKey ? { tryonId: standard.id, url: fileUrl(standard.resultKey) } : null,
    shot: done ? toView(done) : null,
    busy: rows.some((r) => r.status === "processing" && r.createdAt.getTime() > Date.now() - STALE_MS),
    quota,
  };
}

// ---- 提示词 ----

const PERSON = (n: number) => (n > 1 ? `Images 1–${n} are reference photos of the same person.` : "Image 1 is a reference photo of the person.");
const WHO = (n: number) => (n > 1 ? `images 1–${n}` : "image 1");

/** 方案 A：图片顺序为 身份参考 1..refCount → 标准试穿图。 */
export function posePrompt(refCount: number, sceneId: SceneId, pose: PoseId): string {
  const std = refCount + 1;
  return [
    `${PERSON(refCount)} Image ${std} shows this person wearing the complete outfit.`,
    `Create a new photorealistic photo of the exact same person — keep the face, hair, skin tone, body shape and identity from ${WHO(refCount)} unchanged — wearing exactly the outfit from image ${std}: keep every garment, shoe, bag and accessory with the same color, cut, pattern, material and details, and do not add, remove or change any item.`,
    `Setting: ${SCENES[sceneId].prompt}. Pose: ${POSES[pose].prompt}.`,
    "Calm, natural movement only — no jumping, no raised arms, no dramatic action.",
    "Natural light that matches the setting, editorial fashion photography, vertical 3:4 composition. No text, no logos.",
  ].join(" ");
}

/** 方案 B：图片顺序为 身份参考 1..refCount → 标准试穿图 → 封面（最后一张，只作场景与姿势参考）。 */
export function coverPrompt(refCount: number): string {
  const std = refCount + 1;
  const cover = refCount + 2;
  return [
    `${PERSON(refCount)} Image ${std} shows this person wearing the complete outfit. This person is the only person to depict.`,
    `Image ${cover} is a reference ONLY for the setting, light, camera angle, framing and pose — do NOT use the face, hairstyle, body or identity of anyone in image ${cover}.`,
    `Create a new photo of the person from ${WHO(refCount)} in the same setting, camera angle, framing and pose as image ${cover}, wearing exactly the outfit from image ${std}: every garment, shoe, bag and accessory unchanged in color, cut, pattern and material.`,
    `Keep their face, hair, skin tone and body exactly as in ${WHO(refCount)}. Photorealistic, vertical 3:4 composition. No text, no logos.`,
  ].join(" ");
}

async function coverImage(cover: string | null): Promise<string> {
  if (!cover || !COVER_RE.test(cover)) throw new SceneError(422, "这套搭配没有可用的封面");
  const bytes = await readFile(path.join(process.cwd(), "public", cover)).catch(() => null);
  if (!bytes) throw new SceneError(422, "这套搭配没有可用的封面");
  const ext = cover.split(".").pop()!;
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: unknown; cause?: { code?: unknown } };
  return (x?.code ?? x?.cause?.code) === "23505";
};

/** 插入一条 processing 记录；本人已有一张在生成时返回 429（残留超时的记录先标为失败再插一次）。 */
async function claim(row: Omit<ShotRow, "status" | "imageKey" | "error" | "createdAt">) {
  const insert = () => db.insert(schema.sceneShot).values({ ...row, status: "processing" });
  try {
    await insert();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const stale = await db
      .update(schema.sceneShot)
      .set({ status: "failed", error: "生成中断，请重新生成" })
      .where(
        and(
          eq(schema.sceneShot.userId, row.userId),
          eq(schema.sceneShot.status, "processing"),
          lt(schema.sceneShot.createdAt, new Date(Date.now() - STALE_MS)),
        ),
      )
      .returning({ id: schema.sceneShot.id });
    if (!stale.length) throw new SceneError(429, "上一张还在生成，等它好了再来");
    await insert().catch((e2) => {
      throw isUniqueViolation(e2) ? new SceneError(429, "上一张还在生成，等它好了再来") : e2;
    });
  }
}

/**
 * 生成并入库：先占一条 processing，成功后存图并删掉同组合的旧图（replaces），失败记下原因（界面可以直接显示）。
 */
async function render(
  row: Omit<ShotRow, "status" | "imageKey" | "error" | "createdAt">,
  images: string[],
  prompt: string,
  replaces: () => Promise<ShotRow[]>,
): Promise<ShotView> {
  await claim(row);
  try {
    const bytes = await generateSceneImage(images, prompt, {
      signal: AbortSignal.timeout(SHOT_TIMEOUT_MS),
      rejected: "这一张没有生成出来，换个场景或姿势再试",
    });
    const info = sniffImage(bytes);
    if (!info) throw new SceneError(502, "生成结果无法读取，请稍后再试");
    const small = await compressSceneImage(bytes);
    const stored = small ?? { bytes, mime: info.mime, ext: info.ext };
    const key = avatarKey(row.userId, `shot-${row.id}`, stored.ext);
    await getStorage().put(key, stored.bytes, stored.mime);
    const [done] = await db.update(schema.sceneShot).set({ status: "succeeded", imageKey: key }).where(eq(schema.sceneShot.id, row.id)).returning();
    await removeRows((await replaces()).filter((r) => r.id !== row.id)).catch(() => undefined);
    return toView(done);
  } catch (e) {
    const message = e instanceof SceneError || (e as { noCharge?: unknown })?.noCharge === true ? (e as Error).message : "生成失败，请稍后再试";
    if (!(e instanceof SceneError) && (e as { noCharge?: unknown })?.noCharge !== true) console.error("[shot]", e instanceof Error ? e.message : "unknown error");
    await db.update(schema.sceneShot).set({ status: "failed", error: message }).where(eq(schema.sceneShot.id, row.id));
    // 同组合之前失败的记录不再保留，只留这次的失败说明。
    await removeRows((await replaces()).filter((r) => r.id !== row.id && r.status === "failed")).catch(() => undefined);
    throw e instanceof SceneError || (e as { noCharge?: unknown })?.noCharge === true ? e : new SceneError(500, message);
  }
}

async function removeRows(rows: ShotRow[]) {
  if (!rows.length) return;
  const keys = rows.map((r) => r.imageKey).filter((k): k is string => !!k);
  if (keys.length) await getStorage().remove(keys).catch(() => undefined);
  await db.delete(schema.sceneShot).where(inArray(schema.sceneShot.id, rows.map((r) => r.id)));
}

async function requireReady(userId: string, consent: boolean | undefined) {
  if (!shotsEnabled()) throw new SceneError(503, "场景与姿势暂未开放");
  if (consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new SceneError(403, "请先勾选同意，再生成");
  const refs = await identityRefs(userId);
  if (!refs.length) throw new SceneError(409, "先建立你的形象");
  return refs;
}

// ---- 生成 ----

/** 方案 A：在一张标准试穿图上生成「场景 × 姿势」。同一组合只保留最新一张。 */
export async function createPoseShot(userId: string, tryonId: string, sceneId: string, pose: string, opts: { consent?: boolean } = {}): Promise<ShotView> {
  if (!isSceneId(sceneId) || !isPoseId(pose)) throw new SceneError(400, "请求格式不对");
  const std = await ownTryon(userId, tryonId);
  if (!std?.resultKey) throw new SceneError(404, "没有找到这张试穿图");
  const refs = await requireReady(userId, opts.consent);
  const stdImage = await storedImage(std.resultKey);
  if (!stdImage) throw new SceneError(404, "没有找到这张试穿图");
  const same = () =>
    db
      .select()
      .from(schema.sceneShot)
      .where(
        and(
          eq(schema.sceneShot.userId, userId),
          eq(schema.sceneShot.tryonId, tryonId),
          eq(schema.sceneShot.kind, "pose"),
          eq(schema.sceneShot.sceneId, sceneId),
          eq(schema.sceneShot.pose, pose),
          ne(schema.sceneShot.status, "processing"),
        ),
      );
  const row = { id: randomUUID(), userId, kind: "pose", tryonId, outfitId: std.sourceOutfitId, sceneId, pose };
  return render(row, [...refs, stdImage], posePrompt(refs.length, sceneId, pose), same);
}

/** 方案 B：把这套封面里的模特换成本人。需要这套已有整套标准试穿图；同一套只保留最新一张。 */
export async function createCoverShot(userId: string, outfit: Pick<Outfit, "id" | "items" | "cover">, opts: { consent?: boolean } = {}): Promise<ShotView> {
  const cover = await coverImage(outfit.cover);
  const std = await completeLookTryon(userId, outfit);
  if (!std?.resultKey) throw new SceneError(409, "先整套试穿一次，就能把模特换成你");
  const refs = await requireReady(userId, opts.consent);
  const stdImage = await storedImage(std.resultKey);
  if (!stdImage) throw new SceneError(409, "先整套试穿一次，就能把模特换成你");
  const same = () =>
    db
      .select()
      .from(schema.sceneShot)
      .where(
        and(
          eq(schema.sceneShot.userId, userId),
          eq(schema.sceneShot.outfitId, outfit.id),
          eq(schema.sceneShot.kind, "cover"),
          ne(schema.sceneShot.status, "processing"),
        ),
      );
  const row = { id: randomUUID(), userId, kind: "cover", tryonId: std.id, outfitId: outfit.id, sceneId: null, pose: null };
  return render(row, [...refs, stdImage, cover], coverPrompt(refs.length), same);
}

// ---- 删除 ----

/** 删掉一张试穿结果时，一并删掉用它生成的场景姿势图与封面同款。 */
export async function deleteShotsForTryon(userId: string, tryonId: string): Promise<void> {
  await removeRows(await db.select().from(schema.sceneShot).where(and(eq(schema.sceneShot.userId, userId), eq(schema.sceneShot.tryonId, tryonId))));
}

/** 一键删除形象时调用：删掉本人全部场景姿势图与封面同款。 */
export async function deleteAllSceneShots(userId: string): Promise<void> {
  await removeRows(await db.select().from(schema.sceneShot).where(eq(schema.sceneShot.userId, userId)));
}

/** 本人这张图的存储 key（他人或不存在返回 null）；文件路由已按用户前缀鉴权，这里给单元测试与后续用。 */
export async function shotImageKey(userId: string, id: string): Promise<string | null> {
  const rows = await db
    .select({ imageKey: schema.sceneShot.imageKey })
    .from(schema.sceneShot)
    .where(and(eq(schema.sceneShot.id, id), eq(schema.sceneShot.userId, userId)))
    .limit(1);
  return rows[0]?.imageKey ?? null;
}
