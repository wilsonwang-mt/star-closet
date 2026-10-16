import { after } from "next/server";
import { json, notFound, withTryonUser } from "@/lib/tryon/http";
import { deleteTryon, pollTryon } from "@/lib/tryon/service";

// 本人的单个试穿结果，也是前端的轮询接口：还在生成或细化时，服务端顺带查一次 fal 状态；
// 刚好完成时把结果图以 data URI 放在响应里，写入私有存储放到响应之后（after）。不存在或不属于本人一律 404（不区分）。
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTryonUser(async (userId) => {
    const { id } = await params;
    const view = await pollTryon(userId, id, (task) => after(task));
    return view ? json(view) : notFound();
  });
}

// 删除单个试穿结果（同时删除存储里的结果图）。
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTryonUser(async (userId) => {
    const { id } = await params;
    return (await deleteTryon(userId, id)) ? json({ ok: true }) : notFound();
  });
}
