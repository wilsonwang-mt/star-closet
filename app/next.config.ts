import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite 带 WASM 与数据文件，交给 Node 直接加载，不进打包。
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
