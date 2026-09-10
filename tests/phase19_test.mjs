// ============================================================
// PHASE 19 回归测试（24.txt：距离场无有效采样根因修复验证）
// 触发链：designCenter → diagnoseSTL → buildDistanceField(V2 48³/96³) → thicknessStats
//   → INSUFFICIENT_NO_SAMPLE「距离场无有效采样：壁厚可能小于网格采样极限」
// 修复：distanceField 多级升级+多相位合并（maxResolution 96→256）+ wallMain p95 修正
// 验证：
//   T1 原触发模型（3m 壳壁 25mm）不再「无有效采样」，获得内部点与壁厚
//   T2 大件常规壁厚（2m 壳 15/20mm）恢复内部点 + wallMain 接近真实
//   T3 thicknessStats 字段名 bug 回归：≥2 有效采样的模型完整跑通不崩
//   T4 正常工程模型零回归（距离场 OK + wallMain 不变）
//   T5 1m 壳 20mm 全链：diagnoseSTL OK + 采样 WARNING 不误报整体采样不足
//   T6 0 有效采样语义保留（不伪造）：thicknessStats 纯函数仍返回 INSUFFICIENT_NO_SAMPLE
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { tetMC, BOX, subtract } from './helpers/stlGen.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { diagnoseSTL, thicknessStats } from '../js/engine/stlDiagnostic.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { pickRes } from './tools/hotspotGeometryGenerator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];

function meshOf(sdf, bounds, mdim, minFeature) {
  const mesh = { vertices: tetMC(sdf, pad2(bounds), pickRes(mdim, minFeature)), triCount: 0 };
  mesh.triCount = mesh.vertices.length / 9;
  return mesh;
}
const shell = (L, W, H, w) => subtract(
  BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]),
  BOX([-(L / 2 - w), -(W / 2 - w), -(H / 2 - w)], [L / 2 - w, W / 2 - w, H / 2 - w]),
);

/** 全链：geometry + V3 + diagnoseSTL（UI 实际出口） */
function run(mesh) {
  const { geometry } = buildMesh(mesh);
  const g = analyzeGeometry(mesh, geometry);
  const v3 = analyzeHotspotsV3(mesh, geometry, {});
  const view = toViewResult(v3, { wallMax: g.wallMax, wallMain: g.wallMain, wallAvg: g.wallAvg });
  const diag = diagnoseSTL(mesh, geometry, v3);
  return { g, view, diag, coarse: v3.debug?.coarse || {} };
}

export const tests = [
  {
    name: 'P19-T1 原触发模型（3m 壳壁 25mm）：不再「距离场无有效采样」',
    fn() {
      const L = 3000, W = 2000, H = 1200, w = 25;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { diag, g } = run(meshOf(shell(L, W, H, w), b, L, w));
      // 修复前：V2 距离场 48³ vs=62.5mm > 壁 25mm → 0 内部点 → INSUFFICIENT_NO_SAMPLE
      assert(diag.thickness.status !== 'INSUFFICIENT_NO_SAMPLE',
        `3m 壳壁 25mm 不得再报「距离场无有效采样」，实际 ${diag.thickness.status}（${diag.thickness.reason}）`);
      assert(diag.distanceField.insidePoints > 0, `距离场必须获得内部点，实际 ${diag.distanceField.insidePoints}`);
      assert(diag.thickness.samples > 0, `必须获得有效距离采样，实际 ${diag.thickness.samples}`);
      assert(g.wallMax > 0, `geometry 壁厚必须有效，实际 wallMax=${g.wallMax}`);
    },
  },
  {
    name: 'P19-T2 大件常规壁厚（2m 壳 15/20mm）：内部点恢复 + wallMain 接近真实',
    fn() {
      for (const w of [15, 20]) {
        const L = 2000, W = 1200, H = 800;
        const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
        const { diag, g } = run(meshOf(shell(L, W, H, w), b, L, w));
        assert(diag.thickness.status !== 'INSUFFICIENT_NO_SAMPLE',
          `2m 壳壁 ${w}mm 不得报「无有效采样」，实际 ${diag.thickness.status}`);
        assert(diag.distanceField.insidePoints > 1000, `内部点应充足，实际 ${diag.distanceField.insidePoints}`);
        // 修复前 wallMain=4.7（48³ 相位低估一半）；修复后 ≥ 0.7×真实（MC 波纹下界）
        assert(g.wallMain >= 0.7 * w,
          `wallMain 应接近真实 ${w}mm（MC 波纹容忍 0.7×），实际 ${g.wallMain.toFixed(1)}`);
      }
    },
  },
  {
    name: 'P19-T3 thicknessStats 字段名 bug 回归：正常模型诊断完整跑通（含 thickSamples）',
    fn() {
      // 修复前 stlDiagnostic.js:71 p.p[0] 笔误 → 任何 ≥2 有效采样模型崩溃
      const mesh = parseSTL(readFileSync(join(HERE, 'engineering-generated', 'models', 't19_valveLike', 'model.stl')));
      const { geometry } = buildMesh(mesh);
      const v3 = analyzeHotspotsV3(mesh, geometry, {});
      const diag = diagnoseSTL(mesh, geometry, v3);
      assert(diag.thickness.status === 'OK', `t19 距离场应 OK，实际 ${diag.thickness.status}`);
      assert(Array.isArray(diag.thickness.thickSamples) && diag.thickness.thickSamples.length > 0,
        `厚壁代表采样点应存在，实际 ${diag.thickness.thickSamples?.length}`);
      const s = diag.thickness.thickSamples[0];
      assert(Array.isArray(s.position) && s.position.length === 3 && s.thickness > 0,
        `采样点结构应正确（position/厚度），实际 ${JSON.stringify(s)}`);
    },
  },
  {
    name: 'P19-T4 正常工程模型零回归（t20 组合箱体）',
    fn() {
      const mesh = parseSTL(readFileSync(join(HERE, 'engineering-generated', 'models', 't20_combinedBox', 'model.stl')));
      const { diag, g } = run(mesh);
      assert(diag.thickness.status === 'OK', `t20 距离场应 OK，实际 ${diag.thickness.status}`);
      assert(g.wallMain >= 50, `t20 主体壁厚应保持（>50mm 厚结构），实际 ${g.wallMain.toFixed(1)}`);
      assert(diag.thickness.samples > 1000, `有效采样应充足，实际 ${diag.thickness.samples}`);
    },
  },
  {
    name: 'P19-T5 1m 壳壁 20mm 全链：诊断 OK + 采样 WARNING 不误报整体采样不足',
    fn() {
      const L = 1000, W = 800, H = 600, w = 20;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { diag, view } = run(meshOf(shell(L, W, H, w), b, L, w));
      assert(diag.thickness.status !== 'INSUFFICIENT_NO_SAMPLE', `1m 壳壁 20mm 不得报「无有效采样」`);
      assert(view.sampling.level === 'ok' || view.sampling.level === 'local_thin',
        `主体 20mm 大件不得误报整体采样不足，实际 ${view.sampling.level}（${view.sampling.detail || ''}）`);
    },
  },
  {
    name: 'P19-T6 真 0 有效采样语义保留（不伪造）：thicknessStats 纯函数',
    fn() {
      const ts = thicknessStats({ dists: [], insideIdx: [], pts: [], vs: 10, bounds: { size: [1000, 800, 600] } });
      assert(ts.status === 'INSUFFICIENT_NO_SAMPLE', `0 采样仍必须报 INSUFFICIENT_NO_SAMPLE，实际 ${ts.status}`);
      assert(ts.samples === 0, `samples 必须为 0，实际 ${ts.samples}`);
    },
  },
];
