// MetaPerson Creator（Avatar SDK）嵌入协议：浏览器与服务端都可引用的纯常量与纯函数，不读 env、不访问网络。
// 文档要点：iframe 加载后会向父页面 postMessage，data.source === "metaperson_creator"；
// 收到 metaperson_creator_loaded 后由父页面发送 authenticate / set_export_parameters / set_ui_parameters。

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
  | { eventName: "model_generated"; avatarCode?: string }
  | { eventName: "action_availability_changed"; actionName: string; isAvailable: boolean }
  | { eventName: "model_exported"; url: string; avatarCode: string; gender?: string; avatarState?: string };

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
        isAuthenticated: d.isAuthenticated === true,
        errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : undefined,
      };
    case "model_generated":
      return { eventName: d.eventName, avatarCode: typeof d.avatarCode === "string" ? d.avatarCode : undefined };
    case "action_availability_changed":
      return typeof d.actionName === "string"
        ? // 桌面版实测发的是数字 1/0，不是布尔值
          { eventName: d.eventName, actionName: d.actionName, isAvailable: d.isAvailable === true || d.isAvailable === 1 }
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
 * 创建器加载后依次发送的消息。只发 accessToken（服务端换取的短期令牌），绝不发 clientSecret。
 * 手机版的界面参数字段未核实，不发 set_ui_parameters（其自带导出按钮触发的 model_exported 同样会被导入）。
 */
export function setupMessages(accessToken: string, mobile: boolean): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = [
    { eventName: "authenticate", accessToken },
    { eventName: "set_export_parameters", ...MP_EXPORT },
  ];
  if (!mobile) msgs.push({ eventName: "set_ui_parameters", isExportButtonVisible: false });
  return msgs;
}

export function exportMessage(): Record<string, unknown> {
  return { eventName: "export_avatar", ...MP_EXPORT };
}
