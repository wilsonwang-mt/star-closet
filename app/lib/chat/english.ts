// 英文输入 → 规则层认得的中文关键词（D70）。纯函数，服务端与测试共用。
// 规则层（lib/locate/core.ts）的词表只认中文；这里把常见的英文说法换成那里认得的中文词：场合、风格、预算、性别、季节、
// 功能页、否定（not too formal → 别太正式），以及英文界面上追问 chip 的说法（A bit cheaper、Try another style、Only womenswear）。
// - 只用于规则解析（理解行、初筛提示、没有 AI 时的兜底）；发给 Claude 的仍是用户原话。
// - 中文输入原样通过（没有可匹配的英文词）；词表刻意保持很小，认不出的英文交给 AI 层理解。
// - 换出的中文词前后留空格，不会和相邻的词粘在一起被二次命中。

/** [英文正则源（不含边界，大小写不敏感）, 规则层认得的中文词]。数组顺序即优先级：长的、具体的在前。 */
type Rule = readonly [string, string];

// 主理人英文名按子串匹配（core.ts personNames）：这些常见词里含有 sue / leo / moss，先换掉，免得被当成“像谁”
const MASKS: Rule[] = [
  ["suede", "麂皮"],
  ["t?issues?", "问题"],
  ["pursue", "追求"],
  ["leopard(?:[- ]print)?", "豹纹"],
  ["leotards?", "紧身衣"],
  ["moss[- ]green", "苔绿"],
];

const PRICE: Rule[] = [
  ["(?:a bit |a little |slightly |even |much )?cheaper|less expensive|lower (?:the )?budget|too (?:expensive|pricey)", "再便宜一点"],
  ["money is no object|quality first|high[- ]end|premium|splurge|price doesn'?t matter", "质感好"],
  ["cheap|affordable|inexpensive|budget[- ]friendly|on a budget|student|good value|value for money|budget", "平价"],
];

const FOLLOW_UP: Rule[] = [
  ["(?:try |show me |show )?(?:another|a different|different|other) (?:style|closet|vibe|look)s?|something (?:else|different)", "换个风格"],
];

const GENDER: Rule[] = [
  [
    "wom[ae]n(?:'?s)?(?:wear)?|female|ladies|(?:for|as) (?:a )?(?:girls?|her)|(?:my )?(?:girlfriend|wife|mom|mum|mother|sister|bestie)|i'?m (?:a )?girl|a dress|dresses|skirts?",
    "女装",
  ],
  ["m[ae]n(?:'?s)?(?:wear)?|male|guys?|(?:for|as) (?:a )?him|(?:my )?(?:boyfriend|husband|dad|father|brother)|i'?m (?:a )?guy", "男装"],
  ["unisex|gender[- ]?neutral|genderless", "中性"],
];

const SEASON: Rule[] = [["summer|hot weather|breathable|short[- ]sleeves?", "夏天"]];

const PAGES: Rule[] = [
  ["(?:all|every|which|how many) closets?", "全部衣橱"],
  ["fitting[- ]room|my looks|saved looks|favou?rites", "试衣间"],
  ["try(?:ing)?[- ]?(?:it |this |them |these )?on|virtual try[- ]?on", "试穿"],
  ["digital twin|avatar|selfie", "数字分身"],
  ["shopping bag|my bag|cart|basket|check ?out|place (?:an )?order", "购物袋"],
  ["profile|my details|personal info", "档案"],
  ["sign(?:ing)? (?:in|up)|log(?:ging)? ?in|register|account", "登录"],
];

// 风格先于场合，与 core.ts 的解析顺序一致（smart casual 先被认成风格，casual 就不会再算成日常）
const STYLE: Rule[] = [
  ["smart[- ]casual|business[- ]casual|polished|dapper|gentlemanly", "体面"],
  ["quiet[- ]luxury|old[- ]money|stealth[- ]wealth|minimal(?:ist|ism)?|understated|clean[- ]lines?", "静奢"],
  ["french(?:[- ](?:girl|chic|style))?|parisian|effortless|breton(?: stripes?)?", "法式"],
  ["gorpcore|techwear|outdoorsy|functional", "机能"],
  ["city[- ]?boy|japanese(?:[- ]style)?", "日系"],
  ["new[- ]chinese(?:[- ]style)?|neo[- ]chinese|chinese[- ]style|oriental|qipao|cheongsam|mamianqun|horse[- ]face skirt", "新中式"],
  ["k[- ]?style|korean(?:[- ]style)?|sweet[- ](?:and|&)[- ]cool|preppy|cute|edgy", "韩系"],
  ["elegant|graceful|feminine|gentle|soft(?:er)?|ladylike|refined|delicate", "优雅"],
  ["warm(?:er)?[- ](?:colou?rs?|tones?|shades|palette)|earth[- ]?tones?|earthy|maillard|caramel|mocha|cozy|warm(?:er)?", "暖色"],
  ["americana|amekaji|work[- ]?wear|denim|jeans", "工装"],
  ["vintage|retro", "复古"],
];

const OCCASION: Rule[] = [
  ["(?:outdoor|garden|lawn|beach)[- ]wedding|wedding outdoors", "户外婚礼"],
  ["weddings?(?:[- ](?:guest|party|banquet|reception)s?)?|bridesmaids?", "婚礼"],
  ["business[- ]trip|work[- ]trip", "出差"],
  ["(?:company|office|work|annual|year[- ]end)[- ](?:party|parties|gala|dinner)", "年会"],
  ["afternoon[- ]tea|high[- ]tea|tea[- ]party", "下午茶"],
  ["dinner[- ]party|gala|banquet|cocktail(?:[- ]party)?|black[- ]tie", "晚宴"],
  ["(?:job[- ])?interviews?", "面试"],
  [
    "meet(?:ing)? (?:the|his|her|my|their) (?:parents|family|in-laws)|family (?:visit|dinner|gathering|reunion)|(?:lunar|chinese) new year|spring festival",
    "过年",
  ],
  ["christmas|xmas|festive|holidays|holiday season|new year'?s eve", "节日"],
  ["formal|business", "正式"],
  ["sports?|gym|work[- ]?outs?|running|cycling|athletic|exercise", "运动"],
  // 英文里 work 多半是动词（“Would this work for a wedding?”），只认名词用法
  ["(?:for|at|to|after) work|work ?days?|work ?weeks?|workplace|office|commut(?:e|ing)|meetings?|9[- ]to[- ]5", "通勤"],
  ["(?:first[- ]|blind[- ])?dates?|date[- ]night|movie[- ]night", "约会"],
  ["concerts?|music[- ]festival|festival|gigs?|live[- ]show|clubbing", "演唱会"],
  ["part(?:y|ies)|get[- ]togethers?|drinks|bar|hang(?:ing)?[- ]?out|gatherings?", "聚会"],
  ["exhibitions?|museums?|galler(?:y|ies)|art[- ]shows?", "看展"],
  ["photo[- ]?shoots?|photos|pictures|graduation[- ]photos?", "拍照"],
  ["camping", "露营"],
  ["hik(?:e|es|ing)|trek(?:king)?|mountains?|outdoors?", "爬山"],
  ["travel(?:l?ing)?|trips?|vacation|holiday|getaway", "旅行"],
  ["night[- ]out|going[- ]out", "出街"],
  ["weekends?|casual|everyday|daily|coffee|shopping|brunch|errands", "周末"],
];

// 否定只用于风格与场合：not too formal / nothing too formal / less formal / avoid formal → 别太正式（core.ts 的 NEG 会认出来）
const NEGATION = String.raw`(?:(?:not|nothing|anything|isn't|aren't)\s+(?:too|overly|so)\s+|not\s+|no\s+|avoid(?:ing)?\s+|without\s+|less\s+|too\s+)`;

const bounded = (src: string) => new RegExp(String.raw`\b(?:${src})\b`, "gi");

function replaceAll(text: string, rules: Rule[], negatable = false): string {
  let out = text;
  for (const [src, zh] of rules) {
    if (negatable) out = out.replace(new RegExp(String.raw`\b${NEGATION}(?:${src})\b`, "gi"), ` 别太${zh} `);
    out = out.replace(bounded(src), ` ${zh} `);
  }
  return out;
}

const NUM = String.raw`(\d+(?:\.\d+)?)\s*(k)?`;
const BUDGETS = [
  // under 1500 / budget 1500 / budget is ¥1.5k / up to 2000 rmb
  new RegExp(
    String.raw`\b(?:budget(?:\s+(?:is|of|around|about))?|max(?:imum)?|up to|under|below|less than|within|no more than|at most|around|about)\s*:?\s*(?:¥|￥|rmb\s*|cny\s*)?${NUM}\b(?:\s*(?:rmb|cny|yuan|kuai)\b)?`,
    "gi",
  ),
  // ¥1500 / rmb 800
  new RegExp(String.raw`(?:¥|￥|\brmb\s*|\bcny\s*)${NUM}\b`, "gi"),
  // 800 yuan
  new RegExp(String.raw`\b${NUM}\s*(?:rmb|cny|yuan|kuai)\b`, "gi"),
];

function amount(n: string, k: string | undefined) {
  return Math.round(Number(n) * (k ? 1000 : 1));
}

/** 英文说法换成规则层认得的中文词；中文原样返回。 */
export function normalizeEnglish(input: string): string {
  if (!/[a-z]/i.test(input)) return input;
  let text = input.replace(/[‘’]/g, "'");
  // 1,500 → 1500
  while (/(\d),(\d{3})(?!\d)/.test(text)) text = text.replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
  text = replaceAll(text, MASKS);
  for (const re of BUDGETS) text = text.replace(re, (_m, n: string, k?: string) => ` 预算 ${amount(n, k)} `);
  text = replaceAll(text, PRICE);
  text = replaceAll(text, FOLLOW_UP);
  text = replaceAll(text, GENDER);
  text = replaceAll(text, SEASON);
  text = replaceAll(text, PAGES);
  text = replaceAll(text, STYLE, true);
  text = replaceAll(text, OCCASION, true);
  return text.replace(/\s{2,}/g, " ").trim();
}
