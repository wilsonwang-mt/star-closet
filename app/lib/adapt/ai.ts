import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Item, Outfit } from "../catalog";
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

const SYSTEM = `你是线上买手店 Star Closet 的搭配助手。用户选中了一位主理人策展的整套搭配，并用一句话提出自己的约束（预算、场合、想换的单品、不要的材质等）。你的任务是在给定目录内把这套搭配改编成适合用户的一整套。

规则：
1. 只能使用目录里的 item_id，不得编造商品。
2. 一整套至少包含上装（或连衣裙）、下装（穿连衣裙时可省略）和鞋；每个类别最多一件，配饰最多两件。
3. 尽量保留原搭配的风格与配色思路；只在约束需要时替换，替换优先选同类别。
4. 用户提到预算时，在 budget 字段填写预算数字（单位与目录币种一致），所选单品价格合计必须不超过预算；做不到就给出最接近的一套，并在 notes 里说明差多少、为什么。没有提到预算时 budget 填 null。
5. 每件单品的 reason 用中文写一句话（30 字以内），说明保留或替换的理由。
6. summary 用中文写一到两句话，概括这次改编做了什么。
7. notes 只写用户需要知道的取舍或缺口，没有就返回空数组。
8. summary、reason、notes 都是给用户看的：提到单品时用商品名称，不写 item_id；不写任何自己计算的金额（总价、差价、还需增加多少预算等），系统会按目录价格自己计算并展示。`;

function catalogForPrompt(all: Item[]) {
  return JSON.stringify(
    all.map((i) => ({ item_id: i.id, name: i.name, category: i.category, color: i.color, price: i.price, tags: i.tags })),
  );
}

export function hasAiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function adaptWithAi(outfit: Outfit, request: string, all: Item[]): Promise<AdaptDraft> {
  const client = new Anthropic();
  const known = new Set(all.map((i) => i.id));

  const userText = `目录（币种 ${all[0]?.currency ?? "CNY"}）：
${catalogForPrompt(all)}

原搭配「${outfit.name}」：
风格说明：${outfit.styleNote}
单品：${outfit.items.map((i) => i.id).join("、")}

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
