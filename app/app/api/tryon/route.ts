import { after } from "next/server";
import { readBodyLimited } from "@/lib/avatar/http";
import { json, withTryonUser } from "@/lib/tryon/http";
import { createTryon, TryonError, type TryonInput } from "@/lib/tryon/service";
import { withQuota } from "@/lib/usage";

// 发起试穿：只提交到 fal 队列就返回（D62），前端再轮询 GET /api/tryon/<id>。请求体（首次试穿带 consent: true 记录同意）：
// - 逐件（试衣间主路径）：{ lookId 或 outfitId, itemIds: [一件], baseTryonId? }——先提交 performance 立刻出图，
//   quality 在响应之后提交（after），好了以后替换。同一底图 + 同一单品命中缓存时直接返回已有的那条。
//   baseTryonId 必须是本人一张成功的试穿结果，否则 404（不区分不存在与不属于）；不传则穿在本人正面照上。
// - 预热：{ lookId, itemIds: [一件], prewarm: true }——上传正面照后提前跑这一件的 performance，用户点“试穿”时命中缓存。
// - 整套（旧调用方式，保留兼容）：{ lookId } 或 { outfitId, itemIds: [多件] }——上装 → 下装 → 外套（或 连衣裙 → 外套）依次叠加，mode=balanced。
// 返回 TryonView：stage（queued / generating / refining / done / failed）、refining、kind、wornItemId、baseTryonId、appliedItemIds 等。
export const maxDuration = 60;

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
      prewarm: body.prewarm === true,
      consent: body.consent === true,
    };
    // 每用户每日试穿上限（D64）：预热、缓存命中也计一次；校验类错误退回。
    return json(await withQuota(userId, "tryon", () => createTryon(userId, input, (task) => after(task))), 201);
  });
}
