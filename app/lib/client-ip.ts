// 请求方的网络（D76 防滥用第二批）：同一网络下所有账号的每日合计、没登录访客的对话次数都按它计（lib/usage.ts）。
// - 只在内存里用：返回值交给 lib/usage.ts 算带日期的 HMAC 再落库，原始 IP 不进数据库、不进日志。
// - 来源：x-forwarded-for 的第一个地址，没有时用 x-real-ip。部署在 Vercel 上时这两个头由平台覆盖，客户端伪造不了；
//   本地开发、单元测试没有这两个头，返回 null，调用方跳过按网络的限额。
// - IPv6 只取前 64 位：家庭宽带、云主机通常分到一整段 /64，逐个换地址不能绕过合计；IPv4 映射地址（::ffff:a.b.c.d）按 IPv4 处理。

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

function ipv4(s: string): string | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts.join(".") : null;
}

/** IPv6 → 前 64 位（如 "2001:db8:0:1::/64"）；格式不对返回 null。 */
function ipv6Prefix(s: string): string | null {
  let addr = s.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  // 末尾内嵌的 IPv4（::ffff:1.2.3.4）先换成两段十六进制
  const v4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (v4) {
    const four = ipv4(v4[2]);
    if (!four) return null;
    const [a, b, c, d] = four.split(".").map(Number);
    addr = `${v4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (![...head, ...tail].every((g) => HEXTET.test(g))) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail].map((g) => parseInt(g, 16));
  // IPv4 映射地址：::ffff:a.b.c.d
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) return groups.slice(6).flatMap((g) => [g >> 8, g & 255]).join(".");
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** 规范化一个地址：IPv4 原样（去前导零），IPv6 取 /64 前缀；不认识的返回 null。 */
export function networkOf(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  return s.includes(":") ? ipv6Prefix(s) : ipv4(s);
}

/** 请求方的网络；没有可信的来源头时返回 null。 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  return networkOf(forwarded ?? "") ?? networkOf(headers.get("x-real-ip") ?? "");
}
