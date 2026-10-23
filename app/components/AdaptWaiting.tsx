"use client";

import { forwardRef, useEffect, useState } from "react";
import { LOCALE_META } from "@/lib/i18n/config";
import { useLocale, useT, useTerm } from "@/lib/i18n/client";
import ItemThumb from "./ItemThumb";

// AI 改编约需 10–13 秒的等待卡：轮换说明当前在做什么（不显示假进度百分比），附已等待秒数。
// 下方列出当前这一套（改编前的单品），一道香槟光束反复扫过它们（视觉规范 §7.1「等待时光束扫过当前搭配」）；
// 结果出来后由改编结果卡替换，结果卡先以同样的单品开场，再把被换的那几件换掉。
// 文案在 outfit 字典 waiting.steps，这里只定顺序
const STEPS = ["waiting.steps.read", "waiting.steps.pick", "waiting.steps.keep", "waiting.steps.check", "waiting.steps.write"] as const;

type Current = { id: string; name: string; image: string | null; color: string; category: string; displayCategory?: string | null; price: number };

const AdaptWaiting = forwardRef<HTMLElement, { aiEnabled: boolean; items: Current[] }>(function AdaptWaiting({ aiEnabled, items }, ref) {
  const t = useT("outfit");
  const term = useTerm();
  const locale = useLocale();
  const [step, setStep] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      setStep(Math.min(STEPS.length - 1, Math.floor(s / 2.5)));
    }, 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="sc-glass card stack sc-rise adapt-wait" ref={ref} aria-live="polite" aria-busy="true">
      <div className="spread">
        <div>
          <span className="sc-kicker">Re-styling</span>
          <h2 className="section-title">{t("waiting.title")}</h2>
        </div>
        <span className="sc-meta">{aiEnabled ? t("waiting.thinking", { s: seconds }) : `${seconds}s`}</span>
      </div>
      <p className="serif-note wait-step" key={step}>
        {t(STEPS[step])}…
      </p>
      <div className="rows adapt-scan" aria-hidden="true">
        {items.map((it) => (
          <div key={it.id} className="sc-glass sc-glass--row item-row">
            <ItemThumb name={it.name} image={it.image} color={it.color} />
            <div>
              <div className="item-name">{it.name.replace(/^占位：/, "")}</div>
              <div className="sc-meta">
                {term(it.displayCategory || it.category)} · {term(it.color)}
              </div>
            </div>
            <div className="price">¥{it.price.toLocaleString(LOCALE_META[locale].intl)}</div>
          </div>
        ))}
      </div>
      <p className="sc-meta" style={{ margin: 0 }}>
        {t("waiting.footer")}
      </p>
    </section>
  );
});

export default AdaptWaiting;
