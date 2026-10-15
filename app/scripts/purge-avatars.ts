// 3D 形象数据清理（D47）：删除到期的原始照片（存储文件 + 记录），并重试未成功的第三方副本删除。
// 用法：npm run avatar:purge（会读取 .env.local）。可由 cron 等定时任务每天调用，例如：
//   0 4 * * *  cd /path/to/app && npm run avatar:purge >> .data/purge.log 2>&1
// - 设置了 DATABASE_URL：清理 Supabase 中的数据；否则清理本地 PGlite（运行前请先停掉开发服务器，PGlite 同一时间只允许一个进程打开）。
// - 没有 FAL_KEY 时不访问任何外部网络。
// 输出只有计数，不打印用户 id、文件名或任何照片信息。
import { dbKind } from "../lib/db";
import { purgeExpiredPhotos, retryRemotePurges } from "../lib/avatar/purge";

async function main() {
  const photos = await purgeExpiredPhotos();
  const remote = await retryRemotePurges();
  console.log(
    `[avatar:purge] ${new Date().toISOString()}（${dbKind === "postgres" ? "Supabase" : "本地 PGlite"}）` +
      ` 删除到期照片 ${photos.photos} 张；第三方副本删除重试：成功 ${remote.sent}、失败 ${remote.failed}、仍在进行 ${remote.pending}` +
      (remote.skipped ? `、未配置 key 跳过 ${remote.skipped}` : ""),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("[avatar:purge] 失败：", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
