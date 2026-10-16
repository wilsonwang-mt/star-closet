// 生成两位虚构 AI 演示模特：全身正面 → 以全身为参考生成半身与自拍。
import { run, record, guard, download, dataUri, ROOT } from "./fal.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(ROOT, "app/public/demo/models");
const PRICE = 0.15;
const PEOPLE = {
  f01: "a fictional East Asian woman in her mid twenties, natural friendly approachable look, soft natural makeup, shoulder-length dark brown hair, an ordinary non-celebrity face that does not resemble any real person or celebrity",
  m01: "a fictional East Asian man in his mid twenties, natural friendly approachable look, short neat black hair, clean shaven, an ordinary non-celebrity face that does not resemble any real person or celebrity",
};
const only = process.argv[2];

function shrink(file) {
  execFileSync("sips", ["-Z", "1600", "-s", "format", "jpeg", "-s", "formatOptions", "82", file, "--out", file], { stdio: "ignore" });
}

for (const [id, who] of Object.entries(PEOPLE)) {
  if (only && only !== id) continue;
  const full = resolve(OUT, `${id}-full.jpg`);
  if (!existsSync(full)) {
    guard(PRICE);
    const t = Date.now();
    const r = await run("fal-ai/nano-banana-pro", {
      prompt: `Full-body front-facing studio photo of ${who}. Wearing a plain white crew-neck T-shirt and plain straight beige trousers, simple white sneakers. Standing straight, arms relaxed at sides, facing the camera, entire body visible from head to toe with space above head and below feet. Light warm beige seamless studio backdrop, soft even lighting, photorealistic, sharp focus, 3:4 vertical.`,
      aspect_ratio: "3:4", resolution: "2K", num_images: 1, output_format: "jpeg",
    });
    await download(r.images[0].url, full); shrink(full);
    console.log(id, "full", record("fal-ai/nano-banana-pro", `${id} 全身照`, PRICE), `${Date.now() - t}ms`);
  }
  const ref = dataUri(full);
  const variants = {
    half: `Using the same person from the reference photo (identical face, hair and identity), create a half-body portrait from the waist up, same white T-shirt, relaxed natural smile, soft warm studio light, light beige background, photorealistic, 3:4 vertical.`,
    selfie: `Using the same person from the reference photo (identical face, hair and identity), create a natural-light front-facing selfie taken with a phone at arm's length, head and shoulders, looking straight at the camera, neutral relaxed expression, face fully visible and evenly lit by window daylight, plain light wall behind, no phone visible, photorealistic, 3:4 vertical.`,
  };
  for (const [v, prompt] of Object.entries(variants)) {
    const out = resolve(OUT, `${id}-${v}.jpg`);
    if (existsSync(out)) continue;
    guard(PRICE);
    const t = Date.now();
    const r = await run("fal-ai/nano-banana-pro/edit", { prompt, image_urls: [ref], aspect_ratio: "3:4", resolution: "2K", num_images: 1, output_format: "jpeg" });
    await download(r.images[0].url, out); shrink(out);
    console.log(id, v, record("fal-ai/nano-banana-pro/edit", `${id} ${v}`, PRICE), `${Date.now() - t}ms`);
  }
}
