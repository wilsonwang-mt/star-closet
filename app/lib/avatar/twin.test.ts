import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

// 数字分身（D63）：全部用 mock fetch 与 mock 分析，不访问 fal 或 Anthropic；照片与“生成结果”都是程序生成的纯色 PNG，不含真人。
const dir = mkdtempSync(path.join(tmpdir(), "sc-twin-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.AVATAR3D_PROVIDER;
delete process.env.AVATARSDK_CLIENT_ID;
process.env.FAL_KEY = "test-fal-key";
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.TWIN_QUEUE_POLL_MS = "1";

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let failAngle: string | null = null;
let failTimes = 0;
const realFetch = globalThis.fetch;

type Mods = {
  db: typeof import("@/lib/db");
  providers: typeof import("./providers");
  service: typeof import("./service");
  twin: typeof import("./twin");
  testing: typeof import("./testing");
};
let m: Mods;

const RESULT = () => m.testing.pngWithMetadata(30, 40, [220, 210, 190]);

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    providers: await import("./providers"),
    service: await import("./service"),
    twin: await import("./twin"),
    testing: await import("./testing"),
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit") {
      const prompt = String(body?.prompt ?? "");
      const angle = prompt.includes("front view") ? "front" : prompt.includes("three-quarter view") ? "side" : "back";
      if (angle === failAngle && failTimes > 0) {
        failTimes--;
        return new Response("err", { status: 500 });
      }
      const base = `https://queue.fal.run/fal-ai/nano-banana-pro/requests/${angle}`;
      return Response.json({ status: "IN_QUEUE", status_url: `${base}/status`, response_url: base });
    }
    if (url.startsWith("https://queue.fal.run/fal-ai/nano-banana-pro/requests/")) {
      if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
      const angle = url.split("/").at(-1);
      return Response.json({ images: [{ url: `https://v3.fal.media/files/${angle}.png` }] });
    }
    if (url.startsWith("https://v3.fal.media/files/")) return new Response(Buffer.from(RESULT()));
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});

beforeEach(() => {
  calls = [];
  failAngle = null;
  failTimes = 0;
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const analyze = async () => ({
  summary: "肩线平直、腰线较高、腿部比例修长",
  gender: "female" as const,
  hair: "齐肩直发",
  hairColor: "深棕色",
  faceShape: "鹅蛋脸",
  skinTone: "自然暖调",
  bodyType: "匀称",
  shoulders: "肩线平直",
  waist: "腰线较高",
  hips: "看不清",
  legs: "腿部修长",
  glasses: true,
  descriptorEn: "Shoulder-length straight dark brown hair, oval face, wears thin round glasses, balanced proportions.",
});

async function userWithPhotos(id: string, slots: string[], bodyAnalysis = true) {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id, name: "测试", email: `${id}@example.test` });
  const st = await m.service.recordConsent(id, { store: true, thirdParty: true, bodyAnalysis, offerVersion: m.providers.offerVersion() });
  assert.equal(st.mode, "twin");
  assert.equal(st.consent?.thirdParty, "twin");
  for (const slot of slots) {
    const png = m.testing.pngWithMetadata(64, 96);
    await m.service.addPhoto(id, slot, new File([Buffer.from(png)], `${slot}.png`, { type: "image/png" }));
  }
}

test("twinEnabled：FAL_KEY 且 AVATAR3D_PROVIDER 未设或为 twin；同意版本可往返解析", () => {
  const { twinEnabled, consentVersionFor, parseConsentVersion, thirdPartyInfo } = m.providers;
  assert.equal(twinEnabled(), true);
  assert.equal(thirdPartyInfo()?.id, "twin");
  process.env.AVATAR3D_PROVIDER = "tripo_fal";
  assert.equal(twinEnabled(), false);
  process.env.AVATAR3D_PROVIDER = "twin";
  assert.equal(twinEnabled(), true);
  delete process.env.AVATAR3D_PROVIDER;
  assert.deepEqual(parseConsentVersion(consentVersionFor("twin", true)), { thirdParty: "twin", bodyAnalysis: true });
  assert.deepEqual(parseConsentVersion(consentVersionFor("twin", false)), { thirdParty: "twin", bodyAnalysis: false });
});

test("referenceSentence：按实际参考图描述，连续的全身照合并", () => {
  const { referenceSentence } = m.twin;
  assert.equal(
    referenceSentence(["face", "extra", "front", "side"], "her"),
    "Reference 1 is her frontal face close-up, reference 2 her side profile, references 3 and 4 her full body.",
  );
  assert.equal(referenceSentence(["face", "front", "side", "back"], "his"), "Reference 1 is his frontal face close-up, references 2 and 3 his full body, reference 4 an additional photo of him.");
});

test("上传：数字分身模式收 face/front/extra/side/back，照片自上传起 30 天到期", async () => {
  await userWithPhotos("u-up", ["face", "front", "extra", "side", "back"]);
  const st = await m.service.getAvatarState("u-up");
  assert.equal(st.photos.length, 5);
  assert.ok(st.photos.every((p) => p.expiresAt));
  assert.equal(st.canGenerate, true);
});

test("generateTwin：分析 + 三张并行生成，存私有存储并可经契约函数读取", async () => {
  await userWithPhotos("u1", ["face", "front", "extra"]);
  const { jobId } = await m.twin.generateTwin("u1", { gender: "female" }, { analyze });
  const fal = calls.filter((c) => c.url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit");
  assert.equal(fal.length, 3);
  for (const c of fal) {
    assert.equal((c.body!.image_urls as string[]).length, 3, "参考图为全部已上传照片");
    assert.ok((c.body!.image_urls as string[]).every((u) => u.startsWith("data:image/jpeg;base64,")), "参考图压成 JPEG data URI");
    assert.equal(c.body!.aspect_ratio, "3:4");
    assert.equal(c.body!.resolution, "2K");
    assert.match(String(c.body!.prompt), /SAME woman/);
    assert.match(String(c.body!.prompt), /Reference 1 is her frontal face close-up, reference 2 her side profile, reference 3 her full body\./);
    assert.match(String(c.body!.prompt), /plain white fitted short-sleeve crew-neck t-shirt/);
    assert.match(String(c.body!.prompt), /Wearing the same glasses as in the reference/);
    assert.match(String(c.body!.prompt), /thin round glasses/);
  }

  const twin = await m.twin.getTwin("u1");
  assert.ok(twin);
  assert.equal(twin.jobId, jobId);
  assert.equal(twin.images.front, `u1/avatars/twin-${jobId}-front.png`);
  assert.ok(twin.images.side && twin.images.back);
  assert.equal(twin.gender, "female");
  assert.equal(twin.summary, "肩线平直、腰线较高、腿部比例修长");
  assert.equal(twin.traits?.glasses, "戴眼镜");
  assert.equal(twin.traits?.hips, undefined, "看不清的特征不显示");
  assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, twin.images.front)));

  const uri = await m.twin.readTwinImageDataUri(twin.images.front);
  assert.ok(uri.startsWith("data:image/png;base64,"));
  const refs = await m.twin.getIdentityRefs("u1");
  assert.equal(refs.length, 3, "分身正面 + 正脸 + 侧脸");

  const st = await m.service.getAvatarState("u1");
  assert.equal(st.twin?.shots.length, 3);
  assert.equal(st.twin?.shots[0].angle, "front");
  assert.ok(st.twin?.tags.includes("齐肩直发"));
  assert.equal(st.job?.provider, "twin");
  assert.equal(st.job?.isMock, false);
});

test("重新生成：侧面失败一次会重试；成功后删除旧分身文件", async () => {
  const old = (await m.twin.getTwin("u1"))!;
  failAngle = "side";
  failTimes = 1;
  await m.twin.generateTwin("u1", { gender: "female" }, { analyze });
  const sideCalls = calls.filter((c) => c.url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit" && String(c.body?.prompt).includes("three-quarter view"));
  assert.equal(sideCalls.length, 2);
  const now = (await m.twin.getTwin("u1"))!;
  assert.notEqual(now.jobId, old.jobId);
  assert.ok(now.images.side);
  for (const k of [old.images.front, old.images.side!, old.images.back!]) {
    assert.equal(existsSync(path.join(process.env.UPLOADS_DIR!, k)), false, "旧分身文件已删除");
  }
});

test("侧面两次都失败：仍成功，side 为空；正面失败则整次失败并保留旧分身", async () => {
  const before = (await m.twin.getTwin("u1"))!;
  failAngle = "side";
  failTimes = 2;
  await m.twin.generateTwin("u1", { gender: "female" }, { analyze });
  const t = (await m.twin.getTwin("u1"))!;
  assert.equal(t.images.side, null);
  assert.notEqual(t.jobId, before.jobId);

  failAngle = "front";
  failTimes = 2;
  await assert.rejects(m.twin.generateTwin("u1", { gender: "female" }, { analyze }), /生成服务暂时不可用/);
  const kept = (await m.twin.getTwin("u1"))!;
  assert.equal(kept.jobId, t.jobId, "失败的重新生成不影响现有形象");
  assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, kept.images.front)));
});

test("未同意照片分析：不调用分析；未选性别时报错", async () => {
  await userWithPhotos("u2", ["face", "front"], false);
  let called = 0;
  const spy = async () => {
    called++;
    return analyze();
  };
  await assert.rejects(m.twin.generateTwin("u2", {}, { analyze: spy }), /性别/);
  await m.twin.generateTwin("u2", { gender: "male" }, { analyze: spy });
  assert.equal(called, 0);
  const t = (await m.twin.getTwin("u2"))!;
  assert.equal(t.summary, null);
  assert.equal(t.gender, "male");
  const prompt = String(calls.filter((c) => c.url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit").at(-1)?.body?.prompt);
  assert.match(prompt, /SAME man/);
  assert.match(prompt, /plain white sneakers/);
  assert.match(prompt, /Reference 1 is his frontal face close-up, reference 2 his full body\./);
  assert.doesNotMatch(prompt, /glasses/);
});

test("缺正脸照不能生成；未同意第三方不能生成", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "u3", name: "测试", email: "u3@example.test" });
  await assert.rejects(m.twin.generateTwin("u3", { gender: "female" }), /同意/);
  await m.service.recordConsent("u3", { store: true, thirdParty: true, offerVersion: m.providers.offerVersion() });
  await m.service.addPhoto("u3", "front", new File([Buffer.from(m.testing.pngWithMetadata())], "f.png", { type: "image/png" }));
  await assert.rejects(m.twin.generateTwin("u3", { gender: "female" }), /正脸/);
});

test("删除这个形象 / 一键删除：清掉分身图片与记录", async () => {
  const t = (await m.twin.getTwin("u2"))!;
  await m.service.deleteResult("u2", t.jobId);
  assert.equal(await m.twin.getTwin("u2"), null);
  assert.equal(existsSync(path.join(process.env.UPLOADS_DIR!, t.images.front)), false);

  const t1 = (await m.twin.getTwin("u1"))!;
  await m.service.deleteAll("u1");
  assert.equal(await m.twin.getTwin("u1"), null);
  assert.equal(existsSync(path.join(process.env.UPLOADS_DIR!, t1.images.front)), false);
  const { db, schema } = m.db;
  const rows = await db.select().from(schema.avatarJob).where(eq(schema.avatarJob.userId, "u1"));
  assert.ok(rows.every((r) => r.resultImages === null));
  assert.equal((await m.service.getAvatarState("u1")).twin, null);
});

test("生成中的分身作业：轮询 tickJob 不会把它改成失败；超过 270 秒视为中断；进行中再次生成返回 409", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "u4", name: "测试", email: "u4@example.test" });
  await m.service.recordConsent("u4", { store: true, thirdParty: true, offerVersion: m.providers.offerVersion() });
  const id = "11111111-2222-4333-8444-555555555555";
  await db.insert(schema.avatarJob).values({ id, userId: "u4", status: "processing", provider: "twin" });
  const v = await m.service.tickJob("u4", id);
  assert.equal(v?.status, "processing");
  await assert.rejects(m.twin.generateTwin("u4", { gender: "female" }), /正在生成/);
  await db
    .update(schema.avatarJob)
    .set({ updatedAt: new Date(Date.now() - 300_000), createdAt: new Date(Date.now() - 300_000) })
    .where(eq(schema.avatarJob.id, id));
  const st = await m.service.getAvatarState("u4");
  assert.equal(st.job?.status, "failed");
  assert.match(st.job?.error?.message ?? "", /中断/);
});
