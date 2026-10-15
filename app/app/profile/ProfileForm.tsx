"use client";

import Link from "next/link";
import { useState } from "react";
import type { Profile } from "@/lib/profile";

const STYLE_PRESETS = ["通勤", "极简", "法式", "复古", "街头", "运动", "甜美", "中性", "度假", "约会"];
const COLOR_PRESETS = ["黑", "白", "灰", "米", "驼", "藏青", "酒红", "墨绿", "粉", "蓝"];

type Form = {
  displayName: string;
  bio: string;
  city: string;
  styleTags: string[];
  favoriteColors: string[];
  sizeTop: string;
  sizeBottom: string;
  sizeShoe: string;
  heightCm: string;
  weightKg: string;
  bodyDataConsent: boolean;
  budgetMin: string;
  budgetMax: string;
};

function toForm(p: Profile, fallbackName: string): Form {
  const s = (v: string | null) => v ?? "";
  const n = (v: number | null) => (v == null ? "" : String(v));
  return {
    displayName: p.displayName ?? fallbackName,
    bio: s(p.bio),
    city: s(p.city),
    styleTags: p.styleTags,
    favoriteColors: p.favoriteColors,
    sizeTop: s(p.sizeTop),
    sizeBottom: s(p.sizeBottom),
    sizeShoe: s(p.sizeShoe),
    heightCm: n(p.heightCm),
    weightKg: n(p.weightKg),
    bodyDataConsent: p.bodyDataConsent,
    budgetMin: n(p.budgetMin),
    budgetMax: n(p.budgetMax),
  };
}

// "" → null；非整数返回 undefined 表示无效。
function parseInt0(v: string): number | null | undefined {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  return Number(t);
}

function TagPicker({
  label,
  presets,
  value,
  onChange,
}: {
  label: string;
  presets: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const options = [...presets, ...value.filter((v) => !presets.includes(v))];
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t].slice(0, 12));
  function addDraft() {
    const t = draft.trim().slice(0, 20);
    if (t && !value.includes(t)) onChange([...value, t].slice(0, 12));
    setDraft("");
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="sc-meta">{label}</span>
      <div className="chips">
        {options.map((t) => (
          <button
            key={t}
            type="button"
            className="chip"
            aria-pressed={value.includes(t)}
            onClick={() => toggle(t)}
            style={value.includes(t) ? { boxShadow: "inset 0 0 0 1px var(--sc-champ)", color: "var(--sc-champ-text)" } : undefined}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          type="text"
          value={draft}
          maxLength={20}
          placeholder="自定义，回车添加"
          aria-label={`自定义${label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <button type="button" className="sc-cta sc-cta--ghost compact" onClick={addDraft}>
          添加
        </button>
      </div>
    </div>
  );
}

export default function ProfileForm({
  initial,
  fallbackName,
  avatarIsMock,
}: {
  initial: Profile;
  fallbackName: string;
  /** 3D 形象当前是否为示意模式（服务端判断后传入） */
  avatarIsMock: boolean;
}) {
  const [f, setF] = useState<Form>(() => toForm(initial, fallbackName));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hasSavedBody, setHasSavedBody] = useState(
    initial.heightCm != null || initial.weightKg != null || initial.bodyDataConsent,
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setMsg(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const nums = {
      heightCm: f.bodyDataConsent ? parseInt0(f.heightCm) : null,
      weightKg: f.bodyDataConsent ? parseInt0(f.weightKg) : null,
      budgetMin: parseInt0(f.budgetMin),
      budgetMax: parseInt0(f.budgetMax),
    };
    if (Object.values(nums).some((v) => v === undefined)) {
      setMsg({ ok: false, text: "身高、体重和预算请填整数" });
      return;
    }
    if (nums.budgetMin != null && nums.budgetMax != null && nums.budgetMin > nums.budgetMax) {
      setMsg({ ok: false, text: "预算下限不能高于上限" });
      return;
    }
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: f.displayName,
        bio: f.bio,
        city: f.city,
        styleTags: f.styleTags,
        favoriteColors: f.favoriteColors,
        sizeTop: f.sizeTop,
        sizeBottom: f.sizeBottom,
        sizeShoe: f.sizeShoe,
        bodyDataConsent: f.bodyDataConsent,
        ...nums,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const err = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      setMsg({ ok: false, text: err?.error ?? "保存失败，请稍后再试" });
      return;
    }
    const saved = (await res.json()) as Profile;
    setF(toForm(saved, fallbackName));
    setHasSavedBody(saved.heightCm != null || saved.weightKg != null || saved.bodyDataConsent);
    setMsg({ ok: true, text: "已保存" });
  }

  async function clearBody() {
    if (!confirm("确定清空身高、体重并撤回同意吗？")) return;
    const res = await fetch("/api/profile/body-data", { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setMsg({ ok: false, text: "清空失败，请稍后再试" });
      return;
    }
    setF((prev) => ({ ...prev, heightCm: "", weightKg: "", bodyDataConsent: false }));
    setHasSavedBody(false);
    setMsg({ ok: true, text: "身体数据已清空" });
  }

  return (
    <form className="stack" onSubmit={save}>
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">基本信息</h2>
        <label>
          昵称
          <input type="text" value={f.displayName} maxLength={30} onChange={(e) => set("displayName", e.target.value)} />
        </label>
        <label>
          所在城市
          <input type="text" value={f.city} maxLength={30} onChange={(e) => set("city", e.target.value)} />
        </label>
        <label>
          一句话介绍
          <textarea value={f.bio} maxLength={300} onChange={(e) => set("bio", e.target.value)} placeholder="比如：上班族，喜欢简洁但有一点细节的穿搭" />
        </label>
      </section>

      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">风格偏好</h2>
        <TagPicker label="风格" presets={STYLE_PRESETS} value={f.styleTags} onChange={(v) => set("styleTags", v)} />
        <TagPicker label="喜欢的颜色" presets={COLOR_PRESETS} value={f.favoriteColors} onChange={(v) => set("favoriteColors", v)} />
      </section>

      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">尺码与预算</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <label>
            上装
            <input type="text" value={f.sizeTop} maxLength={12} placeholder="M" onChange={(e) => set("sizeTop", e.target.value)} />
          </label>
          <label>
            下装
            <input type="text" value={f.sizeBottom} maxLength={12} placeholder="27" onChange={(e) => set("sizeBottom", e.target.value)} />
          </label>
          <label>
            鞋码
            <input type="text" value={f.sizeShoe} maxLength={12} placeholder="38" onChange={(e) => set("sizeShoe", e.target.value)} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <label>
            整套预算下限（元）
            <input type="text" inputMode="numeric" value={f.budgetMin} maxLength={7} onChange={(e) => set("budgetMin", e.target.value)} />
          </label>
          <label>
            整套预算上限（元）
            <input type="text" inputMode="numeric" value={f.budgetMax} maxLength={7} onChange={(e) => set("budgetMax", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">身体数据</h2>
          <span className="sc-badge">可选</span>
        </div>
        <p className="serif-note">
          身高、体重用于后续的合身参考（比赛版尚未接入），仅你本人可见，可随时一键删除，不会用于训练任何模型。不填也能正常使用。
        </p>
        <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", fontSize: 13, color: "var(--sc-ink)" }}>
          <input
            type="checkbox"
            checked={f.bodyDataConsent}
            onChange={(e) => {
              const on = e.target.checked;
              setF((prev) => ({ ...prev, bodyDataConsent: on, ...(on ? {} : { heightCm: "", weightKg: "" }) }));
              setMsg(null);
            }}
          />
          <span>我同意保存我的身高、体重，用于后续的合身参考</span>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, opacity: f.bodyDataConsent ? 1 : 0.5 }}>
          <label>
            身高（cm）
            <input
              type="text"
              inputMode="numeric"
              value={f.heightCm}
              maxLength={3}
              disabled={!f.bodyDataConsent}
              onChange={(e) => set("heightCm", e.target.value)}
            />
          </label>
          <label>
            体重（kg）
            <input
              type="text"
              inputMode="numeric"
              value={f.weightKg}
              maxLength={3}
              disabled={!f.bodyDataConsent}
              onChange={(e) => set("weightKg", e.target.value)}
            />
          </label>
        </div>
        {!f.bodyDataConsent && hasSavedBody ? <p className="sc-meta">取消同意后保存，已存的身高、体重会被清空。</p> : null}
        {hasSavedBody ? (
          <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={clearBody}>
            清空我的身体数据
          </button>
        ) : null}
      </section>

      <section className="sc-glass card stack sc-rise">
        <span className="sc-kicker">3D Avatar</span>
        <h2 className="section-title">我的 3D 形象</h2>
        <p className="serif-note">上传几张全身照，生成可 360° 查看的 3D 形象预览；穿搭试穿尚未接入。</p>
        {avatarIsMock ? <p className="sc-meta">当前为示意模式：生成的是通用人台，不是你本人。</p> : null}
        <Link href="/profile/avatar" className="sc-cta sc-cta--ghost">
          生成我的 3D 形象
        </Link>
      </section>

      <p role="status" aria-live="polite" className={msg?.ok === false ? "error" : "sc-meta"} style={{ textAlign: "center", minHeight: 18 }}>
        {msg?.text ?? ""}
      </p>
      <div className="cta-bar">
        <button className="sc-cta" disabled={saving}>
          {saving ? "保存中…" : "保存档案"}
        </button>
      </div>
    </form>
  );
}
