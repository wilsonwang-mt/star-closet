// 按实际存在的文件生成 app/public/demo/manifest.json；没有 Live 的场景 live 为 null。
import { PICKS, SCENES } from "./picks.mjs";
import { ROOT } from "./fal.mjs";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pub = (p) => resolve(ROOT, "app/public", p.replace(/^\//, ""));
const models = {};
for (const id of ["f01", "m01"]) models[id] = { full: `/demo/models/${id}-full.jpg`, half: `/demo/models/${id}-half.jpg`, selfie: `/demo/models/${id}-selfie.jpg` };
const items = {};
for (const p of PICKS) {
  const scenes = p.scenes
    .map((sid) => ({ id: sid, title: SCENES[sid].title, image: `/demo/scenes/${p.id}-${sid}.jpg`, live: `/demo/live/${p.id}-${sid}.mp4` }))
    .filter((s) => existsSync(pub(s.image)))
    .map((s) => ({ ...s, live: existsSync(pub(s.live)) ? s.live : null }));
  if (scenes.length) items[p.id] = { model: p.model, scenes };
}
for (const m of Object.values(models)) for (const v of Object.values(m)) if (!existsSync(pub(v))) throw new Error(`缺文件 ${v}`);
writeFileSync(resolve(ROOT, "app/public/demo/manifest.json"), JSON.stringify({ models, items }, null, 2) + "\n");
console.log("items", Object.keys(items).length, "scenes", Object.values(items).reduce((n, i) => n + i.scenes.length, 0), "live", Object.values(items).flatMap((i) => i.scenes).filter((s) => s.live).length);
