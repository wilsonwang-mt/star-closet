// 动效参数的唯一来源（视觉规范 §7.1）：所有位移、缩放都用弹簧，可被打断并从当前速度继续。
// Motion（framer-motion 新包名）直接用下面的弹簧；CSS / View Transitions 用 springCss() 采样成 linear()。
// 与 globals.css 里导航的 --spring（刚度 260、阻尼 24）同一体系。

export type Spring = { type: "spring"; stiffness: number; damping: number; mass: number; restDelta?: number; restSpeed?: number };

const spring = (stiffness: number, damping: number, mass = 1): Spring => ({
  type: "spring",
  stiffness,
  damping,
  mass,
  restDelta: 0.0005,
  restSpeed: 0.002,
});

export const springs = {
  /** 轮播松手吸附：干脆、几乎不过冲，保留手指的速度 */
  snap: spring(220, 30),
  /** 键盘 / 按钮切换一间：比吸附稍柔 */
  step: spring(180, 28),
  /** 走进衣橱：预览放大推进成全屏场景，约 900ms，轻微过冲 */
  enter: spring(90, 16),
  /** 文字、卡片浮起 */
  rise: spring(150, 24),
  /** 文字切换（姓名、tagline） */
  text: spring(300, 32),
  /** 按下轻压 */
  press: spring(500, 30),
  /** 数字滚动（计数器、总价）：快、不过冲 */
  roll: spring(170, 26),
  /** 单品从上方落入：欠阻尼（ζ≈0.5），只回弹几个像素，像有重量的东西落下 */
  drop: spring(320, 18),
} as const;

/** 减弱动态：一律改为短淡入淡出，不位移 */
export const reducedFade = { duration: 0.2, ease: "easeOut" } as const;

/**
 * 把弹簧数值积分后采样成 CSS linear() 缓动，返回缓动与时长（毫秒）。
 * 用在 View Transitions 的伪元素上（它们只能用 CSS 动画）。
 */
export function springCss(s: Spring, samples = 48): { easing: string; duration: number } {
  const { stiffness: k, damping: c, mass: m } = s;
  const dt = 1 / 600;
  let x = 0;
  let v = 0;
  let t = 0;
  const trace: number[] = [0];
  // 积分到静止（位移误差 < 0.1%、速度足够小），最多 3 秒
  while (t < 3) {
    const a = (-k * (x - 1) - c * v) / m;
    v += a * dt;
    x += v * dt;
    t += dt;
    trace.push(x);
    if (Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const idx = Math.round((i / samples) * (trace.length - 1));
    points.push(i === samples ? "1" : String(Math.round(trace[idx] * 1000) / 1000));
  }
  return { easing: `linear(${points.join(", ")})`, duration: Math.round(t * 1000) };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
