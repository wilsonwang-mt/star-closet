// MetaPerson 生成流程状态机（纯函数，浏览器与单元测试共用，不读 env、不访问网络）。D56：
// standby    用户在本站上传照片；创建器已挂载、在后台隐藏预加载
// generating 用户点“生成我的 3D 形象”：本站等待态在前，创建器仍隐藏；引擎就绪后发送 generate_avatar
// revealed   收到 model_generated：淡入创建器供用户微调，再用“保存为我的 3D 形象”导出
// fallback   generate_avatar 发出 90 秒内没有 model_generated，或认证失败：显示创建器原生界面，
//            放回“选择照片”按钮（fallbackUiMessage），提示用户直接在创建器里选正脸照

export const GENERATE_TIMEOUT_MS = 90_000;

export type FlowPhase = "standby" | "generating" | "revealed" | "fallback";
export type FallbackReason = "timeout" | "auth";

export type FlowState = {
  phase: FlowPhase;
  /** 创建器已加载并完成认证，可以接收 generate_avatar */
  engineReady: boolean;
  /** 用户已点生成、照片已备好，等引擎就绪后发送 */
  pending: boolean;
  /** generate_avatar 发出的时间（毫秒时间戳）；未发出为 null */
  sentAt: number | null;
  fallbackReason: FallbackReason | null;
};

export type FlowEvent =
  | { type: "engine_ready" }
  | { type: "request" }
  | { type: "sent"; at: number }
  | { type: "model_generated" }
  | { type: "auth_failed" }
  | { type: "tick"; now: number }
  | { type: "cancel" };

export const initialFlow: FlowState = { phase: "standby", engineReady: false, pending: false, sentAt: null, fallbackReason: null };

export function flowReducer(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case "engine_ready":
      return s.engineReady ? s : { ...s, engineReady: true };
    case "request":
      // 认证失败时只能用原生界面；生成中不重复提交。
      if (s.phase === "generating" || s.fallbackReason === "auth") return s;
      return { ...s, phase: "generating", pending: true, sentAt: null, fallbackReason: null };
    case "sent":
      if (s.phase !== "generating" || !s.pending) return s;
      return { ...s, pending: false, sentAt: e.at };
    case "model_generated":
      // 只认本次 generate_avatar 之后的结果，或兜底时用户在原生界面里生成的结果；
      // 待机时创建器自己加载默认形象发出的事件忽略，避免提前露出。
      if (s.phase === "fallback" || (s.phase === "generating" && s.sentAt !== null)) {
        return { ...s, phase: "revealed", pending: false, fallbackReason: null };
      }
      return s;
    case "auth_failed":
      if (s.phase === "revealed") return s;
      return { ...s, phase: "fallback", pending: false, fallbackReason: "auth" };
    case "cancel":
      // 照片还没准备好就取消（例如读取照片失败）：回到上传。已经发出的请求不撤回。
      if (s.phase !== "generating" || s.sentAt !== null) return s;
      return { ...s, phase: "standby", pending: false };
    case "tick":
      if (s.phase === "generating" && s.sentAt !== null && e.now - s.sentAt >= GENERATE_TIMEOUT_MS) {
        return { ...s, phase: "fallback", fallbackReason: "timeout" };
      }
      return s;
  }
}

/** 是否应在此刻发送 generate_avatar。 */
export function shouldSend(s: FlowState): boolean {
  return s.phase === "generating" && s.pending && s.engineReady;
}

/** 距离兜底还有多少毫秒；未在等待生成结果时为 null。 */
export function msUntilFallback(s: FlowState, now: number): number | null {
  if (s.phase !== "generating" || s.sentAt === null) return null;
  return Math.max(0, s.sentAt + GENERATE_TIMEOUT_MS - now);
}

/** 引擎加载的“进度”：没有真实进度事件，按已用时间做一条趋近 0.92 的曲线，就绪后为 1。只用于进度条的 scaleX，不显示百分比。 */
export function engineProgress(elapsedMs: number, ready: boolean): number {
  if (ready) return 1;
  const t = Math.max(0, elapsedMs) / 1000;
  return Math.round((0.92 * (1 - Math.exp(-t / 40))) * 1000) / 1000;
}
