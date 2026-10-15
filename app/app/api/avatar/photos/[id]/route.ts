import { json, withUser } from "@/lib/avatar/http";
import { deletePhoto } from "@/lib/avatar/service";

// 删除本人的一张照片（同时删除存储文件）；他人的照片返回 404。
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUser(async (userId) => json(await deletePhoto(userId, id)));
}
