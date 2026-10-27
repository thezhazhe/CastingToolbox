// ============================================================
// 工艺分析结果中心（命令3 第15节 / 19.txt 八 / PHASE 71.5 §2 / PHASE 71.7 · 77.txt 五）
// 结构（产品级三页）：结果导航 + 当前页结果 + 操作区
//   Page1 ① 铸件结构工艺性 —— 铸造工艺性卡片（castability.js 复用）+ 线收缩率/加工余量小卡片
//   Page2 ② 冒口设计       —— riserSection（runRiser 输出；多热结逐块展示）
//   Page3 ③ 经典浇注系统   —— gatingSection（尺寸与总截面积 → 校核 → 详细折叠）
//   出品率与铁水重量页按 77.txt 从设计中心剔除（计算仍执行，供报告/熔炼加料使用）
//   其余可选模块（chill/sandbox/charge/shakeout）若被外部注入结果则殿后
// 数据来自 designCenter 执行结果（calcs/ 纯函数输出）；本文件无任何公式，只做编排/展示
// ============================================================
import * as proj from '../model/CastingProject.js';
import { CALC_MANIFEST, ingateRec, runnerRec, VENT_D_DEFAULT } from '../../calcs/calcManifest.js';
import { RISER_SHAPES } from '../../calcs/riser.js';
import { saveFile } from '../download.js';
import { buildWorkflowReport, LEVEL_TEXT } from './reportGenerator.js';
import { riserWarning } from './riserStatus.js';
import { buildPage1Data, page1Html } from './processPage1.js';
import { buildYieldLedger } from './yieldLedger.js';
import { riserItemFacts, gatingFacts, collectRisks } from './resultFacts.js';
import {
  renderRiserReferenceCards, bindRiserReference, referenceNote, riserTopNote,
  insulatedFormulaNote, insulatedNoEfficiencyNote, insulatedLimitNote,
} from './riserReference.js';
import { RUNNER_SECTIONS, defaultTrapezoidKind, runnerSectionNote } from './gatingReference.js';
import { ENG_NOTES } from './gatingView.js';
import { t as tr, isEn } from '../i18n/index.js';

const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (label, val, ok = null) => `<tr><td>${label}</td><td>${val}${ok === null ? '' : ok ? ' ✅' : ' ⚠️'}</td></tr>`;
const stat = (k, v) => `<div class="dc-stat"><div>${k}</div><div class="dc-stat-v">${v}</div></div>`;
const dt = (label, val) => `<tr><td>${label}</td><td>${val}</td></tr>`;

/* 146 §九：阻流位置是引擎里的英文枚举（ingate/sprue/runner/boundary/unset）——
   原来除 boundary/unset 外一律原样输出，中文界面上直接出现 'sprue' 这种开发术语
   （人工截图验收拍到）。这里补一张**显示层**映射表；引擎枚举与公式一字未动。 */
const CHOKE_TEXT = { ingate: '内浇口', sprue: '直浇道', runner: '横浇道', boundary: '临界并列（≤1%）', unset: '系统不完整（缺内浇口/横浇道输入）' };
const chokeText = (k) => tr(CHOKE_TEXT[k] || k || '—');

/* 浇注建议由 `calcs/gating.js` 生成（那儿是**计算层**，中文模板与数值一体）。
   结果页只做显示层翻译：用模板匹配拆出数值，再走 i18n 词条 —— 不改计算层文案、
   不另算任何数值。未命中的条目原样显示（宁可露出未译，也不吞内容）。 */
const SUG_RULES = [
  [/^⚠️ 内浇口平均流速 ([\d.]+) > ([\d.]+) m\/s（目标 ([\d.]+)）偏高$/,
    m => tr('⚠️ 内浇口平均流速 {v} > {hi} m/s（目标 {t}）偏高', [m[1], m[2], m[3]])],
  [/^ℹ️ 内浇口流速 ([\d.]+) < ([\d.]+) m\/s（偏低，可保留；充型速度较低，需关注充型时间，不缩小面积）$/,
    m => tr('ℹ️ 内浇口流速 {v} < {lo} m/s（偏低，可保留；充型速度较低，需关注充型时间，不缩小面积）', [m[1], m[2]])],
  [/^ℹ️ 流速 ([\d.]+) > ([\d.]+) m\/s（超过企业 R7 审核上限 (.+)式），仅提示参考$/,
    m => tr('ℹ️ 流速 {v} > {limit} m/s（超过企业 R7 审核上限 {type}式），仅提示参考', [m[1], m[2], tr(m[3])])],
  [/^ℹ️ 已按目标流速优化内浇口：总面积 ([\d.]+) → ([\d.]+) mm²（目标 ([\d.]+) m\/s）(；放大较多，请结合内浇口数量\/位置及浇注方式工程复核)?$/,
    m => tr('ℹ️ 已按目标流速优化内浇口：总面积 {from} → {to} mm²（目标 {t} m/s）', [m[1], m[2], m[3]])
      + (m[4] ? tr('；放大较多，请结合内浇口数量/位置及浇注方式工程复核') : '')],
  [/^❌ 排气 ([\d.]+) < 1\.5 倍！需增加排气面积$/,
    m => tr('❌ 排气 {vr} < 1.5 倍！需增加排气面积', [m[1]])],
  [/^⚠️ 排气 ([\d.]+) > 4 倍（企业标准 1\.5~4 倍），排气过大可适当减少$/,
    m => tr('⚠️ 排气 {vr} > 4 倍（企业标准 1.5~4 倍），排气过大可适当减少', [m[1]])],
  [/^⚠️ 内浇道偏小（参考 ([\d.]+) mm²）$/,
    m => tr('⚠️ 内浇道偏小（参考 {a} mm²）', [m[1]])],
  [/^⚠️ 内浇道偏大（可适当减小）$/, () => tr('⚠️ 内浇道偏大（可适当减小）')],
  [/^⚠️ 横浇道不足（需 ([\d.]+) mm²）$/,
    m => tr('⚠️ 横浇道不足（需 {a} mm²）', [m[1]])],
  [/^✅ 参数合理，无需优化$/, () => tr('✅ 参数合理，无需优化')],
];
const trSug = (s) => {
  for (const [re, fn] of SUG_RULES) {
    const m = String(s).match(re);
    if (m) return fn(m);
  }
  return s;
};

const HS_REASON_TEXT = {
  no_candidate: '无候选区域', uniform: '模型壁厚均匀，无相对厚区',
  all_low_confidence: '候选置信度不足', invalid_mesh: '网格无效',
  no_inside_points: '模型过薄，无法可靠分析', refine_limit: '局部细化超限，置信度不足',
};

/* ================= Page2 冒口设计（保持冻结样式 + Mc 来源 + 多热结说明） ================= */
// PHASE V2.0-08-FINAL（118.txt §二）：等级标签表已上移到 reportGenerator.js（那里本来就放着
//   SRC_BADGE_TEXT），**页面与导出报告 import 同一张表** —— 两处各写一份正是 D1 那类漂移的温床。
/** PHASE V2.0-08（117.txt §三）：Mc 是否来自**用户**（复用项目 SRC 语义，不新增状态机）。
 *  `it.mcSrc` 由 calcManifest 在实际选值处标注；缺失时按"不是用户输入"保守处理。 */
const isUserMc = (it) => it?.mcSrc === proj.SRC.USER_OVERRIDE || it?.mcSrc === proj.SRC.USER_INPUT;

/** Mc 来源说明（PHASE 71.6 76.txt 三/十二：结果页必须明确 Mc 输入/来源与"来自现有冒口计算器"）
 *  PHASE 72：显示层双语（来源判定逻辑不变） */
function mcSourceLine(r, ctx) {
  const hsN = ctx.hotspotN || 0;
  const hsOk = ctx.hsStatus === 'ok' && hsN > 0;
  // PHASE V2.0-08（117.txt §三）：来源以**实际送进 runRiser 的那个 Mc** 为准（`r.mcSrc`，
  //   由 calcManifest 在选值处标注），不再从 process.mcHotspot 反推 —— 多热结路径的 Mc 来自
  //   process.hsPick，反推会把用户手工填的值标成「STL 热结检测」（D2）。
  //   `ctx.mcUser` 仅作兜底（本函数被复用于没有 mcSrc 的旧结果时）。
  const src = r.mcSrc || (ctx.mcUser ? proj.SRC.USER_OVERRIDE : null);
  if (src === proj.SRC.USER_OVERRIDE || src === proj.SRC.USER_INPUT) return tr('来源：<b>用户输入</b> Mc = {m} mm（未使用 STL 自动热结点）', [fmt(r.Mc, 1)]);
  // 热结编号按**实际用的那个热结**给（勾选路径下不一定是 H1）
  const hsTag = r.hsId != null ? tr('（热结 H{n}）', [r.hsId])
    : (hsN > 1 ? tr('（最大热结 H1；共 {n} 个热结）', [hsN]) : tr('（热结 H1）'));
  /* S5-02：数据来源保留为普通说明，**不再在结果顶部加粗警告**。
     “Mc 是 STL 估计值、仍需工程复核”的完整提示统一放到冒口结果区域最下方（见 riserSection）。 */
  if (hsOk && src !== proj.SRC.DERIVED) return tr('来源：STL 热结检测 Mc = {m} mm{tail}', { m: fmt(r.Mc, 1), tail: hsTag });
  return tr('来源：壁厚/结构参考值 Mc = {m} mm（未检测到可靠热点，初步估算）', [fmt(r.Mc, 1)]);
}
/* ============================================================
   145.txt §二 P0-1：冒口形状的**尺寸字段映射**（纯显示层，冻结计算链一行未动）
   诊断（`calcs/riser.js` 只读 + 数值探针，见 docs/PHASE_V2.0-P1-R3_WORKBENCH2.md §1）：
     · 设计中心固定按 `hd_ratio = 1.0` 调用 runRiser（calcManifest.js:280），
       而四种形状的模数式在该口径下**全部化简为 M = D/6**
       （cyl a·H/(2a+4H) → D/6 · sphere_head V/A → D/6 · sphere 本就 D/6 · square 同 cyl）
       ⇒ `DfromM` 反求出的 **D 与 H 对四种形状必然完全相同**。这是引擎事实，不是缺陷。
     · 换形状真正改变的是**体积 Vr 与补缩效率 eff**（实测 785 / 654 / 524 / 1000 cm³；14 / 25 / 20 / 14 %）。
     · 原来的 UI 缺陷在**映射层**，共四条：
       ① 没用引擎已经提供的 `RISER_SHAPES[k].label(D,H)`（四形状各自的规范尺寸写法），
          视图自己拼了残缺版本 ⇒ 圆柱/球顶圆柱/正方柱**标签与数值长得几乎一样**；
       ② 球形把"球径"与"高度 H"当两个字段重复展示 —— 对球来说 H 不是独立尺寸（H ≡ D）；
       ③ 球顶圆柱的**球顶半径 R 从不显示**（引擎 label() 里本来就有）；
       ④ 速览卡只放 D/H/Mr，恰好是四形状**完全相同**的四项 ⇒ 换形状时屏幕"毫无变化"。
    ⇒ 修法：尺寸文本一律取自 `RISER_SHAPES[k].label()`（单一来源，不另写一套）；
       按形状给字段集（球形只有一个尺寸自由度）；把 Vr / eff 提到显眼处并说明差异所在。
   ============================================================ */
/** 当前形状的尺寸字段（标签 + 值文本），全部来自引擎形状表 */
function shapeSizeCells(it) {
  const k = it.shapeKey || 'cyl';
  const sd = RISER_SHAPES[k] || RISER_SHAPES.cyl;
  const D = fmt(it.D, 0), H = fmt(it.H, 0);
  const mm = (s) => s + ' mm';
  if (k === 'square') return [stat(tr('冒口边长 a（长 × 宽）'), mm(`${D} × ${D}`)), stat(tr('冒口高度 H'), mm(H))];
  if (k === 'sphere') {
    // 球形：几何**只由球径决定**（引擎里 H ≡ D·hd 且 hd=1 ⇒ H 与 D 是同一个几何量）。
    // 原实现把同一个数同时显示成"冒口球径 ⌀100"和"冒口高度 H 100"两个字段 —— 正是用户报的
    // "直径、半径等字段显示相同数值"。只保留一个尺寸字段，其余交给规格写法与说明行。
    return [stat(tr('冒口球径 D'), mm('⌀' + D))];
  }
  if (k === 'sphere_head') return [stat(tr('冒口直径 D'), mm('⌀' + D)), stat(tr('冒口高度 H'), mm(H)), stat(tr('球顶半径 R'), mm('R' + fmt(it.D / 2, 0)))];
  return [stat(tr('冒口直径 D'), mm('⌀' + D)), stat(tr('冒口高度 H'), mm(H))];
}
/** 引擎形状表的规范尺寸写法（如 `⌀100×H100（R50）` / `球⌀100` / `方100×H100`）
 *  S5 视觉验收：英文界面不能出现 `球⌀75` / `方100` 这类中文前缀。
 *  冻结的 `RISER_SHAPES[k].label()` 不改；只在显示层做**前缀/括号**本地化，数值格式保持不变。 */
function shapeLabelOf(it) {
  const sd = RISER_SHAPES[it.shapeKey] || RISER_SHAPES.cyl;
  try {
    const raw = sd.label(it.D, it.H);
    if (!isEn()) return raw;
    return raw.replace(/^球/, 'Sphere ').replace(/^方/, 'Square ')
      .replace(/（R/, ' (R').replace(/）/, ')');
  } catch (e) { return ''; }
}

/* ============================================================
   146.txt §8：结果卡片 = **核心结论 + 详细信息**
     每个类别：标题 → 核心结论卡（每张只回答一个主要问题）→ 关键数值与单位 → 「详细信息」入口。
     ⚠ 纪律：详细信息里出现的**每一个数都来自现有计算结果对象**，UI 层不做任何工程计算；
       不编造数据来源/公式/适用范围（§8.2 末段）。
   ============================================================ */
/** 核心结论卡（可带状态：ok/bad/ref，状态一律「文字 + 颜色」双表达） */
const coreCard = (label, value, unit, stateText, state) =>
  `<div class="dc-core-card ${state || ''}">
    <div class="dc-core-label">${esc(label)}</div>
    <div class="dc-core-value">${esc(value)}${unit ? `<span class="dc-core-unit">${esc(unit)}</span>` : ''}</div>
    ${stateText ? `<div class="dc-core-state ${state || ''}">${esc(stateText)}</div>` : ''}
  </div>`;

function riserBlock(it, ctx = {}, showHead = false) {
  const row = (label, val, ok) =>
    `<tr><td>${label}</td><td>${val}${ok === null || ok === undefined ? '' : ok ? ' ✅' : ' ⚠️'}</td></tr>`;
  /* R6-S3.1：尺寸/体积/结果事实统一从 resultFacts 读取（报告共用同一口径）。 */
  const f = riserItemFacts(it);
  const sizeCells = f.dimensions.map(d => stat(tr(d.labelKey), `${d.value} ${d.unit}`)).join('');
  /* 用本地化版本（英文界面去掉“球/方”中文前缀）；中文下与 f.shapeLabel 完全一致。 */
  const shapeLabel = shapeLabelOf(it);
  const head = showHead
    ? `<div class="dc-p1-parthead" style="margin-top:6px">${tr('热结 H{n} 的冒口', [it.hsId ?? '1'])}
        ${it.hsMc != null ? `<span class="chip">${tr('检出 Mc')} ${fmt(it.hsMc, 1)} mm</span>` : ''}
        ${isUserMc(it) ? `<span class="chip dc-chip-warn">${tr('用户改为 {m} mm', [fmt(it.Mc, 1)])}</span>` : ''}</div>`
    : '';
  /* 164 §4：发热/保温是正式选择的主结果；普通圆柱 V0 只作为基准出现在明细。 */
  if (it.designType === 'insulated') {
    const hdAct = it.D > 0 ? it.H / it.D : null;
    const mref = it.Mr_act;
    const coreIns = `<div class="dc-core-row" data-insulated-main>
      ${coreCard(tr('发热/保温冒口（经验估算）'), `⌀${fmt(it.D, 0)}×H${fmt(it.H, 0)}`, 'mm', tr('按目标体积反算并回算几何'), '')}
      ${coreCard(tr('目标体积 V1 = 0.4 × V0'), fmt(it.V1 / 1000, 1), 'cm³', tr('V0 {v} cm³ × 40%', [fmt(it.V0 / 1000, 1)]), '')}
      ${coreCard(tr('实际几何体积'), fmt(it.Vactual / 1000, 1), 'cm³',
        it.volumeOk ? tr('按显示尺寸回算，≥ 目标') : tr('按显示尺寸回算，小于目标'), it.volumeOk ? 'ok' : 'warn')}
      ${coreCard(tr('几何模数（参考）'), fmt(mref, 2), 'mm', tr('由新几何 D×H 计算；不作普通目标模数判定'), 'ref')}
    </div>`;
    return `${head}${coreIns}
      ${renderRiserReferenceCards({ modulus: mref, wallThickness: proj.getV('process.wallUsed') })}
      <details class="dc-adv-detail">
        <summary>🔎 ${tr('详细信息')} <span class="chip">${tr('体积换算 / 尺寸反算 / 经验限制')}</span></summary>
        <div class="dc-stats">
          ${stat(tr('普通圆柱基准体积 V0'), fmt(it.V0 / 1000, 1) + ' cm³')}
          ${stat(tr('目标体积 V1 = 0.4 × V0'), fmt(it.V1 / 1000, 1) + ' cm³')}
          ${stat(tr('实际几何体积'), fmt(it.Vactual / 1000, 1) + ' cm³')}
          ${stat(tr('直径 D / 高度 H'), `⌀${fmt(it.D, 0)} / H${fmt(it.H, 0)} mm`)}
          ${it.weightKg != null ? stat(tr('冒口重量（按几何体积与密度）'), fmt(it.weightKg, 3) + ' kg') : ''}
        </div>
        <table class="dc-table">
          ${row(tr('热节模数 Mc（设计输入）'), fmt(f.Mc, 2) + ' mm', null)}
          ${row(tr('实际 H/D'), `${fmt(hdAct, 2)}` + (f.raw?.hd != null ? `（${tr('名义')} ${fmt(f.raw.hd, 2)}）` : ''), null)}
          ${row(tr('几何模数（参考）'), fmt(mref, 2) + ' mm', null)}
          ${it.cw > 0 && it.yieldPct != null ? row(tr('单件（铸件+冒口）出品率（参考）'), fmt(it.yieldPct, 1) + '%', null) : ''}
        </table>
        <div class="field-hint" style="line-height:1.7">${insulatedFormulaNote()}</div>
        <div class="field-hint" style="line-height:1.7">${insulatedNoEfficiencyNote()}</div>
        <div class="field-hint" style="line-height:1.7">${insulatedLimitNote()}</div>
      </details>`;
  }
  /* 145 §二 P0-1 / S4（155 §4.1）：**整段“为什么换形状尺寸不变”只在详细信息出现**。
     主卡片只放尺寸、实际模数、可补缩量与必要状态；不再把公式化简说明贴在卡片旁。 */
  /* S5-05：显示**实际** H/D（由最终整数 D/H 计算）；与名义设计值不同时括号标名义值。
     不能直接用 r.hd（那是输入的名义比例，取整后 H/D 可略偏离）。 */
  const hdActual = f.hd != null ? f.hd : (it.shapeKey === 'sphere' ? 1 : 1);
  const hdNominalRaw = Number(it.hd);
  const hdNominal = Number.isFinite(hdNominalRaw) && hdNominalRaw > 0 ? hdNominalRaw : null;
  const hdIsOne = Math.abs(hdActual - 1) < 1e-9;
  // PHASE V2.0-22（138.txt §五）：主要结果必须给出 Mc、Mc 来源、Mr_target、Mr_actual、D、H。
  //   `Mr_target` 为本阶段新增字段；旧结果对象可能没有它 ⇒ 回退到 `Mr_need`（两者恒等，见 riser.js）。
  const MrT = f.MrT;
  /* 146 §8.1：**目标模数、实际模数、体积是三个不同概念，必须明确区分** ——
     现在分核心卡：① 规格与尺寸 ② 模数校核 ③ 补缩能力（体积 × 效率）。 */
  const core = `<div class="dc-core-row">
    ${coreCard(tr('冒口规格'), shapeLabel || '—', 'mm', tr('本形状标准写法（含半径/边长）'), '')}
    ${coreCard(tr('实际冒口模数 Mr_actual'), fmt(it.Mr_act, 2), 'mm',
      f.modOk ? tr('≥ 目标模数 {v} mm', [fmt(MrT, 2)]) : tr('未达目标模数 {v} mm', [fmt(MrT, 2)]), f.modOk ? 'ok' : 'bad')}
    ${coreCard(tr('可补缩量 = Vr × 补缩效率'), fmt(f.effVCm3, 1), 'cm³',
      tr('Vr {v} cm³ × 效率 {e}%', [fmt(f.VrCm3, 1), fmt(f.effPct, 0)]), '')}
    ${coreCard(tr('冒口体积 Vr'), fmt(f.VrCm3, 1), 'cm³',
      tr('补缩效率 {e}%（随形状变化）', [fmt(f.effPct, 0)]), 'ref')}
  </div>`;
  return `${head}${core}
    ${renderRiserReferenceCards({ modulus: it.Mr_act, wallThickness: proj.getV('process.wallUsed') })}
    <details class="dc-adv-detail">
      <summary>🔎 ${tr('详细信息')} <span class="chip">${tr('完整数值 / 单位 / 计算依据 / 适用条件')}</span></summary>
      <div class="dc-dlg-note">${it.shapeKey === 'sphere'
        ? tr('球形由球径唯一确定（H ≡ D）；换形状改变的是体积 Vr 与补缩效率，不是球径自由度。')
        : hdIsOne
          ? tr('当前 H/D = 1.00：四种形状的模数式在该口径下均化简为 M = D/6，因此换形状不改变 D/H 是几何必然。该结论只适用于当前 H/D 口径，不代表不同形状在工程上等效。')
          : tr('当前 H/D = {hd}：不同形状的模数式不同，D/H 会随形状变化；本次尺寸按目标模数规则反求。', [fmt(hdActual, 2)])}</div>
      ${shapeLabel ? `<div class="dc-shape-line">${tr('本形状规格写法')}：<b>${esc(shapeLabel)}</b>（mm）</div>` : ''}
      <div class="dc-stats">
        ${sizeCells}
        ${stat(tr('冒口体积 Vr'), fmt(f.VrCm3, 1) + ' cm³')}
        ${stat(tr('补缩效率'), fmt(f.effPct, 0) + '%')}
        ${stat(tr('目标冒口模数 Mr_target'), fmt(MrT, 2) + ' mm')}
      </div>
      <table class="dc-table">
        ${row(tr('热节模数 Mc（设计输入）'), fmt(f.Mc, 2) + ' mm', null)}
        ${it.shapeKey === 'sphere'
          ? row(tr('H/D（高度 / 直径）'), tr('球形由球径唯一确定：H ≡ D，不存在独立 H/D 设计自由度'), null)
          : row(tr('H/D（高度 / 直径）'), `${tr('实际')} ${fmt(hdActual, 2)}` + (hdNominal != null && Math.abs(hdActual - hdNominal) > 0.005 ? `（${tr('名义')} ${fmt(hdNominal, 2)}）` : ''), null)}
        ${row(tr('实际冒口模数 Mr_actual'), `${fmt(f.MrAct, 2)} mm（${tr('需 ≥ 目标模数')} ${fmt(MrT, 2)}）`, f.modOk)}
        ${row(tr('可补缩量（体积 × 补缩效率）'), fmt(f.effVCm3, 1) + ' cm³', null)}
        ${row(tr('目标模数比 Mr/Mc'), fmt(f.targetRatio != null ? f.targetRatio : 1.2, 2) + ' × Mc（' + tr('设计规则常量') + '）', null)}
      </table>
      <div class="field-hint" style="line-height:1.7">${tr('推荐尺寸依据当前目标模数规则计算；实际补缩能力尚需结合具体工艺和生产结果验证。')}</div>
      ${bindHint(it)}
    </details>`;
}

/* S5-01：旧体积模型提示已从结果页移除（它按整件净重折算，既不是设计判据，也不是可执行建议）。
   计算字段 volOk/needVol/Vc 仍由核心返回，供历史兼容与内部诊断；展示层不再出现“旧体积参考不足”。 */

/** PHASE V2.0-22（138.txt §四.1）：尺寸归因说明。
 *  本阶段推荐尺寸**只**由目标模数反求 ⇒ `bind` 恒为 `'modulus'`。
 *  ⇒ 旧的 `bind === 'volume'` 分支（"本尺寸由补缩体积校核主导…"）已**删除**：
 *     它在新算法下不可能出现，留着会继续暗示"体积约束决定尺寸"，而那正是本阶段取消的行为。
 *     （字段本身保留在 `runRiser` 返回值里，`dModOnly` 亦保留 —— 删字段会打断其他调用方。）
 *  PHASE V2.0-15（126.txt §三）：未收敛披露仍统一由 `js/views/riserStatus.js` 供给 ——
 *  新结果恒 `converged === true`，但**旧结果对象**仍可能带 `converged === false` 到达这里。 */
function bindHint(it) {
  const w = riserWarning(it);
  if (w) return `<div class="field-hint p72-cn" style="line-height:1.7">${tr(w.key, w.params)}</div>`;
  return '';
}
/** 冒口形状的**只读当前值** + 唯一编辑入口（153.txt §六.3/§十.A）。
 *  旧版在结果页还放了第二个形状下拉，并且它是"立即写 + 防抖重算"，与参数面板的
 *  "草稿 + 保存并分析"是两套语义。本阶段把编辑入口收回参数面板，这里只展示结果。 */
function riserShapeRow(r) {
  const selected = proj.getV('process.riserShape');
  const insulated = selected === 'insulated';
  const cur = insulated ? 'cyl' : (r.shapeKey || selected || 'cyl');
  const sd = RISER_SHAPES[cur] || RISER_SHAPES.cyl;
  const name = insulated ? tr('发热/保温冒口（经验估算）') : tr(sd.name);
  const formula = insulated ? tr('经验估算：V1 = 0.4 × 普通圆柱 V0；沿用当前 H/D 反算尺寸') : tr(sd.formula);
  return `<div class="dc-shape-row" data-shape-readonly>
    <span class="dc-shape-label">${tr('冒口形状')}</span>
    <b class="dc-shape-cur">${esc(name)}</b>
    <span class="field-hint dc-shape-formula" data-shape-formula style="margin:0">${esc(formula)}</span>
    <button type="button" class="dc-mini-btn" data-edit-param="process.riserShape">✎ ${tr('去冒口设计修改')}</button>
  </div>`;
}

function riserSection(r, ctx = {}) {
  if (r.blocked) {
    return `<div class="dc-result-sec">
      <div class="dc-sec-title">② ${tr('冒口设计')}</div>
      <div class="dc-blocked">⛔ ${esc(r.note || tr('自动冒口建议不可用'))}</div>
      <div class="field-hint">${tr('请检查模型后重新导入 STL；若要手工指定模数，请到独立「冒口设计」计算器输入。')}</div>
    </div>`;
  }
  const items = (r.items && r.items.length) ? r.items : [r];
  const lv = LEVEL_TEXT[r.level] || ['🟡', '需人工复核'];
  const multi = items.length > 1;
  /* 153.txt §十.A：参与设计的热结与实际采用的 Mc 必须能一眼核对（多热结时尤其重要）。 */
  const pickedTxt = items.map((it, i) => `H${it.hsId ?? i + 1} · Mc ${fmt(it.Mc, 1)} mm`).join('　');
  // PHASE 78（78.txt 五）：多热结「分页」——点「热结 1 / 热结 2」切换各自冒口信息，避免纵向堆叠
  const body = multi
    ? `<div class="dc-hs-tabs" id="dc_hsTabs">
        ${items.map((it, i) => `<button class="dc-hs-tab ${i === 0 ? 'on' : ''}" data-hs-tab="${i}">🔥 ${tr('热结')} H${it.hsId ?? i + 1}
          <span class="dc-hs-tab-mc">Mc ${fmt(it.Mc, 1)}</span></button>`).join('')}
      </div>
      ${items.map((it, i) => `<div class="dc-hs-pane" data-hs-pane="${i}" ${i === 0 ? '' : 'hidden'}>
        <div class="dc-hint-line">${isUserMc(it) && it.hsMc != null
          ? tr('来源：<b>用户输入</b> Mc = {m} mm（该热结检出 {d} mm）', [fmt(it.Mc, 1), fmt(it.hsMc, 1)])
          : tr('来源：STL 热结检测 Mc = {m} mm（热结 H{n}）', [fmt(it.Mc, 1), it.hsId ?? i + 1])}</div>
        ${riserBlock(it, ctx, false)}
      </div>`).join('')}`
    : `<div class="dc-hint-line">${mcSourceLine(r, ctx)}</div>${riserBlock(r, ctx, false)}`;
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">② ${tr('冒口设计')} <span class="chip">${lv[0]} ${tr(lv[1])}</span>
      ${multi ? `<span class="chip">${tr('{n} 个热结 · 分别设计', [items.length])}</span>` : ''}</div>
    ${riserShapeRow(r)}
    ${body}
    <div class="dc-hint-line" data-riser-picked>${tr('参与设计：')}${esc(pickedTxt)}
      <button type="button" class="dc-mini-btn" data-edit-param="process.mcHotspot">✎ ${tr('改热结/Mc')}</button></div>
    <div class="field-hint dc-eng-note" data-eng-note>${tr('Campbell：冒口优先错位侧上方接入热节；T 字交叉会自成热节、需要更大模数。')}</div>
    <details class="dc-adv-detail">
      <summary>📖 ${tr('工程说明（Campbell 布置 / 计算补充）')}</summary>
      <div class="field-hint p72-cn" style="line-height:1.7">${tr('res.riser.campbell')}</div>
      ${multi ? `<div class="field-hint">${tr('res.riser.multiNote')}</div>` : ''}
      ${r.note ? `<div class="field-hint p72-cn">${esc(r.note)}</div>` : ''}
    </details>
    <div class="dc-src-line">${tr('冒口结果来自现有冒口计算器（riser calculator），数值未经本页修改。')}</div>
    ${items.some(it => !isUserMc(it)) ? `<div class="field-hint" data-mc-estimate-note>${tr('Mc 为基于 STL 几何计算的估计值，实际热节情况仍需结合铸件结构和工艺经验复核。')}</div>` : ''}
    <div class="field-hint dc-ref-note" data-ref-note>${referenceNote()}</div>
    <div class="field-hint dc-top-note" data-top-note>${riserTopNote()}</div>
  </div>`;
}

/* ================= Page3 经典浇注系统（75.txt §12：推荐方案→关键尺寸→示意图→关键计算→详细折叠） ================= */

/**
 * PHASE 78（78.txt 七）：内浇道输入框——把「内浇道厚度 / 个数」两个参数从参数区搬到结果页，
 * 直接显示为可改的框：改厚度/个数 → 内浇道长度 L_g 随之重算（runGating 内按阻流面积反算，公式零改动）。
 * 显示的是**当前生效值**（未设定时 = 推荐值），改动即写入项目（USER_INPUT）→ 触发重算。
 */
function ingateBox(g) {
  const wall = proj.getV('process.wallUsed') || proj.getV('geometry.wallAvg') || 0;
  const rec = ingateRec(wall);
  const gt = g.gt > 0 ? g.gt : rec.gt;
  const gc = g.gc > 0 ? g.gc : rec.gc;
  const isRound = g.gateShape === '圆形';
  const userSet = (proj.getV('process.gateThk') || 0) > 0 || (proj.getV('production.ingateN') || 0) > 0;
  return `<div class="dc-edit-box dc-gating-area">
    <div class="dc-edit-head">${tr('内浇道')} <span class="chip">${tr('改厚度/个数 → 长度自动重算')}</span></div>
    <div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('厚度')}
        <input class="dc-edit-inp" type="number" id="dc_gtEdit" step="any" min="0.1" value="${esc(gt)}"><span class="dc-edit-unit">mm</span>
      </label>
      <label class="dc-edit-fld">${tr('内浇口总数（整模，全部铸件合计）')}
        <input class="dc-edit-inp" type="number" id="dc_gcEdit" step="1" min="1" value="${esc(gc)}"><span class="dc-edit-unit">${tr('个')}</span>
      </label>
      <span class="dc-edit-res">→ ${isRound ? `⌀${fmt(g.D_g, 0)} mm` : `${tr('单条长')} <b>${fmt(g.L_g, 0)}</b> mm`} · ${tr('总截面')} <b>${fmt(g.Fg, 0)}</b> mm²</span>
    </div>
    <div class="dc-edit-hint">${tr('推荐：厚')} <b>${rec.gt} mm</b>（${tr('主体壁厚')} ${fmt(wall, 1)} mm ÷ 3）· ${tr('个数')} <b>2~3 ${tr('个')}</b>
      ${userSet ? ` <button class="dc-mini-btn" id="dc_gtReset">↺ ${tr('用推荐值')}</button>` : ''}
      ｜ ${isRound ? tr('当前为圆形内浇道（由独立计算器设定）') : tr('内浇道长度按阻流面积反算，取 5 mm 档')}</div>
    <div class="dc-edit-hint">${tr('内浇口总数为整套浇注系统中所有铸件的内浇口数量合计。')}</div>
  </div>`;
}

/**
 * PHASE 80（79.txt 追问）：横浇道框——与内浇道同级（厚度 / 条数可改）。
 * 横浇道长度由 S:R:G 比例给出的参考面积反算（runGating 内 ceil 到 5mm 档，公式零改动）：
 * 改条数/厚度 → 长度自动重算。默认值 = 工具既有默认（2 条 × 厚 25 mm），可一键恢复。
 */
function runnerBox(g) {
  const rec = runnerRec();
  const saved = proj.getV('process.runnerSection') || '';
  const autoKind = defaultTrapezoidKind(g.rd?.type);
  const section = RUNNER_SECTIONS[saved] ? saved : (g.runnerSection?.kind || autoKind);
  const isTrap = section !== 'rect';
  const auto = !RUNNER_SECTIONS[saved];
  const label = tr(RUNNER_SECTIONS[section]?.label || '矩形');
  const rs = g.runnerSection && g.runnerSection.kind === section ? g.runnerSection : null;
  const trapN = Number.isInteger(rs?.count) && rs.count > 0
    ? rs.count : (proj.getV('production.trapezoidN') || 1);
  const rt = g.rt > 0 ? g.rt : rec.rt;
  const rc = g.rc > 0 ? g.rc : rec.rc;
  const rectUserSet = (proj.getV('process.runnerThk') || 0) > 0 || (proj.getV('production.runnerN') || 0) > 0;
  const need = g.A_run > 0 ? fmt(g.A_run, 0) + ' mm²' : '—';
  const options = Object.values(RUNNER_SECTIONS).map(s =>
    `<option value="${s.key}" ${s.key === section ? 'selected' : ''}>${tr(s.label)}</option>`).join('');
  const trapMetrics = rs?.ok !== false ? `<div class="dc-gating-metrics" data-runner-trap-metrics>
      <div><span>${tr('上底 a')}</span><b>${fmt(rs?.top, 2)} mm</b></div>
      <div><span>${tr('下底 2a')}</span><b>${fmt(rs?.bottom, 2)} mm</b></div>
      <div><span>${tr('高 h')}</span><b>${fmt(rs?.height, 2)} mm</b></div>
      <div><span>${tr('单条实际 / 目标')}</span><b>${fmt(rs?.actualEach, 0)} / ${fmt(rs?.targetEach, 0)} mm²</b></div>
      <div><span>${tr('总实际 / 目标')}</span><b>${fmt(rs?.actualTotal, 0)} / ${fmt(g.A_run, 0)} mm²</b></div>
    </div>` : `<div class="dc-edit-hint dc-ref-bad">${tr('无法计算：缺少有效的横浇道目标面积')}</div>`;
  const rectMetrics = `<div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('厚度')}
        <input class="dc-edit-inp" type="number" id="dc_rtEdit" step="any" min="0.1" value="${esc(rt)}"><span class="dc-edit-unit">mm</span>
      </label>
      <label class="dc-edit-fld">${tr('条数')}
        <input class="dc-edit-inp" type="number" id="dc_rcEdit" step="1" min="1" value="${esc(rc)}"><span class="dc-edit-unit">${tr('条')}</span>
      </label>
      <span class="dc-edit-res">→ ${tr('单条长')} <b>${fmt(g.L_r, 0)}</b> mm · ${tr('总截面')} <b>${fmt(g.Fr_act, 0)}</b> mm²</span>
    </div>
    <div class="dc-edit-hint">${tr('横浇道参考面积')} ${need}（${tr('由系统比例的 R 系数给出')}）÷（${tr('厚度')} × ${tr('条数')}）→ ${tr('长度取 5 mm 档')}；
      ${tr('默认')} <b>${rec.rc} ${tr('条')} × ${tr('厚')} ${rec.rt} mm</b>（${tr('工具既有默认')}）
      ${rectUserSet ? ` <button class="dc-mini-btn" id="dc_rtReset">↺ ${tr('用默认值')}</button>` : ''}
      ｜ ${tr('改条数/厚度会同步改变实际面积比 S:R:G 与阻流位置判定')}</div>`;
  return `<div class="dc-edit-box dc-gating-area" data-runner-section-box data-runner-kind="${section}">
    <div class="dc-edit-head">${tr('横浇道')} <span class="chip">${tr('当前：{s}', [label])}</span>
      <span class="chip">${auto ? tr('自动匹配') : tr('手动选择')}</span></div>
    <div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('截面形式')}
        <select class="dc-edit-inp dc-edit-select" id="dc_runnerSection">${options}</select>
      </label>
      ${isTrap ? `<label class="dc-edit-fld">${tr('数量')}
        <input class="dc-edit-inp" type="number" id="dc_trapN" step="1" min="1" value="${esc(trapN)}"><span class="dc-edit-unit">${tr('条')}</span>
      </label>` : ''}
      ${!isTrap ? '' : `<span class="dc-edit-res">→ ${tr('单条目标面积')} <b>${fmt(rs?.targetEach, 0)}</b> mm² · ${tr('总面积')} <b>${fmt(rs?.actualTotal, 0)}</b> mm²</span>`}
    </div>
    ${!isTrap ? rectMetrics : `${trapMetrics}
      <div class="dc-edit-hint">${tr('目标总面积 A_run = {a} mm²；A_each = A_run ÷ 条数 = {e} mm²。尺寸按 {s} 面积公式反算并回算。', [fmt(g.A_run, 0), fmt(rs?.targetEach, 0), label])}</div>
      <div class="dc-edit-hint">${runnerSectionNote()}</div>`}
    <div class="dc-edit-hint">${auto
      ? tr('自动匹配：开放式 → 扁梯形；封闭式 → 高梯形；自定义/其它 → 标准梯形。手动选择后会保留。')
      : tr('当前为手动选择的截面；系统类型变化不会自动覆盖。')}
      ${!auto ? `<button class="dc-mini-btn" id="dc_runnerAuto">↺ ${tr('恢复自动匹配')}</button>` : ''}</div>
  </div>`;
}

/**
 * PHASE 79（79.txt 四）定稿口径：排气 = **用户定直径、系统算孔数**。
 *   直径可输入（默认 ⌀3，可改 ⌀2/⌀1 …）；孔数为只读结果 = ⌈目标排气面积 ÷ 单孔面积⌉，
 *   目标面积 = 企业标准下限 1.5 × 直浇道实际面积 → 比值恒 ≥1.5，不再出现"排气不足"红字。
 */
function ventBox(g) {
  const d = g.ventD || proj.getV('process.ventD') || VENT_D_DEFAULT;
  const n = g.ventN || 0;
  const hole = Math.PI * d * d / 4;
  const tooMany = n > 40;   // 与 gating 内部规则同口径：孔数过多宜增大直径
  return `<div class="dc-edit-box">
    <div class="dc-edit-head">${tr('排气')} <span class="chip">${tr('直径可改 · 孔数由总排气面积自动生成')}</span></div>
    <div class="dc-edit-row">
      <label class="dc-edit-fld">${tr('排气孔直径')}
        <input class="dc-edit-inp" type="number" id="dc_ventD" step="any" min="0.5" value="${esc(d)}"><span class="dc-edit-unit">mm</span>
      </label>
      <span class="dc-edit-res">→ <b>${n}</b> ${tr('个')} ⌀${fmt(d, 2)} mm ${tr('圆孔')} · ${tr('总排气面积')} <b>${fmt(g.vt, 1)}</b> mm² · ${tr('比值')} <b>${fmt(g.vr, 2)}</b> ${tr('倍')} ${g.vr_ok ? '✅' : '⚠️'}</span>
    </div>
    <div class="dc-edit-hint">${tr('孔数 = 目标排气面积 {a} mm²（企业标准 1.5 × 直浇道 {b} mm²）÷ 单孔面积 {c} mm² 向上取整。', [fmt(g.ventNeed, 0), fmt(g.Fs_act, 0), fmt(hole, 2)])}
      ${tr('企业标准：总排气面积为直浇道的 1.5~4 倍；圆孔直径 3~10 mm（随壁厚），方片厚度 ≤ 铸件壁厚。')}
      ${tooMany ? tr('res.vent.tooMany') : ''}</div>
  </div>`;
}

/** 168 D1：原在参数输入区的排气规则 + 浇注系统工程原则，移入结果“详细信息”。
 *  文字仍来自同一来源（gatingView.ENG_NOTES / 既有排气规则），只改展示位置。 */
function gatingEngineeringNotesHtml() {
  const keys = ['sprue', 'runner', 'turn', 'gateVel', 'filter'];
  return `<div data-gating-engineering>
    <div class="dc-p1-parthead" style="margin-top:10px">${tr('工程说明（不参与计算）')}
      <span class="chip">${tr('说明性原则')}</span></div>
    <details class="dc-dlg-help"><summary>ⓘ ${tr('排气规则')}</summary>
      <div class="dc-dlg-help-body">${tr('总排气面积 1.5~4 倍 S直；圆孔直径 3~10 mm（随壁厚）；方片厚度 ≤ 铸件壁厚。')}</div>
    </details>
    <details class="dc-dlg-help"><summary>📐 ${tr('浇注系统工程原则（{n} 条）', [keys.length])}</summary>
      <div class="dc-dlg-help-body">
        ${keys.map(k => `<div class="dc-dlg-note">· ${esc(tr(ENG_NOTES[k]))}</div>`).join('')}
        <div class="dc-dlg-note">${tr('以上为工程提示，不参与任何计算或判定；具体取值仍应结合合金、铸件结构与浇注工艺确定。')}</div>
      </div>
    </details>
  </div>`;
}

function gatingSection(g, results = {}) {
  /* R6-S3.1（154.txt §六.2/§八）：结果页与报告共用 `gatingFacts` 的三段/整模账目/RH 口径。 */
  const f = gatingFacts(g, results);
  const ledger = f.ledger;
  const rs = g.runnerSection;
  const runnerDetail = rs?.isTrapezoid
    ? `${rs.count} ${tr('条')} × ${tr('上底')} ${fmt(rs.top, 2)} × ${tr('下底')} ${fmt(rs.bottom, 2)} × ${tr('高')} ${fmt(rs.height, 2)} mm → ${fmt(rs.actualTotal, 0)} mm²（${tr('目标')} ${fmt(rs.targetTotal, 0)}）`
    : `${g.rc} ${tr('条')} × ${tr('厚')} ${g.rt} mm × ${tr('长')} ${fmt(g.L_r, 0)} mm → ${fmt(g.Fr_act, 0)} mm²`;
  const rhSrcTxt = tr(f.rh.labelKey);
  const prodLine = f.production.line;
  const prodMethod = f.production.method;
  /* g.ya 是未舍入的实际反算值；g.yv 是取整回显。全节统一用 dy，避免 69% 与 68.5% 同页。 */
  const dy = (g.ya != null ? g.ya : g.yv);
  const sugs = g.sugs || [];
  const shapeTxt = g.gateShape === '圆形'
    ? `${g.gc} ${tr('个')} × ⌀${fmt(g.D_g, 0)} mm`
    : `${g.gc} ${tr('个')} × ${tr('厚')} ${g.gt} mm × ${tr('长')} ${fmt(g.L_g, 0)} mm`;
  const detailRows = [
    [tr('生产条件'), `${tr('型腔数')} ${g.cav} ${tr('件')} · ${tr('预估出品率')} ${fmt(dy, 1)}% · ${tr('造型线')} ${esc(tr(prodLine))} · ${tr('铸造方法')} ${esc(tr(prodMethod))}`],
    [tr('RH（冒口顶面高出铸件顶面）'), `${fmt(g.rh, 1)} mm（${rhSrcTxt}；C = ph + RH）`],
    [tr('铸件质量 W_c = 单件 × 型腔数'), `${fmt(g.castingMass, 2)} kg（${g.pw} kg × ${g.cav} ${tr('件')}；${tr('仅 P47 浇注时间公式用')}）`],
    [tr('预计浇铸重量 G（÷ 出品率）'), `${fmt(g.G, 2)} kg（${tr('预估出品率')} ${fmt(g.yv, 1)}%）`],
    [tr('铸件高度 ph / RH'), `${fmt(g.ph, 1)} / ${fmt(g.rh, 1)} mm`],
    ['C = ph + RH', `${fmt(g.Cmm, 1)} mm`],
    [tr('浇口盆高度 Hb（查表）'), `${fmt(g.Hb, 0)} mm`],
    [tr('P 值（依浇注方向）'), `${fmt(g.Pv, 1)} mm`],
    [tr('平均静压头 Hp'), `${fmt(g.Hp, 1)} mm（${esc(tr(g.pos))}，Ho=${fmt(g.Ho, 0)}）`],
    [`${tr('流速系数 fv')}（${g.filterUsed ? tr('已用过滤网 −0.1') : tr('未用过滤网')}）`, fmt(g.fv, 2)],
    [tr('浇注时间 t（PHASE 47 公式）'), fmt(g.t, 2) + ' s'],
    [tr('阻流截面 A（奥赞）'), fmt(g.A, 0) + ' mm²'],
    [tr('直浇道 S'), '⌀' + fmt(g.D_sp, 0) + ' mm → ' + fmt(g.Fs_act, 0) + ' mm²'],
    [tr('横浇道 R'), runnerDetail],
    [tr('内浇口 G'), shapeTxt + ` → ${fmt(g.Fg, 0)} mm²`],
    [tr('实际面积比 S:R:G'), `${fmt(g.s_r, 2)} : ${fmt(g.r_r, 2)} : ${fmt(g.g_r, 2)}（${tr('实')} ${fmt(g.rrv, 2)} : ${fmt(g.rgv, 2)}）`],
    [tr('实际阻流截面（P51 判定）'), `${esc(chokeText(g.chokePosition))} · ${fmt(g.chokeArea, 0)} mm²`],
    [tr('理论特征流速 fv√(2gHp)'), fmt(g.vTheory, 2) + ' m/s（' + tr('内部诊断值') + '）'],
    [tr('目标内浇口速度推荐'), g.vTarget ? fmt(g.vTarget, 2) + ' m/s' : tr('铸钢/铜：本工具不设目标速度')],
    [tr('液面上升速度 vL（参考）'), fmt(g.vL, 2) + ' mm/s'],
    [tr('排气面积比'), `${fmt(g.vr, 2)} ${tr('倍')}（${tr('实际')} ${fmt(g.vt, 0)} mm² / ${tr('直浇道')} ${fmt(g.Fs_act, 0)} mm²；${tr('企业标准 1.5~4 倍')}）`],
    [tr('设计预估出品率（用于反算 G）'), fmt(dy, 1) + '%'],
    [tr('铸件重 ÷ G（恒等反算，不是实重统计）'), fmt(g.ya, 1) + '%'],
  ].map(([a, b]) => dt(a, b)).join('');
  /* 146 §8.1：浇注系统核心卡 —— 只放**现有计算链真实提供**的关键尺寸与参数，不为填满卡片造数据。 */
  const core = `<div class="dc-core-row">
    ${coreCard(tr('预计浇铸重量'), fmt(g.G, 1), 'kg', tr('单件 × 型腔数 ÷ 预估出品率'), '')}
    ${coreCard(tr('浇注时间 t'), fmt(g.t, 1), 's', tr('PHASE 47 公式（按主壁厚与 Hp）'), '')}
    ${coreCard(tr('阻流截面 A'), fmt(g.A, 0), 'mm²', tr('奥赞公式'), '')}
    ${coreCard(tr('内浇口流速'), fmt(g.vFinal, 2), 'm/s',
      g.vState === 'high' ? tr('略高（R7 ≤{v}）；可在本页增大内浇口总截面后重新分析', [g.vLimit ?? '—']) : tr('在目标区间或偏低'), g.vState === 'high' ? 'warn' : 'ok')}
  </div>`;
  const prodBlock = `<div class="dc-gating-prod" data-gating-prod>
    <div class="dc-p1-parthead" style="margin-top:10px">${tr('生产条件')}
      <span class="chip">${tr('型腔数 / 预估出品率 / 造型线 / 铸造方法')}</span>
      <button type="button" class="dc-mini-btn" data-edit-param="production.cavities">✎ ${tr('修改生产条件')}</button></div>
    <div class="dc-stats">
      ${stat(tr('型腔数（一模件数）'), `${f.production.cav ?? '—'} ${tr('件')}`)}
      ${stat(tr('整模铸件毛坯重'), fmt(ledger.blankTotal, 2) + ' kg')}
      ${stat(tr('预计浇铸重量 G'), fmt(ledger.pourWt, 2) + ' kg')}
      ${stat(tr('设计预估出品率'), fmt(ledger.designYield, 1) + '%')}
    </div>
    <div class="field-hint">${tr('当前为工艺预估值（G 由它反推）。获得实际出品率后，可手动输入并回算相关参数。')}
      <button type="button" class="dc-mini-btn" data-calc-link="yield">📊 ${tr('去“出品率与铁水重量”回算')}</button></div>
    <div class="dc-hint-line">${tr('RH（浇注系统用）')}：<b>${fmt(g.rh, 1)} mm</b>
      <span class="chip ${f.rh.isUser ? 'chip-ok' : 'dc-chip-warn'}">${esc(rhSrcTxt)}</span>
      <button type="button" class="dc-mini-btn" data-edit-param="process.riserHeight">✎ ${tr('修改 RH')}</button></div>
    ${!f.rh.isUser ? `<div class="dc-hint-p1">⚠️ ${tr('RH 未指定：浇注系统按 RH = 0 计算，Hp 可能偏离实际；请按实际冒口位置填写。')}</div>` : ''}
  </div>`;
  /* S5（160.txt §三.S5.1）：整模重量口径是**核对信息**，不是做决定的主结果；
     移到主“详细信息”折叠区内，主界面只留生产条件与必要提示。 */
  const weightLedger = `<details class="dc-adv-detail dc-weight-ledger">
      <summary>⚖️ ${tr('整模重量口径核对')} <span class="chip">${tr('设计口径 · 非实重统计')}</span></summary>
      <table class="dc-table" style="margin-top:8px">
        ${dt(tr('单件毛坯重'), fmt(ledger.blankWt, 2) + ' kg')}
        ${dt(tr('整模铸件毛坯重 = 单件 × 型腔数'), fmt(ledger.blankTotal, 2) + ' kg')}
        ${dt(tr('预计浇铸重量 G'), fmt(ledger.pourWt, 2) + ' kg')}
        ${dt(tr('差值 = G − 整模铸件重（含冒口 + 浇道）'), ledger.delta != null ? fmt(ledger.delta, 2) + ' kg' : '—')}
        ${dt(tr('单套冒口重（现有冒口结果）'), ledger.riserUnit != null ? fmt(ledger.riserUnit, 2) + ' kg' : tr('未计算/被阻断'))}
        ${dt(tr('整模冒口重（× 型腔数；假设每腔一套）'), ledger.riserTotal != null ? fmt(ledger.riserTotal, 2) + ' kg' : '—')}
        ${dt(tr('浇道重（反推残差，假设每腔一套冒口）'), ledger.gatingEst != null ? fmt(ledger.gatingEst, 2) + ' kg' : '—')}
        ${dt(tr('铸件占 G（恒等于设计预估出品率）'), ledger.productShare != null ? fmt(ledger.productShare, 1) + '%' : '—')}
        ${dt(tr('铸件 + 冒口占 G（未含浇道）'), ledger.productPlusRiserShare != null ? fmt(ledger.productPlusRiserShare, 1) + '%' : '—')}
      </table>
      <div class="field-hint">${tr('本表是设计口径的重量分解，不是实称产出。G 由预估出品率反推，浇道重是反推残差（带“每腔一套冒口”假设）。实际出品率请用本厂实绩在独立「出品率与铁水重量」计算器中手动输入并回算。')}</div>
    </details>`;
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">③ ${tr('经典浇注系统设计')} <span class="chip">${esc(tr(g.ratioKey) || '—')}</span>
      ${rs ? `<span class="chip">${tr('横浇道：{s}', [tr(rs.label || (rs.isTrapezoid ? '梯形' : '矩形'))])}</span>` : ''}
      <span class="chip">${esc(tr(g.systemType) || '—')}</span>
      <button type="button" class="dc-mini-btn" data-edit-param="process.riserHeight">✎ ${tr('修改浇注条件')}</button></div>
    ${!f.validity.ok ? `<div class="dc-hint-p0" role="alert">⛔ ${esc(tr(f.validity.textKey))}
      <button type="button" class="dc-mini-btn" data-edit-param="process.riserHeight">${tr('去修改 RH')}</button></div>` : ''}
    ${core}
    ${prodBlock}

    <div class="dc-p1-parthead" style="margin-top:12px">${tr('浇道尺寸与截面')}
      <span class="chip">${tr('按直浇道 / 横浇道 / 内浇道组织')}</span></div>
    <div class="dc-gating-areas">
      <div class="dc-edit-box dc-gating-area">
        <div class="dc-edit-head">${tr('直浇道')} <span class="chip">${tr('系统入口')}</span></div>
        <div class="dc-gating-metrics">
          <div><span>${tr('直径')}</span><b>⌀${fmt(f.areas[0].diameter, 0)} mm</b></div>
          <div><span>${tr('实际总截面')}</span><b>${fmt(f.areas[0].area, 0)} mm²</b></div>
          <div><span>${tr('参考截面')}</span><b>${fmt(f.areas[0].reference, 0)} mm²</b></div>
        </div>
        <div class="dc-edit-hint">${tr('横浇道/内浇道尺寸按 S:R:G 比例与阻流面积反算；当前阻流位置：')}<b>${esc(chokeText(g.chokePosition))}</b></div>
      </div>
      ${runnerBox(g)}
      ${ingateBox(g)}
    </div>
    ${!g.vr_ok ? `<div class="dc-hint-p1">⚠️ ${tr('排气面积比 {v} 倍不在企业标准 1.5~4 倍内；请到下方“详细信息 → 排气”调整孔直径/孔数。', { v: fmt(g.vr, 2) })}</div>` : ''}

    <details class="dc-adv-detail">
      <summary>🔎 ${tr('详细信息')} <span class="chip">${tr('校核 · 建议 · 完整计算过程')}</span></summary>
      <div class="dc-p1-parthead" style="margin-top:10px">${tr('校核')} <span class="chip">${tr('企业口径 R7')}</span></div>
      <table class="dc-table">
        ${t(tr('系统特征'), esc(tr(g.systemType) || '—') + `（${esc(tr(g.ratioKey)) || '—'}）`)}
        ${t(tr('内浇口流速'), fmt(g.vFinal, 2) + ` m/s（${g.rd?.type ? tr(g.rd.type) + tr('式') : ''} R7 ≤${g.vLimit ?? '—'}）`, g.vState !== 'high')}
        ${t(tr('排气面积比'), fmt(g.vr, 2) + ' ' + tr('倍（企业标准 1.5~4）'), g.vr_ok)}
        ${t(tr('实际面积比 S:R:G'), `${fmt(g.s_r, 2)} : ${fmt(g.r_r, 2)} : ${fmt(g.g_r, 2)}（${tr('实')} ${fmt(g.rrv, 2)} : ${fmt(g.rgv, 2)}）`)}
        ${t(tr('阻流位置'), esc(chokeText(g.chokePosition)))}
        ${t(tr('液面上升速度 vL'), fmt(g.vL, 2) + ' mm/s（' + tr('参考') + '）')}
        ${g.vTarget ? t(tr('目标内浇口速度'), fmt(g.vTarget, 2) + ' m/s'
          + `（${tr('当前')} ${fmt(g.vFinal, 2)}：${g.vState === 'high' ? tr('偏高，建议按目标速度优化') : g.vState === 'low' ? tr('偏低，可保留（不缩小面积）') : tr('在目标区间')}）`,
          g.vState !== 'high') : ''}
      </table>
      ${rs?.isTrapezoid ? `<div class="field-hint" style="line-height:1.7">${runnerSectionNote()}</div>` : ''}
      ${weightLedger}
      ${/* 建议条目由计算器内部按数值插值生成（中文模板）；显示层通过 trSug() 拆数值走 i18n，
           计算层与数值一字未改；未命中模板的条目原样显示。 */ ''}
      ${sugs.slice(0, 4).map(s => `<div class="dc-p1-bline ${s.startsWith('✅') ? 'ok' : s.startsWith('ℹ️') ? '' : 'warn'}">${esc(trSug(s))}</div>`).join('')}
      ${g.boundaryNote ? `<div class="dc-p1-bline warn p72-cn">${esc(g.boundaryNote)}</div>` : ''}

      <div class="dc-p1-parthead" style="margin-top:10px">${tr('排气（次级参数）')}
        <span class="chip">${tr('直径可改 · 孔数由总排气面积自动生成')}</span></div>
      ${ventBox(g)}

      <details class="dc-advanced" style="margin-top:8px">
        <summary>📐 ${tr('详细计算过程')} <span class="chip">${tr('奥赞公式 · 企业口径 · 全部保留')}</span></summary>
        <table class="dc-table" style="margin-top:8px">${detailRows}</table>
      </details>
      ${gatingEngineeringNotesHtml()}
    </details>
    <div class="dc-src-line">${tr('浇注系统结果来自现有浇注系统计算器（gating calculator）。')}</div>
  </div>`;
}

function yieldSection(y, hasRiser, allResults = {}) {
  const line = proj.getV('production.line');
  const g = allResults?.gating || null;
  /* 153.txt §四：旧实现用 `y.castWt / y.pourWt`（单件 ÷ 整模 G）⇒ 2 腔 32.5%、4 腔 16.25%。
     受冻结边界限制不能改 yield 计算；这里改为整模账目，并明确它不是实重最终出品率。 */
  const ledger = buildYieldLedger({
    cav: g?.cav ?? (proj.getV('production.cavities') || 1),
    blankWt: g?.pw ?? y.castWt,
    pourWt: g?.G ?? y.pourWt,
    riserWt: y.riserUnit ?? y.riserWt,
    castingMass: y.castingMass,
    riserWtTotal: y.riserWtTotal,
    gatingWtResidual: y.gatingWtResidual,
    designYield: (g?.ya != null ? g.ya : (g?.yv ?? y.designYield ?? null)),
  });
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">④ ${tr('出品率与铁水重量')} <span class="chip">${tr('整模口径 · 设计值')}</span></div>
    <div class="dc-hint-line">${tr('参考区间依据：')}${esc(y.basis || '—')}${line && line !== '不指定' ? ` · ${tr('造型线')}：${esc(tr(line))}` : ` · ${tr('造型线未指定')}`}</div>
    <div class="dc-stats">
      ${stat(tr('整模铸件毛坯重'), fmt(ledger.blankTotal, 2) + ' kg')}
      ${stat(tr('预计浇铸重量 G'), fmt(ledger.pourWt, 2) + ' kg')}
      ${stat(tr('设计出品率'), (ledger.designYield != null ? fmt(ledger.designYield, 1) : '—') + '%')}
    </div>
    <table class="dc-table">
      ${t(tr('参考区间'), `${y.range[0]}~${y.range[1]}%（${tr('依据')}：${y.basis}）`)}
      ${t(tr('整模冒口重（假设每腔一套）'), ledger.riserTotal != null ? fmt(ledger.riserTotal, 2) + ' kg' : '—')}
    </table>
    <div class="field-hint">${tr('当前为工艺预估值。获得实际出品率后，可手动输入并回算相关参数。')}
      <button type="button" class="dc-mini-btn" data-calc-link="yield">📊 ${tr('去“出品率与铁水重量”回算')}</button></div>
  </div>`;
}

function shrinkSection(sh) {
  return `<div class="dc-result-sec">
    <div class="dc-sec-title">📏 ${tr('线收缩率')} <span class="chip">${esc(tr(sh.modeLabel) || tr('常用值（生产·模具）'))}</span></div>
    <div class="dc-stats">
      ${stat(tr('综合比例'), sh.combined != null ? fmt(sh.combined, 2) + '%' : tr('分方向放缩水'))}
      ${stat(tr('方向差'), fmt(sh.spread, 2) + '%')}
      ${stat(tr('参考区间'), esc(sh.range || '—'))}
    </div>
    <table class="dc-table">
      <tr><th>${tr('方向')} (mm)</th><th>${tr('收缩率')}</th><th>${tr('放尺量')} (mm)</th><th>${tr('样板尺寸')} (mm)</th></tr>
      ${(sh.dirs || []).map(d => `<tr><td>${fmt(d.size, 0)}</td><td>${fmt(d.rate, 2)}%</td><td>${fmt(d.amount, 2)}</td><td>${fmt(d.pattern, 1)}</td></tr>`).join('')}
    </table>
    ${sh.directional ? `<div class="field-hint">${tr('⚠️ 各方向收缩率差 ≥0.2%，建议分方向放缩水（不推荐统一综合比例）')}</div>` : ''}
  </div>`;
}

function otherSections(results) {
  const c = results?.chill, s = results?.sandbox, m = results?.machining, ch = results?.charge, sk = results?.shakeout;
  const sections = [];
  if (c) {
    if (c.blocked) {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">❄️ ${tr('冷铁计算')}</div>
        <div class="dc-blocked p72-cn">⛔ ${esc(c.note || tr('自动冷铁推荐不可用'))}</div>
        <div class="field-hint">${tr('可在自动参数区手动填写「热节壁厚 T_hot」后重新执行；或到独立「冷铁计算」工具输入。')}</div>
      </div>`);
    } else {
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">❄️ ${tr('冷铁计算')}</div>
      <div class="dc-stats">
        ${stat(tr('冷铁厚度'), Array.isArray(c.thickness) ? c.thickness.map(v => fmt(v, 1)).join('~') + ' mm' : fmt(c.mid, 1) + ' mm')}
        ${stat(tr('推荐值'), fmt(c.mid, 1) + ' mm')}
        ${stat(tr('类型'), esc(tr(c.type)))}
      </div>
      ${(c.warnings || []).length ? `<table class="dc-table">${c.warnings.slice(0, 4).map(w => t(tr('注意'), esc(w.replace(/^[❌⚠️✅]+\s*/, '')))).join('')}</table>` : ''}
      <div class="field-hint">${tr('冷铁壁厚按热节壁厚（2×Mc）计算：')}${esc(c.deltaText || '')}</div>
      ${c.note ? `<div class="field-hint p72-cn">ℹ️ ${esc(c.note)}</div>` : ''}
    </div>`);
    }
  }
  if (s) {
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">📦 ${tr('3D砂型吃砂量')}</div>
      <div class="dc-stats">
        ${stat(tr('砂型最小壁厚'), fmt(s.minWall, 0) + ' mm')}
        ${stat(tr('轮廓'), fmt(s.dim, 0) + ' mm')}
        ${stat(tr('铸件重'), fmt(s.wt, 1) + ' kg')}
      </div>
      ${s.warning ? `<div class="field-hint p72-cn">${esc(s.warning)}</div>` : ''}
      <div class="field-hint">${tr('砂型方式：')}${esc(tr(s.mode))}（${tr('3D 打印砂型专用，勿套用传统造型')}）</div>
    </div>`);
  }
  if (m) {
    if (m.unsupported) {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">🛠️ ${tr('加工余量')}（GB/T 6414）</div>
        <div class="dc-blocked p72-cn">ℹ️ ${esc(m.note || tr('该工艺×材质无标准 RMA 等级'))}</div>
      </div>`);
    } else {
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">🛠️ ${tr('加工余量')}（GB/T 6414）</div>
      <div class="dc-stats">
        ${stat(tr('余量范围'), fmt(m.min, 1) + '~' + fmt(m.max, 1) + ' mm')}
        ${stat(tr('推荐值'), fmt(m.mid, 1) + ' mm')}
        ${stat(tr('等级'), (m.grades || []).join('~'))}
      </div>
      <div class="field-hint">${tr('按「{a}」推荐等级（等级自动，不选等级）', [esc(tr(m.methodLabel) || tr('砂型 · 机器造型/壳型'))])}</div>
    </div>`);
    }
  }
  if (ch) {
    if (ch.unsupported) {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">🏭 ${tr('熔炼加料')}（${esc(ch.defGrade)}）</div>
        <div class="field-hint p72-cn">${esc(ch.note || tr('暂不支持该牌号'))}</div>
      </div>`);
    } else {
      sections.push(`<div class="dc-result-sec">
        <div class="dc-sec-title">🏭 ${tr('熔炼加料')}（${esc(ch.defGrade)} · ${fmt(ch.pourWt, 1)} kg ${tr('铁液')}）</div>
        <div class="dc-stats">
          ${stat(tr('目标碳当量 CE'), ch.targetCE ? fmt(ch.targetCE, 2) + '%' : '—')}
          ${stat(tr('原铁液 CE'), ch.baseCE ? fmt(ch.baseCE, 2) + '%' : '—')}
          ${stat(tr('成分平衡'), ch.allOk ? tr('全部达标') : tr('有差额，见补料建议'), ch.allOk)}
        </div>
        <table class="dc-table">
          ${(ch.sugs || []).slice(0, 4).map(sg => t(tr('补料建议'), `${esc(sg.label)} +${sg.kg} kg`)).join('')}
        </table>
        <div class="field-hint">${tr('默认按 {g} 推荐配方；铁水总重 = 浇注重量（共享参数自动复用）', [esc(ch.defGrade)])}</div>
      </div>`);
    }
  }
  if (sk) {
    const [lo, hi] = sk.timeRange || [0, 0];
    sections.push(`<div class="dc-result-sec">
      <div class="dc-sec-title">⏱️ ${tr('开箱时间')}</div>
      <div class="dc-stats">
        ${stat(tr('型内冷却时间'), fmt(lo, 0) + (sk.unit === 'h' ? '~' + fmt(hi, 1) + ' h' : '~' + fmt(hi, 0) + ' min'))}
        ${stat(tr('开箱温度'), fmt(sk.shakeTemp, 0) + ' ℃')}
        ${stat(tr('依据'), esc(sk.shakeTempSource || '—'))}
      </div>
      ${(sk.warnings || []).length ? `<table class="dc-table">${sk.warnings.slice(0, 3).map(w => t(tr('风险'), esc(w.replace(/^[❌⚠️✅]+\s*/, '')))).join('')}</table>` : ''}
    </div>`);
  }
  return sections.join('');
}

/* ---- Page1 装配（板块 A/B，来自 processPage1 纯逻辑；ctx 提供内存态：V3 采样/主体壁厚） ---- */
function page1Pack(results, ctx = {}) {
  return {
    v: (p) => proj.getV(p), ps: (p) => proj.get(p),
    sampling: ctx.sampling || null,
    bodyRef: ctx.bodyRef ?? null,
    hasStl: !!ctx.hasStl,
    manual: !!ctx.manual,
    geomStatus: proj.getV('geometry.geomStatus') || 'VALID',
    results,   // PHASE 71.7：线收缩率 / 加工余量卡片数据（计算器既有输出）
  };
}
function page1Section(results, ctx = {}) {
  // 热结明细已在右侧面板「② 热结列表」中（可点击定位 3D）——本页不再重复（77.txt：做减法）
  return page1Html(buildPage1Data(page1Pack(results, ctx)));
}


/** 当前模块结果 HTML */
function moduleHtml(id, results, ctx = {}) {
  const r = results?.[id];
  if (id === 'page1') return page1Section(results, ctx);
  if (!r) return '<div class="field-hint">该模块未执行。</div>';
  if (id === 'gating') return gatingSection(r, results);
  if (id === 'riser') return riserSection(r, ctx);
  if (id === 'yield') return yieldSection(r, !!results.riser, results);   // 设计中心不再展示（77.txt 五）；保留供报告/其他入口
  if (id === 'shrinkage') return shrinkSection(r);
  return otherSections({ [id]: r });
}

/** 结果导航顺序（PHASE 71.7 · 77.txt 五：三页——工艺性（含线收缩率/加工余量卡片）→ 冒口 → 浇注；
 *  出品率与铁水重量页按 77.txt 从设计中心结果中剔除（计算仍执行，供报告/熔炼加料使用）；
 *  其余模块（若被外部注入结果）殿后） */
const PAGE_ORDER = [
  { key: 'page1', name: '① 铸件结构工艺性', icon: '📄' },
  { key: 'riser', name: '② 冒口设计', icon: '🏗️' },
  { key: 'gating', name: '③ 经典浇注系统', icon: '🌊' },
];
const EXTRA_ORDER = ['chill', 'sandbox', 'charge', 'shakeout'];

/**
 * 渲染结果中心：结果导航 + 当前页 + 操作区（75.txt §2：①→④ 一条主链，其余模块殿后）
 * @param {HTMLElement} container
 * @param {object} results  已完成模块结果
 * @param {object} [opts]    { active: 当前页 key, onNav: 导航切换回调,
 *                             ctx: { sampling, bodyRef, hasStl, manual } }（Page1 内存态）
 */
export function renderResultsCenter(container, results, opts = {}) {
  const baseCtx = opts.ctx || {};
  // Page2 需要 Mc 来源判定（热结值/用户输入/壁厚估算）——从共享参数补齐（PHASE 71.6 三/十二）
  const mcHot = proj.getV('process.mcHotspot') || 0;
  const mcPSrc = proj.get(proj.getV('hotspots.items')?.length ? 'process.mcHotspot' : 'process.wallHot');
  const ctx = {
    ...baseCtx,
    hsStatus: proj.getV('hotspots.status'),
    mcHot,
    mcUser: !!mcPSrc && (mcPSrc.src === 'USER_OVERRIDE' || mcPSrc.src === 'USER_INPUT') && mcPSrc.v > 0,
    hotspotN: (proj.getV('hotspots.items') || []).length,
  };
  const doneIds = PAGE_ORDER.filter(p => p.key === 'page1' || results?.[p.key]).map(p => p.key)
    .concat(EXTRA_ORDER.filter(id => results?.[id]));
  const active = doneIds.includes(opts.active) ? opts.active : doneIds[0] || 'page1';
  const hsItems = proj.getV('hotspots.items') || [];
  const mc = hsItems.length ? (proj.getV('process.mcHotspot') || 0) : (proj.getV('process.wallHot') || 0);   // PHASE 28.3-A：冒口模数来源

  /* 146 §8.3：**顶部的「本页结论速览」已删除** —— 它与下方详细卡是同一批字段（速览 + 主卡 + 表格
     三重展示）。现在顶部只留**类别导航**（三页签），核心结论下沉到**每个类别页内部**：
     标题 → 核心结论卡 → 关键数值与单位 → 「详细信息」折叠。
     Page1 数据仍只构建一次（类别页内部使用），口径不变。 */
  const p1data = active === 'page1' ? buildPage1Data(page1Pack(results, ctx)) : null;
  const activeHtml = active === 'page1' ? page1Html(p1data) : moduleHtml(active, results, ctx);
  /* S5-01/S5-02：顶部风险条**只保留 P0**（缺参/几何无效/分析失败等真正阻断项）。
     旧体积参考不足已从产品中移除；Mc 为 STL 估计值的说明降级为冒口结果底部的一行普通文字。
     其余 P1（RH 未指定、流速、排气比）在对应卡片就地显示，不重复堆在页首。
     数据源仍是同一个 `collectRisks`，不另写判定。 */
  const risks = collectRisks(results || {}, { limit: 5 })
    .filter(rk => rk.level === 'P0');

  const navLabel = (key) => {
    const p = PAGE_ORDER.find(x => x.key === key);
    if (p) return `${p.icon} ${tr(p.name)}`;
    const c = CALC_MANIFEST.find(x => x.id === key);
    return `${c?.icon || ''} ${tr(c?.name || key)}`;
  };

  container.innerHTML = `
    <!-- S8（160.txt §三.S8）：返回三维工作台从页首右侧移到结果页底部，
         与“生成报告 / 打开独立计算器”统一为操作区。 -->
    <div class="page-head dc-reshead">
      <h1 class="page-title">${tr('dc.results')}</h1>
    </div>

    ${/* 153.txt §十.C：结果页自己必须说明"这份结果是否与当前参数一致"，
          不能只靠工作台外壳的状态 chip（结果视图下它可能不在视线内）。 */ ''}
    ${opts.status ? `<div class="dc-res-status ${esc(opts.status.cls || '')}" id="dc_resStatus" data-res-status="${esc(opts.status.k || '')}">
      <span>${esc(opts.status.text || '')}</span>
      ${opts.status.action === 'rerun' ? `<button type="button" class="dc-mini-btn" id="dc_resRerun">🔄 ${tr('重新分析')}</button>` : ''}
    </div>` : ''}

    ${risks.length ? `<div class="dc-risk-strip" data-risk-strip>
      ${risks.map(rk => `<div class="dc-risk-item ${rk.level === 'P0' ? 'p0' : 'p1'}" data-risk-code="${esc(rk.code)}">
        <span class="dc-risk-level">${rk.level}</span>
        <span class="dc-risk-text">${esc(tr(rk.textKey, rk.params))}</span>
        ${rk.actionPath
          ? `<button type="button" class="dc-mini-btn" data-edit-param="${esc(rk.actionPath)}">${tr('去处理')}</button>`
          : rk.actionNav
            ? `<button type="button" class="dc-mini-btn" data-nav="${esc(rk.actionNav)}">${tr('去处理')}</button>`
            : ''}
      </div>`).join('')}
    </div>` : ''}

    ${doneIds.length > 1 ? `
    <div class="dc-result-nav" id="dc_resultNav">
      ${doneIds.map(id => `<button class="dc-result-nav-btn ${id === active ? 'on' : ''}" data-nav="${id}">${navLabel(id)}</button>`).join('')}
    </div>` : ''}

    <div id="dc_resultActive">${activeHtml}</div>

    <div style="display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap">
      <button class="btn btn-primary" id="dc_report">📄 ${tr('生成工艺计算报告')}</button>
      <button class="btn btn-ghost" id="dc_openCalcs">🧮 ${tr('打开独立计算器')}</button>
      <button class="btn btn-ghost" id="dc_again">⤡ ${tr('返回三维工作台')}</button>
    </div>
  `;

  /* 返回工作台 —— **必须在这里绑**，不能交给调用方。
     ⚠ 实测缺陷（146 发现，非本轮引入）：本函数用 `container.innerHTML = ...` 整块重建 DOM，
     而调用方 designCenter.renderResults 只在**自己那一轮**给 `#dc_again` 挂监听 ⇒
     只要用户点过任一类别页签（下面那组 [data-nav] 会再调一次本函数重建 DOM），
     `#dc_again` 就是一个**没有任何监听的新元素**——「返回三维工作台」点了毫无反应，
     只能靠触发一次重算（重算会走回 renderResults 重新绑定）才"偶尔"能用。
     绑定放在这里，与 [data-nav] / [data-calc-link] 同一层次，重建一次绑一次，不会漏。 */
  container.querySelector('#dc_again')?.addEventListener('click', () => opts.onBack?.());
  /* R6-S3（153.txt §十.A/B）：结果页只展示，不维护第二套编辑状态。
     "去修改"统一回到参数面板的对应字段（designCenter 的 onEditParam 会先切回模型视图再 openParamAt）。 */
  container.querySelectorAll('[data-edit-param]').forEach(btn => {
    btn.addEventListener('click', () => opts.onEditParam?.(btn.dataset.editParam));
  });
  container.querySelector('#dc_resRerun')?.addEventListener('click', () => opts.onRerun?.());
  // 结果导航切换（19.txt 八：模块导航 + 当前页）
  container.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      opts.onNav?.(btn.dataset.nav);
      renderResultsCenter(container, results, { ...opts, active: btn.dataset.nav });
    });
  });
  // 板块内独立工具链接（Page1 castability 等；随每次重渲染重新绑定）
  container.querySelectorAll('[data-calc-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      history.pushState({ view: 'calculators', id: btn.dataset.calcLink }, '', '#/calculators/' + btn.dataset.calcLink);
      window.dispatchEvent(new Event('hashchange'));
    });
  });
  /* 冒口颈/补缩距离/梯形参考卡：每次结果页重建后重新绑定（只在本地更新） */
  bindRiserReference(container);

  /* ---- PHASE 78（78.txt 二/三/五/七/八）：结果页内联参数与子页签 ---- */
  // 参数改动 → 写项目（USER_INPUT）→ 交回设计中心重跑计算链（gating/riser/yield/charge 保持一致）
  const applyParam = (path, val) => {
    if (!(typeof val === 'string' ? val.length : Number.isFinite(val))) return;
    proj.set(path, val);
    opts.onParamChange?.();
  };
  const numOf = (sel) => { const el = container.querySelector(sel); return el ? parseFloat(el.value) : NaN; };
  /* 冒口形状在结果页**不再提供第二个下拉**（153 §六.3）：唯一编辑入口在参数面板，
     结果页只读展示 + 「去冒口设计修改」。因此这里没有 #dc_riserShape 的监听。 */
  // ③ 内浇道厚度 / 个数（改后 L_g 自动重算）
  container.querySelector('#dc_gtEdit')?.addEventListener('input', () => { const v = numOf('#dc_gtEdit'); if (v > 0) applyParam('process.gateThk', v); });
  container.querySelector('#dc_gcEdit')?.addEventListener('input', () => { const v = numOf('#dc_gcEdit'); if (v >= 1) applyParam('production.ingateN', Math.round(v)); });
  container.querySelector('#dc_gtReset')?.addEventListener('click', () => {
    proj.set('process.gateThk', 0); proj.set('production.ingateN', 0);
    opts.onParamChange?.();
  });
  // ③ 排气孔**直径**（79.txt 四：孔数由系统按总排气面积自动生成，不手填）
  container.querySelector('#dc_ventD')?.addEventListener('input', () => { const v = numOf('#dc_ventD'); if (v >= 0.5) applyParam('process.ventD', v); });
  // ③ 横浇道厚度 / 条数（PHASE 80：与内浇道同级，改后 L_r 自动重算）
  container.querySelector('#dc_rtEdit')?.addEventListener('input', () => { const v = numOf('#dc_rtEdit'); if (v > 0) applyParam('process.runnerThk', v); });
  container.querySelector('#dc_rcEdit')?.addEventListener('input', () => { const v = numOf('#dc_rcEdit'); if (v >= 1) applyParam('production.runnerN', Math.round(v)); });
  container.querySelector('#dc_rtReset')?.addEventListener('click', () => {
    proj.set('process.runnerThk', 0); proj.set('production.runnerN', 0);
    opts.onParamChange?.();
  });
  // 164 §五：横浇道截面与梯形数量。手动选择写入项目后不会被自动匹配覆盖；
  // 恢复自动匹配 = 清空 process.runnerSection（'' 表示按真实浇注系统类型）。
  container.querySelector('#dc_runnerSection')?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (RUNNER_SECTIONS[v]) applyParam('process.runnerSection', v);
  });
  container.querySelector('#dc_runnerAuto')?.addEventListener('click', () => {
    proj.set('process.runnerSection', '');
    opts.onParamChange?.();
  });
  container.querySelector('#dc_trapN')?.addEventListener('input', () => {
    const v = numOf('#dc_trapN');
    // 164 §5.3：数量必须是有效正整数；不静默四舍五入分数输入。
    if (Number.isInteger(v) && v >= 1) applyParam('production.trapezoidN', v);
  });
  // ② 多热结子页签（点击切换该热结的冒口信息）
  container.querySelectorAll('[data-hs-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.hsTab;
      container.querySelectorAll('[data-hs-tab]').forEach(b => b.classList.toggle('on', b === btn));
      container.querySelectorAll('[data-hs-pane]').forEach(p => { p.hidden = p.dataset.hsPane !== i; });
    });
  });
  // 报告（19.txt 十二：只含选择模块 + 参数来源保留）
  container.querySelector('#dc_report')?.addEventListener('click', () => {
    /* R6-S3.1（154.txt §八）：报告必须带结果有效性状态；状态由结果页同一来源传入。 */
    const html = buildWorkflowReport(results, { status: opts.status });
    saveFile(`工艺计算报告_${Date.now()}.html`, html);
  });
}
