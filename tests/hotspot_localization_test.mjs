// ============================================================
// V2.2 PHASE 2 回归：宽平台代表点定位（0.95 连通域质心）
// 断言：定位误差 < V2.1 实测值的一半（平台边缘峰 → 平台质心）
//   V2.1 实测：bossOnPlate 11.8 / tShape 28 / thickEnd 31 / twoAdjacentBosses 22-25
// 注意：thickOnThin = bossOnPlate 旧名（板+凸台），由 bossOnPlate 覆盖
// ============================================================
import { generate } from './tools/hotspotGeometryGenerator.mjs';
import { runAnalyze, positionError } from './tools/validationCommon.mjs';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// [model, V2.1 实测误差, 断言阈值（V2.1 一半）]
const CASES = [
  ['bossOnPlate', 11.8, 6],
  ['tShape', 28, 14],
  ['thickEnd', 31, 15],
  ['twoAdjacentBosses', 22, 11],
];

export const tests = [
  ...CASES.map(([model, v21, threshold]) => ({
    name: `V2.2 定位：${model} 误差 < ${threshold}mm（V2.1 ${v21}mm → 平台质心）`,
    fn: () => {
      const { mesh, gt } = generate(model);
      const r = runAnalyze(mesh);
      assert(r.status === 'ok', `${model} 状态 ${r.status}（${r.reason || ''}）`);
      assert(r.hotspots.length >= 1, `${model} 应至少 1 个热结`);
      const det = r.hotspots[0];
      const e = gt.expectedHotspots[0] || {};
      const err = positionError(det, e);
      assert(err !== null, `${model} 无法计算定位误差`);
      assert(err < threshold,
        `${model} 定位误差 ${err.toFixed(2)}mm ≥ 阈值 ${threshold}mm（V2.1 ${v21}mm）`);
      // 代表点必须与原始峰区分（平台质心 ≠ 边缘峰）且保留 peakPosition
      assert(Array.isArray(det.peakPosition) && det.peakPosition.length === 3, '应保留 peakPosition');
      assert(Array.isArray(det.representativePosition) && det.representativePosition.length === 3, '应输出 representativePosition');
    },
  })),
  {
    name: 'V2.2 定位：pvpPair（twoAdjacentBosses 别名）两柱 1.3mm 级（修复前 22-25mm）',
    fn: () => {
      const { mesh, gt } = generate('pvpPair');
      const r = runAnalyze(mesh);
      assert(r.hotspots.length >= 1, 'pvpPair 应至少 1 个热结');
      const det = r.hotspots[0];
      const e = gt.expectedHotspots[0] || {};
      const err = positionError(det, e);
      assert(err !== null && err < 11, `pvpPair 定位误差 ${err?.toFixed(2)}mm ≥ 11mm`);
    },
  },
];
