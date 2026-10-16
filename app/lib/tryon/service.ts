import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getItemsByIds, type Item } from "@/lib/catalog";
import { avatarKey, getStorage } from "@/lib/storage";
import { MAX_PHOTO_BYTES, sniffImage } from "@/lib/avatar/image";
import { PHOTO_RETENTION_DAYS } from "@/lib/avatar/purge";
import { stripMetadata } from "@/lib/avatar/strip";
import { isAccessory, runAccessoryTryon } from "./accessory";
import { baseInfo, fileUrl, identityRefs, resolveBase, storedImage, type BaseSource } from "./base";
import { fetchResultImage, TryonError, type FashnMode } from "./fashn";
import { isTryonEnabled, providerId, providerName, runTryonStep } from "./provider";
import { planTryon, stepFor, wearOn, type TryonLabel, type WornPiece } from "./plan";

// 2D 试穿服务：把衣服换到用户自己的形象上（D62 起默认可灵 Kolors on fal.ai，TRYON_PROVIDER=fashn_fal 时用 FASHN）。
// - 底图（D63）：优先用数字分身的正面标准形象照；没有分身时退回本人正面全身照（avatar_photo.slot = front），见 base.ts。
// - 逐件（试衣间主路径）：一次只穿一件，调用一次模型。底图是本人形象，或本人一张成功的试穿结果
//   （baseTryonId），这样一件一件把整套穿起来。
// - 整套（旧调用方式，保留兼容）：按 plan.ts 的顺序依次叠加。
// - 一键试穿（商品详情页）：上装 / 下装 / 外套 / 连衣裙走试穿模型；鞋、包、配饰改用 nano-banana-pro/edit，
//   以多张身份参考 + 商品图生成同一个人穿戴这件的全身照（accessory.ts）。
// - 也可在试穿卡里直接上传一张正面全身照（兜底），去元数据后存私有存储；上传时写 expires_at = 上传时间 + 30 天（D47）。
// - 同意（D47）：首次试穿前单独勾选“同意把我的形象照片发送给 fal.ai（可灵 Kolors）生成试穿图”，记录在 tryon_consent；
//   版本号带模型名，换模型或旧版本（v1）都需要重新同意。
// - 结果：服务端取回结果图存 `<userId>/avatars/tryon-<id>.png`，浏览器经 /api/avatar/files/<key> 读取（他人 404）。

export { TryonError } from "./fashn";

/** 当前同意版本：tryon-consent-v2:<模型>。旧的 v1（FASHN）或换了模型都视为未同意。 */
export const consentVersion = () => `tryon-consent-v2:${providerId() ?? "none"}`;
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
  /** 试穿底图的鉴权读取地址：数字分身正面照优先，否则正面全身照；都没有时为 null。字段名沿用旧名。 */
  frontPhotoUrl: string | null;
  /** 底图来源：twin（数字分身）/ photo（正面全身照）/ null（还没有形象）。 */
  baseSource: BaseSource | null;
  /** 同意文案里的处理方，如“fal.ai（可灵 Kolors）”。 */
  providerName: string;
};

// 逐件试穿的信息不新增字段：在 outfit_snapshot（jsonb 数组）末尾追加一条 { kind: "step", ... } 记录，
// 读出时与单品快照分开；没有这条记录的旧行就是整套试穿。item_ids / applied_categories 存结果图上累计穿着的单品。
// provider：这一步实际用的模型（kolors_fal / fashn_fal / nano_banana），旧记录没有。
type StepMeta = { kind: "step"; wornItemId: string; baseTryonId: string | null; mode: FashnMode; provider?: string };
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

export async function hasConsent(userId: string): Promise<boolean> {
  const rows = await db.select().from(schema.tryonConsent).where(eq(schema.tryonConsent.userId, userId)).limit(1);
  return rows[0]?.consentVersion === consentVersion();
}

export async function getTryonContext(userId: string | null): Promise<TryonContext> {
  const enabled = isTryonEnabled();
  const name = providerName();
  if (!enabled || !userId) return { enabled, signedIn: !!userId, consented: false, frontPhotoUrl: null, baseSource: null, providerName: name };
  const [consented, base] = await Promise.all([hasConsent(userId), baseInfo(userId)]);
  return { enabled, signedIn: true, consented, frontPhotoUrl: base.url, baseSource: base.source, providerName: name };
}

export async function recordConsent(userId: string) {
  const version = consentVersion();
  await db
    .insert(schema.tryonConsent)
    .values({ userId, consentVersion: version, consentAt: new Date() })
    .onConflictDoUpdate({ target: schema.tryonConsent.userId, set: { consentVersion: version, consentAt: new Date() } });
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

const NO_BASE = "先建立你的形象，再开始试穿";

/** 试穿底图（分身正面照优先，否则正面全身照）；都没有时 409。 */
async function requireBase(userId: string): Promise<string> {
  const base = await resolveBase(userId);
  if (!base) throw new TryonError(409, NO_BASE);
  return base.image;
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
    model = await requireBase(userId);
  }

  const after = wearOn(worn, step);
  const meta: StepMeta = { kind: "step", wornItemId: item.id, baseTryonId, mode: "quality", provider: providerId() ?? undefined };
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
    return runTryonStep({ modelImage: model, garmentImage: garment, category: step.category, mode: "quality" }, signal);
  });
}

/** 旧的整套试穿（保留兼容）：按 plan.ts 的顺序依次调用，上一步结果作为下一步底图。 */
async function createOutfitTryon(userId: string, input: TryonInput): Promise<TryonView> {
  const firstBase = await requireBase(userId);

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
    let current = firstBase;
    for (const step of steps) {
      const garment = await garmentImage(byId.get(step.itemId)!.image!);
      current = await runTryonStep({ modelImage: current, garmentImage: garment, category: step.category, mode }, signal);
    }
    return current;
  });
}

/**
 * 商品详情页“一键试穿”：把这一件穿到本人形象上（不属于任何搭配）。
 * - 上装 / 下装 / 外套 / 连衣裙：走试穿模型（默认 Kolors），底图为分身正面照或正面全身照。
 * - 鞋、包、配饰（试穿模型不支持）：nano-banana-pro/edit，身份参考（分身多张，没有时为底图）+ 商品图。
 */
export async function createQuickTryon(userId: string, itemId: string, opts: { consent?: boolean } = {}): Promise<TryonView> {
  if (!isTryonEnabled()) throw new TryonError(503, "试穿服务未开放");
  if (opts.consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new TryonError(403, "请先勾选同意，再开始试穿");
  const [item] = await getItemsByIds([itemId]);
  if (!item) throw new TryonError(404, "没有找到这件单品");
  if (!item.image) throw new TryonError(422, "这件单品没有可用的图片");
  if (stepFor(item)) return createItemTryon(userId, { itemIds: [item.id] });
  if (!isAccessory(item)) throw new TryonError(422, "这件单品暂不支持试穿");

  const refs = await identityRefs(userId);
  if (!refs.length) throw new TryonError(409, NO_BASE);
  const meta: StepMeta = { kind: "step", wornItemId: item.id, baseTryonId: null, mode: "quality", provider: "nano_banana" };
  const id = crypto.randomUUID();
  await db.insert(schema.tryon).values({
    id,
    userId,
    sourceLookId: null,
    sourceOutfitId: null,
    outfitSnapshot: [...snapshotOf([item]), meta] as unknown as Record<string, unknown>[],
    itemIds: [item.id],
    // applied_categories 只记录试穿模型的上身区域（上装 / 下装 / 连衣裙 / 外套）；鞋包配饰留空，不参与逐件叠穿。
    appliedCategories: [],
    status: "processing",
  });
  return runAndStore(userId, id, async (signal) => runAccessoryTryon({ refs, garment: await garmentImage(item.image!), item }, signal));
}

/** 本人这件单品最新的一键试穿结果（详情页首屏用）；没有时为 null。 */
export async function getItemTryon(userId: string, itemId: string): Promise<TryonView | null> {
  const row = await latestItemTryonRow(userId, itemId);
  return row ? toView(row) : null;
}

async function latestItemTryonRow(userId: string, itemId: string) {
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(and(eq(schema.tryon.userId, userId), isNull(schema.tryon.sourceLookId), eq(schema.tryon.status, "succeeded")))
    .orderBy(desc(schema.tryon.createdAt))
    .limit(60);
  return (
    rows.find((row) => {
      const v = toView(row);
      return v.kind === "item" && v.wornItemId === itemId && v.baseTryonId === null && !!row.resultKey;
    }) ?? null
  );
}

/** 一键试穿结果图（交给场景图生成作参考，保证衣服准确）；没有或文件已删时为 null。 */
export async function itemTryonImage(userId: string, itemId: string): Promise<string | null> {
  const row = await latestItemTryonRow(userId, itemId);
  return row?.resultKey ? storedImage(row.resultKey) : null;
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
