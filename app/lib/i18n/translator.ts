// 按命名空间取翻译函数。纯函数，服务端（server.ts）与客户端（client.tsx）共用。
import type { Locale } from "./config";
import { formatMessage, type Params } from "./format";
import type { Messages, Namespace, NsKey, Translator } from "./types";

function lookup(dict: unknown, key: string): unknown {
  let node = dict;
  for (const part of key.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export function createTranslator<N extends Namespace>(locale: Locale, messages: Messages, ns: N): Translator<N> {
  const dict = messages[ns];
  return (key: NsKey<N>, params?: Params) => {
    const raw = lookup(dict, key);
    if (typeof raw !== "string") {
      // 类型检查会挡住拼错的键；运行时仍缺失时显示键名，便于发现，不让页面崩掉。
      if (process.env.NODE_ENV !== "production") console.warn(`[i18n] 缺少文案 ${locale}:${ns}.${key}`);
      return `${ns}.${key}`;
    }
    return formatMessage(raw, params, locale);
  };
}
