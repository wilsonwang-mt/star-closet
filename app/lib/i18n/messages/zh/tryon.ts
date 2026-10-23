// 中文（源）· 2D 试穿（逐件、整套、一键试穿）。键名用英文小驼峰，按界面区域分组；占位符写 {name}，复数写 {n, plural, other {# 件}}。
const tryon = {
  /** 试穿面板标题与整套入口按钮。 */
  onMe: "穿在我身上",
  /** 列表分隔（品类名、单品名之间）。 */
  listSep: "、",

  /** 等待中的真实阶段（components/tryon/shared.tsx stageLabel）。 */
  stage: {
    sending: "正在提交",
    queued: "排队中",
    queuedAhead: "排队中 · 前面 {n} 位",
    generating: "生成中",
    refining: "正在细化",
  },
  /** 一键试穿按时间推进的叙述文案（不对应真实进度）。 */
  quickStages: {
    reading: "正在读取你的形象",
    dressing: "正在为你换上这件",
    lighting: "正在调整光影",
    finishing: "正在收尾",
  },
  elapsed: {
    seconds: "{sec} 秒",
    minutes: "{min} 分 {sec} 秒",
  },
  errors: {
    failed: "试穿失败，请稍后再试",
    network: "网络异常，请稍后再试",
    notFound: "没有找到这次试穿，请再试一次",
    uploadFailed: "上传失败，请稍后再试",
    deleteFailed: "删除失败，请稍后再试",
  },
  /** 同意（D47）：如实写明处理方。provider 是服务端给的处理方名称缺省时的兜底。 */
  consent: {
    agree: "同意把我的形象照片发送给 {provider}生成试穿图",
    provider: "fal.ai 上的 AI 模型",
  },
  avatar: {
    createFirst: "先建立你的形象",
    manage: "管理我的形象",
    twinAlt: "你的数字分身",
    photoAlt: "你的正面全身照",
    photo: "你的照片",
    wearingAlt: "穿上{name}的你",
  },
  actions: {
    tryAgain: "再试一次",
    start: "开始试穿",
    done: "完成",
    deleteImage: "删除这张",
    enlarge: "放大查看",
    uploading: "上传中…",
    viewDetails: "看完整详情",
  },
  zoom: {
    dialog: "试穿图大图",
    enlargeResult: "放大查看试穿图",
  },

  /** 浏览中的一键试穿（QuickTryOn）。kind：accessory（鞋包配饰，“穿戴”）/ garment（衣服，“穿上”）。 */
  quick: {
    button: "一键试穿",
    buttonAria: "一键试穿：{name}",
    title: "一键试穿",
    noAvatarLead: "先建立你的形象，之后每件都能一键试穿。",
    noAvatarHint: "上传 3–5 张照片，生成你的数字分身。",
    createTwin: "建立我的数字分身",
    running: "{kind, select, accessory {正在为你穿戴这件} other {正在为你穿上这件}}",
    runningMeta: "{kind, select, accessory {把「{name}」穿戴到你身上} other {把「{name}」穿上到你身上}} · {sec} 秒",
    resultTitle: "穿在你身上",
    refiningNote: "正在细化：衣长、领型和细节会更贴近商品图，好了自动替换",
    resultNote: "{kind, select, accessory {这是你穿戴「{name}」的样子} other {这是你穿上「{name}」的样子}}",
    intro:
      "{base, select, twin {用你的数字分身} other {用你的正面全身照}}，{kind, select, accessory {约 45 秒看「{name}」穿戴在你身上} other {约 20 秒看「{name}」穿在你身上}}",
    resultAlt: "{kind, select, accessory {穿戴{name}的你} other {穿上{name}的你}}",
    save: "加入试衣间",
    saveFirst: "先把这件加入试衣间",
    saved: "已加入试衣间",
    goToFittingRoom: "去试衣间",
  },

  /** 整套“穿在我身上”（TryOn）。 */
  outfit: {
    titleRunning: "正在为你换上这一身",
    titleDone: "穿上这一身",
    changePhoto: "换一张",
    uploadPhoto: "上传正面全身照",
    uploadHint: "站直、正面、光线充足",
    thisLook: "这一套 · {chain}",
    puttingOn: "依次换上{list}",
    progress: "第 {step}/{total} 件 · {stage}",
    lookLabel: "这一套",
    onYou: "穿在你身上",
    resultAlt: "穿上这一身的你",
    applied: "已试穿：{list}",
    notWorn: "未上身：{list}",
  },

  /** 试衣间逐件试穿（LookTryOn）。 */
  look: {
    worn: "已穿上",
    rowBusyAria: "正在穿上{name}，查看",
    rowBusy: "正在穿上 · {elapsed}",
    rowView: "查看试穿",
    rowTryAria: "试穿这件：{name}",
    rowTry: "试穿这件",
    wearAllRunning: "正在穿上 {step}/{total}",
    wearAll: "整套试穿（{n} 件）",
    wearOne: "试穿这一套",
    peekChain: "正在穿上 {step}/{total}：{name}",
    peekPending: "正在为你穿上 {name}",
    peekWorn: "已穿上 {n} 件",
    startFromPhoto: "从你的照片开始",
    peekStage: "{stage} · 已用 {elapsed}",
    peekFrames: "穿搭进度 · {n} 张",
    noAvatar: "还没有你的形象",
    noAvatarHint: "上传 3–5 张照片，生成你的数字分身",
    uploadDirect: "或直接上传一张正面全身照",
    waitChain: "正在穿上 {step}/{total}：",
    waitSingle: "正在为你穿上 ",
    slow: "比平时稍久，仍在进行",
    barChain: "整套试穿 · 第 {step} 件，共 {total} 件",
    barPending: "可以先关掉，穿好后会出现在这一套里",
    barSelected: "下一件穿在这一张上",
    barTwin: "从你的数字分身开始，一件一件穿上",
    restartTwin: "从我的分身重新开始",
    restartPhoto: "从我的照片重新开始",
    restartUpload: "上传照片重新开始",
    changePhoto: "换一张照片",
    progress: "穿搭进度",
    frameTwin: "分身",
    framePhoto: "照片",
    frameOutfit: "整套",
    frameStep: "第 {n} 件",
    frameAria: "{caption}：{name}",
    framePending: "穿上中",
    piecesTitle: "这一套 · 一件一件穿上",
    putOn: "穿上",
    putOnAria: "穿上{name}",
    putOnNamed: "穿上 {name}",
  },
};

export default tryon;
