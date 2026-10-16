// 场景上身图：模特全身照 + 商品图 + 场景描述 → nano-banana-pro/edit。
import { run, record, guard, download, dataUri, ROOT } from "./fal.mjs";
import { PICKS, SCENES } from "./picks.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PRICE = 0.15;
const catalog = JSON.parse(readFileSync(resolve(ROOT, "app/data/catalog.json"), "utf8"));
const byId = Object.fromEntries(catalog.items.map((i) => [i.item_id, i]));
const OUT = resolve(ROOT, "app/public/demo/scenes");
const redo = new Set(process.argv.slice(2)); // 传 I011-street 之类强制重做

function shrink(file) {
  for (const q of [80, 72, 64, 56]) {
    execFileSync("sips", ["-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", String(q), file, "--out", file], { stdio: "ignore" });
    if (statSync(file).size <= 400 * 1024) return;
  }
}

for (const p of PICKS) {
  const item = byId[p.id];
  const modelRef = dataUri(resolve(ROOT, `app/public/demo/models/${p.model}-full.jpg`));
  const itemRef = dataUri(resolve(ROOT, `app/public/catalog/items/${p.id}.webp`));
  for (const sid of p.scenes) {
    const key = `${p.id}-${sid}`;
    const out = resolve(OUT, `${key}.jpg`);
    if (existsSync(out) && !redo.has(key)) continue;
    guard(PRICE);
    const prompt = [
      `Image 1 is the model. Image 2 is the garment: "${item.name}" (${item.color}, ${item.material ?? ""} ${item.subcategory ?? item.category}).`,
      `Create a cinematic editorial photo of the exact same person from image 1 (identical face, hair and identity) wearing exactly the garment from image 2 — keep its color, cut, pattern, details and material exactly the same as image 2.`,
      `Complete the outfit with simple understated pieces that suit it; the garment from image 2 must be the clear hero of the look.`,
      `Setting: ${SCENES[sid].prompt}. Natural candid moment, the person walking or pausing naturally, full body or three-quarter body framing.`,
      `Warm champagne-gold cinematic light, shallow depth of field, subtle film grain, photorealistic, vertical 3:4 composition. No text, no logos.`,
    ].join(" ");
    const t = Date.now();
    try {
      const r = await run("fal-ai/nano-banana-pro/edit", { prompt, image_urls: [modelRef, itemRef], aspect_ratio: "3:4", resolution: "2K", num_images: 1, output_format: "jpeg" });
      await download(r.images[0].url, out); shrink(out);
      const total = record("fal-ai/nano-banana-pro/edit", `场景 ${key}${redo.has(key) ? "（重做）" : ""}`, PRICE);
      console.log(key, "ok", `${Date.now() - t}ms`, "累计", total);
    } catch (e) {
      console.log(key, "FAIL", String(e.message).slice(0, 200));
    }
  }
}
