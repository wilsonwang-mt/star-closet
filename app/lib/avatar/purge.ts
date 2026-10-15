import { and, eq, inArray, isNotNull, isNull, like, lt, or, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { purgeRemoteRequest, type RemotePurge } from "./providers";

// 保留与删除（D47）：
// - 原始照片：对应 3D 形象生成成功时写入 expires_at = 成功时间 + 30 天；到期后删除存储文件并软删除记录。
//   执行方式两种：打开 /profile/avatar 时对本人惰性清理；以及 `npm run avatar:purge`（scripts/purge-avatars.ts）
//   对全部用户清理，可由 cron 等定时任务每天调用。
// - 第三方副本：真实服务的任务结束后请求 fal 删除 payload 与输出。结果写回 avatar_job.provider_status_url
//   （任务结束后状态地址不再需要），格式 `remote-purge:<sent|failed|pending>:<ISO 时间>`；
//   failed / pending 由 avatar:purge 重试。

export const PHOTO_RETENTION_DAYS = 30;
const DAY_MS = 86400_000;
const REMOTE_MARK = "remote-purge:";

export function remoteMark(state: Exclude<RemotePurge, "skipped">, at = new Date()) {
  return `${REMOTE_MARK}${state}:${at.toISOString()}`;
}

/** 从 provider_status_url 读出第三方删除状态；仍是状态地址或为空时返回 null。 */
export function remoteState(statusUrl: string | null): Exclude<RemotePurge, "skipped"> | null {
  if (!statusUrl?.startsWith(REMOTE_MARK)) return null;
  const s = statusUrl.slice(REMOTE_MARK.length).split(":")[0];
  return s === "sent" || s === "failed" || s === "pending" ? s : null;
}

/** 仍是可轮询的外部任务状态地址（不是删除标记）。 */
export function isLiveStatusUrl(statusUrl: string | null): statusUrl is string {
  return !!statusUrl && statusUrl.startsWith("https://");
}

type RemoteJob = { id: string; provider: string; providerTaskId: string | null; providerStatusUrl: string | null };

/** 请求第三方删除某个任务的副本并记录结果。已发送过的不重复发送；未使用第三方时返回 skipped，不访问网络。 */
export async function purgeRemoteForJob(job: RemoteJob): Promise<RemotePurge> {
  if (job.provider === "mock" || !job.providerTaskId) return "skipped";
  if (remoteState(job.providerStatusUrl) === "sent") return "sent";
  const state = await purgeRemoteRequest(job.provider, job.providerTaskId);
  if (state !== "skipped") {
    await db.update(schema.avatarJob).set({ providerStatusUrl: remoteMark(state) }).where(eq(schema.avatarJob.id, job.id));
  }
  return state;
}

/** 生成成功时给本次使用的照片写入清理期限；已有期限的不延后（以最早一次生成为准）。 */
export async function setPhotoExpiry(userId: string, photoIds: string[], succeededAt: Date) {
  if (!photoIds.length) return;
  await db
    .update(schema.avatarPhoto)
    .set({ expiresAt: new Date(succeededAt.getTime() + PHOTO_RETENTION_DAYS * DAY_MS) })
    .where(
      and(
        eq(schema.avatarPhoto.userId, userId),
        inArray(schema.avatarPhoto.id, photoIds),
        isNull(schema.avatarPhoto.expiresAt),
        isNull(schema.avatarPhoto.deletedAt),
      ),
    );
}

const scope = (col: typeof schema.avatarPhoto.userId | typeof schema.avatarJob.userId, userId?: string): SQL | undefined =>
  userId ? eq(col, userId) : undefined;

/**
 * 删除到期照片（存储文件 + 软删除记录）。userId 为空时处理全部用户。
 * 兼容旧数据：expires_at 为空、但已被某次成功生成使用过的照片，按该作业的完成时间补写期限。
 */
export async function purgeExpiredPhotos(opts: { userId?: string; now?: Date } = {}): Promise<{ photos: number }> {
  const now = opts.now ?? new Date();

  const succeeded = await db
    .select({ userId: schema.avatarJob.userId, ids: schema.avatarJob.inputPhotoIds, at: schema.avatarJob.updatedAt })
    .from(schema.avatarJob)
    .where(and(scope(schema.avatarJob.userId, opts.userId), eq(schema.avatarJob.status, "succeeded")));
  const earliest = new Map<string, { userId: string; at: Date }>();
  for (const j of succeeded) {
    for (const id of j.ids ?? []) {
      const prev = earliest.get(id);
      if (!prev || j.at < prev.at) earliest.set(id, { userId: j.userId, at: j.at });
    }
  }
  if (earliest.size) {
    const missing = await db
      .select({ id: schema.avatarPhoto.id })
      .from(schema.avatarPhoto)
      .where(
        and(
          scope(schema.avatarPhoto.userId, opts.userId),
          inArray(schema.avatarPhoto.id, [...earliest.keys()]),
          isNull(schema.avatarPhoto.expiresAt),
          isNull(schema.avatarPhoto.deletedAt),
        ),
      );
    for (const { id } of missing) {
      const e = earliest.get(id)!;
      await setPhotoExpiry(e.userId, [id], e.at);
    }
  }

  const expired = await db
    .select({ id: schema.avatarPhoto.id, key: schema.avatarPhoto.storageKey })
    .from(schema.avatarPhoto)
    .where(
      and(
        scope(schema.avatarPhoto.userId, opts.userId),
        isNull(schema.avatarPhoto.deletedAt),
        isNotNull(schema.avatarPhoto.expiresAt),
        lt(schema.avatarPhoto.expiresAt, now),
      ),
    );
  if (!expired.length) return { photos: 0 };
  const storage = getStorage();
  for (let i = 0; i < expired.length; i += 100) {
    const batch = expired.slice(i, i + 100);
    // 先删文件再标记：文件删除失败时记录保持未删除，下次重试。
    await storage.remove(batch.map((r) => r.key));
    await db
      .update(schema.avatarPhoto)
      .set({ deletedAt: now })
      .where(inArray(schema.avatarPhoto.id, batch.map((r) => r.id)));
  }
  return { photos: expired.length };
}

/** 重试第三方副本删除（failed / pending）。没有配置 FAL_KEY 时不访问网络，只返回待处理数。 */
export async function retryRemotePurges(): Promise<{ sent: number; failed: number; pending: number; skipped: number }> {
  const rows = await db
    .select({
      id: schema.avatarJob.id,
      provider: schema.avatarJob.provider,
      providerTaskId: schema.avatarJob.providerTaskId,
      providerStatusUrl: schema.avatarJob.providerStatusUrl,
    })
    .from(schema.avatarJob)
    .where(
      and(
        eq(schema.avatarJob.provider, "tripo_fal"),
        isNotNull(schema.avatarJob.providerTaskId),
        or(like(schema.avatarJob.providerStatusUrl, `${REMOTE_MARK}failed:%`), like(schema.avatarJob.providerStatusUrl, `${REMOTE_MARK}pending:%`)),
      ),
    );
  const out = { sent: 0, failed: 0, pending: 0, skipped: 0 };
  if (!process.env.FAL_KEY) {
    out.skipped = rows.length;
    return out;
  }
  for (const r of rows) {
    const s = await purgeRemoteForJob(r);
    if (s !== "skipped") out[s]++;
  }
  return out;
}
