// ============================================================
// PHASE V2.0-06A · 场 argmax 逐点诊断（**只读**）
//
// 问题：关掉 ceiling 后，窗口 V/A 的最大值出现在哪个点？该点的 R / V / A / d 是多少？
//   —— 用来判定「未封顶窗口 V/A 是否可信」，即 ceiling 是在**压制虚高**还是在
//      **削掉正确的截面模数**。这是 112.txt §三"不得把不同物理量直接比较"的落地。
//
// 只用公开 API：coarseSample / buildModulusField / mesh3d.distanceToSurface。
// ============================================================
import { buildMesh, distanceToSurface } from '../../js/engine/mesh3d.js';
import { coarseSample } from '../../js/engine/v3/sampling.js';
import { buildModulusField } from '../../js/engine/v3/modulusField.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';

const NO_CEIL = { ...V3_DEFAULTS, modulusCeilRatio: 1e9 };

const CASES = [
  { kind: 'uniformPlate',    params: { l: 300, w: 200, t: 40 } },
  { kind: 'uniformCube',     params: { size: 100 } },
  { kind: 'uniformCylinder', params: { r: 40, h: 120 } },
  { kind: 'thickEnd',        params: undefined },
  { kind: 'pvpPair',         params: { tA: 30, tB: 30, v: 15 } },
];

const f3 = (v) => (+v.toFixed(3));

for (const c of CASES) {
  const { mesh } = generate(c.kind, c.params);
  const { geometry } = buildMesh(mesh);
  const s = coarseSample(mesh, geometry, V3_DEFAULTS);
  const capped = buildModulusField(s.vox, s, NO_CEIL, 1.0);   // 未封顶（实验旋钮）

  let bi = 0;
  for (let t = 1; t < capped.M.length; t++) if (capped.M[t] > capped.M[bi]) bi = t;
  const p = s.pts[bi];
  const d = distanceToSurface(geometry, [p], 1e4)[0];

  // 全部未封顶点的分布（看虚高是普遍现象还是个别点）
  const vals = Array.from(capped.M).sort((a, b) => b - a);
  const p50 = vals[Math.floor(vals.length * 0.5)], p90 = vals[Math.floor(vals.length * 0.1)];
  const above = vals.filter(v => d && v > (1 / 3) * d * 1.05).length;

  console.log(`\n── ${c.kind} ──  vs=${f3(s.vox.vs)}  采样点=${capped.M.length}  内点=${s.pts.length}`);
  console.log(`  未封顶 argmax:  M=${f3(capped.M[bi])}  pos=[${p.map(f3)}]  d=${f3(d)}  R=${f3(capped.R[bi])}  V=${f3(capped.V[bi])}  A=${f3(capped.A[bi])}  → V/A 自身=${f3(capped.V[bi] / capped.A[bi])}`);
  console.log(`  该点 (1/3)d = ${f3(d / 3)}   比值 V/A ÷ [(1/3)d] = ${f3(capped.M[bi] / (d / 3))}`);
  console.log(`  未封顶点分位: top=${f3(vals[0])}  p10=${f3(p90)}  p50=${f3(p50)}   min=${f3(vals[vals.length - 1])}`);
  console.log(`  未封顶值 > 1.05×[(1/3)·argmax_d] 的点数 = ${above} / ${vals.length}`);
}
