import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import { cookies } from "next/headers";
import SiteNav from "@/components/SiteNav";
import type { ThemePref } from "@/components/ThemeToggle";
import "./tokens.css";
import "./globals.css";

const didone = Bodoni_Moda({ subsets: ["latin"], style: ["normal", "italic"], weight: ["400"], variable: "--font-didone" });
const serif = Noto_Serif_SC({ weight: ["300", "400"], variable: "--font-serif", preload: false });
const sans = Noto_Sans_SC({ weight: ["300", "400"], variable: "--font-sans", preload: false });

export const metadata: Metadata = {
  title: "Star Closet",
  description: "把主理人的一整套穿搭，改成适合你、买得起的那一套。",
  applicationName: "Star Closet",
};

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
  const saved = (await cookies()).get("sc-theme")?.value;
  const pref: ThemePref = saved === "light" || saved === "system" ? saved : "dark";
  return (
    <html
      lang="zh-CN"
      data-theme={pref === "system" ? undefined : pref}
      className={`${didone.variable} ${serif.variable} ${sans.variable}`}
    >
      <body>
        <SiteNav initialTheme={pref} />
        <main className="container">{children}</main>
        <footer className="footer sc-meta">
          比赛演示版 · 商品与主理人均为占位数据，图片为 AI 生成示意，不代表任何品牌或合作 · 价格以商家页面为准
        </footer>
      </body>
    </html>
  );
}
