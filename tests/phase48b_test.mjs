// ============================================================
// PHASE 48-B（49.txt FINAL）：内浇口速度"设计校核+自动推荐面积"
//   目标：灰铁 ≤1.0 m/s；球铁/铝 0.45（推荐 0.40~0.50）；铸钢/铜无目标（仅显示）
//   A_target = Q/v_target = 1000·G/(ρ·t·v_target)；A_rec = max(A_gt, A_target)
//   v_final = Q/A_rec（几何按 A_rec 生成 → 实际平均速度）
//   v_theory = fv·√(2gHp) 保留为诊断值；取消"❌ 速度超差"错误式报警
// 覆盖：5 材料 × 3 浇注方向（49.txt §七）、数学关系（§八）、T 传递链（§九）、
//       状态文案三态、无目标材料行为、红线 R7 仅提示
// ============================================================
import { runGating, calc_t, MATERIALS, V_TARGET, V_LIMIT } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const MATS = ['灰铁(HT)', '球铁(QT)', '铸钢(ZG)', '铝合金(Al)', '铜合金(Cu)'];
const POSES = ['顶注', '中注', '底注'];

export const tests = [
  {
    name: '48-B1 5 材料×3 浇注方向：无"❌ 速度超差/计算错误"、状态一致、T→Q→A_target→A_rec→v_final 链完整',
    fn: () => {
      const out = [];
      for (const mat of MATS) {
        for (const pos of POSES) {
          const input = { mat, pw: 30, cav: 1, yr: MATERIALS[mat].y_sug, wall: 15, pos, Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true };  // P50：48-B 放大语义经 optimize 入口验证
          const r = runGating(input);
          const vt = V_TARGET[mat] || null;
          // 无错误式报警
          assert(!r.sugs.some(s => s.includes('❌ 流速') || s.includes('计算错误')), `${mat} ${pos} 不得出现错误式速度报警：${r.sugs.join(' | ')}`);
          // A_rec = max(A_gt, A_target)；有目标材料只放大不缩小；无目标材料不放大
          assert(r.A_rec >= r.A_gt - 1e-9, `${mat} ${pos}: A_rec ≥ A_gt`);
          if (!vt) assert(r.A_rec === r.A_gt && r.vTarget === null && r.vState === 'none', `${mat} 无目标：A_rec=A_gt、vState=none`);
          // T 传递链（§九）：A_target 由 calc_t 的 t 计算
          const G = r.G, t = calc_t(mat, r.castingMass, r.wall);   // PHASE 49：P47 公式 W=castingMass
          assert(close(r.t, t), `${mat} ${pos}: t 未被旧代码覆盖（runGating.t=calc_t(castingMass)）`);
          assert(close(r.A_target, vt ? 1000 * G / (r.rho * t * vt.t) : 0, 1e-6), `${mat} ${pos}: A_target=1000G/(ρt·v_target)`);
          // v_final = Q/A_rec（几何已按 A_rec）
          assert(close(r.vFinal, r.Fg > 0 ? 1000 * G / (r.rho * r.t * r.Fg) : 0), `${mat} ${pos}: v_final=Q/Fg`);
          // v_theory 保留且不被覆盖
          assert(close(r.vTheory, Math.sqrt(2 * 9.81 * r.Hp / 1000) * r.fv, 1e-9), `${mat} ${pos}: v_theory=fv√(2gHp)`);
          // 状态一致性
          if (vt) {
            if (r.vFinal > vt.hi) assert(r.vState === 'high', `${mat} ${pos}: 超目标应 high`);
            else if (vt.lo && r.vFinal < vt.lo) assert(r.vState === 'low', `${mat} ${pos}: 低于区间应 low`);
            else assert(r.vState === 'rec', `${mat} ${pos}: 达标应 rec`);
          }
          // 有目标材料放大后不应超企业 R7 红线（灰铁 ≤1.11 vs 1.5；球铁/铝 ≤~0.5 vs 1.0）
          if (vt) assert(!r.r7Exceed, `${mat} ${pos}: 自动放大后不得超 R7（vFinal=${r.vFinal.toFixed(3)}）`);
          out.push(`${mat} ${pos}: G=${G.toFixed(1)} T=${r.t.toFixed(1)}s A_gt=${r.A_gt.toFixed(0)} A_rec=${r.A_rec.toFixed(0)} v_theory=${r.vTheory.toFixed(2)} v_final=${r.vFinal.toFixed(3)} 状态=${r.vState}`);
        }
      }
      console.log(`      ${out.join('\n      ')}`);
    },
  },
  {
    name: '48-B2 数学关系（§八）：A_rec=A_target 时 v_final≈目标（灰铁≈1.0、球铁/铝≈0.45）',
    fn: () => {
      const cases = [
        { mat: '灰铁(HT)', pw: 60, wall: 20, pos: '顶注' },   // 理论 1.83>1.0 → 必须放大
        { mat: '灰铁(HT)', pw: 300, wall: 20, pos: '顶注' },
        { mat: '球铁(QT)', pw: 100, wall: 15, pos: '顶注' },  // 理论 1.83>0.45 → 放大
        { mat: '球铁(QT)', pw: 100, wall: 15, pos: '中注' },
        { mat: '铝合金(Al)', pw: 20, wall: 10, pos: '顶注' },
        { mat: '铝合金(Al)', pw: 20, wall: 10, pos: '中注' },
      ];
      for (const c of cases) {
        const r = runGating({ ...c, cav: 1, yr: MATERIALS[c.mat].y_sug, Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });  // P50
        const vt = V_TARGET[c.mat];
        assert(r.A_rec > r.A_gt, `${c.mat} ${c.pos}: 顶/中注应触发放大（A_rec=${r.A_rec.toFixed(0)} > A_gt=${r.A_gt.toFixed(0)}）`);
        // ceil 保证 Fg≥A_rec≥A_target → v_final ≤ 目标；5mm 步长向上超调可让 v 低至 目标×0.75（P49 取整宁大勿小）
        assert(r.vFinal <= vt.t * (1 + 1e-6) && r.vFinal >= vt.t * 0.75,
          `${c.mat} ${c.pos}: v_final 应≤${vt.t} 且≥0.75×目标（实际 ${r.vFinal.toFixed(3)}，A_rec=${r.A_rec.toFixed(0)}）`);
        assert(r.vState === 'rec', `${c.mat} ${c.pos}: 应推荐`);
        console.log(`      ${c.mat} ${c.pos}: v_final=${r.vFinal.toFixed(3)}（目标 ${vt.t}）Fg/A_rec=${(r.Fg / r.A_rec).toFixed(3)}`);
      }
    },
  },
  {
    name: '48-B3 铸钢/铜：无目标、不放大、保持计算显示（v_theory 保留）',
    fn: () => {
      for (const mat of ['铸钢(ZG)', '铜合金(Cu)']) {
        for (const pos of ['顶注', '底注']) {
          const r = runGating({ mat, pw: 300, cav: 1, yr: MATERIALS[mat].y_sug, wall: 25, pos, Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15 });
          assert(r.vTarget === null && r.A_target === 0 && r.A_rec === r.A_gt, `${mat} ${pos}: 无目标不放大`);
          assert(r.vState === 'none' && r.vFinal === r.v, `${mat} ${pos}: vState=none、v_final=v`);
          assert(r.vTheory > 0, `${mat} ${pos}: v_theory 保留为诊断值`);
          // 超 R7 红线 → 仅提示不报错
          if (r.v > V_LIMIT[r.rd.type]) {
            assert(r.r7Exceed === true && r.sugs.some(s => s.includes('R7')), `${mat} ${pos}: 超 R7 应有提示且非错误（${r.sugs.join('|')}）`);
          }
        }
      }
    },
  },
  {
    name: '48-B4 偏低状态（球铁/铝 <0.40）：提示可保留、不缩小（A_rec=A_gt）',
    fn: () => {
      // 构造偏低：超大出品率+底注 fv 低 → 理论速度已低于 0.4 时 A_target<A_gt → 不放大 → vFinal<0.4
      const cases = [
        { mat: '球铁(QT)', pw: 5, wall: 50, pos: '底注' },
        { mat: '铝合金(Al)', pw: 3, wall: 30, pos: '底注' },
      ];
      let hit = 0;
      for (const c of cases) {
        const r = runGating({ ...c, cav: 1, yr: MATERIALS[c.mat].y_sug, Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });  // P50
        if (r.vFinal < V_TARGET[c.mat].lo) {
          hit++;
          assert(r.vState === 'low', `${c.mat}: vFinal=${r.vFinal.toFixed(3)}<0.40 → low`);
          // 偏低时参考面积绝不被缩小（A_rec≥A_gt）；可能因 5mm 粒度向上超调而偏低（Fg≥A_rec）
          assert(r.A_rec >= r.A_gt - 1e-9 && r.Fg >= r.A_rec, `${c.mat}: 偏低不缩小（A_rec=${r.A_rec.toFixed(0)}≥A_gt=${r.A_gt.toFixed(0)}，Fg=${r.Fg.toFixed(0)}≥A_rec）`);
          assert(r.sugs.some(s => s.includes('偏低')), `${c.mat}: 应有偏低提示（可保留）`);
          assert(r.sugs.some(s => s.includes('不缩小面积')), `${c.mat}: 偏低提示应注明不缩小面积`);
          console.log(`      ${c.mat} ${c.pos}: v_final=${r.vFinal.toFixed(3)} → low（提示保留，不缩小）`);
        }
      }
      console.log(`      构造偏低命中 ${hit}/2（未命中说明该工况已达标，属正常）`);
    },
  },
];
