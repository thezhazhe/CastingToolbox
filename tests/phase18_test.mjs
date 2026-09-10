// ============================================================
// PHASE 18 回归测试（23.txt 七：NO_INSIDE_POINTS 修复验证）
// 核心：以前 NO_INSIDE_POINTS 的模型现在必须真正获得内部采样点并进入热结分析；
//       正常模型不得回归；真超薄件欠采样语义（WARNING）必须保留。
// 覆盖 23.txt 七 1-8：
//   T1 大尺寸正常壁厚   T2 正常薄壁（修复前濒临）   T3 真正超薄（修复前 NO_INSIDE_POINTS）
//   T4 壳体             T5 壳体+凸台                T6 空腔结构
//   T7 非均匀壁厚       T8 复杂模型（工程文件）
// 全链路：构造/工程 STL → buildMesh → analyzeGeometry → analyzeHotspotsV3
//         → toViewResult(真实 geometry) → 断言内部点 + 状态 + 采样 WARNING 语义
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { tetMC, BOX, subtract, union } from './helpers/stlGen.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
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
const shellWithBoss = (L, W, H, w, boss) => union(
  shell(L, W, H, w),
  BOX([-boss / 2, -boss / 2, H / 2 - w], [boss / 2, boss / 2, H / 2 - w + boss]),
);
/** 空腔结构：开盖箱体（腔体四周留壁，底面开口） */
const cavityBox = (L, W, H, w) => (p) => {
  const outer = BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2])(p);
  const inner = BOX([-(L / 2 - w), -(W / 2 - w), -H / 2 - 1], [L / 2 - w, W / 2 - w, H / 2 - w])(p);
  return Math.max(outer, -inner);
};
/** 非均匀壁厚：薄板 + 中部厚区 */
const steppedPlate = (L, W, t, stepW, stepH) => union(
  BOX([-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]),
  BOX([-stepW / 2, -stepW / 2, t / 2], [stepW / 2, stepW / 2, t / 2 + stepH]),
);

/** 全链路：真实 geometry 进 Adapter，返回 view + geometry + 粗采样统计 */
function run(mesh) {
  const { geometry } = buildMesh(mesh);
  const g = analyzeGeometry(mesh, geometry);
  const raw = analyzeHotspotsV3(mesh, geometry);
  const view = toViewResult(raw, { wallMax: g.wallMax, wallMain: g.wallMain, wallAvg: g.wallAvg });
  const coarse = raw.debug?.coarse || {};
  return { view, g, coarse };
}

const NO_INSIDE = 'INSUFFICIENT_RESOLUTION';

export const tests = [
  {
    name: 'P18-T1 大尺寸正常壁厚（2m 壳壁 30mm）：内部点充足 + 进入热结分析',
    fn() {
      const L = 2000, W = 1200, H = 800, w = 30;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { view, coarse } = run(meshOf(shell(L, W, H, w), b, L, w));
      assert(coarse.pts > 0, `2m 壳壁 30mm 必须获得内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
      assert(view.sampling.level !== 'failed', `正常大件不得 failed，实际 ${view.sampling.level}`);
    },
  },
  {
    name: 'P18-T2 正常薄壁（2m 壳壁 10mm，修复前仅 124 点濒临）：获得充足内部点',
    fn() {
      const L = 2000, W = 1200, H = 800, w = 10;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { view, coarse } = run(meshOf(shell(L, W, H, w), b, L, w));
      // 修复前：16³ 探测 0 落点 → fallback → 主网格 80³ 仅 124 点（濒临 NO_INSIDE_POINTS）
      assert(coarse.pts >= 1000, `2m 壳壁 10mm 修复后应获充足内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
    },
  },
  {
    name: 'P18-T3 真正超薄（2m 壳壁 5mm，修复前 0 内部点 NO_INSIDE_POINTS）：获得内部点但仍报采样不足',
    fn() {
      const L = 2000, W = 1200, H = 800, w = 5;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { view, coarse } = run(meshOf(shell(L, W, H, w), b, L, w));
      // 修复前：16³ 探测 0 点 → fallback vs=25mm > 壁 5mm → 主网格 0 内部点 → NO_INSIDE_POINTS
      assert(coarse.pts > 0, `2m 壳壁 5mm 修复后必须真正获得内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
      // 真超薄欠采样语义必须保留（23.txt 六：能获得内部点但覆盖有限 → 仍 WARNING）
      assert(view.sampling.warning === true, '真超薄件必须仍产生采样 WARNING');
      assert(view.sampling.level === 'resolution' || view.sampling.level === 'failed',
        `应报 resolution/failed，实际 ${view.sampling.level}`);
    },
  },
  {
    name: 'P18-T4 壳体（1m 壳壁 20mm）：不回归',
    fn() {
      const L = 1000, W = 800, H = 600, w = 20;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { view, coarse } = run(meshOf(shell(L, W, H, w), b, L, w));
      assert(coarse.pts > 1000, `壳体应获充足内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
      assert(view.sampling.level === 'ok' || view.sampling.level === 'local_thin',
        `主体 20mm 壳不得判整体采样不足，实际 ${view.sampling.level}`);
    },
  },
  {
    name: 'P18-T5 壳体+凸台（1m 壳壁 10mm + 80mm boss）：内部点 + 热结',
    fn() {
      const L = 1000, W = 800, H = 600, w = 10, boss = 80;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { view, coarse } = run(meshOf(shellWithBoss(L, W, H, w, boss), b, L, w));
      assert(coarse.pts > 0, `壳+凸台应获内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
      assert(view.hotspots.length >= 1, `boss 凸台应检出热结，实际 ${view.hotspots.length} 个`);
    },
  },
  {
    name: 'P18-T6 空腔结构（1m 开盖箱壁 10mm）：内部点 + 进入分析',
    fn() {
      const L = 1000, W = 800, H = 400, w = 10;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const { view, coarse } = run(meshOf(cavityBox(L, W, H, w), b, L, w));
      assert(coarse.pts > 0, `空腔箱应获内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
    },
  },
  {
    name: 'P18-T7 非均匀壁厚（1m 板 10mm + 中部 40mm 厚区）：内部点 + 进入分析',
    fn() {
      const L = 1000, W = 800, t = 10;
      const b = [[-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]];
      const { view, coarse } = run(meshOf(steppedPlate(L, W, t, 400, 30), b, L, t));
      assert(coarse.pts > 0, `非均匀壁厚应获内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
    },
  },
  {
    name: 'P18-T8 复杂模型（工程 t02：10mm 薄板 + 60mm boss）：不回归',
    fn() {
      const mesh = parseSTL(readFileSync(join(HERE, 'engineering-generated', 'models', 't02_thin10_boss60', 'model.stl')));
      const { view, coarse } = run(mesh);
      assert(coarse.pts > 0, `t02 应获内部点，实际 pts=${coarse.pts}`);
      assert(view.status !== NO_INSIDE, `不得 NO_INSIDE_POINTS，实际 status=${view.status}`);
      assert(view.hotspots.length >= 1, `t02 的 boss 应检出热结，实际 ${view.hotspots.length} 个`);
    },
  },
];
