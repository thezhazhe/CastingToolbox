// ============================================================
// Distance Field · 体素距离场（几何分析与热结分析共用）
// 流程：均匀体素网格 → 扫描线判内外（每行一条射线，奇偶翻转）→ BVH 最近点求半壁厚距离
// 性能：比逐点射线投票快约 50 倍（56³ 网格从 ~17s 降到 <1s）
// 输出：体素点坐标 / 内部点索引 / 内部点到表面距离（半壁厚语义）
// 纯引擎模块，Node 可测。
// ============================================================
import * as THREE from 'three';
import { computeBounds } from './stl.js';
import { distanceToSurface, distanceToSurfaceSliced } from './mesh3d.js';

export const DISTANCE_DEFAULTS = {
  resolution: 48,        // 主维度体素数
  maxResolution: 256,    // 薄壁自动升分辨率上限（24.txt PHASE 19：96 对 2m+ 件不够——
                         //   3m 壳壁 25mm 在 96³ 下 vs=31mm 仍采不到 →「距离场无有效采样」误报）
  minWallLayers: 6,      // 最小尺寸边少于 6 层 → 升分辨率
  minInsidePoints: 8,    // 多级采样停判据：内部点数下限（分位数可信阈值，同 V3 probeMinChars）
};

/**
 * 单方向扫描线判内外：对每一行发一条射线，命中交点奇偶翻转得该行全部体素状态。
 * 注意：射线掠过三角面共享边/顶点时会双命中（奇偶抵消）→ 单方向有系统性误差，
 * 必须多方向投票（scanInside 见下）。
 */
function scanAxis(geometry, bounds, gs, vs, axis, globalMin) {
  const inside = new Uint8Array(gs * gs * gs);
  const raycaster = new THREE.Raycaster();
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  if (axis === 0) dir.set(1, 0, 0); else if (axis === 1) dir.set(0, 1, 0); else dir.set(0, 0, 1);
  const ax = [0, 1, 2][axis];           // 扫描主轴（射线方向）
  const b1 = [1, 2, 0][axis];           // 第一个横轴
  const b2 = [2, 0, 1][axis];           // 第二个横轴
  // 射线起点必须在模型外（奇偶翻转基准）。局部细化 bbox 的起点只保证在 bbox 外，
  // bbox 外的相邻结构（MC 侧壁内缩后）可能侵入起点位置 → 外推到全局模型 bbox 外
  // （命中列表与采样点无关，仅起点变远，无性能影响；粗扫 bounds=全局 → 行为不变）。
  const o0 = Math.min(bounds.min[ax] - vs, globalMin[ax] - vs);
  const coord = (idx, a) => bounds.min[a] + (idx + 0.5) * vs;
  for (let j = 0; j < gs; j++) {
    for (let k = 0; k < gs; k++) {
      const o1 = coord(j, b1), o2 = coord(k, b2);
      const o = [0, 0, 0];
      o[ax] = o0; o[b1] = o1; o[b2] = o2;
      origin.set(o[0], o[1], o[2]);
      raycaster.set(origin, dir);
      const hits = raycaster.intersectObject(tmpMesh, false);
      let hi = 0, odd = false;
      const eps = vs * 0.02;   // 重合面合并阈值
      for (let i = 0; i < gs; i++) {
        const c = coord(i, ax);
        const d = c - o0;
        while (hi < hits.length && hits[hi].distance < d) {
          // 同距离组 = 一次表面穿越：MC 会把同一表面拆成 2+ 个三角
          //（重合面/CSG 槽侧壁与 box 表面重合处最多 4 层），只翻转 1 次。
          // 薄壁两侧（如 tube 内/外壁）距离差 >> eps → 各自成组，互不影响。
          odd = !odd;
          const cur = hits[hi].distance;
          hi++;
          while (hi < hits.length && hits[hi].distance - cur < eps) hi++;
        }
        const idx = [0, 0, 0];
        idx[ax] = i; idx[b1] = j; idx[b2] = k;
        inside[idx[0] * gs * gs + idx[1] * gs + idx[2]] = odd ? 1 : 0;
      }
    }
  }
  tmpMesh.material.dispose();
  return inside;
}

/**
 * 三方向扫描投票判内外：X/Y/Z 各扫一遍，每点多数投票（≥2 内部）。
 * 解决单方向射线掠过共享边/顶点导致双命中的系统性误判。
 * 性能：3×gs² 条射线（56³ 网格 <1s，仍比逐点射线快约 50 倍）。
 */
export function scanInside(geometry, bounds, gs, vs, globalMin) {
  const votes = [scanAxis(geometry, bounds, gs, vs, 0, globalMin), scanAxis(geometry, bounds, gs, vs, 1, globalMin), scanAxis(geometry, bounds, gs, vs, 2, globalMin)];
  const out = new Uint8Array(gs * gs * gs);
  for (let i = 0; i < out.length; i++) out[i] = (votes[0][i] + votes[1][i] + votes[2][i]) >= 2 ? 1 : 0;
  return out;
}

/* ---- 分片版（UI 用：分析期间让出主线程，保持可交互；Node 测试仍用同步版） ---- */

async function scanAxisSliced(geometry, bounds, gs, vs, axis, globalMin, yieldFn, sliceRows = 8, onProgress = null) {
  const inside = new Uint8Array(gs * gs * gs);
  const raycaster = new THREE.Raycaster();
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  if (axis === 0) dir.set(1, 0, 0); else if (axis === 1) dir.set(0, 1, 0); else dir.set(0, 0, 1);
  const ax = [0, 1, 2][axis];
  const b1 = [1, 2, 0][axis];
  const b2 = [2, 0, 1][axis];
  // 同 scanAxis：起点外推到全局模型 bbox 外（局部 bbox 起点可能落在相邻结构内）
  const o0 = Math.min(bounds.min[ax] - vs, globalMin[ax] - vs);
  const coord = (idx, a) => bounds.min[a] + (idx + 0.5) * vs;
  for (let j = 0; j < gs; j++) {
    for (let k = 0; k < gs; k++) {
      const o1 = coord(j, b1), o2 = coord(k, b2);
      const o = [0, 0, 0];
      o[ax] = o0; o[b1] = o1; o[b2] = o2;
      origin.set(o[0], o[1], o[2]);
      raycaster.set(origin, dir);
      const hits = raycaster.intersectObject(tmpMesh, false);
      let hi = 0, odd = false;
      const eps = vs * 0.02;
      for (let i = 0; i < gs; i++) {
        const c = coord(i, ax);
        const d = c - o0;
        while (hi < hits.length && hits[hi].distance < d) {
          odd = !odd;
          const cur = hits[hi].distance;
          hi++;
          while (hi < hits.length && hits[hi].distance - cur < eps) hi++;
        }
        const idx = [0, 0, 0];
        idx[ax] = i; idx[b1] = j; idx[b2] = k;
        inside[idx[0] * gs * gs + idx[1] * gs + idx[2]] = odd ? 1 : 0;
      }
    }
    if (yieldFn && j % sliceRows === sliceRows - 1) await yieldFn();
    // 真实进度（PHASE 22：三轴总行数归一化 0→1；可选参数，默认 null 零开销）
    if (onProgress && j % sliceRows === sliceRows - 1) onProgress((axis * gs + j) / (3 * gs));
  }
  tmpMesh.material.dispose();
  return inside;
}

/** 分片版三方向扫描投票（每 sliceRows 行让出一次事件循环；onProgress 可选） */
export async function scanInsideSliced(geometry, bounds, gs, vs, globalMin, yieldFn, onProgress = null) {
  const votes = await Promise.all([
    scanAxisSliced(geometry, bounds, gs, vs, 0, globalMin, yieldFn, 8, onProgress),
    scanAxisSliced(geometry, bounds, gs, vs, 1, globalMin, yieldFn, 8, onProgress),
    scanAxisSliced(geometry, bounds, gs, vs, 2, globalMin, yieldFn, 8, onProgress),
  ]);
  const out = new Uint8Array(gs * gs * gs);
  for (let i = 0; i < out.length; i++) out[i] = (votes[0][i] + votes[1][i] + votes[2][i]) >= 2 ? 1 : 0;
  return out;
}

/**
 * 构建体素距离场
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果（含 BVH）
 * @param {object} [opts]
 * @param {object} [boundsOverride] 采样范围（ENGINE 坐标）——Hotspot V2.1 局部细化用；
 *                                  默认 null = 全模型 bbox。采样网格/射线均基于此范围，
 *                                  BVH 与表面距离始终用全局 geometry（坐标一致）。
 * @returns {{
 *   gs:number, vs:number, bounds,
 *   pts:number[][],        // 全部体素中心（原始坐标系）
 *   insideIdx:number[],    // 内部点索引（对齐 pts）
 *   dists:(number|null)[], // 内部点到表面距离，对齐 insideIdx
 *   insideGrid:Uint8Array, // 扫描线内外网格（调试/热结复用）
 * }}
 */
export function buildDistanceField(mesh, geometry, opts = {}, boundsOverride = null) {
  const o = { ...DISTANCE_DEFAULTS, ...opts };
  const bounds = boundsOverride || computeBounds(mesh.vertices, mesh.triCount);
  // 射线起点外推基准：局部细化 bbox 时取全局模型 bbox（粗扫时即 bounds 本身）
  const globalMin = boundsOverride ? computeBounds(mesh.vertices, mesh.triCount).min : bounds.min;
  const mdim = Math.max(...bounds.size);
  let gs = o.resolution;
  const minDim = Math.min(...bounds.size);
  // 薄壁自动升分辨率（CastEyes 同款思路）
  if (minDim > 0 && minDim < (mdim / gs) * o.minWallLayers) {
    gs = Math.min(o.maxResolution, Math.ceil(o.minWallLayers * mdim / minDim));
  }

  // 多级采样 + 多相位合并（24.txt PHASE 19——「距离场无有效采样」根因修复）：
  //   基础升分辨率判据只看 bbox 最小边（minDim），对"大件+相对薄壁"（壳/板件：
  //   minDim=壳外尺寸 ≠ 壁厚）不触发 → 48³ 格距 > 壁厚 → 0 内部点 →
  //   thicknessStats 报「距离场无有效采样：壁厚可能小于网格采样极限」误报
  //   （实测 3m 壳壁 25mm：48³ vs=62.5 > 25 → 0 点；V2.3.1 已知限制）。
  //   逐级升级（×2 倍增至 maxResolution）。每级合并两个相位（原相位 + 半格偏移）的
  //   内部点——单相位可能全部错过壁中心（char 只采到 1/4 壁厚 → wallMain 低估一半，
  //   实测 1m 壳壁 20mm 在 96³ 下 wallMain 20→10.1），双相位互补保证有落点在壁中心。
  //   停判据：内部点 ≥ minInsidePoints 且估计壁厚（p95）≥ 1 层。
  //   正常模型第一相位即满足 → 零额外开销；真 0 内部点语义保留（不伪造）。
  let insideGrid = null, pts = [], insideIdx = [], dists = [];
  for (let g = gs; ; g = Math.min(o.maxResolution, g * 2)) {
    const v = mdim / g;
    pts = []; insideIdx = []; dists = [];   // 每级独立网格（不跨级累积）
    for (const off of [0, v / 2]) {
      // 相位偏移：平移采样网格起点（扫描线起点随之外移，命中不变）
      const shiftedMin = bounds.min.map(x => x + off);
      const bb = { min: shiftedMin, max: bounds.max, size: bounds.size };
      const grid = scanInside(geometry, bb, g, v, globalMin);
      const pp = [], ii = [];
      for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) {
        if (!grid[(i * g + j) * g + k]) continue;
        const p = [shiftedMin[0] + (i + 0.5) * v, shiftedMin[1] + (j + 0.5) * v, shiftedMin[2] + (k + 0.5) * v];
        pp.push(p);
        ii.push(pts.length + pp.length - 1);   // 全局索引（合并多相位）
      }
      const dd = distanceToSurface(geometry, pp);
      pts = pts.concat(pp); insideIdx = insideIdx.concat(ii); dists = dists.concat(dd);   // concat 防大数组 spread 栈溢出
      // 相位合并后的层数估算（p95 壁厚 vs 格距）——够层才停（否则采到点也算欠采样）
      const vals = dists.filter(x => x !== null && x > 0.001);
      const sorted = [...vals].sort((a, b) => a - b);
      const p95w = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] * 2 : 0;
      if (vals.length >= o.minInsidePoints && p95w >= v) {
        insideGrid = grid; gs = g;
        return { gs, vs: mdim / gs, bounds, pts, insideIdx, dists, insideGrid };
      }
      insideGrid = grid;   // 本级未满足 → 至少保留最后相位（真 0 点语义不变）
    }
    if (g >= o.maxResolution) break;
  }
  const vs = mdim / gs;

  return { gs, vs, bounds, pts, insideIdx, dists, insideGrid };
}

/**
 * 分片版距离场（UI 用：扫描与距离计算均让出主线程；返回结构同 buildDistanceField）
 * @param {object} [opts]
 * @param {Function} [yieldFn]
 * @param {Function} [onProgress]  PHASE 22 真实进度回调：onProgress(phase, frac)
 *   phase ∈ {'scan','dist'}；frac ∈ [0,1]（每级内归一化，调用方自行保单调）
 * @param {object} [boundsOverride]
 */
export async function buildDistanceFieldSliced(mesh, geometry, opts = {}, yieldFn, onProgress = null, boundsOverride = null) {
  const o = { ...DISTANCE_DEFAULTS, ...opts };
  const bounds = boundsOverride || computeBounds(mesh.vertices, mesh.triCount);
  // 同 buildDistanceField：射线起点外推基准 = 全局模型 bbox
  const globalMin = boundsOverride ? computeBounds(mesh.vertices, mesh.triCount).min : bounds.min;
  const mdim = Math.max(...bounds.size);
  let gs = o.resolution;
  const minDim = Math.min(...bounds.size);
  if (minDim > 0 && minDim < (mdim / gs) * o.minWallLayers) {
    gs = Math.min(o.maxResolution, Math.ceil(o.minWallLayers * mdim / minDim));
  }

  // 多级采样 + 多相位合并（同 buildDistanceField，24.txt PHASE 19——「距离场无有效采样」根因修复）
  // 进度：每级内 scan 两相位 → 0→1；dist → 0→1（真实计数；级间回退由调用方取 max 保单调）
  let insideGrid = null, pts = [], insideIdx = [], dists = [];
  for (let g = gs; ; g = Math.min(o.maxResolution, g * 2)) {
    const v = mdim / g;
    pts = []; insideIdx = []; dists = [];   // 每级独立网格（不跨级累积）
    for (let ph = 0; ph < 2; ph++) {
      const off = [0, v / 2][ph];
      const shiftedMin = bounds.min.map(x => x + off);
      const bb = { min: shiftedMin, max: bounds.max, size: bounds.size };
      const scanProgress = (frac) => onProgress?.('scan', (ph + frac) / 2);
      const grid = await scanInsideSliced(geometry, bb, g, v, globalMin, yieldFn, scanProgress);
      const pp = [], ii = [];
      for (let i = 0; i < g; i++) for (let j = 0; j < g; j++) for (let k = 0; k < g; k++) {
        if (!grid[(i * g + j) * g + k]) continue;
        const p = [shiftedMin[0] + (i + 0.5) * v, shiftedMin[1] + (j + 0.5) * v, shiftedMin[2] + (k + 0.5) * v];
        pp.push(p);
        ii.push(pts.length + pp.length - 1);   // 全局索引（合并多相位）
      }
      // 内部采样进度（PHASE 22：真实点计数分片报告，避免"80% 卡 30 秒"）
      let done = 0;
      const total = Math.max(1, Math.ceil(pp.length / 128));
      const distProgress = () => { done++; onProgress?.('dist', done / total); };
      const distYield = () => { const p = yieldFn ? yieldFn() : undefined; distProgress(); return p; };
      const dd = await distanceToSurfaceSliced(geometry, pp, Infinity, distYield);
      pts = pts.concat(pp); insideIdx = insideIdx.concat(ii); dists = dists.concat(dd);   // concat 防大数组 spread 栈溢出
      const vals = dists.filter(x => x !== null && x > 0.001);
      const sorted = [...vals].sort((a, b) => a - b);
      const p95w = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] * 2 : 0;
      if (vals.length >= o.minInsidePoints && p95w >= v) {
        insideGrid = grid; gs = g;
        return { gs, vs: mdim / gs, bounds, pts, insideIdx, dists, insideGrid };
      }
      insideGrid = grid;   // 本级未满足 → 至少保留最后相位（真 0 点语义不变）
    }
    if (g >= o.maxResolution) break;
  }
  const vs = mdim / gs;

  return { gs, vs, bounds, pts, insideIdx, dists, insideGrid };
}
