// ============================================================
// 点是否在实体网格内部（PHASE 91 · 91.txt §6）
//
// 为什么需要它（91.txt §6 实测结论）：
//   PHASE 90 判「浇注系统与产品连接」用的是「浇注系统三角形**质心**到产品**外表面**的距离 ≤ tol」。
//   这招对**面接触**是对的，对**浇注系统插入/嵌入产品**完全不可靠 —— 原因是它根本
//   没有"内 / 外"这个概念：
//     · 插入时，只有高度 ≈ tol 的一圈窄带质心落在阈值内；带宽不足一个三角形就把这圈
//       切碎。实测 ⌀20 内浇口插入 20mm 厚平板 15mm → 一个口被拆成 **4 个**连接口，
//       形心偏到 6.9mm 外，起始方向偏轴 **31°**；贯穿件更被拆成 **15 个**。
//   §6 明确要求区分三种情况（面接触 / 插入 / 完全不接），并点名可用的 80/20 手段：
//     surface proximity + point inside/outside + gating 穿越 product boundary + 连通区域。
//   本模块提供其中的 **point inside/outside**，其余由 flowTrace 组合。
//
// ★ 方法：射线法（parity）+ 多数票
//   从待判点朝固定方向发射线，与产品表面相交**奇数次** → 点在内部。
//   单条射线可能正好擦过一条边或一个顶点，把计数带偏 —— 所以打三条互不平行的射线，
//   取多数票：三票一致 → 判定可靠（agree=3）；两票一致 → 判定可用但标 agree=2；
//   三票各不相同（不可能，奇偶只有两种）→ 实际上只会出现 2:1 或 3:0。
//   agree<3 表示几何含糊，调用方应把它当作"不确定"而不是"确信"。
//
// ★ 为什么不用"最近三角形的法向定符号"（更省事的做法）：
//   最近点落在**棱或顶点**上时，面法向给不出正确的内外号（要角度加权伪法向才行，
//   而那需要焊接+邻接+逐特征角权重）。射线法对网格质量不敏感，且**可解释** ——
//   91.txt §25 要求"必须解释为什么它在几何上属于连接"，射线法一句话说得清。
//
// 前提：产品网格**水密**（没有洞）。有洞时奇偶失效 —— 调用方（flowTrace）会检查
// 产品连通分量的 closed 标志并如实报 product_not_closed，不假装结论可靠。
//
// 纯函数，不依赖 three.js / DOM，Node 可直接 import。
// ============================================================
/** 三条互不平行的射线方向（都取正卦限附近但彼此分开，避免与坐标轴对齐的网格退化） */
const DIRS = [
  [0.8017837, 0.5345225, 0.2672612],
  [0.2672612, 0.8017837, 0.5345225],
  [0.5345225, 0.2672612, 0.8017837],
];

/**
 * 建一个"内外判定器"。
 * @param {{vertices:Float32Array, triCount:number}} mesh 产品网格
 * @param {object} gridInfo buildTriGrid(mesh, cell) 的返回值
 * @returns {{contains:Function, hitTriangle:Function, mesh:object, gridInfo:object}}
 */
export function buildInsideTester(mesh, gridInfo) {
  const seen = new Int32Array(mesh.triCount);
  let epoch = 0;
  return {
    mesh,
    gridInfo,
    /** 射线与某个三角形相交吗（Möller–Trumbore；平行时返回 false） */
    hitTriangle: makeHit(mesh),
    /** @returns {{inside:boolean, agree:number, votes:number[]}} agree = 多数票数（3 才叫可靠） */
    contains(p) {
      const votes = [];
      for (const d of DIRS) {
        epoch++;
        votes.push(rayParity(mesh, gridInfo, seen, epoch, p, d) & 1);
      }
      const ones = votes[0] + votes[1] + votes[2];
      return { inside: ones >= 2, agree: Math.max(ones, 3 - ones), votes };
    },
  };
}

/* ---------- 射线 × 三角形（Möller–Trumbore） ---------- */

function makeHit(mesh) {
  const v = mesh.vertices;
  return function hitTriangle(ox, oy, oz, dx, dy, dz, t, eps) {
    const o = t * 9;
    const ax = v[o], ay = v[o + 1], az = v[o + 2];
    const e1x = v[o + 3] - ax, e1y = v[o + 4] - ay, e1z = v[o + 5] - az;
    const e2x = v[o + 6] - ax, e2y = v[o + 7] - ay, e2z = v[o + 8] - az;
    const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) return false;          // 射线与三角面平行 → 没有交点
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < -eps || u > 1 + eps) return false;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const w = (dx * qx + dy * qy + dz * qz) * inv;
    if (w < -eps || u + w > 1 + eps) return false;
    const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return tt > 0;                                    // 只数前方的交点
  };
}

/* ---------- 射线 × 网格：沿格走（Amanatides–Woo DDA） ---------- */

/**
 * 数一条射线与整份网格的交点数。
 *
 * 为什么要 DDA 而不是"逐格扩大搜索球"：距离查询可以（点就在附近），射线不行 ——
 * 射线要走很远，球形搜索的代价按 r² 涨。
 *
 * ⚠ 三角形跨多格时必须去重，否则同一个三角形会被数很多次（`seen` + `epoch` 做的这件事）。
 */
function rayParity(mesh, gridInfo, seen, epoch, o, d) {
  const { grid, cell, key, always, bb } = gridInfo;
  if (!bb) return 0;

  // 1) 把射线夹到包围盒内（点在盒外 → 直接判"外"，无需发射线）
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < bb.min[a] || o[a] > bb.max[a]) return 0;
    } else {
      let ta = (bb.min[a] - o[a]) / d[a], tb = (bb.max[a] - o[a]) / d[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return 0;
    }
  }
  if (!(t1 > t0)) return 0;

  // 2) DDA 起点 = 进入包围盒的那一格
  const sx = o[0] + d[0] * t0, sy = o[1] + d[1] * t0, sz = o[2] + d[2] * t0;
  let i = Math.floor(sx / cell), j = Math.floor(sy / cell), k = Math.floor(sz / cell);
  const stepI = d[0] > 0 ? 1 : d[0] < 0 ? -1 : 0;
  const stepJ = d[1] > 0 ? 1 : d[1] < 0 ? -1 : 0;
  const stepK = d[2] > 0 ? 1 : d[2] < 0 ? -1 : 0;
  const deltaI = stepI ? Math.abs(cell / d[0]) : Infinity;
  const deltaJ = stepJ ? Math.abs(cell / d[1]) : Infinity;
  const deltaK = stepK ? Math.abs(cell / d[2]) : Infinity;
  let maxI = stepI ? ((stepI > 0 ? i + 1 : i) * cell - o[0]) / d[0] : Infinity;
  let maxJ = stepJ ? ((stepJ > 0 ? j + 1 : j) * cell - o[1]) / d[1] : Infinity;
  let maxK = stepK ? ((stepK > 0 ? k + 1 : k) * cell - o[2]) / d[2] : Infinity;

  const hit = makeHit(mesh);
  const eps = 1e-9;
  let count = 0;
  // 格子数上限：包围盒对角线 / cell + 3 —— 正常走完就 break，这是防跑飞的兜底
  const guardMax = Math.ceil(Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / cell) + 8;
  for (let guard = 0; guard < guardMax; guard++) {
    const b = grid.get(key(i, j, k));
    if (b) {
      for (let n = 0; n < b.length; n++) {
        const t = b[n];
        if (seen[t] === epoch) continue;              // 跨多格的三角形只数一次
        seen[t] = epoch;
        if (hit(o[0], o[1], o[2], d[0], d[1], d[2], t, eps)) count++;
      }
    }
    if (maxI <= maxJ && maxI <= maxK) { if (maxI > t1) break; i += stepI; maxI += deltaI; }
    else if (maxJ <= maxK) { if (maxJ > t1) break; j += stepJ; maxJ += deltaJ; }
    else { if (maxK > t1) break; k += stepK; maxK += deltaK; }
  }
  // 横跨超过 512 格的大三角形被 buildTriGrid 放进"常查表"，必须单独补上
  for (let n = 0; n < always.length; n++) {
    const t = always[n];
    if (seen[t] === epoch) continue;
    seen[t] = epoch;
    if (hit(o[0], o[1], o[2], d[0], d[1], d[2], t, eps)) count++;
  }
  return count;
}
