// ============================================================
// PHASE V2.0-04 §八 · 旋转敏感性**分解**实验
//
// §八 原问："这个方法对模型坐标姿态是否敏感到不可接受？"
// 直接端到端比较会把两种敏感性混在一起：
//   ① Hotspot V3（体素采样网格锚在 bbox 上，本来就不是旋转不变的）
//   ② Cube∩STL 体积算法本身
// 本脚本把两者**分开**：
//   【A】方法自身：拿"原始姿态的 hotspot 中心 + Mc"，把中心按同一旋转搬到旋转坐标系，
//        再算同一个 L=K×Mc 的盒子体积。几何是全等的 → 差异 = 算法自身的数值/离散伪影。
//   【B】检测器：按"旋转后的位置"配对热点，比较 Mc / 检出数量。
//
// 用法：node tests/experiments/analyze_rotation.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeVolume } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { prepareMesh, cubeIntersectVolume } from './hotspotLocalVolume.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ROT = { X: (x, y, z) => [x, -z, y], Y: (x, y, z) => [z, y, -x], Z: (x, y, z) => [-y, x, z] };
const rotMesh = (mesh, ax) => {
  if (!ax) return mesh;
  const f = ROT[ax], s = mesh.vertices, v = new Float32Array(s.length);
  for (let i = 0; i < s.length; i += 3) { const [a, b, c] = f(s[i], s[i + 1], s[i + 2]); v[i] = a; v[i + 1] = b; v[i + 2] = c; }
  return { vertices: v, triCount: mesh.triCount };
};

const Ks = [2, 5, 10];
const CASES = [
  ['HR4012', join(ROOT, 'tests', 'real-stl', 'HR4012塑料模具v4最早大板.stl')],
  ['ALR2510', join(ROOT, 'tests', 'real-stl', 'ALR2510塑料模具v1_1.stl')],
  ['ALHR4510', join(ROOT, 'tests', 'real-stl', 'ALHR4510塑料模具v2-2.1.stl')],
];

for (const [name, file] of CASES) {
  const buf = readFileSync(file);
  const base = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const run = (mesh) => {
    const g = buildMesh(mesh).geometry;
    const v3 = analyzeHotspotsV3(mesh, g);
    return { v3, ctx: prepareMesh(mesh), vol: computeVolume(mesh.vertices, mesh.triCount) };
  };
  const O = run(base);
  const variants = { orig: O };
  for (const ax of ['X', 'Y', 'Z']) variants[ax] = run(rotMesh(base, ax));   // 每个姿态只跑一次

  console.log(`\n${'='.repeat(92)}\n【${name}】 原始：${O.v3.status}，热点 ${O.v3.hotspots.length} 个，体积 ${(O.vol / 1000).toFixed(1)} cm³`);

  // ---- 【A】方法自身旋转不变性 ----
  console.log('\n【A】方法自身（同 Mc、中心随姿态搬运；全等几何 → 差异应 ≈ 0）');
  console.log('  hotspot  Mc      K   L(mm)      V(orig)          V(X)     Δ%          V(Y)     Δ%          V(Z)     Δ%');
  for (const h of O.v3.hotspots) {
    for (const K of Ks) {
      const side = K * h.peakModulus;
      const v0 = cubeIntersectVolume(O.ctx, h.position, side).volume;
      const row = [];
      for (const ax of ['X', 'Y', 'Z']) {
        const c = ROT[ax](h.position[0], h.position[1], h.position[2]);
        const v = cubeIntersectVolume(variants[ax].ctx, c, side).volume;
        row.push([v, (v - v0) / v0 * 100]);
      }
      console.log(`  H${h.hotspotId}      ${h.peakModulus.toFixed(3).padStart(6)}  ${String(K).padStart(2)}  ${side.toFixed(1).padStart(6)}  ${v0.toFixed(1).padStart(13)}  ` +
        row.map(([v, d]) => `${v.toFixed(1).padStart(13)} ${(d >= 0 ? '+' : '') + d.toFixed(3)}%`).join(' '));
    }
  }

  // ---- 【B】Hotspot V3 检测器旋转敏感性（按位置配对）----
  console.log('\n【B】Hotspot V3 检测器（按位置配对）');
  // 模型对角线 5% 作为配对容差（体素质心在旋转下会有网格相位漂移，容差太小会全配不上）
  const diag = Math.hypot(...(O.v3.metrics?.size || [100, 100, 100]));
  const PAIR_TOL = Math.max(3, diag * 0.05);
  for (const ax of ['X', 'Y', 'Z']) {
    const R = variants[ax];
    const mapped = O.v3.hotspots.map(h => ({ h, p: ROT[ax](h.position[0], h.position[1], h.position[2]) }));
    const used = new Set();
    const pairs = [];
    const dists = [];
    for (const m of mapped) {
      let best = -1, bd = Infinity;
      R.v3.hotspots.forEach((q, i) => { if (used.has(i)) return; const d = Math.hypot(m.p[0] - q.position[0], m.p[1] - q.position[1], m.p[2] - q.position[2]); if (d < bd) { bd = d; best = i; } });
      if (best >= 0 && bd < PAIR_TOL) { used.add(best); pairs.push([m.h, R.v3.hotspots[best]]); dists.push(bd); }
    }
    const mcDev = pairs.map(([a, b]) => (b.peakModulus - a.peakModulus) / a.peakModulus * 100).sort((a, b) => a - b);
    const med = mcDev.length ? mcDev[Math.floor(mcDev.length / 2)] : NaN;
    const maxAbs = mcDev.length ? Math.max(...mcDev.map(Math.abs)) : NaN;
    dists.sort((a, b) => a - b);
    console.log(`  ↻${ax}: 检出 ${R.v3.hotspots.length} 个（原始 ${O.v3.hotspots.length}），配对 ${pairs.length}/${O.v3.hotspots.length}（容差 ${PAIR_TOL.toFixed(0)}mm，配对距离中位 ${dists.length ? dists[Math.floor(dists.length / 2)].toFixed(2) : '—'}mm）`);
    if (pairs.length) console.log(`      Mc 偏差：中位 ${med.toFixed(2)}%  最大 ${maxAbs.toFixed(2)}%   [${mcDev.map(v => (v >= 0 ? '+' : '') + v.toFixed(1)).join(', ')}]`);
    console.log(`      检出数量：${O.v3.hotspots.length} → ${R.v3.hotspots.length}${R.v3.hotspots.length !== O.v3.hotspots.length ? '  ⚠ 集合改变（热点身份在旋转下不稳定）' : '  ✓'}`);
  }
}
