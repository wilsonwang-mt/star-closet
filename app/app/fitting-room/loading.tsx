import { PageSkeleton } from "@/components/Skeletons";
import { getT } from "@/lib/i18n/server";

export default async function Loading() {
  const t = await getT("fittingRoom");
  return <PageSkeleton label={t("loading")} />;
}
