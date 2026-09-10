// ============================================================
// V3 Peak / Region / Multi-scale / Representative / Confidence（13.txt §10-§12 重构版）
// Hotspot ≠ 全模型 M 最大（13.txt §10）——prominence = 峰 vs 周围区域：
//   环带背景 = 峰 2R~4R 壳内采样点的 M 中位数（"相对于周围区域明显更高"）。
//   均匀件（cube/plate/cylinder/tube/ring）：M 高但平坦（环带≈峰）→ prom≈0 → 不报
//   切表面虚高（cube 表面层一圈同水平）→ 环带含虚高圈 → prom 低 → 不报
// 检测规则（13.txt §10 核心逻辑）：
//   1. Local M 高值区域（局部极大）
//   2. 相对周围明显更高（环带显著性）
//   3. 合并相邻高值区域（NMS）
//   4. 过滤采样噪声小区域（regionMinVolume）
// 代表点：连通高 M 区域质心 + 金属合法性校验 + fallback（V2.2 已验证思想，§12）
// 纯引擎模块，Node 可测。
// ============================================================
import { buildModulusField } from './modulusField.js';
import { gridNeighbors6 } from './sampling.js';
import { isInside } from '../mesh3d.js';
import { V3_DEFAULTS } from './configV3.js';

/**
 * 峰检测：严格 6 邻域局部极大 + 环带显著性 + NMS
 * @param {Float64Array} M        细化 M 场（对齐 sample.pts）
 * @param {object} sample         {pts, gridToPt, gs, insideIdx, stride}
 * @param {{R:Float64Array}} field
 * @param {object} opts
 * @returns {Array<{pt:number, gi:number, M:number, prominence:number, R:number}>} 降序
 */
export function findPeaks(M, sample, field, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const { gridToPt, gs, insideIdx } = sample;
  const stride = sample.stride ?? 1;
  const n = insideIdx.length;
  const pts = sample.pts;
  const Rarr = field.R;

  // 候选：严格局部极大（邻居必须严格更小；无邻居的边界点拒绝）
  const cand = [];
  for (let t = 0; t < n; t++) {
    const m = M[t];
    if (m <= 0) continue;
    const gi = insideIdx[t];
    const nbrs = gridNeighbors6(gridToPt, gs, gi, stride);
    if (!nbrs.length) continue;
    // 局部极大区域（13.txt §10）：等值邻居不算否定（等高高原的每个点都是极大，
    //   由 NMS 合并为一个候选）——严格极大对高原失效（实测 boss 凸台高原 M 等值）
    let isMax = true;
    for (const nb of nbrs) {
      if (M[nb] > m) { isMax = false; break; }
    }
    if (!isMax) continue;
    cand.push(t);
  }

  // 环带显著性：峰 2R~4R 壳内 M 中位数 → prominence = (M − 环带中位)/M
  const peaks = [];
  for (const t of cand) {
    const m = M[t];
    const r = Rarr[t];
    const ri = o.ringInner * r, ro = o.ringOuter * r;
    const ring = [];
    for (let q = 0; q < n; q++) {
      if (q === t) continue;
      const d = Math.hypot(pts[q][0] - pts[t][0], pts[q][1] - pts[t][1], pts[q][2] - pts[t][2]);
      if (d >= ri && d <= ro && M[q] > 0) ring.push(M[q]);
    }
    if (ring.length < 3) continue;   // 环带采样不足（区域边缘）→ 无局部背景 → 拒绝
    ring.sort((a, b) => a - b);
    const bg = ring[Math.floor(ring.length / 2)];
    const prom = (m - bg) / m;
    if (prom < o.peakProminenceMin) continue;
    peaks.push({ pt: t, gi: insideIdx[t], M: m, prominence: prom, R: r });
  }

  peaks.sort((a, b) => b.M - a.M);

  // NMS：间距 < ratio × R_medium(较大者) → 丢弃低者（相邻高值区域合并）
  const kept = [];
  for (const p of peaks) {
    let tooClose = false;
    for (const q of kept) {
      const r = Math.max(p.R, q.R);
      const d = Math.hypot(pts[p.pt][0] - pts[q.pt][0], pts[p.pt][1] - pts[q.pt][1], pts[p.pt][2] - pts[q.pt][2]);
      if (d < o.peakSeparationRatio * r) { tooClose = true; break; }
    }
    if (!tooClose) kept.push(p);
  }
  return kept;
}

/**
 * 多尺度验证（简化，13.txt §13：不要求完美 45°，不做特殊规则）：
 * 峰点 0.5×/1.0×/2.0× 窗口的 M 值——至少 multiscaleMinScales 个尺度
 * M ≥ 0.6×maxM（峰在多数尺度存在 → 非单尺度噪声），变异系数上限。
 * @returns {{Ms:[number,number,number], cv:number, stable:boolean, stability:number}}
 */
export function multiscaleVerify(vox, sample, ptIdx, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const kArr = o.windowK;
  const Ms = [];
  for (const k of kArr) {
    const f = buildModulusField(vox, sample, opts, k, [ptIdx]);
    Ms.push(f.M[0]);
  }
  const maxM = Math.max(...Ms);
  let scales = 0;
  for (const m of Ms) if (maxM > 0 && m >= 0.6 * maxM) scales++;
  const mean = Ms.reduce((a, b) => a + b, 0) / Ms.length;
  const cv = mean > 0 ? Math.sqrt(Ms.reduce((a, b) => a + (b - mean) ** 2, 0) / Ms.length) / mean : 1;
  const stable = scales >= o.multiscaleMinScales && cv <= o.multiscaleModulusSpread;
  const stability = Math.min(1, 0.5 * (scales / kArr.length) + 0.5 * Math.max(0, 1 - cv / o.multiscaleModulusSpread));
  return { Ms, cv, stable, stability };
}

/**
 * Region 提取：峰出发 BFS（6 邻域，M ≥ regionGrowRatio × M_peak）
 * 输出 peak M / mean M / region volume / centroid / regionArea
 */
export function extractRegion(M, sample, peakPt, opts = {}, field = null) {
  const o = { ...V3_DEFAULTS, ...opts };
  const { gridToPt, gs, insideIdx, vs } = sample;
  const peakM = M[peakPt];
  // PHASE 24（32.txt 根因修复）：区域生长阈值用**未封顶原始 V/A**（field.V/A）——
  //   M 场的 modulusCeilRatio 物理上限对板/肋状厚结构（ALR2510 厚大结构 M_true≈4.7
  //   被压到 2.83）会把 0.8×peak 平台塌缩成 <100mm³ → tiny_region 漏检。
  //   区域是"物理 V/A 结构核心"的度量：用原始 V/A 生长（0.8×max(封顶 M, 原始 V/A)），
  //   峰值检测/报告仍用封顶 M（14.txt 均匀件校准保持）；无 field 时回落纯 M（兼容旧路径）。
  const peakRaw = field && field.A[peakPt] > 1e-9 ? field.V[peakPt] / field.A[peakPt] : 0;
  const threshold = Math.max(peakM, peakRaw) * o.regionGrowRatio;
  const cellVol = vs ** 3;
  const rawOf = (t) => (field && field.A[t] > 1e-9 ? field.V[t] / field.A[t] : M[t]);

  const visited = new Uint8Array(insideIdx.length);
  const pts = [];
  const queue = [peakPt];
  visited[peakPt] = 1;
  while (queue.length) {
    const t = queue.pop();
    pts.push(t);
    const gi = insideIdx[t];
    for (const nb of gridNeighbors6(gridToPt, gs, gi, sample.stride ?? 1)) {
      if (visited[nb]) continue;
      if (rawOf(nb) < threshold) continue;
      visited[nb] = 1;
      queue.push(nb);
    }
  }

  const volume = pts.length * cellVol;
  let sumM = 0, maxM = 0;
  let cx = 0, cy = 0, cz = 0;
  for (const t of pts) {
    sumM += rawOf(t);
    if (rawOf(t) > maxM) maxM = rawOf(t);
    cx += sample.pts[t][0]; cy += sample.pts[t][1]; cz += sample.pts[t][2];
  }
  // region 外最大 M（region 占比判据：区分"均匀件大区"与"局部厚区大占比"，
  //   见 configV3.regionOutsideRatio）——O(N) 一次遍历
  let outsideMaxM = 0;
  for (let t = 0; t < insideIdx.length; t++) {
    if (visited[t]) continue;
    if (rawOf(t) > outsideMaxM) outsideMaxM = rawOf(t);
  }
  const meanM = pts.length ? sumM / pts.length : peakM;
  return {
    pts,
    volume,
    centroid: pts.length ? [cx / pts.length, cy / pts.length, cz / pts.length] : sample.pts[peakPt],
    meanM, maxM, outsideMaxM,
    regionArea: meanM > 1e-9 ? volume / meanM : 0,
  };
}

/**
 * 代表点：region centroid → isInside 校验（空腔/管内/外部/薄壁 → fallback）
 * fallback 顺序：高 M 区域内部最优点 → 最终 peak point（13.txt §12）
 */
export function representativePoint(geometry, sample, region) {
  const c = region.centroid;
  if (isInside(geometry, c, 6)) return c;
  return sample.pts[region.pts[0]];
}

/**
 * 置信度评分（13.txt §21）：normalizedM + prominence + volumeNorm + stability
 */
export function computeConfidence(normalizedM, prominence, region, modelVolume, stability, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const { modulus: w1, prominence: w2, volume: w3, stability: w4 } = o.confWeights;
  const sMod = Math.max(0, Math.min(1, normalizedM));
  const sVol = modelVolume > 0 ? Math.min(1, region.volume / (modelVolume * 0.05)) : 0;
  const confidence = Math.max(0, Math.min(1, w1 * sMod + w2 * prominence + w3 * sVol + w4 * stability));
  return { confidence, scores: { modulus: sMod, prominence, volume: sVol, stability } };
}
