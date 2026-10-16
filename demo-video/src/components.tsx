import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, getStaticFiles, Img, interpolate, OffthreadVideo, random, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, foil } from "./theme";

// 共用画面元素：场景层（缓推 + 暗角 + 渐隐）、胶片颗粒、刊头、浮起文字、玻璃卡、录屏占位、LIVE 标。

export const useLayout = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  /** 以 1080 短边为基准的缩放。 */
  const u = Math.min(width, height) / 1080;
  return { width, height, portrait, u };
};

const files = () => new Set(getStaticFiles().map((f) => f.name));
export const hasFile = (name: string) => files().has(name);

/** 全屏场景：图片或视频，缓慢推镜；可从虚焦暗场推到清晰（视觉规范 §7）。 */
export function SceneLayer({
  src,
  video = false,
  from = 1,
  to = 1.08,
  intro = false,
  dim = 0.35,
  durationInFrames,
}: {
  src: string;
  video?: boolean;
  from?: number;
  to?: number;
  intro?: boolean;
  dim?: number;
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, durationInFrames], [from, to], { extrapolateRight: "clamp" });
  const blur = intro ? interpolate(frame, [0, 75], [18, 0], { extrapolateRight: "clamp" }) : 0;
  const bright = intro ? interpolate(frame, [0, 75], [0.15, 1], { extrapolateRight: "clamp" }) : 1;
  const style: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, filter: `blur(${blur}px) brightness(${bright})` };
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      {video ? <OffthreadVideo src={staticFile(src)} muted style={style} /> : <Img src={staticFile(src)} style={style} />}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.55) 100%)` }} />
      <AbsoluteFill style={{ background: "linear-gradient(to bottom, rgba(11,13,16,.55), transparent 22%, transparent 62%, rgba(11,13,16,.85))" }} />
      <AbsoluteFill style={{ backgroundColor: `rgba(11,13,16,${dim})` }} />
    </AbsoluteFill>
  );
}

/** 胶片颗粒：每两帧换一次噪点种子，深色模式透明度 .14。 */
export function Grain({ opacity = 0.14 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 97;
  const dx = Math.round(random(`gx${seed}`) * 200);
  const dy = Math.round(random(`gy${seed}`) * 200);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity, mixBlendMode: "overlay" }}>
      <svg width="100%" height="100%" style={{ transform: `translate(${-dx}px, ${-dy}px)`, width: "calc(100% + 200px)", height: "calc(100% + 200px)" }}>
        <filter id={`g${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g${seed})`} />
      </svg>
    </AbsoluteFill>
  );
}

/** 弹簧浮起：opacity + translateY，可设延迟（帧）。 */
export function Rise({ children, delay = 0, distance = 28, style }: { children: ReactNode; delay?: number; distance?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 26, stiffness: 120, mass: 1 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * distance}px)`, ...style }}>{children}</div>;
}

export function Masthead({ size = 1 }: { size?: number }) {
  const { u } = useLayout();
  return (
    <div style={{ fontFamily: fonts.didone, fontSize: 64 * size * u, letterSpacing: "0.42em", color: colors.ink, paddingLeft: "0.42em" }}>STAR CLOSET</div>
  );
}

export function Kicker({ children }: { children: ReactNode }) {
  const { u } = useLayout();
  return <div style={{ fontFamily: fonts.didone, fontStyle: "italic", fontSize: 26 * u, letterSpacing: "0.12em", color: colors.ink2 }}>{children}</div>;
}

export function Title({ children, size = 1 }: { children: ReactNode; size?: number }) {
  const { u } = useLayout();
  return (
    <div style={{ fontFamily: fonts.serif, fontSize: 64 * size * u, letterSpacing: "0.12em", lineHeight: 1.45, color: colors.ink, textShadow: "0 2px 24px rgba(0,0,0,.5)" }}>
      {children}
    </div>
  );
}

export function Foil({ children, size = 1 }: { children: ReactNode; size?: number }) {
  const { u } = useLayout();
  const frame = useCurrentFrame();
  const x = interpolate(frame % 270, [0, 270], [0, 200]);
  return (
    <span
      style={{
        fontFamily: fonts.didone,
        fontStyle: "italic",
        fontSize: 96 * size * u,
        backgroundImage: foil,
        backgroundSize: "200% 100%",
        backgroundPosition: `${x}% 0`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
      }}
    >
      {children}
    </span>
  );
}

export function Glass({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: colors.glass,
        backdropFilter: "blur(14px) saturate(1.3)",
        borderRadius: 28,
        boxShadow: `inset 0 1px 0 ${colors.glassEdge}, inset 0 0 0 .5px rgba(255,246,230,.12), 0 30px 80px rgba(0,0,0,.35)`,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** 录屏：public/recordings/<name> 存在时播放，否则显示占位卡（T4 直接替换文件即可）。 */
export function Recording({ name, label, style, startFrom = 0 }: { name: string; label: string; style?: CSSProperties; startFrom?: number }) {
  const { u } = useLayout();
  const path = `recordings/${name}`;
  if (hasFile(path)) {
    return (
      <Glass style={style}>
        <OffthreadVideo src={staticFile(path)} muted startFrom={startFrom} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Glass>
    );
  }
  return (
    <Glass style={{ display: "grid", placeItems: "center", ...style }}>
      <div style={{ textAlign: "center", color: colors.ink2, fontFamily: fonts.sans, fontWeight: 300 }}>
        <div style={{ fontSize: 22 * u, letterSpacing: "0.3em", color: colors.champText }}>录屏占位</div>
        <div style={{ marginTop: 18 * u, fontSize: 30 * u, color: colors.ink, fontFamily: fonts.serif, letterSpacing: "0.1em" }}>{label}</div>
        <div style={{ marginTop: 14 * u, fontSize: 20 * u, letterSpacing: "0.06em" }}>demo-video/public/{path}</div>
      </div>
      <div style={{ position: "absolute", inset: 18 * u, border: `1.5px dashed rgba(201,169,110,.45)`, borderRadius: 20 }} />
    </Glass>
  );
}

export function LiveBadge() {
  const { u } = useLayout();
  return (
    <div
      style={{
        position: "absolute",
        top: 18 * u,
        left: 18 * u,
        display: "flex",
        alignItems: "center",
        gap: 8 * u,
        padding: `${7 * u}px ${14 * u}px ${7 * u}px ${10 * u}px`,
        borderRadius: 999,
        background: "rgba(20,18,15,.42)",
        color: "#f7f1e6",
        fontFamily: fonts.sans,
        fontSize: 16 * u,
        letterSpacing: "0.14em",
      }}
    >
      <svg width={18 * u} height={18 * u} viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="2.2" fill="currentColor" />
        <circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
      LIVE
    </div>
  );
}
