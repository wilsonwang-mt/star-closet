import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---- 账号（Better Auth 核心表）----
// 只存登录所需字段；个人档案、身体数据与照片放在下方 profile / avatar_* 表。

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- 衣橱目录 ----

// v0.2 字段见 docs/supply/目录结构与搜索维度.md。新增列都可空或带默认值，兼容已写入 v0.1 数据的库。
// gender：女装 | 男装 | 中性；closet_type：风格主题 | 穿搭博主 | 个人主理人 | 品牌主题（明星 预留）。

export const curator = pgTable("curator", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  closetType: text("closet_type").notNull(),
  closetName: text("closet_name").notNull(),
  intro: text("intro").notNull(),
  gender: text("gender").notNull().default("女装"),
  tagline: text("tagline"),
  styleTags: text("style_tags").array().notNull().default([]),
  palette: text("palette").array().notNull().default([]),
  avatar: text("avatar"), // 1:1 头像（品牌为标识图）
  cover: text("cover"), // 竖屏 9:16 衣橱场景图
  coverWide: text("cover_wide"), // 横屏 16:9，桌面用
  video: text("video"), // 竖屏 540×960 6 秒静音视频
  videoPoster: text("video_poster"), // 视频首帧 JPG
  personaNote: text("persona_note"), // 诚实标注：虚构示例 / AI 生成
});

export const item = pgTable(
  "item",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(), // 改编用 6 类：上装 下装 外套 鞋 包 配饰
    color: text("color").notNull(),
    price: integer("price").notNull(),
    currency: text("currency").notNull(),
    priceCheckedAt: text("price_checked_at"),
    buyUrl: text("buy_url").notNull(),
    image: text("image"),
    imageRights: text("image_rights"),
    imageRightsNote: text("image_rights_note"),
    sizeNote: text("size_note"),
    tags: text("tags").array().notNull().default([]), // 改编规则用的归一化标签
    curatorId: text("curator_id").references(() => curator.id), // 所属衣橱
    gender: text("gender").notNull().default("女装"),
    displayCategory: text("display_category"), // 展示 8 类（多出 连衣裙、半身裙）
    subcategory: text("subcategory"),
    colorFamily: text("color_family"),
    material: text("material"),
    season: text("season"), // 秋冬 | 春夏 | 春秋 | 四季
    fit: text("fit"),
    heel: text("heel"), // 平底 | 低跟 | 中跟 | 高跟 | 厚底；非鞋为空
    sizes: text("sizes").array().notNull().default([]), // 如 ["S","M","L","XL"]、["39",…,"45"]、["均码"]
    styleTags: text("style_tags").array().notNull().default([]),
    occasionTags: text("occasion_tags").array().notNull().default([]),
    searchKeyword: text("search_keyword"),
    buyLabel: text("buy_label"),
    priceNote: text("price_note"),
  },
  (t) => [index("item_curator_idx").on(t.curatorId), index("item_gender_idx").on(t.gender)],
);

export const outfit = pgTable(
  "outfit",
  {
    id: text("id").primaryKey(),
    curatorId: text("curator_id")
      .notNull()
      .references(() => curator.id),
    name: text("name").notNull(),
    styleNote: text("style_note").notNull(),
    occasionTags: text("occasion_tags").array().notNull().default([]),
    sortOrder: integer("sort_order").notNull().default(0),
    gender: text("gender").notNull().default("女装"),
    styleTags: text("style_tags").array().notNull().default([]),
    season: text("season"),
    budgetTier: text("budget_tier"), // 平价（<1200）| 适中（1200–1999）| 进阶（≥2000）
    cover: text("cover"), // 搭配封面（AI 生成街拍示意）
    coverNote: text("cover_note"), // 如“AI 生成场景示意 · 合身未验证”
  },
  (t) => [index("outfit_curator_idx").on(t.curatorId)],
);

export const outfitItem = pgTable(
  "outfit_item",
  {
    outfitId: text("outfit_id")
      .notNull()
      .references(() => outfit.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.outfitId, t.itemId] })],
);

// ---- 个人试衣间：用户保存的整套 ----

export const look = pgTable("look", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sourceOutfitId: text("source_outfit_id").references(() => outfit.id),
  title: text("title").notNull(),
  request: text("request"),
  summary: text("summary"),
  mode: text("mode").notNull(), // "original" | "ai" | "offline"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const lookItem = pgTable(
  "look_item",
  {
    lookId: text("look_id")
      .notNull()
      .references(() => look.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id),
    position: integer("position").notNull(),
    reason: text("reason"),
  },
  (t) => [primaryKey({ columns: [t.lookId, t.itemId] })],
);

// ---- 个人档案 ----
// 仅本人可见（visibility 固定 'private'，服务端不接受客户端修改）。
// 身体数据（height_cm / weight_kg）可空，只有 body_data_consent = true 时才保存；
// 撤回同意或调用 DELETE /api/profile/body-data 会清空。尺码属于普通档案字段。

export const profile = pgTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  bio: text("bio"),
  styleTags: text("style_tags").array().notNull().default([]),
  favoriteColors: text("favorite_colors").array().notNull().default([]),
  sizeTop: text("size_top"),
  sizeBottom: text("size_bottom"),
  sizeShoe: text("size_shoe"),
  heightCm: integer("height_cm"),
  weightKg: integer("weight_kg"),
  bodyDataConsent: boolean("body_data_consent").notNull().default(false),
  bodyDataConsentAt: timestamp("body_data_consent_at", { withTimezone: true }),
  budgetMin: integer("budget_min"),
  budgetMax: integer("budget_max"),
  city: text("city"),
  visibility: text("visibility").notNull().default("private"), // 固定 "private"
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- 3D 形象：用户上传的照片 ----
// storage_key 指向私有存储中的对象（不存图片本身）；软删除用 deleted_at，存储对象由删除流程一并移除。

export const avatarPhoto = pgTable(
  "avatar_photo",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(), // "front" | "side" | "back" | "face" | "extra"
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes"),
    qualityFlags: jsonb("quality_flags").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // 原始照片的清理期限：形象生成成功时写入（成功时间 + 30 天），到期后由清理流程删除。
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("avatar_photo_user_idx").on(t.userId)],
);

// ---- 3D 形象：生成任务 ----

export const avatarJob = pgTable(
  "avatar_job",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("draft"), // "draft" | "queued" | "processing" | "succeeded" | "failed" | "canceled"
    provider: text("provider").notNull().default("mock"), // "mock" | 真实服务名
    inputPhotoIds: jsonb("input_photo_ids").$type<string[]>().notNull().default([]),
    consentVersion: text("consent_version"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    resultGlbKey: text("result_glb_key"),
    resultPreviewKey: text("result_preview_key"),
    fidelityNote: text("fidelity_note"),
    error: text("error"),
    // 外部生成服务的任务编号与状态查询地址（持久化，替代进程内存；服务重启后可继续轮询）。
    providerTaskId: text("provider_task_id"),
    providerStatusUrl: text("provider_status_url"),
    // 数字分身（D63）：一组标准形象照的私有存储 key 与分析结果
    // { front, side, back, summary, traits, gender }；其他模式为 null。
    resultImages: jsonb("result_images").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("avatar_job_user_idx").on(t.userId)],
);

// ---- 2D 试穿（FASHN on fal.ai）----
// 把一整套衣服依次换到用户自己的正面全身照上。结果图存私有存储 `<userId>/avatars/tryon-<id>.png`
// （沿用现有 key 规则与鉴权文件路由，一键删除 3D 形象时随用户前缀一并清理）。

export const tryon = pgTable(
  "tryon",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceLookId: text("source_look_id"), // 试衣间里的一套（可空；删掉那套不影响试穿结果）
    sourceOutfitId: text("source_outfit_id"), // 原搭配编号（可空）
    // 发起试穿时的整套快照：[{ id, name, category, displayCategory, image, color, price }]
    outfitSnapshot: jsonb("outfit_snapshot").$type<Record<string, unknown>[]>().notNull().default([]),
    itemIds: jsonb("item_ids").$type<string[]>().notNull().default([]), // 实际试穿的单品（按叠加顺序）
    appliedCategories: jsonb("applied_categories").$type<string[]>().notNull().default([]), // 如 ["上装","下装","外套"]
    status: text("status").notNull().default("processing"), // "processing" | "succeeded" | "failed"
    resultKey: text("result_key"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tryon_user_idx").on(t.userId)],
);

// 试穿的第三方处理同意（D47）：首次试穿前单独勾选“同意把我的正面照发送给 FASHN（fal.ai）生成试穿图”。
export const tryonConsent = pgTable("tryon_consent", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  consentVersion: text("consent_version").notNull(), // 如 "tryon-consent-v1:fashn_fal"
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- 商品详情页“上身效果”：本人穿着这件单品出现在场景里（T3）----
// 输入为本人正面全身照（avatar_photo.slot = front）+ 单品图 + 场景描述，经 fal 生成场景图，再在后台生成 3–4 秒 Live 视频。
// 文件存私有存储 `<userId>/avatars/scene-<id>.jpg|mp4`（沿用现有 key 规则，一键删除时随用户前缀清理）。
// 同一用户同一件单品只保留最新一组结果。

export const sceneRender = pgTable(
  "scene_render",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    sceneId: text("scene_id").notNull(),
    status: text("status").notNull().default("processing"), // "processing" | "succeeded" | "failed"
    imageKey: text("image_key"),
    videoKey: text("video_key"),
    // fal queue 的状态查询地址；视频生成中时有值，完成或失败后清空。
    videoStatusUrl: text("video_status_url"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scene_render_user_item_idx").on(t.userId, t.itemId)],
);
