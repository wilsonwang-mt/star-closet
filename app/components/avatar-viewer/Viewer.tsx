"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimationMixer, Box3, LoopRepeat, Vector3, type AnimationClip, type Group, type Mesh, type Object3D } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import ViewerErrorBoundary from "./ErrorBoundary";
import styles from "./AvatarViewer.module.css";

// 模型统一缩放到这个高度（场景单位），相机因此可以固定，不需要逐个模型取景。
const TARGET_HEIGHT = 1.8;
const TARGET_Y = 0.92;
// 相机固定在略高于视线的位置；极角锁死，只能水平 360° 旋转。
const POLAR = 1.47;
const DISTANCE = 4.6;
const CAMERA: [number, number, number] = [0, TARGET_Y + DISTANCE * Math.cos(POLAR), DISTANCE * Math.sin(POLAR)];

// 进场：从上方受重力下落、回弹一次后静止，总长 0.9s。
const DROP_HEIGHT = 0.55;
const FALL_T = 0.55;
const BOUNCE_T = 0.35;
const BOUNCE_HEIGHT = 0.05;

function dropOffset(elapsed: number): number {
  if (elapsed < FALL_T) {
    const u = elapsed / FALL_T;
    return DROP_HEIGHT * (1 - u * u); // 加速下落
  }
  const u = (elapsed - FALL_T) / BOUNCE_T;
  if (u >= 1) return 0;
  return BOUNCE_HEIGHT * 4 * u * (1 - u); // 抛物线回弹
}

/** GLB 带多段动画时优先选待机（Idle），否则第一段。 */
export function pickIdleClip(clips: AnimationClip[]): AnimationClip | null {
  if (!clips.length) return null;
  return clips.find((c) => /idle/i.test(c.name)) ?? clips[0];
}

export function clearModelCache(src: string) {
  useLoader.clear(GLTFLoader, src);
}

type ModelProps = {
  src: string;
  animate: boolean;
  onProgress: (ratio: number | null) => void;
  onLoaded: () => void;
  onSettled: () => void;
};

function Model({ src, animate, onProgress, onLoaded, onSettled }: ModelProps) {
  const gltf = useLoader(GLTFLoader, src, undefined, (e) => {
    onProgress(e.lengthComputable && e.total > 0 ? e.loaded / e.total : null);
  });

  const fitted = useMemo(() => {
    const object: Object3D = cloneSkinned(gltf.scene);
    object.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).frustumCulled = false; // 下落动画中别被裁掉
    });
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const scale = TARGET_HEIGHT / (Math.max(size.x, size.y, size.z) || 1);
    const center = box.getCenter(new Vector3());
    return {
      object,
      scale,
      position: [-center.x * scale, -box.min.y * scale, -center.z * scale] as [number, number, number],
    };
  }, [gltf]);

  const group = useRef<Group>(null);
  const start = useRef<number | null>(null);
  const settled = useRef(!animate);

  // 待机动画：MetaPerson 桌面版导出时带上 Idle 动画（见 metaperson-protocol.ts idlePoseParams），这里循环播放。
  // 减弱动态时不播放，停在绑定姿势（导出时已用动画首帧代替 T 字）。只动骨骼矩阵，不触发布局。
  const mixer = useMemo(() => {
    if (!animate) return null;
    const clip = pickIdleClip(gltf.animations);
    if (!clip) return null;
    const m = new AnimationMixer(fitted.object);
    const action = m.clipAction(clip);
    action.setLoop(LoopRepeat, Infinity);
    action.play();
    return m;
  }, [animate, gltf, fitted]);

  useEffect(() => {
    if (!mixer) return;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(mixer.getRoot());
    };
  }, [mixer]);

  useFrame((_, delta) => {
    // 掉帧或切回标签页时 delta 可能很大，封顶避免动作跳变
    mixer?.update(Math.min(delta, 1 / 20));
  });

  useEffect(() => {
    onLoaded();
    if (!animate) onSettled();
    // 只在模型就绪时通知一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitted]);

  useFrame((state) => {
    if (settled.current || !group.current) return;
    if (start.current === null) start.current = state.clock.elapsedTime;
    const elapsed = state.clock.elapsedTime - start.current;
    const y = dropOffset(elapsed);
    group.current.position.y = y;
    if (y === 0 && elapsed > FALL_T) {
      settled.current = true;
      onSettled();
    }
  });

  return (
    <group ref={group} position={[0, animate ? DROP_HEIGHT : 0, 0]}>
      <group scale={fitted.scale} position={fitted.position}>
        <primitive object={fitted.object} />
      </group>
    </group>
  );
}

// OrbitControls 挂上时会把事件元素（Canvas 外层 div）的 touch-action 设为 none，
// 盖掉外层的 pan-y，手指在查看器上竖滑时页面滚不动。极角锁死、只允许水平旋转，
// 所以改回 pan-y：竖向交给页面滚动，横向拖动仍由 OrbitControls 处理。
// 必须作为 <OrbitControls> 之后的兄弟节点渲染：同级 effect 按顺序执行，这里晚于 controls.connect()。
function AllowVerticalScroll() {
  const target = useThree((s) => s.events.connected as HTMLElement | undefined);
  const gl = useThree((s) => s.gl);
  const apply = useCallback(() => {
    for (const el of [target, gl.domElement]) {
      if (el && el.style.touchAction !== "pan-y") el.style.touchAction = "pan-y";
    }
  }, [target, gl]);
  useEffect(apply, [apply]);
  // 兜底：controls 若重新 connect 又写回 none，下一帧改回。
  useFrame(apply);
  return null;
}

// ---- 复位视角：弹簧把相机带回正面与默认距离 ----
// 半隐式欧拉积分的阻尼弹簧（刚度 170、阻尼比 0.86：轻微过冲后收住，接近 Apple 的“柔和弹簧”）。
// 只改相机位置（GPU 只做矩阵变换），每帧步长封顶 1/30s，掉帧时不会发散。
// 可打断：用户一按下拖动（OrbitControls start 事件）立即停下，速度不保留。减弱动态时直接跳到正面。
const SPRING_K = 170;
const SPRING_C = 2 * 0.86 * Math.sqrt(SPRING_K);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type Spring = { active: boolean; vA: number; vD: number };

function placeCamera(c: OrbitControlsImpl, azimuth: number, distance: number) {
  const cam = c.object;
  const s = Math.sin(POLAR);
  cam.position.set(
    c.target.x + distance * s * Math.sin(azimuth),
    c.target.y + distance * Math.cos(POLAR),
    c.target.z + distance * s * Math.cos(azimuth),
  );
  cam.lookAt(c.target);
}

function CameraRig({
  controls,
  spring,
  signal,
  animate,
  interacted,
  onMoved,
}: {
  interacted: boolean;
  controls: React.RefObject<OrbitControlsImpl | null>;
  spring: React.RefObject<Spring>;
  signal: number;
  animate: boolean;
  onMoved?: (moved: boolean) => void;
}) {
  const moved = useRef(false);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const c = controls.current;
    if (!signal || !c) return;
    if (!animate) {
      placeCamera(c, 0, DISTANCE);
      c.update();
      invalidate();
      return;
    }
    // 关掉阻尼并结算残余惯性，避免与弹簧互相拉扯；结束或被打断时恢复。
    c.enableDamping = false;
    c.update();
    spring.current.active = true;
    spring.current.vA = 0;
    spring.current.vD = 0;
  }, [signal, animate, controls, spring, invalidate]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    let az = c.getAzimuthalAngle();
    let dist = c.getDistance();
    const sp = spring.current;
    if (sp.active) {
      const h = Math.min(delta, 1 / 30);
      const dA = wrapAngle(0 - az);
      const dD = DISTANCE - dist;
      sp.vA += (SPRING_K * dA - SPRING_C * sp.vA) * h;
      sp.vD += (SPRING_K * dD - SPRING_C * sp.vD) * h;
      az += sp.vA * h;
      dist += sp.vD * h;
      const done = Math.abs(dA) < 0.001 && Math.abs(sp.vA) < 0.005 && Math.abs(dD) < 0.001 && Math.abs(sp.vD) < 0.005;
      if (done) {
        az = 0;
        dist = DISTANCE;
        sp.active = false;
        c.enableDamping = true;
      }
      placeCamera(c, az, dist);
    }
    // 只在用户亲手转动或缩放过之后才算“偏离”（进场自转不出现复位按钮）；复位途中视为已复位，按钮立即淡出。
    const isMoved = interacted && !sp.active && (Math.abs(wrapAngle(az)) > 0.12 || Math.abs(dist - DISTANCE) > 0.12);
    if (isMoved !== moved.current) {
      moved.current = isMoved;
      onMoved?.(isMoved);
    }
  });
  return null;
}

// 调用方用 key={src} 挂载：换模型时整体重建，状态自然回到加载态。
export type ViewerProps = {
  src: string;
  /** false：不做下落与自转（减弱动态时用户主动打开 3D） */
  animate: boolean;
  /** 每次递增触发一次“复位视角” */
  resetSignal?: number;
  /** 视角是否偏离正面（用于显示/隐藏复位按钮） */
  onMoved?: (moved: boolean) => void;
};

type Status = { phase: "loading"; progress: number | null } | { phase: "ready" };

export default function Viewer({ src, animate, resetSignal = 0, onMoved }: ViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ phase: "loading", progress: null });
  const [settled, setSettled] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const spring = useRef<Spring>({ active: false, vA: 0, vD: 0 });

  const retry = useCallback(() => {
    clearModelCache(src);
    setStatus({ phase: "loading", progress: null });
    setSettled(false);
    setAttempt((n) => n + 1);
  }, [src]);

  const onProgress = useCallback((progress: number | null) => {
    setStatus((s) => (s.phase === "loading" ? { phase: "loading", progress } : s));
  }, []);
  const onLoaded = useCallback(() => setStatus({ phase: "ready" }), []);
  const onSettled = useCallback(() => setSettled(true), []);

  return (
    <ViewerErrorBoundary key={`${src}#${attempt}`} onRetry={retry}>
      <Canvas
        className={styles.canvas}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
        camera={{ position: CAMERA, fov: 30, near: 0.1, far: 50 }}
        style={{ background: "transparent" }}
      >
        {/* 柔和影棚光：环境光 + 主光 + 轮廓光 */}
        <ambientLight intensity={0.55} />
        <hemisphereLight args={["#fff6e6", "#3a332a", 0.45]} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.7} color="#fff3e0" />
        <directionalLight position={[-3, 2.6, -3.5]} intensity={1.3} color="#e8cf9c" />
        <Suspense fallback={null}>
          <Model src={src} animate={animate} onProgress={onProgress} onLoaded={onLoaded} onSettled={onSettled} />
        </Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.42} scale={3.2} blur={2.6} far={1.6} resolution={512} />
        <OrbitControls
          ref={controls}
          target={[0, TARGET_Y, 0]}
          enablePan={false}
          enableDamping
          minPolarAngle={POLAR}
          maxPolarAngle={POLAR}
          minDistance={3.2}
          maxDistance={6.2}
          autoRotate={animate && settled && !interacted}
          autoRotateSpeed={0.7}
          onStart={() => {
            setInteracted(true);
            // 打断复位弹簧，交还给手势与阻尼
            if (spring.current.active) {
              spring.current.active = false;
              if (controls.current) controls.current.enableDamping = true;
            }
          }}
        />
        <AllowVerticalScroll />
        <CameraRig controls={controls} spring={spring} signal={resetSignal} animate={animate} interacted={interacted} onMoved={onMoved} />
      </Canvas>
      {status.phase === "loading" && (
        <div className={styles.overlay} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <span className="sc-meta">
            {status.progress === null ? "正在加载 3D 形象…" : `正在加载 3D 形象 ${Math.round(status.progress * 100)}%`}
          </span>
        </div>
      )}
    </ViewerErrorBoundary>
  );
}
