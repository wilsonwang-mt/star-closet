import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readBodyLimited } from "@/lib/avatar/http";
import { rejectBot } from "@/lib/botid";
import { clientIp } from "@/lib/client-ip";
import { getOutfit } from "@/lib/catalog";
import { getLocale, localizeServer } from "@/lib/i18n/server";
import { SceneError } from "@/lib/scene/errors";
import { localizeCoverState, localizeShot, localizeShotsState } from "@/lib/scene/l10n";
import { createCoverShot, createPoseShot, getCoverState, getShots } from "@/lib/scene/shots";
import { withQuota } from "@/lib/usage";

// 场景与姿势试穿（D75）。
// GET ?tryonId=…：本人这张标准试穿图上已生成的场景姿势图（方案 A），附今日剩余次数。需要登录。
// GET ?outfitId=…：这套搭配的封面同款（方案 B）：有没有整套标准图、最新一张封面同款、今日剩余次数。未登录返回 signedIn:false。
// POST { kind: "pose", tryonId, sceneId, pose, consent? } 或 { kind: "cover", outfitId, consent? }：生成一张（同步，约 30–60 秒）。
// 每张扣一次 scene 额度；同一人同时只生成一张（429）；全站每日总额满了 503（不扣额度）。
// 首次生成可带 consent: true 记录试穿同意（与 2D 试穿同一项，D47）。文案按当前界面语言返回（D70）。
// 迁移 0008 未执行时 GET 返回 500，界面按“不可用”处理、不显示入口。
export const maxDuration = 150;

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });
const jsonError = async (message: string, status: number) => json({ error: await localizeServer(message) }, status);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const tryonId = params.get("tryonId");
  const outfitId = params.get("outfitId");
  if (tryonId !== null ? !ID_RE.test(tryonId) : !outfitId || !ID_RE.test(outfitId)) return jsonError("请求格式不对", 400);
  const user = await getCurrentUser();
  try {
    const locale = await getLocale();
    if (tryonId !== null) {
      if (!user) return jsonError("请先登录", 401);
      return json(localizeShotsState(await getShots(user.id, tryonId), locale));
    }
    const outfit = await getOutfit(outfitId!);
    if (!outfit) return jsonError("没有找到这套搭配", 404);
    return json(localizeCoverState(await getCoverState(user?.id ?? null, outfit), locale));
  } catch (e) {
    console.error("[shots]", e instanceof Error ? e.message : "unknown error");
    return jsonError("服务暂时不可用，请稍后再试", 500);
  }
}

export async function POST(req: Request) {
  const denied = await rejectBot();
  if (denied) return denied;
  const user = await getCurrentUser();
  if (!user) return jsonError("请先登录", 401);
  try {
    const raw = await readBodyLimited(req, 4 * 1024, "请求太大");
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(Buffer.from(raw).toString("utf8"));
    } catch {
      body = null;
    }
    const str = (k: string) => (typeof body?.[k] === "string" ? (body[k] as string) : "");
    const consent = body?.consent === true;
    let run: () => ReturnType<typeof createPoseShot>;
    if (body?.kind === "pose") {
      const [tryonId, sceneId, pose] = [str("tryonId"), str("sceneId"), str("pose")];
      if (!ID_RE.test(tryonId) || !ID_RE.test(sceneId) || !ID_RE.test(pose)) throw new SceneError(400, "请求格式不对");
      run = () => createPoseShot(user.id, tryonId, sceneId, pose, { consent });
    } else if (body?.kind === "cover") {
      const outfitId = str("outfitId");
      if (!ID_RE.test(outfitId)) throw new SceneError(400, "请求格式不对");
      const outfit = await getOutfit(outfitId);
      if (!outfit) throw new SceneError(404, "没有找到这套搭配");
      run = () => createCoverShot(user.id, outfit, { consent });
    } else {
      throw new SceneError(400, "请求格式不对");
    }
    // 每用户每日上限（超限 429）；生成前的校验失败（4xx）与全站总额已满会退回这次计数。
    const shot = await withQuota(user.id, "scene", run, { ip: clientIp(req.headers) });
    return json({ shot: localizeShot(shot, await getLocale()) }, 201);
  } catch (e) {
    if (e instanceof SceneError) return jsonError(e.message, e.status);
    const status = (e as { status?: unknown })?.status;
    if (typeof status === "number" && e instanceof Error) return jsonError(e.message, status);
    console.error("[shots]", e instanceof Error ? e.message : "unknown error");
    return jsonError("服务暂时不可用，请稍后再试", 500);
  }
}
