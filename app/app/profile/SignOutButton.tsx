"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/client";

export default function SignOutButton() {
  const router = useRouter();
  const t = useT("profile");
  return (
    <button
      type="button"
      className="link-btn"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      {t("signOut")}
    </button>
  );
}
