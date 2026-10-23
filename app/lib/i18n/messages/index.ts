// 全部语言的字典。只在服务端使用（根布局把当前语言的字典传给客户端），客户端组件不要直接 import 本文件，
// 否则所有语言的字典都会打进浏览器包。
import type { Locale } from "../config";
import type { Messages } from "../types";
import { en } from "./en";
import { zh } from "./zh";

export const MESSAGES: Record<Locale, Messages> = { zh, en };
