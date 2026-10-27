// ============================================================
// PHASE V2.0-04 · Vc_local 独立交叉验证（射线积分法，与封盖算法**完全无关**）
//
// 目的：主算法在少数真实件上报"截面交线未能闭合成环"。必须**量化**该告警的影响，
//      而不是假设它无害。本脚本用完全不同的方法算同一个 Volume(STL∩Cube)：
//
//   V = ∫∫ len(x | (y,z) 固定, x ∈ Cube) dy dz
//   沿 +X 对每个 (y,z) 网格点求射线与网格的交点 → 奇偶判内外 → 求实体段长度之和
//   × 面积元。
//
// 这是**近似**方法（O(h) 离散误差），只用作交叉验证；§七 要求的"最终结果"仍是
// 主工具的精确多面体体积。两者应随网格加密收敛到同一值。
//
// 用法：node tests/experiments/verify_volume_raycheck.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { prepareMesh, cubeIntersectVolume } from './hotspotLocalVolume.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function rayT(o, d, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/** 射线积分法求 Volume(STL∩Cube)（沿 X 方向扫 (y,z) 网格） */
function rayVolume(mesh, center, side, G) {
  const { vertices, triCount } = mesh;
  const half = side / 2;
  const lo = [center[0] - half, center[1] - half, center[2] - half];
  const hi = [center[0] + half, center[1] + half, center[2] + half];
  const hy = half * 2 / G, hz = half * 2 / G;
  // ★ 射线起点必须在**整个模型包围盒之外**，否则奇偶判据的初始"外"状态是错的。
  //   曾用 lo[0] − 2×side：K 小时该点仍在模型内部 → 结果整体错误
  //   （HR4012 H2 K=5：精确 175419 vs 该错法 1427），K 大时才碰巧退到模型外。
  const mb = computeBounds(mesh.vertices, mesh.triCount);
  const o = [mb.min[0] - Math.max(1, side), 0, 0], d = [1, 0, 0];

  // 每三角的 (y,z) 包围盒——射线沿 X，只有 (y,z) 投影覆盖该点的三角才可能被命中
  const byz = new Float64Array(triCount * 4);
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    let mny = Infinity, mnz = Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const y = vertices[i + k * 3 + 1], z = vertices[i + k * 3 + 2];
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    byz[t * 4] = mny; byz[t * 4 + 1] = mxy; byz[t * 4 + 2] = mnz; byz[t * 4 + 3] = mxz;
  }

  const xs = [];
  let sum = 0;
  for (let j = 0; j < G; j++) {
    const y = lo[1] + (j + 0.5) * hy;
    for (let k = 0; k < G; k++) {
      const z = lo[2] + (k + 0.5) * hz;
      o[1] = y; o[2] = z;
      xs.length = 0;
      for (let t = 0; t < triCount; t++) {
        const q = t * 4;
        if (y < byz[q] || y > byz[q + 1] || z < byz[q + 2] || z > byz[q + 3]) continue;
        const i = t * 9;
        const tt = rayT(o, d, vertices[i], vertices[i + 1], vertices[i + 2],
          vertices[i + 3], vertices[i + 4], vertices[i + 5],
          vertices[i + 6], vertices[i + 7], vertices[i + 8]);
        if (tt !== null && tt > 0) xs.push(o[0] + tt);
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a - b);
      // 奇偶：先数起点(lo[0])左侧的交点，决定起点是否在实体内
      let inside = false;
      for (const x of xs) if (x < lo[0]) inside = !inside;
      let cursor = lo[0];
      for (const x of xs) {
        if (x <= lo[0]) continue;
        if (x >= hi[0]) break;
        if (inside) sum += (x - cursor);
        cursor = x;
        inside = !inside;
      }
      if (inside) sum += (hi[0] - cursor);
    }
  }
  return sum * hy * hz;
}

const Ks = [2, 5, 10];
const Gs = [200, 400];

for (const [name, file] of [
  ['HR4012', join(ROOT, 'tests', 'real-stl', 'HR4012塑料模具v4最早大板.stl')],
  ['ALR2510', join(ROOT, 'tests', 'real-stl', 'ALR2510塑料模具v1_1.stl')],
]) {
  const buf = readFileSync(file);
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const geometry = buildMesh(mesh).geometry;
  const v3 = analyzeHotspotsV3(mesh, geometry);
  const ctx = prepareMesh(mesh);
  console.log(`\n${'='.repeat(88)}\n【${name}】 三角 ${mesh.triCount}  包围盒 ${computeBounds(mesh.vertices, mesh.triCount).size.map(v => v.toFixed(0)).join('×')}`);
  console.log('  K    精确法(main)      射线 G=200      G=400    精确-vs-射线');
  for (const h of v3.hotspots) {
    for (const K of Ks) {
      const side = K * h.peakModulus;
      const exact = cubeIntersectVolume(ctx, h.position, side).volume;
      const est = Gs.map(G => rayVolume(mesh, h.position, side, G));
      const dev = (est[1] - exact) / exact * 100;
      console.log(`  H${h.hotspotId} K=${String(K).padStart(2)}  ${exact.toFixed(1).padStart(12)}  ${est.map(e => e.toFixed(1).padStart(12)).join('  ')}   ${dev >= 0 ? '+' : ''}${dev.toFixed(2)}%`);
    }
  }
}
