import { json, jsonError, withUser } from "@/lib/avatar/http";
import { localizeAvatarState } from "@/lib/avatar/l10n";
import { recordConsent } from "@/lib/avatar/service";
import { getLocale } from "@/lib/i18n/server";

// 记录同意：body { store: true, thirdParty: boolean, offerVersion }。
// store：同意上传并存储本人照片用于生成 3D 形象（必选）。
// thirdParty：同意把照片发送给第三方生成服务（只在配置了真实服务 key 时可选；不勾选只能用示意模型）。
// bodyAnalysis：同意由 Anthropic（Claude）分析全身照、参考照片调整体型（D56；只在 MetaPerson 模式且配置了 key 时可选）。
// offerVersion 必须与当前同意卡一致，防止用户看到的是旧的“谁处理”说明。
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => null)) as {
      store?: unknown;
      thirdParty?: unknown;
      offerVersion?: unknown;
      bodyAnalysis?: unknown;
    } | null;
    if (body?.store !== true) return jsonError("需要勾选同意保存照片", 400);
    const state = await recordConsent(userId, {
      store: true,
      thirdParty: body.thirdParty === true,
      offerVersion: body.offerVersion,
      bodyAnalysis: body.bodyAnalysis === true,
    });
    return json(localizeAvatarState(state, await getLocale()));
  });
}
