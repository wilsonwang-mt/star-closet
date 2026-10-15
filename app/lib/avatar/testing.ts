// 测试用合成图片（纯色，带伪造的 EXIF/GPS 等元数据），只用于单元测试与本地联调，不含任何真实人物或真实位置。
import { crc32, deflateSync } from "node:zlib";

/** 测试里塞进元数据的标记字符串：剥离后不应再出现在文件里。 */
export const SECRET = "SC-TEST-GPS-31.2304N-121.4737E";

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const bytesOf = (s: string) => [...Buffer.from(s, "latin1")];

function segment(marker: number, payload: number[]) {
  return [0xff, marker, ...be16(payload.length + 2), ...payload];
}

/** 带 EXIF（方向=orientation、GPS 子 IFD）、XMP、IPTC、COM 的最小 JPEG 结构（像素数据为占位）。 */
export function jpegWithExif(width = 80, height = 120, orientation = 6): Uint8Array {
  // TIFF（大端）：IFD0 两个字段——Orientation 与 GPS IFD 指针；GPS IFD 一个 ASCII 字段放 SECRET。
  const secret = bytesOf(SECRET + "\0");
  const ifd0 = 8;
  const gpsIfd = ifd0 + 2 + 2 * 12 + 4;
  const gpsData = gpsIfd + 2 + 12 + 4;
  const tiff = [
    0x4d, 0x4d, 0x00, 0x2a, ...be32(ifd0),
    ...be16(2),
    ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0,
    ...be16(0x8825), ...be16(4), ...be32(1), ...be32(gpsIfd),
    ...be32(0),
    ...be16(1),
    ...be16(0x0002), ...be16(2), ...be32(secret.length), ...be32(gpsData),
    ...be32(0),
    ...secret,
  ];
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [...bytesOf("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xe1, [...bytesOf("Exif\0\0"), ...tiff]),
    ...segment(0xe1, [...bytesOf("http://ns.adobe.com/xap/1.0/\0"), ...bytesOf(`<x:xmpmeta>${SECRET}</x:xmpmeta>`)]),
    ...segment(0xed, [...bytesOf("Photoshop 3.0\0"), ...bytesOf(SECRET)]),
    ...segment(0xfe, bytesOf(SECRET)),
    ...segment(0xdb, [0, ...new Array(64).fill(1)]),
    ...segment(0xc0, [8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0x34, 0x56, 0x78, 0xff, 0x00, 0x9a,
    0xff, 0xd9,
  ]);
}

function pngChunk(type: string, data: number[]) {
  const td = Buffer.from([...bytesOf(type), ...data]);
  return [...be32(data.length), ...td, ...be32(crc32(td))];
}

/** 纯色 PNG（真实可解码），附带 tEXt 与 eXIf 元数据块。 */
export function pngWithMetadata(width = 64, height = 96, rgb: [number, number, number] = [201, 169, 110]): Uint8Array {
  const row = [0, ...Array.from({ length: width }, () => rgb).flat()];
  const raw = Buffer.from(Array.from({ length: height }, () => row).flat());
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk("IHDR", [...be32(width), ...be32(height), 8, 2, 0, 0, 0]),
    ...pngChunk("tEXt", [...bytesOf("Comment\0"), ...bytesOf(SECRET)]),
    ...pngChunk("eXIf", [0x4d, 0x4d, 0, 0x2a, ...be32(8), ...bytesOf(SECRET)]),
    ...pngChunk("IDAT", [...deflateSync(raw)]),
    ...pngChunk("IEND", []),
  ]);
}

/** VP8X 扩展格式 WebP 结构，带 EXIF 与 XMP 块（图像块为占位）。 */
export function webpWithMetadata(width = 100, height = 150): Uint8Array {
  const chunk = (tag: string, data: number[]) => [...bytesOf(tag), ...le32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  const w = width - 1;
  const h = height - 1;
  const body = [
    ...bytesOf("WEBP"),
    ...chunk("VP8X", [0x08 | 0x04, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]),
    ...chunk("VP8L", [0x2f, 0, 0, 0, 0, 1, 2]),
    ...chunk("EXIF", bytesOf(SECRET)),
    ...chunk("XMP ", bytesOf(`<x>${SECRET}</x>`)),
  ];
  return new Uint8Array([...bytesOf("RIFF"), ...le32(body.length), ...body]);
}

export function contains(hay: Uint8Array, needle: string): boolean {
  return Buffer.from(hay).includes(Buffer.from(needle, "latin1"));
}
