// 部署环境的快速失败检查（D64）。只在服务端调用，只检查变量是否存在，不读取、不打印变量值。
// - Vercel（VERCEL=1）：DATABASE_URL、SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 缺一不可。
//   Vercel 文件系统只读，不能回落本地 PGlite（.data/pglite）或本地文件存储（.data/uploads）。
// - 本地 next start（NODE_ENV=production）：只要求 DATABASE_URL；没配 Supabase Storage 的本地演示继续用本地驱动。
// - 构建阶段（NEXT_PHASE=phase-production-build）一律不检查，构建仍可用内存 PGlite。

// scope：db 只查数据库（每个页面都会用到）；storage 只查私有文件存储（只有照片、形象、试穿、场景图用到）；all 两者都查。
// 2026-10-17：生产环境暂缺 SUPABASE_SERVICE_ROLE_KEY 时，数据库检查不再连带存储变量，避免首页等全部 500。
export type DeployEnvScope = "all" | "db" | "storage";

export function missingDeployEnv(env: NodeJS.ProcessEnv = process.env, scope: DeployEnvScope = "all"): string[] {
  if (env.NEXT_PHASE === "phase-production-build") return [];
  const db = env.VERCEL === "1" || env.NODE_ENV === "production" ? ["DATABASE_URL"] : [];
  const storage = env.VERCEL === "1" ? ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] : [];
  const required = scope === "db" ? db : scope === "storage" ? storage : [...db, ...storage];
  return required.filter((k) => !env[k]);
}

export function assertDeployEnv(env: NodeJS.ProcessEnv = process.env, scope: DeployEnvScope = "all") {
  const missing = missingDeployEnv(env, scope);
  if (missing.length) {
    throw new Error(`缺少环境变量 ${missing.join("、")}：生产环境不回落本地 PGlite 或本地文件存储，请在部署环境变量中配置`);
  }
}
