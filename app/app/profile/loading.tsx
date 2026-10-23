"use client";

import { PageSkeleton } from "@/components/Skeletons";
import { useT } from "@/lib/i18n/client";

export default function Loading() {
  const t = useT("profile");
  return <PageSkeleton label={t("loading")} />;
}
