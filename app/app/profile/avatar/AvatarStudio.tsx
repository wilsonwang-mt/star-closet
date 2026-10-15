"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AvatarViewer from "@/components/AvatarViewer";
import type { AvatarState, JobView, PhotoView, Slot } from "@/lib/avatar/service";

const SLOT_META: { slot: Slot; label: string; tip: string; required?: boolean }[] = [
  { slot: "front", label: "正面全身", tip: "站直面对镜头，头到脚完整入镜", required: true },
  { slot: "side", label: "侧面全身", tip: "身体转 90°，手臂自然下垂" },
  { slot: "back", label: "背面全身", tip: "背对镜头，同样头到脚入镜" },
  { slot: "face", label: "面部特写", tip: "光线均匀，不戴墨镜" },
  { slot: "extra", label: "补充照片", tip: "可选，最多 3 张" },
];

const STATUS_TEXT: Record<string, string> = {
  queued: "排队中",
  processing: "生成中",
  succeeded: "已完成",
  failed: "生成失败",
  canceled: "已取消",
};

const MAX_EDGE = 1600;

// 在本机压缩到最长边 1600px 并重新编码为 JPEG：顺带去掉 EXIF（拍摄位置等）信息。
async function compress(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("encode failed");
  return blob;
}

async function readError(res: Response | null, fallback: string) {
  if (!res) return "网络异常，请稍后再试";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

function Badges({ items }: { items: string[] }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {items.map((b) => (
        <span key={b} className="sc-badge">
          {b}
        </span>
      ))}
    </div>
  );
}

function PhotoTile({
  meta,
  photo,
  disabled,
  busy,
  onPick,
  onDelete,
}: {
  meta: (typeof SLOT_META)[number];
  photo?: PhotoView;
  disabled: boolean;
  busy: boolean;
  onPick: (f: File) => void;
  onDelete?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="stack" style={{ gap: 6, minWidth: 0, alignContent: "start" }}>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
        aria-label={photo ? `替换${meta.label}` : `上传${meta.label}`}
        style={{
          aspectRatio: "3 / 4",
          width: "100%",
          borderRadius: 14,
          border: photo ? "1px solid rgba(201,169,110,.5)" : "1px dashed rgba(201,169,110,.6)",
          background: "rgba(255,255,255,.04)",
          overflow: "hidden",
          padding: 0,
          display: "grid",
          placeItems: "center",
          color: "var(--sc-ink)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.url} alt={meta.label} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span className="sc-meta" style={{ padding: 8 }}>
            {busy ? "上传中…" : `＋ ${meta.label}`}
          </span>
        )}
      </button>
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
      <div className="spread" style={{ gap: 4 }}>
        <span style={{ fontSize: 13 }}>
          {meta.label}
          {meta.required ? <span className="sc-meta">（必填）</span> : null}
        </span>
        {photo && onDelete ? (
          <button type="button" className="link-btn" onClick={onDelete} disabled={busy}>
            删除
          </button>
        ) : null}
      </div>
      {photo ? (
        <span className="sc-meta">
          {photo.width}×{photo.height}
        </span>
      ) : (
        <span className="sc-meta">{meta.tip}</span>
      )}
      {photo?.hints.map((h) => (
        <span key={h} className="sc-meta" style={{ color: "var(--sc-champ-text)" }}>
          提示：{h}
        </span>
      ))}
    </div>
  );
}

export default function AvatarStudio({ initial }: { initial: AvatarState }) {
  const [state, setState] = useState<AvatarState>(initial);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const job = state.job;
  const consented = !!state.consent?.current;
  const mock = state.provider.isMock;
  const modeBadges = mock ? ["非本人示意模型", "合身：未验证"] : ["AI 生成 3D 形象 · 还原度未验证", "合身：未验证"];
  const active = job?.status === "queued" || job?.status === "processing";

  const setJob = useCallback((j: JobView) => setState((s) => ({ ...s, job: j })), []);

  // 生成中每 2 秒查询一次进度；查询本身会推进任务状态。
  const jobId = job?.id;
  useEffect(() => {
    if (!jobId || !active) return;
    let stop = false;
    const t = setInterval(async () => {
      const res = await fetch(`/api/avatar/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
      if (stop || !res || !res.ok) return;
      setJob((await res.json()) as JobView);
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [jobId, active, setJob]);

  async function giveConsent() {
    setBusy("consent");
    setMsg(null);
    const res = await fetch("/api/avatar/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agree: true, consentVersion: state.provider.consentVersion }),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ ok: false, text: await readError(res, "记录同意失败") });
    setState((await res.json()) as AvatarState);
  }

  async function upload(slot: Slot, file: File) {
    setBusy(slot);
    setMsg(null);
    let blob: Blob;
    try {
      blob = await compress(file);
    } catch {
      setBusy(null);
      return setMsg({ ok: false, text: "无法读取这张图片，请换一张 JPG 或 PNG" });
    }
    const fd = new FormData();
    fd.set("slot", slot);
    fd.set("file", blob, `${slot}.jpg`);
    const res = await fetch("/api/avatar/photos", { method: "POST", body: fd }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ ok: false, text: await readError(res, "上传失败") });
    setState((await res.json()) as AvatarState);
  }

  async function removePhoto(id: string) {
    setBusy(id);
    const res = await fetch(`/api/avatar/photos/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ ok: false, text: await readError(res, "删除失败") });
    setState((await res.json()) as AvatarState);
  }

  async function generate() {
    setBusy("job");
    setMsg(null);
    const res = await fetch("/api/avatar/jobs", { method: "POST" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ ok: false, text: await readError(res, "创建任务失败") });
    setJob((await res.json()) as JobView);
  }

  async function cancel() {
    if (!job) return;
    setBusy("cancel");
    const res = await fetch(`/api/avatar/jobs/${job.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ ok: false, text: await readError(res, "取消失败") });
    setJob((await res.json()) as JobView);
  }

  async function deleteEverything() {
    if (!confirm("确定删除全部照片与 3D 形象吗？存储里的文件会一并删除，无法恢复。")) return;
    setBusy("delete");
    const res = await fetch("/api/avatar", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ ok: false, text: await readError(res, "删除失败") });
    setState((await res.json()) as AvatarState);
    setAgree(false);
    setMsg({ ok: true, text: "已删除全部照片与 3D 形象" });
  }

  const photosBySlot = (slot: Slot) => state.photos.filter((p) => p.slot === slot);
  const hasAny = state.photos.length > 0 || (job && job.status !== "canceled");

  return (
    <div className="stack">
      {/* 同意卡 */}
      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">照片怎么用</h2>
          {consented ? <span className="sc-badge">已同意</span> : null}
        </div>
        <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          <li>用途：只用来生成你的 3D 形象，在本站预览穿搭。</li>
          <li>谁处理：{state.provider.processor}。</li>
          <li>
            保存期：原始照片在 3D 形象生成完成 {state.retentionDays} 天后自动删除；3D 形象保留到你删除为止。
          </li>
          <li>可删除：随时一键删除全部照片与形象，存储里的文件同时清除。</li>
          <li>
            不用于训练：本站不会把你的照片或形象用于训练任何模型
            {mock ? "。" : "；第三方服务的数据处理以其条款为准，本站调用时要求不保留输入输出。"}
          </li>
          <li>隐私：照片仅你本人可见；上传前在你的设备上压缩，并去掉拍摄位置等附加信息。</li>
        </ul>
        {consented ? (
          <p className="sc-meta">同意时间：{new Date(state.consent!.at).toLocaleString("zh-CN")}</p>
        ) : (
          <>
            {state.consent && !state.consent.current ? (
              <p className="error">处理方已变更，请重新阅读并确认。</p>
            ) : null}
            <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", fontSize: 13, color: "var(--sc-ink)" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                {mock
                  ? "我同意本站保存我上传的照片，用于生成 3D 形象预览"
                  : "我同意把我的全身照发送给上述第三方 AI 服务，用于生成 3D 形象"}
              </span>
            </label>
            <button type="button" className="sc-cta" disabled={!agree || busy === "consent"} onClick={giveConsent}>
              {busy === "consent" ? "记录中…" : "同意并开始上传"}
            </button>
          </>
        )}
      </section>

      {/* 多照片上传 */}
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">上传照片</h2>
        <p className="serif-note">
          穿贴身或常穿的衣服，站直、手臂略微张开，背景简洁、光线均匀。至少需要正面，以及侧面或背面中的一张。
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
          {SLOT_META.filter((m) => m.slot !== "extra").map((m) => {
            const p = photosBySlot(m.slot)[0];
            return (
              <PhotoTile
                key={m.slot}
                meta={m}
                photo={p}
                disabled={!consented}
                busy={busy === m.slot || (!!p && busy === p.id)}
                onPick={(f) => upload(m.slot, f)}
                onDelete={p ? () => removePhoto(p.id) : undefined}
              />
            );
          })}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <span className="sc-meta">补充照片（可选，最多 3 张，仅存档，暂不参与生成）</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {photosBySlot("extra").map((p) => (
              <PhotoTile
                key={p.id}
                meta={SLOT_META[4]}
                photo={p}
                disabled
                busy={busy === p.id}
                onPick={() => {}}
                onDelete={() => removePhoto(p.id)}
              />
            ))}
            {photosBySlot("extra").length < 3 ? (
              <PhotoTile
                meta={SLOT_META[4]}
                disabled={!consented}
                busy={busy === "extra"}
                onPick={(f) => upload("extra", f)}
              />
            ) : null}
          </div>
        </div>
      </section>

      {/* 生成与结果 */}
      <section className="sc-glass card stack sc-rise">
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <h2 className="section-title">生成</h2>
          {job ? <span className="sc-meta">{STATUS_TEXT[job.status] ?? job.status}</span> : null}
        </div>
        {/* 有结果时徽章由查看器常驻显示，这里不重复 */}
        {job?.status === "succeeded" && job.glbUrl ? null : <Badges items={job ? job.badges : modeBadges} />}
        {mock ? (
          <p className="sc-meta">当前为示意模式：生成结果是通用人台，不是根据你的照片生成的本人形象。</p>
        ) : null}

        {active ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="wait-bar" aria-hidden="true">
              <i />
            </div>
            <p role="status" aria-live="polite" className="serif-note">
              {job!.status === "queued" ? "已提交，正在排队…" : `正在生成你的 3D 形象 · 已用 ${job!.elapsedSeconds} 秒`}
            </p>
            <button type="button" className="sc-cta sc-cta--ghost" onClick={cancel} disabled={busy === "cancel"}>
              取消生成
            </button>
          </div>
        ) : null}

        {job?.status === "failed" ? (
          <p className="error" role="alert">
            {job.error?.message ?? "生成失败"}，可以检查照片后重试。
          </p>
        ) : null}

        {job?.status === "succeeded" && job.glbUrl ? (
          <div className="stack" style={{ gap: 8 }}>
            <AvatarViewer src={job.glbUrl} badges={job.badges} />
            {job.fidelityNote ? <p className="sc-meta">{job.fidelityNote}</p> : null}
          </div>
        ) : null}

        {!active ? (
          <button type="button" className="sc-cta" disabled={!state.canGenerate || busy === "job"} onClick={generate}>
            {busy === "job"
              ? "提交中…"
              : job?.status === "failed"
                ? "重试生成"
                : job?.status === "succeeded" || job?.status === "canceled"
                  ? "重新生成"
                  : "生成我的 3D 形象"}
          </button>
        ) : null}
        {!active && !state.canGenerate ? (
          <p className="sc-meta">{consented ? "先上传正面，以及侧面或背面全身照。" : "先在上方勾选同意。"}</p>
        ) : null}
      </section>

      {/* 删除 */}
      {hasAny ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">删除</h2>
          <p className="sc-meta">删除全部照片与生成的 3D 形象，存储文件一并清除；之后再上传需要重新同意。</p>
          <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={deleteEverything} disabled={busy === "delete"}>
            {busy === "delete" ? "删除中…" : "一键删除全部照片与形象"}
          </button>
        </section>
      ) : null}

      <p role="status" aria-live="polite" className={msg?.ok === false ? "error" : "sc-meta"} style={{ textAlign: "center", minHeight: 18 }}>
        {msg?.text ?? ""}
      </p>
    </div>
  );
}
