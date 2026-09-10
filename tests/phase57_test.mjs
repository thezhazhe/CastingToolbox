// ============================================================
// PHASE 57（57.txt）：第一批双 AI 审计修正锁定
//   T1  machining 现行标准 RMAG A~K 十级表（GB/T 6414-2017 = GB/T 42124.3-2025）
//   T2  machining E@250~400=1.8（旧 1.4 修正）+ J/K 列补全 + 熔模 E + nextCoarser H→J
//   T3  chill 文案软化（无绝对"失效/几乎丧失"措辞）
//   T4  riser neck 表述（工程参考值语义保留值不变）
// ============================================================
import { RMA_TABLE, RMA_GRADES, lookupRMA, rmaRange, nextCoarserGrade, METHOD_GRADES } from '../calcs/machining.js';
import { runChill } from '../calcs/chill.js';
import { RISER_MATERIALS } from '../calcs/riser.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: '57-T1 RMAG 十级表：等级序列 A~K 无 I；全表 A~K 有值；J/K 正式列',
    fn: () => {
      assert(RMA_GRADES.join('') === 'ABCDEFGHJK', `等级序列应为 A~K 无 I（实际 ${RMA_GRADES.join('')}）`);
      assert(RMA_TABLE.length === 13, `13 个尺寸档（实际 ${RMA_TABLE.length}）`);
      for (const row of RMA_TABLE) {
        for (const g of RMA_GRADES) {
          assert(typeof row[g] === 'number' && row[g] > 0, `档 ≤${row.max} 缺 ${g}`);
        }
      }
      // 现行标准表关键格（GB/T 6414-2017 表/GB/T 42124.3-2025 表7，多源转录）
      assert(lookupRMA(40, 'H').value === 0.7 && lookupRMA(40, 'J').value === 1 && lookupRMA(40, 'K').value === 1.4, '≤40 档 H/J/K');
      assert(lookupRMA(300, 'E').value === 1.8, `E@250~400 应为 1.8（旧 1999 值 1.4 已修，实际 ${lookupRMA(300, 'E').value}）`);
      assert(lookupRMA(300, 'H').value === 5 && lookupRMA(300, 'K').value === 10, '250~400 档 H/K');
      assert(lookupRMA(10000, 'K').value === 24, '最大档 K=24');
    },
  },
  {
    name: '57-T2 rmaRange 全区间解析 + nextCoarser 序列 + 熔模推荐',
    fn: () => {
      // 手工造型铸钢 G~K → 全区间含 J/K（此前 J/K 未收录止于 H）
      const r1 = rmaRange(300, 'G~K');
      assert(r1.grades.join('') === 'GHJK', `G~K 应解析 4 级（实际 ${r1.grades.join('')}）`);
      assert(r1.min === 3.5 && r1.max === 10, `300mm G~K 范围 3.5~10（实际 ${r1.min}~${r1.max}）`);
      // H → J（无 I）
      assert(nextCoarserGrade('H') === 'J' && nextCoarserGrade('K') === 'K', 'nextCoarser H→J、K 封顶');
      // 熔模铸造：标准附录 RMAG E（所有材质族）
      assert(METHOD_GRADES['熔模铸造'] && Object.values(METHOD_GRADES['熔模铸造']).every(v => v === 'E'), '熔模铸造 = E（附录建议）');
      const r2 = rmaRange(300, METHOD_GRADES['熔模铸造']['灰铸铁']);
      assert(r2 && r2.min === 1.8 && r2.max === 1.8, `熔模 300mm E 级 = 1.8mm（实际 ${r2?.min}）`);
      // 无标准组合保持：压铸×灰铁、金属型×铸钢
      assert(!METHOD_GRADES['压力铸造']['灰铸铁'] || METHOD_GRADES['压力铸造']['灰铸铁'] === '—', '压铸×灰铁仍无标准');
      assert(METHOD_GRADES['金属型（重力/低压）']['铸钢'] === '—', '金属型×铸钢仍无标准');
    },
  },
  {
    name: '57-T3 chill 文案：无绝对失效措辞；数值语义不变',
    fn: () => {
      const r = runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 150, chillMat: '铸铁冷铁' });
      assert(r && r.thickness[0] === 37.5 && r.thickness[1] === 75, `灰铁 150mm 厚度 0.25~0.5×T（实际 ${r.thickness}）`);
      const joined = [...r.warnings, ...r.rules].join(' ');
      assert(!joined.includes('失效：') && !joined.includes('几乎不起') && !joined.includes('几乎丧失') && !joined.includes('应改用内冷铁或强制冷却'),
        '经验边界不应使用绝对"失效/几乎丧失/必须改用"措辞');
      assert(joined.includes('经验'), '应带经验标签');
      // 隔砂场景
      const r2 = runChill({ mat: '灰铸铁', type: '外冷铁·间接(隔砂)', T: 60, chillMat: '铸铁冷铁' });
      assert(r2.warnings.some(w => w.includes('挂砂层')), '隔砂提示存在');
    },
  },
  {
    name: '57-T4 riser 关键参数值不变（57 仅补标注）',
    fn: () => {
      // neck_k 值保持 56 核验值（灰铁 0.75 ∈ ASM/Karsay 0.67~1.1；钢 1.1=通则）
      assert(RISER_MATERIALS['灰铁'].neck_k === 0.75 && RISER_MATERIALS['铸钢'].neck_k === 1.1
        && RISER_MATERIALS['球铁'].neck_k === 1.0 && RISER_MATERIALS['铝合金'].neck_k === 1.0
        && RISER_MATERIALS['铜合金'].neck_k === 1.0, 'neck_k 值全部保持');
    },
  },
];
