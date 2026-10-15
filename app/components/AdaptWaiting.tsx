"use client";

import { forwardRef, useEffect, useState } from "react";

// AI 改编约需 10–13 秒的等待卡：轮换说明当前在做什么（不显示假进度百分比），
// 附已等待秒数和三行占位，结果出来后由改编结果卡替换。
const STEPS = ["读懂你的要求", "在主理人目录里挑选", "保留原搭配的风格", "核对类别与预算", "写下每件的理由"];

const AdaptWaiting = forwardRef<HTMLElement, { aiEnabled: boolean }>(function AdaptWaiting({ aiEnabled }, ref) {
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
      <div className="wait-bar" aria-hidden="true">
        <i />
      </div>
      <div className="rows" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="sc-glass sc-glass--row item-row skeleton-row" style={{ animationDelay: `${i * 0.15}s` }}>
            <div className="thumb skeleton-block" />
            <div className="stack" style={{ gap: 6 }}>
              <span className="skeleton-line" style={{ width: "62%" }} />
              <span className="skeleton-line" style={{ width: "38%" }} />
            </div>
            <span className="skeleton-line" style={{ width: 36 }} />
          </div>
        ))}
      </div>
      <p className="sc-meta" style={{ margin: 0 }}>
        {aiEnabled ? "通常需要 10 秒左右，会只从主理人的目录里挑。" : "规则模式，马上就好。"}
      </p>
    </section>
  );
});

export default AdaptWaiting;
