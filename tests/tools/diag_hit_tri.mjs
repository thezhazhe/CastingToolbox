// ============================================================
// PHASE 1 追踪：打印射线命中点精确坐标与命中三角形顶点
// 验证 z=29.9 处"垂直法线命中"是 BVH 数值误交还是真实几何
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import * as THREE from 'three';

const { mesh } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n: 5 });
const { geometry } = buildMesh(mesh);

const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const dir = new THREE.Vector3(1, 0, 0);

function trace(label, o0, y, z) {
  origin.set(o0, y, z);
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObject(tmpMesh, false);
  console.log(`${label}: 起点(${o0.toFixed(2)},${y},${z}) 命中 ${hits.length} 次`);
  for (const h of hits.slice(0, 8)) {
    const pos = geometry.attributes.position;
    const idx = geometry.index;
    const a = idx.getX(h.face.a), b = idx.getX(h.face.b), c = idx.getX(h.face.c);
    const va = [pos.getX(a), pos.getY(a), pos.getZ(a)];
    const vb = [pos.getX(b), pos.getY(b), pos.getZ(b)];
    const vc = [pos.getX(c), pos.getY(c), pos.getZ(c)];
    const zs = [va[2], vb[2], vc[2]];
    console.log(`    d=${h.distance.toFixed(3)} hit=(${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)}) 法线=(${h.face.normal.x.toFixed(3)},${h.face.normal.y.toFixed(3)},${h.face.normal.z.toFixed(3)})`);
    console.log(`      tri z∈[${Math.min(...zs).toFixed(2)},${Math.max(...zs).toFixed(2)}] tri=(${va.map(v=>v.toFixed(1))})(${vb.map(v=>v.toFixed(1))})(${vc.map(v=>v.toFixed(1))})`);
  }
}

trace('凸台 D 内起点（y=-38.3, z=29.9）', -83.35, -38.3, 29.9);
trace('凸台 D 内起点（y=-38.3, z=30.4）', -83.35, -38.3, 30.4);
trace('模型外起点（y=-38.3, z=40）', -83.35, -38.3, 40);
trace('模型外起点（y=-38.3, z=21.7）', -83.35, -38.3, 21.7);
trace('模型外起点（y=-38.3, z=10）', -83.35, -38.3, 10);
