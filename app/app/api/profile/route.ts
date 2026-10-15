import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getProfile, ProfileInput, upsertProfile } from "@/lib/profile";

// 个人档案：只读写当前登录用户本人的数据。
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json(await getProfile(user.id), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = ProfileInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const budget = parsed.error.issues.find((i) => i.path[0] === "budgetMax" && i.code === "custom");
    return NextResponse.json({ error: budget ? budget.message : "数据格式不对" }, { status: 400 });
  }
  return NextResponse.json(await upsertProfile(user.id, parsed.data));
}
