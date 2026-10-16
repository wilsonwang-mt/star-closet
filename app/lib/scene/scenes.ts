import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Item } from "@/lib/catalog";

// 商品详情页“上身效果”的场景库（与 T2 演示素材同一组场景）与演示模特清单。
// 场景描述只给生成模型看；title 是界面上的中文标题。

export type SceneId = "cafe" | "street" | "wedding" | "gallery" | "seaside" | "market";

export const SCENES: Record<SceneId, { title: string; prompt: string }> = {
  cafe: { title: "周五的咖啡馆", prompt: "inside a warm Friday-evening café with wooden tables, espresso bar and soft window light" },
  street: { title: "城市街头黄昏", prompt: "on a city street at golden-hour dusk, warm low sun, shop windows and soft bokeh lights" },
  wedding: { title: "户外草坪婚礼", prompt: "at an outdoor lawn wedding, white chairs and floral arch softly blurred behind, late-afternoon sun" },
  gallery: { title: "美术馆", prompt: "in a quiet modern art gallery with pale walls, large framed artworks and skylight glow" },
  seaside: { title: "海边度假", prompt: "on a seaside promenade on holiday, calm sea and soft evening sky behind" },
  market: { title: "周末市集", prompt: "at a weekend open-air market with canvas stalls, flowers and produce softly blurred" },
};

export const isSceneId = (x: unknown): x is SceneId => typeof x === "string" && x in SCENES;

/** 按单品的场合与风格标签挑 2 个场景（顺序即展示顺序）。 */
export function pickScenes(item: Pick<Item, "occasionTags" | "styleTags" | "tags" | "category">): SceneId[] {
  const tags = new Set([...(item.occasionTags ?? []), ...(item.styleTags ?? []), ...(item.tags ?? [])]);
  const has = (...ks: string[]) => ks.some((k) => tags.has(k));
  const out: SceneId[] = [];
  const add = (s: SceneId) => {
    if (!out.includes(s)) out.push(s);
  };
  if (has("婚礼", "派对", "晚宴")) add("wedding");
  if (has("度假", "海边", "旅行")) add("seaside");
  if (has("约会", "艺术", "新中式", "文艺", "正式")) add("gallery");
  if (has("通勤", "静奢", "都市", "职场")) add("street");
  if (has("户外", "山系", "露营", "周末", "休闲", "工装", "复古")) add("market");
  if (has("咖啡", "日常", "法式", "慵懒", "约会", "通勤")) add("cafe");
  for (const s of ["cafe", "street"] as SceneId[]) add(s);
  return out.slice(0, 2);
}

// ---- 演示模特（T2 产出的 app/public/demo/manifest.json）----

export type DemoScene = { id: string; title: string; image: string; live: string | null };
export type DemoManifest = {
  models: Record<string, { full: string; half: string; selfie: string }>;
  items: Record<string, { model: string; scenes: DemoScene[] }>;
};

const SAFE_PATH = /^\/demo\/[A-Za-z0-9/_-]{1,120}\.(jpg|jpeg|png|webp|mp4)$/;

let cached: { at: number; data: DemoManifest | null } | null = null;

/** 读取演示清单；文件不存在或格式不对时返回 null（页面回退到生成入口）。只接受 /demo/ 下的本站路径。 */
export async function readDemoManifest(): Promise<DemoManifest | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.data;
  let data: DemoManifest | null = null;
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "demo", "manifest.json"), "utf8");
    const parsed = JSON.parse(raw) as DemoManifest;
    if (parsed && typeof parsed === "object" && parsed.items && typeof parsed.items === "object") data = parsed;
  } catch {
    data = null;
  }
  cached = { at: Date.now(), data };
  return data;
}

export async function demoScenesFor(itemId: string): Promise<DemoScene[]> {
  const m = await readDemoManifest();
  const entry = m?.items?.[itemId];
  if (!entry || !Array.isArray(entry.scenes)) return [];
  return entry.scenes
    .filter((s) => s && typeof s.image === "string" && SAFE_PATH.test(s.image))
    .map((s) => ({
      id: String(s.id),
      title: typeof s.title === "string" ? s.title : "",
      image: s.image,
      live: typeof s.live === "string" && SAFE_PATH.test(s.live) ? s.live : null,
    }));
}
