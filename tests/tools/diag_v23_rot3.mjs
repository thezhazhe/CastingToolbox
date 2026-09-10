// D 模型旋转验证（问题 1 修复的模型必须 90° 稳定）
import { rotateMesh } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { BOX, union, subtract, tetMC } from '../helpers/stlGen.js';
const verts = tetMC(union(
  BOX([-60, -60, -50], [60, 60, 50]),
  subtract(BOX([-80, -80, -50], [80, 80, 40]), BOX([-72, -72, -50], [72, 72, 40])),
), [[-85, -85, -55], [85, 85, 55]], 80);
const mesh = { vertices: verts, triCount: verts.length / 9 };
const run = (m, label) => {
  const geo = buildMesh(m).geometry;
  const hs = analyzeHotspots(m, geo);
  console.log(label, hs.hotspots.map(h => `rp(${h.x.toFixed(1)},${h.y.toFixed(1)},${h.z.toFixed(1)}) mc=${h.mc.toFixed(1)} c=${h.confidence.toFixed(2)}`).join(' | '), `status=${hs.status} H=${hs.hotspots.length}`);
};
const inv = (ax, p) => ax === 'x' ? [p[0], p[2], -p[1]] : ax === 'y' ? [-p[2], p[1], p[0]] : [p[1], -p[0], p[2]];
run(mesh, 'orig ');
for (const ax of ['x', 'y', 'z']) {
  const rot = rotateMesh({ vertices: new Float32Array(mesh.vertices), triCount: mesh.triCount }, ax, 90);
  run(rot, ax + '90 ');
}
