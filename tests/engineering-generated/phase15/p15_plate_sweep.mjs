// 均匀板扫描（临时诊断，不入报告）：均匀板应 NO_HOTSPOT（12.txt 标准 2）
import { BOX, tetMC } from '../../helpers/stlGen.js';
import { pickRes } from '../../tools/hotspotGeometryGenerator.mjs';
import { runV3 } from './p15_common.mjs';

const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];
const CASES = [
  ['plate300x200x40', 300, 200, 40], ['plate300x200x20', 300, 200, 20], ['plate300x200x10', 300, 200, 10],
  ['plate500x500x30', 500, 500, 30], ['plate500x500x20', 500, 500, 20], ['plate500x500x10', 500, 500, 10],
  ['plate800x800x20', 800, 800, 20], ['plate1000x1000x20', 1000, 1000, 20], ['plate1000x1000x40', 1000, 1000, 40],
  ['plate200x200x20', 200, 200, 20], ['plate400x400x20', 400, 400, 20],
];
console.log('均匀板扫描（应为 NO_HOTSPOT）：');
for (const [name, L, W, T] of CASES) {
  const b = [[-L / 2, -W / 2, -T / 2], [L / 2, W / 2, T / 2]];
  const sdf = BOX(b[0], b[1]);
  const mdim = Math.max(L, W, T);
  const mesh = { vertices: tetMC(sdf, pad2(b), pickRes(mdim, T)), triCount: 0 };
  mesh.triCount = mesh.vertices.length / 9;
  const r = runV3(mesh);
  const c = r.v3.debug.coarse;
  const hs = r.v3.hotspots.map(h => 'M' + h.peakModulus.toFixed(1) + '@(' + h.position.map(v => v.toFixed(0)).join(',') + ')').join(' ');
  console.log('  ' + name.padEnd(18) + ' vs=' + (c?.vs ?? 0).toFixed(1) + '  ' + r.v3.status.padEnd(14) + ' H' + r.v3.hotspots.length + (hs ? '  ' + hs : ''));
}
