// ============================================================
// Hotspot V2.1 Self Validation · 公共工具
// runAnalyze（统一计时/调用）/ 统一记录格式 / 分级 / 分类 / raw 累积
// ============================================================
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { RAW_DIR, gradePosition, CLASS } from './validationConfig.mjs';

/** 统一分析入口：buildMesh + analyzeHotspots + 计时（hotspots 排序保持引擎顺序 H1..Hn） */
export function runAnalyze(mesh, opts = {}) {
  const t0 = Date.now();
  const { geometry } = buildMesh(mesh);   // buildMesh 返回 {geometry, bvh, bounds}，引擎需要 geometry
  const buildMs = Date.now() - t0;
  const t1 = Date.now();
  const r = analyzeHotspots(mesh, geometry, opts);
  return { ...r, _buildMs: buildMs, _analyzeMs: Date.now() - t1, _totalMs: Date.now() - t0 };
}

/** 定位误差（欧氏；跳过 x 为 null 的对称轴，返回 null 表示该轴不检查） */
export function positionError(det, exp) {
  if (!det) return null;
  let d2 = 0, checked = 0;
  for (const a of ['x', 'y', 'z']) {
    if (exp[a] === null || exp[a] === undefined) continue;
    d2 += (det[a] - exp[a]) ** 2;
    checked++;
  }
  return checked ? Math.sqrt(d2) : null;
}

/** 径向约束检查（环形热结：代表点落在 [r0, r1] 圆环壁内） */
export function radialOk(det, exp, axis = 'y') {
  if (!det || !exp.radialRange) return null;
  const [r0, r1] = exp.radialRange;
  const other = axis === 'y' ? ['x', 'z'] : axis === 'x' ? ['y', 'z'] : ['x', 'y'];
  const r = Math.hypot(det[other[0]], det[other[1]]);
  return { r, ok: r >= r0 && r <= r1, range: [r0, r1] };
}

/**
 * 统一记录（用户第十六节字段全集；coarse/refine error 引擎不暴露中间坐标 → null，
 * 用分辨率对照实验（resolution sweep）推断粗扫贡献）
 */
export function makeRecord(model, parameters, expected, r, extra = {}) {
  const det = r.hotspots?.[0] || null;
  const posErr = positionError(det, expected?.expectedHotspots?.[0] || {});
  const eH = expected?.expectedHotspots?.[0];
  const thickErr = det && eH ? Math.abs(det.localThickness - eH.thickness) : null;
  const thickErrPct = det && eH && eH.thickness ? thickErr / eH.thickness : null;
  const mcErr = det && eH?.mc ? Math.abs(det.mc - eH.mc) : null;
  const mcErrPct = det && eH?.mc ? mcErr / eH.mc : null;
  return {
    model, parameters,
    expected: { uniform: expected?.expectedUniform, hotspots: expected?.expectedHotspots },
    detected: {
      status: r.status, reason: r.reason || null,
      hotspots: (r.hotspots || []).map(h => ({
        id: h.id, x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2),
        mc: h.mc, localThickness: h.localThickness, confidence: h.confidence,
        resolutionScore: h.resolutionScore, prominenceScore: h.prominenceScore, validationScore: h.validationScore,
        regionVolumeCm3: h.regionVolumeCm3,
      })),
    },
    status: r.status,
    positionError: posErr === null ? null : +posErr.toFixed(3),
    positionGrade: posErr === null ? null : gradePosition(posErr),
    thicknessError: thickErr === null ? null : +thickErr.toFixed(3),
    thicknessErrorPct: thickErrPct === null ? null : +thickErrPct.toFixed(4),
    mcError: mcErr === null ? null : +mcErr.toFixed(3),
    mcErrorPct: mcErrPct === null ? null : +mcErrPct.toFixed(4),
    confidence: det?.confidence ?? null,
    resolutionScore: det?.resolutionScore ?? null,
    prominenceScore: det?.prominenceScore ?? null,
    validationScore: det?.validationScore ?? null,
    coarseError: null,   // 引擎 audit 无中间坐标（见头部注释）
    refineError: null,
    finalError: posErr === null ? null : +posErr.toFixed(3),
    runtime: r._totalMs,
    triCount: extra.triCount ?? null,
    debug: { gs: r.debug?.gs, vs: r.debug?.vs, insidePoints: r.debug?.insidePoints, candidates: r.debug?.candidates, regions: r.debug?.regions, peaks: r.debug?.peaks },
    radial: null,
    audit: (r.audit || []).map(a => ({
      candidateId: a.candidateId, coarsePeak: a.coarsePeak, peak: a.peak,
      coarseRes: a.coarseRes, refineRes: a.refineRes, valley: a.valley, valleyDepth: a.valleyDepth,
      merged: a.merged || null, split: a.split || null, rejected: a.rejected || null,
    })),
    classification: null,   // 由语义判定器填写
    note: null,
    ...extra,
  };
}

/** 语义判定（主实验）：分类 + note */
export function classifyRecord(rec, expected, cfg = {}) {
  const e = expected;
  const det = rec.detected.hotspots[0] || null;
  const want = e.expectedHotspots.length;                 // 期望热结数
  const got = rec.detected.hotspots.length;
  const okState = (rec.status === 'ok' && want > 0) || (rec.status !== 'ok' && want === 0);

  // 均匀件
  if (e.expectedUniform) {
    if (rec.status === 'NO_HOTSPOT') return { classification: CLASS.PASS, note: '均匀件 → NO_HOTSPOT ✓' };
    if (rec.status === 'ok' || rec.status === 'LOW_CONFIDENCE') {
      return { classification: CLASS.TEST_ARTIFACT, note: `均匀件报热结（${rec.status}，conf=${det?.confidence}）——MC 圆角伪影待实验量化（圆角扫描）` };
    }
    return { classification: CLASS.WARNING, note: `均匀件状态 ${rec.status}（${rec.reason}）` };
  }
  // 非均匀件：语义核对
  if (rec.status !== 'ok') {
    // GT 明确声明"预期无热结"（如渐变厚度无局部极大）→ NO_HOTSPOT 是符合预期的语义观察
    if (want === 0 && e.notes?.includes('预期无') || (want === 0 && e.notes?.includes('无局部极大'))) {
      return { classification: CLASS.EXPECTED, note: `${rec.status}（${rec.reason}）——GT 预期无局部极大，符合语义` };
    }
    if (rec.status === 'INSUFFICIENT_RESOLUTION' || rec.status === 'NO_HOTSPOT') {
      return { classification: CLASS.FAIL, note: `有厚区但 ${rec.status}（${rec.reason}）——漏检` };
    }
    return { classification: CLASS.WARNING, note: `有厚区但 LOW_CONFIDENCE（${rec.reason}）——候选存在但未达标` };
  }
  // OK 且 GT 预期无热结（渐变模型被检出）→ FAIL（意外检出）
  if (want === 0) {
    return { classification: CLASS.FAIL, note: `GT 预期无热结，但 OK 检出 ${got} 个` };
  }
  // OK：数量核对
  if (got !== want) {
    const subset = got > 0 && got < want ? `检出 ${got}/${want} 个` : `数量 ${got} vs 期望 ${want}`;
    if (e.notes?.includes('可能不报')) return { classification: CLASS.WARNING, note: `OK 但 ${subset}（弱热结被拒，GT 已提示可能）` };
    return { classification: CLASS.FAIL, note: `OK 但 ${subset}` };
  }
  return { classification: CLASS.PASS, note: `${want} 热结 ✓` };
}

/** raw JSON 累积（每次实验一个文件，不覆盖，保留原始数据） */
export function appendRaw(expName, records, meta = {}) {
  mkdirSync(RAW_DIR, { recursive: true });
  const file = join(RAW_DIR, `${expName}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { experiment: expName, meta: {}, records: [] };
  prev.meta = { ...prev.meta, ...meta, updatedAt: new Date().toISOString() };
  prev.records.push(...records);
  writeFileSync(file, JSON.stringify(prev, null, 1));
  return file;
}

/** 实验级 CSV 行（从统一记录提取常用列） */
export function csvRows(records) {
  const head = ['model', 'parameters', 'status', 'reason', 'positionError', 'positionGrade',
    'thicknessErrorPct', 'mcErrorPct', 'confidence', 'resolutionScore', 'prominenceScore',
    'validationScore', 'runtime', 'classification', 'note'];
  const lines = [head.join(',')];
  for (const r of records) {
    lines.push([r.model, JSON.stringify(r.parameters), r.status, r.reason || '',
      r.positionError ?? '', r.positionGrade ?? '',
      r.thicknessErrorPct === null ? '' : (r.thicknessErrorPct * 100).toFixed(1),
      r.mcErrorPct === null ? '' : (r.mcErrorPct * 100).toFixed(1),
      r.confidence ?? '', r.resolutionScore ?? '', r.prominenceScore ?? '', r.validationScore ?? '',
      r.runtime, r.classification ?? '', r.note ?? '',
    ].join(','));
  }
  return lines.join('\n');
}
