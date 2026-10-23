// 多语言字典的类型：中文字典（messages/zh）是唯一的源，其他语言用 Shape<> 约束成同样的键，
// 少键、多键都会在 typecheck 时报错。键按命名空间（nav、home、tryon…）分文件，见 messages/zh/index.ts。
import type { ZhMessages } from "./messages/zh";
import type { Params } from "./format";

export type Messages = ZhMessages;
export type Namespace = keyof Messages;

/** 其他语言的字典形状：键与中文完全一致，值都是字符串。 */
export type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };

/** 某个字典里所有叶子键的点路径，如 "menu.open"。 */
export type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type NsKey<N extends Namespace> = Leaves<Messages[N]>;

export type Translator<N extends Namespace> = (key: NsKey<N>, params?: Params) => string;
