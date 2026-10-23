import { json, jsonError, withUser } from "@/lib/avatar/http";
import { localizeJobView } from "@/lib/avatar/l10n";
import { cancelJob, tickJob } from "@/lib/avatar/service";
import { getLocale } from "@/lib/i18n/server";

type Ctx = { params: Promise<{ id: string }> };

// 查询任务进度；每次查询顺带推进一步（queued → processing → succeeded / failed）。
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const job = await tickJob(userId, id);
    return job ? json(localizeJobView(job, await getLocale())) : jsonError("任务不存在", 404);
  });
}

// 取消排队中或生成中的任务。
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return withUser(async (userId) => {
    const job = await cancelJob(userId, id);
    return job ? json(localizeJobView(job, await getLocale())) : jsonError("任务不存在", 404);
  });
}
