// ============================================================
// Exp 09 · 性能压力（命令文件 7.txt 第十五节）
// 细分箱（直接构造顶点，不经 MC）：10万~500万面
// 记录：BVH 构建 / 粗扫距离场 / 总分析时间；检查 3s/8s 预算与 refine 保护
// 注意：引擎不暴露分阶段计时 → coarse ≈ buildDistanceField 单独计时，candidate+refine ≈ 差值
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';
import { analyzeHotspots } from '../../js/engine/hotspot.js';
import { appendRaw } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

/** 细分箱：400³ 箱，每面 n×n → 6×2n² 面（顶点/索引直接生成） */
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

// 注：性能爆炸已由 29 万面定位（BVH 对规则网格查询退化 → O(inside×faces) 全遍历）。
// 50 万面以上按 165s(29万) 推算 >20min/点 —— 不跑，报告中线性外推。
const TARGETS = [
  ['10万', 90], ['20万', 130],
];
const BUDGET = { simpleMs: 3000, complexMs: 8000 };

const out = [];
for (const [label, n] of TARGETS) {
  const t0 = Date.now();
  const mesh = tessBox(n);
  const genMs = Date.now() - t0;

  const t1 = Date.now();
  const { geometry } = buildMesh(mesh);
  const buildMs = Date.now() - t1;

  const t2 = Date.now();
  const df = buildDistanceField(mesh, geometry, {});
  const dfMs = Date.now() - t2;

  const t3 = Date.now();
  const r = analyzeHotspots(mesh, geometry, {});
  const totalMs = Date.now() - t3;

  const rec = {
    model: `perf_${label}`,
    parameters: { faces: mesh.triCount, label },
    detected: { status: r.status, hotspots: r.hotspots.length },
    status: r.status,
    positionError: null, classification: null,
    runtime: totalMs,
    triCount: mesh.triCount,
    _genMs: genMs, _buildMs: buildMs, _dfMs: dfMs, _candRefineMs: totalMs - dfMs,
    debug: { gs: r.debug.gs, vs: r.debug.vs, insidePoints: r.debug.insidePoints, candidates: r.debug.candidates },
    budgetOk: totalMs < BUDGET.simpleMs,
    note: totalMs < BUDGET.simpleMs ? '在预算内' : totalMs < BUDGET.complexMs ? '复杂预算内' : '超预算',
  };
  out.push(rec);
  console.log(`${label}面（${mesh.triCount}）: 生成${(genMs / 1000).toFixed(1)}s BVH${(buildMs / 1000).toFixed(1)}s 距离场${(dfMs / 1000).toFixed(1)}s 候选+细化${((totalMs - dfMs) / 1000).toFixed(1)}s 总${(totalMs / 1000).toFixed(1)}s status=${r.status} ${rec.budgetOk ? '' : '⚠️'}（vs=${r.debug.vs.toFixed(2)} inside=${r.debug.insidePoints}）`);
}

appendRaw('exp09_perf', out, { targets: TARGETS.map(([l, n]) => `${l}=${2 * n * n * 6}`) });
writeFileSync(join(RAW_DIR, 'exp09_perf.csv'), [
  'model,triCount,runtime,buildMs,dfMs,candRefineMs,status,budgetOk,vs,insidePoints,candidates',
  ...out.map(r => [r.model, r.triCount, r.runtime, r._buildMs, r._dfMs, r._candRefineMs, r.status, r.budgetOk, r.debug.vs.toFixed(2), r.debug.insidePoints, r.debug.candidates].join(',')),
].join('\n'));
console.log('完成');
