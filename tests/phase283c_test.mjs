// ============================================================
// PHASE 28.3-C：浇注系统工程规则（39.txt §七）
//   - 内浇口流速企业标准：封闭式 ≤1.5 / 开放式 ≤1.0 m/s（P1-4，已批准）
//     标注"企业经验标准"；UI 显示为校核/建议
//   - fv 保留企业 Excel 来源（过滤网 −0.1 不硬编码）
//   - 液面上升速度 vL 校核接口（仅计算参考，不参与 allOk）
// ============================================================
import { runGating, V_LIMIT, calc_v } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** 构造可复现的 gating 输入（仅变化 ratioKey/pos） */
function base(ratioKey, pos = '顶注') {
  return {
    mat: '灰铁(HT)', pw: 46.8, cav: 2, yr: 75, wall: 37.5,
    pos, Ho: 180, ph: 76, rh: 171.5, ratioKey,
    gc: 1, gt: 5, rc: 2, rt: 25, vr: 15, vrc: 4, vs: 75, vst: 8, vsc: 4,
  };
}

export const tests = [
  {
    name: '28.3-C-1 流速 R7 红线：V_LIMIT 表不变（封闭1.5/开放1.0）；有目标材料自动达标、无目标材料超 R7 仅提示不硬报错（PHASE 48-B 更新）',
    fn: () => {
      assert(V_LIMIT.封闭 === 1.5 && V_LIMIT.开放 === 1.0, 'V_LIMIT 表应为企业标准 封闭1.5/开放1.0');
      // 夹具 v_theory≈1.76（固定回归值）→ 灰铁（目标 1.0）自动放大后达标 rec
      const r = runGating({ ...base('封闭式 常用型'), optimize: true });   // P50：48-B 放大语义经 optimize 入口
      assert(r.vLimit === 1.5, '封闭式限值 1.5');
      assert(r.vState === 'rec' && r.v_ok === true, '灰铁夹具应自动放大至目标（推荐，不再硬报错）');
      assert(Math.abs(r.vTheory - 1.756) < 0.05, `v_theory 应保留 1.756（实际 ${r.vTheory.toFixed(3)}）`);
      assert(r.r7Exceed === false, '自动放大后不超 R7');
      // 铸钢（无目标）：同一夹具 v≈1.76 超 R7 → r7Exceed 提示，v_ok 不再为 false（仅显示）
      const rz = runGating({ ...base('封闭式 常用型'), mat: '铸钢(ZG)' });
      assert(rz.vTarget === null && rz.vState === 'none', '铸钢无目标');
      assert(rz.r7Exceed === true && Math.abs(rz.v - 1.76) < 0.05, `铸钢夹具应超 R7（v=${rz.v.toFixed(2)}）但仅提示`);
      // 大截面低速：两式均通过（分级关系 V_LIMIT 表保证）
      const bigF = calc_v(r.G, r.rho, r.t, 2000);
      assert(bigF > 0 && bigF < 1.0, '大截面应低速');
      assert(bigF <= V_LIMIT.开放 && bigF <= V_LIMIT.封闭, '低流速两式均通过');
    },
  },
  {
    name: '28.3-C-2 流速提示语义（PHASE 48-B 更新）：目标材料超限防御性文案含目标值；无目标材料超 R7 提示含红线与限值',
    fn: () => {
      const r = runGating({ ...base('封闭式 常用型'), optimize: true });
      assert(r.vState === 'rec', '前置：灰铁夹具应推荐');
      assert(!r.sugs.some(s => s.includes('❌ 流速')), '不得出现错误式速度报警');
      // 铸钢超 R7 → 建议文案含 R7 标注与限值
      const rz = runGating({ ...base('封闭式 常用型'), mat: '铸钢(ZG)' });
      assert(rz.r7Exceed, '前置：应超 R7');
      assert(rz.sugs.some(s => s.includes('R7')), '超限提示应标注 R7');
      assert(rz.sugs.some(s => s.includes(String(rz.vLimit))), '提示应含具体限值');
      assert(rz.sugs.some(s => s.includes('提示参考')), '应注明仅提示参考（非错误）');
    },
  },
  {
    name: '28.3-C-3 液面上升速度 vL：= 铸件高度/浇注时间，仅参考不参与判定',
    fn: () => {
      const r = runGating(base('封闭式 常用型'));
      assert(Math.abs(r.vL - r.ph / r.t) < 1e-9, `vL = ph/t（实际 ${r.vL}）`);
      assert(typeof r.vL === 'number' && r.vL > 0, 'vL 应输出');
      // allOk 只由 v/vr 决定（vL 不参与）
      const r2 = runGating(base('封闭式 常用型', '底注'));
      assert(r2.allOk === (r2.v_ok && r2.vr_ok), 'allOk 不应受 vL 影响');
    },
  },
  {
    name: '28.3-C-4 fv 来源不变：顶/中/底 0.8/0.6/0.45（企业 Excel），无过滤网修正',
    fn: () => {
      assert(runGating(base('封闭式 常用型', '顶注')).fv === 0.8, '顶注 fv=0.8');
      assert(runGating(base('封闭式 常用型', '中注')).fv === 0.6, '中注 fv=0.6');
      assert(runGating(base('封闭式 常用型', '底注')).fv === 0.45, '底注 fv=0.45');
    },
  },
];
