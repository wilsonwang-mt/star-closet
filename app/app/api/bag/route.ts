import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { AddBody, DeleteBody, PatchBody } from "@/lib/bag/core";
import { addToBag, listBag, removeBagLine, updateBagLine } from "@/lib/bag/service";

// 购物袋（D67）：GET 列出；POST { items: [{ itemId, size?, qty? }] } 加入（单件 / 整套 / 多选）；
// PATCH { itemId, size, qty?, toSize? } 改数量或尺码；DELETE { itemId, size } 移除。都需要登录。

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });

async function withUser(fn: (userId: string) => Promise<Response>) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "请先登录" }, 401);
  try {
    return await fn(user.id);
  } catch (e) {
    console.error("[bag]", e instanceof Error ? e.message : "unknown error");
    return json({ error: "服务暂时不可用，请稍后再试" }, 500);
  }
}

export async function GET() {
  return withUser(async (userId) => json(await listBag(userId)));
}

export async function POST(req: Request) {
  return withUser(async (userId) => {
    const parsed = AddBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "请求格式不对" }, 400);
    try {
      const count = await addToBag(userId, parsed.data.items);
      return json({ count }, 201);
    } catch (e) {
      if (e instanceof Error && e.message === "没有可加入的单品") return json({ error: e.message }, 400);
      throw e;
    }
  });
}

export async function PATCH(req: Request) {
  return withUser(async (userId) => {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "请求格式不对" }, 400);
    const ok = await updateBagLine(userId, parsed.data);
    return ok ? json(await listBag(userId)) : json({ error: "没有找到" }, 404);
  });
}

export async function DELETE(req: Request) {
  return withUser(async (userId) => {
    const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "请求格式不对" }, 400);
    const ok = await removeBagLine(userId, parsed.data.itemId, parsed.data.size);
    return ok ? json(await listBag(userId)) : json({ error: "没有找到" }, 404);
  });
}
