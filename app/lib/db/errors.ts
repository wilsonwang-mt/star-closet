/**
 * 表还不存在（Postgres 42P01，生产库尚未执行对应迁移）。postgres-js 直接带 code，drizzle 有时包在 cause 里。
 * 防滥用计数（lib/spend.ts、lib/usage.ts）遇到时放行并打 error 日志：限额暂时失效，但不让已有功能整体报错。
 */
export function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: unknown; cause?: { code?: unknown } })?.code ?? (e as { cause?: { code?: unknown } })?.cause?.code;
  return code === "42P01";
}
