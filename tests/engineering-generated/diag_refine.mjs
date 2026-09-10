// ============================================================
// 细化段诊断（只读，不修改核心）——复刻 hotspotV3.js 候选→细化→NMS
// 用法: node diag_refine.mjs <modelName>
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { coarseSample, refineSample, refineRegion, buildGridToPt } from '../../js/engine/v3/sampling.js';
import { buildModulusField } from '../../js/engine/v3/modulusField.js';
import { findPeaks } from '../../js/engine/v3/peakRegion.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
const mesh = parseSTL(readFileSync(join(HERE, 'models', name, 'model.stl')));
const geometry = buildMesh(mesh).geometry;
const bounds = computeBounds(mesh.vertices, mesh.triCount);
const o = { ...V3_DEFAULTS };

const coarse = coarseSample(mesh, geometry, o);
coarse.gridToPt = buildGridToPt(coarse.gs, coarse.vox.inside, coarse.insideIdx);
const coarseField = buildModulusField(coarse.vox, coarse, o, 1.0);
const coarsePeaks = findPeaks(coarseField.M, coarse, coarseField, o);
console.log(`${name}: 粗场峰 ${coarsePeaks.length} 个, top10:`);
coarsePeaks.slice(0, 10).forEach((p, i) =>
  console.log(`  #${i + 1} M=${p.M.toFixed(2)} pos=(${coarse.pts[p.pt].map(v => v.toFixed(0)).join(',')}) R=${p.R.toFixed(1)} prom=${p.prominence.toFixed(3)}`));

// 细化（与 hotspotV3 相同逻辑）
const refinedPeaks = [];
const seenRegions = [];
for (const cp of coarsePeaks.slice(0, o.maxHotspots * 3)) {
  const rMed = Math.max(o.charFloor, 1.0 * cp.R);
  if (2 * rMed < 3 * coarse.vs) { console.log(`  候选#${coarsePeaks.indexOf(cp) + 1} mc_artifact 跳过`); continue; }
  const toCenter = Math.hypot(coarse.pts[cp.pt][0] - bounds.center[0], coarse.pts[cp.pt][1] - bounds.center[1], coarse.pts[cp.pt][2] - bounds.center[2]);
  const regR = Math.max(rMed, Math.min(toCenter, 2 * rMed));
  const region = refineRegion(bounds, coarse.pts[cp.pt], regR, 1.0);
  const key = region.flat().map(v => v.toFixed(0)).join(',');
  if (seenRegions.includes(key)) { console.log(`  候选#${coarsePeaks.indexOf(cp) + 1} 区域重复跳过`); continue; }
  seenRegions.push(key);
  const ref = refineSample(geometry, region, coarse.globalMin, coarse.vs, o);
  if (!ref.pts.length) { console.log(`  候选#${coarsePeaks.indexOf(cp) + 1} 无采样点`); continue; }
  ref.gridToPt = buildGridToPt(ref.gs, ref.vox.inside, ref.insideIdx);
  const refField = buildModulusField(coarse.vox, ref, o, 1.0);
  const peaks = findPeaks(refField.M, ref, refField, o);
  console.log(`  候选#${coarsePeaks.indexOf(cp) + 1} @(${coarse.pts[cp.pt].map(v => v.toFixed(0)).join(',')}) → 细化峰 ${peaks.length} 个: ` +
    peaks.slice(0, 4).map(p => `M=${p.M.toFixed(2)}@(${ref.pts[p.pt].map(v => v.toFixed(0)).join(',')})`).join(' | '));
  for (const p of peaks) refinedPeaks.push({ ...p, ref, refField });
}
console.log(`\n细化后峰总数 ${refinedPeaks.length}`);
// globalNMS（与 hotspotV3.js 同步：距离合并 + 等高环峰合并）
const midM = (pa, qa) => {
  const mx = (pa[0] + qa[0]) / 2, my = (pa[1] + qa[1]) / 2, mz = (pa[2] + qa[2]) / 2;
  let best = Infinity, bm = 0;
  for (let i = 0; i < coarse.pts.length; i++) {
    const d = (coarse.pts[i][0] - mx) ** 2 + (coarse.pts[i][1] - my) ** 2 + (coarse.pts[i][2] - mz) ** 2;
    if (d < best) { best = d; bm = coarseField.M[i]; }
  }
  return bm;
};
const sorted = [...refinedPeaks].sort((a, b) => b.M - a.M);
const kept = [];
for (const p of sorted) {
  let tooClose = false;
  for (const q of kept) {
    const r = Math.max(p.refField.R[p.pt], q.refField.R[q.pt]);
    const d = Math.hypot(p.ref.pts[p.pt][0] - q.ref.pts[q.pt][0], p.ref.pts[p.pt][1] - q.ref.pts[q.pt][1], p.ref.pts[p.pt][2] - q.ref.pts[q.pt][2]);
    if (d < o.peakSeparationRatio * r) { tooClose = true; break; }
    const dm = Math.abs(p.M - q.M), em = o.peakEqualRatio * Math.max(p.M, q.M);
    const dd = d < o.peakEqualDistRatio * r;
    const mm = midM(p.ref.pts[p.pt], q.ref.pts[q.pt]);
    if (process.env.DEBUG_NMS && dm < 0.15 * Math.max(p.M, q.M)) {
      console.log(`  [NMS] pM=${p.M.toFixed(3)} qM=${q.M.toFixed(3)} d=${d.toFixed(1)} r=${r.toFixed(1)} 3.5r=${(o.peakEqualDistRatio*r).toFixed(1)} |ΔM|=${dm.toFixed(4)}<${em.toFixed(4)}?${dm<em} d<3.5r?${dd} midM=${mm.toFixed(2)}>=${(o.peakEqualValleyRatio*Math.max(p.M,q.M)).toFixed(2)}?${mm>=o.peakEqualValleyRatio*Math.max(p.M,q.M)}`);
    }
    if (dm < em && dd && mm >= o.peakEqualValleyRatio * Math.max(p.M, q.M)) {
      tooClose = true; break;
    }
  }
  if (!tooClose) kept.push(p);
}
console.log('NMS 后保留:');
kept.slice(0, 10).forEach((p, i) =>
  console.log(`  H${i + 1} M=${p.M.toFixed(2)} @(${p.ref.pts[p.pt].map(v => v.toFixed(0)).join(',')}) R=${p.refField.R[p.pt].toFixed(1)}`));
