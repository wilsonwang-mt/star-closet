import { generateOne, GenError, type TwinGender } from "./twin-gen";

// 数字分身的脸部精修（D68）。
// 评估发现：全身标准形象照（2K，1792×2400）里脸只有约 250px 高，nano-banana-pro 在这个尺寸上会把五官画成“通用脸”；
// 同样的参考图与提示词，脸占画面一半的特写身份保持度明显更高。所以在全身图生成后再做一步：
//   1. 按影棚纯色背景找出人物头部（不依赖人脸模型）；
//   2. 把头部方块裁出、放大到 1024，连同正脸（与侧脸）参考交给 nano-banana-pro/edit，只重画五官；
//   3. 结果缩回原尺寸，在缩放 × 平移上找最佳对齐并校验构图没变（误差过大就放弃精修），再做低频色调迁移，
//      只把脸部椭圆羽化贴回原图（发型外轮廓与背景保留原图）。
// 任何一步失败都返回原图，不影响分身生成。

export type HeadBox = { left: number; top: number; size: number };

const ANALYZE_W = 320;
/** 与行背景色的最大通道差超过它算人物像素。 */
const FG_DIFF = 28;
/** 头部高度约为身高的 1/7.5（服装目录站姿）。 */
const HEADS_PER_BODY = 7.5;
/** 裁切方块边长 = 头高 × 2，上沿留 0.25 个头高：包含整个头部与脖子，脸约占方块高度的 45%。 */
const CROP_HEADS = 2;
const CROP_TOP_HEADS = 0.25;
/** 低频色调迁移的模糊半径（占方块边长）：只对齐色调与明暗，不把原图的五官轮廓带回来。 */
const TONE_SIGMA = 0.04;
/**
 * 贴回的脸部椭圆（占方块边长）。实测 30 张全身图，脸框中心约在 (0.50, 0.45)、宽 0.32、高 0.44。
 * 椭圆内 70% 全用精修结果，向外线性淡出到边缘；发型外轮廓与背景保留原图，避免发缘出现光晕。
 */
const FACE_CX = 0.5;
const FACE_CY = 0.45;
const FACE_RX = 0.23;
const FACE_RY = 0.29;
const FACE_SOLID = 0.7;
/**
 * 精修结果与原裁切对齐后、去掉整体明暗差的平均灰度差（0–255）超过它，视为构图被改动，放弃精修。
 * 实测对齐良好的为 1.4–5.0；模型改了发型轮廓或大幅放大的为 9 以上。
 */
export const MAX_ALIGN_DIFF = 6;
const ALIGN_SIZE = 96;
const ALIGN_MAX_SHIFT = 6;
/** 送去精修的裁切边长；结果用 2K（与 1K 同价）出图，脸部约 900px，接近特写的尺度。 */
export const FACE_DETAIL_EDGE = 1536;

async function loadSharp() {
  return (await import("sharp")).default;
}

/**
 * 在全身标准形象照里找头部方块（原图像素）。每行用左右边缘 6% 的像素中位数作该行背景色，
 * 与之差异大的像素算人物；最上方连续的人物行是头顶，最下方是脚底。人物没站满全身（贴着下边缘）或尺寸异常时返回 null。
 */
export async function locateHead(bytes: Uint8Array): Promise<HeadBox | null> {
  const sharp = await loadSharp();
  const meta = await sharp(bytes).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return null;
  const { data, info } = await sharp(bytes).resize({ width: ANALYZE_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const edge = Math.max(3, Math.round(w * 0.06));
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1];

  const mask = new Uint8Array(w * h);
  const rowFg: number[] = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    const bg = [0, 1, 2].map((c) => {
      const xs: number[] = [];
      for (let x = 0; x < edge; x++) xs.push(data[(y * w + x) * ch + c], data[(y * w + (w - 1 - x)) * ch + c]);
      return median(xs);
    });
    for (let x = edge; x < w - edge; x++) {
      const i = (y * w + x) * ch;
      const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
      if (d > FG_DIFF) {
        mask[y * w + x] = 1;
        rowFg[y]++;
      }
    }
  }
  const isPerson = (y: number) => rowFg[y] >= 2 && rowFg[y] < (w - 2 * edge) * 0.9;
  const run = (y: number, dir: 1 | -1) => [0, 1, 2].every((k) => y + k * dir >= 0 && y + k * dir < h && isPerson(y + k * dir));
  let top = -1;
  for (let y = 0; y < h; y++) if (run(y, 1)) { top = y; break; }
  let bottom = -1;
  for (let y = h - 1; y >= 0; y--) if (run(y, -1)) { bottom = y; break; }
  if (top < 0 || bottom <= top) return null;
  if (top < h * 0.01 || bottom > h * 0.99) return null; // 头顶或脚底出画：不是完整全身
  const bodyH = bottom - top;
  if (bodyH < h * 0.6) return null;
  const headH = bodyH / HEADS_PER_BODY;
  const headRows: number[] = [];
  for (let y = top; y < Math.min(h, Math.round(top + headH)); y++) headRows.push(y);

  // 头部水平中心与宽度：先取头部各行人物像素 x 的中位数 c0；每行把人物像素按断口分簇（断口不超过 0.8 个头高的算同一簇，
  // 脸部肤色接近背景时脸中间会是空洞），取包含 c0 或离 c0 最近的一簇。离散的背景噪点不会把宽度拉大。
  const xsAll: number[] = [];
  for (const y of headRows) for (let x = 0; x < w; x++) if (mask[y * w + x]) xsAll.push(x);
  if (!xsAll.length) return null;
  const c0 = median(xsAll);
  const maxGap = Math.max(4, headH * 0.8);
  const spans: { mid: number; width: number }[] = [];
  for (const y of headRows) {
    const clusters: [number, number][] = [];
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const last = clusters.at(-1);
      if (last && x - last[1] <= maxGap) last[1] = x;
      else clusters.push([x, x]);
    }
    if (!clusters.length) continue;
    const dist = (c: [number, number]) => (c0 < c[0] ? c[0] - c0 : c0 > c[1] ? c0 - c[1] : 0);
    const [l, r] = clusters.reduce((best, c) => (dist(c) < dist(best) ? c : best));
    if (dist([l, r]) > maxGap) continue;
    spans.push({ mid: (l + r) / 2, width: r - l });
  }
  if (spans.length < headRows.length / 2) return null;
  const cx = spans.reduce((a, b) => a + b.mid, 0) / spans.length;
  const span = median(spans.map((s) => s.width));
  if (!(span > headH * 0.4 && span < headH * 1.9)) return null; // 头宽异常（可能没找准）

  const k = W / w;
  const size = Math.round(CROP_HEADS * headH * k);
  if (size < 64 || size > Math.min(W, H)) return null;
  const left = Math.min(Math.max(0, Math.round(cx * k - size / 2)), W - size);
  const topPx = Math.min(Math.max(0, Math.round((top - CROP_TOP_HEADS * headH) * k)), H - size);
  return { left, top: topPx, size };
}

export function faceDetailPrompt(gender: TwinGender, hasProfile: boolean): string {
  const noun = gender === "female" ? "woman" : "man";
  const pr = gender === "female" ? "her" : "his";
  const obj = gender === "female" ? "her" : "him";
  return [
    `Image 1 is a close-up crop from a full-body studio photo of a ${noun}.`,
    `Return image 1 with exactly the same framing, head size, head position and tilt, gaze direction, neutral expression, hairstyle and hair outline, neck, clothing, lighting, colors and background, all aligned with image 1.`,
    `Only redraw the face in high detail so that it is unmistakably the same person as in reference 2 (${pr} frontal face close-up)${hasProfile ? ` and reference 3 (${pr} side profile)` : ""}: identical face shape and jawline, cheekbones, eyes, eyelids, eyebrows, nose and lips.`,
    `Keep the lighting, color grading, skin tone and skin smoothness of image 1. Do not beautify, slim, age or idealize ${obj}. Photorealistic, sharp focus.`,
  ].join(" ");
}

/**
 * 在灰度图 a（边长 sa）上放置灰度图 b（边长 sb，左上角在 (ox, oy)），比较重叠部分：
 * 两边各自减去重叠区均值后的平均绝对差（不受整体明暗变化影响）。重叠太少返回 Infinity。
 */
export function placedDiff(a: Uint8Array, sa: number, b: Uint8Array, sb: number, ox: number, oy: number): number {
  const x0 = Math.max(0, ox);
  const y0 = Math.max(0, oy);
  const x1 = Math.min(sa, ox + sb);
  const y1 = Math.min(sa, oy + sb);
  const cnt = (x1 - x0) * (y1 - y0);
  if (x1 <= x0 || y1 <= y0 || cnt < sa * sa * 0.5) return Infinity;
  let ma = 0;
  let mb = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      ma += a[y * sa + x];
      mb += b[(y - oy) * sb + (x - ox)];
    }
  }
  ma /= cnt;
  mb /= cnt;
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += Math.abs(a[y * sa + x] - ma - (b[(y - oy) * sb + (x - ox)] - mb));
  return sum / cnt;
}

/** 精修结果相对原裁切的缩放比例候选（模型常把头部略微放大）：把结果缩放到 s 倍后再贴回。 */
export const ALIGN_SCALES = [0.8, 0.84, 0.88, 0.92, 0.96, 1, 1.04, 1.08];

/** 在缩放 × 平移上找最佳对齐：b 缩放后的边长 n，左上角 (ox, oy)（均为 ALIGN_SIZE 坐标）与差异。 */
export function bestAlign(a: Uint8Array, bByScale: { n: number; px: Uint8Array }[], maxShift: number) {
  let best = { n: ALIGN_SIZE, ox: 0, oy: 0, diff: Infinity };
  for (const { n, px } of bByScale) {
    const c = Math.round((ALIGN_SIZE - n) / 2);
    for (let dy = -maxShift; dy <= maxShift; dy++) {
      for (let dx = -maxShift; dx <= maxShift; dx++) {
        const diff = placedDiff(a, ALIGN_SIZE, px, n, c + dx, c + dy);
        if (diff < best.diff) best = { n, ox: c + dx, oy: c + dy, diff };
      }
    }
  }
  return best;
}

/** 羽化椭圆蒙版（边长 n 的方块内，圆心与半轴为像素坐标）：归一化半径 ≤ FACE_SOLID 全不透明，到 1 线性淡出。 */
export function ellipseMask(n: number, cx: number, cy: number, rx: number, ry: number): Buffer {
  const m = Buffer.alloc(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x - cx) / rx, (y - cy) / ry);
      m[y * n + x] = Math.round(255 * Math.min(1, Math.max(0, (1 - r) / (1 - FACE_SOLID))));
    }
  }
  return m;
}

/**
 * 低频色调迁移：out = refined + blur(orig) − blur(refined)。精修结果的五官细节（高频）保留，
 * 整体与局部的色调、明暗（低频）对齐原图，背景与脖子处不会出现色块。输入为同尺寸 RGB 原始像素。
 */
export async function transferTone(orig: Buffer, refined: Buffer, size: number, sigma: number): Promise<Buffer> {
  const sharp = await loadSharp();
  const raw = { raw: { width: size, height: size, channels: 3 as const } };
  const [bo, br] = await Promise.all([
    sharp(orig, raw).blur(sigma).raw().toBuffer(),
    sharp(refined, raw).blur(sigma).raw().toBuffer(),
  ]);
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.max(0, refined[i] + bo[i] - br[i]));
  return out;
}

export type FaceDetailResult = { bytes: Uint8Array; applied: boolean; reason?: string };

/** 把头部方块放大后连同正脸（与侧脸）参考交给 nano-banana-pro/edit，返回模型原始输出（方形）。 */
export async function requestFaceDetail(
  full: Uint8Array,
  box: HeadBox,
  refs: { face: string; profile?: string | null },
  gender: TwinGender,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const crop = await sharp(full)
    .extract({ left: box.left, top: box.top, width: box.size, height: box.size })
    .resize(FACE_DETAIL_EDGE, FACE_DETAIL_EDGE)
    .jpeg({ quality: 92 })
    .toBuffer();
  const images = [`data:image/jpeg;base64,${crop.toString("base64")}`, refs.face, ...(refs.profile ? [refs.profile] : [])];
  return generateOne(faceDetailPrompt(gender, !!refs.profile), images, signal, { resolution: "2K", aspectRatio: "1:1" });
}

/** 本地合成：校验构图 → 缩放与平移对齐 → 低频色调迁移 → 脸部椭圆羽化贴回。构图被改动时返回原图。 */
export async function composeFaceDetail(full: Uint8Array, box: HeadBox, out: Uint8Array): Promise<FaceDetailResult> {
  const sharp = await loadSharp();
  const size = box.size;
  const meta = await sharp(full).metadata();
  const W = meta.width ?? size;
  const H = meta.height ?? size;
  const gray = async (img: Uint8Array | Buffer, n: number) =>
    new Uint8Array(await sharp(img).resize(n, n, { fit: "fill" }).grayscale().raw().toBuffer());
  const origGray = await gray(await sharp(full).extract({ left: box.left, top: box.top, width: size, height: size }).toBuffer(), ALIGN_SIZE);
  const scaled = await Promise.all(
    ALIGN_SCALES.map(async (s) => {
      const n = Math.round(ALIGN_SIZE * s);
      return { n, px: await gray(out, n) };
    }),
  );
  const best = bestAlign(origGray, scaled, ALIGN_MAX_SHIFT);
  if (best.diff > MAX_ALIGN_DIFF) return { bytes: full, applied: false, reason: `misaligned-${best.diff.toFixed(1)}` };

  // 按最佳缩放与平移把精修结果放回原图坐标。
  const k = size / ALIGN_SIZE;
  const paste = Math.min(Math.round(best.n * k), W, H);
  const left = Math.min(Math.max(0, Math.round(box.left + best.ox * k)), W - paste);
  const top = Math.min(Math.max(0, Math.round(box.top + best.oy * k)), H - paste);
  const [origAt, refined] = await Promise.all([
    sharp(full).extract({ left, top, width: paste, height: paste }).removeAlpha().raw().toBuffer(),
    sharp(out).resize(paste, paste, { fit: "fill" }).removeAlpha().raw().toBuffer(),
  ]);
  const toned = await transferTone(origAt, refined, paste, Math.max(2, paste * TONE_SIGMA));
  // 蒙版按原裁切的脸部位置画在贴回方块的坐标里。
  const mask = ellipseMask(paste, box.left + FACE_CX * size - left, box.top + FACE_CY * size - top, FACE_RX * size, FACE_RY * size);
  const rgba = await sharp(toned, { raw: { width: paste, height: paste, channels: 3 } })
    .joinChannel(mask, { raw: { width: paste, height: paste, channels: 1 } })
    .png()
    .toBuffer();
  const composed = await sharp(full).composite([{ input: rgba, left, top }]).jpeg({ quality: 92 }).toBuffer();
  return { bytes: new Uint8Array(composed), applied: true };
}

/** 精修一次约 20–40 秒；剩余时间不足这么多就不开始（或不再重试）。 */
export const FACE_DETAIL_MIN_LEFT_MS = 45_000;

/** 线上默认开启；TWIN_FACE_DETAIL=0 时关闭（例如需要控制成本时）。 */
export function faceDetailEnabled(): boolean {
  return process.env.TWIN_FACE_DETAIL !== "0";
}

/**
 * 对一张全身标准形象照做脸部精修。refs.face 为正脸参考（data URI 或 https），refs.profile 为侧脸参考（可无）。
 * 构图被改动或生成失败（输入问题除外）时，剩余时间够就再试一次；最终不成功返回原图（applied = false，reason 说明原因）。
 */
export async function refineFace(
  full: Uint8Array,
  refs: { face: string; profile?: string | null },
  gender: TwinGender,
  signal: AbortSignal,
  deadline = Infinity,
): Promise<FaceDetailResult> {
  try {
    await loadSharp();
  } catch {
    return { bytes: full, applied: false, reason: "no-sharp" };
  }
  const box = await locateHead(full).catch(() => null);
  if (!box) return { bytes: full, applied: false, reason: "no-head" };
  let last: FaceDetailResult = { bytes: full, applied: false, reason: "no-time" };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted || deadline - Date.now() < FACE_DETAIL_MIN_LEFT_MS) return last;
    try {
      const out = await requestFaceDetail(full, box, refs, gender, signal);
      last = await composeFaceDetail(full, box, out).catch(() => ({ bytes: full, applied: false, reason: "compose-error" }));
      if (last.applied || last.reason === "compose-error") return last;
    } catch (e) {
      last = { bytes: full, applied: false, reason: e instanceof GenError ? `gen-${e.status}` : "gen-error" };
      if (e instanceof GenError && e.status === 422) return last; // 输入问题，重试无益
    }
  }
  return last;
}
