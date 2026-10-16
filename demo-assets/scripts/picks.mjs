// T2 挑选的 8 件主打单品与各自的 2 个场景（第 1 个场景优先做 Live）。
export const SCENES = {
  cafe: { title: "周五的咖啡馆", prompt: "inside a warm Friday-evening café with wooden tables, espresso bar and soft window light" },
  street: { title: "城市街头黄昏", prompt: "on a city street at golden-hour dusk, warm low sun, shop windows and soft bokeh lights" },
  wedding: { title: "户外草坪婚礼", prompt: "at an outdoor lawn wedding, white chairs and floral arch softly blurred behind, late-afternoon sun" },
  gallery: { title: "美术馆", prompt: "in a quiet modern art gallery with pale walls, large framed artworks and skylight glow" },
  seaside: { title: "海边度假", prompt: "on a seaside promenade on holiday, calm sea and soft evening sky behind" },
  market: { title: "周末市集", prompt: "at a weekend open-air market with canvas stalls, flowers and produce softly blurred" },
};
export const PICKS = [
  { id: "I011", model: "f01", scenes: ["street", "cafe"], why: "C01 静奢通勤的主打风衣，版型和卡其色上身辨识度高" },
  { id: "I023", model: "f01", scenes: ["cafe", "seaside"], why: "C02 法式慵懒标志性的藏青白条纹，图案上身一眼可辨" },
  { id: "I071", model: "f01", scenes: ["gallery", "wedding"], why: "C04 新中式的竹青改良旗袍，盘扣与立领细节清楚" },
  { id: "I113", model: "f01", scenes: ["wedding", "gallery"], why: "C06 婚礼宾客的香槟缎面中长裙，对应演示脚本的户外婚礼场景" },
  { id: "I142", model: "f01", scenes: ["street", "market"], why: "C07 美拉德秋冬的摩卡毛呢大衣，色调与香槟金暖光契合" },
  { id: "I160", model: "m01", scenes: ["cafe", "street"], why: "C08 男士都市通勤的藏青休闲西装，男装主打" },
  { id: "I175", model: "m01", scenes: ["market", "seaside"], why: "C09 日系山系的藏青渔夫麻花毛衣，纹理上身清楚" },
  { id: "I191", model: "m01", scenes: ["street", "market"], why: "C10 美式复古工装的原色牛仔夹克（中性），覆盖第 10 间衣橱" },
];
