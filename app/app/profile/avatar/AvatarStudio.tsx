"use client";

import { useCallback, useEffect, useState } from "react";
import AvatarViewer from "@/components/AvatarViewer";
import MetaPersonStudio from "./MetaPersonStudio";
import TwinStudio from "./TwinStudio";
import PhotoTile from "./PhotoTile";
import { compressImage } from "./image-client";
import { MP_PRIVACY_URL } from "@/lib/avatar/metaperson-protocol";
import type { AvatarState, JobView, RemoteSummary, Slot } from "@/lib/avatar/service";
import { useLocale, useT } from "@/lib/i18n/client";
import { LOCALE_META } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/types";
import s from "./AvatarStudio.module.css";

// 只收生成会用到的三张全身照；面部特写与补充照片不参与生成，已不再收集。
// 标签与拍摄提示见字典 avatar.photos.slots.<slot>。
const SLOT_META: Extract<Slot, "front" | "side" | "back">[] = ["front", "side", "back"];

const STATUS_KEYS = ["queued", "processing", "succeeded", "failed", "canceled"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];
const isStatusKey = (v: string): v is StatusKey => (STATUS_KEYS as readonly string[]).includes(v);

async function readError(res: Response | null, fallback: string, offline: string) {
  if (!res) return offline;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}


function remoteText(t: Translator<"avatar">, state: JobView["remotePurge"], name: string): { text: string; bad: boolean } | null {
  if (state === "failed") return { text: t("generate.remoteFailed", { name }), bad: true };
  return null;
}

/** 一键删除的结果：有第三方删除请求失败时附上失败个数。 */
function deletedAllText(t: Translator<"avatar">, twin: boolean, r: RemoteSummary): string {
  if (r.failed) return t(twin ? "remove.doneAllTwinPartial" : "remove.doneAll3dPartial", { n: r.failed });
  return t(twin ? "remove.doneAllTwin" : "remove.doneAll3d");
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
  const tr = useT("avatar");
  const tc = useT("common");
  const intl = LOCALE_META[useLocale()].intl;
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
  const modeBadges = mock ? [tr("generate.demoBadge")] : [];
  const active = job?.status === "queued" || job?.status === "processing";
  const remoteName = offer?.name ?? tr("generate.tripoName");

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
    if (!res || !res.ok) return setMsg({ at: "consent", ok: false, text: await readError(res, tr("errors.consent"), tc("networkError")) });
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
      return setMsg({ at: slot, ok: false, text: tr("errors.badImage") });
    }
    const fd = new FormData();
    fd.set("slot", slot);
    fd.set("file", blob, `${slot}.jpg`);
    const res = await fetch("/api/avatar/photos", { method: "POST", body: fd }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: slot, ok: false, text: await readError(res, tr("errors.upload"), tc("networkError")) });
    setState((await res.json()) as AvatarState);
  }

  // at：错误显示的位置。主视角按 slot（删除后格子仍在），其他照片按照片 id。
  async function removePhoto(id: string, at: string) {
    setBusy(id);
    setMsg(null);
    const res = await fetch(`/api/avatar/photos/${id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at, ok: false, text: await readError(res, tr("errors.delete"), tc("networkError")) });
    setState((await res.json()) as AvatarState);
  }

  async function generate() {
    setBusy("job");
    setMsg(null);
    const res = await fetch("/api/avatar/jobs", { method: "POST" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, tr("errors.createJob"), tc("networkError")) });
    setJob((await res.json()) as JobView);
  }

  async function cancel() {
    if (!job) return;
    setBusy("cancel");
    setMsg(null);
    const res = await fetch(`/api/avatar/jobs/${job.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, tr("errors.cancel"), tc("networkError")) });
    setJob((await res.json()) as JobView);
  }

  async function deleteAvatar() {
    if (!job) return;
    if (!confirm(mp ? tr("remove.confirmMetaperson") : tr("remove.confirmPhotos"))) return;
    setBusy("result");
    setMsg(null);
    const res = await fetch(`/api/avatar/jobs/${job.id}/result`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "job", ok: false, text: await readError(res, tr("errors.delete"), tc("networkError")) });
    const body = (await res.json()) as { job: JobView };
    setForgotten(job.glbUrl);
    setJob(body.job);
    // 卡片里已有“这个形象已删除…”的状态说明，这里只给读屏播报，不再就近重复显示
    setMsg({ at: "sr", ok: true, text: mp ? tr("remove.doneMetaperson") : tr("remove.donePhotos") });
  }

  async function deleteEverything() {
    if (!confirm(tw ? tr("remove.confirmAllTwin") : tr("remove.confirmAll3d"))) return;
    setBusy("delete");
    setMsg(null);
    const res = await fetch("/api/avatar", { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setMsg({ at: "delete", ok: false, text: await readError(res, tr("errors.delete"), tc("networkError")) });
    const body = (await res.json()) as AvatarState & { remotePurge: RemoteSummary };
    setForgotten(job?.glbUrl ?? null);
    setState(body);
    setAgreeStore(false);
    setAgreeThird(false);
    setAgreeBody(false);
    setMsg({ at: "delete", ok: body.remotePurge.failed === 0, text: deletedAllText(tr, tw, body.remotePurge) });
  }

  const photosBySlot = (slot: Slot) => state.photos.filter((p) => p.slot === slot);
  const legacy = state.photos.filter((p) => p.slot === "face" || p.slot === "extra");
  const hasAny = state.photos.length > 0 || (job && job.status !== "canceled") || !!state.twin;
  const remote = job ? remoteText(tr, job.remotePurge, remoteName) : null;

  return (
    <div className="stack">
      {/* 同意卡 */}
      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">{tr("consent.title")}</h2>
          {consented && !editing ? <span className="sc-badge">{tr("consent.agreed")}</span> : null}
        </div>
        <p className="note-text">
          {tw ? tr("consent.introTwin", { days: state.retentionDays }) : tr("consent.intro3d")}
        </p>

        {showConsentForm ? (
          <>
            {state.consent && !state.consent.current ? <p className="error">{tr("consent.updated")}</p> : null}
            {noteAt("consent") ? (
              <p className="error" role="alert">
                {noteAt("consent")!.text}
              </p>
            ) : null}
            {!consented ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeStore} onChange={(e) => setAgreeStore(e.target.checked)} />
                <span>
                  {tw ? tr("consent.storeTwin") : mp ? tr("consent.storeMetaperson") : tr("consent.storePhotos")}
                </span>
              </label>
            ) : null}
            {offer ? (
              <label className={s.option}>
                <input type="checkbox" checked={agreeThird} onChange={(e) => setAgreeThird(e.target.checked)} />
                <span>
                  {tw
                    ? tr("consent.thirdTwin")
                    : mp
                      ? tr("consent.thirdMetaperson", { name: offer.name })
                      : tr("consent.thirdPhotos", { name: offer.name })}
                  {mp ? (
                    <>
                      {" · "}
                      {/* 手机版创建器上传前会要求接受 Avatar SDK 的隐私政策，这里先给出同一份文件 */}
                      <a className={s.policy} href={MP_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                        {tr("consent.privacyPolicy")}
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
                  {tw ? tr("consent.bodyTwin") : tr("consent.bodyMetaperson")}
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
                {busy === "consent"
                  ? tr("consent.recording")
                  : consented
                    ? tr("consent.save")
                    : needThird
                      ? tr("consent.agreeAndStart")
                      : tr("consent.agreeAndUpload")}
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
                  {tc("cancel")}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className={s.granted}>
            <span className={s.pill} data-on>
              ✓ {needThird ? tr(tw ? "consent.grantedStoreTwin" : "consent.grantedStore3d") : tr("consent.grantedStorePhotos")}
            </span>
            {offer ? (
              <span className={s.pill} data-on={state.consent?.thirdParty ? true : undefined}>
                {state.consent?.thirdParty ? "✓" : "—"}{" "}
                {tw ? tr("consent.grantedThirdTwin", { name: offer.name }) : tr("consent.grantedThirdSend", { name: offer.name })}
              </span>
            ) : null}
            {offer && bodyOffer ? (
              <span className={s.pill} data-on={state.consent?.bodyAnalysis ? true : undefined}>
                {state.consent?.bodyAnalysis ? "✓" : "—"}{" "}
                {tw
                  ? tr("consent.grantedPhotoAnalysis", { name: bodyOffer.name })
                  : tr("consent.grantedBodyAnalysis", { name: bodyOffer.name })}
              </span>
            ) : null}
            <span className={s.hint}>{new Date(state.consent!.at).toLocaleString(intl)}</span>
            {offer ? (
              <button type="button" className={s.small} onClick={() => setEditing(true)}>
                {tr("consent.edit")}
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
          <h2 className="section-title">{tr("twin.title")}</h2>
          <p className="sc-meta">{tr("consent.checkFirst")}</p>
        </section>
      ) : null}

      {/* MetaPerson：上传照片（创建器在后台预加载）→ 生成 → 保存 → 查看器 */}
      {mp && job?.status === "succeeded" && job.glbUrl && !regenerating ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">{tr("metaperson.resultTitle")}</h2>
          <div className="stack" style={{ gap: 12 }}>
            <AvatarViewer src={job.glbUrl} badges={job.badges} height={520} label={tr("metaperson.viewerLabel")} />
            {state.bodyAnalysis?.summary ? (
              <p className="sc-meta">{tr("metaperson.basedOn", { summary: state.bodyAnalysis.summary })}</p>
            ) : null}
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
                {tr("metaperson.regenerate")}
              </button>
              <button type="button" className={s.small} onClick={deleteAvatar} disabled={busy === "result"}>
                {busy === "result" ? tr("metaperson.deleting") : tr("metaperson.delete")}
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
            setMsg({ at: "sr", ok: true, text: tr("metaperson.saved") });
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
                  {tr("metaperson.backToCurrent")}
                </button>
              ) : null}
              {job?.resultDeleted ? <p className="sc-meta">{tr("metaperson.previousDeleted")}</p> : null}
            </>
          }
        />
      ) : mp ? (
        <section className="sc-glass card stack sc-rise">
          <h2 className="section-title">{tr("metaperson.title")}</h2>
          <p className="sc-meta">{tr("consent.checkFirst")}</p>
        </section>
      ) : null}

      {/* 照片 */}
      {state.mode === "photos" ? (
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">{tr("photos.title")}</h2>
        <p className="note-text">{sideRequired ? tr("photos.noteSideRequired") : tr("photos.noteEither")}</p>
        <div className={s.grid}>
          {SLOT_META.map((slot) => {
            const p = photosBySlot(slot)[0];
            return (
              <PhotoTile
                key={slot}
                label={tr(`photos.slots.${slot}.label`)}
                tip={tr(`photos.slots.${slot}.tip`)}
                photo={p}
                disabled={!consented}
                busy={busy === slot || (!!p && busy === p.id)}
                required={
                  slot === "front" || (slot === "side" && sideRequired) ? "required" : slot === "back" && sideRequired ? "optional" : "either"
                }
                error={noteAt(slot)?.text}
                onPick={(f) => upload(slot, f)}
                onDelete={p ? () => removePhoto(p.id, slot) : undefined}
              />
            );
          })}
        </div>
        {legacy.length ? (
          <div className="stack" style={{ gap: 8 }}>
            <span className="sc-meta">{tr("photos.legacyNote")}</span>
            <div className={s.grid}>
              {legacy.map((p) => (
                <PhotoTile
                  key={p.id}
                  label={p.slot === "face" || p.slot === "extra" ? tr(`photos.legacy.${p.slot}`) : tr("photos.legacy.other")}
                  tip=""
                  photo={p}
                  disabled
                  required="optional"
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
          <h2 className="section-title">{tr("generate.title")}</h2>
          {job ? (
            <span className="sc-meta">
              {job.resultDeleted
                ? tr("generate.resultDeleted")
                : isStatusKey(job.status)
                  ? tr(`generate.status.${job.status}`)
                  : job.status}
            </span>
          ) : null}
        </div>
        {/* 有结果时徽章由查看器常驻显示，这里不重复 */}
        {job?.status === "succeeded" && job.glbUrl ? null : <Badges items={job && !active ? job.badges : modeBadges} />}

        {active ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="wait-bar" aria-hidden="true">
              <i />
            </div>
            <p role="status" aria-live="polite" className="note-text">
              {job!.status === "queued" ? tr("generate.queuedNote") : tr("generate.progress", { s: job!.elapsedSeconds })}
            </p>
            <button type="button" className="sc-cta sc-cta--ghost" onClick={cancel} disabled={busy === "cancel"}>
              {tr("generate.cancel")}
            </button>
          </div>
        ) : null}

        {job?.status === "failed" ? (
          <p className="error" role="alert">
            {tr("generate.failedRetry", { reason: job.error?.message ?? tr("generate.failedDefault") })}
          </p>
        ) : null}

        {job?.status === "succeeded" && job.glbUrl ? (
          <div className="stack" style={{ gap: 8 }}>
            <AvatarViewer src={job.glbUrl} badges={job.badges} />
            <div className={s.actions}>
              <button type="button" className={s.small} style={{ marginRight: 0, paddingLeft: 0 }} onClick={deleteAvatar} disabled={busy === "result"}>
                {busy === "result" ? tr("remove.deleting") : tr("generate.deleteKeepPhotos")}
              </button>
            </div>
          </div>
        ) : null}
        {/* 一键删除后照片也没了，那时结果写在删除卡里，这里不再重复 */}
        {job?.resultDeleted && state.photos.length > 0 ? (
          <p className="sc-meta">{tr("generate.deletedKeepPhotos")}</p>
        ) : null}
        {remote ? (
          <p className={s.status} data-tone={remote.bad ? "bad" : undefined}>
            {remote.text}
          </p>
        ) : null}

        {!active ? (
          <button type="button" className="sc-cta" disabled={!state.canGenerate || busy === "job"} onClick={generate}>
            {busy === "job"
              ? tr("generate.submitting")
              : job?.status === "failed"
                ? tr("generate.retry")
                : job?.status === "succeeded" || job?.status === "canceled"
                  ? tr("generate.regenerate")
                  : tr("generate.start")}
          </button>
        ) : null}
        {!active && job?.status === "succeeded" && job.glbUrl ? (
          <p className={s.hint}>{tr("generate.replaceNote")}</p>
        ) : null}
        {!active && !state.canGenerate ? (
          <p className="sc-meta">
            {!consented ? tr("consent.checkFirst") : sideRequired ? tr("generate.needSide") : tr("generate.needEither")}
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
          <h2 className="section-title">{tr("remove.title")}</h2>
          {hasAny ? (
            <>
              <p className="sc-meta">
                {tw ? tr("remove.descTwin") : tr("remove.desc3d")}
              </p>
              <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={deleteEverything} disabled={busy === "delete"}>
                {busy === "delete" ? tr("remove.deleting") : tr("remove.all")}
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
