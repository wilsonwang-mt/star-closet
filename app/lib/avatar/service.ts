import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { avatarKey, getStorage, photoKey } from "@/lib/storage";
import { MAX_PHOTO_BYTES, QUALITY_HINTS, qualityFlags, sniffImage, type QualityFlags } from "./image";
import {
  BODY_ANALYSIS_NAME,
  bodyAnalysisOffered,
  consentVersionFor,
  getProvider,
  hasRequiredSlots,
  offerVersion,
  parseConsentVersion,
  ProviderError,
  providerForConsent,
  providerInfo,
  requiredSlotsMessage,
  thirdPartyInfo,
  type ErrorCode,
  type ProviderHandle,
  type ProviderId,
  type RemotePurge,
} from "./providers";
import {
  isLiveStatusUrl,
  PHOTO_RETENTION_DAYS,
  purgeExpiredPhotos,
  purgeRemoteForJob,
  remoteState,
  setPhotoExpiry,
} from "./purge";
import { checkAvatarCode, downloadExport, metapersonEnabled } from "./metaperson";
import { currentBodyAnalysis, type BodyAnalysisView } from "./body";
import { stripMetadata } from "./strip";
import { deleteAllTryons } from "@/lib/tryon/service";

// 3D 形象：同意 → 上传照片 → 生成（draft → queued → processing → succeeded / failed，可 canceled）→ 查看 → 删除。
// 所有函数都以当前登录用户 userId 为界，只读写本人数据。
// 作业推进由 GET /api/avatar/jobs/[id] 轮询驱动（tick），并用带条件的 UPDATE 防止并发轮询重复提交。
// 外部任务句柄存在 avatar_job.provider_task_id / provider_status_url，进程重启后可继续轮询；
// 任务结束后 provider_status_url 改写为第三方删除标记（见 purge.ts）。

export { PHOTO_RETENTION_DAYS };
export const SLOTS = ["front", "side", "back", "face", "extra"] as const;
export type Slot = (typeof SLOTS)[number];
/** 现在接受上传的位置：只收生成会用到的三张全身照。面部特写与补充照片不参与生成，不再收集（旧照片仍可查看与删除）。 */
export const UPLOAD_SLOTS = ["front", "side", "back"] as const;
/** MetaPerson 模式收的照片（D56）：正脸自拍（必传，用于建脸）、全身正面（必传，同时作为 2D 试穿的正面照）、全身侧面（选传）。 */
export const MP_UPLOAD_SLOTS = ["face", "front", "side"] as const;
/** 当前模式接受上传的位置。 */
export function uploadSlotsFor(metaperson: boolean): readonly Slot[] {
  return metaperson ? MP_UPLOAD_SLOTS : UPLOAD_SLOTS;
}
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
  /** 到期删除时间（生成成功后写入），未生成过为 null */
  expiresAt: string | null;
};

export type JobView = {
  id: string;
  status: JobStatus;
  provider: string;
  isMock: boolean;
  glbUrl: string | null;
  /** 生成成功但形象已被用户删除（照片保留） */
  resultDeleted: boolean;
  fidelityNote: string | null;
  badges: string[];
  error: { code: string; message: string } | null;
  /** 第三方副本删除状态；未使用第三方服务为 null */
  remotePurge: Exclude<RemotePurge, "skipped"> | null;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type ProviderView = { id: ProviderId; isMock: boolean; name: string; processor: string };

export type AvatarState = {
  /** photos：上传三张全身照由服务端生成（mock / tripo_fal）；metaperson：在嵌入的 MetaPerson 创建器里用自拍生成。 */
  mode: "photos" | "metaperson";
  /** 同意卡：offerVersion 用来确认用户看到的卡片没有过期；thirdParty 为 null 时不显示第二项。 */
  offer: { version: string; thirdParty: ProviderView | null; bodyAnalysis: { name: string } | null };
  /** 按用户同意实际使用的服务 */
  provider: ProviderView;
  consent: { version: string; at: string; current: boolean; thirdParty: ProviderId | null; bodyAnalysis: boolean } | null;
  photos: PhotoView[];
  job: JobView | null;
  canGenerate: boolean;
  retentionDays: number;
  /** 当前全身照的体型分析（D56）；照片换了或没有分析为 null */
  bodyAnalysis: BodyAnalysisView | null;
};

export type RemoteSummary = { sent: number; failed: number; pending: number };

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
  return isMock ? ["演示模型"] : [];
}

function parseError(e: string | null): JobView["error"] {
  if (!e) return null;
  const i = e.indexOf("|");
  return i < 0 ? { code: "PROVIDER_FAILED", message: e } : { code: e.slice(0, i), message: e.slice(i + 1) };
}

type JobRow = typeof schema.avatarJob.$inferSelect;
type PhotoRow = typeof schema.avatarPhoto.$inferSelect;

const view = (p: { id: ProviderId; isMock: boolean; name: string; processor: string }): ProviderView => ({
  id: p.id,
  isMock: p.isMock,
  name: p.name,
  processor: p.processor,
});

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
    resultDeleted: j.status === "succeeded" && !j.resultGlbKey,
    fidelityNote: j.fidelityNote,
    badges: badgesFor(isMock),
    error: j.status === "failed" ? parseError(j.error) : null,
    // MetaPerson 的远端删除接口未实测，结果只记日志，不在界面显示。
    remotePurge: isMock || j.provider === "metaperson" ? null : remoteState(j.providerStatusUrl),
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
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
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

function consentOf(jobs: JobRow[]): AvatarState["consent"] {
  const j = jobs.find((x) => x.consentVersion && x.consentAt);
  if (!j || !j.consentVersion || !j.consentAt) return null;
  const parsed = parseConsentVersion(j.consentVersion);
  return {
    version: j.consentVersion,
    at: j.consentAt.toISOString(),
    current: !!parsed,
    thirdParty: parsed?.thirdParty ?? null,
    bodyAnalysis: parsed?.bodyAnalysis ?? false,
  };
}

function offer(): AvatarState["offer"] {
  const tp = thirdPartyInfo();
  return { version: offerVersion(), thirdParty: tp ? view(tp) : null, bodyAnalysis: bodyAnalysisOffered() ? { name: BODY_ANALYSIS_NAME } : null };
}

export async function getAvatarState(userId: string): Promise<AvatarState> {
  // D47：到期照片在打开页面时惰性清理；另有 npm run avatar:purge 供定时任务调用。
  await purgeExpiredPhotos({ userId });
  const [photos, jobs] = await Promise.all([livePhotos(userId), latestJobs(userId)]);
  const consent = consentOf(jobs);
  const provider = providerForConsent(consent?.current ? consent.thirdParty : null);
  const job = jobs.find((j) => j.status !== "draft");
  return {
    mode: metapersonEnabled() ? "metaperson" : "photos",
    offer: offer(),
    provider: view(provider),
    consent,
    photos: photos.map(toPhotoView),
    job: job ? toJobView(job) : null,
    canGenerate: !!consent?.current && provider.id !== "metaperson" && hasRequiredSlots(provider.id, photos),
    retentionDays: PHOTO_RETENTION_DAYS,
    bodyAnalysis: consent?.current && consent.bodyAnalysis ? currentBodyAnalysis(photos) : null,
  };
}

async function requireConsent(userId: string) {
  const jobs = await latestJobs(userId);
  const consent = consentOf(jobs);
  if (!consent?.current) throw new AvatarError(403, "请先阅读并勾选同意，再上传照片");
  return { jobs, consent, provider: providerForConsent(consent.thirdParty) };
}

/**
 * 记录同意。store（保存照片）必选；thirdParty（发送给第三方服务）只有在配置了真实服务时才可勾选。
 * offerVersion 必须与当前同意卡一致，防止用户看到的是旧的“谁处理”说明。
 */
export async function recordConsent(
  userId: string,
  input: { store: boolean; thirdParty: boolean; offerVersion: unknown; bodyAnalysis?: boolean },
) {
  if (!input.store) throw new AvatarError(400, "需要勾选同意保存照片");
  if (input.offerVersion !== offerVersion()) throw new AvatarError(409, "处理方已变更，请刷新页面重新阅读说明");
  const tp = thirdPartyInfo();
  if (input.thirdParty && !tp) throw new AvatarError(409, "第三方生成服务未启用，请刷新页面");
  if (input.bodyAnalysis && !bodyAnalysisOffered()) throw new AvatarError(409, "体型分析未启用，请刷新页面");
  const version = consentVersionFor(input.thirdParty && tp ? tp.id : null, !!input.bodyAnalysis);
  const provider = providerForConsent(input.thirdParty && tp ? tp.id : null);
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
      .set({ consentVersion: version, consentAt: now, provider: provider.id, createdAt: now, updatedAt: now })
      .where(eq(schema.avatarJob.id, draft.id));
  } else {
    await db.insert(schema.avatarJob).values({
      id: crypto.randomUUID(),
      userId,
      status: "draft",
      provider: provider.id,
      consentVersion: version,
      consentAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return getAvatarState(userId);
}

export async function addPhoto(userId: string, slot: string, file: File) {
  if (!(SLOTS as readonly string[]).includes(slot)) throw new AvatarError(400, "照片位置不对");
  const mpMode = metapersonEnabled();
  if (!(uploadSlotsFor(mpMode) as readonly string[]).includes(slot)) {
    throw new AvatarError(400, mpMode ? "只收正脸自拍、全身正面与全身侧面照" : "面部特写与补充照片不参与生成，已不再收集");
  }
  if (file.size > MAX_PHOTO_BYTES) throw new AvatarError(413, "单张照片不能超过 8MB");
  if (file.size === 0) throw new AvatarError(400, "照片是空文件");
  // MetaPerson 模式：照片用于生成本人形象，须已单独同意由 MetaPerson 处理（D47）。
  if (mpMode) await requireMetapersonConsent(userId);
  else await requireConsent(userId);

  const raw = new Uint8Array(await file.arrayBuffer());
  if (raw.byteLength > MAX_PHOTO_BYTES) throw new AvatarError(413, "单张照片不能超过 8MB");
  // 服务端再剥一次元数据（EXIF 含 GPS、XMP 等）：浏览器压缩已去掉，但不能依赖客户端。
  const stripped = stripMetadata(raw);
  if (!stripped) throw new AvatarError(415, "只支持 JPG、PNG、WebP 图片");
  const bytes = stripped.bytes;
  const info = sniffImage(bytes);
  if (!info) throw new AvatarError(415, "只支持 JPG、PNG、WebP 图片");
  if (info.width < 64 || info.height < 64 || info.width > 10000 || info.height > 10000) {
    throw new AvatarError(400, "图片尺寸不对");
  }

  const live = await livePhotos(userId);
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
      // D47/D56：MetaPerson 模式没有服务端生成任务，照片自上传起保留 30 天。
      ...(mpMode ? { expiresAt: new Date(Date.now() + PHOTO_RETENTION_DAYS * 86400_000) } : {}),
    });
  } catch (e) {
    await storage.remove([key]).catch(() => {});
    throw e;
  }
  // 每个位置只保留一张：替换掉旧照片并删除旧文件。
  const old = live.filter((p) => p.slot === slot);
  if (old.length) {
    await storage.remove(old.map((p) => p.storageKey));
    await db
      .update(schema.avatarPhoto)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.avatarPhoto.userId, userId), inArray(schema.avatarPhoto.id, old.map((p) => p.id))));
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
  const { jobs, consent, provider } = await requireConsent(userId);
  if (provider.id === "metaperson") throw new AvatarError(400, "请在 MetaPerson 创建器中生成形象");
  const active = jobs.find((j) => j.status === "queued" || j.status === "processing");
  if (active) throw new AvatarError(409, "已有一个正在生成的任务");
  const photos = (await livePhotos(userId)).filter((p) => (UPLOAD_SLOTS as readonly string[]).includes(p.slot));
  if (!hasRequiredSlots(provider.id, photos)) throw new AvatarError(400, requiredSlotsMessage(provider.id));

  const now = new Date();
  const values = {
    status: "queued" as const,
    provider: provider.id,
    inputPhotoIds: photos.map((p) => p.id),
    consentVersion: consent.version,
    consentAt: new Date(consent.at),
    error: null,
    providerTaskId: null,
    providerStatusUrl: null,
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

function handleOf(j: JobRow): ProviderHandle | null {
  return j.providerTaskId && isLiveStatusUrl(j.providerStatusUrl) ? { taskId: j.providerTaskId, statusUrl: j.providerStatusUrl } : null;
}

/** 新形象生成成功后，清理本人其他作业留下的旧 GLB（照片不动）。 */
async function removeOlderResults(userId: string, keepJobId: string) {
  const older = await db
    .select({ id: schema.avatarJob.id, key: schema.avatarJob.resultGlbKey })
    .from(schema.avatarJob)
    .where(and(eq(schema.avatarJob.userId, userId), ne(schema.avatarJob.id, keepJobId), isNotNull(schema.avatarJob.resultGlbKey)));
  if (!older.length) return;
  await getStorage().remove(older.map((o) => o.key!));
  await db
    .update(schema.avatarJob)
    .set({ resultGlbKey: null, resultPreviewKey: null })
    .where(inArray(schema.avatarJob.id, older.map((o) => o.id)));
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
          const handle = await provider.submit(won.id, photos.map((p) => ({ slot: p.slot, storageKey: p.storageKey, mime: p.mime })));
          if (handle) {
            // 持久化外部任务句柄；不改 updated_at（它是超时计时起点）。
            await db
              .update(schema.avatarJob)
              .set({ providerTaskId: handle.taskId, providerStatusUrl: handle.statusUrl })
              .where(eq(schema.avatarJob.id, won.id));
          }
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
      const r = await provider.poll(job.id, handleOf(job), job.updatedAt).catch(
        () => ({ state: "failed", code: "PROVIDER_FAILED", message: "查询生成进度失败" }) as const,
      );
      if (r.state === "failed") {
        await failJob(job.id, r.code, r.message);
        await purgeRemoteForJob(job);
      } else if (r.state === "succeeded") {
        const key = avatarKey(userId, job.id);
        const storage = getStorage();
        await storage.put(key, r.glb, "model/gltf-binary");
        const now = new Date();
        const [done] = await db
          .update(schema.avatarJob)
          .set({ status: "succeeded", resultGlbKey: key, fidelityNote: provider.info.fidelityNote, error: null, updatedAt: now })
          .where(and(eq(schema.avatarJob.id, job.id), eq(schema.avatarJob.status, "processing")))
          .returning();
        if (done) {
          // D47：原始照片自生成成功起保留 30 天。对本人全部在用照片生效：
          // 以前上传、不参与生成的面部特写与补充照片也随之到期，不会无限期保留。
          const all = await livePhotos(userId);
          await setPhotoExpiry(userId, all.map((p) => p.id), now);
          await removeOlderResults(userId, done.id);
        } else {
          // 期间被取消或删除：丢弃结果文件。
          await storage.remove([key]).catch(() => {});
        }
        // GLB 已转存到本站：请求第三方删除该任务的 payload 与输出（mock 不访问网络）。
        await purgeRemoteForJob(job);
      }
    }
  } finally {
    inflight.delete(job.id);
  }
  const fresh = await getOwnJob(userId, jobId);
  return fresh ? toJobView(fresh) : null;
}

async function safeCancel(j: JobRow) {
  try {
    await getProvider(j.provider).cancel(j.id, handleOf(j));
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
    await safeCancel(job);
    // 任务可能尚未在第三方结束：删除请求返回 pending，由 avatar:purge 重试。
    await purgeRemoteForJob(job);
  }
  const fresh = await getOwnJob(userId, jobId);
  return fresh ? toJobView(fresh) : null;
}

/** 删除单个已生成的形象（GLB 文件），保留照片与同意；同时再次请求第三方删除副本。 */
export async function deleteResult(userId: string, jobId: string): Promise<{ job: JobView; remotePurge: RemotePurge }> {
  const job = await getOwnJob(userId, jobId);
  if (!job || job.status !== "succeeded") throw new AvatarError(404, "形象不存在");
  if (job.resultGlbKey) await getStorage().remove([job.resultGlbKey]);
  await db
    .update(schema.avatarJob)
    .set({ resultGlbKey: null, resultPreviewKey: null, updatedAt: new Date() })
    .where(eq(schema.avatarJob.id, job.id));
  const purged = await purgeRemoteForJob(job);
  const remotePurge = job.provider === "metaperson" ? "skipped" : purged;
  return { job: toJobView((await getOwnJob(userId, jobId))!), remotePurge };
}

/** 一键删除：全部照片与生成结果（含存储文件），作业标记 canceled，同意随之失效；并请求第三方删除副本。 */
export async function deleteAll(userId: string): Promise<AvatarState & { remotePurge: RemoteSummary }> {
  const jobs = await db.select().from(schema.avatarJob).where(eq(schema.avatarJob.userId, userId));
  const active = jobs.filter((j) => j.status === "queued" || j.status === "processing");
  const now = new Date();
  await db
    .update(schema.avatarJob)
    .set({ status: "canceled", error: DELETED_MARK, resultGlbKey: null, resultPreviewKey: null, updatedAt: now })
    .where(eq(schema.avatarJob.userId, userId));
  await db
    .update(schema.avatarPhoto)
    .set({ deletedAt: now })
    .where(and(eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt)));
  await Promise.all(active.map(safeCancel));
  // 试穿结果图由本人照片生成，一键删除时一并删除记录、结果图与试穿同意（D47）。
  await deleteAllTryons(userId);
  await getStorage().removeUserPrefix(userId);
  const summary: RemoteSummary = { sent: 0, failed: 0, pending: 0 };
  for (const j of jobs) {
    const s = await purgeRemoteForJob(j);
    // MetaPerson 远端删除失败只记日志（接口未实测），不计入界面提示。
    if (s !== "skipped" && j.provider !== "metaperson") summary[s]++;
  }
  return { ...(await getAvatarState(userId)), remotePurge: summary };
}

/** MetaPerson 模式下的同意检查：必须已单独同意发送给 MetaPerson，且服务仍已配置。 */
export async function requireMetapersonConsent(userId: string) {
  if (!metapersonEnabled()) throw new AvatarError(409, "MetaPerson 未启用，请刷新页面");
  const r = await requireConsent(userId);
  if (r.consent.thirdParty !== "metaperson") throw new AvatarError(403, "请先勾选同意由 MetaPerson 生成形象");
  return r;
}

/**
 * 导入 MetaPerson 导出的形象：服务端立即下载（https + 主机白名单 + 100MB + GLB 头校验），
 * 存入 <userId>/avatars/<jobId>.glb，写入 succeeded 作业（provider metaperson，provider_task_id = avatarCode），
 * 然后清理本人旧的 GLB。
 */
export async function importMetaperson(userId: string, input: { url: unknown; avatarCode: unknown }): Promise<AvatarState> {
  const { consent } = await requireMetapersonConsent(userId);
  const avatarCode = checkAvatarCode(input.avatarCode);
  const glb = await downloadExport(input.url);
  const id = crypto.randomUUID();
  const key = avatarKey(userId, id);
  const storage = getStorage();
  await storage.put(key, glb, "model/gltf-binary");
  const now = new Date();
  try {
    await db.insert(schema.avatarJob).values({
      id,
      userId,
      status: "succeeded",
      provider: "metaperson",
      consentVersion: consent.version,
      consentAt: new Date(consent.at),
      resultGlbKey: key,
      fidelityNote: providerInfo("metaperson")!.fidelityNote,
      providerTaskId: avatarCode,
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    await storage.remove([key]).catch(() => {});
    throw e;
  }
  await removeOlderResults(userId, id);
  // D47：在用照片（含试穿卡上传的正面照）自生成成功起最多保留 30 天；已有期限不延后。
  await setPhotoExpiry(userId, (await livePhotos(userId)).map((p) => p.id), now);
  return getAvatarState(userId);
}
