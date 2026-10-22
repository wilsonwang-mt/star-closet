import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getAllItems, getOutfit } from "@/lib/catalog";
import { consumeQuota, QuotaError } from "@/lib/usage";
import { adaptWithAi, hasAiKey } from "@/lib/adapt/ai";
import { adaptOffline } from "@/lib/adapt/offline";
import { finalizeAdapt } from "@/lib/adapt/finalize";
import { buildCandidatePool } from "@/lib/adapt/rules";
import type { AdaptDraft, AdaptResult } from "@/lib/adapt/types";

const Body = z.object({
  outfitId: z.string(),
  request: z.string().trim().min(1).max(300),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  // 改编会调用 Claude（付费）：需要登录，并按用户每日限次（D64）。AI 失败或没有 key 时仍走规则兜底。
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请说一句改编要求" }, { status: 400 });

  const outfit = await getOutfit(parsed.data.outfitId);
  if (!outfit) return NextResponse.json({ error: "搭配不存在" }, { status: 404 });
  try {
    await consumeQuota(user.id, "adapt");
  } catch (e) {
    if (e instanceof QuotaError) return NextResponse.json({ error: e.message }, { status: 429 });
    throw e;
  }
  // 候选池：同衣橱 + 同性别/中性单品（男装不换成女装，反之亦然）。
  const pool = buildCandidatePool(outfit, await getAllItems());

  let draft: AdaptDraft;
  const extraNotes: string[] = [];
  if (hasAiKey()) {
    try {
      draft = await adaptWithAi(outfit, parsed.data.request, pool);
    } catch (e) {
      const msg = e instanceof Anthropic.APIError ? `AI 服务错误 ${e.status}` : (e as Error).message;
      console.error("adapt ai failed:", msg);
      draft = adaptOffline(outfit, parsed.data.request, pool);
    }
  } else {
    draft = adaptOffline(outfit, parsed.data.request, pool);
  }

  // 服务端校验、总价与“去掉了…”说明（按原搭配与结果的实际差异生成）见 lib/adapt/finalize.ts。
  const result: AdaptResult = finalizeAdapt(outfit, draft, pool, parsed.data.request, extraNotes);
  return NextResponse.json(result);
}
