import Link from "next/link";
import { redirect } from "next/navigation";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { localizeAvatarState } from "@/lib/avatar/l10n";
import { getAvatarState } from "@/lib/avatar/service";
import { getLocale, getT } from "@/lib/i18n/server";
import AvatarStudio from "./AvatarStudio";

export const dynamic = "force-dynamic";

export default async function AvatarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile/avatar");
  const [rawState, t, locale] = await Promise.all([getAvatarState(user.id), getT("avatar"), getLocale()]);
  // 处理方说明、照片质量提示、作业错误与分身标签按语言显示（D70）
  const state = localizeAvatarState(rawState, locale);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "28dvh" }}>
        <span className="sc-kicker">{state.mode === "twin" ? t("page.kickerTwin") : t("page.kicker3d")}</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>{state.mode === "twin" ? t("page.titleTwin") : t("page.title3d")}</h1>
        <p className="serif-note">
          {state.mode === "twin"
            ? t("page.introTwin")
            : state.mode === "metaperson"
              ? t("page.introMetaperson")
              : t("page.introPhotos")}
        </p>
      </section>
      <AvatarStudio initial={state} />
      <section className="row" style={{ justifyContent: "center", padding: "8px 4px 0" }}>
        <Link href="/profile" className="link-btn">
          {t("page.back")}
        </Link>
      </section>
    </>
  );
}
