// 服务端剥离照片元数据（EXIF 含 GPS、XMP、IPTC、文字注释等），不依赖 sharp 等原生库。
// 只删元数据段/块，不动像素数据，因此不会二次压缩、也不改变宽高。
// - JPEG：删除 APP1（Exif / XMP）、非 ICC 的 APP2（如 MPF）、APP3–APP15（含 APP13 IPTC）、COM 注释，
//   以及 EOI 之后的附加数据（动态照片视频、副图等）；保留 APP0（JFIF）、APP2 ICC 色彩配置、APP14（Adobe）和全部图像段。若原图 EXIF 带非默认的方向（Orientation），
//   重新写入一个只含方向字段的最小 EXIF，保证剥离后不会“躺倒”；其余字段（拍摄时间、设备、GPS 等）一律不保留。
// - PNG：只保留白名单内的块（图像数据与色彩相关），删除 eXIf、tEXt、zTXt、iTXt、tIME 等。
// - WebP：删除 EXIF 与 XMP 块，清掉 VP8X 头里对应的标志位并重算 RIFF 长度。
// 无法识别或结构损坏时返回 null，由调用方拒收。

export type StripResult = { bytes: Uint8Array; removed: string[] };

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

// ---------- JPEG ----------

/** 从 APP1 Exif 段读取 IFD0 的 Orientation（0x0112）；没有或无法解析时返回 1。 */
export function readExifOrientation(seg: Uint8Array): number {
  // seg 从 "Exif\0\0" 开始
  if (seg.byteLength < 14 || ascii(seg, 0, 4) !== "Exif") return 1;
  const t = 6;
  const le = seg[t] === 0x49 && seg[t + 1] === 0x49;
  const be = seg[t] === 0x4d && seg[t + 1] === 0x4d;
  if (!le && !be) return 1;
  const r16 = (o: number) => (le ? seg[o] | (seg[o + 1] << 8) : u16be(seg, o));
  const r32 = (o: number) => (le ? u32le(seg, o) : u32be(seg, o));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > seg.byteLength) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > seg.byteLength) return 1;
    if (r16(e) === 0x0112) {
      const v = r16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** 只含 Orientation 一个字段的最小 APP1 段（含 FFE1 标记与长度）。 */
function orientationApp1(orientation: number): Uint8Array {
  const body = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF 头（大端），IFD0 在偏移 8
    0x00, 0x01, // 1 个字段
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT ×1
    0x00, 0x00, 0x00, 0x00, // 没有下一个 IFD
  ]);
  const len = body.byteLength + 2;
  return concat([new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff]), body]);
}

function stripJpeg(b: Uint8Array): StripResult | null {
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  const removed: string[] = [];
  let orientation = 1;
  let i = 2;
  while (i < b.byteLength) {
    if (b[i] !== 0xff) return null;
    // 填充字节
    if (b[i + 1] === 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd9) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      break;
    }
    // 无长度的独立标记
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (i + 4 > b.byteLength) return null;
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.byteLength) return null;
    const seg = b.subarray(i, i + 2 + len);
    if (marker === 0xda) {
      // 扫描段之后是熵编码数据，保留到第一个 EOI（FF D9）为止。熵编码数据里 FF 后只会跟 00 或 D0–D7，
      // 渐进式 JPEG 的扫描之间只有 C4/DB/DA/DD 等段，所以第一个 FF D9 就是真正的结尾。
      // EOI 之后的附加数据（手机“动态照片”附带的视频、MPF 副图/深度图等）一律丢弃。
      let end = -1;
      for (let k = i + 2 + len; k + 1 < b.byteLength; k++) {
        if (b[k] === 0xff && b[k + 1] === 0xd9) {
          end = k + 2;
          break;
        }
      }
      if (end < 0) {
        parts.push(b.subarray(i));
      } else {
        parts.push(b.subarray(i, end));
        if (end < b.byteLength) removed.push("TRAILER");
      }
      i = b.byteLength;
      break;
    }
    const payload = seg.subarray(4);
    if (marker === 0xe1) {
      if (ascii(payload, 0, 4) === "Exif") {
        orientation = readExifOrientation(payload);
        removed.push("EXIF");
      } else {
        removed.push("XMP");
      }
    } else if (marker === 0xe2 && ascii(payload, 0, 12) !== "ICC_PROFILE\0") {
      // APP2 只保留 ICC 色彩配置；MPF（多图索引，指向 EOI 之后的副图）等一并删除。
      removed.push("APP2");
    } else if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) {
      removed.push(marker === 0xed ? "IPTC" : `APP${marker - 0xe0}`);
    } else if (marker === 0xfe) {
      removed.push("COM");
    } else {
      parts.push(seg);
    }
    i += 2 + len;
  }
  if (orientation !== 1) {
    // 插在 SOI 之后、紧跟 APP0（若有）。
    const app0 = parts[1] && parts[1][1] === 0xe0 ? 2 : 1;
    parts.splice(app0, 0, orientationApp1(orientation));
  }
  return { bytes: concat(parts), removed };
}

// ---------- PNG ----------

const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs", "bKGD"]);

function stripPng(b: Uint8Array): StripResult | null {
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  let i = 8;
  let ended = false;
  while (i + 12 <= b.byteLength) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.byteLength) return null;
    if (PNG_KEEP.has(type)) parts.push(b.subarray(i, end));
    else removed.push(type);
    i = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended) return null;
  return { bytes: concat(parts), removed };
}

// ---------- WebP ----------

function stripWebp(b: Uint8Array): StripResult | null {
  const parts: Uint8Array[] = [];
  const removed: string[] = [];
  const riffEnd = Math.min(b.byteLength, 8 + u32le(b, 4));
  let i = 12;
  let vp8xIndex = -1;
  while (i + 8 <= riffEnd) {
    const tag = ascii(b, i, 4);
    const size = u32le(b, i + 4);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.byteLength) return null;
    const chunk = b.subarray(i, Math.min(end, b.byteLength));
    if (tag === "EXIF" || tag === "XMP ") {
      removed.push(tag.trim());
    } else {
      if (tag === "VP8X") vp8xIndex = parts.length;
      parts.push(chunk);
    }
    i = end;
  }
  if (vp8xIndex >= 0) {
    const x = new Uint8Array(parts[vp8xIndex]);
    x[8] &= ~(0x08 | 0x04); // 清掉 EXIF、XMP 标志位
    parts[vp8xIndex] = x;
  }
  const body = concat(parts);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46], 0);
  const size = body.byteLength + 4;
  header.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  return { bytes: concat([header, body]), removed };
}

/** 按文件头选择格式并剥离元数据；不支持的格式或结构损坏返回 null。 */
export function stripMetadata(b: Uint8Array): StripResult | null {
  if (b.byteLength < 16) return null;
  try {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return stripJpeg(b);
    if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return stripPng(b);
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return stripWebp(b);
  } catch {
    return null;
  }
  return null;
}
