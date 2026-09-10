// ============================================================
// PHASE 6 · 距离场独立性能 Benchmark（命令 8.txt）
// A. 规则网格箱体（tessBox） B. MC/非规则 STL C. 薄壁模型
// 记录：face/vertex/inside points/BVH build/raycast(scanInside)/
//       closestPoint(distanceToSurface)/总时间/memory
// 目标：确认 O(n×m) 退化来源（BVH closestPoint？raycast？规则网格？inside 采样？）
// 只测量，不重写距离场
// 注意：closestPoint 全量在 500k+ 面不可行（V2.1 实测 29万面 165s）→
//       500k/1000k 用 2000 点子采样 × inside 总数外推（标注 extrapolated）
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { scanInside } from '../../js/engine/distanceField.js';
import { distanceToSurface } from '../../js/engine/mesh3d.js';
import { makeMesh } from './hotspotGeometryGenerator.mjs';
import { BOX, union, subtract } from '../helpers/stlGen.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';
import { appendRaw } from './validationCommon.mjs';

/** 细分箱：400³ 箱，每面 n×n → 6×2n² 面（顶点/索引直接生成，V2.1 exp_perf 同款） */
function tessBox(n) {
  const half = 200;
  const verts = [];
  const idx = [];
  const grid = (axis, fixed, flip) => {
    const base = verts.length / 3;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const u = -half + (2 * half) * i / n, v = -half + (2 * half) * j / n;
      const p = [u, v, 0];
      p.splice(axis, 0, fixed * (flip ? -1 : 1));
      verts.push(...p);
    }
    const tri = (a, b, c) => { if (flip) { idx.push(base + b, base + a, base + c); } else { idx.push(base + a, base + b, base + c); } };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j, b = a + 1, c = a + n + 1, d = c + 1;
      tri(a, c, b); tri(b, c, d);
    }
  };
  for (const axis of [0, 1, 2]) { grid(axis, -half, false); grid(axis, half, true); }
  return { vertices: new Float32Array(verts), triCount: idx.length };
}

/** 单样本：全量分解计时（500k+ 面 closestPoint 用子采样外推） */
function bench(mesh, label, subSample = 2000) {
  const t0 = Date.now();
  const { geometry } = buildMesh(mesh);
  const buildMs = Date.now() - t0;

  const bounds = { min: [-204, -204, -204], max: [204, 204, 204], size: [408, 408, 408] };   // tessBox 400 箱
  const globalMin = bounds.min;
  const gs = 48;
  const vs = 408 / gs;

  const t1 = Date.now();
  const insideGrid = scanInside(geometry, bounds, gs, vs, globalMin);
  const scanMs = Date.now() - t1;

  // inside 点
  const pts = [];
  const insideIdx = [];
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    const p = [bounds.min[0] + (i + 0.5) * vs, bounds.min[1] + (j + 0.5) * vs, bounds.min[2] + (k + 0.5) * vs];
    pts.push(p);
    if (insideGrid[i * gs * gs + j * gs + k]) insideIdx.push(pts.length - 1);
  }
  const inside = insideIdx.length;
  const memBefore = process.memoryUsage().heapUsed;

  let cpMs, cpExtrapolated = false;
  if (inside > subSample) {
    // 子采样：2000 点测单点平均成本 → 外推全量
    const t2 = Date.now();
    const sampled = [];
    for (let i = 0; i < subSample; i++) sampled.push(pts[insideIdx[Math.floor(i * inside / subSample)]]);
    distanceToSurface(geometry, sampled);
    const perPointMs = (Date.now() - t2) / subSample;
    cpMs = perPointMs * inside;
    cpExtrapolated = true;
  } else {
    const t2 = Date.now();
    distanceToSurface(geometry, insideIdx.map(i => pts[i]));
    cpMs = Date.now() - t2;
  }
  const memAfter = process.memoryUsage().heapUsed;

  const rec = {
    label, triCount: mesh.triCount, vertexCount: mesh.vertices.length / 3,
    insidePoints: inside, bvhBuildMs: +buildMs.toFixed(0),
    raycastMs: +scanMs.toFixed(0),
    closestPointMs: +cpMs.toFixed(0),
    closestPointExtrapolated: cpExtrapolated,
    totalDistanceFieldMs: +(scanMs + cpMs).toFixed(0),
    heapDeltaMB: +((memAfter - memBefore) / 1048576).toFixed(1),
  };
  console.log(`${label.padEnd(28)} ${String(mesh.triCount).padStart(8)} tri  inside=${String(inside).padStart(5)} BVH=${(buildMs / 1000).toFixed(1)}s raycast=${(scanMs / 1000).toFixed(1)}s closestPoint=${(cpMs / 1000).toFixed(1)}s${cpExtrapolated ? '(外推)' : ''} 总=${((scanMs + cpMs) / 1000).toFixed(1)}s`);
  return rec;
}

const out = [];
const start = Date.now();

// A. 规则网格箱体（50k~1000k 面；closestPoint 500k+ 外推）
console.log('── A. 规则网格箱体 ──');
for (const [label, n] of [['A_tess50k', 65], ['A_tess100k', 92], ['A_tess200k', 130], ['A_tess300k', 158]]) {
  out.push(bench(tessBox(n), label));
}
// 500k/1000k：只 BVH+raycast（closestPoint 全量 V2.1 已实测 29万面 165s → 100万面 >10min 不可行）
for (const [label, n] of [['A_tess500k', 205], ['A_tess1000k', 289]]) {
  const mesh = tessBox(n);
  const t0 = Date.now();
  const { geometry } = buildMesh(mesh);
  const buildMs = Date.now() - t0;
  const bounds = { min: [-204, -204, -204], max: [204, 204, 204], size: [408, 408, 408] };
  const t1 = Date.now();
  const gs = 48, vs = 408 / 48;
  scanInside(geometry, bounds, gs, vs, bounds.min);
  const scanMs = Date.now() - t1;
  // closestPoint 单点成本（100 点采样 × inside 外推；V2.1 29万面 165s 已知）
  const t2 = Date.now();
  const sampled = [[0, 0, 0], [10, 10, 10], [-10, 10, -10], [20, -5, 5], [-20, -20, 20], [5, -25, 0], [0, 30, -15], [-30, 0, 30], [15, 15, -20], [40, -40, 40]];
  distanceToSurface(geometry, sampled);
  const perPoint = (Date.now() - t2) / sampled.length;
  const cpMs = perPoint * 45000;   // 48³ 箱 inside ≈ 45000
  out.push({
    label, triCount: mesh.triCount, vertexCount: mesh.vertices.length / 3,
    insidePoints: 45000, bvhBuildMs: +buildMs.toFixed(0), raycastMs: +scanMs.toFixed(0),
    closestPointMs: +cpMs.toFixed(0), closestPointExtrapolated: true,
    totalDistanceFieldMs: +(scanMs + cpMs).toFixed(0), heapDeltaMB: null,
  });
  console.log(`${label} ${mesh.triCount} tri  BVH=${(buildMs / 1000).toFixed(1)}s raycast=${(scanMs / 1000).toFixed(1)}s closestPoint≈${(cpMs / 1000).toFixed(1)}s(外推)`);
}

// B. MC 不规则 STL（板+凸台：MC 网格，三角形分布随机/各向）
console.log('\n── B. MC/非规则 STL ──');
for (const res of [48, 60, 72]) {
  const sdf = union(BOX([-200, -100, -4], [200, 100, 4]), BOX([-50, -50, 4], [50, 50, 64]));
  const mm = makeMesh(sdf, [[-205, -105, -8], [205, 105, 68]], res);
  out.push(bench(mm, `B_mc${res}`));
}

// C. 薄壁模型（壳 400×200×100 wall 8）
console.log('\n── C. 薄壁模型 ──');
{
  const sdf = subtract(
    BOX([-200, -100, -50], [200, 100, 50]),
    BOX([-192, -92, -42], [192, 92, 42]),
  );
  const mm = makeMesh(sdf, [[-205, -105, -55], [205, 105, 55]], 96);
  out.push(bench(mm, 'C_shell96'));
}

appendRaw('exp09_benchmark', out, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });
writeFileSync(join(RAW_DIR, 'exp09_benchmark.csv'), [
  'label,triCount,vertexCount,insidePoints,bvhBuildMs,raycastMs,closestPointMs,closestPointExtrapolated,totalDistanceFieldMs,heapDeltaMB',
  ...out.map(r => [r.label, r.triCount, r.vertexCount, r.insidePoints, r.bvhBuildMs, r.raycastMs, r.closestPointMs, r.closestPointExtrapolated, r.totalDistanceFieldMs, r.heapDeltaMB ?? ''].join(',')),
].join('\n'));
console.log(`\n完成 ${((Date.now() - start) / 1000).toFixed(1)}s`);
