import { readBodyLimited } from "@/lib/avatar/http";
import { json, withTryonUser } from "@/lib/tryon/http";
import { createQuickTryon, TryonError } from "@/lib/tryon/service";

// 商品详情页“一键试穿”：POST { itemId, consent? }，把这一件穿到本人形象上（数字分身正面照优先，否则正面全身照）。
// 上装 / 下装 / 外套 / 连衣裙走试穿模型（默认可灵 Kolors，约 10 秒）；鞋、包、配饰走 nano-banana-pro/edit（约 30 秒）。
// 返回 TryonView；首次可带 consent: true 记录同意（与试衣间同一项，D47）。
export const maxDuration = 120;

const ITEM_RE = /^[A-Za-z0-9_-]{1,40}$/;

export async function POST(req: Request) {
  return withTryonUser(async (userId) => {
    const raw = await readBodyLimited(req, 4 * 1024, "请求太大");
    let body: Record<string, unknown> | null;
    try {
      body = JSON.parse(Buffer.from(raw).toString("utf8"));
    } catch {
      body = null;
    }
    const itemId = typeof body?.itemId === "string" ? body.itemId : "";
    if (!ITEM_RE.test(itemId)) throw new TryonError(400, "请求格式不对");
    return json(await createQuickTryon(userId, itemId, { consent: body?.consent === true }), 201);
  });
}
