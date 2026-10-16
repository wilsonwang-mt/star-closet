// 悬浮对话（D66）的前后端协议：卡片数据与 NDJSON 流事件。客户端与服务端共用，只放类型与常量。
import type { LocateQuery, PageKey } from "../locate/core";

export type ClosetCard = {
  kind: "closet";
  id: string;
  closetName: string;
  displayName: string;
  closetType: string;
  tagline: string;
  avatar: string | null;
  cover: string;
  outfitCount: number;
};

export type OutfitCard = {
  kind: "outfit";
  id: string;
  name: string;
  closetName: string;
  curatorId: string;
  no: number;
  total: number;
  cover: string | null;
  occasion: string;
};

export type PageCard = {
  kind: "page";
  page: PageKey;
  href: string;
  title: string;
  kicker: string;
  desc: string;
};

export type ChatCard = ClosetCard | OutfitCard | PageCard;

/** 服务端 → 客户端，每行一个 JSON。 */
export type ChatEvent =
  /** 规则层的即时结果：一句话、卡片、追问、解析出的查询（下一轮带回来） */
  | { t: "rules"; text: string; cards: ChatCard[]; chips: string[]; query: LocateQuery }
  /** AI 文字增量；第一段到达时替换规则那句话 */
  | { t: "delta"; d: string }
  /** AI 选定的卡片（已校验）；替换规则卡片 */
  | { t: "cards"; cards: ChatCard[] }
  | { t: "chips"; chips: string[] }
  /** AI 中途失败：撤回已流出的半截文字，恢复规则那句话 */
  | { t: "revert" }
  | { t: "done" };

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  /** assistant 这一轮展示过的卡片 id（衣橱、搭配、功能页），给 AI 当上下文 */
  shown?: string[];
};

export type ChatRequest = {
  messages: ChatTurn[];
  /** 上一轮规则解析出的查询，用来沿用条件（多轮） */
  query?: LocateQuery | null;
};

export const CHAT_MAX_INPUT = 200;
