// ============================================================
// PHASE V2.0-05F · 6 geometries × 3 combined resolution levels（108.txt §十二~§十七）
//
// 前置：05E = QUALIFIED_FOR_05F（thickEnd 主 Mc 单调收敛、Δ 逐半、位置漂移收敛）
//
// 6 几何：
//   1 bossOnPlate   2 thinShell   3 thickEnd   4 pvpPair
//   5 t19_valveLike（20 模型套件）  6 HR4012（真实件）
// 每几何 3 档 = 18 runs。riser 仍 球铁/cyl/hd=1/cast_wt=0（只验证 modulus path）。
//
// 用法：node tests/experiments/phasev2005f_probe.mjs
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { LEVELS, ROOT, loadGeometry, runLevel, summarizeRuns, classify, toCsv } from './mcConvCommon.mjs';

const OUT_DIR = join(ROOT, 'tests', 'experiments', 'out');
const RISER = { mat: '球铁', shape: 'cyl', hdRatio: 1.0, castWt: 0 };

const GEOMS = [
  { name: 'bossOnPlate', spec: { kind: 'bossOnPlate' } },
  { name: 'thinShell', spec: { kind: 'thinShell' } },
  { name: 'thickEnd', spec: { kind: 'thickEnd' } },
  { name: 'pvpPair', spec: { kind: 'pvpPair', params: { tA: 30, tB: 30, v: 15 } } },
  { name: 't19_valveLike', spec: { stlPath: join(ROOT, 'tests', 'engineering-generated', 'models', 't19_valveLike', 'model.stl') } },
  { name: 'HR4012', spec: { stlPath: join(ROOT, 'tests', 'real-stl', 'HR4012塑料模具v4最早大板.stl') } },
];

console.log('='.repeat(112));
console.log('PHASE V2.0-05F · 6 geometries × 3 combined resolution levels = 18 runs');
console.log('  L1 = gs 64 / R 8000     L2 = gs 96 / R 32000     L3 = gs 128 / R 128000');
console.log('  riser: 球铁 / cyl / hd=1 / cast_wt=0');
console.log('='.repeat(112));

const all = [];
for (const g of GEOMS) {
  const t0 = Date.now();
  const { mesh, gt, triCount, source } = loadGeometry(g.spec);
  const geometry = buildMesh(mesh).geometry;      // 每几何只建一次
  console.log(`\n【${g.name}】 triCount=${triCount}  source=${source.startsWith('generator') ? source : 'file'}${gt ? `  GT.expectMc=${gt.expectedHotspots[0]?.mc}` : ''}`);

  const runs = [];
  for (const L of LEVELS) {
    const r = runLevel(mesh, L, RISER, geometry);
    runs.push(r);
    const mr = r.mainRegion;
    console.log(`  ${L.name} gs=${String(r.coarse.actualGs).padStart(3)} R=${String(L.refineMaxPoints).padStart(6)} | vs=${String(r.coarse.vs).padStart(9)} 主区spacing=${String(mr?.spacing).padStart(9)} stride=${mr?.stride} | ${String(r.status).padEnd(5)} hot=${r.hotspotCount} Mc=${r.mainHotspot ? r.mainHotspot.mc.toFixed(4) : '—'} | D=${r.riser?.D} H=${r.riser?.H} Vr=${r.riser?.Vr} | ${r.analyzeMs}ms`);
  }
  const sum = summarizeRuns(runs, RISER);
  const cls = classify(sum);
  console.log(`  → ΔMc ${sum.dMc12pct}% / ${sum.dMc23pct}%  span ${sum.mcSpanPct}%  位置漂移 ${sum.mainPositionDrift12mm}/${sum.mainPositionDrift23mm}mm  D=${sum.D.join('/')}  ΔVr ${sum.dVr12pct}%/${sum.dVr23pct}%`);
  console.log(`  → 分类: ${cls}   （总 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  all.push({ geometry: g.name, triCount, gtExpectMc: gt?.expectedHotspots?.[0]?.mc ?? null, runs, summary: sum, classification: cls });
}

/* ---------- 汇总表 ---------- */
console.log('\n' + '='.repeat(112));
console.log('§十三 汇总（每几何 Mc 三档 / ΔMc / span / 工程输出）');
console.log('geometry          Mc L1      Mc L2      Mc L3      ΔMc12%   ΔMc23%   span%    D1/D2/D3     ΔVr12%   ΔVr23%   分类');
for (const a of all) {
  const s = a.summary;
  console.log(
    a.geometry.padEnd(17) + ' ' +
    (s.mc[0] != null ? s.mc[0].toFixed(4) : '—').padEnd(10) + ' ' +
    (s.mc[1] != null ? s.mc[1].toFixed(4) : '—').padEnd(10) + ' ' +
    (s.mc[2] != null ? s.mc[2].toFixed(4) : '—').padEnd(10) + ' ' +
    String(s.dMc12pct ?? '—').padStart(7) + ' ' + String(s.dMc23pct ?? '—').padStart(8) + ' ' +
    String(s.mcSpanPct ?? '—').padStart(7) + '  ' +
    s.D.map(v => String(v ?? '—')).join('/').padEnd(13) + ' ' +
    String(s.dVr12pct ?? '—').padStart(7) + ' ' + String(s.dVr23pct ?? '—').padStart(8) + '  ' + a.classification);
}

console.log('\n§十三 稳定性指标');
console.log('geometry          hotspot数  主区位置漂移(mm)   主区spacing(L1→L3)        field vs(L1→L3)');
for (const a of all) {
  const s = a.summary;
  console.log(
    a.geometry.padEnd(17) + ' ' + s.hotspotCounts.join('/').padEnd(11) + ' ' +
    `${String(s.mainPositionDrift12mm ?? '—').padStart(7)}/${String(s.mainPositionDrift23mm ?? '—').padStart(7)}   ` +
    s.mainRegionSpacings.map(v => String(v)).join('→').padEnd(24) + '  ' +
    s.mFieldSpacings.map(v => String(v)).join('→'));
}

/* ---------- §十七 HR4012 专项 ---------- */
const hr = all.find(a => a.geometry === 'HR4012');
if (hr) {
  console.log('\n' + '='.repeat(112));
  console.log('§十七 HR4012 专项（真实工程件）');
  console.log('Level  Mc          position                          D    H    Vr         Mr_act    conf     regionVol');
  hr.runs.forEach(r => {
    console.log(
      r.level.padEnd(6) + ' ' + (r.mainHotspot ? r.mainHotspot.mc.toFixed(5) : '—').padEnd(11) + ' ' +
      (r.mainHotspot ? '[' + r.mainHotspot.position.join(', ') + ']' : '—').padEnd(33) + ' ' +
      String(r.riser?.D).padStart(4) + ' ' + String(r.riser?.H).padStart(4) + ' ' +
      String(r.riser?.Vr).padStart(9) + ' ' + String(r.riser?.Mr_act).padStart(8) + ' ' +
      String(r.mainHotspot?.confidence).padStart(7) + ' ' + String(r.mainHotspot?.regionVolumeMm3).padStart(9));
  });
  console.log(`  ΔMc12=${hr.summary.dMc12pct}%  ΔMc23=${hr.summary.dMc23pct}%  span=${hr.summary.mcSpanPct}%`);
  console.log(`  ΔD12=${hr.summary.dD12}mm  ΔD23=${hr.summary.dD23}mm  ΔH12=${hr.summary.dH12}mm  ΔH23=${hr.summary.dH23}mm`);
  console.log(`  ΔVr12=${hr.summary.dVr12pct}%  ΔVr23=${hr.summary.dVr23pct}%`);
  console.log(`  hotspot 数=${hr.summary.hotspotCounts.join('/')}  分类=${hr.classification}`);
}

/* ---------- 输出 ---------- */
mkdirSync(OUT_DIR, { recursive: true });
const jsonFile = join(OUT_DIR, 'phasev2005ef_mc_convergence.json');
writeFileSync(jsonFile, JSON.stringify({
  phase: 'V2.0-05E+05F', baseline: 'main @ da1c822',
  levels: LEVELS, riserConfig: RISER,
  note: 'gtExpectMc 仅参考：108.txt §九 禁止用作 accuracy 判定',
  geometries: all,
}, null, 2));

const csvRows = [];
for (const a of all) {
  for (const r of a.runs) {
    csvRows.push({
      geometry: a.geometry, level: r.level,
      experimentalGs: r.experimentalGs, refineMaxPoints: r.refineMaxPoints,
      coarseGs: r.coarse.actualGs, mFieldSpacing: r.mFieldSpacing,
      refineRegionCount: r.refine.regionCount,
      mainRefGs: r.mainRegion?.refGs, mainStride: r.mainRegion?.stride, mainRegionSpacing: r.mainRegion?.spacing,
      hotspotCount: r.hotspotCount, mc: r.mainHotspot?.mc,
      x: r.mainHotspot?.position[0], y: r.mainHotspot?.position[1], z: r.mainHotspot?.position[2],
      confidence: r.mainHotspot?.confidence, regionVolumeMm3: r.mainHotspot?.regionVolumeMm3,
      Mr_need: r.riser?.Mr_need, D: r.riser?.D, H: r.riser?.H, Vr: r.riser?.Vr, Mr_act: r.riser?.Mr_act, modOk: r.riser?.modOk,
      dMc12pct: a.summary.dMc12pct, dMc23pct: a.summary.dMc23pct, mcSpanPct: a.summary.mcSpanPct,
      classification: a.classification,
    });
  }
}
writeFileSync(join(OUT_DIR, 'phasev2005ef_mc_convergence.csv'), toCsv(csvRows, Object.keys(csvRows[0])));
console.log(`\n→ ${jsonFile}`);
