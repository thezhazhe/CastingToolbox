// ============================================================
// PHASE 17 回归测试（21.txt 八：Test 1-6）
// 采样 WARNING 分级修正验证：
//   Test 1  正常厚壁（500~1000mm、20mm）不出现"模型过薄"
//   Test 2  真实薄壁（2~3mm、500~1000mm）仍产生 WARNING
//   Test 3  主体正常 + 局部薄特征（区分 local_thin，不判整个模型过薄）
//   Test 4  探测 fallback 被识别，不把兜底值当真实壁厚
//   Test 5  NO_INSIDE_POINTS 仍必须报警
//   Test 6  1000mm+、20~30mm 主体大型铸件不误报（本次真实问题回归）
// 全链路：构造模型 → buildMesh → analyzeGeometry → analyzeHotspotsV3
//         → toViewResult(真实 geometry) → 断言 sampling.level
// 构造模型均为 tetMC 水密网格（与工程测试集同源），内存直传。
// ============================================================
import { tetMC, BOX, subtract } from './helpers/stlGen.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { pickRes } from './tools/hotspotGeometryGenerator.mjs';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];

/** SDF → 网格（tetMC + padding，同 phase15/16-A） */
function meshOf(sdf, bounds, mdim, minFeature) {
  const mesh = { vertices: tetMC(sdf, pad2(bounds), pickRes(mdim, minFeature)), triCount: 0 };
  mesh.triCount = mesh.vertices.length / 9;
  return mesh;
}

/** 壳：外 L×W×H，壁厚 w（差集构造，表面干净） */
const shell = (L, W, H, w) => subtract(
  BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]),
  BOX([-(L / 2 - w), -(W / 2 - w), -(H / 2 - w)], [L / 2 - w, W / 2 - w, H / 2 - w]),
);
/** 板 + 中部浅槽（槽底薄区）：主体厚 t，槽底剩 w 薄 */
const plateWithSlot = (L, W, t, w, slotW) => subtract(
  BOX([-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]),
  BOX([-slotW / 2, -slotW / 2, t / 2 - (t - w)], [slotW / 2, slotW / 2, t / 2 + 1]),
);
/** 全链路：真实 geometry 进 Adapter */
function run(mesh) {
  const { geometry } = buildMesh(mesh);
  const g = analyzeGeometry(mesh, geometry);
  const raw = analyzeHotspotsV3(mesh, geometry);
  const view = toViewResult(raw, { wallMax: g.wallMax, wallMain: g.wallMain, wallAvg: g.wallAvg });
  return { view, g };
}

export const tests = [
  {
    name: 'P17-T1 正常厚壁 500~1000mm 主体 20mm：不出现"模型过薄"（level≠resolution/failed）',
    fn() {
      const L = 1000, W = 800, H = 600, w = 20;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const mesh = meshOf(shell(L, W, H, w), b, L, w);
      const { view, g } = run(mesh);
      assert(g.wallMain >= 15, `geometry 主体壁厚应≈20，实际 wallMain=${g.wallMain.toFixed(1)}`);
      assert(view.sampling.level === 'ok' || view.sampling.level === 'local_thin',
        `主体 20mm 大件不得判采样不足/无法分析，实际 level=${view.sampling.level}：${view.sampling.detail || ''}`);
      assert(!view.sampling.detail || !view.sampling.detail.includes('过薄'), '文案不得含"过薄"');
    },
  },
  {
    name: 'P17-T2 真实薄壁（1m 壳壁 3mm）：仍产生 WARNING（failed/无法可靠分析）',
    fn() {
      const L = 1000, W = 800, H = 600, w = 3;
      const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
      const mesh = meshOf(shell(L, W, H, w), b, L, w);
      const { view } = run(mesh);
      assert(view.sampling.warning === true, `真薄壁必须报警，实际 ${JSON.stringify(view.sampling)}`);
      assert(view.sampling.level === 'failed' || view.sampling.level === 'resolution',
        `真薄壁应为 failed/resolution，实际 ${view.sampling.level}`);
    },
  },
  {
    name: 'P17-T3 主体 20mm + 局部 4mm 薄区：不判整个模型过薄，区分 local_thin',
    fn() {
      const L = 500, W = 400, t = 20, w = 4, slotW = 200;
      const b = [[-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]];
      const mesh = meshOf(plateWithSlot(L, W, t, w, slotW), b, L, w);
      const { view, g } = run(mesh);
      assert(view.sampling.level === 'local_thin' || view.sampling.level === 'ok',
        `主体正常+局部薄不得判"整体过薄"，实际 level=${view.sampling.level}：${view.sampling.detail || ''}`);
      if (view.sampling.level === 'local_thin') {
        assert(view.sampling.bodyWall != null && view.sampling.bodyWall >= 10,
          `local_thin 应带主体壁厚（≥10mm），实际 bodyWall=${view.sampling.bodyWall}`);
        assert(view.sampling.minWall != null && view.sampling.minWall <= 8,
          `local_thin 应带局部特征（≤8mm），实际 minWall=${view.sampling.minWall}`);
      }
    },
  },
  {
    name: 'P17-T4 1m 板 10mm：探测升级恢复真实壁厚（PHASE 18 后 fallback 被多级探测取代）',
    fn() {
      const L = 1000, W = 1000, t = 10;
      const b = [[-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]];
      const mesh = meshOf(BOX(b[0], b[1]), b, L, t);
      const { view, g } = run(mesh);
      // PHASE 18 前：16³ 探测 z 方向无落点 → estMinWall=mdim/40（fallback）→ minWallReliable=false。
      // PHASE 18 后：探测升级（128³ 格距 7.8mm < 壁 10mm）采到真实壁厚 → estMinWall 可信，
      //   且主网格成功获得内部点——fallback 路径被修复取代（23.txt 目标：正常 STL 真正获得内部点）。
      assert(view.sampling.minWallReliable === true,
        `探测升级后 estMinWall 应来自真实 char（minWallReliable=true），实际 ${view.sampling.minWallReliable}（detail: ${view.sampling.detail || ''}）`);
      assert(view.sampling.level === 'resolution',
        `10mm 壁相对 1m 模型仍欠采样（主体层数<2）→ 应报采样分辨率不足，实际 ${view.sampling.level}`);
      assert(view.sampling.bodyWall != null && view.sampling.bodyWall <= 12,
        `主体壁厚应来自 geometry（≈10mm），实际 bodyWall=${view.sampling.bodyWall}`);
      assert(view.debug.v3.coarse.pts > 0,
        `修复后必须真正获得内部采样点（pts=${view.debug.v3.coarse.pts}），不得 NO_INSIDE_POINTS`);
    },
  },
  {
    name: 'P17-T5 NO_INSIDE_POINTS：必须仍然报警（level=failed）',
    fn() {
      const fakeV3 = {
        status: 'INSUFFICIENT_RESOLUTION', reason: 'no_inside_points', hotspots: [], audit: [],
        metrics: {}, debug: { coarse: { gs: 80, vs: 12.5, estMinWall: 25, pts: 0 } },
      };
      const r = toViewResult(fakeV3, { wallMax: 3, wallMain: 3, wallAvg: 3 });
      assert(r.sampling.warning === true, 'NO_INSIDE_POINTS 必须报警');
      assert(r.sampling.level === 'failed', `应分级为 failed，实际 ${r.sampling.level}`);
      assert(r.sampling.detail && r.sampling.detail.includes('无法可靠'), 'failed 文案应说明无法可靠分析');
    },
  },
  {
    name: 'P17-T6 1000mm+ 主体 20~30mm 大型铸件：不误报（本次真实问题回归）',
    fn() {
      for (const w of [20, 30]) {
        const L = 1000, W = 800, H = 600;
        const b = [[-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]];
        const mesh = meshOf(shell(L, W, H, w), b, L, w);
        const { view, g } = run(mesh);
        assert(view.sampling.level !== 'resolution' && view.sampling.level !== 'failed',
          `1m 壳壁 ${w}mm 不得误报采样不足/无法分析，实际 level=${view.sampling.level}：${view.sampling.detail || ''}`);
        // V2 距离场对 1m 壳的 wallMain 有已知低估（48³ 网格 vs=20.8mm，30mm 壁仅 1.4 层），
        // 本阶段目标是不误报；0.5×w 下限验证"未严重偏离主体尺度"
        assert(g.wallMain >= 0.5 * w, `geometry 主体壁厚应≥${0.5 * w}mm，实际 wallMain=${g.wallMain.toFixed(1)}`);
      }
    },
  },
];
