import { readBodyLimited } from "@/lib/avatar/http";
import { json, withTryonUser } from "@/lib/tryon/http";
import { createTryon, TryonError, type TryonInput } from "@/lib/tryon/service";

// 整套试穿：同步依次调用 FASHN（上装 → 下装 → 外套，或 连衣裙 → 外套），服务端整体 120 秒超时。
// 请求体：{ lookId } 或 { outfitId, itemIds }，首次试穿带 consent: true（记录同意）。
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
    const input: TryonInput = {
      lookId: typeof body.lookId === "string" ? body.lookId : null,
      outfitId: typeof body.outfitId === "string" ? body.outfitId : null,
      itemIds: Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === "string") : [],
      consent: body.consent === true,
    };
    return json(await createTryon(userId, input), 201);
  });
}
