// ============================================================
// HotSpot Engine V3 · Local Thermal Modulus（13.txt 重构版）
// 数据流（13.txt §23 最终核心路线）：
//   STL → Adaptive Sampling → Local V → Local A → Local Thermal Modulus
//       → M Field → Hotspot Region → Representative Point → Confidence → 标准化结果
// 核心物理：M = V/A（Chvorinov 几何近似）；Hotspot ≠ 全模型 M 最大——
//   prominence（峰 vs 周围环带）判定局部显著性（13.txt §10）。
// 均匀件：M 高但平坦 → NO_HOTSPOT 自然结果（13.txt §11），无模型特判。
// 状态/原因复用 V2 枚举（HS_STATUS/HS_REASON）；HotspotResult 契约见 12.txt §33。
// 坐标：ENGINE（STL 原始坐标）。纯引擎模块，Node 可测。
// ============================================================
import { computeBounds, computeVolume, computeArea } from '../stl.js';
import { validateMesh } from '../meshValidation.js';
import { HS_STATUS, HS_REASON } from '../hotspot.js';
import { coarseSample, coarseSampleSliced, refineSample, refineRegion, buildGridToPt } from './sampling.js';
import { buildModulusField, buildModulusFieldSliced } from './modulusField.js';
import { findPeaks, multiscaleVerify, extractRegion, representativePoint, computeConfidence } from './peakRegion.js';
import { V3_DEFAULTS } from './configV3.js';

/**
 * V3 热结分析主入口（同步版，Node 测试用）
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果（含 BVH）
 * @param {object} [opts] 覆盖 V3_DEFAULTS
 * @returns {{
 *   status, reason,
 *   hotspots:[{hotspotId, position:[x,y,z], peakModulus, normalizedModulus,
 *              regionVolume, regionArea, confidence, scaleStability, geometrySource}],
 *   metrics, audit:[], debug
 * }}
 */
export function analyzeHotspotsV3(mesh, geometry, opts = {}) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();

  // 0. Mesh Validation（复用 V2 基础设施）
  const mv = validateMesh(mesh);
  if (mv.issues.some(i => i.level === 'error')) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.INVALID_MESH, hotspots: [], metrics: metricsOf(mesh), audit: [], debug: withElapsed({}, t0) };
  }

  // 1. Geometry Metrics
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const modelVolume = computeVolume(mesh.vertices, mesh.triCount);
  const modelArea = computeArea(mesh.vertices, mesh.triCount);
  const metrics = { volume: modelVolume, area: modelArea, bounds, triCount: mesh.triCount, size: bounds.size, center: bounds.center };

  // 2. Adaptive Sampling（13.txt §5：vs 由模型自动决定）
  const coarse = coarseSample(mesh, geometry, o);
  if (!coarse.pts.length) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.NO_INSIDE_POINTS, hotspots: [], metrics, audit: [], debug: withElapsed({ coarse: { gs: coarse.gs, vs: coarse.vs, estMinWall: coarse.estMinWall, pts: 0, thin: coarse.thin } }, t0) };
  }
  coarse.gridToPt = buildGridToPt(coarse.gs, coarse.vox.inside, coarse.insideIdx);

  // 3. 粗 M 场（medium 尺度）
  const coarseField = buildModulusField(coarse.vox, coarse, o, 1.0);

  // 4. 粗场峰检测（环带显著性）
  const coarsePeaks = findPeaks(coarseField.M, coarse, coarseField, o);
  // 均匀件判据（13.txt §11：均匀结构 M 高但平坦 → NO_HOTSPOT 自然结果）：
  //   top2 与 top3 都同水平（比值 ≥ 0.85）→ 等值高原/噪声圈（tube 端部噪声、
  //   ring 环弧、longBar 沿线等值、plate20 板面、cylinder 对称+端部）→ 均匀快路径。
  //   只有 top2 同水平、top3 掉到背景（twoThick 两厚块 + 板区）→ 双结构 → 非均匀。
  //   单候选（cube 中心/壳、thickOnThin 凸台）一律走细化——由 region 占比判据
  //   （均匀件中心区/壳占模型大部分）区分。
  //   14.txt 测试集修正：等高 + top1 prominence 高（≥ uniformPromMax）= 多个真实
  //   局部厚区（管法兰环 0.67 / 多 boss 0.93 / 递减厚区 0.87 / 阀体 0.68 / 弱块 0.75）
  //   ——必须走细化；等高 + prom 低 = 网格相位噪声（tube 0.50 / plate 0.44）→ 快路径。
  //   longBar 0.86 / hollowRing 0.68 也走细化——由 region 占比判据（outsideM 条件）区分。
  // PHASE 29（R3）：单峰均匀件补判——斜置模型（非 90°）粗场只剩 1 个候选峰时无等高对照
  //   （原判据需 ≥3 峰），体素离散又使"窗口撞 cap"判据失效（斜壁 char 低估 → R 不触 cap）：
  //   实测均匀立方体绕 (1,1,1) 轴转 45° → 中心峰误报（conf 0.89）。补判：单峰 + prom 低
  //   （< uniformPromMax，同均匀件语义）+ 位于模型中心附近 → 均匀件中心峰 → NO_HOTSPOT。
  //   真热结（居中 hub/flange）环带背景显著更低 → prom ≥0.6 不触发；弱居中热结被拒概率低（记录）。
  const uniform = isUniformCoarse(coarsePeaks, coarse, bounds, metrics, o);
  if (uniform || !coarsePeaks.length) {
    return {
      status: HS_STATUS.NO_HOTSPOT, reason: HS_REASON.NO_CANDIDATE, hotspots: [], metrics, audit: [],
      debug: withElapsed({ coarse: { gs: coarse.gs, vs: coarse.vs, estMinWall: coarse.estMinWall, pts: coarse.pts.length, stride: coarse.stride, maxM: coarseField.maxM, meanM: coarseField.meanM, peaks: coarsePeaks.length, uniform: uniform || !coarsePeaks.length, scanMs: coarse.scanMs, fieldMs: coarseField.ms, thin: coarse.thin } }, t0),
    };
  }

  // 5. 候选区细化（区域向模型内部扩展：偏置候选须覆盖结构完整截面）
  const debug = { coarse: { gs: coarse.gs, vs: coarse.vs, estMinWall: coarse.estMinWall, pts: coarse.pts.length, stride: coarse.stride, maxM: coarseField.maxM, meanM: coarseField.meanM, peaks: coarsePeaks.length, scanMs: coarse.scanMs, fieldMs: coarseField.ms, thin: coarse.thin }, refine: [] };
  const refinedPeaks = [];
  const seenRegions = [];

  for (const cp of coarsePeaks.slice(0, o.maxHotspots * 3)) {
    const rMed = Math.max(o.charFloor, 1.0 * cp.R);
    // MC 网格表面伪尖峰（区域尺寸 < 3×粗场 vs）→ 跳过
    if (2 * rMed < 3 * coarse.vs) {
      debug.refine.push({ region: coarse.pts[cp.pt], skipped: 'mc_artifact' });
      continue;
    }
    // 向模型内部扩展：偏置候选（表面层/边缘）的区域必须覆盖结构完整截面
    // （cube 角落候选：区域须含模型中心 → 壳状伪峰被 region 占比判据拒；
    //   twoThick 厚块候选：2.0×toCenter 使区域 220mm → 细化 vs 13.75 太粗 →
    //   region 仅 1-2 cell → tiny_region 误杀 → 1.0×toCenter（厚块 ±60mm 精确））
    // 14.txt 测试集修正：toCenter 上限 2×R——大模型上远离中心的候选（t10 侧出
    //   boss：toCenter 268mm）若区域=全模型 → refineSample stride 3 → 小结构
    //   失去局部极大（细化峰 0）→ 漏检。结构中心候选只需覆盖结构 + 环带背景
    //   （2R 内）；表面层伪峰候选（plate 边缘/cube 角落）由 uniform 快路径拦截
    //   或 region 占比判据（粗场）拒绝，不需要 toCenter 全覆盖。
    const toCenter = Math.hypot(coarse.pts[cp.pt][0] - bounds.center[0], coarse.pts[cp.pt][1] - bounds.center[1], coarse.pts[cp.pt][2] - bounds.center[2]);
    const regR = Math.max(rMed, Math.min(toCenter, 2 * rMed));
    const region = refineRegion(bounds, coarse.pts[cp.pt], regR, 1.0);
    // 区域去重（同一结构多个候选 → 只细化一次）
    const key = region.flat().map(v => v.toFixed(0)).join(',');
    if (seenRegions.includes(key)) continue;
    seenRegions.push(key);

    const ref = refineSample(geometry, region, coarse.globalMin, coarse.vs, o);
    if (!ref.pts.length) continue;
    ref.gridToPt = buildGridToPt(ref.gs, ref.vox.inside, ref.insideIdx);
    // M 场统一用全局网格（coarse.vox）：块边界 = 模型表面（区域网格的边界在模型
    //   内部会把内部截面误计为散热面——cube 细化区域 95mm 实测 A 错 2.3×）。
    //   细化只提供更密的采样点（stride 1）与 char。
    const refField = buildModulusField(coarse.vox, ref, o, 1.0);
    const peaks = findPeaks(refField.M, ref, refField, o);
    debug.refine.push({
      region: [coarse.pts[cp.pt][0], coarse.pts[cp.pt][1], coarse.pts[cp.pt][2]], gs: ref.gs, vs: ref.vs,
      pts: ref.pts.length, scanMs: ref.scanMs, fieldMs: refField.ms, maxM: refField.maxM,
      peaks: peaks.map(p => ({ M: p.M, pt: ref.pts[p.pt] })),
    });
    for (const p of peaks) {
      refinedPeaks.push({ ...p, ref, refField });
    }
  }

  // 6. 全局 NMS（跨区域合并）：距离合并 + 等高环峰合并（环形/带状热节）
  const merged = globalNMS(refinedPeaks, o, coarse, coarseField);
  // 诊断钩子（PHASE 24 诊断用，opt-in，零生产影响）：merged 峰摘要
  if (o.debugMerged) {
    debug.merged = merged.map(p => ({ M: +p.M.toFixed(2), R: +p.refField.R[p.pt].toFixed(1), pos: p.ref.pts[p.pt].map(v => +v.toFixed(0)) }));
  }

  // 7. 多尺度验证 + Region + 代表点 + 置信度
  const hotspots = [];
  const audit = [];
  const topM = merged.length ? merged[0].M : 0;
  const topR = merged.length ? merged[0].refField.R[merged[0].pt] : 0;
  for (const p of merged) {
    // 弱峰过滤（14.txt 测试集两档）：
    //   Hard：峰 M < 0.35×主峰 → 无条件拒（网格相位噪声：t09 箱顶壁/角柱、t08 管壁）
    //   Soft：峰 M < 0.5×主峰 且 距主峰 < 2×R → 拒（主结构内平滑梯度次峰：t01 boss 内
    //         0.43 距 157 < 218；独立弱热结（t18 最小 boss 距 280、t14 H40 距 400）保留）
    const distToTop = topM > 0 && p.M < topM * o.peakMinRatioSoft
      ? Math.hypot(p.ref.pts[p.pt][0] - merged[0].ref.pts[merged[0].pt][0], p.ref.pts[p.pt][1] - merged[0].ref.pts[merged[0].pt][1], p.ref.pts[p.pt][2] - merged[0].ref.pts[merged[0].pt][2])
      : Infinity;
    if (topM > 0 && (p.M < topM * o.peakMinRatioHard
      || (p.M < topM * o.peakMinRatioSoft && distToTop < o.peakMinDistRatio * topR))) {
      audit.push({ hotspotId: audit.length + 1, reason: 'weak_peak', M: p.M, topM, distToTop: +distToTop.toFixed(0) });
      continue;
    }
    const ms = multiscaleVerify(coarse.vox, p.ref, p.pt, o);
    if (!ms.stable) {
      audit.push({ hotspotId: audit.length + 1, reason: 'unstable_multiscale', M: p.M, cv: ms.cv });
      continue;
    }
    const region = extractRegion(p.refField.M, p.ref, p.pt, o, p.refField);
    if (region.volume < o.regionMinVolumeMm3) {
      audit.push({ hotspotId: audit.length + 1, reason: 'tiny_region', M: p.M, volume: region.volume });
      continue;
    }
    // 中心区/壳状伪峰判据：热结是"局部"结构（region 占模型体积小比例）；
    //   均匀件的中心高原/表面层壳占模型大部分（cube 壳 58%、cylinder 中心 13%）
    //   → 拒绝。实测校准：真热结 region 占比 <8%（boss 凸台 0.01%、flange hub 0.02%、
    //   大厚圆柱 3.5%）；均匀件中心/壳 >8%。
    //   物理依据：热结 = 局部 V/A 显著高于周围的结构（13.txt §10），
    //   均匀件无"局部"结构（中心区是全场背景的一部分）。
    //   14.txt 测试集修正：大占比 region 有两种——(a) 均匀件把厚料占完
    //   （longBar 沿线等值、tube 管壁、cube 壳——prom 低或 region 外仍有同水平 M）
    //   → 拒；(b) 大厚区 + 薄主体（t08 管法兰环 48%、hollowRing 环段——prom 高且
    //   region 外金属显著更薄）→ 真热结 → 报。
    const regionRatio = modelVolume > 0 ? region.volume / modelVolume : 1;
    // 均匀件中心区/壳判据：热结是"局部"结构（region 占模型体积小比例）；
    //   均匀件中心高原/壳占模型大部分（cylinder 中心 13% > 8%）→ 拒（prom 低）。
    if (regionRatio > o.regionVolumeMaxRatio && p.prominence < o.uniformPromMax) {
      audit.push({ hotspotId: audit.length + 1, reason: 'central_region', M: p.M, ratio: +regionRatio.toFixed(3), volume: region.volume });
      continue;
    }
    // 窗口撞上限判据（14.txt 测试集）：峰 R ≥ 窗口上限（0.5×mdim）→ 窗口被截断到
    //   "到表面距离"为止（cube 中心 R=50=cap=50，窗口内无自由面 → 无局部信息）→
    //   峰是 M 场平滑锥形顶点（均匀件中心），非局部结构 → 拒。
    //   实测校准：cube/cylinder/cube50/cylinder100 中心 R≈cap 拒；
    //   boss 凸台 R=60 << cap=200、t08 法兰 R=69 < 150、t14 块 R=96 < 600 → 保留。
    //   已排除：outsideRatio 判据（boss 0.741 vs cube 0.733 重叠，无效）。
    //   风险记录：结构厚 ≥ 0.25×mdim 的"大厚块"中心也会撞 cap（窗口无局部性）
    //   ——真实场景少见（块厚 ≥ 模型 1/4），待真实 STL 验证。
    const peakR = p.refField.R[p.pt];
    const cap = o.windowCapRatio * Math.max(...metrics.size);
    if (peakR >= cap * 0.99) {
      audit.push({ hotspotId: audit.length + 1, reason: 'global_vertex', M: p.M, R: +peakR.toFixed(1), cap: +cap.toFixed(1), volume: region.volume });
      continue;
    }
    const rep = representativePoint(geometry, p.ref, region);
    const normM = p.refField.maxM > 0 ? p.M / p.refField.maxM : 0;
    const { confidence } = computeConfidence(normM, p.prominence, region, modelVolume, ms.stability, o);
    if (confidence < o.CONFIDENCE_THRESHOLD) {
      audit.push({ hotspotId: audit.length + 1, reason: 'low_confidence', M: p.M, confidence });
      continue;
    }
    hotspots.push({
      hotspotId: hotspots.length + 1,
      position: rep,
      peakModulus: p.M,
      normalizedModulus: normM,
      regionVolume: region.volume,
      regionArea: region.regionArea,
      confidence,
      scaleStability: ms.stability,
      geometrySource: `refined field peak @(${p.ref.pts[p.pt].map(v => v.toFixed(1)).join(',')})`,
      _internal: { region, ms, peakM: p.M, prominence: p.prominence },
    });
  }

  // 排序 + 去重（多峰可能收敛同一区域）
  hotspots.sort((a, b) => b.peakModulus - a.peakModulus);
  const deduped = [];
  for (const h of hotspots) {
    let dup = false;
    for (const d of deduped) {
      const r = Math.max(h._internal.region.meanM > 0 ? (h._internal.region.volume / h._internal.region.regionArea) : 1, d._internal.region.meanM > 0 ? (d._internal.region.volume / d._internal.region.regionArea) : 1);
      const dist = Math.hypot(h.position[0] - d.position[0], h.position[1] - d.position[1], h.position[2] - d.position[2]);
      if (dist < o.peakSeparationRatio * r) { dup = true; break; }
    }
    if (!dup) deduped.push(h);
  }
  const out = deduped.slice(0, o.maxHotspots).map(({ _internal, ...h }, i) => ({ ...h, hotspotId: i + 1 }));

  let status, reason;
  if (out.length) {
    status = HS_STATUS.OK;
    reason = null;
  } else if (audit.some(a => a.reason === 'low_confidence')) {
    status = HS_STATUS.LOW_CONFIDENCE;
    reason = HS_REASON.ALL_LOW_CONFIDENCE;
  } else {
    status = HS_STATUS.NO_HOTSPOT;
    reason = audit.length ? 'rejected' : HS_REASON.NO_CANDIDATE;
  }

  return { status, reason, hotspots: out, metrics, audit, debug: withElapsed(debug, t0) };
}

/**
 * 分片版 V3 热结分析（PHASE 22 · UI 用）：与 analyzeHotspotsV3 同一条流水线、
 * 同一组判定（findPeaks/globalNMS/multiscaleVerify/extractRegion/...），仅粗采样与
 * M 场构建期间让出主线程（每片 ≤256 点/每扫描片）。Node 回归仍走同步版；
 * 两版一致性由 phase22_test.mjs「sliced == sync」用例锁定。
 * @param {Function} [yieldFn]
 * @param {Function} [onProgress] onProgress(phase, frac)：
 *   phase ∈ {'scan','dist','field','refine'}；frac ∈ [0,1]（调用方映射到进度条区间）
 */
export async function analyzeHotspotsV3Sliced(mesh, geometry, opts = {}, yieldFn = null, onProgress = null) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();

  // 0. Mesh Validation（与同步版同判定）
  const mv = validateMesh(mesh);
  if (mv.issues.some(i => i.level === 'error')) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.INVALID_MESH, hotspots: [], metrics: metricsOf(mesh), audit: [], debug: withElapsed({}, t0) };
  }

  // 1. Geometry Metrics
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const modelVolume = computeVolume(mesh.vertices, mesh.triCount);
  const modelArea = computeArea(mesh.vertices, mesh.triCount);
  const metrics = { volume: modelVolume, area: modelArea, bounds, triCount: mesh.triCount, size: bounds.size, center: bounds.center };

  // 2. Adaptive Sampling（分片扫描 + 分片距离）
  const coarse = await coarseSampleSliced(mesh, geometry, o, yieldFn, onProgress);
  if (!coarse.pts.length) {
    return { status: HS_STATUS.INSUFFICIENT_RESOLUTION, reason: HS_REASON.NO_INSIDE_POINTS, hotspots: [], metrics, audit: [], debug: withElapsed({ coarse: { gs: coarse.gs, vs: coarse.vs, estMinWall: coarse.estMinWall, pts: 0, thin: coarse.thin } }, t0) };
  }
  coarse.gridToPt = buildGridToPt(coarse.gs, coarse.vox.inside, coarse.insideIdx);

  // 3. 粗 M 场（medium 尺度，分片）
  const coarseField = await buildModulusFieldSliced(coarse.vox, coarse, o, 1.0, null, yieldFn,
    (f) => onProgress?.('field', f * 0.5));   // 粗场占 field 阶段前 50%

  // 4. 粗场峰检测（与同步版同实现）
  const coarsePeaks = findPeaks(coarseField.M, coarse, coarseField, o);
  const uniform = isUniformCoarse(coarsePeaks, coarse, bounds, metrics, o);
  if (uniform || !coarsePeaks.length) {
    return {
      status: HS_STATUS.NO_HOTSPOT, reason: HS_REASON.NO_CANDIDATE, hotspots: [], metrics, audit: [],
      debug: withElapsed({ coarse: { gs: coarse.gs, vs: coarse.vs, estMinWall: coarse.estMinWall, pts: coarse.pts.length, stride: coarse.stride, maxM: coarseField.maxM, meanM: coarseField.meanM, peaks: coarsePeaks.length, uniform: uniform || !coarsePeaks.length, scanMs: coarse.scanMs, fieldMs: coarseField.ms, thin: coarse.thin } }, t0),
    };
  }

  // 5. 候选区细化（分片 M 场；区域扫描保持同步——区域小毫秒级）
  const debug = { coarse: { gs: coarse.gs, vs: coarse.vs, estMinWall: coarse.estMinWall, pts: coarse.pts.length, stride: coarse.stride, maxM: coarseField.maxM, meanM: coarseField.meanM, peaks: coarsePeaks.length, scanMs: coarse.scanMs, fieldMs: coarseField.ms, thin: coarse.thin }, refine: [] };
  const refinedPeaks = [];
  const seenRegions = [];
  const refineTargets = coarsePeaks.slice(0, o.maxHotspots * 3);

  for (let ri = 0; ri < refineTargets.length; ri++) {
    const cp = refineTargets[ri];
    onProgress?.('refine', ri / Math.max(1, refineTargets.length));
    const rMed = Math.max(o.charFloor, 1.0 * cp.R);
    // MC 网格表面伪尖峰（区域尺寸 < 3×粗场 vs）→ 跳过
    if (2 * rMed < 3 * coarse.vs) {
      debug.refine.push({ region: coarse.pts[cp.pt], skipped: 'mc_artifact' });
      continue;
    }
    const toCenter = Math.hypot(coarse.pts[cp.pt][0] - bounds.center[0], coarse.pts[cp.pt][1] - bounds.center[1], coarse.pts[cp.pt][2] - bounds.center[2]);
    const regR = Math.max(rMed, Math.min(toCenter, 2 * rMed));
    const region = refineRegion(bounds, coarse.pts[cp.pt], regR, 1.0);
    const key = region.flat().map(v => v.toFixed(0)).join(',');
    if (seenRegions.includes(key)) continue;
    seenRegions.push(key);

    if (yieldFn) await yieldFn();   // 区域之间让出（UI 可刷新进度条）
    const ref = refineSample(geometry, region, coarse.globalMin, coarse.vs, o);
    if (!ref.pts.length) continue;
    ref.gridToPt = buildGridToPt(ref.gs, ref.vox.inside, ref.insideIdx);
    // M 场统一用全局网格（coarse.vox），细化只提供更密采样点（与同步版同一设计）
    const refField = await buildModulusFieldSliced(coarse.vox, ref, o, 1.0, null, yieldFn,
      (f) => onProgress?.('field', 0.5 + 0.5 * f * (1 / Math.max(1, refineTargets.length))));
    const peaks = findPeaks(refField.M, ref, refField, o);
    debug.refine.push({
      region: [coarse.pts[cp.pt][0], coarse.pts[cp.pt][1], coarse.pts[cp.pt][2]], gs: ref.gs, vs: ref.vs,
      pts: ref.pts.length, scanMs: ref.scanMs, fieldMs: refField.ms, maxM: refField.maxM,
      peaks: peaks.map(p => ({ M: p.M, pt: ref.pts[p.pt] })),
    });
    for (const p of peaks) {
      refinedPeaks.push({ ...p, ref, refField });
    }
  }

  // 6. 全局 NMS（与同步版同实现）
  const merged = globalNMS(refinedPeaks, o, coarse, coarseField);

  // 7. 多尺度验证 + Region + 代表点 + 置信度（全部同步——O(N) 毫秒级）
  const hotspots = [];
  const audit = [];
  const topM = merged.length ? merged[0].M : 0;
  const topR = merged.length ? merged[0].refField.R[merged[0].pt] : 0;
  for (const p of merged) {
    const distToTop = topM > 0 && p.M < topM * o.peakMinRatioSoft
      ? Math.hypot(p.ref.pts[p.pt][0] - merged[0].ref.pts[merged[0].pt][0], p.ref.pts[p.pt][1] - merged[0].ref.pts[merged[0].pt][1], p.ref.pts[p.pt][2] - merged[0].ref.pts[merged[0].pt][2])
      : Infinity;
    if (topM > 0 && (p.M < topM * o.peakMinRatioHard
      || (p.M < topM * o.peakMinRatioSoft && distToTop < o.peakMinDistRatio * topR))) {
      audit.push({ hotspotId: audit.length + 1, reason: 'weak_peak', M: p.M, topM, distToTop: +distToTop.toFixed(0) });
      continue;
    }
    const ms = multiscaleVerify(coarse.vox, p.ref, p.pt, o);
    if (!ms.stable) {
      audit.push({ hotspotId: audit.length + 1, reason: 'unstable_multiscale', M: p.M, cv: ms.cv });
      continue;
    }
    const region = extractRegion(p.refField.M, p.ref, p.pt, o, p.refField);
    if (region.volume < o.regionMinVolumeMm3) {
      audit.push({ hotspotId: audit.length + 1, reason: 'tiny_region', M: p.M, volume: region.volume });
      continue;
    }
    const regionRatio = modelVolume > 0 ? region.volume / modelVolume : 1;
    if (regionRatio > o.regionVolumeMaxRatio && p.prominence < o.uniformPromMax) {
      audit.push({ hotspotId: audit.length + 1, reason: 'central_region', M: p.M, ratio: +regionRatio.toFixed(3), volume: region.volume });
      continue;
    }
    const peakR = p.refField.R[p.pt];
    const cap = o.windowCapRatio * Math.max(...metrics.size);
    if (peakR >= cap * 0.99) {
      audit.push({ hotspotId: audit.length + 1, reason: 'global_vertex', M: p.M, R: +peakR.toFixed(1), cap: +cap.toFixed(1), volume: region.volume });
      continue;
    }
    const rep = representativePoint(geometry, p.ref, region);
    const normM = p.refField.maxM > 0 ? p.M / p.refField.maxM : 0;
    const { confidence } = computeConfidence(normM, p.prominence, region, modelVolume, ms.stability, o);
    if (confidence < o.CONFIDENCE_THRESHOLD) {
      audit.push({ hotspotId: audit.length + 1, reason: 'low_confidence', M: p.M, confidence });
      continue;
    }
    hotspots.push({
      hotspotId: hotspots.length + 1,
      position: rep,
      peakModulus: p.M,
      normalizedModulus: normM,
      regionVolume: region.volume,
      regionArea: region.regionArea,
      confidence,
      scaleStability: ms.stability,
      geometrySource: `refined field peak @(${p.ref.pts[p.pt].map(v => v.toFixed(1)).join(',')})`,
      _internal: { region, ms, peakM: p.M, prominence: p.prominence },
    });
  }

  // 排序 + 去重（与同步版同实现）
  hotspots.sort((a, b) => b.peakModulus - a.peakModulus);
  const deduped = [];
  for (const h of hotspots) {
    let dup = false;
    for (const d of deduped) {
      const r = Math.max(h._internal.region.meanM > 0 ? (h._internal.region.volume / h._internal.region.regionArea) : 1, d._internal.region.meanM > 0 ? (d._internal.region.volume / d._internal.region.regionArea) : 1);
      const dist = Math.hypot(h.position[0] - d.position[0], h.position[1] - d.position[1], h.position[2] - d.position[2]);
      if (dist < o.peakSeparationRatio * r) { dup = true; break; }
    }
    if (!dup) deduped.push(h);
  }
  const out = deduped.slice(0, o.maxHotspots).map(({ _internal, ...h }, i) => ({ ...h, hotspotId: i + 1 }));

  let status, reason;
  if (out.length) {
    status = HS_STATUS.OK;
    reason = null;
  } else if (audit.some(a => a.reason === 'low_confidence')) {
    status = HS_STATUS.LOW_CONFIDENCE;
    reason = HS_REASON.ALL_LOW_CONFIDENCE;
  } else {
    status = HS_STATUS.NO_HOTSPOT;
    reason = audit.length ? 'rejected' : HS_REASON.NO_CANDIDATE;
  }

  onProgress?.('refine', 1);
  return { status, reason, hotspots: out, metrics, audit, debug: withElapsed(debug, t0) };
}

/**
 * 均匀件判据（PHASE 29 重构为 helper，sync/sliced 共用）：
 *   ① ≥3 峰等高（top2/top3 ≥ 0.85×top1）+ 低 prom → 等值高原/相位噪声（原判据）；
 *   ② 单峰 + 模型中心附近 + 窗口接近 cap 上限 → 均匀件中心顶点（R3 斜置补判）。
 *   单峰判据物理依据：唯一候选峰且位于模型中心（距中心 < 0.2×mdim）时无等高对照，
 *   若其窗口 R ≥ 0.8×cap（cap=0.5×mdim，即"到表面距离"≈模型半宽）→ 该点就是模型
 *   最厚位置 = 均匀件中心顶点（无局部结构）。实测 45° 斜置立方体误报中心峰
 *   （R/cap=0.87；轴向撞 cap 判据失效因斜壁 char 低估）。不用 prom——斜壁 M 低估使
 *   环带背景虚低、prom 虚高（0.6 条件实测不可靠）。
 *   不误伤：真热结窗口是局部结构尺寸（boss R/cap≈0.3、法兰 0.46、大厚块 ≈0.25），
 *   远低于 0.8。
 */
function isUniformCoarse(coarsePeaks, coarse, bounds, metrics, o) {
  if (coarsePeaks.length >= 3) {
    return coarsePeaks[1].M / coarsePeaks[0].M >= o.uniformTop2Ratio
      && coarsePeaks[2].M / coarsePeaks[0].M >= o.uniformTop2Ratio
      && coarsePeaks[0].prominence < o.uniformPromMax;
  }
  if (coarsePeaks.length === 1) {
    const p = coarse.pts[coarsePeaks[0].pt];
    const c = bounds.center;
    const md = Math.max(...metrics.size);
    const cap = o.windowCapRatio * md;
    return coarsePeaks[0].R >= 0.8 * cap
      && Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 0.2 * md;
  }
  return false;
}

/** 跨细化区域全局 NMS（14.txt 测试集两阶段）：
 *  阶段 1：等高连通分组（环形/带状热节）——两峰 M 差 < peakEqualRatio 且距离 <
 *    peakEqualDistRatio×R 且峰间中点粗场 M 无谷（≥ peakEqualValleyRatio×峰）
 *    → 同一环形/带状热节（t08 管法兰环、t19 阀体法兰环、t20 底板大平板相位峰）。
 *    并查集连通分组（链式合并：环上隔一个的峰也归组——单遍比较 kept 会漏）。
 *    中点检查区分"同环等高峰"（t19 环上峰间无谷 0.74）与"独立厚区"
 *    （t12 两块间板区 M 低 0.35）。
 *  阶段 2：组间距离 NMS（1.3×R）。 */
function globalNMS(peaks, o, coarse, coarseField) {
  const sorted = [...peaks].sort((a, b) => b.M - a.M);
  const n = sorted.length;
  const midM = (pa, qa) => {
    const mx = (pa[0] + qa[0]) / 2, my = (pa[1] + qa[1]) / 2, mz = (pa[2] + qa[2]) / 2;
    let best = Infinity, bm = 0;
    for (let i = 0; i < coarse.pts.length; i++) {
      const d = (coarse.pts[i][0] - mx) ** 2 + (coarse.pts[i][1] - my) ** 2 + (coarse.pts[i][2] - mz) ** 2;
      if (d < best) { best = d; bm = coarseField.M[i]; }
    }
    return bm;
  };
  // 阶段 1：等高连通分组（并查集）
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const p = sorted[i], q = sorted[j];
    if (Math.abs(p.M - q.M) >= o.peakEqualRatio * Math.max(p.M, q.M)) continue;
    const r = Math.max(p.refField.R[p.pt], q.refField.R[q.pt]);
    const d = Math.hypot(p.ref.pts[p.pt][0] - q.ref.pts[q.pt][0], p.ref.pts[p.pt][1] - q.ref.pts[q.pt][1], p.ref.pts[p.pt][2] - q.ref.pts[q.pt][2]);
    if (d >= o.peakEqualDistRatio * r) continue;
    if (midM(p.ref.pts[p.pt], q.ref.pts[q.pt]) < o.peakEqualValleyRatio * Math.max(p.M, q.M)) continue;
    parent[find(i)] = find(j);
  }
  const reps = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!reps.has(root) || sorted[i].M > sorted[reps.get(root)].M) reps.set(root, i);
  }
  const grouped = [...reps.values()].sort((a, b) => sorted[b].M - sorted[a].M).map(i => sorted[i]);
  // 阶段 2：组间距离 NMS
  const kept = [];
  for (const p of grouped) {
    let tooClose = false;
    for (const q of kept) {
      const r = Math.max(p.refField.R[p.pt], q.refField.R[q.pt]);
      const d = Math.hypot(p.ref.pts[p.pt][0] - q.ref.pts[q.pt][0], p.ref.pts[p.pt][1] - q.ref.pts[q.pt][1], p.ref.pts[p.pt][2] - q.ref.pts[q.pt][2]);
      if (d < o.peakSeparationRatio * r) { tooClose = true; break; }
    }
    if (!tooClose) kept.push(p);
  }
  return kept;
}

function metricsOf(mesh) {
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  return { volume: computeVolume(mesh.vertices, mesh.triCount), area: computeArea(mesh.vertices, mesh.triCount), bounds, triCount: mesh.triCount, size: bounds.size, center: bounds.center };
}

function withElapsed(debug, t0) {
  return { ...debug, elapsedMs: Date.now() - t0 };
}
