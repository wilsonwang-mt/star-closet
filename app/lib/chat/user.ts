// 悬浮对话读取的用户状态（服务端，D68）：档案偏好 + 形象 / 试衣间 / 购物袋计数。
// 只挑出 ChatUser 里列出的字段；身高、体重等身体数据不读出、不发给 Claude。
import { count, eq } from "drizzle-orm";
import { bagCount } from "../bag/service";
import { db, schema } from "../db";
import { getProfile } from "../profile";
import { getTryonContext } from "../tryon/service";
import type { ChatUser } from "./context";

async function lookCount(userId: string) {
  const [row] = await db.select({ n: count() }).from(schema.look).where(eq(schema.look.userId, userId));
  return Number(row?.n ?? 0);
}

export async function getChatUser(userId: string | null): Promise<ChatUser | null> {
  if (!userId) return null;
  const [p, tryon, looks, bag] = await Promise.all([getProfile(userId), getTryonContext(userId), lookCount(userId), bagCount(userId)]);
  return {
    signedIn: true,
    styleTags: p.styleTags,
    favoriteColors: p.favoriteColors,
    sizeTop: p.sizeTop,
    sizeBottom: p.sizeBottom,
    sizeShoe: p.sizeShoe,
    budgetMin: p.budgetMin,
    budgetMax: p.budgetMax,
    city: p.city,
    avatar: tryon.baseSource ?? null,
    tryonEnabled: tryon.enabled,
    looks,
    bag,
  };
}
