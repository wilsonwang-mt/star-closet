import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import * as realTwin from "@/lib/avatar/twin";

// 试穿与上身效果的“底图”（D63）：优先用数字分身的正面标准形象照；没有分身时退回本人正面全身照（avatar_photo.slot = front）。
// 身份参考（多张，更像本人）：分身正面 + 正脸 + 侧脸（getIdentityRefs，最多 4 张）；没有分身时退回底图一张。
// 数字分身由 lib/avatar/twin.ts 提供（feat/digital-twin）；这里只按契约调用，任何异常都按“没有分身”处理，不影响退回正面照。

type TwinApi = Pick<typeof realTwin, "getTwin" | "readTwinImageDataUri" | "getIdentityRefs">;
let twinApi: TwinApi = realTwin;

/** 仅供单元测试替换数字分身实现；传 null 恢复真实实现。 */
export function __setTwinApiForTests(api: TwinApi | null) {
  twinApi = api ?? realTwin;
}

export const fileUrl = (key: string) => `/api/avatar/files/${key.split("/").map(encodeURIComponent).join("/")}`;

/** 本人正面照；已过 30 天期限（尚未被清理流程删除）的不再使用。 */
export async function frontPhoto(userId: string) {
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

/** 私有存储里的图片交给 fal：Supabase 私有桶生成 15 分钟签名 URL；本地存储没有公开地址，改用 data URI。文件不存在时返回 null。 */
export async function storedImage(key: string, mime?: string): Promise<string | null> {
  const storage = getStorage();
  const signed = await storage.signedUrl(key, 900).catch(() => null);
  if (signed) return signed;
  const obj = await storage.get(key).catch(() => null);
  if (!obj) return null;
  return `data:${mime ?? obj.contentType};base64,${Buffer.from(obj.bytes).toString("base64")}`;
}

/** 本人的数字分身（有正面照的才算）；未接入或出错时为 null。 */
export async function findTwin(userId: string) {
  try {
    const twin = await twinApi.getTwin(userId);
    return twin?.images?.front ? twin : null;
  } catch {
    return null;
  }
}

export type BaseSource = "twin" | "photo";

/** 试穿底图（给 fal 的 data URI / 签名 URL）：分身正面照优先，否则正面全身照；都没有时为 null。 */
export async function resolveBase(userId: string): Promise<{ image: string; source: BaseSource } | null> {
  const twin = await findTwin(userId);
  if (twin) {
    const image = await twinApi.readTwinImageDataUri(twin.images.front).catch(() => null);
    if (image) return { image, source: "twin" };
  }
  const photo = await frontPhoto(userId);
  if (!photo) return null;
  const image = await storedImage(photo.storageKey, photo.mime);
  return image ? { image, source: "photo" } : null;
}

/** 界面展示用的底图地址（鉴权读取，他人 404）。 */
export async function baseInfo(userId: string): Promise<{ url: string | null; source: BaseSource | null }> {
  const twin = await findTwin(userId);
  if (twin) return { url: fileUrl(twin.images.front), source: "twin" };
  const photo = await frontPhoto(userId);
  return photo ? { url: fileUrl(photo.storageKey), source: "photo" } : { url: null, source: null };
}

/** nano 试穿的补充参考：分身的正脸（getIdentityRefs 第 2 张，契约顺序为 正面 / 正脸 / 侧脸）与性别；没有分身时都为空。 */
export async function identityExtras(userId: string): Promise<{ face: string | null; gender: "female" | "male" | null }> {
  const twin = await findTwin(userId);
  if (!twin) return { face: null, gender: null };
  const refs = await twinApi.getIdentityRefs(userId).catch(() => [] as string[]);
  const face = typeof refs?.[1] === "string" && refs[1] ? refs[1] : null;
  return { face, gender: twin.gender ?? null };
}

/** 身份参考图：分身的多张参考（最多 4 张）；没有分身时退回底图一张；都没有时为空数组。 */
export async function identityRefs(userId: string): Promise<string[]> {
  const refs = await twinApi.getIdentityRefs(userId).catch(() => [] as string[]);
  const usable = (refs ?? []).filter((r) => typeof r === "string" && r.length > 0).slice(0, 4);
  if (usable.length) return usable;
  const base = await resolveBase(userId);
  return base ? [base.image] : [];
}
