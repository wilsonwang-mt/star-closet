// 中文（源）· 首页（衣橱轮播、筛选）。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const home = {
  /** 目录还没导入数据库时首页显示的开发提示 */
  dbEmpty: "目录还没有写入数据库。请先在 app/ 下运行 npm run db:setup。",
  title: "想走进谁的衣橱？",
  enter: "走进衣橱",
  filters: {
    aria: "筛选衣橱",
    all: "全部",
    noMatch: "这个组合下暂时没有衣橱",
  },
  empty: {
    note: "这个组合下暂时没有衣橱。",
    showAll: "查看全部",
  },
  carousel: {
    roledescription: "轮播",
    aria: "衣橱，共 {n} 间。左右方向键切换，回车走进当前衣橱",
    cardRoledescription: "衣橱",
    cardAria: "{index} / {total}：{name}",
    prev: "上一间",
    next: "下一间",
  },
  /** 首页第二部分「按场合，整套穿走」（D71） */
  edit: {
    title: "按场合，整套穿走",
    lead: "主理人搭好的整套，先穿在你身上看，再决定带走哪几件。",
    ask: "不确定？问问造型师",
    tabsAria: "按场合挑选整套搭配",
    viewLookAria: "查看整套：{name}",
    pieces: "这套的 {n} 件",
    piecesAria: "{name} 的单品",
    total: "整套",
    viewLook: "查看整套",
    more: "更多「{occasion}」搭配",
    cardPieces: "{n} 件",
  },
};

export default home;
