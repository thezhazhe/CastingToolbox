// ============================================================
// PHASE V2.0-03（101.txt）：extractRegion regionVolume 的 stride³ 确定性修复
//   T1  同一物理区域、不同采样 stride（1/2/3/5）→ 实际几何体积必须相同
//   T2  修复不改变 region 的非体积输出（点数/连通/meanM/peakM）
//   T3  无 stride 字段的旧式 sample 仍可用（退化为 1）
// 设计意图：只证明「改变采样 stride 不应改变同一物理区域的几何体积」，
//   不测试算法效果、不涉及任何阈值/公式。
// ============================================================
import { extractRegion } from '../js/engine/v3/peakRegion.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/**
 * 构造**同一个物理区域**（gs³ 个 voxel，边长 vs）在给定 stride 下的采样视图：
 *   - stride=1 时每个 voxel 一个采样点；stride=s 时每 s 格一个采样点。
 *   - 两种视图覆盖的空间完全相同（同 min/max、同 vs），仅采样密度不同。
 *   - 所有点 inside 且 Raw = V/A = 10（全域均匀，不低于任何阈值）。
 * @returns {{sample, field, truthVolume}}
 */
function buildSameRegion(gs, stride, vs) {
  const insideIdx = [];
  for (let i = 0; i < gs; i += stride) for (let j = 0; j < gs; j += stride) for (let k = 0; k < gs; k += stride) {
    insideIdx.push((i * gs + j) * gs + k);
  }
  const gridToPt = new Int32Array(gs * gs * gs).fill(-1);
  const pts = [];
  for (let t = 0; t < insideIdx.length; t++) {
    gridToPt[insideIdx[t]] = t;
    const gi = insideIdx[t];
    const i = Math.floor(gi / (gs * gs)), rest = gi % (gs * gs), j = Math.floor(rest / gs), k = rest % gs;
    pts.push([(i + 0.5) * vs, (j + 0.5) * vs, (k + 0.5) * vs]);
  }
  const n = pts.length;
  return {
    sample: { pts, gridToPt, gs, insideIdx, stride, vs },
    field: { M: new Float64Array(n).fill(10), V: new Float64Array(n).fill(1000), A: new Float64Array(n).fill(100) },
    truthVolume: gs ** 3 * vs ** 3,
  };
}

const GS = 30, VS = 1.0;   // 物理体积 = 30³ × 1³ = 27000 mm³

export const tests = [
  {
    name: 'V2.0-03-T1 regionVolume 与采样 stride 无关（同一物理区域 → 同一体积）',
    fn: () => {
      const truth = GS ** 3 * VS ** 3;   // 27000 mm³
      const got = {};
      for (const stride of [1, 2, 3, 5]) {
        const { sample, field } = buildSameRegion(GS, stride, VS);
        const r = extractRegion(field.M, sample, 0, {}, field);
        got[stride] = r.volume;
        assert(Math.abs(r.volume - truth) < 1e-6,
          `stride=${stride} 区域体积应为 ${truth} mm³，实得 ${r.volume} mm³（采样点 ${sample.pts.length} 个）`);
      }
      // 修复前：stride=2/3/5 分别只有 truth 的 1/8、1/27、1/125
      assert(Math.abs(got[1] - got[5]) < 1e-6, `stride=1 与 stride=5 必须得到同一体积（${got[1]} vs ${got[5]}）`);
    },
  },
  {
    name: 'V2.0-03-T2 修复只改体积尺度：meanM/maxM 严格不变，regionArea 仍为派生量',
    fn: () => {
      const a = buildSameRegion(GS, 1, VS);
      const b = buildSameRegion(GS, 3, VS);
      const ra = extractRegion(a.field.M, a.sample, 0, {}, a.field);
      const rb = extractRegion(b.field.M, b.sample, 0, {}, b.field);
      // 采样点数由采样密度决定（不同视图本就不同）——不是本修复改的量
      assert(ra.pts.length === GS ** 3, `stride=1 点数应为 ${GS ** 3}，实得 ${ra.pts.length}`);
      assert(rb.pts.length === (GS / 3) ** 3, `stride=3 点数应为 ${(GS / 3) ** 3}，实得 ${rb.pts.length}`);
      // 均匀场下两项 M 统计量与 stride 无关（修复前后都成立）
      assert(Math.abs(ra.meanM - rb.meanM) < 1e-9, `meanM 应一致（${ra.meanM} vs ${rb.meanM}）`);
      assert(Math.abs(ra.maxM - rb.maxM) < 1e-9, `maxM 应一致（${ra.maxM} vs ${rb.maxM}）`);
      // 质心：stride>1 时采样格点整体偏移 (stride-1)/2 格，故质心允许 ≤ 半个采样间距的偏移
      //   —— 这是分格采样的固有性质（修复前后一致），不是本修复引入的。
      const halfSpacing = 3 * VS / 2;
      for (let ax = 0; ax < 3; ax++) {
        assert(Math.abs(ra.centroid[ax] - rb.centroid[ax]) <= halfSpacing + 1e-9,
          `centroid[${ax}] 偏移应 ≤ 半格（${ra.centroid[ax]} vs ${rb.centroid[ax]}）`);
      }
      // regionArea 仍是 volume/meanM 的派生量（不是独立测量）——随体积一并恢复
      assert(Math.abs(ra.regionArea - ra.volume / ra.meanM) < 1e-6, 'regionArea 仍为 volume/meanM 的派生量');
      assert(Math.abs(rb.regionArea - rb.volume / rb.meanM) < 1e-6, 'regionArea 仍为 volume/meanM 的派生量');
      assert(Math.abs(ra.regionArea - rb.regionArea) < 1e-6, `regionArea 也应与 stride 无关（${ra.regionArea} vs ${rb.regionArea}）`);
    },
  },
  {
    name: 'V2.0-03-T3 无 stride 字段的旧式 sample 退化为 1（不破坏兼容路径）',
    fn: () => {
      const { sample, field, truthVolume } = buildSameRegion(GS, 1, VS);
      delete sample.stride;
      const r = extractRegion(field.M, sample, 0, {}, field);
      assert(Math.abs(r.volume - truthVolume) < 1e-6,
        `无 stride 时应退化为 vs³（期望 ${truthVolume}，实得 ${r.volume}）`);
    },
  },
];
