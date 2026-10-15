import { redirect } from "next/navigation";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { thirdPartyInfo } from "@/lib/avatar/providers";
import { getProfile } from "@/lib/profile";
import ProfileForm from "./ProfileForm";
import SignOutButton from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");
  const profile = await getProfile(user.id);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "32dvh" }}>
        <span className="sc-kicker">My Profile</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>我的档案</h1>
        <p className="serif-note">
          记下你的风格、尺码与预算。档案仅你本人可见，先为后续的个性化推荐保存，比赛版的改编暂未读取它。
        </p>
      </section>
      <ProfileForm initial={profile} fallbackName={user.name} avatarIsMock={!thirdPartyInfo()} />
      <section className="row" style={{ justifyContent: "space-between", padding: "8px 4px 0" }}>
        <span className="sc-meta">{user.email}</span>
        <SignOutButton />
      </section>
    </>
  );
}
