import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getItemsByIds, type Item } from "@/lib/catalog";
import { avatarKey, getStorage } from "@/lib/storage";
import { MAX_PHOTO_BYTES, sniffImage } from "@/lib/avatar/image";
import { PHOTO_RETENTION_DAYS } from "@/lib/avatar/purge";
import { stripMetadata } from "@/lib/avatar/strip";
import { fetchResultImage, isTryonEnabled, PROVIDER_ID, runFashn, TryonError, type FashnMode } from "./fashn";
import { planTryon, stepFor, wearOn, type TryonLabel, type WornPiece } from "./plan";

// 2D 试穿服务：把衣服换到用户自己的正面全身照上（FASHN on fal.ai）。两种请求：
// - 逐件（试衣间主路径）：一次只穿一件，调用一次 FASHN（mode=quality）。底图是本人正面照，或本人一张成功的试穿结果
//   （baseTryonId），这样一件一件把整套穿起来。
// - 整套（旧调用方式，保留兼容）：按 plan.ts 的顺序依次叠加；两步以内 mode=quality，三步 balanced。
// - 照片来源：3D 形象流程已上传的正面全身照（avatar_photo.slot = front）；也可在试穿卡里直接上传一张，
//   同样去元数据后存私有存储，并作为正面照供 3D 形象复用（每个位置只保留一张）。上传时写 expires_at = 上传时间 + 30 天（D47）。
// - 同意（D47）：首次试穿前单独勾选“同意把我的正面照发送给 FASHN（fal.ai）生成试穿图”，记录在 tryon_consent。
// - 结果：服务端取回结果图存 `<userId>/avatars/tryon-<id>.png`，浏览器经 /api/avatar/files/<key> 读取（他人 404）。

export { TryonError } from "./fashn";

export const CONSENT_VERSION = `tryon-consent-v1:${PROVIDER_ID}`;
/** 服务端整体超时：所有步骤（含下载与存储）必须在此之内完成。 */
export const TOTAL_TIMEOUT_MS = 120_000;

export type SnapshotItem = {
  id: string;
  name: string;
  category: string;
  displayCategory: string | null;
  image: string | null;
  color: string;
  price: number;
};

export type TryonView = {
  id: string;
  status: string;
  resultUrl: string | null;
  /** item：逐件试穿（一次穿一件）；outfit：旧的整套叠加。 */
  kind: "item" | "outfit";
  mode: FashnMode;
  /** 逐件：这次穿上的单品；整套为 null。 */
  wornItemId: string | null;
  /** 逐件：在哪张试穿结果上继续穿；null 表示穿在本人正面照上（整套也为 null）。 */
  baseTryonId: string | null;
  /** 结果图上穿着的单品类别与编号（按穿上的先后；逐件为累计，被新一件盖掉的不再列出）。 */
  applied: TryonLabel[];
  appliedItemIds: string[];
  items: SnapshotItem[];
  sourceLookId: string | null;
  sourceOutfitId: string | null;
  error: string | null;
  createdAt: string;
};

export type TryonContext = {
  enabled: boolean;
  signedIn: boolean;
  consented: boolean;
  /** 本人正面全身照的鉴权读取地址；没有时为 null。 */
  frontPhotoUrl: string | null;
};

const fileUrl = (key: string) => `/api/avatar/files/${key.split("/").map(encodeURIComponent).join("/")}`;

// 逐件试穿的信息不新增字段：在 outfit_snapshot（jsonb 数组）末尾追加一条 { kind: "step", ... } 记录，
// 读出时与单品快照分开；没有这条记录的旧行就是整套试穿。item_ids / applied_categories 存结果图上累计穿着的单品。
type StepMeta = { kind: "step"; wornItemId: string; baseTryonId: string | null; mode: FashnMode };
const isStepMeta = (x: unknown): x is StepMeta => !!x && typeof x === "object" && (x as { kind?: unknown }).kind === "step";

function toView(row: typeof schema.tryon.$inferSelect): TryonView {
  const records = (row.outfitSnapshot ?? []) as unknown[];
  const step = records.find(isStepMeta) ?? null;
  return {
    id: row.id,
    status: row.status,
    resultUrl: row.status === "succeeded" && row.resultKey ? fileUrl(row.resultKey) : null,
    kind: step ? "item" : "outfit",
    mode: step?.mode ?? "balanced",
    wornItemId: step?.wornItemId ?? null,
    baseTryonId: step?.baseTryonId ?? null,
    applied: row.appliedCategories as TryonLabel[],
    appliedItemIds: row.itemIds,
    items: records.filter((r) => !isStepMeta(r)) as SnapshotItem[],
    sourceLookId: row.sourceLookId,
    sourceOutfitId: row.sourceOutfitId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 本人正面照；已过 30 天期限（尚未被清理流程删除）的不再使用。 */
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
  return rows[0]?.consentVersion === CONSENT_VERSION;
}

export async function getTryonContext(userId: string | null): Promise<TryonContext> {
  const enabled = isTryonEnabled();
  if (!enabled || !userId) return { enabled, signedIn: !!userId, consented: false, frontPhotoUrl: null };
  const [consented, photo] = await Promise.all([hasConsent(userId), frontPhoto(userId)]);
  return { enabled, signedIn: true, consented, frontPhotoUrl: photo ? fileUrl(photo.storageKey) : null };
}

export async function recordConsent(userId: string) {
  await db
    .insert(schema.tryonConsent)
    .values({ userId, consentVersion: CONSENT_VERSION, consentAt: new Date() })
    .onConflictDoUpdate({ target: schema.tryonConsent.userId, set: { consentVersion: CONSENT_VERSION, consentAt: new Date() } });
}

const DAY_MS = 86400_000;

/** 在试穿卡里上传正面全身照：去元数据、按文件头识别类型，存私有存储并作为正面照（替换旧的一张），30 天后自动删除（D47）。 */
export async function uploadFrontPhoto(userId: string, file: File) {
  if (!isTryonEnabled()) throw new TryonError(503, "试穿服务未开放");
  if (file.size === 0) throw new TryonError(400, "照片是空文件");
  if (file.size > MAX_PHOTO_BYTES) throw new TryonError(413, "照片不能超过 8MB");
  const raw = new Uint8Array(await file.arrayBuffer());
  const stripped = stripMetadata(raw);
  if (!stripped) throw new TryonError(415, "只支持 JPG、PNG、WebP 图片");
  const info = sniffImage(stripped.bytes);
  if (!info) throw new TryonError(415, "只支持 JPG、PNG、WebP 图片");
  if (info.width < 256 || info.height < 256 || info.width > 10000 || info.height > 10000) {
    throw new TryonError(400, "照片太小，请换一张清晰的正面全身照");
  }
  const old = await db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, userId), eq(schema.avatarPhoto.slot, "front"), isNull(schema.avatarPhoto.deletedAt)));
  const id = crypto.randomUUID();
  const key = `${userId}/photos/${id}.${info.ext}`;
  const storage = getStorage();
  await storage.put(key, stripped.bytes, info.mime);
  try {
    await db.insert(schema.avatarPhoto).values({
      id,
      userId,
      slot: "front",
      storageKey: key,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: stripped.bytes.byteLength,
      qualityFlags: {
        lowResolution: Math.min(info.width, info.height) < 512,
        landscapeForFullBody: info.width > info.height,
        tinyFile: stripped.bytes.byteLength < 20 * 1024,
      },
      // 与 3D 形象的原始照片同一规则：30 天后由 avatar:purge / 惰性清理删除。
      expiresAt: new Date(Date.now() + PHOTO_RETENTION_DAYS * DAY_MS),
    });
  } catch (e) {
    await storage.remove([key]).catch(() => {});
    throw e;
  }
  if (old.length) {
    await storage.remove(old.map((p) => p.storageKey)).catch(() => {});
    await db
      .update(schema.avatarPhoto)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.avatarPhoto.userId, userId), inArray(schema.avatarPhoto.id, old.map((p) => p.id))));
  }
  return { frontPhotoUrl: fileUrl(key) };
}

/** 单品图：本站 public 下的相对路径读成 data URI；https 地址原样使用。 */
async function garmentImage(image: string): Promise<string> {
  if (image.startsWith("https://")) return image;
  if (!/^\/catalog\/items\/[A-Za-z0-9_-]{1,80}\.(webp|png|jpg|jpeg)$/.test(image)) throw new TryonError(422, "单品图片不可用");
  const bytes = await readFile(path.join(process.cwd(), "public", image)).catch(() => null);
  if (!bytes) throw new TryonError(422, "单品图片不可用");
  const ext = image.split(".").pop()!;
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/** 私有存储里的图片交给 FASHN：Supabase 私有桶生成 15 分钟签名 URL；本地存储没有公开地址，改用 data URI。文件不存在时返回 null。 */
async function storedImage(key: string, mime?: string): Promise<string | null> {
  const storage = getStorage();
  // 签名失败（如对象已不存在）时退回直接读取，读不到即视为不存在。
  const signed = await storage.signedUrl(key, 900).catch(() => null);
  if (signed) return signed;
  const obj = await storage.get(key);
  if (!obj) return null;
  return `data:${mime ?? obj.contentType};base64,${Buffer.from(obj.bytes).toString("base64")}`;
}

async function modelImage(photo: { storageKey: string; mime: string }): Promise<string> {
  const image = await storedImage(photo.storageKey, photo.mime);
  if (!image) throw new TryonError(409, "没有找到你的正面全身照，请重新上传");
  return image;
}

export type TryonInput = {
  lookId?: string | null;
  outfitId?: string | null;
  itemIds?: string[];
  /** 逐件：在本人这张成功的试穿结果上继续穿；不传则穿在正面照上。 */
  baseTryonId?: string | null;
  consent?: boolean;
};

const uniqueIds = (ids: unknown[] | undefined) => [...new Set((ids ?? []).filter((x): x is string => typeof x === "string"))];

/**
 * 逐件请求：带 baseTryonId，或 itemIds 恰好一件。
 * 旧调用方式（整套）发送的 itemIds 是这一套的全部单品，只有一件时两种理解的结果相同（把这一件穿在正面照上）。
 */
export function isItemRequest(input: TryonInput): boolean {
  return !!input.baseTryonId || uniqueIds(input.itemIds).length === 1;
}

async function resolveItems(userId: string, input: TryonInput): Promise<{ items: Item[]; lookId: string | null; outfitId: string | null }> {
  if (input.lookId) {
    const look = await db
      .select()
      .from(schema.look)
      .where(and(eq(schema.look.id, input.lookId), eq(schema.look.userId, userId)))
      .limit(1);
    if (!look[0]) throw new TryonError(404, "没有找到这套搭配");
    const links = await db
      .select()
      .from(schema.lookItem)
      .where(eq(schema.lookItem.lookId, look[0].id))
      .orderBy(asc(schema.lookItem.position));
    return { items: await getItemsByIds(links.map((l) => l.itemId)), lookId: look[0].id, outfitId: look[0].sourceOutfitId };
  }
  const ids = uniqueIds(input.itemIds).slice(0, 12);
  if (!ids.length) throw new TryonError(400, "没有可试穿的单品");
  return { items: await getItemsByIds(ids), lookId: null, outfitId: input.outfitId ?? null };
}

const snapshotOf = (items: Item[]): SnapshotItem[] =>
  items.map((i) => ({
    id: i.id,
    name: i.name.replace(/^占位：/, ""),
    category: i.category,
    displayCategory: i.displayCategory,
    image: i.image,
    color: i.color,
    price: i.price,
  }));

/** 执行生成并保存结果：整体 120 秒超时；失败时记录并返回明确的中文错误。 */
async function runAndStore(userId: string, id: string, produce: (signal: AbortSignal) => Promise<string>): Promise<TryonView> {
  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS - 5_000);
  try {
    const url = await produce(signal);
    const bytes = await fetchResultImage(url, signal);
    const info = sniffImage(bytes);
    if (!info) throw new TryonError(502, "试穿结果无法读取，请稍后再试");
    const key = avatarKey(userId, `tryon-${id}`, info.ext);
    await getStorage().put(key, bytes, info.mime);
    const [row] = await db
      .update(schema.tryon)
      .set({ status: "succeeded", resultKey: key })
      .where(eq(schema.tryon.id, id))
      .returning();
    return toView(row);
  } catch (e) {
    const message = e instanceof TryonError ? e.message : "试穿失败，请稍后再试";
    if (!(e instanceof TryonError)) console.error("[tryon]", e instanceof Error ? e.message : "unknown error");
    await db.update(schema.tryon).set({ status: "failed", error: message }).where(eq(schema.tryon.id, id));
    throw new TryonError(e instanceof TryonError ? e.status : 500, message);
  }
}

/** 发起一次试穿：逐件（一次 FASHN，quality）或旧的整套叠加（依次调用，balanced）。 */
export async function createTryon(userId: string, input: TryonInput): Promise<TryonView> {
  if (!isTryonEnabled()) throw new TryonError(503, "试穿服务未开放");
  if (input.consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new TryonError(403, "请先勾选同意，再开始试穿");
  return isItemRequest(input) ? createItemTryon(userId, input) : createOutfitTryon(userId, input);
}

const BASE_NOT_FOUND = "没有找到这张试穿图";

/**
 * 逐件：只把这一件穿上，调用一次 FASHN（mode=quality）。
 * 底图：baseTryonId 指向本人一张成功的试穿结果时读该结果图（不属于本人、不存在、未成功或文件已删一律 404，不区分）；
 * 否则用本人正面照。先校验单品与底图，再写记录、调用 FASHN。
 */
async function createItemTryon(userId: string, input: TryonInput): Promise<TryonView> {
  const ids = uniqueIds(input.itemIds);
  if (ids.length !== 1) throw new TryonError(400, "一次只能试穿一件");
  const [itemId] = ids;
  const { items, lookId, outfitId } = await resolveItems(userId, { ...input, itemIds: ids });
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new TryonError(404, lookId ? "这套搭配里没有这件单品" : "没有找到这件单品");
  const step = stepFor(item);
  if (!step) throw new TryonError(422, "只能试穿上装、下装、连衣裙或外套");

  let model: string;
  let worn: WornPiece[] = [];
  let baseTryonId: string | null = null;
  if (input.baseTryonId) {
    const rows = await db
      .select()
      .from(schema.tryon)
      .where(and(eq(schema.tryon.id, input.baseTryonId), eq(schema.tryon.userId, userId)))
      .limit(1);
    const base = rows[0];
    if (!base || base.status !== "succeeded" || !base.resultKey) throw new TryonError(404, BASE_NOT_FOUND);
    const image = await storedImage(base.resultKey);
    if (!image) {
      // 结果图已随一键删除被清掉：连同记录一起清理（与 getTryon 一致）。
      await db.delete(schema.tryon).where(eq(schema.tryon.id, base.id));
      throw new TryonError(404, BASE_NOT_FOUND);
    }
    model = image;
    baseTryonId = base.id;
    const labels = base.appliedCategories as TryonLabel[];
    worn = base.itemIds.flatMap((id, i) => (labels[i] ? [{ itemId: id, label: labels[i] }] : []));
  } else {
    const photo = await frontPhoto(userId);
    if (!photo) throw new TryonError(409, "请先上传一张正面全身照");
    model = await modelImage(photo);
  }

  const after = wearOn(worn, step);
  const meta: StepMeta = { kind: "step", wornItemId: item.id, baseTryonId, mode: "quality" };
  const id = crypto.randomUUID();
  await db.insert(schema.tryon).values({
    id,
    userId,
    sourceLookId: lookId,
    sourceOutfitId: outfitId,
    outfitSnapshot: [...snapshotOf(items), meta] as unknown as Record<string, unknown>[],
    itemIds: after.map((w) => w.itemId),
    appliedCategories: after.map((w) => w.label),
    status: "processing",
  });
  return runAndStore(userId, id, async (signal) => {
    const garment = await garmentImage(item.image!);
    return runFashn({ modelImage: model, garmentImage: garment, category: step.category, mode: "quality" }, signal);
  });
}

/** 旧的整套试穿（保留兼容）：按 plan.ts 的顺序依次调用，上一步结果作为下一步 model_image。 */
async function createOutfitTryon(userId: string, input: TryonInput): Promise<TryonView> {
  const photo = await frontPhoto(userId);
  if (!photo) throw new TryonError(409, "请先上传一张正面全身照");

  const { items, lookId, outfitId } = await resolveItems(userId, input);
  const steps = planTryon(items);
  if (!steps.length) throw new TryonError(422, "这套里没有可试穿的上装、下装、连衣裙或外套");

  const id = crypto.randomUUID();
  await db.insert(schema.tryon).values({
    id,
    userId,
    sourceLookId: lookId,
    sourceOutfitId: outfitId,
    outfitSnapshot: snapshotOf(items) as unknown as Record<string, unknown>[],
    itemIds: steps.map((s) => s.itemId),
    appliedCategories: steps.map((s) => s.label),
    status: "processing",
  });

  const byId = new Map(items.map((i) => [i.id, i]));
  // 两步以内用 quality（实测单步 20–30 秒，balanced 会出现多余袖子等瑕疵）；三步时为守住 120 秒上限仍用 balanced。
  const mode: FashnMode = steps.length <= 2 ? "quality" : "balanced";
  return runAndStore(userId, id, async (signal) => {
    let current = await modelImage(photo);
    for (const step of steps) {
      const garment = await garmentImage(byId.get(step.itemId)!.image!);
      current = await runFashn({ modelImage: current, garmentImage: garment, category: step.category, mode }, signal);
    }
    return current;
  });
}

/** 每套最多带回的试穿结果数（取最新的这些，按时间先后排列）。 */
const FRAMES_PER_LOOK = 24;

/**
 * 本人在这些搭配上的成功试穿，按搭配分组、按时间先后排列（试衣间的“穿搭进度”）。
 * 不逐个检查结果文件是否还在（Supabase 上相当于逐个下载）；一键删除会连同记录一起删除。
 */
export async function listLookTryons(userId: string, lookIds: string[]): Promise<Record<string, TryonView[]>> {
  if (!lookIds.length) return {};
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(and(eq(schema.tryon.userId, userId), inArray(schema.tryon.sourceLookId, lookIds), eq(schema.tryon.status, "succeeded")))
    .orderBy(asc(schema.tryon.createdAt));
  const out: Record<string, TryonView[]> = {};
  for (const row of rows) {
    if (!row.sourceLookId || !row.resultKey) continue;
    (out[row.sourceLookId] ??= []).push(toView(row));
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(-FRAMES_PER_LOOK);
  return out;
}

/** 本人的试穿结果；不存在、不属于本人或结果图已被删除时返回 null（路由一律 404）。 */
export async function getTryon(userId: string, id: string): Promise<TryonView | null> {
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(and(eq(schema.tryon.id, id), eq(schema.tryon.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.status === "succeeded") {
    // 一键删除 3D 形象会清空用户存储前缀，结果图随之删除：这时连同记录一起清掉。
    const obj = row.resultKey ? await getStorage().get(row.resultKey).catch(() => null) : null;
    if (!obj) {
      await db.delete(schema.tryon).where(eq(schema.tryon.id, row.id));
      return null;
    }
  }
  return toView(row);
}

export async function deleteTryon(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.tryon)
    .where(and(eq(schema.tryon.id, id), eq(schema.tryon.userId, userId)))
    .returning();
  const row = rows[0];
  if (!row) return false;
  if (row.resultKey) await getStorage().remove([row.resultKey]).catch(() => {});
  return true;
}

/** 删除本人全部试穿结果与试穿同意（一键删除 3D 形象时调用）。 */
export async function deleteAllTryons(userId: string): Promise<number> {
  const rows = await db.delete(schema.tryon).where(eq(schema.tryon.userId, userId)).returning();
  const keys = rows.flatMap((r) => (r.resultKey ? [r.resultKey] : []));
  if (keys.length) await getStorage().remove(keys).catch(() => {});
  await db.delete(schema.tryonConsent).where(eq(schema.tryonConsent.userId, userId));
  return rows.length;
}
