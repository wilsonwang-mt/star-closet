"use client";

import { useMemo } from "react";
import { useT } from "@/lib/i18n/client";
import zhBag from "@/lib/i18n/messages/zh/bag";
import { lookPayload } from "./core";

// 浏览器端：加入购物袋 / 加入试衣间。未登录（401）时去登录页并带回当前页面。
// 加入购物袋成功后广播 sc:bag 事件（detail.count），导航栏角标据此更新。
// 失败提示：服务端给出的 error（已按当前语言翻译）优先；没有时用调用方传入的兜底提示（组件里 useBagErrors() 取当前语言），
// 不传时用中文原文（兼容还没改的调用方）。

export const BAG_EVENT = "sc:bag";

export type AddResult = { ok: true; count?: number } | { ok: false; error: string } | { ok: false; redirected: true };

/** 客户端兜底提示。 */
export type BagErrors = { network: string; addToBag: string; addToFittingRoom: string };

const ZH_ERRORS: BagErrors = {
  network: zhBag.errors.network,
  addToBag: zhBag.errors.addToBag,
  addToFittingRoom: zhBag.errors.addToFittingRoom,
};

/** 当前语言的兜底提示：const errors = useBagErrors(); addItemsToBag(items, errors) */
export function useBagErrors(): BagErrors {
  const t = useT("bag");
  return useMemo(
    () => ({ network: t("errors.network"), addToBag: t("errors.addToBag"), addToFittingRoom: t("errors.addToFittingRoom") }),
    [t],
  );
}

function toLogin(): AddResult {
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  return { ok: false, redirected: true };
}

async function errorOf(res: Response | null, fallback: string, network: string) {
  if (!res) return network;
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

export async function addItemsToBag(
  items: { itemId: string; size?: string; qty?: number }[],
  errors: BagErrors = ZH_ERRORS,
): Promise<AddResult> {
  const res = await fetch("/api/bag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }).catch(() => null);
  if (res?.status === 401) return toLogin();
  if (!res?.ok) return { ok: false, error: await errorOf(res, errors.addToBag, errors.network) };
  const { count } = (await res.json()) as { count: number };
  window.dispatchEvent(new CustomEvent(BAG_EVENT, { detail: { count } }));
  return { ok: true, count };
}

export async function addToFittingRoom(input: Parameters<typeof lookPayload>[0], errors: BagErrors = ZH_ERRORS): Promise<AddResult> {
  const res = await fetch("/api/looks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lookPayload(input)),
  }).catch(() => null);
  if (res?.status === 401) return toLogin();
  if (!res?.ok) return { ok: false, error: await errorOf(res, errors.addToFittingRoom, errors.network) };
  return { ok: true };
}
