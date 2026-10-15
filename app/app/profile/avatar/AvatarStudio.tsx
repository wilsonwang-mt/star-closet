"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AvatarViewer from "@/components/AvatarViewer";
import type { AvatarState, JobView, PhotoView, RemoteSummary, Slot } from "@/lib/avatar/service";
import s from "./AvatarStudio.module.css";

// 只收生成会用到的三张全身照；面部特写与补充照片不参与生成，已不再收集。
const SLOT_META: { slot: Slot; label: string; tip: string }[] = [
  { slot: "front", label: "正面", tip: "站直面对镜头，头到脚完整入镜" },
  { slot: "side", label: "侧面", tip: "身体转 90°，手臂自然下垂" },
  { slot: "back", label: "背面", tip: "背对镜头，同样头到脚入镜" },
];
const LEGACY_LABEL: Partial<Record<Slot, string>> = { face: "面部特写", extra: "补充照片" };

const STATUS_TEXT: Record<string, string> = {
  queued: "排队中",
  processing: "生成中",
  succeeded: "已完成",
  failed: "生成失败",
  canceled: "已取消",
};

const MAX_EDGE = 1600;

// 在本机压缩到最长边 1600px 并重新编码为 JPEG：顺带去掉 EXIF（拍摄位置等）信息。服务端还会再剥离一次。
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

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });

function remoteText(state: JobView["remotePurge"], name: string): { text: string; bad: boolean } | null {
  if (state === "sent") return { text: `第三方副本删除请求已发送（${name}）`, bad: false };
  if (state === "failed") return { text: `第三方副本删除请求失败（${name}），已记录，清理任务会重试`, bad: true };
  if (state === "pending") return { text: `${name} 的任务尚未结束，删除请求已记录，清理任务会重试`, bad: false };
  return null;
}

function summaryText(r: RemoteSummary): string {
  const parts: string[] = [];
  if (r.sent) parts.push(`第三方副本删除请求已发送 ${r.sent} 个`);
  if (r.failed) parts.push(`${r.failed} 个删除请求失败，已记录，清理任务会重试`);
  if (r.pending) parts.push(`${r.pending} 个任务尚未结束，稍后重试删除`);
  return parts.length ? `；${parts.join("，")}` : "";
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
  label,
  tip,
  photo,
  disabled,
  busy,
  error,
  required,
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
  /** 必填 / 二选一 / 可选 */
  required: "必填" | "二选一" | "可选";
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
        aria-label={photo ? `替换${label}照片` : `上传${label}全身照`}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={photo.id} src={photo.url} alt={`${label}照片`} />
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
      {photo ? (
        <span className={s.hint}>
          {photo.width}×{photo.height}
          {photo.expiresAt ? ` · ${fmtDate(photo.expiresAt)}自动删除` : ""}
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

export default function AvatarStudio({ initial }: { initial: AvatarState }) {
  const [state, setState] = useState<AvatarState>(initial);
  const offer = state.offer.thirdParty;
  const [agreeStore, setAgreeStore] = useState(false);
  const [agreeThird, setAgreeThird] = useState(!!initial.consent?.thirdParty);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // 提示就近显示：at 为照片格（slot 或照片 id）、consent、job、delete。
  // 底部的视觉隐藏 aria-live 区同步播报给读屏，就近文字不再重复声明 role。
  const [msg, setMsg] = useState<{ at: string; ok: boolean; text: string } | null>(null);
  const noteAt = (at: string) => (msg && msg.at === at ? msg : null);
  const job = state.job;
  const consented = !!state.consent?.current;
  const showConsentForm = !consented || editing;
  const mock = state.provider.isMock;
  // 真实服务按位置区分视角（front/left/back），侧面必填；示意模式正面 + 侧面或背面任一即可。
  const sideRequired = !mock;
  const modeBadges = mock ? ["非本人示意模型", "合身：未验证"] : ["AI 生成 3D 形象 · 还原度未验证", "合身：未验证"];
  const active = job?.status === "queued" || job?.status === "processing";
  const remoteName = offer?.name ?? "fal.ai（Tripo 3D）";

  const setJob = useCallback((j: JobView) => setState((st) => ({ ...st, job: j })), []);

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
      body: JSON.stringify({ store: true, thirdParty: !!offer && agreeThird, offerVersion: state.offer.version }),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "consent", ok: false, text: await readError(res, "记录同意失败") });
    const next = (await res.json()) as AvatarState;
    setState(next);
    setEditing(false);
    setAgreeThird(!!next.consent?.thirdParty);
  }

  async function upload(slot: Slot, file: File) {
    setBusy(slot);
    setMsg(null);
    let blob: Blob;
    try {
      blob = await compress(file);
    } catch {
      setBusy(null);
      return setMsg({ at: slot, ok: false, text: "无法读取这张图片，请换一张 JPG 或 PNG" });
    }
    const fd = new FormData();
    fd.set("slot", slot);
    fd.set("file", blob, `${slot}.jpg`);
    const res = await fetch("/api/avatar/photos", { method: "POST", body: fd }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: slot, ok: false, text: await readError(res, "上传失败") });
    setState((await res.json()) as AvatarState);
  }

  // at：错误显示的位置。主视角按 slot（删除后格子仍在），其他照片按照片 id。
  async function removePhoto(id: string, at: string) {
    setBusy(id);
    setMsg(null);
    const res = await fetch(`/api/avatar/photos/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at, ok: false, text: await readError(res, "删除失败") });
    setState((await res.json()) as AvatarState);
  }

  async function generate() {
    setBusy("job");
    setMsg(null);
    const res = await fetch("/api/avatar/jobs", { method: "POST" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, "创建任务失败") });
    setJob((await res.json()) as JobView);
  }

  async function cancel() {
    if (!job) return;
    setBusy("cancel");
    setMsg(null);
    const res = await fetch(`/api/avatar/jobs/${job.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, "取消失败") });
    setJob((await res.json()) as JobView);
  }

  async function deleteAvatar() {
    if (!job) return;
    if (!confirm("删除这个 3D 形象吗？照片会保留，之后可以重新生成。")) return;
    setBusy("result");
    setMsg(null);
    const res = await fetch(`/api/avatar/jobs/${job.id}/result`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, "删除失败") });
    const body = (await res.json()) as { job: JobView };
    setJob(body.job);
    setMsg({ at: "job", ok: true, text: "已删除这个 3D 形象，照片仍保留" });
  }

  async function deleteEverything() {
    if (!confirm("确定删除全部照片与 3D 形象吗？存储里的文件会一并删除，无法恢复。")) return;
    setBusy("delete");
    setMsg(null);
    const res = await fetch("/api/avatar", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "delete", ok: false, text: await readError(res, "删除失败") });
    const body = (await res.json()) as AvatarState & { remotePurge: RemoteSummary };
    setState(body);
    setAgreeStore(false);
    setAgreeThird(false);
    setMsg({ at: "delete", ok: body.remotePurge.failed === 0, text: `已删除全部照片与 3D 形象${summaryText(body.remotePurge)}` });
  }

  const photosBySlot = (slot: Slot) => state.photos.filter((p) => p.slot === slot);
  const legacy = state.photos.filter((p) => p.slot === "face" || p.slot === "extra");
  const hasAny = state.photos.length > 0 || (job && job.status !== "canceled");
  const remote = job ? remoteText(job.remotePurge, remoteName) : null;

  return (
    <div className="stack">
      {/* 同意卡 */}
      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">照片怎么用</h2>
          {consented && !editing ? <span className="sc-badge">已同意</span> : null}
        </div>
        <ul className={s.consentList}>
          <li>
            <strong>用途</strong>：只用来生成你的 3D 形象，在本站 360° 查看。它是外观预览，合身未验证；穿搭试穿尚未接入。
          </li>
          <li>
            <strong>收哪些</strong>：只收正面、侧面、背面三张全身照，不收面部特写或其他照片。
          </li>
          <li>
            <strong>谁处理</strong>：
            {offer
              ? `默认只在本站处理，生成的是通用示意人台；只有你单独勾选第二项，三张全身照才会发送给 ${offer.name}（第三方服务，位于境外）生成本人形象。`
              : "本站服务器。照片只保存在本站私有存储，不发送给任何第三方 AI 服务；生成结果是通用示意人台，不是你本人。"}
          </li>
          <li>
            <strong>保存期</strong>：原始照片在 3D 形象生成成功 {state.retentionDays} 天后删除，日期显示在照片下方。由每天的清理任务执行（需运营方配置定时任务）；未配置时，在你下次打开本页时删除。3D 形象保留到你删除为止。
          </li>
          <li>
            <strong>可删除</strong>：可随时删除单个形象，或一键删除全部照片与形象，本站存储里的文件同时清除
            {offer ? `；用过 ${offer.name} 时，会同时请求它删除该次任务的数据，并在这里显示请求是否发送成功。` : "。"}
          </li>
          <li>
            <strong>不用于训练</strong>：本站不会把你的照片或形象用于训练任何模型
            {offer ? "；调用第三方时已请求对方不保存本次输入输出，完成后再请求删除，对方是否仍留有无法删除的副本尚未核实。" : "。"}
          </li>
          <li>
            <strong>隐私</strong>：照片仅你本人可见；上传前在你的设备上压缩，服务器再剥离一次拍摄位置（GPS）等附加信息后才保存。
          </li>
        </ul>

        {showConsentForm ? (
          <>
            {state.consent && !state.consent.current ? <p className="error">说明已更新，请重新阅读并确认。</p> : null}
            {noteAt("consent") ? <p className="error">{noteAt("consent")!.text}</p> : null}
            {!consented ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeStore} onChange={(e) => setAgreeStore(e.target.checked)} />
                <span>
                  我同意本站上传并存储我的照片，用于生成 3D 形象（必选）
                  <small>只存本站私有存储，按上方期限删除</small>
                </span>
              </label>
            ) : null}
            {offer ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeThird} onChange={(e) => setAgreeThird(e.target.checked)} />
                <span>
                  我同意把三张全身照发送给 {offer.name} 处理（可选）
                  <small>不勾选也能继续，但只能生成非本人的示意模型</small>
                </span>
              </label>
            ) : null}
            <div className={s.actions}>
              <button
                type="button"
                className="sc-cta"
                disabled={(!consented && !agreeStore) || busy === "consent"}
                onClick={giveConsent}
              >
                {busy === "consent" ? "记录中…" : consented ? "保存授权" : "同意并开始上传"}
              </button>
              {editing ? (
                <button
                  type="button"
                  className={s.small}
                  onClick={() => {
                    setEditing(false);
                    setAgreeThird(!!state.consent?.thirdParty);
                  }}
                >
                  取消
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className={s.granted}>
            <span className={s.pill} data-on>
              ✓ 存储照片
            </span>
            {offer ? (
              <span className={s.pill} data-on={state.consent?.thirdParty ? true : undefined}>
                {state.consent?.thirdParty ? "✓" : "—"} 发送给 {offer.name}
              </span>
            ) : null}
            <span className={s.hint}>{new Date(state.consent!.at).toLocaleString("zh-CN")}</span>
            {offer ? (
              <button type="button" className={s.small} onClick={() => setEditing(true)}>
                修改授权
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* 照片 */}
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">上传全身照</h2>
        <p className="serif-note">
          穿贴身或常穿的衣服，站直、手臂略微张开，背景简洁、光线均匀。
          {sideRequired ? "需要正面和侧面，背面可选。" : "需要正面，以及侧面或背面中的一张。"}
        </p>
        <div className={s.grid}>
          {SLOT_META.map((m) => {
            const p = photosBySlot(m.slot)[0];
            return (
              <PhotoTile
                key={m.slot}
                label={m.label}
                tip={m.tip}
                photo={p}
                disabled={!consented}
                busy={busy === m.slot || (!!p && busy === p.id)}
                required={
                  m.slot === "front" || (m.slot === "side" && sideRequired) ? "必填" : m.slot === "back" && sideRequired ? "可选" : "二选一"
                }
                error={noteAt(m.slot)?.text}
                onPick={(f) => upload(m.slot, f)}
                onDelete={p ? () => removePhoto(p.id, m.slot) : undefined}
              />
            );
          })}
        </div>
        {legacy.length ? (
          <div className="stack" style={{ gap: 8 }}>
            <span className="sc-meta">以前上传的其他照片：不参与生成，建议删除</span>
            <div className={s.grid}>
              {legacy.map((p) => (
                <PhotoTile
                  key={p.id}
                  label={LEGACY_LABEL[p.slot] ?? "照片"}
                  tip=""
                  photo={p}
                  disabled
                  required="可选"
                  busy={busy === p.id}
                  error={noteAt(p.id)?.text}
                  onDelete={() => removePhoto(p.id, p.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* 生成与结果 */}
      <section className="sc-glass card stack sc-rise">
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <h2 className="section-title">生成</h2>
          {job ? <span className="sc-meta">{job.resultDeleted ? "形象已删除" : (STATUS_TEXT[job.status] ?? job.status)}</span> : null}
        </div>
        {/* 有结果时徽章由查看器常驻显示，这里不重复 */}
        {job?.status === "succeeded" && job.glbUrl ? null : <Badges items={job && !active ? job.badges : modeBadges} />}
        {mock ? (
          <p className="sc-meta">
            {offer && consented
              ? `当前为示意模式：未同意发送给 ${offer.name}，生成结果是通用人台，不是你本人。`
              : "当前为示意模式：生成结果是通用人台，不是根据你的照片生成的本人形象。"}
          </p>
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
            <div className={s.actions}>
              <button type="button" className={s.small} style={{ marginRight: 0, paddingLeft: 0 }} onClick={deleteAvatar} disabled={busy === "result"}>
                {busy === "result" ? "删除中…" : "删除这个形象（保留照片）"}
              </button>
            </div>
          </div>
        ) : null}
        {job?.resultDeleted ? <p className="sc-meta">这个形象已删除，照片仍保留，可以重新生成。</p> : null}
        {remote ? (
          <p className={s.status} data-tone={remote.bad ? "bad" : undefined}>
            {remote.text}
          </p>
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
        {!active && job?.status === "succeeded" && job.glbUrl ? (
          <p className={s.hint}>重新生成成功后，旧的形象文件会被删除。</p>
        ) : null}
        {!active && !state.canGenerate ? (
          <p className="sc-meta">
            {!consented ? "先在上方勾选同意。" : sideRequired ? "先上传正面和侧面全身照。" : "先上传正面，以及侧面或背面全身照。"}
          </p>
        ) : null}
        {noteAt("job") ? <p className={noteAt("job")!.ok ? "sc-meta" : "error"}>{noteAt("job")!.text}</p> : null}
      </section>

      {/* 删除 */}
      {/* 删除成功后 hasAny 变为 false，仍保留这张卡显示结果 */}
      {hasAny || noteAt("delete") ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">删除</h2>
          {hasAny ? (
            <>
              <p className="sc-meta">
                删除全部照片与生成的 3D 形象，本站存储文件一并清除
                {offer ? `，并请求 ${offer.name} 删除相关任务数据` : ""}；之后再上传需要重新同意。
              </p>
              <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={deleteEverything} disabled={busy === "delete"}>
                {busy === "delete" ? "删除中…" : "一键删除全部照片与形象"}
              </button>
            </>
          ) : null}
          {noteAt("delete") ? <p className={noteAt("delete")!.ok ? "sc-meta" : "error"}>{noteAt("delete")!.text}</p> : null}
        </section>
      ) : null}

      {/* 读屏播报：视觉上隐藏，提示文字已就近显示在对应卡片里 */}
      <p role="status" aria-live="polite" className="sr-only">
        {msg?.text ?? ""}
      </p>
    </div>
  );
}
