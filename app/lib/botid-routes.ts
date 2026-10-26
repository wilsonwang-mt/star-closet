// Vercel BotID 保护的接口（D76）：客户端 instrumentation-client.ts 的 initBotId 与服务端 lib/botid.ts 用同一份列表，
// 新增付费接口时两边一起生效（lib/botid.test.ts 检查每个路径的路由文件都调用了 rejectBot）。
// 这个文件会进浏览器包，不要从这里引用服务端代码。路径按完整路径精确匹配（不用通配，免得给 get-session 这类请求也加挑战）。
export const BOTID_PROTECTED = [
  // 注册 / 登录（better-auth，app/api/auth/[...all]/route.ts）
  { path: "/api/auth/sign-up/email", method: "POST" },
  { path: "/api/auth/sign-in/email", method: "POST" },
  // 付费接口：Claude 与 fal
  { path: "/api/chat", method: "POST" },
  { path: "/api/adapt", method: "POST" },
  { path: "/api/tryon", method: "POST" },
  { path: "/api/tryon/quick", method: "POST" },
  { path: "/api/scene", method: "POST" },
  { path: "/api/scene/shots", method: "POST" },
  { path: "/api/avatar/twin", method: "POST" },
  { path: "/api/avatar/body-analysis", method: "POST" },
] as const;
