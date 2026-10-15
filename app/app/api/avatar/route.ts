import { json, withUser } from "@/lib/avatar/http";
import { deleteAll, getAvatarState } from "@/lib/avatar/service";

// 当前用户的 3D 形象状态：同意、照片、最近一次生成任务。
export async function GET() {
  return withUser(async (userId) => json(await getAvatarState(userId)));
}

// 一键删除全部照片与生成结果（同时删除存储文件），作业标记 canceled，需重新同意才能再上传；
// 使用过第三方服务的任务同时请求其删除副本，结果在 remotePurge 中返回。
export async function DELETE() {
  return withUser(async (userId) => json(await deleteAll(userId)));
}
