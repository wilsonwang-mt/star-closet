import { OutfitSkeleton } from "@/components/Skeletons";

// 搭配页加载骨架：点搭配卡后立刻切到这层外壳（Next 预取），真页面到了再替换。
export default function Loading() {
  return <OutfitSkeleton />;
}
