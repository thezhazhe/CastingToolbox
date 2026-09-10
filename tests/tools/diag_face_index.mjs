// ============================================================
// PHASE 1 追踪：验证 BVH raycast 返回的 face 与命中点是否一致
// 1) 打印 face.a/b/c 原始索引与对应顶点
// 2) 用 Ray.intersectTriangle 对这些顶点手工求交 → 应为 null（平行）
// 3) 检查 BVH 内三角形总数与 position 关系
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import * as THREE from 'three';

const { mesh } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n: 5 });
const { geometry } = buildMesh(mesh);

const pos = geometry.attributes.position;
console.log(`position: ${pos.count} 顶点 (${pos.count / 3} 三角形), index: ${geometry.index ? geometry.index.count : '无'}`);
console.log(`BVH 内部: ${JSON.stringify({ root: geometry.boundsTree._roots.length, bounds: geometry.boundsTree.bounds })}`);

const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const dir = new THREE.Vector3(1, 0, 0);

const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), pt = new THREE.Vector3();
const ray = new THREE.Ray();

origin.set(-83.35, -38.3, 29.9);
raycaster.set(origin, dir);
const hits = raycaster.intersectObject(tmpMesh, false);
console.log(`\n射线起点(-83.35,-38.3,29.9) 命中 ${hits.length} 次`);
for (const h of hits.slice(0, 5)) {
  const a = h.face.a, b = h.face.b, c = h.face.c;
  va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); vc.fromBufferAttribute(pos, c);
  const n = new THREE.Triangle(va, vb, vc).getNormal(new THREE.Vector3());
  // 手工求交（Ray.intersectTriangle，backfaceCulling=false）
  const res = ray.copy(raycaster.ray).intersectTriangle(va, vb, vc, false, pt);
  console.log(`  d=${h.distance.toFixed(4)} face=[${a},${b},${c}] 命中点=(${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)})`);
  console.log(`    triA=(${va.x.toFixed(2)},${va.y.toFixed(2)},${va.z.toFixed(2)}) triB=(${vb.x.toFixed(2)},${vb.y.toFixed(2)},${vb.z.toFixed(2)}) triC=(${vc.x.toFixed(2)},${vc.y.toFixed(2)},${vc.z.toFixed(2)})`);
  console.log(`    tri法线=(${n.x.toFixed(4)},${n.y.toFixed(4)},${n.z.toFixed(4)}) face.normal=(${h.face.normal.x.toFixed(4)},${h.face.normal.y.toFixed(4)},${h.face.normal.z.toFixed(4)})`);
  console.log(`    手工 intersectTriangle: ${res ? `命中 @(${pt.x.toFixed(2)},${pt.y.toFixed(2)},${pt.z.toFixed(2)})` : 'null（平行，不应命中）'}`);
}
