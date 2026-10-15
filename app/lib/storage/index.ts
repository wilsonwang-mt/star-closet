import { localDriver } from "./local";
import { supabaseDriver } from "./supabase";
import type { StorageDriver } from "./types";

export type { StorageDriver, StoredObject } from "./types";
export { assertKey, isValidKey } from "./types";

// 私有文件存储（用户照片、生成的 3D 形象）。只在服务端使用：
// - 设置了 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY：Supabase Storage 私有桶 avatar-private（见 supabase/storage.sql）。
// - 否则：本地 app/.data/uploads/（已被 .gitignore 忽略，不进仓库）。
// 对象 key 统一为 `<userId>/photos/<file>` 或 `<userId>/avatars/<file>`，按用户前缀隔离；
// 浏览器只能经 /api/avatar/files/<key> 在校验登录且前缀属于本人后读取，不生成公开链接。

const globalForStorage = globalThis as unknown as { scStorage?: StorageDriver };

export function getStorage(): StorageDriver {
  if (!globalForStorage.scStorage) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    globalForStorage.scStorage = url && key ? supabaseDriver(url, key) : localDriver();
  }
  return globalForStorage.scStorage;
}

export function photoKey(userId: string, id: string, ext: string) {
  return `${userId}/photos/${id}.${ext}`;
}

export function avatarKey(userId: string, jobId: string, ext = "glb") {
  return `${userId}/avatars/${jobId}.${ext}`;
}
