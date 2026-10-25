import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import ChatDock from "@/components/chat/ChatDock";
import SiteNav from "@/components/SiteNav";
import ShopForVariantSwitcher from "@/components/ShopForVariantSwitcher";
import { SHOP_FOR_COOKIE, SHOP_FOR_VARIANT_COOKIE, parseShopFor, parseShopForVariant } from "@/lib/shopfor";
import type { ThemePref } from "@/components/ThemeToggle";
import { catalogTerms } from "@/lib/i18n/catalog";
import { I18nProvider } from "@/lib/i18n/client";
import { LOCALE_META } from "@/lib/i18n/config";
import { MESSAGES } from "@/lib/i18n/messages";
import { getLocale, tFor } from "@/lib/i18n/server";
import { getChatCatalog } from "@/lib/chat/catalog";
import "./fonts.css"; // 汉字：思源黑体 Light 300 / Medium 500（D50、D72）
import "./fonts-latin.css"; // 西文与数字：Instrument Sans（D71、D72）
import "./tokens.css";
import "./globals.css";
import "./explore-shopfor.css"; // 「为谁选」放法探索（仅 explore/shop-for 分支，定稿前不合并）


// 标题模板与描述按访客语言输出（D70）。
export async function generateMetadata(): Promise<Metadata> {
  const t = tFor(await getLocale(), "meta");
  return {
    title: { default: t("siteName"), template: t("titleTemplate") },
    description: t("description"),
    applicationName: t("siteName"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
    { media: "(prefers-color-scheme: light)", color: "#f4efe6" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // 字体自托管（app/fonts.css、fonts-latin.css）：只预加载首屏一定会用到的 core 子集，其余按 unicode-range 按需下载。
  // 西文与数字（标签、价格、编号）两种语言都用 Instrument Sans（D72）。
  preload("/fonts/sc-sans-light-core.v2.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  preload("/fonts/instrument-sans-latin.v1.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  // 悬浮对话的目录快照提前读进内存（缓存 5 分钟），第一次提问不必等数据库；构建阶段不连库
  if (process.env.NEXT_PHASE !== "phase-production-build") void getChatCatalog().catch(() => {});
  const saved = (await cookies()).get("sc-theme")?.value;
  const pref: ThemePref = saved === "light" || saved === "system" ? saved : "dark";
  // 「为谁选」探索：sc-sfx 选放法（a 导航顶层 / b 首屏分段 / c 首访轻问），没有时是现状、不按 sc-shopfor 过滤
  const jar = await cookies();
  const sfx = parseShopForVariant(jar.get(SHOP_FOR_VARIANT_COOKIE)?.value);
  const shopFor = sfx ? parseShopFor(jar.get(SHOP_FOR_COOKIE)?.value) : null;
  // 多语言（D70）：cookie sc-locale → 浏览器语言 → 中文。只把当前语言的字典与目录词表交给客户端。
  const locale = await getLocale();
  // 中文标题用思源黑体 Medium（D72）
  if (locale === "zh") preload("/fonts/sc-sans-medium-core.v2.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  return (
    <html
      lang={LOCALE_META[locale].htmlLang}
      data-theme={pref === "system" ? undefined : pref}
      data-sfx={sfx ?? undefined}
    >
      <body>
        <I18nProvider locale={locale} messages={MESSAGES[locale]} terms={catalogTerms(locale)}>
          <SiteNav initialTheme={pref} shopFor={shopFor} />
          <main className="container">{children}</main>
          {/* 全站悬浮对话（D66）：与导航同级，路由切换不卸载 */}
          <ChatDock />
          <ShopForVariantSwitcher current={sfx} />
        </I18nProvider>
      </body>
    </html>
  );
}
