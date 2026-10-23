import { runBodyAnalysis } from "@/lib/avatar/body";
import { json, withUser } from "@/lib/avatar/http";
import { localizeBodyAnalysis } from "@/lib/avatar/l10n";
import { requireMetapersonConsent } from "@/lib/avatar/service";
import { getLocale } from "@/lib/i18n/server";
import { withQuota } from "@/lib/usage";

export const maxDuration = 60;

// 体型分析（D56）：需登录，且已同意由 MetaPerson 生成形象。
// 用户另外单独同意“由 Anthropic（Claude）分析我的全身照……”且配置了 ANTHROPIC_API_KEY 时，读取本人全身正面/侧面照
// （私有存储）与档案身高体重调用 Claude；否则或调用失败时只按身高体重粗略设定，不报错。
// 返回 { source: "claude" | "bmi" | "none", gender, blends: { Body, Neck, Shoulders, Chest, Forearms, Waist, Hips, Legs }, summary, lang }。
// 概括按当前界面语言写（D70）；已存的是另一种语言时重新分析一次。
export async function POST() {
  return withUser(async (userId) => {
    const locale = await getLocale();
    const { consent } = await requireMetapersonConsent(userId);
    // 只有同意由 Claude 分析时才会调用付费服务，此时计入每日上限（D64）；只按身高体重估算不计数。
    const view = consent.bodyAnalysis
      ? await withQuota(userId, "body_analysis", () => runBodyAnalysis(userId, { consented: true, locale }))
      : await runBodyAnalysis(userId, { consented: false, locale });
    return json(localizeBodyAnalysis(view, locale));
  });
}
