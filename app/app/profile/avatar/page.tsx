import Link from "next/link";
import { redirect } from "next/navigation";
import Scene from "@/components/Scene";
import { getCurrentUser } from "@/lib/auth";
import { getAvatarState } from "@/lib/avatar/service";
import AvatarStudio from "./AvatarStudio";

export const dynamic = "force-dynamic";

export default async function AvatarPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile/avatar");
  const state = await getAvatarState(user.id);
  return (
    <>
      <Scene dim />
      <section className="hero sc-rise" style={{ minHeight: "28dvh" }}>
        <span className="sc-kicker">3D Avatar</span>
        <h1 className="sc-display" style={{ margin: "6px 0 8px" }}>我的 3D 形象</h1>
        <p className="serif-note">
          {state.mode === "metaperson"
            ? "上传一张自拍，生成你本人的全身 3D 形象，可 360° 旋转查看。"
            : "上传正面、侧面、背面三张全身照，AI 为你生成可 360° 旋转查看的 3D 形象。"}
        </p>
      </section>
      <AvatarStudio initial={state} />
      <section className="row" style={{ justifyContent: "center", padding: "8px 4px 0" }}>
        <Link href="/profile" className="link-btn">
          返回我的档案
        </Link>
      </section>
    </>
  );
}
