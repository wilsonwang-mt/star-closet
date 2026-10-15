import AutoVideo from "./AutoVideo";

// 全屏场景层（视觉规范 §2）：夜间竖屏 / 夜间宽屏 / 日间三段视频，由 CSS 按主题与屏幕宽度只显示一个，
// 只有显示的那个会加载并播放；poster 是视频第一帧。
export default function Scene({ dim = false }: { dim?: boolean }) {
  return (
    <div className="sc-scene app-scene" aria-hidden="true">
      <AutoVideo className="sc-scene__media is-video scene-night scene-portrait" src="/scenes/night-closet-web.mp4" poster="/scenes/night-portrait.jpg" />
      <AutoVideo className="sc-scene__media is-video scene-night scene-wide" src="/scenes/night-wide-web.mp4" poster="/scenes/night-wide.jpg" />
      <AutoVideo className="sc-scene__media is-video scene-day" src="/scenes/day-closet-web.mp4" poster="/scenes/day-portrait.jpg" />
      <div className="sc-scene__vignette" />
      <div className="sc-beam scene-night-only" />
      <div className="sc-scene__fade-top" />
      <div className="sc-scene__fade-bottom" />
      {dim ? <div className="scene-dim" /> : null}
      <div className="sc-grain" />
    </div>
  );
}
