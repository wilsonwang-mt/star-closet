import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/i18n/api";
import { deleteLook } from "@/lib/looks";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  const { id } = await params;
  const ok = await deleteLook(user.id, id);
  return ok ? new NextResponse(null, { status: 204 }) : jsonError("不存在", 404);
}
