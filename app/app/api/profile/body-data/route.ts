import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/i18n/api";
import { clearBodyData, getProfile } from "@/lib/profile";

// 清空本人的身体数据（身高、体重）并撤回同意。
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  await clearBodyData(user.id);
  return NextResponse.json(await getProfile(user.id));
}
