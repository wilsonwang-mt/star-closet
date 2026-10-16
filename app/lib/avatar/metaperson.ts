import { isGlb } from "./mannequin";
import { AVATAR_CODE_RE } from "./metaperson-protocol";

// MetaPerson（Avatar SDK）服务端部分：只在服务端使用，clientSecret 永远不出服务端。
// 启用条件：AVATAR3D_PROVIDER=metaperson 且 AVATARSDK_CLIENT_ID、AVATARSDK_CLIENT_SECRET 都存在。
// - 令牌：POST https://api.avatarsdk.com/o/token/（Basic auth，grant_type=client_credentials），缓存到过期前 60 秒。
// - 导出文件：浏览器从创建器拿到导出地址后交给服务端，服务端校验 https + 主机白名单后立即下载、校验 GLB 头，转存私有存储。
// - 远端删除：DELETE https://api.avatarsdk.com/avatars/<avatarCode>/（Bearer）。该接口对 MetaPerson Creator 生成的形象是否生效未实测。

export const MP_TOKEN_URL = "https://api.avatarsdk.com/o/token/";
export const MP_API_BASE = "https://api.avatarsdk.com";
export const MP_DEFAULT_HOSTS = ["avatarsdk.com"];
export const MAX_MP_GLB_BYTES = 100 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class MetapersonError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// D63 已放弃 MetaPerson：即使 AVATAR3D_PROVIDER=metaperson（例如从旧 .env.local 导入的部署环境），
// 也只有显式设置 AVATAR3D_ALLOW_METAPERSON=1 时才启用，否则走数字分身（twinEnabled）。
export function metapersonEnabled(): boolean {
  return (
    process.env.AVATAR3D_PROVIDER === "metaperson" &&
    process.env.AVATAR3D_ALLOW_METAPERSON === "1" &&
    !!process.env.AVATARSDK_CLIENT_ID &&
    !!process.env.AVATARSDK_CLIENT_SECRET
  );
}

// ---------- 令牌 ----------

type Cached = { token: string; expiresAt: number; clientId: string };
const g = globalThis as unknown as { scMpToken?: Cached | null; scMpTokenInflight?: Promise<Cached> | null };

export function resetTokenCache() {
  g.scMpToken = null;
  g.scMpTokenInflight = null;
}

async function requestToken(): Promise<Cached> {
  const id = process.env.AVATARSDK_CLIENT_ID!;
  const secret = process.env.AVATARSDK_CLIENT_SECRET!;
  const res = await fetch(MP_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    cache: "no-store",
  }).catch(() => null);
  if (!res || !res.ok) {
    // 只记录状态码，不记录响应体与凭据。
    console.warn(`[avatar] MetaPerson 令牌获取失败：${res ? `HTTP ${res.status}` : "网络错误"}`);
    throw new MetapersonError(502, "生成服务暂时不可用，请稍后再试");
  }
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  const token = typeof body?.access_token === "string" ? body.access_token : "";
  if (!token) throw new MetapersonError(502, "生成服务返回格式异常");
  const ttl = Number(body?.expires_in);
  const seconds = Number.isFinite(ttl) && ttl > 0 ? ttl : 3600;
  return { token, expiresAt: Date.now() + seconds * 1000, clientId: id };
}

/** 取访问令牌（缓存到过期前 60 秒；并发请求共用一次换取）。 */
export async function getAccessToken(): Promise<{ accessToken: string; expiresIn: number }> {
  if (!metapersonEnabled()) throw new MetapersonError(409, "生成服务未启用");
  const c = g.scMpToken;
  if (c && c.clientId === process.env.AVATARSDK_CLIENT_ID && c.expiresAt - Date.now() > 60_000) {
    return { accessToken: c.token, expiresIn: Math.floor((c.expiresAt - Date.now()) / 1000) };
  }
  g.scMpTokenInflight ??= requestToken().finally(() => {
    g.scMpTokenInflight = null;
  });
  const fresh = await g.scMpTokenInflight;
  g.scMpToken = fresh;
  return { accessToken: fresh.token, expiresIn: Math.floor((fresh.expiresAt - Date.now()) / 1000) };
}

// ---------- 导出文件下载 ----------

export function exportHosts(): string[] {
  const extra = (process.env.AVATARSDK_EXPORT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
    .filter((h) => /^[a-z0-9.-]+$/.test(h) && h.includes("."));
  return [...new Set([...MP_DEFAULT_HOSTS, ...extra])];
}

/** 主机名等于白名单项，或是其子域。 */
export function hostAllowed(hostname: string, hosts = exportHosts()): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return hosts.some((a) => h === a || h.endsWith(`.${a}`));
}

/** 校验导出地址：只允许 https、默认端口、白名单主机，不带用户名密码。不通过时抛出含主机名的明确错误。 */
export function checkExportUrl(raw: unknown): URL {
  if (typeof raw !== "string" || raw.length > 4096) throw new MetapersonError(400, "导出地址无效");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new MetapersonError(400, "导出地址无效");
  }
  if (u.protocol !== "https:") throw new MetapersonError(400, "导出地址必须是 https");
  if (u.username || u.password || (u.port && u.port !== "443")) throw new MetapersonError(400, "导出地址无效");
  if (!hostAllowed(u.hostname)) {
    throw new MetapersonError(400, `导出地址的主机 ${u.hostname} 不在白名单中（可在 AVATARSDK_EXPORT_HOSTS 中追加）`);
  }
  return u;
}

export function checkAvatarCode(code: unknown): string {
  if (typeof code !== "string" || !AVATAR_CODE_RE.test(code)) throw new MetapersonError(400, "形象编号无效");
  return code;
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > limit) throw new MetapersonError(413, "形象文件过大");
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new MetapersonError(413, "形象文件过大");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/**
 * 下载导出的 GLB。手动跟随重定向（最多 3 次），每一跳都重新校验 https 与主机白名单，
 * 防止借重定向访问内网或其他主机。限制 100MB，并校验 glTF 二进制头。
 */
export async function downloadExport(raw: unknown, limit = MAX_MP_GLB_BYTES): Promise<Uint8Array> {
  let url = checkExportUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, { redirect: "manual", cache: "no-store" }).catch(() => null);
    if (!res) throw new MetapersonError(502, "下载形象文件失败，请重试");
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop >= MAX_REDIRECTS) throw new MetapersonError(502, "下载形象文件失败（重定向过多）");
      url = checkExportUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw new MetapersonError(502, `下载形象文件失败（${res.status}）`);
    const bytes = await readLimited(res, limit);
    if (!isGlb(bytes)) throw new MetapersonError(422, "导出的文件不是 GLB 格式");
    return bytes;
  }
}

// ---------- 远端删除 ----------

/** 请求 Avatar SDK 删除远端形象。成功返回 true；失败只记日志（不含响应体），返回 false。 */
export async function deleteRemoteAvatar(avatarCode: string): Promise<boolean> {
  if (!AVATAR_CODE_RE.test(avatarCode)) return false;
  if (!process.env.AVATARSDK_CLIENT_ID || !process.env.AVATARSDK_CLIENT_SECRET) {
    console.warn("[avatar] MetaPerson 远端删除跳过：未配置 client id/secret");
    return false;
  }
  try {
    const enabled = metapersonEnabled();
    // 关闭 metaperson 模式后仍允许用已有凭据发删除请求。
    const token = enabled ? (await getAccessToken()).accessToken : (await requestToken()).token;
    const res = await fetch(`${MP_API_BASE}/avatars/${encodeURIComponent(avatarCode)}/`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => null);
    if (res && (res.ok || res.status === 404)) return true;
    console.warn(`[avatar] MetaPerson 远端删除失败：${res ? `HTTP ${res.status}` : "网络错误"}`);
    return false;
  } catch {
    console.warn("[avatar] MetaPerson 远端删除失败：令牌不可用");
    return false;
  }
}
