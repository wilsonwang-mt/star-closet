// 中文（源）· 试衣间。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const fittingRoom = {
  title: "个人试衣间",
  loading: "正在打开试衣间",
  signedOut: "登录后，加入试衣间的搭配会保存在你的账号里。",
  signIn: "登录 / 注册",
  summary: "{n} 套搭配。勾选想要的单品，加入购物袋。",
  summaryTryon: "{n} 套搭配。整套或一件一件穿到你身上，勾选想要的单品，加入购物袋。",
  empty: "还是空的，去衣橱里挑一套吧。",
  browse: "去逛衣橱",
  lifeScene: "穿着这一身，出现在周五的咖啡馆",
  /** 保存搭配时自动生成的标题（lib/bag/core.ts lookPayload、Adapter），显示时按当前语言重拼。 */
  lookTitle: {
    outfit: "整套搭配",
    myVersion: "{name} · 我的版本",
    picked: "挑选的 {n} 件",
    pickedFrom: "{name} · 挑选 {n} 件",
  },
  /** 试衣间里的一套（LookCard）。 */
  card: {
    mode: {
      original: "主理人原搭配",
      ai: "AI 改编",
      offline: "为你改编",
      pick: "我挑的单品",
    },
    remove: "移出",
    selectAria: "选择{name}",
    selected: "已选 {n} / {total} 件",
    addToBag: "加入购物袋（{n} 件）",
    added: "已加入购物袋",
    viewBag: "查看购物袋",
  },
};

export default fittingRoom;
