// ============================================================
// PHASE 50（51.txt）：内浇口"按目标速度优化"一键按钮（calc 层）
//   默认（不 optimize）= 基础奥赞设计，几何按 A_gt，超速只提示；
//   用户显式 optimize:true = A_rec=max(A_gt, A_target) 几何放大降速。
//   优化不得污染：t/G/Q/choke/直浇道/横浇道。
//   UI 按钮/确认/ⓘ 交互由浏览器验证脚本覆盖。
// ============================================================
import { runGating, MATERIALS, V_TARGET } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const inputOf = (mat, pw, wall, pos, extra = {}) => ({
  mat, pw, cav: 1, yr: MATERIALS[mat].y_sug, wall, pos, Ho: 150, ph: 100, rh: 50,
  gc: 2, gt: 15, rc: 1, rt: 15, ...extra,
});

export const tests = [
  {
    name: '50-T1 正常速度（v≤目标）：默认 rec，无放大（Fg=A_gt 基准），基础结果独立于 optimize',
    fn: () => {
      const r = runGating(inputOf('灰铁(HT)', 30, 20, '底注'));   // v_theory≈0.83 < 1.0
      assert(r.vState === 'rec', '底注灰铁默认应达标 rec（vFinal=' + r.vFinal.toFixed(3) + '）');
      assert(r.A_rec === r.A_gt, '达标工况 A_rec=A_gt（不放大）');
      assert(r.Fg >= r.A_gt && r.Fg < r.A_gt * 1.5, '基础几何按 A_gt 生成');
      // 默认 = 显式 false（无意外自动优化）
      const rf = runGating(inputOf('灰铁(HT)', 30, 20, '底注', { optimize: false }));
      assert(r.Fg === rf.Fg && r.vFinal === rf.vFinal && r.t === rf.t, '默认行为 = 显式 optimize:false');
    },
  },
  {
    name: '50-T2 速度超目标：默认 high + 提示引导按钮；基础结果保持奥赞设计（不自动放大）',
    fn: () => {
      const r = runGating(inputOf('灰铁(HT)', 30, 20, '顶注'));   // v_theory≈1.74 > 1.0
      assert(r.vState === 'high', '顶注灰铁默认应 high（vFinal=' + r.vFinal.toFixed(3) + '）');
      assert(r.sugs.some(s => s.includes('偏高')), '提示应含偏高（按钮引导已移至 UI 层，P51）');
      assert(r.A_rec > r.A_gt, '计算层已给出 A_rec（供按钮使用）');
      assert(r.Fg < r.A_rec, '默认 Fg 按 A_gt（基础），不得自动放大到 A_rec');
      assert(close(r.Fg, r.A_gt, 0.05 * r.A_gt) || r.Fg <= r.A_gt * 1.1, '基础 Fg 在 A_gt 附近（取整宁大勿小）');
      assert(!r.optimized, '默认 optimized=false');
    },
  },
  {
    name: '50-T3 点击优化：A_target 正确、A_rec=max(A_current,A_target)、数量/形状/厚度不变',
    fn: () => {
      const base = inputOf('球铁(QT)', 60, 15, '顶注');   // 理论 1.74 > 0.45
      const b = runGating(base);
      assert(b.vState === 'high', '前置：超目标');
      const o = runGating({ ...base, optimize: true });
      // A_target = Q/v_target
      const at = 1000 * b.G / (b.rho * b.t * V_TARGET['球铁(QT)'].t);
      assert(close(o.A_target, at, 1e-6), `A_target=Q/v_target（${o.A_target.toFixed(1)} vs ${at.toFixed(1)}）`);
      assert(o.A_rec === Math.max(b.A_gt, at), 'A_optimized = max(A_current=A_gt, A_target)');
      // 用户选择不变
      assert(o.gc === base.gc && o.gt === base.gt && o.gateShape === '方形', '个数/厚度/形状保持用户选择');
      assert(o.L_g > b.L_g, `优化后长度应增大（${b.L_g} → ${o.L_g}）`);
      assert(o.optimized === true, 'optimized 标记');
    },
  },
  {
    name: '50-T4 几何取整：A_actual ≥ A_optimized（方形/圆形，绝不小于）',
    fn: () => {
      for (const mat of ['灰铁(HT)', '球铁(QT)', '铝合金(Al)']) {
        for (const pos of ['顶注', '底注']) {
          const sq = runGating(inputOf(mat, 30, 15, pos, { optimize: true }));
          assert(sq.Fg >= sq.A_rec - 1e-9, `方形 ${mat} ${pos}: Fg=${sq.Fg} ≥ A_rec=${sq.A_rec}`);
          const rd = runGating(inputOf(mat, 30, 15, pos, { optimize: true, gateShape: '圆形' }));
          assert(rd.Fg >= rd.A_rec - 1e-9, `圆形 ${mat} ${pos}: Fg=${rd.Fg} ≥ A_rec=${rd.A_rec}`);
        }
      }
    },
  },
  {
    name: '50-T5 优化后速度：v_actual=Q/Fg ≤ v_target（达标或偏低，不偏高）',
    fn: () => {
      for (const c of [
        { mat: '灰铁(HT)', pw: 60, wall: 20, pos: '顶注' },
        { mat: '球铁(QT)', pw: 60, wall: 15, pos: '顶注' },
        { mat: '球铁(QT)', pw: 60, wall: 15, pos: '中注' },
        { mat: '铝合金(Al)', pw: 20, wall: 10, pos: '顶注' },
      ]) {
        const o = runGating(inputOf(c.mat, c.pw, c.wall, c.pos, { optimize: true }));
        const vt = V_TARGET[c.mat];
        assert(o.vFinal <= vt.t + 1e-6, `${c.mat} ${c.pos}: vFinal=${o.vFinal.toFixed(3)} ≤ ${vt.t}`);
        assert(o.vState === 'rec' || o.vState === 'low', `${c.mat} ${c.pos}: 优化后不得 high（${o.vState}）`);
        assert(close(o.vFinal, o.Fg > 0 ? 1000 * o.G / (o.rho * o.t * o.Fg) : 0, 1e-9), 'v_actual=Q/Fg');
      }
    },
  },
  {
    name: '50-T6/T7 基础计算不被污染：optimize 前后 t/G/Q/choke/直浇道/横浇道 全等；仅内浇口变',
    fn: () => {
      const cases = [
        inputOf('灰铁(HT)', 30, 20, '顶注'),
        inputOf('灰铁(HT)', 300, 25, '中注'),
        inputOf('球铁(QT)', 100, 12, '底注'),
        inputOf('铸钢(ZG)', 200, 30, '顶注'),    // 无目标材料：optimize 无效果
        inputOf('铝合金(Al)', 10, 8, '中注'),
      ];
      for (const base of cases) {
        const b = runGating(base);
        const o = runGating({ ...base, optimize: true });
        const unchanged = ['t', 'G', 'castingMass', 'A', 'A_gt', 'A_sp', 'A_run', 'Fs_act', 'Fr_act', 'D_sp', 'L_r', 'Hp', 'fv', 'ya', 'vr'];
        for (const k of unchanged) {
          assert(Math.abs(b[k] - o[k]) < 1e-9, `${base.mat} ${base.pos}: ${k} 不应被优化改变（${b[k]} vs ${o[k]}）`);
        }
        // 内浇口相关允许/应当变化（有目标且放大时）
        if (V_TARGET[base.mat]) {
          assert(o.A_rec >= b.A_rec - 1e-9 && o.Fg >= b.Fg - 1e-9, `${base.mat}: 优化后内浇口面积不减`);
        } else {
          assert(o.Fg === b.Fg && o.vFinal === b.vFinal, `${base.mat} 无目标：optimize 无任何效果（零污染）`);
        }
      }
    },
  },
];
