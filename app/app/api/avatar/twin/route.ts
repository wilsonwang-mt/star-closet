import { after } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { json, readBodyLimited, withUser } from "@/lib/avatar/http";
import { AvatarError, getAvatarState } from "@/lib/avatar/service";
import { generateTwin } from "@/lib/avatar/twin";

// 数字分身（D63）：需登录，且已单独同意由 fal.ai 上的 AI 图像模型生成形象。
// POST { gender: "female" | "male" }：校验通过、作业写入（status=processing）后立即返回最新 AvatarState，
// 生成在响应之后继续（after）；页面看到 processing 作业会每 3 秒查询一次直到结束。
// fal 排队时单张 40–120 秒，同步等待容易超时，所以改为后台执行（总预算 240 秒）。
export const maxDuration = 300;

const hasProcessingJob = async (userId: string) =>
  (
    await db
      .select({ id: schema.avatarJob.id })
      .from(schema.avatarJob)
      .where(and(eq(schema.avatarJob.userId, userId), eq(schema.avatarJob.provider, "twin"), eq(schema.avatarJob.status, "processing")))
  ).length > 0;

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
    let settled = false;
    let failure: unknown = null;
    const run = generateTwin(userId, { gender: body?.gender }).then(
      () => void (settled = true),
      (e) => {
        settled = true;
        failure = e;
      },
    );
    // 校验类错误（未同意、缺照片、正在生成）在写入作业前抛出：等到作业出现或 promise 结束为止（最多约 10 秒）。
    for (let i = 0; i < 50 && !settled; i++) {
      if (await hasProcessingJob(userId)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (settled && failure) throw failure;
    if (!settled) after(() => run);
    return json(await getAvatarState(userId));
  });
}
