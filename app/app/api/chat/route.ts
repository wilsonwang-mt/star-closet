import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { streamChatAi, hasChatAi } from "@/lib/chat/ai";
import { availablePages, closetCard, getChatCatalog, outfitCard, pageCard } from "@/lib/chat/catalog";
import { CHAT_MAX_INPUT, type ChatCard, type ChatEvent } from "@/lib/chat/protocol";
import { emptyQuery, locate, parseQuery, type LocateCatalog, type LocateQuery, type LocateResult } from "@/lib/locate/core";

export const dynamic = "force-dynamic";

// 悬浮对话（D66）。返回 NDJSON 流：
//   1. rules —— 规则层即时结果（读目录后 <50ms），保证 1–2 秒内有卡片；
//   2. delta… —— AI 的一两句话，逐段流出（第一段替换规则那句）；
//   3. cards / chips —— AI 用工具选出的卡片（已按目录与性别校验）；
//   4. done。
// 没有 ANTHROPIC_API_KEY、AI 超时或出错时停在规则结果；已流出半截文字则发 revert 撤回。界面不显示“规则模式”（D48）。
// 用户的话只在内存里用于这次请求：不落库，日志只记错误类型。

// 审美类的话（如“暖一点的颜色”）模型会多想一会儿，实测首字约 10 秒；规则结果已经先到，这里宁可多等
const FIRST_TOKEN_MS = 15_000;
const TOTAL_MS = 25_000;

const Turn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
  shown: z.array(z.string().max(32)).max(12).optional(),
});

const strArr = z.array(z.string().max(40)).max(12).catch([]);
const Query = z
  .object({
    person: z.string().max(16).nullable().catch(null),
    styles: strArr,
    occasions: strArr,
    generic: z.boolean().catch(false),
    avoid: strArr,
    gender: z.enum(["女装", "男装", "中性"]).nullable().catch(null),
    budget: z.number().int().min(0).max(1_000_000).nullable().catch(null),
    tier: z.enum(["平价", "适中", "进阶"]).nullable().catch(null),
    season: z.enum(["春夏"]).nullable().catch(null),
    skipClosets: strArr,
    occasionLabels: strArr,
    styleLabels: strArr,
    avoidLabels: strArr,
  })
  .partial();

const Body = z.object({
  messages: z.array(Turn).min(1).max(40),
  query: Query.nullable().optional(),
});

function rulesCards(r: LocateResult, catalog: LocateCatalog): ChatCard[] {
  const cards: ChatCard[] = [];
  const top = r.closets[0];
  if (top) cards.push(closetCard(top.closet));
  for (const s of r.outfits.slice(0, 4)) cards.push(outfitCard(s.outfit, catalog.closets));
  const allowed = new Set(availablePages());
  for (const p of r.pages) if (allowed.has(p)) cards.push(pageCard(p));
  return cards;
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请说一句你的需求" }, { status: 400 });
  const history = parsed.data.messages.map((m) => (m.role === "user" ? { ...m, text: m.text.slice(0, CHAT_MAX_INPUT) } : m));
  const latest = [...history].reverse().find((m) => m.role === "user")?.text.trim();
  if (!latest) return NextResponse.json({ error: "请说一句你的需求" }, { status: 400 });

  let catalog: LocateCatalog;
  try {
    catalog = await getChatCatalog();
  } catch (e) {
    console.error("chat catalog failed:", (e as Error).message);
    return NextResponse.json({ error: "目录暂时读不到，稍后再试" }, { status: 503 });
  }

  const prev: LocateQuery | null = parsed.data.query ? { ...emptyQuery(), ...parsed.data.query } : null;
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const prevShown = (lastAssistant?.shown ?? []).filter((id) => /^C\d+$/.test(id));
  const query = parseQuery(latest, catalog.closets, prev, prevShown);
  const rules = locate(catalog, query);

  const encoder = new TextEncoder();
  const ctrl = new AbortController();
  req.signal.addEventListener("abort", () => ctrl.abort());

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端已断开时 enqueue 会抛错：忽略，后续由 cancel() 中止 AI 调用
      const send = (ev: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
        } catch {}
      };
      send({ t: "rules", text: rules.text, cards: rulesCards(rules, catalog), chips: rules.chips, query });

      if (hasChatAi()) {
        let streamed = false;
        const firstToken = setTimeout(() => ctrl.abort(), FIRST_TOKEN_MS);
        const total = setTimeout(() => ctrl.abort(), TOTAL_MS);
        try {
          const out = await streamChatAi({
            catalog,
            history,
            rules,
            query,
            signal: ctrl.signal,
            onText: (d) => {
              if (!streamed) clearTimeout(firstToken);
              streamed = true;
              send({ t: "delta", d });
            },
          });
          if (out.cards.length) send({ t: "cards", cards: out.cards });
          if (out.chips.length) send({ t: "chips", chips: out.chips });
        } catch (e) {
          if (!req.signal.aborted) {
            const msg = e instanceof Anthropic.APIError ? `AI 服务错误 ${e.status}` : (e as Error).name;
            console.error("chat ai failed:", msg);
          }
          if (streamed) send({ t: "revert" });
        } finally {
          clearTimeout(firstToken);
          clearTimeout(total);
        }
      }
      send({ t: "done" });
      try {
        controller.close();
      } catch {}
    },
    cancel() {
      ctrl.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
