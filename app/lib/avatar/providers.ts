import { getStorage } from "@/lib/storage";
import { buildMannequinGlb, isGlb } from "./mannequin";
import { deleteRemoteAvatar, metapersonEnabled } from "./metaperson";

// 3D 形象生成服务适配。全部在服务端调用，浏览器永远拿不到任何 key。
// - mock（默认）：不访问任何外部网络，几秒后返回程序生成的通用人台，标注“非本人示意模型”。
// - tripo_fal：fal.ai 托管的 Tripo H3.1 Multiview-to-3D。只有 AVATAR3D_PROVIDER=tripo_fal 且设置了 FAL_KEY 才可用，
//   并且用户必须在同意卡上单独勾选“同意发送给 fal.ai（Tripo 3D）”（D47）；否则一律走 mock，不发起任何外部请求。
// - metaperson：Avatar SDK 的 MetaPerson Creator。用户在本站嵌入的创建器里上传自拍、生成形象，导出后由服务端下载转存
//   （见 metaperson.ts、POST /api/avatar/metaperson/import）。不走 submit/poll；AVATAR3D_PROVIDER=metaperson 且
//   AVATARSDK_CLIENT_ID、AVATARSDK_CLIENT_SECRET 都存在才启用，同样要求用户单独勾选第三方处理（D47）。
// - twin（D63，数字分身）：不做 3D。用户上传 3–5 张照片，Claude 分析体型/发型/脸部特征，fal.ai 上的 nano-banana-pro/edit
//   生成一组标准形象照（正面、侧面、背面）。设置了 FAL_KEY 且 AVATAR3D_PROVIDER 未设或为 twin 时启用；同样要求用户单独勾选（D47）。
//   生成走 POST /api/avatar/twin（同步），不走 submit/poll，见 twin.ts。
// Meshy 备选适配器比赛版未实现。

export type ProviderId = "mock" | "tripo_fal" | "metaperson" | "twin";

export type ProviderInfo = {
  id: ProviderId;
  isMock: boolean;
  /** 同意卡第二项里的服务名。 */
  name: string;
  /** 同意卡上“谁处理”的说明。 */
  processor: string;
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

/** 外部任务句柄：持久化在 avatar_job.provider_task_id / provider_status_url，进程重启后据此继续轮询。 */
export type ProviderHandle = { taskId: string; statusUrl: string };

export type PollResult =
  | { state: "processing" }
  | { state: "succeeded"; glb: Uint8Array }
  | { state: "failed"; code: ErrorCode; message: string };

/** 第三方副本删除结果：sent 已删除 / failed 失败 / pending 任务未结束、稍后重试 / skipped 未使用第三方。 */
export type RemotePurge = "sent" | "failed" | "pending" | "skipped";

export interface Avatar3DProvider {
  info: ProviderInfo;
  /** 提交任务；真实服务返回需要持久化的句柄，mock 返回 null。 */
  submit(jobId: string, photos: InputPhoto[]): Promise<ProviderHandle | null>;
  poll(jobId: string, handle: ProviderHandle | null, startedAt: Date): Promise<PollResult>;
  cancel(jobId: string, handle: ProviderHandle | null): Promise<void>;
}

const INFO: Record<ProviderId, ProviderInfo> = {
  mock: {
    id: "mock",
    isMock: true,
    name: "本站（示意模式）",
    processor: "本站服务器：照片只保存在本站私有存储，不发送给任何第三方 AI 服务；生成结果是通用人台，不是你本人",
    fidelityNote: "示意模型，非本人：未使用照片生成，仅为通用人台。合身未验证。",
  },
  tripo_fal: {
    id: "tripo_fal",
    isMock: false,
    name: "fal.ai（Tripo 3D）",
    processor: "fal.ai 托管的 Tripo 3D 生成模型（第三方服务，位于境外）：只发送正面、侧面、背面三张全身照",
    fidelityNote: "AI 根据你的照片生成的 3D 形象预览：还原外观轮廓，还原度未验证，不代表精确本人外貌或身体尺寸。合身未验证。",
  },
  metaperson: {
    id: "metaperson",
    isMock: false,
    name: "MetaPerson",
    processor: "Avatar SDK 的 MetaPerson 创建器（第三方服务，位于境外）：自拍在创建器内上传并由其生成形象，本站只保存导出的 3D 形象",
    fidelityNote: "MetaPerson 根据你的自拍生成的 3D 形象。",
  },
  twin: {
    id: "twin",
    isMock: false,
    name: "fal.ai",
    processor: "fal.ai 上的 AI 图像模型（第三方服务，位于境外）：根据你上传的照片生成你的一组标准形象照",
    fidelityNote: "AI 根据你的照片生成的形象照。",
  },
};

/** 数字分身（D63）：设置了 FAL_KEY，且 AVATAR3D_PROVIDER 未设或为 twin。 */
export function twinEnabled(): boolean {
  const p = process.env.AVATAR3D_PROVIDER;
  return !!process.env.FAL_KEY && (!p || p === "twin");
}

// ---------- 同意版本 ----------
// consent_version 同时记录各项：
//   avatar-consent-v2:store            只同意本站保存照片（只能生成示意模型）
//   avatar-consent-v2:store+tripo_fal  另外单独同意把照片发送给 fal.ai（Tripo 3D）
//   avatar-consent-v2:store+metaperson            单独同意由 MetaPerson 生成本人形象
//   avatar-consent-v2:store+metaperson+anthropic  另外单独同意由 Anthropic（Claude）分析全身照、参考照片调整体型（D56）
// 同意卡文案改动时提升版本号，旧版本的同意随之失效、需要重新确认。
export const CONSENT_BASE = "avatar-consent-v2";

/** bodyAnalysis 只在第三方为 MetaPerson 或数字分身时生效（分析结果只用于这两种形象）。 */
export function consentVersionFor(thirdParty: ProviderId | null, bodyAnalysis = false): string {
  if ((thirdParty === "metaperson" || thirdParty === "twin") && bodyAnalysis) return `${CONSENT_BASE}:store+${thirdParty}+${BODY_ANALYSIS_ID}`;
  return thirdParty && thirdParty !== "mock" ? `${CONSENT_BASE}:store+${thirdParty}` : `${CONSENT_BASE}:store`;
}

export function parseConsentVersion(v: string | null | undefined): { thirdParty: ProviderId | null; bodyAnalysis: boolean } | null {
  if (v === `${CONSENT_BASE}:store`) return { thirdParty: null, bodyAnalysis: false };
  if (v === `${CONSENT_BASE}:store+tripo_fal`) return { thirdParty: "tripo_fal", bodyAnalysis: false };
  if (v === `${CONSENT_BASE}:store+metaperson`) return { thirdParty: "metaperson", bodyAnalysis: false };
  if (v === `${CONSENT_BASE}:store+metaperson+${BODY_ANALYSIS_ID}`) return { thirdParty: "metaperson", bodyAnalysis: true };
  if (v === `${CONSENT_BASE}:store+twin`) return { thirdParty: "twin", bodyAnalysis: false };
  if (v === `${CONSENT_BASE}:store+twin+${BODY_ANALYSIS_ID}`) return { thirdParty: "twin", bodyAnalysis: true };
  return null;
}

// ---------- 体型分析（D56） ----------
// 第三个第三方处理方：Anthropic（Claude）读取全身正面/侧面照与身高体重，给出 8 个身体比例参数与一句体型概括。
// 只在 MetaPerson 模式且配置了 ANTHROPIC_API_KEY 时出现在同意卡上，且须用户单独勾选；否则只按身高体重粗略设定。
export const BODY_ANALYSIS_ID = "anthropic";
export const BODY_ANALYSIS_NAME = "Anthropic（Claude）";

export function bodyAnalysisOffered(): boolean {
  return (metapersonEnabled() || twinEnabled()) && !!process.env.ANTHROPIC_API_KEY;
}

/** 配置了真实服务 key 时返回该服务；否则 null（同意卡不显示第二项）。 */
export function thirdPartyInfo(): ProviderInfo | null {
  if (metapersonEnabled()) return INFO.metaperson;
  if (twinEnabled()) return INFO.twin;
  return process.env.AVATAR3D_PROVIDER === "tripo_fal" && process.env.FAL_KEY ? INFO.tripo_fal : null;
}

/** 用户看到的同意卡版本：第二项是否出现、写的是哪家服务。提交同意时用来确认卡片没有过期。 */
export function offerVersion(): string {
  return `${CONSENT_BASE}:offer:${thirdPartyInfo()?.id ?? "none"}${bodyAnalysisOffered() ? `+${BODY_ANALYSIS_ID}` : ""}`;
}

/** 按用户的同意决定实际使用的服务：只有单独同意了第三方、且该服务仍已配置，才用真实服务。 */
export function providerForConsent(thirdParty: ProviderId | null): ProviderInfo {
  const tp = thirdPartyInfo();
  return tp && thirdParty === tp.id ? tp : INFO.mock;
}

/**
 * 生成所需的必填照片。
 * - mock：不发送照片，正面 + 侧面或背面任一即可。
 * - tripo_fal：正面 + 侧面必填（侧面对应 fal 的 left 位），背面可选。
 */
export function hasRequiredSlots(id: string, photos: { slot: string }[]) {
  const slots = new Set(photos.map((p) => p.slot));
  if (!slots.has("front")) return false;
  if (id === "twin") return slots.has("face");
  if (id === "tripo_fal") return slots.has("side");
  return slots.has("side") || slots.has("back");
}

export function requiredSlotsMessage(id: string) {
  if (id === "twin") return "需要正脸照和全身正面照";
  return id === "tripo_fal" ? "需要正面和侧面全身照，背面可选" : "需要正面全身照，以及侧面或背面全身照至少一张";
}

export function maxPollSeconds() {
  const n = Number(process.env.AVATAR3D_MAX_POLL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

export function providerInfo(id: string): ProviderInfo | null {
  return id === "mock" || id === "tripo_fal" || id === "metaperson" || id === "twin" ? INFO[id] : null;
}

export function getProvider(id: string): Avatar3DProvider {
  if (id === "tripo_fal") {
    if (!process.env.FAL_KEY) throw new ProviderError("NO_KEY", "生成服务未配置，请稍后重试");
    return tripoFal;
  }
  if (id === "metaperson") return metaperson;
  if (id === "twin") return twin;
  return mock;
}

// ---------- mock ----------

const MOCK_SECONDS = 3;

const mock: Avatar3DProvider = {
  info: INFO.mock,
  async submit() {
    return null;
  },
  async poll(_jobId, _handle, startedAt) {
    if (Date.now() - startedAt.getTime() < MOCK_SECONDS * 1000) return { state: "processing" };
    return { state: "succeeded", glb: buildMannequinGlb() };
  },
  async cancel() {},
};

// ---------- metaperson ----------
// 形象由浏览器里的创建器生成、经导入接口直接写成 succeeded 作业，不存在需要提交或轮询的服务端任务。
const metaperson: Avatar3DProvider = {
  info: INFO.metaperson,
  async submit() {
    throw new ProviderError("BAD_INPUT", "请在 MetaPerson 创建器中生成形象");
  },
  async poll() {
    return { state: "failed", code: "BAD_INPUT", message: "请在 MetaPerson 创建器中生成形象" };
  },
  async cancel() {},
};

// ---------- twin ----------
// 数字分身由 POST /api/avatar/twin 同步生成并直接写成 succeeded / failed 作业，不存在需要轮询的任务。
// poll 永远返回 processing：任何轮询（例如另一个标签页）都不能把正在生成的作业改成失败；超时由 service 的视图层判断。
const twin: Avatar3DProvider = {
  info: INFO.twin,
  async submit() {
    throw new ProviderError("BAD_INPUT", "请在形象页生成数字分身");
  },
  async poll() {
    return { state: "processing" };
  },
  async cancel() {},
};

// ---------- tripo_fal ----------

const FAL_ENDPOINT = "https://queue.fal.run/tripo3d/h3.1/multiview-to-3d";
const FAL_PLATFORM = "https://api.fal.ai/v1/models/requests";
const MAX_GLB_BYTES = 100 * 1024 * 1024;
// fal 的 image_urls 按位置区分视角：[front, left, back, right]，2–4 张，正面必填，
// 文档没有“跳过某个位置”的写法（不接受空串或 null）。因此按位置构造、不能过滤后压紧：
// 本站“侧面”固定对应 left，“背面”对应 back，不发 right。只有正面+背面时背面会被当成 left，
// 所以真实服务要求正面+侧面必填，背面可选。
const FAL_VIEW_ORDER = ["front", "side", "back"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 对 fal 状态接口的查询节流（只是限速，不是状态；进程重启后丢失无妨）。
const g = globalThis as unknown as { scFalLastPoll?: Map<string, number> };
const lastPoll = (g.scFalLastPoll ??= new Map());

function falHeaders() {
  // X-Fal-Store-IO: 0 —— 请求 fal 不保存本次请求的输入输出（payload）。
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" };
}

/** 校验并拆出状态地址：必须是 https://queue.fal.run/.../requests/<taskId>/status。 */
export function falUrls(h: ProviderHandle): { status: string; response: string; cancel: string } | null {
  if (!UUID_RE.test(h.taskId)) return null;
  let u: URL;
  try {
    u = new URL(h.statusUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "queue.fal.run") return null;
  const suffix = `/requests/${h.taskId}/status`;
  if (!u.pathname.endsWith(suffix) || u.search) return null;
  const base = `${u.origin}${u.pathname.slice(0, -"/status".length)}`;
  return { status: `${base}/status`, response: base, cancel: `${base}/cancel` };
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
  async submit(_jobId, photos) {
    const bySlot = (slot: string) => photos.find((p) => p.slot === slot);
    if (!hasRequiredSlots("tripo_fal", photos)) {
      throw new ProviderError("BAD_INPUT", requiredSlotsMessage("tripo_fal"));
    }
    // 位置 0=front、1=left(侧面)、2=back；背面缺省时数组到 left 为止，位置不会错位。
    const ordered: InputPhoto[] = [];
    for (const slot of FAL_VIEW_ORDER) {
      const p = bySlot(slot);
      if (!p) break;
      ordered.push(p);
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
    const body = (await res.json().catch(() => null)) as { request_id?: unknown; status_url?: unknown } | null;
    const handle = { taskId: String(body?.request_id ?? ""), statusUrl: String(body?.status_url ?? "") };
    if (!falUrls(handle)) throw new ProviderError("PROVIDER_FAILED", "生成服务返回格式异常");
    return handle;
  },
  async poll(jobId, handle, startedAt) {
    const urls = handle && falUrls(handle);
    if (!handle || !urls) return { state: "failed", code: "PROVIDER_FAILED", message: "缺少生成任务编号，请重试" };
    if (Date.now() - startedAt.getTime() > maxPollSeconds() * 1000) {
      await this.cancel(jobId, handle);
      return { state: "failed", code: "TIMEOUT", message: "生成超时，请重试" };
    }
    // 前端每 2 秒轮询一次；对 fal 的状态查询至少间隔 4 秒。
    if (Date.now() - (lastPoll.get(jobId) ?? 0) < 4000) return { state: "processing" };
    lastPoll.set(jobId, Date.now());
    const st = await fetch(urls.status, { headers: falHeaders(), cache: "no-store" }).catch(() => null);
    if (!st) return { state: "processing" };
    if (!st.ok && st.status !== 202) return { state: "failed", code: "PROVIDER_FAILED", message: `生成服务出错（${st.status}）` };
    const status = ((await st.json().catch(() => null)) as { status?: string } | null)?.status;
    if (status !== "COMPLETED") return { state: "processing" };

    lastPoll.delete(jobId);
    const r = await fetch(urls.response, { headers: falHeaders(), cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) {
      const text = r ? await r.text().catch(() => "") : "";
      if (/safety|nsfw|content policy/i.test(text)) return { state: "failed", code: "SAFETY_BLOCKED", message: "照片未通过生成服务的安全检查" };
      return { state: "failed", code: "PROVIDER_FAILED", message: `生成失败（${r?.status ?? "网络错误"}）` };
    }
    const out = (await r.json().catch(() => null)) as { model_mesh?: { url?: unknown } } | null;
    const meshUrl = out?.model_mesh?.url;
    if (!isHttps(meshUrl)) return { state: "failed", code: "NOT_GLB", message: "生成结果缺少 3D 模型文件" };
    // fal 的媒体链接可公开访问，立即下载转存到本站私有存储；随后由 service 调用 purgeRemoteRequest 删除 fal 侧副本。
    const dl = await fetch(meshUrl, { cache: "no-store" }).catch(() => null);
    if (!dl || !dl.ok) return { state: "failed", code: "PROVIDER_FAILED", message: "下载生成结果失败" };
    const len = Number(dl.headers.get("content-length") ?? 0);
    if (len > MAX_GLB_BYTES) return { state: "failed", code: "PROVIDER_FAILED", message: "生成结果过大" };
    const glb = new Uint8Array(await dl.arrayBuffer());
    if (glb.byteLength > MAX_GLB_BYTES) return { state: "failed", code: "PROVIDER_FAILED", message: "生成结果过大" };
    if (!isGlb(glb)) return { state: "failed", code: "NOT_GLB", message: "生成结果不是 GLB 格式" };
    return { state: "succeeded", glb };
  },
  async cancel(jobId, handle) {
    lastPoll.delete(jobId);
    const urls = handle && falUrls(handle);
    if (urls) await fetch(urls.cancel, { method: "PUT", headers: falHeaders(), cache: "no-store" }).catch(() => null);
  },
};

/**
 * 请求第三方删除该任务保存的 payload 与输出文件（fal Platform API：DELETE /v1/models/requests/<id>/payloads）。
 * - 非真实服务或没有任务编号：skipped，不访问网络。
 * - 没有 FAL_KEY（key 已被移除）：failed，不访问网络。
 * - fal 返回 400（任务仍在进行）：pending，由 npm run avatar:purge 稍后重试。
 * 只记录状态码，不记录响应体。注意：fal 文档说明“请求输入里的 CDN 文件不会被删除”，本站不把照片上传到 fal 存储，
 * 只传签名 URL（Supabase）或内联 data URI（本地开发）。
 */
export async function purgeRemoteRequest(providerId: string, taskId: string | null): Promise<RemotePurge> {
  // MetaPerson：taskId 即 avatarCode。删除接口对创建器生成的形象是否生效未实测；失败只记日志。
  if (providerId === "metaperson" && taskId) return (await deleteRemoteAvatar(taskId)) ? "sent" : "failed";
  if (providerId !== "tripo_fal" || !taskId) return "skipped";
  if (!UUID_RE.test(taskId)) return "failed";
  if (!process.env.FAL_KEY) {
    console.warn("[avatar] 第三方副本删除失败：FAL_KEY 未配置");
    return "failed";
  }
  const res = await fetch(`${FAL_PLATFORM}/${taskId}/payloads`, {
    method: "DELETE",
    // 不带 Idempotency-Key：fal 会把同一 key 的响应缓存 10 分钟，“仍在进行”的 400 会挡住稍后的重试。
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
    cache: "no-store",
  }).catch(() => null);
  if (!res) {
    console.warn("[avatar] 第三方副本删除失败：网络错误");
    return "failed";
  }
  if (res.status === 400) return "pending";
  if (!res.ok) {
    console.warn(`[avatar] 第三方副本删除失败：HTTP ${res.status}`);
    return "failed";
  }
  const body = (await res.json().catch(() => null)) as { cdn_delete_results?: { exception?: string | null }[] } | null;
  const failed = (body?.cdn_delete_results ?? []).filter((r) => r.exception).length;
  if (failed) {
    console.warn(`[avatar] 第三方副本删除部分失败：${failed} 个文件`);
    return "failed";
  }
  return "sent";
}
