import AutoVideo from "./AutoVideo";

// 全屏场景层（视觉规范 §2）：夜间竖屏 / 夜间宽屏 / 日间三段视频，由 CSS 按主题与屏幕宽度只显示一个，
// 只有显示的那个会加载并播放；poster 是视频第一帧。
// 日间暂无横屏素材：宽屏下竖屏视频居中、两侧大范围羽化，底下垫一层同一画面的大幅模糊放大（环境色铺满全宽），
// 不再露出米色空白和硬边。
// cover：传入时（搭配页）改用这套搭配自己的封面照片做场景，与衣橱页的搭配卡衔接；两种主题都用它。
export default function Scene({ dim = false, cover }: { dim?: boolean; cover?: string | null }) {
  return (
    <div className="sc-scene app-scene" aria-hidden="true">
      {cover ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="scene-ambient scene-ambient--cover" src={cover} alt="" decoding="async" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sc-scene__media scene-cover" src={cover} alt="" decoding="async" fetchPriority="high" />
        </>
      ) : (
        <>
          <AutoVideo className="sc-scene__media is-video scene-night scene-portrait" src="/scenes/night-closet-web.mp4" poster="/scenes/night-portrait.jpg" />
          <AutoVideo className="sc-scene__media is-video scene-night scene-wide" src="/scenes/night-wide-web.mp4" poster="/scenes/night-wide.jpg" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="scene-ambient scene-day-ambient" src="/scenes/day-portrait.jpg" alt="" decoding="async" />
          <AutoVideo className="sc-scene__media is-video scene-day" src="/scenes/day-closet-web.mp4" poster="/scenes/day-portrait.jpg" />
        </>
      )}
      <div className="sc-scene__vignette" />
      {cover ? null : <div className="sc-beam scene-night-only" />}
      <div className="sc-scene__fade-top" />
      <div className="sc-scene__fade-bottom" />
      {/* 封面是人物街拍，画面亮且杂：标题与风格说明所在的中下部再垫一层底色，文字始终清楚 */}
      {cover ? <div className="scene-cover-scrim" /> : null}
      {dim ? <div className="scene-dim" /> : null}
      <div className="sc-grain" />
    </div>
  );
}
