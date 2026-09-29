// ============================================================
// 点到三角网格的最近距离（纯 JS，带均匀空间哈希加速）
//
// 从 gatingTrace.js 抽出来的通用工具（PHASE 90 §十六：「已可作为通用几何工具则保留」）。
// PHASE 89 与 PHASE 90 两条链路都用它，且**两边都不改语义** —— 本文件是纯搬运 + 导出。
//
// ★ 唯一要记住的坑（实测推翻过一次又推翻一次，见 distanceToMesh 的注释）：
//     搜索起点必须取"查询点在包围盒上的最近点"所在的格，不能取查询点自己的格，
//     也不能"从包围盒距离对应的圈起扫"。三种写法的实测代价差三个数量级。
//
// 纯函数，不依赖 three.js / DOM，Node 可直接 import。
// ============================================================

/**
 * 为一份网格建均匀空间哈希。cell 建议取包围盒对角线 / 64 上下。
 * @returns {{grid:Map<string,number[]>, cell:number, key:Function, always:number[], bb:{min:number[],max:number[]}}}
 */
export function buildTriGrid(mesh, cell) {
  const grid = new Map();
  // 包围盒：给 distanceToMesh 定搜索起点（见该函数注释）
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0, n = mesh.triCount * 9; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.vertices[i + k];
      if (v < bmin[k]) bmin[k] = v;
      if (v > bmax[k]) bmax[k] = v;
    }
  }
  const key = (i, j, k) => i + ',' + j + ',' + k;
  const put = (k, t) => { const b = grid.get(k); if (b) b.push(t); else grid.set(k, [t]); };
  for (let t = 0; t < mesh.triCount; t++) {
    const o = t * 9;
    const bx = [Infinity, Infinity, Infinity], bX = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      for (let a = 0; a < 3; a++) {
        const v = mesh.vertices[o + k * 3 + a];
        if (v < bx[a]) bx[a] = v;
        if (v > bX[a]) bX[a] = v;
      }
    }
    const i0 = Math.floor(bx[0] / cell), i1 = Math.floor(bX[0] / cell);
    const j0 = Math.floor(bx[1] / cell), j1 = Math.floor(bX[1] / cell);
    const k0 = Math.floor(bx[2] / cell), k1 = Math.floor(bX[2] / cell);
    // 大三角形横跨很多格：封顶到 512 格，超出则放进"常查表"（宁可多查，不可漏查）
    if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > 512) { put('*', t); continue; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) put(key(i, j, k), t);
  }
  return { grid, cell, key, always: grid.get('*') || [], bb: { min: bmin, max: bmax } };
}

/** 点到单个三角形的真最近距离（Ericson 7 区域法）。v = 顶点数组，o = 三角形起始下标 */
export function pointTriDist(px, py, pz, v, o) {
  const ax = v[o], ay = v[o + 1], az = v[o + 2];
  const bx = v[o + 3], by = v[o + 4], bz = v[o + 5];
  const cx = v[o + 6], cy = v[o + 7], cz = v[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return Math.hypot(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return Math.hypot(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const s = d1 / (d1 - d3);
    return Math.hypot(px - (ax + abx * s), py - (ay + aby * s), pz - (az + abz * s));
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return Math.hypot(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const s = d2 / (d2 - d6);
    return Math.hypot(px - (ax + acx * s), py - (ay + acy * s), pz - (az + acz * s));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const s = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return Math.hypot(px - (bx + (cx - bx) * s), py - (by + (cy - by) * s), pz - (bz + (cz - bz) * s));
  }
  const den = va + vb + vc;
  const vv = vb / den, ww = vc / den;
  const qx = ax + abx * vv + acx * ww, qy = ay + aby * vv + acy * ww, qz = az + abz * vv + acz * ww;
  return Math.hypot(px - qx, py - qy, pz - qz);
}

/** 点到轴对齐包围盒的距离（真最近距离的下界；点在盒内时为 0） */
export function pointBoxDist(p, bb) {
  if (!bb) return 0;
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = p[k] < bb.min[k] ? bb.min[k] - p[k] : (p[k] > bb.max[k] ? p[k] - bb.max[k] : 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * 点到网格的最近距离（带格加速 + 常查表兜底）。
 *
 * ⚠ 搜索起点要取"查询点在包围盒上的最近点"所在的格，**不能取查询点自己的格**：
 *   原先固定从 0 圈扫到 6 圈，于是任何离网格超过 6 格的点都返回 Infinity。
 *   实测：一块悬在产品上方 200mm 的浇注系统，"到产品的最近距离"报成 null ——
 *   而这条距离正是"到底接没接上"的唯一证据。
 *   改成"从包围盒距离对应的圈起扫"也不行：那一圈是**球壳**，格子数按 r² 增长
 *   （实测 cell=3mm、距离 200mm 时每点要查 3 万格 × 3000 个采样点 = 上亿次 Map 查询，直接把测试跑挂）。
 *   正确做法：把查询点**夹到包围盒上**得到 q —— 网格的边界三角形就在 q 附近，
 *   而 p 的最近三角形必然是其中一个。从 q 的格开始扫，代价与距离无关。
 *
 * ⚠ 注意：搜索上限 8 圈、命中后只多扫 1 圈 → 返回值**可能略大于**真最近距离（不会更小）。
 *   做"是否接触"判定时，若 tol 极小可能漏判；PHASE 90 的 tol 是模型尺度的千分之几，
 *   远大于该高估量级。
 *
 * @returns {number} 最近距离（mm）；空网格返回 Infinity
 */
export function distanceToMesh(gridInfo, mesh, p) {
  const { grid, cell, key, always, bb } = gridInfo;
  let best = Infinity;
  // 夹到包围盒 → 搜索锚点（点本来就在盒内时 q === p，行为与原先一致）
  const q = bb ? p.map((v, k) => Math.min(Math.max(v, bb.min[k]), bb.max[k])) : p;
  const ci = Math.floor(q[0] / cell), cj = Math.floor(q[1] / cell), ck = Math.floor(q[2] / cell);
  // 逐圈扩大搜索半径：找到第一个非空格后，再多扫两圈收工
  let found = -1;
  for (let r = 0; r <= 8; r++) {
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let k = ck - r; k <= ck + r; k++) {
          // 只扫本次新增的壳
          if (r > 0 && Math.abs(i - ci) !== r && Math.abs(j - cj) !== r && Math.abs(k - ck) !== r) continue;
          const b = grid.get(key(i, j, k));
          if (!b) continue;
          // ★ PHASE 97 修：这里原先写的是 `found = r`（无条件），而下面的收工条件是
          //   `r > found` —— 于是只要本圈有任何命中，found 就被改写成 r，`r > r` 恒假，
          //   **永远不 break**，每次查询都把 9 圈全扫一遍。
          //   实测（产品 100×100×40、cell=2.296mm、查询点在表面上）：
          //     修前 grid.get 调用 **4913** 次（整整 17³ 格）；修后 **27** 次 —— 180 倍。
          //   本函数自己的注释写的就是"找到第一个非空格后，再多扫一圈收工"，
          //   所以下面这个写法才是原意，不是改行为。
          //   ⚠ 数值影响：多扫的圈只会**多找到**更近的三角形，所以修前的结果 >= 修后的结果
          //     （即修前更接近真值、修后是文档里写的那个"可能略大于真最近距离"的近似）。
          //     两者都满足"是真实距离的上界"这一契约；差量以格边长为界。
          if (found < 0) found = r;
          for (const t of b) {
            const d = pointTriDist(p[0], p[1], p[2], mesh.vertices, t * 9);
            if (d < best) best = d;
          }
        }
      }
    }
    if (found >= 0 && r > found) break;                 // 多扫一圈后收工
  }
  for (const t of always) {
    const d = pointTriDist(p[0], p[1], p[2], mesh.vertices, t * 9);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 一组点各自到网格的最近距离。
 * PHASE 90 的 Product↔Gating 连接检测就是靠它逐三角形质心查一遍。
 * @returns {Float64Array} 与 points 等长
 */
export function distancesToMesh(gridInfo, mesh, points) {
  const out = new Float64Array(points.length / 3);
  for (let i = 0, n = out.length; i < n; i++) {
    out[i] = distanceToMesh(gridInfo, mesh, [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]);
  }
  return out;
}
