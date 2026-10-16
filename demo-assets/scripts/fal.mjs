// fal 调用公共模块：key 只从 app/.env.local 读取，不打印。
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "../..");
const ENV_CANDIDATES = [
  process.env.STAR_ENV_FILE,
  resolve(ROOT, "app/.env.local"),
].filter(Boolean);

function loadKey() {
  for (const p of ENV_CANDIDATES) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^FAL_KEY=(.+)$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  throw new Error("FAL_KEY 未找到（app/.env.local）");
}
const KEY = loadKey();
const H = () => ({ Authorization: `Key ${KEY}`, "Content-Type": "application/json" });

export const LEDGER = resolve(ROOT, "demo-assets/费用明细.csv");
if (!existsSync(LEDGER)) writeFileSync(LEDGER, "时间,模型,用途,单价(USD),累计(USD)\n");

export function spent() {
  const lines = readFileSync(LEDGER, "utf8").trim().split("\n").slice(1);
  if (!lines.length) return 0;
  return Number(lines.at(-1).split(",").at(-1)) || 0;
}
export const BUDGET_STOP = 18;
export function record(model, purpose, price) {
  const total = +(spent() + price).toFixed(4);
  appendFileSync(LEDGER, `${new Date().toISOString()},${model},${purpose},${price},${total}\n`);
  return total;
}
export function guard(next) {
  if (spent() + next > BUDGET_STOP) throw new Error(`预算保护：已花 ${spent()}，再花 ${next} 会超过 ${BUDGET_STOP}`);
}

export async function pricing(ids) {
  const q = ids.map((i) => `endpoint_id=${encodeURIComponent(i)}`).join("&");
  const r = await fetch(`https://api.fal.ai/v1/models/pricing?${q}`, { headers: H() });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export async function run(model, input) {
  const r = await fetch(`https://fal.run/${model}`, { method: "POST", headers: H(), body: JSON.stringify(input) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${model} ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// queue 接口（视频等长任务）
export async function queue(model, input, { every = 5000, max = 600000 } = {}) {
  const s = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: H(), body: JSON.stringify(input) });
  const sub = await s.json();
  if (!s.ok) throw new Error(`${model} submit ${s.status}: ${JSON.stringify(sub).slice(0, 400)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    await new Promise((r) => setTimeout(r, every));
    const st = await (await fetch(sub.status_url, { headers: H() })).json();
    if (st.status === "COMPLETED") {
      const res = await fetch(sub.response_url, { headers: H() });
      return res.json();
    }
    if (st.status && !["IN_QUEUE", "IN_PROGRESS"].includes(st.status)) throw new Error(`${model} ${JSON.stringify(st).slice(0, 300)}`);
  }
  throw new Error(`${model} 超时`);
}

export function dataUri(path) {
  const buf = readFileSync(path);
  const ext = path.split(".").pop().toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
export async function download(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`下载失败 ${r.status}`);
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}
