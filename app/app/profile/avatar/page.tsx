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
          上传正面、侧面、背面三张全身照，生成可 360° 查看的 3D 外观预览；穿搭试穿尚未接入。它还原的是外观轮廓，不代表精确的本人外貌或身体尺寸，合身未验证。
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
