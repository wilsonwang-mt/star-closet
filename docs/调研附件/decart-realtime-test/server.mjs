// 本机测试服务器：签发 fal 实时临时令牌（FAL_KEY 只在服务端），提供测试页与虚构模特视频、商品图。
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
const env = readFileSync("/Users/wilson_macstudio/Desktop/star-closet-claude/app/.env.local", "utf8");
const KEY = env.match(/^FAL_KEY=(.+)$/m)[1].trim();
const types = { html: "text/html; charset=utf-8", mp4: "video/mp4", jpg: "image/jpeg", js: "text/javascript" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/token") {
    const r = await fetch("https://rest.alpha.fal.ai/tokens/", { method: "POST", headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ allowed_apps: ["lucy2-vton"], token_expiration: 120 }) });
    const t = await r.text();
    res.writeHead(r.status, { "Content-Type": "text/plain" });
    return res.end(t.replace(/^"|"$/g, ""));
  }
  const f = "." + (url.pathname === "/" ? "/page.html" : url.pathname);
  if (!/^\.\/[\w.-]+$/.test(f) || !existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[f.split(".").pop()] ?? "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(3300, () => console.log("decart test on :3300"));
