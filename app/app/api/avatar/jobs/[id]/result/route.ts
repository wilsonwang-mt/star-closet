import { json, withUser } from "@/lib/avatar/http";
import { localizeJobView } from "@/lib/avatar/l10n";
import { deleteResult } from "@/lib/avatar/service";
import { getLocale } from "@/lib/i18n/server";

// 删除单个已生成的 3D 形象（GLB 文件），保留照片与同意；使用过第三方服务时同时请求其删除副本。
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUser(async (userId) => {
    const r = await deleteResult(userId, id);
    return json({ ...r, job: localizeJobView(r.job, await getLocale()) });
  });
}
