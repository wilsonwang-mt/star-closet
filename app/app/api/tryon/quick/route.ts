import { after } from "next/server";
import { readBodyLimited } from "@/lib/avatar/http";
import { rejectBot } from "@/lib/botid";
import { clientIp } from "@/lib/client-ip";
import { getLocale } from "@/lib/i18n/server";
import { json, withTryonUser } from "@/lib/tryon/http";
import { localizeTryonView } from "@/lib/tryon/l10n";
import { createQuickTryon, TryonError } from "@/lib/tryon/service";
import { withQuota } from "@/lib/usage";

// 商品详情页“一键试穿”：POST { itemId, consent? }，把这一件穿到本人形象上（数字分身正面照优先，否则正面全身照）。
// 与试衣间逐件同一套两段式（只提交到 fal 队列就返回，前端轮询 GET /api/tryon/<id>）：上装 / 下装 / 外套 / 连衣裙先用可灵 Kolors
// 快出图（约 20 秒），再用 nano-banana 多参考细化（约 45 秒）原地替换；鞋、包、配饰只跑 nano 一段。同一底图 + 同一单品命中缓存。
// 返回 TryonView；首次可带 consent: true 记录同意（与试衣间同一项，D47）。
export const maxDuration = 60;

const ITEM_RE = /^[A-Za-z0-9_-]{1,40}$/;

export async function POST(req: Request) {
  const denied = await rejectBot();
  if (denied) return denied;
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
    // 与试衣间共用每日试穿上限（D64）。
    const view = await withQuota(
      userId,
      "tryon",
      () => createQuickTryon(userId, itemId, { consent: body?.consent === true }, (task) => after(task)),
      { ip: clientIp(req.headers) },
    );
    return json(localizeTryonView(view, await getLocale()), 201);
  });
}
