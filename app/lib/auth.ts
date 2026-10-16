import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { db, schema } from "./db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // 会话 cookie 缓存：5 分钟内已登录请求只验 cookie 签名，不再查库（慢链路上省约 0.6 s）。
  // 代价：别处撤销的会话，旧 cookie 最多再有效 5 分钟；本站没有改密 / 退出所有设备入口，同浏览器退出立即失效。
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  plugins: [nextCookies()],
});

export async function getCurrentUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}
