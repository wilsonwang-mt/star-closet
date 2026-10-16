"use client";

import { forwardRef, useEffect, useState } from "react";
import ItemThumb from "./ItemThumb";

// AI 改编约需 10–13 秒的等待卡：轮换说明当前在做什么（不显示假进度百分比），附已等待秒数。
// 下方列出当前这一套（改编前的单品），一道香槟光束反复扫过它们（视觉规范 §7.1「等待时光束扫过当前搭配」）；
// 结果出来后由改编结果卡替换，结果卡先以同样的单品开场，再把被换的那几件换掉。
const STEPS = ["读懂你的要求", "在这间衣橱里挑选", "保留原搭配的风格", "核对类别与预算", "写下每件的理由"];

type Current = { id: string; name: string; image: string | null; color: string; category: string; price: number };

const AdaptWaiting = forwardRef<HTMLElement, { aiEnabled: boolean; items: Current[] }>(function AdaptWaiting({ aiEnabled, items }, ref) {
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
          <h2 className="section-title">正在为你改编</h2>
        </div>
        <span className="sc-meta">{aiEnabled ? `AI 思考中 · ${seconds}s` : `${seconds}s`}</span>
      </div>
      <p className="serif-note wait-step" key={step}>
        {STEPS[step]}…
      </p>
      <div className="rows adapt-scan" aria-hidden="true">
        {items.map((it) => (
          <div key={it.id} className="sc-glass sc-glass--row item-row">
            <ItemThumb name={it.name} image={it.image} color={it.color} />
            <div>
              <div className="item-name">{it.name.replace(/^占位：/, "")}</div>
              <div className="sc-meta">
                {it.category} · {it.color}
              </div>
            </div>
            <div className="price">¥{it.price}</div>
          </div>
        ))}
      </div>
      <p className="sc-meta" style={{ margin: 0 }}>
        正在从衣橱里为你挑选最合适的一套
      </p>
    </section>
  );
});

export default AdaptWaiting;
