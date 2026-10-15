import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createLook, listLooks } from "@/lib/looks";

const Body = z.object({
  title: z.string().trim().min(1).max(60),
  sourceOutfitId: z.string().nullable(),
  request: z.string().max(300).nullable(),
  summary: z.string().max(500).nullable(),
  mode: z.enum(["original", "ai", "offline"]),
  items: z
    .array(z.object({ itemId: z.string(), reason: z.string().max(200).nullable() }))
    .min(1)
    .max(12),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json(await listLooks(user.id));
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "数据格式不对" }, { status: 400 });
  try {
    const id = await createLook(user.id, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
