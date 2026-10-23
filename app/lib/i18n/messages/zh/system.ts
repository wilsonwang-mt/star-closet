// 中文（源）· 404、错误页、骨架屏。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const system = {
  notFound: {
    page: {
      title: "找不到这个页面",
      note: "链接可能写错了，或者内容已经下架。",
    },
    closet: {
      title: "这间衣橱不存在或已下架",
      note: "去看看其他主理人的衣橱吧。",
    },
    outfit: {
      title: "这套搭配不存在或已下架",
      note: "主理人可能已经换掉了这一套，回到衣橱看看别的吧。",
    },
    item: {
      title: "这件单品不存在或已下架",
      note: "去衣橱里看看其他单品吧。",
    },
    home: "回到全部衣橱",
    fittingRoom: "去我的试衣间",
  },
  error: {
    title: "这一页没能打开",
    note: "可能是网络不稳定或服务暂时出错。可以再试一次，或先回到全部衣橱。",
    retry: "再试一次",
    home: "回到全部衣橱",
  },
  /** 加载骨架给读屏的状态文字 */
  loading: {
    closet: "正在打开衣橱",
    outfit: "正在打开搭配",
    page: "正在打开",
  },
};

export default system;
