"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import LinkPending from "./LinkPending";
import OfflineNotice from "./OfflineNotice";
import ThemeToggle, { type ThemePref } from "./ThemeToggle";

// 顶部悬浮玻璃胶囊导航（视觉规范 6.1）。
// - 手机（< 640px）：右侧只留主题切换与圆形菜单按钮，链接收进玻璃下拉面板。
// - 桌面：链接直接排在胶囊里；登录后多一个首字母圆钮，面板里放账号与“退出登录”。
// - 向下滚动超过 8px 收起（.sc-nav--hidden），向上滚动、回到顶部、键盘焦点进入时出现；首次加载先显示 2 秒。
// 动画全部是 CSS transition（只动 transform / opacity），曲线是预先算好的弹簧 linear()，见 globals.css。

const LINKS = [
  { href: "/", label: "衣橱", kicker: "The Closets" },
  { href: "/fitting-room", label: "试衣间", kicker: "Fitting Room" },
] as const;

const SHOW_ON_LOAD_MS = 2000;
const SCROLL_THRESHOLD = 8;

function currentness(pathname: string, href: string): "page" | "true" | undefined {
  if (pathname === href) return "page";
  // 衣橱页与搭配页都属于“衣橱”这一栏
  if (href === "/" && (pathname.startsWith("/closet") || pathname.startsWith("/outfit"))) return "true";
  if (href !== "/" && pathname.startsWith(`${href}/`)) return "true";
  return undefined;
}

export default function SiteNav({ initialTheme }: { initialTheme: ThemePref }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user ?? null;

  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  // 滚动方向控制显隐：passive 监听 + requestAnimationFrame 合并，每帧最多算一次。
  useEffect(() => {
    let lastY = Math.max(0, window.scrollY);
    let travel = 0;
    let frame = 0;
    const lockedUntil = performance.now() + SHOW_ON_LOAD_MS;

    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY); // iOS 回弹时 scrollY 可能为负
      const dy = y - lastY;
      lastY = y;
      if (y <= SCROLL_THRESHOLD || openRef.current || navRef.current?.querySelector(":focus-visible")) {
        travel = 0;
        setHidden(false);
        return;
      }
      if (dy === 0) return;
      // 同方向累计位移，换向时清零，避免手指抖动造成闪烁
      travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
      if (travel > SCROLL_THRESHOLD) {
        if (performance.now() >= lockedUntil) setHidden(true);
      } else if (travel < -SCROLL_THRESHOLD) {
        setHidden(false);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // 换页：关闭菜单并让导航出现
  useEffect(() => {
    setOpen(false);
    setHidden(false);
  }, [pathname]);

  // 菜单打开时：焦点移到第一个菜单项；Esc 关闭并把焦点还给按钮；焦点离开导航与面板时关闭。
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      // 桌面上面板里的页面链接被 CSS 隐藏，取第一个实际可见的可聚焦元素
      const items = panelRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [];
      Array.from(items)
        .find((el) => el.getClientRects().length > 0)
        ?.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node | null;
      if (t && !panelRef.current?.contains(t) && !navRef.current?.contains(t)) closeMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open, closeMenu]);

  async function signOut() {
    setOpen(false);
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  const accountHref = user ? "/profile" : "/login";
  const accountLabel = user ? "我的档案" : "登录";
  const initial = (user?.name?.trim() || user?.email || "").slice(0, 1).toUpperCase();

  const navClass = ["sc-nav", "site-nav", hidden && !open ? "sc-nav--hidden" : "", open ? "is-open" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <header ref={navRef} className={navClass} onFocus={() => setHidden(false)}>
        <Link href="/" className="sc-nav__brand site-nav__brand" aria-label="Star Closet 首页">
          STAR CLOSET
        </Link>
        <div className="site-nav__end">
          <nav aria-label="主导航" className="sc-nav__links site-nav__inline">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="sc-nav__link" aria-current={currentness(pathname, l.href)}>
                {l.label}
                <LinkPending />
              </Link>
            ))}
            {isPending ? (
              <span className="sc-nav__link site-nav__placeholder" aria-hidden="true">
                我的档案
              </span>
            ) : (
              <Link
                href={accountHref}
                className="sc-nav__link"
                aria-current={currentness(pathname, accountHref)}
                title={user?.email}
              >
                {accountLabel}
                <LinkPending />
              </Link>
            )}
          </nav>
          <ThemeToggle initial={initialTheme} />
          <button
            ref={buttonRef}
            type="button"
            className={`sc-nav__icon-btn site-nav__menu-btn${user ? " has-account" : ""}`}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "关闭菜单" : user ? "打开菜单与账号" : "打开菜单"}
            onClick={() => (open ? closeMenu(false) : setOpen(true))}
          >
            <span className="site-nav__burger" aria-hidden="true">
              <i />
              <i />
            </span>
            {user && (
              <span className="site-nav__initial" aria-hidden="true">
                {initial}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* 断网提示挂在导航里（全站都有导航），自己用 portal 放到 body，不受导航收起的 transform 影响 */}
      <OfflineNotice />
      {/* 点外部关闭：透明遮罩吃掉这次点击，避免误触下面的内容 */}
      <div className="site-menu__scrim" data-open={open} onClick={() => closeMenu(false)} aria-hidden="true" />

      <div
        id="site-menu"
        ref={panelRef}
        className={`site-menu${user ? " has-account" : ""}`}
        data-open={open}
        inert={!open}
        aria-label="菜单"
      >
        <nav aria-label="主导航（菜单）" className="site-menu__primary">
          {[...LINKS, { href: accountHref, label: accountLabel, kicker: user ? "My Profile" : "Sign in" }].map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              className="site-menu__item"
              style={{ "--i": i } as React.CSSProperties}
              aria-current={currentness(pathname, l.href)}
              onClick={() => setOpen(false)}
            >
              <span className="site-menu__label">{l.label}</span>
              <span className="site-menu__kicker">{l.kicker}</span>
            </Link>
          ))}
        </nav>
        {user && (
          <div className="site-menu__account" style={{ "--i": LINKS.length + 1 } as React.CSSProperties}>
            <span className="site-menu__email" title={user.email}>
              {user.email}
            </span>
            <button type="button" className="site-menu__signout" onClick={signOut}>
              退出登录
            </button>
          </div>
        )}
      </div>
    </>
  );
}
