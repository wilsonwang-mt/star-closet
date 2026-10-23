import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readBodyLimited } from "@/lib/avatar/http";
import { getItemsByIds } from "@/lib/catalog";
import { getLocale, localizeServer } from "@/lib/i18n/server";
import { localizeSceneState } from "@/lib/scene/l10n";
import { createScenes, getSceneState, SceneError } from "@/lib/scene/service";
import { withQuota } from "@/lib/usage";

// 商品详情页“上身效果”（T3）。
// GET ?itemId=I011：本人这件单品的上身效果（未登录返回 signedIn:false）；视频生成中时每次 GET 推进一次轮询。
// POST { itemId, consent? }：用本人正面全身照生成 2 张场景图（同步，约 30–45 秒），随后后台生成 Live 视频。
// 首次生成可带 consent: true 记录试穿同意（与 2D 试穿同一项，D47）。
// 场景标题、失败说明与错误提示按当前界面语言返回（D70）。
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });
const jsonError = async (message: string, status: number) => json({ error: await localizeServer(message) }, status);
const ITEM_RE = /^[A-Za-z0-9_-]{1,40}$/;

export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get("itemId") ?? "";
  if (!ITEM_RE.test(itemId)) return jsonError("请求格式不对", 400);
  const user = await getCurrentUser();
  try {
    return json(localizeSceneState(await getSceneState(user?.id ?? null, itemId), await getLocale()));
  } catch (e) {
    console.error("[scene]", e instanceof Error ? e.message : "unknown error");
    return jsonError("服务暂时不可用，请稍后再试", 500);
  }
}

export async function POST(req: Request) {
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
    const itemId = typeof body?.itemId === "string" ? body.itemId : "";
    if (!ITEM_RE.test(itemId)) throw new SceneError(400, "请求格式不对");
    const [item] = await getItemsByIds([itemId]);
    if (!item) throw new SceneError(404, "没有找到这件单品");
    // 每用户每日上身效果上限（D64），超限 429（QuotaError 带 status，由下方 catch 统一返回）。
    const state = await withQuota(user.id, "scene", () => createScenes(user.id, item, { consent: body?.consent === true }));
    return json(localizeSceneState(state, await getLocale()), 201);
  } catch (e) {
    if (e instanceof SceneError) return jsonError(e.message, e.status);
    const status = (e as { status?: unknown })?.status;
    if (typeof status === "number" && e instanceof Error) return jsonError(e.message, status);
    console.error("[scene]", e instanceof Error ? e.message : "unknown error");
    return jsonError("服务暂时不可用，请稍后再试", 500);
  }
}
