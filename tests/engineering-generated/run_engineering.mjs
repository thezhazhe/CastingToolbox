// ============================================================
// 工程化测试集运行器（命令 14.txt；PHASE 85 增加诊断层）
// 对 models/<name>/ 下每个模型：
//   跑 V3 → result.json（V3 完整结果 + legacy 检查项 + 诊断项 + 变体）
//
// ★ PHASE 85（85.txt 二/五/八）：本文件现在有**两层判定**，互不干扰：
//
//   层 1 —— legacy（`checks`）：逐字未改，仍用「到 GT 中心的距离 ≤ tolerance」配对。
//           「位置超差」会被同时记成 1 漏检 + 1 误报 —— 这是历史口径，**故意保留**，
//           用来复现 legacy score 9/20（85.txt 九：legacy 是历史指标，不因新体系改变）。
//           它读的是 expected.json 里**冻结的** `legacy.expectedHotspots`。
//
//   层 2 —— diagnostic（`diagnostics`）：把「检测」与「位置精度」拆开
//           （85.txt 二/五/六/七/八），产出 zoneMatch / 峰点与代表点双轨距离 /
//           7 类 classification / 新 summary 计数。它读修正后的
//           `expectedHotspots`（必检）+ `optionalHotspots`（可选）。
//
//   两层**都读同一份 V3 输出**，算法零改动（85.txt 一）。
//
// 变体（子集模型）：
//   rot90（y 轴 90°） / scale×10 / scale×0.1 / mesh density（r90/r120）
//
// 用法: node tests/engineering-generated/run_engineering.mjs
//       node tests/engineering-generated/run_engineering.mjs --legacy-only   # 只跑层 1
// ============================================================
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { transformMesh, rotY, scaleMesh, rotateMesh } from '../tools/hotspotGeometryGenerator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(HERE, 'models');

// 变体配置（模型 → 变体列表）
const VARIANTS = {
  t01_boss100: ['rot90', 'scale10', 'scale01'],
  t10_multiDirBoss: ['rot90'],
  t13_farPair: ['rot90', 'scale10'],
  t19_valveLike: ['rot90'],
};
const DENSITY_MODELS = ['t08_pipeFlange70', 't16_extreme_10_100'];

/** 运行 V3 一次，返回 {v3, ms} */
function runV3(vertices, triCount) {
  const mesh = { vertices, triCount };
  const geometry = buildMesh(mesh).geometry;
  const t0 = Date.now();
  const v3 = analyzeHotspotsV3(mesh, geometry);
  return { v3, ms: Date.now() - t0 };
}

/** 逆 y 旋转 90° 的坐标变换（变体结果回到主坐标） */
function invRotY90(p) { return [-p[2], p[1], p[0]]; }

/** ring 型匹配：点位于环带内（径向 ∈ [innerR, outerR] ± tol，轴向 |along| ≤ halfH + tol）→ 返回径向误差（mm），否则 null */
function ringMatch(pos, e) {
  const axisIdx = e.axis ? e.axis.findIndex(v => v === 1) : -1;
  const along = axisIdx >= 0 ? pos[axisIdx] - e.centerMm[axisIdx] : 0;
  if (Math.abs(along) > (e.halfH ?? 0) + e.toleranceMm) return null;
  let radial = 0;
  for (let i = 0; i < 3; i++) {
    if (i === axisIdx) continue;
    radial += (pos[i] - e.centerMm[i]) ** 2;
  }
  radial = Math.sqrt(radial);
  if (radial < e.innerR - e.toleranceMm || radial > e.outerR + e.toleranceMm) return null;
  return Math.max(0, Math.abs(radial - (e.innerR + e.outerR) / 2));
}

/** legacy 判定集：优先用 expected.json 里冻结的那份（PHASE 84 及以前），保证 9/20 可复现 */
function legacyExpected(expected) {
  return expected.legacy?.expectedHotspots ?? expected.expectedHotspots ?? [];
}

/**
 * 检查 V3 热点 vs expected（14.txt 六 1-6）—— ★ legacy 层，PHASE 85 逐字未改 ★
 * 语义提醒（PHASE 84 审计结论）：这里用「到 GT 中心的距离 ≤ tolerance」配对，
 *   所以**位置超差的热点会被计成 falsePositive**，一次偏移 = 1 漏检 + 1 误报。
 *   这是历史口径，保留用于复现 legacy score；诊断请用 analyzeHotspots()。
 * @returns {{matched:[], missed:[], falsePositives:[], positionErrorsMm:[], rankingOk, pass}}
 */
function checkHotspots(v3, expected) {
  const exps = expected.expectedHotspots || [];
  const hotspots = v3.hotspots || [];
  const used = new Set();
  const matched = [];
  const falsePositives = [];
  for (const h of hotspots) {
    const pos = h.position;
    let best = null, bestD = Infinity;
    exps.forEach((e, i) => {
      if (used.has(i)) return;
      const d = e.kind === 'ring'
        ? ringMatch(pos, e)
        : Math.hypot(pos[0] - e.positionMm[0], pos[1] - e.positionMm[1], pos[2] - e.positionMm[2]);
      if (d !== null && d < bestD) { bestD = d; best = i; }
    });
    if (best !== null && bestD <= (exps[best].toleranceMm ?? 30)) {
      if (exps[best].kind !== 'ring') used.add(best);   // ring 可匹配多热点（环上多峰 = 同一结构）
      matched.push({ expectedId: exps[best].thickZoneId, v3Id: h.hotspotId, distMm: +bestD.toFixed(1), peakModulus: h.peakModulus, expectedRank: exps[best].rank, position: pos });
    } else {
      falsePositives.push({ v3Id: h.hotspotId, position: pos, peakModulus: h.peakModulus });
    }
  }
  const matchedRings = new Set();
  const missed = exps.filter((_, i) => !used.has(i) && !(exps[i].kind === 'ring' && matched.some(m => m.expectedId === exps[i].thickZoneId))).map(e => e.thickZoneId);
  // 排序：matched 按 peakModulus 降序 → expectedRank 应非降（同 rank 允许任意序）。
  // M 差 < 10% 的反序不算错（网格相位 ±10% 精度限制：t05 5.7% / t14 2.8% / t15 2.7% / t20 6.8% 翻转）
  const sortedM = matched.slice().sort((a, b) => b.peakModulus - a.peakModulus);
  const rankSeq = sortedM.map(m => m.expectedRank);
  let rankingOk = true;
  for (let i = 1; i < rankSeq.length; i++) {
    if (rankSeq[i] < rankSeq[i - 1] && sortedM[i - 1].peakModulus - sortedM[i].peakModulus > 0.10 * sortedM[i - 1].peakModulus) {
      rankingOk = false; break;
    }
  }
  return {
    matched, missed, falsePositives,
    positionErrorsMm: matched.map(m => m.distMm),
    rankingOk, rankingSeq: rankSeq,
    pass: missed.length === 0 && falsePositives.length === 0 && rankingOk,
  };
}

/* ============================================================
   层 2 · 诊断（PHASE 85 新增，85.txt 三/四/五/六/七/八/十三）
   目的：把「检测到没有」与「代表点准不准」拆成两个问题。
   不改算法、不改 legacy 判定、不删除任何旧字段（85.txt 二：不要删除旧 distance 数据）。
   ============================================================ */

/** 由一份 thickZones 条目还原几何（box 用 center+size；ring 用 axis + sizeMm=[外径,内径,高]） */
function geomFromZone(z) {
  if (!z) return null;
  const id = z.id;
  if (z.kind === 'ring' && Array.isArray(z.sizeMm) && z.centerMm) {
    return { type: 'ring', id, axis: z.axis, center: z.centerMm, innerR: z.sizeMm[1] / 2, outerR: z.sizeMm[0] / 2, halfH: z.sizeMm[2] / 2 };
  }
  if (z.kind === 'box' && Array.isArray(z.sizeMm) && z.centerMm) {
    return { type: 'box', id, center: z.centerMm, size: z.sizeMm };
  }
  return null;
}
/**
 * 归一化一份 zone 几何描述（只复用 expected.json 既有字段，不另造一套 —— 85.txt 三）
 * 解析顺序：① 条目自带 ring 参数（expectedHotspots 的 ring 写法）
 *          ② 条目自带 box 几何
 *          ③ **按 thickZoneId 回落到 thickZones** —— box 型 expected 只写
 *             `{thickZoneId, positionMm, toleranceMm, rank}`，形状在 thickZones 里。
 */
function zoneGeom(z, zoneById = null) {
  if (!z) return null;
  const id = z.thickZoneId ?? z.id;
  if (z.kind === 'ring' && z.innerR != null) {
    return { type: 'ring', id: z.thickZoneId, axis: z.axis, center: z.centerMm, innerR: z.innerR, outerR: z.outerR, halfH: z.halfH };
  }
  const own = geomFromZone({ ...z, id });
  if (own) return own;
  return zoneById?.get(id) ?? null;
}

/** 点是否落在该 zone 几何体内（严格按声明几何，**不用 tolerance 球代替 thick zone**，85.txt 四） */
function inZone(pos, g) {
  if (!pos || !g) return false;
  if (g.type === 'box') {
    return [0, 1, 2].every(i => Math.abs(pos[i] - g.center[i]) <= g.size[i] / 2);
  }
  if (g.type === 'ring') {
    // 轴向：优先用声明的 axis；缺 axis 时三条轴都试（取任一命中，避免几何判定漏判）
    const axes = Array.isArray(g.axis) ? [g.axis.findIndex(v => v === 1)] : [0, 1, 2];
    for (const ax of axes) {
      if (ax < 0) continue;
      if (Math.abs(pos[ax] - g.center[ax]) > g.halfH) continue;
      let r = 0;
      for (let i = 0; i < 3; i++) if (i !== ax) r += (pos[i] - g.center[i]) ** 2;
      r = Math.sqrt(r);
      if (r >= g.innerR && r <= g.outerR) return true;
    }
    return false;
  }
  return false;
}

/** 点到 expected 条目的距离（rering 用环带误差，box 用欧氏；与 legacy ringMatch 同源语义） */
function distToExpected(pos, e) {
  if (e.kind === 'ring') return ringMatch(pos, e) ?? Infinity;
  const c = e.positionMm || e.centerMm;
  if (!pos || !c) return Infinity;
  return Math.hypot(pos[0] - c[0], pos[1] - c[1], pos[2] - c[2]);
}

/**
 * 分类（85.txt 七）。**优先级从高到低，命中即返回，互不覆盖**：
 *
 *   1. WEAK_OR_UNEXPECTED        —— 峰点落在 optionalHotspots 声明的厚区内
 *                                   （generator 自己说"非必报"的弱次级结构；检出很好，不检出也不算漏）
 *   2. CORRECT_PEAK              —— 峰点在必检 zone 内 + 峰点距离 ≤ tol + 代表点距离 ≤ tol
 *   3. REPRESENTATIVE_DRIFT      —— 峰点在必检 zone 内 + 峰点距离 ≤ tol + 代表点距离 > tol
 *   4. CORRECT_ZONE_POSITION_OFFSET —— 峰点在必检 zone 内 + 峰点距离 > tol
 *   5. OUTSIDE_EXPECTED_ZONE     —— 峰点不属于任何声明的厚区
 *   6. UNMATCHED                 —— 模型没有可用 zone 声明，无法配对
 *   7. UNKNOWN                   —— 缺坐标，无法自动判断
 *
 * 说明：85.txt 七 对 CORRECT_PEAK 的字面定义（"峰点正确"）会被 REPRESENTATIVE_DRIFT
 *   完全包含；为满足"分类不要互相覆盖"，此处 CORRECT_PEAK 取**两点都达标**的语义。
 */
function classifyHotspot(h, expected) {
  const peak = h.peakPositionMm, rep = h.representativePositionMm;
  if (!peak || !rep) return 'UNKNOWN';
  if (h.optionalZoneId) return 'WEAK_OR_UNEXPECTED';
  if (h.expectedZoneId) {
    if (h.peakWithinTolerance && h.representativeWithinTolerance) return 'CORRECT_PEAK';
    if (h.peakWithinTolerance) return 'REPRESENTATIVE_DRIFT';
    return 'CORRECT_ZONE_POSITION_OFFSET';
  }
  const hasZones = (expected.thickZones || []).length > 0;
  return hasZones ? 'OUTSIDE_EXPECTED_ZONE' : 'UNMATCHED';
}

/**
 * 诊断层主函数（85.txt 五：三层——先 zone 归属，再同 zone 内按峰点距离配对，最后记录代表点距离）
 * @returns {{ hotspots:[...], models:{...}, counters:{...} }}
 */
function analyzeHotspots(v3, expected) {
  // 先建 thickZoneId → 几何 的索引（box 型 expected 只写 thickZoneId，形状在 thickZones 里）
  const zoneById = new Map((expected.thickZones || []).map(z => [z.id, geomFromZone(z)]).filter(([, g]) => g));
  const exps = (expected.expectedHotspots || []).map(e => ({ ...e, geom: zoneGeom(e, zoneById) })).filter(e => e.geom);
  const opts = (expected.optionalHotspots || []).map(e => ({ ...e, geom: zoneGeom(e, zoneById) })).filter(e => e.geom);
  const zones = (expected.thickZones || []).map(z => ({ id: z.id, geom: geomFromZone(z) })).filter(z => z.geom);

  const hotspots = (v3.hotspots || []).map(h => {
    // —— 峰点：引擎输出的 geometrySource 里带 "@(x,y,z)"；缺则回落代表点 ——
    const m = String(h.geometrySource || '').match(/@\(([-\d.,\s]+)\)/);
    const peakPositionMm = m ? m[1].split(',').map(Number) : h.position.slice();
    const representativePositionMm = h.position;

    // 第一层：峰点落在哪些**声明厚区**内（可能多个，全部记录，不随意选择 —— 85.txt 四）
    const zoneCandidates = zones.filter(z => inZone(peakPositionMm, z.geom)).map(z => z.id);
    // 必检 / 可选：按 expectedHotspots / optionalHotspots 的 zone 归属判定
    const expHit = exps.filter(e => inZone(peakPositionMm, e.geom));
    const optHit = opts.filter(e => inZone(peakPositionMm, e.geom));

    // 第二层 + 第三层：同 zone 内按**峰点**距离取最近，再记录**代表点**距离
    const pick = (arr) => arr.length
      ? arr.reduce((a, b) => (distToExpected(peakPositionMm, a) <= distToExpected(peakPositionMm, b) ? a : b))
      : null;
    const expBest = pick(expHit), optBest = pick(optHit);

    const peakDistanceToGTmm = expBest ? +distToExpected(peakPositionMm, expBest).toFixed(1) : null;
    const representativeDistanceToGTmm = expBest ? +distToExpected(representativePositionMm, expBest).toFixed(1) : null;
    const tol = expBest?.toleranceMm ?? 30;
    // 峰点不在任何 expected zone 时，额外记录"最近的 expected"供诊断（**不参与判定**，
    //   与 zoneMatch 严格分开：§四要求不得用 tolerance 球代替厚区）
    let nearest = null;
    if (!expBest && exps.length) {
      nearest = exps.reduce((a, b) => (distToExpected(peakPositionMm, a) <= distToExpected(peakPositionMm, b) ? a : b));
    }

    const rec = {
      hotspotId: h.hotspotId,
      // —— 旧字段全部保留（85.txt 六：不要破坏现有消费者）——
      position: h.position, peakModulus: h.peakModulus, confidence: h.confidence,
      regionVolumeMm3: h.regionVolumeMm3 ?? h.regionVolume, geometrySource: h.geometrySource,
      // —— 诊断字段 ——
      expectedZoneId: expBest?.thickZoneId ?? null,
      optionalZoneId: optBest?.thickZoneId ?? null,
      zoneMatch: !!expBest,
      zoneCandidates,
      peakPositionMm,
      representativePositionMm,
      peakDistanceToGTmm,
      representativeDistanceToGTmm,
      toleranceMm: tol,
      peakWithinTolerance: peakDistanceToGTmm != null && peakDistanceToGTmm <= tol,
      representativeWithinTolerance: representativeDistanceToGTmm != null && representativeDistanceToGTmm <= tol,
      // 仅当峰点不属于任何 expected zone 时给出（参考信息，不参与判定）
      nearestExpectedId: nearest?.thickZoneId ?? null,
      nearestExpectedPeakDistanceMm: nearest ? +distToExpected(peakPositionMm, nearest).toFixed(1) : null,
      nearestExpectedRepresentativeDistanceMm: nearest ? +distToExpected(representativePositionMm, nearest).toFixed(1) : null,
      note: expBest ? undefined : (nearest ? '峰点不在任何必检厚区内；最近 expected 仅供参考' : '无 expected 可比较'),
    };
    rec.classification = classifyHotspot(rec, expected);
    return rec;
  });

  // —— 模型级：每个必检 zone 是否被「检出」（按峰点归属），以及是否被「定位到」（按代表点归属）——
  const peakDetected = exps.filter(e => hotspots.some(h => inZone(h.peakPositionMm, e.geom)));
  const repDetected = exps.filter(e => hotspots.some(h => inZone(h.representativePositionMm, e.geom)));
  const peakAccurate = exps.filter(e => hotspots.some(h => h.expectedZoneId === e.thickZoneId && h.peakWithinTolerance));
  const repAccurate = exps.filter(e => hotspots.some(h => h.expectedZoneId === e.thickZoneId
    && h.peakWithinTolerance && h.representativeWithinTolerance));

  const byClass = {};
  for (const h of hotspots) byClass[h.classification] = (byClass[h.classification] || 0) + 1;

  return {
    hotspots,
    models: {
      requiredZones: exps.length,
      peakDetectedZones: peakDetected.length,       // 峰点落入的必检 zone 数
      repDetectedZones: repDetected.length,         // 代表点落入的必检 zone 数
      peakAccurateZones: peakAccurate.length,       // 峰点在容差内的必检 zone 数
      repAccurateZones: repAccurate.length,         // 峰点+代表点都在容差内的必检 zone 数
      // 模型级布尔：全部必检 zone 都达标
      peakDetectionPass: exps.length > 0 && peakDetected.length === exps.length,
      peakAccuracyPass: exps.length > 0 && peakAccurate.length === exps.length,
      zoneDetectionPass: exps.length > 0 && repDetected.length === exps.length,
      representativeAccuracyPass: exps.length > 0 && repAccurate.length === exps.length,
    },
    counters: byClass,
  };
}

/** 变体运行与检查 */
function runVariant(modelName, vn) {
  const file = join(MODELS_DIR, modelName, 'model.stl');
  const mesh = parseSTL(readFileSync(file).buffer.slice(0));
  const out = {};

  if (vn === 'rot90') {
    const r = runV3(rotateMesh(mesh, 'y', 90).vertices, mesh.triCount);
    out.status = r.v3.status; out.hotspotCount = r.v3.hotspots.length; out.ms = r.ms;
    out.rotatedPositions = r.v3.hotspots.map(h => invRotY90(h.position));
  } else {
    const s = vn === 'scale10' ? 10 : 0.1;
    const sm = scaleMesh(mesh, s);
    const r = runV3(sm.vertices, mesh.triCount);
    out.status = r.v3.status; out.hotspotCount = r.v3.hotspots.length; out.ms = r.ms;
    out.peakModulus = r.v3.hotspots.map(h => +h.peakModulus.toFixed(2));
    out.expectedRatio = s;
  }
  return out;
}

/** 主流程 */
const names = readdirSync(MODELS_DIR).filter(d => readdirSync(join(MODELS_DIR, d)).includes('model.stl')).sort();
const summary = [];
const detailRows = [];   // 控制台明细（不进 summary.json）
console.log(`运行 ${names.length} 个工程模型 + 变体...\n`);

for (const name of names) {
  const dir = join(MODELS_DIR, name);
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
  // expectedHotspotCount 保持 **legacy 口径**（冻结集大小）—— 否则 t19 从 4 变 2，
  //   legacy 那一行的显示就与 PHASE 84 对不上了（85.txt 十五：legacy 9/20 必须可复现）
  const legacyExps = legacyExpected(expected);
  const result = {
    name, category: expected.category,
    expectedHotspotCount: legacyExps.length,
    requiredHotspotCount: (expected.expectedHotspots || []).length,          // 新体系：必检
    optionalHotspotCount: (expected.optionalHotspots || []).length,          // 新体系：可选
  };

  // 主运行
  const mesh = parseSTL(readFileSync(join(dir, 'model.stl')));
  const { v3, ms } = runV3(mesh.vertices, mesh.triCount);
  result.v3 = {
    status: v3.status, reason: v3.reason, elapsedMs: ms, triCount: mesh.triCount,
    hotspots: v3.hotspots.map(h => ({ hotspotId: h.hotspotId, position: h.position.map(v => +v.toFixed(1)), peakModulus: +h.peakModulus.toFixed(2), confidence: +h.confidence.toFixed(2), regionVolumeMm3: Math.round(h.regionVolume), geometrySource: h.geometrySource })),
    coarse: v3.debug?.coarse && { vs: v3.debug.coarse.vs, estMinWall: v3.debug.coarse.estMinWall, pts: v3.debug.coarse.pts, maxM: +v3.debug.coarse.maxM?.toFixed(2), peaks: v3.debug.coarse.peaks },
    audit: v3.audit,
  };
  // 层 1：legacy —— 用**冻结的**判定集，保证 9/20 可复现（85.txt 九/十五）
  result.checks = checkHotspots(v3, { ...expected, expectedHotspots: legacyExpected(expected) });
  // 层 2：诊断 —— 用修正后的必检 + 可选集（85.txt 二~八）
  result.diagnostics = analyzeHotspots(v3, expected);

  // 变体
  const variants = {};
  for (const vn of VARIANTS[name] || []) {
    try { variants[vn] = runVariant(name, vn); } catch (e) { variants[vn] = { error: e.message }; }
  }
  if (DENSITY_MODELS.includes(name)) {
    for (const r of [90, 120]) {
      try {
        const m2 = parseSTL(readFileSync(join(dir, `model_r${r}.stl`)));
        const r2 = runV3(m2.vertices, m2.triCount);
        variants[`density_r${r}`] = { status: r2.v3.status, hotspotCount: r2.v3.hotspots.length, triCount: m2.triCount, ms: r2.ms, peakModulus: r2.v3.hotspots.map(h => +h.peakModulus.toFixed(2)) };
      } catch (e) { variants[`density_r${r}`] = { error: e.message }; }
    }
  }
  result.variants = variants;

  writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2));

  // 汇总行
  const c = result.checks;
  const d = result.diagnostics;
  const varLine = Object.entries(variants).map(([k, v]) => `${k}:${v.hotspotCount ?? v.error ?? '?'}`).join(' ');
  console.log(
    `${name.padEnd(22)} V3[${v3.status}] H${v3.hotspots.length}/${result.expectedHotspotCount} ` +
    `检出${c.matched.length} 漏${c.missed.length ? c.missed.join(',') : 0} 误报${c.falsePositives.length} ` +
    `Δmax=${c.positionErrorsMm.length ? Math.max(...c.positionErrorsMm) : '-'}mm 排序${c.rankingOk ? '✓' : '✗'} ${ms}ms${varLine ? ' | ' + varLine : ''}`
  );
  // 诊断行（PHASE 85）：检测层 / 定位层分开显示
  const cc = d.counters;
  const cls = Object.entries(cc).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(
    `${' '.repeat(22)} └ 诊断 必检${d.models.requiredZones} 峰检出${d.models.peakDetectedZones} 代表检出${d.models.repDetectedZones} ` +
    `峰达标${d.models.peakAccurateZones} 代表达标${d.models.repAccurateZones}  ${cls}`
  );
  // 明细行留给控制台打印用（不进 summary.json，避免文件膨胀）
  detailRows.push({ name, hotspots: d.hotspots, legacyPass: c.pass });
  summary.push({
    // —— 旧字段（保持兼容，85.txt 六）——
    name, category: expected.category, status: v3.status, found: v3.hotspots.length,
    expected: result.expectedHotspotCount, pass: c.pass, missed: c.missed,
    fp: c.falsePositives.length,
    maxPosErr: c.positionErrorsMm.length ? Math.max(...c.positionErrorsMm) : null,
    rankingOk: c.rankingOk, ms, variants,
    // —— 诊断字段（PHASE 85 新增，与旧字段并存不替代）——
    diag: {
      requiredZones: d.models.requiredZones,
      peakDetectedZones: d.models.peakDetectedZones,
      repDetectedZones: d.models.repDetectedZones,
      peakAccurateZones: d.models.peakAccurateZones,
      repAccurateZones: d.models.repAccurateZones,
      peakDetectionPass: d.models.peakDetectionPass,
      peakAccuracyPass: d.models.peakAccuracyPass,
      zoneDetectionPass: d.models.zoneDetectionPass,
      representativeAccuracyPass: d.models.representativeAccuracyPass,
      counters: cc,
      peakWithinTol: d.hotspots.filter(h => h.peakWithinTolerance).length,
      repWithinTol: d.hotspots.filter(h => h.representativeWithinTolerance).length,
      hotspotCount: d.hotspots.length,
    },
  });
}

writeFileSync(join(HERE, 'summary.json'), JSON.stringify(summary, null, 2));

const N = summary.length;
const sum = (f) => summary.reduce((a, s) => a + f(s), 0);

console.log('\n════════ 汇总（PHASE 85：legacy 与诊断分开看）════════\n');

// ── 层 1：legacy（历史口径，**故意不因新体系变好看**）──
console.log('【Legacy score】—— 旧判定体系（到 GT 中心距离 ≤ tolerance），历史指标');
console.log(`  Legacy score: ${summary.filter(s => s.pass).length} / ${N}`);
console.log('  （它把"位置超差"同时记成 1 漏检 + 1 误报；新体系不改它，也不拿它当唯一结论）\n');
for (const s of summary) {
  const flag = s.pass ? '✅' : '❌';
  console.log(`  ${flag} ${s.name.padEnd(22)} ${s.category} H${s.found}/${s.expected} 漏[${s.missed}] 误报${s.fp} Δmax=${s.maxPosErr ?? '-'} 排序${s.rankingOk ? '✓' : '✗'}`);
}

// ── 层 2：诊断（85.txt 八）──
const hot = sum(s => s.diag.hotspotCount);
console.log('\n【诊断指标】—— 拆开"检测"与"位置精度"（分母已标明）');
console.log(`  Peak detection          （模型级，必检热点全部被峰点落进厚区）: ${summary.filter(s => s.diag.peakDetectionPass).length} / ${N}`);
console.log(`  Peak accuracy           （模型级，必检热点的峰点全部落在容差内）: ${summary.filter(s => s.diag.peakAccuracyPass).length} / ${N}`);
console.log(`  Zone detection          （模型级，必检热点全部被代表点落进厚区）: ${summary.filter(s => s.diag.zoneDetectionPass).length} / ${N}`);
console.log(`  Representative accuracy （模型级，峰点+代表点全部落在容差内）: ${summary.filter(s => s.diag.representativeAccuracyPass).length} / ${N}`);
console.log(`  Peak within tolerance   （热点级）: ${sum(s => s.diag.peakWithinTol)} / ${hot}`);
console.log(`  Representative within tolerance（热点级）: ${sum(s => s.diag.repWithinTol)} / ${hot}`);
const tot = (k) => sum(s => s.diag.counters[k] || 0);
console.log('');
console.log(`  Unexpected / outside-zone : ${tot('OUTSIDE_EXPECTED_ZONE')}`);
console.log(`  In-zone-but-offset        : ${tot('CORRECT_ZONE_POSITION_OFFSET')}`);
console.log(`  Representative-drift      : ${tot('REPRESENTATIVE_DRIFT')}`);
console.log(`  Peak-level failures       : ${tot('CORRECT_ZONE_POSITION_OFFSET') + tot('OUTSIDE_EXPECTED_ZONE')}  (in-zone-but-offset + outside-zone)`);
console.log(`  Correct (peak+rep 都达标)  : ${tot('CORRECT_PEAK')}`);
console.log(`  Weak / optional-zone hit  : ${tot('WEAK_OR_UNEXPECTED')}`);
console.log(`  Unmatched / Unknown       : ${tot('UNMATCHED')} / ${tot('UNKNOWN')}`);

console.log('\n【分类明细】每个热点一条（CONFIRMED = 需人工关注）');
for (const s of detailRows) {
  for (const h of s.hotspots) {
    const note = h.classification === 'REPRESENTATIVE_DRIFT' || h.classification === 'CORRECT_ZONE_POSITION_OFFSET'
      || h.classification === 'OUTSIDE_EXPECTED_ZONE';
    console.log(`  ${note ? '•' : ' '} ${s.name.padEnd(22)} H${h.hotspotId}  ${h.classification.padEnd(28)} ` +
      `zone=${h.expectedZoneId ?? h.optionalZoneId ?? '—'}  峰→GT ${h.peakDistanceToGTmm ?? '—'} 代表→GT ${h.representativeDistanceToGTmm ?? '—'} (tol ${h.toleranceMm})`);
  }
}
console.log('\n→ result.json 已写入各模型目录；汇总见 summary.json');
