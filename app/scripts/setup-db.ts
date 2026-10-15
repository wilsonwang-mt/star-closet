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
  // v0.2
  gender?: string;
  tagline?: string;
  style_tags?: string[];
  palette?: string[];
  avatar?: string;
  cover?: string;
  cover_wide?: string;
  video?: string;
  video_poster?: string;
  persona_note?: string;
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
    // v0.2
    gender?: string;
    style_tags?: string[];
    season?: string;
    budget_tier?: string;
    cover?: string;
    cover_note?: string;
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
    // v0.2
    curator_id?: string;
    gender?: string;
    display_category?: string;
    subcategory?: string;
    color_family?: string;
    material?: string;
    season?: string;
    fit?: string;
    heel?: string | null;
    sizes?: string[];
    style_tags?: string[];
    occasion_tags?: string[];
    search_keyword?: string;
    buy_label?: string;
    price_note?: string;
  }[];
};

const CATEGORIES = new Set(["上装", "下装", "外套", "鞋", "包", "配饰"]);
const IMAGE_RIGHTS = ["自有拍摄", "商家书面授权", "AI 生成"];
const GENDERS = new Set(["女装", "男装", "中性"]);
const CLOSET_TYPES = new Set(["风格主题", "穿搭博主", "个人主理人", "品牌主题", "明星"]);
const BUDGET_TIERS = new Set(["平价", "适中", "进阶"]);

function curatorsOf(c: CatalogJson): CuratorJson[] {
  return c.curators ?? (c.curator ? [c.curator] : []);
}

function validate(c: CatalogJson) {
  const errors: string[] = [];
  const curators = curatorsOf(c);
  if (curators.length === 0) errors.push("没有主理人（curator 或 curators）");
  const cids = new Set(curators.map((x) => x.curator_id));
  for (const x of curators) {
    if (x.gender && !GENDERS.has(x.gender)) errors.push(`${x.curator_id} 性别不合规：${x.gender}`);
    if (!CLOSET_TYPES.has(x.closet_type)) errors.push(`${x.curator_id} 入驻方类型不合规：${x.closet_type}`);
  }
  const ids = new Set<string>();
  for (const i of c.items) {
    if (ids.has(i.item_id)) errors.push(`单品编号重复：${i.item_id}`);
    ids.add(i.item_id);
    if (!CATEGORIES.has(i.category)) errors.push(`${i.item_id} 类别不合规：${i.category}`);
    if (!Number.isInteger(i.price) || i.price <= 0) errors.push(`${i.item_id} 价格不是正整数`);
    if (i.image && !IMAGE_RIGHTS.includes(i.image_rights ?? ""))
      errors.push(`${i.item_id} 有图片但图片来源不合规（只能是 ${IMAGE_RIGHTS.join(" / ")}）`);
    if (i.gender && !GENDERS.has(i.gender)) errors.push(`${i.item_id} 性别不合规：${i.gender}`);
    if (i.curator_id && !cids.has(i.curator_id)) errors.push(`${i.item_id} 的 curator_id 不存在：${i.curator_id}`);
    if (i.sizes && (!Array.isArray(i.sizes) || i.sizes.length === 0)) errors.push(`${i.item_id} 尺码为空`);
  }
  const itemGender = new Map(c.items.map((i) => [i.item_id, i.gender ?? "女装"]));
  const oids = new Set<string>();
  for (const o of c.outfits) {
    if (oids.has(o.outfit_id)) errors.push(`搭配编号重复：${o.outfit_id}`);
    oids.add(o.outfit_id);
    if (curators.length > 1 && !o.curator_id) errors.push(`${o.outfit_id} 缺少 curator_id`);
    if (o.curator_id && !cids.has(o.curator_id)) errors.push(`${o.outfit_id} 的 curator_id 不存在：${o.curator_id}`);
    for (const id of o.item_ids) if (!ids.has(id)) errors.push(`${o.outfit_id} 引用了不存在的单品 ${id}`);
    if (o.gender && !GENDERS.has(o.gender)) errors.push(`${o.outfit_id} 性别不合规：${o.gender}`);
    if (o.budget_tier && !BUDGET_TIERS.has(o.budget_tier)) errors.push(`${o.outfit_id} 预算档不合规：${o.budget_tier}`);
    // 男装搭配不能含女装单品，反之亦然；中性单品可进任何搭配。
    const og = o.gender ?? "女装";
    for (const id of o.item_ids) {
      const g = itemGender.get(id);
      if (g && g !== "中性" && og !== "中性" && g !== og) errors.push(`${o.outfit_id}（${og}）含${g}单品 ${id}`);
    }
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
      const row = {
        displayName: c.display_name,
        closetType: c.closet_type,
        closetName: c.closet_name,
        intro: c.intro,
        gender: c.gender ?? "女装",
        tagline: c.tagline || null,
        styleTags: c.style_tags ?? [],
        palette: c.palette ?? [],
        avatar: c.avatar || null,
        cover: c.cover || null,
        coverWide: c.cover_wide || null,
        video: c.video || null,
        videoPoster: c.video_poster || null,
        personaNote: c.persona_note || null,
      };
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
        curatorId: i.curator_id || null,
        gender: i.gender ?? "女装",
        displayCategory: i.display_category || null,
        subcategory: i.subcategory || null,
        colorFamily: i.color_family || null,
        material: i.material || null,
        season: i.season || null,
        fit: i.fit || null,
        heel: i.heel || null,
        sizes: i.sizes ?? [],
        styleTags: i.style_tags ?? [],
        occasionTags: i.occasion_tags ?? [],
        searchKeyword: i.search_keyword || null,
        buyLabel: i.buy_label || null,
        priceNote: i.price_note || null,
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
        gender: o.gender ?? "女装",
        styleTags: o.style_tags ?? [],
        season: o.season || null,
        budgetTier: o.budget_tier || null,
        cover: o.cover || null,
        coverNote: o.cover_note || null,
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
