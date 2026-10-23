import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { streamChatAi, hasChatAi } from "@/lib/chat/ai";
import { availablePages, closetCard, getChatCatalog, outfitCard, pageCard, type ChatCatalog } from "@/lib/chat/catalog";
import { describePage, describeUser, hasOwnSignal, resolvePage, rulesHint } from "@/lib/chat/context";
import { CHAT_MAX_INPUT, type ChatCard, type ChatEvent } from "@/lib/chat/protocol";
import { getChatUser } from "@/lib/chat/user";
import { emptyQuery, locate, parseQuery, type LocateQuery, type LocateResult } from "@/lib/locate/core";

export const dynamic = "force-dynamic";
// 流式回复可能持续十几秒（审美类问题模型会多想）；不设时用平台默认时限，可能在 AI 回来前被掐断
export const maxDuration = 60;

// 悬浮对话（D66；D68 动态化）。返回 NDJSON 流：
//   1. understood —— 立刻返回这句话里识别到的条件（“理解行”）和解析出的查询；不是回复本身，没识别到时为空；
//   2. delta… —— Claude 的回复逐段流出，形态随意图而变（闲聊、建议、找搭配、答细节、指路、追问）；
//   3. cards / chips —— 每完成一次工具调用推一次（已按目录与性别校验）；
//   4. done。
// 没有 ANTHROPIC_API_KEY、AI 超时或出错时发 fallback：这句本身有找衣服条件就给规则层结果，追问类给一句“没接上”，
// 不再拿上一轮的旧卡片充数；已流出半截文字先发 revert 撤回。界面不显示“规则模式”（D48）。
// 用户的话只在内存里用于这次请求：不落库；日志只记耗时、速度、卡片数等，不记正文。身体数据不读、不发（见 lib/chat/user.ts）。

// 审美类的话（如“暖一点的颜色”）模型会多想一会儿，实测首字约 10 秒
const FIRST_TOKEN_MS = 15_000;
const TOTAL_MS = 40_000;

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
  path: z.string().max(300).optional(),
});

function rulesCards(r: LocateResult, catalog: ChatCatalog): ChatCard[] {
  const cards: ChatCard[] = [];
  const top = r.closets[0];
  if (top) cards.push(closetCard(top.closet));
  for (const s of r.outfits.slice(0, 4)) cards.push(outfitCard(s.outfit, catalog.closets));
  const allowed = new Set(availablePages());
  for (const p of r.pages) if (allowed.has(p)) cards.push(pageCard(p));
  return cards;
}

/** 没有 AI 或 AI 失败时的回复。追问类（这句本身没有找衣服条件）不拿上一轮的旧卡片充数。 */
function fallbackReply(rules: LocateResult, catalog: ChatCatalog, own: boolean, followUp: boolean, failed: boolean) {
  if (own || !followUp) return { text: rules.text, cards: rulesCards(rules, catalog), chips: rules.chips };
  return failed
    ? { text: "刚才没接上，再说一次试试？", cards: [], chips: [] }
    : { text: "这个我暂时答不上来。说说场合、风格或预算，我帮你找搭配。", cards: [], chips: rules.chips };
}

export async function POST(req: Request) {
  const started = Date.now();
  // 登录用户的档案偏好与状态：与目录读取并行，不挡住第一行
  const userP = getCurrentUser()
    .then((u) => getChatUser(u?.id ?? null))
    .catch(() => null);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请说一句你的需求" }, { status: 400 });
  const history = parsed.data.messages.map((m) => (m.role === "user" ? { ...m, text: m.text.slice(0, CHAT_MAX_INPUT) } : m));
  const latest = [...history].reverse().find((m) => m.role === "user")?.text.trim();
  if (!latest) return NextResponse.json({ error: "请说一句你的需求" }, { status: 400 });

  let catalog: ChatCatalog;
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
  const own = hasOwnSignal(latest, catalog);
  const followUp = Boolean(lastAssistant);
  const page = resolvePage(parsed.data.path, catalog);

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
      // 理解行：只显示这句话本身带出的条件（追问“为什么”时不重复上一轮的条件）
      send({ t: "understood", labels: own ? query.labels : [], query });

      const tag = `signal=${own ? 1 : 0} page=${page.kind}`;
      if (!hasChatAi()) {
        const fb = fallbackReply(rules, catalog, own, followUp, false);
        send({ t: "fallback", ...fb });
      } else {
        let streamed = false;
        let firstMs = 0;
        const firstToken = setTimeout(() => ctrl.abort(), FIRST_TOKEN_MS);
        const total = setTimeout(() => ctrl.abort(), TOTAL_MS);
        const first = () => {
          if (firstMs) return;
          firstMs = Date.now() - started;
          clearTimeout(firstToken);
        };
        try {
          const user = await userP;
          const context = [describePage(page, catalog), describeUser(user), own ? rulesHint(rules) : ""].filter(Boolean).join("\n");
          const out = await streamChatAi({
            catalog,
            history,
            context,
            query,
            signal: ctrl.signal,
            onText: (d) => {
              first();
              streamed = true;
              send({ t: "delta", d });
            },
            onCards: (cards) => {
              first();
              send({ t: "cards", cards });
            },
            onChips: (chips) => {
              first();
              send({ t: "chips", chips });
            },
          });
          // 模型偶尔只给卡片或追问、一句话都没写：补一句，免得看起来像空回复（保留它给的卡片与追问）
          if (!out.wroteText) {
            const fb = fallbackReply(rules, catalog, own, followUp, false);
            const text = out.cards.length ? "先看看这几样：" : fb.text;
            send({ t: "fallback", text, cards: out.cards.length ? out.cards : fb.cards, chips: out.chips.length ? out.chips : fb.chips });
          }
          console.info(
            `chat ok speed=${out.speed ?? "?"} first=${firstMs}ms total=${Date.now() - started}ms cards=${out.cards.length} chips=${out.chips.length} tooltext=${out.textToolCalls} notext=${out.wroteText ? 0 : 1} ${tag}`,
          );
        } catch (e) {
          const msg = req.signal.aborted
            ? "client-closed"
            : e instanceof Anthropic.APIError
              ? `api-${e.status}`
              : ctrl.signal.aborted
                ? "timeout"
                : (e as Error).name;
          console.error(`chat ai failed (${msg}) first=${firstMs}ms total=${Date.now() - started}ms fallback=1 ${tag}`);
          if (streamed) send({ t: "revert" });
          send({ t: "fallback", ...fallbackReply(rules, catalog, own, followUp, true) });
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
