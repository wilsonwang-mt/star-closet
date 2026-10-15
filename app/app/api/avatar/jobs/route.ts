import { json, withUser } from "@/lib/avatar/http";
import { createJob } from "@/lib/avatar/service";

// 创建生成任务（draft → queued）。失败或取消后再次调用即为重试。
export async function POST() {
  return withUser(async (userId) => json(await createJob(userId), 201));
}
