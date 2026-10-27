// ============================================================
// PHASE V2.0-05E · thickEnd × 3 个 combined resolution levels（108.txt §五~§十一）
//
// 唯一变量 = (experimentalGs, refineMaxPoints) 组合档位
// riser：球铁 / 圆柱 / hd=1 / cast_wt=0 / direct —— 完全隔离 modulus path
//
// 用法：node tests/experiments/phasev2005e_probe.mjs
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LEVELS, ROOT, loadGeometry, runLevel, summarizeRuns, classify, toCsv } from './mcConvCommon.mjs';

const OUT_DIR = join(ROOT, 'tests', 'experiments', 'out');
const RISER = { mat: '球铁', shape: 'cyl', hdRatio: 1.0, castWt: 0 };

console.log('='.repeat(104));
console.log('PHASE V2.0-05E · thickEnd × 3 combined resolution levels');
console.log('  L1 = gs 64  / R 8000     L2 = gs 96 / R 32000     L3 = gs 128 / R 128000');
console.log('  riser: 球铁 / cyl / hd=1 / cast_wt=0  （隔离 modulus path，volume path 不参与）');
console.log('='.repeat(104));

const { mesh, gt, triCount } = loadGeometry({ kind: 'thickEnd' });
console.log(`夹具 thickEnd  triCount=${triCount}  GT.expectMc=${gt.expectedHotspots[0].mc}（★仅参考，本实验不做 accuracy 判定）\n`);

const runs = [];
for (const L of LEVELS) {
  const r = runLevel(mesh, L, RISER);
  runs.push(r);
  console.log(`【${L.name}】 experimentalGs=${L.experimentalGs}(actual ${r.coarse.actualGs}, honored=${r.coarse.gsHonored})  refineMaxPoints=${L.refineMaxPoints}`);
  console.log(`  Coarse : vs=${r.coarse.vs}  stride=${r.coarse.stride}  spacing=${r.coarse.spacing}  pts=${r.coarse.pointCount}  maxM=${r.coarse.maxM}  peaks=${r.coarse.peaks}`);
  console.log(`  Refine : ${r.refine.regionCount} 区  stride分布 s1=${r.refine.strideDist.s1} s2=${r.refine.strideDist.s2} s3=${r.refine.strideDist.s3}  总点=${r.refine.totalPoints}`);
  console.log(`           spacing min=${r.refine.minSpacing} median=${r.refine.medianSpacing} max=${r.refine.maxSpacing}`);
  console.log(`  ★主区  : idx=${r.mainRegion?.idx} refGs=${r.mainRegion?.refGs} stride=${r.mainRegion?.stride} spacing=${r.mainRegion?.spacing}  (距代表点 ${r.mainRegion?.dPeak}mm, |ΔM|=${r.mainRegion?.dM})`);
  console.log(`  Hotspot: ${r.status}  count=${r.hotspotCount}  mainMc=${r.mainHotspot?.mc}  mainPos=[${r.mainHotspot?.position.join(', ')}]`);
  console.log(`           conf=${r.mainHotspot?.confidence}  regionVol=${r.mainHotspot?.regionVolumeMm3}`);
  console.log(`  Riser  : Mc=${r.riserInputMc} → Mr_need=${r.riser?.Mr_need} D=${r.riser?.D} H=${r.riser?.H} Vr=${r.riser?.Vr} Mr_act=${r.riser?.Mr_act} modOk=${r.riser?.modOk}`);
  console.log(`  ${r.analyzeMs} ms\n`);
}

const sum = summarizeRuns(runs, RISER);

console.log('─'.repeat(104));
console.log('§八 核心判据');
console.log(`  1. field resolution 逐步提高？      mFieldSpacing(vs) = ${sum.mFieldSpacings.join(' → ')}  ${sum.mFieldSpacings.every((v, i) => i === 0 || v < sum.mFieldSpacings[i - 1]) ? '✓ 严格下降' : '✗'}`);
console.log(`  2. sampling 同步不粗化？            主区 spacing = ${sum.mainRegionSpacings.join(' → ')}  ${sum.mainRegionSpacings.every((v, i) => i === 0 || (v != null && v <= sum.mainRegionSpacings[i - 1])) ? '✓ 不增' : '✗'}`);
console.log(`  3. Mc 是否逐渐稳定？                Mc = ${sum.mc.join(' → ')}`);
console.log(`       ΔMc L1→L2 = ${sum.dMc12} (${sum.dMc12pct}%)    ΔMc L2→L3 = ${sum.dMc23} (${sum.dMc23pct}%)    total span = ${sum.mcSpanPct}%`);
console.log(`  4. hotspot 主区可追踪？             ${sum.mainRegionTrackable}  count=${sum.hotspotCounts.join('/')}  主区位置漂移 L1→L2 ${sum.mainPositionDrift12mm}mm, L2→L3 ${sum.mainPositionDrift23mm}mm`);
console.log(`  5. 是否"更细反而明显跳变"？         ${sum.mcSpanPct != null && sum.mcSpanPct <= 5 ? '无明显跳变' : '需评估'}`);
console.log(`  6. 工程输出是否稳定？               D=${sum.D.join('/')}  H=${sum.H.join('/')}  Vr=${sum.Vr.join('/')}  ΔD12=${sum.dD12} ΔD23=${sum.dD23}`);
console.log(`     工程输出观察项(|ΔD|≤1mm)：L1→L2 ${sum.dD12 != null && Math.abs(sum.dD12) <= 1 ? '✓' : '✗'}   L2→L3 ${sum.dD23 != null && Math.abs(sum.dD23) <= 1 ? '✓' : '✗'}  （★仅观察，不据此宣布收敛）`);

const cls = classify(sum);
console.log(`\n§十四 分类：${cls}`);

mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, 'phasev2005ef_mc_convergence.json');
writeFileSync(outFile, JSON.stringify({
  phase: 'V2.0-05E', baseline: 'main @ da1c822',
  geometry: { name: 'thickEnd', triCount, gtExpectMc: gt.expectedHotspots[0].mc, gtNote: '★仅参考：108.txt §九 禁止用 expectedMc 做 accuracy 判定' },
  levels: LEVELS, riserConfig: RISER,
  runs, summary: sum, classification: cls,
}, null, 2));

const csvRows = runs.map(r => ({
  phase: '05E', geometry: 'thickEnd', level: r.level,
  experimentalGs: r.experimentalGs, refineMaxPoints: r.refineMaxPoints,
  coarseGs: r.coarse.actualGs, coarseVs: r.coarse.vs, coarseStride: r.coarse.stride,
  refineMaxPointsUsed: r.refineMaxPoints,
  mainRefGs: r.mainRegion?.refGs, mainRegionStride: r.mainRegion?.stride, mainRegionSpacing: r.mainRegion?.spacing,
  mFieldSpacing: r.mFieldSpacing,
  hotspotCount: r.hotspotCount, mc: r.mainHotspot?.mc,
  x: r.mainHotspot?.position[0], y: r.mainHotspot?.position[1], z: r.mainHotspot?.position[2],
  confidence: r.mainHotspot?.confidence, regionVolumeMm3: r.mainHotspot?.regionVolumeMm3,
  Mr_need: r.riser?.Mr_need, D: r.riser?.D, H: r.riser?.H, Vr: r.riser?.Vr, Mr_act: r.riser?.Mr_act, modOk: r.riser?.modOk,
  dMc12pct: sum.dMc12pct, dMc23pct: sum.dMc23pct, mcSpanPct: sum.mcSpanPct, classification: cls,
}));
writeFileSync(join(OUT_DIR, 'phasev2005ef_mc_convergence.csv'),
  toCsv(csvRows, Object.keys(csvRows[0])));

console.log(`\n→ ${outFile}`);
export { runs, sum, cls };
