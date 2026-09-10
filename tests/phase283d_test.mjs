// ============================================================
// PHASE 28.3-D：过滤网校核（企业 Excel「过滤网标准」C 级数据）
//   - 数据完整性：9 规格、莫来石仅球铁、成本数据不引入
//   - checkFilter：灰铁/球铁过流量校核；铸钢/铝/铜无标准 → null（明确提示而非静默）
//   - recommendFilter：最小满足规格（低成本优先）
// ============================================================
import { FILTER_SPECS } from '../data/filter_calc.js';
import { checkFilter, recommendFilter } from '../calcs/filter.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: '28.3-D-1 数据完整性：9 规格 + 莫来石仅球铁 + 无价格字段',
    fn: () => {
      assert(FILTER_SPECS.length === 9, `应 9 规格（实际 ${FILTER_SPECS.length}）`);
      assert(FILTER_SPECS.every(s => !('price' in s) && !('cost' in s)), '成本数据不得引入');
      const mul = FILTER_SPECS.find(s => s.id === 'mul_150');
      assert(mul.htCapacity === null && mul.qtCapacity === 2200, '莫来石灰铁无标准、球铁 2200');
      const sic = FILTER_SPECS.find(s => s.id === 'sic_100');
      assert(sic.htCapacity === 400 && sic.qtCapacity === 200, '碳化硅 100 灰铁 400/球铁 200（企业表 R18）');
    },
  },
  {
    name: '28.3-D-2 checkFilter：灰铁/球铁校核正确',
    fn: () => {
      const ok = checkFilter(350, '灰铁', 'sic_100');        // 350 ≤ 400 ✓
      assert(ok && ok.ok === true && ok.capacity === 400, `灰铁 350kg 应通过 sic_100（实际 ${JSON.stringify(ok)}）`);
      const over = checkFilter(500, '灰铁', 'sic_100');      // 500 > 400 ✗
      assert(over && over.ok === false, '灰铁 500kg 应超 sic_100');
      const overPct = checkFilter(500, '球铁', 'sic_100');   // 500 > 200 ✗
      assert(overPct && overPct.ok === false && Math.abs(overPct.usedPct - 250) < 1e-9, '球铁 500kg vs 200 应 250%');
      const qtOk = checkFilter(190, '球铁', 'sic_100');
      assert(qtOk && qtOk.ok === true, '球铁 190kg 应通过 sic_100');
    },
  },
  {
    name: '28.3-D-3 checkFilter：材料/型号不适用 → null（明确提示，不静默）',
    fn: () => {
      assert(checkFilter(300, '铸钢', 'sic_100') === null, '铸钢无企业标准 → null');
      assert(checkFilter(300, '铝合金', 'sic_100') === null, '铝无企业标准 → null');
      assert(checkFilter(300, '灰铁', 'mul_150') === null, '莫来石×灰铁不适用 → null');
      assert(checkFilter(300, '灰铁', 'no_such') === null, '未知型号 → null');
    },
  },
  {
    name: '28.3-D-4 recommendFilter：最小满足规格（低成本优先）',
    fn: () => {
      const r350 = recommendFilter(350, '灰铁');
      assert(r350 && r350.rec.id === 'sic_100', '灰铁 350 → sic_100（400）');
      const r500 = recommendFilter(500, '灰铁');
      assert(r500 && r500.rec.id === 'sic_120', '灰铁 500 → sic_120（600）');
      const r900 = recommendFilter(900, '灰铁');
      assert(r900 && r900.rec.id === 'sic_150', '灰铁 900 → sic_150（800 不够 → 1200 档首个）');
      const big = recommendFilter(2000, '灰铁');
      assert(big && big.rec === null, '灰铁 2000 超全部规格 → rec=null（提示人工处理）');
      const qt1500 = recommendFilter(1500, '球铁');
      assert(qt1500 && qt1500.rec.id === 'mul_150', '球铁 1500 → mul_150（2200）');
      assert(recommendFilter(300, '铸钢') === null, '铸钢无标准 → null');
    },
  },
];
