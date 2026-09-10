// ============================================================
// PHASE 1 追踪：对 region#3（凸台 E(0,0)）的细化 bbox 重建距离场
// 验证：bbox 是否覆盖凸台 E / scanInside 是否判定正确 / 距离是否正常
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';

const { mesh } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n: 5 });
const { geometry } = buildMesh(mesh);

// region#3 峰点（diag_multi_trace 输出）
const p = [-5.0, -5.3, 29.9];
const dPeak = 25.05, vsCoarse = 9.99;
const half = 2 * dPeak + 2 * vsCoarse;
const vsRefine = 2 * dPeak / 6;
const gsLocal = Math.ceil(2 * half / vsRefine);
console.log(`half=${half} vsRefine=${vsRefine.toFixed(3)} gsLocal=${gsLocal}`);
console.log(`凸台 E: x∈[-40,40] y∈[-40,40] z∈[5,55]；峰点 p=(${p})`);

const lb = {
  min: [p[0] - half, p[1] - half, p[2] - half],
  max: [p[0] + half, p[1] + half, p[2] + half],
  size: [2 * half, 2 * half, 2 * half],
};
console.log(`细化 bbox: x∈[${lb.min[0].toFixed(1)},${lb.max[0].toFixed(1)}] y∈[${lb.min[1].toFixed(1)},${lb.max[1].toFixed(1)}] z∈[${lb.min[2].toFixed(1)},${lb.max[2].toFixed(1)}]`);

const gdf = buildDistanceField(mesh, geometry, { resolution: gsLocal }, lb);
console.log(`\n细化距离场: gs=${gdf.gs} vs=${gdf.vs.toFixed(3)} inside=${gdf.insideIdx.length}`);

// 距离分布
const dists = gdf.dists.filter(d => d !== null && d !== undefined);
if (dists.length) {
  const maxD = Math.max(...dists);
  const hi = dists.filter(d => d > 15);
  const mid = dists.filter(d => d >= 5 && d <= 15);
  const lo = dists.filter(d => d > 0 && d < 5);
  console.log(`距离统计: max=${maxD.toFixed(2)}mm  >15mm:${hi.length}  5-15mm:${mid.length}  <5mm:${lo.length}`);
  // 高分点位置
  const top = [];
  for (let i = 0; i < gdf.dists.length; i++) {
    if (gdf.dists[i] > 20) top.push(gdf.pts[gdf.insideIdx[i]]);
  }
  console.log(`\ndist>20mm 的点（应位于凸台 E 内部）:`);
  for (const q of top) console.log(`  (${q[0].toFixed(1)},${q[1].toFixed(1)},${q[2].toFixed(1)})`);
} else {
  console.log('细化 bbox 内无内部点！');
}
