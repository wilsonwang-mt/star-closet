import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Foil, Glass, Grain, hasFile, Kicker, LiveBadge, Masthead, Recording, Rise, SceneLayer, Title, useLayout } from "./components";
import { colors, fonts, sec } from "./theme";

// 分镜（docs/工作站任务/T1-演示视频.md §3）。时长见 Demo.tsx 的 SCENES。

const center = { justifyContent: "center", alignItems: "center", textAlign: "center" as const };

/** 0–8s 片头：夜景横移（竖屏用夜间衣橱竖版），刊头与一句愿景。 */
export function Intro({ d }: { d: number }) {
  const { portrait, u } = useLayout();
  return (
    <AbsoluteFill>
      <SceneLayer src={portrait ? "brand/video/night-closet-web.mp4" : "brand/video/night-wide-web.mp4"} video intro dim={0.25} from={1.02} to={1.08} durationInFrames={d} />
      <AbsoluteFill style={{ ...center, gap: 36 * u }}>
        <Rise delay={sec(1.2)}>
          <Masthead size={portrait ? 0.9 : 1.15} />
        </Rise>
        <Rise delay={sec(2.6)}>
          <div style={{ fontFamily: fonts.serif, fontSize: (portrait ? 40 : 44) * u, letterSpacing: "0.16em", color: colors.ink, padding: `0 ${60 * u}px`, lineHeight: 1.7 }}>
            让每一种喜欢的风格，{portrait ? <br /> : null}都能穿到自己身上
          </div>
        </Rise>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
}

/** 8–20s 痛点：收藏卡片越堆越多，计数到 100；然后一句“还是不知道自己该怎么穿”。 */
export function Pain({ d }: { d: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait, u, width, height } = useLayout();
  const covers = Array.from({ length: 24 }, (_, i) => `brand/outfits/O${String(((i * 7) % 60) + 1).padStart(2, "0")}.webp`).filter(hasFile);
  const count = Math.round(interpolate(frame, [sec(0.6), sec(6)], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const fade = interpolate(frame, [sec(6.5), sec(8)], [1, 0.22], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cols = portrait ? 4 : 8;
  const cw = (width - 80 * u) / cols;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <AbsoluteFill style={{ opacity: fade }}>
        {covers.map((c, i) => {
          const p = spring({ frame: frame - sec(0.4) - i * 5, fps, config: { damping: 18, stiffness: 140 } });
          const col = i % cols;
          const row = Math.floor(i / cols);
          return (
            <Img
              key={c}
              src={staticFile(c)}
              style={{
                position: "absolute",
                left: 40 * u + col * cw + 6,
                top: (portrait ? 180 : 60) * u + row * cw * 1.33,
                width: cw - 12,
                height: cw * 1.33 - 12,
                objectFit: "cover",
                borderRadius: 14 * u,
                opacity: p * 0.9,
                transform: `translateY(${(1 - p) * -60}px) rotate(${((i % 5) - 2) * 0.8}deg)`,
              }}
            />
          );
        })}
      </AbsoluteFill>
      <AbsoluteFill style={{ ...center, background: "radial-gradient(ellipse at center, rgba(11,13,16,.75), rgba(11,13,16,.2) 70%)" }}>
        <Glass style={{ padding: `${40 * u}px ${64 * u}px` }}>
          <Kicker>Saved · 收藏夹</Kicker>
          <div style={{ marginTop: 10 * u }}>
            <Foil size={1.3}>{count}</Foil>
            <span style={{ fontFamily: fonts.serif, fontSize: 40 * u, color: colors.ink, letterSpacing: "0.12em", marginLeft: 12 * u }}>套穿搭</span>
          </div>
        </Glass>
        <Rise delay={sec(7)} style={{ marginTop: 56 * u, maxWidth: width - 120 * u }}>
          <Title size={portrait ? 0.82 : 0.9}>还是不知道自己该怎么穿</Title>
        </Rise>
      </AbsoluteFill>
      <Grain />
      <div style={{ position: "absolute", width, height }} />
    </AbsoluteFill>
  );
}

/** 录屏段的统一版式：横屏左文右屏，竖屏上文下屏。 */
function RecordingScene({ d, kicker, title, note, file, label, bg }: { d: number; kicker: string; title: string; note: string; file: string; label: string; bg: string }) {
  const { portrait, u, width, height } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - sec(0.5), fps, config: { damping: 24, stiffness: 90 } });
  const screen = portrait
    ? { width: width - 140 * u, height: (width - 140 * u) * (812 / 375) * 0.82 }
    : { width: width * 0.56, height: width * 0.56 * (900 / 1440) };
  return (
    <AbsoluteFill>
      <SceneLayer src={bg} dim={0.62} from={1.04} to={1.1} durationInFrames={d} />
      <AbsoluteFill
        style={{
          flexDirection: portrait ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          gap: (portrait ? 48 : 90) * u,
          padding: `${80 * u}px ${70 * u}px`,
        }}
      >
        <div style={{ width: portrait ? "100%" : width * 0.28, textAlign: portrait ? "center" : "left" }}>
          <Rise delay={sec(0.2)}>
            <Kicker>{kicker}</Kicker>
          </Rise>
          <Rise delay={sec(0.45)} style={{ marginTop: 14 * u }}>
            <Title size={portrait ? 0.8 : 0.85}>{title}</Title>
          </Rise>
          <Rise delay={sec(0.8)} style={{ marginTop: 20 * u }}>
            <div style={{ fontFamily: fonts.serif, fontSize: 26 * u, lineHeight: 1.85, color: colors.ink2, letterSpacing: "0.06em" }}>{note}</div>
          </Rise>
        </div>
        <div style={{ opacity: p, transform: `translateY(${(1 - p) * 60}px) scale(${0.96 + 0.04 * p})` }}>
          <Recording name={file} label={label} style={{ width: screen.width, height: Math.min(screen.height, height * 0.62), position: "relative" }} />
        </div>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
}

/** 20–40s 走进衣橱：首页浅弧轮播 → 走进衣橱（录屏）。 */
export function Closet({ d }: { d: number }) {
  return (
    <RecordingScene
      d={d}
      kicker="01 — Walk In"
      title="走进一间衣橱"
      note="明星、博主、品牌和懂穿搭的人，各开一间衣橱。滑一滑，走进去。"
      file="02-closet.mp4"
      label="首页浅弧轮播 → 走进衣橱"
      bg="brand/keyframes/night-portrait.jpg"
    />
  );
}

/** 40–60s 一句话改编：输入要求 → AI 改编结果（录屏）+ 要求与总价浮层。 */
export function Adapt({ d, request, total }: { d: number; request: string; total: number }) {
  const { portrait, u } = useLayout();
  const frame = useCurrentFrame();
  const shown = Math.min(request.length, Math.max(0, Math.floor((frame - sec(1.4)) / 3)));
  const priceOn = frame > sec(12);
  return (
    <AbsoluteFill>
      <RecordingScene
        d={d}
        kicker="02 — Re-style"
        title="一句话，改成你的那一套"
        note="说出预算、场合和想换的单品，AI 在目录里改编出一整套，逐件说明，总价对得上。"
        file="03-adapt.mp4"
        label="输入要求 → AI 改编结果"
        bg="brand/keyframes/night-wide.jpg"
      />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: portrait ? "center" : "flex-start", padding: `${(portrait ? 120 : 90) * u}px ${(portrait ? 70 : 120) * u}px` }}>
        <Glass style={{ padding: `${20 * u}px ${30 * u}px`, display: "flex", gap: 28 * u, alignItems: "center" }}>
          <div style={{ fontFamily: fonts.sans, fontWeight: 300, fontSize: 28 * u, color: colors.ink, letterSpacing: "0.06em" }}>
            “{request.slice(0, shown)}
            <span style={{ opacity: shown < request.length && Math.floor(frame / 15) % 2 === 0 ? 1 : 0 }}>|</span>”
          </div>
          {priceOn ? <Foil size={0.6}>¥{total}</Foil> : null}
        </Glass>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** 60–78s 穿在我身上：先 3D 形象 360°（录屏），再场景上身图 + Live。 */
export function OnMe({ d }: { d: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait, u, width, height } = useLayout();
  const split = sec(8);
  const looks = ["I113-wedding", "I011-street", "I071-gallery"].filter((k) => hasFile(`demo/scenes/${k}.jpg`));
  if (frame < split) {
    return (
      <RecordingScene
        d={split}
        kicker="03 — On You"
        title="穿在我身上"
        note="一张自拍生成你的 3D 形象，360° 转一圈看看。"
        file="04-avatar.mp4"
        label="自拍生成 3D 形象并 360° 旋转"
        bg="brand/keyframes/life-cafe.jpg"
      />
    );
  }
  const f = frame - split;
  const shown = portrait ? looks.slice(0, 1) : looks;
  const cardW = portrait ? width - 160 * u : (width - 260 * u) / 3;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <SceneLayer src="brand/keyframes/life-cafe.jpg" dim={0.7} durationInFrames={d - split} />
      <AbsoluteFill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 44 * u }}>
        <Rise delay={0}>
          <div style={{ textAlign: "center" }}>
            <Kicker>In Your Life</Kicker>
            <div style={{ marginTop: 12 * u }}>
              <Title size={portrait ? 0.78 : 0.8}>走进不同的场景，看它动起来</Title>
            </div>
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 40 * u }}>
          {shown.length
            ? shown.map((k, i) => {
                const p = spring({ frame: f - 10 - i * 8, fps, config: { damping: 22, stiffness: 110 } });
                const live = hasFile(`demo/live/${k}.mp4`);
                return (
                  <div key={k} style={{ opacity: p, transform: `translateY(${(1 - p) * 50}px) scale(${1 + 0.04 * p})` }}>
                    <Glass style={{ width: cardW, height: Math.min(cardW * 4 / 3, height * 0.64), position: "relative" }}>
                      {live ? (
                        <OffthreadVideo src={staticFile(`demo/live/${k}.mp4`)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <Img src={staticFile(`demo/scenes/${k}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      )}
                      {live ? <LiveBadge /> : null}
                    </Glass>
                  </div>
                );
              })
            : <Recording name="05-item-live.mp4" label="商品详情页 · 上身效果与 Live" style={{ width: portrait ? width - 160 * u : width * 0.6, height: height * 0.55, position: "relative" }} />}
        </div>
        <Rise delay={sec(1.5)}>
          <div style={{ fontFamily: fonts.sans, fontWeight: 300, fontSize: 22 * u, color: colors.ink2, letterSpacing: "0.1em" }}>演示模特为 AI 生成的虚构人物</div>
        </Rise>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
}

/** 78–90s 收尾：愿景 + 产品名，夜间衣橱竖图缓推。 */
export function Outro({ d }: { d: number }) {
  const { portrait, u } = useLayout();
  return (
    <AbsoluteFill>
      <SceneLayer src={portrait ? "brand/keyframes/night-portrait.jpg" : "brand/keyframes/night-wide.jpg"} dim={0.45} from={1.0} to={1.1} durationInFrames={d} />
      <AbsoluteFill style={{ ...center, gap: 40 * u }}>
        <Rise delay={sec(0.4)}>
          <Title size={portrait ? 0.8 : 0.9}>让每一种喜欢的风格，{portrait ? <br /> : null}都能穿到自己身上</Title>
        </Rise>
        <Rise delay={sec(1.6)}>
          <div style={{ fontFamily: fonts.sans, fontWeight: 300, fontSize: 28 * u, letterSpacing: "0.4em", color: colors.champText, paddingLeft: "0.4em" }}>逛得到 · 试得上 · 买得到</div>
        </Rise>
        <Rise delay={sec(3)} style={{ marginTop: 40 * u }}>
          <Masthead size={portrait ? 0.8 : 1} />
        </Rise>
      </AbsoluteFill>
      <Grain />
    </AbsoluteFill>
  );
}
