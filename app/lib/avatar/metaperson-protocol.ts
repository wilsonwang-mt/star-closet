// MetaPerson Creator（Avatar SDK）嵌入协议：浏览器与服务端都可引用的纯常量与纯函数，不读 env、不访问网络。
// 文档要点：iframe 加载后会向父页面 postMessage，data.source === "metaperson_creator"；
// 收到 metaperson_creator_loaded 后由父页面发送 authenticate / set_export_parameters / set_ui_parameters。
// D56：照片由本站自己的上传界面收集，正脸照经 generate_avatar 交给创建器；创建器在生成完成前保持隐藏。

export const MP_DESKTOP_URL = "https://metaperson.avatarsdk.com/iframe.html";
export const MP_MOBILE_URL = "https://mobile.metaperson.avatarsdk.com/generator";
/** 视口宽度小于此值时使用手机版生成器。 */
export const MP_MOBILE_BREAKPOINT = 768;
export const MP_SOURCE = "metaperson_creator";

/** 只接受这两个来源的消息，并把消息只回发给对应来源。 */
export const MP_ORIGINS = [new URL(MP_DESKTOP_URL).origin, new URL(MP_MOBILE_URL).origin] as const;

export const MP_EXPORT = { format: "glb", lod: 2, textureProfile: "1K.jpg", useZip: false } as const;

/** avatarCode 会拼进远端删除接口的路径：只允许字母、数字、下划线与连字符。 */
export const AVATAR_CODE_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function creatorUrl(viewportWidth: number): { url: string; mobile: boolean } {
  const mobile = viewportWidth < MP_MOBILE_BREAKPOINT;
  return { url: mobile ? MP_MOBILE_URL : MP_DESKTOP_URL, mobile };
}

export type MpEvent =
  | { eventName: "metaperson_creator_loaded" }
  | { eventName: "authentication_status"; isAuthenticated: boolean; errorMessage?: string }
  | { eventName: "model_generated"; avatarCode?: string; gender?: string }
  | { eventName: "action_availability_changed"; actionName: string; isAvailable: boolean }
  | { eventName: "model_exported"; url: string; avatarCode: string; gender?: string; avatarState?: string };

/** 创建器的布尔字段：桌面版 1.42.0 实测会发数字 1/0（b462c14），true / 1 都算真。 */
export function mpFlag(v: unknown): boolean {
  return v === true || v === 1;
}

/** 解析来自创建器的消息：来源 origin 不在白名单或 data.source 不对时返回 null。 */
export function parseMpMessage(origin: string, data: unknown): MpEvent | null {
  if (!(MP_ORIGINS as readonly string[]).includes(origin)) return null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== MP_SOURCE || typeof d.eventName !== "string") return null;
  switch (d.eventName) {
    case "metaperson_creator_loaded":
      return { eventName: d.eventName };
    case "authentication_status":
      return {
        eventName: d.eventName,
        isAuthenticated: mpFlag(d.isAuthenticated),
        errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : undefined,
      };
    case "model_generated":
      return {
        eventName: d.eventName,
        avatarCode: typeof d.avatarCode === "string" ? d.avatarCode : undefined,
        gender: typeof d.gender === "string" ? d.gender : undefined,
      };
    case "action_availability_changed":
      return typeof d.actionName === "string"
        ? // 桌面版实测发的是数字 1/0，不是布尔值
          { eventName: d.eventName, actionName: d.actionName, isAvailable: mpFlag(d.isAvailable) }
        : null;
    case "model_exported":
      return typeof d.url === "string" && typeof d.avatarCode === "string"
        ? {
            eventName: d.eventName,
            url: d.url,
            avatarCode: d.avatarCode,
            gender: typeof d.gender === "string" ? d.gender : undefined,
            avatarState: typeof d.avatarState === "string" ? d.avatarState : undefined,
          }
        : null;
    default:
      return null;
  }
}

/**
 * 隐藏创建器自带的取图入口与示例形象：照片由本站上传界面收集，正脸照经 generate_avatar 发送（D56）。
 * 桌面版字段见官方 JS API 的 set_ui_parameters；手机版用 isNoPhotoVisible 隐藏“无照片”入口，
 * 并用 age 固定为成人：手机版创建器默认提供 10–16 岁选项，而 AGENTS.md 规定未成年人规则未定前不处理未成年人身体照片。
 */
export function hiddenUiMessage(mobile: boolean): Record<string, unknown> {
  if (mobile) return { eventName: "set_ui_parameters", isNoPhotoVisible: false, age: "adult" };
  return {
    eventName: "set_ui_parameters",
    isExportButtonVisible: false,
    showSampleAvatars: false,
    isTakeSelfieButtonVisible: false,
    isBrowsePhotoButtonVisible: false,
    isLanguageSelectionVisible: false,
  };
}

/** 兜底：显示创建器原生界面时，把“选择照片”按钮放回来，让用户在创建器里直接选正脸照。手机版保持原生入口，不另发消息。 */
export function fallbackUiMessage(mobile: boolean): Record<string, unknown> | null {
  if (mobile) return null;
  return { eventName: "set_ui_parameters", isBrowsePhotoButtonVisible: true };
}

/**
 * 创建器加载后依次发送的消息。只发 accessToken（服务端换取的短期令牌），绝不发 clientSecret。
 */
export function setupMessages(accessToken: string, mobile: boolean): Record<string, unknown>[] {
  return [
    { eventName: "authenticate", accessToken },
    { eventName: "set_export_parameters", ...MP_EXPORT },
    hiddenUiMessage(mobile),
  ];
}

// ---------- 待机姿势 ----------
// 默认导出的是 T 字姿势（双臂平举）。官方 JS API 的导出参数（桌面版才支持，手机版忽略）：
// animationName 选一段随模型一起导出的动画；animationAsBindPose: true 用动画第一帧代替 T-Pose 作为绑定姿势，
// 所以即使不播放动画，模型也是自然站姿。动画名按性别区分：Female_Animation_Idle / Male_Animation_Idle。
// 查看器（components/avatar-viewer/Viewer.tsx）发现 GLB 带动画时循环播放。

/** 创建器 / 事件里的性别字符串归一为 male | female；认不出时返回 null。 */
export function mpGenderOf(v: unknown): MpGender | null {
  if (typeof v !== "string") return null;
  const g = v.trim().toLowerCase();
  if (g.startsWith("female") || g === "f" || g === "woman") return "female";
  if (g.startsWith("male") || g === "m" || g === "man") return "male";
  return null;
}

/** 桌面版导出时附带的待机动画参数；手机版不支持这两个字段，返回空对象。 */
export function idlePoseParams(gender: MpGender | null, mobile: boolean): Record<string, unknown> {
  if (mobile || !gender) return {};
  return { animationName: gender === "male" ? "Male_Animation_Idle" : "Female_Animation_Idle", animationAsBindPose: true };
}

/** 生成完成、知道性别后重发一次导出参数（桌面版带上待机动画）；手机版没有可加的字段，返回 null。 */
export function idleExportParamsMessage(gender: MpGender | null, mobile: boolean): Record<string, unknown> | null {
  const extra = idlePoseParams(gender, mobile);
  if (!Object.keys(extra).length) return null;
  return { eventName: "set_export_parameters", ...MP_EXPORT, ...extra };
}

export function exportMessage(opts: { gender?: MpGender | null; mobile?: boolean } = {}): Record<string, unknown> {
  return { eventName: "export_avatar", ...MP_EXPORT, ...idlePoseParams(opts.gender ?? null, opts.mobile ?? true) };
}

// ---------- generate_avatar ----------

export type MpGender = "male" | "female";
/** MetaPerson 桌面版的 8 个身体比例参数（blends），取值 -1..1，0 为默认。 */
export const BODY_BLENDS = ["Body", "Neck", "Shoulders", "Chest", "Forearms", "Waist", "Hips", "Legs"] as const;
export type BodyBlend = (typeof BODY_BLENDS)[number];
export type BodyBlends = Record<BodyBlend, number>;

/** 裁剪到 [-1, 1] 并四舍五入到 0.05；非有限数按 0。 */
export function clampBlend(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  const r = Math.round(Math.max(-1, Math.min(1, n)) * 20) / 20;
  return r === 0 ? 0 : r; // 去掉 -0
}

/** 只保留 8 个已知名称，缺省为 0，并逐项裁剪。 */
export function normalizeBlends(input?: Partial<Record<string, unknown>> | null): BodyBlends {
  const out = {} as BodyBlends;
  for (const name of BODY_BLENDS) out[name] = clampBlend(input?.[name]);
  return out;
}

/** 去掉 data URL 前缀（"data:image/jpeg;base64,"），只留 base64 正文。 */
export function stripDataUrl(s: string): string {
  const i = s.indexOf("base64,");
  return s.startsWith("data:") && i >= 0 ? s.slice(i + "base64,".length) : s;
}

/** 等比缩放到长边不超过 maxEdge（不放大）。 */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 发给创建器的正脸照：长边约 1024px 的 JPEG。 */
export const MP_FACE_MAX_EDGE = 1024;

/**
 * generate_avatar 消息：gender、age 固定 adult、image 为 JPEG/PNG 的 base64（不带 data: 前缀）。
 * blends 只有桌面版有效，手机版不发。
 */
export function generateAvatarMessage(input: {
  gender: MpGender;
  image: string;
  blends?: Partial<Record<string, unknown>> | null;
  mobile: boolean;
}): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    eventName: "generate_avatar",
    gender: input.gender === "male" ? "male" : "female",
    age: "adult",
    image: stripDataUrl(input.image),
  };
  if (!input.mobile) {
    const b = normalizeBlends(input.blends);
    msg.blends = BODY_BLENDS.map((name) => ({ name, value: b[name] }));
  }
  return msg;
}
