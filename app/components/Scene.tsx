// 全屏场景层（视觉规范 §2）：夜/日两张场景图按主题切换，只显示一张。
// 视频到位后可在这里换成 <video muted playsInline loop autoPlay poster>。
export default function Scene({ variant = "closet", dim = false }: { variant?: "closet" | "cafe"; dim?: boolean }) {
  return (
    <div className="sc-scene app-scene" aria-hidden="true">
      {variant === "cafe" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="sc-scene__media" src="/scenes/life-cafe.jpg" alt="" />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sc-scene__media scene-night" src="/scenes/night-portrait.jpg" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sc-scene__media scene-day" src="/scenes/day-portrait.jpg" alt="" />
        </>
      )}
      <div className="sc-scene__vignette" />
      <div className="sc-beam scene-night-only" />
      <div className="sc-scene__fade-top" />
      <div className="sc-scene__fade-bottom" />
      {dim ? <div className="scene-dim" /> : null}
      <div className="sc-grain" />
    </div>
  );
}
