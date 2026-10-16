import { AbsoluteFill } from "remotion";
import { linearTiming, springTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Adapt, Closet, Intro, OnMe, Outro, Pain } from "./scenes";
import { colors, sec } from "./theme";

// 90 秒成片：6 段，段与段之间 0.6 秒弹簧淡入淡出（交叠）。
// 每段时长 = 分镜时长 + 交叠，合计 2700 帧（30fps）。
const T = sec(0.6);
export const SCENES = [
  { id: "intro", seconds: 8 },
  { id: "pain", seconds: 12 },
  { id: "closet", seconds: 20 },
  { id: "adapt", seconds: 20 },
  { id: "onme", seconds: 18 },
  { id: "outro", seconds: 12 },
] as const;
const len = (i: number) => sec(SCENES[i].seconds) + (i < SCENES.length - 1 ? T : 0);
export const TOTAL_FRAMES = SCENES.reduce((n, _s, i) => n + len(i), 0) - T * (SCENES.length - 1);

export type DemoProps = { request: string; total: number };

export function Demo({ request, total }: DemoProps) {
  const timing = springTiming({ config: { damping: 200 }, durationInFrames: T });
  const parts = [
    <Intro d={len(0)} />,
    <Pain d={len(1)} />,
    <Closet d={len(2)} />,
    <Adapt d={len(3)} request={request} total={total} />,
    <OnMe d={len(4)} />,
    <Outro d={len(5)} />,
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <TransitionSeries>
        {parts.flatMap((node, i) => {
          const seq = (
            <TransitionSeries.Sequence key={SCENES[i].id} durationInFrames={len(i)}>
              {node}
            </TransitionSeries.Sequence>
          );
          return i < parts.length - 1
            ? [seq, <TransitionSeries.Transition key={`t${i}`} presentation={fade()} timing={i === 0 ? linearTiming({ durationInFrames: T }) : timing} />]
            : [seq];
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
}
