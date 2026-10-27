// ============================================================
// PHASE V2.0-15（126.txt §四）· 冒口**未收敛状态显式化与披露**测试
//
//   本阶段只改"说不说清楚"，**不改任何数值**。因此本套件同时钉住两件事：
//     ① 未收敛状态在**四个入口**都被如实展示，且**不得因 modOk=true 就显示整体通过**；
//     ② `D/H/f/Mr_act/Vr/effV` 与本阶段之前**逐位相同**（数值冻结）。
//
//   证据口径：走**真实生产函数**（runRiser / renderResultsCenter / buildWorkflowReport /
//   riserWarning），不测私有实现细节。
//
//   ★ PHASE V2.0-22（138.txt §3.4）：`runRiser` 的 f 迭代已移除 ⇒ **新结果恒收敛**
//     （`converged === true` / `bind === 'modulus'`），`bind='limit'` 与"未收敛"在新结果上
//     不可能出现。本套件的守卫价值随之分成两半：
//       ① 新契约：真实结果恒收敛、恒达标、归因恒为 modulus（A1/G2）；
//       ② 披露链路：`js/views/riserStatus.js` 的兼容分支仍要服务**旧结果对象**
//          （旧持久化项目 / 旧存档 / 旧测试构造的假数据）⇒ 未收敛样本改为**构造对象**
//          （真实几何 + 旧状态字段，见下方 `legacy()`），四个入口不得对旧结果说谎。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRiser, RISER_SHAPES, meetsTarget } from '../calcs/riser.js';
import * as proj from '../js/model/CastingProject.js';
import { riserConverged, riserWarning, fillWarning } from '../js/views/riserStatus.js';
import { renderResultsCenter } from '../js/views/resultsCenter.js';
import { buildWorkflowReport } from '../js/views/reportGenerator.js';
import { reportHtml } from '../js/views/wizard.js';
import EN from '../js/i18n/en-US.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, tol, m) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m}（期望 ${b}±${tol}，实际 ${a}）`); };

const R = (mc, o = {}) => runRiser({
  mat: o.mat || '球铁', cast_wt: o.cw || 0, mc_mode: 'direct', mc,
  shape: o.shape || 'cyl', hd_ratio: o.hd === undefined ? 1.0 : o.hd,
});

/** 最小 DOM 桩：resultsCenter 的渲染只用到 innerHTML / querySelectorAll */
function stubContainer() {
  const el = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {} };
  return { querySelector: () => el, querySelectorAll: () => [], addEventListener: () => {}, _el: el };
}

/* 未收敛样本 = **构造的旧结果对象**。
   PHASE V2.0-22（138.txt §3.4）：`runRiser` 已移除 f 迭代 ⇒ 恒收敛，真实输出里再没有
   `bind='limit'` / `converged=false`；但 `js/views/riserStatus.js` 的兼容分支（以及
   resultsCenter / wizard / 报告的旧结果路径）仍必须对**旧结果对象**如实披露。
   构造方式 = 取一个真实结果再**就地改状态字段**：几何量（D/H/Mr_act/Vr/eff/sd/cw…）
   全部保持真实，避免手编数字；旧口径下 modOk 是相对"迭代末次要求"算的，故可独立改写。 */
const legacy = (o = {}) => {
  const r = R(5, { cw: 77.56 });                    // 真实几何（球铁 / cyl / hd=1.0）
  return { ...r, converged: false, bind: 'limit', final_f: 3.55, ...o };
};
const LIMIT_VC = legacy({ modOk: true, volOk: false });     // 旧口径下 89% 的实际形态
const LIMIT_BOTH = legacy({ modOk: false, volOk: false });  // 还原后模数也差一点 ⇒ 两条都不通过

export const tests = [
  /* ================= A. 状态字段（126.txt §二.4/§二.5） ================= */
  {
    name: 'V2.0-15-A1 ★ converged 显式导出：新契约 = 真实结果恒收敛、归因恒为本阶段的 modulus',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用新契约。
      let n = 0;
      for (const cw of [0, 0.5, 20, 77.56, 200]) for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
        for (let i = 0; i <= 60; i++) {
          const mc = +(0.5 + i * 0.2).toFixed(4);
          const r = R(mc, { cw, shape });
          if (!r) continue;
          n++;
          assert(typeof r.converged === 'boolean', `converged 必须是布尔（mc=${mc} cw=${cw} ${shape}）`);
          // 新契约：状态恒收敛、归因恒为"由目标模数反求"（旧取值 volume/limit/both/start 不应再出现）
          same(r.converged, true, `新算法应恒收敛（mc=${mc} cw=${cw} ${shape}：converged=${r.converged}）`);
          same(r.bind, 'modulus', `新算法归因应恒为 modulus（mc=${mc} cw=${cw} ${shape}：bind=${r.bind}）`);
        }
      assert(n > 200, `样本量偏小（${n}）`);
    },
  },
  {
    name: 'V2.0-15-A2 ★ converged=false 的旧结果：状态如实读出、警告如实分档（不是标签写错）',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const cases = [
        ['modOk=true / volOk=false', LIMIT_VC, '模数校核通过', '体积校核未通过'],
        ['modOk=false / volOk=false', LIMIT_BOTH, '模数校核与体积校核均未通过', null],
      ];
      for (const [label, r, wantLine, wantFail] of cases) {
        same(riserConverged(r), false, `${label}：converged=false 必须被如实读出（不得因其它字段而翻转）`);
        const w = riserWarning(r);
        assert(!!w, `${label}：标了未收敛就必须出警告`);
        // 警告分档必须与 modOk/volOk 组合一一对应（V2.0-15 修的旧缺陷正是"分档与事实不符"）
        assert(w.key.includes(wantLine), `${label}：警告分档应为「${wantLine}」，实际：${w.key}`);
        if (wantFail) assert(w.key.includes(wantFail), `${label}：警告应点明「${wantFail}」，实际：${w.key}`);
        // 几何量取自真实结果 ⇒ 独立复核仍须逐位成立（构造不得破坏 D/H/Vr 的自洽）
        const sd = RISER_SHAPES.cyl;
        near(r.Mr_act, sd.M(r.D, r.H), 1e-9, `${label}：Mr_act != M(D,H)`);
        near(r.Vr, sd.V(r.D, r.H), 1e-9, `${label}：Vr != V(D,H)`);
      }
    },
  },
  /* ================= B. 未收敛的约束组合（126.txt §四.2/§四.3） ================= */
  {
    name: 'V2.0-15-B1 ★ modOk=true / volOk=false（89% 的实际形态）：警告必须说"模数通过、体积未通过"',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const r = LIMIT_VC;
      same(r.modOk, true, `Mc=${r.Mc} 期望 modOk=true`);
      same(r.volOk, false, `Mc=${r.Mc} 期望 volOk=false`);
      const w = riserWarning(r);
      assert(!!w, '未收敛必须产出警告');
      assert(w.key.includes('模数校核通过'), `警告须说明"模数校核通过"，实际：${w.key}`);
      assert(w.key.includes('体积校核未通过'), `警告须说明"体积校核未通过"，实际：${w.key}`);
      assert(!w.key.includes('均未通过'), '不得把 modOk=true 的情形说成"均未通过"（这正是 V2.0-15 要修的旧缺陷）');
    },
  },
  {
    name: 'V2.0-15-B2 ★ modOk=false / volOk=false：警告必须说"两条均未通过"',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const r = LIMIT_BOTH;
      same(r.modOk, false, `Mc=${r.Mc} 期望 modOk=false`);
      same(r.volOk, false, `Mc=${r.Mc} 期望 volOk=false`);
      const w = riserWarning(r);
      assert(!!w, '未收敛必须产出警告');
      assert(w.key.includes('均未通过'), `警告须说明两条均未通过，实际：${w.key}`);
    },
  },
  {
    name: 'V2.0-15-B3 警告措辞不得外推：既不写"真实铸件必然缩孔"，也不把理论值说成已验证的生产尺寸',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      for (const s of [LIMIT_VC, LIMIT_BOTH]) {
        const w = riserWarning(s);
        for (const bad of ['缩孔', '必然', '一定报废', '已生产验证', '生产验证', '实测验证'])
          assert(!w.key.includes(bad), `警告不得包含外推措辞「${bad}」：${w.key}`);
        assert(w.key.includes('不是收敛解'), '必须明确"不是收敛解"');
        assert(w.key.includes('不能当作已通过全部约束的设计结果'), '必须明确"不可当作已通过全部约束的设计结果"');
      }
    },
  },
  {
    name: 'V2.0-15-B4 已收敛 / 无结果 ⇒ 不产警告（保持沉默，不制造噪音）',
    fn: () => {
      same(riserWarning(R(10, { cw: 0 })), null, '收敛解不得出未收敛警告');
      same(riserWarning(R(30, { cw: 77.56 })), null, '起点即收敛的解不得出未收敛警告');
      same(riserWarning(null), null, '无结果不得出警告');
    },
  },
  /* ================= C. 四个入口的展示（126.txt §三/§四.4） ================= */
  {
    name: 'V2.0-15-C1 ★ 设计中心结果卡：未收敛警告出现在渲染结果里，且不再使用已废弃的旧文案',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const r = LIMIT_VC;
      const c = stubContainer();
      renderResultsCenter(c, { riser: { ...r, level: 'WARNING_REVIEW' } }, { ctx: {}, active: 'riser' });
      const html = c.innerHTML;
      assert(html.includes('未收敛'), '结果卡必须出现"未收敛"');
      assert(html.includes('模数校核通过'), '结果卡必须说明哪条约束通过了');
      assert(html.includes('体积校核未通过'), '结果卡必须说明哪条约束未通过');
      assert(!html.includes('仍未同时满足模数与体积校核'), '已废弃的旧文案不得再出现');
    },
  },
  {
    name: 'V2.0-15-C2 ★ 设计中心结果卡：已收敛时不出现未收敛警告（不得误报）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      const c = stubContainer();
      renderResultsCenter(c, { riser: { ...R(30, { cw: 77.56 }), level: 'WARNING_REVIEW' } }, { ctx: {}, active: 'riser' });
      assert(!c.innerHTML.includes('未收敛'), '收敛解不得被标成未收敛');
    },
  },
  {
    name: 'V2.0-15-C3 ★ 导出报告：未收敛警告必须随报告一起印出（含多热结路径逐条点名）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 77.56, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const r = LIMIT_VC;
      const html = buildWorkflowReport({ riser: { ...r, level: 'WARNING_REVIEW' } }, { fileName: 'T.stl' });
      assert(html.includes('未收敛'), '导出报告必须含未收敛警告');
      assert(html.includes('体积校核未通过'), '导出报告必须说明未通过的约束');
      // 多热结：逐热结点名
      const rBad = LIMIT_VC;
      const rGood = R(30, { cw: 77.56 });
      const html2 = buildWorkflowReport({
        riser: { ...rBad, level: 'WARNING_REVIEW', multi: true, items: [{ ...rBad, hsId: 1 }, { ...rGood, hsId: 2 }] },
      }, { fileName: 'T.stl' });
      assert(/热结 H1：[\s\S]{0,40}未收敛/.test(html2), '多热结报告须逐个热结点名未收敛的那一个');
      assert(!/热结 H2：[\s\S]{0,40}未收敛/.test(html2), '已收敛的热结不得被点名');
    },
  },
  {
    name: 'V2.0-15-C4 ★ 独立计算器与向导：源码级守卫（两个入口都必须引用共享状态模块并出警告）',
    fn: () => {
      const V = read('js/views/riserView.js');
      const W = read('js/views/wizard.js');
      for (const [name, src] of [['riserView.js', V], ['wizard.js', W]]) {
        assert(src.includes("from './riserStatus.js'"), `${name} 必须引用共享状态模块（单一来源）`);
        assert(/riserWarning\(/.test(src), `${name} 必须调用 riserWarning 出未收敛警告`);
        assert(/riserConverged\(/.test(src), `${name} 必须调用 riserConverged 判状态`);
      }
      // 独立计算器：标题不得在未收敛时仍称"推荐/最优解"（i18n 惯例 = 三元在 tr() 之内）。
      //   PHASE V2.0-22（138.txt §3.4）：f 迭代已移除，收敛分支的称谓由「推荐冒口（自动迭代最优解）」
      //   改为「推荐冒口（按目标模数反求）」（旧的「自动迭代」在新算法下已不成立）；未收敛分支不变，
      //   故判据本身（称谓必须随收敛状态改口）保留。
      assert(/tr\(okConv \? '推荐冒口（按目标模数反求）' : '计算所得冒口（未收敛，非最终建议）'\)/.test(V),
        '独立计算器在未收敛时必须换掉"推荐冒口…"这一称谓');
      // 独立计算器自己的导出报告
      assert(/fillWarning\(riserWarning\(r\)\)/.test(V), '独立计算器的导出报告必须带未收敛警告');
      // 向导：不得因 modOk=true 或 r 为空就显示"参数合理"
      assert(!/const allOk = g\.v_ok && g\.vr_ok && \(!r \|\| r\.volOk\)/.test(W),
        '向导的 allOk 不得再使用 (!r || r.volOk) 这一会放行空结果/未收敛结果的写法');
      // PHASE V2.0-22（138.txt §3.5）：旧体积模型已降级为参考值 ⇒ 向导的合格条件从
      //   `r.volOk === true` 改为 `r.modOk === true`（= 达到目标模数）；"三条件同时成立"的判据不变。
      assert(/const riserOk = !!r && conv === true && r\.modOk === true;/.test(W),
        '向导必须以"有结果 + 已收敛 + 达到目标模数"三者同时成立才算合格');
    },
  },
  {
    name: 'V2.0-15-C5 四处文案同源：四个入口渲染的警告都来自 riserStatus，无第二份副本',
    fn: () => {
      const files = ['js/views/resultsCenter.js', 'js/views/reportGenerator.js', 'js/views/riserView.js', 'js/views/wizard.js'];
      for (const f of files) {
        const s = read(f);
        assert(!s.includes('迭代已达上限（f = {f}）仍未'), `${f} 仍残留已废弃的旧 limit 文案硬编码`);
        assert(!/迭代已达上限[^』]{0,80}模数与体积校核/.test(s), `${f} 仍自行编写未收敛文案（应取自 riserStatus）`);
      }
      // 文案模板只允许出现在 riserStatus.js
      const src = read('js/views/riserStatus.js');
      same((src.match(/迭代已达上限/g) || []).length, 4, 'riserStatus 应恰好提供 4 条分档警告模板');
    },
  },
  /* ================= D. 兼容性（126.txt §二.6） ================= */
  {
    name: 'V2.0-15-D1 ★ 旧结果（无 converged 字段）：回退到 bind 推断，不误判、不抛错',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      // 旧存档形态 = 真实几何 + 旧状态字段（bind='limit'），且**没有** converged 字段。
      const archivedLimit = { ...LIMIT_VC }; delete archivedLimit.converged;
      same(riserConverged(archivedLimit), false, '旧结果应仍能被识别为未收敛（bind=limit）');
      assert(!!riserWarning(archivedLimit), '旧结果也应出警告');
      const good = R(30, { cw: 77.56 });
      const legacyOk = { ...good }; delete legacyOk.converged;
      same(riserConverged(legacyOk), true, '已收敛的旧结果不得被误判为未收敛');
      same(riserWarning(legacyOk), null, '已收敛的旧结果不得出警告');
      // 连 bind 都没有（测试构造的假数据）：保守 —— 不声称未收敛
      same(riserConverged({ D: 1, H: 1 }), true, '既无 converged 又无 bind 时不得凭空判为未收敛');
      same(riserWarning({ D: 1, H: 1 }), null, '无法判定时保持沉默');
      same(riserConverged(null), null, '无结果应为 null');
    },
  },
  {
    name: 'V2.0-15-D2 新增字段不破坏既有消费方：字段为纯增量，且不参与任何数值',
    fn: () => {
      const r = R(5, { cw: 77.56 });
      assert('converged' in r, '新结果必须带 converged');
      same(typeof r.converged, 'boolean', 'converged 必须是布尔');
      // 与 bind/dModOnly 同类：只读、不参与计算 —— 源码里不得出现在任何 D/H/f 赋值右侧
      const src = read('calcs/riser.js');
      const body = src.slice(src.indexOf('export function runRiser'));
      assert(!/D\s*=\s*[^;\n]*\bconverged\b/.test(body) && !/H\s*=\s*[^;\n]*\bconverged\b/.test(body)
        && !/f\s*=\s*[^;\n]*\bconverged\b/.test(body), 'converged 不得参与 D/H/f 赋值');
    },
  },
  /* ================= E. hd 入口回归（126.txt §四.5） ================= */
  {
    name: 'V2.0-15-E1 ★ hd ∈ {0.8, 1.0, 1.2, 1.5}（UI 可达集合）× 4 形状：状态字段自洽、警告与状态一致',
    fn: () => {
      let n = 0;
      for (const hd of [0.8, 1.0, 1.2, 1.5]) for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
        for (const cw of [0, 0.5, 20, 77.56]) for (let i = 0; i <= 40; i++) {
          const mc = +(1 + i * 0.25).toFixed(4);
          const r = R(mc, { cw, shape, hd });
          if (!r) continue;
          n++;
          same(r.converged, r.bind !== 'limit', `hd=${hd} ${shape} cw=${cw} mc=${mc}：converged 与 bind 矛盾`);
          const w = riserWarning(r);
          same(!!w, !r.converged, `hd=${hd} ${shape} cw=${cw} mc=${mc}：警告有无与收敛状态不一致`);
          if (w) assert(w.key.includes('未收敛'), '警告必须点明"未收敛"');
        }
      assert(n > 500, `样本量偏小（${n}）`);
    },
  },
  /* ================= F. 无效输入 / 退化（126.txt §四.6） ================= */
  {
    name: 'V2.0-15-F1 ★ 无效输入：Mc ≤ 0 / 未知形状 ⇒ null（不得产出"成功结果"）',
    fn: () => {
      same(runRiser({ mat: '球铁', mc_mode: 'direct', mc: 0, cast_wt: 10, shape: 'cyl', hd_ratio: 1 }), null, 'Mc=0 应返回 null');
      same(runRiser({ mat: '球铁', mc_mode: 'direct', mc: -3, cast_wt: 10, shape: 'cyl', hd_ratio: 1 }), null, 'Mc<0 应返回 null');
      same(runRiser({ mat: '球铁', mc_mode: 'direct', mc: 10, cast_wt: 10, shape: '不存在的形状', hd_ratio: 1 }), null, '未知形状应返回 null');
      same(riserWarning(null), null, 'null 结果不得出警告');
      same(riserConverged(null), null, 'null 结果的状态应为 null');
    },
  },
  {
    name: 'V2.0-15-F2 ★ 设计中心阻断（blocked）：仍走既有阻断分支，不被普通成功渲染覆盖',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      const c = stubContainer();
      renderResultsCenter(c, { riser: { blocked: true, reason: 'analysis_failed', note: '热结分析失败：无法自动给出冒口建议。' } }, { ctx: {}, active: 'riser' });
      const html = c.innerHTML;
      assert(html.includes('⛔'), '阻断结果必须显示阻断标记');
      assert(html.includes('热结分析失败'), '阻断原因必须如实展示');
      assert(!html.includes('未收敛'), '阻断 ≠ 未收敛，不得混为一谈');
    },
  },
  /* ================= G. 数值冻结（126.txt §四.8） ================= */
  {
    name: 'V2.0-15-G1 ★★ 数值冻结（V2.0-22 新基线）：D/H/f/Mr_act/Vr/effV 逐位钉住',
    fn: () => {
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例的基线改为**新算法**的
      //   真实输出（旧基线 106/144/198 是"整件净重 ⇒ f 迭代放大"的历史产物，已随本阶段作废）。
      //   每条新值均经独立复核：`Mr_act ≥ Mr_target` 且 `D` 是**最小可行整数档**（D−1 档不达标）。
      const BASE = [
        { mc: 5, cw: 77.56, D: 36, H: 36, f: 1.20, Mr: 6, Vr: 36643.536711471344 },
        { mc: 8, cw: 77.56, D: 58, H: 58, f: 1.20, Mr: 9.666666666666666, Vr: 153240.60645680293 },
        { mc: 30, cw: 77.56, D: 216, H: 216, f: 1.20, Mr: 36, Vr: 7915003.9296778105 },
        { mc: 3.37, cw: 0, D: 25, H: 25, f: 1.20, Mr: 25 / 6, Vr: null },
        { mc: 3.38, cw: 0, D: 25, H: 25, f: 1.20, Mr: 25 / 6, Vr: null },
      ];
      for (const b of BASE) {
        const r = R(b.mc, { cw: b.cw });
        same(r.D, b.D, `Mc=${b.mc} cw=${b.cw} 的 D 变了`);
        same(r.H, b.H, `Mc=${b.mc} cw=${b.cw} 的 H 变了`);
        near(r.final_f, b.f, 1e-9, `Mc=${b.mc} cw=${b.cw} 的 f 变了`);
        near(r.Mr_act, b.Mr, 1e-12, `Mc=${b.mc} cw=${b.cw} 的 Mr_act 变了`);
        if (b.Vr !== null) near(r.Vr, b.Vr, 1e-6, `Mc=${b.mc} cw=${b.cw} 的 Vr 变了`);
        near(r.effV, r.Vr * r.eff, 1e-9, `Mc=${b.mc} 的 effV ≠ Vr×eff`);
      }
    },
  },
  {
    name: 'V2.0-15-G2 ★★ (V2.0-22 改写) 旧"limit→收敛边界翻转"已随 f 迭代移除：边界带内不得再出现 limit / 未收敛',
    fn: () => {
      // 旧用例（V2.0-13/14 §3）钉的是 mc=1.24 cyl / mc=1.10 sphere_head 两条"由 limit 翻转到收敛"的边界点
      //   （旧值 D=27 / D=24）。PHASE V2.0-22（138.txt §3.4）移除 f 迭代 ⇒ 恒收敛，该现象不可能再出现。
      // 本用例改为：① 冻结这两点的新锚点值（已独立复核 Mr_act ≥ Mr_target、D 为最小整数档）；
      //   ② 在两条旧边界附近各扫 ±0.20（步长 0.01，翻转就发生在这一带），钉住"不再出现 limit 翻转"。
      const anchors = [
        { mc: 1.24, shape: 'cyl', D: 9, H: 9 },
        { mc: 1.10, shape: 'sphere_head', D: 8, H: 8 },
      ];
      for (const a of anchors) {
        const r = R(a.mc, { cw: 0.5, shape: a.shape });
        same(r.D, a.D, `mc=${a.mc} ${a.shape} 的 D 变了（新算法锚点）`);
        same(r.H, a.H, `mc=${a.mc} ${a.shape} 的 H 变了（新算法锚点）`);
        assert(meetsTarget(r.Mr_act, r.Mr_target), `mc=${a.mc} ${a.shape} 锚点须满足 Mr_act ≥ Mr_target`);
      }
      let scanned = 0;
      for (const c of anchors) {
        let prevD = 0;
        for (let i = -20; i <= 20; i++) {
          const mc = +(c.mc + i * 0.01).toFixed(4);
          const r = R(mc, { cw: 0.5, shape: c.shape });
          assert(!!r, `mc=${mc} ${c.shape} 不应无结果`);
          scanned++;
          same(r.bind, 'modulus', `mc=${mc} ${c.shape} 的 bind 应为 modulus（旧 limit 翻转不应再出现）`);
          same(r.converged, true, `mc=${mc} ${c.shape} 应恒收敛`);
          same(riserWarning(r), null, `mc=${mc} ${c.shape} 不得出未收敛警告`);
          assert(meetsTarget(r.Mr_act, r.Mr_target), `mc=${mc} ${c.shape} Mr_act < Mr_target`);
          // 旧"翻转"的症状是 D 在边界处反向跳变 / 虚增一档 ⇒ 这里要求 D 随 Mc 单调不减
          assert(r.D >= prevD, `mc=${mc} ${c.shape} 的 D 随 Mc 应单调不减（${prevD} → ${r.D}）`);
          prevD = r.D;
        }
      }
      same(scanned, 82, `扫描点数应为 82（2 条边界 × 41 点），实际 ${scanned}`);
    },
  },
  /* ================= H. 披露口径（126.txt §五） ================= */
  {
    name: 'V2.0-15-H1 ★★ 向导真实渲染：未收敛不得显示"参数合理"；冒口一栏须标未收敛（126.txt §五）',
    fn: () => {
      const doc = { id: 'QT500-7', title: '球墨铸铁', content: { recommendations: ['建议'] } };
      const gOk = { G: 15, t: 12, A: 480, v: 1.2, v_ok: true, vr: 1.8, vr_ok: true };
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const rLimit = LIMIT_VC;                                   // 未收敛（构造的旧结果对象）
      same(rLimit.converged, false, '样本应未收敛');
      const html = reportHtml(doc, 'md', gOk, rLimit, rLimit.Mc);
      assert(!html.includes('参数合理'), '未收敛时**不得**显示"✅ 参数合理"');
      assert(html.includes('需关注优化项'), '未收敛时应显示"需关注优化项"');
      assert(html.includes('⛔ 未收敛'), '横幅摘要必须点明未收敛');
      assert(html.includes('体积校核未通过'), '必须说明哪条约束未通过');
      assert(html.includes('⛔ 未收敛（迭代达上限）'), '冒口建议表须有"收敛状态"一行');
      assert(html.includes('不可作为最终建议'), '综合判定不得把未收敛当成合格');
      // 反例：收敛解仍必须显示"参数合理"（不得把好结果也说成有问题）
      const rOk = R(30, { cw: 77.56 });
      const htmlOk = reportHtml(doc, 'md', gOk, rOk, 30);
      // （措辞随 V2.0-22 更新：合格条件已由"体积充足"改为"达到目标模数"，该样本两者都满足）
      assert(htmlOk.includes('参数合理'), '已收敛且达到目标模数时应显示"参数合理"');
      assert(!htmlOk.includes('未收敛'), '已收敛不得显示未收敛');
      // 边界：无冒口结果（r=null）不得再被判为合理（V2.0-15 修的第二个漏洞）
      const htmlNull = reportHtml(doc, 'md', gOk, null, 0);
      assert(!htmlNull.includes('参数合理'), '无冒口结果时不得显示"参数合理"');
      assert(htmlNull.includes('— 未计算'), '无冒口结果时应显示"未计算"而不是合格');
    },
  },
  {
    name: 'V2.0-15-H1b ★ 独立计算器：未收敛时标题/徽标/结论文案三处同时改口（源码级守卫）',
    fn: () => {
      const V = read('js/views/riserView.js');
      assert(/if \(!okConv\) parts\.unshift/.test(V), '独立计算器必须为未收敛插入醒目徽标');
      assert(/okConv \? tr\('推荐：'\) : tr\('当前计算所得（未收敛，非最终建议）：'\)/.test(V),
        '独立计算器的结论文案必须随收敛状态改变');
      // PHASE V2.0-22（138.txt §3.4）：f 迭代已移除 ⇒ 收敛分支称谓由「推荐冒口（自动迭代最优解）」
      //   改为「推荐冒口（按目标模数反求）」（旧称谓在新算法下不再成立）；未收敛分支不变，判据保留。
      assert(/okConv \? '推荐冒口（按目标模数反求）' : '计算所得冒口（未收敛，非最终建议）'/.test(V),
        '独立计算器的标题必须随收敛状态改变（未收敛时不得仍称"推荐/最优解"）');
    },
  },
  {
    name: 'V2.0-15-H2 英文词条齐备：4 条分档警告 + 独立计算器新增称谓均已登记',
    fn: () => {
      const src = read('js/views/riserStatus.js');
      const keys = [...src.matchAll(/key: '([^']+)'/g)].map(m => m[1]);
      same(keys.length, 4, `riserStatus 应提供 4 条模板，实际 ${keys.length}`);
      for (const k of keys) assert(typeof EN[k] === 'string' && EN[k].length > 0, `未收敛警告缺英文：${k.slice(0, 30)}…`);
      // PHASE V2.0-22（138.txt §3.4）：独立计算器收敛分支的称谓改口（见 C4/H1b），英文词条须同步登记。
      for (const k of ['未收敛', '计算所得冒口（未收敛，非最终建议）', '当前计算所得（未收敛，非最终建议）：', '推荐冒口（按目标模数反求）'])
        assert(typeof EN[k] === 'string' && EN[k].length > 0, `缺英文：${k}`);
    },
  },
  {
    name: 'V2.0-15-H3 fillWarning：位置参数按出现顺序代入（与 tr 的位置参数规则同口径）',
    fn: () => {
      same(fillWarning(null), '', 'null 应返回空串');
      same(fillWarning({ key: 'a{f}b', params: ['1.25'] }), 'a1.25b', '应代入 {f}');
      same(fillWarning({ key: '无占位符', params: [] }), '无占位符', '无占位符应原样返回');
      same(fillWarning({ key: 'x{f}y{f}', params: ['1', '2'] }), 'x1y2', '多个占位符应按顺序代入');
      // 真实用例：不得残留未替换的 {f}
      // PHASE V2.0-22（138.txt §3.4）：runRiser 已移除 f 迭代 ⇒ 恒收敛；本用例改用构造的旧结果对象继续守披露链路。
      const r = LIMIT_VC;
      const txt = fillWarning(riserWarning(r));
      assert(!txt.includes('{f}'), `填充后不得残留占位符：${txt}`);
      assert(txt.includes('3.55'), `应代入实际 f 值，实际：${txt}`);
    },
  },
  {
    name: 'V2.0-15-H4 历史 PHASE24 T5 未被动过：测试文件与预期均未改',
    fn: () => {
      const t24 = read('tests/phase24_test.mjs');
      // 断言用模板字面量拼装：`热结数应=${expect}，实际 ${…}`（故此处核验模板与期望值本身）
      assert(t24.includes('热结数应=${expect}，实际 ${v3.hotspots.length}'),
        'phase24 T5 的断言模板不得被改动（应保留原样，让其如实失败）');
      assert(/ALHR4510[\s\S]{0,120}?5/.test(t24), 'phase24 T5 对 ALHR4510 的期望值 5 不得被改小/删除');
      assert(!/\b(it|test|describe)\.(skip|only)\b/.test(t24), 'phase24 T5 不得被跳过或独占');
    },
  },
];
