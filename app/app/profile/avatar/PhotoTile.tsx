"use client";

import { useRef, type ReactNode } from "react";
import type { PhotoView } from "@/lib/avatar/service";
import s from "./AvatarStudio.module.css";

export type Requirement = "必填" | "二选一" | "可选" | "必传" | "选传";

// 拍摄示意剪影：细线勾勒，颜色跟随 currentColor（香槟色）。
export function FaceSilhouette() {
  return (
    <svg viewBox="0 0 48 64" className={s.silhouette} aria-hidden="true">
      <ellipse cx="24" cy="25" rx="10.5" ry="13.5" />
      <path d="M8 62c0-10 7-15 16-15s16 5 16 15" />
      <path d="M20 23.5h.01M28 23.5h.01M21.5 31.5c1.6 1.2 3.4 1.2 5 0" />
    </svg>
  );
}

export function BodyFrontSilhouette() {
  return (
    <svg viewBox="0 0 48 96" className={s.silhouette} aria-hidden="true">
      <circle cx="24" cy="11" r="6.5" />
      <path d="M17 21.5q7-2.4 14 0l2.2 25-2.7.8-1 11.2-.8 31.5h-3.2L24 60l-1.5 30h-3.2l-.8-31.5-1-11.2-2.7-.8z" />
      <path d="M17 22.5l-5 25.5M31 22.5l5 25.5" />
    </svg>
  );
}

export function BodySideSilhouette() {
  return (
    <svg viewBox="0 0 48 96" className={s.silhouette} aria-hidden="true">
      <path d="M21 5.2a6.5 6.5 0 1 1 1.6 12.5l-.3 1.8" />
      <path d="M21 5.2c-1.6 1.2-2.4 3-2.4 5l-1.3 1.6 1.4.6c.2 1.8 1.2 3.5 2.6 4.6" />
      <path d="M22.3 19.5q6.2 1 6.2 10l-1 16.5-.9 12 .9 32h-4.8l-.6-31.5-2-12.5q-1.5-16 2.2-26.5z" />
      <path d="M24.5 23.5l1.2 25" />
    </svg>
  );
}

export default function PhotoTile({
  label,
  tip,
  photo,
  disabled,
  busy,
  error,
  required,
  icon,
  noun = "全身照",
  onPick,
  onDelete,
}: {
  label: string;
  tip: string;
  photo?: PhotoView;
  disabled: boolean;
  busy: boolean;
  /** 本格上传或删除的错误，就近显示 */
  error?: string;
  required: Requirement;
  /** 空格子里的拍摄示意；不传时显示“+” */
  icon?: ReactNode;
  /** 读屏用的名词：“上传正面全身照” */
  noun?: string;
  onPick?: (f: File) => void;
  onDelete?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={s.tile}>
      <button
        type="button"
        className={s.frame}
        data-empty={photo ? undefined : true}
        disabled={disabled || busy || !onPick}
        onClick={() => input.current?.click()}
        aria-label={photo ? `替换${label}照片` : `上传${label}${noun}`}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={photo.id} src={photo.url} alt={`${label}照片`} />
        ) : icon ? (
          <span className={s.plus}>
            {icon}
            {label}
          </span>
        ) : (
          <span className={s.plus}>
            <b aria-hidden="true">+</b>
            {label}
          </span>
        )}
        {busy ? (
          <span className={s.busy} aria-hidden="true">
            处理中…
          </span>
        ) : null}
      </button>
      {onPick ? (
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onPick(f);
          }}
        />
      ) : null}
      <div className={s.caption}>
        <span>
          {label} <span className={s.req}>{required}</span>
        </span>
        {photo && onDelete ? (
          <button type="button" className={s.small} onClick={onDelete} disabled={busy} aria-label={`删除${label}照片`}>
            删除
          </button>
        ) : null}
      </div>
      {photo && !icon ? (
        <span className={s.hint}>
          {photo.width}×{photo.height}
        </span>
      ) : (
        <span className={s.hint}>{tip}</span>
      )}
      {photo?.hints.map((h) => (
        <span key={h} className={`${s.hint} ${s.warn}`}>
          提示：{h}
        </span>
      ))}
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}
