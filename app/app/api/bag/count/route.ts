import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { bagCount } from "@/lib/bag/service";

// 导航栏购物袋角标：未登录返回 0（不报错，导航不必区分）。
export async function GET() {
  const user = await getCurrentUser();
  const count = user ? await bagCount(user.id).catch(() => 0) : 0;
  return NextResponse.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
}
