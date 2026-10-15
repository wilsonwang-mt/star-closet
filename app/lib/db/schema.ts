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

export const curator = pgTable("curator", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  closetType: text("closet_type").notNull(),
  closetName: text("closet_name").notNull(),
  intro: text("intro").notNull(),
});

export const item = pgTable("item", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  color: text("color").notNull(),
  price: integer("price").notNull(),
  currency: text("currency").notNull(),
  priceCheckedAt: text("price_checked_at"),
  buyUrl: text("buy_url").notNull(),
  image: text("image"),
  imageRights: text("image_rights"),
  imageRightsNote: text("image_rights_note"),
  sizeNote: text("size_note"),
  tags: text("tags").array().notNull().default([]),
});

export const outfit = pgTable("outfit", {
  id: text("id").primaryKey(),
  curatorId: text("curator_id")
    .notNull()
    .references(() => curator.id),
  name: text("name").notNull(),
  styleNote: text("style_note").notNull(),
  occasionTags: text("occasion_tags").array().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
});

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("avatar_job_user_idx").on(t.userId)],
);
