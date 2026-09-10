// ============================================================
// PHASE 1 追踪：同一条射线（y=-38.3, z=29.9 沿 +x）
// 细化 bbox 起点 vs 全局 bbox 起点 → 完整 hits 列表对比
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import * as THREE from 'three';

const { mesh } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n: 5 });
const { geometry } = buildMesh(mesh);

const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const raycaster = new THREE.Raycaster();
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();

function trace(label, o0, y, z) {
  origin.set(o0, y, z);
  dir.set(1, 0, 0);
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObject(tmpMesh, false);
  console.log(`${label}: o0=(${o0.toFixed(1)},${y},${z}) 命中 ${hits.length} 次`);
  for (const h of hits.slice(0, 12)) console.log(`    d=${h.distance.toFixed(2)} 面片法线(${h.face.normal.x.toFixed(3)},${h.face.normal.y.toFixed(3)},${h.face.normal.z.toFixed(3)})`);
}

// 细化 bbox 起点（x=-83.3）与全局起点（x=-312.5），同一 y,z
trace('细化起点', -75.08 - 8.245, -38.3, 29.9);
trace('全局起点', -312.5, -38.3, 29.9);
trace('细化起点 z=21.7', -83.3, -5.0, 21.7);
trace('细化起点 y=-5.0 z=21.7', -83.3, -5.0, 21.7);
trace('凸台中心列 y=0', -83.3, 0, 29.9);

// BVH 信息
console.log('\ngeometry 元数据:', {
  vertexCount: geometry.attributes.position?.count,
  indexCount: geometry.index?.count,
  bvh: geometry.boundsTree ? `BVH ${geometry.boundsTree.bounds}` : '无 BVH',
  boundingSphere: geometry.boundingSphere ? `r=${geometry.boundingSphere.radius.toFixed(1)} c=(${geometry.boundingSphere.center.x.toFixed(1)},${geometry.boundingSphere.center.y.toFixed(1)},${geometry.boundingSphere.center.z.toFixed(1)})` : '无',
});
