import type { Metadata } from "next";
import NotFoundView from "@/components/NotFoundView";

export const metadata: Metadata = { title: "找不到这个页面" };

export default function NotFound() {
  return <NotFoundView title="找不到这个页面" note="链接可能写错了，或者内容已经下架。" />;
}
