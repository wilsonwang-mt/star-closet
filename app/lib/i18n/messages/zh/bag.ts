// 中文（源）· 购物袋。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const bag = {
  title: "购物袋",
  signedOut: "登录后，加入购物袋的单品会保存在你的账号里。",
  signIn: "登录 / 注册",
  empty: "购物袋还是空的。逛衣橱时，单品、整套或勾选的几件都可以加进来。",
  browse: "去逛衣橱",
  /** 单品行（BagList）。 */
  line: {
    listAria: "购物袋中的单品",
    sizeAria: "{name}的尺码",
    chooseSize: "选择尺码",
    oneSize: "均码",
    qtyAria: "{name}的数量",
    decrease: "减少一件",
    increase: "增加一件",
    unitPrice: "单价 {price}",
    remove: "移除",
  },
  summary: {
    aria: "合计",
    count: "共 {n} 件",
    total: "合计",
  },
  /** 客户端兜底提示（app/bag/BagList.tsx、lib/bag/client.ts）。服务端给出的 error 优先。 */
  errors: {
    saveFailed: "没有保存成功，请再试一次",
    network: "网络异常，请稍后再试",
    addToBag: "加入购物袋失败，请稍后再试",
    addToFittingRoom: "加入试衣间失败，请稍后再试",
  },
};

export default bag;
