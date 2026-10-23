import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";

// 体型分析（D56）：Claude 调用全部用注入的假函数，fetch 一律失败——不访问 Anthropic、Avatar SDK 或任何外部服务。
// 测试图片由代码生成（纯色 PNG），不含任何真人照片。
const dir = mkdtempSync(path.join(tmpdir(), "sc-body-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.FAL_KEY;
process.env.AVATAR3D_PROVIDER = "metaperson";
process.env.AVATAR3D_ALLOW_METAPERSON = "1";
process.env.AVATARSDK_CLIENT_ID = "test-client-id";
process.env.AVATARSDK_CLIENT_SECRET = "test-client-secret";
process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";

type Mods = {
  db: typeof import("@/lib/db");
  body: typeof import("./body");
  service: typeof import("./service");
  providers: typeof import("./providers");
  testing: typeof import("./testing");
};
let m: Mods;
const realFetch = globalThis.fetch;
let fetchCalls = 0;

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    body: await import("./body"),
    service: await import("./service"),
    providers: await import("./providers"),
    testing: await import("./testing"),
  };
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error("network disabled in tests");
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

type Call = Parameters<import("./body").ModelCall>[0];
function fakeModel(out: import("./body").ModelBody | null | Error) {
  const calls: Call[] = [];
  const fn = async (input: Call) => {
    calls.push(input);
    if (out instanceof Error) throw out;
    return out;
  };
  return { fn, calls };
}

const MODEL_OUT = {
  gender: "female" as const,
  blends: { Body: 0.12, Neck: -0.07, Shoulders: -0.42, Chest: 0, Forearms: 0.03, Waist: -1.6, Hips: 0.33, Legs: 0.58 },
  summary: "肩线偏窄、腰线较高、腿部比例修长。",
};

// ---------- 纯函数 ----------

test("bmiBlends：只按身高体重粗设 Body/Waist/Hips，其余为 0；缺数据时全部为 0", () => {
  const { bmiBlends } = m.body;
  const avg = bmiBlends(170, 63.6);
  assert.equal(avg.source, "bmi");
  assert.ok(Object.values(avg.blends).every((v) => v === 0));
  const high = bmiBlends(160, 80); // BMI ≈ 31.3
  assert.deepEqual(high.blends, { Body: 1, Neck: 0, Shoulders: 0, Chest: 0, Forearms: 0, Waist: 0.8, Hips: 0.6, Legs: 0 });
  const low = bmiBlends(180, 50); // BMI ≈ 15.4
  assert.equal(low.blends.Body, -0.8);
  assert.equal(low.blends.Waist, -0.65);
  assert.equal(low.blends.Hips, -0.5);
  assert.equal(low.blends.Legs, 0);
  for (const [h, w] of [
    [null, 60],
    [170, null],
    [null, null],
  ] as const) {
    const none = bmiBlends(h, w);
    assert.equal(none.source, "none");
    assert.ok(Object.values(none.blends).every((v) => v === 0));
  }
});

test("cleanSummary：去结尾标点，超过 30 字在顿号处截断，“精准/还原/1:1”之类说法整句丢弃", () => {
  const { cleanSummary } = m.body;
  assert.equal(cleanSummary(" 肩线偏窄、腰线较高。 "), "肩线偏窄、腰线较高");
  const long = "肩线偏窄、腰线较高、腿部比例修长、上半身线条利落、胯部略宽、整体比例匀称舒展";
  const out = cleanSummary(long)!;
  assert.ok(Array.from(out).length <= 30);
  assert.ok(!out.endsWith("、"));
  assert.equal(cleanSummary("精准还原你的身材"), null);
  assert.equal(cleanSummary("1:1 复刻你的比例"), null);
  assert.equal(cleanSummary(""), null);
  assert.equal(cleanSummary(42), null);
});

test("analyzeBody：允许时用 Claude 的结果并裁剪；不允许、失败、拒绝都退化为身高体重，不抛错", async () => {
  const { analyzeBody } = m.body;
  const images = [{ slot: "front" as const, mime: "image/png", base64: "QUJD" }];

  const ok = fakeModel(MODEL_OUT);
  const r = await analyzeBody({ images, heightCm: 165, weightKg: 55, allowClaude: true }, ok.fn);
  assert.equal(ok.calls.length, 1);
  assert.equal(r.source, "claude");
  assert.equal(r.gender, "female");
  assert.deepEqual(r.blends, { Body: 0.1, Neck: -0.05, Shoulders: -0.4, Chest: 0, Forearms: 0.05, Waist: -1, Hips: 0.35, Legs: 0.6 });
  assert.equal(r.summary, "肩线偏窄、腰线较高、腿部比例修长");

  const denied = fakeModel(MODEL_OUT);
  const d = await analyzeBody({ images, heightCm: 160, weightKg: 80, allowClaude: false }, denied.fn);
  assert.equal(denied.calls.length, 0);
  assert.equal(d.source, "bmi");
  assert.equal(d.gender, null);
  assert.equal(d.summary, null);
  assert.equal(d.blends.Body, 1);

  const boom = fakeModel(new Error("APIConnectionError"));
  const b = await analyzeBody({ images, heightCm: 160, weightKg: 80, allowClaude: true }, boom.fn);
  assert.equal(boom.calls.length, 1);
  assert.equal(b.source, "bmi");

  const refused = fakeModel(null);
  const f = await analyzeBody({ images, heightCm: null, weightKg: null, allowClaude: true }, refused.fn);
  assert.equal(f.source, "none");
  assert.ok(Object.values(f.blends).every((v) => v === 0));

  const noFront = fakeModel(MODEL_OUT);
  await analyzeBody({ images: [{ slot: "side", mime: "image/png", base64: "QUJD" }], heightCm: 1, weightKg: 1, allowClaude: true }, noFront.fn);
  assert.equal(noFront.calls.length, 0);
});

// ---------- 同意、存取与删除（PGlite + 本地存储） ----------

async function consent(userId: string, bodyAnalysis: boolean) {
  return m.service.recordConsent(userId, { store: true, thirdParty: true, bodyAnalysis, offerVersion: m.providers.offerVersion() });
}

const png = (w = 600, h = 800) => new File([Buffer.from(m.testing.pngWithMetadata(w, h))], "p.png", { type: "image/png" });

test("同意：体型分析是单独一项；只在 MetaPerson 模式且配置了 key 时提供", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "b1", name: "测试", email: "b1@example.test" });
  let st = await consent("b1", false);
  assert.deepEqual(st.offer.bodyAnalysis, { name: "Anthropic（Claude）" });
  assert.match(st.offer.version, /\+anthropic$/);
  assert.equal(st.consent?.bodyAnalysis, false);
  assert.equal(st.consent?.version, "avatar-consent-v2:store+metaperson");
  st = await consent("b1", true);
  assert.equal(st.consent?.bodyAnalysis, true);
  assert.equal(st.consent?.thirdParty, "metaperson");
  assert.equal(st.consent?.version, "avatar-consent-v2:store+metaperson+anthropic");
  assert.deepEqual(m.providers.parseConsentVersion("avatar-consent-v2:store+metaperson+anthropic"), {
    thirdParty: "metaperson",
    bodyAnalysis: true,
  });
  // 未同意 MetaPerson 时体型分析不单独生效
  assert.equal(m.providers.consentVersionFor(null, true), "avatar-consent-v2:store");

  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const offer = m.providers.offerVersion();
    assert.doesNotMatch(offer, /anthropic/);
    await assert.rejects(
      m.service.recordConsent("b1", { store: true, thirdParty: true, bodyAnalysis: true, offerVersion: offer }),
      (e: Error & { status?: number }) => e.status === 409,
    );
    assert.equal((await m.service.getAvatarState("b1")).offer.bodyAnalysis, null);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("runBodyAnalysis：同意后读取本人全身正面+侧面照与身高体重调用 Claude，结果挂在正面照上并进入页面状态；同一组照片不重复调用", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "b2", name: "测试", email: "b2@example.test" });
  await db.insert(schema.profile).values({ userId: "b2", heightCm: 168, weightKg: 56 });
  await consent("b2", true);
  await m.service.addPhoto("b2", "face", png(600, 600));
  await m.service.addPhoto("b2", "front", png());
  let st = await m.service.addPhoto("b2", "side", png());
  assert.equal(st.bodyAnalysis, null);

  const model = fakeModel(MODEL_OUT);
  const r = await m.body.runBodyAnalysis("b2", { consented: true }, model.fn);
  assert.equal(model.calls.length, 1);
  const call = model.calls[0];
  assert.deepEqual(
    call.images.map((i) => i.slot),
    ["front", "side"],
  );
  assert.ok(call.images.every((i) => i.mime === "image/png" && i.base64.length > 100));
  assert.equal(call.heightCm, 168);
  assert.equal(call.weightKg, 56);
  assert.equal(r.source, "claude");
  assert.equal(r.summary, "肩线偏窄、腰线较高、腿部比例修长");

  st = await m.service.getAvatarState("b2");
  assert.equal(st.bodyAnalysis?.summary, "肩线偏窄、腰线较高、腿部比例修长");
  assert.equal(st.bodyAnalysis?.gender, "female");
  // 质量提示不受影响
  assert.ok(st.photos.every((p) => Array.isArray(p.hints)));

  await m.body.runBodyAnalysis("b2", { consented: true }, model.fn);
  assert.equal(model.calls.length, 1, "同一组照片应直接返回已存结果");

  // 换了侧面照：重新分析
  await m.service.addPhoto("b2", "side", png(620, 820));
  assert.equal((await m.service.getAvatarState("b2")).bodyAnalysis, null);
  await m.body.runBodyAnalysis("b2", { consented: true }, model.fn);
  assert.equal(model.calls.length, 2);

  // 删除正面照：软删除的记录上不再保留体型分析（D47：派生数据随照片删除）
  st = await m.service.getAvatarState("b2");
  assert.ok(st.bodyAnalysis);
  const frontId = st.photos.find((p) => p.slot === "front")!.id;
  st = await m.service.deletePhoto("b2", frontId);
  const [row] = await db.select().from(schema.avatarPhoto).where(eq(schema.avatarPhoto.id, frontId));
  assert.ok(row.deletedAt);
  assert.equal((row.qualityFlags as Record<string, unknown>).bodyAnalysis, undefined);
  assert.equal((row.qualityFlags as Record<string, unknown>).lowResolution, false);
  assert.equal(st.bodyAnalysis, null);
  assert.equal(fetchCalls, 0);
});

test("runBodyAnalysis：未单独同意或没有 key 时不调用 Claude，只按身高体重且不存；撤回同意后删除已存的结果", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "b3", name: "测试", email: "b3@example.test" });
  await db.insert(schema.profile).values({ userId: "b3", heightCm: 160, weightKg: 80 });
  await consent("b3", true);
  await m.service.addPhoto("b3", "face", png(600, 600));
  const st = await m.service.addPhoto("b3", "front", png());
  const frontId = st.photos.find((p) => p.slot === "front")!.id;
  const storedOnFront = async () => {
    const [row] = await db.select().from(schema.avatarPhoto).where(eq(schema.avatarPhoto.id, frontId));
    return (row.qualityFlags as Record<string, unknown>).bodyAnalysis;
  };

  const model = fakeModel(MODEL_OUT);
  await m.body.runBodyAnalysis("b3", { consented: true }, model.fn);
  assert.equal(model.calls.length, 1);
  assert.ok(await storedOnFront());

  // 撤回体型分析同意
  await consent("b3", false);
  assert.equal((await m.service.getAvatarState("b3")).bodyAnalysis, null);
  const r = await m.body.runBodyAnalysis("b3", { consented: false }, model.fn);
  assert.equal(model.calls.length, 1);
  assert.equal(r.source, "bmi");
  assert.equal(r.blends.Body, 1);
  assert.equal(r.summary, null);
  assert.equal(await storedOnFront(), undefined, "撤回同意后不再保留 Claude 结果，身高体重估算也不存");

  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const r2 = await m.body.runBodyAnalysis("b3", { consented: true }, model.fn);
    assert.equal(model.calls.length, 1);
    assert.equal(r2.source, "bmi");
    assert.equal(await storedOnFront(), undefined);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }

  // 身高体重变了：重新估算；清空后全部为 0
  await db.update(schema.profile).set({ weightKg: 64 }).where(eq(schema.profile.userId, "b3"));
  const r3 = await m.body.runBodyAnalysis("b3", { consented: false }, model.fn);
  assert.ok(r3.blends.Body < 1);
  await db.update(schema.profile).set({ heightCm: null, weightKg: null }).where(eq(schema.profile.userId, "b3"));
  const r4 = await m.body.runBodyAnalysis("b3", { consented: false }, model.fn);
  assert.equal(r4.source, "none");
  assert.ok(Object.values(r4.blends).every((v) => v === 0));
  assert.equal(fetchCalls, 0);
});

test("callClaude：请求形状（模型、结构化输出、图片块）与解析——fetch 换成本地假响应，不访问网络", async () => {
  let captured: { url: string; body: Record<string, unknown> } | null = null;
  const prev = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    captured = { url, body: JSON.parse(String(init?.body)) };
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(MODEL_OUT) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const out = await m.body.callClaude({
      images: [
        { slot: "front", mime: "image/jpeg", base64: "QUJD" },
        { slot: "side", mime: "image/png", base64: "REVG" },
      ],
      heightCm: 170,
      weightKg: 60,
    });
    assert.deepEqual(out, MODEL_OUT);
    const c = captured as unknown as { url: string; body: Record<string, unknown> };
    assert.match(c.url, /\/v1\/messages/);
    assert.equal(c.body.model, "claude-opus-5-5");
    const oc = c.body.output_config as { effort: string; format: { type: string } };
    assert.equal(oc.effort, "low");
    assert.equal(oc.format.type, "json_schema");
    const content = (c.body.messages as { content: { type: string; source?: { media_type: string } }[] }[])[0].content;
    assert.deepEqual(
      content.filter((b) => b.type === "image").map((b) => b.source?.media_type),
      ["image/jpeg", "image/png"],
    );
    assert.ok(content.some((b) => b.type === "text" && JSON.stringify(b).includes("身高 170 cm")));
  } finally {
    globalThis.fetch = prev;
  }
});

// ---------- 多语言（D70）：英文界面的概括 ----------

const MODEL_OUT_EN = { ...MODEL_OUT, summary: "Narrow shoulders, a high waist and long legs." };
const CJK = /[㐀-鿿]/;

test("英文概括：cleanSummary 保留词间空格，过长时在逗号处截断，夸大说法或夹带中文时整句丢弃", () => {
  const { cleanSummary } = m.body;
  assert.equal(cleanSummary("  Narrow shoulders,  a high waist. ", "en"), "Narrow shoulders, a high waist");
  const long = "Narrow shoulders, a high waist, long legs, a straight upper body, slightly wider hips and balanced overall proportions";
  const out = cleanSummary(long, "en")!;
  assert.ok(out.length <= 90 && !out.endsWith(","), out);
  assert.ok(long.startsWith(out));
  assert.equal(cleanSummary("A precise replica of your figure", "en"), null);
  assert.equal(cleanSummary("Your proportions, 1:1", "en"), null);
  assert.equal(cleanSummary("肩线偏窄、腰线较高", "en"), null, "英文界面不显示中文概括");
  assert.equal(cleanSummary("肩线偏窄、腰线较高。"), "肩线偏窄、腰线较高", "中文默认不变");
});

test("英文界面：系统提示要求英文概括，其余规则不变；中文提示词不变", () => {
  const zh = m.body.bodySystemPrompt();
  const en = m.body.bodySystemPrompt("en");
  assert.match(zh, /summary 用中文写一句不超过 30 字/);
  assert.doesNotMatch(en, /summary 用中文写/);
  assert.match(en, /summary 用英文（English）写/);
  assert.equal(en.split("\n").length, zh.split("\n").length);
  assert.match(en, /4\. 不识别、不描述人物身份/);
});

test("runBodyAnalysis 英文：概括用英文、记下语言；换回中文时重新分析一次；接口边界只显示与界面同语言的概括", async () => {
  const { db, schema } = m.db;
  const { localizeAvatarState, localizeBodyAnalysis } = await import("./l10n");
  await db.insert(schema.user).values({ id: "b5", name: "测试", email: "b5@example.test" });
  await db.insert(schema.profile).values({ userId: "b5", heightCm: 170, weightKg: 60 });
  await consent("b5", true);
  await m.service.addPhoto("b5", "face", png(600, 600));
  await m.service.addPhoto("b5", "front", png());

  const en = fakeModel(MODEL_OUT_EN);
  const r = await m.body.runBodyAnalysis("b5", { consented: true, locale: "en" }, en.fn);
  assert.equal(en.calls.length, 1);
  assert.equal(en.calls[0].locale, "en");
  assert.equal(r.summary, "Narrow shoulders, a high waist and long legs");
  assert.equal(r.lang, "en");
  await m.body.runBodyAnalysis("b5", { consented: true, locale: "en" }, en.fn);
  assert.equal(en.calls.length, 1, "同一组照片、同一语言直接返回已存结果");

  let st = await m.service.getAvatarState("b5");
  assert.equal(st.bodyAnalysis?.lang, "en");
  assert.equal(localizeAvatarState(st, "en").bodyAnalysis?.summary, "Narrow shoulders, a high waist and long legs");
  assert.equal(localizeAvatarState(st, "zh").bodyAnalysis?.summary, null, "中文界面不显示英文概括");
  assert.deepEqual(localizeAvatarState(st, "zh").bodyAnalysis?.blends, st.bodyAnalysis?.blends);

  // 英文界面的其他文字：处理方、体型分析名称、照片质量提示都是英文
  const view = localizeAvatarState(st, "en");
  assert.equal(view.offer.bodyAnalysis?.name, "Anthropic (Claude)");
  for (const p of [view.provider, view.offer.thirdParty!]) {
    assert.ok(!CJK.test(p.name) && !CJK.test(p.processor), `${p.name}: ${p.processor}`);
  }
  for (const h of view.photos.flatMap((p) => p.hints)) assert.ok(!CJK.test(h), h);
  // lib 里的视图仍是中文原文
  assert.equal(st.offer.bodyAnalysis?.name, "Anthropic（Claude）");

  // 换回中文：重新分析一次并覆盖
  const zh = fakeModel(MODEL_OUT);
  const z = await m.body.runBodyAnalysis("b5", { consented: true }, zh.fn);
  assert.equal(zh.calls.length, 1);
  assert.equal(z.lang, "zh");
  assert.equal(z.summary, "肩线偏窄、腰线较高、腿部比例修长");
  st = await m.service.getAvatarState("b5");
  assert.equal(localizeBodyAnalysis(st.bodyAnalysis!, "en").summary, null);
  assert.equal(localizeBodyAnalysis(st.bodyAnalysis!, "zh").summary, "肩线偏窄、腰线较高、腿部比例修长");
  assert.equal(fetchCalls, 0);
});

test("callClaude 英文：系统提示与结构化输出的说明都要求英文概括（fetch 换成本地假响应）", async () => {
  let captured: Record<string, unknown> | null = null;
  const prev = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    captured = JSON.parse(String(init?.body));
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(MODEL_OUT_EN) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const out = await m.body.callClaude({ images: [{ slot: "front", mime: "image/png", base64: "QUJD" }], heightCm: 170, weightKg: null, locale: "en" });
    assert.deepEqual(out, MODEL_OUT_EN);
    const body = captured as unknown as { system: string; output_config: { format: unknown } };
    assert.match(body.system, /summary 用英文（English）写/);
    assert.match(JSON.stringify(body.output_config.format), /in English/);
  } finally {
    globalThis.fetch = prev;
  }
});

test("作业视图英文：失败说明、说明文字与徽标按界面语言；中文原样", async () => {
  const { localizeJobView } = await import("./l10n");
  const job = {
    id: "j1",
    status: "failed" as const,
    provider: "mock",
    isMock: true,
    glbUrl: null,
    resultDeleted: false,
    fidelityNote: "示意模型，非本人：未使用照片生成，仅为通用人台。合身未验证。",
    badges: m.service.badgesFor(true),
    error: { code: "PROVIDER_FAILED", message: "生成服务暂时不可用（503）" },
    remotePurge: null,
    elapsedSeconds: 3,
    createdAt: "",
    updatedAt: "",
  };
  const en = localizeJobView(job, "en");
  assert.equal(en.error?.message, "The generation service is temporarily unavailable (503).");
  assert.equal(en.error?.code, "PROVIDER_FAILED");
  assert.deepEqual(en.badges, ["Demo model"]);
  assert.ok(en.fidelityNote && !CJK.test(en.fidelityNote));
  assert.deepEqual(localizeJobView(job, "zh"), job);
});
