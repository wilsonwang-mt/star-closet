// 悬浮对话（D66，D68 动态化）的前后端协议：卡片数据与 NDJSON 流事件。客户端与服务端共用，只放类型与常量。
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
  /** 立刻返回：这句话里识别到的条件（户外婚礼、1500 以内…），界面显示为“理解行”；没识别到时为空。不是回复本身。
   *  query 是规则层解析的查询，客户端下一轮带回来用于沿用条件。 */
  | { t: "understood"; labels: string[]; query: LocateQuery }
  /** AI 文字增量 */
  | { t: "delta"; d: string }
  /** 到目前为止的卡片（已按目录与性别校验）；每完成一次工具调用发一次，整组替换 */
  | { t: "cards"; cards: ChatCard[] }
  | { t: "chips"; chips: string[] }
  /** AI 中途失败：撤回已流出的半截文字（随后会有 fallback） */
  | { t: "revert" }
  /** 没有 AI、AI 超时或出错时的兜底回复（规则层结果，或一句“没接上”），整条替换 */
  | { t: "fallback"; text: string; cards: ChatCard[]; chips: string[] }
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
  /** 用户发这句话时所在的页面（路径 + 查询串），让“这套”“这件”有着落 */
  path?: string;
};

export const CHAT_MAX_INPUT = 200;
