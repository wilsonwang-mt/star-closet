"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import ItemList, { type ListedItem } from "./ItemList";
import type { Item, Outfit } from "@/lib/catalog";
import type { AdaptResult } from "@/lib/adapt/types";

const EXAMPLES = ["预算 800 以内，户外婚礼，换成平底鞋", "冬天通勤穿，不要皮革", "周末逛街，舒服一点，600 以内"];

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, (new () => SpeechRecognitionLike) | undefined>;
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function total(items: { price: number }[]) {
  return items.reduce((s, i) => s + i.price, 0);
}

export default function Adapter({ outfit, catalog, aiEnabled }: { outfit: Outfit; catalog: Item[]; aiEnabled: boolean }) {
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdaptResult | null>(null);
  const [items, setItems] = useState<ListedItem[] | null>(null);
  const [listening, setListening] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  async function adapt(text: string) {
    setLoading(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outfitId: outfit.id, request: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "改编失败");
      setResult(data);
      setItems(data.items);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggleVoice() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      setError("这个浏览器不支持语音输入，请直接打字");
      return;
    }
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join("");
      setRequest(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  function swap(fromId: string, toId: string) {
    const to = catalog.find((c) => c.id === toId);
    if (!to || !items) return;
    setItems(items.map((i) => (i.id === fromId ? { ...to, reason: "你手动替换" } : i)));
    setSaved(null);
  }

  async function save(mode: "original" | "ai" | "offline", list: ListedItem[]) {
    setError(null);
    const res = await fetch("/api/looks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: mode === "original" ? outfit.name.replace(/^占位：/, "") : `${outfit.name.replace(/^占位：/, "")} · 我的版本`,
        sourceOutfitId: outfit.id,
        request: mode === "original" ? null : request,
        summary: mode === "original" ? null : (result?.summary ?? null),
        mode,
        items: list.map((i) => ({ itemId: i.id, reason: i.reason ?? null })),
      }),
    });
    if (res.status === 401) {
      router.push(`/login?next=/outfit/${outfit.id}`);
      return;
    }
    if (!res.ok) {
      setError((await res.json()).error ?? "保存失败");
      return;
    }
    setSaved(mode);
  }

  const shownTotal = items ? total(items) : 0;
  const overBudget = result?.budget != null && shownTotal > result.budget;

  const originalIds = new Set(outfit.items.map((i) => i.id));
  const resultRef = useRef<HTMLElement | null>(null);

  return (
    <div className="stack">
      <section className="sc-glass card sc-rise">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <span className="sc-kicker">Original</span>
            <h2 className="section-title">主理人原搭配</h2>
          </div>
          <span className="price" style={{ fontSize: 20 }}>¥{outfit.total}</span>
        </div>
        <ItemList items={outfit.items} />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="link-btn" onClick={() => save("original", outfit.items)}>
            原样加入试衣间
          </button>
          {saved === "original" ? <span className="sc-badge">已加入试衣间</span> : null}
        </div>
      </section>

      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <div>
            <span className="sc-kicker">Re-style</span>
            <h2 className="section-title">一句话改编</h2>
          </div>
          <span className="sc-badge">{aiEnabled ? "AI 改编" : "非 AI · 规则模式"}</span>
        </div>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="例如：预算 800 以内，户外婚礼，换成平底鞋"
          maxLength={300}
          aria-label="改编要求"
        />
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => setRequest(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="sc-cta sc-cta--ghost compact" onClick={toggleVoice} aria-pressed={listening}>
            {listening ? "停止语音" : "语音输入"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {result && items ? (
        <section className="sc-glass card stack sc-rise" ref={resultRef}>
          <div className="spread">
            <div>
              <span className="sc-kicker">Re-styled for you</span>
              <h2 className="section-title">为你改编的一套</h2>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="total sc-foil">¥{shownTotal}</div>
              {result.budget != null ? <div className="sc-meta">预算 ¥{result.budget}</div> : null}
            </div>
          </div>
          <p className="serif-note" style={{ color: "var(--sc-ink)" }}>{result.summary}</p>
          {overBudget ? <span className="sc-badge" style={{ justifySelf: "start" }}>超出预算 ¥{shownTotal - result.budget!}</span> : null}
          {result.notes.length ? (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <ItemList items={items} catalog={catalog} onSwap={swap} originalIds={originalIds} />
          <p className="sc-meta" style={{ margin: 0 }}>
            {result.mode === "ai" ? "由 AI 在主理人目录内挑选；" : "由规则在目录内挑选，未使用 AI；"}
            金线标出的是换掉的单品；总价由系统按目录价格计算。
          </p>
        </section>
      ) : null}

      <div className="cta-bar">
        {result && items ? (
          <>
            <button className="sc-cta" onClick={() => save(result.mode, items)} disabled={saved === result.mode}>
              {saved === result.mode ? "已加入试衣间" : "加入试衣间"}
            </button>
            <button className="sc-cta sc-cta--ghost" onClick={() => adapt(request)} disabled={loading || !request.trim()}>
              {loading ? "改编中" : "重新改编"}
            </button>
          </>
        ) : (
          <button className="sc-cta" disabled={loading || !request.trim()} onClick={() => adapt(request)}>
            {loading ? "正在改编…" : "改编这一套"}
          </button>
        )}
      </div>
    </div>
  );
}
