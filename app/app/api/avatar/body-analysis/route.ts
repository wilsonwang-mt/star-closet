import { runBodyAnalysis } from "@/lib/avatar/body";
import { json, withUser } from "@/lib/avatar/http";
import { requireMetapersonConsent } from "@/lib/avatar/service";

// 体型分析（D56）：需登录，且已同意由 MetaPerson 生成形象。
// 用户另外单独同意“由 Anthropic（Claude）分析我的全身照……”且配置了 ANTHROPIC_API_KEY 时，读取本人全身正面/侧面照
// （私有存储）与档案身高体重调用 Claude；否则或调用失败时只按身高体重粗略设定，不报错。
// 返回 { source: "claude" | "bmi" | "none", gender, blends: { Body, Neck, Shoulders, Chest, Forearms, Waist, Hips, Legs }, summary }。
export async function POST() {
  return withUser(async (userId) => {
    const { consent } = await requireMetapersonConsent(userId);
    return json(await runBodyAnalysis(userId, { consented: consent.bodyAnalysis }));
  });
}
