// ============================================================
// PHASE 28.3-F：浇注温度推荐（企业 Excel 壁厚表 + 液相线公式）
// 锚点验证：
//   wall=37.5 → 1320℃（Excel「查表」R75 案例值）
//   TL = 1650 − 124.5C − 26.7Si − 65.4P（B 级公式）
// ============================================================
import { pourTempByWall, recommendPourTemp } from '../calcs/pourTemp.js';
import { liquidus } from '../data/pour_temp.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

export const tests = [
  {
    name: '28.3-F-1 真实案例锚点：37.5mm → 1320℃（Excel R75 一致）',
    fn: () => {
      assert(close(pourTempByWall(37.5), 1320), `37.5mm 应为 1320℃（实际 ${pourTempByWall(37.5)}）`);
      assert(pourTempByWall(5) === 1470, '5mm = 1470（档位点）');
      assert(pourTempByWall(250) === 1270, '250mm = 1270（档位点）');
      assert(pourTempByWall(100) === 1277, '100mm = 1277（档位点）');
    },
  },
  {
    name: '28.3-F-2 液相线公式（B 级）：HT300 典型成分验证合理性',
    fn: () => {
      const TL = liquidus(3.2, 1.8, 0.15);   // HT300 典型成分 wt%
      assert(close(TL, 1650 - 124.5 * 3.2 - 26.7 * 1.8 - 65.4 * 0.15), '公式复算一致');
      assert(TL > 1150 && TL < 1230, `灰铁液相线应在 ~1150-1230（实际 ${TL}）`);
      // 成分灵敏度：C 增加 0.1 → TL 降 12.45℃
      assert(close(liquidus(3.3, 1.8, 0.15) - TL, -12.45), 'C 灵敏度正确');
    },
  },
  {
    name: '28.3-F-3 推荐入口：铸铁输出范围 + 来源标注；无成分时仅壁厚表',
    fn: () => {
      const r = recommendPourTemp({ family: '灰铁', wall: 37.5 });
      assert(r.byWall === 1320, 'byWall 应为 1320');
      assert(r.byLiquidus === null, '无成分 → byLiquidus null（不强造）');
      assert(Array.isArray(r.range) && r.range[0] < 1320 && r.range[1] > 1320, '范围含壁厚值');
      assert(r.source.includes('C 级') || r.source.includes('企业'), '来源标注');
      assert(r.note.includes('企业经验参数'), '明确标注企业经验参数');
      // 有成分：byLiquidus = TL + 50（企业过热度）
      const r2 = recommendPourTemp({ family: '球铁', wall: 20, C: 3.6, Si: 2.4, P: 0.05 });
      assert(r2.byLiquidus != null && r2.overheat === 50, '有成分 → TL+50（企业过热度）');
    },
  },
  {
    name: '28.3-F-4 非铸铁：明确提示无企业数据，不猜测',
    fn: () => {
      const r = recommendPourTemp({ family: '铸钢', wall: 30 });
      assert(r.byWall === null && r.range === null, '铸钢无企业表 → null');
      assert(r.note.includes('无企业浇注温度表'), '明确提示');
      const r2 = recommendPourTemp({ family: '铝合金', wall: 8 });
      assert(r2.byWall === null, '铝同样处理');
    },
  },
];
