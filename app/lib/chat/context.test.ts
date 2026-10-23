// 悬浮对话上下文（D68）的单元测试：页面解析、用户描述不含身体数据、追问判断。不连数据库、不调用 AI。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadCatalog } from "../adapt/catalog-fixture";
import type { ChatCatalog } from "./catalog";
import { describePage, describeUser, hasOwnSignal, resolvePage, type ChatUser } from "./context";

function buildCatalog(): ChatCatalog {
  const raw = JSON.parse(readFileSync(path.join(process.cwd(), "data/catalog.json"), "utf-8")) as { curators: Record<string, unknown>[] };
  const { items, outfits } = loadCatalog();
  const seen = new Map<string, number>();
  return {
    closets: raw.curators.map((c) => ({
      id: String(c.curator_id),
      displayName: String(c.display_name),
      closetName: String(c.closet_name),
      closetType: String(c.closet_type),
      gender: String(c.gender ?? "女装"),
      tagline: String(c.tagline ?? ""),
      styleTags: (c.style_tags as string[]) ?? [],
      avatar: null,
      cover: "",
      outfitCount: outfits.filter((o) => o.curatorId === c.curator_id).length,
    })),
    outfits: outfits.map((o) => {
      const no = (seen.get(o.curatorId) ?? 0) + 1;
      seen.set(o.curatorId, no);
      return {
        id: o.id,
        curatorId: o.curatorId,
        name: o.name,
        styleNote: o.styleNote,
        occasionTags: o.occasionTags,
        styleTags: o.styleTags,
        season: o.season,
        budgetTier: o.budgetTier,
        gender: o.gender,
        total: o.total,
        cover: o.cover,
        no,
        itemIds: o.items.map((i) => i.id),
      };
    }),
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      subcategory: i.subcategory,
      color: i.color,
      material: i.material,
      price: i.price,
      gender: i.gender,
    })),
  };
}

const catalog = buildCatalog();

test("页面解析：只认目录里存在的 id", () => {
  assert.deepEqual(resolvePage("/outfit/O31", catalog), { kind: "outfit", outfitId: "O31" });
  assert.deepEqual(resolvePage("/closet/C04", catalog), { kind: "closet", closetId: "C04" });
  assert.deepEqual(resolvePage("/?c=C06", catalog), { kind: "home", closetId: "C06" });
  assert.deepEqual(resolvePage("/?c=C99", catalog), { kind: "home", closetId: null });
  assert.deepEqual(resolvePage("/outfit/O999", catalog), { kind: "other" });
  assert.deepEqual(resolvePage("/profile/avatar", catalog), { kind: "avatar" });
  assert.deepEqual(resolvePage("/bag", catalog), { kind: "bag" });
  assert.deepEqual(resolvePage(undefined, catalog), { kind: "home", closetId: null });
});

test("搭配页的说明让“这套”“这件”有着落", () => {
  const s = describePage({ kind: "outfit", outfitId: "O31" }, catalog);
  assert.match(s, /O31「户外草坪婚礼」/);
  assert.match(s, /“这套”/);
  const itemId = catalog.outfits.find((o) => o.id === "O31")!.itemIds[0];
  assert.match(describePage({ kind: "item", itemId }, catalog), /出现在搭配 .*O31/);
});

test("用户描述：带偏好与状态，不含身体数据", () => {
  const u: ChatUser = {
    signedIn: true,
    styleTags: ["静奢"],
    favoriteColors: ["燕麦"],
    sizeTop: "M",
    sizeBottom: "M",
    sizeShoe: "38",
    budgetMin: 500,
    budgetMax: 1500,
    city: "上海",
    avatar: "twin",
    tryonEnabled: true,
    looks: 2,
    bag: 1,
  };
  // 即使调用方误传了身高体重，也不会被写进描述
  const s = describeUser({ ...u, heightCm: 165, weightKg: 52 } as ChatUser);
  assert.match(s, /上装 M/);
  assert.match(s, /¥500–¥1500/);
  assert.match(s, /已建立数字分身/);
  assert.doesNotMatch(s, /165|52|身高|体重/);
  assert.match(describeUser(null), /未登录/);
});

test("追问判断：“为什么”“鞋子是什么”没有自己的找衣服条件", () => {
  assert.equal(hasOwnSignal("下周户外婚礼，1500 以内", catalog), true);
  assert.equal(hasOwnSignal("只看女装", catalog), true);
  assert.equal(hasOwnSignal("帮我打开试衣间", catalog), true);
  assert.equal(hasOwnSignal("第一套为什么适合我？", catalog), false);
  assert.equal(hasOwnSignal("你好", catalog), false);
});
