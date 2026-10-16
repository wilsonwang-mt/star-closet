import assert from "node:assert/strict";
import { test } from "node:test";
import { pollDelay, waitFirst } from "@/components/tryon/shared";
import type { TryonView } from "./service";

// 前端轮询节奏（components/tryon/shared.tsx）：间隔按两次请求的开始时间计。fetch 被替换，不访问网络。

test("pollDelay：扣掉上一次请求的耗时，至少留 150 ms", () => {
  assert.equal(pollDelay(1000, 0), 1000);
  assert.equal(pollDelay(1000, 300), 700);
  assert.equal(pollDelay(1000, 1400), 150);
});

test("waitFirst：每次轮询本身很慢时，开始到开始的间隔仍约为 pollMs，而不是 pollMs + 请求耗时", async () => {
  const LATENCY = 150;
  const POLL = 300;
  const starts: number[] = [];
  const base = { id: "t1", status: "processing", resultUrl: null, stage: "generating" } as unknown as TryonView;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), "/api/tryon/t1");
    starts.push(Date.now());
    await new Promise((r) => setTimeout(r, LATENCY));
    const done = starts.length >= 5;
    const view = done ? { ...base, status: "succeeded", resultUrl: "/api/avatar/files/x", stage: "done" } : base;
    return new Response(JSON.stringify(view), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const v = await waitFirst(base, { alive: () => true, pollMs: POLL });
    assert.equal(v.status, "succeeded");
  } finally {
    globalThis.fetch = realFetch;
  }
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  assert.equal(gaps.length, 4);
  for (const g of gaps) {
    assert.ok(g >= POLL - 20, `间隔 ${g} ms 不应短于 pollMs`);
    assert.ok(g < POLL + LATENCY / 2, `间隔 ${g} ms 不应再加上请求耗时（改前约 ${POLL + LATENCY} ms）`);
  }
});
