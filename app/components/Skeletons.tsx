"use client";

// 路由切换时的加载骨架（app/**/loading.tsx 使用）。Next 会预取这层外壳，点击后立刻切到骨架，数据到了再换成真页面。
// 结构与真页面同位：衣橱页是“底部文案 + 搭配网格”，搭配页是“返回胶囊 + 标题 + 两张卡”，换上真内容时不跳动。
// 骨架只用 tokens 颜色（两种主题自动适配），脉动在减弱动态时关闭（globals.css .skeleton-row）。
// 注意：这里不放共享元素过渡的 data-vt-hero，首页「走进衣橱」的放大推进只截取真页面的场景。
// 客户端组件：读屏状态文字从根布局下发的当前语言字典里取（useT），loading.tsx 不必变成异步。
import { useT } from "@/lib/i18n/client";

function Line({ w, h = 10 }: { w: string | number; h?: number }) {
  return <span className="skeleton-line" style={{ width: w, height: h, borderRadius: h / 2 }} />;
}

function Status({ label }: { label: string }) {
  return (
    <span className="sr-only" role="status">
      {label}
    </span>
  );
}

export function ClosetSkeleton() {
  const t = useT("system");
  return (
    <div className="page-skeleton" aria-busy="true">
      <Status label={t("loading.closet")} />
      <div className="page-skeleton__scene" aria-hidden="true" />
      <section className="wide-col page-skeleton__first skeleton-row" aria-hidden="true">
        <span className="skeleton-block page-skeleton__pill" />
        <div className="page-skeleton__copy">
          <Line w={150} h={9} />
          <Line w="min(320px, 70%)" h={34} />
          <Line w={190} />
          <Line w="min(420px, 90%)" h={12} />
          <Line w="min(300px, 64%)" h={12} />
        </div>
      </section>
      <section className="wide-col page-skeleton__looks" aria-hidden="true">
        <Line w={90} h={9} />
        <div className="page-skeleton__grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sc-glass page-skeleton__look skeleton-row" style={{ animationDelay: `${i * 0.12}s` }}>
              <span className="skeleton-block page-skeleton__cover" />
              <div className="page-skeleton__body">
                <Line w="60%" h={14} />
                <Line w="40%" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function OutfitSkeleton() {
  const t = useT("system");
  return (
    <div className="page-skeleton" aria-busy="true">
      <Status label={t("loading.outfit")} />
      <div className="page-skeleton__scene" aria-hidden="true" />
      <section className="hero skeleton-row" style={{ minHeight: "42dvh", gap: 10 }} aria-hidden="true">
        <span className="skeleton-block page-skeleton__pill" style={{ marginBottom: "auto" }} />
        <Line w={80} h={9} />
        <Line w="min(300px, 72%)" h={30} />
        <Line w="min(460px, 92%)" h={12} />
      </section>
      <div className="stack" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="sc-glass card stack skeleton-row" style={{ animationDelay: `${i * 0.12}s` }}>
            <Line w={110} h={14} />
            {[0, 1, 2].map((r) => (
              <div key={r} className="page-skeleton__row">
                <span className="skeleton-block" />
                <Line w="56%" h={12} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ label }: { label?: string }) {
  const t = useT("system");
  return (
    <div className="page-skeleton" aria-busy="true">
      <Status label={label ?? t("loading.page")} />
      <div className="page-skeleton__scene" aria-hidden="true" />
      <section className="hero skeleton-row" style={{ minHeight: "34dvh", gap: 10 }} aria-hidden="true">
        <Line w={100} h={9} />
        <Line w="min(240px, 60%)" h={30} />
        <Line w="min(420px, 88%)" h={12} />
      </section>
      <div className="stack" aria-hidden="true">
        <div className="sc-glass card stack skeleton-row">
          <Line w={120} h={14} />
          <Line w="80%" h={12} />
          <Line w="64%" h={12} />
        </div>
      </div>
    </div>
  );
}
