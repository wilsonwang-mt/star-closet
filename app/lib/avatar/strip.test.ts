import assert from "node:assert/strict";
import { test } from "node:test";
import { sniffImage } from "./image";
import { readExifOrientation, stripMetadata } from "./strip";
import { contains, jpegWithExif, pngWithMetadata, SECRET, webpWithMetadata } from "./testing";

test("JPEG：删除 EXIF（含 GPS）、XMP、IPTC、注释，保留方向与图像段", () => {
  const src = jpegWithExif(80, 120, 6);
  assert.ok(contains(src, SECRET));
  const out = stripMetadata(src);
  assert.ok(out);
  assert.ok(!contains(out.bytes, SECRET), "元数据标记仍在文件里");
  assert.deepEqual([...new Set(out.removed)].sort(), ["COM", "EXIF", "IPTC", "XMP"]);
  // 只剩一个最小 APP1：只有 Orientation=6，没有 GPS 指针（0x8825）
  const b = out.bytes;
  const app1 = [...b.keys()].filter((i) => b[i] === 0xff && b[i + 1] === 0xe1);
  assert.equal(app1.length, 1);
  const len = (b[app1[0] + 2] << 8) | b[app1[0] + 3];
  const seg = b.subarray(app1[0] + 4, app1[0] + 2 + len);
  assert.equal(readExifOrientation(seg), 6);
  assert.ok(!Buffer.from(seg).includes(Buffer.from([0x88, 0x25])));
  // 宽高仍可识别，扫描数据原样保留
  assert.deepEqual(sniffImage(b), { mime: "image/jpeg", ext: "jpg", width: 80, height: 120 });
  assert.deepEqual([...b.subarray(-9)], [0x12, 0x34, 0x56, 0x78, 0xff, 0x00, 0x9a, 0xff, 0xd9]);
});

test("JPEG：方向为 1 时不写回任何 EXIF", () => {
  const out = stripMetadata(jpegWithExif(80, 120, 1))!;
  const b = out.bytes;
  assert.ok(![...b.keys()].some((i) => b[i] === 0xff && b[i + 1] === 0xe1));
});

test("PNG：删除 tEXt / eXIf，保留可解码的图像块", () => {
  const out = stripMetadata(pngWithMetadata(64, 96))!;
  assert.ok(out);
  assert.ok(!contains(out.bytes, SECRET));
  assert.deepEqual(out.removed.sort(), ["eXIf", "tEXt"]);
  assert.ok(contains(out.bytes, "IDAT") && contains(out.bytes, "IEND"));
  assert.deepEqual(sniffImage(out.bytes), { mime: "image/png", ext: "png", width: 64, height: 96 });
});

test("WebP：删除 EXIF / XMP 块，清掉 VP8X 标志位并修正 RIFF 长度", () => {
  const out = stripMetadata(webpWithMetadata(100, 150))!;
  assert.ok(out);
  const b = out.bytes;
  assert.ok(!contains(b, SECRET));
  assert.equal(b[20] & 0x0c, 0, "EXIF/XMP 标志位未清除");
  const riff = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  assert.equal(riff, b.byteLength - 8);
  assert.deepEqual(sniffImage(b), { mime: "image/webp", ext: "webp", width: 100, height: 150 });
});

test("不支持或损坏的文件返回 null", () => {
  assert.equal(stripMetadata(new TextEncoder().encode("GIF89a-not-supported-here")), null);
  const broken = jpegWithExif().subarray(0, 30);
  assert.equal(stripMetadata(broken), null);
});
