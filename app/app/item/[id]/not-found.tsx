import NotFoundView from "@/components/NotFoundView";
import { getT } from "@/lib/i18n/server";

export default async function ItemNotFound() {
  const t = await getT("system");
  return <NotFoundView title={t("notFound.item.title")} note={t("notFound.item.note")} />;
}
