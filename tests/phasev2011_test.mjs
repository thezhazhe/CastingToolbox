// ============================================================
// PHASE V2.0-11（121.txt）· 冒口 BLOCK 的原因说明（修 R-1）
//
//   R-1：几何 INVALID 时等级已被 V2.0-10 正确判为 BLOCK，但**卡片不给解释** ——
//        自动 Mc 时显示的是「本次冒口 Mc 采用 STL 自动热结估计值（未经确认）」（属实，但不是阻断原因），
//        用户 Mc 时 note 为空、**连一句都没有**。用户看到 ⛔ 不知道该怎么办。
//
// 断言纪律（121.txt §四）：
//   · **只走真实生产调用路径**：`CALC_MANIFEST.riser.calculate()` 取结果、
//     `buildWorkflowReport()` 走真实报告渲染 —— 不测私有辅助函数，也不靠"搜源码字符串"宣称通过；
//   · 文案断言只看**运行时输出**里的事实（是否出现、出现几次、在第几位），不锁死整句措辞；
//   · 数值用修复前基线（V2.0-10 已记录的黄金值）逐位锁死。
//   ★ PHASE V2.0-22（138.txt §3.4）：尺寸改由目标模数 Mr_target = Mc×1.2 反求（旧体积约束不再决定尺寸）
//     ⇒ 该基线已**合法失效**，`V2.0-11-7` / `V2.0-11-9` 的尺寸/Vr/f 按新契约重新基线化；
//       两用例的实质（几何状态不影响尺寸、报告照常印尺寸）未变，文案断言一字未动。
// ============================================================
import { pathToFileURL } from 'node:url';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { buildWorkflowReport, LEVEL_TEXT } from '../js/views/reportGenerator.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => assert(Object.is(a, b), `${m}（实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}）`);
const count = (s, sub) => s.split(sub).length - 1;

/* 阻断原因的三个必备事实（121.txt §二 R1）：原因 / 建议操作 / 重要限制 */
const REASON = '当前 STL 网格校验无效';
const ACTION = '请检查并修复网格';
const LIMIT = '不应直接用于生产设计';
/* 自动 Mc 的既有口径（V2.0-06A1/V2.0-08），VALID 场景必须逐字不变 */
const AUTO_TAIL = '自动估计值尚未验证适用于所有几何';

const HS2 = [{ id: 1, mc: 14 }, { id: 2, mc: 12 }];
function seed(o = {}) {
  proj.reset();
  proj.set('material.family', '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', o.geom || 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', o.hs || 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', o.items !== undefined ? o.items : HS2, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', 8, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', o.mc ?? 14, o.mcUser ? SRC.USER_OVERRIDE : SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  if (o.pick) proj.set('process.hsPick', o.pick, SRC.USER_INPUT, CONF.USER_CONFIRMED);
}
const riser = (o) => { seed(o); return getCalcManifest('riser').calculate(); };
const BLOCK = 'BLOCK_AUTO_RECOMMEND', WARN = 'WARNING_REVIEW';

export const tests = [

  /* ---------- 1. INVALID + 自动 Mc：等级仍 BLOCK，且明确给出网格无效原因 ---------- */
  {
    name: 'V2.0-11-1 ★ 几何 INVALID + 自动 Mc：等级仍 BLOCK，且**先**看到网格无效的阻断原因',
    fn: () => {
      const r = riser({ geom: 'INVALID' });
      same(r.level, BLOCK, '等级必须仍是 BLOCK（V2.0-10 的优先级不得回归）');
      assert(r.note && r.note.length > 0, '必须给出说明文字');
      assert(r.note.includes(REASON), `缺阻断原因（${REASON}）`);
      assert(r.note.includes(ACTION), '缺建议操作');
      assert(r.note.includes(LIMIT), '缺重要限制（不应直接用于生产设计）');
      // 原因必须**排在最前** —— 121.txt §二 R2.1「必须先看到几何阻断原因」
      same(r.note.indexOf(REASON), 0, '阻断原因必须排在最前');
      // 自动 Mc 的既有说明**保留但不取代**原因
      assert(r.note.includes(AUTO_TAIL), '自动 Mc 的未确认说明被取代了（R2.1 要求可保留）');
      assert(r.note.indexOf(AUTO_TAIL) > r.note.indexOf(REASON), '自动 Mc 说明必须排在阻断原因之后');
    },
  },

  /* ---------- 2. INVALID + 用户 Mc：原 note 为空，仍必须给出阻断原因 ---------- */
  {
    name: 'V2.0-11-2 ★ 几何 INVALID + 用户 Mc：原来 note 为空，现在也必须给出阻断原因',
    fn: () => {
      const r = riser({ geom: 'INVALID', mc: 20, mcUser: true });
      same(r.level, BLOCK, '等级必须仍是 BLOCK');
      assert(r.note && r.note.includes(REASON), '用户 Mc 场景原来 note 为空 ⇒ 现在必须补上阻断原因');
      assert(r.note.includes(ACTION) && r.note.includes(LIMIT), '三要素必须齐全');
      same(r.note.indexOf(REASON), 0, '阻断原因必须排在最前');
    },
  },

  /* ---------- 3. 多热结 + INVALID：原因针对整份几何，不误称为某个热结失败 ---------- */
  {
    name: 'V2.0-11-3 ★ 多热结 + INVALID：阻断原因针对整份几何，不得误称为"某个热结分析失败"',
    fn: () => {
      // (a) 混合：H1 用户改值 / H2 仍是检出值
      const mixed = riser({ geom: 'INVALID', pick: [{ id: 1, mc: 20 }, { id: 2, mc: 12 }] });
      same(mixed.level, BLOCK, '多热结 + INVALID 必须 BLOCK');
      assert(mixed.multi === true, '应走多热结路径');
      assert(mixed.note && mixed.note.includes(REASON), '多热结也必须给出阻断原因');
      same(mixed.note.indexOf(REASON), 0, '阻断原因必须排在最前');
      assert(!mixed.note.includes('热结分析失败') && !mixed.note.includes('置信度不足'),
        `几何问题不得被描述成热结分析问题（实际：${mixed.note}）`);
      // (b) 全部用户改值
      const allUser = riser({ geom: 'INVALID', pick: [{ id: 1, mc: 20 }, { id: 2, mc: 15 }] });
      same(allUser.level, BLOCK, '全部用户改值时同样 BLOCK');
      assert(allUser.note.includes(REASON), '全部用户改值也必须给出阻断原因');
      // (c) 逐热结的子结果不应各自重复一遍阻断原因（原因属于整份几何，只说一次）
      same(count(mixed.note, REASON), 1, '阻断原因只能出现一次（不得逐热结重复）');
    },
  },

  /* ---------- 4. VALID + 自动 Mc：原有提示逐字不变 ---------- */
  {
    name: 'V2.0-11-4 几何 VALID + 自动 Mc：原有未确认提示与等级逐字不变',
    fn: () => {
      const r = riser({});
      same(r.level, WARN, 'VALID + 自动 Mc 仍应为 WARNING_REVIEW');
      assert(r.note.includes(AUTO_TAIL), '自动 Mc 的未确认提示必须仍在');
      assert(!r.note.includes(REASON), '几何有效时**不得**出现网格无效的阻断原因（假警告）');
      same(count(r.note, REASON), 0, '原因出现次数应为 0');
    },
  },

  /* ---------- 5. VALID + 用户 Mc：提示与来源标记不变 ---------- */
  {
    name: 'V2.0-11-5 几何 VALID + 用户 Mc：note 仍为空、来源标记不变',
    fn: () => {
      const r = riser({ mc: 20, mcUser: true });
      same(r.level, WARN, '仍为 WARNING_REVIEW');
      assert(!r.note, `几何有效 + 用户 Mc 不应新增任何 note（实际 ${r.note}）`);
      same(r.mcSrc, 'USER_OVERRIDE', '来源必须仍是用户输入');
    },
  },

  /* ---------- 6. 文案：不重复、不矛盾 ---------- */
  {
    name: 'V2.0-11-6 阻断文案不重复、不自相矛盾',
    fn: () => {
      const r = riser({ geom: 'INVALID' });
      same(count(r.note, REASON), 1, '阻断原因必须恰好出现一次');
      assert(!r.note.includes('可直接采用'), '阻断结果的文案里不得出现"可直接采用"（自相矛盾）');
      // VALID 场景的文案一个字都不该变（与 V2.0-08/-10 的既有口径一致）
      const v = riser({});
      assert(!v.note.includes(LIMIT) && !v.note.includes(ACTION), 'VALID 场景不得混入阻断文案');
      assert(r.note.length <= 400, `阻断文案过长（${r.note.length} 字），与"简洁明确"的要求不符`);
    },
  },

  /* ---------- 7. 工程数值逐位一致（修复前基线 = V2.0-10 记录的黄金值） ---------- */
  {
    name: 'V2.0-11-7 工程数值基线（PHASE V2.0-22 重新基线化）：几何状态仍不影响任何尺寸字段',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：尺寸改由目标模数 Mr_target = Mc×1.2 反求（体积约束不再决定尺寸），
      //   D/H/Vr/f/Mr_act 按新契约重新基线化；d_neck 只由 Mc 决定 ⇒ 未变。
      //   本用例的实质不变：**几何状态只影响等级与文案，不影响任何尺寸/模数字段**。
      const a = riser({ geom: 'INVALID' });                       // 本次唯一改动的场景
      same(a.D, 101, 'D'); same(a.H, 101, 'H'); same(a.Mc, 14, 'Mc'); same(a.d_neck, 56, 'd_neck');
      same(a.Mr_act, 16.833333333333332, 'Mr_act'); same(a.modOk, true, 'modOk');
      // volOk 已**不是判据**（旧体积口径=整件净重，不再决定尺寸）⇒ 只断言它是布尔诊断值
      assert(typeof a.volOk === 'boolean', `volOk 应为布尔诊断值（实际 ${JSON.stringify(a.volOk)}）`);
      assert(Math.abs(a.final_f - 1.2) < 1e-9, `f（实际 ${a.final_f}）`);
      assert(Math.abs(a.Vr - 809196.5131465544) < 1e-6, `Vr（实际 ${a.Vr}）`);
      const b = riser({ geom: 'INVALID', mc: 20, mcUser: true });
      same(b.D, 144, 'D'); same(b.H, 144, 'H'); same(b.Mc, 20, 'Mc'); same(b.d_neck, 80, 'd_neck');
      assert(Math.abs(b.Vr - 2345186.349534166) < 1e-6, `Vr（实际 ${b.Vr}）`);
      // 几何状态**不影响**任何尺寸：只影响等级与文案
      const ok = riser({});
      for (const k of ['D', 'H', 'Mc', 'Mr_act', 'Mr_need', 'Vr', 'effV', 'final_f', 'd_neck', 'M_neck', 'modOk', 'volOk', 'bind', 'dModOnly', 'yieldPct']) {
        assert(Object.is(ok[k], a[k]), `字段 ${k} 不应随 geomStatus 变化（VALID=${ok[k]} vs INVALID=${a[k]}）`);
      }
    },
  },

  /* ---------- 8. mcSrc / 等级 / 来源说明无回归 ---------- */
  {
    name: 'V2.0-11-8 mcSrc、等级与来源说明无回归',
    fn: () => {
      same(riser({ geom: 'INVALID' }).mcSrc, 'STL_GEOMETRY_ANALYSIS', 'INVALID + 自动 Mc 的来源');
      same(riser({ geom: 'INVALID', mc: 20, mcUser: true }).mcSrc, 'USER_OVERRIDE', 'INVALID + 用户 Mc 的来源');
      same(riser({}).mcSrc, 'STL_GEOMETRY_ANALYSIS', 'VALID + 自动 Mc 的来源');
      same(riser({ hs: 'NO_HOTSPOT', items: [] }).mcSrc, 'DERIVED', '壁厚兜底的来源');
      // 其他阻断状态仍是 BLOCK，且它们自己的说明没有被本次改动污染
      const fail = riser({ hs: 'INSUFFICIENT_RESOLUTION', items: [] });
      assert(fail.blocked === true && fail.level === BLOCK, '分析失败仍应 blocked + BLOCK');
      assert(fail.note.includes('热结分析失败'), '分析失败的原有说明必须仍在');
      assert(!fail.note.includes(REASON), '分析失败不得被写成几何问题');
      // 人工放行不被误伤
      same(riser({ hs: 'INSUFFICIENT_RESOLUTION', items: [], mc: 20, mcUser: true }).level, WARN, '人工放行仍为 WARNING_REVIEW');
    },
  },

  /* ---------- 9. 报告路径：同一个 note，只说一次、不矛盾 ---------- */
  {
    name: 'V2.0-11-9 导出报告复用同一 note：阻断原因只出现一次，且等级/尺寸照常印出',
    fn: () => {
      const r = riser({ geom: 'INVALID' });
      const html = buildWorkflowReport({ riser: r });
      same(count(html, REASON), 1, '报告里阻断原因必须恰好出现一次（不得卡片/报告各写一份而重复）');
      assert(html.includes(LEVEL_TEXT[BLOCK][1]), '报告必须印出 BLOCK 等级');
      // PHASE V2.0-22（138.txt §3.4）：尺寸由目标模数反求 ⇒ Mc=14 时为 ⌀101×H101（原体积口径为 ⌀147）
      assert(html.includes('⌀101'), '报告仍应印出实际尺寸（尺寸是"仅供排查参考"，不是不显示）');
      assert(html.includes(LIMIT), '报告也必须带上"不应直接用于生产设计"的限制');
      // 报告走的是"未 blocked"分支（blocked 分支的文案不应出现）
      assert(!html.includes('自动冒口建议不可用'), '不应落到 blocked 分支的兜底文案');
      // VALID 场景的报告不得出现阻断原因
      same(count(buildWorkflowReport({ riser: riser({}) }), REASON), 0, 'VALID 报告不得出现阻断原因');
    },
  },

  /* ---------- 10. 冷铁同口径（R4）：可最小修复故一并做，但当前无可观测效果 ---------- */
  {
    name: 'V2.0-11-10 冷铁同口径给出阻断原因（R4；当前冷铁不在主流程，无可观测产品效果）',
    fn: () => {
      seed({ geom: 'INVALID' });
      const c = getCalcManifest('chill').calculate();
      assert(!c.blocked, '冷铁仍要算出结果');
      same(c.level, BLOCK, '几何 INVALID 时冷铁等级仍为 BLOCK（V2.0-10 的修复不得回归）');
      assert(c.note && c.note.includes(REASON), '冷铁也必须给出几何阻断原因');
      same(c.note.indexOf(REASON), 0, '阻断原因必须排在最前');
      // 冷铁几何有效时行为不变
      seed({});
      const c2 = getCalcManifest('chill').calculate();
      same(c2.level, WARN, '几何有效 + 自动 T 仍为 WARNING_REVIEW');
      assert(!c2.note.includes(REASON), '几何有效时冷铁不得出现阻断原因');
    },
  },
];

/* ---- 自运行（node tests/phasev2011_test.mjs，121.txt §五 要求的命令之一）---- */
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log(`  ✅ ${t.name}`); }
    catch (e) { fail++; console.log(`  ❌ ${t.name}\n     ${String(e.message).split('\n').slice(0, 3).join('\n     ')}`); }
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
