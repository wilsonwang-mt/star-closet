import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { db, schema } from "./db";

// 部署（D64）：BETTER_AUTH_URL 设为线上地址（如 https://<项目>.vercel.app）；本地不设或设为 http://localhost:3000。
// trustedOrigins 额外信任本次部署的 https://${VERCEL_URL}（预览部署地址每次不同），其他来源的登录/注册请求一律拒绝。
// cookie：BETTER_AUTH_URL 是 https 时强制 Secure；本地 http（包括 next start）不强制，否则 localhost 无法登录。
const baseURL = process.env.BETTER_AUTH_URL || undefined;
const trustedOrigins = [baseURL, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined].filter(
  (o): o is string => Boolean(o),
);
const secureCookies = baseURL?.startsWith("https://") || process.env.VERCEL === "1";

export const auth = betterAuth({
  baseURL,
  trustedOrigins,
  advanced: { useSecureCookies: secureCookies },
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
  plugins: [nextCookies()],
});

export async function getCurrentUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}
