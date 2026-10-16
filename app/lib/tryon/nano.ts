import { submitQueue, type FashnJob } from "./fashn";

// nano-banana 多参考试穿（fal-ai/nano-banana-pro/edit，队列接口）：两段式里的“细化”一段；鞋包配饰只跑这一段。
// 指挥台用真实 key 在分身正面照上对比风衣、高领毛衣：Kolors 约 20 秒，但衣长、腰带、领型会变；
// nano-banana 多参考约 45 秒，衣长、领型、扣子、腰带与商品图一致，人物也是本人。
// - image_urls = [底图（分身正面照 / 上一步试穿结果 / 正面照）, 正脸（有则加）, 商品图]，每张长边 1536、JPEG q92 的 data URI。
// - aspect_ratio 3:4、resolution 2K、num_images 1；输出 images[0].url。鞋包配饰同一提示词，只把动词改成 wearing / carrying the item。

export const NANO_MODEL = "fal-ai/nano-banana-pro/edit";
const MAX_EDGE = 1536;
const JPEG_QUALITY = 92;

export type NanoKind = "garment" | "shoes" | "bag" | "accessory";
export type Gender = "female" | "male" | null | undefined;

/** 把一张图（data URI 或 https 地址）转成长边 1536、JPEG q92 的 data URI；读不到或处理失败时原样返回。 */
export async function toJpegDataUri(src: string, signal?: AbortSignal): Promise<string> {
  try {
    let bytes: Buffer;
    if (src.startsWith("data:")) {
      const comma = src.indexOf(",");
      if (comma < 0 || !src.slice(0, comma).endsWith(";base64")) return src;
      bytes = Buffer.from(src.slice(comma + 1), "base64");
    } else if (src.startsWith("https://")) {
      const res = await fetch(src, { signal, cache: "no-store" });
      if (!res.ok) return src;
      bytes = Buffer.from(await res.arrayBuffer());
    } else {
      return src;
    }
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return src;
  }
}

/** 实测有效的试穿提示词；按性别换代词，没有正脸参考时去掉 reference 2 并调整编号。 */
export function nanoTryonPrompt(opts: { hasFace: boolean; gender?: Gender; kind?: NanoKind }): string {
  const male = opts.gender === "male";
  const her = male ? "his" : "her";
  const g = opts.hasFace ? 3 : 2;
  const refs = opts.hasFace
    ? `Reference 1 is the person (full body), reference 2 is a close-up of the same person's face, reference ${g} is a`
    : `Reference 1 is the person (full body), reference ${g} is a`;
  const same = opts.hasFace ? "references 1 and 2" : "reference 1";
  const kind = opts.kind ?? "garment";
  const tail = `Keep ${her} identity exactly (face, hair, body shape and proportions), same front-facing natural standing pose, full body head to toe, same seamless warm-beige studio background and soft daylight, photorealistic fashion catalog photo.`;
  if (kind === "garment") {
    return [
      `Virtual try-on. ${refs} garment product photo.`,
      `Create a photo of exactly the same person from ${same} wearing the garment from reference ${g}, replacing the corresponding clothing; keep ${her} other clothing items unchanged.`,
      `The garment must match reference ${g} exactly: same color, fabric texture, length, collar, buttons, belt, pockets, cut and proportions, worn naturally with realistic drape and fit on ${her} body.`,
      tail,
    ].join(" ");
  }
  const verb = kind === "bag" ? "carrying" : "wearing";
  const noun = kind === "shoes" ? "shoes" : kind === "bag" ? "bag" : "accessory";
  return [
    `Virtual try-on. ${refs} ${noun} product photo.`,
    `Create a photo of exactly the same person from ${same} ${verb} the item from reference ${g}; keep ${her} clothing unchanged.`,
    `The item must match reference ${g} exactly: same color, material, shape, hardware, details and proportions, clearly visible and naturally ${kind === "bag" ? "held" : "worn"}.`,
    tail,
  ].join(" ");
}

export type NanoInput = { base: string; face?: string | null; garment: string; gender?: Gender; kind?: NanoKind; syncMode?: boolean };

export async function nanoBody(input: NanoInput, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const images = await Promise.all([input.base, ...(input.face ? [input.face] : []), input.garment].map((x) => toJpegDataUri(x, signal)));
  return {
    prompt: nanoTryonPrompt({ hasFace: !!input.face, gender: input.gender, kind: input.kind }),
    image_urls: images,
    aspect_ratio: "3:4",
    resolution: "2K",
    num_images: 1,
    // 结果以 data URI 返回，fal 不留 CDN 副本（D47）；fal OpenAPI 已列出 sync_mode 与 resolution 1K/2K/4K（2026-10-17 核对）。
    sync_mode: input.syncMode ?? true,
  };
}

/** 提交一次 nano-banana 试穿到 fal 队列（不等待生成）。 */
export async function submitNano(input: NanoInput, signal?: AbortSignal): Promise<FashnJob> {
  return submitQueue(NANO_MODEL, await nanoBody(input, signal), signal);
}
