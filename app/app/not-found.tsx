import type { Metadata } from "next";
import NotFoundView from "@/components/NotFoundView";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("system");
  return { title: t("notFound.page.title") };
}

export default async function NotFound() {
  const t = await getT("system");
  return <NotFoundView title={t("notFound.page.title")} note={t("notFound.page.note")} />;
}
