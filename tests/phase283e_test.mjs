// ============================================================
// PHASE 28.3-E：浇注时间查表（企业 Excel C 级数据，线性插值）
// 回归锚点（Excel 原值验证）：
//   G=120.22 → 有冒口 16.9099s / 无冒口 10.022s / 快浇 9.5392s
// ============================================================
import { pourTimeByWeight, pourTimeFast, pourTimeReference } from '../calcs/pourTimeTable.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

export const tests = [
  {
    name: '28.3-E-1 真实案例回归：G=120.22 三表与 Excel 原值一致',
    fn: () => {
      assert(close(pourTimeByWeight(120.22, true), 16.9099), `有冒口应为 16.9099（实际 ${pourTimeByWeight(120.22, true)}）`);
      assert(close(pourTimeByWeight(120.22, false), 10.022), `无冒口应为 10.022（实际 ${pourTimeByWeight(120.22, false)}）`);
      assert(close(pourTimeFast(120.22), 9.5392), `快浇应为 9.5392（实际 ${pourTimeFast(120.22)}）`);
    },
  },
  {
    name: '28.3-E-2 线性插值正确性：档位中点与端点',
    fn: () => {
      assert(pourTimeByWeight(100, true) === 16, '有冒口 100kg = 16s（档位点）');
      assert(pourTimeByWeight(200, true) === 20.5, '有冒口 200kg = 20.5s（档位点）');
      assert(pourTimeByWeight(150, true) === 18.25, '有冒口 150kg = 插值 (16+20.5)/2');
      assert(pourTimeByWeight(0, true) === 0, '0kg = 0s');
      assert(pourTimeByWeight(500, false) === 23, '无冒口 500kg = 23s（档位点）');
      assert(pourTimeByWeight(400, false) === 21.5, '无冒口 400kg = 21.5s（档位点）');
      assert(pourTimeFast(700) === 25, '快浇 700kg = 25s（分段点）');
    },
  },
  {
    name: '28.3-E-3 超界取端点（不外推）',
    fn: () => {
      assert(pourTimeByWeight(500000, true) === 256, '超大重量取端点 256s（有冒口）');
      assert(pourTimeByWeight(50, true) === 8, '50kg 在 [0,100] 段插值 = 8s（有冒口 16×0.5）');
      assert(pourTimeFast(2000000) === 120, '快浇超上限取 120s');
    },
  },
  {
    name: '28.3-E-4 参照入口：快浇/重量表输出 + 慢浇待验证标记',
    fn: () => {
      const r = pourTimeReference(120.22, true);
      assert(r.fast === 9.5392, 'fast 应有值');
      assert(close(r.wtTable, 16.9099), 'wtTable 应有值');
      assert(r.slow === null, '慢浇表数据源不明确 → null（不猜测）');
      assert(r.source.includes('C 级'), '来源标注');
    },
  },
];
