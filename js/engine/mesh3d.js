// ============================================================
// Mesh 3D 集成 · three.js BufferGeometry + BVH
// 显示与几何查询共用一套数据结构；Three.js 只负责显示与加速查询，
// 热结/壁厚等分析算法不依赖渲染（见 hotspot.js 等纯引擎模块）。
// 浏览器专用模块（依赖 three importmap）。
// ============================================================
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { computeBounds } from './stl.js';

// Raycaster 走 BVH（关键性能）：scanAxis 的射线求交若走 three 默认暴力遍历，
// 25 万面 × 2.7 万射线 = 数分钟；patch 后 <1s。模块加载时生效一次（浏览器与 Node 各自实例）。
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

/**
 * 从 stl.js 解析结果构建 three 几何体 + BVH
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @returns {{geometry:THREE.BufferGeometry, bvh:MeshBVH, bounds:object}}
 */
export function buildMesh(mesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.vertices, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.boundsTree = new MeshBVH(geometry, { lazyGeneration: true });
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  return { geometry, bvh: geometry.boundsTree, bounds };
}

/**
 * 查询：给定点集到表面的最近距离（mm）
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果
 * @param {Array<[number,number,number]>} points
 * @param {number} [maxDist] 超过返回 null
 * @returns {(number|null)[]}
 */
function distanceLoop(bvh, points, start, end, out, maxDist) {
  const vec = new THREE.Vector3();
  const target = new THREE.Vector3();
  for (let i = start; i < end; i++) {
    vec.set(points[i][0], points[i][1], points[i][2]);
    const r = bvh.closestPointToPoint(vec, target, 0, maxDist || Infinity);
    if (r === null) { out[i] = null; continue; }
    // 不同 mesh-bvh 版本返回字段不同：distance 或 distanceSq
    out[i] = r.distance !== undefined ? r.distance : Math.sqrt(r.distanceSq);
  }
}

export function distanceToSurface(geometry, points, maxDist) {
  const out = new Array(points.length);
  distanceLoop(geometry.boundsTree, points, 0, points.length, out, maxDist);
  return out;
}

/** 分片版：每 chunk 个点让出一次事件循环（UI 用，避免大模型阻塞交互） */
export async function distanceToSurfaceSliced(geometry, points, maxDist, yieldFn, chunk = 128) {
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i += chunk) {
    distanceLoop(geometry.boundsTree, points, i, Math.min(i + chunk, points.length), out, maxDist);
    if (yieldFn) await yieldFn();
  }
  return out;
}

/**
 * 射线求交：点是否在实体内部（多方向奇偶投票）
 * 对非流形网格，单方向射线可能恰好掠边，多方向投票更稳（CastEyes 同类方案）。
 */
export function isInside(geometry, p, rays = 6) {
  const dirs = [
    [1, 0.131, 0.273], [-0.321, 1, 0.142], [0.213, -0.244, 1],
    [-1, -0.131, -0.273], [0.321, -1, -0.142], [-0.213, 0.244, -1],
  ];
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3(p[0], p[1], p[2]);
  // DoubleSide 必须：从实体内部发射的射线会穿过背面三角，单面材质会漏检
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  let hits = 0, votes = 0;
  for (let i = 0; i < rays; i++) {
    const d = dirs[i % dirs.length];
    raycaster.set(origin, new THREE.Vector3(d[0], d[1], d[2]));
    const inter = raycaster.intersectObject(tmpMesh, false);
    votes++;
    if (inter.length % 2 === 1) hits++;
  }
  tmpMesh.material.dispose();
  return hits > votes / 2;
}
