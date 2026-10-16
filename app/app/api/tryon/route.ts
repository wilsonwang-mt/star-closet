import { readBodyLimited } from "@/lib/avatar/http";
import { json, withTryonUser } from "@/lib/tryon/http";
import { createTryon, TryonError, type TryonInput } from "@/lib/tryon/service";

// 发起试穿，服务端整体 120 秒超时。请求体（首次试穿带 consent: true 记录同意）：
// - 逐件（试衣间主路径）：{ lookId 或 outfitId, itemIds: [一件], baseTryonId? }——只穿这一件，调用一次 FASHN（mode=quality）。
//   baseTryonId 必须是本人一张成功的试穿结果，否则 404（不区分不存在与不属于）；不传则穿在本人正面照上。
// - 整套（旧调用方式，保留兼容）：{ lookId } 或 { outfitId, itemIds: [多件] }——上装 → 下装 → 外套（或 连衣裙 → 外套）依次叠加，mode=balanced。
// 返回 TryonView：kind（item / outfit）、wornItemId（这次穿上的单品）、baseTryonId（在哪张结果上穿，null 为正面照）、
// appliedItemIds / applied（结果图上穿着的单品）等。
export const maxDuration = 120;

export async function POST(req: Request) {
  return withTryonUser(async (userId) => {
    const raw = await readBodyLimited(req, 16 * 1024, "请求太大");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.from(raw).toString("utf8"));
    } catch {
      throw new TryonError(400, "请求格式不对");
    }
    if (!body || typeof body !== "object") throw new TryonError(400, "请求格式不对");
    const input: TryonInput = {
      lookId: typeof body.lookId === "string" ? body.lookId : null,
      outfitId: typeof body.outfitId === "string" ? body.outfitId : null,
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === "string") : [],
      baseTryonId: typeof body.baseTryonId === "string" && body.baseTryonId ? body.baseTryonId : null,
      consent: body.consent === true,
    };
    return json(await createTryon(userId, input), 201);
  });
}
