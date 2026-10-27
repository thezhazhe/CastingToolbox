// ============================================================
// PHASE V2.0-22（138.txt）· 目标冒口模数设计规则
//
//   本阶段**授权**修改了 `calcs/riser.js` 的尺寸决策路径：
//     · 推荐尺寸由目标模数 `Mr_target = Mc × MODULUS_TARGET_RATIO`（= 1.2）反求；
//     · 旧的 `f` 迭代（起点 1.10 / 步长 0.05 / 上限 3.55）**整体移除**；
//     · 按整件净重折算的旧体积约束**不再改变推荐尺寸**，只保留为内部诊断（`volOk` 等）。
//
//   本套件按 138.txt §六 的 A/B/C 三组建立**新契约**，与旧基线的重新基线化分开记录：
//     A 目标模数规则 · B 体积约束解耦 · C 集成与回归
//
//   证据口径：
//     · 行为断言一律走**真实生产入口**（runRiser / CALC_MANIFEST.riser.calculate）；
//     · "不得存在某条路径"类断言用**注释剥离后的源码**（注释里会引用被删除的旧写法）；
//     · 数字期望一律给**可推理的判据**（`Mr_act ≥ Mr_target`、最小整数档、几何解析关系），
//       不是"把跑出来的值抄一遍"。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRiser, RISER_SHAPES, MODULUS_TARGET_RATIO, RISER_EFF, FLOAT_REL_EPS, meetsTarget } from '../calcs/riser.js';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { renderResultsCenter } from '../js/views/resultsCenter.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m}（期望 ${b}±${tol}，实际 ${a}）`); };
/** 注释剥离：用于"不得存在"类源码断言（源码注释会**引用**被删除的旧写法） */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');

const SHAPES = ['cyl', 'sphere_head', 'sphere', 'square'];
const R = (mc, o = {}) => runRiser({
  mat: o.mat || '球铁', cast_wt: o.cw || 0, mc_mode: 'direct', mc,
  shape: o.shape || 'cyl', hd_ratio: o.hd === undefined ? 1.0 : o.hd,
});

/** 由**整数直径**求高度 —— 与实现同规则的独立复述（`calcs/riser.js` 的 `hOf`） */
function hOf(shape, d, hd) {
  let h = Math.round(d * hd);
  if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
  if (shape === 'sphere') h = d;
  return h;
}
/** 满足目标模数的**最小整数直径**（独立实现：暴力上探 + 下探，`DfromM` 只用于起点的量级估计）
 *  ⚠ 达标判据用生产侧同一个 `meetsTarget`（浮点精度内达标）—— 测试与实现判据必须同源，
 *    否则边界点会出现"实现接受、测试拒绝"的假失败。 */
function minD(shape, Mr, hd) {
  const sd = RISER_SHAPES[shape];
  let d = Math.max(1, Math.round(sd.DfromM(Mr, hd)));
  for (let i = 0; i < 64 && !meetsTarget(sd.M(d, hOf(shape, d, hd)), Mr); i++) d++;
  for (let i = 0; i < 64 && d > 1 && meetsTarget(sd.M(d - 1, hOf(shape, d - 1, hd)), Mr); i++) d--;
  return d;
}

/* ---------- 设计中心：受控项目状态（与 phasev2008/2010 同一套口径） ---------- */
const HS2 = [{ id: 1, mc: 14 }, { id: 2, mc: 12 }];
function seed(o = {}) {
  proj.reset();
  proj.set('material.family', o.mat || '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', o.geom || 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', o.netWt === undefined ? 77.56 : o.netWt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', o.netWt === undefined ? 77.56 : o.netWt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', o.hs || 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', o.items !== undefined ? o.items : HS2, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', 8, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', o.mc === undefined ? 14 : o.mc,
    o.mcUser ? SRC.USER_OVERRIDE : SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  if (o.shape) proj.set('process.riserShape', o.shape, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  return proj;
}
/** 最小 DOM 桩（resultsCenter 只用到 innerHTML / querySelector） */
function stubContainer() {
  const el = { innerHTML: '', hidden: false, querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {} };
  return { querySelector: () => el, querySelectorAll: () => [], addEventListener: () => {}, _el: el };
}

export const tests = [
  /* ================= A. 目标模数规则（138.txt §六 A） ================= */
  {
    name: 'V2.0-22-A1 ★ Mr_target = Mc × MODULUS_TARGET_RATIO（常量 = 1.2，唯一来源）',
    fn: () => {
      same(MODULUS_TARGET_RATIO, 1.2, '目标模数比常量应为 1.2');
      for (const mc of [0.5, 1, 3.37, 11.43, 20, 100]) {
        const r = R(mc);
        near(r.Mr_target, mc * MODULUS_TARGET_RATIO, 1e-12, `Mc=${mc} 的 Mr_target`);
        same(r.targetRatio, MODULUS_TARGET_RATIO, `Mc=${mc} 的 targetRatio`);
        same(r.final_f, MODULUS_TARGET_RATIO, `Mc=${mc} 的 final_f（兼容字段，恒为规则常量）`);
      }
      // 常量只有一个来源：源码里不得再有硬编码的模数放大系数
      const code = strip(read('calcs/riser.js'));
      assert(!/Mc \* 1\.10|mc \* 1\.10/.test(code), 'riser.js 仍有硬编码的 1.10');
      const hits = code.match(/MODULUS_TARGET_RATIO/g) || [];
      assert(hits.length >= 2, `MODULUS_TARGET_RATIO 的使用点过少（${hits.length}）—— 尺寸与 dModOnly 应同源`);
    },
  },
  {
    name: 'V2.0-22-A2 ★ 四种冒口形状遵守同一目标模数规则',
    fn: () => {
      for (const shape of SHAPES) {
        for (const mc of [1, 5, 14, 40]) {
          const r = R(mc, { shape });
          near(r.Mr_target, mc * MODULUS_TARGET_RATIO, 1e-12, `${shape} Mc=${mc} 的 Mr_target`);
          assert(meetsTarget(r.Mr_act, r.Mr_target), `${shape} Mc=${mc}：Mr_act < 目标模数`);
          same(r.D, minD(shape, r.Mr_target, 1.0), `${shape} Mc=${mc}：D 不是最小整数档`);
          same(r.H, hOf(shape, r.D, 1.0), `${shape} Mc=${mc}：H 与"由整数 D 求 H"规则不符`);
        }
      }
    },
  },
  {
    name: 'V2.0-22-A3 ★ hd=1.0：四形状反求结果符合几何模型的解析关系（M = D/6）',
    fn: () => {
      // 取整点：hd=1 时四种形状的模数公式都退化为 M(D,D) = D/6（解析可证）
      for (const shape of SHAPES) {
        const r = R(11.43, { shape });
        near(r.sd.M(r.D, r.H), r.D / 6, 1e-12, `${shape}：M(D,H) 应为 D/6`);
        near(r.H, r.D, 0, `${shape} hd=1 时 H 应等于 D`);
        assert(r.D >= 6 * r.Mr_target - 1 && r.D <= 6 * r.Mr_target + 1,
          `${shape}：D 应落在 6×Mr_target 附近（实际 ${r.D}，6Mr=${6 * r.Mr_target}）`);
      }
      // 连续解取整后未达标的点必须升一档（C′ 复核仍在）
      const Mc = +(25 / 6 / 1.2).toFixed(6);      // 6×Mr_target = 25 恰为整数
      const a = R(Mc);
      assert(a.Mr_act >= a.Mr_target, '升档后必须达标');
    },
  },
  {
    name: 'V2.0-22-A4 ★★ 整数尺寸复核：Mr_actual ≥ Mr_target 且 D 是最小整数档（含大网格）',
    fn: () => {
      let n = 0;
      for (const shape of SHAPES)
        for (const hd of [0.5, 0.8, 1.0, 1.2, 1.5, 2.0])
          for (let mc = 0.5; mc <= 60; mc += 0.5) {
            const r = R(+mc.toFixed(4), { shape, hd, cw: 5 });
            if (!r) continue;
            n++;
            assert(meetsTarget(r.Mr_act, r.Mr_target), `${shape}/hd=${hd}/Mc=${mc}：Mr_act 未达目标模数`);
            same(r.D, minD(shape, r.Mr_target, hd), `${shape}/hd=${hd}/Mc=${mc}：D 不是最小整数档`);
            same(r.H, hOf(shape, r.D, hd), `${shape}/hd=${hd}/Mc=${mc}：H 与整数 D 的导出规则不符`);
            near(r.Mr_act, r.sd.M(r.D, r.H), 1e-12, `${shape}/hd=${hd}/Mc=${mc}：Mr_act ≠ M(D,H)`);
          }
      assert(n > 2000, `样本过少（${n}）`);
    },
  },
  {
    name: 'V2.0-22-A5 ★ Mr_target 与 Mr_actual 是两个独立字段（含义不同、算法不同）',
    fn: () => {
      const r = R(11.43, { cw: 77.56 });
      assert('Mr_target' in r && 'Mr_act' in r, '两个字段都必须存在');
      assert(!Object.is(r.Mr_target, r.Mr_act), '本例中目标与实际不应相等（取整升档）');
      near(r.Mr_target, 11.43 * 1.2, 1e-12, 'Mr_target 应由 Mc 与规则常量算出');
      near(r.Mr_act, r.sd.M(r.D, r.H), 1e-12, 'Mr_act 必须由**最终整数尺寸**独立重算');
      assert(r.Mr_act > r.Mr_target, '升档后实际模数应严格高于目标');
      // 兼容别名：Mr_need 不得自己另算一份
      same(r.Mr_need, r.Mr_target, 'Mr_need 应是 Mr_target 的别名');
      // 字段语义在源码里有登记（防将来漂移）
      const code = read('calcs/riser.js');
      assert(/Mr_target/.test(code) && /Mr_act/.test(code) && /Mr_need/.test(code), 'riser.js 未登记三个模数字段');
    },
  },

  /* ================= B. 体积约束解耦（138.txt §六 B） ================= */
  {
    name: 'V2.0-22-B1 ★★ 固定 Mc/形状/hd，改变 cast_wt：D 与 H 逐位不变',
    fn: () => {
      let n = 0;
      for (const shape of SHAPES)
        for (const hd of [0.8, 1.0, 1.5])
          for (const mc of [2, 5, 11.43, 30]) {
            const base = R(mc, { shape, hd, cw: 0 });
            for (const cw of [0.001, 0.5, 5, 77.56, 500, 20000]) {
              const r = R(mc, { shape, hd, cw });
              n++;
              same(r.D, base.D, `${shape}/hd=${hd}/Mc=${mc}：cw=${cw} 时 D 被改变了`);
              same(r.H, base.H, `${shape}/hd=${hd}/Mc=${mc}：cw=${cw} 时 H 被改变了`);
              same(r.Vr, base.Vr, `${shape}/hd=${hd}/Mc=${mc}：cw=${cw} 时 Vr 被改变了`);
              same(r.Mr_target, base.Mr_target, `${shape}/hd=${hd}/Mc=${mc}：cw=${cw} 时目标模数被改变了`);
            }
          }
      assert(n === 288, `样本数不对（${n}）`);
    },
  },
  {
    name: 'V2.0-22-B2 ★ 原"体积主导区"：重量从 0 扫到 5000kg，尺寸恒定且 bind 恒为 modulus',
    fn: () => {
      const seen = new Set();
      for (let cw = 0; cw <= 5000; cw += 250) {
        const r = R(11.43, { cw });
        same(r.D, 83, `cw=${cw} 时 D 变了`);
        same(r.H, 83, `cw=${cw} 时 H 变了`);
        seen.add(r.bind);
      }
      same([...seen].join(','), 'modulus', `bind 应恒为 modulus，实际 ${[...seen]}`);
      // 该区间的旧体积诊断确实会从"够"翻到"不够"——但尺寸不受影响
      const light = R(11.43, { cw: 1 }), heavy = R(11.43, { cw: 5000 });
      same(light.volOk, true, '小重量时旧体积诊断应为"够"');
      same(heavy.volOk, false, '大重量时旧体积诊断应为"不够"');
      same(light.D, heavy.D, '体积诊断翻转不得影响尺寸');
    },
  },
  {
    name: 'V2.0-22-B3 ★★ 源码级：不存在"提高 f / 迭代 / 体积推进尺寸"的路径',
    fn: () => {
      const code = strip(read('calcs/riser.js'));
      assert(!code.includes('f += 0.05'), '仍有 f 步进');
      assert(!/for \(let iter/.test(code), '仍有迭代循环');
      assert(!/converged = true; break;/.test(code), '仍有"两条同时过才 break"的收敛路径');
      assert(!/volOk\s*\)\s*\{\s*$/.test(code), '仍存在以 volOk 为条件的推进分支');
      // 尺寸段（目标模数 → 整数尺寸 → 归因/dModOnly）里**不得出现任何体积约束量**
      const iSize = code.indexOf('const Mr_target = Mc * MODULUS_TARGET_RATIO');
      const iNeck = code.indexOf('const neck_k = md.neck_k');
      assert(iSize > 0 && iNeck > iSize, `尺寸段边界定位失败（size@${iSize} neck@${iNeck}）`);
      const sizeBlock = code.slice(iSize, iNeck);
      assert(!/\bcw\b|volOk|needVol|\bVc\b/.test(sizeBlock), '尺寸计算段落里出现了体积约束量');
      // 体积段必须整体排在尺寸段之后
      const iVol = code.indexOf('const Vc = cw > 0');
      assert(iVol > iNeck, `体积段没有排在尺寸段之后（vol@${iVol} neck@${iNeck}）`);
    },
  },
  {
    name: 'V2.0-22-B4 ★ 无隐蔽放大路径：极端重量 + 极端形状组合下尺寸仍只由目标模数决定',
    fn: () => {
      for (const shape of SHAPES) {
        for (const cw of [1e-6, 1e6]) {
          const r = R(9, { shape, cw });
          same(r.D, R(9, { shape, cw: 0 }).D, `${shape} cw=${cw}：尺寸被重量改变了（存在隐蔽放大路径）`);
          near(r.Mr_target, 9 * 1.2, 1e-12, `${shape} cw=${cw} 的目标模数`);
        }
      }
    },
  },
  {
    name: 'V2.0-22-B5 ★ 展示：旧体积校核不通过不得显示为"冒口不合格"（结果卡）',
    fn: () => {
      seed({ mc: 11.43, netWt: 77.56 });
      const r = R(11.43, { cw: 77.56 });
      same(r.volOk, false, '前置条件：该样本旧体积诊断应为"不够"');
      const c = stubContainer();
      renderResultsCenter(c, { riser: { ...r, level: 'WARNING_REVIEW' } }, { ctx: {}, active: 'riser' });
      const html = c.innerHTML;
      assert(html.includes('目标冒口模数 Mr_target'), '结果卡缺少目标模数');
      assert(html.includes('实际冒口模数 Mr_actual'), '结果卡缺少实际模数');
      assert(!html.includes('旧体积模型参考') && !html.includes('旧体积参考不足'),
        'S5-01：结果卡不得再显示旧体积验证/参考不足提示');
      assert(html.includes('可补缩量'), '结果卡应保留可补缩量（Vr × 效率）');
      assert(!html.includes('需加大冒口或加冷铁'), '仍存在"体积不足 ⇒ 需加大冒口"的失败态文案');
      assert(!html.includes('不合格'), '不得把旧体积校核不通过写成"不合格"');
      assert(!html.includes('未收敛'), '新算法恒收敛，结果卡不得出现未收敛字样');
    },
  },

  /* ================= C. 集成与回归（138.txt §六 C） ================= */
  {
    name: 'V2.0-22-C1 ★ 设计中心入口（CALC_MANIFEST.riser）：尺寸由目标模数决定',
    fn: () => {
      seed({ mc: 14, netWt: 77.56, shape: 'cyl' });
      const r = getCalcManifest('riser').calculate();
      assert(r && !r.blocked, '设计中心应给出结果');
      near(r.Mr_target, 14 * 1.2, 1e-12, '设计中心的 Mr_target');
      same(r.D, 101, 'Mc=14 → Mr=16.8 → D 应为 101（旧值 147 由体积约束抬升）');
      same(r.H, 101, 'H');
      same(r.bind, 'modulus', 'bind');
      same(r.converged, true, 'converged');
      same(r.final_f, 1.2, 'final_f');
      assert(meetsTarget(r.Mr_act, r.Mr_target), '实际模数必须达标');
      // 改重量不改尺寸（同一 Mc）
      seed({ mc: 14, netWt: 3, shape: 'cyl' });
      same(getCalcManifest('riser').calculate().D, 101, '设计中心：重量变化不得改变尺寸');
    },
  },
  {
    name: 'V2.0-22-C2 ★ 三入口共用同一契约：独立计算器与向导不得绕过目标模数规则',
    fn: () => {
      // ① 独立计算器：入参形状 = riserView 组装的 12 键（`eff` 总是显式传）
      const rv = runRiser({
        mat: '球铁', cast_wt: 50, mc_mode: 'direct', mc: 14, hot_d: 28, wall_t: 28,
        cast_v: 50000, cast_a: 5000, shape: 'cyl', hd_ratio: '1.0', eff: RISER_EFF.eff_open,
      });
      same(rv.D, 101, '独立计算器路径的 D');
      near(rv.Mr_target, 16.8, 1e-12, '独立计算器路径的 Mr_target');
      // ② 向导：把 Mc 在界面内换算后按 direct 传（源码级确认它调的仍是 runRiser）
      const wz = strip(read('js/views/wizard.js'));
      assert(/runRiser\(\{/.test(wz), '向导未调用 runRiser');
      assert(/mc_mode: 'direct'/.test(wz), '向导应统一按 direct 传 Mc');
      assert(/hd_ratio: state\.hdRatio/.test(wz), '向导应传界面的高径比');
      // ③ 设计中心：S5-05 起读取 process.hdRatio（默认 1.0）；不得再硬编码 1.0。
      const cm = strip(read('calcs/calcManifest.js'));
      assert(/process\.hdRatio/.test(cm) && /hd_ratio: hdRatio/.test(cm),
        '设计中心应读取 process.hdRatio（默认 1.0）');
      assert(!/hd_ratio: 1\.0/.test(cm), '设计中心不得再硬编码 hd_ratio 1.0');
      // 三入口都不得出现自己的模数放大系数
      for (const f of ['calcs/calcManifest.js', 'js/views/riserView.js', 'js/views/wizard.js']) {
        assert(!/1\.10|1\.1\b/.test(strip(read(f)).replace(/[^\n]*MODULUS_TARGET_RATIO[^\n]*/g, '')),
          `${f} 里存在自己的模数系数（应统一来自 MODULUS_TARGET_RATIO）`);
      }
    },
  },
  {
    name: 'V2.0-22-C3 ★ 结果页的目标/实际模数来自正确字段',
    fn: () => {
      seed({ mc: 11.43, netWt: 77.56 });
      const r = R(11.43, { cw: 77.56 });
      const c = stubContainer();
      renderResultsCenter(c, { riser: { ...r, level: 'WARNING_REVIEW' } }, { ctx: {}, active: 'riser' });
      const html = c.innerHTML;
      // 目标模数 = Mr_target（13.72），实际 = Mr_act（13.83）—— 两个数都必须在场且不得互相顶替
      assert(html.includes(r.Mr_target.toFixed(2)), '结果卡未印出 Mr_target 的值');
      assert(html.includes(r.Mr_act.toFixed(2)), '结果卡未印出 Mr_act 的值');
      const code = read('js/views/resultsCenter.js');
      assert(/Mr_target/.test(code), '结果卡未引用 Mr_target 字段');
      assert(/it\.Mr_act/.test(code), '结果卡未引用 Mr_act 字段');
      // 旧结果对象（无 Mr_target）必须回退到 Mr_need，不得显示 undefined
      const legacy = { ...r }; delete legacy.Mr_target; delete legacy.targetRatio;
      const c2 = stubContainer();
      renderResultsCenter(c2, { riser: { ...legacy, level: 'WARNING_REVIEW' } }, { ctx: {}, active: 'riser' });
      assert(!c2.innerHTML.includes('undefined') && !c2.innerHTML.includes('NaN'), '旧结果对象渲染出 undefined/NaN');
    },
  },
  {
    name: 'V2.0-22-C4 ★（R6-S3.1 新契约）RH 不再由冒口自动回写；gating 仍读唯一权威参数',
    fn: () => {
      const dc = strip(read('js/views/designCenter.js'));
      /* 154.txt §五.3：process.riserHeight 的语义是 RH（冒口顶面高出铸件顶面），
         不是冒口总高 H。riser 计算不得再自动覆盖用户指定的 RH。 */
      assert(!/proj\.setResult\('process\.riserHeight', r\.H\)/.test(dc),
        'riser 仍会自动回写 process.riserHeight（违反 154 §五.3）');
      const cm = strip(read('calcs/calcManifest.js'));
      assert(/rh: proj\.getV\('process\.riserHeight'\)/.test(cm), 'gating 未读取唯一权威 RH 参数');
      assert(/riser[\s\S]{0,200}gating|gating[\s\S]{0,200}riser/.test(cm), 'riser 与 gating 的依赖关系未被登记');
      // 冒口尺寸（含 H）仍随 Mc 变化；它只是不再自动冒充 RH。
      const r = R(14);
      same(r.H, 101, 'riser 的 H 仍由目标模数与形状几何决定');
    },
  },
  {
    name: 'V2.0-22-C5 ★ 状态与文案不得与新算法矛盾（三处入口）',
    fn: () => {
      const rc = read('js/views/resultsCenter.js');
      assert(!strip(rc).includes("it.bind === 'volume'"), '结果卡仍有 volume 归因分支');
      assert(rc.includes('推荐尺寸依据当前目标模数规则计算'), '结果卡缺少"目标模数规则 + 尚需验证"提示');
      const rv = read('js/views/riserView.js');
      assert(rv.includes('目标冒口模数 Mr_target'), '独立计算器缺少目标模数');
      assert(!strip(rv).includes("'模数放大系数 f'"), '独立计算器仍在显示"模数放大系数 f"');
      const rg = read('js/views/reportGenerator.js');
      assert(!strip(rg).includes('旧体积模型参考') && !strip(rg).includes('旧体积参考不足'),
        'S5-01：导出报告不得再显示旧体积验证/参考不足提示');
      assert(!strip(rg).includes('体积补缩'), '导出报告仍有"体积补缩 充足/不足"的判据式文案');
      // 英文侧同步（中文原文即 key）
      const en = read('js/i18n/en-US.js');
      for (const k of ['目标冒口模数 Mr_target', '实际冒口模数 Mr_actual', 'H/D（高度 / 直径）']) {
        assert(en.includes(k), `英文词条缺失：${k}`);
      }
    },
  },
  {
    name: 'V2.0-22-C6 ★★ 关键案例锁定（球铁 77.56kg / Mc=11.43 / cyl / hd=1）',
    fn: () => {
      const r = R(11.43, { cw: 77.56 });
      same(r.D, 83, 'D');
      same(r.H, 83, 'H');
      near(r.Mr_target, 13.716, 1e-12, 'Mr_target');
      near(r.Mr_act, 83 / 6, 1e-12, 'Mr_actual');
      near(r.Mr_act / r.Mc, 1.2103, 1e-4, '实际模数比（≥ 1.2）');
      same(r.bind, 'modulus', 'bind');
      same(r.converged, true, 'converged');
      same(r.final_f, 1.2, 'final_f');
      same(r.dModOnly, 82, 'dModOnly（连续解取整，未跟随升档）');
      same(r.d_neck, 46, 'd_neck（仍由 Mc × neck_k 决定）');
      // 旧体积诊断仍算得出来，但已不影响尺寸
      same(r.volOk, false, '旧体积诊断');
      near(r.needVol / 1000, 327.72, 0.01, '旧模型所需补缩量（整件净重口径）');
      near(r.effV / 1000, 62.87, 0.01, '本冒口有效补缩量');
      // 与旧算法（体积主导 → D=144）的对照：同一个件，尺寸差 61mm
      assert(144 - r.D === 61, '与旧输出的对照值变化了');
    },
  },

  /* ================= E. 浮点边界（139.txt §3.3 A~D） ================= */
  {
    name: 'V2.0-22-E1 ★ 浮点边界回归：理论模数**恰等于**目标时不得多升 1mm',
    fn: () => {
      // 已发现案例：球顶柱 / Mc=25 → Mr_target=30；H=D=180 时理论模数恰为 30，
      //   但浮点算出 29.999999999999996（少 4e-15）⇒ 修复前被判"不足"而升到 181。
      const r = R(25, { shape: 'sphere_head' });
      same(r.Mr_target, 30, 'Mc=25 的目标模数应为 30');
      same(r.D, 180, '理论模数恰等于目标 ⇒ 取 180，不得因浮点误差升到 181');
      same(r.H, 180, 'H 应等于 D');
      assert(meetsTarget(r.Mr_act, r.Mr_target), '应判定为达标（浮点精度内）');
      // 同族边界点（hd=1 的球顶柱：M(D,D) = D/6，Mr 为整数时取 6×Mr）
      for (const [mc, mr, d] of [[12.5, 15, 90], [37.5, 45, 270], [42.5, 51, 306], [50, 60, 360]]) {
        const x = R(mc, { shape: 'sphere_head' });
        same(x.Mr_target, mr, `Mc=${mc} 的目标模数`);
        same(x.D, d, `Mc=${mc}：D 应为 ${d}`);
      }
      // 另一处已知边界（hd=1.5）
      const y = R(20, { shape: 'sphere_head', hd: 1.5 });
      same(y.Mr_target, 24, 'Mc=20 的目标模数');
      same(y.D, 126, 'hd=1.5 边界点应取 126');
    },
  },
  {
    name: 'V2.0-22-E2 ★★ 真实不足**不得**被容差放行（临界尺寸附近）',
    fn: () => {
      const sd = RISER_SHAPES.sphere_head;
      const m180 = sd.M(180, 180);
      // 依次把目标抬高到 180 档**真实不足**的量级：从工程显著（1e-3）到极小（1e-11）
      for (const rel of [1e-3, 1e-6, 1e-9, 1e-11]) {
        const Mr = 30 * (1 + rel);
        const x = R(Mr / MODULUS_TARGET_RATIO, { shape: 'sphere_head' });
        same(x.D, 181, `目标抬高 ${rel} 倍后 180 档真实不足 ⇒ 必须取 181`);
        assert(!meetsTarget(m180, Mr), `容差把真实不足（rel=${rel}）判成了合格`);
      }
      // 反方向对照：目标恰好等于理论值时必须**不**多升
      const exact = R(30 / MODULUS_TARGET_RATIO, { shape: 'sphere_head' });
      same(exact.D, 180, '目标恰等于理论模数 ⇒ 取 180');
      assert(meetsTarget(m180, 30), '恰好相等应判达标');
      // 明显不足（跨一整档）也必须拒
      assert(!meetsTarget(sd.M(179, 179), 30), '179 档（差 0.1667）必须判不足');
    },
  },
  {
    name: 'V2.0-22-E3 ★ 最小性：四形状 × 六高径比，D 达标且 D−1 必不达标',
    fn: () => {
      let n = 0;
      for (const shape of SHAPES)
        for (const hd of [0.5, 0.8, 1.0, 1.2, 1.5, 2.0])
          for (let mc = 0.5; mc <= 60; mc += 0.5) {
            const r = R(+mc.toFixed(4), { shape, hd });
            if (!r) continue;
            n++;
            assert(meetsTarget(r.Mr_act, r.Mr_target), `${shape}/hd=${hd}/Mc=${mc}：D 不达标`);
            const dPrev = r.D - 1, hPrev = hOf(shape, dPrev, hd);
            const prevOk = dPrev > 0 && hPrev > 0 && meetsTarget(r.sd.M(dPrev, hPrev), r.Mr_target);
            assert(!prevOk, `${shape}/hd=${hd}/Mc=${mc}：D−1=${dPrev} 也达标 ⇒ D 不是最小档`);
          }
      assert(n > 2000, `样本过少（${n}）`);
    },
  },
  {
    name: 'V2.0-22-E4 ★★ 容差安全性：被拒绝的候选只能落在"浮点噪声"或"真实不足"两侧，中间无灰带',
    fn: () => {
      // 这是 §3.2「证明容差不会放过实际不足的尺寸」的**回归化**：
      //   扫描所有"上探终止处"的候选，记录其相对欠缺量 rel = (Mr − M(D−1)) / Mr。
      //   要求：每个 rel 要么 ≤ 噪声上界，要么 ≥ 真实下界，且 FLOAT_REL_EPS 严格夹在中间。
      let noiseMax = 0, realMin = Infinity, nNoise = 0, nReal = 0, ambiguous = [];
      for (const shape of SHAPES)
        for (const hd of [0.5, 1.0, 1.5]) {
          const sd = RISER_SHAPES[shape];
          for (let i = 0; i <= 400; i++) {
            const Mr = +(0.2 + i * 0.15).toFixed(4) * 1.2;
            let d = Math.max(1, Math.round(sd.DfromM(Mr, hd)));
            for (let k = 0; k < 64 && !meetsTarget(sd.M(d, hOf(shape, d, hd)), Mr); k++) d++;
            if (d <= 1) continue;
            const rel = (Mr - sd.M(d - 1, hOf(shape, d - 1, hd))) / Mr;
            if (rel <= 1e-13) { nNoise++; noiseMax = Math.max(noiseMax, rel); }
            else if (rel >= 1e-7) { nReal++; realMin = Math.min(realMin, rel); }
            else ambiguous.push({ shape, hd, Mr, rel });
          }
        }
      assert(ambiguous.length === 0,
        `存在灰带候选（既非浮点噪声也非真实不足）：${JSON.stringify(ambiguous.slice(0, 4))}`);
      assert(nReal > 100, `真实不足样本过少（${nReal}）`);
      assert(FLOAT_REL_EPS > noiseMax * 8,
        `容差 ${FLOAT_REL_EPS} 未高出噪声上界 ${noiseMax} 至少 8 倍`);
      assert(FLOAT_REL_EPS * 1000 < realMin,
        `容差 ${FLOAT_REL_EPS} 未低于真实不足下界 ${realMin} 1000 倍`);
    },
  },
  {
    name: 'V2.0-22-E5 ★ 非球顶回归：边界修复未波及其它形状，且 1.2 与"重量解耦"契约保持',
    fn: () => {
      // 非球顶：同样的 Mr=30，圆柱形必须仍是 180（该档 M=D/6=30 精确，本就无浮点问题）
      const c = R(25, { shape: 'cyl' });
      same(c.Mr_target, 30, 'cyl 的目标模数');
      same(c.D, 180, 'cyl 在 Mr=30 时应取 180');
      for (const shape of ['cyl', 'square', 'sphere']) {
        const x = R(25, { shape });
        same(x.D, 180, `${shape} 在 Mr=30 时应取 180`);
        assert(meetsTarget(x.Mr_act, x.Mr_target), `${shape} 应达标`);
      }
      // 目标比例契约
      same(MODULUS_TARGET_RATIO, 1.2, '目标比例必须仍是 1.2');
      // 重量解耦在**边界点**上同样成立
      for (const cw of [0, 0.5, 77.56, 5000]) {
        same(R(25, { shape: 'sphere_head', cw }).D, 180, `cw=${cw} 时边界点尺寸不得改变`);
      }
    },
  },
];
