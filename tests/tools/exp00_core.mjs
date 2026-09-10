// ============================================================
// Exp 00 · 核心三测（命令文件 7.txt 第三节 A/B/C）
//   22 模型 × {Semantic / Localization / Modulus}
//   + 分辨率对照子实验（coarse 分辨率对定位误差的贡献——引擎不暴露中间坐标的替代方案）
// 输出：tests/golden/analytical/raw/exp00_core.json
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { runAnalyze, makeRecord, classifyRecord, appendRaw, csvRows } from './validationCommon.mjs';
import { gradePosition } from './validationConfig.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

const MODELS = [
  ['uniformCube', {}],
  ['uniformCylinder', {}],
  ['uniformPlate', {}],
  ['uniformTube', {}],
  ['thinShell', {}],
  ['bossOnPlate', {}],
  ['eccentricBoss', { ox: 80, oy: 40 }],
  ['multipleBosses', { n: 4 }],
  ['steppedThickness', {}],
  ['lShape', {}],
  ['tShape', {}],
  ['flange', {}],
  ['hollowThickRing', {}],
  ['centralBoss', {}],
  ['offsetBoss', { ox: -90, oy: 50 }],
  ['twoAdjacentBosses', { tA: 30, tB: 30, v: 15 }],   // depth 0.5 → SPLIT
  ['threeBosses', {}],
  ['ribBoss', {}],
  ['thickCorner', {}],
  ['thickEnd', {}],
  ['gradualTaper', {}],
  ['suddenTransition', {}],
  // PVP 合并变体（谷深 (15−14)/15=0.067 < 0.15 → MERGE）
  ['pvpPair', { tA: 30, tB: 30, v: 28 }],
];

function runOne(kind, params) {
  const { mesh, gt, triCount } = generate(kind, params);
  const r = runAnalyze(mesh);
  const rec = makeRecord(kind, params, gt, r, { triCount });
  // 径向约束补充
  const eH = gt.expectedHotspots[0];
  if (eH?.radialRange) {
    const rad = rec.detected.hotspots[0]
      ? { r: Math.hypot(rec.detected.hotspots[0].x, rec.detected.hotspots[0].z),
          ok: Math.hypot(rec.detected.hotspots[0].x, rec.detected.hotspots[0].z) >= eH.radialRange[0]
            && Math.hypot(rec.detected.hotspots[0].x, rec.detected.hotspots[0].z) <= eH.radialRange[1] }
      : null;
    rec.radial = rad;
    rec.note = rec.note ? rec.note + `；径向 r=${rad?.r.toFixed(1)} ${rad?.ok ? '✓' : '✗'}` : null;
  }
  const cl = classifyRecord(rec, gt);
  rec.classification = cl.classification;
  rec.note = [cl.note, rec.note].filter(Boolean).join('；') || null;
  return rec;
}

/** 分辨率对照：同一模型在 resolution 48/64/96 下定位误差（粗扫贡献） */
function resolutionSweep(kind, params) {
  const { mesh, gt, triCount } = generate(kind, params);
  const out = [];
  for (const res of [48, 64, 96]) {
    const r = runAnalyze(mesh, { resolution: res });
    const rec = makeRecord(`${kind}@res${res}`, { ...params, resolution: res }, gt, r, { triCount });
    rec.classification = null;
    out.push(rec);
  }
  return out;
}

const ALL = [];
const start = Date.now();
for (const [kind, params] of MODELS) {
  const t0 = Date.now();
  const rec = runOne(kind, params);
  ALL.push(rec);
  const bar = rec.classification === 'PASS' ? '✓' : rec.classification === 'FAIL' ? '✗' : '?';
  console.log(`${bar} ${kind.padEnd(20)} ${rec.status.padEnd(22)} err=${rec.positionError ?? '—'}mm ${rec.classification} (${Date.now() - t0}ms)${rec.note ? ' — ' + rec.note : ''}`);
}

// 分辨率对照（选 4 个代表性模型）
console.log('\n== resolution sweep ==');
for (const [kind, params] of [['bossOnPlate', {}], ['lShape', {}], ['thickEnd', {}], ['pvpPair', { tA: 30, tB: 30, v: 15 }]]) {
  const sweep = resolutionSweep(kind, params);
  for (const r of sweep) {
    console.log(`  ${r.model.padEnd(18)} err=${String(r.positionError ?? '—').padStart(6)}mm  vs=${r.debug.vs.toFixed(2)}  status=${r.status}`);
    ALL.push(r);
  }
}

appendRaw('exp00_core', ALL, { total: ALL.length, models: MODELS.length, elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });
writeFileSync(join(RAW_DIR, 'exp00_core.csv'), csvRows(ALL));
console.log(`\n完成：${ALL.length} 条记录 → tests/golden/analytical/raw/exp00_core.{json,csv} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
