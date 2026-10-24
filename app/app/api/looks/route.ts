import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { jsonError } from "@/lib/i18n/api";
import { getLocale } from "@/lib/i18n/server";
import { createLook, listLooks } from "@/lib/looks";
import { LOOK_TITLE_MAX, localizeLook } from "@/lib/looks-l10n";

// 自动标题由服务端按中文目录生成，客户端不用传 title（旧客户端传的按界面语言拼的标题也会被认出来换成中文）；
// 传了认不出的标题当作用户自己写的原样保存。manual 表示这件是用户手动替换的。见 lib/looks.ts createLook。
const Body = z.object({
  title: z.string().trim().min(1).max(LOOK_TITLE_MAX).optional(),
  sourceOutfitId: z.string().nullable(),
  request: z.string().max(300).nullable(),
  summary: z.string().max(500).nullable(),
  mode: z.enum(["original", "ai", "offline", "pick"]),
  items: z
    .array(z.object({ itemId: z.string(), reason: z.string().max(200).nullable(), manual: z.boolean().optional() }))
    .min(1)
    .max(12),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  // 自动标题、“你手动替换”理由与单品名按当前界面语言（D70）；改编要求、改编说明与 AI 写的理由原样返回。
  const [locale, looks] = await Promise.all([getLocale(), listLooks(user.id)]);
  return NextResponse.json(looks.map((l) => localizeLook(l, locale)));
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
