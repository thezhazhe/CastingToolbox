// ============================================================
// V3 → Design Center 视图适配层（17.txt PHASE 16-A / 21.txt PHASE 17）
// 职责：把 analyzeHotspotsV3 的输出映射为 designCenter 消费的 V2 视图形态
//       （{id, x, y, z, mc, regionVolumeCm3, confidence, peaks, ...}），
//       Adapter 只做字段转换（peakModulus→mc、regionVolume→regionVolumeCm3），
//       不修改 V3 核心，不修改 designCenter 下游消费逻辑。
// 附加产出：采样 WARNING 分级（21.txt PHASE 17——主体壁厚/局部薄特征区分，
//       修复"模型过薄"误报；只读验证见 docs/PHASE17_SAMPLING_WARNING_FIX_REPORT.md）。
// 纯函数，Node 可测。
// ============================================================
import { V3_DEFAULTS } from './configV3.js';

const f1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(1) : null);

/**
 * V3 结果 → Design Center 兼容形态
 * @param {object} v3  analyzeHotspotsV3 的返回
 *   {status, reason, hotspots:[{hotspotId, position:[x,y,z], peakModulus,
 *     normalizedModulus, regionVolume(mm³), regionArea(mm²), confidence,
 *     scaleStability, geometrySource}], metrics, audit, debug}
 * @param {object} [geom]  几何分析结果（designCenter 已有，16-A 判据用）
 *   {wallMax, wallMain}   —— V2 距离场壁厚（已验证与 golden 一致），权威真实壁厚
 * @returns {{
 *   engine:'v3', status, reason, hotspots, audit, metrics,
 *   debug:{V2 兼容字段 + v3 原始信息},   // updateHsBadge/logHotspotDebug/diagnoseSTL 消费
 *   sampling:{ok|warning, layers, detail}  // 17.txt 十三：采样欠解析 WARNING
 * }}
 */
export function toViewResult(v3, geom = {}) {
  const d = v3.debug || {};
  const coarse = d.coarse || {};

  const hotspots = (v3.hotspots || []).map(h => ({
    id: h.hotspotId,
    x: h.position[0], y: h.position[1], z: h.position[2],
    mc: h.peakModulus,                       // peakModulus → mc（mm）
    score: h.peakModulus,                    // 显示用（V3 无 V2 半壁厚语义，取 M 值）
    confidence: h.confidence,
    regionVolumeCm3: +(h.regionVolume / 1000).toFixed(2),   // mm³ → cm³
    regionAreaCm2: h.regionArea != null ? +(h.regionArea / 100).toFixed(2) : undefined,
    normalizedModulus: h.normalizedModulus,
    scaleStability: h.scaleStability,
    geometrySource: h.geometrySource,
    peaks: [{ x: h.position[0], y: h.position[1], z: h.position[2], score: h.peakModulus }],
  }));

  const debug = {
    // V2 兼容字段（updateHsBadge / logHotspotDebug / diagnoseSTL 直接消费）
    gs: coarse.gs ?? 0,
    vs: coarse.vs ?? 0,
    insidePoints: coarse.pts ?? 0,
    totalPoints: coarse.gs ? coarse.gs ** 3 : 0,
    candidates: coarse.peaks ?? 0,
    regions: (d.refine || []).length,
    peaks: coarse.peaks ?? 0,
    rejected: (v3.audit || []).length,
    median: null,                            // V2 字段，V3 无对应
    elapsedMs: d.elapsedMs ?? 0,
    // V3 原始信息（16-C/D 阶段采样 WARNING UI、调试面板用）
    v3: { coarse, refine: d.refine || [], audit: v3.audit || [] },
  };

  return {
    engine: 'v3',
    status: v3.status,
    reason: v3.reason,
    hotspots,
    audit: v3.audit || [],
    metrics: v3.metrics,
    debug,
    sampling: samplingWarn(coarse, geom, v3.status, (v3.hotspots || []).length),
  };
}

/**
 * 主体壁厚参考（21.txt PHASE 17 原则 1：优先使用已有 geometry 分析，不重新发明）。
 * wallMain 可信区间校验：geometry 峰值检测失败时会 fallback 到 wallMax（=最大壁厚）
 * 或卡在伪低桶（实测 plate500_w20 wallMain=4 < wallAvg=9.4、t02 wallMain=67.7=wallMax）——
 * 这两种都不可信。可信 wallMain 应高于平均壁厚 70%、低于最大壁厚 90%。
 * PHASE 26（34.txt 一）：导出供 UI 复用——"主体壁厚"显示与 samplingWarn 同链。
 * @param {object} geom  {wallMain, wallAvg, wallMax}（V2 距离场 48³ + 亚体素精化）
 * @returns {number|null} 主体壁厚（mm）
 */
export function bodyWallOf(geom) {
  const wm = geom.wallMain, wa = geom.wallAvg, wx = geom.wallMax;
  if (wm > 0 && wa > 0 && wx > 0 && wm >= 0.7 * wa && wm <= 0.9 * wx) return wm;
  if (wa > 0) return wa;
  return wx > 0 ? wx : null;
}

/**
 * 可信主体壁厚参考链（PHASE 26 · 34.txt 一：UI"主体壁厚"与 samplingWarn 统一来源）。
 * bodyRef = max(bodyWallOf, tP50)（PHASE 23/24 验证链）：
 *   - 薄壁主体+厚大结构（ALR2510）：wallMain 退化 wallMax 不可信 → bodyWallOf→wallAvg
 *     2.3mm；tP50=3.6（局部完整厚度中位）→ bodyRef=3.6 ≈ 真实主体 2-3mm ✓
 *   - 均匀实心件（cube50）：bodyWallOf→wallAvg=12.5 低估（wallMain=wallMax=50 不可信，
 *     均匀件半距平均=边/8 是几何事实）→ tP50≈50（全域 t=d+d2≈50）→ bodyRef=50 ✓
 *   - tP50 可用性 guard（PHASE 23 校准）：tP50 ≤ 2×wallMax 才可信（断网格伪 t 保护）
 * 仅合并计算，不修改任何阈值；samplingWarn 内部调用同一函数（行为零变化）。
 * @param {object} geom  {wallMain, wallAvg, wallMax}（V2 距离场）
 * @param {object} [thin]  coarse.thin {tP50, ...}（V3 局部完整厚度测度）
 * @returns {{bodyRef:number|null, bodyWall:number|null, tP50:number|null}}
 */
export function bodyRefOf(geom, thin = {}) {
  const body = bodyWallOf(geom);
  const wallMaxG = geom.wallMax > 0 ? geom.wallMax : null;
  const tP50 = thin.tP50 > 0 && (wallMaxG == null || thin.tP50 <= 2 * wallMaxG) ? thin.tP50 : null;
  const bodyRef = body != null && tP50 != null ? Math.max(body, tP50) : (body ?? tP50);
  return { bodyRef, bodyWall: body, tP50 };
}

/**
 * 采样 WARNING 分级（21.txt PHASE 17 四级结构保留；PHASE 23 触发机制重做）
 *
 * PHASE 23 根因（31.txt 五/六，数据证据见 docs/PHASE23_REPORT.md）：
 *   旧"局部特征过薄"触发 = estMinWall（探测 char p10）/vs < 2——实测 30 个真实 STL：
 *   p10 是"表面密度"统计（最近距离低分位），任何带表面特征的实体 p10 恒 ≈2-4mm
 *   （ALR2510 真薄壁 2.3mm 与 HR4012 大板 48mm 主体的 charP10 几乎相同：2.2 vs 2.4-3.1），
 *   且 estMinWall 被 estWallFloor=4 保底夹住、vs 被 mdim/128 上限夹住 → 10/30 模具
 *   结构性误报"局部特征过薄"（HR4012 大板家族 6 个 + ALHR45xx 系列——均无真实薄材料）。
 *
 *   新触发使用**局部完整厚度** t = d + d2（最近表面距离 + 沿局部法线到远侧表面距离，
 *   coarse.thin，sampling.js localThicknessStats）：
 *   - t 分布与表面壳层解耦：48mm 厚板表面点 t≈48（旧 char=2mm 误判）；4mm 肋 t≈4。
 *   - thinFrac = P(t < 2×vs)：真实低于 2 层采样下限的材料占比。
 *   实测判别：误报家族 thinFrac 全部 0.000~0.011；真薄壁 ALR2510 0.618 / 滑块x3 0.375；
 *   边界 ALHR4520A v3 0.090。阈值 thinFractionMin=0.10 留 10× 余量。
 *
 * 四级状态（21.txt 六）：
 *   🟢 ok         —— 主体壁厚 ≥2 采样层，且无 ≥10% 材料局部厚度 <2 层
 *   🟡 local_thin —— 主体正常，但 ≥10% 材料局部厚度 <2×vs（真实薄材料欠采样）
 *   🟠 resolution —— 主体壁厚 <2 层（或采样格 > 最大壁厚）：整体采样分辨率不足
 *   🔴 failed     —— V3 明确无法可靠分析（NO_INSIDE_POINTS / INVALID_MESH）
 */
function samplingWarn(coarse, geom, status, hotspotCount = 0) {
  const out = { ok: true, warning: false, level: 'ok', layers: null, vs: null };
  if (!coarse || !coarse.vs) return out;
  out.vs = +coarse.vs.toFixed(2);

  // 🔴 无法可靠分析（V3 明确失败——不再用"模型过薄"误导文案；22.txt 四文案）
  if (status === 'INSUFFICIENT_RESOLUTION') {
    return { ...out, ok: false, warning: true, level: 'failed',
      detail: '⚠ 无法可靠进行热结分析，请检查模型尺度、网格质量或局部薄壁结构。' };
  }

  // 局部完整厚度测度（PHASE 23）：tP50 = 材料中位局部厚度（与表面壳层解耦的"主体"估计）
  const thin = coarse.thin || {};
  const thinFrac = typeof thin.thinFrac === 'number' ? thin.thinFrac : 0;
  // 可信主体壁厚链（PHASE 26 提取 bodyRefOf：bodyWallOf + tP50 取大，含 2×wallMax 可用性
  //   guard——断网格伪 t 保护，见 bodyRefOf 注释）。samplingWarn 行为与本函数此前一致。
  const { bodyRef, tP50 } = bodyRefOf(geom, thin);
  const bodyLayers = bodyRef != null ? bodyRef / coarse.vs : null;
  out.layers = bodyLayers !== null ? +bodyLayers.toFixed(2) : null;
  out.thinFrac = +thinFrac.toFixed(3);
  if (thin.tP10 != null) out.tP10 = +thin.tP10.toFixed(1);
  if (tP50 != null) out.tP50 = +tP50.toFixed(1);

  // fallback 识别（21.txt Test 4）：estMinWall=mdim/coarseResolution 兜底 → 与真实壁厚无关
  const mdim = coarse.vs * coarse.gs;
  const fallback = coarse.estMinWall != null && mdim > 0 &&
    Math.abs(coarse.estMinWall - mdim / V3_DEFAULTS.coarseResolution) < mdim * 0.01;
  const estMinWall = coarse.estMinWall != null ? f1(coarse.estMinWall) : null;

  // 主体壁厚数据本身不可靠（geometry 无有效值且 tP50 无）→ 明确"不确定"（22.txt 三）
  if (bodyRef == null) {
    return { ...out, ok: false, warning: true, level: 'resolution', bodyWall: null, minWall: estMinWall, minWallReliable: !fallback,
      detail: '⚠ 主体壁厚信息不可靠，当前模型采样可信度有限，热结分析结果仅供参考。' };
  }

  // 🟠 采样可信度有限：主体壁厚 <2 层，或采样格 > 最大壁厚（最厚处也 <1 层）（22.txt 四文案）
  // PHASE 24 语义修正（32.txt 八："模型整体薄" ≠ "热结结果不可靠"）：
  //   主体薄只影响薄壁区厚度测量精度；热结区域（厚大结构）能通过 tiny_region/置信度
  //   门槛即说明其采样层数充足（ALR2510 实模：主体 2-3mm 仅 1.8 层，厚大轨 15.8mm
  //   有 7.9 层 → 5 热结 conf 0.82，结果可用）。有热结时不再用"结果仅供参考"误导文案。
  const wallMax = geom.wallMax > 0 ? geom.wallMax : null;
  if ((bodyLayers !== null && bodyLayers < 2) || (wallMax && coarse.vs > wallMax)) {
    const hasHs = typeof hotspotCount === 'number' && hotspotCount > 0;
    const bodyTxt = bodyRef != null ? `约 ${f1(bodyRef)}mm（${bodyLayers !== null ? bodyLayers.toFixed(1) : '?'} 层，低于 2 层采样下限）` : '低于 2 层采样下限';
    return {
      ...out, ok: false, warning: true, level: 'resolution', bodyWall: f1(bodyRef), minWall: estMinWall, minWallReliable: !fallback,
      detail: hasHs
        ? `⚠ 模型主体为薄壁结构（${bodyTxt}），薄壁区域厚度测量精度有限；已检出 ${hotspotCount} 个热结（厚大区域采样正常），热结分析结果可用。`
        : '⚠ 当前模型存在局部区域采样不足，热结分析结果仅供参考。',
    };
  }

  // 🟡 局部薄特征（PHASE 23 新触发）：≥thinFractionMin 的材料局部厚度 < 2×vs——真实薄材料
  //   且低于 2 层采样下限；旧触发（estMinWall/vs<2，表面密度统计）已废弃
  const thinLine = 2 * coarse.vs;
  if (thinFrac >= V3_DEFAULTS.thinFractionMin) {
    return {
      ...out, ok: false, warning: true, level: 'local_thin', bodyWall: f1(bodyRef), minWall: estMinWall, minWallReliable: true,
      thinFrac, thinLine: +thinLine.toFixed(1),
      detail: `⚠ 主体壁厚约 ${f1(bodyRef)}mm，约 ${Math.round(thinFrac * 100)}% 的材料局部厚度小于 ${thinLine.toFixed(1)}mm（低于 2 层采样下限${thin.tP10 ? `，最薄约 ${thin.tP10.toFixed(1)}mm` : ''}），局部区域采样精度可能不足。`,
    };
  }

  return out;
}
