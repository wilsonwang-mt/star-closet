import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "./db";

// 个人档案：只能由服务端按当前登录用户读写。
// 身体数据（身高、体重）只有在 bodyDataConsent = true 时才保存；撤回同意即清空。

export type Profile = {
  displayName: string | null;
  bio: string | null;
  styleTags: string[];
  favoriteColors: string[];
  sizeTop: string | null;
  sizeBottom: string | null;
  sizeShoe: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyDataConsent: boolean;
  bodyDataConsentAt: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  city: string | null;
  visibility: "private";
  updatedAt: string | null;
};

const EMPTY: Profile = {
  displayName: null,
  bio: null,
  styleTags: [],
  favoriteColors: [],
  sizeTop: null,
  sizeBottom: null,
  sizeShoe: null,
  heightCm: null,
  weightKg: null,
  bodyDataConsent: false,
  bodyDataConsentAt: null,
  budgetMin: null,
  budgetMax: null,
  city: null,
  visibility: "private",
  updatedAt: null,
};

// 空字符串视为未填。
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const tagList = z
  .array(z.string().trim().min(1).max(20))
  .max(12)
  .transform((arr) => [...new Set(arr)]);

const optInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

export const ProfileInput = z
  .object({
    displayName: optText(30),
    bio: optText(300),
    styleTags: tagList,
    favoriteColors: tagList,
    sizeTop: optText(12),
    sizeBottom: optText(12),
    sizeShoe: optText(12),
    heightCm: optInt(80, 250),
    weightKg: optInt(20, 300),
    bodyDataConsent: z.boolean(),
    budgetMin: optInt(0, 1_000_000),
    budgetMax: optInt(0, 1_000_000),
    city: optText(30),
  })
  .strict()
  .refine((v) => v.budgetMin == null || v.budgetMax == null || v.budgetMin <= v.budgetMax, {
    message: "预算下限不能高于上限",
    path: ["budgetMax"],
  });

export type ProfileInputT = z.infer<typeof ProfileInput>;

function toProfile(row: typeof schema.profile.$inferSelect): Profile {
  return {
    displayName: row.displayName,
    bio: row.bio,
    styleTags: row.styleTags,
    favoriteColors: row.favoriteColors,
    sizeTop: row.sizeTop,
    sizeBottom: row.sizeBottom,
    sizeShoe: row.sizeShoe,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    bodyDataConsent: row.bodyDataConsent,
    bodyDataConsentAt: row.bodyDataConsentAt?.toISOString() ?? null,
    budgetMin: row.budgetMin,
    budgetMax: row.budgetMax,
    city: row.city,
    visibility: "private",
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getProfile(userId: string): Promise<Profile> {
  const rows = await db.select().from(schema.profile).where(eq(schema.profile.userId, userId)).limit(1);
  return rows[0] ? toProfile(rows[0]) : { ...EMPTY };
}

export async function upsertProfile(userId: string, input: ProfileInputT): Promise<Profile> {
  const now = new Date();
  const existing = await db
    .select({ consent: schema.profile.bodyDataConsent, consentAt: schema.profile.bodyDataConsentAt })
    .from(schema.profile)
    .where(eq(schema.profile.userId, userId))
    .limit(1);
  const prev = existing[0];
  const consent = input.bodyDataConsent;
  // 同意时间只在“未同意 → 同意”时记录；已同意则保留原时间。
  const consentAt = consent ? (prev?.consent && prev.consentAt ? prev.consentAt : now) : null;

  const row = {
    displayName: input.displayName,
    bio: input.bio,
    styleTags: input.styleTags,
    favoriteColors: input.favoriteColors,
    sizeTop: input.sizeTop,
    sizeBottom: input.sizeBottom,
    sizeShoe: input.sizeShoe,
    // 未同意时一律不保存身体数据，无论客户端传了什么。
    heightCm: consent ? input.heightCm : null,
    weightKg: consent ? input.weightKg : null,
    bodyDataConsent: consent,
    bodyDataConsentAt: consentAt,
    budgetMin: input.budgetMin,
    budgetMax: input.budgetMax,
    city: input.city,
    visibility: "private",
    updatedAt: now,
  };
  const saved = await db
    .insert(schema.profile)
    .values({ userId, ...row })
    .onConflictDoUpdate({ target: schema.profile.userId, set: row })
    .returning();
  return toProfile(saved[0]);
}

export async function clearBodyData(userId: string): Promise<void> {
  await db
    .update(schema.profile)
    .set({ heightCm: null, weightKg: null, bodyDataConsent: false, bodyDataConsentAt: null, updatedAt: new Date() })
    .where(eq(schema.profile.userId, userId));
}
