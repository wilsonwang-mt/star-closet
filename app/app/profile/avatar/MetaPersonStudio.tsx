"use client";

import { useState, type ReactNode } from "react";
import type { BodyAnalysisView } from "@/lib/avatar/body";
import type { FlowPhase } from "@/lib/avatar/metaperson-flow";
import { MP_FACE_MAX_EDGE, type MpGender } from "@/lib/avatar/metaperson-protocol";
import type { AvatarState, Slot } from "@/lib/avatar/service";
import MetaPersonCreator, { type CreatorRequest, type EngineState } from "./MetaPersonCreator";
import PhotoTile, { BodyFrontSilhouette, BodySideSilhouette, FaceSilhouette, type Requirement } from "./PhotoTile";
import { photoToBase64 } from "./image-client";
import s from "./AvatarStudio.module.css";

// MetaPerson 模式的上传与生成（D56）：本站极简上传界面收三张照片，创建器在后台隐藏预加载；
// 点“生成我的 3D 形象”后把正脸照交给创建器生成，生成完成前一直显示本站的等待态。
// 生成前先请求体型分析（/api/avatar/body-analysis）：用户单独同意时由 Claude 参考全身照给出 8 个身体比例参数与一句体型概括，
// 否则服务端只按身高体重粗略设定；结果作为 generate_avatar 的 blends。MetaPerson 只用正脸照建脸，全身照只能微调体型。

/** 体型分析最长等多久；超时就不带体型参数继续生成。 */
const ANALYSIS_TIMEOUT_MS = 100_000;

async function fetchAnalysis(): Promise<BodyAnalysisView | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ANALYSIS_TIMEOUT_MS);
  try {
    const res = await fetch("/api/avatar/body-analysis", { method: "POST", signal: ctl.signal });
    return res.ok ? ((await res.json()) as BodyAnalysisView) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const SLOT_META: { slot: Slot; label: string; tip: string; required: Requirement; icon: ReactNode }[] = [
  { slot: "face", label: "正脸自拍", tip: "正对镜头，五官清晰", required: "必传", icon: <FaceSilhouette /> },
  { slot: "front", label: "全身正面", tip: "面向镜头，头到脚入镜", required: "必传", icon: <BodyFrontSilhouette /> },
  { slot: "side", label: "全身侧面", tip: "转身 90°，头到脚入镜", required: "选传", icon: <BodySideSilhouette /> },
];

const GENDERS: { value: MpGender; label: string }[] = [
  { value: "female", label: "女" },
  { value: "male", label: "男" },
];

export default function MetaPersonStudio({
  state,
  busy,
  errorAt,
  onUpload,
  onRemove,
  onImported,
  footer,
}: {
  state: AvatarState;
  /** 正在上传或删除的照片格（slot 或照片 id） */
  busy: string | null;
  errorAt: (at: string) => string | undefined;
  onUpload: (slot: Slot, file: File) => void;
  onRemove: (id: string, at: string) => void;
  onImported: (next: AvatarState) => void;
  footer?: ReactNode;
}) {
  const [gender, setGender] = useState<MpGender | null>(state.bodyAnalysis?.gender ?? null);
  const [request, setRequest] = useState<CreatorRequest | null>(null);
  const [phase, setPhase] = useState<FlowPhase>("standby");
  const [engine, setEngine] = useState<EngineState>("loading");
  const [genError, setGenError] = useState<string | null>(null);

  const photo = (slot: Slot) => state.photos.find((p) => p.slot === slot);
  const face = photo("face");
  const front = photo("front");
  const photoKey = `${front?.id ?? ""}|${photo("side")?.id ?? ""}`;
  // 本次分析的概括只对同一组全身照有效；没有时用页面带来的上次结果。
  const [last, setLast] = useState<{ key: string; summary: string | null } | null>(null);
  const summary = last && last.key === photoKey ? last.summary : (state.bodyAnalysis?.summary ?? null);
  const bodyOn = !!state.consent?.bodyAnalysis && !!state.offer.bodyAnalysis;
  const generating = phase === "generating";
  const ready = !!face && !!front && !!gender;

  async function generate() {
    if (!face || !front || !gender || generating) return;
    setGenError(null);
    const id = Date.now();
    setRequest({ id, payload: null });
    try {
      const [analysis, image] = await Promise.all([fetchAnalysis(), photoToBase64(face.url, MP_FACE_MAX_EDGE)]);
      setLast({ key: photoKey, summary: analysis?.summary ?? null });
      setRequest({ id, payload: { gender, image, blends: analysis?.blends ?? null } });
    } catch {
      setRequest(null);
      setGenError("无法读取正脸照片，请重新上传");
    }
  }

  const missing = !face || !front ? "先上传正脸自拍和全身正面照" : !gender ? "选择形象性别" : null;

  return (
    <section className="sc-glass card stack sc-rise">
      <h2 className="section-title">生成你的 3D 形象</h2>
      <p className="serif-note">
        {bodyOn
          ? "正脸自拍用来塑造你的形象，全身照用来参考你的体型；全身正面照同时用于 2D 试穿。"
          : "正脸自拍用来塑造你的形象，全身正面照同时用于 2D 试穿。"}
      </p>

      <div className={s.grid}>
        {SLOT_META.map((m) => {
          const p = photo(m.slot);
          return (
            <PhotoTile
              key={m.slot}
              label={m.label}
              tip={m.tip}
              icon={m.icon}
              noun="照片"
              photo={p}
              disabled={generating}
              busy={busy === m.slot || (!!p && busy === p.id)}
              required={m.required}
              error={errorAt(m.slot)}
              onPick={(f) => onUpload(m.slot, f)}
              onDelete={p ? () => onRemove(p.id, m.slot) : undefined}
            />
          );
        })}
      </div>

      <div className={s.choice}>
        <span className="sc-meta" id="mp-gender-label">
          形象性别
        </span>
        <div className={s.segment} role="group" aria-labelledby="mp-gender-label">
          {GENDERS.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={gender === g.value}
              disabled={generating}
              onClick={() => setGender(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {phase !== "fallback" ? (
        <div className={s.actions}>
          <button
            type="button"
            className={phase === "revealed" ? "sc-cta sc-cta--ghost" : "sc-cta"}
            disabled={!ready || generating || engine === "error"}
            onClick={generate}
          >
            {generating ? "正在生成…" : phase === "revealed" ? "用新照片重新生成" : "生成我的 3D 形象"}
          </button>
          {missing && !generating ? <span className="sc-meta">{missing}</span> : null}
        </div>
      ) : null}
      {genError ? (
        <p className="error" role="alert">
          {genError}
        </p>
      ) : null}

      <MetaPersonCreator
        request={request}
        stillUrl={front?.url ?? face?.url ?? null}
        summary={summary}
        onPhase={(p, e) => {
          setPhase(p);
          setEngine(e);
        }}
        onImported={onImported}
      />
      {footer}
    </section>
  );
}
