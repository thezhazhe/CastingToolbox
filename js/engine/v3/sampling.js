// ============================================================
// V3 Adaptive Spatial Sampling（13.txt §5/§6 重构版）
// 采样率由模型自动决定，不是 bbox/固定 voxel 数：
//   Stage 1 粗探测（16³ 快速扫描 + BVH 距离）→ char 分布
//   Stage 2 从 char 低分位估计最小壁厚 → 目标 vs = 0.5×估计壁厚（≥2 层）
//   Stage 3 vs 夹在 [mdim/MAX_RESOLUTION, mdim/MIN_RESOLUTION]（保护上限）
// 判内外：scanInside 三方向扫描线（O(N)，ray origin 全局 bbox 外——V2.2 已修历史 bug）
// 纯引擎模块，Node 可测。
// ============================================================
import * as THREE from 'three';
import { computeBounds } from '../stl.js';
import { scanInside } from '../distanceField.js';
import { distanceToSurface, distanceToSurfaceSliced } from '../mesh3d.js';
import { voxelize, voxelizeSliced } from './windowV.js';
import { V3_DEFAULTS } from './configV3.js';

/**
 * 局部完整厚度测度（PHASE 23 · 31.txt 五/六 根因修复）：
 * 旧语义 estMinWall = char p10（最近表面距离×2 的低分位）是"表面密度"统计——
 * 任何带表面特征的实体其 p10 恒 ≈2-4mm（表面壳层占体积 25-40%），无法判别
 * "真实薄材料"（ALR2510 真薄壁 2.3mm 与 HR4012 大板 48mm 主体的 p10 几乎相同）。
 * 本测度对每个采样点计算**局部完整厚度** t = d + d2：
 *   d  = 到最近表面距离（BVH，已有）；d2 = 沿最近表面方向到远侧表面的距离（射线）
 * → 48mm 厚板表面点的 t ≈ 48（不再是 2mm）；4mm 肋的 t ≈ 4。t 分布直接度量
 * "真实有多少材料是薄的"，与表面壳层解耦。
 * @returns {{thinFrac:number, tP10:number, tP50:number, samples:number, noFar:number}}
 *   thinFrac = P(t < 2×vs)（低于 2 层采样下限的材料占比）
 */
export function localThicknessStats(geometry, pts, dists, vs, opts = {}) {
  const bvh = geometry?.boundsTree;
  if (!bvh) return { thinFrac: 0, tP10: 0, tP50: 0, samples: 0, noFar: 0 };
  const raycaster = new THREE.Raycaster();
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const vec = new THREE.Vector3();
  const target = new THREE.Vector3();
  const ts = [];
  let noFar = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = dists[i];
    if (d === null || !(d > 0.001)) { ts.push(null); continue; }
    vec.set(p[0], p[1], p[2]);
    const r = bvh.closestPointToPoint(vec, target, 0, Infinity);
    const S = r?.point;
    if (!S) { ts.push(null); continue; }
    // 局部法线（表面→点，指向材料内部）；远侧表面 = 射线越过最近表面后的首个命中
    const n = new THREE.Vector3(p[0] - S.x, p[1] - S.y, p[2] - S.z).normalize();
    raycaster.set(vec, n);
    const hits = raycaster.intersectObject(tmpMesh, false);
    let d2 = null;
    for (const h of hits) if (h.distance > d * 1.02) { d2 = h.distance; break; }
    if (d2 === null) { noFar++; ts.push(null); continue; }
    ts.push(d + d2);
  }
  tmpMesh.material.dispose();
  const vals = ts.filter(x => x !== null && x > 0.05).sort((a, b) => a - b);
  if (!vals.length) return { thinFrac: 0, tP10: 0, tP50: 0, samples: 0, noFar };
  const p = (q) => vals[Math.floor(vals.length * q)];
  const thinLine = 2 * vs;
  const thinFrac = vals.filter(x => x < thinLine).length / vals.length;
  return { thinFrac, tP10: p(0.1), tP50: p(0.5), samples: vals.length, noFar, tArr: ts };
}

/**
 * 自适应体素尺寸：多级粗探测 → char 分布 → 估计最小壁厚 → vs
 * @param {THREE.BufferGeometry} geometry
 * @param {object} bounds {min, max, size}
 * @param {number[]} globalMin
 * @param {object} opts
 * @returns {{vs:number, gs:number, estMinWall:number, probePts:number, probeLevel:number}}
 */
export function adaptiveVs(geometry, bounds, globalMin, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const mdim = Math.max(...bounds.size);

  // Stage 1：多级粗探测（23.txt PHASE 18——NO_INSIDE_POINTS 根因修复）
  //   16³ 探测对"壁厚 < mdim/16 格距"的薄壁可能 0 落点（确定性网格相位全部错过）
  //   → estMinWall=mdim/40 兜底 → vs=mdim/80 → 主网格同样无落点 → 0 内部点。
  //   逐级升级（16→32→48→64→96→128）直到 char 足够（探测到真实壁厚）或到达最高级。
  //   级级可退，性能有上限（各级 3×gs² 条射线，BVH 求交秒级）。
  let probeLevel = 0, probePts = [], chars = [];
  for (const pgs of o.probeResolutionSteps) {
    const pvs = mdim / pgs;
    probeLevel = pgs;
    const inside = scanInside(geometry, bounds, pgs, pvs, globalMin);
    const pts = [];
    for (let i = 0; i < pgs; i++) for (let j = 0; j < pgs; j++) for (let k = 0; k < pgs; k++) {
      if (!inside[(i * pgs + j) * pgs + k]) continue;
      pts.push([bounds.min[0] + (i + 0.5) * pvs, bounds.min[1] + (j + 0.5) * pvs, bounds.min[2] + (k + 0.5) * pvs]);
    }
    // Stage 2：char 分布（2×到表面距离=局部壁厚）→ p10 = 最小壁厚估计
    //   过滤 MC 网格表面伪尖峰（char < 2mm——网格化曲面的伪曲率，实测 cylinder/ring
    //   的 char p10 被污染到 1~2mm → vs 爆细到 1.2mm → 网格噪声峰）。
    //   工程假设（UNKNOWN 待真实 STL 校准）：MC 网格化最小可信特征 ≈ 2mm。
    const dists = pts.length ? distanceToSurface(geometry, pts) : [];
    const cs = dists.filter(d => d !== null && d > 0.001 && d * 2 >= o.charFilterMin).map(d => d * 2);
    cs.sort((a, b) => a - b);
    probePts = pts; chars = cs;
    if (cs.length >= o.probeMinChars) break;   // 足够 char → 该级停止升级
  }
  let estMinWall = chars.length >= o.probeMinChars ? chars[Math.max(0, Math.floor(chars.length * 0.1))] : (mdim / o.coarseResolution);
  estMinWall = Math.max(estMinWall, o.estWallFloor);   // 保底下限（防全部伪尖峰/空）

  // Stage 3：目标 vs = 0.5×最小壁厚（≥2 层），夹在保护区间
  const vsMax = mdim / o.coarseMinRes;                 // 最粗（下限分辨率）
  const vsMin = mdim / o.coarseMaxRes;                 // 最细（上限分辨率，保护）
  let vs = Math.max(vsMin, Math.min(vsMax, 0.5 * estMinWall));
  // 注（PHASE 22 实测结论，30.txt 十/十一）：曾尝试"主体壁厚决定 vs 下限"（bodyWall/5），
  // 但 ALHR4510 实模验证：p10 局部壁厚（≈5mm 肋）与主体（≈20mm）同尺度，2× 放宽
  // 即 5 热结 → NO_HOTSPOT（肋本身是热结结构）。防"局部极薄特征爆分辨率"已由
  // charFilterMin=2mm（<2mm 特征不进 char 统计）+ estWallFloor=4mm（vs ≥ 2mm 保底）
  // 结构性承担——不再叠加会改变验证结果的额外下限。
  let gs = Math.round(mdim / vs);
  // PHASE 23 实验 override（31.txt 三：仅供 192³/256³/384³ 对照实验，生产默认不传——
  // 传入时强制主网格分辨率，estMinWall 仍按探测链路计算，不改任何生产语义）
  if (o.experimentalGs > 0) {
    vs = mdim / o.experimentalGs;
    gs = o.experimentalGs;
  }

  return { vs, gs, estMinWall, probePts: probePts.length, probeLevel };
}

/**
 * 粗采样：自适应 vs 全局体素化 + 降密度采样点 + 每点 BVH 距离（char=2d）
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果（含 BVH）
 * @param {object} [opts]
 * @returns {{
 *   vox,               // voxelize 结果（inside/boundary/gs/vs/bounds/globalMin）
 *   pts:number[][],    // 采样点（ENGINE 坐标，体素网格对齐）
 *   insideIdx:number[],// 采样点对应体素网格索引（对齐 pts）
 *   dists:(number|null)[], char:(number|null)[], d:(number|null)[],
 *   estMinWall, scanMs, stride
 * }}
 */
export function coarseSample(mesh, geometry, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const globalMin = bounds.min;
  const mdim = Math.max(...bounds.size);

  // 自适应 vs（多级粗探测 + char p10）
  const { vs, estMinWall, probePts, probeLevel } = adaptiveVs(geometry, bounds, globalMin, o);

  // 主网格多级采样（23.txt PHASE 18——0 内部点修复）：
  //   自适应 vs 对"壁厚 < vs"的薄壁可能因网格相位无落点 → 0 内部点 → NO_INSIDE_POINTS
  //   （实测：2m 壳壁 5/8mm，vs=mdim/80=25mm，主网格 80³ 壁内无落点）。
  //   逐级尝试：原 vs → 半格偏移（相位互补）→ vs/2 → 半格 → ... → 直到获得足够内部点
  //   或到达上限（maxSampleGs 性能保护）。偏移 = 平移 bounds.min（采样点 = 偏移网格中心，
  //   ENGINE 坐标真实位置；voxelize 签名不变）。
  //   全部级别仍不足 → 保留最后一试（有内部点即可进入分析，欠采样由 WARNING 层报）；
  //   真 0 内部点 → NO_INSIDE_POINTS 语义不变（hotspotV3 出口保留）。
  let vox = null, usedGs = 0, usedVs = 0;
  let last = null;
  for (let lv = 0; lv <= o.sampleVsLevels; lv++) {
    const lvs = vs / (2 ** lv);
    for (const off of [0, lvs * o.phaseOffsetHalf]) {
      let gvs = lvs;
      let ggs = Math.round(mdim / gvs);
      if (ggs > o.maxSampleGs) { ggs = o.maxSampleGs; gvs = mdim / ggs; }
      const shiftedMin = bounds.min.map(v => v + off);
      const trial = voxelize(geometry, { min: shiftedMin, max: bounds.max, size: bounds.size }, ggs, gvs, globalMin);
      let nInside = 0;
      for (let i = 0; i < trial.inside.length; i++) if (trial.inside[i]) nInside++;
      last = { trial, ggs, gvs };
      if (nInside >= o.minInsidePoints) { vox = trial; usedGs = ggs; usedVs = gvs; break; }
    }
    if (vox) break;
  }
  if (!vox) { vox = last.trial; usedGs = last.ggs; usedVs = last.gvs; }
  const gs = usedGs, vsF = usedVs;

  // 采样点：inside 体素按 3D stride 降密度（点数上限保护：≤ coarseMaxPoints）
  // stride = ceil(gs / 目标每轴采样数)，目标总点 ≈ clamp(inside×gs³/stride³)
  let nInside = 0;
  for (let i = 0; i < vox.inside.length; i++) if (vox.inside[i]) nInside++;
  const targetPts = Math.min(nInside, o.coarseMaxPoints);
  const stride = Math.max(1, Math.ceil(Math.cbrt(nInside / Math.max(1, targetPts))));
  const min = vox.bounds.min;

  const pts = [];
  const insideIdx = [];
  for (let i = 0; i < gs; i += stride) for (let j = 0; j < gs; j += stride) for (let k = 0; k < gs; k += stride) {
    const gi = (i * gs + j) * gs + k;
    if (!vox.inside[gi]) continue;
    pts.push([min[0] + (i + 0.5) * vsF, min[1] + (j + 0.5) * vsF, min[2] + (k + 0.5) * vsF]);
    insideIdx.push(gi);
  }

  // 每采样点 BVH 距离（O(N) 级：1 次 closestPoint/点，非主循环）
  const dists = distanceToSurface(geometry, pts);
  const char = dists.map(d => (d !== null && d > 0.001 ? d * 2 : null));
  // 局部完整厚度测度（PHASE 23：WARNING 判别用；~20k 点 × 1 射线 ≈ 百毫秒级）
  const thin = localThicknessStats(geometry, pts, dists, vsF, o);

  return { vox, pts, insideIdx, dists, char, thin, tArr: thin.tArr, estMinWall, probePts, probeLevel, scanMs: Date.now() - t0, stride, gs, vs: vsF, bounds: vox.bounds, globalMin };
}

/**
 * 分片版粗采样（PHASE 22 · UI 用）：与 coarseSample 逐字段一致（同一自适应 vs、
 * 同一多级/双相位循环、同一 stride），仅在扫描与 BVH 距离期间让出主线程。
 * @param {Function} [yieldFn]
 * @param {Function} [onProgress]  onProgress(phase, frac)：phase ∈ {'scan','dist','probe'}
 */
export async function coarseSampleSliced(mesh, geometry, opts = {}, yieldFn = null, onProgress = null) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const globalMin = bounds.min;
  const mdim = Math.max(...bounds.size);

  // 自适应 vs（粗探测与同步版同一实现；低分辨率探测毫秒级，不做分片）
  const { vs, estMinWall, probePts, probeLevel } = adaptiveVs(geometry, bounds, globalMin, o);

  // 主网格多级采样（同 coarseSample：逐级尝试 → 半格偏移 → vs/2 → …）
  let vox = null, usedGs = 0, usedVs = 0;
  let last = null;
  for (let lv = 0; lv <= o.sampleVsLevels; lv++) {
    const lvs = vs / (2 ** lv);
    for (let ph = 0; ph < 2; ph++) {
      const off = [0, lvs * o.phaseOffsetHalf][ph];
      let gvs = lvs;
      let ggs = Math.round(mdim / gvs);
      if (ggs > o.maxSampleGs) { ggs = o.maxSampleGs; gvs = mdim / ggs; }
      const shiftedMin = bounds.min.map(v => v + off);
      const scanProgress = (frac) => onProgress?.('scan', (lv * 2 + ph + frac) / ((o.sampleVsLevels + 1) * 2));
      const trial = await voxelizeSliced(geometry, { min: shiftedMin, max: bounds.max, size: bounds.size }, ggs, gvs, globalMin, yieldFn, scanProgress);
      let nInside = 0;
      for (let i = 0; i < trial.inside.length; i++) if (trial.inside[i]) nInside++;
      last = { trial, ggs, gvs };
      if (nInside >= o.minInsidePoints) { vox = trial; usedGs = ggs; usedVs = gvs; break; }
    }
    if (vox) break;
  }
  if (!vox) { vox = last.trial; usedGs = last.ggs; usedVs = last.gvs; }
  const gs = usedGs, vsF = usedVs;

  // 采样点：inside 体素按 3D stride 降密度（点数上限保护：≤ coarseMaxPoints）
  let nInside = 0;
  for (let i = 0; i < vox.inside.length; i++) if (vox.inside[i]) nInside++;
  const targetPts = Math.min(nInside, o.coarseMaxPoints);
  const stride = Math.max(1, Math.ceil(Math.cbrt(nInside / Math.max(1, targetPts))));
  const min = vox.bounds.min;

  const pts = [];
  const insideIdx = [];
  for (let i = 0; i < gs; i += stride) for (let j = 0; j < gs; j += stride) for (let k = 0; k < gs; k += stride) {
    const gi = (i * gs + j) * gs + k;
    if (!vox.inside[gi]) continue;
    pts.push([min[0] + (i + 0.5) * vsF, min[1] + (j + 0.5) * vsF, min[2] + (k + 0.5) * vsF]);
    insideIdx.push(gi);
  }

  // 每采样点 BVH 距离（分片；进度真实计数）
  let done = 0;
  const total = Math.max(1, Math.ceil(pts.length / 128));
  const distYield = () => { const p = yieldFn ? yieldFn() : undefined; done++; onProgress?.('dist', done / total); return p; };
  const dists = await distanceToSurfaceSliced(geometry, pts, Infinity, distYield);
  const char = dists.map(d => (d !== null && d > 0.001 ? d * 2 : null));
  // 局部完整厚度测度（与同步版同一实现；点分批让出主线程）
  const thin = await localThicknessStatsSliced(geometry, pts, dists, vsF, yieldFn, o);

  return { vox, pts, insideIdx, dists, char, thin, tArr: thin.tArr, estMinWall, probePts, probeLevel, scanMs: Date.now() - t0, stride, gs, vs: vsF, bounds: vox.bounds, globalMin };
}

/** 分片版局部完整厚度测度（PHASE 23 · UI 用；结果与 localThicknessStats 一致） */
export async function localThicknessStatsSliced(geometry, pts, dists, vs, yieldFn = null, opts = {}) {
  const bvh = geometry?.boundsTree;
  if (!bvh) return { thinFrac: 0, tP10: 0, tP50: 0, samples: 0, noFar: 0 };
  const raycaster = new THREE.Raycaster();
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const vec = new THREE.Vector3();
  const target = new THREE.Vector3();
  const ts = [];
  let noFar = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const d = dists[i];
    if (d === null || !(d > 0.001)) { ts.push(null); continue; }
    vec.set(p[0], p[1], p[2]);
    const r = bvh.closestPointToPoint(vec, target, 0, Infinity);
    const S = r?.point;
    if (!S) { ts.push(null); continue; }
    const n = new THREE.Vector3(p[0] - S.x, p[1] - S.y, p[2] - S.z).normalize();
    raycaster.set(vec, n);
    const hits = raycaster.intersectObject(tmpMesh, false);
    let d2 = null;
    for (const h of hits) if (h.distance > d * 1.02) { d2 = h.distance; break; }
    if (d2 === null) { noFar++; ts.push(null); continue; }
    ts.push(d + d2);
    if (yieldFn && i % 256 === 255) await yieldFn();
  }
  tmpMesh.material.dispose();
  const vals = ts.filter(x => x !== null && x > 0.05).sort((a, b) => a - b);
  if (!vals.length) return { thinFrac: 0, tP10: 0, tP50: 0, samples: 0, noFar };
  const p = (q) => vals[Math.floor(vals.length * q)];
  const thinLine = 2 * vs;
  const thinFrac = vals.filter(x => x < thinLine).length / vals.length;
  return { thinFrac, tP10: p(0.1), tP50: p(0.5), samples: vals.length, noFar, tArr: ts };
}

/**
 * 细化采样：候选区域局部体素化（vs 与粗场同量级或更细）+ 采样点
 * @param {THREE.BufferGeometry} geometry
 * @param {number[][]} region  [[minX,minY,minZ],[maxX,maxY,maxZ]]
 * @param {number[]} globalMin
 * @param {number} coarseVs    粗场 vs（空间分辨率守恒）
 * @param {object} [opts]
 * @returns {同 coarseSample（局部）}
 */
export function refineSample(geometry, region, globalMin, coarseVs, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();
  const min = region[0], max = region[1];
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const mdim = Math.max(...size);

  // 细化 vs：与粗场同量级，但不超过区域 mdim/refineMinRes（区域小 → 更细）
  const vs = Math.min(coarseVs, mdim / o.refineMinRes);
  const gs = Math.max(Math.round(mdim / vs), o.refineMinRes);
  const bounds = { min, max };
  const vox = voxelize(geometry, bounds, gs, vs, globalMin);

  const stride = Math.max(1, Math.ceil(Math.cbrt(gs ** 3 / o.refineMaxPoints)));
  const pts = [];
  const insideIdx = [];
  for (let i = 0; i < gs; i += stride) for (let j = 0; j < gs; j += stride) for (let k = 0; k < gs; k += stride) {
    const gi = (i * gs + j) * gs + k;
    if (!vox.inside[gi]) continue;
    pts.push([min[0] + (i + 0.5) * vs, min[1] + (j + 0.5) * vs, min[2] + (k + 0.5) * vs]);
    insideIdx.push(gi);
  }

  const dists = distanceToSurface(geometry, pts);
  const char = dists.map(d => (d !== null && d > 0.001 ? d * 2 : null));
  // 局部完整厚度（PHASE 24：M 场物理上限用 t 而非 d——板/肋状厚结构不被 (1/3)×d 错误压制）
  const thin = localThicknessStats(geometry, pts, dists, vs, o);

  return { vox, pts, insideIdx, dists, char, thin, tArr: thin.tArr, scanMs: Date.now() - t0, stride, gs, vs, bounds, globalMin, estMinWall: 0 };
}

/** 细化区域：候选峰 ± margin × R_medium（夹在全局 bbox 内） */
export function refineRegion(bounds, p, rMedium, margin) {
  const min = [0, 1, 2].map(a => Math.max(bounds.min[a], p[a] - margin * rMedium));
  const max = [0, 1, 2].map(a => Math.min(bounds.max[a], p[a] + margin * rMedium));
  return [min, max];
}

/**
 * 网格 6 邻域采样点索引（±stride 格）
 * @param {Int32Array} gridToPt
 * @param {number} gs
 * @param {number} gi 网格索引
 * @param {number} [stride]
 */
export function gridNeighbors6(gridToPt, gs, gi, stride = 1) {
  const i = Math.floor(gi / (gs * gs)), rest = gi % (gs * gs);
  const j = Math.floor(rest / gs), k = rest % gs;
  const out = [];
  const tryAdd = (ii, jj, kk) => {
    if (ii < 0 || jj < 0 || kk < 0 || ii >= gs || jj >= gs || kk >= gs) return;
    const n = gridToPt[ii * gs * gs + jj * gs + kk];
    if (n >= 0) out.push(n);
  };
  tryAdd(i + stride, j, k); tryAdd(i - stride, j, k);
  tryAdd(i, j + stride, k); tryAdd(i, j - stride, k);
  tryAdd(i, j, k + stride); tryAdd(i, j, k - stride);
  return out;
}

/** 采样点 → 网格索引映射（6 邻域连通用）：gridIndex → pt 索引（-1 = 非采样点） */
export function buildGridToPt(gs, insideGrid, insideIdx) {
  const gridToPt = new Int32Array(gs * gs * gs).fill(-1);
  for (let t = 0; t < insideIdx.length; t++) gridToPt[insideIdx[t]] = t;
  return gridToPt;
}
