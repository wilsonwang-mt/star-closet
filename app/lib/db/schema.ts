import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---- 账号（Better Auth 核心表）----
// 只存登录所需字段；不存任何身体数据或照片。

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
