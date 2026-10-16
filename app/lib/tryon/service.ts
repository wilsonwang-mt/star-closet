import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getItemsByIds, type Item } from "@/lib/catalog";
import { avatarKey, getStorage } from "@/lib/storage";
import { MAX_PHOTO_BYTES, sniffImage } from "@/lib/avatar/image";
import { PHOTO_RETENTION_DAYS } from "@/lib/avatar/purge";
import { stripMetadata } from "@/lib/avatar/strip";
import { accessoryKind } from "./accessory";
import { baseInfo, fileUrl, identityExtras, resolveBaseRef, storedImage, type BaseSource } from "./base";
import {
  cancelFashn,
  fashnResult,
  fashnStatus,
  FashnTransientError,
  fetchResultImage,
  TryonError,
  type FashnJob,
  type FashnMode,
  type FashnStatus,
} from "./fashn";
import type { NanoKind } from "./nano";
import { chainModel, isTryonEnabled, providerId, providerName, stageDeadline, stagePlan, submitStage, type StageInput, type StageModel } from "./provider";
import { planTryon, stepFor, wearOn, type FashnCategory, type TryonLabel, type WornPiece } from "./plan";

// 2D 试穿服务：把衣服换到用户自己的形象上（fal.ai 队列接口；模型编排见 provider.ts）。
// - 底图（D63）：优先数字分身的正面标准形象照；没有分身时退回本人正面全身照（avatar_photo.slot = front），见 base.ts。
// - 逐件（试衣间主路径，两段式）：一次只穿一件。默认先提交可灵 Kolors（约 20 秒出图）并立刻返回；nano-banana 多参考细化
//   （约 45 秒，[底图, 正脸, 商品图]）在响应之后提交，好了以后原地替换（界面写“正在细化”）。鞋包配饰只跑 nano 一段。
//   TRYON_PROVIDER=fashn_fal 时为原来的 FASHN performance → quality。
//   前端轮询 GET /api/tryon/<id>，服务端每次查一下 fal 状态、取回结果，写入私有存储放到响应之后（after）。
//   底图是本人形象，或本人一张成功的试穿结果（baseTryonId，用当前最好的那张，细化中也不必等）。
// - 一键试穿（商品详情页，createQuickTryon）：同一套逐件流程，不属于任何搭配；鞋包配饰也可以。
// - 缓存：同一底图（正面照 id 或底图试穿 id）+ 同一单品只生成一次，重复试穿直接返回；另一套里已完成的复制结果图，不再调用 FASHN。
// - 预热：上传正面照且已同意后，前端用 prewarm 先跑这一套的第一件（只跑 performance）；用户点“试穿”时命中缓存，再补提交 quality。
//   预热的记录在用户点“试穿”之前不出现在穿搭进度里；换照片时清掉没用上的预热结果。
// - 整套（旧调用方式，保留兼容）：按 plan.ts 的顺序依次叠加，mode=balanced，也走队列，每次轮询推进一步。
// - 照片来源：3D 形象流程已上传的正面全身照（avatar_photo.slot = front）；也可在试穿卡里直接上传一张，
//   同样去元数据后存私有存储，并作为正面照供 3D 形象复用（每个位置只保留一张）。上传时写 expires_at = 上传时间 + 30 天（D47）。
// - 同意（D47）：首次试穿（含预热）前单独勾选“同意把我的形象照片发送给 fal.ai 上的 AI 模型生成试穿图”，记录在 tryon_consent，
//   版本 tryon-consent-v2:fal；旧版本（tryon-consent-v1:fashn_fal）需要重新同意。
// - 结果：存 `<userId>/avatars/tryon-<id>.jpg`（细化后另存 `tryon-<id>-hq.jpg`，两张都随记录删除），
//   浏览器经 /api/avatar/files/<key> 读取（他人 404）；刚生成的一张在 data URI 不超过 inlineLimit（3.5MB，Vercel 函数响应上限 4.5MB）时
//   直接随轮询响应返回、写桶放到响应之后；更大的先写桶，响应里只给存储地址（deliver）。写桶完成之前同一记录同一阶段不再重复取结果、重复写桶（storing）。
// - 不新增数据库字段：生成信息放在 outfit_snapshot 末尾的一条 { kind: "step" | "chain", ... } 记录里。

export { TryonError } from "./fashn";

/** 当前同意版本：处理方为 fal.ai（不区分 fal 上的具体模型）；旧的 v1（FASHN）视为未同意。 */
export const CONSENT_VERSION = "tryon-consent-v2:fal";
export const consentVersion = () => CONSENT_VERSION;
/** 快速出图（performance）与整套每一步：从提交起最多等这么久。 */
export const FAST_DEADLINE_MS = 90_000;
/** 细化（quality）：从提交起最多等这么久，超过就保留快速出的那张。 */
export const FINE_DEADLINE_MS = 150_000;
/** 细化在响应之后提交：超过这个时间还没有提交记录，视为没有提交成功。 */
const FINE_SUBMIT_GRACE_MS = 30_000;
const TIMEOUT_MESSAGE = "试穿超时，请稍后再试";

export type SnapshotItem = {
  id: string;
  name: string;
  category: string;
  displayCategory: string | null;
  image: string | null;
  color: string;
  price: number;
};

/** queued 排队中 / generating 生成中 / refining 已出图、正在细化 / done 完成 / failed 失败。 */
export type TryonStage = "queued" | "generating" | "refining" | "done" | "failed";

export type TryonView = {
  id: string;
  status: string;
  /** 当前最好的一张：存储里的鉴权地址，或刚生成、随响应返回的 data URI。 */
  resultUrl: string | null;
  /** item：逐件试穿（一次穿一件）；outfit：旧的整套叠加。 */
  kind: "item" | "outfit";
  /** resultUrl 这张图的生成模式：逐件细化前为 performance、细化后为 quality；整套为 balanced。 */
  mode: FashnMode;
  stage: TryonStage;
  /** 排队位置（fal 返回时才有）。 */
  queuePosition: number | null;
  /** 逐件：已有快速结果、quality 还在细化。 */
  refining: boolean;
  /** 整套：正在第几步 / 共几步（从 1 起）；逐件为 null。 */
  progress: { step: number; total: number } | null;
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
  /** 同意文案里的处理方：“fal.ai 上的 AI 模型”。 */
  providerName: string;
};

/** 把任务放到响应之后执行（路由里传 next/server 的 after）；不传时就地执行（单元测试与脚本）。 */
export type Defer = (task: () => Promise<void>) => void;

type Row = typeof schema.tryon.$inferSelect;

/** 队列里的一段生成。没有 statusUrl 表示还在提交；done 之前每次轮询查一次状态。model：这一段用的模型（旧记录没有，按 FASHN）。 */
type Stage = Partial<FashnJob> & { submittedAt: number; done?: "ok" | "failed"; error?: string; model?: StageModel };

type StepMeta = {
  kind: "step";
  wornItemId: string;
  baseTryonId: string | null;
  /** 改造前的单段记录为 quality；两段式记录按 fast / fine 判断，这里记目标模式 quality。 */
  mode: FashnMode;
  basePhotoId?: string | null;
  cacheKey?: string;
  prewarm?: boolean;
  fast?: Stage | null;
  fine?: Stage | null;
  fastKey?: string;
  hqKey?: string;
  /** 鞋包配饰：nano 的动词（shoes / bag / accessory），只跑一段，不参与逐件叠穿。 */
  nanoKind?: NanoKind | null;
  /** 发起时的 TRYON_PROVIDER。 */
  provider?: string | null;
};

type ChainMeta = {
  kind: "chain";
  steps: { itemId: string; category: FashnCategory }[];
  index: number;
  job: Stage | null;
};

type Meta = StepMeta | ChainMeta;

const isMeta = (x: unknown): x is Meta => !!x && typeof x === "object" && typeof (x as { kind?: unknown }).kind === "string";
const metaOf = (row: Row): Meta | null => ((row.outfitSnapshot ?? []) as unknown[]).find(isMeta) ?? null;
const stepMetaOf = (row: Row): StepMeta | null => {
  const m = metaOf(row);
  return m?.kind === "step" ? m : null;
};

const isLive = (s: Stage | null | undefined): s is Stage => !!s && !s.done;
/** 逐件：还没出图，或已出图但细化未完成。 */
const stepPending = (row: Row, m: StepMeta) => row.status === "processing" || (row.status === "succeeded" && isLive(m.fine));

function toView(row: Row, live: Partial<TryonView> = {}): TryonView {
  const records = (row.outfitSnapshot ?? []) as unknown[];
  const meta = records.find(isMeta) ?? null;
  const step = meta?.kind === "step" ? meta : null;
  const chain = meta?.kind === "chain" ? meta : null;
  const refining = row.status === "succeeded" && !!step && isLive(step.fine);
  const mode: FashnMode = step
    ? step.fast || step.fine
      ? step.fine?.done === "ok"
        ? "quality"
        : "performance"
      : step.mode
    : "balanced";
  return {
    id: row.id,
    status: row.status,
    resultUrl: row.status === "succeeded" && row.resultKey ? fileUrl(row.resultKey) : null,
    kind: step ? "item" : "outfit",
    mode,
    stage: row.status === "failed" ? "failed" : row.status === "succeeded" ? (refining ? "refining" : "done") : "queued",
    queuePosition: null,
    refining,
    progress: chain ? { step: Math.min(chain.index + 1, chain.steps.length), total: chain.steps.length } : null,
    wornItemId: step?.wornItemId ?? null,
    baseTryonId: step?.baseTryonId ?? null,
    applied: row.appliedCategories as TryonLabel[],
    appliedItemIds: row.itemIds,
    items: records.filter((r) => !isMeta(r)) as SnapshotItem[],
    sourceLookId: row.sourceLookId,
    sourceOutfitId: row.sourceOutfitId,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    ...live,
  };
}

const liveFrom = (st: FashnStatus | null): Partial<TryonView> =>
  st?.state === "queued" ? { stage: "queued", queuePosition: st.position } : { stage: "generating", queuePosition: null };

/**
 * 原子地改 outfit_snapshot 末尾那条生成信息里的若干字段（"fine" 或 "fine.done" 这样的路径），可同时改普通列；
 * where 不满足时不改并返回 null（用作乐观锁）。各轮询只改自己的字段，不会互相覆盖。
 */
async function patchMeta(id: string, fields: Record<string, unknown>, cols: Partial<Pick<Row, "status" | "resultKey" | "error">> = {}, where?: SQL) {
  const col = schema.tryon.outfitSnapshot;
  let expr: SQL = sql`${col}`;
  for (const [k, v] of Object.entries(fields)) {
    const parts = [sql`(jsonb_array_length(${col}) - 1)::text`, ...k.split(".").map((p) => sql`${p}::text`)];
    expr = sql`jsonb_set(${expr}, array[${sql.join(parts, sql`, `)}], ${JSON.stringify(v ?? null)}::jsonb)`;
  }
  const rows = await db
    .update(schema.tryon)
    .set({ ...cols, outfitSnapshot: expr })
    .where(where ? and(eq(schema.tryon.id, id), where) : eq(schema.tryon.id, id))
    .returning();
  return rows[0] ?? null;
}

async function later(defer: Defer | undefined, task: () => Promise<void>) {
  const safe = () => task().catch((e) => console.error("[tryon]", e instanceof Error ? e.message : "unknown error"));
  if (defer) defer(safe);
  else await safe();
}

export async function hasConsent(userId: string): Promise<boolean> {
  const rows = await db.select().from(schema.tryonConsent).where(eq(schema.tryonConsent.userId, userId)).limit(1);
  return rows[0]?.consentVersion === CONSENT_VERSION;
}

export async function getTryonContext(userId: string | null): Promise<TryonContext> {
  const enabled = isTryonEnabled();
  const name = providerName();
  if (!enabled || !userId) return { enabled, signedIn: !!userId, consented: false, frontPhotoUrl: null, baseSource: null, providerName: name };
  const [consented, base] = await Promise.all([hasConsent(userId), baseInfo(userId)]);
  return { enabled, signedIn: true, consented, frontPhotoUrl: base.url, baseSource: base.source, providerName: name };
}

export async function recordConsent(userId: string) {
  await db
    .insert(schema.tryonConsent)
    .values({ userId, consentVersion: CONSENT_VERSION, consentAt: new Date() })
    .onConflictDoUpdate({ target: schema.tryonConsent.userId, set: { consentVersion: CONSENT_VERSION, consentAt: new Date() } });
}

const DAY_MS = 86400_000;

const keysOf = (row: Row) => {
  const m = stepMetaOf(row);
  return [...new Set([row.resultKey, m?.fastKey, m?.hqKey].filter((k): k is string => !!k))];
};

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
  // 换了照片：旧照片上没用上的预热结果不再需要，连同结果图删掉。
  const stale = await db
    .delete(schema.tryon)
    .where(and(eq(schema.tryon.userId, userId), sql`${schema.tryon.outfitSnapshot} @> ${JSON.stringify([{ kind: "step", prewarm: true }])}::jsonb`))
    .returning();
  const staleKeys = stale.flatMap(keysOf);
  if (staleKeys.length) await storage.remove(staleKeys).catch(() => {});
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

/** 读出底图交给 fal；文件已不在时 409。 */
async function loadBase(load: () => Promise<string | null>): Promise<string> {
  const image = await load();
  if (!image) throw new TryonError(409, NO_BASE);
  return image;
}

const BASE_NOT_FOUND = "没有找到这张试穿图";

/** 底图试穿的结果图（当前最好的一张）；已随一键删除被清掉时连同记录清理（与 getTryon 一致）。 */
async function baseImage(base: Row): Promise<string> {
  const image = base.resultKey ? await storedImage(base.resultKey) : null;
  if (image) return image;
  await db.delete(schema.tryon).where(eq(schema.tryon.id, base.id));
  throw new TryonError(404, BASE_NOT_FOUND);
}

export type TryonInput = {
  lookId?: string | null;
  outfitId?: string | null;
  itemIds?: string[];
  /** 逐件：在本人这张成功的试穿结果上继续穿；不传则穿在正面照上。 */
  baseTryonId?: string | null;
  /** 预热：上传正面照后提前跑这一件的 performance（只用于正面照、只跑一段）。 */
  prewarm?: boolean;
  consent?: boolean;
};

const uniqueIds = (ids: unknown[] | undefined) => [...new Set((ids ?? []).filter((x): x is string => typeof x === "string"))];

/**
 * 逐件请求：带 baseTryonId 或 prewarm，或 itemIds 恰好一件。
 * 旧调用方式（整套）发送的 itemIds 是这一套的全部单品，只有一件时两种理解的结果相同（把这一件穿在正面照上）。
 */
export function isItemRequest(input: TryonInput): boolean {
  return !!input.baseTryonId || !!input.prewarm || uniqueIds(input.itemIds).length === 1;
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

const dataUrlOf = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

type Settled =
  | { kind: "pending"; status: FashnStatus | null }
  | { kind: "image"; bytes: Uint8Array; mime: string; ext: string; dataUrl: string }
  | { kind: "failed"; message: string };

/** 查一段生成：还在排队 / 生成（网络抖动也算还在等），或已取回结果图，或失败。 */
async function settle(job: FashnJob): Promise<Settled> {
  try {
    const st = await fashnStatus(job);
    if (st.state !== "completed") return { kind: "pending", status: st };
    const url = await fashnResult(job);
    const bytes = await fetchResultImage(url);
    const info = sniffImage(bytes);
    if (!info) return { kind: "failed", message: "试穿结果无法读取，请稍后再试" };
    return { kind: "image", bytes, mime: info.mime, ext: info.ext, dataUrl: url.startsWith("data:image/") ? url : dataUrlOf(bytes, info.mime) };
  } catch (e) {
    if (e instanceof FashnTransientError) return { kind: "pending", status: null };
    if (e instanceof TryonError) return { kind: "failed", message: e.message };
    throw e;
  }
}

const hasJob = (s: Stage): s is Stage & FashnJob => !!s.statusUrl && !!s.responseUrl;

type Got = Extract<Settled, { kind: "image" }>;
type StoreWhich = "fast" | "hq" | "chain";

/**
 * 正在写桶的结果：`<记录 id>:<阶段>` → 开始时间。从“fal 已完成、取回结果”到“记录里写上 done”这段时间，
 * 每次轮询都会再取一遍结果、再写一次桶（x-upsert 覆盖同一个 key）；有标记时这几次轮询只回报“还在处理”，不再碰 fal 和存储。
 * 进程内的标记：Vercel 上多个实例之间不互斥，换到另一个实例的轮询仍可能重复写一次（覆盖同一 key，只多花时间与流量）。
 * 超过 STORING_TTL_MS 的标记视为失效（after() 的任务没跑完就被丢弃时不会永远卡住）。
 */
const storing = new Map<string, number>();
const STORING_TTL_MS = 90_000;
const storingKey = (id: string, which: StoreWhich) => `${id}:${which}`;
function isStoring(id: string, which: StoreWhich): boolean {
  const at = storing.get(storingKey(id, which));
  if (at === undefined) return false;
  if (Date.now() - at < STORING_TTL_MS) return true;
  storing.delete(storingKey(id, which));
  return false;
}

/** 随轮询响应内联返回的结果图上限（data URI 的字符数）。Vercel 函数响应体上限 4.5MB，留出 JSON 其余部分的余量。 */
const DEFAULT_INLINE_LIMIT = 3_500_000;
let inlineLimit = DEFAULT_INLINE_LIMIT;

/** 仅供单元测试调低内联上限；传 null 恢复默认值。 */
export function __setInlineLimitForTests(limit: number | null) {
  inlineLimit = limit ?? DEFAULT_INLINE_LIMIT;
}

/** 内联：结果图随这次响应返回、写桶放到响应之后；stored：太大放不进响应，已先写桶，row 是写好的记录，null 表示写桶没成功（下次轮询再取）。 */
type Delivery = { inline: true } | { inline: false; row: Row | null };

/**
 * 把取回的结果图交出去。data URI 不超过 inlineLimit 时随响应返回、写桶放到响应之后（首图不等写桶）；
 * 超过时（nano-banana 的 2K PNG 有 6.7–7.1MB，data URI 8.9–9.5MB）先写桶，响应里只给存储地址。
 * 写完之前同一记录同一阶段打上标记，见 storing。
 */
async function deliver(defer: Defer | undefined, id: string, which: StoreWhich, got: Got, store: () => Promise<Row | null>): Promise<Delivery> {
  const mark = storingKey(id, which);
  storing.set(mark, Date.now());
  const run = () => store().finally(() => storing.delete(mark));
  if (got.dataUrl.length <= inlineLimit) {
    await later(defer, async () => void (await run()));
    return { inline: true };
  }
  try {
    return { inline: false, row: await run() };
  } catch (e) {
    console.error("[tryon]", e instanceof Error ? e.message : "unknown error");
    return { inline: false, row: null };
  }
}

async function rowOf(id: string): Promise<Row | null> {
  const rows = await db.select().from(schema.tryon).where(eq(schema.tryon.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * 逐件：把取回的结果图写入私有存储并更新记录。细化先到时快速结果不再覆盖 resultKey。
 * 写之前再读一次记录：已经有人写过这个阶段（另一个实例）就不再写；记录已被删除就不写，免得留下无主文件。返回写好的记录。
 */
async function storeStep(userId: string, id: string, got: Got, which: "fast" | "hq"): Promise<Row | null> {
  const cur = await rowOf(id);
  if (!cur) return null;
  const m = stepMetaOf(cur);
  if (which === "hq" ? m?.hqKey : m?.fastKey) return cur;
  const key = avatarKey(userId, which === "hq" ? `tryon-${id}-hq` : `tryon-${id}`, got.ext);
  await getStorage().put(key, got.bytes, got.mime);
  if (which === "hq") {
    return patchMeta(id, { hqKey: key, "fine.done": "ok" }, { status: "succeeded", resultKey: key, error: null });
  }
  const updated = await patchMeta(id, { fastKey: key, "fast.done": "ok" }, { status: "succeeded", resultKey: key }, isNull(schema.tryon.resultKey));
  return updated ?? (await patchMeta(id, { fastKey: key, "fast.done": "ok" }));
}

/** 整套最后一步：同 storeStep，记录已经是 succeeded 时不再写。 */
async function storeChain(userId: string, id: string, got: Got): Promise<Row | null> {
  const cur = await rowOf(id);
  if (!cur) return null;
  if (cur.status === "succeeded") return cur;
  const key = avatarKey(userId, `tryon-${id}`, got.ext);
  await getStorage().put(key, got.bytes, got.mime);
  return patchMeta(id, { "job.done": "ok" }, { status: "succeeded", resultKey: key });
}

/** 逐件的一次轮询：细化好了直接用细化的一张；否则看快速出图；两段都失败才算失败。 */
async function advanceStep(userId: string, row: Row, meta: StepMeta, defer?: Defer): Promise<TryonView> {
  const now = Date.now();
  let fineLive: Partial<TryonView> | null = null;
  const fine = meta.fine;
  if (isLive(fine)) {
    if (isStoring(row.id, "hq")) {
      // 结果已取回、正在写桶：不再查 fal、不再重复写。
      fineLive = liveFrom(null);
    } else if (!hasJob(fine)) {
      if (now - fine.submittedAt > FINE_SUBMIT_GRACE_MS) row = (await patchMeta(row.id, { "fine.done": "failed" })) ?? row;
    } else if (now - fine.submittedAt > stageDeadline(fine.model, FINE_DEADLINE_MS)) {
      void cancelFashn(fine);
      row = (await patchMeta(row.id, { "fine.done": "failed", "fine.error": TIMEOUT_MESSAGE })) ?? row;
    } else {
      const got = await settle(fine);
      if (got.kind === "image") {
        const sent = await deliver(defer, row.id, "hq", got, () => storeStep(userId, row.id, got, "hq"));
        if (sent.inline) return toView(row, { status: "succeeded", resultUrl: got.dataUrl, stage: "done", refining: false, mode: "quality", error: null });
        if (sent.row) return toView(sent.row);
        fineLive = liveFrom(null);
      } else if (got.kind === "failed") row = (await patchMeta(row.id, { "fine.done": "failed", "fine.error": got.message })) ?? row;
      else fineLive = liveFrom(got.status);
    }
  }

  if (row.status !== "processing") return toView(row);

  const fast = meta.fast;
  let live: Partial<TryonView> = {};
  if (isLive(fast) && hasJob(fast)) {
    if (isStoring(row.id, "fast")) {
      live = liveFrom(null);
    } else if (now - fast.submittedAt > stageDeadline(fast.model, FAST_DEADLINE_MS)) {
      void cancelFashn(fast);
      row = (await patchMeta(row.id, { "fast.done": "failed", "fast.error": TIMEOUT_MESSAGE })) ?? row;
    } else {
      const got = await settle(fast);
      if (got.kind === "image") {
        const sent = await deliver(defer, row.id, "fast", got, () => storeStep(userId, row.id, got, "fast"));
        if (sent.inline) {
          const refining = isLive(stepMetaOf(row)?.fine);
          return toView(row, { status: "succeeded", resultUrl: got.dataUrl, stage: refining ? "refining" : "done", refining, mode: "performance" });
        }
        if (sent.row) return toView(sent.row);
        live = liveFrom(null);
      } else if (got.kind === "failed") row = (await patchMeta(row.id, { "fast.done": "failed", "fast.error": got.message })) ?? row;
      else live = liveFrom(got.status);
    }
  }

  const m = stepMetaOf(row) ?? meta;
  const fastDead = !m.fast || m.fast.done === "failed";
  const message = m.fast?.error ?? m.fine?.error ?? "试穿失败，请稍后再试";
  if (fastDead && !isLive(m.fine)) return failRow(row, message);
  // 快速出图失败但细化还在跑：等细化。
  return toView(row, fastDead ? (fineLive ?? { stage: "generating" }) : live);
}

async function failRow(row: Row, message: string) {
  const [failed] = await db.update(schema.tryon).set({ status: "failed", error: message }).where(eq(schema.tryon.id, row.id)).returning();
  return toView(failed ?? row);
}

/** 整套的一次轮询：当前一步好了就提交下一步（结果地址直接交给下一步，不取回本站）；最后一步取回结果图。 */
async function advanceChain(userId: string, row: Row, meta: ChainMeta, defer?: Defer): Promise<TryonView> {
  const total = meta.steps.length;
  if (Date.now() - row.createdAt.getTime() > stageDeadline(meta.job?.model, FAST_DEADLINE_MS) * total) {
    if (meta.job) void cancelFashn(meta.job);
    return failRow(row, TIMEOUT_MESSAGE);
  }
  const job = meta.job;
  if (!job || !hasJob(job) || job.done) return toView(row, { stage: "generating" });
  const last = meta.index >= total - 1;
  if (last) {
    if (isStoring(row.id, "chain")) return toView(row, { stage: "generating" });
    const got = await settle(job);
    if (got.kind === "failed") return failRow(row, got.message);
    if (got.kind === "pending") return toView(row, liveFrom(got.status));
    const sent = await deliver(defer, row.id, "chain", got, () => storeChain(userId, row.id, got));
    if (sent.inline) return toView(row, { status: "succeeded", resultUrl: got.dataUrl, stage: "done" });
    return toView(sent.row ?? row, sent.row ? {} : { stage: "generating" });
  }
  let url: string;
  try {
    const st = await fashnStatus(job);
    if (st.state !== "completed") return toView(row, liveFrom(st));
    url = await fashnResult(job);
  } catch (e) {
    if (e instanceof FashnTransientError) return toView(row, { stage: "generating" });
    if (e instanceof TryonError) return failRow(row, e.message);
    throw e;
  }
  // 乐观锁：只有把 index 从 i 推进到 i+1 的那次轮询负责提交下一步，避免重复提交。
  const next = meta.index + 1;
  const claimed = await patchMeta(row.id, { index: next, job: null }, {}, sql`(${schema.tryon.outfitSnapshot}->(-1)->>'index')::int = ${meta.index}`);
  if (!claimed) return toView(row, { stage: "generating" });
  const step = meta.steps[next];
  const item = (claimed.outfitSnapshot as unknown as SnapshotItem[]).find((i) => !isMeta(i) && i.id === step.itemId);
  try {
    if (!item?.image) throw new TryonError(422, "单品图片不可用");
    const model = meta.job?.model ?? "fashn_balanced";
    const nextJob = await submitStage(model, {
      modelImage: url,
      garmentImage: await garmentImage(item.image),
      category: step.category,
      syncMode: next === total - 1,
      // 正脸参考是 data URI，不存进记录：每步现取。
      ...(model === "nano" ? await identityExtras(userId) : {}),
    });
    const updated = await patchMeta(row.id, { job: nextJob });
    return toView(updated ?? claimed, { stage: "queued" });
  } catch (e) {
    return failRow(claimed, e instanceof TryonError ? e.message : "试穿失败，请稍后再试");
  }
}

/** 发起一次试穿：逐件（两段式）或旧的整套叠加（依次调用，balanced）。两者都只提交到队列，立即返回。 */
export async function createTryon(userId: string, input: TryonInput, defer?: Defer): Promise<TryonView> {
  if (!isTryonEnabled()) throw new TryonError(503, "试穿服务未开放");
  if (input.consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new TryonError(403, "请先勾选同意，再开始试穿");
  return isItemRequest(input) ? createItemTryon(userId, input, defer) : createOutfitTryon(userId, input);
}

/** 同一底图 + 同一单品的记录（未失败、未超时），新的在前。 */
async function findCached(userId: string, cacheKey: string): Promise<Row[]> {
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(
      and(
        eq(schema.tryon.userId, userId),
        ne(schema.tryon.status, "failed"),
        sql`${schema.tryon.outfitSnapshot} @> ${JSON.stringify([{ kind: "step", cacheKey }])}::jsonb`,
      ),
    )
    .orderBy(desc(schema.tryon.createdAt))
    .limit(5);
  return rows.filter((r) => r.status !== "processing" || Date.now() - r.createdAt.getTime() < FAST_DEADLINE_MS);
}

/** 补提交细化（默认 nano-banana 多参考，FASHN 备选时为 quality）；提交失败时记为细化失败，保留快速出的那张。 */
async function submitFine(id: string, model: StageModel, input: () => Promise<StageInput>) {
  try {
    const job = await submitStage(model, await input());
    await patchMeta(id, { fine: { ...job, submittedAt: job.submittedAt } });
  } catch (e) {
    await patchMeta(id, { "fine.done": "failed", "fine.error": e instanceof TryonError ? e.message : "细化失败" });
  }
}

type ItemOptions = { allowAccessory?: boolean };

/**
 * 逐件：只把这一件穿上。底图：baseTryonId 指向本人一张成功的试穿结果时读该结果图（不属于本人、不存在、未成功或文件已删一律 404，不区分）；
 * 否则用本人形象（数字分身正面照优先，否则正面照）。命中缓存直接返回；否则提交快出图一段、写记录后返回，细化放到响应之后提交（预热不提交）。
 * allowAccessory（详情页一键试穿）：鞋包配饰也可以，只跑 nano 一段，不改变已穿着的上身单品。
 */
async function createItemTryon(userId: string, input: TryonInput, defer?: Defer, opts: ItemOptions = {}): Promise<TryonView> {
  const ids = uniqueIds(input.itemIds);
  if (ids.length !== 1) throw new TryonError(400, "一次只能试穿一件");
  if (input.prewarm && input.baseTryonId) throw new TryonError(400, "预热只用于正面照");
  const [itemId] = ids;
  const { items, lookId, outfitId } = await resolveItems(userId, { ...input, itemIds: ids });
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new TryonError(404, lookId ? "这套搭配里没有这件单品" : "没有找到这件单品");
  const step = stepFor(item);
  const nanoKind = !step && opts.allowAccessory && item.image ? accessoryKind(item) : null;
  if (!step && !nanoKind) throw new TryonError(422, "只能试穿上装、下装、连衣裙或外套");
  const category: FashnCategory = step?.category ?? "tops";
  const plan = stagePlan(nanoKind);

  let base: Row | null = null;
  let worn: WornPiece[] = [];
  let ref: Awaited<ReturnType<typeof resolveBaseRef>> = null;
  if (input.baseTryonId) {
    const rows = await db
      .select()
      .from(schema.tryon)
      .where(and(eq(schema.tryon.id, input.baseTryonId), eq(schema.tryon.userId, userId)))
      .limit(1);
    base = rows[0] ?? null;
    if (!base || base.status !== "succeeded" || !base.resultKey) throw new TryonError(404, BASE_NOT_FOUND);
    const labels = base.appliedCategories as TryonLabel[];
    worn = base.itemIds.flatMap((id, i) => (labels[i] ? [{ itemId: id, label: labels[i] }] : []));
  } else {
    ref = await resolveBaseRef(userId);
    if (!ref) throw new TryonError(409, NO_BASE);
  }
  const baseRow = base;
  const baseRef = ref;
  const loadModel = () => (baseRow ? baseImage(baseRow) : loadBase(baseRef!.load));
  const loadGarment = () => garmentImage(item.image!);
  const cacheKey = `${baseRow ? `tryon:${baseRow.id}` : baseRef!.id}|${item.id}`;
  const after = step ? wearOn(worn, step) : worn;
  const afterIds = step ? after.map((w) => w.itemId) : [...after.map((w) => w.itemId), item.id];

  // 缓存：同一套里的直接返回（预热的转为正式，补提交细化）；另一套里已完成的复制结果图。
  const hits = await findCached(userId, cacheKey);
  const same = hits.find((h) => h.sourceLookId === lookId);
  const extrasP = identityExtras(userId);
  const stageInput = async (): Promise<StageInput> => ({
    modelImage: await loadModel(),
    garmentImage: await loadGarment(),
    category,
    nanoKind,
    ...(await extrasP),
  });
  if (same) {
    const m = stepMetaOf(same)!;
    if (input.prewarm || !m.prewarm) return toView(same);
    // 认领预热（乐观锁：并发的两次点击只有一次补提交细化）。
    const claimed = await patchMeta(
      same.id,
      { prewarm: false, fine: plan.fine ? { submittedAt: Date.now() } : null },
      {},
      sql`(${schema.tryon.outfitSnapshot}->(-1)->>'prewarm') = 'true'`,
    );
    if (claimed) {
      const fineModel = plan.fine;
      if (fineModel) await later(defer, () => submitFine(same.id, fineModel, stageInput));
      return toView(claimed);
    }
    const [fresh] = await db.select().from(schema.tryon).where(eq(schema.tryon.id, same.id)).limit(1);
    return toView(fresh ?? same);
  }
  const done = hits.find((h) => {
    const m = stepMetaOf(h);
    return h.status === "succeeded" && !!h.resultKey && !!m && !m.prewarm && !stepPending(h, m);
  });
  if (done && !input.prewarm) {
    const obj = await getStorage()
      .get(done.resultKey!)
      .catch(() => null);
    if (obj) {
      const id = crypto.randomUUID();
      const key = avatarKey(userId, `tryon-${id}`, done.resultKey!.split(".").pop()!);
      await getStorage().put(key, obj.bytes, obj.contentType);
      const meta: StepMeta = {
        kind: "step",
        wornItemId: item.id,
        baseTryonId: baseRow?.id ?? null,
        basePhotoId: baseRef?.photoId ?? null,
        mode: toView(done).mode,
        cacheKey,
        nanoKind,
        provider: providerId(),
      };
      const [row] = await db
        .insert(schema.tryon)
        .values({
          id,
          userId,
          sourceLookId: lookId,
          sourceOutfitId: outfitId,
          outfitSnapshot: [...snapshotOf(items), meta] as unknown as Record<string, unknown>[],
          itemIds: afterIds,
          appliedCategories: after.map((w) => w.label),
          status: "succeeded",
          resultKey: key,
        })
        .returning();
      return toView(row);
    }
  }

  const prepared = await stageInput();
  const fast = await submitStage(plan.fast, prepared);
  const id = crypto.randomUUID();
  const meta: StepMeta = {
    kind: "step",
    wornItemId: item.id,
    baseTryonId: baseRow?.id ?? null,
    basePhotoId: baseRef?.photoId ?? null,
    mode: "quality",
    cacheKey,
    prewarm: !!input.prewarm,
    fast,
    fine: input.prewarm || !plan.fine ? null : { submittedAt: Date.now() },
    nanoKind,
    provider: providerId(),
  };
  const [row] = await db
    .insert(schema.tryon)
    .values({
      id,
      userId,
      sourceLookId: lookId,
      sourceOutfitId: outfitId,
      outfitSnapshot: [...snapshotOf(items), meta] as unknown as Record<string, unknown>[],
      itemIds: afterIds,
      appliedCategories: after.map((w) => w.label),
      status: "processing",
    })
    .returning();
  const fineModel = plan.fine;
  if (!input.prewarm && fineModel) {
    await later(defer, () => submitFine(id, fineModel, async () => prepared));
  }
  return toView(row);
}

/** 旧的整套试穿（保留兼容）：按 plan.ts 的顺序依次叠加，每步一段（默认 Kolors）；这里只提交第一步，之后由轮询推进。 */
async function createOutfitTryon(userId: string, input: TryonInput): Promise<TryonView> {
  const ref = await resolveBaseRef(userId);
  if (!ref) throw new TryonError(409, NO_BASE);

  const { items, lookId, outfitId } = await resolveItems(userId, input);
  const steps = planTryon(items);
  if (!steps.length) throw new TryonError(422, "这套里没有可试穿的上装、下装、连衣裙或外套");

  const byId = new Map(items.map((i) => [i.id, i]));
  const model = chainModel();
  const job = await submitStage(model, {
    modelImage: await loadBase(ref.load),
    garmentImage: await garmentImage(byId.get(steps[0].itemId)!.image!),
    category: steps[0].category,
    syncMode: steps.length === 1,
    ...(model === "nano" ? await identityExtras(userId) : {}),
  });
  const meta: ChainMeta = { kind: "chain", steps: steps.map((s) => ({ itemId: s.itemId, category: s.category })), index: 0, job };
  const [row] = await db
    .insert(schema.tryon)
    .values({
      id: crypto.randomUUID(),
      userId,
      sourceLookId: lookId,
      sourceOutfitId: outfitId,
      outfitSnapshot: [...snapshotOf(items), meta] as unknown as Record<string, unknown>[],
      itemIds: steps.map((s) => s.itemId),
      appliedCategories: steps.map((s) => s.label),
      status: "processing",
    })
    .returning();
  return toView(row);
}

/**
 * 商品详情页“一键试穿”：把这一件穿到本人形象上（不属于任何搭配），走同一套逐件两段式与缓存。
 * 上装 / 下装 / 外套 / 连衣裙：Kolors 快出图 → nano 细化；鞋、包、配饰：只跑 nano。前端轮询 GET /api/tryon/<id>。
 */
export async function createQuickTryon(userId: string, itemId: string, opts: { consent?: boolean } = {}, defer?: Defer): Promise<TryonView> {
  if (!isTryonEnabled()) throw new TryonError(503, "试穿服务未开放");
  if (opts.consent === true) await recordConsent(userId);
  if (!(await hasConsent(userId))) throw new TryonError(403, "请先勾选同意，再开始试穿");
  const [item] = await getItemsByIds([itemId]);
  if (!item) throw new TryonError(404, "没有找到这件单品");
  if (!item.image) throw new TryonError(422, "这件单品没有可用的图片");
  if (!stepFor(item) && !accessoryKind(item)) throw new TryonError(422, "这件单品暂不支持试穿");
  return createItemTryon(userId, { itemIds: [item.id] }, defer, { allowAccessory: true });
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
      const m = stepMetaOf(row);
      return !!m && !m.prewarm && m.wornItemId === itemId && m.baseTryonId === null && !!row.resultKey;
    }) ?? null
  );
}

/** 本人这件单品最新的一键试穿结果（详情页首屏用；细化中时 refining 为 true，前端接着轮询）。 */
export async function getItemTryon(userId: string, itemId: string): Promise<TryonView | null> {
  const row = await latestItemTryonRow(userId, itemId);
  return row ? toView(row) : null;
}

/** 一键试穿结果图（交给场景图生成作参考，保证衣服准确）；没有或文件已删时为 null。 */
export async function itemTryonImage(userId: string, itemId: string): Promise<string | null> {
  const row = await latestItemTryonRow(userId, itemId);
  return row?.resultKey ? storedImage(row.resultKey) : null;
}

/** 每套最多带回的试穿结果数（取最新的这些，按时间先后排列）。 */
const FRAMES_PER_LOOK = 24;

/**
 * 本人在这些搭配上的成功试穿，按搭配分组、按时间先后排列（试衣间的“穿搭进度”）；还没被用上的预热结果不列出。
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
    if (!row.sourceLookId || !row.resultKey || stepMetaOf(row)?.prewarm) continue;
    (out[row.sourceLookId] ??= []).push(toView(row));
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(-FRAMES_PER_LOOK);
  return out;
}

/**
 * 本人的试穿结果（前端轮询用）：还在生成或细化时推进一步（查 fal 状态、取回结果，写入存储交给 defer）；
 * 不存在、不属于本人或结果图已被删除时返回 null（路由一律 404）。
 */
export async function pollTryon(userId: string, id: string, defer?: Defer): Promise<TryonView | null> {
  const rows = await db
    .select()
    .from(schema.tryon)
    .where(and(eq(schema.tryon.id, id), eq(schema.tryon.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const meta = metaOf(row);
  if (meta?.kind === "step" && stepPending(row, meta)) return advanceStep(userId, row, meta, defer);
  if (meta?.kind === "chain" && row.status === "processing") return advanceChain(userId, row, meta, defer);
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

export const getTryon = (userId: string, id: string) => pollTryon(userId, id);

export async function deleteTryon(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(schema.tryon)
    .where(and(eq(schema.tryon.id, id), eq(schema.tryon.userId, userId)))
    .returning();
  const row = rows[0];
  if (!row) return false;
  const m = stepMetaOf(row);
  // 还在跑的生成不再需要：尽力取消（已开始的无法取消，结果没有人取回）。
  for (const s of [m?.fast, m?.fine]) if (isLive(s)) void cancelFashn(s);
  const keys = keysOf(row);
  if (keys.length) await getStorage().remove(keys).catch(() => {});
  return true;
}

/** 删除本人全部试穿结果与试穿同意（一键删除 3D 形象时调用）。 */
export async function deleteAllTryons(userId: string): Promise<number> {
  const rows = await db.delete(schema.tryon).where(eq(schema.tryon.userId, userId)).returning();
  const keys = rows.flatMap(keysOf);
  if (keys.length) await getStorage().remove(keys).catch(() => {});
  await db.delete(schema.tryonConsent).where(eq(schema.tryonConsent.userId, userId));
  return rows.length;
}
