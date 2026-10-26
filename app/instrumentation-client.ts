import { initBotId } from "botid/client/core";
import { BOTID_PROTECTED } from "./lib/botid-routes";

// Vercel BotID 浏览器端（D76）：给注册、登录与付费接口的请求带上无感挑战的结果，服务端 lib/botid.ts 校验。
// 只在 Vercel 上构建时启用（next.config.ts 把 NEXT_PUBLIC_BOTID 写成 "1"）：本地开发不加载挑战脚本，也不改写请求。
if (process.env.NEXT_PUBLIC_BOTID === "1") {
  initBotId({ protect: BOTID_PROTECTED.map((r) => ({ path: r.path, method: r.method })) });
}
