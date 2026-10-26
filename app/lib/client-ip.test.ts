import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp, networkOf } from "./client-ip";

// 请求方网络（D76）：纯函数，不连数据库、不访问网络。地址都是文档保留段（RFC 5737 / 3849）。

test("clientIp：取 x-forwarded-for 的第一个地址，没有时用 x-real-ip；都没有或格式不对时为 null", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIp(new Headers({ "x-real-ip": "198.51.100.20" })), "198.51.100.20");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "not-an-ip", "x-real-ip": "198.51.100.20" })), "198.51.100.20");
  assert.equal(clientIp(new Headers()), null, "本地开发没有来源头");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "300.1.1.1" })), null);
});

test("networkOf：IPv4 原样（去前导零）；IPv6 取前 64 位，同一段内换地址算同一网络；IPv4 映射地址按 IPv4", () => {
  assert.equal(networkOf("203.000.113.007"), "203.0.113.7");
  const a = networkOf("2001:db8:abcd:12:1111:2222:3333:4444");
  assert.equal(a, "2001:db8:abcd:12::/64");
  assert.equal(networkOf("2001:0DB8:ABCD:0012::9"), a, "大小写、前导零、压缩写法都归到同一段");
  assert.equal(networkOf("[2001:db8:abcd:12::1]"), a);
  assert.notEqual(networkOf("2001:db8:abcd:13::1"), a, "另一段 /64 是另一个网络");
  assert.equal(networkOf("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(networkOf("::1"), "0:0:0:0::/64");
  for (const bad of ["", "1:2:3", "1::2::3", "2001:db8::g", "1:2:3:4:5:6:7:8:9", "::ffff:999.0.0.1"]) assert.equal(networkOf(bad), null, bad);
});
