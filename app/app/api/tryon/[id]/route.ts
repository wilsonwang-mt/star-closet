import { json, notFound, withTryonUser } from "@/lib/tryon/http";
import { deleteTryon, getTryon } from "@/lib/tryon/service";

// 本人的单个试穿结果；不存在或不属于本人一律 404（不区分）。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTryonUser(async (userId) => {
    const { id } = await params;
    const view = await getTryon(userId, id);
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
