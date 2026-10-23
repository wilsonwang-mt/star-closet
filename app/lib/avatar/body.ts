import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { getProfile } from "@/lib/profile";
import { getStorage } from "@/lib/storage";
import { BODY_BLENDS, clampBlend, normalizeBlends, type BodyBlends, type MpGender } from "./metaperson-protocol";

// 体型分析（D56）：读取本人全身正面（必需）与侧面（可选）照片和档案身高体重，给出 MetaPerson 的 8 个身体比例参数
// 和一句不超过 30 字的体型概括，在 generate_avatar 时作为 blends 传入。
// - 用户在同意卡上单独勾选“由 Anthropic（Claude）分析我的全身照……”且配置了 ANTHROPIC_API_KEY 时调用 Claude；
// - 否则、或调用失败/拒绝时，只按身高体重的 BMI 粗略设定 Body / Waist / Hips（其余为 0），不报错。
// MetaPerson 用一张正脸照建脸，身体只是 8 个比例参数：这里只能“参考照片微调体型”，不是还原身材。
// 只有 Claude 的结果会存：挂在当前全身正面照的 avatar_photo.quality_flags.bodyAnalysis 上（不改表结构），照片换了自然失效；
// 照片删除后由 scrubDeletedBodyAnalysis 抹掉；撤回体型分析同意后下次分析时删除。身高体重的估算是纯算术，每次重算、不存，
// 因而档案里清空身高体重后不会在别处留下副本。
// 多语言（D70）：概括按请求语言写（locale 从接口传入，默认中文），存储时记下语言 lang；换了语言视为没有缓存、重新分析一次。

const MODEL = "claude-opus-5-5";
const SUMMARY_MAX = 30;
/** 英文概括的字符上限（约 15 个词）。 */
const SUMMARY_MAX_EN = 90;

export type BodySource = "claude" | "bmi" | "none";

export type BodyAnalysis = {
  source: BodySource;
  gender: MpGender | null;
  blends: BodyBlends;
  summary: string | null;
  /** summary 的语言（旧记录没有，视为中文）。 */
  lang: Locale;
  /** 分析时用的全身正面、侧面照片 id（侧面可缺） */
  photoIds: string[];
  at: string;
};

/** 给浏览器的视图。lang 为 summary 的语言：与当前界面语言不同时，接口边界不显示这句（lib/avatar/l10n.ts）。 */
export type BodyAnalysisView = Pick<BodyAnalysis, "source" | "gender" | "blends" | "summary" | "lang">;

const toView = (a: BodyAnalysis): BodyAnalysisView => ({ source: a.source, gender: a.gender, blends: a.blends, summary: a.summary, lang: a.lang });

// 数值范围不写进 schema：SDK 会把不支持的约束挪到客户端校验，越界一点就整个解析失败；范围由 clampBlend 裁剪。
const bodySchema = (locale: Locale) =>
  z.object({
    gender: z.enum(["male", "female"]).describe("最接近的 3D 身体模板"),
    blends: z.object(
      Object.fromEntries(BODY_BLENDS.map((n) => [n, z.number().describe("-1 到 1，0 为平均比例")])) as Record<
        (typeof BODY_BLENDS)[number],
        z.ZodNumber
      >,
    ),
    summary: z.string().describe(locale === "en" ? "One-sentence body-proportion summary in English, at most 15 words" : "不超过 30 字的中文体型概括"),
  });
const BodySchema = bodySchema(DEFAULT_LOCALE);
export type ModelBody = z.infer<typeof BodySchema>;

const SYSTEM = `你在为线上买手店 SEEN. 的 3D 形象微调身体比例。输入是同一个人的全身正面照（可能还有全身侧面照），以及可选的身高体重。
3D 形象有 8 个身体比例参数，取值 -1 到 1，0 表示该身体模板成年人的平均比例：
- Body：整体体量（偏纤细为负，偏丰满为正）
- Neck：颈部粗细
- Shoulders：肩宽
- Chest：胸廓
- Forearms：手臂粗细
- Waist：腰围
- Hips：胯部宽度
- Legs：腿长占身高的比例（腿更长为正）

规则：
1. 只依据照片里看得清的轮廓估计；衣服宽松、姿势或角度遮挡、看不清的部位填 0。宁可保守，绝对值一般不超过 0.6。
2. gender 只用于选择 3D 身体模板（male 或 female），按照片中最接近的模板选择。
3. summary 用中文写一句不超过 30 字的体型概括，只描述比例与线条，例如“肩线偏窄、腰线较高、腿部比例修长”。用中性、不评判的服装搭配语言：不写体重数字，不用“胖”“瘦”“身材好/差”等评价词，不写“精准”“还原”“复刻”之类的说法。
4. 不识别、不描述人物身份、面部、年龄或其他与身体比例无关的特征。`;

// 英文界面：只换概括的语言要求（第 3 条），其余规则相同。
const SYSTEM_EN = SYSTEM.replace(
  /^3\. summary .*$/m,
  "3. summary 用英文（English）写一句不超过 15 个词的体型概括，只描述比例与线条，例如 “Narrow shoulders, a high waist and long legs”。" +
    "用中性、不评判的服装搭配语言：不写体重数字，不用 fat、thin、skinny、good/bad figure 之类的评价词，不写 precise、exact、replica、1:1 之类的说法。不要夹带中文。",
);

/** 给模型的系统提示：概括用哪种语言写。 */
export function bodySystemPrompt(locale: Locale = DEFAULT_LOCALE): string {
  return locale === "en" ? SYSTEM_EN : SYSTEM;
}

export function hasBodyAnalysisKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const OVERCLAIM_EN = /\b(?:precise(?:ly)?|precision|exact(?:ly)?|accurate(?:ly)?|replica|replicat\w*|one[- ]to[- ]one|true[- ]to[- ]life)\b|1\s*:\s*1/i;
const HAS_CJK = /[\u3400-\u9fff]/;

/** 英文概括：合并空白、去结尾标点，超过上限时在逗号 / 分号处截断；夸大说法或夹带中文时整句丢弃（D48）。 */
function cleanSummaryEn(raw: string): string | null {
  let s = raw.replace(/\s+/g, " ").trim().replace(/[.!。！]+$/u, "");
  if (!s || OVERCLAIM_EN.test(s) || /精准|精确|还原|复刻/.test(s) || HAS_CJK.test(s)) return null;
  if (s.length > SUMMARY_MAX_EN) {
    const head = s.slice(0, SUMMARY_MAX_EN);
    const cut = Math.max(head.lastIndexOf(","), head.lastIndexOf(";"));
    s = (cut > 0 ? head.slice(0, cut) : head.slice(0, Math.max(head.lastIndexOf(" "), 1))).trim();
  }
  return s || null;
}

/** 概括：去空白与结尾标点，超过 30 字时在顿号/逗号处截断；出现“精准/还原/复刻/1:1”等说法时整句丢弃（D48）。英文另有规则（cleanSummaryEn）。 */
export function cleanSummary(raw: unknown, locale: Locale = DEFAULT_LOCALE): string | null {
  if (typeof raw !== "string") return null;
  if (locale === "en") return cleanSummaryEn(raw);
  let s = raw.replace(/\s+/g, "").replace(/[。．.!！]+$/u, "");
  if (!s || /精准|精确|还原|复刻|1[:：]1|一比一/.test(s)) return null;
  const chars = Array.from(s);
  if (chars.length > SUMMARY_MAX) {
    const head = chars.slice(0, SUMMARY_MAX).join("");
    const cut = Math.max(head.lastIndexOf("、"), head.lastIndexOf("，"), head.lastIndexOf(","));
    s = cut > 0 ? head.slice(0, cut) : head;
  }
  return s || null;
}

/** 没有 Claude 时的粗略设定：BMI 22 为 0，每 ±8 约到 ±1；只动 Body / Waist / Hips。缺身高或体重时全部为 0。 */
export function bmiBlends(heightCm: number | null, weightKg: number | null): { source: BodySource; blends: BodyBlends } {
  if (!heightCm || !weightKg || heightCm < 80 || weightKg < 20) return { source: "none", blends: normalizeBlends(null) };
  const bmi = weightKg / (heightCm / 100) ** 2;
  const body = clampBlend((bmi - 22) / 8);
  return { source: "bmi", blends: normalizeBlends({ Body: body, Waist: body * 0.8, Hips: body * 0.6 }) };
}

export type BodyImage = { slot: "front" | "side"; mime: string; base64: string };
export type ModelCall = (input: {
  images: BodyImage[];
  heightCm: number | null;
  weightKg: number | null;
  /** 概括用哪种语言写；不传为中文。 */
  locale?: Locale;
}) => Promise<ModelBody | null>;

/** 调用 Claude（照 lib/adapt/ai.ts 的写法：messages.parse + zodOutputFormat）。拒绝或无法解析时返回 null。 */
export const callClaude: ModelCall = async ({ images, heightCm, weightKg, locale = DEFAULT_LOCALE }) => {
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    content.push(
      { type: "text", text: img.slot === "front" ? "全身正面照：" : "全身侧面照：" },
      {
        type: "image",
        source: { type: "base64", media_type: img.mime as "image/jpeg" | "image/png" | "image/webp", data: img.base64 },
      },
    );
  }
  content.push({
    type: "text",
    text: heightCm && weightKg ? `身高 ${heightCm} cm，体重 ${weightKg} kg。` : heightCm ? `身高 ${heightCm} cm，未提供体重。` : "未提供身高体重。",
  });
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: bodySystemPrompt(locale),
    output_config: { effort: "low", format: zodOutputFormat(locale === DEFAULT_LOCALE ? BodySchema : bodySchema(locale)) },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") return null;
  return response.parsed_output ?? null;
};

/**
 * 合成体型结果：允许时先问 Claude，失败、拒绝或不允许时按身高体重退化。永不抛错。
 * allowClaude = 用户单独同意 && 配置了 key && 有全身正面照。
 */
export async function analyzeBody(
  input: { images: BodyImage[]; heightCm: number | null; weightKg: number | null; allowClaude: boolean; locale?: Locale },
  call: ModelCall = callClaude,
): Promise<Pick<BodyAnalysis, "source" | "gender" | "blends" | "summary" | "lang">> {
  const lang = input.locale ?? DEFAULT_LOCALE;
  if (input.allowClaude && input.images.some((i) => i.slot === "front")) {
    try {
      const out = await call({ images: input.images, heightCm: input.heightCm, weightKg: input.weightKg, locale: lang });
      if (out) {
        return {
          source: "claude",
          gender: out.gender === "male" || out.gender === "female" ? out.gender : null,
          blends: normalizeBlends(out.blends),
          summary: cleanSummary(out.summary, lang),
          lang,
        };
      }
      console.warn("[avatar] 体型分析未返回结果，改用身高体重估算");
    } catch (e) {
      // 只记错误类型，不记响应内容。
      console.warn(`[avatar] 体型分析失败，改用身高体重估算：${e instanceof Error ? e.name : "unknown"}`);
    }
  }
  const fb = bmiBlends(input.heightCm, input.weightKg);
  return { source: fb.source, gender: null, blends: fb.blends, summary: null, lang };
}

// ---------- 存取 ----------

type PhotoRow = typeof schema.avatarPhoto.$inferSelect;

function storedOf(row: PhotoRow | undefined): BodyAnalysis | null {
  const v = (row?.qualityFlags as Record<string, unknown> | null | undefined)?.bodyAnalysis;
  if (!v || typeof v !== "object") return null;
  const a = v as Partial<BodyAnalysis>;
  if (!Array.isArray(a.photoIds) || (a.source !== "claude" && a.source !== "bmi" && a.source !== "none")) return null;
  const lang = isLocale(a.lang) ? a.lang : DEFAULT_LOCALE;
  return {
    source: a.source,
    gender: a.gender === "male" || a.gender === "female" ? a.gender : null,
    blends: normalizeBlends(a.blends as Record<string, unknown> | undefined),
    summary: cleanSummary(a.summary, lang),
    lang,
    photoIds: a.photoIds.filter((x): x is string => typeof x === "string"),
    at: typeof a.at === "string" ? a.at : "",
  };
}

const latest = (rows: PhotoRow[], slot: string) =>
  rows.filter((p) => p.slot === slot).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

const idsOf = (front: PhotoRow | undefined, side: PhotoRow | undefined) => [front?.id, side?.id].filter((x): x is string => !!x);

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 从在用照片里取出与当前全身正面/侧面照对应的分析结果（getAvatarState 用，不访问网络）。 */
export function currentBodyAnalysis(photos: PhotoRow[]): BodyAnalysisView | null {
  const front = latest(photos, "front");
  const stored = storedOf(front);
  if (!stored || !sameIds(stored.photoIds, idsOf(front, latest(photos, "side")))) return null;
  return toView(stored);
}

/**
 * POST /api/avatar/body-analysis 的实现。调用方须已确认登录与 MetaPerson 同意；consented 为用户是否单独同意体型分析。
 * 同一组照片、同一语言已有 Claude 结果时直接返回，不重复调用；未同意时删除已存的 Claude 结果，只按身高体重估算。
 * locale：概括用哪种语言写（接口传 getLocale()）；已存结果是另一种语言时重新分析一次并覆盖。
 */
export async function runBodyAnalysis(
  userId: string,
  opts: { consented: boolean; locale?: Locale },
  call: ModelCall = callClaude,
): Promise<BodyAnalysisView> {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.avatarPhoto)
    .where(
      and(
        eq(schema.avatarPhoto.userId, userId),
        inArray(schema.avatarPhoto.slot, ["front", "side"]),
        isNull(schema.avatarPhoto.deletedAt),
        or(isNull(schema.avatarPhoto.expiresAt), gt(schema.avatarPhoto.expiresAt, now)),
      ),
    )
    .orderBy(desc(schema.avatarPhoto.createdAt));
  const front = latest(rows, "front");
  const side = latest(rows, "side");
  const photoIds = idsOf(front, side);
  const { heightCm, weightKg } = await getProfile(userId);
  const allowClaude = opts.consented && hasBodyAnalysisKey() && !!front;

  const stored = storedOf(front);
  if (allowClaude && stored?.source === "claude" && sameIds(stored.photoIds, photoIds) && stored.lang === locale) return toView(stored);
  const saveOnFront = async (bodyAnalysis: BodyAnalysis | null) => {
    if (!front) return;
    const { bodyAnalysis: _old, ...flags } = (front.qualityFlags ?? {}) as Record<string, unknown>;
    void _old;
    await db
      .update(schema.avatarPhoto)
      .set({ qualityFlags: bodyAnalysis ? { ...flags, bodyAnalysis } : flags })
      .where(and(eq(schema.avatarPhoto.id, front.id), eq(schema.avatarPhoto.userId, userId), isNull(schema.avatarPhoto.deletedAt)));
  };
  // 撤回了体型分析同意：删掉以前存的 Claude 结果。
  if (!opts.consented && stored) await saveOnFront(null);

  const images: BodyImage[] = [];
  if (allowClaude) {
    const storage = getStorage();
    for (const [slot, row] of [
      ["front", front],
      ["side", side],
    ] as const) {
      if (!row) continue;
      const obj = await storage.get(row.storageKey).catch(() => null);
      if (obj) images.push({ slot, mime: row.mime, base64: Buffer.from(obj.bytes).toString("base64") });
    }
  }
  const result = await analyzeBody({ images, heightCm, weightKg, allowClaude: allowClaude && images.length > 0, locale }, call);
  const full: BodyAnalysis = { ...result, photoIds, at: now.toISOString() };
  if (result.source === "claude") await saveOnFront(full);
  return toView(full);
}

/** 已删除照片上残留的体型分析一并抹掉（D47：派生数据随照片删除）。userId 为空时处理全部用户。 */
export async function scrubDeletedBodyAnalysis(userId?: string): Promise<void> {
  await db
    .update(schema.avatarPhoto)
    .set({ qualityFlags: sql`${schema.avatarPhoto.qualityFlags} - 'bodyAnalysis'` })
    .where(
      and(
        userId ? eq(schema.avatarPhoto.userId, userId) : undefined,
        isNotNull(schema.avatarPhoto.deletedAt),
        sql`(${schema.avatarPhoto.qualityFlags} -> 'bodyAnalysis') is not null`,
      ),
    );
}
