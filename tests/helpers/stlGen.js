// ============================================================
// 程序化 STL 生成器（测试专用）
// CSG 并集（隐式曲面）+ 四面体 Marching Cubes → 水密三角网格
// 用途：命令3 第30节回归测试模型（T 型/十字/Boss/双热结/壳体等）
// 只生成 ASCII STL（测试模型，无性能要求）
// ============================================================

/* ---- 基本体隐式距离（外部为正） ---- */
export const BOX = (min, max) => (p) => Math.max(
  min[0] - p[0], p[0] - max[0],
  min[1] - p[1], p[1] - max[1],
  min[2] - p[2], p[2] - max[2],
);
export const CYL_Y = (cx, cz, r, h) => (p) => Math.max(
  Math.sqrt((p[0] - cx) ** 2 + (p[2] - cz) ** 2) - r,
  Math.abs(p[1]) - h / 2,
);
export const SPHERE = (c, r) => (p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r;

/** CSG 并集 */
export function union(...shapes) {
  return (p) => Math.min(...shapes.map(s => s(p)));
}

/** CSG 差集：base 减去 parts（挖槽）。差集表面天然干净（无内部面/重合面） */
export function subtract(base, ...parts) {
  return (p) => Math.max(base(p), ...parts.map(s => -s(p)));
}

/** 四面体 MC：把每个立方体拆 5 个四面体，每个四面体独立提取等值面（16 case，无歧义）
 *  导出供 validation 生成器内存直传顶点（不落盘 STL 文本，避免解析开销） */
export function tetMC(sdf, bounds, res) {
  const [min, max] = bounds;
  const step = [(max[0] - min[0]) / res, (max[1] - min[1]) / res, (max[2] - min[2]) / res];
  const verts = [];
  const P = (x, y, z) => [min[0] + x * step[0], min[1] + y * step[1], min[2] + z * step[2]];
  const field = new Float32Array((res + 1) ** 3);
  const F = (i, j, k) => field[i * (res + 1) ** 2 + j * (res + 1) + k];
  for (let i = 0; i <= res; i++) for (let j = 0; j <= res; j++) for (let k = 0; k <= res; k++) {
    field[i * (res + 1) ** 2 + j * (res + 1) + k] = sdf(P(i, j, k));
  }
  // 四面体顶点索引偏移（8 顶点 cube 内的 5 个四面体）
  // 正确 5-tet 分解：中间体 {0,3,5,6}（体积 1/3）+ 4 角各 1/6（Σ=1，无重叠无退化）
  const TETS = [
    [0, 1, 3, 5], [0, 2, 3, 6], [0, 4, 5, 6], [3, 5, 6, 7], [0, 3, 5, 6],
  ];
  // 镜像剖分（顶点位补 v→7-v）：cube 按 (i+j+k)%2 交错选择，保证相邻 cube
  // 共享面上的三角分割一致（否则网格无法缝合，这是 5-tet 独立 MC 的关键）
  const TETS_MIRROR = TETS.map(tet => tet.map(v => 7 - v));
  const V8 = (i, j, k, idx) => {
    const x = (idx & 1) ? i + 1 : i, y = (idx & 2) ? j + 1 : j, z = (idx & 4) ? k + 1 : k;
    return [x, y, z];
  };
  const EMAP = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  for (let i = 0; i < res; i++) for (let j = 0; j < res; j++) for (let k = 0; k < res; k++) {
    const TETS_USE = (i + j + k) % 2 === 0 ? TETS : TETS_MIRROR;   // checkerboard 交错
    for (const tet of TETS_USE) {
      const f = tet.map(t => F(...V8(i, j, k, t)));
      const inside = f.map(v => v < 0);
      const nIn = inside.filter(Boolean).length;
      if (nIn === 0 || nIn === 4) continue;
      // 6 条边交点（两端符号不同）；保存拓扑 {a, b, p:交点坐标}
      const edges = [];
      for (let e = 0; e < 6; e++) {
        const [a, b] = EMAP[e];
        if (inside[a] === inside[b]) continue;
        const pa = P(...V8(i, j, k, tet[a])), pb = P(...V8(i, j, k, tet[b]));
        const t = f[a] / (f[a] - f[b]);
        edges.push({ a, b, p: [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t] });
      }
      // 统一法向：顶点顺序叉积方向应与 sdf 梯度（外部为正）一致
      const tri = (a, b, c) => {
        const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        // 三角中心梯度差分（sdf 外部为正 → 法向应与梯度同向）
        const e = step[0] * 0.01 || 1e-4;
        const gx = (sdf([cx + e, cy, cz]) - sdf([cx - e, cy, cz])) / (2 * e);
        const gy = (sdf([cx, cy + e, cz]) - sdf([cx, cy - e, cz])) / (2 * e);
        const gz = (sdf([cx, cy, cz + e]) - sdf([cx, cy, cz - e])) / (2 * e);
        if (nx * gx + ny * gy + nz * gz < 0) { const tmp = b; b = c; c = tmp; }   // 反向则交换
        verts.push(...a, ...b, ...c);
      };
      const P_of = (ed) => ed.p;
      if (edges.length === 3) {
        tri(P_of(edges[0]), P_of(edges[1]), P_of(edges[2]));
      } else if (edges.length === 4) {
        // 2 in / 2 out：4 条边必成四边形环（四面体为凸体，截面恒凸）。
        // 按 inside 顶点拓扑配对，不能按收集顺序（否则交叉折叠）。
        const inV = [];
        for (const ed of edges) {
          const iv = inside[ed.a] ? ed.a : ed.b;
          if (!inV.includes(iv)) inV.push(iv);
        }
        const other = (ed, iv) => (ed.a === iv ? ed.b : ed.a);
        const byIn = inV.map(iv => edges.filter(ed => (inside[ed.a] ? ed.a : ed.b) === iv));
        const e1 = byIn[0][0], e2 = byIn[0][1];
        const v1 = other(e1, inV[0]), v2 = other(e2, inV[0]);
        const e3 = byIn[1][0], e4 = byIn[1][1];
        const w1 = other(e3, inV[1]), w2 = other(e4, inV[1]);
        let eA = e1, eB = e2, eC = e3, eD = e4;
        if (w2 === v1) { eC = e4; eD = e3; }   // 匹配另一端
        tri(P_of(eA), P_of(eC), P_of(eD));
        tri(P_of(eA), P_of(eD), P_of(eB));     // 环: v1-in1, v1-in2, v2-in2, v2-in1
      }
    }
  }
  return new Float32Array(verts);
}

/**
 * 生成 ASCII STL
 * @param {Function} sdf  隐式距离函数（union(...)）
 * @param {[[number,number,number],[number,number,number]]} bounds  生成范围
 * @param {number} res  网格分辨率（40-80，越大越精细）
 * @returns {string} ASCII STL 文本
 */
export function genSTL(sdf, bounds, res = 48) {
  const verts = tetMC(sdf, bounds, res);
  const lines = ['solid gen'];
  for (let t = 0; t < verts.length / 9; t++) {
    lines.push('  facet normal 0 0 0');
    lines.push('    outer loop');
    for (let k = 0; k < 3; k++) {
      lines.push(`      vertex ${fmt6(verts[t * 9 + k * 3])} ${fmt6(verts[t * 9 + k * 3 + 1])} ${fmt6(verts[t * 9 + k * 3 + 2])}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push('endsolid gen');
  return lines.join('\n');
}

const fmt6 = (v) => v.toFixed(6);

/** 常用测试模型（全部用差集/完全包含构造：表面干净，无 CSG 内部面）
 *  注意：并集部分重叠会产生"内部面"（一个体的表面伸进另一个体），
 *  扫描线奇偶判内外会受干扰——真实 CAD 布尔导出的 STL 无此问题。 */

/** T 型：100×100×40 柱，挖去左上/右上槽 → T 形截面（竖板 40 宽，横板 100×20 厚） */
export function tShape() {
  return {
    sdf: subtract(
      BOX([-50, 0, -20], [50, 100, 20]),
      BOX([-50, 20, -20], [-20, 100, 20]),   // 左槽（贯通顶面与左面）
      BOX([20, 20, -20], [50, 100, 20]),     // 右槽
    ),
    bounds: [[-55, -5, -25], [55, 105, 25]],
    res: 56,
  };
}

/** 十字交汇：100³ 柱挖去四角贯通槽（沿 z）→ 十字截面（各臂 20 宽），中心交汇为热结 */
export function crossShape() {
  return {
    sdf: subtract(
      BOX([-50, -50, -50], [50, 50, 50]),
      BOX([-50, -50, -50], [-10, -10, 50]),
      BOX([10, -50, -50], [50, -10, 50]),
      BOX([-50, 10, -50], [-10, 50, 50]),
      BOX([10, 10, -50], [50, 50, 50]),
    ),
    bounds: [[-55, -55, -55], [55, 55, 55]],
    res: 56,
  };
}

/** Boss：120×30×120 块，四角挖去 10 厚台阶 → 中心 40×40 凸台 + 10 厚板缘（方台版） */
export function bossShape() {
  return {
    sdf: subtract(
      BOX([-60, -10, -60], [60, 20, 60]),
      BOX([-60, 10, -60], [-20, 20, -20]),
      BOX([20, 10, -60], [60, 20, -20]),
      BOX([-60, 10, 20], [-20, 20, 60]),
      BOX([20, 10, 20], [60, 20, 60]),
    ),
    bounds: [[-65, -15, -65], [65, 25, 65]],
    res: 56,
  };
}

/** 薄厚过渡：160×60×80 块，左侧挖去上 40 厚 → 左 20 厚薄板 + 右 60 厚块（差集，干净） */
export function stepShape() {
  return {
    sdf: subtract(
      BOX([-80, -30, -40], [80, 30, 40]),
      BOX([-80, 10, -40], [-40, 30, 40]),   // 左侧上槽（挖到 y=10，贯通顶面）
    ),
    bounds: [[-85, -35, -45], [85, 35, 45]],
    res: 56,
  };
}

/** 两个相近独立热结：160×60×60 块，中间挖去上下槽 → 两块 60 厚块由 10 厚薄桥连接 */
export function twoHotspots() {
  return {
    sdf: subtract(
      BOX([-80, -30, -30], [80, 30, 30]),
      BOX([-20, 5, -30], [20, 30, 30]),
      BOX([-20, -30, -30], [20, -5, 30]),
    ),
    bounds: [[-85, -35, -35], [85, 35, 35]],
    res: 72,   // 薄桥 10mm 需高分辨率（MC 台阶更小）
  };
}

/**
 * V2.2 PHASE 1 回归：5 凸台（3×2 排布，间距 120，板 600×500×10，凸台 80×80×50）
 * 修复目标：scanAxis 起点外推（局部细化 bbox 起点落在相邻凸台内 → 凸台 E(0,0) 细化失败漏检）
 * GT：5 个独立凸台 → 5 个热结（maxHotspots=5），位置一一对应
 */
export function multiBoss5() {
  const pos = [[-120, -120], [0, -120], [120, -120], [-120, 0], [0, 0]];
  return {
    sdf: union(
      BOX([-300, -250, -5], [300, 250, 5]),
      ...pos.map(([ox, oy]) => BOX([ox - 40, oy - 40, 5], [ox + 40, oy + 40, 55])),
    ),
    bounds: [[-305, -255, -10], [305, 255, 60]],
    res: 72,
  };
}

/** 一个连续大热结：长厚块 200×60×60（单一大热结） */
export function longBlock() {
  return {
    sdf: BOX([-100, -30, -30], [100, 30, 30]),
    bounds: [[-105, -35, -35], [105, 35, 35]],
    res: 56,
  };
}

/** L 形（两臂 40 高 60×60 截面，角部 60 高加厚）→ 角部热节 Mc≈30 */
export function lShape() {
  return {
    sdf: subtract(
      BOX([-60, -60, -30], [60, 60, 30]),       // 整块 120×120×60
      BOX([0, 0, -30], [60, 60, 30]),           // 右上象限（L 外）
      BOX([0, -60, -30], [60, 0, -20]),         // 底臂右半下方（x∈[0,60] 无角部加厚）
      BOX([0, -60, 20], [60, 0, 30]),           // 底臂右半上方
      BOX([-60, 0, -30], [0, 60, -20]),         // 立臂上半下方（y∈[0,60] 无角部加厚）
      BOX([-60, 0, 20], [0, 60, 30]),           // 立臂上半上方
    ),
    bounds: [[-65, -65, -35], [65, 65, 35]],
    res: 72,
  };
}

/** 复杂壳体：箱体壁厚 10（中空） */
export function boxShell() {
  return {
    sdf: (p) => {
      // 外箱 100³ 减内箱 80³（壁厚 10）
      const outer = BOX([-50, -50, -50], [50, 50, 50])(p);
      const inner = BOX([-40, -40, -40], [40, 40, 40])(p);
      return Math.max(outer, -inner);
    },
    bounds: [[-55, -55, -55], [55, 55, 55]],
    res: 72,   // 壁 10mm 需高分辨率（MC 台阶更小，扫描线判内外更可靠）
  };
}

/** 网格较差：薄板 + 故意缺口（非闭合，验证 OPEN_MESH 提示且不崩溃） */
export function brokenMesh() {
  return {
    sdf: BOX([-60, -5, -60], [60, 5, 60]),
    bounds: [[-65, -10, -65], [65, 10, 65]],
    res: 40,
    dropFaces: 0.05,   // 随机删除 5% 面制造破口
  };
}

/** 解析体积对照表（用于生成器自检；模型均为差集构造） */
export function analyticVolume(name) {
  switch (name) {
    case 'multiBoss5': return 600 * 500 * 10 + 5 * 80 * 80 * 50;          // 3000000+1600000=4600000
    case 'tShape': return 100 * 100 * 40 - 2 * 30 * 80 * 40;            // 400000-192000=208000
    case 'crossShape': return 100 ** 3 - 4 * 40 * 40 * 100;              // 1000000-640000=360000
    case 'bossShape': return 120 * 30 * 120 - 4 * 40 * 10 * 40;          // 432000-64000=368000
    case 'stepShape': return 160 * 60 * 80 - 40 * 20 * 80;               // 768000-64000=704000
    case 'twoHotspots': return 160 * 60 * 60 - 2 * 40 * 25 * 60;         // 576000-120000=456000
    case 'longBlock': return 200 * 60 * 60;                              // 720000
    case 'boxShell': return 100 ** 3 - 80 ** 3;                          // 488000
    case 'brokenMesh': return 120 * 10 * 120;                            // 144000（缺面后稍小）
    default: return null;
  }
}
