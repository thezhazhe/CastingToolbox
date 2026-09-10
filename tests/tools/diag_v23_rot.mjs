import { generate, rotateMesh } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
const { mesh } = generate('bossOnPlate');
const run = (m, label) => {
  const geo = buildMesh(m).geometry;
  const hs = analyzeHotspots(m, geo);
  console.log(label, hs.hotspots.map(h => `rp(${h.x.toFixed(1)},${h.y.toFixed(1)},${h.z.toFixed(1)}) mc=${h.mc.toFixed(1)} c=${h.confidence.toFixed(2)}`).join(' | '), `status=${hs.status}`);
};
run(mesh, 'orig ');
for (const ax of ['rx', 'ry', 'rz']) {
  const rot = rotateMesh({ vertices: new Float32Array(mesh.vertices), triCount: mesh.triCount }, ax, 90);
  run(rot, ax + '90 ');
}
