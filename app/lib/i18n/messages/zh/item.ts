// 中文（源）· 单品详情页、上身效果画廊、加入购物袋。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const item = {
  facts: {
    color: "颜色",
    material: "材质",
    size: "尺码",
    fit: "版型",
    season: "季节",
    closet: "衣橱",
  },
  priceNote: "参考价",
  demoModel: "演示模特",
  demoModelAi: "演示模特 · 由 AI 生成的虚构人物",
  inLooks: {
    title: "这件出现在哪些搭配里",
    total: "整套 {price}",
  },
  /** 选尺码 + 加入购物袋（components/item/AddToBag） */
  bag: {
    sizes: "尺码",
    pickSize: "先选一个尺码",
    add: "加入购物袋",
    added: "已加入购物袋",
    view: "查看购物袋",
  },
  /** 实况照片（components/live/LivePhoto） */
  live: {
    aria: "{alt}（实况，悬停或长按播放）",
  },
  /** 一键试穿（商品详情页顶部，components/item/LookGallery）。kind：accessory = 鞋包配饰，其他 = 衣服 */
  quick: {
    title: "一键试穿",
    titleRunning: "{kind, select, accessory {正在为你穿戴这件} other {正在为你穿上这件}}",
    titleResult: "穿在你身上",
    signIn: "登录后一键试穿",
    buildAvatar: "先建立你的形象",
    tryOn: "一键试穿",
    again: "再试一次",
    descSignedOut: "用你的数字分身，一键看这件穿在你身上",
    descNoBase: "上传 3–5 张照片生成你的数字分身，之后每件衣服都能一键试穿",
    descResult: "这是你{kind, select, accessory {穿戴} other {穿上}}「{name}」的样子 · 点图放大",
    descReady: "{base, select, twin {用你的数字分身} other {用你的正面全身照}}，{kind, select, accessory {约 45 秒看这件穿戴在你身上} other {约 20 秒看这件穿在你身上}}",
    refining: "正在细化：衣长、领型和细节会更贴近商品图，好了自动替换",
    running: "把「{name}」{kind, select, accessory {穿戴} other {穿上}}到你身上 · {s} 秒",
    altResult: "{kind, select, accessory {穿戴} other {穿上}}{name}的你",
    altTwin: "你的数字分身",
    altPhoto: "你的正面全身照",
    emptySignedIn: "还没有你的形象",
    emptySignedOut: "登录后在这里看到你自己",
    zoom: "放大查看",
    labelRefining: "正在细化",
    labelTwin: "你的分身",
  },
  /** 上身效果画廊（本人场景图 / 演示模特） */
  gallery: {
    title: "上身效果",
    titleOwn: "你的上身效果",
    titleDemo: "模特上身",
    titleRunning: "正在为你生成上身效果",
    running: "把你穿上「{name}」放进两个场景里 · {s} 秒",
    livePending: "实况效果正在生成，悬停或长按可先预览",
    liveReady: "悬停或长按，看它动起来",
    empty: "用你的形象，看这件穿在你身上、走进不同场景的样子",
    signIn: "登录后生成我的上身效果",
    generate: "生成我的上身效果",
    regenerate: "重新生成",
    regenerateMine: "重新生成我的上身效果",
    uploading: "正在上传…",
    uploadPhoto: "或上传一张正面全身照",
    photoTips: "站直、正面、光线充足；与试穿共用，只传一次",
    uploadError: "照片上传失败，请再试一次",
    generateError: "生成失败，请稍后再试",
    lightbox: "试穿图大图",
    lightboxAlt: "穿上{name}的你",
    /** 生成场景图约 30 秒的阶段文案 */
    stages: {
      staging: "正在布景",
      dressing: "正在为你换上这件",
      lighting: "正在调光",
      finishing: "正在收尾",
    },
  },
};

export default item;
