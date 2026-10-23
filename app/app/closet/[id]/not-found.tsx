import NotFoundView from "@/components/NotFoundView";
import { getT } from "@/lib/i18n/server";

export default async function ClosetNotFound() {
  const t = await getT("system");
  return <NotFoundView title={t("notFound.closet.title")} note={t("notFound.closet.note")} />;
}
