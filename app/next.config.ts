import path from "node:path";
import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite 带 WASM 与数据文件，交给 Node 直接加载，不进打包。
  serverExternalPackages: ["@electric-sql/pglite"],
  // 本机上层目录有别的 lockfile，显式指定工程根目录。
  outputFileTracingRoot: path.resolve(__dirname),
  // 浏览器端 BotID（instrumentation-client.ts）只在 Vercel 上构建时启用，与服务端 lib/botid.ts 的判断一致（D76）。
  env: { NEXT_PUBLIC_BOTID: process.env.VERCEL === "1" && process.env.BOTID !== "off" ? "1" : "" },
  // 自托管字体文件名带版本号（v1、v2…），可以长缓存
  async headers() {
    return [{ source: "/fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

// withBotId：把挑战脚本与校验请求改写到本站路径下（同源，不被广告拦截插件挡掉）。
export default withBotId(nextConfig);
