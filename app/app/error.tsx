"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/lib/i18n/client";

// 页面渲染出错（数据库或网络异常等）：沿用全站玻璃卡与 tokens，说明按当前语言，可以原地重试或回到全部衣橱。
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("system");
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
        {t("error.title")}
      </h1>
      <p className="note-text" style={{ margin: 0 }}>
        {t("error.note")}
      </p>
      <div className="stack" style={{ gap: 8, marginTop: 6 }}>
        <button type="button" className="sc-cta" onClick={reset}>
          {t("error.retry")}
        </button>
        <Link href="/" className="link-btn" style={{ justifySelf: "center", alignSelf: "center" }}>
          {t("error.home")}
        </Link>
      </div>
    </section>
  );
}
