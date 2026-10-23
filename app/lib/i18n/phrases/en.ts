// 服务端发出的中文提示 → English（gettext 式：以中文原文为键）。
// 用于 Route Handler 返回的 { error }、存进数据库后再读出的错误文案等：在响应边界按当前语言替换，
// lib 里的逻辑与测试仍用中文原文。新增一条服务端提示时，同时在这里补英文（i18n 测试会检查 app/api 里的字面量）。

/** 原文完全相同时替换。 */
export const phrases: Record<string, string> = {};

/** 带变量的原文：按顺序尝试，$1、$2 引用捕获组。 */
export const patterns: ReadonlyArray<readonly [RegExp, string]> = [];
