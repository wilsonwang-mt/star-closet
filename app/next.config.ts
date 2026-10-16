import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite 带 WASM 与数据文件，交给 Node 直接加载，不进打包。
  serverExternalPackages: ["@electric-sql/pglite"],
  // 本机上层目录有别的 lockfile，显式指定工程根目录。
  outputFileTracingRoot: path.resolve(__dirname),
  // 自托管字体文件名带版本号（v1、v2…），可以长缓存
  async headers() {
    return [{ source: "/fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;
