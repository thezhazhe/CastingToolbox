// ============================================================
// V2.3 信号设计实测：候选信号"低值区平台度"区分度
// 对 D（厚圆柱+薄围板，应检出）vs cube/plate/cylinder/tube/taper/shell（应 NO_HOTSPOT）
// 打印: regionMedian / 低30%分位 P25 / 低值区均值 / 平台度 = 低值均值/P25
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { BOX, union, subtract, tetMC } from '../helpers/stlGen.js';

async function stat(label, sdf, bounds, res = 80) {
  const verts = tetMC(sdf, bounds, res);
  const mesh = { vertices: verts, triCount: verts.length / 9 };
  const geo = buildMesh(mesh).geometry;
  const { scanInside } = await import('../../js/engine/distanceField.js');
  const { distanceToSurface } = await import('../../js/engine/mesh3d.js');
  const [mn, mx] = bounds;
  const B = { min: mn, max: mx, size: [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]] };
  const gs = 48;
  const vs = Math.max(...B.size) / gs;
  const insideGrid = scanInside(geo, B, gs, vs, mn);
  const pts = [];
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    if (insideGrid[i * gs * gs + j * gs + k]) {
      pts.push([mn[0] + (i + 0.5) * vs, mn[1] + (j + 0.5) * vs, mn[2] + (k + 0.5) * vs]);
    }
  }
  const dists = distanceToSurface(geo, pts);
  const scores = dists.filter(d => d !== null && d > 0.001);
  if (!scores.length) { console.log(`${label}: 无内部点`); return; }
  scores.sort((a, b) => a - b);
  const n = scores.length;
  const p25 = scores[Math.floor(n * 0.25)], p30 = scores[Math.floor(n * 0.3)];
  let loSum = 0, loCnt = 0;
  for (let i = 0; i < Math.floor(n * 0.3); i++) { loSum += scores[i]; loCnt++; }
  const loMean = loSum / loCnt;
  const p50 = scores[Math.floor(n * 0.5)];
  console.log(`${label.padEnd(22)} n=${String(n).padStart(6)} min=${scores[0].toFixed(1)} P25=${p25.toFixed(1)} P30=${p30.toFixed(1)} P50=${p50.toFixed(1)} max=${scores[n-1].toFixed(1)} 低值均值=${loMean.toFixed(1)} 平台度(低值均值/P25)=${(loMean/p25).toFixed(2)}`);
}

const M = {
  'D_thickCylThinCollar': union(BOX([-60,-60,-50],[60,60,50]), subtract(BOX([-80,-80,-50],[80,80,40]), BOX([-72,-72,-50],[72,72,40]))),
  'cube100': BOX([-50,-50,-50],[50,50,50]),
  'plate40': BOX([-150,-100,-20],[150,100,20]),
  'cyl120': (() => { const d = (p) => Math.max(Math.hypot(p[0],p[2])-60, Math.abs(p[1])-50); return d; })(),
  'tube10': (() => { const d = (p) => Math.max(Math.max(Math.hypot(p[0],p[2])-50, -(Math.hypot(p[0],p[2])-40)), Math.abs(p[1])-50); return d; })(),
  'taper': (() => { const d = (p) => Math.max(Math.max(Math.abs(p[1])-50, Math.abs(p[2])-10), Math.abs(p[0])-(20+20*(p[1]+50)/100)); return d; })(),
  'shell8': subtract(BOX([-200,-100,-50],[200,100,50]), BOX([-192,-92,-42],[192,92,42])),
  'bossOnPlate': union(BOX([-200,-100,-4],[200,100,4]), BOX([-50,-50,-4],[50,50,56])),
};
for (const [k, sdf] of Object.entries(M)) {
  stat(k, sdf, [[-210,-110,-60],[210,110,60]]);
}

async function main() {}
await main();
