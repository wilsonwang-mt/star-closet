"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function UserNav() {
  const { data, isPending } = authClient.useSession();
  const router = useRouter();
  if (isPending) return null;
  if (!data) return <Link href="/login">登录</Link>;
  return (
    <button
      className="link-btn"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
      title={data.user.email}
    >
      退出
    </button>
  );
}
