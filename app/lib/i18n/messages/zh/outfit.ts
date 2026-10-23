// 中文（源）· 搭配页、一句话改编、单品列表。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const outfit = {
  backToCloset: "返回衣橱",
  original: {
    title: "主理人原搭配",
  },
  restyle: {
    title: "一句话改编",
    badge: "AI 改编",
    placeholder: "例如：{example}",
    aria: "改编要求",
    voiceStart: "语音输入",
    voiceStop: "停止语音",
    needInput: "先写一句要求，或点上面的示例",
    /** 示例要求：点一下填进输入框（并作为要求发给改编接口） */
    examples: {
      wedding: "预算 800 以内，户外婚礼，换成平底鞋",
      commute: "冬天通勤穿，不要皮革",
      weekend: "周末逛街，舒服一点，600 以内",
    },
  },
  errors: {
    adapt: "改编失败",
    save: "保存失败",
    noVoice: "这个浏览器不支持语音输入，请直接打字",
  },
  /** 提示态：没听懂，或这句要求在这套里没有可改动的地方 */
  unchanged: {
    nothing: "没有可改动的地方",
    unclear: "没听懂这句要求",
    hint: "可以说说预算、场合、想换或不要的单品，比如：",
  },
  result: {
    title: "为你改编的一套",
    budget: "预算 {amount}",
    over: "· 超出 {amount}",
    note: "{mode, select, ai {由 AI 挑选：优先用这间衣橱的单品，不够时也会用其他衣橱的；} other {由规则挑选，未使用 AI：优先用这间衣橱的单品，不够时也会用其他衣橱的；}}金线标出的是换掉的单品；总价按各单品标价计算。",
  },
  /** 逐件替换后这件单品下方的理由 */
  manualReason: "你手动替换",
  /** 保存改编结果时的标题 */
  myVersion: "{name} · 我的版本",
  cta: {
    same: "和原搭配相同",
    added: "已加入试衣间",
    add: "加入试衣间",
    again: "重新改编",
    running: "正在改编…",
    retry: "换一句再改编",
    start: "改编这一套",
  },
  waiting: {
    title: "正在为你改编",
    thinking: "AI 思考中 · {s}s",
    footer: "正在从衣橱里为你挑选最合适的一套",
    steps: {
      read: "读懂你的要求",
      pick: "在这间衣橱里挑选",
      keep: "保留原搭配的风格",
      check: "核对类别与预算",
      write: "写下每件的理由",
    },
  },
  /** 单品列表（components/ItemList）与缩略图（components/ItemThumb） */
  list: {
    swapAria: "替换{name}",
    swapPlaceholder: "换一件{category}…",
    ownCloset: "这间衣橱",
    otherClosets: "其他衣橱",
    viewItem: "查看单品：{name}",
  },
};

export default outfit;
