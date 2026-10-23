// 兜底：模型偶尔把工具调用写成正文里的 XML（<invoke name="show_outfits"><parameter name="outfit_ids">[…]</parameter></invoke>），
// 而不是真正的 tool_use。2026-10-23 实测 fast mode + effort low 下 12 轮里出现 3 次，卡片因此丢失、用户看到标签。
// 这里把这类片段从正文里摘出来、转成工具调用，其余标签一律去掉。纯函数，便于测试。

export type TextToolCall = { name: string; input: Record<string, unknown> };

const INVOKE = /<invoke\s+name="([\w-]+)"\s*>([\s\S]*?)(?:<\/invoke>|$)/g;
const PARAM = /<parameter\s+name="([\w-]+)"\s*>([\s\S]*?)<\/parameter>/g;

function value(raw: string): unknown {
  const v = raw.trim();
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** 从正文尾部（第一个 “<” 起）里摘出工具调用；返回去掉所有标签后剩下的正文。 */
export function extractTextToolCalls(text: string): { calls: TextToolCall[]; rest: string } {
  const calls: TextToolCall[] = [];
  const rest = text.replace(INVOKE, (_m, name: string, body: string) => {
    const input: Record<string, unknown> = {};
    for (const p of body.matchAll(PARAM)) input[p[1]] = value(p[2]);
    calls.push({ name, input });
    return "";
  });
  return {
    calls,
    rest: rest
      .replace(/<\/?[\w:-]+(?:\s[^<>]*)?>/g, "")
      .replace(/<[^>]*$/, "") // 被截断、没写完的标签
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/**
 * 流式正文过滤：遇到第一个 “<” 之后的内容先扣住，不发给前端（正常回复是中文口语，不会出现尖括号）；
 * 结束时由 finish() 把扣住的部分解析成工具调用，剩下的正文补发。
 */
export function createTextGuard(emit: (text: string) => void) {
  let held = "";
  return {
    push(d: string) {
      if (held) {
        held += d;
        return;
      }
      const i = d.indexOf("<");
      if (i < 0) return emit(d);
      if (i > 0) emit(d.slice(0, i));
      held = d.slice(i);
    },
    finish(): TextToolCall[] {
      if (!held) return [];
      const { calls, rest } = extractTextToolCalls(held);
      held = "";
      if (rest) emit(rest);
      return calls;
    },
  };
}
