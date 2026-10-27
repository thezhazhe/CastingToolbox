// ============================================================
// PHASE V2.0-R7（162.txt）· 冒口颈 / 补缩距离经验参考
//
// 契约（只测独立参考模块与两个入口的接线，不改冒口核心）：
//   · 颈：M_N ≥ M_F/3；圆形 D=4M_N；正方形 a=4M_N；长方形 b=2aM_N/(a−2M_N)，a>2M_N；
//   · 取整只向上，取整后仍满足模数；输入非法/边界明确失败；
//   · 补缩距离：板状 2s、杆状 1.2s；s 为现有 STL 主体壁厚，缺失不造数；
//   · 两个入口都调用同一模块，M_F 使用冒口实际模数（Mr_act），不是 Mc。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcNeckReference, calcFeedingReference, calcInsulatedRiser,
  applyInsulatedRiserResult, INSULATED_VOLUME_RATIO,
} from '../js/views/riserReference.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, t, m) => { if (!(Math.abs(a - b) <= t)) throw new Error(`${m}（期望 ${b}±${t}，实际 ${a}）`); };

const MF = 12.38;
const MN = MF / 3;

export const tests = [
  {
    name: 'R7-N1 圆形/正方形：理论尺寸 4M_N；上限取整超出时必须如实标记（不能只查下限）',
    fn: () => {
      for (const shape of ['circle', 'square']) {
        const r = calcNeckReference({ modulus: MF, shape });
        assert(r.ok, `${shape} 应成功`);
        near(r.MnMin, MN, 1e-12, `${shape} M_N 下限`);
        near(r.MnMax, 2 * MF / 3, 1e-12, `${shape} M_N 上限`);
        near(r.theoreticalMin, 4 * MN, 1e-12, `${shape} 理论下限`);
        near(r.theoreticalMax, 8 * MF / 3, 1e-12, `${shape} 理论上限`);
        assert(Number.isInteger(r.recommendedMin) && r.recommendedMin >= r.theoreticalMin, `${shape} 建议下限应向上取整`);
        assert(Number.isInteger(r.recommendedMax) && r.recommendedMax >= r.theoreticalMax, `${shape} 建议上限应向上取整`);
        near(r.actualMin, r.recommendedMin / 4, 1e-12, `${shape} 下限实际模数必须由建议尺寸回算`);
        near(r.actualMax, r.recommendedMax / 4, 1e-12, `${shape} 上限实际模数必须由建议尺寸回算`);
        assert(r.minWithin && r.actualMin >= MN - 1e-9 && r.actualMin <= r.MnMax + 1e-9,
          `${shape} 下限实际模数应在参考范围内`);
        assert(r.exceedsUpper && !r.maxWithin && !r.verified,
          `${shape} 上限向上取整后超出 M_N,max，必须标为不在范围内`);
        near(r.actualMax, 8.5, 1e-12, `${shape} 本例上限实际模数`);
      }
    },
  },
  {
    name: 'R7-N1b 圆形/正方形：理论上下限都恰为整数时，verified=true 且上下限均在范围',
    fn: () => {
      for (const shape of ['circle', 'square']) {
        const r = calcNeckReference({ modulus: 12, shape });
        assert(r.ok, `${shape} 应成功`);
        near(r.actualMin, 4, 1e-12, `${shape} 下限实际模数`);
        near(r.actualMax, 8, 1e-12, `${shape} 上限实际模数`);
        assert(r.minWithin && r.maxWithin && r.verified && !r.exceedsUpper,
          `${shape} 上下限实际值都在范围内时才允许 verified=true`);
      }
    },
  },
  {
    name: 'R7-N2 长方形：上限取整超出时如实标记；实际模数由最终 b 回算',
    fn: () => {
      const a = 100;
      const r = calcNeckReference({ modulus: MF, shape: 'rect', sideA: a });
      assert(r.ok, '长方形应成功');
      near(r.theoreticalMin, 2 * a * MN / (a - 2 * MN), 1e-12, '长方形 b 理论下限');
      near(r.theoreticalMax, 2 * a * (2 * MF / 3) / (a - 2 * (2 * MF / 3)), 1e-12, '长方形 b 理论上限');
      assert(Number.isInteger(r.recommendedMin) && r.recommendedMin >= r.theoreticalMin, '建议 b 下限应向上取整');
      assert(Number.isInteger(r.recommendedMax) && r.recommendedMax >= r.theoreticalMax, '建议 b 上限应向上取整');
      const mMin = a * r.recommendedMin / (2 * (a + r.recommendedMin));
      const mMax = a * r.recommendedMax / (2 * (a + r.recommendedMax));
      near(r.actualMin, mMin, 1e-12, '下限实际 M_N 必须由最终 b 回算');
      near(r.actualMax, mMax, 1e-12, '上限实际 M_N 必须由最终 b 回算');
      assert(mMin >= MN - 1e-9 && mMin <= r.MnMax + 1e-9, '下限实际值应在范围内');
      assert(r.exceedsUpper && mMax > r.MnMax && !r.maxWithin && !r.verified,
        '上限 b 向上取整后超出 M_N,max，必须如实标记');
    },
  },
  {
    name: 'R7-N3 长方形边界与非法输入：a≤2M_N,max、空/负/非数、M_F 缺失均明确失败',
    fn: () => {
      assert(calcNeckReference({ modulus: MF, shape: 'rect', sideA: 2 * (2 * MF / 3) }).reason === 'side_too_small', 'a=2M_N,max 应不适用');
      assert(calcNeckReference({ modulus: MF, shape: 'rect', sideA: 0 }).reason === 'bad_side', 'a=0 应不适用');
      assert(calcNeckReference({ modulus: MF, shape: 'rect', sideA: -1 }).reason === 'bad_side', '负 a 应不适用');
      assert(calcNeckReference({ modulus: MF, shape: 'rect', sideA: 'abc' }).reason === 'bad_side', '非数 a 应不适用');
      assert(calcNeckReference({ modulus: MF, shape: 'rect', sideA: Infinity }).reason === 'bad_side', 'Infinity a 应不适用');
      assert(calcNeckReference({ modulus: 0 }).reason === 'no_modulus', 'M_F=0 应无法计算');
      assert(calcNeckReference({ modulus: NaN }).reason === 'no_modulus', 'M_F=NaN 应无法计算');
      assert(calcNeckReference({ modulus: Infinity }).reason === 'no_modulus', 'M_F=Infinity 应无法计算');
    },
  },
  {
    name: 'R7-F1 补缩距离：s=10 → 板 20 / 杆 12；单位 mm，精度保留',
    fn: () => {
      const r = calcFeedingReference({ wallThickness: 10 });
      assert(r.ok, '有效壁厚应成功');
      near(r.plate, 20, 1e-12, '板状 2s');
      near(r.bar, 12, 1e-12, '杆状 1.2s');
      const d = calcFeedingReference({ wallThickness: 12.5 });
      near(d.plate, 25, 1e-12, '板状 2s（小数）');
      near(d.bar, 15, 1e-12, '杆状 1.2s（小数）');
    },
  },
  {
    name: 'R7-F2 无有效主体壁厚：0/空/负/NaN 不得用默认值代替',
    fn: () => {
      for (const s of [0, null, undefined, -1, NaN, '']) {
        assert(calcFeedingReference({ wallThickness: s }).reason === 'no_wall', `s=${String(s)} 应无法计算`);
      }
    },
  },
  {
    name: 'R8-FB1 发热/保温：V1=0.4V0、沿用 H/D、整数尺寸回算体积；缺体积/非法 H/D 明确失败',
    fn: () => {
      const V0 = 100000;   // mm³
      for (const k of [0.8, 1.0, 1.2, 1.5]) {
        const r = calcInsulatedRiser({ referenceVolume: V0, hdRatio: k });
        assert(r.ok, `k=${k} 应成功`);
        near(r.V0, V0, 1e-9, 'V0 应保持输入几何体积');
        near(r.V1, 0.4 * V0, 1e-9, 'V1 = 0.4 V0');
        near(r.Vnew, 0.4 * V0, 1e-9, 'Vnew 与 V1 同口径');
        assert(Number.isInteger(r.D) && r.D > 0 && Number.isInteger(r.H) && r.H > 0, `k=${k} 尺寸应为正整数 mm`);
        assert(r.H === Math.max(1, Math.round(k * r.D)), `k=${k} 应沿用 H = round(kD)`);
        const vAct = Math.PI * r.D * r.D * r.H / 4;
        near(r.Vactual, vAct, 1e-9, `k=${k} 实际体积必须由最终显示尺寸回算`);
        assert(r.volumeOk && r.Vactual >= r.V1 - 1e-6, `k=${k} 实际尺寸应达到目标体积`);
        const hPrev = Math.max(1, Math.round(k * (r.D - 1)));
        const vPrev = Math.PI * (r.D - 1) * (r.D - 1) * hPrev / 4;
        assert(r.D === 1 || vPrev < r.V1 - 1e-6, `k=${k} D 应为满足目标体积的最小整数档`);
      }
      assert(INSULATED_VOLUME_RATIO === 0.4, '40% 经验系数应集中为常量');
      assert(calcInsulatedRiser({ referenceVolume: 0 }).reason === 'no_volume', 'V0=0 应无法计算');
      assert(calcInsulatedRiser({ referenceVolume: NaN }).reason === 'no_volume', 'V0=NaN 应无法计算');
      assert(calcInsulatedRiser({ referenceVolume: V0, hdRatio: 0 }).reason === 'bad_hd', 'H/D=0 应无法计算');
      assert(calcInsulatedRiser({ referenceVolume: V0, hdRatio: NaN }).reason === 'bad_hd', 'H/D=NaN 应无法计算');
    },
  },
  {
    name: 'R8-FB2 主结果转换：V0 取普通圆柱 Vr 而非 effV；不重复效率；不冒充普通模数判定',
    fn: () => {
      const base = {
        Vr: 100000, effV: 14000, D: 100, H: 100, hd: 1, shapeKey: 'cyl',
        Mc: 10, cw: 10, Vc: 1408450, rhoUsed: 7.1, md: { rho: 7.1 },
        Mr_target: 12, Mr_need: 12, targetRatio: 1.2, modOk: true,
        eff: 0.14, needVol: 50000, sd: { name: '圆柱形' },
      };
      const a = applyInsulatedRiserResult(base, { hdRatio: 1.2 });
      assert(a.designType === 'insulated' && a.insulated === true, '应标记为发热/保温主结果');
      near(a.V0, base.Vr, 1e-9, 'V0 必须取普通圆柱几何体积 Vr，不得取 effV');
      near(a.V1, 0.4 * base.Vr, 1e-9, 'V1 必须由 V0 乘 0.4');
      near(a.Vr, a.Vactual, 1e-9, '主结果体积必须是最终几何体积');
      assert(a.Vr !== base.Vr, '主结果体积不应残留普通圆柱体积');
      assert(a.eff === null && a.effV === null && a.needVol === null, '不得重复应用补缩效率/体积修正');
      assert(a.Mr_target === null && a.Mr_need === null && a.targetRatio === null && a.modOk === null,
        '不得把普通目标模数判定冒充成发热/保温结果');
      near(a.hd, 1.2, 1e-12, '应沿用输入 H/D');
      assert(a.Mr_act > 0 && Number.isFinite(a.Mr_act), '可可靠计算新几何的几何模数');
      const b = applyInsulatedRiserResult(base, { hdRatio: 0.8 });
      assert(a.D !== b.D || a.H !== b.H, '不同 H/D 应产生不同换算尺寸');
      const invalid = applyInsulatedRiserResult({ ...base, Vr: 0 }, { hdRatio: 1 });
      assert(invalid.insulatedError === 'no_volume' && invalid.D === null, '无有效 V0 应明确不可用');
      const fallbackHd = applyInsulatedRiserResult(base, { hdRatio: 0 });
      assert(!fallbackHd.insulatedError && Math.abs(fallbackHd.hd - 1) < 1e-12,
        'H/D 非法时应回退到核心结果的名义值/合法默认，不得让主结果消失');
      const fallbackOne = applyInsulatedRiserResult({ ...base, hd: 0 }, { hdRatio: 0 });
      assert(!fallbackOne.insulatedError && Math.abs(fallbackOne.hd - 1) < 1e-12,
        '当前值和核心名义值都无效时，应使用现有合法默认 1.0');
    },
  },
  {
    name: 'R8-C1 两个入口共用同一模块：主结果转换、M_F 用 Mr_act、s 用 process.wallUsed',
    fn: () => {
      const rc = read('js/views/resultsCenter.js');
      const rv = read('js/views/riserView.js');
      const dc = read('js/views/designCenter.js');
      const mod = read('js/views/riserReference.js');
      assert(rc.includes("from './riserReference.js'"), '设计中心结果页未 import 共用模块');
      assert(rv.includes("from './riserReference.js'"), '独立计算器未 import 共用模块');
      assert(rc.includes('modulus: it.Mr_act'), '设计中心 M_F 应使用 Mr_act');
      assert(rv.includes('modulus: r.Mr_act'), '独立计算器 M_F 应使用 Mr_act');
      assert(rc.includes("proj.getV('process.wallUsed')"), '设计中心主体壁厚应使用 process.wallUsed');
      assert(rv.includes("proj.getV('process.wallUsed')"), '独立计算器主体壁厚应使用 process.wallUsed');
      assert(!/modulus:\s*(it|r)\.Mc\b/.test(rc + rv), '不得把铸件 Mc 当作冒口 M_F');
      assert(mod.includes('Mf / 3') && mod.includes('2 * s') && mod.includes('1.2 * s'), '参考公式应集中在共用模块');
      assert(mod.includes('INSULATED_VOLUME_RATIO = 0.4') && mod.includes('Math.cbrt'), '发热/保温换算应集中在共用模块');
      assert(rv.includes('applyInsulatedRiserResult(base, { hdRatio: input.hd_ratio })'),
        '独立计算器应使用共享主结果转换并传入当前 H/D');
      assert(dc.includes('applyInsulatedRiserResult(r, { hdRatio: proj.getV(\'process.hdRatio\') })'),
        '设计中心应使用共享主结果转换并读取当前 H/D');
      assert(!rc.includes('renderInsulatedReference') && !rv.includes('renderInsulatedReference'),
        '不应再显示第二套发热/保温参考卡');
    },
  },
];
