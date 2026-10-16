import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isSceneId, pickScenes, SCENES } from "./scenes";

const base = { occasionTags: [] as string[], styleTags: [] as string[], tags: [] as string[], category: "上装" };

test("pickScenes：总是返回 2 个不重复的已知场景", () => {
  for (const tags of [[], ["婚礼"], ["通勤", "静奢"], ["度假"], ["户外", "山系"], ["约会", "法式", "咖啡"]]) {
    const out = pickScenes({ ...base, occasionTags: tags });
    assert.equal(out.length, 2);
    assert.equal(new Set(out).size, 2);
    for (const s of out) assert.ok(isSceneId(s) && SCENES[s].title);
  }
});

test("pickScenes：婚礼单品优先户外婚礼，通勤单品有城市街头", () => {
  assert.equal(pickScenes({ ...base, occasionTags: ["婚礼", "派对"] })[0], "wedding");
  assert.ok(pickScenes({ ...base, styleTags: ["通勤"] }).includes("street"));
});

test("demoScenesFor：只接受 /demo/ 下的本站路径，缺视频为 null", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "scene-"));
  mkdirSync(path.join(dir, "public", "demo"), { recursive: true });
  writeFileSync(
    path.join(dir, "public", "demo", "manifest.json"),
    JSON.stringify({
      models: {},
      items: {
        I001: {
          model: "f01",
          scenes: [
            { id: "cafe", title: "周五的咖啡馆", image: "/demo/scenes/I001-cafe.jpg", live: "/demo/live/I001-cafe.mp4" },
            { id: "street", title: "城市街头黄昏", image: "/demo/scenes/I001-street.jpg", live: null },
            { id: "x", title: "外链", image: "https://evil.example/a.jpg", live: "javascript:alert(1)" },
            { id: "y", title: "穿越", image: "/demo/../../etc/passwd.jpg", live: null },
          ],
        },
      },
    }),
  );
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const { demoScenesFor } = await import("./scenes");
    const out = await demoScenesFor("I001");
    assert.deepEqual(
      out.map((s) => [s.id, s.live]),
      [
        ["cafe", "/demo/live/I001-cafe.mp4"],
        ["street", null],
      ],
    );
    assert.deepEqual(await demoScenesFor("I999"), []);
  } finally {
    process.chdir(cwd);
  }
});
