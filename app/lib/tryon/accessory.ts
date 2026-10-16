import type { Item } from "@/lib/catalog";
import { TryonError } from "./fashn";

// 鞋、包、配饰的一键试穿（试穿模型只换上身区域，不支持这些品类）：fal-ai/nano-banana-pro/edit。
// image_urls = 身份参考（数字分身正面 + 正脸 + 侧脸，最多 4 张；没有分身时为底图一张）+ 商品图；
// 提示词要求同一个人（脸、发型、身材与参考一致）穿着 / 佩戴这件单品，全身照，浅米色影棚背景。输出 images[0].url。

export const ACCESSORY_ENDPOINT = "https://fal.run/fal-ai/nano-banana-pro/edit";
const ACCESSORY_TIMEOUT_MS = 100_000;

const ACCESSORY_CATEGORIES = new Set(["鞋", "包", "配饰"]);

export function isAccessory(item: Pick<Item, "category" | "displayCategory">): boolean {
  return ACCESSORY_CATEGORIES.has(item.category) || ACCESSORY_CATEGORIES.has(item.displayCategory ?? "");
}

function verbFor(item: Pick<Item, "category">): string {
  if (item.category === "鞋") return "wearing";
  if (item.category === "包") return "carrying";
  return "wearing";
}

export function accessoryPrompt(item: Pick<Item, "name" | "category" | "displayCategory" | "subcategory" | "color" | "material">, refCount: number): string {
  const kind = [item.color, item.material, item.subcategory ?? item.displayCategory ?? item.category].filter(Boolean).join(" ");
  const refs = refCount > 1 ? `Images 1–${refCount} are reference photos of the same person.` : "Image 1 is the person.";
  const g = refCount + 1;
  return [
    `${refs} Image ${g} is the product: "${item.name.replace(/^占位：/, "")}" (${kind}).`,
    `Create a photorealistic full-body photo of exactly the same person — keep the face, hairstyle, skin tone, body shape and proportions identical to the reference photos — ${verbFor(item)} the product from image ${g}; keep its color, shape, material and details exactly the same as image ${g}, clearly visible.`,
    "Simple neutral basic clothing that does not distract from the product. Standing naturally, front view, head to toe in frame.",
    "Clean light beige studio backdrop, soft even studio lighting, vertical 3:4 composition. No text, no logos, no watermark.",
  ].join(" ");
}

export async function runAccessoryTryon(
  input: { refs: string[]; garment: string; item: Pick<Item, "name" | "category" | "displayCategory" | "subcategory" | "color" | "material"> },
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new TryonError(503, "试穿服务未开放");
  const timeout = AbortSignal.timeout(ACCESSORY_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const refs = input.refs.slice(0, 4);
  let res: Response;
  try {
    res = await fetch(ACCESSORY_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", "X-Fal-Store-IO": "0" },
      body: JSON.stringify({
        prompt: accessoryPrompt(input.item, refs.length),
        image_urls: [...refs, input.garment],
        aspect_ratio: "3:4",
        resolution: "1K",
        num_images: 1,
        output_format: "png",
      }),
      signal: combined,
      cache: "no-store",
    });
  } catch (e) {
    if (combined.aborted || (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") {
      throw new TryonError(504, "试穿超时，请稍后再试");
    }
    throw new TryonError(502, "试穿服务暂时连不上，请稍后再试");
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new TryonError(502, "试穿服务配置有误，请稍后再试");
    if (res.status === 422 || res.status === 400) throw new TryonError(422, "这件单品暂时无法试穿，请稍后再试");
    if (res.status === 429) throw new TryonError(429, "试穿的人有点多，请稍后再试");
    throw new TryonError(502, "试穿服务暂时不可用，请稍后再试");
  }
  const data = (await res.json().catch(() => null)) as { images?: { url?: unknown }[] } | null;
  const url = data?.images?.[0]?.url;
  if (typeof url !== "string" || !(url.startsWith("https://") || url.startsWith("data:image/"))) {
    throw new TryonError(502, "试穿服务没有返回图片，请稍后再试");
  }
  return url;
}
