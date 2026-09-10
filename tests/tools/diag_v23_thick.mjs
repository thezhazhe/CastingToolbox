// ============================================================
// V2.3 诊断：D_thickCylThinCollar NO_HOTSPOT 根因
// 打印 analyzeHotspots 各阶段计数 + uniform 判据信号
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { BOX, union, subtract, tetMC } from '../helpers/stlGen.js';

const f = (v, d = 2) => typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)) : v;

function build(label, sdf, bounds, res = 80) {
  const verts = tetMC(sdf, bounds, res);
  const mesh = { vertices: verts, triCount: verts.length / 9 };
  console.log(`\n=== ${label} (${mesh.triCount} tri) ===`);
  const t0 = Date.now();
  const geo = buildMesh(mesh).geometry;
  const hs = analyzeHotspots(mesh, geo);
  console.log(`耗时 ${Date.now() - t0}ms · status=${hs.status} reason=${hs.reason}`);
  const d = hs.debug || {};
  console.log(`gs=${d.gs}³ vs=${f(d.vs)} · inside=${d.insidePoints}/${d.totalPoints} · 候选=${d.candidates} 区域=${d.regions} 峰=${d.peaks} 拒绝=${d.rejected}`);
  if (hs.audit?.length) {
    for (const a of hs.audit) {
      if (a.uniform !== undefined) {
        const rl = a.regionLevel || {};
        console.log(`uniform=${a.uniform} peak=${f(rl.peak,1)} regionMedian=${f(rl.regionMedian,1)} regionMean=${f(rl.regionMean,1)} regionVol=${f(rl.regionVolumeCm3,1)}cm³ highScoreVol=${f(rl.highScoreRegionVolume,1)} peakToRegionRatio=${f(rl.peakToRegionRatio,3)} regionCoverage=${f(rl.regionCoverage,3)} outsideMaxima=${rl.outsideMaxima} thicknessRatio=${f(rl.thicknessRatio,3)} centroidOffsetRatio=${f(rl.centroidOffsetRatio,4)}`);
      }
    }
  }
  console.log(`候选列表: ${(hs.debug?.candidates ?? []).slice(0, 12).map(c => `(${f(c[0],0)},${f(c[1],0)},${f(c[2],0)})s=${f(c[3],2)}`).join(' ')}`);
  return hs;
}

// D：大厚圆柱 ⌀120×H100 + 薄围板 8（距 20）
build('D_thickCylThinCollar', union(
  BOX([-60, -60, -50], [60, 60, 50]),
  subtract(BOX([-80, -80, -50], [80, 80, 40]), BOX([-72, -72, -50], [72, 72, 40])),
), [[-85, -85, -55], [85, 85, 55]]);

// F：大厚圆柱 ⌀160×H100 + 薄底板 12（对照：此模型检出）
build('F_thickCylThinBase', union(
  BOX([-80, -80, -50], [80, 80, 50]),
  BOX([-180, -180, -56], [180, 180, -44]),
), [[-185, -185, -61], [185, 185, 55]]);

// B：薄板+厚环（对照：检出但代表点 r 偏出 4mm）
build('B_plateThickRing', union(
  BOX([-200, -200, -5], [200, 200, 5]),
  subtract(BOX([-70, -70, -5], [70, 70, 65]), BOX([-40, -40, -5], [40, 40, 65])),
), [[-205, -205, -10], [205, 205, 70]]);
