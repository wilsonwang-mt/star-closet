import { redirect } from "next/navigation";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { getProfile } from "@/lib/profile";
import ProfileForm from "./ProfileForm";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");
  const [profile, t] = await Promise.all([getProfile(user.id), getT("profile")]);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "32dvh" }}>
        <span className="sc-kicker">{t("kicker")}</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>{t("title")}</h1>
        <p className="serif-note">{t("intro")}</p>
      </section>
      <ProfileForm initial={profile} fallbackName={user.name} />
      <section className="row" style={{ justifyContent: "space-between", padding: "8px 4px 0" }}>
        <span className="sc-meta">{user.email}</span>
        <SignOutButton />
      </section>
    </>
  );
}
