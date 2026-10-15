import Link from "next/link";
import Scene from "./Scene";

// 404 错误态：沿用全站场景与 tokens，中文文案，主按钮回到全部衣橱。
// app/not-found.tsx、closet/[id]/not-found.tsx、outfit/[id]/not-found.tsx 共用。
export default function NotFoundView({ title, note }: { title: string; note: string }) {
  return (
    <>
      <Scene dim />
      <section className="sc-glass card stack sc-rise" style={{ maxWidth: 440, margin: "22dvh auto 0", textAlign: "center" }}>
        <span className="sc-kicker">N°404 — Not in the closet</span>
        <h1 className="sc-display" style={{ margin: 0, fontSize: "clamp(24px, 6vw, 32px)" }}>
          {title}
        </h1>
        <p className="serif-note" style={{ margin: 0 }}>
          {note}
        </p>
        <div className="stack" style={{ gap: 8, marginTop: 6 }}>
          <Link href="/" className="sc-cta">
            回到全部衣橱
          </Link>
          <Link href="/fitting-room" className="link-btn" style={{ justifySelf: "center", alignSelf: "center" }}>
            去我的试衣间
          </Link>
        </div>
      </section>
    </>
  );
}
