"use client";

import Link from "next/link";
import { useEffect } from "react";

// 页面渲染出错（数据库或网络异常等）：沿用全站玻璃卡与 tokens，中文说明，可以原地重试或回到全部衣橱。
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section
      className="sc-glass card stack sc-rise"
      role="alert"
      style={{ maxWidth: 440, margin: "22dvh auto 0", textAlign: "center" }}
    >
      <span className="sc-kicker">N°500 — Something slipped</span>
      <h1 className="sc-display" style={{ margin: 0, fontSize: "clamp(24px, 6vw, 32px)" }}>
        这一页没能打开
      </h1>
      <p className="serif-note" style={{ margin: 0 }}>
        可能是网络不稳定或服务暂时出错。可以再试一次，或先回到全部衣橱。
      </p>
      <div className="stack" style={{ gap: 8, marginTop: 6 }}>
        <button type="button" className="sc-cta" onClick={reset}>
          再试一次
        </button>
        <Link href="/" className="link-btn" style={{ justifySelf: "center", alignSelf: "center" }}>
          回到全部衣橱
        </Link>
      </div>
    </section>
  );
}
