import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllItems, getOutfit, sumPrice } from "@/lib/catalog";
import { adaptWithAi, hasAiKey } from "@/lib/adapt/ai";
import { adaptOffline } from "@/lib/adapt/offline";
import type { AdaptDraft, AdaptResult } from "@/lib/adapt/types";

const Body = z.object({
  outfitId: z.string(),
  request: z.string().trim().min(1).max(300),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请说一句改编要求" }, { status: 400 });

  const outfit = await getOutfit(parsed.data.outfitId);
  if (!outfit) return NextResponse.json({ error: "搭配不存在" }, { status: 404 });
  const all = await getAllItems();

  let draft: AdaptDraft;
  const extraNotes: string[] = [];
  if (hasAiKey()) {
    try {
      draft = await adaptWithAi(outfit, parsed.data.request, all);
    } catch (e) {
      const msg = e instanceof Anthropic.APIError ? `AI 服务错误 ${e.status}` : (e as Error).message;
      console.error("adapt ai failed:", msg);
      draft = adaptOffline(outfit, parsed.data.request, all);
      extraNotes.push(`AI 暂不可用（${msg}），本次结果来自规则模式`);
    }
  } else {
    draft = adaptOffline(outfit, parsed.data.request, all);
  }

  // 总价与预算由服务端计算，不采用模型给出的数字。
  const byId = new Map(all.map((i) => [i.id, i]));
  const items = draft.picks
    .map((p) => {
      const it = byId.get(p.itemId);
      return it ? { ...it, reason: p.reason } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const total = sumPrice(items);
  const overBudget = draft.budget !== null && total > draft.budget;

  const result: AdaptResult = {
    mode: draft.mode,
    items,
    summary: draft.summary,
    budget: draft.budget,
    total,
    overBudget,
    notes: [...draft.notes, ...extraNotes],
  };
  return NextResponse.json(result);
}
