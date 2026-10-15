import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { deleteLook } from "@/lib/looks";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await params;
  const ok = await deleteLook(user.id, id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "不存在" }, { status: 404 });
}
