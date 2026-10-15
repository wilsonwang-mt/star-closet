import type { Item } from "../catalog";

export type AdaptMode = "ai" | "offline";

// 改编器只决定“选哪些单品、为什么”；总价与预算判断由服务端统一计算。
export type AdaptDraft = {
  mode: AdaptMode;
  picks: { itemId: string; reason: string }[];
  summary: string;
  budget: number | null;
  notes: string[];
};

export type AdaptResult = {
  mode: AdaptMode;
  items: (Item & { reason: string })[];
  summary: string;
  budget: number | null;
  total: number;
  overBudget: boolean;
  notes: string[];
};
