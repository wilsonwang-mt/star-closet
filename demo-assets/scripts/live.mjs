// Live 视频：场景图 → Kling 2.5 Turbo Pro image-to-video（5 s，0.07 美元/秒）→ avconvert 剪到 4 s、H.264。
import { queue, record, guard, download, dataUri, ROOT } from "./fal.mjs";
import { PICKS } from "./picks.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const PRICE = 0.35; // 5 s × 0.07
const OUT = resolve(ROOT, "app/public/demo/live");
const tmpDir = process.env.LIVE_TMP ?? "/tmp";
const args = process.argv.slice(2);
const pass = args.includes("--second") ? 1 : 0; // 先做每件的第 1 个场景，再做第 2 个
const only = args.filter((a) => !a.startsWith("--"));

const PROMPT = "Living photo: the person stays almost still, only subtle natural motion — a gentle breath, hair and clothing hem moving softly in a light breeze, warm light gently shimmering, a very slow subtle camera push-in. Calm, cinematic, photorealistic. The clothing keeps exactly the same color, pattern and shape. The last frame closely matches the first frame for a seamless loop.";
const NEG = "fast motion, walking away, turning around, face distortion, changing clothes, morphing, text, watermark, blur";

// 转码：demo-assets/tools/transcode.swift 编译后的可执行文件（swiftc -O transcode.swift -o transcode），
// 剪到 4 s、缩放到 720×960、H.264；超过 2MB 时降码率重试。
const TRANSCODE = process.env.TRANSCODE ?? resolve(ROOT, "demo-assets/tools/transcode");
function convert(src, dst) {
  for (const bps of [3_600_000, 3_000_000, 2_400_000]) {
    execFileSync(TRANSCODE, [src, dst, "4", "720", "960", String(bps)], { stdio: "ignore" });
    if (statSync(dst).size <= 2 * 1024 * 1024) return `720x960@${bps / 1e6}Mbps`;
  }
  return "720x960(>2MB)";
}

for (const p of PICKS) {
  const sid = p.scenes[pass];
  const key = `${p.id}-${sid}`;
  if (only.length && !only.includes(key)) continue;
  const out = resolve(OUT, `${key}.mp4`);
  if (existsSync(out)) continue;
  guard(PRICE);
  const t = Date.now();
  try {
    const img = dataUri(resolve(ROOT, `app/public/demo/scenes/${key}.jpg`));
    const r = await queue(MODEL, { prompt: PROMPT, negative_prompt: NEG, image_url: img, duration: "5", cfg_scale: 0.5 });
    const raw = resolve(tmpDir, `${key}-raw.mp4`);
    await download(r.video.url, raw);
    const total = record(MODEL, `Live ${key}`, PRICE);
    const preset = convert(raw, out);
    console.log(key, "ok", `${Math.round((Date.now() - t) / 1000)}s`, preset, `${Math.round(statSync(out).size / 1024)}KB`, "累计", total);
  } catch (e) {
    console.log(key, "FAIL", String(e.message).slice(0, 240));
  }
}
