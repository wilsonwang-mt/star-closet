import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Item, Outfit } from "../catalog";
import { capsText, fitsSize, groupByCategory, isLayered, parseSizes, relevantCategories, sizeText } from "./rules";
import type { AdaptDraft } from "./types";

const MODEL = "claude-opus-5-5";

const AdaptSchema = z.object({
  items: z.array(
    z.object({
      item_id: z.string(),
      reason: z.string(),
    }),
  ),
  summary: z.string(),
  budget: z.number().nullable(),
  notes: z.array(z.string()),
});

const SYSTEM = `你是线上买手店 SEEN. 的搭配助手。用户选中了一位主理人策展的整套搭配，并用一句话提出自己的约束（预算、场合、想换的单品、不要的材质等）。你的任务是在给定目录内把这套搭配改编成适合用户的一整套。

规则：
1. 只能使用目录里的 item_id，不得编造商品。
2. 一整套至少包含上装（或连衣裙）、下装（穿连衣裙时可省略）和鞋。每个类别的件数上限以“本套类目上限”为准：叠穿搭配（内搭 + 叠穿，或连衣裙 + 开衫）可以保留两件上装，其余类别按给出的上限。目录已按搭配的性别筛过（男装搭配只有男装和中性单品，女装搭配只有女装和中性单品），不要跨性别。
3. 尽量保留原搭配的风格与配色思路；只在约束需要时替换，替换优先选同类别。
4. 用户提到预算时，在 budget 字段填写预算数字（单位与目录币种一致），所选单品价格合计必须不超过预算；做不到就给出最接近的一套，并在 notes 里说明差多少、为什么。没有提到预算时 budget 填 null。
5. 每件单品的 reason 用中文写一句话（30 字以内），说明保留或替换的理由。
6. summary 用中文写一到两句话，概括这次改编做了什么。
7. notes 只写用户需要知道的取舍或缺口，没有就返回空数组。
8. summary、reason、notes 都是给用户看的：提到单品时用商品名称，不写 item_id；不写任何自己计算的金额（总价、差价、还需增加多少预算等），系统会按目录价格自己计算并展示。`;

// 按类目分组，只放相关类目；每件只带选品需要的字段。
function catalogForPrompt(grouped: Partial<Record<string, Item[]>>) {
  const out: Record<string, unknown[]> = {};
  for (const [cat, items] of Object.entries(grouped)) {
    out[cat] = (items ?? []).map((i) => ({
      item_id: i.id,
      name: i.name,
      sub: i.subcategory,
      color: i.color,
      price: i.price,
      tags: i.tags,
      ...(i.heel ? { heel: i.heel } : {}),
      sizes: i.sizes,
    }));
  }
  return JSON.stringify(out);
}

export function hasAiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** pool 必须是 buildCandidatePool(outfit, …) 的结果；这里再按相关类目与用户尺码收窄。 */
export async function adaptWithAi(outfit: Outfit, request: string, pool: Item[]): Promise<AdaptDraft> {
  const client = new Anthropic();
  const wish = parseSizes(request);
  const cats = relevantCategories(outfit, request);
  const candidates = pool.filter((i) => fitsSize(i, wish));
  const grouped = groupByCategory(candidates, cats);
  const known = new Set(Object.values(grouped).flatMap((items) => (items ?? []).map((i) => i.id)));
  const noSize = outfit.items.filter((i) => !known.has(i.id));

  const userText = `目录（币种 ${pool[0]?.currency ?? "CNY"}，按类别分组，只含与这套搭配相关的类别）：
${catalogForPrompt(grouped)}

原搭配「${outfit.name}」（${outfit.gender}${isLayered(outfit) ? "，叠穿" : ""}）：
风格说明：${outfit.styleNote}
单品：${outfit.items.map((i) => `${i.id}（${i.category}）`).join("、")}
本套类目上限：${capsText(outfit)}。
${sizeText(wish) ? `用户尺码：${sizeText(wish)}；目录已只保留有这个尺码的单品。\n` : ""}${
    noSize.length ? `原搭配中这些单品没有用户的尺码，必须换成同类：${noSize.map((i) => i.name).join("、")}。\n` : ""
  }
用户的要求：${request}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];

  // 最多两次：第一次结果引用了目录外的编号时，带上错误再请模型修正一次。
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: "low", format: zodOutputFormat(AdaptSchema) },
      messages,
    });

    if (response.stop_reason === "refusal") throw new Error("模型拒绝了这次请求");
    const out = response.parsed_output;
    if (!out) throw new Error("模型没有返回可解析的结果");

    const unknown = out.items.map((i) => i.item_id).filter((id) => !known.has(id));
    if (unknown.length === 0) {
      const seen = new Set<string>();
      const picks = out.items
        .filter((i) => (seen.has(i.item_id) ? false : (seen.add(i.item_id), true)))
        .map((i) => ({ itemId: i.item_id, reason: i.reason }));
      return { mode: "ai", picks, summary: out.summary, budget: out.budget, notes: out.notes };
    }

    messages.push(
      { role: "assistant", content: JSON.stringify(out) },
      { role: "user", content: `这些 item_id 不在目录里：${unknown.join("、")}。请只用目录内的编号重新给出结果。` },
    );
  }
  throw new Error("模型两次都返回了目录外的商品");
}
