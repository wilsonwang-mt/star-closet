// 服务端图片检查：按文件头识别真实类型并读出宽高，不依赖 sharp 等原生库。
// 记录的是识别出的类型，不采信客户端声明的 Content-Type。

export type ImageInfo = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp"; width: number; height: number };

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length < 32) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: "image/png", ext: "png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG：遍历段，找 SOFn
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (b[i + 5] << 8) | b[i + 6];
        const width = (b[i + 7] << 8) | b[i + 8];
        return { mime: "image/jpeg", ext: "jpg", width, height };
      }
      if (marker === 0xda || len < 2) break;
      i += 2 + len;
    }
    return null;
  }
  // WebP
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    const chunk = tag(12);
    if (chunk === "VP8 ") {
      return { mime: "image/webp", ext: "webp", width: ((b[27] << 8) | b[26]) & 0x3fff, height: ((b[29] << 8) | b[28]) & 0x3fff };
    }
    if (chunk === "VP8L") {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return {
        mime: "image/webp",
        ext: "webp",
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }
    if (chunk === "VP8X") {
      return {
        mime: "image/webp",
        ext: "webp",
        width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
        height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
      };
    }
  }
  return null;
}

export type QualityFlags = {
  lowResolution: boolean; // 短边 < 512px
  landscapeForFullBody: boolean; // 全身照却是横图
  tinyFile: boolean; // 文件过小，可能过度压缩或几乎没有细节
};

export const FULL_BODY_SLOTS = ["front", "side", "back"] as const;

export function qualityFlags(slot: string, info: ImageInfo, bytes: number): QualityFlags {
  return {
    lowResolution: Math.min(info.width, info.height) < 512,
    landscapeForFullBody: (FULL_BODY_SLOTS as readonly string[]).includes(slot) && info.width > info.height,
    tinyFile: bytes < 20 * 1024,
  };
}

export const QUALITY_HINTS: Record<keyof QualityFlags, string> = {
  lowResolution: "分辨率偏低，细节可能丢失",
  landscapeForFullBody: "全身照建议竖拍，让头到脚都在画面里",
  tinyFile: "文件很小，可能过度压缩或画面过于单一",
};
