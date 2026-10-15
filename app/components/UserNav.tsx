"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

// 手机顶栏宽度有限：登录后只放“我的档案”，退出登录在档案页底部。
export default function UserNav() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!data) return <Link href="/login">登录</Link>;
  return (
    <Link href="/profile" title={data.user.email}>
      我的档案
    </Link>
  );
}
