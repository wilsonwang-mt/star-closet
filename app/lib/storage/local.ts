import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertKey, assertUserId, type StorageDriver } from "./types";

// 本地驱动：开发与比赛演示用，文件写到 app/.data/uploads/<userId>/...（.data 已被 .gitignore 忽略）。
// 内容类型按扩展名推断，不额外存元数据文件。
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  glb: "model/gltf-binary",
};

export function localDriver(root = process.env.UPLOADS_DIR ?? path.join(process.cwd(), ".data", "uploads")): StorageDriver {
  const abs = (key: string) => {
    const p = path.resolve(root, assertKey(key));
    // 双保险：解析后仍必须位于根目录内。
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error("invalid storage key");
    return p;
  };
  return {
    kind: "local",
    async put(key, bytes) {
      const p = abs(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, bytes);
    },
    async get(key) {
      try {
        const bytes = await readFile(abs(key));
        const ext = key.split(".").pop() ?? "";
        return { bytes: new Uint8Array(bytes), contentType: MIME[ext] ?? "application/octet-stream" };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async remove(keys) {
      await Promise.all(keys.map((k) => rm(abs(k), { force: true })));
    },
    async removeUserPrefix(userId) {
      await rm(path.join(path.resolve(root), assertUserId(userId)), { recursive: true, force: true });
    },
    async signedUrl() {
      return null;
    },
  };
}
