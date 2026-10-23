// 中文（源）· 衣橱页。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const closet = {
  backAll: "全部衣橱",
  byline: "主理人 · {name} · {n} 套搭配",
  cue: "向下浏览 {n} 套搭配",
  looks: {
    title: "这间衣橱的 {n} 套搭配",
    note: "每件都能一键试穿；整套或挑几件加入试衣间、购物袋。",
  },
  look: {
    opening: "正在打开 {name}",
    pieces: "{name}的单品",
    go: "查看与改编",
  },
  /** 搭配的加入操作（衣橱页搭配卡与搭配页共用，components/closet/LookActions） */
  actions: {
    addLook: "整套加入试衣间",
    addPicked: "加入试衣间（{n} 件）",
    added: "已加入试衣间",
    addLookToBag: "整套加入购物袋",
    addPickedToBag: "加入购物袋（{n} 件）",
    addedToBag: "已加入购物袋",
    bag: "购物袋",
    selectPieces: "多选单品",
    cancelSelect: "取消多选",
    pickHint: "勾选想要的单品",
    goToRoom: "去试衣间",
    viewBag: "查看购物袋",
    select: "选择{name}",
  },
};

export default closet;
