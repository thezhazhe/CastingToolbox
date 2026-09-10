// ============================================================
// V3 体素化 + 窗口块计数（13.txt §7/§8 — Local V / Local A 的 O(N) 方案）
// 全局体素化一次（scanInside 三方向扫描线，O(N)）→ inside 网格 + 边界体素
// （inside 且 6 邻域有 outside = 与模具/空气接触的金属表面）。
// 每个采样点的 Local V / Local A = 以其为中心的体素块内计数：
//   V = 块内 inside 体素数 × vs³
//   A = 块内边界体素数 × vs²
// 无 per-窗口 raycast/closestPoint/shapecast 主循环——13.txt §8 硬要求
// （规则高面数 STL 的 O(N×M) 退化被结构性杜绝）。
// 纯引擎模块，Node 可测。
// ============================================================
import { scanInside, scanInsideSliced } from '../distanceField.js';

/**
 * 全局体素化：判内外 + 边界体素标记
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果（含 BVH，供 scanInside 射线）
 * @param {object} bounds  {min:[x,y,z], max:[x,y,z]}（ENGINE 坐标）
 * @param {number} gs      每轴体素数
 * @param {number} vs      体素尺寸（mm）
 * @param {number[]} globalMin 全局模型 bbox min（射线起点外推基准）
 * @returns {{
 *   inside:Uint8Array, boundary:Uint8Array, gs, vs, bounds, globalMin
 * }}
 */
export function voxelize(geometry, bounds, gs, vs, globalMin) {
  const inside = scanInside(geometry, bounds, gs, vs, globalMin);
  // 边界体素：inside 且 6 邻域（网格内）存在 outside（= 与模具/空气接触）
  const boundary = new Uint8Array(inside.length);
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    const gi = (i * gs + j) * gs + k;
    if (!inside[gi]) continue;
    let b = 0;
    if (i + 1 >= gs || !inside[((i + 1) * gs + j) * gs + k]) b++;
    if (i - 1 < 0 || !inside[((i - 1) * gs + j) * gs + k]) b++;
    if (j + 1 >= gs || !inside[(i * gs + j + 1) * gs + k]) b++;
    if (j - 1 < 0 || !inside[(i * gs + j - 1) * gs + k]) b++;
    if (k + 1 >= gs || !inside[(i * gs + j) * gs + k + 1]) b++;
    if (k - 1 < 0 || !inside[(i * gs + j) * gs + k - 1]) b++;
    if (b) boundary[gi] = b;   // 记录接触面数（A 更精确：×接触面数）
  }
  return { inside, boundary, gs, vs, bounds, globalMin };
}

/**
 * 分片版体素化（PHASE 22 · UI 用）：扫描期间让出主线程；结果与 voxelize 一致。
 * @param {Function} [yieldFn]
 * @param {Function} [onProgress] 扫描进度回调（0→1 每轴归一化；可选）
 */
export async function voxelizeSliced(geometry, bounds, gs, vs, globalMin, yieldFn = null, onProgress = null) {
  const inside = await scanInsideSliced(geometry, bounds, gs, vs, globalMin, yieldFn, onProgress);
  // 边界体素：inside 且 6 邻域（网格内）存在 outside（= 与模具/空气接触）
  const boundary = new Uint8Array(inside.length);
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    const gi = (i * gs + j) * gs + k;
    if (!inside[gi]) continue;
    let b = 0;
    if (i + 1 >= gs || !inside[((i + 1) * gs + j) * gs + k]) b++;
    if (i - 1 < 0 || !inside[((i - 1) * gs + j) * gs + k]) b++;
    if (j + 1 >= gs || !inside[(i * gs + j + 1) * gs + k]) b++;
    if (j - 1 < 0 || !inside[(i * gs + j - 1) * gs + k]) b++;
    if (k + 1 >= gs || !inside[(i * gs + j) * gs + k + 1]) b++;
    if (k - 1 < 0 || !inside[(i * gs + j) * gs + k - 1]) b++;
    if (b) boundary[gi] = b;   // 记录接触面数（A 更精确：×接触面数）
  }
  return { inside, boundary, gs, vs, bounds, globalMin };
}

/**
 * 窗口块计数：以采样点为中心的体素块内 V/A
 * @param {{inside:Uint8Array, boundary:Uint8Array, gs, vs, bounds}} vox  voxelize 结果
 * @param {number[]} p    采样点坐标（应与体素网格对齐——粗场采样点来自网格子采样）
 * @param {number} R      窗口半径（mm）
 * @returns {{
 *   v:number, a:number, nInside:number, nBoundary:number, nFaces:number,
 *   winSize:number        // 块边长（体素）
 * }}
 */
export function windowVoxels(vox, p, R) {
  const { inside, boundary, gs, vs, bounds } = vox;
  const min = bounds.min;
  // 采样点 → 中心体素索引
  const ci = Math.max(0, Math.min(gs - 1, Math.floor((p[0] - min[0]) / vs)));
  const cj = Math.max(0, Math.min(gs - 1, Math.floor((p[1] - min[1]) / vs)));
  const ck = Math.max(0, Math.min(gs - 1, Math.floor((p[2] - min[2]) / vs)));
  // 块半宽（体素）：+1 层覆盖网格相位缺口（13.txt §30 数值伪影抑制）——
  //   实测：中心体素 14 的块 [0..30]（97mm）缺 1 层模型表面 → A 差 50% → M 虚高 31.6；
  //   +1 层 → 块 [0..31] 含完整表面 → M=16.7 均匀。物理上窗口半径 = R + vs/2 ✓
  const half = Math.max(1, Math.round(R / vs) + 1);
  const i0 = Math.max(0, ci - half), i1 = Math.min(gs - 1, ci + half);
  const j0 = Math.max(0, cj - half), j1 = Math.min(gs - 1, cj + half);
  const k0 = Math.max(0, ck - half), k1 = Math.min(gs - 1, ck + half);

  let nInside = 0, nFaces = 0, nBoundary = 0;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
    const gi = (i * gs + j) * gs + k;
    if (!inside[gi]) continue;
    nInside++;
    const bf = boundary[gi];
    if (bf) { nBoundary++; nFaces += bf; }
  }
  const vs2 = vs * vs, vs3 = vs2 * vs;
  return {
    v: nInside * vs3,
    a: nFaces * vs2,        // 接触面数 × 面元面积（更精确的散热界面）
    nInside, nBoundary, nFaces,
    winSize: (i1 - i0 + 1),
  };
}
