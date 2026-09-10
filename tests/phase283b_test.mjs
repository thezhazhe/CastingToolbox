// ============================================================
// PHASE 28.3-B：Hp 方案 A 真实案例回归（39.txt §四正式批准实施）
// 背景：Excel 唯一完整案例 海德曼基座 147-01-00033-0（HT300 机床件，三铸）
//   ph=76（铸件高）· rh=171.5（冒口高）· Ho=180 · Hb=300 · G=120.22kg
// 锁定值（Excel 原式 = 方案 A，100% 复现）：
//   顶注 Hp = 270.6 mm、中注 Hp = 153.9 mm、底注 Hp = 240.0 mm
//   无冒口（rh=0）中注退化文献式 320.5 mm
// ============================================================
import { calc_Hp, calc_A, runGating } from '../calcs/gating.js';
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifest = (id) => CALC_MANIFEST.find(c => c.id === id);
const close = (a, b, tol = 0.1) => Math.abs(a - b) <= tol;

export const tests = [
  {
    name: '28.3-B-1 Hp 方案 A：真实案例三式 100% 复现 Excel（270.6/153.9/240.0）',
    fn: () => {
      const Ho = 180, Hb = 300, ph = 76, rh = 171.5, C = ph + rh, P_mid = C / 2;
      const top = calc_Hp('顶注', Ho, Hb, 0, C, rh);
      const mid = calc_Hp('中注', Ho, Hb, P_mid, C, rh);
      const bot = calc_Hp('底注', Ho, Hb, C, C, rh);
      assert(close(top, 270.6), `顶注应为 270.6（实际 ${top.toFixed(1)}）`);
      assert(close(mid, 153.9), `中注应为 153.9（实际 ${mid.toFixed(1)}）`);
      assert(close(bot, 240.0), `底注应为 240.0（实际 ${bot.toFixed(1)}）`);
    },
  },
  {
    name: '28.3-B-2 无冒口中注退化文献式：rh=0 → Hp = Ho+Hb/2−C/8',
    fn: () => {
      const Ho = 180, Hb = 300, ph = 76, rh = 0, C = ph;
      const mid = calc_Hp('中注', Ho, Hb, C / 2, C, 0);
      assert(close(mid, 320.5), `无冒口中注应退化 320.5（实际 ${mid.toFixed(1)}）`);
    },
  },
  {
    name: '28.3-B-3 runGating 全链：Hp 与 calc_Hp 一致（Hb 自动查表）+ 奥赞 A 一致',
    fn: () => {
      const r = runGating({
        mat: '灰铁(HT)', pw: 120.22, cav: 1, yr: 75, wall: 37.5,
        pos: '中注', Ho: 180, ph: 76, rh: 171.5,
        ratioKey: '封闭式 常用型', gc: 2, gt: 15, rc: 2, rt: 25, vr: 15, vrc: 4, vs: 75, vst: 8, vsc: 4,
      });
      // Hb 自动查表：G=120.22/0.75=160.3 → Hb=250（非真实案例的 300）
      assert(r && r.Hb === 250, `Hb 应按 G 查表=250（实际 ${r?.Hb}）`);
      assert(close(r.Hp, calc_Hp('中注', 180, r.Hb, r.Pv, r.Cmm, r.rh)), 'runGating.Hp 应与 calc_Hp 一致');
      assert(close(r.Hp, 128.9, 0.15), `中注 Hp 应为 128.9（Hb=250 时，实际 ${r?.Hp?.toFixed(1)}）`);
      // 奥赞：A = 71.47×G/(ρ×t×fv×√Hp)×100（与 calc_A 一致）
      const A = calc_A(r.G, r.rho, r.t, r.fv, r.Hp);
      assert(close(r.A, A, 0.001), 'A 应与 calc_A 一致');
    },
  },
  {
    name: '28.3-B-4 设计中心链路：riser 回写 riserHeight → gating 读取（端到端）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '灰铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 46.8, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('production.cavities', 2, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.wallUsed', 37.5, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.pourPos', '中注', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.Ho', 180, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.ph', 76, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.wallHot', 10, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      proj.set('process.riserHeight', 0, proj.SRC.DEFAULT, proj.CONF.LOW);
      // 模拟 runAnalysis 顺序：gating → riser → riser 回写
      const g0 = manifest('gating').calculate();
      // 无冒口 rh=0：中注 Hp = Ho + Hb/2 − C/8（Hb 按 G 查表：46.8×2/0.75=124.8 → 250）
      assert(g0 && close(g0.Hp, 180 + 250 / 2 - 76 / 8), `无冒口 gating Hp=${180 + 125 - 9.5}（实际 ${g0?.Hp?.toFixed(1)}）`);
      const r = manifest('riser').calculate();
      assert(r && r.H > 0, 'riser 应算出冒口高度');
      // 回写（与 designCenter runAnalysis 相同逻辑）
      if (proj.get('process.riserHeight').src !== proj.SRC.USER_OVERRIDE) proj.setResult('process.riserHeight', r.H);
      assert(proj.getV('process.riserHeight') === r.H, 'riserHeight 应回写');
      assert(proj.get('process.riserHeight').src === 'CALC_RESULT', '回写来源应为 CALC_RESULT');
      // gating 重算 → 读取回写值（中注 Hp = 方案 A；Hb 仍按 G 查表）
      const g1 = manifest('gating').calculate();
      const C = 76 + r.H;
      assert(close(g1.Hp, 180 + g1.Hb / 2 - (C / 2 + r.H) * (C / 2 + r.H) / (2 * C)), `gating 应读 riserHeight（实际 ${g1?.Hp?.toFixed(1)}）`);
      // 用户手动改 riserHeight → 不被回写覆盖
      proj.set('process.riserHeight', 100);
      assert(proj.get('process.riserHeight').src === proj.SRC.USER_OVERRIDE, '用户修改 → USER_OVERRIDE');
      const r2 = manifest('riser').calculate();
      if (proj.get('process.riserHeight').src !== proj.SRC.USER_OVERRIDE) proj.setResult('process.riserHeight', r2.H);
      assert(proj.getV('process.riserHeight') === 100, 'USER_OVERRIDE 不被 riser 回写覆盖');
    },
  },
];
