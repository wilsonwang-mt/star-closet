import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BODY_BLENDS,
  clampBlend,
  fallbackUiMessage,
  fitWithin,
  generateAvatarMessage,
  normalizeBlends,
  parseMpMessage,
  stripDataUrl,
} from "./metaperson-protocol";
import {
  engineProgress,
  flowReducer,
  GENERATE_TIMEOUT_MS,
  initialFlow,
  msUntilFallback,
  shouldSend,
  type FlowEvent,
  type FlowState,
} from "./metaperson-flow";

// D56：generate_avatar 消息、体型参数裁剪、90 秒兜底与认证失败兜底。纯函数，不访问网络。

const run = (events: FlowEvent[], from: FlowState = initialFlow) => events.reduce(flowReducer, from);
const ORIGIN = "https://metaperson.avatarsdk.com";

// ---------- generate_avatar ----------

test("generateAvatarMessage：去掉 data: 前缀，age 固定 adult，桌面版带 8 个 blends", () => {
  const msg = generateAvatarMessage({
    gender: "female",
    image: "data:image/jpeg;base64,QUJD",
    blends: { Body: 0.31, Waist: -2, Legs: 0.5, Bogus: 1 },
    mobile: false,
  });
  assert.equal(msg.eventName, "generate_avatar");
  assert.equal(msg.gender, "female");
  assert.equal(msg.age, "adult");
  assert.equal(msg.image, "QUJD");
  assert.ok(!String(msg.image).startsWith("data:"));
  const blends = msg.blends as { name: string; value: number }[];
  assert.deepEqual(
    blends.map((b) => b.name),
    [...BODY_BLENDS],
  );
  assert.deepEqual(Object.fromEntries(blends.map((b) => [b.name, b.value])), {
    Body: 0.3,
    Neck: 0,
    Shoulders: 0,
    Chest: 0,
    Forearms: 0,
    Waist: -1,
    Hips: 0,
    Legs: 0.5,
  });
  assert.ok(!JSON.stringify(msg).includes("Bogus"));
});

test("generateAvatarMessage：手机版不发 blends；没有体型参数时全部为 0；性别只认 male/female", () => {
  const mobile = generateAvatarMessage({ gender: "male", image: "QUJD", blends: { Body: 1 }, mobile: true });
  assert.equal(mobile.gender, "male");
  assert.equal("blends" in mobile, false);
  assert.equal(mobile.image, "QUJD");
  const none = generateAvatarMessage({ gender: "female", image: "QUJD", blends: null, mobile: false });
  assert.ok((none.blends as { value: number }[]).every((b) => b.value === 0));
  const odd = generateAvatarMessage({ gender: "x" as never, image: "QUJD", mobile: false });
  assert.equal(odd.gender, "female");
});

test("clampBlend / normalizeBlends：裁剪到 [-1,1]、四舍五入到 0.05，非数字按 0", () => {
  assert.equal(clampBlend(0.123), 0.1);
  assert.equal(clampBlend(0.125), 0.15);
  assert.equal(clampBlend(-0.024), 0);
  assert.ok(Object.is(clampBlend(-0.01), 0));
  assert.equal(clampBlend(1.7), 1);
  assert.equal(clampBlend(-3), -1);
  assert.equal(clampBlend(Number.NaN), 0);
  assert.equal(clampBlend("0.5"), 0);
  assert.equal(clampBlend(Infinity), 0);
  const b = normalizeBlends({ Hips: 0.68, Chest: -0.33 });
  assert.equal(Object.keys(b).length, 8);
  assert.equal(b.Hips, 0.7);
  assert.equal(b.Chest, -0.35);
  assert.equal(b.Body, 0);
  for (const v of Object.values(normalizeBlends({ Body: 9, Neck: -9 }))) assert.ok(v >= -1 && v <= 1);
});

test("stripDataUrl / fitWithin：base64 正文与长边 1024 缩放", () => {
  assert.equal(stripDataUrl("data:image/png;base64,AAAA"), "AAAA");
  assert.equal(stripDataUrl("AAAA"), "AAAA");
  assert.deepEqual(fitWithin(3000, 4000, 1024), { width: 768, height: 1024 });
  assert.deepEqual(fitWithin(4000, 3000, 1024), { width: 1024, height: 768 });
  assert.deepEqual(fitWithin(800, 600, 1024), { width: 800, height: 600 });
});

test("fallbackUiMessage：桌面放回“选择照片”按钮，手机版不发", () => {
  assert.deepEqual(fallbackUiMessage(false), { eventName: "set_ui_parameters", isBrowsePhotoButtonVisible: true });
  assert.equal(fallbackUiMessage(true), null);
});

test("parseMpMessage：authentication_status 兼容 1/0；model_generated 带回性别", () => {
  const auth = (v: unknown) => parseMpMessage(ORIGIN, { source: "metaperson_creator", eventName: "authentication_status", isAuthenticated: v });
  assert.deepEqual(auth(1), { eventName: "authentication_status", isAuthenticated: true, errorMessage: undefined });
  assert.equal((auth(true) as { isAuthenticated: boolean }).isAuthenticated, true);
  assert.equal((auth(0) as { isAuthenticated: boolean }).isAuthenticated, false);
  assert.equal((auth(false) as { isAuthenticated: boolean }).isAuthenticated, false);
  assert.equal((auth("yes") as { isAuthenticated: boolean }).isAuthenticated, false);
  const gen = parseMpMessage(ORIGIN, { source: "metaperson_creator", eventName: "model_generated", avatarCode: "c1", gender: "male" });
  assert.deepEqual(gen, { eventName: "model_generated", avatarCode: "c1", gender: "male" });
});

// ---------- 流程与兜底计时 ----------

test("flow：点生成后等引擎就绪才发送；收到 model_generated 淡入创建器", () => {
  let s = run([{ type: "request" }]);
  assert.equal(s.phase, "generating");
  assert.equal(shouldSend(s), false); // 引擎未就绪，先排队
  s = run([{ type: "engine_ready" }], s);
  assert.equal(shouldSend(s), true);
  s = run([{ type: "sent", at: 1000 }], s);
  assert.equal(shouldSend(s), false);
  assert.equal(s.sentAt, 1000);
  s = run([{ type: "model_generated" }], s);
  assert.equal(s.phase, "revealed");
});

test("flow：generate_avatar 发出 90 秒内没有 model_generated → 兜底显示原生界面", () => {
  let s = run([{ type: "engine_ready" }, { type: "request" }, { type: "sent", at: 10_000 }]);
  assert.equal(msUntilFallback(s, 10_000), GENERATE_TIMEOUT_MS);
  assert.equal(msUntilFallback(s, 50_000), 50_000);
  s = run([{ type: "tick", now: 10_000 + GENERATE_TIMEOUT_MS - 1 }], s);
  assert.equal(s.phase, "generating");
  s = run([{ type: "tick", now: 10_000 + GENERATE_TIMEOUT_MS }], s);
  assert.equal(s.phase, "fallback");
  assert.equal(s.fallbackReason, "timeout");
  assert.equal(msUntilFallback(s, 200_000), null);
  // 兜底后用户在原生界面里生成成功
  s = run([{ type: "model_generated" }], s);
  assert.equal(s.phase, "revealed");
  assert.equal(s.fallbackReason, null);
});

test("flow：model_generated 先到就不再兜底；还没发出时不计时", () => {
  let s = run([{ type: "engine_ready" }, { type: "request" }, { type: "sent", at: 0 }, { type: "model_generated" }]);
  s = run([{ type: "tick", now: 10 * GENERATE_TIMEOUT_MS }], s);
  assert.equal(s.phase, "revealed");
  // 引擎迟迟不就绪：请求一直排队，不会因为计时进入兜底
  const queued = run([{ type: "request" }, { type: "tick", now: 10 * GENERATE_TIMEOUT_MS }]);
  assert.equal(queued.phase, "generating");
  assert.equal(msUntilFallback(queued, 0), null);
});

test("flow：认证失败 → 兜底（任何阶段，除了已生成）；之后不再接受本站的生成请求", () => {
  const standby = run([{ type: "auth_failed" }]);
  assert.equal(standby.phase, "fallback");
  assert.equal(standby.fallbackReason, "auth");
  assert.equal(run([{ type: "request" }], standby).phase, "fallback");
  const waiting = run([{ type: "request" }, { type: "auth_failed" }]);
  assert.equal(waiting.phase, "fallback");
  assert.equal(waiting.pending, false);
  const done = run([{ type: "engine_ready" }, { type: "request" }, { type: "sent", at: 0 }, { type: "model_generated" }, { type: "auth_failed" }]);
  assert.equal(done.phase, "revealed");
});

test("flow：待机或尚未发出时的 model_generated（创建器默认形象）不会提前露出", () => {
  assert.equal(run([{ type: "model_generated" }]).phase, "standby");
  assert.equal(run([{ type: "request" }, { type: "model_generated" }]).phase, "generating");
});

test("flow：照片没准备好就撤回 → 回到上传；超时兜底后可以再试一次；生成中不重复提交", () => {
  assert.equal(run([{ type: "request" }, { type: "cancel" }]).phase, "standby");
  const sent = run([{ type: "engine_ready" }, { type: "request" }, { type: "sent", at: 5 }]);
  assert.equal(run([{ type: "cancel" }], sent).phase, "generating");
  assert.equal(run([{ type: "request" }], sent), sent);
  const timedOut = run([{ type: "tick", now: 5 + GENERATE_TIMEOUT_MS }], sent);
  const retry = run([{ type: "request" }], timedOut);
  assert.equal(retry.phase, "generating");
  assert.equal(retry.sentAt, null);
  assert.equal(shouldSend(retry), true);
});

test("engineProgress：没有真实进度，趋近但不到 1，就绪为 1", () => {
  assert.equal(engineProgress(0, false), 0);
  const a = engineProgress(30_000, false);
  const b = engineProgress(180_000, false);
  assert.ok(a > 0 && a < b && b < 0.93);
  assert.equal(engineProgress(1000, true), 1);
});
