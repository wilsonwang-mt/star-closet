// 中文字典（源）：按命名空间汇总。新增命名空间：在 zh/ 与 en/ 各加一个文件，再在两边的 index.ts 登记。
import common from "./common";
import meta from "./meta";
import nav from "./nav";
import home from "./home";
import closet from "./closet";
import outfit from "./outfit";
import item from "./item";
import system from "./system";
import fittingRoom from "./fittingRoom";
import tryon from "./tryon";
import bag from "./bag";
import auth from "./auth";
import profile from "./profile";
import avatar from "./avatar";
import chat from "./chat";

export const zh = { common, meta, nav, home, closet, outfit, item, system, fittingRoom, tryon, bag, auth, profile, avatar, chat };

export type ZhMessages = typeof zh;
