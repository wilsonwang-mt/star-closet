"use client";

import { useLinkStatus } from "next/link";

// 放在 <Link> 里面：点击后到新页面就绪之前（弱网、服务端渲染慢）给出待跳转反馈。
// 底部一条香槟色细线来回扫动（延迟 120ms 出现，网络快时不闪）；读屏用 role="status" 播报“正在打开”。
// 父元素需要 position: relative（.back-link、衣橱页搭配卡已设置）。
export default function LinkPending({ label = "正在打开" }: { label?: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className="link-pending" data-on={pending} aria-hidden="true" />
      <span className="sr-only" role="status">
        {pending ? label : ""}
      </span>
    </>
  );
}
