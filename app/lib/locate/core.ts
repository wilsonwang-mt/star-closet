// 对话定位的规则层（纯函数，服务端与测试共用；设计见 docs/design/AI对话定位方案.md §3）。
//
// 一句话 → 六个信号：
//   像谁（主理人名 / 衣橱名）直达衣橱；风格 → 衣橱（同一间的 6 套风格标签相同）；场合 → 具体那一套；
//   性别硬过滤（复用 allowedGenders）；预算只加分与写提示语，不扣分、不过滤（改编能把大多数搭配压进预算）；
//   否定（别太正式）用来避开。
// 解析按“最长匹配、命中后消费原词”：先认出「户外婚礼」，再从文本里删掉，避免「户外」二次命中。
// 多轮：只是补充条件（只看女装、再便宜一点、换个风格）时沿用上一轮；提到新场合/风格/人就是换话题，从头解析。
import { parseConstraints } from "../adapt/offline";
import { allowedGenders } from "../adapt/rules";

export type LocateCloset = {
  id: string;
  displayName: string;
  closetName: string;
  closetType: string;
  gender: string;
  tagline: string;
  styleTags: string[];
  avatar: string | null;
  cover: string;
  outfitCount: number;
};

export type LocateOutfit = {
  id: string;
  curatorId: string;
  name: string;
  styleNote: string;
  occasionTags: string[];
  styleTags: string[];
  season: string | null;
  budgetTier: string | null;
  gender: string;
  total: number;
  cover: string | null;
  /** 这套在所属衣橱里的序号（与衣橱页、搭配页的 N° 一致） */
  no: number;
};

export type LocateCatalog = { closets: LocateCloset[]; outfits: LocateOutfit[] };

export const PAGE_KEYS = ["closets", "fitting-room", "avatar", "tryon", "bag", "profile", "login"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

export type QueryGender = "女装" | "男装" | "中性";
export type Tier = "平价" | "适中" | "进阶";

export type LocateQuery = {
  person: string | null;
  styles: string[];
  occasions: string[];
  /** 只说了周末 / 日常 / 逛街这类泛场合 */
  generic: boolean;
  /** 否定命中的标签（或原词） */
  avoid: string[];
  gender: QueryGender | null;
  budget: number | null;
  tier: Tier | null;
  season: "春夏" | null;
  pages: PageKey[];
  /** 「换个风格」：跳过这些衣橱（上一轮展示过的） */
  skipClosets: string[];
  occasionLabels: string[];
  styleLabels: string[];
  avoidLabels: string[];
  /** 识别到的条件，给用户看的短标签（户外婚礼、1500 以内…） */
  labels: string[];
};

// ---------- 词表 ----------
// [正则, 映射到的标签, 给用户看的标签]

const STYLE_WORDS: [RegExp, string[], string][] = [
  [/静奢|老钱|高级感|低调奢华|极简|干净利落|简约/i, ["静奢", "极简"], "静奢极简"],
  [/法式|巴黎|慵懒|条纹/, ["法式", "慵懒"], "法式慵懒"],
  [/机能|gorpcore|户外风|冲锋衣/i, ["机能", "Gorpcore", "户外"], "户外机能"],
  [/山系|city ?boy|日系/i, ["日系", "山系", "City Boy"], "日系山系"],
  [/新中式|国风|东方|中式|马面裙|旗袍|盘扣/, ["新中式", "东方", "雅致"], "新中式"],
  [/韩系|韩剧|甜酷|学院|甜美|甜一点|酷一点/, ["韩系", "甜酷", "学院"], "韩系甜酷"],
  [/优雅|温柔|淑女|仙气|得体|精致/, ["优雅"], "优雅"],
  [/美拉德|大地色|焦糖|摩卡|暖色|暖一点|温暖|暖暖/, ["美拉德", "大地色"], "暖色系"],
  [/smart casual|商务休闲|体面|绅士/i, ["Smart Casual"], "体面"],
  [/美式|工装|阿美咔叽|amekaji|牛仔|丹宁|原色/i, ["美式复古", "工装", "Amekaji"], "美式工装"],
  [/复古/, ["复古"], "复古"],
];

const OCCASION_WORDS: [RegExp, string[], string][] = [
  [/户外婚礼|草坪婚礼|草地婚礼/, ["户外婚礼", "婚礼宾客"], "户外婚礼"],
  [/婚礼|伴娘|喜宴|喝喜酒|婚宴/, ["婚礼宾客"], "婚礼"],
  [/晚宴|宴会|酒会|宴请/, ["晚宴", "正式"], "晚宴"],
  [/正式|隆重|商务/, ["正式"], "正式场合"],
  [/面试|求职/, ["面试"], "面试"],
  [/通勤|上班|开会|办公|早八|职场|例会/, ["通勤"], "通勤"],
  [/出差/, ["出差"], "出差"],
  [/约会|相亲|看电影/, ["约会"], "约会"],
  [/见家长|见亲戚|过年|春节/, ["节日", "聚会"], "过年见家人"],
  [/圣诞|节日|跨年/, ["节日"], "节日"],
  [/年会/, ["年会"], "年会"],
  [/演唱会|音乐节|livehouse|蹦迪/i, ["演唱会"], "演唱会"],
  [/派对|聚会|朋友聚|小酌|酒吧|聚餐/, ["聚会"], "聚会"],
  [/看展|博物馆|美术馆|展览/, ["看展"], "看展"],
  [/拍照|毕业照|打卡|写真/, ["拍照"], "拍照"],
  [/下午茶|茶会|喝茶/, ["下午茶", "茶会"], "下午茶"],
  [/露营/, ["露营", "户外"], "露营"],
  [/爬山|徒步|登山|山里|户外/, ["户外", "运动"], "户外"],
  [/运动|健身|跑步|骑行/, ["运动"], "运动"],
  [/旅行|旅游|度假|出去玩|飞去|雪山/, ["旅行"], "旅行"],
  [/出街|夜晚|夜里/, ["出街"], "出街"],
];

const GENERIC = /周末|逛街|休闲|日常|随便穿|咖啡/;

const PAGE_WORDS: [RegExp, PageKey][] = [
  [/全部衣橱|所有衣橱|有哪些衣橱|几间衣橱/, "closets"],
  [/试衣间|我保存的|我的搭配|收藏/, "fitting-room"],
  [/3d|三维|形象|数字人|数字分身|分身|建模|自拍/i, "avatar"],
  [/试穿|穿在我身上|上身效果|换装/, "tryon"],
  [/购物袋|购物车|下单|结算/, "bag"],
  [/档案|个人资料|个人信息/, "profile"],
  [/登录|注册|账号/, "login"],
];

const MALE = /男生|男士|男装|男朋友|男友|老公|我是男|男的|给他|爸爸|兄弟/;
const FEMALE = /女生|女士|女装|女朋友|女友|老婆|我是女|女的|给她|妈妈|闺蜜|裙子|连衣裙/;
const NEUTRAL = /中性|无性别|unisex/i;

const NEG = /(?:别太|不要太|不想太|别|不要|不想|不用|不穿)([一-龥A-Za-z]{1,4})/g;
const CHEAPER = /再便宜|便宜一?点|再省|预算低一点|贵了/;
const CHEAP = /便宜|平价|学生党|性价比|省钱|不贵/;
const PRICEY = /贵一点也行|质感好|预算充足|不差钱/;
const SUMMER = /夏天|夏季|很热|天热|透气|短袖/;
const OTHER_STYLE = /换个风格|换一种风格|别的风格|其他风格|换一间|别的衣橱/;

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseBudget(text: string): number | null {
  const c = parseConstraints(text).budget;
  if (c !== null) return c;
  const k = text.match(/(\d+(?:\.\d+)?)\s*(?:k|K|千)/);
  if (k) return Math.round(Number(k[1]) * 1000);
  const cn = text.match(/([一二两三四五六七八九])千([一二两三四五六七八九])?/);
  if (cn) return CN_NUM[cn[1]] * 1000 + (cn[2] ? CN_NUM[cn[2]] * 100 : 0);
  const bare = text.match(/(?:^|[^\d])(\d{3,5})(?:[^\d]|$)/);
  if (bare && /预算|以内|以下|左右|块|元|¥/.test(text)) return Number(bare[1]);
  return null;
}

/** 主理人的可识别名字：中文名、英文名（长度 ≥ 2）。衣橱名不算——「新中式」「法式慵懒」这类衣橱名同时是风格词，交给风格词表。 */
function personNames(c: Pick<LocateCloset, "displayName">) {
  return c.displayName
    .split(/\s+/)
    .filter((p) => p.length >= 2)
    .map((p) => p.toLowerCase());
}

function scan(text: string, words: [RegExp, string[], string][]) {
  let rest = text;
  const tags: string[] = [];
  const labels: string[] = [];
  for (const [re, ts, label] of words) {
    if (!re.test(rest)) continue;
    rest = rest.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), " ");
    for (const t of ts) if (!tags.includes(t)) tags.push(t);
    if (!labels.includes(label)) labels.push(label);
  }
  return { rest, tags, labels };
}

const uniq = <T,>(a: T[]) => [...new Set(a)];

export function emptyQuery(): LocateQuery {
  return {
    person: null,
    styles: [],
    occasions: [],
    generic: false,
    avoid: [],
    gender: null,
    budget: null,
    tier: null,
    season: null,
    pages: [],
    skipClosets: [],
    occasionLabels: [],
    styleLabels: [],
    avoidLabels: [],
    labels: [],
  };
}

export function parseQuery(
  input: string,
  closets: Pick<LocateCloset, "id" | "displayName" | "closetName">[],
  prev?: LocateQuery | null,
  /** 上一轮展示过的衣橱（「换个风格」时跳过） */
  prevShownClosets: string[] = [],
): LocateQuery {
  const q = emptyQuery();
  let text = input.trim();

  // 否定：先摘出来，再从正向匹配里去掉
  const avoidWords: string[] = [];
  text = text.replace(NEG, (_m, w: string) => {
    avoidWords.push(w);
    return " ";
  });
  for (const w of avoidWords) {
    const hit = [...scan(w, STYLE_WORDS).tags, ...scan(w, OCCASION_WORDS).tags];
    q.avoid.push(...(hit.length ? hit : [w]));
  }
  q.avoid = uniq(q.avoid);
  q.avoidLabels = avoidWords.length ? [`不要太${avoidWords.join("、")}`] : [];

  const lower = text.toLowerCase();
  for (const c of closets) {
    if (personNames(c).some((n) => lower.includes(n))) {
      q.person = c.id;
      break;
    }
  }

  const st = scan(text, STYLE_WORDS);
  q.styles = st.tags;
  q.styleLabels = st.labels;
  const oc = scan(st.rest, OCCASION_WORDS);
  q.occasions = oc.tags;
  q.occasionLabels = oc.labels;
  q.generic = GENERIC.test(oc.rest);
  if (q.generic && q.occasions.length === 0) {
    q.occasions = ["周末", "休闲"];
    q.occasionLabels = ["周末日常"];
  }

  q.gender = MALE.test(input) ? "男装" : FEMALE.test(input) ? "女装" : NEUTRAL.test(input) ? "中性" : null;
  q.budget = parseBudget(input);
  if (q.budget === null && !CHEAPER.test(input)) q.tier = CHEAP.test(input) ? "平价" : PRICEY.test(input) ? "进阶" : null;
  q.season = SUMMER.test(input) ? "春夏" : null;
  for (const [re, page] of PAGE_WORDS) if (re.test(input) && !q.pages.includes(page)) q.pages.push(page);
  const otherStyle = OTHER_STYLE.test(input);

  // 多轮：这一句只是补充条件（只看女装、再便宜一点、换个风格）时沿用上一轮；提到新场合 / 风格 / 人就是换话题，重新开始
  const newTopic = q.person !== null || q.styles.length > 0 || (q.occasions.length > 0 && !q.generic);
  if (prev && !newTopic) {
    q.person = otherStyle ? null : prev.person;
    q.styles = otherStyle ? [] : prev.styles;
    q.styleLabels = otherStyle ? [] : prev.styleLabels;
    if (q.occasions.length === 0) {
      q.occasions = prev.occasions;
      q.occasionLabels = prev.occasionLabels;
      q.generic = prev.generic;
    }
    q.avoid = uniq([...prev.avoid, ...q.avoid]);
    q.avoidLabels = uniq([...prev.avoidLabels, ...q.avoidLabels]);
    q.season = q.season ?? prev.season;
    q.skipClosets = otherStyle ? uniq([...prev.skipClosets, ...prevShownClosets]) : prev.skipClosets;
    q.gender = q.gender ?? prev.gender;
    if (q.budget === null && q.tier === null) {
      if (CHEAPER.test(input)) {
        q.budget = prev.budget !== null ? Math.round((prev.budget * 0.7) / 100) * 100 : null;
        q.tier = prev.budget === null ? "平价" : null;
      } else {
        q.budget = prev.budget;
        q.tier = prev.tier;
      }
    }
  } else if (CHEAPER.test(input) && q.budget === null && q.tier === null) {
    q.tier = "平价";
  }

  const personName = q.person ? closets.find((c) => c.id === q.person)?.displayName : null;
  q.labels = uniq(
    [
      personName ? `像 ${personName}` : null,
      ...q.occasionLabels,
      ...q.styleLabels,
      q.gender,
      q.budget !== null ? `${q.budget} 以内` : q.tier === "平价" ? "平价" : q.tier === "进阶" ? "质感优先" : null,
      ...q.avoidLabels,
    ].filter((x): x is string => Boolean(x)),
  );
  return q;
}

export function isRecognized(q: LocateQuery) {
  return Boolean(
    q.person ||
      q.styles.length ||
      q.occasions.length ||
      q.gender ||
      q.budget !== null ||
      q.tier ||
      q.season ||
      q.avoid.length ||
      q.skipClosets.length,
  );
}

// ---------- 打分 ----------

const TIER_ORDER: Tier[] = ["平价", "适中", "进阶"];

export type ScoredOutfit = { outfit: LocateOutfit; score: number; why: string[] };

export function scoreOutfit(o: LocateOutfit, q: LocateQuery): ScoredOutfit {
  let s = 0;
  const why: string[] = [];
  if (q.person && o.curatorId === q.person) {
    s += 5;
    why.push("像谁");
  }
  const occ = q.occasions.filter((t) => o.occasionTags.includes(t));
  const genericOnly = q.generic && q.occasions.every((t) => t === "周末" || t === "休闲");
  if (occ.length) {
    s += 3 + 0.5 * (occ.length - 1);
    why.push(`场合：${occ.join("、")}`);
  }
  if (q.generic && !genericOnly && o.occasionTags.some((t) => t === "周末" || t === "休闲")) s += 0.5;
  const sty = q.styles.filter((t) => o.styleTags.includes(t));
  if (sty.length) {
    s += 2 + 0.5 * (sty.length - 1);
    why.push(`风格：${sty.join("、")}`);
  }
  if (q.season === "春夏" && o.season === "四季") s += 1;
  if (q.tier && o.budgetTier) {
    const d = Math.abs(TIER_ORDER.indexOf(q.tier) - TIER_ORDER.indexOf(o.budgetTier as Tier));
    s += d === 0 ? 1 : d === 1 ? 0.5 : 0;
  }
  if (q.budget !== null && o.total <= q.budget) {
    s += 1;
    why.push("预算内");
  }
  if (q.avoid.some((a) => o.occasionTags.includes(a) || o.styleTags.includes(a) || o.name.includes(a))) {
    s -= 2;
    why.push("避开");
  }
  return { outfit: o, score: s, why };
}

export type LocateResult = {
  query: LocateQuery;
  recognized: boolean;
  /** 按分数排好的搭配（已按性别过滤），每间最多 2 套 */
  outfits: ScoredOutfit[];
  /** 按最佳搭配分数排好的衣橱（不同衣橱） */
  closets: { closet: LocateCloset; score: number; best: LocateOutfit }[];
  /** 没说性别、前两名性别不同且分数接近：追问 */
  ambiguousGender: boolean;
  pages: PageKey[];
  text: string;
  chips: string[];
};

export function genderAllows(q: LocateQuery, gender: string) {
  return !q.gender || allowedGenders(q.gender).includes(gender as never);
}

export function locate(catalog: LocateCatalog, q: LocateQuery): LocateResult {
  const recognized = isRecognized(q);
  const order = new Map(catalog.closets.map((c, i) => [c.id, i]));
  const scored = catalog.outfits
    .filter((o) => order.has(o.curatorId) && genderAllows(q, o.gender) && !q.skipClosets.includes(o.curatorId))
    .map((o) => scoreOutfit(o, q))
    .sort(
      (a, b) =>
        b.score - a.score ||
        // 平手：在预算内且更接近预算的优先，再按首页衣橱顺序、目录顺序
        (q.budget !== null ? Math.abs(q.budget - a.outfit.total) - Math.abs(q.budget - b.outfit.total) : 0) ||
        (order.get(a.outfit.curatorId)! - order.get(b.outfit.curatorId)!) ||
        a.outfit.no - b.outfit.no,
    );

  const perCloset = new Map<string, number>();
  const outfits: ScoredOutfit[] = [];
  const closets: LocateResult["closets"] = [];
  for (const s of scored) {
    const n = perCloset.get(s.outfit.curatorId) ?? 0;
    if (n === 0) {
      const closet = catalog.closets.find((c) => c.id === s.outfit.curatorId)!;
      closets.push({ closet, score: s.score, best: s.outfit });
    }
    if (n < 2) outfits.push(s);
    perCloset.set(s.outfit.curatorId, n + 1);
  }

  const hasSignal = recognized && (outfits[0]?.score ?? 0) > 0;
  const ambiguousGender =
    hasSignal &&
    !q.gender &&
    closets.length > 1 &&
    closets[0].closet.gender !== closets[1].closet.gender &&
    closets[0].closet.gender !== "中性" &&
    closets[1].closet.gender !== "中性" &&
    closets[0].score - closets[1].score < 1;

  return {
    query: q,
    recognized,
    outfits: hasSignal ? outfits : [],
    closets: hasSignal ? closets : [],
    ambiguousGender,
    pages: q.pages,
    text: replyText(q, hasSignal, outfits, ambiguousGender),
    chips: replyChips(q, hasSignal, ambiguousGender),
  };
}

// ---------- 一句话与追问（规则层；AI 回来后会被替换） ----------

function replyText(q: LocateQuery, hasSignal: boolean, outfits: ScoredOutfit[], ambiguous: boolean) {
  if (!hasSignal) {
    if (q.pages.length) return "在这里：";
    return "说说去哪儿、什么场合、预算多少，我帮你找衣橱和搭配。";
  }
  const parts: string[] = [];
  parts.push(q.labels.length ? `${q.labels.join("、")}——先看这几套。` : "先看这几套。");
  if (q.season === "春夏") parts.push("这批衣橱以秋冬为主，先挑了四季都能穿的。");
  if (ambiguous) parts.push("男装女装都有合适的。");
  const top = outfits[0]?.outfit;
  if (q.budget !== null && top && top.total > q.budget) parts.push("原价超出预算，进到搭配页说一句就能按预算改。");
  return parts.join("");
}

function replyChips(q: LocateQuery, hasSignal: boolean, ambiguous: boolean) {
  if (!hasSignal) return q.pages.length ? [] : ["户外婚礼，1500 以内", "男生第一次约会", "过年回家，新中式一点"];
  const chips: string[] = [];
  if (ambiguous) chips.push("只看女装", "只看男装");
  if (chips.length < 3) chips.push(q.budget !== null || q.tier ? "再便宜一点" : "预算 1000 以内");
  if (chips.length < 3) chips.push("换个风格");
  return chips.slice(0, 3);
}
