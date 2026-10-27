// ============================================================
// PHASE V2.0-R8-FIX（164.txt 五）· 梯形横浇道正式截面 + 数量口径
//
// 契约：
//   · A_run 是现有 runGating 的“全部横浇道目标总面积”；梯形按 A_run/n 均分。
//   · 三种梯形：上底 a、下底 2a；标准 h=2a / 扁 h=a / 高 h=4a。
//   · 数量必须为正整数；默认 1；数量变化必须改变尺寸，不能只多一个输入框。
//   · 主结果只保留当前截面的几何；矩形路径完全保留。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  calcTrapezoidRunner, defaultTrapezoidKind, TRAPEZOID_TYPES,
  applyRunnerSection, effectiveRunnerSection, normalizeRunnerCount,
} from '../js/views/gatingReference.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, t, m) => { if (!(Math.abs(a - b) <= t)) throw new Error(`${m}（期望 ${b}±${t}，实际 ${a}）`); };
const up2 = (v) => Math.ceil(v * 100 - 1e-9) / 100;

export const tests = [
  {
    name: 'R8-T1 三种梯形：a 向上取整 0.01mm，上底/下底/高/面积自洽',
    fn: () => {
      const A = 1200;
      for (const [kind, areaFactor, hFactor] of [['standard', 3, 2], ['flat', 1.5, 1], ['tall', 6, 4]]) {
        const r = calcTrapezoidRunner({ area: A, kind, count: 1 });
        assert(r.ok, `${kind} 应成功`);
        const a = up2(Math.sqrt(A / areaFactor));
        near(r.a, a, 1e-12, `${kind} a 应为向上取整后的显示值`);
        near(r.top, a, 1e-12, `${kind} 上底`);
        near(r.bottom, 2 * a, 1e-12, `${kind} 下底`);
        near(r.height, hFactor * a, 1e-12, `${kind} 高`);
        near(r.checkArea, areaFactor * a * a, 1e-9, `${kind} 面积必须由显示尺寸回算`);
        assert(r.actualTotal >= A - 1e-9, `${kind} 向上取整后实际面积不得小于目标`);
      }
    },
  },
  {
    name: 'R8-T1b 数量：A_each = A_run / n，尺寸随数量变化，不重复除',
    fn: () => {
      const A = 1200, n = 3;
      const r = calcTrapezoidRunner({ area: A, kind: 'flat', count: n });
      assert(r.ok && r.count === n, '有效数量应成功');
      near(r.areaEachTarget, A / n, 1e-12, '单条目标面积应为 A_run / n');
      const a = up2(Math.sqrt((A / n) / TRAPEZOID_TYPES.flat.areaFactor));
      near(r.a, a, 1e-12, 'a 必须按单条目标面积反算（不能拿 A_run 再反算）');
      near(r.actualTotal, r.actualEach * n, 1e-9, '总实际面积 = 单条实际 × 数量');
      assert(r.actualTotal >= A - 1e-9, '总实际面积不得小于目标');
      assert(r.actualTotal < A * 1.02, '面积余量应主要来自 0.01mm 取整，不能异常放大');
      const one = calcTrapezoidRunner({ area: A, kind: 'flat', count: 1 });
      assert(r.a < one.a, '数量增加后单条尺寸必须变小');
    },
  },
  {
    name: 'R8-T2 自动默认：开放式→扁梯形；封闭式→高梯形；其他→标准梯形；手动值优先',
    fn: () => {
      assert(defaultTrapezoidKind('开放') === 'flat', '开放式默认扁梯形');
      assert(defaultTrapezoidKind('封闭') === 'tall', '封闭式默认高梯形');
      assert(defaultTrapezoidKind('自定义') === 'standard', '自定义默认标准梯形');
      assert(effectiveRunnerSection({ rd: { type: '开放' } }, '') === 'flat', '未保存时应自动匹配');
      assert(effectiveRunnerSection({ rd: { type: '开放' } }, 'rect') === 'rect', '用户手动选择必须优先');
    },
  },
  {
    name: 'R8-T3 非法面积/数量：不得输出尺寸或 NaN/Infinity',
    fn: () => {
      for (const A of [0, null, undefined, -1, NaN, '']) {
        const r = calcTrapezoidRunner({ area: A });
        assert(r.ok === false && r.reason === 'no_area', `A=${String(A)} 应无法计算`);
      }
      for (const n of [0, -1, 1.5, 'abc']) {
        const r = calcTrapezoidRunner({ area: 1200, count: n });
        assert(r.ok === false && r.reason === 'bad_count', `count=${String(n)} 应明确失败`);
      }
      assert(normalizeRunnerCount(0, 1) === 1 && normalizeRunnerCount(3, 1) === 3, '数量归一化只做防御性回退');
    },
  },
  {
    name: 'R8-T4 两个浇注入口共用正式截面计算；不再显示旧参考卡',
    fn: () => {
      const rv = read('js/views/resultsCenter.js');
      const dc = read('js/views/designCenter.js');
      const gv = read('js/views/gatingView.js');
      const mod = read('js/views/gatingReference.js');
      assert(rv.includes("from './gatingReference.js'") && dc.includes("from './gatingReference.js'"),
        '设计中心结果页/分析链接未接入共享截面模块');
      assert(gv.includes("from './gatingReference.js'"), '独立浇注计算器未 import 共享截面模块');
      assert(dc.includes('applyRunnerSection') && gv.includes('applyRunnerSection'), '两个入口都应调用共同的主结果转换');
      assert(rv.includes('id="dc_runnerSection"') && gv.includes('id="g_runnerSection"'), '两个入口都应有正式截面选择器');
      assert(!rv.includes('renderTrapezoidCard') && !gv.includes('renderTrapezoidCard'), '旧梯形参考卡调用应移除');
      assert(mod.includes('calcTrapezoidRunner({ area: g.A_run') && mod.includes('areaEachTarget = A / rawCount'),
        '梯形公式与数量分配应集中在共享模块');
      assert(mod.includes('const bottom = 2 * a') && mod.includes('spec.hFactor * a'), '梯形几何定义应集中在共享模块');
    },
  },
  {
    name: 'R8-T5 内浇口数量：现有 gc 为整模总数，未乘型腔数；两个页面统一显示该口径',
    fn: () => {
      const g = read('calcs/gating.js');
      const rv = read('js/views/resultsCenter.js');
      const gv = read('js/views/gatingView.js');
      assert(/Fg\s*=\s*gt\s*\*\s*L_g\s*\*\s*gc/.test(g), '核心应把 gc 作为总数量直接计算内浇口面积');
      assert(!/gc\s*\*\s*cav|cav\s*\*\s*gc/.test(g), '不得未经确认把 gc 乘以型腔数');
      for (const s of [rv, gv]) {
        assert(s.includes('内浇口总数（整模，全部铸件合计）'), '页面必须显示整模总数量口径');
        assert(s.includes('内浇口总数为整套浇注系统中所有铸件的内浇口数量合计。'), '页面必须说明整模合计含义');
      }
    },
  },
  {
    name: 'R8-T6 主结果转换：矩形原样保留；梯形替换横浇道几何并按实际截面积重算阻流',
    fn: () => {
      const base = {
        blocked: false, A_run: 1200, A_sp: 800, Fs_act: 1000, Fg: 900,
        rc: 2, rt: 25, L_r: 30, Fr_act: 1500, rrv: 1.5, rgv: 0.9,
        chokeArea: 900, chokePosition: 'ingate', systemType: 'old', ingateChoke: true, boundaryChoke: false,
        sugs: ['⚠️ 横浇道不足（需 1200 mm²）'], optimized: false, rd: { type: '开放' },
      };
      const rect = applyRunnerSection(base, { section: 'rect', count: 9 });
      assert(rect.rc === 2 && rect.rt === 25 && rect.L_r === 30 && rect.Fr_act === 1500, '矩形字段必须完全保留');
      assert(rect.runnerSection.kind === 'rect' && rect.runnerSection.isTrapezoid === false, '矩形元数据');
      const trap = applyRunnerSection(base, { section: 'flat', count: 3 });
      assert(trap.rc === 3 && trap.rt === null && trap.L_r === null, '梯形主结果不得残留矩形厚度/长度');
      near(trap.Fr_act, trap.runnerSection.actualTotal, 1e-9, '实际总截面必须来自梯形尺寸回算');
      near(trap.runnerSection.targetEach, 400, 1e-9, 'A_run 应按数量均分');
      assert(trap.runnerSection.count === 3 && trap.runnerSection.isTrapezoid === true, '梯形元数据');
      assert(trap.chokePosition === 'ingate', '应按最终实际总截面积重新判定阻流位置');
      assert(!trap.sugs.some(s => String(s).includes('横浇道不足')), '不得保留按矩形面积生成的横浇道不足提示');
      near(trap.rrv, trap.Fr_act / base.Fs_act, 1e-12, '实际面积比应按梯形总截面积更新');
    },
  },
];
