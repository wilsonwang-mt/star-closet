/**
 * 数字分身脸部相似度评估：用线上同一套提示词与参数（lib/avatar/twin-gen.ts）为测试人物生成形象照（D68）。
 * 生成结果交给 scripts/face-eval.py 打分。会调用 fal（付费），每次调用记一行账，累计达到 --budget 就停。
 *
 * 只用 AI 生成的虚构人物照片；照片、结果与账本都放在仓库外。不打印图片内容与 key。
 *
 * 用法：
 *   npx tsx --env-file=/path/to/app/.env.local scripts/twin-eval-gen.ts \
 *     --photos DIR --persona w01:female --persona m01:male \
 *     --variant baseline --angles front,side --runs 2 [--resolution 2K] [--shot full|portrait] [--refine-from baseline] \
 *     --out DIR --ledger DIR/ledger.csv --budget 15
 * --shot portrait 是诊断用的半身正面特写（脸占画面约一半），用来区分“全身图里脸太小”与“模型把脸画偏”。
 * --refine-from <方案> 不重新生成，而是对该方案已生成的图逐张做脸部精修（lib/avatar/twin-face.ts，按 --angles 用正面或侧面的
 *   提示词与脸部椭圆，不支持 back），每张一次调用；模型原始输出与头部方块存在 <out>/<方案>/raw/，
 *   加 --recompose 可只在本地重新合成、不再调用 fal。
 * 照片命名：DIR/<id>-<slot>.jpg，slot 取 face（正脸）、extra（侧脸）、front（全身正面）、side（全身侧面）、back（半身或其他）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { composeFaceDetail, type FaceAngle, type HeadBox, locateHead, requestFaceDetail } from "../lib/avatar/twin-face";
import {
  generateOne,
  REFERENCE_ORDER,
  referenceFromBytes,
  referenceSentence,
  type TwinAngle,
  type TwinGender,
  type TwinResolution,
  twinPrompt,
} from "../lib/avatar/twin-gen";

const PRICE_USD: Record<TwinResolution, number> = { "1K": 0.15, "2K": 0.15, "4K": 0.3 }; // fal 页面价格，4K 按两倍计

const { values } = parseArgs({
  options: {
    photos: { type: "string" },
    persona: { type: "string", multiple: true },
    variant: { type: "string" },
    angles: { type: "string", default: "front,side" },
    runs: { type: "string", default: "1" },
    resolution: { type: "string", default: "2K" },
    out: { type: "string" },
    ledger: { type: "string" },
    budget: { type: "string", default: "15" },
    concurrency: { type: "string", default: "6" },
    shot: { type: "string", default: "full" },
    "refine-from": { type: "string" },
    recompose: { type: "boolean", default: false },
  },
});

function need(v: string | undefined, name: string): string {
  if (!v) {
    console.error(`缺少 --${name}`);
    process.exit(2);
  }
  return v;
}

const photosDir = need(values.photos, "photos");
const variant = need(values.variant, "variant");
const outDir = path.join(need(values.out, "out"), variant);
const ledger = need(values.ledger, "ledger");
const budget = Number(values.budget);
const resolution = values.resolution as TwinResolution;
if (!(resolution in PRICE_USD)) throw new Error(`resolution 只能是 ${Object.keys(PRICE_USD).join("/")}`);
const angles = values.angles!.split(",") as TwinAngle[];
const runs = Number(values.runs);
const shot = values.shot === "portrait" ? "portrait" : "full";
const refineFrom = values["refine-from"] ? path.join(path.dirname(outDir), values["refine-from"]) : null;
if (refineFrom && angles.includes("back")) throw new Error("脸部精修只支持 front、side");

/** 诊断用：半身正面特写，其余约束与线上全身模板一致。 */
function portraitPrompt(gender: TwinGender, slots: readonly string[]): string {
  const noun = gender === "female" ? "woman" : "man";
  const pr = gender === "female" ? "her" : "his";
  const obj = gender === "female" ? "her" : "him";
  const subj = gender === "female" ? "she" : "he";
  return [
    `Studio head-and-shoulders identity portrait of the SAME ${noun} shown in the reference photos.`,
    referenceSentence(slots, pr),
    `Reproduce ${pr} identity exactly: identical face shape, eyes, eyelids, eyebrows, nose, lips, jawline, skin tone and skin texture, identical hairstyle, hair length, parting and hair color.`,
    `Do not beautify, slim or idealize ${obj}; ${subj} must be instantly recognizable as the same person.`,
    "Pose: facing the camera directly, front view, neutral relaxed expression, framed from the top of the head to the upper chest, the face filling about half of the frame height.",
    "Wardrobe: a plain white crew-neck t-shirt, no accessories, no logos.",
    "Seamless light warm-beige studio backdrop, soft even diffused daylight, neutral white balance, photorealistic portrait photography, sharp focus, 85mm lens look.",
  ].join(" ");
}
const personas = (values.persona ?? []).map((p) => {
  const [id, gender] = p.split(":");
  if (gender !== "female" && gender !== "male") throw new Error(`--persona ${p} 需写成 id:female 或 id:male`);
  return { id, gender: gender as TwinGender };
});
if (!personas.length) throw new Error("至少一个 --persona");
if (!values.recompose && !process.env.FAL_KEY) throw new Error("没有 FAL_KEY（用 --env-file 指向 app/.env.local）");

mkdirSync(outDir, { recursive: true });
if (!existsSync(ledger)) writeFileSync(ledger, "time,variant,persona,run,angle,resolution,usd,status,seconds\n");

function spent(): number {
  return readFileSync(ledger, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .reduce((sum, line) => sum + (Number(line.split(",")[6]) || 0), 0);
}

type Task = { persona: (typeof personas)[number]; run: number; angle: TwinAngle; refs: string[]; slots: string[]; faceRef: string; profileRef: string | null };

async function main() {
  const tasks: Task[] = [];
  for (const persona of personas) {
    const slots: string[] = [];
    const refs: string[] = [];
    for (const slot of REFERENCE_ORDER) {
      const file = path.join(photosDir, `${persona.id}-${slot}.jpg`);
      if (!existsSync(file)) continue;
      slots.push(slot);
      refs.push(await referenceFromBytes(readFileSync(file), "image/jpeg"));
    }
    if (!slots.includes("face") || !slots.includes("front")) throw new Error(`${persona.id} 缺正脸或全身正面照`);
    const faceRef = refs[slots.indexOf("face")];
    const profileRef = slots.includes("extra") ? refs[slots.indexOf("extra")] : null;
    for (let run = 1; run <= runs; run++) for (const angle of angles) tasks.push({ persona, run, angle, refs, slots, faceRef, profileRef });
  }

  const price = PRICE_USD[resolution];
  console.log(`${variant}：${tasks.length} 张，预计 ${(tasks.length * price).toFixed(2)} 美元；账本已记 ${spent().toFixed(2)} 美元，上限 ${budget} 美元`);

  let next = 0;
  let stopped = false;
  async function worker() {
    while (next < tasks.length && !stopped) {
      const t = tasks[next++];
      if (spent() + price > budget) {
        stopped = true;
        console.log(`已到预算上限 ${budget} 美元，停止`);
        return;
      }
      const file = path.join(outDir, `${t.persona.id}-run${t.run}-${t.angle}.jpg`);
      const prompt = shot === "portrait" ? portraitPrompt(t.persona.gender, t.slots) : twinPrompt(t.angle, t.persona.gender, { slots: t.slots });
      // 与线上一致：失败重试一次。每次提交都按一次计费记一行账（失败的也记，偏保守）。
      for (let attempt = 1; attempt <= 2; attempt++) {
        const started = Date.now();
        let status = "ok";
        try {
          if (refineFrom) {
            const src = path.join(refineFrom, path.basename(file));
            if (!existsSync(src)) break;
            const full = readFileSync(src);
            const rawDir = path.join(outDir, "raw");
            mkdirSync(rawDir, { recursive: true });
            const rawFile = path.join(rawDir, path.basename(file));
            const boxFile = `${rawFile}.json`;
            let box: HeadBox | null;
            let out: Uint8Array;
            if (values.recompose) {
              if (!existsSync(rawFile)) break;
              box = JSON.parse(readFileSync(boxFile, "utf8")) as HeadBox;
              out = readFileSync(rawFile);
            } else {
              box = await locateHead(full);
              if (!box) {
                status = "skipped:no-head";
                writeFileSync(file, full);
                break;
              }
              out = await requestFaceDetail(full, box, { face: t.faceRef, profile: t.profileRef }, t.persona.gender, AbortSignal.timeout(300_000), t.angle as FaceAngle);
              writeFileSync(rawFile, out);
              writeFileSync(boxFile, JSON.stringify(box));
            }
            const r = await composeFaceDetail(full, box, out, t.angle as FaceAngle);
            writeFileSync(file, r.bytes);
            if (!r.applied) status = `skipped:${r.reason}`;
            if (values.recompose) {
              console.log(`${t.persona.id} run${t.run} ${t.angle}: 重新合成 ${status}`);
              break;
            }
          } else {
            writeFileSync(file, await generateOne(prompt, t.refs, AbortSignal.timeout(300_000), { resolution }));
          }
        } catch (e) {
          status = `failed:${e instanceof Error ? e.message.replace(/,/g, " ") : "unknown"}`;
        }
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        appendFileSync(ledger, `${new Date().toISOString()},${variant},${t.persona.id},${t.run},${t.angle},${resolution},${price},${status},${secs}\n`);
        console.log(`${t.persona.id} run${t.run} ${t.angle} #${attempt}: ${status} ${secs}s`);
        if (status !== "ok" && !status.startsWith("failed")) break;
        if (status === "ok" || spent() + price > budget) break;
      }
    }
  }
  await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));
  console.log(`完成；账本累计 ${spent().toFixed(2)} 美元`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
