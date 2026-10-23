import NotFoundView from "@/components/NotFoundView";
import { getT } from "@/lib/i18n/server";

export default async function OutfitNotFound() {
  const t = await getT("system");
  return <NotFoundView title={t("notFound.outfit.title")} note={t("notFound.outfit.note")} />;
}
