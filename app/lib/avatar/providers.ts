import { getStorage } from "@/lib/storage";
import { buildMannequinGlb, isGlb } from "./mannequin";

// 3D 形象生成服务适配。全部在服务端调用，浏览器永远拿不到任何 key。
// - mock（默认）：不访问任何外部网络，几秒后返回程序生成的通用人台，标注“非本人示意模型”。
// - tripo_fal：fal.ai 托管的 Tripo H3.1 Multiview-to-3D。只有 AVATAR3D_PROVIDER=tripo_fal 且设置了 FAL_KEY 才启用；
//   缺 key 时自动回落到 mock，不发起任何外部请求。
// Meshy 备选适配器比赛版未实现。

export type ProviderId = "mock" | "tripo_fal";

export type ProviderInfo = {
  id: ProviderId;
  isMock: boolean;
  /** 同意卡上“谁处理”的说明。 */
  processor: string;
  /** 同意版本：换了处理方就需要用户重新同意。 */
  consentVersion: string;
  fidelityNote: string;
};

export type ErrorCode = "NO_KEY" | "TIMEOUT" | "PROVIDER_FAILED" | "NOT_GLB" | "SAFETY_BLOCKED" | "BAD_INPUT";

export class ProviderError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type InputPhoto = { slot: string; storageKey: string; mime: string };

export type PollResult =
  | { state: "processing" }
  | { state: "succeeded"; glb: Uint8Array }
  | { state: "failed"; code: ErrorCode; message: string };

export interface Avatar3DProvider {
  info: ProviderInfo;
  submit(jobId: string, photos: InputPhoto[]): Promise<void>;
  poll(jobId: string, startedAt: Date): Promise<PollResult>;
  cancel(jobId: string): Promise<void>;
}

const INFO: Record<ProviderId, ProviderInfo> = {
  mock: {
    id: "mock",
    isMock: true,
    processor: "本站服务器（示意模式）：照片只保存在本站私有存储，不发送给任何第三方 AI 服务；生成结果是通用人台，不是你本人",
    consentVersion: "avatar-consent-v1:mock",
    fidelityNote: "示意模型，非本人：未使用照片生成，仅为通用人台。合身未验证。",
  },
  tripo_fal: {
    id: "tripo_fal",
    isMock: false,
    processor: "fal.ai 托管的 Tripo 3D 生成模型（第三方服务，位于境外）：只发送正面、侧面、背面三张全身照，面部特写与补充照片不发送",
    consentVersion: "avatar-consent-v1:tripo_fal",
    fidelityNote: "AI 根据你的照片生成的 3D 形象预览：还原外观轮廓，还原度未验证，不代表精确本人外貌或身体尺寸。合身未验证。",
  },
};

export function maxPollSeconds() {
  const n = Number(process.env.AVATAR3D_MAX_POLL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

/** 当前启用的服务：要求的服务缺 key 时回落到 mock。 */
export function activeProviderInfo(): ProviderInfo {
  const want = process.env.AVATAR3D_PROVIDER;
  if (want === "tripo_fal" && process.env.FAL_KEY) return INFO.tripo_fal;
  return INFO.mock;
}

export function providerInfo(id: string): ProviderInfo | null {
  return id === "mock" || id === "tripo_fal" ? INFO[id] : null;
}

export function getProvider(id: string): Avatar3DProvider {
  if (id === "tripo_fal") {
    if (!process.env.FAL_KEY) throw new ProviderError("NO_KEY", "生成服务未配置，请稍后重试");
    return tripoFal;
  }
  return mock;
}

// ---------- mock ----------

const MOCK_SECONDS = 3;

const mock: Avatar3DProvider = {
  info: INFO.mock,
  async submit() {},
  async poll(_jobId, startedAt) {
    if (Date.now() - startedAt.getTime() < MOCK_SECONDS * 1000) return { state: "processing" };
    return { state: "succeeded", glb: buildMannequinGlb() };
  },
  async cancel() {},
};

// ---------- tripo_fal ----------
// avatar_job 表没有 provider_task_id 列，fal 返回的 status/response/cancel URL 暂存在进程内存里；
// 进程重启后丢失，对应作业会判为失败并提示重试（集成时建议加列）。

type FalHandle = { statusUrl: string; responseUrl: string; cancelUrl: string; lastPoll: number };
const g = globalThis as unknown as { scFalHandles?: Map<string, FalHandle> };
const handles = (g.scFalHandles ??= new Map());

const FAL_ENDPOINT = "https://queue.fal.run/tripo3d/h3.1/multiview-to-3d";
const MAX_GLB_BYTES = 100 * 1024 * 1024;
// fal 要求的视角顺序：front、left、back、right；本站的“侧面”对应 left，没有 right。
const SLOT_ORDER = ["front", "side", "back"] as const;

function falHeaders() {
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" };
}

async function photoUrl(p: InputPhoto): Promise<string> {
  const storage = getStorage();
  // Supabase 私有桶：生成 15 分钟有效的签名 URL；本地存储没有可公开访问的地址，改用 data URI。
  const signed = await storage.signedUrl(p.storageKey, 900);
  if (signed) return signed;
  const obj = await storage.get(p.storageKey);
  if (!obj) throw new ProviderError("BAD_INPUT", "照片文件不存在，请重新上传");
  return `data:${p.mime};base64,${Buffer.from(obj.bytes).toString("base64")}`;
}

const isHttps = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://");

const tripoFal: Avatar3DProvider = {
  info: INFO.tripo_fal,
  async submit(jobId, photos) {
    const ordered = SLOT_ORDER.map((s) => photos.find((p) => p.slot === s)).filter((p): p is InputPhoto => !!p);
    if (!ordered.length || ordered[0].slot !== "front" || ordered.length < 2) {
      throw new ProviderError("BAD_INPUT", "需要正面全身照，以及侧面或背面全身照至少一张");
    }
    const image_urls = await Promise.all(ordered.map(photoUrl));
    const res = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: falHeaders(),
      body: JSON.stringify({
        image_urls,
        texture: true,
        pbr: true,
        texture_quality: "standard",
        geometry_quality: "standard",
        quad: false, // true 会返回 FBX
        orientation: "align_image",
        enable_safety_checker: true,
      }),
      cache: "no-store",
    }).catch(() => null);
    if (!res || !res.ok) throw new ProviderError("PROVIDER_FAILED", `生成服务暂时不可用（${res?.status ?? "网络错误"}）`);
    const body = (await res.json().catch(() => null)) as { status_url?: unknown; response_url?: unknown; cancel_url?: unknown } | null;
    if (!body || !isHttps(body.status_url) || !isHttps(body.response_url) || !isHttps(body.cancel_url)) {
      throw new ProviderError("PROVIDER_FAILED", "生成服务返回格式异常");
    }
    handles.set(jobId, { statusUrl: body.status_url, responseUrl: body.response_url, cancelUrl: body.cancel_url, lastPoll: 0 });
  },
  async poll(jobId, startedAt) {
    const h = handles.get(jobId);
    if (!h) return { state: "failed", code: "PROVIDER_FAILED", message: "服务已重启，生成进度丢失，请重试" };
    if (Date.now() - startedAt.getTime() > maxPollSeconds() * 1000) {
      await this.cancel(jobId);
      return { state: "failed", code: "TIMEOUT", message: "生成超时，请重试" };
    }
    // 前端每 2 秒轮询一次；对 fal 的状态查询至少间隔 4 秒。
    if (Date.now() - h.lastPoll < 4000) return { state: "processing" };
    h.lastPoll = Date.now();
    const st = await fetch(h.statusUrl, { headers: falHeaders(), cache: "no-store" }).catch(() => null);
    if (!st) return { state: "processing" };
    if (!st.ok && st.status !== 202) return { state: "failed", code: "PROVIDER_FAILED", message: `生成服务出错（${st.status}）` };
    const status = ((await st.json().catch(() => null)) as { status?: string } | null)?.status;
    if (status !== "COMPLETED") return { state: "processing" };

    const r = await fetch(h.responseUrl, { headers: falHeaders(), cache: "no-store" }).catch(() => null);
    handles.delete(jobId);
    if (!r || !r.ok) {
      const text = r ? await r.text().catch(() => "") : "";
      if (/safety|nsfw|content policy/i.test(text)) return { state: "failed", code: "SAFETY_BLOCKED", message: "照片未通过生成服务的安全检查" };
      return { state: "failed", code: "PROVIDER_FAILED", message: `生成失败（${r?.status ?? "网络错误"}）` };
    }
    const out = (await r.json().catch(() => null)) as { model_mesh?: { url?: unknown } } | null;
    const meshUrl = out?.model_mesh?.url;
    if (!isHttps(meshUrl)) return { state: "failed", code: "NOT_GLB", message: "生成结果缺少 3D 模型文件" };
    // fal 的媒体链接可公开访问，立即下载转存到本站私有存储。
    const dl = await fetch(meshUrl, { cache: "no-store" }).catch(() => null);
    if (!dl || !dl.ok) return { state: "failed", code: "PROVIDER_FAILED", message: "下载生成结果失败" };
    const len = Number(dl.headers.get("content-length") ?? 0);
    if (len > MAX_GLB_BYTES) return { state: "failed", code: "PROVIDER_FAILED", message: "生成结果过大" };
    const glb = new Uint8Array(await dl.arrayBuffer());
    if (glb.byteLength > MAX_GLB_BYTES) return { state: "failed", code: "PROVIDER_FAILED", message: "生成结果过大" };
    if (!isGlb(glb)) return { state: "failed", code: "NOT_GLB", message: "生成结果不是 GLB 格式" };
    return { state: "succeeded", glb };
  },
  async cancel(jobId) {
    const h = handles.get(jobId);
    handles.delete(jobId);
    if (h) await fetch(h.cancelUrl, { method: "PUT", headers: falHeaders(), cache: "no-store" }).catch(() => null);
  },
};
