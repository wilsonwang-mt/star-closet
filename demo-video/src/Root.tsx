import { Composition } from "remotion";
import { Demo, TOTAL_FRAMES, type DemoProps } from "./Demo";
import { FPS } from "./theme";

// 两版：横屏 1920×1080、竖屏 1080×1920，同一套分镜，按画面宽高自动排版。
// request / total：一句话改编段浮层上的要求与总价，T4 录屏后改成录屏里的实际值。
const defaults: DemoProps = { request: "预算 800，户外婚礼，换平底鞋", total: 797 };

export function Root() {
  return (
    <>
      <Composition id="DemoLandscape" component={Demo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} defaultProps={defaults} />
      <Composition id="DemoPortrait" component={Demo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1080} height={1920} defaultProps={defaults} />
    </>
  );
}
