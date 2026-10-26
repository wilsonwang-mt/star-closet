import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BOT_MESSAGE, botIdEnabled, isBotRequest, rejectBot } from "./botid";
import { BOTID_PROTECTED } from "./botid-routes";

// Vercel BotID（D76）：校验函数全部替换成假的，不调用 Vercel 的接口。

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const human = async () => ({ isBot: false });
const bot = async () => ({ isBot: true });

test("只在 Vercel 上检查：本地（含 next start）不调用校验；BOTID=off 关闭", async () => {
  let called = 0;
  const check = async () => (called++, { isBot: true });
  assert.equal(botIdEnabled(env({})), false);
  assert.equal(await isBotRequest(check, env({})), false);
  assert.equal(await isBotRequest(check, env({ VERCEL: "1", BOTID: "off" })), false);
  assert.equal(called, 0);
  assert.equal(botIdEnabled(env({ VERCEL: "1" })), true);
  assert.equal(await isBotRequest(check, env({ VERCEL: "1" })), true);
  assert.equal(called, 1);
});

test("判定为机器人才拒绝；校验本身出错时放行（后面还有额度与总闸兜底）", async () => {
  const on = env({ VERCEL: "1" });
  assert.equal(await isBotRequest(human, on), false);
  assert.equal(await isBotRequest(bot, on), true);
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await isBotRequest(async () => Promise.reject(new Error("x-vercel-oidc-token header is missing")), on), false);
  } finally {
    console.error = quiet;
  }
});

test("rejectBot：机器人返回 403 与提示，正常请求返回 null", async () => {
  const prev = process.env.VERCEL;
  process.env.VERCEL = "1";
  try {
    assert.equal(await rejectBot(human), null);
    const res = await rejectBot(bot);
    assert.equal(res?.status, 403);
    assert.deepEqual(await res?.json(), { error: BOT_MESSAGE }, "请求之外按默认语言（中文）");
  } finally {
    if (prev === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prev;
  }
});

test("受保护的接口：每个路径的 POST 都先过 BotID；注册与登录在 better-auth 路由里拦截；浏览器端用同一份列表", () => {
  const root = process.cwd();
  for (const { path: p, method } of BOTID_PROTECTED) {
    assert.equal(method, "POST");
    if (p.startsWith("/api/auth/")) continue;
    const file = path.join(root, "app", p, "route.ts");
    assert.ok(existsSync(file), `${p} 没有路由文件`);
    const src = readFileSync(file, "utf-8");
    const post = src.slice(src.indexOf("export async function POST"));
    // POST 里第一个 await 就是 rejectBot（登录、读请求体、扣额度都在它之后）
    assert.ok(post.indexOf("await ") >= 0 && post.indexOf("await ") === post.indexOf("await rejectBot()"), `${p} 的 POST 没有先调用 rejectBot`);
    assert.match(post, /const denied = await rejectBot\(\);\n {2}if \(denied\) return denied;/);
  }
  const auth = readFileSync(path.join(root, "app/api/auth/[...all]/route.ts"), "utf-8");
  for (const { path: p } of BOTID_PROTECTED.filter((r) => r.path.startsWith("/api/auth/"))) assert.ok(auth.includes(`"${p}"`), `${p} 不在 better-auth 路由的拦截列表里`);
  assert.match(auth, /isBotRequest\(\)/);
  assert.match(auth, /code: "BOT_DETECTED"/);
  const client = readFileSync(path.join(root, "instrumentation-client.ts"), "utf-8");
  assert.match(client, /initBotId\(\{ protect: BOTID_PROTECTED/);
  const login = readFileSync(path.join(root, "app/login/page.tsx"), "utf-8");
  assert.match(login, /BOT_DETECTED: "botDetected"/, "登录页按错误码显示提示");
});
