import { assertKey, assertUserId, type StorageDriver } from "./types";

// Supabase Storage 驱动：私有桶 avatar-private（建桶与说明见 supabase/storage.sql）。
// 用 service role key 在服务端直接调用 Storage REST API，不引入 supabase-js；
// service role key 只在服务端读取，不下发到浏览器，也不写进日志。
export const BUCKET = "avatar-private";

export function supabaseDriver(baseUrl: string, serviceKey: string): StorageDriver {
  const api = `${baseUrl.replace(/\/+$/, "")}/storage/v1`;
  const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
  const objectUrl = (key: string) =>
    `${api}/object/${BUCKET}/${assertKey(key).split("/").map(encodeURIComponent).join("/")}`;

  async function fail(op: string, res: Response): Promise<never> {
    // 只带状态码，不回显响应体，避免把内部信息带进日志或前端。
    throw new Error(`supabase storage ${op} failed: ${res.status}`);
  }

  async function list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const res = await fetch(`${api}/object/list/${BUCKET}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 100, offset }),
        cache: "no-store",
      });
      if (!res.ok) await fail("list", res);
      const rows = (await res.json()) as { name: string; id: string | null }[];
      for (const r of rows) if (r.id) out.push(`${prefix}/${r.name}`);
      if (rows.length < 100) return out;
    }
  }

  const driver: StorageDriver = {
    kind: "supabase",
    async put(key, bytes, contentType) {
      const res = await fetch(objectUrl(key), {
        method: "POST",
        headers: { ...auth, "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "no-store" },
        body: Buffer.from(bytes),
        cache: "no-store",
      });
      if (!res.ok) await fail("put", res);
    },
    async get(key) {
      const res = await fetch(objectUrl(key), { headers: auth, cache: "no-store" });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) await fail("get", res);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },
    async remove(keys) {
      if (!keys.length) return;
      keys.forEach(assertKey);
      const res = await fetch(`${api}/object/${BUCKET}`, {
        method: "DELETE",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: keys }),
        cache: "no-store",
      });
      if (!res.ok) await fail("remove", res);
    },
    async removeUserPrefix(userId) {
      assertUserId(userId);
      const keys = [...(await list(`${userId}/photos`)), ...(await list(`${userId}/avatars`))];
      for (let i = 0; i < keys.length; i += 100) await driver.remove(keys.slice(i, i + 100));
    },
    async signedUrl(key, expiresInSeconds) {
      const res = await fetch(`${api}/object/sign/${BUCKET}/${assertKey(key).split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
        cache: "no-store",
      });
      if (!res.ok) await fail("sign", res);
      const { signedURL } = (await res.json()) as { signedURL: string };
      return `${baseUrl.replace(/\/+$/, "")}/storage/v1${signedURL}`;
    },
  };
  return driver;
}
