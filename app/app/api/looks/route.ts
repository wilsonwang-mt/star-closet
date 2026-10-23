import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/i18n/api";
import { getCatalogL10n } from "@/lib/i18n/server";
import { createLook, listLooks } from "@/lib/looks";

const Body = z.object({
  title: z.string().trim().min(1).max(60),
  sourceOutfitId: z.string().nullable(),
  request: z.string().max(300).nullable(),
  summary: z.string().max(500).nullable(),
  mode: z.enum(["original", "ai", "offline", "pick"]),
  items: z
    .array(z.object({ itemId: z.string(), reason: z.string().max(200).nullable() }))
    .min(1)
    .max(12),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  // 单品名按当前界面语言（D70）；标题、说明是保存时写下的内容，原样返回。
  const l10n = await getCatalogL10n();
  const looks = await listLooks(user.id);
  return NextResponse.json(looks.map((l) => ({ ...l, items: l.items.map(l10n.item) })));
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("数据格式不对", 400);
  try {
    const id = await createLook(user.id, parsed.data);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return jsonError((e as Error).message, 400);
  }
}
