"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import AdaptWaiting from "./AdaptWaiting";
import ItemList, { REVEAL_DELAY, type ListedItem } from "./ItemList";
import { CountTo } from "./motion/RollingNumber";
import type { Item, Outfit } from "@/lib/catalog";
import type { AdaptResult } from "@/lib/adapt/types";

// 等待卡至少停留这么久：规则模式几乎瞬间返回，等待卡一闪而过会造成闪烁
const MIN_WAIT_MS = 900;

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
  // 改编前的那一套：等待时光束扫过它；结果出现时先以它开场，再换掉被换的单品，总价从它的总价滚到新值
  const [before, setBefore] = useState<ListedItem[]>(outfit.items);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 输入为空时点“改编这一套”：不改编，聚焦输入框并给一行提示（按钮不用原生 disabled，点了总有反馈）
  const [needInput, setNeedInput] = useState(false);

  function tryAdapt(text: string) {
    if (!text.trim()) {
      setNeedInput(true);
      inputRef.current?.focus();
      return;
    }
    setNeedInput(false);
    void adapt(text);
  }

  function pickExample(ex: string, run = false) {
    setRequest(ex);
    setNeedInput(false);
    if (run) void adapt(ex);
  }

  async function adapt(text: string) {
    const current = items ?? outfit.items;
    setBefore(current);
    const started = Date.now();
    setLoading(true);
    setError(null);
    setSaved(null);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    try {
      const res = await fetch("/api/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outfitId: outfit.id, request: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "改编失败");
      const wait = MIN_WAIT_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
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
  // 服务端判定没有改动（或没听懂）→ 提示态；手动替换后又回到原搭配 → 也不提供保存
  const unchanged = !!result && !result.changed;
  const sameAsOriginal =
    !!items && items.length === outfit.items.length && items.every((i) => originalIds.has(i.id));

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
          ref={inputRef}
          value={request}
          onChange={(e) => {
            setRequest(e.target.value);
            if (e.target.value.trim()) setNeedInput(false);
          }}
          placeholder="例如：预算 800 以内，户外婚礼，换成平底鞋"
          maxLength={300}
          aria-label="改编要求"
        />
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => pickExample(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="sc-cta sc-cta--ghost compact" onClick={toggleVoice} aria-pressed={listening}>
            {listening ? "停止语音" : "语音输入"}
          </button>
        </div>
        {needInput ? (
          <p className="sc-meta fade-in" role="status" style={{ margin: 0, color: "var(--sc-champ-text)" }}>
            先写一句要求，或点上面的示例
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </section>

      {loading ? (
        <AdaptWaiting aiEnabled={aiEnabled} items={before} ref={resultRef} />
      ) : result && unchanged ? (
        // 提示态：没听懂，或这句要求在这套里没有可改动的地方。不显示结果列表，也不提供保存。
        <section className="sc-glass card stack adapt-result fade-in" ref={resultRef} aria-live="polite">
          <div>
            <span className="sc-kicker">{result.recognized ? "Nothing to change" : "Try again"}</span>
            <h2 className="section-title">{result.recognized ? "没有可改动的地方" : "没听懂这句要求"}</h2>
          </div>
          <p className="serif-note" style={{ color: "var(--sc-ink)", margin: 0 }}>
            {result.recognized
              ? result.summary
              : "可以说说预算、场合、想换或不要的单品，比如："}
          </p>
          {result.recognized && result.notes.length ? (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => pickExample(ex, true)}>
                {ex}
              </button>
            ))}
          </div>
        </section>
      ) : result && items ? (
        <section className="sc-glass card stack adapt-result" ref={resultRef}>
          <div className="spread">
            <div>
              <span className="sc-kicker">Re-styled for you</span>
              <h2 className="section-title">为你改编的一套</h2>
            </div>
            <div style={{ textAlign: "right" }}>
              <CountTo
                className="total sc-foil"
                value={shownTotal}
                from={total(before)}
                delay={REVEAL_DELAY + 0.1}
                format={(n) => `¥${Math.round(n)}`}
              />
              {result.budget != null ? (
                <div className="sc-meta">
                  预算 ¥{result.budget}
                  {/* 超出预算写在预算旁边：手动替换越过预算时不往列表上方插入一行，列表不跳动 */}
                  {overBudget ? (
                    <span className="fade-in" style={{ color: "var(--sc-champ-text)" }}>
                      {" "}
                      · 超出 ¥{shownTotal - result.budget}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <p className="serif-note" style={{ color: "var(--sc-ink)" }}>{result.summary}</p>
          {result.notes.length ? (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <ItemList
            items={items}
            catalog={catalog}
            onSwap={swap}
            originalIds={originalIds}
            reveal={before}
            ownCuratorId={outfit.curatorId}
          />
          <p className="sc-meta" style={{ margin: 0 }}>
            {result.mode === "ai"
              ? "由 AI 挑选：优先用这间衣橱的单品，不够时也会用其他衣橱的；"
              : "由规则挑选，未使用 AI：优先用这间衣橱的单品，不够时也会用其他衣橱的；"}
            金线标出的是换掉的单品；总价按各单品标价计算。
          </p>
        </section>
      ) : null}

      <div className="cta-bar">
        {result && items && !unchanged && !loading ? (
          <>
            <button
              className="sc-cta"
              onClick={() => save(result.mode, items)}
              disabled={saved === result.mode || sameAsOriginal}
            >
              {sameAsOriginal ? "和原搭配相同" : saved === result.mode ? "已加入试衣间" : "加入试衣间"}
            </button>
            <button className="sc-cta sc-cta--ghost" onClick={() => tryAdapt(request)}>
              重新改编
            </button>
          </>
        ) : (
          <button
            className="sc-cta"
            disabled={loading}
            aria-disabled={!request.trim() || undefined}
            onClick={() => tryAdapt(request)}
          >
            {loading ? "正在改编…" : unchanged ? "换一句再改编" : "改编这一套"}
          </button>
        )}
      </div>
    </div>
  );
}
