import type { Metadata } from "next";
import ClosetDirectory from "@/components/home/ClosetDirectory";
import { toClosetView } from "@/components/closet/data";
import { getCurators } from "@/lib/catalog";
import { getCatalogL10n, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("home");
  return { title: t("directory.title") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : null);

// 全部衣橱目录（D71）：网格 + 按性别、衣橱类型、风格筛选；?gender=女装&type=风格主题&style=极简 还原筛选。
export default async function ClosetsPage({ searchParams }: Props) {
  const [curators, sp, l10n] = await Promise.all([getCurators(), searchParams, getCatalogL10n()]);
  // 衣橱名、简介按当前语言换；性别、类型、风格保持中文（筛选按中文值工作），显示时再翻译。
  const closets = curators.map((c) => toClosetView(l10n.curator(c)));
  return <ClosetDirectory closets={closets} initial={{ gender: one(sp.gender), type: one(sp.type), style: one(sp.style) }} />;
}
