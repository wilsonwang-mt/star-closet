import ClosetCarousel from "@/components/home/ClosetCarousel";
import { toClosetView } from "@/components/closet/data";
import { getCurators } from "@/lib/catalog";

export const dynamic = "force-dynamic";

// 首页：先选择“想走进谁的衣橱”，用空间预览引起好奇再进入（/closet/[id]）。
// ?c=C03 记住当前选中的那一间：从衣橱页返回时回到原处。
export default async function Home({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const [curators, sp] = await Promise.all([getCurators(), searchParams]);
  if (curators.length === 0) {
    return <p className="muted">目录还没有写入数据库。请先在 app/ 下运行 npm run db:setup。</p>;
  }
  const initialId = typeof sp.c === "string" ? sp.c : undefined;
  return <ClosetCarousel closets={curators.map((c) => toClosetView(c))} initialId={initialId} />;
}
