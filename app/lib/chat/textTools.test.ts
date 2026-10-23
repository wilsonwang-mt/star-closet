// 正文里 XML 工具调用的兜底解析（D68）。样例取自 2026-10-23 实测里模型真实写出的片段。
import assert from "node:assert/strict";
import { test } from "node:test";
import { createTextGuard, extractTextToolCalls } from "./textTools";

const SAMPLE = `这三套都在 1500 以内。\n\n<invoke name="show_outfits">\n<parameter name="outfit_ids">["O31","O21","O33"]</parameter>\n</invoke>\n<invoke name="open_page">\n<parameter name="pages">["login"]</parameter>\n</invoke>`;

test("摘出多个工具调用，参数按 JSON 解析，正文去掉标签", () => {
  const { calls, rest } = extractTextToolCalls(SAMPLE);
  assert.deepEqual(calls, [
    { name: "show_outfits", input: { outfit_ids: ["O31", "O21", "O33"] } },
    { name: "open_page", input: { pages: ["login"] } },
  ]);
  assert.equal(rest, "这三套都在 1500 以内。");
});

test("被截断的半个调用不会漏到正文里", () => {
  const { calls, rest } = extractTextToolCalls("好的。\n<invoke na");
  assert.equal(calls.length, 0);
  assert.equal(rest, "好的。");
  assert.doesNotMatch(extractTextToolCalls('看看这套\n<invoke name="show_outfits"><parameter name="outfit_ids">["O1"]').rest, /invoke|parameter/);
});

test("流式过滤：尖括号之前的正文照常流出，之后扣住，结束时补发剩余正文", () => {
  const out: string[] = [];
  const g = createTextGuard((t) => out.push(t));
  for (const d of ["这三套都在", " 1500 以内。\n\n<inv", 'oke name="suggest_replies">', '<parameter name="replies">["再便宜点"]</parameter></invoke>']) g.push(d);
  assert.deepEqual(out, ["这三套都在", " 1500 以内。\n\n"]);
  const calls = g.finish();
  assert.deepEqual(calls, [{ name: "suggest_replies", input: { replies: ["再便宜点"] } }]);
  assert.deepEqual(out, ["这三套都在", " 1500 以内。\n\n"]);
});

test("没有尖括号时原样流出", () => {
  const out: string[] = [];
  const g = createTextGuard((t) => out.push(t));
  g.push("你好呀，");
  g.push("想穿去哪儿？");
  assert.deepEqual(g.finish(), []);
  assert.equal(out.join(""), "你好呀，想穿去哪儿？");
});
