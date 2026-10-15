import type { Item } from "../catalog";

export type AdaptMode = "ai" | "offline";

// 改编器只决定“选哪些单品、为什么”；总价、预算判断与“去掉了哪些单品”的说明由服务端统一计算。
export type AdaptDraft = {
  mode: AdaptMode;
  picks: { itemId: string; reason: string }[];
  summary: string;
  budget: number | null;
  notes: string[];
  /** 规则模式是否识别到了任何约束（AI 模式不填，视为已识别） */
  recognized?: boolean;
};

export type AdaptResult = {
  mode: AdaptMode;
  items: (Item & { reason: string })[];
  summary: string;
  budget: number | null;
  total: number;
  overBudget: boolean;
  notes: string[];
  /** 结果与原搭配的单品是否不同；false 时界面改为提示态，不提供保存 */
  changed: boolean;
  /** 是否听懂了这句要求；false 时界面显示“没听懂”与示例 */
  recognized: boolean;
};
