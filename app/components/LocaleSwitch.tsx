"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_META, LOCALES, type Locale } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";
import styles from "./LocaleSwitch.module.css";

// 语言切换（D70）：放在顶部导航主题切换旁边。圆形按钮显示当前语言简写，点开是一张玻璃小卡片列出全部语言。
// 选择后写 cookie（一年），再 router.refresh() 让服务端按新语言重新渲染；语言清单来自 lib/i18n/config.ts，
// 以后加语言不用改这里。卡片用 portal 挂到 body：导航自带 transform 与 backdrop-filter，放在里面玻璃会失效。
export default function LocaleSwitch() {
  const locale = useLocale();
  const t = useT("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right - 6) });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const onScroll = () => close(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open, close, place]);

  function choose(next: Locale) {
    close(true);
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    document.documentElement.lang = LOCALE_META[next].htmlLang;
    startTransition(() => router.refresh());
  }

  const current = LOCALE_META[locale];
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`sc-nav__icon-btn ${styles.button}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="locale-menu"
        aria-busy={pending || undefined}
        aria-label={t("language.button", { current: current.label })}
        title={t("language.title")}
        data-pending={pending || undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <span key={locale} className={styles.code} lang={current.htmlLang} aria-hidden="true">
          {current.short}
        </span>
      </button>
      {mounted &&
        createPortal(
          <div
            id="locale-menu"
            ref={menuRef}
            role="menu"
            aria-label={t("language.menu")}
            className={styles.menu}
            data-open={open}
            inert={!open}
            style={pos ? { top: pos.top, right: pos.right } : undefined}
          >
            {LOCALES.map((l, i) => {
              const meta = LOCALE_META[l];
              const checked = l === locale;
              return (
                <button
                  key={l}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  lang={meta.htmlLang}
                  className={styles.item}
                  style={{ "--i": i } as React.CSSProperties}
                  onClick={() => choose(l)}
                >
                  <span className={styles.label}>{meta.label}</span>
                  <span className={styles.short} aria-hidden="true">
                    {checked ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 7.4 5.8 10 11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      meta.short
                    )}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
