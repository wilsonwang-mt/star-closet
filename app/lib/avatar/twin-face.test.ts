import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import sharp from "sharp";
import { composeFaceDetail, ellipseMask, FACE_DETAIL_EDGE, FACE_ELLIPSE, faceDetailPrompt, locateHead, refineFace, transferTone } from "./twin-face";
import { figurePng, pngWithMetadata } from "./testing";

// 数字分身脸部精修（D68）：全部用合成的几何人形示意图与 mock fetch，不访问 fal，不含任何真人图像。
process.env.FAL_KEY = "test-fal-key";
process.env.TWIN_QUEUE_POLL_MS = "1";

const FIGURE = figurePng();
const realFetch = globalThis.fetch;
type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
/** 模拟模型输出：拿到送去精修的裁切，返回加工后的图片。 */
let respond: (crop: Buffer) => Promise<Buffer> = async (crop) => crop;
let failTimes = 0;
let lastCrop: Buffer = Buffer.alloc(0);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ url, body });
  if (url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit") {
    if (failTimes > 0) {
      failTimes--;
      return new Response("err", { status: 500 });
    }
    const first = String((body?.image_urls as string[])[0]);
    lastCrop = Buffer.from(first.slice(first.indexOf(",") + 1), "base64");
    const base = "https://queue.fal.run/fal-ai/nano-banana-pro/requests/r1";
    return Response.json({ status: "IN_QUEUE", status_url: `${base}/status`, response_url: base });
  }
  if (url.endsWith("/status")) return Response.json({ status: "COMPLETED" });
  if (url === "https://queue.fal.run/fal-ai/nano-banana-pro/requests/r1") return Response.json({ images: [{ url: "https://v3.fal.media/files/r1.jpg" }] });
  if (url === "https://v3.fal.media/files/r1.jpg") return new Response(new Uint8Array(await respond(lastCrop)));
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

beforeEach(() => {
  calls = [];
  failTimes = 0;
  respond = async (crop) => crop;
});

after(() => {
  globalThis.fetch = realFetch;
});

async function rgb(img: Uint8Array | Buffer) {
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** 两张同尺寸图片在区域内的平均绝对差（0–255）。 */
async function regionDiff(a: Uint8Array | Buffer, b: Uint8Array | Buffer, r = { x0: 0, y0: 0, x1: Infinity, y1: Infinity }) {
  const [A, B] = await Promise.all([rgb(a), rgb(b)]);
  let sum = 0;
  let n = 0;
  for (let y = r.y0; y < Math.min(A.h, r.y1); y++) {
    for (let x = r.x0; x < Math.min(A.w, r.x1); x++) {
      for (let c = 0; c < 3; c++) sum += Math.abs(A.data[(y * A.w + x) * 3 + c] - B.data[(y * B.w + x) * 3 + c]);
      n += 3;
    }
  }
  return sum / n;
}

const ZOOM = (z: number) => async (crop: Buffer) => {
  const meta = await sharp(crop).metadata();
  const n = meta.width!;
  const inner = Math.round(n / z);
  const off = Math.round((n - inner) / 2);
  return sharp(crop).extract({ left: off, top: off, width: inner, height: inner }).resize(n, n).jpeg({ quality: 95 }).toBuffer();
};

test("locateHead：在影棚全身图里找到头部方块；纯色图、没站满全身的图返回 null", async () => {
  const box = await locateHead(FIGURE);
  assert.ok(box);
  // 头部（头发椭圆）横向 255–345、纵向 75–185，方块应把它整个包住，边长约两个头高
  assert.ok(box.left < 255 && box.left + box.size > 345, `横向包住头部：${JSON.stringify(box)}`);
  assert.ok(box.top < 75 && box.top + box.size > 185, `纵向包住头部：${JSON.stringify(box)}`);
  assert.ok(box.size > 150 && box.size < 230, `边长约两个头高：${box.size}`);
  assert.equal(await locateHead(pngWithMetadata(300, 400)), null);
  assert.equal(await locateHead(figurePng(600, 800, true)), null);
});

test("ellipseMask：椭圆内 70% 全不透明，向外淡出，椭圆外为 0", () => {
  const m = ellipseMask(100, 50, 50, 20, 30);
  assert.equal(m[50 * 100 + 50], 255);
  assert.equal(m[50 * 100 + 63], 255, "归一化半径 0.65");
  assert.ok(m[50 * 100 + 67] > 0 && m[50 * 100 + 67] < 255, "归一化半径 0.85 处在淡出");
  assert.equal(m[0], 0);
});

test("transferTone：整体偏色被拉回原图，细节保留", async () => {
  const size = 64;
  const orig = Buffer.alloc(size * size * 3);
  for (let i = 0; i < orig.length; i++) orig[i] = 100 + ((i * 7) % 50);
  const shifted = Buffer.from(orig.map((v) => Math.min(255, v + 40)));
  const out = await transferTone(orig, shifted, size, 6);
  const meanAbs = out.reduce((a, v, i) => a + Math.abs(v - orig[i]), 0) / out.length;
  assert.ok(meanAbs < 3, `偏色被拉回：${meanAbs}`);
});

test("composeFaceDetail：结果与原裁切一致或略有放大时贴回；构图被改动时返回原图", async () => {
  const box = (await locateHead(FIGURE))!;
  const crop = await sharp(FIGURE).extract({ left: box.left, top: box.top, width: box.size, height: box.size }).resize(FACE_DETAIL_EDGE, FACE_DETAIL_EDGE).jpeg().toBuffer();

  const same = await composeFaceDetail(FIGURE, box, crop);
  assert.equal(same.applied, true);
  assert.ok((await regionDiff(same.bytes, FIGURE)) < 2, "原样返回时几乎不改变原图");

  const zoomed = await composeFaceDetail(FIGURE, box, await ZOOM(1.08)(crop));
  assert.equal(zoomed.applied, true, "模型把头部略微放大时按缩放对齐后贴回");
  const face = { x0: 270, y0: 105, x1: 330, y1: 185 };
  assert.ok((await regionDiff(zoomed.bytes, FIGURE, face)) < 6, "对齐后脸部与原图重合");

  const other = await composeFaceDetail(FIGURE, box, await sharp(pngWithMetadata(200, 200, [90, 120, 160])).png().toBuffer());
  assert.equal(other.applied, false);
  assert.match(other.reason ?? "", /^misaligned-/);
  assert.equal(other.bytes, FIGURE, "构图被改动时原图原样返回");
});

test("composeFaceDetail：只改脸部，发型外轮廓与背景保留原图，脸部色调对齐原图", async () => {
  const box = (await locateHead(FIGURE))!;
  // 模拟模型：脸部整体偏红偏亮（色调漂移），并把背景也染了色
  respond = async (crop) => {
    const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const out = Buffer.from(data.map((v, i) => Math.min(255, v + (i % 3 === 0 ? 35 : 15))));
    return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
  };
  const crop = await sharp(FIGURE).extract({ left: box.left, top: box.top, width: box.size, height: box.size }).resize(FACE_DETAIL_EDGE, FACE_DETAIL_EDGE).jpeg().toBuffer();
  const r = await composeFaceDetail(FIGURE, box, await respond(crop));
  assert.equal(r.applied, true);
  assert.ok((await regionDiff(r.bytes, FIGURE, { x0: 280, y0: 120, x1: 320, y1: 175 })) < 6, "脸部色调被拉回原图");
  assert.ok((await regionDiff(r.bytes, FIGURE, { x0: 0, y0: 0, x1: 600, y1: 60 })) < 1, "头顶上方的背景不变");
});

test("refineFace：送 2K 方图与正脸、侧脸参考；构图被改动时重试一次；时间不够不调用", async () => {
  const refs = { face: "data:image/jpeg;base64,RkFDRQ==", profile: "data:image/jpeg;base64,UFJPRklMRQ==" };
  const ok = await refineFace(FIGURE, refs, "female", AbortSignal.timeout(10_000));
  assert.equal(ok.applied, true);
  const submits = calls.filter((c) => c.url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit");
  assert.equal(submits.length, 1);
  const body = submits[0].body!;
  assert.equal(body.resolution, "2K");
  assert.equal(body.aspect_ratio, "1:1");
  const urls = body.image_urls as string[];
  assert.equal(urls.length, 3);
  assert.ok(urls[0].startsWith("data:image/jpeg;base64,"), "第一张是头部裁切");
  assert.deepEqual(urls.slice(1), [refs.face, refs.profile]);
  assert.match(String(body.prompt), /reference 2 \(her frontal face close-up\) and reference 3 \(her side profile\)/);
  assert.match(String(body.prompt), /Do not beautify/);

  calls = [];
  respond = async () => sharp(pngWithMetadata(200, 200, [90, 120, 160])).png().toBuffer();
  const moved = await refineFace(FIGURE, { face: refs.face }, "male", AbortSignal.timeout(10_000));
  assert.equal(moved.applied, false);
  assert.match(moved.reason ?? "", /^misaligned-/);
  assert.equal(moved.bytes, FIGURE);
  assert.equal(calls.filter((c) => c.url.endsWith("/nano-banana-pro/edit")).length, 2, "构图被改动时重试一次");
  assert.doesNotMatch(String(calls[0].body!.prompt), /reference 3/, "没有侧脸时不提参考 3");

  calls = [];
  failTimes = 2;
  const failed = await refineFace(FIGURE, refs, "female", AbortSignal.timeout(10_000));
  assert.equal(failed.applied, false);
  assert.equal(failed.reason, "gen-502");

  calls = [];
  const late = await refineFace(FIGURE, refs, "female", AbortSignal.timeout(10_000), Date.now() + 10_000);
  assert.equal(late.reason, "no-time");
  assert.equal(calls.length, 0, "剩余时间不足时不调用");

  const noHead = await refineFace(pngWithMetadata(300, 400), refs, "female", AbortSignal.timeout(10_000));
  assert.equal(noHead.reason, "no-head");
  assert.equal(calls.length, 0);
});

test("faceDetailPrompt：正面不传角度与传 front 逐字相同、不提转头；侧面要求保持四分之三侧的转头；refineFace 按角度送提示词", async () => {
  for (const g of ["female", "male"] as const) {
    for (const h of [true, false]) {
      assert.equal(faceDetailPrompt(g, h), faceDetailPrompt(g, h, "front"));
      assert.doesNotMatch(faceDetailPrompt(g, h), /three-quarter|head turn/);
      const side = faceDetailPrompt(g, h, "side");
      assert.match(side, /in a three-quarter view\./);
      assert.match(side, /Keep exactly the same three-quarter head turn; do not rotate the face toward the camera\./);
      assert.match(side, /Do not beautify/);
    }
  }
  assert.deepEqual(FACE_ELLIPSE.front, { cx: 0.5, cy: 0.45, rx: 0.23, ry: 0.29 }, "正面椭圆不变");

  const refs = { face: "data:image/jpeg;base64,RkFDRQ==" };
  const r = await refineFace(FIGURE, refs, "male", AbortSignal.timeout(10_000), Infinity, "side");
  assert.equal(r.applied, true);
  const submit = calls.find((c) => c.url === "https://queue.fal.run/fal-ai/nano-banana-pro/edit")!;
  assert.equal(String(submit.body!.prompt), faceDetailPrompt("male", false, "side"));
});

test("composeFaceDetail：侧面椭圆左移、更大，画面左侧脸颊处用精修结果，正面同一位置基本保留原图", async () => {
  const box = (await locateHead(FIGURE))!;
  const crop = await sharp(FIGURE).extract({ left: box.left, top: box.top, width: box.size, height: box.size }).resize(FACE_DETAIL_EDGE, FACE_DETAIL_EDGE).png().toBuffer();
  // 模拟模型在方块 (0.29, 0.45) 处画了一块蓝色：侧面椭圆的全用区里，正面椭圆的淡出带外缘
  const n = FACE_DETAIL_EDGE;
  const patch = { left: Math.round(0.27 * n), top: Math.round(0.41 * n), width: Math.round(0.04 * n), height: Math.round(0.08 * n) };
  const blue = await sharp({ create: { width: patch.width, height: patch.height, channels: 3, background: { r: 30, g: 60, b: 230 } } }).png().toBuffer();
  const out = await sharp(crop).composite([{ input: blue, left: patch.left, top: patch.top }]).png().toBuffer();
  const at = (k: number) => Math.round(box.left + k * box.size);
  const region = { x0: at(0.28), y0: Math.round(box.top + 0.43 * box.size), x1: at(0.3), y1: Math.round(box.top + 0.47 * box.size) };
  const [side, front] = await Promise.all([composeFaceDetail(FIGURE, box, out, "side"), composeFaceDetail(FIGURE, box, out, "front")]);
  assert.equal(side.applied, true);
  assert.equal(front.applied, true);
  const ds = await regionDiff(side.bytes, FIGURE, region);
  const df = await regionDiff(front.bytes, FIGURE, region);
  assert.ok(ds > 2 * df && ds > 15, `侧面贴回了左侧脸颊处的改动（侧面 ${ds.toFixed(1)}，正面 ${df.toFixed(1)}）`);
});
