"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import AdaptWaiting from "./AdaptWaiting";
import ItemList, { REVEAL_DELAY, type ListedItem } from "./ItemList";
import { CountTo } from "./motion/RollingNumber";
import type { Item, Outfit } from "@/lib/catalog";
import { LOCALE_META } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";
import type { AdaptResult } from "@/lib/adapt/types";
import type { TryonContext } from "@/lib/tryon/service";
import TryOn from "./tryon/TryOn";
import LookActions, { usePick } from "./closet/LookActions";

// 等待卡至少停留这么久：规则模式几乎瞬间返回，等待卡一闪而过会造成闪烁
const MIN_WAIT_MS = 900;

// 示例要求（文案在 outfit 字典 restyle.examples）：点一下填进输入框，提示态里点一下直接改编
const EXAMPLES = ["restyle.examples.wedding", "restyle.examples.commute", "restyle.examples.weekend"] as const;

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

// 改编结果里的一件；manual 表示用户手动替换的（理由显示当前语言的“你手动替换”，保存时只发这个标记，见 save）
type ResultItem = ListedItem & { manual?: boolean };

function total(items: { price: number }[]) {
  return items.reduce((s, i) => s + i.price, 0);
}

export default function Adapter({
  outfit,
  catalog,
  aiEnabled,
  tryon,
  signedIn,
}: {
  outfit: Outfit;
  catalog: Item[];
  aiEnabled: boolean;
  tryon?: TryonContext;
  signedIn?: boolean;
}) {
  const router = useRouter();
  const t = useT("outfit");
  const locale = useLocale();
  const yuan = (n: number) => `¥${n.toLocaleString(LOCALE_META[locale].intl)}`;
  const examples = EXAMPLES.map((k) => t(k));
  const [request, setRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdaptResult | null>(null);
  const [items, setItems] = useState<ResultItem[] | null>(null);
  const [listening, setListening] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  // 改编前的那一套：等待时光束扫过它；结果出现时先以它开场，再换掉被换的单品，总价从它的总价滚到新值
  const [before, setBefore] = useState<ListedItem[]>(outfit.items);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // 输入为空时点“改编这一套”：不改编，聚焦输入框并给一行提示（按钮不用原生 disabled，点了总有反馈）
  const [needInput, setNeedInput] = useState(false);
  // 原搭配的整套 / 多选加入试衣间与购物袋（D67）
  const pick = usePick();
  const source = { outfitId: outfit.id };

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
    // 改编需要登录（D64：会调用 Claude，按用户每日限次）；未登录先去登录，登录后回到这套搭配。
    if (signedIn === false) {
      router.push(`/login?next=/outfit/${outfit.id}`);
      return;
    }
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
      if (res.status === 401) {
        router.push(`/login?next=/outfit/${outfit.id}`);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("errors.adapt"));
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
      setError(t("errors.noVoice"));
      return;
    }
    rec.lang = LOCALE_META[locale].intl;
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
    setItems(items.map((i) => (i.id === fromId ? { ...to, reason: t("manualReason"), manual: true } : i)));
    setSaved(null);
  }

  // 不带标题、手动替换不带理由文字：服务端存中文（原搭配名 / “X · 我的版本”、“你手动替换”），
  // 试衣间按当前语言显示（lib/looks-l10n.ts），所以切换语言后跟着变。改编要求与 AI 写的说明、理由原样保存。
  async function save(mode: "original" | "ai" | "offline", list: ResultItem[]) {
    setError(null);
    const res = await fetch("/api/looks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceOutfitId: outfit.id,
        request: mode === "original" ? null : request,
        summary: mode === "original" ? null : (result?.summary ?? null),
        mode,
        items: list.map((i) => (i.manual ? { itemId: i.id, reason: null, manual: true } : { itemId: i.id, reason: i.reason ?? null })),
      }),
    });
    if (res.status === 401) {
      router.push(`/login?next=/outfit/${outfit.id}`);
      return;
    }
    if (!res.ok) {
      setError((await res.json()).error ?? t("errors.save"));
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
            <h2 className="section-title">{t("original.title")}</h2>
          </div>
          <span className="price" style={{ fontSize: 20 }}>{yuan(outfit.total)}</span>
        </div>
        <ItemList items={outfit.items} pick={pick} source={source} />
        <div style={{ marginTop: 14 }}>
          <LookActions items={outfit.items} pick={pick} outfitId={outfit.id} />
        </div>
      </section>

      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <div>
            <span className="sc-kicker">Re-style</span>
            <h2 className="section-title">{t("restyle.title")}</h2>
          </div>
          <span className="sc-badge">{t("restyle.badge")}</span>
        </div>
        <textarea
          ref={inputRef}
          value={request}
          onChange={(e) => {
            setRequest(e.target.value);
            if (e.target.value.trim()) setNeedInput(false);
          }}
          placeholder={t("restyle.placeholder", { example: examples[0] })}
          maxLength={300}
          aria-label={t("restyle.aria")}
        />
        <div className="chips">
          {examples.map((ex) => (
            <button key={ex} className="chip" onClick={() => pickExample(ex)}>
              {ex}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="sc-cta sc-cta--ghost compact" onClick={toggleVoice} aria-pressed={listening}>
            {listening ? t("restyle.voiceStop") : t("restyle.voiceStart")}
          </button>
        </div>
        {needInput ? (
          <p className="sc-meta fade-in" role="status" style={{ margin: 0, color: "var(--sc-champ-text)" }}>
            {t("restyle.needInput")}
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
            <h2 className="section-title">{result.recognized ? t("unchanged.nothing") : t("unchanged.unclear")}</h2>
          </div>
          <p className="note-text" style={{ color: "var(--sc-ink)", margin: 0 }}>
            {result.recognized ? result.summary : t("unchanged.hint")}
          </p>
          {result.recognized && result.notes.length ? (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {result.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <div className="chips">
            {examples.map((ex) => (
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
              <h2 className="section-title">{t("result.title")}</h2>
            </div>
            <div style={{ textAlign: "right" }}>
              <CountTo
                className="total sc-foil"
                value={shownTotal}
                from={total(before)}
                delay={REVEAL_DELAY + 0.1}
                format={(n) => yuan(Math.round(n))}
              />
              {result.budget != null ? (
                <div className="sc-meta">
                  {t("result.budget", { amount: yuan(result.budget) })}
                  {/* 超出预算写在预算旁边：手动替换越过预算时不往列表上方插入一行，列表不跳动 */}
                  {overBudget ? (
                    <span className="fade-in" style={{ color: "var(--sc-champ-text)" }}>
                      {" "}
                      {t("result.over", { amount: yuan(shownTotal - result.budget) })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <p className="note-text" style={{ color: "var(--sc-ink)" }}>{result.summary}</p>
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
            source={source}
          />
          <p className="sc-meta" style={{ margin: 0 }}>
            {t("result.note", { mode: result.mode === "ai" ? "ai" : "rules" })}
          </p>
          {tryon ? (
            <div className="row">
              {/* 试穿的是当前这一套（含手动替换后的单品） */}
              <TryOn ctx={tryon} source={{ outfitId: outfit.id }} items={items} />
            </div>
          ) : null}
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
              {sameAsOriginal ? t("cta.same") : saved === result.mode ? t("cta.added") : t("cta.add")}
            </button>
            <button className="sc-cta sc-cta--ghost" onClick={() => tryAdapt(request)}>
              {t("cta.again")}
            </button>
          </>
        ) : (
          <button
            className="sc-cta"
            disabled={loading}
            aria-disabled={!request.trim() || undefined}
            onClick={() => tryAdapt(request)}
          >
            {loading ? t("cta.running") : unchanged ? t("cta.retry") : t("cta.start")}
          </button>
        )}
      </div>
    </div>
  );
}
