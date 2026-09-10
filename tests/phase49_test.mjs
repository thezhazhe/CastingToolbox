// ============================================================
// PHASE 49（50.txt）：W 定义修正 + 边界提示 + 取整修复
//   A. castingMass (W_c=pw×cav) 与 pouringMetalMass (G=W_c/出品率) 职责分离
//      P47 浇注时间公式只用 W_c；奥赞/流量 Q/目标面积全用 G
//   B. 经验公式分界点工程提示（不插值）：灰铁 450kg（±5%）、球铁 10/25mm（±1mm）
//   C. 内浇口方形长度 ceil（目标面积驱动不得因 round 而面积不足）
//   不修改：速度公式/目标值/R7/1:2:0.85（审计另行）
// ============================================================
import { runGating, calc_t, MATERIALS } from '../calcs/gating.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

export const tests = [
  {
    name: '49-W1 castingMass 与 pouringMetalMass 分离：改出品率只影响 G/A/Q、不影响 t',
    fn: () => {
      const base = { mat: '灰铁(HT)', pw: 46.8, cav: 2, wall: 20, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15 };
      const r65 = runGating({ ...base, yr: 65 });
      const r80 = runGating({ ...base, yr: 80 });
      // 分离：castingMass 与 yr 无关
      assert(r65.castingMass === r80.castingMass && r65.castingMass === 93.6, `castingMass=pw×cav=93.6（实际 ${r65.castingMass}）`);
      // P47 时间用 W_c → 与 yr 无关
      assert(close(r65.t, r80.t, 1e-9), '浇注时间 t 不得随出品率变化（W=castingMass）');
      assert(close(r65.t, calc_t('灰铁(HT)', 93.6, 20), 1e-9), 't = calc_t(castingMass)');
      // G=pouringMetalMass 随 yr 变；A/Q/A_rec 随 G 变
      assert(r65.G > r80.G && close(r65.G, 93.6 / 0.65, 1e-6), 'G = castingMass/yr');
      assert(r65.A > r80.A, '奥赞面积随浇注重量 G 增大而增大');
      assert(r65.A_target > r80.A_target, 'A_target=1000G/(ρt·v_target) 随 G 增大');
      // 下游全部用 G：v_final 单位/数学关系
      const r = r65;
      const vExp = r.Fg > 0 ? 1000 * r.G / (r.rho * r.t * r.Fg) : 0;
      assert(close(r.vFinal, vExp, 1e-9), 'v_final = 1000·G_pouring/(ρ·t·Fg)');
    },
  },
  {
    name: '49-W2 灰铁 450kg 边界按 castingMass 判定（与 yr 无关）',
    fn: () => {
      // castingMass = pw×cav：449.9/450.0 → 式1；450.1 → 式2（任意 yr）
      for (const yr of [60, 75]) {
        const r1 = runGating({ mat: '灰铁(HT)', pw: 449.9, cav: 1, yr, wall: 15, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });
        const f1 = 0.70 * (1.41 + 15 / 14.59) * Math.sqrt(449.9);
        assert(close(r1.t, f1, 1e-9), `yr=${yr}: 449.9kg 应走式1（√W，实际 ${r1.t}）`);
        const r2 = runGating({ mat: '灰铁(HT)', pw: 450.1, cav: 1, yr, wall: 15, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });
        const f2 = 0.70 * (1.236 + 15 / 16.65) * Math.cbrt(450.1);
        assert(close(r2.t, f2, 1e-9), `yr=${yr}: 450.1kg 应走式2（∛W，实际 ${r2.t}）`);
      }
      // cav 参与：单件 300kg × 2 件 = 600 > 450 → 式2（防止用单件重量误判）
      const rc = runGating({ mat: '灰铁(HT)', pw: 300, cav: 2, yr: 75, wall: 15, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });
      assert(rc.castingMass === 600 && close(rc.t, 0.70 * (1.236 + 15 / 16.65) * Math.cbrt(600), 1e-9),
        '单件300×2件：castingMass=600 应按式2（∛W）');
    },
  },
  {
    name: '49-W3 球铁 10/25mm 分档边界（runGating 层）',
    fn: () => {
      const expect = { '9.9': 2.080, '10.0': 2.670, '25.0': 2.670, '25.1': 2.970 };
      for (const [w, k1] of Object.entries(expect)) {
        const r = runGating({ mat: '球铁(QT)', pw: 50, cav: 1, yr: 65, wall: parseFloat(w), pos: '中注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });
        assert(close(r.t, k1 * Math.sqrt(50), 1e-9), `球铁壁厚 ${w} → K₁=${k1}（实际 t=${r.t}）`);
      }
    },
  },
  {
    name: '49-W4 分界点工程提示 boundaryNote：触发/不触发正确',
    fn: () => {
      const mk = (mat, pw, wall) => runGating({ mat, pw, cav: 1, yr: 75, wall, pos: '顶注', Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });
      assert(mk('灰铁(HT)', 460, 20).boundaryNote?.includes('450kg'), '灰铁 460kg（±5%内）应有分界提示');
      assert(mk('灰铁(HT)', 440, 20).boundaryNote?.includes('450kg'), '灰铁 440kg 应有分界提示');
      assert(mk('灰铁(HT)', 400, 20).boundaryNote === null, '灰铁 400kg 不应有提示');
      assert(mk('灰铁(HT)', 500, 20).boundaryNote === null, '灰铁 500kg 不应有提示');
      assert(mk('球铁(QT)', 50, 9.5).boundaryNote?.includes('10/25'), '球铁 9.5mm 应有分档提示');
      assert(mk('球铁(QT)', 50, 10.5).boundaryNote?.includes('10/25'), '球铁 10.5mm 应有分档提示');
      assert(mk('球铁(QT)', 50, 25.5).boundaryNote?.includes('10/25'), '球铁 25.5mm 应有分档提示');
      assert(mk('球铁(QT)', 50, 24.5).boundaryNote?.includes('10/25'), '球铁 24.5mm 应有分档提示');
      assert(mk('球铁(QT)', 50, 12).boundaryNote === null, '球铁 12mm 不应有提示');
      assert(mk('铸钢(ZG)', 460, 20).boundaryNote === null, '铸钢无分界提示');
      assert(mk('灰铁(HT)', 460, 20).boundaryNote.includes('工程复核'), '提示应含"工程复核"字样');
    },
  },
  {
    name: '49-W5 目标面积驱动的几何尺寸：实际面积 Fg 不得小于目标 A_rec（方形/圆形，ceil）',
    fn: () => {
      const grid = [];
      for (const mat of ['灰铁(HT)', '球铁(QT)', '铸钢(ZG)', '铝合金(Al)', '铜合金(Cu)']) {
        for (const pw of [3, 10, 50, 300]) for (const wall of [5, 20, 50]) for (const pos of ['顶注', '底注']) {
          grid.push({ mat, pw, wall, pos });
        }
      }
      for (const c of grid) {
        const sq = runGating({ ...c, cav: 1, yr: MATERIALS[c.mat].y_sug, Ho: 150, ph: 100, rh: 50, gc: 2, gt: 15, rc: 1, rt: 15, optimize: true });
        if (sq.gc > 0 && sq.gt > 0 && sq.A_rec > 0) {
          assert(sq.Fg >= sq.A_rec - 1e-9, `方形 ${c.mat} ${c.pw}kg/${c.wall}mm ${c.pos}: Fg=${sq.Fg} < A_rec=${sq.A_rec}`);
        }
        const rd = runGating({ ...c, cav: 1, yr: MATERIALS[c.mat].y_sug, Ho: 150, ph: 100, rh: 50, gateShape: '圆形', gc: 2, rc: 1, rt: 15, optimize: true });
        if (rd.gc > 0 && rd.A_rec > 0) {
          assert(rd.Fg >= rd.A_rec - 1e-9, `圆形 ${c.mat} ${c.pw}kg/${c.wall}mm ${c.pos}: Fg=${rd.Fg} < A_rec=${rd.A_rec}`);
        }
      }
      // 极小面积（取整粒度影响最大）：Fg ≥ A_rec 仍成立
      const tiny = runGating({ mat: '球铁(QT)', pw: 1, cav: 1, yr: 65, wall: 5, pos: '底注', Ho: 150, ph: 100, rh: 50, gc: 1, gt: 3, rc: 1, rt: 15, optimize: true });
      assert(tiny.Fg >= tiny.A_rec - 1e-9, `极小件: Fg=${tiny.Fg} ≥ A_rec=${tiny.A_rec}`);
    },
  },
];
