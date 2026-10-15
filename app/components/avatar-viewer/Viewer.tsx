"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box3, Vector3, type Group, type Mesh, type Object3D } from "three";
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

// 调用方用 key={src} 挂载：换模型时整体重建，状态自然回到加载态。
export type ViewerProps = {
  src: string;
  /** false：不做下落与自转（减弱动态时用户主动打开 3D） */
  animate: boolean;
};

type Status = { phase: "loading"; progress: number | null } | { phase: "ready" };

export default function Viewer({ src, animate }: ViewerProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ phase: "loading", progress: null });
  const [settled, setSettled] = useState(false);
  const [interacted, setInteracted] = useState(false);

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
          target={[0, TARGET_Y, 0]}
          enablePan={false}
          enableDamping
          minPolarAngle={POLAR}
          maxPolarAngle={POLAR}
          minDistance={3.2}
          maxDistance={6.2}
          autoRotate={animate && settled && !interacted}
          autoRotateSpeed={0.7}
          onStart={() => setInteracted(true)}
        />
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
