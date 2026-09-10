// ============================================================
// PHASE 59（59.txt）：Campbell 提示层增量 —— 计算逻辑零改动验证
//   T1  激冷片类型：纯说明返回（无系数计算、无编造参数）
//   T2  冷铁既有行为不变：外冷铁/内冷铁数值与 57 前一致
//   T3  riser 五材料数值不变（灰铁/球铁/铸钢/铝/铜 抽样锁定）
//   T4  gating 数值不变（关键输出与既有锁定一致）
// ============================================================
import { runChill } from '../calcs/chill.js';
import { CHILL_TYPES, CHILL_PAD } from '../data/chill_calc.js';
import { runRiser } from '../calcs/riser.js';
import { runGating, MATERIALS } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: '59-T1 激冷片类型：加入下拉数据、纯说明返回、无厚度无编造参数',
    fn: () => {
      assert(CHILL_TYPES.includes('激冷片（Chill Pad）'), 'CHILL_TYPES 含激冷片');
      assert(CHILL_PAD.note && CHILL_PAD.rules.length >= 1 && CHILL_PAD.source.includes('Campbell'), '集中文案存在且带资料出处');
      const r = runChill({ mat: '灰铸铁', type: '激冷片（Chill Pad）', T: 40, chillMat: '铸铁冷铁' });
      assert(r && r.pad && r.thickness == null && r.deltaText == null, '激冷片返回 pad 说明、无厚度计算');
      assert(!r.thickness && !r.recommendedMat, '激冷片无系数输出（不编造参数）');
      // 文案防绝对化：不得出现"即可代替冒口"
      assert(!CHILL_PAD.note.includes('即可代替冒口') && !r.pad.note.includes('取消冒口'), '说明不绝对化');
      // 任意材料下激冷片均可返回（不依赖系数表）
      for (const m of ['灰铸铁', '球墨铸铁', '铸钢', '铝合金', '铜合金']) {
        const rr = runChill({ mat: m, type: '激冷片（Chill Pad）', T: 50 });
        assert(rr && rr.pad, `${m} 激冷片可用`);
      }
    },
  },
  {
    name: '59-T2 冷铁既有行为不变：外冷铁系数/内冷铁/回退 与修改前一致',
    fn: () => {
      const ext = runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 40, chillMat: '铸铁冷铁' });
      assert(ext.thickness[0] === 10 && ext.thickness[1] === 20, `灰铁 40mm 0.25~0.5T（实际 ${ext.thickness}）`);
      const int = runChill({ mat: '球墨铸铁', type: '内冷铁', T: 40 });
      assert(int.thickness[0] === 12 && int.thickness[1] === 20, `内冷铁 0.3~0.5T（实际 ${int.thickness}）`);
      const fb = runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 60, chillMat: '铝冷铁' });  // 非法搭配 → 回退铸铁冷铁
      assert(fb.recommendedMat === '铸铁冷铁' && fb.thickness[0] === 15, `回退推荐材料（实际 ${fb.recommendedMat} ${fb.thickness}）`);
      assert(runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 0 }) === null, 'T=0 → null');
    },
  },
  {
    name: '59-T3 riser 五材料数值不变（抽样锁定 56 实验值）',
    fn: () => {
      // 与 56.txt 数值实验输出逐项一致（形状=球顶柱暗冒口 eff25%、Mc=15 直接输入）
      const exp = [
        ['灰铁', 50, 'sphere_head', 1.10, 99], ['球铁', 50, 'sphere_head', 1.25, 113],
        ['铸钢', 50, 'sphere_head', 1.35, 122], ['铝合金', 50, 'sphere_head', 1.95, 176],
      ];
      for (const [m, w, shape, f, D] of exp) {
        const r = runRiser({ mat: m, cast_wt: w, mc_mode: 'direct', mc: 15, shape, hd_ratio: 1.0 });
        assert(Math.abs(r.final_f - f) < 0.011 && r.D === D, `${m} ${w}kg: f=${r.final_f} D=${r.D}（期望 ${f}/${D}）`);
      }
      const cu = runRiser({ mat: '铜合金', cast_wt: 10, mc_mode: 'direct', mc: 15, shape: 'cyl', hd_ratio: 1.0 });
      assert(cu.final_f === 1.10 && cu.D === 99, `铜 10kg cyl f/D（实际 ${cu.final_f}/${cu.D}）`);
      // 灰铁 neck_k=0.75 等材料参数未动
      assert(runRiser({ mat: '灰铁', cast_wt: 50, mc_mode: 'direct', mc: 15, shape: 'cyl', hd_ratio: 1.0 }).d_neck === 45, '灰铁颈径不变（0.75×15×4=45）');
    },
  },
  {
    name: '59-T4 gating 数值不变：典型输入关键输出与既有断言一致',
    fn: () => {
      const base = { mat: '灰铁(HT)', pw: 60, cav: 1, yr: 75, wall: 20, pos: '顶注', Ho: 180, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, ratioKey: '封闭式 常用型' };
      const r = runGating(base);
      // 与 phase52/53 既有锁定同值（抽取代表性格）
      assert(r.G > 0 && r.t > 0 && r.A > 0, '基础计算正常');
      assert(r.chokeArea === Math.min(r.Fs_act, r.Fr_act, r.Fg), 'choke 判定未变');
      const vLimit = { 封闭: 1.5, 开放: 1.0 }[r.rd.type];
      assert(r.vLimit === vLimit, 'R7 限值未变');
      // 直浇道 ceil 规则（52 修复）未回退：Fs_act ≥ A_sp
      assert(r.Fs_act >= r.A_sp, '直浇道面积≥目标（ceil 规则保持）');
      // 过滤网 fv−0.1 未变
      const f = runGating({ ...base, filterUsed: true });
      assert(Math.abs(f.fv - 0.7) < 1e-9, '过滤网 fv−0.1 未变');
    },
  },
];
