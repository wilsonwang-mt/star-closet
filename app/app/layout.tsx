import type { Metadata, Viewport } from "next";
import Link from "next/link";
import UserNav from "@/components/UserNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Star Closet",
  description: "把主理人的一整套穿搭，改成适合你、买得起的那一套。",
  applicationName: "Star Closet",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f1e8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            STAR CLOSET
          </Link>
          <nav>
            <Link href="/">衣橱</Link>
            <Link href="/fitting-room">试衣间</Link>
            <UserNav />
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          比赛演示版 · 商品与主理人均为占位数据，不代表任何品牌或合作 · 价格以商家页面为准
        </footer>
      </body>
    </html>
  );
}
