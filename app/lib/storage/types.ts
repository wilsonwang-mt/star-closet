export type StoredObject = { bytes: Uint8Array; contentType: string };

export interface StorageDriver {
  kind: "local" | "supabase";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** 不存在时返回 null。 */
  get(key: string): Promise<StoredObject | null>;
  /** 删除若干对象；不存在的 key 忽略。 */
  remove(keys: string[]): Promise<void>;
  /** 删除某个用户前缀下的全部对象（`<userId>/`）。 */
  removeUserPrefix(userId: string): Promise<void>;
  /** 生成短时签名 URL（只有 Supabase 驱动支持；本地驱动返回 null）。仅用于把照片交给已获同意的第三方生成服务。 */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}

// key 只允许 `<userId>/(photos|avatars)/<文件名>`，拒绝 `..`、绝对路径与其他字符。
const KEY_RE = /^[A-Za-z0-9_-]{1,64}\/(photos|avatars)\/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{2,5}$/;
const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function assertKey(key: string): string {
  if (!isValidKey(key)) throw new Error("invalid storage key");
  return key;
}

export function assertUserId(userId: string): string {
  if (!USER_RE.test(userId)) throw new Error("invalid user id");
  return userId;
}
