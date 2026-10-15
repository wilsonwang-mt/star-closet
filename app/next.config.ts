import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite 带 WASM 与数据文件，交给 Node 直接加载，不进打包。
  serverExternalPackages: ["@electric-sql/pglite"],
  // 本机上层目录有别的 lockfile，显式指定工程根目录。
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
