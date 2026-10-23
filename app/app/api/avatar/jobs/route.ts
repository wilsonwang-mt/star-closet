import { json, withUser } from "@/lib/avatar/http";
import { localizeJobView } from "@/lib/avatar/l10n";
import { createJob } from "@/lib/avatar/service";
import { getLocale } from "@/lib/i18n/server";

// 创建生成任务（draft → queued）。失败或取消后再次调用即为重试。
export async function POST() {
  return withUser(async (userId) => json(localizeJobView(await createJob(userId), await getLocale()), 201));
}
