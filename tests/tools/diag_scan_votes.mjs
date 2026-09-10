// ============================================================
// PHASE 1 追踪：scanInside 三轴投票矩阵（细化 bbox）
// 检查凸台 E 内部采样点的 X/Y/Z 投票为何不达标
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { scanInside } from '../../js/engine/distanceField.js';

const { mesh } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n: 5 });
const { geometry } = buildMesh(mesh);

const p = [-5.0, -5.3, 29.9];
const half = 70.08;
const vsRefine = 8.350;
const gsLocal = 17;
const lb = {
  min: [p[0] - half, p[1] - half, p[2] - half],
  max: [p[0] + half, p[1] + half, p[2] + half],
  size: [2 * half, 2 * half, 2 * half],
};
const vs = (2 * half) / gsLocal;

// 凸台 E 内采样点（i,j,k 网格索引）
const insideE = [];
for (let i = 0; i < gsLocal; i++) for (let j = 0; j < gsLocal; j++) for (let k = 0; k < gsLocal; k++) {
  const x = lb.min[0] + (i + 0.5) * vs, y = lb.min[1] + (j + 0.5) * vs, z = lb.min[2] + (k + 0.5) * vs;
  if (x >= -40 && x <= 40 && y >= -40 && y <= 40 && z >= 5 && z <= 55) insideE.push({ i, j, k, x, y, z });
}
console.log(`凸台 E 内部采样点: ${insideE.length} 个`);

// 逐轴射线命中计数（直接 raycast 一条射线数交点，模拟 scanAxis 翻转逻辑）
import * as THREE from 'three';
const raycaster = new THREE.Raycaster();
const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const origin = new THREE.Vector3();
const dir = new THREE.Vector3();
const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const eps = vs * 0.02;
for (const pt of insideE.slice(0, 8)) {
  const hitsCount = [];
  for (let ax = 0; ax < 3; ax++) {
    // 模拟 scanAxis：o0 = bounds.min[ax] - vs
    const o0 = lb.min[ax] - vs;
    const b1 = [1, 2, 0][ax], b2 = [2, 0, 1][ax];
    const o1 = pt[b1], o2 = pt[b2];
    const o = [0, 0, 0];
    o[ax] = o0; o[b1] = o1; o[b2] = o2;
    origin.set(o[0], o[1], o[2]);
    dir.set(...axes[ax]);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObject(tmpMesh, false);
    // 采样点位置
    const c = pt[ax];
    const d = c - o0;
    let odd = false, hi = 0, groups = 0;
    const hd = [];
    while (hi < hits.length && hits[hi].distance < d) {
      odd = !odd;
      hd.push(hits[hi].distance.toFixed(1));
      const cur = hits[hi].distance;
      hi++;
      while (hi < hits.length && hits[hi].distance - cur < eps) hi++;
      groups++;
    }
    hitsCount.push(`${ax === 0 ? 'X' : ax === 1 ? 'Y' : 'Z'}${odd ? '内' : '外'} hits=[${hd.join(',')}]`);
  }
  console.log(`  (${pt.x.toFixed(1)},${pt.y.toFixed(1)},${pt.z.toFixed(1)}): ${hitsCount.join('  ')}`);
}

// 用全局 bbox（全模型）对比同一物理位置的投票
console.log('\n对比：同一位置在全模型 bbox 下的 X 轴投票');
{
  const gb = { min: [-300, -250, -55], max: [300, 250, 55], size: [600, 500, 110] };
  const gvs = 600 / 48;
  for (const pt of insideE.slice(0, 4)) {
    const ax = 0;
    const o0 = gb.min[ax] - gvs;
    origin.set(o0, pt[1], pt[2]);
    dir.set(1, 0, 0);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObject(tmpMesh, false);
    let odd = false, hi = 0;
    const d = pt[0] - o0;
    const eps2 = gvs * 0.02;
    while (hi < hits.length && hits[hi].distance < d) {
      odd = !odd;
      const cur = hits[hi].distance;
      hi++;
      while (hi < hits.length && hits[hi].distance - cur < eps2) hi++;
    }
    console.log(`  (${pt.x.toFixed(1)},${pt.y.toFixed(1)},${pt.z.toFixed(1)}): 全局bbox X轴 ${odd ? '内' : '外'}`);
  }
}
