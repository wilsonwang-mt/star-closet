import { json, readBodyLimited, withUser } from "@/lib/avatar/http";
import { AvatarError, getAvatarState } from "@/lib/avatar/service";
import { generateTwin } from "@/lib/avatar/twin";

// 数字分身（D63）：需登录，且已单独同意由 fal.ai 上的 AI 图像模型生成形象。
// POST { gender: "female" | "male" }：同步执行（Claude 分析 → 三张形象照并行生成，目标 60 秒内），返回最新的 AvatarState。
// 失败时作业记为 failed，返回 { error }。
export const maxDuration = 120;

export async function POST(req: Request) {
  return withUser(async (userId) => {
    const raw = await readBodyLimited(req, 4096, "请求太大");
    let body: { gender?: unknown } = {};
    if (raw.byteLength) {
      try {
        body = JSON.parse(new TextDecoder().decode(raw)) as { gender?: unknown };
      } catch {
        throw new AvatarError(400, "请求格式不对");
      }
    }
    await generateTwin(userId, { gender: body?.gender });
    return json(await getAvatarState(userId));
  });
}
