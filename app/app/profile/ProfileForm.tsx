"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { NsKey } from "@/lib/i18n/types";
import type { Profile } from "@/lib/profile";

// 预设标签：value 是存进数据库的中文原词（切换语言不变），key 对应字典 profile.presets.* 里的显示名。
type Preset = { value: string; key: NsKey<"profile"> };
const STYLE_PRESETS: Preset[] = [
  { value: "通勤", key: "presets.style.commute" },
  { value: "极简", key: "presets.style.minimal" },
  { value: "法式", key: "presets.style.french" },
  { value: "复古", key: "presets.style.vintage" },
  { value: "街头", key: "presets.style.street" },
  { value: "运动", key: "presets.style.sporty" },
  { value: "甜美", key: "presets.style.sweet" },
  { value: "中性", key: "presets.style.androgynous" },
  { value: "度假", key: "presets.style.resort" },
  { value: "约会", key: "presets.style.date" },
];
const COLOR_PRESETS: Preset[] = [
  { value: "黑", key: "presets.color.black" },
  { value: "白", key: "presets.color.white" },
  { value: "灰", key: "presets.color.gray" },
  { value: "米", key: "presets.color.beige" },
  { value: "驼", key: "presets.color.camel" },
  { value: "藏青", key: "presets.color.navy" },
  { value: "酒红", key: "presets.color.burgundy" },
  { value: "墨绿", key: "presets.color.forest" },
  { value: "粉", key: "presets.color.pink" },
  { value: "蓝", key: "presets.color.blue" },
];

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
  customAria,
  presets,
  value,
  onChange,
}: {
  label: string;
  customAria: string;
  presets: Preset[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const tr = useT("profile");
  const [draft, setDraft] = useState("");
  const presetValues = presets.map((p) => p.value);
  const options = [...presetValues, ...value.filter((v) => !presetValues.includes(v))];
  // 预设显示译名；用户自己输入的标签按原样显示。
  const display = (v: string) => {
    const preset = presets.find((p) => p.value === v);
    return preset ? tr(preset.key) : v;
  };
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
            {display(t)}
          </button>
        ))}
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          type="text"
          value={draft}
          maxLength={20}
          placeholder={tr("style.customPlaceholder")}
          aria-label={customAria}
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <button
          type="button"
          className="sc-cta sc-cta--ghost compact"
          style={{ flex: "none", minWidth: 64, whiteSpace: "nowrap" }}
          onClick={addDraft}
        >
          {tr("style.add")}
        </button>
      </div>
    </div>
  );
}

export default function ProfileForm({
  initial,
  fallbackName,
}: {
  initial: Profile;
  fallbackName: string;
}) {
  const t = useT("profile");
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
      heightCm: parseInt0(f.heightCm),
      weightKg: parseInt0(f.weightKg),
      budgetMin: parseInt0(f.budgetMin),
      budgetMax: parseInt0(f.budgetMax),
    };
    if (Object.values(nums).some((v) => v === undefined)) {
      setMsg({ ok: false, text: t("messages.integersOnly") });
      return;
    }
    if (nums.budgetMin != null && nums.budgetMax != null && nums.budgetMin > nums.budgetMax) {
      setMsg({ ok: false, text: t("messages.budgetOrder") });
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
        bodyDataConsent: nums.heightCm != null || nums.weightKg != null,
        ...nums,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) {
      const err = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      setMsg({ ok: false, text: err?.error ?? t("messages.saveFailed") });
      return;
    }
    const saved = (await res.json()) as Profile;
    setF(toForm(saved, fallbackName));
    setHasSavedBody(saved.heightCm != null || saved.weightKg != null || saved.bodyDataConsent);
    setMsg({ ok: true, text: t("messages.saved") });
  }

  async function clearBody() {
    if (!confirm(t("body.clearConfirm"))) return;
    const res = await fetch("/api/profile/body-data", { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setMsg({ ok: false, text: t("messages.clearFailed") });
      return;
    }
    setF((prev) => ({ ...prev, heightCm: "", weightKg: "", bodyDataConsent: false }));
    setHasSavedBody(false);
    setMsg({ ok: true, text: t("messages.cleared") });
  }

  return (
    <form className="stack" onSubmit={save}>
      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">{t("basics.title")}</h2>
        <label>
          {t("basics.name")}
          <input type="text" value={f.displayName} maxLength={30} onChange={(e) => set("displayName", e.target.value)} />
        </label>
        <label>
          {t("basics.city")}
          <input type="text" value={f.city} maxLength={30} onChange={(e) => set("city", e.target.value)} />
        </label>
        <label>
          {t("basics.bio")}
          <textarea value={f.bio} maxLength={300} onChange={(e) => set("bio", e.target.value)} placeholder={t("basics.bioPlaceholder")} />
        </label>
      </section>

      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">{t("style.title")}</h2>
        <TagPicker
          label={t("style.styles")}
          customAria={t("style.customStyleAria")}
          presets={STYLE_PRESETS}
          value={f.styleTags}
          onChange={(v) => set("styleTags", v)}
        />
        <TagPicker
          label={t("style.colors")}
          customAria={t("style.customColorAria")}
          presets={COLOR_PRESETS}
          value={f.favoriteColors}
          onChange={(v) => set("favoriteColors", v)}
        />
      </section>

      <section className="sc-glass card stack sc-rise">
        <h2 className="section-title">{t("sizes.title")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          <label>
            {t("sizes.top")}
            <input type="text" value={f.sizeTop} maxLength={12} placeholder="M" onChange={(e) => set("sizeTop", e.target.value)} />
          </label>
          <label>
            {t("sizes.bottom")}
            <input type="text" value={f.sizeBottom} maxLength={12} placeholder="27" onChange={(e) => set("sizeBottom", e.target.value)} />
          </label>
          <label>
            {t("sizes.shoe")}
            <input type="text" value={f.sizeShoe} maxLength={12} placeholder="38" onChange={(e) => set("sizeShoe", e.target.value)} />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <label>
            {t("sizes.budgetMin")}
            <input type="text" inputMode="numeric" value={f.budgetMin} maxLength={7} onChange={(e) => set("budgetMin", e.target.value)} />
          </label>
          <label>
            {t("sizes.budgetMax")}
            <input type="text" inputMode="numeric" value={f.budgetMax} maxLength={7} onChange={(e) => set("budgetMax", e.target.value)} />
          </label>
        </div>
      </section>

      <section className="sc-glass card stack sc-rise">
        <div className="spread">
          <h2 className="section-title">{t("body.title")}</h2>
          <span className="sc-badge">{t("body.private")}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <label>
            {t("body.height")}
            <input
              type="text"
              inputMode="numeric"
              value={f.heightCm}
              maxLength={3}
              onChange={(e) => set("heightCm", e.target.value)}
            />
          </label>
          <label>
            {t("body.weight")}
            <input
              type="text"
              inputMode="numeric"
              value={f.weightKg}
              maxLength={3}
              onChange={(e) => set("weightKg", e.target.value)}
            />
          </label>
        </div>
        {hasSavedBody ? (
          <button type="button" className="link-btn" style={{ justifySelf: "start" }} onClick={clearBody}>
            {t("body.clear")}
          </button>
        ) : null}
      </section>

      <section className="sc-glass card stack sc-rise">
        <span className="sc-kicker">{t("avatar.kicker")}</span>
        <h2 className="section-title">{t("avatar.title")}</h2>
        <p className="note-text">{t("avatar.intro")}</p>
        <Link href="/profile/avatar" className="sc-cta sc-cta--ghost">
          {t("avatar.cta")}
        </Link>
      </section>

      <p role="status" aria-live="polite" className={msg?.ok === false ? "error" : "sc-meta"} style={{ textAlign: "center", minHeight: 18 }}>
        {msg?.text ?? ""}
      </p>
      <div className="cta-bar">
        <button className="sc-cta" disabled={saving}>
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
