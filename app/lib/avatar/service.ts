import { and, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { avatarKey, getStorage, photoKey } from "@/lib/storage";
import { MAX_PHOTO_BYTES, QUALITY_HINTS, qualityFlags, sniffImage, type QualityFlags } from "./image";
import {
  activeProviderInfo,
  getProvider,
  hasRequiredSlots,
  ProviderError,
  providerInfo,
  requiredSlotsMessage,
  type ErrorCode,
  type ProviderInfo,
} from "./providers";

// 3D 形象：同意 → 上传照片 → 生成（draft → queued → processing → succeeded / failed，可 canceled）→ 查看 → 删除。
// 所有函数都以当前登录用户 userId 为界，只读写本人数据。
// 作业推进由 GET /api/avatar/jobs/[id] 轮询驱动（tick），并用带条件的 UPDATE 防止并发轮询重复提交。

export const SLOTS = ["front", "side", "back", "face", "extra"] as const;
export type Slot = (typeof SLOTS)[number];
export const MAX_EXTRA = 3;
/** 原始照片在对应形象生成完成后保留天数（D47）。 */
export const PHOTO_RETENTION_DAYS = 30;
/** 一键删除时写入 error 的标记；带此标记的作业不再计入同意状态。 */
const DELETED_MARK = "DELETED_BY_USER|用户已删除全部照片与形象";

export type JobStatus = "draft" | "queued" | "processing" | "succeeded" | "failed" | "canceled";

export type PhotoView = {
  id: string;
  slot: Slot;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  hints: string[];
  createdAt: string;
};

export type JobView = {
  id: string;
  status: JobStatus;
  provider: string;
  isMock: boolean;
  glbUrl: string | null;
  fidelityNote: string | null;
  badges: string[];
  error: { code: string; message: string } | null;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type AvatarState = {
  provider: { id: string; isMock: boolean; processor: string; consentVersion: string };
  consent: { version: string; at: string; current: boolean } | null;
  photos: PhotoView[];
  job: JobView | null;
  canGenerate: boolean;
  retentionDays: number;
};

export class AvatarError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const fileUrl = (key: string) => `/api/avatar/files/${key}`;

export function badgesFor(isMock: boolean): string[] {
  return isMock ? ["非本人示意模型", "合身：未验证"] : ["AI 生成 3D 形象 · 还原度未验证", "合身：未验证"];
}

function parseError(e: string | null): JobView["error"] {
  if (!e) return null;
  const i = e.indexOf("|");
  return i < 0 ? { code: "PROVIDER_FAILED", message: e } : { code: e.slice(0, i), message: e.slice(i + 1) };
}

type JobRow = typeof schema.avatarJob.$inferSelect;
type PhotoRow = typeof schema.avatarPhoto.$inferSelect;

function toJobView(j: JobRow): JobView {
  const info = providerInfo(j.provider);
  const isMock = info?.isMock ?? true;
  const terminal = j.status === "succeeded" || j.status === "failed" || j.status === "canceled";
  return {
    id: j.id,
    status: j.status as JobStatus,
    provider: j.provider,
    isMock,
    glbUrl: j.status === "succeeded" && j.resultGlbKey ? fileUrl(j.resultGlbKey) : null,
    fidelityNote: j.fidelityNote,
    badges: badgesFor(isMock),
    error: j.status === "failed" ? parseError(j.error) : null,
    elapsedSeconds: Math.max(0, Math.round(((terminal ? j.updatedAt.getTime() : Date.now()) - j.createdAt.getTime()) / 1000)),
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}

function toPhotoView(p: PhotoRow): PhotoView {
  const flags = (p.qualityFlags ?? {}) as Partial<QualityFlags>;
  return {
    id: p.id,
    slot: p.slot as Slot,
    url: fileUrl(p.storageKey),
    width: p.width,
    height: p.height,
    bytes: p.bytes,
    hints: (Object.keys(QUALITY_HINTS) as (keyof QualityFlags)[]).filter((k) => flags[k]).map((k) => QUALITY_HINTS[k]),
    createdAt: p.createdAt.toISOString(),
  };
}

const notDeletedJob = or(isNull(schema.avatarJob.error), ne(schema.avatarJob.error, DELETED_MARK));

async function livePhotos(userId: string) {
  return db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt)))
    .orderBy(schema.avatarPhoto.createdAt);
}

async function latestJobs(userId: string, limit = 10) {
  return db
    .select()
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), notDeletedJob))
    .orderBy(desc(schema.avatarJob.createdAt))
    .limit(limit);
}

function consentOf(jobs: JobRow[], info: ProviderInfo): AvatarState["consent"] {
  const j = jobs.find((x) => x.consentVersion && x.consentAt);
  if (!j || !j.consentVersion || !j.consentAt) return null;
  return { version: j.consentVersion, at: j.consentAt.toISOString(), current: j.consentVersion === info.consentVersion };
}

// 必填视角随服务而定（真实服务按位置区分视角，见 providers.ts）。
function hasRequiredPhotos(photos: { slot: string }[], providerId: string) {
  return hasRequiredSlots(providerId, photos);
}

// D47：原始照片在对应形象生成完成 30 天后删除。比赛版在读取状态时顺带清理（惰性）。
async function purgeExpiredPhotos(userId: string) {
  const cutoff = new Date(Date.now() - PHOTO_RETENTION_DAYS * 86400_000);
  const old = await db
    .select({ ids: schema.avatarJob.inputPhotoIds })
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), eq(schema.avatarJob.status, "succeeded"), lt(schema.avatarJob.updatedAt, cutoff)));
  const ids = [...new Set(old.flatMap((r) => r.ids ?? []))];
  if (!ids.length) return;
  const rows = await db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt), inArray(schema.avatarPhoto.id, ids)));
  if (!rows.length) return;
  await getStorage().remove(rows.map((r) => r.storageKey));
  await db
    .update(schema.avatarPhoto)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.avatarPhoto.userId, userId), inArray(schema.avatarPhoto.id, rows.map((r) => r.id))));
}

export async function getAvatarState(userId: string): Promise<AvatarState> {
  await purgeExpiredPhotos(userId);
  const info = activeProviderInfo();
  const [photos, jobs] = await Promise.all([livePhotos(userId), latestJobs(userId)]);
  const consent = consentOf(jobs, info);
  const job = jobs.find((j) => j.status !== "draft");
  return {
    provider: { id: info.id, isMock: info.isMock, processor: info.processor, consentVersion: info.consentVersion },
    consent,
    photos: photos.map(toPhotoView),
    job: job ? toJobView(job) : null,
    canGenerate: !!consent?.current && hasRequiredPhotos(photos, info.id),
    retentionDays: PHOTO_RETENTION_DAYS,
  };
}

async function requireConsent(userId: string) {
  const info = activeProviderInfo();
  const jobs = await latestJobs(userId);
  const consent = consentOf(jobs, info);
  if (!consent?.current) throw new AvatarError(403, "请先阅读并勾选同意，再上传照片");
  return { info, jobs, consent };
}

export async function recordConsent(userId: string) {
  const info = activeProviderInfo();
  const now = new Date();
  const [draft] = await db
    .select()
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), eq(schema.avatarJob.status, "draft"), notDeletedJob))
    .orderBy(desc(schema.avatarJob.createdAt))
    .limit(1);
  if (draft) {
    await db
      .update(schema.avatarJob)
      .set({ consentVersion: info.consentVersion, consentAt: now, provider: info.id, updatedAt: now })
      .where(eq(schema.avatarJob.id, draft.id));
  } else {
    await db.insert(schema.avatarJob).values({
      id: crypto.randomUUID(),
      userId,
      status: "draft",
      provider: info.id,
      consentVersion: info.consentVersion,
      consentAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return getAvatarState(userId);
}

export async function addPhoto(userId: string, slot: string, file: File) {
  if (!(SLOTS as readonly string[]).includes(slot)) throw new AvatarError(400, "照片位置不对");
  if (file.size > MAX_PHOTO_BYTES) throw new AvatarError(413, "单张照片不能超过 8MB");
  if (file.size === 0) throw new AvatarError(400, "照片是空文件");
  await requireConsent(userId);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new AvatarError(413, "单张照片不能超过 8MB");
  const info = sniffImage(bytes);
  if (!info) throw new AvatarError(415, "只支持 JPG、PNG、WebP 图片");
  if (info.width < 64 || info.height < 64 || info.width > 10000 || info.height > 10000) {
    throw new AvatarError(400, "图片尺寸不对");
  }

  const live = await livePhotos(userId);
  if (slot === "extra" && live.filter((p) => p.slot === "extra").length >= MAX_EXTRA) {
    throw new AvatarError(400, `补充照片最多 ${MAX_EXTRA} 张`);
  }

  const storage = getStorage();
  const id = crypto.randomUUID();
  const key = photoKey(userId, id, info.ext);
  await storage.put(key, bytes, info.mime);
  try {
    await db.insert(schema.avatarPhoto).values({
      id,
      userId,
      slot,
      storageKey: key,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: bytes.byteLength,
      qualityFlags: qualityFlags(slot, info, bytes.byteLength),
    });
  } catch (e) {
    await storage.remove([key]).catch(() => {});
    throw e;
  }
  // 正面/侧面/背面/面部每个位置只保留一张：替换掉旧照片并删除旧文件。
  if (slot !== "extra") {
    const old = live.filter((p) => p.slot === slot);
    if (old.length) {
      await storage.remove(old.map((p) => p.storageKey));
      await db
        .update(schema.avatarPhoto)
        .set({ deletedAt: new Date() })
        .where(and(eq(schema.avatarPhoto.userId, userId), inArray(schema.avatarPhoto.id, old.map((p) => p.id))));
    }
  }
  return getAvatarState(userId);
}

export async function deletePhoto(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.avatarPhoto)
    .where(and(eq(schema.avatarPhoto.id, id), eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt)))
    .limit(1);
  if (!row) throw new AvatarError(404, "照片不存在");
  await getStorage().remove([row.storageKey]);
  await db.update(schema.avatarPhoto).set({ deletedAt: new Date() }).where(eq(schema.avatarPhoto.id, row.id));
  return getAvatarState(userId);
}

export async function createJob(userId: string): Promise<JobView> {
  const { info, jobs, consent } = await requireConsent(userId);
  const active = jobs.find((j) => j.status === "queued" || j.status === "processing");
  if (active) throw new AvatarError(409, "已有一个正在生成的任务");
  const photos = await livePhotos(userId);
  if (!hasRequiredPhotos(photos, info.id)) throw new AvatarError(400, requiredSlotsMessage(info.id));

  const now = new Date();
  const values = {
    status: "queued" as const,
    provider: info.id,
    inputPhotoIds: photos.map((p) => p.id),
    consentVersion: consent.version,
    consentAt: new Date(consent.at),
    error: null,
    updatedAt: now,
  };
  const draft = jobs.find((j) => j.status === "draft");
  let row: JobRow | undefined;
  if (draft) {
    [row] = await db
      .update(schema.avatarJob)
      .set({ ...values, createdAt: now })
      .where(and(eq(schema.avatarJob.id, draft.id), eq(schema.avatarJob.status, "draft")))
      .returning();
  }
  if (!row) {
    // 重试：沿用同一份（仍有效的）同意，新建一个作业。
    [row] = await db
      .insert(schema.avatarJob)
      .values({ id: crypto.randomUUID(), userId, createdAt: now, ...values })
      .returning();
  }
  return toJobView(row);
}

const g = globalThis as unknown as { scAvatarInflight?: Set<string> };
const inflight = (g.scAvatarInflight ??= new Set());

async function failJob(id: string, code: ErrorCode, message: string) {
  await db
    .update(schema.avatarJob)
    .set({ status: "failed", error: `${code}|${message}`, updatedAt: new Date() })
    .where(and(eq(schema.avatarJob.id, id), inArray(schema.avatarJob.status, ["queued", "processing"])));
}

async function getOwnJob(userId: string, jobId: string) {
  const [j] = await db
    .select()
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.id, jobId), eq(schema.avatarJob.userId, userId), notDeletedJob))
    .limit(1);
  return j ?? null;
}

/** 读取作业并推进一步。返回 null 表示不存在或不属于本人。 */
export async function tickJob(userId: string, jobId: string): Promise<JobView | null> {
  const job = await getOwnJob(userId, jobId);
  if (!job || job.status === "draft") return null;
  if ((job.status !== "queued" && job.status !== "processing") || inflight.has(job.id)) return toJobView(job);

  inflight.add(job.id);
  try {
    if (job.status === "queued") {
      // 只有把 queued 改成 processing 的那一次请求负责提交，避免重复调用（真实服务按次计费）。
      const [won] = await db
        .update(schema.avatarJob)
        .set({ status: "processing", updatedAt: new Date() })
        .where(and(eq(schema.avatarJob.id, job.id), eq(schema.avatarJob.status, "queued")))
        .returning();
      if (won) {
        try {
          const provider = getProvider(won.provider);
          const photos = won.inputPhotoIds.length
            ? await db
                .select()
                .from(schema.avatarPhoto)
                .where(
                  and(
                    eq(schema.avatarPhoto.userId, userId),
                    isNull(schema.avatarPhoto.deletedAt),
                    inArray(schema.avatarPhoto.id, won.inputPhotoIds),
                  ),
                )
            : [];
          await provider.submit(won.id, photos.map((p) => ({ slot: p.slot, storageKey: p.storageKey, mime: p.mime })));
        } catch (e) {
          const pe = e instanceof ProviderError ? e : new ProviderError("PROVIDER_FAILED", "提交生成任务失败");
          await failJob(job.id, pe.code, pe.message);
        }
      }
    } else {
      let provider;
      try {
        provider = getProvider(job.provider);
      } catch (e) {
        const pe = e as ProviderError;
        await failJob(job.id, pe.code ?? "PROVIDER_FAILED", pe.message);
        return toJobView((await getOwnJob(userId, jobId))!);
      }
      const r = await provider.poll(job.id, job.updatedAt).catch(
        () => ({ state: "failed", code: "PROVIDER_FAILED", message: "查询生成进度失败" }) as const,
      );
      if (r.state === "failed") {
        await failJob(job.id, r.code, r.message);
      } else if (r.state === "succeeded") {
        const key = avatarKey(userId, job.id);
        const storage = getStorage();
        await storage.put(key, r.glb, "model/gltf-binary");
        const [done] = await db
          .update(schema.avatarJob)
          .set({ status: "succeeded", resultGlbKey: key, fidelityNote: provider.info.fidelityNote, error: null, updatedAt: new Date() })
          .where(and(eq(schema.avatarJob.id, job.id), eq(schema.avatarJob.status, "processing")))
          .returning();
        // 期间被取消或删除：丢弃结果文件。
        if (!done) await storage.remove([key]).catch(() => {});
      }
    }
  } finally {
    inflight.delete(job.id);
  }
  const fresh = await getOwnJob(userId, jobId);
  return fresh ? toJobView(fresh) : null;
}

async function safeCancel(providerId: string, jobId: string) {
  try {
    await getProvider(providerId).cancel(jobId);
  } catch {
    // 服务未配置或取消请求失败：本地状态已改为 canceled，忽略。
  }
}

export async function cancelJob(userId: string, jobId: string): Promise<JobView | null> {
  const job = await getOwnJob(userId, jobId);
  if (!job || job.status === "draft") return null;
  if (job.status === "queued" || job.status === "processing") {
    await db
      .update(schema.avatarJob)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(schema.avatarJob.id, job.id), inArray(schema.avatarJob.status, ["queued", "processing"])));
    await safeCancel(job.provider, job.id);
  }
  const fresh = await getOwnJob(userId, jobId);
  return fresh ? toJobView(fresh) : null;
}

/** 一键删除：全部照片与生成结果（含存储文件），作业标记 canceled，同意随之失效。 */
export async function deleteAll(userId: string) {
  const active = await db
    .select({ id: schema.avatarJob.id, provider: schema.avatarJob.provider })
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), inArray(schema.avatarJob.status, ["queued", "processing"])));
  const now = new Date();
  await db
    .update(schema.avatarJob)
    .set({ status: "canceled", error: DELETED_MARK, resultGlbKey: null, resultPreviewKey: null, updatedAt: now })
    .where(eq(schema.avatarJob.userId, userId));
  await db
    .update(schema.avatarPhoto)
    .set({ deletedAt: now })
    .where(and(eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt)));
  await Promise.all(active.map((j) => safeCancel(j.provider, j.id)));
  await getStorage().removeUserPrefix(userId);
  return getAvatarState(userId);
}
