import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getItemsByIds, type Item } from "@/lib/catalog";
import { avatarKey, getStorage } from "@/lib/storage";
import { MAX_PHOTO_BYTES, sniffImage } from "@/lib/avatar/image";
import { stripMetadata } from "@/lib/avatar/strip";
import { fetchResultImage, isTryonEnabled, PROVIDER_ID, runFashn, TryonError } from "./fashn";
import { planTryon, type TryonLabel } from "./plan";

// 2D 试穿服务：把一整套衣服依次换到用户自己的正面全身照上（FASHN on fal.ai）。
// - 照片来源：3D 形象流程已上传的正面全身照（avatar_photo.slot = front）；也可在试穿卡里直接上传一张，
//   同样去元数据后存私有存储，并作为正面照供 3D 形象复用（每个位置只保留一张）。
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

function toView(row: typeof schema.tryon.$inferSelect): TryonView {
  return {
    id: row.id,
    status: row.status,
    resultUrl: row.status === "succeeded" && row.resultKey ? fileUrl(row.resultKey) : null,
    applied: row.appliedCategories as TryonLabel[],
    appliedItemIds: row.itemIds,
    items: row.outfitSnapshot as unknown as SnapshotItem[],
    sourceLookId: row.sourceLookId,
    sourceOutfitId: row.sourceOutfitId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

async function frontPhoto(userId: string) {
  const rows = await db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, userId), eq(schema.avatarPhoto.slot, "front"), isNull(schema.avatarPhoto.deletedAt)))
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

/** 在试穿卡里上传正面全身照：去元数据、按文件头识别类型，存私有存储并作为正面照（替换旧的一张）。 */
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

/** 正面照：Supabase 私有桶生成 15 分钟签名 URL；本地存储没有公开地址，改用 data URI。 */
async function modelImage(photo: { storageKey: string; mime: string }): Promise<string> {
  const storage = getStorage();
  const signed = await storage.signedUrl(photo.storageKey, 900);
  if (signed) return signed;
  const obj = await storage.get(photo.storageKey);
  if (!obj) throw new TryonError(409, "没有找到你的正面全身照，请重新上传");
  return `data:${photo.mime};base64,${Buffer.from(obj.bytes).toString("base64")}`;
}

export type TryonInput = { lookId?: string | null; outfitId?: string | null; itemIds?: string[]; consent?: boolean };

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
  const ids = [...new Set((input.itemIds ?? []).filter((x): x is string => typeof x === "string"))].slice(0, 12);
  if (!ids.length) throw new TryonError(400, "没有可试穿的单品");
  return { items: await getItemsByIds(ids), lookId: null, outfitId: input.outfitId ?? null };
}

/** 发起一次整套试穿：同步依次调用，整体 120 秒超时；失败时记录并返回明确的中文错误。 */
export async function createTryon(userId: string, input: TryonInput): Promise<TryonView> {
  if (!isTryonEnabled()) throw new TryonError(503, "试穿服务未开放");
  if (input.consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new TryonError(403, "请先勾选同意，再开始试穿");
  const photo = await frontPhoto(userId);
  if (!photo) throw new TryonError(409, "请先上传一张正面全身照");

  const { items, lookId, outfitId } = await resolveItems(userId, input);
  const steps = planTryon(items);
  if (!steps.length) throw new TryonError(422, "这套里没有可试穿的上装、下装、连衣裙或外套");

  const snapshot: SnapshotItem[] = items.map((i) => ({
    id: i.id,
    name: i.name.replace(/^占位：/, ""),
    category: i.category,
    displayCategory: i.displayCategory,
    image: i.image,
    color: i.color,
    price: i.price,
  }));
  const id = crypto.randomUUID();
  await db.insert(schema.tryon).values({
    id,
    userId,
    sourceLookId: lookId,
    sourceOutfitId: outfitId,
    outfitSnapshot: snapshot as unknown as Record<string, unknown>[],
    itemIds: steps.map((s) => s.itemId),
    appliedCategories: steps.map((s) => s.label),
    status: "processing",
  });

  const signal = AbortSignal.timeout(TOTAL_TIMEOUT_MS - 5_000);
  const byId = new Map(items.map((i) => [i.id, i]));
  try {
    let current = await modelImage(photo);
    for (const step of steps) {
      const garment = await garmentImage(byId.get(step.itemId)!.image!);
      current = await runFashn({ modelImage: current, garmentImage: garment, category: step.category }, signal);
    }
    const bytes = await fetchResultImage(current, signal);
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
