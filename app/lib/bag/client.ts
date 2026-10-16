"use client";

import { lookPayload } from "./core";

// 浏览器端：加入购物袋 / 加入试衣间。未登录（401）时去登录页并带回当前页面。
// 加入购物袋成功后广播 sc:bag 事件（detail.count），导航栏角标据此更新。

export const BAG_EVENT = "sc:bag";

export type AddResult = { ok: true; count?: number } | { ok: false; error: string } | { ok: false; redirected: true };

function toLogin(): AddResult {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  return { ok: false, redirected: true };
}

async function errorOf(res: Response | null, fallback: string) {
  if (!res) return "网络异常，请稍后再试";
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export async function addItemsToBag(items: { itemId: string; size?: string; qty?: number }[]): Promise<AddResult> {
  const res = await fetch("/api/bag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }).catch(() => null);
  if (res?.status === 401) return toLogin();
  if (!res?.ok) return { ok: false, error: await errorOf(res, "加入购物袋失败，请稍后再试") };
  const { count } = (await res.json()) as { count: number };
  window.dispatchEvent(new CustomEvent(BAG_EVENT, { detail: { count } }));
  return { ok: true, count };
}

export async function addToFittingRoom(input: Parameters<typeof lookPayload>[0]): Promise<AddResult> {
  const res = await fetch("/api/looks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lookPayload(input)),
  }).catch(() => null);
  if (res?.status === 401) return toLogin();
  if (!res?.ok) return { ok: false, error: await errorOf(res, "加入试衣间失败，请稍后再试") };
  return { ok: true };
}
