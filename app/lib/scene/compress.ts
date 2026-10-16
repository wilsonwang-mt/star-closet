// 本人场景图入库前压缩（T3 遗留问题 3：fal 返回的 2K JPEG 每张 1.4–1.6MB）。
// 用 sharp（Next.js 自带的图片处理依赖，package.json 已显式声明）缩到长边 1600、JPEG q82，顺带去掉元数据。
// sharp 不可用或处理失败时返回 null，调用方原样保存，不影响生成结果。

export const SCENE_MAX_EDGE = 1600;
export const SCENE_JPEG_QUALITY = 82;

export type CompressedImage = { bytes: Uint8Array; mime: "image/jpeg"; ext: "jpg" };

export async function compressSceneImage(input: Uint8Array): Promise<CompressedImage | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(input)
      .rotate() // 按 EXIF 方向摆正后再丢掉元数据
      .resize({ width: SCENE_MAX_EDGE, height: SCENE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: SCENE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    // 原图本来就很小（例如已经是 1600 以内的低码率 JPEG）时，压缩后可能更大：那就保留原图。
    if (out.byteLength >= input.byteLength) return null;
    return { bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength), mime: "image/jpeg", ext: "jpg" };
  } catch {
    return null;
  }
}
