// 程序化生成的通用人台（GLB），作为没有 key 或未同意第三方处理时的“非本人示意模型”。
// 由本项目代码生成，不来自任何真人照片或扫描；与 public/models/mock-mannequin.glb 内容一致。
// 坐标：Y 轴向上，单位米，脚底在 y=0，身高约 1.71m，面朝 +Z。

type Part = {
  c: [number, number, number]; // 中心
  r: [number, number, number]; // 三轴半径
  rotZ?: number; // 绕 Z 轴旋转（弧度），用于手臂外展
};

const PARTS: Part[] = [
  { c: [0, 1.6, 0], r: [0.085, 0.11, 0.095] }, // 头
  { c: [0, 1.47, 0], r: [0.045, 0.06, 0.045] }, // 颈
  { c: [0, 1.28, 0], r: [0.17, 0.18, 0.1] }, // 胸
  { c: [0, 1.08, 0], r: [0.13, 0.12, 0.085] }, // 腰
  { c: [0, 0.95, 0], r: [0.16, 0.1, 0.1] }, // 胯
  ...([-1, 1] as const).flatMap((s): Part[] => [
    { c: [s * 0.19, 1.38, 0], r: [0.06, 0.05, 0.06] }, // 肩
    { c: [s * 0.22, 1.2, 0], r: [0.045, 0.16, 0.045], rotZ: s * 0.12 }, // 上臂
    { c: [s * 0.255, 0.92, 0], r: [0.038, 0.14, 0.038], rotZ: s * 0.1 }, // 前臂
    { c: [s * 0.275, 0.74, 0], r: [0.03, 0.06, 0.02] }, // 手
    { c: [s * 0.09, 0.68, 0], r: [0.07, 0.24, 0.075] }, // 大腿
    { c: [s * 0.09, 0.27, 0], r: [0.05, 0.22, 0.055] }, // 小腿
    { c: [s * 0.09, 0.035, 0.05], r: [0.045, 0.035, 0.11] }, // 脚
  ]),
];

const LAT = 16;
const LON = 24;

function buildMesh() {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const p of PARTS) {
    const base = pos.length / 3;
    const cos = Math.cos(p.rotZ ?? 0);
    const sin = Math.sin(p.rotZ ?? 0);
    const [rx, ry, rz] = p.r;
    for (let i = 0; i <= LAT; i++) {
      const theta = (i / LAT) * Math.PI;
      for (let j = 0; j <= LON; j++) {
        const phi = (j / LON) * Math.PI * 2;
        const ux = Math.sin(theta) * Math.cos(phi);
        const uy = Math.cos(theta);
        const uz = Math.sin(theta) * Math.sin(phi);
        const x = ux * rx;
        const y = uy * ry;
        const z = uz * rz;
        // 椭球法线 = (x/rx², y/ry², z/rz²) 归一化
        let nx = x / (rx * rx);
        let ny = y / (ry * ry);
        let nz = z / (rz * rz);
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        pos.push(p.c[0] + x * cos - y * sin, p.c[1] + x * sin + y * cos, p.c[2] + z);
        nor.push(nx * cos - ny * sin, nx * sin + ny * cos, nz);
      }
    }
    for (let i = 0; i < LAT; i++) {
      for (let j = 0; j < LON; j++) {
        const a = base + i * (LON + 1) + j;
        const b = a + LON + 1;
        // 逆时针为正面（glTF 约定）
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

const pad4 = (n: number) => (n + 3) & ~3;

export function buildMannequinGlb(): Uint8Array {
  const { pos, nor, idx } = buildMesh();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  }
  const posBytes = pos.byteLength;
  const norBytes = nor.byteLength;
  const idxBytes = idx.byteLength;
  const norOff = pad4(posBytes);
  const idxOff = norOff + pad4(norBytes);
  const binLen = pad4(idxOff + idxBytes);

  const gltf = {
    asset: { version: "2.0", generator: "star-closet procedural mannequin" },
    extras: { note: "非本人示意模型 · 程序生成，不代表任何真人" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "mannequin" }],
    meshes: [
      {
        name: "mannequin",
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0, mode: 4 }],
      },
    ],
    materials: [
      {
        name: "champagne-matte",
        pbrMetallicRoughness: { baseColorFactor: [0.82, 0.76, 0.68, 1], metallicFactor: 0, roughnessFactor: 0.62 },
      },
    ],
    buffers: [{ byteLength: binLen }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: norOff, byteLength: norBytes, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: idx.length, type: "SCALAR" },
    ],
  };

  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = pad4(jsonRaw.length);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonRaw, 20);
  out.fill(0x20, 20 + jsonRaw.length, 20 + jsonLen); // JSON 用空格补齐
  const binStart = 20 + jsonLen;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  const b = binStart + 8;
  out.set(new Uint8Array(pos.buffer, pos.byteOffset, posBytes), b);
  out.set(new Uint8Array(nor.buffer, nor.byteOffset, norBytes), b + norOff);
  out.set(new Uint8Array(idx.buffer, idx.byteOffset, idxBytes), b + idxOff);
  return out;
}

/** 检查字节是否为 GLB（文件头 magic 为 "glTF"）。 */
export function isGlb(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}
