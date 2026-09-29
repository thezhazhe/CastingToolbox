// ============================================================
// 截面形状识别（PHASE 94 · 94.txt §五/§六）
//
// 职责：给**一个**已经切出来的截面多边形，判断它到底是不是圆 / 矩形 / 梯形，
//   还是只能如实叫"不规则"。
//
// 为什么必须新开一个模块（94.txt §一 要求先查证，这里是查证结论）：
//   · 全库原先**没有任何截面形状识别**。objectMetrics 只给"面积是多少"，
//     至于这个面积是圆算出来的还是方算出来的，它不回答。
//   · 94.txt §五 明确要求按形状分别输出 D / W×H / 上底·下底·高。
//   · 94.txt §十八 禁止"用 bbox 直接冒充有效截面积"、禁止"对无法可靠识别的异形截面
//     给出假精确值" —— 所以本模块的每一类判定都必须带**可复算的几何证据**，
//     拿不出证据就退到 irregular（不规则），而不是硬套公式。
//
// ★ 面积口径（这是本模块最要紧的一条，94.txt §五/§七 的总截面积就建在它上面）：
//     圆形   → A = πD²/4，其中 D = 2√(A实测/π) —— 等价直径，**由实测面积反推**，
//              所以 πD²/4 ≡ A实测，不会凭空多出几个百分点。
//     矩形   → A = W × H（W/H 取最小面积外接矩形，94.txt §五B 的定义式）。
//     梯形   → A = (a+b)h/2（94.txt §五C 的定义式）。
//     不规则 → A = 实测截面多边形面积本身（94.txt §五D："应采用实际截面几何面积计算"）。
//   前三类在给出公式值之前，都要先通过"公式值 vs 实测面积"的一致性闸门；
//   过不了闸门 = 形状其实没那么规整 = 降级为 irregular。
//
// 纯函数：不碰 DOM、不碰 three.js、不依赖任何引擎模块 → Node 直接可测
//   （94.txt §十四 A~G 全部在本层验证）。
// ============================================================

/** 截面类型（94.txt §五 的四类，只有这四类，不多不少） */
export const SECTION_TYPE = {
  CIRCULAR: 'circular',
  RECT: 'rect',
  TRAPEZOID: 'trapezoid',
  IRREGULAR: 'irregular',
};

/** 判不出形状的原因（只给码，文案由视图层查 i18n） */
export const SECTION_REASON = {
  NO_LOOP: 'no_loop',               // 这一刀没切出闭合环
  MULTI_LOOP: 'multi_loop',         // 这一刀切出 ≥2 个独立闭合环 → 没有唯一截面可言
  DEGENERATE: 'degenerate',         // 环上的点太少 / 面积退化为 0
  AMBIGUOUS_AXIS: 'ambiguous_axis', // **平板件**：三个方向里有两个尺度相当、第三个明显小 → 方向不可判定
};

/* ---------------- 数值闸门（全部集中在这里，改口径只改这一处） ---------------- */

export const SHAPE_GATE = {
  /** 圆度 = 4πA/P²：正圆 = 1，正方形 = π/4 ≈ 0.785 */
  CIRCULARITY_MIN: 0.90,
  /** 径向均匀度 = (Rmax − Rmin) / Rmean：正圆 = 0，正方形 ≈ 0.293，正八边形 ≈ 0.076 */
  RADIAL_SPREAD_MAX: 0.10,
  /**
   * 矩形填充率 = A(凸包) / A(最小面积外接矩形)。
   *
   * ★ PHASE 96 改成**矩形判定的唯一闸门**（原先它被套在 QUAD_FILL_MIN 里面，见下）。
   *   为什么：真矩形的 QUAD_FILL 恰好落在 0.94~0.98 —— 而闸门是 0.95，**闸门正压在噪声带上**。
   *   实测（同一块 20×5×30 的矩形，只改 MC 网格相位 / 分辨率 / 破对称小量）：
   *     quadFill = 0.9382 / 0.9439 / 0.9473 / 0.9561 / 0.9605 / 0.9761  ← 横跨 0.95
   *   于是**同一块几何**有时判 rect、有时判 irregular；而规格分组要求 type 一致
   *   → 两个一模一样的内浇口被判成「多种规格」（96.txt §二.2 用户实测到的现象）。
   *   （PHASE 96 同时给 processInspection.sameSpec 加了面积兜底，两道防线都要在。）
   *
   *   为什么 RECT_FILL 稳：它用的是**凸包**与**最小面积外接矩形**，两者都由极值点决定，
   *   不吃 MC 倒角（真矩形的倒角发生在角上，不影响外接矩形）。同批实测：
   *     真矩形      0.9988 ~ 0.9995   （四种网格相位全部 ≥ 0.9988）
   *     半圆截面    0.7854            （96.txt §六 点名的 20×10 bbox / 157mm² 那一类）
   *     正六边形    0.7540 ~ 0.7543
   *     正八边形    0.8283
   *     梯形(10,20,15) 0.7555 ~ 0.7571 · 梯形(14,20,15) 0.8533 ~ 0.8557
   *     正圆        0.7854
   *   0.97 落在 0.8557 与 0.9988 之间，两边各有 16% 以上的余量 —— 不是压线值。
   */
  RECT_FILL_MIN: 0.97,
  /**
   * 四边形解释率 = A(四个主要角点围成的四边形) / A(凸包)。
   *
   * ★ PHASE 96：**只用于"是不是梯形"这条路**，不再参与"是不是矩形"的判定。
   *   原 PHASE 94 把它当成矩形的前置闸门（quadFill ≥ 0.95 且 rectFill ≥ 0.97 才算矩形），
   *   但实测真矩形的 quadFill 是 0.9382~0.9761（随 MC 相位翻），闸门正压在噪声带上
   *   —— 详见 RECT_FILL_MIN 的注释。矩形改由 RECT_FILL_MIN 单独判定。
   *   梯形这条路保留它：梯形本来就"不是矩形"，需要先确认凸包能被某个四边形解释掉。
   *
   * 为什么不能直接"数出 4 个角"：实测一个**真正的矩形截面**凸包有 8 个顶点 ——
   *   MC 等值面在直角处会倒出一个 0.26mm 的小斜角，比 1% 长边（0.20mm）还大，
   *   纯几何合并合不掉它，于是"8 个角"被判成不规则。
   * 闸门 0.95 实测：矩形+倒角 0.94~0.98、真梯形 0.975~0.985（PHASE 96 实测）、
   *   正八边形 0.607、正六边形 0.662、正圆 0.637。
   *   ⚠ 梯形那条路还要过 TRAPEZOID_TOL（公式值 vs 实测值的偏差），两道闸门一起才认。
   */
  QUAD_FILL_MIN: 0.95,
  /** 梯形公式值与实测面积的相对偏差上限 —— 超过就说明"其实不规整" */
  TRAPEZOID_TOL: 0.05,
  /** 判定"两条边平行"的角度上限（度） */
  PARALLEL_DEG: 8,
  /** 折线点合并容差 = 该比例 × 截面的长边（相对量，避免大件小件共用一个绝对值） */
  COLLINEAR_FRAC: 0.01,
  /** 四边形的**最短边**下限 = 该比例 × 长边 —— 防止退化四边形（如三角形被补成四点）冒充梯形 */
  QUAD_MIN_EDGE_FRAC: 0.08,
  /** 平板件判据（两个条件同时成立才算平板，见 axisAmbiguous 的说明） */
  PLATE_THIN_RATIO: 0.15,    // λ3 / λ2 < 此值：第三个方向明显比第二个方向"薄"
  PLATE_WIDE_RATIO: 0.50,    // λ2 / λ1 > 此值：两个大方向尺度相当（不是一根细长杆）
};

/* ---------------- 基础几何（全部在 2D 切面坐标 (u,v) 内） ---------------- */

/** 多边形面积（绝对值；顶点环绕方向的符号在这里没有意义） */
export function polygonArea(pts) {
  let a2 = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a2) / 2;
}

/** 多边形周长（闭合） */
export function polygonPerimeter(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return s;
}

/** 凸包（Andrew monotone chain），返回逆时针、首尾不重复 */
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : p.slice(0, 3);
}

/**
 * 最小面积外接矩形（旋转卡壳的朴素写法：矩形必有一条边与凸包某条边共线）。
 * @returns {{w:number, h:number, area:number, angle:number}|null} w ≥ h
 */
export function minAreaRect(hull) {
  const n = hull.length;
  if (n < 3) return null;
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const el = Math.hypot(ex, ey);
    if (!(el > 1e-12)) continue;
    ex /= el; ey /= el;
    const px = -ey, py = ex;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of hull) {
      const u = q[0] * ex + q[1] * ey;
      const v = q[0] * px + q[1] * py;
      if (u < u0) u0 = u; if (u > u1) u1 = u;
      if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const w = u1 - u0, h = v1 - v0;
    if (!best || w * h < best.area) {
      best = { w: Math.max(w, h), h: Math.min(w, h), area: w * h, angle: Math.atan2(ey, ex) };
    }
  }
  return best;
}

/** 凸包顶点的面积加权形心（2D） */
function hullCentroid(hull) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0, n = hull.length; i < n; i++) {
    const p = hull[i], q = hull[(i + 1) % n];
    const cr = p[0] * q[1] - q[0] * p[1];
    a2 += cr;
    cx += (p[0] + q[0]) * cr;
    cy += (p[1] + q[1]) * cr;
  }
  if (Math.abs(a2) < 1e-12) {
    // 退化成一条线 → 用顶点算术平均兜底（此时形状判定本来也会落到 irregular）
    const m = hull.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
    return [m[0] / hull.length, m[1] / hull.length];
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

/**
 * 径向均匀度 = (Rmax − Rmin) / Rmean（形心到各凸包顶点的距离）。
 * 为什么单独要这个指标：最小外接矩形对"正八边形"这种形状会给出接近正方的 W/H，
 * 只看长宽比会把八边形当圆；径向均匀度对八边形是 0.076、对正方形是 0.293，分得很开。
 * @returns {{min:number, max:number, mean:number, spread:number}}
 */
export function radialStats(hull) {
  const c = hullCentroid(hull);
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (const p of hull) {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (d < mn) mn = d;
    if (d > mx) mx = d;
    sum += d;
  }
  const mean = sum / hull.length;
  return { min: mn, max: mx, mean, spread: mean > 0 ? (mx - mn) / mean : 1 };
}

/** 点到直线（过 a、b）的距离 */
function pointLineDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (!(l > 1e-12)) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / l;
}

/**
 * 合并**近似共线**的凸包顶点 —— 目的只有一个：把 MC/网格离散出来的锯齿抹平，
 * 数出"这个截面真正有几个角"。平面上的直边离散后所有点严格共线，
 * 所以 1% 长边的容差足以抹掉锯齿、又远远吃不掉真实的角（真实角是 90°/梯形的斜边夹角）。
 */
export function simplifyCorners(hull, tol) {
  let pts = hull.slice();
  let guard = 0;
  let changed = true;
  while (changed && pts.length > 3 && guard++ < 64) {
    changed = false;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (pointLineDist(cur, prev, next) < tol) { changed = true; continue; }
      out.push(cur);
    }
    if (out.length >= 3) pts = out;
  }
  return pts;
}

/**
 * 从凸包里挑出**四个角点**：按最小面积外接矩形自己的 u/v 轴，四个象限方向各取最远的那个顶点。
 *
 * 为什么不去"数角"或"按面积贪婪删点"（两种都实测栽过）：
 *   MC 等值面在直角处会倒出一个 ~0.3mm 的小斜角，于是一个**真正的矩形截面**凸包有 8 个顶点。
 *   · 数角 → 数出 8 → 判成不规则；
 *   · 按"删掉它损失面积最小"贪婪删点 → 每个斜角点被删时损失的是**跨整条长边**的细长三角形
 *     （约 2.4mm²），和删掉一个真角点的损失量级相同，贪婪根本分不出来。
 *   换成"矩形的四个象限方向各取极值点"就与容差无关：矩形转角处的两个候选点里，
 *   必然有一个在象限方向上更远，直接被选中。
 *
 * 这不是"硬凑一个四边形"，而是"这个形状能不能被某个四边形解释掉" ——
 * 解释率由调用方用 polygonArea(quad)/polygonArea(hull) 算，达不到闸门就不算四边形。
 *
 * @returns {number[][]} 4 个点（按环绕顺序）；挑不出 4 个互不相同的点则返回 []
 */
export function quadFromRect(hull, rect) {
  if (!hull || hull.length < 4 || !rect) return [];
  const ca = Math.cos(rect.angle), sa = Math.sin(rect.angle);
  const U = [ca, sa], V = [-sa, ca];
  const picks = [];
  for (const [su, sv] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    let best = null, bestD = -Infinity;
    for (const p of hull) {
      const d = su * (p[0] * U[0] + p[1] * U[1]) + sv * (p[0] * V[0] + p[1] * V[1]);
      if (d > bestD) { bestD = d; best = p; }
    }
    if (!best) return [];
    // 同一个顶点被两个象限选中 = 这个形状根本没有四个角（三角形/圆都是这样）
    if (picks.some((q) => Math.abs(q[0] - best[0]) < 1e-9 && Math.abs(q[1] - best[1]) < 1e-9)) return [];
    picks.push(best);
  }
  return picks;
}

/** 2D 直线的最小二乘拟合（总体最小二乘：过形心、方向取主成分）→ {c:[x,y], d:[dx,dy]} */
export function fitLine2D(pts) {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  // 2×2 协方差主特征向量（闭式解，避免再引一套特征分解）
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(tr * tr / 4 - det, 0);
  const l1 = tr / 2 + Math.sqrt(disc);
  let dx = sxy, dy = l1 - sxx;
  if (Math.hypot(dx, dy) < 1e-12) { dx = l1 - syy; dy = sxy; }
  const l = Math.hypot(dx, dy) || 1;
  return { c: [cx, cy], d: [dx / l, dy / l] };
}

/** 两直线交点；平行返回 null */
export function intersectLines(a, b) {
  const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
  if (Math.abs(den) < 1e-9) return null;
  const wx = b.c[0] - a.c[0], wy = b.c[1] - a.c[1];
  const t = (wx * b.d[1] - wy * b.d[0]) / den;
  return [a.c[0] + a.d[0] * t, a.c[1] + a.d[1] * t];
}

/**
 * 由四个角点把真实的角"找回来"。
 *
 * 为什么必须找：MC 等值面是**内接**的，直角处会被倒掉约一个网格步的小斜角，
 * 于是凸包上根本没有真正的角点，只有两条边各退一小截的两个点。
 * 直接拿这两个点当角，梯形会算小 3%（实测：上底 10 / 下底 20 / 高 15 的梯形
 * 被量成 10.08 / 19.29 / 14.81，面积 217.5 而不是 225）。
 *
 * 做法：把凸包按四个角点切成四条边，每条边用**边内部的点**拟合一条直线
 * （内部点为空时才退回用两个角点本身），相邻两条直线的交点就是真实的角。
 * 平面面片离散后点严格共线，所以这个拟合是精确的，不是近似。
 */
export function refineQuad(hull, picks) {
  const n = hull.length;
  if (!hull || n < 4 || !picks || picks.length !== 4) return picks;
  const idxOf = (p) => hull.findIndex((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9);
  const idx = picks.map(idxOf);
  if (idx.some((i) => i < 0)) return picks;
  const order = [0, 1, 2, 3].sort((a, b) => idx[a] - idx[b]);
  const si = order.map((k) => idx[k]);
  const sp = order.map((k) => picks[k]);
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const i0 = si[s], i1 = si[(s + 1) % 4];
    const interior = [];
    for (let k = (i0 + 1) % n, guard = 0; k !== i1 && guard <= n; k = (k + 1) % n, guard++) interior.push(hull[k]);
    lines.push(fitLine2D(interior.length >= 2 ? interior : [sp[s], sp[(s + 1) % 4]]));
  }
  const out = [];
  for (let s = 0; s < 4; s++) {
    const p = intersectLines(lines[(s + 3) % 4], lines[s]);
    if (!p) return sp;
    out.push(p);
  }
  return out;
}

/** 四边形的最短边长（退化四边形会有一个边趋近 0） */
function minQuadEdge(q) {
  let mn = Infinity;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    mn = Math.min(mn, Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return mn;
}

/**
 * 四边形是不是梯形：找一对**近似平行的对边**，那就是上底/下底，两线距离就是高。
 * 94.txt §五C："只有真正满足几何条件时才标记为梯形" —— 找不到平行对就直接 null。
 * @returns {{a:number, b:number, h:number, areaMm2:number, crossSin:number}|null}
 */
export function fitTrapezoid(quad, maxSin) {
  if (!quad || quad.length !== 4) return null;
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    edges.push({ a, b, len: Math.hypot(dx, dy), dx, dy });
  }
  if (edges.some((e) => !(e.len > 1e-9))) return null;
  let best = null;
  for (const [i, j] of [[0, 2], [1, 3]]) {
    const e1 = edges[i], e2 = edges[j];
    // |sin θ| = |d1 × d2| / (|d1||d2|)
    const crossSin = Math.abs(e1.dx * e2.dy - e1.dy * e2.dx) / (e1.len * e2.len);
    if (crossSin > maxSin) continue;
    const h = pointLineDist(e2.a, e1.a, e1.b);
    if (!(h > 1e-9)) continue;
    if (!best || crossSin < best.crossSin) {
      best = { a: e1.len, b: e2.len, h, areaMm2: (e1.len + e2.len) * h / 2, crossSin };
    }
  }
  return best;
}

/* ---------------- 对外主函数 ---------------- */

/**
 * 判断一个截面是什么形状。
 *
 * @param {Array<{area:number, poly?:number[][]}>} loops
 *   来自 `objectMetrics(mesh, { withPoly: true }).section.repLoops` —— **产出 rep 那一刀**的闭合环。
 *   传空数组 / 传 ≥2 环 → 判不出唯一截面，如实返回 usable:false（94.txt §六末段：不给猜值）。
 * @param {number} [repAreaMm2] 该刀的总面积（= section.rep），仅用于交叉核对
 * @returns {{
 *   type:string|null, usable:boolean, reason:string|null, areaMm2:number|null,
 *   dMm:number|null, wMm:number|null, hMm:number|null,
 *   topMm:number|null, bottomMm:number|null, heightMm:number|null,
 *   circularity:number|null, radialSpread:number|null, rectFill:number|null,
 *   corners:number, loops:number, evidence:object
 * }}
 *   areaMm2 —— **做汇总用的那个面积**，口径见文件头。usable:false 时一律 null。
 */
export function classifySection(loops, repAreaMm2 = null) {
  const empty = {
    type: null, usable: false, reason: SECTION_REASON.NO_LOOP, areaMm2: null,
    dMm: null, wMm: null, hMm: null, topMm: null, bottomMm: null, heightMm: null,
    circularity: null, radialSpread: null, rectFill: null,
    corners: 0, loops: 0, evidence: {},
  };
  const list = Array.isArray(loops) ? loops.filter((l) => l && Array.isArray(l.poly) && l.poly.length >= 3) : [];
  if (!list.length) return empty;
  // 一刀切出两个独立闭合环 = 这个方向根本没有"唯一截面"（U 形/C 形件被横切）
  //   → 94.txt §六："如果某个复杂几何无法可靠定义唯一截面：必须明确显示 WARNING，不要猜。"
  if (list.length > 1) return { ...empty, reason: SECTION_REASON.MULTI_LOOP, loops: list.length };

  const loop = list[0];
  const pts = loop.poly;
  const measuredA = loop.area > 0 ? loop.area : polygonArea(pts);
  if (!(measuredA > 0)) return { ...empty, reason: SECTION_REASON.DEGENERATE, loops: 1 };

  const hull = convexHull(pts);
  if (hull.length < 3) return { ...empty, reason: SECTION_REASON.DEGENERATE, loops: 1 };

  const per = polygonPerimeter(pts);
  const hullPer = polygonPerimeter(hull);
  const hullA = polygonArea(hull);
  const circularity = hullPer > 0 ? (4 * Math.PI * hullA) / (hullPer * hullPer) : 0;
  const radial = radialStats(hull);
  const rect = minAreaRect(hull);
  const longSide = rect ? Math.max(rect.w, rect.h) : 0;
  const corners = simplifyCorners(hull, longSide * SHAPE_GATE.COLLINEAR_FRAC);
  const rectFill = rect && rect.area > 0 ? hullA / rect.area : 0;

  // 四边形假设：取外接矩形四个象限方向的极值点，看它能把凸包解释掉多少
  const quad = quadFromRect(hull, rect);
  const quadArea = quad.length === 4 ? polygonArea(quad) : 0;
  const quadFill = hullA > 0 ? quadArea / hullA : 0;
  const quadOk = quad.length === 4 && quadFill >= SHAPE_GATE.QUAD_FILL_MIN
    && minQuadEdge(quad) >= longSide * SHAPE_GATE.QUAD_MIN_EDGE_FRAC;

  const base = {
    ...empty, loops: 1, corners: corners.length,
    circularity, radialSpread: radial.spread, rectFill,
    evidence: {
      measuredAreaMm2: measuredA, hullAreaMm2: hullA, perimeterMm: per,
      vertices: pts.length, quadFill, hullVertices: hull.length,
    },
  };

  /* ---- ① 圆形：既要圆（圆度 + 径向均匀），面积又要能由等价直径自洽还原 ---- */
  if (circularity >= SHAPE_GATE.CIRCULARITY_MIN && radial.spread <= SHAPE_GATE.RADIAL_SPREAD_MAX) {
    // 等价直径由**实测面积**反推 → πD²/4 ≡ measuredA，公式不会带来额外偏差
    const d = 2 * Math.sqrt(measuredA / Math.PI);
    return {
      ...base, type: SECTION_TYPE.CIRCULAR, usable: true, reason: null,
      areaMm2: (Math.PI * d * d) / 4, dMm: d,
      evidence: { ...base.evidence, formula: 'A = πD²/4', equivalentDiameter: true },
    };
  }

  /* ---- ② 矩形：只看"凸包能不能填满自己的最小面积外接矩形"（PHASE 96 改，见 SHAPE_GATE） ----
     ⚠ 不再要求 quadOk：矩形**本来就不是**四边形解释率能判的东西（真矩形的 quadFill
       在 0.94~0.98 之间抖，跟闸门 0.95 重叠）。rectFill 判据对真矩形 ≥0.9988、
       对其他所有候选形状 ≤0.8557，两边都不压线。 */
  if (rectFill >= SHAPE_GATE.RECT_FILL_MIN) {
    return {
      ...base, type: SECTION_TYPE.RECT, usable: true, reason: null,
      areaMm2: rect.w * rect.h, wMm: rect.w, hMm: rect.h,
      evidence: { ...base.evidence, formula: 'A = W × H' },
    };
  }

  /* ---- ③ 梯形：凸包能被某个四边形解释掉，且平行对边对上公式 ---- */
  if (quadOk) {
    // 参数一律用**找回的角**算（欠倒角会让梯形小 3%），解释率闸门仍用原始四角点
    const rc = refineQuad(hull, quad);
    const tp = fitTrapezoid(rc, Math.sin((SHAPE_GATE.PARALLEL_DEG * Math.PI) / 180));
    if (tp && Math.abs(tp.areaMm2 - measuredA) / measuredA <= SHAPE_GATE.TRAPEZOID_TOL) {
      // ⚠ PHASE 96：两条平行边一律**按长度排序**输出（长边在前），字段名仍是 topMm / bottomMm
      //   —— 保留字段名只为不动 PHASE 94 的既有接口；**UI 上的"上底/下底"字样必须去掉**，
      //   改叫"平行边"（见 inspectionCenter 的 shapeDims）。
      //   为什么：切线平面里哪条边算"上"取决于这个单元在铸件上的朝向，
      //   而截面是在**单元自身的主轴坐标系**里切的，那里根本没有重力/充型方向。
      //   实测（上底10 / 下底20 / 高15 的梯形柱）：算法先遇到的是 y=0 那条 20 的边，
      //   于是"上底"报 20、"下底"报 10 —— 对调。面积 (a+b)h/2 与顺序无关，所以
      //   这个错标只影响显示、不影响任何计算，但它会让用户以为模型建反了。
      const [longA, shortB] = tp.a >= tp.b ? [tp.a, tp.b] : [tp.b, tp.a];
      return {
        ...base, type: SECTION_TYPE.TRAPEZOID, usable: true, reason: null,
        areaMm2: tp.areaMm2, topMm: longA, bottomMm: shortB, heightMm: tp.h,
        evidence: { ...base.evidence, formula: 'A = (a+b)h/2', parallelSin: tp.crossSin, refined: rc !== quad },
      };
    }
  }

  /* ---- ④ 不规则：不硬套公式，直接给**实测截面几何面积**（94.txt §五D 指定的做法） ---- */
  return {
    ...base, type: SECTION_TYPE.IRREGULAR, usable: true, reason: null,
    areaMm2: measuredA,
    evidence: { ...base.evidence, formula: 'measured' },
  };
}

/**
 * **平板件判据**：这个实体的"主轴方向不唯一"。
 *
 * 什么情况会踩到（94.txt §六/§十三.5 点名要验的"扇形内浇口"就是典型）：
 *   一片 40 长 × 48 宽 × 8 厚的扇形板。主轴取的是**平面内最长的那个方向**（48），
 *   垂直于它切出来的是"长 × 厚"（约 40×8 = 320）；换一条轴（40）切是"宽 × 厚"（48×8 = 384）。
 *   哪一条才是"有效流通截面"取决于**充型方向**，而那是 PHASE 89~92 那套自动识别的事，
 *   本阶段不做（94.txt §一）。
 *
 * 判据（两个条件同时成立才算方向不唯一）：
 *   · λ3/λ2 很小 —— 第三个方向明显比第二个方向薄；
 *   · λ2/λ1 不很小 —— 两个大方向尺度相当（否则是一根细长杆，主轴就是杆轴，截面毫无歧义）。
 * 实测：⌀12×20 圆柱 λ∝(400,144,144) → 0.99 / 1.00 → 不是平板；
 *       80×20×15 方管 λ∝(6400,400,225) → 0.56 / 0.06 → 不是平板；
 *       40×48×8 扇形 λ∝(2304,1600,64) → 0.04 / 0.69 → **是平板**。
 *
 * ★ PHASE 96 改了**后果**，没改判据：
 *   94 的做法是"方向不唯一 → 截面积留空（null + ambiguous_axis）"。
 *   实测下来这个代价太大 —— 判据是 λ2/λ1 要达到 0.5 以上，等价于"两个大方向相差不到 1.41 倍"，
 *   而**真实内浇口通常就落在这个区间**（浇口宽度沿铸件边、充型路程 = 砂型里那一小段，
 *   两者本来就是一个量级）。于是大量正常内浇口被判"方向不唯一"→ 不计入总面积
 *   → 用户实测到的"总面积偏小"（96.txt §二.3）。
 *   96.txt §六 把优先级定死为「第一优先：真实闭合截面的几何面积」，§二十一 又写明
 *   "只要能够得到可靠闭合截面：直接计算闭合截面的真实几何面积"。
 *   所以现在的行为是：**照常给主轴那一刀的实测面积**（它确实是一个真实的闭合截面），
 *   同时把 axisUncertain 标记带出去，由 UI 如实说明"这个方向是按主轴取的约定值"，
 *   并把**另一条轴的截面面积**一并给出（metrics.sectionAlt），让用户能自己判断差多少。
 *   拒绝给数不再发生在这一层（拒绝只保留给"根本不是闭合实体""切不出闭合环"这些真缺陷）。
 */
export function axisAmbiguous(metrics) {
  const v = metrics && metrics.axisValues;
  if (!Array.isArray(v) || v.length < 3) return false;
  const [l1, l2, l3] = v;
  if (!(l1 > 0) || !(l2 > 0)) return false;
  return (l3 / l2) < SHAPE_GATE.PLATE_THIN_RATIO && (l2 / l1) > SHAPE_GATE.PLATE_WIDE_RATIO;
}

/**
 * 便利封装：从 `objectMetrics` 的返回值直接得到截面描述。
 * 判定顺序刻意是"外层的可靠闸门优先" —— section.usable 为假时根本不该谈形状。
 *
 * PHASE 96：方向不唯一（平板）**不再**让 areaMm2 变 null，只加 `axisUncertain` 标记。
 *   理由见 axisAmbiguous 的注释（96.txt §六 / §二十一）。
 * @param {object} metrics objectMetrics(mesh, { withPoly: true }) 的结果
 */
export function sectionShapeOf(metrics, dirInfo) {
  const s = metrics && metrics.section;
  if (!s) return { ...classifySection([]), reason: SECTION_REASON.NO_LOOP };
  if (!s.usable) return { ...classifySection([]), reason: s.reason || SECTION_REASON.NO_LOOP };
  const out = classifySection(s.repLoops, s.rep);
  // ★ PHASE 97：这一刀的方向是不是**由真实连接面给定**的。
  //   是 → 方向有几何依据（不是"取最长轴"这个约定），所以**不该**再标"方向未确认"；
  //        把来源如实记下来给 UI（"由产品连接面确定"）。
  //   否 → 走下面 PHASE 96 的原逻辑（平板件标记 + 另一条主轴的对照值）。
  const fromConnection = !!(dirInfo && dirInfo.direction);
  if (fromConnection) {
    out.directionSource = dirInfo.source;
    out.directionConfidence = dirInfo.confidence;
    out.connectionAreaMm2 = Number.isFinite(dirInfo.areaMm2) ? dirInfo.areaMm2 : null;
    out.connectionCenter = dirInfo.center || null;
    out.axisUncertain = false;
    return out;
  }
  if (axisAmbiguous(metrics)) {
    // 另一条主轴的截面面积（objectMetrics 开了 altAxis 才有）——给 UI 展示"差多少"
    const alt = Number.isFinite(metrics.sectionAlt?.rep) ? metrics.sectionAlt.rep : null;
    out.altAreaMm2 = alt;
    out.altSpreadPct = (alt != null && out.areaMm2 > 0)
      ? (Math.abs(alt - out.areaMm2) / out.areaMm2) * 100 : null;
    // ★ 判据命中 ≠ 结果可疑（PHASE 96 实测到的假警报）：
    //   30×5×30 的方形截面 λ∝(900,900,25) → 命中平板判据（两条大轴一样长），
    //   但两条轴切出来的截面是同一个 30×5，面积差 0.1% —— 方向根本不影响结果。
    //   所以只有当**两条轴的实测截面确实不同**时才标 uncertainty。
    //   2% 的依据：同一截面跨网格相位的实测离散约 0.5%，2% 是它的 4 倍（不误报），
    //   而真的取错方向至少差一个尺寸档（≥5%，见 SPEC_AREA_REL 的注释）。
    //   alt 拿不到时（调用方没开 altAxis）保守起见仍然标记。
    out.axisUncertain = out.altSpreadPct == null || out.altSpreadPct > AXIS_SPREAD_MIN;
  }
  return out;
}

/**
 * 「方向确实会影响结果」的最小相对差（%）。
 * 依据见 sectionShapeOf：同截面跨网格相位的离散 ~0.5%，取 4 倍做噪声地板；
 * 真取错方向至少差一个尺寸档（≥5%）。两条实测线之间取 2%。
 */
export const AXIS_SPREAD_MIN = 2;
