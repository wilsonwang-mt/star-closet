// 有授权图片时显示图片；没有就用色块和名称，不使用任何人的身体照片。
const SWATCH: Record<string, string> = {
  米白: "#efe6d6", 白: "#f6f4ef", 黑: "#2a2826", 雾蓝: "#b7c6d3", 香槟: "#e5d3ae", 鼠尾草绿: "#b6c2a7",
  "蓝/白": "#c9d6e6", 燕麦: "#ddd0b8", 浅蓝: "#b9cde0", 驼: "#c19a6b", 灰: "#b5b3ae", 卡其: "#c8b48b",
  奶白: "#f3ecdf", 浅棕: "#b38b62", 裸色: "#e2c2a8", 金: "#d8bb80", 香槟金: "#d9c08c", 原木: "#c9a678",
  米: "#eadfca", 玳瑁: "#8a5a35",
};

export default function ItemThumb({ name, image, color }: { name: string; image: string | null; color: string }) {
  if (image) {
    return (
      <div className="thumb" style={{ background: "#f3eee5" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={name} loading="lazy" />
      </div>
    );
  }
  const bg = SWATCH[color] ?? "#ddd5c8";
  const dark = ["黑", "玳瑁"].includes(color);
  return (
    <div className="thumb" style={{ background: bg, color: dark ? "#f2efe9" : "#3a332b" }} aria-label={name}>
      {color}
    </div>
  );
}
