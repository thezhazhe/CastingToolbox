// ============================================================
// HotSpot Engine V2.1 · 几何热节倾向分析（docs/HOTSPOT_ENGINE_V2.md）
// 五级流水线：Coarse Scan → Candidate Detection → Local Refinement
//             → Hotspot Evaluation → Final Hotspot
// 定位：轻量、快速、稳定、可解释的几何热节倾向分析器（非凝固模拟）。
// 原则：
//   - Candidate ≠ Hotspot：候选层只做绝对下限 + 局部极大（"值得检查吗"）；
//     相对显著性由 PVP 谷深比承担，最终热结必须经过 Local Refinement + Evaluation。
//   - PVP 合并/分裂仅作用于同一细化 Region 内多峰；不同 Region 永不合并。
//   - 状态严格区分：OK / NO_HOTSPOT / LOW_CONFIDENCE / INSUFFICIENT_RESOLUTION。
//   - 全部参数在 hotspotConfig.js，算法代码不写死数值。
//   - 坐标：引擎输出 ENGINE（STL 原始坐标）；Viewer 平移由调用方一次完成。
// 纯引擎模块，Node 可测。
// ============================================================
import { computeBounds } from './stl.js';
import { validateMesh } from './meshValidation.js';
import { distanceToSurface } from './mesh3d.js';
import { buildDistanceField, buildDistanceFieldSliced } from './distanceField.js';
import { HOTSPOT_DEFAULTS } from './hotspotConfig.js';

/* ---- 状态枚举（V2.1：区分"没有热结"与"无法可靠分析"） ---- */
export const HS_STATUS = {
  OK: 'ok',                        // 至少一个热结 confidence ≥ 阈值
  NO_HOTSPOT: 'NO_HOTSPOT',        // 分析分辨率足够，但无相对显著候选（均匀模型）
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',// 有候选，但无一达到最终标准（可解释原因）
  INSUFFICIENT_RESOLUTION: 'INSUFFICIENT_RESOLUTION', // 无法可靠分析
};

/* ---- 可解释原因（拒绝/空结果必填） ---- */
export const HS_REASON = {
  INVALID_MESH: 'invalid_mesh',            // 网格无效（→ INSUFFICIENT_RESOLUTION）
  NO_INSIDE_POINTS: 'no_inside_points',    // 粗扫无内部点（壁 < 采样极限，→ INSUFFICIENT_RESOLUTION）
  NO_CANDIDATE: 'no_candidate',            // 无相对显著候选（均匀模型 → NO_HOTSPOT）
  UNIFORM: 'uniform',                      // 均匀件：top2 候选比值 < PEAK_SEPARATION_RATIO（→ NO_HOTSPOT）
  ALL_LOW_CONFIDENCE: 'all_low_confidence',// 候选全部 confidence 不足（→ LOW_CONFIDENCE）
  REFINE_LIMIT: 'refine_limit',            // 细化超限/无法解析（区域 → LOW_CONFIDENCE）
};

/**
 * 热结分析主入口（同步版，Node 测试用）
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果（含 BVH）
 * @param {object} [opts] 覆盖 HOTSPOT_DEFAULTS
 * @returns {{
 *   status, reason, hotspots:[{id,x,y,z,mc,score,confidence,resolutionScore,prominenceScore,
 *     validationScore,localThickness,regionVolumeCm3,resolution,reason,regionBBox,peaks}],
 *   audit:[{candidateId,coarsePeak,coarseValley,regionVolumeCm3,localThickness,coarseRes,refineRes,
 *     merged,split,rejected,confidence,...}],   // 全链追踪（产生→细化→合并/分裂→接受/拒绝）
 *   debug:{gs,vs,median,candidates,regions,peaks,rejected,insidePoints,totalPoints,elapsedMs}
 * }}
 */
export function analyzeHotspots(mesh, geometry, opts = {}) {
  const o = { ...HOTSPOT_DEFAULTS, ...opts };
  const t0 = Date.now();
  const debug = { candidates: 0, regions: 0, peaks: 0, rejected: 0, insidePoints: 0, totalPoints: 0, gs: 0, vs: 0, median: 0 };

  // 0. Mesh Validation
  const mv = validateMesh(mesh);
  if (mv.issues.some(i => i.level === 'error')) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.INVALID_MESH, hotspots: [], audit: [], debug: withElapsed(debug, t0) };
  }

  // ① Coarse Scan（全局粗扫；vs 允许大于壁厚——采样稀疏但距离有效）
  const df = buildDistanceField(mesh, geometry, o);
  return analyzeCoarseToFinal(mesh, geometry, df, null, o, t0, debug);
}

/**
 * 分片版（UI 用）：粗扫距离场构建期间让出主线程；结果与同步版一致。
 * 局部细化区域小（毫秒级），不做分片。
 */
export async function analyzeHotspotsSliced(mesh, geometry, opts = {}, yieldFn) {
  const o = { ...HOTSPOT_DEFAULTS, ...opts };
  const t0 = Date.now();
  const debug = { candidates: 0, regions: 0, peaks: 0, rejected: 0, insidePoints: 0, totalPoints: 0, gs: 0, vs: 0, median: 0 };

  const mv = validateMesh(mesh);
  if (mv.issues.some(i => i.level === 'error')) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.INVALID_MESH, hotspots: [], audit: [], debug: withElapsed(debug, t0) };
  }

  const df = await buildDistanceFieldSliced(mesh, geometry, o, yieldFn);
  return analyzeCoarseToFinal(mesh, geometry, df, null, o, t0, debug);
}

/**
 * 粗扫之后的五级流水线主体（②→⑤；同步/分片共用）
 * @param {object|null} precomputedScore 已算好的 score/median（V2 扩展用），默认内部计算
 */
function analyzeCoarseToFinal(mesh, geometry, df, precomputedScore, o, t0, debug) {
  const audit = [];
  debug.gs = df.gs; debug.vs = df.vs;
  debug.insidePoints = df.insideIdx.length; debug.totalPoints = df.pts.length;
  if (!df.insideIdx.length) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.NO_INSIDE_POINTS, hotspots: [], audit, debug: withElapsed(debug, t0) };
  }

  // 内部点 score（半壁厚；无效距离 → 0）
  const n = df.insideIdx.length;
  const score = new Float32Array(n);
  let maxS = 0;
  for (let i = 0; i < n; i++) {
    const d = df.dists[i];
    const s = d !== null && d > 0.001 ? d : 0;
    score[i] = s;
    if (s > maxS) maxS = s;
  }
  if (maxS <= 0) {
    return { status: HS_STATUS.NO_HOTSPOT, reason: HS_REASON.NO_CANDIDATE, hotspots: [], audit, debug: withElapsed(debug, t0) };
  }
  // ② Candidate Detection：26 邻域局部极大 + NMS
  //    门槛 = maxScore × CANDIDATE_FLOOR（绝对下限，只过滤极弱噪声）。
  //    相对显著性由 PVP 谷深比承担（候选层不做全局统计基准——见 hotspotConfig 注）。
  const { grid, coord } = buildGrid(df);
  // V2.3：rawMax 用低门槛（只服务 uniform 判据的"region 外局部极大"计数——
  // 厚区+薄区结构的薄区中面局部极大 < 0.1×maxS 会被高门槛滤掉，见 CANDIDATE_FLOOR_LOW 注）；
  // 主候选流程保持高门槛不变（零性能影响，localMaxima 遍历成本同 O(n)）。
  const localMax = localMaxima(df, score, grid, coord, maxS * o.CANDIDATE_FLOOR_LOW);
  const candidates = nmsDedup(localMax.filter(m => m.score >= maxS * o.CANDIDATE_FLOOR), o.candidateNMS);
  debug.candidates = candidates.length;
  if (!candidates.length) {
    return { status: HS_STATUS.NO_HOTSPOT, reason: HS_REASON.NO_CANDIDATE, hotspots: [], audit, debug: withElapsed(debug, t0) };
  }
  // ③ Region 聚类提前（V2.2 PHASE 4：uniform 判据需要候选的 region 归属）
  let regions = growRegions(df, score, candidates, coord, grid, o);
  regions = mergeOverlapping(regions, score);
  debug.regions = regions.length;

  // 均匀件判据（V2.2 PHASE 4 · Region-level）：单个 voxel 峰值不能证明结构性厚区，
  // 必须看候选所在 region 是否形成独立空间结构。
  // 多结构件触发条件（满足任一）：
  //   a) 候选比值 ≥ PEAK_SEPARATION_RATIO（L 形角部 28.75 vs 臂 18.75 = 1.53）
  //   b) 与主峰的谷深比 ≥ UNIFORM_VALLEY_RATIO（对称双厚区 28.33 vs 槽 7 = 0.75）
  //   d) region 外局部极大 > 0（未 NMS 的 raw localMaxima）：均匀件 region 外 = 梯度区
  //      （单调递减 → 无局部极大）；板+凸台 region 外 = 平坦板（局部极大存在）。
  //      res96 场景：板仅 1-2 采样层，板候选被 NMS 与凸台候选去重 → 候选层看不见板，
  //      region 外局部极大兜底（V2.1 E2 漏检修复）。
  // 修复要点：同 region 候选不能跳过比值/谷深检查（L 形臂/连接带连通件的第二结构与
  // 主峰同 region——靠比值/谷深触发）；同平台噪声的 valleyScore 是 O(平台点) 快速失败
  // （高分域已连通 → 立即返回），性能安全。
  if (candidates.length >= 1) {
    const gcomp = connectedComponents(df, grid, grid.gIdx);
    const top = candidates[0];
    // d) region 外局部极大（raw localMaxima 未 NMS——板平坦区在 NMS 前存在）。
    //    必须与 top 比值 ≥ PEAK_SEPARATION_RATIO：等厚件（凸台=板厚）被网格分层成
    //    多个薄层 region，region 外极大与 top 同值（比值 1.0）→ 不是相对结构 → 不触发
    //    （g10_20_h10 实测误报 3 个热结的修复）
    const rSet = new Set(regions[0].cells);
    let outsideMaxima = 0;
    for (const m of localMax) {
      if (rSet.has(m.i)) continue;
      if (m.score < maxS * o.CANDIDATE_FLOOR_LOW) continue;   // V2.3：低门槛（localMax 已是 LOW 门槛，双保险）
      if (top.score / m.score >= o.PEAK_SEPARATION_RATIO) {
        outsideMaxima++;
        if (outsideMaxima > 32) break;
      }
    }
    // e) region 平均厚度显著高于模型整体（薄板+凸台高分辨率兜底：板仅 1-2 采样层 →
    //    无局部极大、候选被 NMS 去重 → 候选层看不见板）
    // f) region 质心偏离模型质心（AND 组合）：均匀实心件（cube/cylinder）的中心厚区
    //    对称（偏移≈0）→ 不触发；凸台/厚端等"突变结构"的 region 质心偏离模型质心 → 触发。
    //    单独厚度比不可用：cube 2.12 / cylinder 2.03 与凸台 3.18 混叠（实测）。
    let rSum = 0, rx = 0, ry = 0, rz = 0;
    for (const i of regions[0].cells) {
      rSum += score[i];
      const q = df.pts[df.insideIdx[i]];
      rx += q[0]; ry += q[1]; rz += q[2];
    }
    const rcellsLen = regions[0].cells.length;
    const rMean = rSum / rcellsLen;
    let totalSum = 0, mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) {
      totalSum += score[i];
      const q = df.pts[df.insideIdx[i]];
      mx += q[0]; my += q[1]; mz += q[2];
    }
    const modelMean = totalSum / n;
    const thicknessRatio = rMean / modelMean;
    const mdim = Math.max(...df.bounds.size);
    const centroidOffset = Math.hypot(rx / rcellsLen - mx / n, ry / rcellsLen - my / n, rz / rcellsLen - mz / n) / mdim;
    let hasStructure = outsideMaxima > 0
      || (thicknessRatio >= o.REGION_THICKNESS_RATIO && centroidOffset >= o.REGION_CENTROID_OFFSET_RATIO), checked = 0;
    for (const c of candidates.slice(1)) {
      if (hasStructure || checked >= o.UNIFORM_CHECK_LIMIT) break;
      checked++;
      const ratio = top.score / c.score;
      if (ratio >= o.PEAK_SEPARATION_RATIO) { hasStructure = true; break; }
      // 谷深 < UNIFORM_VALLEY_RATIO（0.05）= 同平台噪声/主峰邻域（谷深≈0）→ 跳过；
      // ≥0.05 即有第二结构（含 0.05~0.15 弱谷 = 融合结构如相交球，PVP 合并报 1 个）
      const valley = valleyScore(c.i, top.i, score, gcomp, coord, grid, df.gs, gcomp[top.i]);
      const depth = (Math.min(c.score, top.score) - valley) / Math.min(c.score, top.score);
      if (depth >= o.UNIFORM_VALLEY_RATIO) { hasStructure = true; break; }
    }
    const coverage = regions[0].cells.length / n;   // 记录用（region 覆盖率指标）
    if (!hasStructure) {
      audit.push({ uniform: true, topPeak: +top.score.toFixed(2), regionCoverage: +coverage.toFixed(3), outsideMaxima, thicknessRatio: +thicknessRatio.toFixed(3), rejected: 'uniform: 无第二显著结构（模型壁厚均匀）' });
      return { status: HS_STATUS.NO_HOTSPOT, reason: HS_REASON.UNIFORM, hotspots: [], audit, debug: withElapsed(debug, t0) };
    }
    // Region-level 指标记录（audit；供 Region 稳定性评估——(8).txt PHASE 4 要求）
    const rcells = regions[0].cells;
    const rSorted = rcells.map(i => score[i]).sort((a, b) => a - b);
    let rHi = 0;
    for (const i of rcells) if (score[i] >= top.score * 0.9) rHi++;
    audit.push({
      uniform: false,
      regionLevel: {
        peak: +top.score.toFixed(2),
        regionMedian: +rSorted[Math.floor(rSorted.length / 2)].toFixed(2),
        regionMean: +rMean.toFixed(2),
        regionVolumeCm3: +(rcells.length * df.vs ** 3 / 1000).toFixed(2),
        highScoreRegionVolume: +(rHi * df.vs ** 3 / 1000).toFixed(2),
        peakToRegionRatio: rMean > 0 ? +(top.score / rMean).toFixed(3) : 0,
        regionCoverage: +coverage.toFixed(3),
        outsideMaxima,
        thicknessRatio: +thicknessRatio.toFixed(3),
        centroidOffsetRatio: +centroidOffset.toFixed(4),
      },
    });
  }

  // ④⑤ 每区域：Local Refinement → Evaluation（PVP + confidence）
  const evaluated = [];
  let rejectedCnt = 0, limitHit = false;
  for (let ri = 0; ri < regions.length; ri++) {
    if (ri >= o.MAX_REFINEMENT_REGIONS) {
      audit.push({ candidateId: ri + 1, coarsePeak: +score[regions[ri].peakIdx].toFixed(2), rejected: 'max refinement regions exceeded' });
      rejectedCnt++;
      continue;
    }
    const r = refineAndEvaluate(mesh, geometry, df, score, maxS, regions[ri], ri, o, audit);
    rejectedCnt += r.rejected;
    limitHit = limitHit || !!r.limitHit;
    if (r.result) {
      evaluated.push(...r.result);   // r.result 是候选数组（主峰+分裂次峰）
      if (evaluated.length >= o.maxHotspots) break;
    }
  }
  debug.rejected = rejectedCnt;

  // ⑤ Final Hotspot：confidence + 显著度双门槛过滤 + id 分配（H1/H2…）
  // 弱峰（prominence < MIN_PROMINENCE_RATIO，如薄区/台阶噪声）即使置信度加权过线也不进
  // 最终热结——降级 LOW_CONFIDENCE 保留可解释性
  const finalHs = [];
  const lowConf = [];
  for (const ev of evaluated) {
    if (ev.confidence >= o.CONFIDENCE_THRESHOLD && ev.hotspot.prominenceScore >= o.MIN_PROMINENCE_RATIO) {
      finalHs.push({ ...ev.hotspot, id: finalHs.length + 1 });
    } else {
      lowConf.push({ ...ev.hotspot, id: 0 });
    }
  }
  debug.peaks = finalHs.length + lowConf.length;

  if (finalHs.length) {
    return { status: HS_STATUS.OK, reason: null, hotspots: finalHs, audit, debug: withElapsed(debug, t0) };
  }
  if (lowConf.length || limitHit) {
    // 有候选但无一达标 / 细化超限——报候选（带 confidence），状态 LOW_CONFIDENCE
    return {
      status: HS_STATUS.LOW_CONFIDENCE,
      reason: lowConf.length ? HS_REASON.ALL_LOW_CONFIDENCE : HS_REASON.REFINE_LIMIT,
      hotspots: lowConf, audit, debug: withElapsed(debug, t0),
    };
  }
  return { status: HS_STATUS.NO_HOTSPOT, reason: HS_REASON.NO_CANDIDATE, hotspots: [], audit, debug: withElapsed(debug, t0) };
}

/* ================= ③ Local Refinement + Evaluation ================= */

/**
 * 对单个粗扫 Region：Local Refinement（按需）→ 区域内多峰 PVP → 代表点 + 三因子 confidence
 * 网格决策（V2.1）：粗扫对该区域层数已足够（d_peak ≥ TARGET×vs_coarse）→ 跳过细化，
 * 直接用粗扫数据评估（省计算）；不足才细化，且细化 bbox 聚焦峰值 ±3×d_peak
 * （不用整个 grow region——grow region 含臂/连接会过度扩大范围）。
 * @param {number} maxS 粗扫全局最大半壁厚（prominence 因子基准）
 * @returns {{result:null|{hotspot,confidence}|null, rejected:number}}
 */
function refineAndEvaluate(mesh, geometry, df, score, maxS, region, ri, o, audit) {
  const peakIdx = region.peakIdx;
  const dPeak = score[peakIdx];
  const p = df.pts[df.insideIdx[peakIdx]];
  const vsCoarse = df.vs;

  // ---- 网格决策（V2.1 修正）----
  // 目标体素 vs_refine = 2×d_peak/6（壁厚 6 层）。上限 = vs_coarse（不强制变细）：
  // 粗扫已足够（targetVs ≥ vsCoarse）→ 直接用粗扫网格评估（L 形/凸台大厚区，避免无谓细化）；
  // 只有目标比粗扫细（薄壁大件厚区）才细化，且细化 bbox 聚焦峰值 ±2×d_peak。
  let gdf = df, gscore = score, gvs = vsCoarse;
  let refineRes = vsCoarse;
  const targetVs = 2 * dPeak / o.TARGET_VOXELS_ACROSS_THICKNESS;
  const needRefine = targetVs < vsCoarse;
  if (needRefine) {
    const vsRefine = Math.max(o.MIN_VOXEL_SIZE, targetVs);
    refineRes = vsRefine;
    const half = 2 * dPeak + 2 * vsCoarse;   // 峰值 ± 厚区范围（覆盖凸台主体，不过度外扩）
    const lb = {
      min: [p[0] - half, p[1] - half, p[2] - half],
      max: [p[0] + half, p[1] + half, p[2] + half],
      size: [2 * half, 2 * half, 2 * half],
    };
    const localMdim = 2 * half;
    let gsLocal = Math.ceil(localMdim / vsRefine);
    const gsCap = Math.max(8, Math.floor(Math.cbrt(o.MAX_REFINEMENT_POINTS)));   // 硬约束：禁止无限细化
    if (gsLocal > gsCap) {
      const why = `refine limit: gs ${gsLocal} > cap ${gsCap}（region ${Math.round(localMdim)}mm @ ${vsRefine.toFixed(2)}mm/voxel）`;
      audit.push({ candidateId: ri + 1, coarsePeak: +dPeak.toFixed(2), coarseRes: +vsCoarse.toFixed(2), refineRes: +vsRefine.toFixed(2), rejected: why });
      return { result: null, rejected: 1, limitHit: true };
    }
    // ④ Local Refinement：局部距离场（区域小，同步毫秒级；复用 buildDistanceField bounds 参数）
    gdf = buildDistanceField(mesh, geometry, { resolution: gsLocal }, lb);
    if (!gdf.insideIdx.length) {
      audit.push({ candidateId: ri + 1, coarsePeak: +dPeak.toFixed(2), coarseRes: +vsCoarse.toFixed(2), refineRes: +vsRefine.toFixed(2), rejected: 'refinement found no inside points' });
      return { result: null, rejected: 1, limitHit: true };
    }
    gscore = new Float32Array(gdf.insideIdx.length);
    for (let i = 0; i < gdf.insideIdx.length; i++) {
      const d = gdf.dists[i];
      gscore[i] = d !== null && d > 0.001 ? d : 0;
    }
    gvs = vsRefine;
  }

  // ---- 公共评估（网格无关：粗扫或细化）----
  const gg = buildGrid(gdf);
  const gcomp = connectedComponents(gdf, gg.grid, gg.gIdx);

  // 区域内多峰：26 邻域局部极大 + NMS（区域内不做额外门槛——平坦区数值噪声峰
  // 由 PVP 谷深比收敛：伪峰相邻谷极浅 → 谷深比≈0 → 合并，不会爆出几十个热结）
  // 粗扫路径限定在 region.cells 内（避免模型其他区域的峰）；细化路径全网格（bbox 已聚焦）
  const maxima = localMaxima(gdf, gscore, gg.grid, gg.coord, 0);
  const regionSet = needRefine ? null : new Set(region.cells);
  const subPeaks = nmsDedup(maxima.filter(m => !regionSet || regionSet.has(m.i)), o.minPeakGap);

  // PVP：同一连通域内峰间谷值（minGapOnPath 复用）；谷深比 ≥ valleyDepthRatio → 分裂为独立热结
  // 不同连通域 → 天然独立（区域独立性优先于谷值判断，V2.1 冻结）
  const domains = new Map();   // 连通域 id → 该域内峰
  for (const pk of subPeaks) {
    const compId = gcomp[pk.i];
    if (!domains.has(compId)) domains.set(compId, { peaks: [] });
    domains.get(compId).peaks.push(pk);
  }
  const hotRegions = [];
  for (const [compId, dom] of domains) {
    const dPeaks = dom.peaks.sort((a, b) => b.score - a.score);
    // PVP（峰-谷-峰）：次峰与"已保留峰"逐个比较最大瓶颈谷值，遇无显著谷（<valleyDepthRatio）
    // 即并入该峰；与所有已保留峰都有显著谷才独立为新热结。
    // 关键：不能只与全局最高峰比较——同柱内相邻峰（谷深 0）必须合并，跨结构峰（谷深 0.4）才分裂。
    const finalPeaks = [dPeaks[0]];
    for (const pk of dPeaks.slice(1)) {
      let merged = false;
      for (const f of finalPeaks) {
        const valley = valleyScore(pk.i, f.i, gscore, gcomp, gg.coord, gg.grid, gdf.gs, compId);
        const depth = (Math.min(gscore[pk.i], gscore[f.i]) - valley) / Math.min(gscore[pk.i], gscore[f.i]);
        const a = auditEntry(ri, dPeak, vsCoarse, refineRes, pk, f, gscore, valley, depth, compId);
        if (depth >= o.valleyDepthRatio) {
          a.split = `split from peak ${f.score.toFixed(1)}mm (valleyDepth ${depth.toFixed(2)} ≥ ${o.valleyDepthRatio})`;
        } else {
          a.merged = `merged into peak ${f.score.toFixed(1)}mm (valleyDepth ${depth.toFixed(2)} < ${o.valleyDepthRatio})`;
          merged = true;
        }
        audit.push(a);
        if (merged) break;
      }
      if (!merged) finalPeaks.push(pk);
    }
    hotRegions.push({ main: finalPeaks[0], subs: finalPeaks.slice(1), compId });
  }

  // 代表点 + 评估：每个独立峰（主峰 + 分裂次峰）各自成为热结候选
  const out = [];
  for (const hr of hotRegions) {
    for (const pk of [hr.main, ...hr.subs]) {
      const ev = evaluateHotspot(geometry, gdf, gscore, gcomp, gg.grid, gg.gIdx, pk, maxS, vsCoarse, refineRes, o);
      const a = auditEntry(ri, dPeak, vsCoarse, refineRes, pk, null, gscore, 0, 0, hr.compId);
      Object.assign(a, {
        localThickness: +(ev.localThickness).toFixed(2),
        regionVolumeCm3: +ev.regionVolumeCm3.toFixed(2),
        confidence: +ev.confidence.toFixed(3),
        resolutionScore: +ev.resolutionScore.toFixed(3),
        prominenceScore: +ev.prominenceScore.toFixed(3),
        validationScore: +ev.validationScore.toFixed(3),
      });
      if (ev.rejected) a.rejected = ev.rejected;
      audit.push(a);
      if (ev.hotspot) out.push({ hotspot: ev.hotspot, confidence: ev.confidence });
    }
  }
  return { result: out.length ? out : null, rejected: 0 };
}

function auditEntry(ri, dPeak, vsCoarse, vsRefine, pk, main, lscore, valley, depth, compId) {
  return {
    candidateId: ri + 1,
    coarsePeak: +dPeak.toFixed(2),
    peak: +(pk?.score ?? 0).toFixed(2),
    coarseRes: +vsCoarse.toFixed(2),
    refineRes: +vsRefine.toFixed(2),
    valley: +(+valley).toFixed(2),
    valleyDepth: +(+depth).toFixed(3),
    component: compId,
  };
}

/** 单峰评估：inside 终检 + refineMc 精化 + 区域体积 + 三因子 confidence */
function evaluateHotspot(geometry, ldf, lscore, lcomp, grid, gIdx, pk, maxS, vsCoarse, vsRefine, o) {
  const dim = ldf.gs;
  const gi = pk.gi, gj = pk.gj, gk = pk.gk;
  // inside 终检（细化网格扫描线投票——V1 语义复用）
  const inside = ldf.insideGrid[gi * dim * dim + gj * dim + gk] === 1;
  const dRefined = lscore[pk.i];
  // 原峰坐标（ENGINE；audit/输出保留 peakPosition）
  const peakPos = ldf.pts[ldf.insideIdx[pk.i]];

  // 代表点（V2.2 PHASE 2 + V2.3 阈值调整）：从峰出发 BFS 生长 score ≥ peak×REPRESENTATIVE_RATIO
  // 的高分连通区，取几何质心。
  // 旧实现（±2 体素邻域）在宽平台（等厚区 ≥4×vs）上只覆盖峰附近 → 峰落在平台边缘时
  // 质心被拉到边缘（tShape 28mm / thickEnd 31mm / bossOnPlate 11.8mm 实测）。
  // 注意：不能用"整个 compId 连通域"过滤（多凸台经板连通为同域 → 质心跨平台，
  // threeBosses 实测 135mm）——必须从峰格 6 邻域生长，只覆盖峰所在的高分平台。
  // 代表点（V2.2 PHASE 2 + V2.3 自适应）：从峰出发 BFS 生长高分连通区，取几何质心。
  // 旧实现（±2 体素邻域）在宽平台（等厚区 ≥4×vs）上只覆盖峰附近 → 峰落在平台边缘时
  // 质心被拉到边缘（tShape 28mm / thickEnd 31mm / bossOnPlate 11.8mm 实测）。
  // 注意：不能用"整个 compId 连通域"过滤（多凸台经板连通为同域 → 质心跨平台，
  // threeBosses 实测 135mm）——必须从峰格 6 邻域生长，只覆盖峰所在的高分平台。
  // V2.3 自适应（(9).txt 问题 2：代表点必须落在实际厚区/热结核心）：
  //   峰可信度：0.9×peak 连通域 < REPRESENTATIVE_MIN_CELLS 格 → MC 伪厚尖峰
  //   （角部/过渡带 MC 圆角叠厚）→ 没有稳定平台质心，直接用峰点（thinShell 角部峰
  //   4.94：0.8×peak 域会连上壁面中面 4.0 → 质心拉向壁面 → mc 2.85 出 [3,6] 范围，实测）。
  //   真峰（平台/柱顶，0.9 域正常）→ 保持 0.95×peak 域（V2.2 精度，PVP 弱谷场景
  //   连接带 score < 0.95×peak 不跨谷——0.8 单阈值会把质心拉到两柱之间，实测 d=50mm）。
  //   质心校验：环状/管状厚区的域几何质心天然落在对称轴空腔（hollowThickRing 实测
  //   (0,0,0) → mc=40 错误）→ 质心所在细化格必须仍属于该连通域（连通域格 = 合法
  //   region/inside）；失败 → 降阈值（0.8/0.6）重算 → 仍失败 → "高分格"fallback
  //   （score ≥ max×0.7，避开 MC 内壁圆角低分区）离质心最近格。
  const compId = lcomp[pk.i];
  const DIRS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  /** BFS 连通域质心（阈值 ratio×peak；返回 null = 域为空） */
  const bfsCentroid = (ratio) => {
    const t = dRefined * ratio;
    const vis = new Uint8Array(lscore.length);
    const q = [pk.i];
    vis[pk.i] = 1;
    let x = 0, y = 0, z = 0, c = 0;
    while (q.length) {
      const cur = q.pop();
      const qq = ldf.pts[ldf.insideIdx[cur]];
      x += qq[0]; y += qq[1]; z += qq[2]; c++;
      const g = gIdx[cur];
      const cgi = Math.floor(g / (dim * dim));
      const cgj = Math.floor((g % (dim * dim)) / dim);
      const cgk = g % dim;
      for (const [da, db, dc] of DIRS) {
        const ni = cgi + da, nj = cgj + db, nk = cgk + dc;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
        const id = grid[idx3(ni, nj, nk, dim)];
        if (id < 0 || vis[id] || lcomp[id] !== compId || lscore[id] < t) continue;
        vis[id] = 1;
        q.push(id);
      }
    }
    return c ? [x / c, y / c, z / c, c] : null;
  };
  /** 质心是否仍在厚区连通域内（合法 region/inside 格） */
  const inComp = (p) => {
    const gi2 = Math.max(0, Math.min(dim - 1, Math.floor((p[0] - ldf.bounds.min[0]) / vsRefine)));
    const gj2 = Math.max(0, Math.min(dim - 1, Math.floor((p[1] - ldf.bounds.min[1]) / vsRefine)));
    const gk2 = Math.max(0, Math.min(dim - 1, Math.floor((p[2] - ldf.bounds.min[2]) / vsRefine)));
    const cid = grid[gi2 * dim * dim + gj2 * dim + gk2];
    return cid >= 0 && lcomp[cid] === compId;
  };
  // 峰可信度：0.9×peak 连通域格数（MC 伪厚尖峰 = 极小域）
  const hiCnt9 = bfsCentroid(0.9);
  const isSpike = !hiCnt9 || hiCnt9[3] < o.REPRESENTATIVE_MIN_CELLS;
  let p = null;
  let p0 = null;
  if (isSpike) {
    // MC 伪厚尖峰：无稳定平台质心 → 直接用峰点（尖峰处即局部厚区）
    p0 = [peakPos[0], peakPos[1], peakPos[2], 1];
    p = p0.slice(0, 3);
  } else {
    p0 = bfsCentroid(0.95);
    if (p0) {
      p = p0.slice(0, 3);
      if (!inComp(p)) {
        // 质心落空腔（环/管对称结构）→ 降阈值重算（覆盖真实厚区核心）
        const p1 = bfsCentroid(0.8);
        if (p1) {
          p = p1.slice(0, 3);
          if (!inComp(p)) p = null;   // 仍空腔 → 高分格 fallback
        } else p = null;
      }
    }
  }
  if (!p && p0) {
    // fallback：连通域内"高分格"（score ≥ max×0.7，避开 MC 内壁圆角低分区——
    // hollowThickRing 实测最近格落在内壁圆角 r=32.8 < GT 环内径 40）离质心最近格。
    let maxInComp = 0;
    for (let i = 0; i < lscore.length; i++) if (lcomp[i] === compId && lscore[i] > maxInComp) maxInComp = lscore[i];
    const hiT2 = maxInComp * 0.7;
    let bestD = Infinity, bestQ = null;
    for (let i = 0; i < lscore.length; i++) {
      if (lcomp[i] !== compId || lscore[i] < hiT2) continue;
      const q = ldf.pts[ldf.insideIdx[i]];
      const d = (q[0] - p0[0]) ** 2 + (q[1] - p0[1]) ** 2 + (q[2] - p0[2]) ** 2;
      if (d < bestD) { bestD = d; bestQ = q; }
    }
    if (bestQ) p = [bestQ[0], bestQ[1], bestQ[2]];
  }
  if (!p) {   // 理论上不触发（峰自身 ≥ 0.75×peak）：±2 邻域质心 → 原峰点
    const hiT = dRefined * (isSpike ? 0.75 : 0.95);
    let fx = 0, fy = 0, fz = 0, fc = 0;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
      const ni = gi + a, nj = gj + b, nk = gk + c;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
      const id = grid[idx3(ni, nj, nk, dim)];
      if (id < 0 || lscore[id] < hiT) continue;
      const q = ldf.pts[ldf.insideIdx[id]];
      fx += q[0]; fy += q[1]; fz += q[2]; fc++;
    }
    p = fc ? [fx / fc, fy / fc, fz / fc] : peakPos;
  }

  // 亚体素精化 mc（全局 BVH 几何，ENGINE 坐标）
  const mc = refineMcGlobal(geometry, p, vsRefine);

  // 区域体积（该峰所在连通域的全部体素数 × vs_refine³）
  let cellCount = 0;
  for (let i = 0; i < lscore.length; i++) if (lcomp[i] === compId) cellCount++;
  const regionVol = cellCount * vsRefine ** 3;

  // 层数 < 1 体素：该候选低于可解析分辨率（稀疏采样下的台阶/角部伪厚，如薄壁壳角 mc=5.5 vs vs=12.5）
  // → 直接拒绝（audit 可解释），不进入最终热结
  const layers = dRefined / vsRefine;   // 壁厚层数（半壁厚 / vs）
  if (layers < 1) {
    return {
      hotspot: null,
      rejected: `candidate below 1 voxel resolution (${dRefined.toFixed(2)}mm @ ${vsRefine.toFixed(2)}mm/voxel)`,
      confidence: 0, localThickness: 2 * dRefined, regionVolumeCm3: 0, resolutionScore: 0.3, prominenceScore: 0, validationScore: 0,
    };
  }
  const resolutionScore = Math.min(1, Math.max(0.3, 0.3 + (layers - 3) / 3 * 0.7));   // 3 层→0.3，6 层→1.0
  // 显著度：相对全局最大半壁厚（主热结 1.0；≥67% 主热结的峰保持高分；
  // 低于 1/3 主热结的弱峰（薄壁槽/台阶噪声）显著度不足 → 组合置信度被拉低 → 拒绝）
  const ratio = maxS > 0 ? dRefined / maxS : 0;
  const prominenceScore = Math.min(1, Math.max(0.3, ratio * 1.5));
  let validationScore = inside ? 1 : 0;
  if (regionVol < o.minRegionVolumeMm3) validationScore *= 0.5;   // 区域过小 → 半信
  const confidence = resolutionScore * o.confWeights.resolution + prominenceScore * o.confWeights.prominence + validationScore * o.confWeights.validation;

  // 可解释 reason（ratio = 峰/全局最大）
  const reason = ratio >= 0.8 ? 'local mass concentration + thick region' : ratio >= o.MIN_PROMINENCE_RATIO ? 'thick region (relative prominence)' : 'weak candidate (low relative prominence)';

  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < lscore.length; i++) {
    if (lcomp[i] !== compId) continue;
    const q = ldf.pts[ldf.insideIdx[i]];
    for (let k = 0; k < 3; k++) { if (q[k] < bmin[k]) bmin[k] = q[k]; if (q[k] > bmax[k]) bmax[k] = q[k]; }
  }

  const hotspot = {
    x: p[0], y: p[1], z: p[2],
    mc, score: +dRefined.toFixed(2),
    peakPosition: [peakPos[0], peakPos[1], peakPos[2]],          // V2.2: 原峰坐标（audit）
    representativePosition: [p[0], p[1], p[2]],                  // V2.2: 0.95 连通域质心
    confidence: +confidence.toFixed(3),
    resolutionScore: +resolutionScore.toFixed(3),
    prominenceScore: +prominenceScore.toFixed(3),
    validationScore: +validationScore.toFixed(3),
    localThickness: +(2 * dRefined).toFixed(2),
    regionVolumeCm3: +(regionVol / 1000).toFixed(2),
    resolution: +vsRefine.toFixed(3),
    reason,
    regionBBox: { min: bmin, max: bmax },
    peaks: [{ x: peakPos[0], y: peakPos[1], z: peakPos[2], score: +dRefined.toFixed(2) }],
  };
  return {
    hotspot: inside ? hotspot : null,
    rejected: inside ? null : `inside validation failed (${p[0].toFixed(1)},${p[1].toFixed(1)},${p[2].toFixed(1)})`,
    confidence, localThickness: 2 * dRefined, regionVolumeCm3: regionVol / 1000, resolutionScore, prominenceScore, validationScore,
  };
}

/* ================= 复用工具（V1 逻辑逐行保留，不重写） ================= */

/** 体素网格线性索引（3D） */
function idx3(i, j, k, dim) { return i * dim * dim + j * dim + k; }

/** 网格索引映射：insideIdx → 3D 网格坐标 + grid 表 */
function buildGrid(df) {
  const dim = df.gs;
  const grid = new Int32Array(dim * dim * dim).fill(-1);
  const gIdx = new Int32Array(df.insideIdx.length);
  const coord = new Int32Array(df.insideIdx.length * 3);
  for (let i = 0; i < df.insideIdx.length; i++) {
    const p = df.pts[df.insideIdx[i]];
    const gi = Math.min(dim - 1, Math.floor((p[0] - df.bounds.min[0]) / df.vs));
    const gj = Math.min(dim - 1, Math.floor((p[1] - df.bounds.min[1]) / df.vs));
    const gk = Math.min(dim - 1, Math.floor((p[2] - df.bounds.min[2]) / df.vs));
    const g = idx3(gi, gj, gk, dim);
    grid[g] = i;
    gIdx[i] = g;
    coord[i * 3] = gi; coord[i * 3 + 1] = gj; coord[i * 3 + 2] = gk;
  }
  return { grid, gIdx, coord };
}

/** 26 邻域局部极大（score ≥ minScore；含等分 plateau 用 ≥ 排除严格更高） */
function localMaxima(df, score, grid, coord, minScore) {
  const dim = df.gs;
  const n = score.length;
  const localMax = [];
  for (let i = 0; i < n; i++) {
    if (score[i] < minScore) continue;
    const gi = coord[i * 3], gj = coord[i * 3 + 1], gk = coord[i * 3 + 2];
    let isMax = true;
    for (let a = -1; a <= 1 && isMax; a++) for (let b = -1; b <= 1 && isMax; b++) for (let c = -1; c <= 1 && isMax; c++) {
      if (a === 0 && b === 0 && c === 0) continue;
      const ni = gi + a, nj = gj + b, nk = gk + c;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
      const idx = grid[idx3(ni, nj, nk, dim)];
      if (idx >= 0 && score[idx] > score[i]) isMax = false;
    }
    if (isMax) localMax.push({ i, gi, gj, gk, score: score[i] });
  }
  return localMax;
}

/** 非极大抑制：按 score 降序保留 gap 体素邻域内最高者 */
function nmsDedup(localMax, gap) {
  const candidates = [];
  for (const c of localMax.sort((a, b) => b.score - a.score)) {
    const dup = candidates.some(k =>
      Math.abs(k.gi - c.gi) <= gap && Math.abs(k.gj - c.gj) <= gap && Math.abs(k.gk - c.gk) <= gap);
    if (dup) continue;
    candidates.push(c);
  }
  return candidates;
}

/** Region BFS 生长（6 邻域，score ≥ 峰值×growRatio）——V1 逻辑 */
function growRegions(df, score, candidates, coord, grid, o) {
  const n = score.length;
  const dim = df.gs;
  const regionId = new Int32Array(n).fill(-1);
  const regions = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (regionId[c.i] >= 0) continue;
    const rid = regions.length;
    const thresh = c.score * o.growRatio;
    const cells = [];
    const queue = [c.i];
    regionId[c.i] = rid;
    while (queue.length) {
      const cur = queue.pop();
      cells.push(cur);
      const gi = coord[cur * 3], gj = coord[cur * 3 + 1], gk = coord[cur * 3 + 2];
      for (const [da, db, dc] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const ni = gi + da, nj = gj + db, nk = gk + dc;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
        const idx = grid[idx3(ni, nj, nk, dim)];
        if (idx < 0 || regionId[idx] >= 0 || score[idx] < thresh) continue;
        regionId[idx] = rid;
        queue.push(idx);
      }
    }
    cells.sort((a, b) => b - a);
    regions.push({ peakIdx: c.i, cells });
  }
  return regions;
}

/** Region 重叠合并（共享单元 ≥ 自身 30% → 并入主区域）——V1 逻辑 */
function mergeOverlapping(regions, score) {
  const sorted = [...regions].sort((a, b) => score[b.peakIdx] - score[a.peakIdx]);
  const merged = [];
  for (const r of sorted) {
    const cells = new Set(r.cells);
    let owner = null;
    for (const m of merged) {
      let shared = 0;
      for (const c of r.cells) if (m.cellSet.has(c)) shared++;
      if (shared >= r.cells.length * 0.3) { owner = m; break; }
    }
    if (owner) {
      if (score[owner.peakIdx] < score[r.peakIdx]) owner.peakIdx = r.peakIdx;
      for (const c of r.cells) { owner.cellSet.add(c); owner.cells.push(c); }
    } else {
      merged.push({ peakIdx: r.peakIdx, cells: [...r.cells], cellSet: cells });
    }
  }
  return merged.map(m => ({ peakIdx: m.peakIdx, cells: m.cells }));
}

/** 细化网格内部点连通域（6 邻域 BFS）——区域独立性保证（跨域永不合并） */
function connectedComponents(df, grid, gIdx) {
  const n = df.insideIdx.length;
  const dim = df.gs;
  const comp = new Int32Array(n).fill(-1);
  const coord = new Int32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = df.pts[df.insideIdx[i]];
    coord[i * 3] = Math.min(dim - 1, Math.floor((p[0] - df.bounds.min[0]) / df.vs));
    coord[i * 3 + 1] = Math.min(dim - 1, Math.floor((p[1] - df.bounds.min[1]) / df.vs));
    coord[i * 3 + 2] = Math.min(dim - 1, Math.floor((p[2] - df.bounds.min[2]) / df.vs));
  }
  let cid = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue;
    const queue = [i];
    comp[i] = cid;
    while (queue.length) {
      const cur = queue.pop();
      const gi = coord[cur * 3], gj = coord[cur * 3 + 1], gk = coord[cur * 3 + 2];
      for (const [da, db, dc] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const ni = gi + da, nj = gj + db, nk = gk + dc;
        if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
        const idx = grid[idx3(ni, nj, nk, dim)];
        if (idx < 0 || comp[idx] >= 0) continue;
        comp[idx] = cid;
        queue.push(idx);
      }
    }
    cid++;
  }
  return comp;
}

/**
 * 最大瓶颈路径谷值（maximin）：两峰间"使最低 score 最大"的路径上的最低值。
 * 实现：同一连通域内所有点按 score 降序加入并查集（6 邻域合并），
 * 当 from/to 首次连通时，当前加入点的 score 即最大瓶颈（真实谷值）。
 * 比 BFS 扩散正确：BFS 会绕进峰自身侧翼（低值边缘）污染谷值（L 形实测 11.5 vs 真实 20）。
 */
function valleyScore(from, to, score, comp, coord, grid, dim, compId) {
  const n = score.length;
  const parent = new Int32Array(n).fill(-1);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const hi = Math.min(score[from], score[to]);
  // 高分域（≥hi，含 from/to）预加入并建邻接——否则更高分的主峰不参与并查集，
  // 连通判定永不成立（修复：主峰 30 vs 次峰 18 时 to=30 被跳过 → 误判谷深 0.15 边界）
  const hiPts = [];
  const low = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] !== compId) continue;
    if (score[i] >= hi) { parent[i] = i; hiPts.push(i); }
    else low.push(i);
  }
  for (const i of hiPts) {
    const gi = coord[i * 3], gj = coord[i * 3 + 1], gk = coord[i * 3 + 2];
    for (const [da, db, dc] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const ni = gi + da, nj = gj + db, nk = gk + dc;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
      const id = grid[idx3(ni, nj, nk, dim)];
      if (id < 0 || comp[id] !== compId || parent[id] < 0) continue;
      if (score[id] >= score[i]) union(i, id);
    }
  }
  if (find(from) === find(to)) return hi;   // 高分域内已连通（同平台 → 谷深 0）
  // 降序处理低分点；剪枝：谷深判定只需分辨 ≥0.15 / <0.15，低于 0.85×hi 不可能落回 <0.15
  low.sort((a, b) => score[b] - score[a]);
  for (const i of low) {
    if (score[i] < hi * 0.85) return score[i];
    parent[i] = i;
    const gi = coord[i * 3], gj = coord[i * 3 + 1], gk = coord[i * 3 + 2];
    for (const [da, db, dc] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const ni = gi + da, nj = gj + db, nk = gk + dc;
      if (ni < 0 || nj < 0 || nk < 0 || ni >= dim || nj >= dim || nk >= dim) continue;
      const id = grid[idx3(ni, nj, nk, dim)];
      if (id < 0 || comp[id] !== compId || parent[id] < 0) continue;
      if (score[id] >= score[i]) union(i, id);
    }
    if (find(from) === find(to)) return score[i];   // 首次连通 = 最大瓶颈
  }
  return hi;
}

/** 亚体素精化：峰值点 ±vs 邻域细分采样取最大距离（V1 逻辑） */
function refineMcGlobal(geometry, center, vs) {
  const sub = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let d = -2; d <= 2; d++) {
    sub.push([center[0] + a * vs / 4, center[1] + b * vs / 4, center[2] + d * vs / 4]);
  }
  const ds = distanceToSurface(geometry, sub);
  let mx = 0;
  for (const d of ds) if (d !== null && d > mx) mx = d;
  return mx;
}

function withElapsed(debug, t0) {
  return { ...debug, elapsedMs: Date.now() - t0 };
}

/* ---- 供 UI/debug 使用的原始距离场（可选：Engineering Debug Mode） ---- */
export function rawDistanceField(mesh, geometry, opts = {}) {
  return buildDistanceField(mesh, geometry, opts);
}
