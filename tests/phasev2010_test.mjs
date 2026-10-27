// ============================================================
// PHASE V2.0-10（120.txt）· 可信度等级的**阻断优先级**（修 N-E）
//
//   N-E：V2.0-06A1 把"未确认的自动 Mc"降级写成 `(userMc || note) ? 'WARNING_REVIEW' : reliabilityLevel(…)`，
//        `note` 为真即短路 ⇒ reliabilityLevel 再也轮不到 ⇒ 几何 INVALID（本应 BLOCK）被降成"需人工复核"。
//        冷铁分支同病（`(userMc || userT || autoT)`），多热结路径则**根本不调** reliabilityLevel。
//
// 断言纪律（121 项纪律的延续）：
//   · **只走真实调用分支**：全部经 CALC_MANIFEST.<id>.calculate() / buildPage1Data()，
//     不直测 reliabilityLevel() 纯函数（纯函数正确 ≠ 调用路径正确，那正是 N-E 的成因）；
//   · **不做"搜源码字符串"式断言** —— 每条都是行为断言（返回值/字段）；
//   · 数值用"修复前实测的黄金值"锁死，证明本次只动标签、不动任何工程数值。
//   ★ PHASE V2.0-22（138.txt §3.4）：尺寸改由目标模数 Mr_target = Mc×1.2 反求（旧体积约束不再决定尺寸）
//     ⇒ 该黄金值已**合法失效**，`V2.0-10-8` 的 D/H/Vr/f 按新契约重新基线化（等级断言一字未动）。
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { buildPage1Data } from '../js/views/processPage1.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => assert(Object.is(a, b), `${m}（实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);

const HS2 = [{ id: 1, mc: 14 }, { id: 2, mc: 12 }];

/** 受控项目状态（与 phasev2008 / phasev2008final 同一套，保证跨阶段口径可对照） */
function seed(o = {}) {
  proj.reset();
  proj.set('material.family', o.mat || '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', o.geom || 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.volumeCm3', 10924, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.size', [300, 200, 150], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.status', o.hs || 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', o.items !== undefined ? o.items : HS2, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', 8, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', o.mc ?? 14, o.mcUser ? SRC.USER_OVERRIDE : SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  if (o.chillT != null) proj.set('process.chillT', o.chillT, o.chillTUser ? SRC.USER_OVERRIDE : SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  if (o.pick) proj.set('process.hsPick', o.pick, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  return o;
}
const riser = (o) => { seed(o); return getCalcManifest('riser').calculate(); };
const chill = (o) => { seed(o); return getCalcManifest('chill').calculate(); };

/** 页面侧（processPage1）真实入口 —— 用于"页面与结果卡等级一致" */
function page1(geomStatus) {
  const store = {
    'material.family': { v: '球铁', src: 'SCENARIO', conf: 'medium', editable: true },
    'geometry.geomStatus': { v: geomStatus, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
    'hotspots.status': { v: 'ok', src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
    'hotspots.items': { v: [{ id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 }], src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: false },
    'process.mcHotspot': { v: 14, src: 'STL_GEOMETRY_ANALYSIS', conf: 'high', editable: true },
  };
  return buildPage1Data({
    v: (p) => (store[p] || {}).v, ps: (p) => store[p] || null,
    sampling: null, bodyRef: null, hasStl: true, manual: false, geomStatus,
  });
}

const BLOCK = 'BLOCK_AUTO_RECOMMEND', WARN = 'WARNING_REVIEW', SAFE = 'SAFE_TO_RECOMMEND';

export const tests = [

  /* ---------- 1. 几何 INVALID + 自动 Mc 提示 → BLOCK（N-E 本体） ---------- */
  {
    name: 'V2.0-10-1 ★ 几何 INVALID + 未确认的自动 Mc → BLOCK（自动 Mc 提示不得降级阻断）',
    fn: () => {
      const r = riser({ geom: 'INVALID' });
      assert(r && !r.blocked, '仍要算出结果（本阶段只改等级，不改是否出结果）');
      same(r.level, BLOCK, '几何 INVALID 必须 BLOCK');
      assert(!!r.note, 'note（自动 Mc 提示）仍须随结果返回，不得被吞掉');
      assert(r.D > 0 && r.H > 0, '数值照常给出（阻断的是"建议"，不是"计算"）');
      // 阻断路径不得丢掉 V2.0-08 引入的 mcSrc（结果页「来源：…」要用它；丢了会退回反推 → D2 复发）
      same(r.mcSrc, 'STL_GEOMETRY_ANALYSIS', '阻断路径仍须带 mcSrc');
      same(riser({ geom: 'INVALID', mc: 20, mcUser: true }).mcSrc, 'USER_OVERRIDE', '用户 Mc 的阻断路径 mcSrc 应为 USER_OVERRIDE');
    },
  },

  /* ---------- 2. 几何 INVALID + 用户修改 Mc → BLOCK（人工放行不得旁路几何无效） ---------- */
  {
    name: 'V2.0-10-2 ★ 几何 INVALID + 用户修改 Mc → 仍 BLOCK（人工输入替代不了不可信的网格）',
    fn: () => {
      same(riser({ geom: 'INVALID', mc: 20, mcUser: true }).level, BLOCK, '几何 INVALID + 用户 Mc 必须还是 BLOCK');
      // 勾选热结（多热结路径）同样不得旁路
      same(riser({ geom: 'INVALID', pick: [{ id: 1, mc: 20 }, { id: 2, mc: 12 }] }).level, BLOCK,
        '几何 INVALID + 勾选热结路径必须也是 BLOCK');
    },
  },

  /* ---------- 3. 几何有效 + 自动 Mc 未确认 → 维持 06A1 的人工复核规则 ---------- */
  {
    name: 'V2.0-10-3 几何有效 + 未确认的自动 Mc → 仍是 WARNING_REVIEW（06A1 口径不变）',
    fn: () => {
      const r = riser({});
      same(r.level, WARN, '几何 VALID + 自动 Mc 应维持 WARNING_REVIEW');
      assert(r.level !== SAFE, '未确认的自动 Mc 不得给"可直接采用"');
      assert(!!r.note, '未确认提示必须仍在');
      // 几何 WARNING / NO_HOTSPOT 兜底 同样是 WARNING_REVIEW（原规则）
      same(riser({ geom: 'WARNING' }).level, WARN, '几何 WARNING 应维持 WARNING_REVIEW');
      same(riser({ hs: 'NO_HOTSPOT', items: [] }).level, WARN, 'NO_HOTSPOT 壁厚兜底应维持 WARNING_REVIEW');
    },
  },

  /* ---------- 4. 几何有效 + 用户修改 Mc → 维持既有既定规则（含 PHASE 29 人工放行） ---------- */
  {
    name: 'V2.0-10-4 几何有效 + 用户 Mc → 维持既有规则；分析失败的人工放行不被误伤',
    fn: () => {
      same(riser({ mc: 20, mcUser: true }).level, WARN, '几何 VALID + 用户 Mc 应仍为 WARNING_REVIEW');
      // PHASE 29 人工放行：热结分析失败 + 用户显式 Mc → 放行（不是 BLOCK）
      const released = riser({ hs: 'INSUFFICIENT_RESOLUTION', items: [], mc: 20, mcUser: true });
      assert(released && !released.blocked, '人工放行应真的算出结果');
      same(released.level, WARN, '热结分析失败 + 用户 Mc = 人工放行，必须仍是 WARNING_REVIEW（不得被本次修复误伤）');
      // 低置信度同理
      same(riser({ hs: 'LOW_CONFIDENCE', items: [], mc: 20, mcUser: true }).level, WARN, '低置信度 + 用户 Mc 同为人工放行');
    },
  },

  /* ---------- 5. 其他既有阻断状态不被自动 Mc 提示覆盖 ---------- */
  {
    name: 'V2.0-10-5 其他既有阻断状态：分析失败 / 低置信度仍 BLOCK，不被自动 Mc 提示覆盖',
    fn: () => {
      const a = riser({ hs: 'INSUFFICIENT_RESOLUTION', items: [] });
      assert(a && a.blocked === true, '分析失败应 blocked');
      same(a.level, BLOCK, '分析失败必须 BLOCK');
      assert(!!a.note, '阻断说明必须仍在');
      const b = riser({ hs: 'LOW_CONFIDENCE', items: [] });
      assert(b && b.blocked === true, '低置信度应 blocked');
      same(b.level, BLOCK, '低置信度必须 BLOCK');
      // 几何 INVALID 叠加分析失败：两条阻断都在，仍是 BLOCK
      same(riser({ geom: 'INVALID', hs: 'INSUFFICIENT_RESOLUTION', items: [] }).level, BLOCK, '双重阻断仍 BLOCK');
    },
  },

  /* ---------- 6. 冷铁分支：同类短路已修 ---------- */
  {
    name: 'V2.0-10-6 ★ 冷铁分支同类短路：几何 INVALID 时自动 T / 用户 T 都必须 BLOCK',
    fn: () => {
      const auto = chill({ geom: 'INVALID' });
      assert(auto && !auto.blocked, '冷铁仍要算出结果');
      same(auto.level, BLOCK, '几何 INVALID + 自动 T 必须 BLOCK（修复前是 WARNING_REVIEW）');
      assert(!!auto.note, '"初始建议值"提示仍须返回');
      same(chill({ geom: 'INVALID', chillT: 40, chillTUser: true }).level, BLOCK, '几何 INVALID + 用户 T 也必须 BLOCK');
      // 几何有效时维持原规则
      same(chill({}).level, WARN, '几何 VALID + 自动 T 应维持 WARNING_REVIEW');
      same(chill({ chillT: 40, chillTUser: true }).level, WARN, '几何 VALID + 用户 T 应维持 WARNING_REVIEW');
      // 冷铁的人工放行（分析失败 + 用户 T）不被误伤
      same(chill({ hs: 'INSUFFICIENT_RESOLUTION', items: [], chillT: 40, chillTUser: true }).level, WARN,
        '分析失败 + 用户 T = 人工放行，必须仍是 WARNING_REVIEW');
    },
  },

  /* ---------- 7. 页面与结果卡等级一致（N-E 的跨页不一致） ---------- */
  {
    name: 'V2.0-10-7 ★ 页面与结果卡等级一致：几何 INVALID 时两处都是 BLOCK',
    fn: () => {
      same(page1('INVALID').level, BLOCK, '页面（processPage1）几何 INVALID 应为 BLOCK');
      same(riser({ geom: 'INVALID' }).level, BLOCK, '结果卡几何 INVALID 应为 BLOCK');
      // 几何 VALID / WARNING：页面按纯 reliabilityLevel 给，结果卡按"未确认自动 Mc"给 —— 两者都在"非阻断"区
      same(page1('VALID').level, SAFE, '页面几何 VALID + ok 热结 = SAFE（纯函数口径，未变）');
      same(page1('WARNING').level, WARN, '页面几何 WARNING = WARNING_REVIEW');
      same(riser({ geom: 'WARNING' }).level, WARN, '结果卡几何 WARNING = WARNING_REVIEW');
      for (const g of ['INVALID', 'VALID', 'WARNING']) {
        assert(page1(g).level !== BLOCK || riser({ geom: g }).level === BLOCK,
          `几何 ${g}：页面判 BLOCK 时结果卡不得是别的等级（阻断方向必须一致）`);
      }
    },
  },

  /* ---------- 8. 工程数值基线（PHASE V2.0-22 重新基线化） ---------- */
  {
    name: 'V2.0-10-8 数值基线（PHASE V2.0-22 重新基线化）：D/H/Mc/f/d_neck/Vr 与目标模数契约一致',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：本用例原为"V2.0-10 只改标签、不动数值"的黄金值对照。
      //   V2.0-22 按设计把尺寸改由**目标模数** Mr_target = Mc×1.2 反求（体积约束不再决定尺寸），
      //   故 D/H/Vr/f 全部按新契约重新基线化 —— 唯一未变的是 d_neck（只由 Mc 决定）。
      //   2026-10-11 修复前的旧值（D=H=147、f=1.75、Vr≈2494835.33）保留为历史记录，不再引用。
      const a = riser({ geom: 'INVALID' });                    // 同一批输入，只是等级变了
      same(a.Mc, 14, 'Mc'); same(a.D, 101, 'D'); same(a.H, 101, 'H');
      same(a.d_neck, 56, 'd_neck'); same(a.modOk, true, 'modOk');
      // volOk 已**不是判据**（旧体积口径=整件净重，不再决定尺寸）⇒ 只断言它是布尔诊断值
      assert(typeof a.volOk === 'boolean', `volOk 应为布尔诊断值（实际 ${JSON.stringify(a.volOk)}）`);
      assert(Math.abs(a.final_f - 1.2) < 1e-9, `final_f（实际 ${a.final_f}）`);
      assert(Math.abs(a.Vr - 809196.5131465544) < 1e-6, `Vr（实际 ${a.Vr}）`);
      const b = riser({ geom: 'INVALID', mc: 20, mcUser: true });
      same(b.Mc, 20, 'Mc'); same(b.D, 144, 'D'); same(b.H, 144, 'H'); same(b.d_neck, 80, 'd_neck');
      assert(Math.abs(b.Vr - 2345186.349534166) < 1e-6, `Vr（实际 ${b.Vr}）`);
      const c = riser({});                                     // 几何 VALID（与 INVALID 同尺寸：几何状态只影响等级/文案）
      same(c.D, 101, 'D（VALID）'); same(c.H, 101, 'H（VALID）'); same(c.d_neck, 56, 'd_neck（VALID）');
      // 冷铁数值同样不受影响（仍是 2×Mc；thickness 是区间数组 [min,max]）
      const k = chill({ geom: 'INVALID' });
      assert(Array.isArray(k.thickness) && k.thickness.length === 2, '冷铁应给出厚度区间');
      same(k.thickness[0], 8.4, '冷铁厚度下限'); same(k.thickness[1], 22.4, '冷铁厚度上限');
      same(k.mid, 15.4, '冷铁推荐值');
    },
  },

  /* ---------- 9. 等级字段是唯一被改动的输出 ---------- */
  {
    name: 'V2.0-10-9 只改等级：同一状态下除 level 外的结果字段逐位不变',
    fn: () => {
      // 用"几何 VALID + 自动 Mc"（修复前后 level 都是 WARNING_REVIEW）作对照，
      // 与"几何 INVALID + 自动 Mc"（本次 level 变 BLOCK）逐字段比较 —— 除 level / geomStatus 外必须全同。
      const okRun = riser({});
      const badRun = riser({ geom: 'INVALID' });
      const KEYS = ['Mc', 'D', 'H', 'Mr_act', 'Mr_need', 'Vr', 'effV', 'final_f',
        'd_neck', 'M_neck', 'cw', 'Vc', 'needVol', 'modOk', 'volOk', 'bind', 'dModOnly', 'yieldPct'];
      for (const k of KEYS) {
        assert(Object.is(okRun[k], badRun[k]),
          `字段 ${k} 不应随 geomStatus 变化（VALID=${JSON.stringify(okRun[k])} vs INVALID=${JSON.stringify(badRun[k])}）`);
      }
      same(okRun.level, WARN, '对照场景等级');
      same(badRun.level, BLOCK, 'INVALID 场景等级');
    },
  },
];
