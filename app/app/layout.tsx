import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import SiteNav from "@/components/SiteNav";
import type { ThemePref } from "@/components/ThemeToggle";
import "./fonts.css";
import "./fonts-serif.css"; // 标题字体自托管（Vercel 构建机上 next/font/google 解析失败，2026-10-17）
import "./tokens.css";
import "./globals.css";


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
  // 正文字体自托管（app/fonts.css）：只预加载首屏一定会用到的 core 子集，其余按 unicode-range 按需下载
  preload("/fonts/sc-sans-light-core.v1.woff2", { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  const saved = (await cookies()).get("sc-theme")?.value;
  const pref: ThemePref = saved === "light" || saved === "system" ? saved : "dark";
  return (
    <html
      lang="zh-CN"
      data-theme={pref === "system" ? undefined : pref}
    >
      <body>
        <SiteNav initialTheme={pref} />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
