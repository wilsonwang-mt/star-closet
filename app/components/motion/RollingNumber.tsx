"use client";

// 数字滚动（视觉规范 §7.1）。两种形态：
// - RollingDigits：里程表式，每一位是一条 0–9 的竖排数字，弹簧滚到目标位；用于轮播位置“01 / 10”与 N° 编号。
// - CountTo：数值弹簧过渡后按整数写成文字（不做位移），可以套金箔渐变（background-clip: text 穿不透带 transform 的子元素）；用于总价。
// 两者都可被打断：新值到来时从当前位置与速度继续。读屏只读最终数值。
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef } from "react";
import { springs } from "@/lib/motion";
import styles from "./RollingNumber.module.css";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function RollingDigits({ value, pad = 2, className }: { value: number; pad?: number; className?: string }) {
  const reduced = useReducedMotion();
  const text = String(Math.max(0, Math.round(value))).padStart(pad, "0");
  const chars = text.split("");
  return (
    <span className={`${styles.digits} ${className ?? ""}`}>
      <span className="sr-only">{text}</span>
      <span className={styles.ghost} aria-hidden="true">
        0
      </span>
      {chars.map((ch, i) => {
        // 按“从右数第几位”做 key：位数变化时个位不重新挂载
        const place = chars.length - 1 - i;
        const d = Number(ch);
        return (
          <span key={place} className={styles.col} aria-hidden="true">
            <motion.span
              className={styles.strip}
              initial={false}
              animate={{ y: `${-d * 10}%` }}
              transition={reduced ? { duration: 0 } : springs.roll}
            >
              {DIGITS.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}

const yuan = (n: number) => Math.round(n).toLocaleString("zh-CN");

export function CountTo({
  value,
  from,
  delay = 0,
  className,
  format = yuan,
}: {
  value: number;
  /** 首次出现时从这个数滚到 value（例如原搭配总价）；不给则直接显示 value */
  from?: number;
  delay?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const mv = useMotionValue(from ?? value);
  const text = useTransform(mv, (v) => format(v));
  const fromRef = useRef(from);

  useEffect(() => {
    // 还停在起始值（首次出现；开发模式 StrictMode 第二次执行也算）时才等待 delay
    const isFirst = fromRef.current !== undefined && mv.get() === fromRef.current;
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { ...springs.roll, delay: isFirst ? delay : 0 });
    return () => controls.stop();
  }, [value, reduced, delay, mv]);

  return (
    <span className={className}>
      <span className="sr-only">{format(value)}</span>
      <motion.span aria-hidden="true" className={styles.tabular}>
        {text}
      </motion.span>
    </span>
  );
}
