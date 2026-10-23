// 消息格式（ICU 子集）：{name} 插值；{n, plural, =0 {…} one {…} other {…}} 复数（# 换成数字）；
// {x, select, a {…} other {…}} 选择。足够覆盖界面文案，不引入第三方库。纯函数，浏览器与服务端共用。
import { LOCALE_META, type Locale } from "./config";

export type Params = Record<string, string | number | null | undefined>;

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralOf(locale: Locale, n: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALE_META[locale].intl);
    pluralRules.set(locale, rules);
  }
  return rules.select(n);
}

/** 从 start（必须是 “{”）找到配对的 “}”；没有配对返回 -1。 */
function matchBrace(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 解析 “=0 {…} one {…} other {…}” 这样的分支表。 */
function parseOptions(s: string): Record<string, string> {
  const options: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    let key = "";
    while (i < s.length && s[i] !== "{" && !/\s/.test(s[i])) key += s[i++];
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== "{") break;
    const end = matchBrace(s, i);
    if (end < 0) break;
    options[key] = s.slice(i + 1, end);
    i = end + 1;
  }
  return options;
}

function formatArgument(body: string, params: Params, locale: Locale): string {
  const first = body.indexOf(",");
  if (first < 0) {
    const value = params[body.trim()];
    return value == null ? `{${body}}` : String(value);
  }
  const name = body.slice(0, first).trim();
  const rest = body.slice(first + 1);
  const second = rest.indexOf(",");
  if (second < 0) return String(params[name] ?? "");
  const type = rest.slice(0, second).trim();
  const options = parseOptions(rest.slice(second + 1));
  const value = params[name];
  if (type === "plural") {
    const n = Number(value ?? 0);
    const chosen = options[`=${n}`] ?? options[pluralOf(locale, n)] ?? options.other ?? "";
    return formatMessage(chosen.replace(/#/g, String(n)), params, locale);
  }
  if (type === "select") {
    const chosen = options[String(value)] ?? options.other ?? "";
    return formatMessage(chosen, params, locale);
  }
  return String(value ?? "");
}

export function formatMessage(message: string, params: Params | undefined, locale: Locale): string {
  if (!params || !message.includes("{")) return message;
  let out = "";
  let i = 0;
  while (i < message.length) {
    if (message[i] === "{") {
      const end = matchBrace(message, i);
      if (end < 0) {
        out += message.slice(i);
        break;
      }
      out += formatArgument(message.slice(i + 1, end), params, locale);
      i = end + 1;
    } else {
      out += message[i++];
    }
  }
  return out;
}

/** 消息里出现的参数名（含 plural / select 的变量名），用于检查各语言的占位符一致。 */
export function placeholdersOf(message: string): string[] {
  const names = new Set<string>();
  let i = 0;
  while (i < message.length) {
    if (message[i] === "{") {
      const end = matchBrace(message, i);
      if (end < 0) break;
      const body = message.slice(i + 1, end);
      const comma = body.indexOf(",");
      names.add((comma < 0 ? body : body.slice(0, comma)).trim());
      if (comma >= 0) {
        const rest = body.slice(comma + 1);
        const second = rest.indexOf(",");
        if (second >= 0) {
          for (const branch of Object.values(parseOptions(rest.slice(second + 1)))) {
            for (const n of placeholdersOf(branch)) names.add(n);
          }
        }
      }
      i = end + 1;
    } else i++;
  }
  return [...names].sort();
}
