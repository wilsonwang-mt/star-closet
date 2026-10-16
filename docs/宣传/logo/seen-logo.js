// SEEN. 品牌标识（定稿 2026-10-16）
// 图形：顶灯衣架——问号挂钩 + 灯泡（问号的点）+ 3:1 拱肩衣架 + 灯泡径向光晕。
// 主字标：粗细对比（竖粗横细、无衬线）。S 按切线方向逐点生成变宽轮廓；句点 = 灯泡。
// 两个光学尺寸：display（宣传片、海报、PPT 封面，字高 ≥ 48px）/ text（网站顶栏、PPT 页脚，字高 < 48px）。
// 视觉补偿：S 上下超出大写高 1.5%；N 斜笔比竖笔细约 7%；字距按字形单独设置。
// 辅助图形：≡（三道横杆）。
// 所有部件带 id 分组（hook / bulb / shoulders / bar / glow / beam / S / E1 / E2 / N / period），供动效拆层。
// 依赖浏览器 DOM（S 轮廓用 getPointAtLength 计算），由 final.html 导出静态 SVG。
(function () {
  const PALETTE = {
    dark:  { ink: "#f4f2ed", accent: "#e8cf9c", core: "#fff6e0", bg: "#0b0d10", glow: true },
    light: { ink: "#1a150d", accent: "#8a6a36", core: "#8a6a36", bg: "#f4efe6", glow: false },
  };
  let uid = 0;
  const next = (p) => `${p}${++uid}`;

  // —— 图形（局部坐标 240×200；hero 版向下延伸到 y=330）——
  const BX = 120, BY = 92, L = 36, R = 204, BAR = 148;
  const HOOK = "M 99 42 A 21 21 0 1 1 132 58 Q 120 66 120 76";
  const SHOULDERS = `M ${L} ${BAR} Q 74 110 ${BX} ${BY} Q 166 110 ${R} ${BAR}`;

  /**
   * mode: std 标准 / hero 光束落地 / small 小尺寸（加粗、无光晕）
   * theme: dark / light
   */
  function mark({ mode = "std", theme = "dark", sw } = {}) {
    const c = PALETTE[theme];
    const small = mode === "small";
    sw = sw || (small ? 11 : 5.5);
    const glow = c.glow && !small;
    const id = next("m");
    const out = [`<defs>
      <radialGradient id="${id}b" cx="${BX}" cy="${BY}" r="78" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${c.accent}" stop-opacity="${theme === "dark" ? .78 : .42}"/><stop offset=".35" stop-color="${c.accent}" stop-opacity="${theme === "dark" ? .32 : .16}"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${id}c" x1="0" y1="${BAR}" x2="0" y2="330" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${c.accent}" stop-opacity=".16"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="${id}f"><stop offset="0" stop-color="${c.accent}" stop-opacity=".32"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient>
      <filter id="${id}g" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>`];
    if (mode === "hero") {
      out.push(`<g id="beam"><path d="M ${L + 6} ${BAR} L ${R - 6} ${BAR} L ${R + 70} 330 L ${L - 70} 330 Z" fill="url(#${id}c)"/><ellipse cx="${BX}" cy="330" rx="150" ry="33" fill="url(#${id}f)"/></g>`);
    }
    if (!small) out.push(`<g id="glow"><path d="${SHOULDERS} Z" fill="url(#${id}b)"/></g>`);
    out.push(`<g id="shoulders"><path d="${SHOULDERS}" fill="none" stroke="${c.ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></g>`);
    out.push(`<g id="bar"><line x1="${L}" y1="${BAR}" x2="${R}" y2="${BAR}" stroke="${c.ink}" stroke-width="${sw}" stroke-linecap="round"/></g>`);
    out.push(`<g id="hook"><path d="${small ? "M 98 40 A 22 22 0 1 1 133 57 Q 120 65 120 72" : HOOK}" fill="none" stroke="${c.accent}" stroke-width="${sw}" stroke-linecap="round"/></g>`);
    const r = small ? sw * .95 : sw * 1.35;
    out.push(`<g id="bulb">` +
      (glow ? `<circle cx="${BX}" cy="${BY}" r="13" fill="${c.accent}" opacity=".7" filter="url(#${id}g)"/>` : "") +
      `<circle cx="${BX}" cy="${BY}" r="${r}" fill="${glow ? c.core : c.accent}"/>` +
      (glow ? `<circle cx="${BX}" cy="${BY}" r="${r}" fill="none" stroke="${c.accent}" stroke-width="${sw * .5}"/>` : "") + `</g>`);
    return out.join("");
  }
  const MARK_BOX = { std: "28 14 184 142", small: "24 12 192 148", hero: "-40 14 320 356" };

  // —— 主字标 SEEN.（大写高 100，基线 y=100）——
  const SIZES = {
    //            横笔   竖笔   斜笔   S 最粗  字距：S→E  E→E  E→N  N→句点  句点半径
    display: { thin: 3.6, thick: 15,   diag: 14,   sMax: 15.5, gaps: [42, 40, 42, 26], dot: 8 },
    text:    { thin: 7.2, thick: 18.5, diag: 17.2, sMax: 19,   gaps: [52, 50, 52, 30], dot: 10 },
  };
  const W = { S: 66, E: 54, N: 72 };

  // S 骨架：斜向脊部；y 经 Y() 映射，让外轮廓上下各超出大写高 1.5
  function sSpine(x, Y) {
    return `M ${x + 58} ${Y(16)} C ${x + 52} ${Y(5)}, ${x + 43} ${Y(2)}, ${x + 33} ${Y(2)} C ${x + 17} ${Y(2)}, ${x + 7} ${Y(12)}, ${x + 7} ${Y(25)} C ${x + 7} ${Y(40)}, ${x + 21} ${Y(45)}, ${x + 33} ${Y(50)} C ${x + 47} ${Y(55)}, ${x + 59} ${Y(61)}, ${x + 59} ${Y(76)} C ${x + 59} ${Y(90)}, ${x + 47} ${Y(98)}, ${x + 32} ${Y(98)} C ${x + 19} ${Y(98)}, ${x + 8} ${Y(93)}, ${x + 4} ${Y(84)}`;
  }
  function contrastS(x, ink, s) {
    const top = -1.5 + s.thin / 2, bottom = 101.5 - s.thin / 2;
    const Y = (y) => (top + (y - 2) * (bottom - top) / 96).toFixed(2);
    const NS = "http://www.w3.org/2000/svg";
    const tmp = document.createElementNS(NS, "svg"); document.body.appendChild(tmp);
    const p = document.createElementNS(NS, "path"); p.setAttribute("d", sSpine(x, Y)); tmp.appendChild(p);
    const len = p.getTotalLength(), n = 300, left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const l = len * i / n, a = p.getPointAtLength(Math.max(0, l - .5)), b = p.getPointAtLength(Math.min(len, l + .5)), c = p.getPointAtLength(l);
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const vert = Math.abs(dy / d);
      const e = Math.min(1, i / 28, (n - i) / 28), taper = .5 - .5 * Math.cos(Math.PI * e);   // 两端平滑收细
      const w = (s.thin + (s.sMax - s.thin) * Math.pow(vert, 1.6)) * (.6 + .4 * taper);
      const nx = -dy / d, ny = dx / d;
      left.push(`${(c.x + nx * w / 2).toFixed(2)} ${(c.y + ny * w / 2).toFixed(2)}`);
      right.push(`${(c.x - nx * w / 2).toFixed(2)} ${(c.y - ny * w / 2).toFixed(2)}`);
    }
    tmp.remove();
    return `<path d="M ${left.join(" L ")} L ${right.reverse().join(" L ")} Z" fill="${ink}"/>`;
  }

  function dot(cx, cy, r, c) {
    if (!c.glow) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.accent}"/>`;
    const id = next("d");
    return `<defs><filter id="${id}" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="${r * 1.1}"/></filter></defs>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 1.9}" fill="${c.accent}" opacity=".75" filter="url(#${id})"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.core}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c.accent}" stroke-width="${r * .38}"/>`;
  }

  /** 返回 { svg, w, h, box } */
  function wordmark({ size = "display", theme = "dark", glow } = {}) {
    const s = SIZES[size], c = { ...PALETTE[theme] };
    if (glow === false || size === "text") c.glow = false;
    const cap = next("c");
    const hair = (d) => `<path d="${d}" fill="none" stroke="${c.ink}" stroke-width="${s.thin}" stroke-linecap="butt"/>`;
    const heavy = (d, w) => `<path d="${d}" fill="none" stroke="${c.ink}" stroke-width="${w}" stroke-linecap="square" clip-path="url(#${cap})"/>`;
    const h = s.thin / 2;
    let x = 0, out = "";
    out += `<g id="S">${contrastS(x, c.ink, s)}</g>`; x += W.S + s.gaps[0];
    for (const k of [1, 2]) {
      const sx = x + s.thick / 2;
      out += `<g id="E${k}">` + heavy(`M ${sx} 0 L ${sx} 100`, s.thick) +
        hair(`M ${sx} ${h} L ${x + 54} ${h} M ${sx} 50 L ${x + 40} 50 M ${sx} ${100 - h} L ${x + 54} ${100 - h}`) + `</g>`;
      x += W.E + (k === 1 ? s.gaps[1] : s.gaps[2]);
    }
    // 斜笔两端与竖笔外缘齐平：在 y=0 处占 [x, x+b]，在 y=100 处占 [x+72-b, x+72]
    const b = s.diag * Math.hypot(72, 100) / 100, x0 = x + b / 2, x1 = x + 72 - b / 2, k = (x1 - x0) / 100;
    out += `<g id="N">` + hair(`M ${x + h} 100 L ${x + h} 0 M ${x + 72 - h} 0 L ${x + 72 - h} 100`) + heavy(`M ${x0 - k * 8} -8 L ${x1 + k * 8} 108`, s.diag) + `</g>`;
    x += W.N;
    const px = x + s.gaps[3] + s.dot;
    out += `<g id="period">${dot(px, 100 - s.dot, s.dot, c)}</g>`;
    const w = px + s.dot + 2;
    return { svg: `<defs><clipPath id="${cap}"><rect x="-20" y="0" width="${w + 40}" height="100"/></clipPath></defs>` + out, w, h: 106, box: `-4 -3 ${w + 8} 106` };
  }

  // —— 辅助图形 ≡ ——
  function bars({ theme = "dark", sw = 9 } = {}) {
    const c = PALETTE[theme];
    return `<path d="M 0 0 L 54 0 M 8 50 L 46 50 M 0 100 L 54 100" fill="none" stroke="${c.ink}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }

  window.SEEN = { PALETTE, mark, MARK_BOX, wordmark, bars };
})();
