// 服务端提示与视图的英文（D70）：lib 里抛出、存库后返回、随视图返回的中文都要有英文；视图在边界本地化后不改逻辑字段。
// 不连接外部服务：只读源码做静态扫描，数据库用临时 PGlite（仅为能加载 lib/usage）。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { localizeServerText } from "../i18n/phrases";
import { patterns, phrases } from "../i18n/phrases/en";

const dir = mkdtempSync(path.join(tmpdir(), "sc-l10n-"));
process.env.PGLITE_DIR = path.join(dir, "pglite");
process.env.UPLOADS_DIR = path.join(dir, "uploads");
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
// 加载 lib/usage、lib/avatar/service 会初始化数据库：先等它就绪，结束后再删临时目录。
before(async () => {
  const db = await import("@/lib/db");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  await migrate(db.db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
});
after(() => rmSync(dir, { recursive: true, force: true }));

const CJK = /[㐀-鿿！-～]/;
const en = (s: string) => localizeServerText("en", s);

function walk(p: string): string[] {
  if (!statSync(p).isDirectory()) return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  return readdirSync(p).flatMap((f) => walk(path.join(p, f)));
}

// 会经接口返回给浏览器的 lib 源码（不含 lib/chat、lib/locate：对话子任务负责）。
const SOURCES = ["lib/avatar", "lib/tryon", "lib/scene", "lib/usage.ts", "lib/looks.ts", "lib/profile.ts", "lib/bag/service.ts", "lib/bag/core.ts", "app/api"]
  .map((p) => path.join(process.cwd(), p))
  .flatMap(walk);

test("lib 里抛出或存库的中文提示都有英文（错误类、message 字段、请求体上限说明）", () => {
  const found = new Set<string>();
  const res = [
    /new (?:Avatar|Tryon|Scene|Metaperson|Gen|Provider)Error\([^"`)]*"([^"\n]*[一-鿿][^"\n]*)"/g,
    /new (?:Avatar|Tryon|Scene)Error\(\d+, [^"`)]*\? "([^"\n]*[一-鿿][^"\n]*)" : "([^"\n]*[一-鿿][^"\n]*)"/g,
    /\bmessage:\s*"([^"\n]*[一-鿿][^"\n]*)"/g,
    /readBodyLimited\([^"`)]*"([^"\n]*[一-鿿][^"\n]*)"/g,
    /throw new Error\("([^"\n]*[一-鿿][^"\n]*)"\)/g,
    /const (?:TIMEOUT_MESSAGE|NO_BASE|BASE_NOT_FOUND|PROCESSOR_LABEL) = "([^"\n]*)"/g,
    /\berror: "(?:[A-Z_]+\|)?([^"\n]*[一-鿿][^"\n]*)"/g,
    /"fine\.error": [^"\n]*"([^"\n]*[一-鿿][^"\n]*)"/g,
  ];
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf-8");
    for (const re of res) for (const m of src.matchAll(re)) for (const g of m.slice(1)) if (g) found.add(g);
  }
  // lib/adapt/ai.ts 的模型错误只记日志、不返回；lib/env.ts 的部署检查不经接口。
  const missing = [...found].filter((s) => en(s) === s);
  assert.ok(found.size > 80, `扫描到的提示太少（${found.size}），正则可能失效`);
  assert.deepEqual(missing, [], "以下服务端提示缺英文（lib/i18n/phrases/en.ts）");
});

test("随视图返回的固定文案都有英文：处理方说明、质量提示、场景标题、照片角度、必需照片说明、徽标", async () => {
  const { QUALITY_HINTS } = await import("../avatar/image");
  const { providerInfo, requiredSlotsMessage, BODY_ANALYSIS_NAME } = await import("../avatar/providers");
  const { badgesFor } = await import("../avatar/service");
  const { SCENES } = await import("../scene/scenes");
  const texts = [
    ...Object.values(QUALITY_HINTS),
    ...(["mock", "tripo_fal", "metaperson", "twin"] as const).flatMap((id) => {
      const p = providerInfo(id)!;
      return [p.name, p.processor, p.fidelityNote];
    }),
    ...["twin", "tripo_fal", "mock"].map(requiredSlotsMessage),
    BODY_ANALYSIS_NAME,
    ...badgesFor(true),
    ...Object.values(SCENES).map((s) => s.title),
    "正面",
    "侧面",
    "背面",
    "生成中断，请重试",
  ];
  for (const t of texts) {
    const out = en(t);
    assert.ok(!CJK.test(out), `缺英文：${t}`);
  }
});

test("带变量的提示：每日上限（每种用途）、第三方状态码、导出主机；patterns 的英文里没有中文", async () => {
  const { QuotaError } = await import("../usage");
  for (const kind of ["adapt", "tryon", "scene", "twin", "body_analysis", "chat"] as const) {
    const msg = new QuotaError(kind, 7).message;
    const out = en(msg);
    assert.ok(!CJK.test(out) && out.includes("7") && /Try again tomorrow\.$/.test(out), `${kind}: ${out}`);
  }
  assert.equal(en("生成服务暂时不可用（502）"), "The generation service is temporarily unavailable (502).");
  assert.equal(en("生成服务暂时不可用（网络错误）"), "The generation service is temporarily unavailable (network error).");
  assert.equal(en("生成失败（网络错误）"), "Generation didn't work (network error). Please try again.");
  assert.equal(en("生成服务出错（500）"), "The generation service ran into an error (500).");
  assert.equal(en("下载形象文件失败（404）"), "We couldn't download the avatar file (404).");
  assert.match(en("导出地址的主机 evil.example 不在白名单中（可在 AVATARSDK_EXPORT_HOSTS 中追加）"), /^The export host evil\.example isn't on the allowlist/);
  for (const [re, replacement] of patterns) {
    assert.ok(!CJK.test(replacement), `${re}`);
    assert.ok(re.source.startsWith("^") && re.source.endsWith("$"), `${re} 应以 ^…$ 锚定`);
  }
  for (const [k, v] of Object.entries(phrases)) assert.ok(v.trim() && !CJK.test(v), k);
  // 中文原样
  assert.equal(localizeServerText("zh", "生成服务暂时不可用（502）"), "生成服务暂时不可用（502）");
});

test("试穿与上身效果视图：英文换掉失败说明、单品名与场景标题，其余字段不动；中文原样", async () => {
  const { localizeTryonContext, localizeTryonView } = await import("./l10n");
  const { localizeSceneState } = await import("../scene/l10n");
  const { localizeItem } = await import("../i18n/catalog");
  const item = { id: "I001", name: "奶白垂感醋酸衬衫", category: "上装", displayCategory: null, image: null, color: "奶白", price: 299 };
  const view = {
    id: "t1",
    status: "failed",
    resultUrl: null,
    kind: "item" as const,
    mode: "performance" as const,
    stage: "failed" as const,
    queuePosition: null,
    refining: false,
    progress: null,
    wornItemId: "I001",
    baseTryonId: null,
    applied: ["上装" as const],
    appliedItemIds: ["I001"],
    items: [item],
    sourceLookId: null,
    sourceOutfitId: null,
    error: "试穿超时，请稍后再试",
    createdAt: "",
  };
  const v = localizeTryonView(view, "en");
  assert.equal(v.error, "The try-on took too long. Please try again in a moment.");
  assert.equal(v.items[0].name, localizeItem(item, "en").name);
  assert.equal(v.items[0].category, "上装");
  assert.deepEqual(v.applied, ["上装"]);
  assert.equal(v.stage, "failed");
  assert.deepEqual(localizeTryonView(view, "zh"), view);
  assert.equal(localizeTryonView({ ...view, error: null }, "en").error, null);

  const ctx = { enabled: true, signedIn: true, consented: false, frontPhotoUrl: null, baseSource: null, providerName: "fal.ai 上的 AI 模型" };
  assert.equal(localizeTryonContext(ctx, "en").providerName, "AI models on fal.ai");

  const scene = {
    enabled: true,
    signedIn: true,
    hasFrontPhoto: true,
    consented: true,
    renders: [
      { id: "s1", sceneId: "cafe", title: "周五的咖啡馆", status: "succeeded", imageUrl: "/x", videoUrl: null, videoPending: true, error: null },
      { id: "s2", sceneId: "street", title: "城市街头黄昏", status: "failed", imageUrl: null, videoUrl: null, videoPending: false, error: "生成超时，请稍后再试" },
    ],
  };
  const s = localizeSceneState(scene, "en");
  assert.deepEqual(
    s.renders.map((r) => [r.title, r.error]),
    [
      ["Friday café", null],
      ["City street at dusk", "Generation took too long. Please try again in a moment."],
    ],
  );
  assert.equal(s.renders[0].videoPending, true);
  assert.deepEqual(localizeSceneState(scene, "zh"), scene);
});
