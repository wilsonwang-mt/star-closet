// 建表并把 data/catalog.json 写入本地数据库（可重复执行）。
// 用法：npm run db:setup（会读取 .env.local）。
// - 设置了 DATABASE_URL：写入 Supabase。迁移需要会话模式连接，可另设 DATABASE_MIGRATE_URL（5432 端口）。
// - 没有设置：写入本地 PGlite；开发服务器运行时请先停掉，PGlite 同一时间只允许一个进程打开。
import { readFileSync } from "node:fs";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db, dbKind, schema } from "../lib/db";

type CuratorJson = {
  curator_id: string;
  display_name: string;
  closet_type: string;
  closet_name: string;
  intro: string;
};

// v0.1 用单个 curator；v0.2 用 curators[]，搭配用 curator_id 指明所属衣橱。两种格式都接受。
type CatalogJson = {
  curator?: CuratorJson;
  curators?: CuratorJson[];
  outfits: {
    outfit_id: string;
    curator_id?: string;
    name: string;
    style_note: string;
    occasion_tags: string[];
    item_ids: string[];
  }[];
  items: {
    item_id: string;
    name: string;
    category: string;
    color: string;
    price: number;
    currency: string;
    price_checked_at?: string;
    buy_url: string;
    image?: string;
    image_rights?: string;
    image_rights_note?: string;
    size_note?: string;
    tags?: string[];
  }[];
};

const CATEGORIES = new Set(["上装", "下装", "外套", "鞋", "包", "配饰"]);
const IMAGE_RIGHTS = ["自有拍摄", "商家书面授权", "AI 生成"];

function curatorsOf(c: CatalogJson): CuratorJson[] {
  return c.curators ?? (c.curator ? [c.curator] : []);
}

function validate(c: CatalogJson) {
  const errors: string[] = [];
  const curators = curatorsOf(c);
  if (curators.length === 0) errors.push("没有主理人（curator 或 curators）");
  const cids = new Set(curators.map((x) => x.curator_id));
  const ids = new Set<string>();
  for (const i of c.items) {
    if (ids.has(i.item_id)) errors.push(`单品编号重复：${i.item_id}`);
    ids.add(i.item_id);
    if (!CATEGORIES.has(i.category)) errors.push(`${i.item_id} 类别不合规：${i.category}`);
    if (!Number.isInteger(i.price) || i.price <= 0) errors.push(`${i.item_id} 价格不是正整数`);
    if (i.image && !IMAGE_RIGHTS.includes(i.image_rights ?? ""))
      errors.push(`${i.item_id} 有图片但图片来源不合规（只能是 ${IMAGE_RIGHTS.join(" / ")}）`);
  }
  const oids = new Set<string>();
  for (const o of c.outfits) {
    if (oids.has(o.outfit_id)) errors.push(`搭配编号重复：${o.outfit_id}`);
    oids.add(o.outfit_id);
    if (curators.length > 1 && !o.curator_id) errors.push(`${o.outfit_id} 缺少 curator_id`);
    if (o.curator_id && !cids.has(o.curator_id)) errors.push(`${o.outfit_id} 的 curator_id 不存在：${o.curator_id}`);
    for (const id of o.item_ids) if (!ids.has(id)) errors.push(`${o.outfit_id} 引用了不存在的单品 ${id}`);
  }
  if (errors.length) throw new Error("目录校验失败：\n" + errors.join("\n"));
}

async function main() {
  const catalog: CatalogJson = JSON.parse(readFileSync("data/catalog.json", "utf-8"));
  validate(catalog);

  if (dbKind === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  } else {
    const sql = postgres(process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL!, { max: 1 });
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzlePostgres(sql), { migrationsFolder: "./drizzle" });
    await sql.end();
  }

  await db.transaction(async (tx) => {
    // 目录整体重写；用户的试衣间引用单品编号，所以单品只做 upsert、不删除。
    const curators = curatorsOf(catalog);
    for (const c of curators) {
      const row = { displayName: c.display_name, closetType: c.closet_type, closetName: c.closet_name, intro: c.intro };
      await tx
        .insert(schema.curator)
        .values({ id: c.curator_id, ...row })
        .onConflictDoUpdate({ target: schema.curator.id, set: row });
    }

    for (const i of catalog.items) {
      const row = {
        id: i.item_id,
        name: i.name,
        category: i.category,
        color: i.color,
        price: i.price,
        currency: i.currency,
        priceCheckedAt: i.price_checked_at || null,
        buyUrl: i.buy_url,
        image: i.image || null,
        imageRights: i.image_rights || null,
        imageRightsNote: i.image_rights_note || null,
        sizeNote: i.size_note || null,
        tags: i.tags ?? [],
      };
      await tx.insert(schema.item).values(row).onConflictDoUpdate({ target: schema.item.id, set: row });
    }

    await tx.delete(schema.outfitItem);
    for (const [idx, o] of catalog.outfits.entries()) {
      const row = {
        id: o.outfit_id,
        curatorId: o.curator_id ?? curators[0].curator_id,
        name: o.name,
        styleNote: o.style_note,
        occasionTags: o.occasion_tags,
        sortOrder: idx,
      };
      await tx.insert(schema.outfit).values(row).onConflictDoUpdate({ target: schema.outfit.id, set: row });
      await tx
        .insert(schema.outfitItem)
        .values(o.item_ids.map((itemId, position) => ({ outfitId: o.outfit_id, itemId, position })));
    }
  });

  console.log(`已写入 ${catalog.items.length} 件单品、${catalog.outfits.length} 套搭配（${dbKind === "postgres" ? "Supabase" : "本地 PGlite"}）。`);
  if (dbKind === "postgres") console.log("提醒：首次写入 Supabase 后，请在 SQL Editor 执行一次 supabase/rls.sql，为所有表开启 RLS。");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
