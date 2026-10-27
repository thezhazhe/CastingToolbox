// ============================================================
// PHASE V2.0-08-FINAL（118.txt）· 导出报告与结果页的 Mc 来源 / 可信度一致性
//
//   1 报告冒口段必须印出**可靠度等级**，且与结果页共用同一张标签表（不允许两处各写一份）
//   2 报告必须印出**设计模数 Mc 及其来源**：STL 自动（未经确认）/ 用户确认 / 壁厚参考值
//   3 多热结**逐项**标 Mc 来源（混合场景：H1 用户确认 / H2 仍是检出值）★
//   4 多热结尺寸按形状标注：正方柱不得印成"⌀直径"、球形不得印成"⌀D×H"★
//   5 等级 / 来源缺失时**不出行、不编造**，且不出现 undefined / NaN（对旧结果与合成数据）
//
// 断言纪律：与 117/118 一致 —— 只看**事实是否出现且正确**，不锁死整句中文措辞。
//   报告是中文单语（无 i18n），故这里直接检查关键词。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { buildWorkflowReport, LEVEL_TEXT } from '../js/views/reportGenerator.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const assert = (c, m) => { if (!c) throw new Error(m); };

const REPORT_SRC = read('js/views/reportGenerator.js');
const VIEW_SRC = read('js/views/resultsCenter.js');

/** 受控项目状态（与 phasev2008_test.mjs 同一套，保证两阶段口径可对照） */
const DEFAULT_HS = [{ id: 1, mc: 14, regionVolumeCm3: 60 }, { id: 2, mc: 12, regionVolumeCm3: 25 }];
function setup(o = {}) {
  proj.reset();
  proj.set('material.family', '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', o.geomStatus || 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', o.hsStatus || 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', o.hs || DEFAULT_HS, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', o.mcHot ?? 14, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallHot', 8, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.riserShape', o.shape || 'cyl', SRC.DEFAULT, CONF.LOW);
  if (o.pick) proj.set('process.hsPick', o.pick, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  if (o.mcHotUser != null) proj.set('process.mcHotspot', o.mcHotUser, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
}
const calc = (o) => { setup(o); return getCalcManifest('riser').calculate(); };
/** 报告的冒口段（从模块标题到本节结束），避免被第 4 节参数表里的同名文字干扰 */
function riserReport(o) {
  const r = calc(o);
  const html = buildWorkflowReport({ riser: r });
  const i = html.indexOf('🏗️ 冒口设计');
  assert(i >= 0, '报告中应出现冒口设计模块');
  return { r, txt: html.slice(i, html.indexOf('</div>\n  </div>', i)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') };
}

export const tests = [
  {
    name: '08F-1 ★ 报告冒口段必须给出可靠度等级（不能只列 ✅ 校核行，让读者当成已验证）',
    fn: () => {
      const auto = riserReport({});                       // 未确认的自动 Mc
      assert(/可靠度/.test(auto.txt), '报告应给出可靠度一行');
      assert(auto.txt.includes(LEVEL_TEXT.WARNING_REVIEW[1]),
        `未确认的自动 Mc 应为"${LEVEL_TEXT.WARNING_REVIEW[1]}"，实际：${auto.txt.slice(0, 80)}`);
      assert(!auto.txt.includes(LEVEL_TEXT.SAFE_TO_RECOMMEND[1]),
        '未确认的自动 Mc 的报告里不得出现"可直接采用"');
      const user = riserReport({ mcHotUser: 20 });        // 用户确认
      assert(user.txt.includes(LEVEL_TEXT.WARNING_REVIEW[1]), '人工输入同样为需人工复核（与页面同口径）');
    },
  },
  {
    name: '08F-2 ★ 报告必须印出设计模数 Mc 及其来源（自动 / 用户确认 / 壁厚参考值）',
    fn: () => {
      const auto = riserReport({});
      assert(/设计模数 Mc/.test(auto.txt), '报告应印出设计模数 Mc');
      assert(auto.txt.includes('14'), 'Mc 数值应出现');
      assert(/STL 自动检测/.test(auto.txt) && /未经确认/.test(auto.txt),
        `自动来源必须标明未经确认，实际：${auto.txt.slice(0, 100)}`);
      const user = riserReport({ mcHotUser: 20 });
      assert(/用户确认/.test(user.txt), '用户改过值 → 来源应为用户确认');
      assert(!/STL 自动检测/.test(user.txt), '用户确认的 Mc 不得再标成 STL 自动检测');
      const wall = riserReport({ hsStatus: 'NO_HOTSPOT', hs: [] });
      assert(/壁厚\/结构参考值/.test(wall.txt), `无热结走壁厚参考值，实际：${wall.txt.slice(0, 100)}`);
    },
  },
  {
    name: '08F-3 ★ 多热结报告逐项标 Mc 来源（混合场景两类数字不得并列成同质行）',
    fn: () => {
      const { r, txt } = riserReport({ pick: [{ id: 1, mc: 20 }, { id: 2, mc: 12 }] });
      assert(r.items && r.items.length === 2, '两个热结各出一行');
      assert(/Mc 来源/.test(txt), '多热结表应有「Mc 来源」列');
      assert(/H1/.test(txt) && /H2/.test(txt), '两行都在');
      // H1 = 用户改过（20≠检出14）→ 用户确认；H2 = 仍是检出值(12) → 未经确认
      // PHASE V2.0-22（138.txt §3.5/§四.1）：原锚点「体积校核」列已随"旧体积模型不再是设计判据"移除
      //   （末列改为「目标模数 Mr_target」+「旧体积参考」）。锚点改用多热结表的「Mc 来源」列头 ——
      //   它只出现在多热结表，故切片后仍只覆盖逐热结行（单热结表在它之前，不会污染判定）。
      const seg = txt.slice(txt.indexOf('Mc 来源'));
      assert(seg.length > 0 && txt.indexOf('Mc 来源') >= 0, '多热结表应有「Mc 来源」列（切片锚点）');
      assert(/用户确认/.test(seg) && /未经确认/.test(seg),
        `混合场景必须同时出现"用户确认"与"未经确认"，实际：${seg.slice(0, 160)}`);
      // S5-01：旧体积参考列已移除；末列保留设计依据「目标模数 Mr_target」，不得再是旧判定。
      assert(/目标模数 Mr_target/.test(seg) && !/旧体积参考/.test(seg) && !/体积校核/.test(seg),
        `多热结表应保留「目标模数 Mr_target」且不再出现旧体积列，实际：${seg.slice(0, 160)}`);
    },
  },
  {
    name: '08F-4 ★ 多热结尺寸按形状标注（正方柱不得印成 ⌀直径、球形不得印成 ⌀D×H）',
    fn: () => {
      const sq = riserReport({ shape: 'square', pick: [{ id: 1, mc: 14 }, { id: 2, mc: 12 }] });
      // S5-01：旧体积列已移除。切片锚点改用只出现在多热结表的「Mc 来源」列头。
      assert(sq.txt.includes('Mc 来源'), '多热结表应有「Mc 来源」列（切片锚点）');
      const sqItems = sq.txt.slice(sq.txt.indexOf('Mc 来源'));
      assert(!/⌀/.test(sqItems), `正方柱冒口的尺寸行不应出现 ⌀（应为"方…"），实际：${sqItems.slice(0, 160)}`);
      assert(/方/.test(sqItems), '正方柱应标为"方…"');
      const sp = riserReport({ shape: 'sphere', pick: [{ id: 1, mc: 14 }, { id: 2, mc: 12 }] });
      assert(sp.txt.includes('Mc 来源'), '多热结表应有「Mc 来源」列（切片锚点）');
      const spItems = sp.txt.slice(sp.txt.indexOf('Mc 来源'));
      assert(!/×H/.test(spItems), `球形冒口没有独立的 H 尺寸，不应出现"×H"，实际：${spItems.slice(0, 160)}`);
      // 与单热结路径同一写法（形状库自带 label）
      const one = riserReport({ shape: 'square' });
      assert(/方/.test(one.txt), '单热结正方柱同样应标为"方…"');
    },
  },
  {
    name: '08F-5 等级 / 来源缺失（旧结果、合成数据）→ 不出行、不编造、不出现 undefined/NaN',
    fn: () => {
      // 缺 level / mcSrc / sd 的"裸"结果：只给尺寸，报告必须仍然健壮
      const bare = buildWorkflowReport({ riser: { D: 90, H: 90, Mr_act: 18, Mr_need: 16, eff: 0.14, Vr: 381700, d_neck: 60, modOk: true, volOk: true } });
      assert(!/undefined/.test(bare), '报告不得出现 undefined');
      assert(!/NaN/.test(bare), '报告不得出现 NaN');
      const seg = bare.slice(bare.indexOf('🏗️ 冒口设计'));
      assert(!/可靠度/.test(seg.slice(0, 600)), '等级未知时不得编造等级');
      assert(!/设计模数 Mc/.test(seg.slice(0, 600)), '来源未知时不得编造来源');
      // blocked 分支仍走 ⛔ 说明，不重复出等级行
      const blocked = getCalcManifest('riser');
      proj.reset();
      proj.set('material.family', '球铁');
      proj.set('hotspots.status', 'INSUFFICIENT_RESOLUTION', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      const rb = blocked.calculate();
      assert(rb && rb.blocked, '分析失败应给 blocked');
      const hb = buildWorkflowReport({ riser: rb });
      assert(/⛔/.test(hb), 'blocked 结果应给 ⛔ 说明');
    },
  },
  {
    name: '08F-6 结构守卫：等级标签表单一来源（结果页 import，不得再本地定义一份）',
    fn: () => {
      assert(/export const LEVEL_TEXT/.test(REPORT_SRC), 'LEVEL_TEXT 应由 reportGenerator 导出');
      assert(/import \{[^}]*LEVEL_TEXT[^}]*\} from '\.\/reportGenerator\.js'/.test(VIEW_SRC),
        '结果页应从 reportGenerator import LEVEL_TEXT');
      assert(!/^const LEVEL_TEXT\s*=/m.test(VIEW_SRC), '结果页不得再本地定义 LEVEL_TEXT（两处各写一份 = 标签漂移温床）');
      // 报告侧：来源判定只认 mcSrc，不得从别的字段反推
      assert(/mcSrcText\(r\.mcSrc\)/.test(REPORT_SRC) && /mcSrcText\(it\.mcSrc\)/.test(REPORT_SRC),
        '报告必须只看 calcManifest 标注的 mcSrc');
      assert(!/mcHotspot/.test(REPORT_SRC), '报告不得从 process.mcHotspot 反推 Mc 来源');
    },
  },
  {
    name: '08F-7 工程数值未被报告改动（同一结果对象 → 报告前后数值一致）',
    fn: () => {
      const r = calc({});
      const before = JSON.stringify({ D: r.D, H: r.H, Mc: r.Mc, Mr_act: r.Mr_act, Vr: r.Vr, d_neck: r.d_neck, f: r.final_f });
      buildWorkflowReport({ riser: r });
      const after = JSON.stringify({ D: r.D, H: r.H, Mc: r.Mc, Mr_act: r.Mr_act, Vr: r.Vr, d_neck: r.d_neck, f: r.final_f });
      assert(before === after, `报告生成不得改动结果对象：${before} → ${after}`);
      // PHASE V2.0-22（138.txt §3.5/§四.1）：原基线 147/147 来自旧"体积主导"算法（整件净重顶大尺寸）；
      //   新规则 D = 满足 D/6 ≥ Mc × 1.2 的最小整数，Mc=14 ⇒ 101/101。
      assert(r.D === 101 && r.H === 101, `基线尺寸应为 101/101，实际 ${r.D}/${r.H}`);
      assert(r.final_f === 1.2 && r.bind === 'modulus' && r.converged === true,
        `新规则下恒为 f=1.2 / bind=modulus / converged=true，实际 ${r.final_f}/${r.bind}/${r.converged}`);
    },
  },
];
