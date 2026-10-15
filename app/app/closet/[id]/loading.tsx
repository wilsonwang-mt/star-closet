import { ClosetSkeleton } from "@/components/Skeletons";

// 衣橱页加载骨架：从首页或搭配页点进来时立刻切到这层外壳（Next 预取），真页面到了再替换。
export default function Loading() {
  return <ClosetSkeleton />;
}
