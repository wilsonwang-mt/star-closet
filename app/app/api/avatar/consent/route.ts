import { json, withUser } from "@/lib/avatar/http";
import { activeProviderInfo } from "@/lib/avatar/providers";
import { recordConsent } from "@/lib/avatar/service";

// 记录同意：body { agree: true, consentVersion }。consentVersion 必须与当前处理方一致，
// 防止用户看到的是旧的“谁处理”说明。
export async function POST(req: Request) {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => null)) as { agree?: unknown; consentVersion?: unknown } | null;
    if (body?.agree !== true) return json({ error: "需要勾选同意" }, 400);
    if (body.consentVersion !== activeProviderInfo().consentVersion) {
      return json({ error: "处理方已变更，请刷新页面重新阅读说明" }, 409);
    }
    return json(await recordConsent(userId));
  });
}
