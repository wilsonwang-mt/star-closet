import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";

// MetaPerson 接入：全部用 mock fetch，不访问任何外部服务；GLB 用程序生成的人台，不含任何真人数据。
const dir = mkdtempSync(path.join(tmpdir(), "sc-mp-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.FAL_KEY;
process.env.AVATAR3D_PROVIDER = "metaperson";
process.env.AVATARSDK_CLIENT_ID = "test-client-id";
process.env.AVATARSDK_CLIENT_SECRET = "test-client-secret";
delete process.env.AVATARSDK_EXPORT_HOSTS;

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let handler: (url: string, init?: RequestInit) => Response | Promise<Response> = () => {
  throw new Error("unexpected fetch");
};
const realFetch = globalThis.fetch;

type Mods = {
  db: typeof import("@/lib/db");
  mp: typeof import("./metaperson");
  proto: typeof import("./metaperson-protocol");
  providers: typeof import("./providers");
  service: typeof import("./service");
  mannequin: typeof import("./mannequin");
};
let m: Mods;

before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  m = {
    db,
    mp: await import("./metaperson"),
    proto: await import("./metaperson-protocol"),
    providers: await import("./providers"),
    service: await import("./service"),
    mannequin: await import("./mannequin"),
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
});

beforeEach(() => {
  calls = [];
  m?.mp.resetTokenCache();
});

after(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

const tokenResponse = (token = "tok-1", expires = 36000) =>
  new Response(JSON.stringify({ access_token: token, expires_in: expires, token_type: "Bearer" }), {
    headers: { "content-type": "application/json" },
  });

// ---------- 协议（浏览器端共用） ----------

test("parseMpMessage：只接受白名单来源且 source 正确的消息", () => {
  const { parseMpMessage } = m.proto;
  const ok = "https://metaperson.avatarsdk.com";
  assert.deepEqual(parseMpMessage(ok, { source: "metaperson_creator", eventName: "metaperson_creator_loaded" }), {
    eventName: "metaperson_creator_loaded",
  });
  assert.equal(parseMpMessage("https://evil.example", { source: "metaperson_creator", eventName: "metaperson_creator_loaded" }), null);
  assert.equal(parseMpMessage(ok, { source: "other", eventName: "metaperson_creator_loaded" }), null);
  assert.equal(parseMpMessage(ok, "string"), null);
  const exported = parseMpMessage("https://mobile.metaperson.avatarsdk.com", {
    source: "metaperson_creator",
    eventName: "model_exported",
    url: "https://x.avatarsdk.com/a.glb",
    avatarCode: "abc-123",
    gender: "female",
  });
  assert.equal(exported?.eventName, "model_exported");
  assert.equal(parseMpMessage(ok, { source: "metaperson_creator", eventName: "model_exported", url: 1, avatarCode: "a" }), null);
  const avail = parseMpMessage(ok, {
    source: "metaperson_creator",
    eventName: "action_availability_changed",
    actionName: "avatar_export",
    isAvailable: true,
  });
  assert.deepEqual(avail, { eventName: "action_availability_changed", actionName: "avatar_export", isAvailable: true });
  // 桌面版创建器 1.42.0 实测发数字 1/0
  const numeric = (v: number) =>
    parseMpMessage(ok, { source: "metaperson_creator", eventName: "action_availability_changed", actionName: "avatar_export", isAvailable: v });
  assert.deepEqual(numeric(1), { eventName: "action_availability_changed", actionName: "avatar_export", isAvailable: true });
  assert.deepEqual(numeric(0), { eventName: "action_availability_changed", actionName: "avatar_export", isAvailable: false });
});

test("setupMessages / creatorUrl：只发 accessToken；隐藏创建器自带的取图入口与示例形象（D56）", () => {
  const { setupMessages, creatorUrl, exportMessage } = m.proto;
  const desk = setupMessages("tok", false);
  assert.deepEqual(desk[0], { eventName: "authenticate", accessToken: "tok" });
  assert.deepEqual(desk[1], { eventName: "set_export_parameters", format: "glb", lod: 2, textureProfile: "1K.jpg", useZip: false });
  assert.deepEqual(desk[2], {
    eventName: "set_ui_parameters",
    isExportButtonVisible: false,
    showSampleAvatars: false,
    isTakeSelfieButtonVisible: false,
    isBrowsePhotoButtonVisible: false,
    isLanguageSelectionVisible: false,
  });
  const mobile = setupMessages("tok", true);
  assert.equal(mobile.length, 3);
  assert.deepEqual(mobile[2], { eventName: "set_ui_parameters", isNoPhotoVisible: false, age: "adult" });
  assert.ok(!JSON.stringify(desk).includes("secret"));
  assert.deepEqual(creatorUrl(767), { url: "https://mobile.metaperson.avatarsdk.com/generator", mobile: true });
  assert.deepEqual(creatorUrl(768), { url: "https://metaperson.avatarsdk.com/iframe.html", mobile: false });
  assert.equal(exportMessage().eventName, "export_avatar");
});

test("待机姿势：桌面版导出带性别对应的 Idle 动画并以首帧为绑定姿势；手机版不带", () => {
  const { exportMessage, idleExportParamsMessage, mpGenderOf } = m.proto;
  assert.deepEqual(exportMessage({ gender: "female", mobile: false }), {
    eventName: "export_avatar",
    format: "glb",
    lod: 2,
    textureProfile: "1K.jpg",
    useZip: false,
    animationName: "Female_Animation_Idle",
    animationAsBindPose: true,
  });
  assert.equal(exportMessage({ gender: "male", mobile: false }).animationName, "Male_Animation_Idle");
  assert.equal(exportMessage({ gender: "male", mobile: true }).animationName, undefined);
  assert.equal(exportMessage({ gender: null, mobile: false }).animationName, undefined);
  assert.equal(idleExportParamsMessage("female", true), null);
  assert.equal(idleExportParamsMessage("male", false)?.eventName, "set_export_parameters");
  assert.equal(mpGenderOf("Female"), "female");
  assert.equal(mpGenderOf("male"), "male");
  assert.equal(mpGenderOf("unknown"), null);
});

// ---------- 启用条件与令牌 ----------

test("metapersonEnabled：三项 env 都有才启用，同意卡第二项变为 MetaPerson", () => {
  assert.equal(m.mp.metapersonEnabled(), true);
  assert.equal(m.providers.thirdPartyInfo()?.id, "metaperson");
  const saved = process.env.AVATARSDK_CLIENT_SECRET;
  delete process.env.AVATARSDK_CLIENT_SECRET;
  assert.equal(m.mp.metapersonEnabled(), false);
  assert.equal(m.providers.thirdPartyInfo(), null);
  process.env.AVATARSDK_CLIENT_SECRET = saved;
  assert.deepEqual(m.providers.parseConsentVersion("avatar-consent-v2:store+metaperson"), { thirdParty: "metaperson", bodyAnalysis: false });
});

test("getAccessToken：Basic auth + client_credentials，结果缓存", async () => {
  handler = () => tokenResponse("tok-A", 36000);
  const a = await m.mp.getAccessToken();
  const b = await m.mp.getAccessToken();
  assert.equal(a.accessToken, "tok-A");
  assert.equal(b.accessToken, "tok-A");
  assert.ok(a.expiresIn > 35000 && a.expiresIn <= 36000);
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, "https://api.avatarsdk.com/o/token/");
  assert.equal(c.init?.method, "POST");
  const auth = (c.init?.headers as Record<string, string>).Authorization;
  assert.equal(auth, `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`);
  assert.equal(String(c.init?.body), "grant_type=client_credentials");
});

test("getAccessToken：快过期时重新换取；失败返回 502 且不泄露响应体", async () => {
  handler = () => tokenResponse("tok-short", 30);
  await m.mp.getAccessToken();
  handler = () => tokenResponse("tok-new", 36000);
  assert.equal((await m.mp.getAccessToken()).accessToken, "tok-new");
  m.mp.resetTokenCache();
  handler = () => new Response("invalid_client secret=xxx", { status: 401 });
  await assert.rejects(m.mp.getAccessToken(), (e: Error & { status?: number }) => e.status === 502 && !e.message.includes("secret"));
});

// ---------- 导出地址与下载 ----------

test("checkExportUrl：仅 https + 白名单主机（含子域与 env 追加）", () => {
  const { checkExportUrl, hostAllowed } = m.mp;
  assert.ok(checkExportUrl("https://avatarsdk.com/x.glb"));
  assert.ok(checkExportUrl("https://cdn.metaperson.avatarsdk.com/x.glb"));
  assert.throws(() => checkExportUrl("http://avatarsdk.com/x.glb"), /https/);
  assert.throws(() => checkExportUrl("https://evilavatarsdk.com/x.glb"), /evilavatarsdk\.com/);
  assert.throws(() => checkExportUrl("https://avatarsdk.com.evil.io/x.glb"), /avatarsdk\.com\.evil\.io/);
  assert.throws(() => checkExportUrl("https://127.0.0.1/x.glb"), /127\.0\.0\.1/);
  assert.throws(() => checkExportUrl("https://u:p@avatarsdk.com/x.glb"), /无效/);
  assert.throws(() => checkExportUrl("https://avatarsdk.com:8443/x.glb"), /无效/);
  assert.throws(() => checkExportUrl(42), /无效/);
  process.env.AVATARSDK_EXPORT_HOSTS = " s3.amazonaws.com , bad host ,";
  assert.ok(hostAllowed("bucket.s3.amazonaws.com"));
  assert.ok(!hostAllowed("amazonaws.com"));
  delete process.env.AVATARSDK_EXPORT_HOSTS;
  assert.ok(!hostAllowed("bucket.s3.amazonaws.com"));
});

test("downloadExport：校验 GLB 头、大小与每一跳重定向", async () => {
  const glb = m.mannequin.buildMannequinGlb();
  handler = (url) => {
    if (url === "https://api.avatarsdk.com/exports/1") {
      return new Response(null, { status: 302, headers: { location: "https://files.avatarsdk.com/1.glb" } });
    }
    if (url === "https://files.avatarsdk.com/1.glb") return new Response(Buffer.from(glb));
    if (url === "https://api.avatarsdk.com/exports/evil") {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    }
    if (url === "https://api.avatarsdk.com/notglb") return new Response("<html>");
    if (url === "https://api.avatarsdk.com/big") return new Response(Buffer.from(glb), { headers: { "content-length": "999999999" } });
    return new Response("nope", { status: 404 });
  };
  const bytes = await m.mp.downloadExport("https://api.avatarsdk.com/exports/1");
  assert.equal(bytes.byteLength, glb.byteLength);
  for (const c of calls) assert.equal(c.init?.redirect, "manual");
  await assert.rejects(m.mp.downloadExport("https://api.avatarsdk.com/exports/evil"), /https/);
  assert.ok(!calls.some((c) => c.url.includes("169.254")));
  await assert.rejects(m.mp.downloadExport("https://api.avatarsdk.com/notglb"), /GLB/);
  await assert.rejects(m.mp.downloadExport("https://api.avatarsdk.com/big"), /过大/);
  // 没有 content-length 时边读边数
  await assert.rejects(m.mp.downloadExport("https://api.avatarsdk.com/exports/1", 100), /过大/);
  await assert.rejects(m.mp.downloadExport("https://api.avatarsdk.com/missing"), /404/);
});

// ---------- 导入、替换与删除（PGlite + 本地存储） ----------

async function consent(userId: string, thirdParty: boolean) {
  return m.service.recordConsent(userId, { store: true, thirdParty, offerVersion: m.providers.offerVersion() });
}

test("importMetaperson：需单独同意；导入后作业 succeeded、替换时清理旧 GLB、删除时请求远端删除", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "mp1", name: "测试", email: "mp1@example.test" });
  const glb = m.mannequin.buildMannequinGlb();
  handler = (url, init) => {
    if (url.endsWith("/o/token/")) return tokenResponse("tok-del");
    if (url.startsWith("https://files.avatarsdk.com/")) return new Response(Buffer.from(glb));
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return new Response("nope", { status: 404 });
  };

  // 只同意存储、未同意第三方：令牌与导入都拒绝
  let st = await consent("mp1", false);
  assert.equal(st.mode, "metaperson");
  assert.equal(st.offer.thirdParty?.id, "metaperson");
  await assert.rejects(m.service.requireMetapersonConsent("mp1"), (e: Error & { status?: number }) => e.status === 403);
  await assert.rejects(
    m.service.importMetaperson("mp1", { url: "https://files.avatarsdk.com/a.glb", avatarCode: "code-a" }),
    (e: Error & { status?: number }) => e.status === 403,
  );

  st = await consent("mp1", true);
  assert.equal(st.consent?.thirdParty, "metaperson");
  assert.equal(st.canGenerate, false);
  await m.service.requireMetapersonConsent("mp1");
  await assert.rejects(m.service.createJob("mp1"), /创建器/);

  // 非白名单主机：明确报出主机名，不发请求
  calls = [];
  await assert.rejects(
    m.service.importMetaperson("mp1", { url: "https://cdn.example.net/a.glb", avatarCode: "code-a" }),
    /cdn\.example\.net/,
  );
  assert.equal(calls.length, 0);
  await assert.rejects(m.service.importMetaperson("mp1", { url: "https://files.avatarsdk.com/a.glb", avatarCode: "../x" }), /编号/);

  st = await m.service.importMetaperson("mp1", { url: "https://files.avatarsdk.com/a.glb", avatarCode: "code-a" });
  const first = st.job!;
  assert.equal(first.status, "succeeded");
  assert.equal(first.provider, "metaperson");
  assert.equal(first.isMock, false);
  assert.deepEqual(first.badges, []);
  assert.equal(first.remotePurge, null);
  assert.match(first.glbUrl!, new RegExp(`^/api/avatar/files/mp1/avatars/${first.id}\\.glb$`));
  const [row] = await db.select().from(schema.avatarJob).where(eq(schema.avatarJob.id, first.id));
  assert.equal(row.providerTaskId, "code-a");
  assert.equal(row.consentVersion, "avatar-consent-v2:store+metaperson");
  const firstFile = path.join(process.env.UPLOADS_DIR!, "mp1", "avatars", `${first.id}.glb`);
  assert.ok(existsSync(firstFile));

  // 重新生成：新形象替换旧形象，旧 GLB 文件被删除
  st = await m.service.importMetaperson("mp1", { url: "https://files.avatarsdk.com/b.glb", avatarCode: "code-b" });
  const second = st.job!;
  assert.notEqual(second.id, first.id);
  assert.ok(!existsSync(firstFile));
  assert.ok(existsSync(path.join(process.env.UPLOADS_DIR!, "mp1", "avatars", `${second.id}.glb`)));

  // 删除单个形象：请求远端删除（Bearer），结果不进界面
  calls = [];
  const del = await m.service.deleteResult("mp1", second.id);
  assert.equal(del.remotePurge, "skipped");
  assert.equal(del.job.resultDeleted, true);
  const remote = calls.find((c) => c.init?.method === "DELETE");
  assert.equal(remote?.url, "https://api.avatarsdk.com/avatars/code-b/");
  assert.equal((remote?.init?.headers as Record<string, string>).Authorization, "Bearer tok-del");

  // 一键删除：远端删除失败只记日志，不计入提示
  handler = (url) => (url.endsWith("/o/token/") ? tokenResponse("tok-del") : new Response("err", { status: 500 }));
  const all = await m.service.deleteAll("mp1");
  assert.deepEqual(all.remotePurge, { sent: 0, failed: 0, pending: 0 });
  assert.equal(all.job, null);
  assert.equal(all.consent, null);
});

test("MetaPerson 模式上传（D56）：收正脸自拍、全身正面、全身侧面；需单独同意；自上传起 30 天到期；不访问外部服务", async () => {
  const { db, schema } = m.db;
  const { pngWithMetadata } = await import("./testing");
  await db.insert(schema.user).values({ id: "mp2", name: "测试", email: "mp2@example.test" });
  const file = (w = 600, h = 800) => new File([Buffer.from(pngWithMetadata(w, h))], "p.png", { type: "image/png" });
  const status = (code: number) => (e: Error & { status?: number }) => e.status === code;
  calls = [];
  handler = () => new Response("nope", { status: 404 });

  // 只同意保存、未同意 MetaPerson：不能上传
  await consent("mp2", false);
  await assert.rejects(m.service.addPhoto("mp2", "face", file(600, 600)), status(403));

  await consent("mp2", true);
  const t0 = Date.now();
  await m.service.addPhoto("mp2", "face", file(600, 600));
  await m.service.addPhoto("mp2", "front", file());
  let st = await m.service.addPhoto("mp2", "side", file());
  await assert.rejects(m.service.addPhoto("mp2", "back", file()), /正脸自拍/);
  await assert.rejects(m.service.addPhoto("mp2", "extra", file()), status(400));
  assert.deepEqual(st.photos.map((p) => p.slot).sort(), ["face", "front", "side"]);
  const days30 = 30 * 86400_000;
  for (const p of st.photos) {
    const left = Date.parse(p.expiresAt!) - t0;
    assert.ok(left > days30 - 60_000 && left <= days30 + 60_000, `${p.slot} 到期时间应为上传后 30 天`);
  }
  // 同一位置只保留一张
  st = await m.service.addPhoto("mp2", "face", file(640, 640));
  assert.equal(st.photos.filter((p) => p.slot === "face").length, 1);
  assert.equal(st.photos.find((p) => p.slot === "face")?.width, 640);
  // 服务端生成任务仍只属于 photos 模式
  assert.equal(st.canGenerate, false);
  await assert.rejects(m.service.createJob("mp2"), /创建器/);
  assert.equal(calls.length, 0);

  // photos 模式（未启用 MetaPerson）仍不收正脸自拍
  const saved = process.env.AVATAR3D_PROVIDER;
  process.env.AVATAR3D_PROVIDER = "mock";
  try {
    await assert.rejects(m.service.addPhoto("mp2", "face", file(600, 600)), /面部特写/);
  } finally {
    process.env.AVATAR3D_PROVIDER = saved;
  }
});

test("importMetaperson：在用照片（含试穿卡写入、没有期限的正面照）自导入成功起 30 天到期，已有期限不延后", async () => {
  const { db, schema } = m.db;
  await db.insert(schema.user).values({ id: "mp3", name: "测试", email: "mp3@example.test" });
  await consent("mp3", true);
  const early = new Date(Date.now() + 5 * 86400_000);
  await db.insert(schema.avatarPhoto).values([
    { id: "mp3-front", userId: "mp3", slot: "front", storageKey: "mp3/photos/mp3-front.jpg", mime: "image/jpeg" },
    { id: "mp3-face", userId: "mp3", slot: "face", storageKey: "mp3/photos/mp3-face.jpg", mime: "image/jpeg", expiresAt: early },
  ]);
  const glb = m.mannequin.buildMannequinGlb();
  handler = (url) => (url.startsWith("https://files.avatarsdk.com/") ? new Response(Buffer.from(glb)) : new Response("nope", { status: 404 }));
  const t0 = Date.now();
  const st = await m.service.importMetaperson("mp3", { url: "https://files.avatarsdk.com/c.glb", avatarCode: "code-c" });
  const front = st.photos.find((p) => p.id === "mp3-front")!;
  const face = st.photos.find((p) => p.id === "mp3-face")!;
  const left = Date.parse(front.expiresAt!) - t0;
  assert.ok(left > 30 * 86400_000 - 60_000 && left <= 30 * 86400_000 + 60_000);
  assert.equal(Date.parse(face.expiresAt!), early.getTime());
});

test("token / import 在未启用 metaperson 时拒绝", async () => {
  const saved = process.env.AVATAR3D_PROVIDER;
  process.env.AVATAR3D_PROVIDER = "mock";
  try {
    await assert.rejects(m.service.requireMetapersonConsent("mp1"), (e: Error & { status?: number }) => e.status === 409);
    await assert.rejects(m.mp.getAccessToken(), (e: Error & { status?: number }) => e.status === 409);
  } finally {
    process.env.AVATAR3D_PROVIDER = saved;
  }
});
