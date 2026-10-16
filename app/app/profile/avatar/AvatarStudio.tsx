"use client";

import { useCallback, useEffect, useState } from "react";
import AvatarViewer from "@/components/AvatarViewer";
import MetaPersonStudio from "./MetaPersonStudio";
import TwinStudio from "./TwinStudio";
import PhotoTile from "./PhotoTile";
import { compressImage } from "./image-client";
import { MP_PRIVACY_URL } from "@/lib/avatar/metaperson-protocol";
import type { AvatarState, JobView, RemoteSummary, Slot } from "@/lib/avatar/service";
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

async function readError(res: Response | null, fallback: string) {
  if (!res) return "网络异常，请稍后再试";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}


function remoteText(state: JobView["remotePurge"], name: string): { text: string; bad: boolean } | null {
  if (state === "failed") return { text: `第三方副本删除请求失败（${name}），已记录，清理任务会重试`, bad: true };
  return null;
}

function summaryText(r: RemoteSummary): string {
  const parts: string[] = [];
  if (r.failed) parts.push(`${r.failed} 个删除请求失败，已记录，清理任务会重试`);
  return parts.length ? `；${parts.join("，")}` : "";
}

/**
 * 删除后把这份 GLB 从查看器的加载缓存里移除：已删除的本人形象不再留在内存里，
 * 之后任何组件也不会拿这个地址再取一次（文件已删，只会得到 404）。查看器的代码块此时已加载，动态引入不增加首屏体积。
 * 必须在查看器卸载之后调用（见 forgotten 的 effect）：还挂着的查看器若在清缓存后重渲染，会重新请求这份已删除的文件。
 */
function forgetModel(url: string | null | undefined) {
  if (!url) return;
  void import("@/components/avatar-viewer/Viewer").then((m) => m.clearModelCache(url)).catch(() => undefined);
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

export default function AvatarStudio({ initial }: { initial: AvatarState }) {
  const [state, setState] = useState<AvatarState>(initial);
  const offer = state.offer.thirdParty;
  const [agreeStore, setAgreeStore] = useState(false);
  const [agreeThird, setAgreeThird] = useState(!!initial.consent?.thirdParty);
  // D56：由 Anthropic（Claude）分析全身照，单独一项、可不勾；只在 MetaPerson 模式且服务端配置了 key 时出现。
  // 数字分身模式（D63）同样提供这一项：分析体型、发型与脸部特征，让形象照更像本人。
  const bodyOffer = state.mode === "metaperson" || state.mode === "twin" ? state.offer.bodyAnalysis : null;
  const [agreeBody, setAgreeBody] = useState(!!initial.consent?.bodyAnalysis);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // 提示就近显示：at 为照片格（slot 或照片 id）、consent、job、delete；就近的提示自己就是播报区（常驻的 role=status 容器或 role=alert）。
  // at 为 "sr" 的提示没有就近位置（例如保存成功后整张卡换成查看器），只写进底部视觉隐藏的播报区。同一句话只出现一次。
  const [msg, setMsg] = useState<{ at: string; ok: boolean; text: string } | null>(null);
  const noteAt = (at: string) => (msg && msg.at === at ? msg : null);
  const job = state.job;
  const consented = !!state.consent?.current;
  // MetaPerson 模式：照片在本站上传，正脸照交给嵌入的创建器生成（D56）；必须单独同意由 MetaPerson 处理才能上传、打开创建器。
  const mp = state.mode === "metaperson";
  const mpReady = mp && consented && state.consent?.thirdParty === "metaperson";
  // 数字分身模式（D63）：须单独同意由 fal.ai 上的 AI 图像模型生成形象才能上传与生成。
  const tw = state.mode === "twin";
  const twReady = tw && consented && state.consent?.thirdParty === "twin";
  // MetaPerson 与数字分身都必须勾选第三方处理才能开始。
  const needThird = mp || tw;
  const [regenerating, setRegenerating] = useState(false);
  const showConsentForm = !consented || editing || (mp && !mpReady) || (tw && !twReady);
  const mock = state.provider.isMock;
  // 真实服务按位置区分视角（front/left/back），侧面必填；示意模式正面 + 侧面或背面任一即可。
  const sideRequired = !mock;
  const modeBadges = mock ? ["演示模型"] : [];
  const active = job?.status === "queued" || job?.status === "processing";
  const remoteName = offer?.name ?? "fal.ai（Tripo 3D）";

  // 刚删除的 GLB 地址：随删除结果同一批提交，查看器卸载后（effect 阶段）再清缓存。
  const [forgotten, setForgotten] = useState<string | null>(null);
  useEffect(() => forgetModel(forgotten), [forgotten]);

  const setJob = useCallback((j: JobView) => setState((st) => ({ ...st, job: j })), []);

  // 生成中每 2 秒查询一次进度；查询本身会推进任务状态。
  const jobId = job?.id;
  // 数字分身没有排队任务（同步生成），由 TwinStudio 自己处理“生成中”的恢复。
  const twinJob = job?.provider === "twin";
  useEffect(() => {
    if (!jobId || !active || twinJob) return;
    let stop = false;
    const t = setInterval(async () => {
      const res = await fetch(`/api/avatar/jobs/${jobId}`, { cache: "no-store" }).catch(() => null);
      if (stop || !res || !res.ok) return;
      const next = (await res.json()) as JobView;
      if (next.status === "succeeded") {
        // 成功时服务端给本次用到的照片写了删除日期：重新拉一次整体状态，照片下方立刻显示“X月X日自动删除”
        const full = await fetch("/api/avatar", { cache: "no-store" }).catch(() => null);
        if (!stop && full && full.ok) {
          setState((await full.json()) as AvatarState);
          return;
        }
      }
      if (!stop) setJob(next);
    }, 2000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [jobId, active, twinJob, setJob]);

  async function giveConsent() {
    setBusy("consent");
    setMsg(null);
    const res = await fetch("/api/avatar/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store: true,
        thirdParty: !!offer && agreeThird,
        bodyAnalysis: !!bodyOffer && !!offer && agreeThird && agreeBody,
        offerVersion: state.offer.version,
      }),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "consent", ok: false, text: await readError(res, "记录同意失败") });
    const next = (await res.json()) as AvatarState;
    setState(next);
    setEditing(false);
    setAgreeThird(!!next.consent?.thirdParty);
    setAgreeBody(!!next.consent?.bodyAnalysis);
  }

  async function upload(slot: Slot, file: File) {
    setBusy(slot);
    setMsg(null);
    let blob: Blob;
    try {
      // 本机压缩到最长边 1600px 并重新编码为 JPEG：顺带去掉 EXIF（拍摄位置等）信息。服务端还会再剥离一次。
      blob = await compressImage(file, 1600);
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
    if (!confirm(mp ? "删除这个 3D 形象吗？之后可以重新生成。" : "删除这个 3D 形象吗？照片会保留，之后可以重新生成。")) return;
    setBusy("result");
    setMsg(null);
    const res = await fetch(`/api/avatar/jobs/${job.id}/result`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, "删除失败") });
    const body = (await res.json()) as { job: JobView };
    setForgotten(job.glbUrl);
    setJob(body.job);
    // 卡片里已有“这个形象已删除…”的状态说明，这里只给读屏播报，不再就近重复显示
    setMsg({ at: "sr", ok: true, text: mp ? "已删除这个 3D 形象" : "已删除这个 3D 形象，照片仍保留" });
  }

  async function deleteEverything() {
    if (!confirm(`确定删除全部照片与${tw ? "" : " 3D "}形象吗？存储里的文件会一并删除，无法恢复。`)) return;
    setBusy("delete");
    setMsg(null);
    const res = await fetch("/api/avatar", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "delete", ok: false, text: await readError(res, "删除失败") });
    const body = (await res.json()) as AvatarState & { remotePurge: RemoteSummary };
    setForgotten(job?.glbUrl ?? null);
    setState(body);
    setAgreeStore(false);
    setAgreeThird(false);
    setAgreeBody(false);
    setMsg({ at: "delete", ok: body.remotePurge.failed === 0, text: `已删除全部照片与${tw ? "" : " 3D "}形象${summaryText(body.remotePurge)}` });
  }

  const photosBySlot = (slot: Slot) => state.photos.filter((p) => p.slot === slot);
  const legacy = state.photos.filter((p) => p.slot === "face" || p.slot === "extra");
  const hasAny = state.photos.length > 0 || (job && job.status !== "canceled") || !!state.twin;
  const remote = job ? remoteText(job.remotePurge, remoteName) : null;

  return (
    <div className="stack">
      {/* 同意卡 */}
      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">开始之前</h2>
          {consented && !editing ? <span className="sc-badge">已同意</span> : null}
        </div>
        <p className="serif-note">
          {tw
            ? `照片仅用于生成你的形象，私密保存、仅你可见；原图 ${state.retentionDays} 天后自动删除，可随时一键删除。`
            : "照片仅用于生成你的 3D 形象，私密保存、仅你可见，可随时删除。"}
        </p>

        {showConsentForm ? (
          <>
            {state.consent && !state.consent.current ? <p className="error">说明已更新，请重新阅读并确认。</p> : null}
            {noteAt("consent") ? (
              <p className="error" role="alert">
                {noteAt("consent")!.text}
              </p>
            ) : null}
            {!consented ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeStore} onChange={(e) => setAgreeStore(e.target.checked)} />
                <span>
                  {tw
                    ? "保存我的照片与形象，仅自己可见"
                    : mp
                      ? "我同意保存我的照片与 3D 形象，仅自己可见"
                      : "我同意上传照片，用于生成我的 3D 形象"}
                </span>
              </label>
            ) : null}
            {offer ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeThird} onChange={(e) => setAgreeThird(e.target.checked)} />
                <span>
                  {tw
                    ? "由 fal.ai 上的 AI 图像模型根据我的照片生成我的形象"
                    : mp
                      ? `由 ${offer.name} 根据你的自拍生成本人形象`
                      : `由 ${offer.name} 根据照片生成更真实的本人形象`}
                  {mp ? (
                    <>
                      {" · "}
                      {/* 手机版创建器上传前会要求接受 Avatar SDK 的隐私政策，这里先给出同一份文件 */}
                      <a className={s.policy} href={MP_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                        隐私政策
                      </a>
                    </>
                  ) : null}
                </span>
              </label>
            ) : null}
            {offer && bodyOffer ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeBody} onChange={(e) => setAgreeBody(e.target.checked)} />
                <span>
                  {tw
                    ? "由 Anthropic（Claude）分析我的照片，理解身材、发型与脸部特征"
                    : "由 Anthropic（Claude）分析我的全身照，参考我的照片调整 3D 形象的体型"}
                </span>
              </label>
            ) : null}
            <div className={s.actions}>
              <button
                type="button"
                className="sc-cta"
                disabled={(!consented && !agreeStore) || (needThird && !agreeThird) || busy === "consent"}
                onClick={giveConsent}
              >
                {busy === "consent" ? "记录中…" : consented ? "保存授权" : needThird ? "同意并开始" : "同意并开始上传"}
              </button>
              {editing ? (
                <button
                  type="button"
                  className={s.small}
                  onClick={() => {
                    setEditing(false);
                    setAgreeThird(!!state.consent?.thirdParty);
                    setAgreeBody(!!state.consent?.bodyAnalysis);
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
              ✓ {needThird ? "保存照片与形象" : "存储照片"}
            </span>
            {offer ? (
              <span className={s.pill} data-on={state.consent?.thirdParty ? true : undefined}>
                {state.consent?.thirdParty ? "✓" : "—"} {tw ? `${offer.name} 生成形象` : `发送给 ${offer.name}`}
              </span>
            ) : null}
            {offer && bodyOffer ? (
              <span className={s.pill} data-on={state.consent?.bodyAnalysis ? true : undefined}>
                {state.consent?.bodyAnalysis ? "✓" : "—"} {bodyOffer.name} {tw ? "照片分析" : "体型分析"}
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

      {/* 数字分身（D63）：上传照片 → 生成标准形象照 → 画廊。不加载 MetaPerson 创建器。 */}
      {twReady ? (
        <TwinStudio
          state={state}
          busy={busy}
          errorAt={(at) => noteAt(at)?.text}
          onUpload={upload}
          onRemove={removePhoto}
          onState={setState}
          onNote={(text) => setMsg({ at: "sr", ok: true, text })}
        />
      ) : tw ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">生成你的形象</h2>
          <p className="sc-meta">先在上方勾选同意。</p>
        </section>
      ) : null}

      {/* MetaPerson：上传照片（创建器在后台预加载）→ 生成 → 保存 → 查看器 */}
      {mp && job?.status === "succeeded" && job.glbUrl && !regenerating ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">你的形象</h2>
          <div className="stack" style={{ gap: 12 }}>
            <AvatarViewer src={job.glbUrl} badges={job.badges} height={520} label="我的 3D 形象，可拖动 360° 旋转" />
            {state.bodyAnalysis?.summary ? <p className="sc-meta">参考你的照片：{state.bodyAnalysis.summary}</p> : null}
            <div className={s.actions}>
              <button
                type="button"
                className="sc-cta sc-cta--ghost"
                onClick={() => {
                  setMsg(null); // 上一次的“已保存 / 已删除”不再适用
                  setRegenerating(true);
                }}
                disabled={!mpReady}
              >
                重新生成
              </button>
              <button type="button" className={s.small} onClick={deleteAvatar} disabled={busy === "result"}>
                {busy === "result" ? "删除中…" : "删除这个形象"}
              </button>
            </div>
            <div role="status" aria-live="polite">
              {noteAt("job") ? <p className={noteAt("job")!.ok ? "sc-meta" : "error"}>{noteAt("job")!.text}</p> : null}
            </div>
          </div>
        </section>
      ) : mpReady ? (
        <MetaPersonStudio
          state={state}
          busy={busy}
          errorAt={(at) => noteAt(at)?.text}
          onUpload={upload}
          onRemove={removePhoto}
          onImported={(next) => {
            setState(next);
            setRegenerating(false);
            setMsg({ at: "sr", ok: true, text: "已保存你的 3D 形象" });
          }}
          footer={
            <>
              {regenerating && job?.status === "succeeded" && job.glbUrl ? (
                <button
                  type="button"
                  className={s.small}
                  style={{ justifySelf: "start" }}
                  onClick={() => {
                    setMsg(null);
                    setRegenerating(false);
                  }}
                >
                  返回当前形象
                </button>
              ) : null}
              {job?.resultDeleted ? <p className="sc-meta">之前的形象已删除，可以重新生成。</p> : null}
            </>
          }
        />
      ) : mp ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">生成你的 3D 形象</h2>
          <p className="sc-meta">先在上方勾选同意。</p>
        </section>
      ) : null}

      {/* 照片 */}
      {state.mode === "photos" ? (
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
      ) : null}

      {/* 生成与结果 */}
      {state.mode === "photos" ? (
      <section className="sc-glass card stack sc-rise">
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <h2 className="section-title">生成</h2>
          {job ? <span className="sc-meta">{job.resultDeleted ? "形象已删除" : (STATUS_TEXT[job.status] ?? job.status)}</span> : null}
        </div>
        {/* 有结果时徽章由查看器常驻显示，这里不重复 */}
        {job?.status === "succeeded" && job.glbUrl ? null : <Badges items={job && !active ? job.badges : modeBadges} />}

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
            <div className={s.actions}>
              <button type="button" className={s.small} style={{ marginRight: 0, paddingLeft: 0 }} onClick={deleteAvatar} disabled={busy === "result"}>
                {busy === "result" ? "删除中…" : "删除这个形象（保留照片）"}
              </button>
            </div>
          </div>
        ) : null}
        {/* 一键删除后照片也没了，那时结果写在删除卡里，这里不再重复 */}
        {job?.resultDeleted && state.photos.length > 0 ? (
          <p className="sc-meta">这个形象已删除，照片仍保留，可以重新生成。</p>
        ) : null}
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
        <div role="status" aria-live="polite">
          {noteAt("job") ? <p className={noteAt("job")!.ok ? "sc-meta" : "error"}>{noteAt("job")!.text}</p> : null}
        </div>
      </section>
      ) : null}

      {/* 删除 */}
      {/* 删除成功后 hasAny 变为 false，仍保留这张卡显示结果 */}
      {hasAny || noteAt("delete") ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">删除</h2>
          {hasAny ? (
            <>
              <p className="sc-meta">
                {tw ? "删除全部照片与形象照。" : "删除全部照片与 3D 形象。"}
              </p>
              <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={deleteEverything} disabled={busy === "delete"}>
                {busy === "delete" ? "删除中…" : "一键删除全部照片与形象"}
              </button>
            </>
          ) : null}
          <div role="status" aria-live="polite">
            {noteAt("delete") ? <p className={noteAt("delete")!.ok ? "sc-meta" : "error"}>{noteAt("delete")!.text}</p> : null}
          </div>
        </section>
      ) : null}

      {/* 读屏播报：只播没有就近位置的提示（at = "sr"），其余提示由就近的播报区负责，避免同一句出现两次 */}
      <p role="status" aria-live="polite" className="sr-only">
        {msg?.at === "sr" ? msg.text : ""}
      </p>
    </div>
  );
}
