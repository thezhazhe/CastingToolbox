// ============================================================
// 铸造工艺设计中心（命令3 第2/3/14/24节；PHASE 71.6 76.txt：删除分析任务选择）
// 核心入口：导入 STL → 自动几何/热结分析 → 统一参数与执行条件（自动值可改，保留原值）
// → 执行 → 三页工艺设计结果（① 结构工艺性 ② 冒口 ③ 浇注 + 收缩率/加工余量/出品率）
// 原则：能从 STL 得到的自动得到；自动参数允许修改（标记来源 + ↺ 恢复）；
//       计算器作为底层能力被调用（calcs/ 纯函数 + adapters 参数投影）——核心公式零改动
// ============================================================
import { parseSTL, computeBounds } from '../engine/stl.js';
import { validateMesh, deriveGeomStatus } from '../engine/meshValidation.js';
import { buildMesh, isInside } from '../engine/mesh3d.js';
import { analyzeGeometry, analyzeGeometrySliced } from '../engine/geometryAnalysis.js';
import { analyzeHotspots, analyzeHotspotsSliced, HS_STATUS, HS_REASON } from '../engine/hotspot.js';
import { analyzeHotspotsV3, analyzeHotspotsV3Sliced } from '../engine/v3/hotspotV3.js';
import { toViewResult, bodyWallOf, bodyRefOf } from '../engine/v3/v3ViewAdapter.js';
import { diagnoseSTL } from '../engine/stlDiagnostic.js';
import { displayCenterFor } from '../engine/hotspotDisplay.js';
import { ModelView3D } from './components/modelView3D.js';
import * as proj from '../model/CastingProject.js';
import { SRC, CONF } from '../model/CastingProject.js';
import { MATERIALS as GATING_MATS, RATIO_PRESETS, recommendGatingRatio } from '../../calcs/gating.js';
import { RISER_MATERIALS, RISER_SHAPES, RISER_EFF } from '../../calcs/riser.js';
/* 164.txt 四/五：发热/保温冒口与梯形横浇道的**主结果转换**集中在这两个共享模块。
   calcManifest/riser.js/gating.js 仍按既有口径计算；视图层只把选中的设计类型
   转换为当前主结果，避免把普通圆柱/矩形结果冒充新类型。 */
import { applyInsulatedRiserResult } from './riserReference.js';
import { applyRunnerSection, effectiveRunnerSection, normalizeRunnerCount } from './gatingReference.js';
// 146 §3.3：参数窗口的来源徽章与结果页/工艺性页共用同一张表（SRC_TAG），不另写一套口径
import { srcTagHtml } from './processPage1.js';
/* 149 §三：热结状态 → Mc 来源文案的**单一来源**（纯函数模块，见 V2.0-15 riserStatus.js 同范式） */
import { hsSourceInfo, HS_SRC_KIND } from './hsSourceNote.js';
// PHASE 79（79.txt 一）：参数联动提示用既有数据表（出品率区间 / 加工余量等级）——无新增数据、无公式改动
import { resolveYield } from '../../calcs/yield.js';
import { methodGradeRec } from '../../calcs/machining.js';
import { CALC_MANIFEST, RUN_ORDER } from '../../calcs/calcManifest.js';
import { renderResultsCenter } from './resultsCenter.js';
import { gatingValidity } from './resultFacts.js';
import { gatingDiagramSvg } from './gatingDiagram.js';
/* 149 §二.2：参数帮助内容一律**从独立计算器复用，不在这里另抄一份正文**。
   `gatingView` 顶层只有 import 与常量、无 DOM 副作用，与既有的 `./processPage1.js`
   （srcTagHtml）是同一种 view→view 复用方式；导入增量只有几个与计算无关的小模块。 */
import { RATIO_APPLIC, ratioHelpRows, RATIO_HELP_INTRO, RATIO_HELP_AUTO, RATIO_HELP_TIP } from './gatingView.js';
import * as context from '../context.js';
// PHASE 72（80.txt §九~§十三）：设计中心 UI 中英双语（本阶段重点）
//   纪律：只译显示文案；参数键、来源 enum、公式、单位、数据取值一律不动。
import { t as tr } from '../i18n/index.js';
import { markRelocalizable } from '../i18n/viewState.js';

/* ---- PHASE 71.6（76.txt 一/二）：设计中心 = 明确工艺设计流程，不再让用户选择分析任务。
   固定任务集（用户导入 STL 后直接进入，UI 无勾选）：
     ① 铸件结构工艺性（Page1，板块 A/B，不走 manifest）
     ② 线收缩率 ③ 加工余量 ④ 浇注系统设计 ⑤ 冒口设计 ⑥ 出品率
   其余独立计算器（chill/sandbox/charge/shakeout/CT/principles/defect_finder/Campbell…）
   仍可从「计算器」入口使用，但不进入本流程——文件不删、能力不破坏。 ---- */
const FIXED_CALC_TASKS = ['shrinkage', 'machining', 'riser', 'gating', 'yield'];
/* 计算执行顺序（依赖：shrinkage/machining 独立 → riser → gating（读唯一的用户 RH）→ yield → charge）
   PHASE 28.4：迁移至 calcs/calcManifest.js 导出（可测试），riser 前置 gating（Hp 方案 A 回写闭环） */

/* 参数 → 使用它的模块（19.txt 十：参数变化 → 受影响模块 ⚠ 需重新计算） */
const PARAM_OWNERS = new Map();
for (const c of CALC_MANIFEST) {
  for (const p of [...(c.requiredInputs || []), ...(c.optionalInputs || [])]) {
    if (!p.param) continue;
    PARAM_OWNERS.set(p.param, [...(PARAM_OWNERS.get(p.param) || []), c.id]);
  }
}
/* 参数来源徽章（19.txt 五：🟢STL 自动 / 🔵计算得到 / 🟡用户输入 / 🟠用户修改）
   PHASE 72（80.txt §十一）：**来源 enum 不改**，只在显示层翻译标签 */
/* 单位换算系数（相对 mm）：内部统一 mm，导入时确认（命令2 第8节） */
const UNIT_SCALE = { mm: 1, cm: 10, m: 1000, inch: 25.4 };

/* 调试模式（命令文件 Debug & Stabilization Phase 第三/六阶段）：
   URL 带 ?hsDebug=1 时：
   ① 热结分析后 console 输出 status/reason/debug 计数/每个热点 ID·XYZ·Mc·Score
   ② 真实算法未检出热结时，注入 Fake TEST-1(0,0,0)/TEST-2(20,30,40)
      验证 3D 显示链路与 3D↔UI 联动——判断"不显示"问题在哪一层。
   不改真实热结算法；Fake 只作用于 UI 显示层。 */
const DEBUG_HS = new URLSearchParams(location.search).has('hsDebug');
/* 热结引擎选择（17.txt 十三：生产 UI 默认 V3；?hsV2=1 开发对照时回退 V2） */
const USE_V2 = new URLSearchParams(location.search).has('hsV2');
/* STL 会话指纹（18.txt 四：sessionStorage 标记"本会话导入过 STL"；刷新后 mesh 丢失 →
   指纹仅用于判断会话状态，不跨会话保留） */
const STL_FP_KEY = 'ct-stl-fp';
const stlFingerprint = (file) => `${file.name}|${file.size}`;
/* Fake 测试热结（居中坐标系，直接进入 Viewer）——命令文件第三阶段固定数据 */
const FAKE_HOTSPOTS = [
  { id: 1, x: 0, y: 0, z: 0, mc: 10, regionVolumeCm3: 4.19, peaks: [{ x: 0, y: 0, z: 0, score: 10 }] },
  { id: 2, x: 20, y: 30, z: 40, mc: 10, regionVolumeCm3: 4.19, peaks: [{ x: 20, y: 30, z: 40, score: 10 }] },
];

/* ---- 模块状态（进入视图保持，清空按钮重置） ---- */
let state = {
  mesh: null,        // stl.js 解析结果
  geometry: null,    // three 几何（BVH）
  analysis: null,    // analyzeGeometry 结果
  view3d: null,      // ModelView3D 实例
  _view3dBox: null,  // view3d 当前挂载的承载元素（D1：切视图会换掉它，必须比对才能发现）
  unit: 'mm',
  tasks: new Set(FIXED_CALC_TASKS),   // PHASE 71.6：固定任务集（无 UI 选择）
  results: null,     // {gating, riser, yield, ...}
  stale: new Set(),  // 已完成但参数已变化、需重新计算的模块（19.txt 十）
  busy: false,
  hsFake: false,     // 调试模式：当前显示的是 Fake 热结（badge 区分，不误导）
  bodyRef: null,     // 可信主体壁厚（PHASE 26：V3 采样完成后 = bodyRefOf 完整链；之前 = bodyWallOf）
  activePage: null,  // PHASE 78：结果中心当前页（内联改参数触发重算时保持在原页）
  lastRun: null,     // V2.0-P1-01 D8：最近一次分析的结局 {ok, reason}（失败时旧结果不得冒充当前结果）
  /* ---- 144.txt §二/§五：固定视口工作台 ---- */
  wsView: 'model',   // 工作台当前视图：'model'（三维 + 按需面板）| 'results'（结果工作区）
  resultsViewed: false, // 145 §三：用户是否真的打开过结果视图（步骤③的完成判据，不猜）
  /* ---- R6 §3.1/§3.3：右侧**按需**任务面板（替代原常驻左栏）----
     `taskStep` = 面板当前显示的步骤键（'model' | S2 起再加 'cond'/'param'），
     `null` 兼作"面板关闭"。**只有这一个状态**，与 data-task 属性一一对应，不另设开关变量。 */
  taskStep: null,
  /* ---- 146.txt §三：参数编辑的**未保存草稿**（R6-S2 起从浮层窗口迁到右侧任务面板）----
     语义一字未改：局部状态，不写项目、不进全局状态机——避免出现第二套状态系统。
     null = 没有未保存修改；对象 = {path: value} 只存被改动过的键。
     生命周期 = 面板处于 ②/③ 编辑步骤的整段会话（步骤间切换**不丢**草稿，否则就是
     §3.4 禁止的"静默丢失用户输入"；关闭面板/取消/保存才终结）。 */
  paramDraft: null,
  paramTab: 'riser',  // R6-S3：③ 工艺设计内的子模块（'riser' 冒口设计 | 'gating' 浇注系统设计）
  /* 149 §五：**待生效的"恢复自动原值"意图**。与 paramDraft 同属草稿机制、同生命周期
     （开窗重置 / 关窗丢弃 / 取消一并作废），**不是第二套状态系统**。
     为什么不直接往 paramDraft 塞一个值：恢复要还原的是**来源**（v+src+conf+orig 四件一起），
     §五.5 明令「不得把"恢复为原来的数字"错误当成"恢复自动来源"」——
     若只把 orig.v 写进草稿，保存时仍走 `proj.set(path, v)`，src 会再次落成 USER_OVERRIDE，
     数字对了、语义错了。所以单独记一串路径，保存时改调 `proj.restoreAutoValue()`。 */
  draftRestore: null,
  /* R6-S3.1/S4：结果页内联参数触发 autoRecompute(keepScroll) 时，RH 复核提示不能被
     “共享参数已变化”的完成 toast 覆盖 ⇒ 先挂起，由 autoRecompute 的结束提示消费。
     （参数面板的「保存」不再触发分析，因此不会产生这条挂起提示。） */
  pendingRhReview: null,
};
/* ⚠ 145.txt §三 删的是**「不导入 STL、全部手填」的独立手动模式**；
   146.txt §0/§3.5 更正了那一轮的产品理解偏差：**STL 模式下的参数查看/输入/修改/确认/保存/
   重新分析能力必须完整保留**（本轮恢复）。删掉的仍然只有：无 STL 的手动模式、
   「✎ 改 Mc」小弹窗、草稿的**全局**状态（现在草稿只活在窗口内部）。
   `zoom3d`（D7 放大三维工作区）按 §七 一并删除。 */

/* ============================================================
   145.txt §三：工艺设计中心的**固定三步流程 + 五状态**
     A 尚未导入模型   B 已导入未分析   C 正在分析   D 分析完成   E 分析失败 / 条件不足
   状态只由**真实状态**判定，不猜测、不伪造：
     · C 由 state.busy（真实的计算中标志）
     · E 由 state.lastRun.ok === false（runAnalysis 的三道门禁真实记账）
     · A/B/D 由 mesh / results 是否存在
   ============================================================ */
function workflowState() {
  if (state.busy) return 'C';
  if (state.lastRun && state.lastRun.ok === false) return 'E';
  if (!state.mesh) return 'A';
  if (!state.results) return 'B';
  return 'D';
}
/** 材料大类是否已定 —— STL 无法识别材料，这是唯一"没有可靠默认值"的必需输入 */
const familySet = () => !!(proj.getV('material.family') || '');

/* ============================================================
   146.txt §3.3/§3.4：参数有效性 —— **只由真实数据判定**，不看 UI 标记（§4.1 末段）
   检查项逐条来自该字段在下游计算链里是否真的被消费（见 §3.2 清单核实结论）：
     · material.family     —— 无 STL 来源、无可靠默认值 ⇒ 缺它密度/重量/浇注/冒口全算不了（硬门禁）
     · geometry.blankWeightKg —— gating（G=pw×cav/出品率）/ yield / charge / shakeout 的输入；
       由 STL 体积 × 材料固态密度自动得出，非 0 即有效（STL 坏掉/密度缺失时会是 0）
   其余字段（Ho/ph/型腔数/出品率/造型线/铸造方法/浇注系统比例/内浇道/横浇道/排气）在计算链里
   **都有既有的、可追溯的默认值**（calcManifest 的 `|| 150` / `|| 100` / `rec.gt` 等），
   缺它们不阻塞分析 —— 因此**不列为必需项**，只在窗口里标注"当前值 = 系统默认"。
   ============================================================ */
/** 取"当前生效值"：**草稿优先**（窗口打开时，用户屏幕上看到的就是这个值） */
function effValue(path) {
  if (state.paramDraft && Object.prototype.hasOwnProperty.call(state.paramDraft, path)) return state.paramDraft[path];
  if (path === 'geometry.unit') return state.unit;
  return proj.getV(path);
}
/**
 * 必需项检查。
 * @param {boolean} [useDraft] true = 把窗口里**尚未保存**的草稿也算进来。
 *   ⚠ 这两个口径必须分开，否则会踩两个方向相反的坑：
 *     · 状态 chip / 主按钮（useDraft=false）必须看**已保存**的项目——草稿没落盘就不算"参数有效"，
 *       否则就是 §3.4 明令禁止的"UI 显示已确认、实际计算仍用旧值"；
 *     · 参数窗口里的保存按钮（useDraft=true）必须看**草稿**——否则用户刚把必填项填上，
 *       按钮仍按旧项目判定为禁用，**根本存不下去**（本轮实测到的真缺陷）。
 */
function paramIssues(useDraft = false) {
  const val = (p) => (useDraft ? effValue(p) : proj.getV(p));
  const out = [];
  const fam = val('material.family');
  if (!fam) out.push({ path: 'material.family', msg: tr('材料大类未指定（STL 无法识别材料）') });
  const wt = val('geometry.blankWeightKg');
  if (fam && !(wt > 0)) out.push({ path: 'geometry.blankWeightKg', msg: tr('毛坯重量无效（体积 × 固态密度未得到正值）') });
  return out;
}
const paramsReady = () => paramIssues(false).length === 0;

/* ================= V2.0-P1-01 D8 / 145 §三：结果状态机 =================
   143.txt §一 D8 纪律：不得靠"隐藏提示 / 清空结果 / 放宽断言"掩盖问题。因此这里的做法是——
   旧结果**继续显示**，但状态 chip 与结果区横幅必须**显式说明它不是当前参数算出来的**，
   并给出失败原因与重算入口。优先级：计算中 > 失败 > 已过期 > 就绪 > 未分析。
   （145 §三 起不再有"未保存草稿"态——参数输入窗口已移除，改动即落盘即重算。） */
function computeState() {
  if (state.busy) return { k: 'busy', cls: 'busy', text: tr('⏳ 正在计算…') };
  if (state.lastRun && state.lastRun.ok === false) {
    return { k: 'failed', cls: 'bad', text: tr('❌ 分析未完成：{r}', [state.lastRun.reason]) };
  }
  if (state.stale.size > 0 && state.results) {
    return { k: 'stale', cls: 'warn', text: tr('⚠️ 参数已修改，当前结果已过期（待重新分析）') };
  }
  if (state.results) return { k: 'ok', cls: 'ok', text: tr('✓ 结果与当前参数一致') };
  if (!state.mesh) return { k: 'idle', cls: '', text: tr('尚未导入模型') };
  /* 146 §4.2：主工作台的**紧凑参数状态** —— 四种，全部由真实数据判定（paramIssues 逐条有依据）。
     缺项时把"缺什么"直接写在状态里，用户不必打开窗口才知道。 */
  const issues = paramIssues();
  if (issues.length) {
    return { k: 'needparam', cls: 'warn', text: tr('⚠️ 缺少必要条件：{r}', [issues.map(i => i.msg).join('；')]) };
  }
  return { k: 'ready', cls: '', text: tr('✓ 工艺设计参数有效，可开始工艺分析') };
}

/** 结果页内部状态条的内容（单一来源：computeState + "下面是上一次结果"的说明）。
 *  `renderResultsCenter` 初次渲染与 `refreshResultStatus` 就地刷新共用，避免两处口径漂移。 */
function resultStatusInfo() {
  const cs = computeState();
  const text = cs.k === 'stale'
    ? tr('⚠️ 参数已修改，以下结果待重新分析（仍是上一次成功结果）')
    : cs.k === 'failed'
      ? tr('❌ 上次分析未完成：{r}。以下为上一次结果，已标记为过期', [state.lastRun?.reason || tr('未知原因')])
      : cs.k === 'busy' ? cs.text
        : cs.k === 'ok' ? tr('✓ 当前结果有效：以下结果由当前参数计算')
          : cs.text;
  return { k: cs.k, cls: cs.cls, text, action: (cs.k === 'stale' || cs.k === 'failed') ? 'rerun' : null };
}

/** 就地刷新结果页状态条（参数一变就调用，不等 600ms 防抖/重渲染）。
 *  只改状态条自身，不重画结果页 —— 否则用户正在输入的内联控件会丢焦点。 */
function refreshResultStatus(container) {
  const strip = container.querySelector('#dc_results [data-res-status]');
  if (!strip) return;
  const st = resultStatusInfo();
  strip.className = 'dc-res-status ' + (st.cls || '');
  strip.dataset.resStatus = st.k;
  const span = strip.querySelector('span');
  if (span) span.textContent = st.text;
  let btn = strip.querySelector('#dc_resRerun');
  if (st.action === 'rerun' && !btn) {
    btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dc-mini-btn'; btn.id = 'dc_resRerun';
    btn.textContent = '🔄 ' + tr('重新分析');
    btn.addEventListener('click', () => runAnalysis(container, { keepScroll: true }));
    strip.appendChild(btn);
  } else if (st.action !== 'rerun' && btn) {
    btn.remove();
  }
}

/** 刷新状态 chip + 底部状态栏 + 结果区过期/失败横幅（并挂上"重新分析"入口）
 *  144 §三.D：状态栏与状态 chip 是"工作台外壳状态"的**唯一显示位**，
 *  因此这里统一刷新——凡状态变化处调它一处即可，不会出现两处口径不一致。 */
function renderStateChip(container) {
  const s = computeState();
  const chip = container?.querySelector('#dc_stateChip');
  if (chip) { chip.textContent = s.text; chip.className = 'chip dc-state-chip ' + s.cls; }
  renderStatusBar(container);
  refreshResultStatus(container);
  const bar = container?.querySelector('#dc_staleBar');
  if (!bar) return;
  const show = (s.k === 'stale' || s.k === 'failed') && !!state.results;
  bar.hidden = !show;
  if (!show) { bar.innerHTML = ''; return; }
  bar.className = 'dc-stale-bar' + (s.k === 'failed' ? ' bad' : '');
  bar.innerHTML = `<span>${esc(s.text)}</span><button type="button" class="btn btn-ghost" id="dc_staleRerun">🔄 ${tr('重新分析')}</button>`;
  bar.querySelector('#dc_staleRerun')?.addEventListener('click', () => runAnalysis(container));
}

/* 146.txt §七：「放大三维工作区」按钮已**按用户要求删除**。
   核实过它确实只是一个独立的视口放大/恢复入口（`state.zoom3d` + `.dc-ws.zoom3d` +
   `body.dc-zoomed`，除自身外无消费者），因此连同 `setZoom3d` / `applyZoom3d` /
   `bindZoomEsc` / `state.zoom3d` / 对应 CSS 一并移除。
   ⚠ **没有**动 ResizeObserver、渲染生命周期、`dispose()` 资源释放、
   `ModelView3D.resize()` —— 那些是画布尺寸适配的必要逻辑，与放大功能无关。 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');
const showToast = (msg) => {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.remove(), 2200);
};

/* ================= PHASE 22：分析进度条（30.txt 十三——分阶段真实进度，不伪造百分比） =================
   阶段区间（真实进度进入区间内按实际比例填充；无法报告真实进度的阶段显示
   indeterminate shimmer + 阶段文案，绝不假装数字增长）：
     导入模型 0–10%   检查 STL 10–20%   建立距离场 30–55%   内部采样 55–70%
     热结分析 70–90%  生成结果 90–100%
   距离场扫描/距离与 V3 扫描/距离/场 均报告真实分片进度（见 engine 层 onProgress）。 */
const PROGRESS_STAGES = {
  import:  { start: 0,   end: 10,  text: '导入模型' },
  validate: { start: 10,  end: 20,  text: '检查 STL' },
  dfScan:  { start: 30,  end: 55,  text: '建立距离场' },
  dfDist:  { start: 55,  end: 70,  text: '内部采样' },
  hsScan:  { start: 70,  end: 79,  text: '热结分析 · 建立几何采样' },
  hsDist:  { start: 79,  end: 84,  text: '热结分析 · 测量壁厚' },
  hsField: { start: 84,  end: 87,  text: '热结分析 · 计算模数场' },
  hsRefine:{ start: 87,  end: 90,  text: '热结分析 · 局部细化' },
  result:  { start: 90,  end: 100, text: '生成结果' },
};
function progressEl(container) {
  const p = container.querySelector('#dc_progress');
  if (!p || p.hidden) return null;
  return p;
}
function progressTo(container, stage, frac) {
  const p = progressEl(container);
  if (!p) return;
  const s = PROGRESS_STAGES[stage];
  const fill = container.querySelector('#dc_progressFill');
  const text = container.querySelector('#dc_progressText');
  const pct = Math.round(s.start + Math.max(0, Math.min(1, frac)) * (s.end - s.start));
  if (fill) fill.style.width = pct + '%';
  if (text) text.textContent = `${tr(s.text)}（${pct}%）`;
}
function progressIndeterminate(container, stage) {
  const p = progressEl(container);
  if (!p) return;
  const s = PROGRESS_STAGES[stage];
  const fill = container.querySelector('#dc_progressFill');
  const text = container.querySelector('#dc_progressText');
  if (fill) fill.classList.add('indeterminate');
  if (text) text.textContent = tr(s.text) + '…';
}
function progressStart(container, stage) {
  const p = container.querySelector('#dc_progress');
  if (!p) return;
  p.hidden = false;
  const fill = container.querySelector('#dc_progressFill');
  const text = container.querySelector('#dc_progressText');
  if (fill) { fill.classList.remove('indeterminate'); fill.style.width = '0%'; }
  if (text) text.textContent = tr(PROGRESS_STAGES[stage].text) + '…';
  progressTo(container, stage, 0);
}
function progressEnd(container) {
  const p = container.querySelector('#dc_progress');
  if (!p) return;
  p.hidden = true;
  const fill = container.querySelector('#dc_progressFill');
  if (fill) fill.classList.remove('indeterminate');
}

/** 单调进度包装（多级采样级间回退 → 只前进不后退，避免"进度倒退"错觉） */
function monotonic(container, stage) {
  let seen = -1;
  return (frac) => {
    if (frac < seen) return;
    seen = frac;
    progressTo(container, stage, frac);
  };
}

/* ============================================================
   PHASE 86（86.txt）· 显示点微调 —— **纯显示层，引擎零改动**
   问题：代表点 = 区域质心，在部分结构上会顺边界漂出热点区（实测 20 模型 47 个热点里
        10 个飘出自己声明的厚区，1 个飘进别的热点厚区）。
   方案（经过 S0/S1/S2/S3 四族策略在 20 模型上的对照实验选出，见 docs/PHASE86_REPORT.md）：
        **把显示点朝峰点拉近，最多拉 1×Mpeak（模数值，单位 mm）；出材料则回落原代表点。**
   为什么是这个：
     · 不用峰点本身 —— 直接的峰点有 2 例会落到材料外，且 t01/t02/t09/t11 上代表点本来就更居中；
     · 不用固定比例插值（S2）—— 各档都有 3 例落到材料外；
     · k=1 是本轮**唯一**同时满足"0 出材料 / 0 飘进别的热点厚区 / 0 需护栏介入"的策略，
       并把"飘出自己厚区"从 10 降到 5。
   计算坐标 h.x/y/z 永不修改（30.txt 六）——CastingProject / 工艺计算报告仍用引擎原值。
   ============================================================ */
const DISPLAY_PULL_K = 1.0;   // 显示点朝峰点最大拉近量 = K × Mpeak

/** 引擎峰点坐标：v3ViewAdapter 只把它写进 geometrySource 字符串（无独立字段）。
 *  本阶段禁止改 js/engine/，故在此解析。取不到（Fake 热结/旧数据）→ 返回 null，显示行为不变。 */
function peakPosOf(h) {
  const m = /@\(([-\d.,\s]+)\)/.exec(String(h.geometrySource || ''));
  if (!m) return null;
  const p = m[1].split(',').map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? p : null;
}

/** 显示基准点 = 代表点朝峰点拉近（≤ DISPLAY_PULL_K × Mpeak），出材料则回落代表点 */
function displayBaseOf(h) {
  const rep = [h.x, h.y, h.z];
  const peak = peakPosOf(h);
  if (!peak) return rep;
  const d = Math.hypot(peak[0] - rep[0], peak[1] - rep[1], peak[2] - rep[2]);
  const maxPull = DISPLAY_PULL_K * (h.mc > 0 ? h.mc : 0);
  if (!(d > 1e-6) || !(maxPull > 0)) return rep;
  const cand = d <= maxPull ? peak
    : [rep[0] + (peak[0] - rep[0]) * (maxPull / d),
       rep[1] + (peak[1] - rep[1]) * (maxPull / d),
       rep[2] + (peak[2] - rep[2]) * (maxPull / d)];
  // 护栏：插值可能穿到型腔/模型外 —— 出材料就回落原代表点（实验里 k=1 从未触发，留作防线）
  return state.geometry && !isInside(state.geometry, cand, 6) ? rep : cand;
}

/**
 * 热结 → 3D 视图对象（PHASE 22；PHASE 86 加显示点微调）：ENGINE 坐标 → 居中坐标；
 * 显示位置 = **微调后的点** + 有界中面修正（displayCenterFor，只读计算坐标）；regionBBox 同步平移。
 * 计算坐标 h.x/y/z 永不修改（30.txt 六：计算位置是真实数据）。
 */
function toViewHotspot(h) {
  const c = state.analysis?.center || [0, 0, 0];
  const b = displayBaseOf(h);
  const dp = displayCenterFor(state.geometry, { ...h, x: b[0], y: b[1], z: b[2] }, {});
  return {
    ...h,
    x: h.x - c[0], y: h.y - c[1], z: h.z - c[2],
    displayPosition: [dp.displayPosition[0] - c[0], dp.displayPosition[1] - c[1], dp.displayPosition[2] - c[2]],
    displayCenterReliable: dp.displayCenterReliable,
    regionBBox: h.regionBBox ? {
      min: [h.regionBBox.min[0] - c[0], h.regionBBox.min[1] - c[1], h.regionBBox.min[2] - c[2]],
      max: [h.regionBBox.max[0] - c[0], h.regionBBox.max[1] - c[1], h.regionBBox.max[2] - c[2]],
    } : undefined,
  };
}

export function render(container) {
  // PHASE 72：设计中心支持原地换语言（全部状态存于 state + CastingProject，重渲染无损）
  markRelocalizable();
  /* ============================================================
     146.txt §0/§三：工艺设计中心 = **只保留「导入 STL」模式**，但该模式下的
     **参数查看 / 输入 / 修改 / 确认 / 保存 / 重新分析能力必须完整**
       1 导入 STL → 2 查看/确认分析条件与必要工艺参数 → 3 分析并查看结果（S5-03 合并入口）
     · 顶部只留**一个主操作按钮**（#dc_run），文案与动作随真实状态变化（§4.1）；
     · 参数窗口（#dc_paramDlg）分三模块：A 分析条件 / B 冒口设计 / C 浇注系统；
     · 左栏只留两个区域：① 分析结果概览 ② 热结列表（§4.3）；
     · 无 STL 的独立手动模式已删除（§3.5），独立计算器一律不受影响。
     参数来源一字未改：能从 STL 得到的仍从 STL 得到，有可靠默认值的仍用原默认值，
     "没有可靠默认值"的必需项（材料大类 / 毛坯重量）显式要求，缺失时**说明原因并阻断分析**。
     ============================================================ */
  container.innerHTML = `
    <div class="dc-ws" id="dc_ws" data-wsview="model" data-flow="A" data-task="closed">
      <!-- ===== A. 顶部紧凑主工具栏 ===== -->
      <header class="dc-topbar" id="dc_topbar">
        <h1 class="page-title dc-tb-title" title="${esc(tr('dc.sub'))}">${tr('dc.title')}</h1>
        <div class="dc-tbgrp" id="dc_tbModel">
          <span class="chip" id="dc_stlStatus" hidden></span>
          <button type="button" class="btn btn-ghost dc-tb" id="dc_replaceStl" hidden>📥 ${tr('导入 STL')}</button>
          <button type="button" class="btn btn-ghost dc-tb" id="dc_deleteStl" hidden>🗑️ ${tr('删除 STL')}</button>
        </div>
        <span class="dc-topbar-spacer"></span>
        <button type="button" class="btn btn-ghost dc-tb" id="dc_taskToggle" hidden>🧩 ${tr('模型信息')}</button>
        <button type="button" class="btn btn-ghost dc-tb" id="dc_paramsBtn" hidden>⚙️ ${tr('分析条件与工艺参数')}</button>
        <button type="button" class="btn btn-primary dc-tbrun" id="dc_run">▶ ${tr('分析并查看结果')}</button>
      </header>

      <!-- ===== R6 §3.2：顶部流程导航 =====
           它不是装饰性步骤条 —— 每个节点的状态**全部由真实数据判定**（见 flowSteps()），
           点击进入的是**真实操作界面**（面板步骤 / 参数编辑 / 执行分析 / 结果视图）。 -->
      <nav class="dc-flowbar" id="dc_flowbar" aria-label="${esc(tr('工艺设计流程'))}"></nav>

      <!-- ===== 共享 chrome 行（R6-S4 / 155 §六）=====
           STL 校验提示与分析进度原来只长在三维列内 ⇒ 它们把三维顶边往下压，
           右侧任务面板仍从 .dc-body 顶边开始，两边顶部必然错位（实测约 23px，
           有网格问题时更多）。移到 .dc-body **之前**的整行后，左右两列从同一条
           基线开始；提示/进度本身照常可见，不靠隐藏反馈换对齐。
           元素 id 全部保留（#dc_validate / #dc_progress），既有代码与测试零改动。 -->
      <div class="dc-chrome" id="dc_chrome">
        <div id="dc_validate" class="dc-validate" hidden></div>
        <div id="dc_progress" class="dc-progress" hidden>
          <div class="dc-progress-bar"><div class="dc-progress-fill" id="dc_progressFill"></div></div>
          <div class="dc-progress-text" id="dc_progressText">${tr('正在分析模型…')}</div>
        </div>
      </div>

      <!-- ===== B/C/D 主体：模型工作区 与 结果工作区 二选一 ===== -->
      <div class="dc-body">
        <div class="dc-main">
          <!-- 中央三维工作区：尽可能大；空态直接把"导入 STL"作为主引导，不用信息卡填满页面 -->
          <div class="dc-stage">
            <div id="dc_importZone" class="dc-import-zone">
              <div class="dc-import-icon">📂</div>
              <div class="dc-import-title">${tr('导入 STL 模型开始工艺设计')}</div>
              <div>${tr('拖拽 STL 到此处，或')} <button type="button" class="btn btn-primary" id="dc_pick">${tr('选择 STL 文件')}</button></div>
              <div class="field-hint" style="margin-top:6px">${tr('支持 Binary / ASCII STL · 完全本地解析 · 数据不出本机')}</div>
              <input type="file" id="dc_file" accept=".stl" hidden>
            </div>
            <div id="dc_view3d" class="dc-view3d" hidden>
              <!-- ⚠⚠ 146.txt §五：**视口浮层控件必须是 #dc_view3dBox 的兄弟节点，绝不能放进它内部**。
                   #dc_view3dBox 就是传给 OrbitControls 的 domElement；
                   OrbitControls 在 pointerdown 时对它 setPointerCapture（vendor/controls/
                   OrbitControls.js:1000），此后该指针的 pointerup / click 一律被重定向到容器
                   ⇒ 落在容器**内部**的按钮，其 click 处理器**永远不会被调用**。
                   R3 为做"视口内浮层"把它们移进了容器内部，正是"前后左右视图按钮全部失效"的根因
                   （实测：pointerdown 命中 BUTTON，click 却落在 DIV.dc-view3d-box 上）。
                   v1.1.0 里这两块本来就在 box 外面，所以旧版没有这个病。 -->
              <div id="dc_view3dBox" class="dc-view3d-box"></div>
              <button class="dc-view-reset" id="dc_viewReset" title="${esc(tr('重置视角（自适应模型）'))}">⟳ ${tr('重置视角')}</button>
              <div class="dc-view-controls">
                <select id="dc_dispMode" class="dc-disp-mode" title="${esc(tr('显示模式'))}">
                  <option value="solid">${tr('实体')}</option>
                  <option value="wireframe">${tr('线框')}</option>
                  <option value="transparent">${tr('透明')}</option>
                </select>
                <div class="dc-view-btns">
                  <button data-view="front" title="${esc(tr('前视图'))}">${tr('前')}</button>
                  <button data-view="back" title="${esc(tr('后视图'))}">${tr('后')}</button>
                  <button data-view="left" title="${esc(tr('左视图'))}">${tr('左')}</button>
                  <button data-view="right" title="${esc(tr('右视图'))}">${tr('右')}</button>
                  <button data-view="top" title="${esc(tr('俯视图'))}">${tr('顶')}</button>
                  <button data-view="bottom" title="${esc(tr('仰视图'))}">${tr('底')}</button>
                  <button data-view="isometric" title="${esc(tr('等轴测'))}">${tr('等轴')}</button>
                </div>
              </div>
              <div id="dc_hsBadge" class="dc-hs-badge" hidden></div>
            </div>
          </div>
        </div>

        <!-- ===== R6 §3.1/§3.3：右侧**按需**任务面板（替代原常驻左栏 .dc-rail）=====
             常驻左栏已按 §3.1.1 取消；原来的两块内容（分析结果概览 / 热结列表）迁到这里，
             **id 一律沿用** ⇒ renderOverview() / renderHotspotList() 零改动。
             面板默认收起（data-task="closed"），此时三维拿到全宽；展开时才付出宽度。
             ⚠ 它是 #dc_view3dBox 的**远房兄弟**（都在 .dc-body 内但不同分支）——
               面板开合只改 CSS 列宽 ⇒ 由 #dc_view3dBox 上的 ResizeObserver 自然驱动画布跟随，
               **绝不重建 3D 容器、更不放任何按钮进 #dc_view3dBox**（146 §5 红线）。 -->
        <aside class="dc-taskp" id="dc_taskPanel" hidden>
          <div class="dc-taskp-head">
            <span class="dc-taskp-title" id="dc_taskTitle"></span>
            <button type="button" class="dc-taskp-x" id="dc_taskClose" title="${esc(tr('关闭面板'))}">✕</button>
          </div>
          <div class="dc-taskp-body" id="dc_taskBody" data-step="model">
            <!-- ==== 步骤① 模型与几何信息：两块内容包在一个容器里 ====
                 包容器是**必须的**：#dc_overviewCard 的 hidden 归 renderOverview() 所有
                 （⚠ 本段是**模板字符串**：注释里写反引号会提前闭合它，见 R6-S1 踩坑记录）
                 （有热结数据才显示），面板的步骤切换**不能**去改它，否则两处口径打架。
                 切换只动本容器与下面两个卡片容器。 -->
            <div class="dc-taskp-step" id="dc_modelStep">
              <div class="dc-panel-sec" id="dc_overviewCard" hidden>
                <div class="dc-panel-title">${tr('dc.overview')}</div>
                <div id="dc_overview"></div>
              </div>
              <div class="dc-panel-sec" id="dc_hotspotsCard" hidden>
                <div class="dc-panel-title">${tr('dc.hotspotList')}<span class="chip">${tr('dc.hotspotListChip')}</span></div>
                <div id="dc_hotspotList"></div>
                <div class="field-hint" id="dc_hsHint" style="margin-top:6px"></div>
              </div>
            </div>
            <!-- ==== 步骤② 分析条件 / 步骤③ 工艺参数：S2 从 #dc_paramDlg 迁入 ====
                 字段表/只读表/热结区/帮助块**全部复用**原 #dc_paramDlg 的生成函数，
                 不再有浮层窗口：面板本身就是编辑界面（§3.3「按需任务面板」）。 -->
            <div class="dc-taskp-step" id="dc_condStep" hidden>
              <div class="dc-panel-sec" id="dc_condEditCard">
                <div class="dc-taskp-sech">${tr('分析条件')}<span class="chip">${tr('材料 / 壁厚 / 毛坯重量 / 单位')}</span></div>
                <div id="dc_condBody"></div>
              </div>
            </div>
            <div class="dc-taskp-step" id="dc_paramStep" hidden>
              <div class="dc-panel-sec" id="dc_paramEditCard">
                <div id="dc_paramBody"></div>
              </div>
            </div>
          </div>
          <!-- 编辑态页脚：只在 ②/③ 出现。草稿语义与 R4 参数窗口完全一致（§七）。 -->
          <div class="dc-taskp-foot" id="dc_taskFoot" hidden>
            <div class="dc-dlg-hint" id="dc_taskHint"></div>
            <div class="dc-taskp-footbtn">
              <button type="button" class="btn btn-ghost" id="dc_pfCancel">${tr('取消')}</button>
              <button type="button" class="btn btn-primary" id="dc_pfSave" disabled>💾 ${tr('保存')}</button>
            </div>
          </div>
        </aside>

        <!-- 结果工作区：与模型工作区互斥显示，内部滚动，**不做页面跳转** -->
        <section class="dc-resview" id="dc_results" hidden></section>

      </div>

      <!-- 结果过期 / 分析失败横幅 -->
      <div class="dc-stale-bar" id="dc_staleBar" hidden></div>

      <!-- ===== D. 底部状态栏 ===== -->
      <footer class="dc-statusbar">
        <span class="chip dc-st-unit" id="dc_unitChip"></span>
        <span class="chip dc-file-chip" id="dc_fileName" hidden></span>
        <span class="chip dc-meta-chip" id="dc_metaChip" hidden></span>
        <span class="chip dc-st-item" id="dc_stModel" hidden></span>
        <span class="chip dc-st-item" id="dc_stHotspot" hidden></span>
        <span class="dc-topbar-spacer"></span>
        <span class="chip dc-state-chip" id="dc_stateChip"></span>
      </footer>
    </div>
  `;
  // 导入 STL
  const fileEl = container.querySelector('#dc_file');
  container.querySelector('#dc_pick').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => { if (fileEl.files[0]) importFile(container, fileEl.files[0]); });
  const zone = container.querySelector('#dc_importZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f && /\.stl$/i.test(f.name)) importFile(container, f);
    else if (f) showToast(tr('⚠️ 仅支持 .stl 文件'));
  });
  // STL 替换 / 删除
  container.querySelector('#dc_replaceStl').addEventListener('click', () => fileEl.click());
  container.querySelector('#dc_deleteStl').addEventListener('click', () => deleteStl(container));
  // 3D 控件
  container.querySelector('#dc_viewReset').addEventListener('click', () => state.view3d?.fit());
  container.querySelector('#dc_dispMode').addEventListener('change', (e) => state.view3d?.setDisplayMode(e.target.value));
  container.querySelectorAll('.dc-view-btns button').forEach(btn => {
    btn.addEventListener('click', () => state.view3d?.setView(btn.dataset.view));
  });

  /* ---------- 主操作按钮：文案与动作**都**随状态变化（读的是点击那一刻的真实状态） ----------
     146 §4.1：按钮**就是**流程引导（步骤卡已删）⇒ 每种真实状态都有唯一明确的可执行动作。 */
  container.querySelector('#dc_run').addEventListener('click', () => handleRunButton(container));
  // 参数窗口入口（§3.1：导入 STL 后必须有一个明确的「分析条件与工艺参数」入口）
  container.querySelector('#dc_paramsBtn').addEventListener('click', () => openParamAt(container, paramIssues()[0]?.path));
  /* ---------- R6 §3.2：流程条（**事件委托**）----------
     流程条每次 syncFlowChrome 都会重建 innerHTML ⇒ 若在每个节点上直接绑监听会随重建累积。
     绑在容器上、用 data-flow-step 分流，**注册一次、永不叠加**。 */
  container.querySelector('#dc_flowbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flow-step]');
    if (!btn) return;
    const step = flowSteps().find(s => s.k === btn.dataset.flowStep);
    if (!step) return;
    /* §3.2：**点击后进入哪个实际操作界面**必须明确；前置未满足时给出原因，不静默 */
    if (!step.action) { showToast(tr('ℹ️ {r}', [step.title])); return; }
    if (step.action === 'model') { openTaskPanel(container, 'model'); return; }
    // ② 分析条件 / ③ 工艺参数：S2 起**面板本身**就是编辑界面（浮层窗口已删除）
    if (step.action === 'cond') { openParamPanel(container, 'cond', 'material.family'); return; }
    if (step.action === 'param') { openTaskPanel(container, 'param'); return; }
    /* S5-03：④ 是**合并后的唯一入口**（分析并查看结果）。
       startAnalysis 内部判断：结果当前有效 → 直接查看；否则分析，成功后自动切结果页。
       不再保留独立的 ⑤「结果」节点。 */
    if (step.action === 'run') { startAnalysis(container); return; }
  });
  // 面板自身的开/关：**只改 state.taskStep**，不碰三维容器。
  //   编辑步骤带上未保存草稿时走"先确认再关"（与页脚「取消」同一条路）。
  container.querySelector('#dc_taskClose').addEventListener('click', () => {
    if (TASK_IS_EDIT(state.taskStep)) { requestCloseParamPanel(container); return; }
    closeTaskPanel(container);
  });
  /* 顶部「模型信息」按钮：桌面端用来展开/收起右面板（面板默认收起 ⇒ 三维拿全宽）。
     按钮文案说的是"模型信息"⇒ 点击**只切到 ① 模型步骤**；在编辑步骤时切过去草稿照旧保留
     （切回来还在）。真正"关掉面板"的入口是面板自己的 ✕ 与页脚「取消」——两者都带未保存确认。 */
  container.querySelector('#dc_taskToggle').addEventListener('click', () => {
    if (state.taskStep === 'model') closeTaskPanel(container);
    else openTaskPanel(container, 'model');
  });

  // STL 会话校验（18.txt 四：刷新/新会话时项目里有 STL 数据但内存 mesh 已丢 → 清理防幽灵 STL）
  if (!state.mesh) {
    const r = proj.stlSessionCheck(false);
    if (r.stale) {
      sessionStorage.removeItem(STL_FP_KEY);
      showToast(tr('🔄 页面已刷新：STL 数据已清理，请重新导入 STL'));
    }
  }
  // 恢复已有状态（导入后重进视图）
  state.container = container;
  if (state.mesh) restore(container);
  // 首次进入（无 STL）：主按钮即为「选择 STL 文件」，引导由中央导入区承担（步骤卡已删）
  setWorkspaceView(container, state.wsView, { silent: true });
  syncFlowChrome(container);
}

/* ============================================================
   146.txt §三：**分析条件与工艺参数窗口**
   ── 为什么恢复 ────────────────────────────────────────────────
   145 把「取消无 STL 的独立手动模式」误读成「删除全部参数输入」，把 STL 模式下必要的
   参数查看/输入/修改/确认/保存能力也一并删了。§0 明确更正：**只淘汰 B（无 STL 全手填），
   完整保留 A（导入 STL + 用户补充/修改必要工艺参数）**。
   ── 逐字段核实结论（§3.2 清单 → 实际接线）────────────────────
   字段在下游是不是真的被消费，一律以 `calcs/calcManifest.js` 的 calculate 为准：
     material.family       必需 · 无 STL 来源、无可靠默认值        → 可编辑（必填）
     geometry.blankWeightKg 必需 · 由体积×固态密度派生，可上调     → 可编辑（门禁项）
     geometry.unit         必需 · STL 不带单位                     → 可编辑（改了重写几何派生量）
     process.wallUsed      STL 自动（bodyWallOf → bodyRefOf 回写） → 可编辑（gating 浇注时间 / 无热结时 wallHot 基准）
     process.mcHotspot     STL 自动（最大热结 Mc）                 → 可编辑（riser 的 Mc；门禁读它）
     process.hsPick        用户输入                                → 可编辑（多热结分别设计冒口）
     process.riserShape    默认 cyl                                → 可编辑（RISER_SHAPES 4 种；唯一入口）
     process.riserHeight   RH（冒口顶面高出铸件顶面）/ 用户指定     → 可编辑（gating 的 rh；不再由冒口自动回写）
     process.pourPos       默认顶注                                → 可编辑（gating P 值）
     process.Ho / ph       默认 150 / 100                          → 可编辑（gating C = ph + rh）
     process.ratioKey      空 = 自动推荐                           → 可编辑（gating S:R:G）
     production.cavities   默认 1                                  → 可编辑（G = pw × cav ÷ 出品率）
     material.yieldSug     材料默认                                → 可编辑（gating 的 yr，预估/目标值）
     production.line       默认不指定                              → 可编辑（yield 参考区间）
     production.method     默认砂型机器造型                        → 可编辑（machining 等级）
     process.gateThk / production.ingateN / process.runnerThk /
     production.runnerN / process.ventD                           → **只在结果页编辑**（153 §八）
       —— 这些尺寸/数量在"看到总面积与流速"后才有判断依据；参数面板不再提供第二套入口。
     H/D（hd_ratio）                                               → **只读**：calcManifest 冻结计算链固定 1.0，
       本阶段不提供假输入（独立冒口计算器可调，见 S3 报告）。
   ⇒ **上面每一项在下游 calculate 里都能找到读取点**；结果阶段参数不复制存储，写回同一
     CastingProject。只读几何量（尺寸/体积/面积/壁厚/净重…）集中在 ① 模型与几何信息。
   ── 保存语义（§3.4 / S4 §七）──────────────────────────────────
   · 窗口内的输入先进**局部草稿**（state.paramDraft，只存改动过的键），**不写项目**；
   · 「保存」只落盘（写 CastingProject）→ 已有结果标记过期，**不触发分析**；
   · 顶部第 ④ 项「分析」才执行完整分析（有草稿时先明确确认再保存+分析）；
   · 「取消」若有未保存修改 → 明确确认，绝不静默丢失；
   · 草稿只活在窗口里，**没有第二套状态系统**：全局状态仍只有 CastingProject + state.stale。
   ============================================================ */

/** 窗口字段表（§3.2 三模块）。`ro:true` 的项只读展示。 */
function paramFields() {
  const FAM = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];
  return [
    /* ---- ② 分析条件（真正影响分析的必要条件） ---- */
    { mod: 'cond', path: 'material.family', label: tr('材料大类'), kind: 'select', options: FAM, required: true,
      placeholder: tr('请选择材料大类'),
      hint: tr('STL 只能给出几何，识别不出材料；未指定时无法计算密度/重量。') },
    { mod: 'cond', path: 'process.wallUsed', label: tr('主体壁厚（浇注时间用）'), kind: 'number', unit: 'mm', restore: true,
      hint: tr('自动 = STL 可信主体壁厚（V3 采样链）；也可按工艺判断改为代表壁厚。') },
    { mod: 'cond', path: 'geometry.blankWeightKg', label: tr('毛坯重量（含加工余量，计算口径）'), kind: 'number', unit: 'kg', required: true, restore: true,
      hint: tr('自动 = 净重（体积 × 固态密度）；有加工余量时按实际毛坯上调。') },
    { mod: 'cond', path: 'geometry.unit', label: tr('模型单位'), kind: 'select', options: ['mm', 'cm', 'm', 'inch'], system: 'unit',
      hint: tr('STL 不带单位；非 mm 建模时在此改，保存后再点 ④「分析」重算。') },
    /* ---- ③ 冒口设计 ---- */
    { mod: 'riser', path: 'process.mcHotspot', label: tr('热节模数 Mc（冒口设计依据）'), kind: 'number', unit: 'mm', mcRow: true, restore: true,
      hint: tr('自动 = STL 检出的最大热结模数（热结 H1）。检出多个热结时可分别勾选、分别设计。') },
    { mod: 'riser', path: 'process.riserShape', label: tr('冒口形状'), kind: 'select', shapeRow: true },
    /* S5-05：H/D 设计输入。四档与独立冒口计算器一致；球形不使用（H ≡ D），
       由 fieldHtml 按当前形状隐藏。默认 1.0 保持既有结果。 */
    { mod: 'riser', path: 'process.hdRatio', label: tr('H/D（高度 / 直径）'), kind: 'select', numeric: true, hdRow: true,
      options: [['0.8', '0.8（矮胖）'], ['1.0', '1.0（适中）'], ['1.2', '1.2（瘦高）'], ['1.5', '1.5（细长）']],
      hint: tr('设计输入：改变 H/D 会改变 D、H 与 Vr；保存后点顶部 ④「分析并查看结果」才更新结果。') },
    /* ---- ③ 浇注系统设计 ---- */
    { mod: 'gating', path: 'process.pourPos', label: tr('浇注位置'), kind: 'select', options: ['顶注', '中注', '底注'], diagramRow: true,
      hint: tr('决定 P 值与平均静压头 Hp。') },
    { mod: 'gating', path: 'process.Ho', label: tr('内浇道至上箱面距离 Ho'), kind: 'number', unit: 'mm', placeholder: tr('未填按 150 计'),
      hint: tr('需结合造型方案确定（STL 无法识别分型面）。') },
    { mod: 'gating', path: 'process.ph', label: tr('铸件高度（浇注方向）ph'), kind: 'number', unit: 'mm', placeholder: tr('未填按 100 计'),
      hint: tr('与 RH 一起构成 C = ph + RH。') },
    /* R6-S3.1（154.txt §五.2）：RH 紧接 ph 之后，形成“铸件顶面 → 冒口顶面”的连续几何组。
       RH 是**浇注系统需要的几何高度差**，不是冒口总高 H；由用户按实际冒口位置指定。
       唯一存储仍是 `process.riserHeight`（gating 的 rh / C = ph + rh 读它），不建第二份。
       自定义渲染：`rhEditHtml()`（用户值 + 参考值 + 来源 + 复核提示 + 测量基准图）。 */
    { mod: 'gating', path: 'process.riserHeight', label: tr('RH（冒口顶面高出铸件顶面）'), kind: 'number', unit: 'mm', rhRow: true,
      hint: tr('浇注系统按 C = ph + RH 与平均静压头 Hp 使用。RH 不是冒口自身总高 H：顶冒口直接坐在铸件顶面时二者才相等；侧冒口/冒口座按实际高度差填。底注时现有公式的 Hp 不随 RH 变化。') },
    { mod: 'gating', path: 'process.ratioKey', label: tr('浇注系统比例（直 : 横 : 内）'), kind: 'select', ratioRow: true,
      hint: tr('未选定（自动）= 按材料与铸件重量推荐。封闭式阻流在内浇口，开放式阻流在直浇道。'), ratioHelp: true },
    /* S3：内浇道/横浇道/排气尺寸是**看到结果后再调**的设计参数，全部只在结果页编辑
       （结果页已有一组直写同一 CastingProject 的输入框）。参数面板不再重复一套入口，
       避免"同参数两处保存、两套保存语义"。这里仍由 calcManifest 用既有推荐值兜底。 */
    /* ---- ③ 生产条件（置顶分组：型腔数/预估出品率/造型线/铸造方法）---- */
    { mod: 'gating', group: 'prod', path: 'production.cavities', label: tr('型腔数（一模件数）'), kind: 'number', unit: tr('件'), placeholder: tr('未填按 1 计'),
      hint: tr('整模铸件重 = 单件 × 型腔数；浇注时间用整模重。') },
    { mod: 'gating', group: 'prod', path: 'material.yieldSug', label: tr('预估出品率'), kind: 'number', unit: '%',
      hint: tr('用于反算浇注重量 G 的预估/目标值；不是实称最终出品率。') },
    { mod: 'gating', group: 'prod', path: 'production.line', label: tr('造型线'), kind: 'select', options: ['不指定', '垂直线', '水平线'],
      hint: tr('影响出品率参考区间。') },
    { mod: 'gating', group: 'prod', path: 'production.method', label: tr('铸造方法'), kind: 'select',
      options: ['不指定', '砂型 · 机器造型/壳型', '砂型 · 手工造型', '金属型（重力/低压）', '压力铸造', '熔模铸造'],
      hint: tr('决定加工余量推荐等级（GB/T 6414）。') },
  ];
}

/** 读当前生效值（草稿优先——保证"屏幕上看到的 = 保存后会写入的"） */
function dlgValue(f) {
  if (state.paramDraft && Object.prototype.hasOwnProperty.call(state.paramDraft, f.path)) return state.paramDraft[f.path];
  if (f.system === 'unit') return state.unit;
  /* 149 §五：待恢复的字段，输入框先显示"恢复后会变成的自动原值"。
     这只是**预览**（`proj` 一字未改），保存时才真正走 `restoreAutoValue()`。 */
  if (restorePending(f.path)) {
    const p = proj.get(f.path);
    if (p?.orig) return p.orig.v;
  }
  return proj.getV(f.path);
}
/* ---------------- 149 §五：恢复自动原值（草稿态） ----------------
   语义依据是 `CastingProject.restoreAutoValue()`（模型层，本轮一字未改）：
   只有 `p.orig` 存在且 `p.src === USER_OVERRIDE` 才恢复得动，恢复的是
   **v + src + conf 三件一起**（不是"把数字改回去"）。 */
const restorePending = (path) => !!state.draftRestore && state.draftRestore.has(path);
/** 该字段此刻是否**真的**有可恢复的自动原值（§五.1：没有就不显示入口） */
function canRestorePath(path) {
  const p = proj.get(path);
  return !!p && !!p.orig && p.src === SRC.USER_OVERRIDE;
}
const dlgDirty = () => (!!state.paramDraft && Object.keys(state.paramDraft).length > 0)
  || (!!state.draftRestore && state.draftRestore.size > 0);
/** 未保存改动的**项数**（含待恢复项）—— 页脚与关闭确认都用它，两处口径必须一致 */
const dlgDirtyCount = () => (state.paramDraft ? Object.keys(state.paramDraft).length : 0)
  + (state.draftRestore ? state.draftRestore.size : 0);

/* ---------------- 打开 / 关闭（R6-S2：界面载体 = 右侧任务面板，不再有浮层） ----------------
   `step` 决定面板停在哪一步：'cond'（分析条件）| 'param'（工艺设计：冒口/浇注）。
   `sub`  仅对 'param' 有效：'riser' | 'gating'（对应 `state.paramTab`）。
   草稿**只在会话起点建立**：从 ② 切到 ③（或点流程条来回跳）**不重新起稿**，
   否则用户刚填的值会在切换步骤的一瞬间无声消失（§3.4 明令禁止静默丢失）。 */
function openParamPanel(container, step, focusPath) {
  const target = step === 'cond' ? 'cond' : 'param';
  if (!state.paramDraft) {                     // 仅当本会话还没有草稿时才起稿
    state.paramDraft = {};
    state.draftRestore = new Set();            // 待恢复意图同生命周期（§五）
  }
  state.taskStep = target;
  syncTaskPanel(container);                    // 先让面板出现（hidden=false 后才量得到位置）
  renderParamPanel(container, focusPath || null);
}

/** 打开面板并直达能编辑 `path` 的那一步/子模块（找不到就停在 ② 分析条件）。
    用于"缺什么就带用户去哪里"——主按钮、流程条 ②③ 都走这一个入口，不各写一套。 */
function openParamAt(container, path) {
  const f = path ? paramFields().find(x => x.path === path) : null;
  if (f && f.mod !== 'cond') state.paramTab = f.mod;   // 必须在 render 之前定好子模块
  openParamPanel(container, (f && f.mod !== 'cond') ? 'param' : 'cond', f ? f.path : null);
}

/** 终结草稿（保存 / 取消 / 关面板 三条路都经这里，保证不会留下幽灵修改） */
function clearParamDraft() {
  state.paramDraft = null;
  state.draftRestore = null;      // 关闭/取消 = 待恢复意图一并作废（项目自始至终没被动过）
}

/** 关面板 + 清草稿（内部用：数据被替换/重建时不问，因为草稿本来就已无意义）
    ⚠ 同时**清空编辑区 DOM**（沿用 146 §3.4 断言的用意：编辑界面关掉后不留游离的输入控件）。
    只把容器 hidden 掉而不清内容，会让"页面上有几套参数输入控件"变成说不清的事。 */
function closeParamPanel(container) {
  clearParamDraft();
  const condBody = container.querySelector('#dc_condBody');
  const paramBody = container.querySelector('#dc_paramBody');
  if (condBody) condBody.innerHTML = '';
  if (paramBody) paramBody.innerHTML = '';
  /* R6-S3：从 ① 模型信息关闭时也必须真正收起面板（否则 ✕ 只清了草稿、面板还开着）。 */
  state.taskStep = null;
  syncTaskPanel(container);
}

/** §3.4：取消/关闭**不能静默丢失未保存修改** —— 有改动就明确问一次 */
function requestCloseParamPanel(container) {
  if (!dlgDirty()) { closeParamPanel(container); return; }
  const n = dlgDirtyCount();
  if (window.confirm(tr('有 {n} 项未保存的参数修改，关闭将丢弃这些修改。确定关闭吗？', [n]))) closeParamPanel(container);
}

/* ---------------- 渲染（R6-S2：渲染目标是右侧任务面板的两个容器） ----------------
   R6-S3 在 S2 的骨架上重整了字段归属（剩余 15 个前置字段 + 帮助/热结区）：
     · 分析条件 4 个；冒口设计（热结选择 / Mc / 形状）；浇注系统 8 个（生产条件 4 + RH + 3）。
     · 内浇道/横浇道/排气 5 个字段只在结果页编辑；只读几何值集中在 ①。
     · RH 是**可编辑的同一 process.riserHeight**（S3 取代 S2.2 的只读展示）。 */
function renderParamPanel(container, focusPath) {
  const panel = container.querySelector('#dc_taskPanel');
  const condBody = container.querySelector('#dc_condBody');
  const paramBody = container.querySelector('#dc_paramBody');
  if (!panel || !condBody || !paramBody) return;
  const step = state.taskStep;
  if (step !== 'cond' && step !== 'param') return;   // 只有编辑步骤才渲染（① 走 renderOverview）
  const issues = paramIssues(true);   // §3.4：保存按钮看**草稿**（否则刚填上必填项也存不下去）
  const issueMsg = (path) => issues.find(i => i.path === path)?.msg || '';
  const fields = paramFields();
  /* R6-S3（153.txt §五/§六）：界面标题不再用 B/C 当主标题；它们只是内部子模块键。 */
  const MODS = [
    { k: 'cond', t: tr('分析条件'), sub: tr('材料 / 壁厚 / 毛坯重量 / 单位') },
    { k: 'riser', t: tr('冒口设计'), sub: tr('热结选择 / Mc / 形状 / H/D') },
    { k: 'gating', t: tr('浇注系统设计'), sub: tr('生产条件 / RH / 浇注方向 / 比例') },
  ];

  /* ★★ S2.2-B 修复（保留）：热结勾选/逐项 Mc 的编辑必须以**当前草稿**为基，
     不能以项目里的已保存值为基。否则连续勾选两个热结时，第二次勾选会用项目里的
     旧数组重算 ⇒ 第一次的勾选被静默丢掉（实测：H1+H2 一起勾，保存后只剩 H2）。
     它现在也供 Mc 区块读取"本次到底采用哪些热结"。 */
  const currentPicks = () => (state.paramDraft && 'process.hsPick' in state.paramDraft)
    ? (state.paramDraft['process.hsPick'] || []).slice()
    : (proj.getV('process.hsPick') || []).slice();
  /** 草稿内热结选择变化后，就地更新“本次设计采用 Mc”（不重渲染，避免丢逐热结输入焦点）。
      只有当从“无勾选”切到“有勾选”（或反之）时才需要重渲染主 Mc 输入/只读块的形态。 */
  const refreshMcAdopted = (picks) => {
    const max = picks.length ? picks.reduce((a, b) => (b.mc > a.mc ? b : a), picks[0]).mc : null;
    panel.querySelectorAll('[data-mc-adopted-val]').forEach(el => {
      el.textContent = max > 0 ? fmt(max, 2) : '—';
    });
  };
  /** 自动 Mc 的真实来源/数值（与 calcManifest 的选值分支同口径，只做展示，不参与计算） */
  const mcAutoInfo = () => {
    const hsStatus = proj.getV('hotspots.status') || 'none';
    const hs = proj.getV('hotspots.items') || [];
    const picks = currentPicks();
    if (picks.length) {
      const primary = picks.reduce((a, b) => (b.mc > a.mc ? b : a), picks[0]);
      return { value: primary?.mc ?? 0, label: tr('已勾选 {n} 个热结，主冒口取 Mc 最大者', [picks.length]), path: null, blocked: false };
    }
    if (hsStatus === 'ok' && hs.length) {
      const maxMc = Math.max(...hs.map(h => h.mc || 0));
      return { value: maxMc, label: tr('STL 自动识别（最大热结 Mc）'), path: 'process.mcHotspot', blocked: false };
    }
    if (hsStatus === 'INSUFFICIENT_RESOLUTION' || hsStatus === 'LOW_CONFIDENCE') {
      return { value: null, label: tr('热结分析未给出可靠结果，需人工指定 Mc'), path: null, blocked: true };
    }
    const wallHot = proj.getV('process.wallHot') || 0;
    return { value: wallHot, label: tr('壁厚/结构参考值（主体壁厚 ÷ 2）'), path: 'process.wallHot', blocked: false };
  };
  /** Mc 区块的"自动值 vs 设计采用值"说明（153 §六.1：两者必须同时可见、口径一致） */
  const mcAutoHtml = () => {
    const info = mcAutoInfo();
    const picks = currentPicks();
    const autoTxt = info.value > 0 ? fmt(info.value, 2) + ' mm' : '—';
    const adopted = picks.length
      ? picks.reduce((a, b) => (b.mc > a.mc ? b : a), picks[0])?.mc
      : (dlgValue({ path: 'process.mcHotspot' }) > 0 ? dlgValue({ path: 'process.mcHotspot' }) : info.value);
    const adoptedTxt = adopted > 0 ? fmt(adopted, 2) + ' mm' : '—';
    const eq = adopted > 0 && info.value > 0 && Math.abs(adopted - info.value) < 1e-9;
    return `<div class="dc-dlg-note dc-mc-adopt">
      ${tr('自动/参考 Mc：')}<b>${autoTxt}</b>（${esc(info.label)}） · ${tr('本次采用：')}<b data-mc-adopted><span data-mc-adopted-val>${adopted > 0 ? fmt(adopted, 2) : '—'}</span>${adopted > 0 ? ' mm' : ''}</b><span data-mc-adopted-state>${eq ? ' ' + tr('（等于自动值）') : ' ' + tr('（已修正）')}</span>
    </div>`;
  };

  /* R6-S3.1（154.txt §五）：RH = **冒口顶面高出铸件顶面的距离**（浇注系统口径），
     不是冒口总高 H。唯一存储 = process.riserHeight；只有用户输入才算“指定”。
     · **不再自动回读冒口总高**：riser 结果只作为显式可采用的参考值（仅顶冒口直接坐铸件顶面时适用）。
     · 手动值写 USER_INPUT/USER_OVERRIDE；冒口重算/换 STL 不静默覆盖，但会提示复核。
     · 底注时现有公式 Hp 不随 RH 变化（如实披露，不假装有影响）。
     · 测量基准图与公式说明放进可展开区，主界面只留 P1 复核提示。 */
  const rhEditHtml = (f) => {
    const p = proj.get(f.path);
    const src = p?.src || SRC.DEFAULT;
    const isUser = src === SRC.USER_OVERRIDE || src === SRC.USER_INPUT;
    const draftOn = !!state.paramDraft && Object.prototype.hasOwnProperty.call(state.paramDraft, f.path);
    const v = dlgValue(f);
    const shown = (typeof v === 'number' && Number.isFinite(v) && v > 0) ? String(v) : '';
    const manual = isUser || (draftOn && shown !== '');
    // 参考值只来自**本次冒口结果**，不再从 orig / CALC_RESULT 自动继承。
    const refRaw = (state.results?.riser && !state.results.riser.blocked && state.results.riser.H > 0)
      ? state.results.riser.H : null;
    const refTxt = refRaw != null ? fmt(refRaw, 1) + ' mm' : '—';
    const badge = manual ? tr('用户指定') : tr('未指定');
    return `<div class="dc-dlg-fld dc-rh-linked" data-rh-linked data-rh-src="${esc(src)}" data-rh-manual="${manual ? '1' : '0'}">
      <label>${esc(f.label)} <span class="chip dc-rh-badge${manual ? ' dc-chip-warn' : ''}">${esc(badge)}</span></label>
      <div class="f-row">
        <input class="field-input" type="number" step="any" id="${'dc_p_' + f.path.replace(/\./g, '_')}"
          data-pf="${esc(f.path)}" value="${esc(shown)}" placeholder="${esc(tr('按实际位置填写；未填按 0 计'))}">
        <span class="f-unit">mm</span>
      </div>
      <div class="dc-dlg-note dc-rh-ref">${tr('本次冒口计算 H 参考：')}<b>${refTxt}</b>
        ${refRaw != null ? `<button type="button" class="dc-mini-btn" data-rh-use-ref="${esc(refRaw)}">${tr('采用此参考值')}</button>` : ''}</div>
      ${!manual ? `<div class="dc-hint-p1" role="status">⚠️ ${tr('RH 未指定：浇注系统按 RH = 0 计算，平均静压头 Hp 可能偏离实际。请按实际冒口位置填写。')}</div>` : ''}
      ${manual ? `<div class="dc-dlg-note">${tr('已由用户指定：重算与更换 STL 后不覆盖；几何或冒口方案变化后请复核。')}</div>` : ''}
      <div class="dc-dlg-note">${tr('冒口顶高于周边顶面的距离；未填按 0 计。')}</div>
      ${f.hint ? `<div class="dc-dlg-note">${esc(f.hint)}</div>` : ''}
    </div>`;
  };

  const fieldHtml = (f) => {
    if (f.rhRow) return rhEditHtml(f);
    const v = dlgValue(f);
    const bad = issueMsg(f.path);
    const p = proj.get(f.path);
    /* 稳定 id：`data-pf` 是行为钩子，`id` 供自动化测试与 label 关联（材料/单位沿用历史 id，
       让既有测试只需"先打开窗口"这一步改动）。 */
    const fid = f.system === 'unit' ? 'dc_m_unit' : (f.path === 'material.family' ? 'dc_m_family' : 'dc_p_' + f.path.replace(/\./g, '_'));
    let ctrl = '';
    /* R6-S3（153.txt §六.1）：勾选了热结时，主 Mc 输入框**不再存在** ——
       calcManifest 走多热结路径，`process.mcHotspot` 根本不参与计算；继续显示它会让用户
       以为改它有用（屏幕与计算不一致）。此时只读展示"主冒口采用值 = 各勾选 Mc 的最大值"，
       真正的修改入口是下方逐热结 Mc（每个热结绑定自己的 id）。 */
    const picksNow = f.mcRow ? currentPicks() : [];
    if (f.mcRow && picksNow.length) {
      const primary = picksNow.reduce((a, b) => (b.mc > a.mc ? b : a), picksNow[0]);
      ctrl = `<div class="dc-dlg-ro" data-mc-adopted><span data-mc-adopted-val>${fmt(primary?.mc, 2)}</span> mm ${tr('（主冒口 = 已勾选热结的最大 Mc；逐项值见下方热结行）')}</div>`;
    } else if (f.kind === 'select') {
      let opts;
      if (f.ratioRow) {
        const autoRec = recommendGatingRatio(matKeyOf(proj.getV('material.family') || '灰铁'), proj.getV('geometry.blankWeightKg') || 0);
        opts = [['', tr('自动推荐（按材料/重量 → {r}）', [tr(autoRec)])]]
          .concat(Object.keys(RATIO_PRESETS).map(k => [k, `${tr(k)}　${RATIO_PRESETS[k].r.map(x => x.toFixed(2)).join(' : ')}`]));
      } else if (f.shapeRow) {
        opts = Object.entries(RISER_SHAPES).map(([k, s]) => [k, tr(s.name)]);
        // R8：发热/保温冒口作为视图层经验选项，核心仍按普通圆柱基准计算（不改冻结算法）
        opts.push(['insulated', tr('发热/保温冒口（经验估算）')]);
      } else {
        /* options 支持字符串或 [value, label] 二元组（H/D 四档需要“0.8（矮胖）”这类标签）。 */
        opts = (f.options || []).map(o => Array.isArray(o) ? [o[0], tr(o[1])] : [o, tr(o)]);
      }
      /* ⚠ 值不在候选里（典型：必填的「材料大类」还没选）时**必须补一个占位项**。
         不补的话浏览器会默认选中第一项 ⇒ 界面显示"灰铁"、项目里其实是空的、
         旁边还挂着"未指定"的警告 —— 正是 §3.4 禁止的"UI 显示已确认、实际没值"。
         （人工截图验收实拍到过。） */
      /* 数值下拉（H/D）必须按 number 比较：项目里是 1，option value 是 '1.0'，
         用字符串比较会一个都选不中，浏览器退回第一项（实测默认显示 0.8）。 */
      const sameOpt = (a, b) => f.numeric ? Number(a) === Number(b) : String(a) === String(b);
      const matched = opts.some(([val]) => sameOpt(val, v ?? ''));
      if (!matched) opts = [['', f.placeholder || tr('未填')], ...opts];
      ctrl = `<select class="field-select" id="${fid}" data-pf="${esc(f.path)}">
        ${opts.map(([val, lab]) => `<option value="${esc(val)}" ${sameOpt(val, v ?? '') ? 'selected' : ''}${val === '' && !matched ? ' disabled' : ''}>${esc(lab)}</option>`).join('')}
      </select>`;
    } else {
      const shown = (v === undefined || v === null || v === 0 || v === '') ? '' : String(v);
      /* Mc 的自动值可能来自 wallHot（NO_HOTSPOT 时 mcHotspot 仍为 0）⇒ 输入框为空，
         用 placeholder 把"自动采用值"显示出来，避免用户以为没有 Mc。 */
      const mcPh = (f.mcRow && !picksNow.length && mcAutoInfo().value > 0)
        ? fmt(mcAutoInfo().value, 2) + ' mm' : '';
      ctrl = `<input class="field-input" type="number" step="any" id="${fid}" data-pf="${esc(f.path)}"
        value="${esc(shown)}" placeholder="${esc(f.placeholder || mcPh || tr('未填'))}">`;

    }
    const unit = f.unit ? `<span class="f-unit">${esc(f.unit)}</span>` : '';
    /* 形状帮助必须能**就地刷新**：`[data-shape-note]` 是行为钩子（与 data-pf 同一约定）。
       不包这一层的话，切形状后只能整面板重渲染才能换文案 —— 那会丢焦点，也会让用户
       在"下拉已变、下面还写着旧形状公式"的状态里以为切换没生效。 */
    const shapeHint = f.shapeRow ? `<div class="dc-shape-note" data-shape-note>${shapeNoteHtml(v)}</div>` : '';
    const mcAuto = f.mcRow ? mcAutoHtml() : '';
    const mcNote = f.mcRow ? mcSourceNote() : '';
    /* S5-05/S6：H/D 是设计输入。只有球形没有独立 H/D 自由度；
       发热/保温沿用当前圆柱 H/D（164.txt 4.3），不再固定为 1、也不隐藏选择器。 */
    const hdSphereNote = f.shapeRow ? `<div class="dc-dlg-note" data-hd-sphere-note hidden>
      ${tr('球形冒口由球径唯一确定（H ≡ D），不存在独立的 H/D 设计自由度；H/D 选择器已隐藏。')}
    </div>` : '';
    /* 149 §二.2：帮助一律**按需展开**（<details>），常驻的只有字段名/单位/来源徽章/一行短说明，
       所以"必要的字段含义和来源"不会因为折叠而消失（§二「不能完全隐藏」）。 */
    const help = [
      f.ratioHelp ? ratioHelpHtml() : '',
      f.diagramRow ? gatingDiagramHtml(v) : '',
    ].join('');
    const restore = f.restore ? restoreRowHtml(f.path) : '';
    return `<div class="dc-dlg-fld"${f.hdRow ? ' data-hd-field' : ''}>
      <label>${esc(f.label)}${f.required ? ` <span class="dc-req">${tr('必填')}</span>` : ''}${p && !(f.mcRow && picksNow.length) ? srcTagHtml(p, !!state.mesh, { restorePath: f.restore ? f.path : null }) : ''}</label>
      <div class="f-row">${ctrl}${unit}</div>
      ${f.hint ? `<div class="dc-dlg-note">${esc(f.hint)}</div>` : ''}
      ${shapeHint}${hdSphereNote}${mcAuto}${mcNote}${restore}${help}
      ${bad ? `<div class="dc-dlg-warn">⚠️ ${esc(bad)}</div>` : ''}
    </div>`;
  };

  const secHtml = (m) => {
    const list = fields.filter(f => f.mod === m.k);
    /* R6-S3.1：RH 不再单列在字段组顶部，而是按 `paramFields()` 的顺序紧跟在 ph 之后
       （154.txt §五.2：RH 放在 PH 下方，形成连续的几何参数分组）。 */
    const head = list.filter(f => !f.group && !f.mcRow);
    const prod = list.filter(f => f.group === 'prod');
    const mcF = list.find(f => f.mcRow);
    if (!head.length && !prod.length && !mcF) return '';
    /* 153.txt §五.D：生产条件（型腔数 / 预估出品率 / 造型线 / 铸造方法）**置顶**到浇注系统设计，
       而不是像旧版一样挂在模块最末。它影响浇注重量、出品率参考与加工余量，属于前置条件。 */
    const prodBlock = prod.length ? `
      <div class="dc-dlg-subhead" data-group="prod"><b>${tr('生产条件')}</b><span class="chip">${tr('影响浇注重量 / 出品率 / 加工余量')}</span></div>
      <div class="dc-dlg-grid">${prod.map(fieldHtml).join('')}</div>` : '';
    const modelLink = `<div class="dc-dlg-note dc-model-link">${tr('几何量由 STL 自动识别：')}
      <button type="button" class="dc-mini-btn" data-goto-model>① ${tr('模型与几何信息')}</button></div>`;
    return `<section class="dc-dlg-sec" id="dc_sec_${m.k}">
      <div class="dc-dlg-sechead"><b>${esc(m.t)}</b><span class="chip">${esc(m.sub)}</span>
        ${m.k === 'riser' ? `<span class="chip">${tr('冒口结果来自现有冒口计算器')}</span>` : ''}</div>
      ${m.k === 'gating' ? prodBlock : ''}
      ${/* S2.2-B：热结选择是**冒口设计的输入**，放在冒口设计最上方；
           它写草稿，保存后生效（分析由顶部 ④ 执行），与逐热结 Mc 共用同一个 `process.hsPick`。 */ ''}
      ${m.k === 'riser' ? `<div class="dc-dlg-grid">${hotspotPickHtml()}${mcF ? fieldHtml(mcF) : ''}</div>` : ''}
      <div class="dc-dlg-grid">
        ${head.map(fieldHtml).join('')}
        ${m.k === 'gating' ? `<div class="dc-dlg-note dc-edit-in-results">${tr('内浇道 / 横浇道 / 排气在「结果页 → 经典浇注系统设计」中调整（长度 / 孔数自动重算）；排气规则与浇注系统工程原则见结果页「详细信息」。')}</div>` : ''}
        ${m.k === 'cond' ? modelLink : ''}
      </div>
    </section>`;
  };

  /* 来源图例（149 §二.2 的 v1.1.0 原文，一字未改）：两步编辑里都出现在最上方。
     由**同一个表达式**产出、在两处使用——不是"两份文案各自维护"。 */
  const legend = `<div class="dc-src-legend">${tr('🟢 STL 自动识别 · 🟡 用户输入/默认 · 🔵 自动计算 · 🟠 用户修改（覆盖自动值，可 ↺ 恢复原值）')}</div>`;

  if (step === 'cond') {
    condBody.innerHTML = legend + secHtml(MODS[0]);
  } else {
    /* ③ 工艺设计 = 冒口设计 + 浇注系统设计 两个子模块。
       只渲染**当前子模块**：全部字段堆在一页会变成一条谁也读不完的长表单（§3.3 明确禁止）。
       `state.paramTab` 是这条切换的唯一状态（146 起就是个只写不读的死变量，S2 复活它）。 */
    const act = MODS.find(m => m.k === state.paramTab && m.k !== 'cond') || MODS[1];
    paramBody.innerHTML = `
      <div class="dc-param-tabs" id="dc_paramTabs">
        ${MODS.filter(m => m.k !== 'cond').map(m => `
          <button type="button" class="dc-param-tab${m.k === act.k ? ' on' : ''}" data-ptab="${m.k}"
            title="${esc(m.sub)}">${esc(m.t)}<span class="dc-param-tab-sub">${esc(m.sub)}</span></button>`).join('')}
      </div>
      ${legend}${secHtml(act)}`;
  }

  /* S5-05 / 164 §4.3：H/D 选择器随形状显隐——只有球形没有独立自由度。
     发热/保温沿用当前圆柱 H/D，切换形状时选择值原样保留。 */
  const syncHdUi = () => {
    const shapeKey = dlgValue({ path: 'process.riserShape' }) || proj.getV('process.riserShape') || 'cyl';
    const isSphere = shapeKey === 'sphere';
    panel.querySelectorAll('[data-hd-field]').forEach(el => { el.hidden = isSphere; });
    panel.querySelectorAll('[data-hd-sphere-note]').forEach(el => {
      el.hidden = !isSphere;
      if (!el.hidden) el.textContent = tr('球形冒口由球径唯一确定（H ≡ D），不存在独立的 H/D 设计自由度；H/D 选择器已隐藏。');
    });
  };
  syncHdUi();

  /** 草稿里"热结选择"的**唯一写入口**（勾选与逐项改 Mc 共用，保证两者不会各写各的） */
  const writeHsPickDraft = (list) => {
    const base = proj.getV('process.hsPick') || [];
    const sorted = list.slice().sort((a, b) => a.id - b.id);
    state.paramDraft = state.paramDraft || {};
    if (JSON.stringify(sorted) === JSON.stringify(base)) delete state.paramDraft['process.hsPick'];
    else state.paramDraft['process.hsPick'] = sorted;
    refreshTaskFoot(container);
  };
  const refreshHsNote = () => {
    const el = panel.querySelector('[data-hs-pick-note]');
    if (!el) return;
    // 草稿里没有该键 = 与项目一致（writeHsPickDraft 的"改回原值就不记草稿"约定）⇒ 直接读项目
    const picks = state.paramDraft && 'process.hsPick' in state.paramDraft
      ? state.paramDraft['process.hsPick'] : (proj.getV('process.hsPick') || []);
    el.innerHTML = hsPickNoteText(picks || []);
  };

  // 输入 → 草稿（**不写项目**）
  panel.querySelectorAll('[data-pf]').forEach(el => {
    const path = el.dataset.pf;
    const f = fields.find(x => x.path === path);
    const handler = () => {
      const raw = el.value;
      let val;
      if (f.kind === 'select') {
        /* H/D 等数值下拉必须以 number 入草稿/proj：字符串 '1.0' 与 1 比较会造出幽灵草稿。 */
        val = f.numeric ? parseFloat(raw) : raw;
        if (f.numeric && !Number.isFinite(val)) return;
      } else { val = raw === '' ? 0 : parseFloat(raw); if (!Number.isFinite(val)) val = 0; }
      const base = f.system === 'unit' ? state.unit : proj.getV(path);
      state.paramDraft = state.paramDraft || {};
      // 改回原值 = 不算改动（否则"打开又改回来"会留下幽灵草稿）
      if (String(val) === String(base ?? '')) delete state.paramDraft[path];
      else state.paramDraft[path] = val;
      /* 149 §五：手动改成别的值 = 放弃"恢复自动值"的意图（后一次操作覆盖前一次，
         不做"两个意图叠加"那种需要用户猜谁赢的规则）。 */
      state.draftRestore?.delete(path);
      panel.querySelector(`[data-undo-restore="${path}"]`)?.closest('.dc-restore-pending')?.remove();
      /* 冒口形状：公式/补缩效率**立即**按当前草稿值刷新（S2.2-A）。
         只换这一个帮助节点，不重渲染整面板 ⇒ 下拉焦点与滚动位置都不动。
         文案来源仍是 `shapeNoteHtml()` → `RISER_SHAPES` / `RISER_EFF`（冻结模块的权威表）。 */
      if (f.shapeRow) {
        const host = panel.querySelector('[data-shape-note]');
        if (host) host.innerHTML = shapeNoteHtml(val);
        syncHdUi();   // S5-05：球形隐藏 H/D，其余形状恢复
      }
      /* R6-S3.1：RH 输入后立刻反映“用户指定 / 未指定”状态（不重渲染，保留输入焦点）。
         未填（0）仍是“未指定”，浇注系统按 0 计——不能因为用户点过输入框就假装已指定。 */
      if (f.rhRow) {
        const wrap = panel.querySelector('[data-rh-linked]');
        const nowManual = Number.isFinite(val) && val > 0;
        if (wrap) {
          wrap.dataset.rhManual = nowManual ? '1' : '0';
          const badge = wrap.querySelector('.dc-rh-badge');
          if (badge) {
            badge.textContent = nowManual ? tr('用户指定') : tr('未指定');
            badge.classList.toggle('dc-chip-warn', nowManual);
          }
          const p1 = wrap.querySelector('.dc-hint-p1');
          if (p1) p1.hidden = nowManual;
        }
      }
      /* Mc 主输入变化：采用值/“已修正”状态必须同步（不重渲染，保留输入焦点）。 */
      if (f.mcRow) {
        const info = mcAutoInfo();
        const num = typeof val === 'number' ? val : 0;
        const adopted = num > 0 ? num : info.value;
        panel.querySelectorAll('[data-mc-adopted-val]').forEach(el => {
          el.textContent = adopted > 0 ? fmt(adopted, 2) : '—';
        });
        const st = panel.querySelector('[data-mc-adopted-state]');
        const isAuto = num <= 0 || (info.value > 0 && Math.abs(num - info.value) < 1e-9);
        if (st) st.textContent = isAuto ? ' ' + tr('（等于自动值）') : ' ' + tr('（已修正）');
      }
      refreshTaskFoot(container);
    };
    el.addEventListener(f.kind === 'select' ? 'change' : 'input', handler);
  });

  // 热结勾选（写草稿；保存时统一落盘）
  panel.querySelectorAll('[data-dlg-hs]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = +cb.dataset.dlgHs;
      const items = proj.getV('hotspots.items') || [];
      const det = items.find(x => x.id === id)?.mc || 0;
      const base = currentPicks();
      const hadPicks = base.length > 0;
      const rest = base.filter(p => p.id !== id);
      if (cb.checked && det > 0) rest.push({ id, mc: det });
      writeHsPickDraft(rest);
      /* 149 §四：行内的「冒口设计 Mc」只在**该热结参与设计时**可编辑——
         不勾选的热结在 calcManifest 里根本不计算（`picks.filter(...)`），
         让它可编辑反而会造出一个"填了但不生效"的假入口。 */
      const row = cb.closest('.dc-hsp');
      const mcIn = row?.querySelector('[data-dlg-hs-mc]');
      if (mcIn) { mcIn.disabled = !cb.checked; mcIn.value = cb.checked ? String(det) : ''; }
      row?.querySelector('[data-dlg-hs-mc-reset]')?.remove();
      refreshHsNote();
      const now = currentPicks();
      /* 0 ⇄ >0：主 Mc 的“可编辑输入 / 只读采用值”形态需要切换 ⇒ 重渲染；
         已在多选状态内增减热结：只就地更新采用值。 */
      if (hadPicks !== (now.length > 0)) renderParamPanel(container, null);
      else refreshMcAdopted(now);
    });
  });

  /* 149 §四：逐热结改 Mc —— 只改本行的 `hsPick` 元素（按 id 定位），其他热结一个字节都不动 */
  panel.querySelectorAll('[data-dlg-hs-mc]').forEach(inp => {
    inp.addEventListener('input', () => {
      const id = +inp.dataset.dlgHsMc;
      const raw = parseFloat(inp.value);
      /* ⚠ 与 `calcManifest` 的 `p.mc > 0` 过滤同口径：非正值 = 该热结算不出来。
         不静默写一个 0 进去（那会让它被悄悄剔除），而是明确提示并保持原值不变。 */
      if (!(raw > 0)) { inp.classList.add('bad'); return; }
      inp.classList.remove('bad');
      const base = currentPicks();
      const rest = base.filter(p => p.id !== id);
      rest.push({ id, mc: raw });
      writeHsPickDraft(rest);
      refreshHsNote();
      refreshMcAdopted(currentPicks());
    });
  });
  panel.querySelectorAll('[data-dlg-hs-mc-reset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = +btn.dataset.dlgHsMcReset;
      const det = (proj.getV('hotspots.items') || []).find(x => x.id === id)?.mc || 0;
      const inp = panel.querySelector(`[data-dlg-hs-mc="${id}"]`);
      if (inp) { inp.value = String(det); inp.classList.remove('bad'); }
      const base = currentPicks();
      const rest = base.filter(p => p.id !== id);
      rest.push({ id, mc: det });
      writeHsPickDraft(rest);
      btn.remove();
      refreshHsNote();
      refreshMcAdopted(currentPicks());
    });
  });

  /* 149 §五：↺ 恢复自动原值 —— **只标记意图，不写项目**（§七「保存前项目数据不变」）。
     真正落盘在 saveParamDraft 里走 `proj.restoreAutoValue()`（模型层既有实现，一字未改）。 */
  panel.querySelectorAll('[data-reset-orig]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.resetOrig;
      if (!canRestorePath(path)) return;                 // 没有原值就什么也不做（按钮本来也不该在）
      state.draftRestore = state.draftRestore || new Set();
      state.draftRestore.add(path);
      state.paramDraft?.delete?.(path);                  // 恢复意图压过同字段的手改草稿
      renderParamPanel(container, null);                   // 重渲染以显示"待恢复"状态与预览值
    });
  });
  panel.querySelectorAll('[data-undo-restore]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.draftRestore?.delete(btn.dataset.undoRestore);
      renderParamPanel(container, null);
    });
  });
  /* R6-S3.1（154.txt §五.3）：冒口 H 只作**显式可采用**的参考值，绝不自动回读。
     点击后仍走草稿 → 保存 → 顶部 ④ 分析，用户始终知道 RH 从哪来。 */
  panel.querySelectorAll('[data-rh-use-ref]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = parseFloat(btn.dataset.rhUseRef);
      if (!(v > 0)) return;
      state.paramDraft = state.paramDraft || {};
      state.paramDraft['process.riserHeight'] = v;
      state.draftRestore?.delete('process.riserHeight');
      renderParamPanel(container, 'process.riserHeight');
    });
  });
  /* B/C 子模块切换（③ 工艺参数）。**只改 `state.paramTab` 再重渲染** ——
     草稿在 `state.paramDraft` 里，与"当前在看哪个子模块"完全无关 ⇒ 来回切不会丢用户输入。 */
  panel.querySelectorAll('[data-ptab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.paramTab === btn.dataset.ptab) return;
      state.paramTab = btn.dataset.ptab;
      renderParamPanel(container, null);
    });
  });
  /* R6-S3：① 模型与几何信息 / 冒口设计 之间的明确入口。
     · 从分析条件跳到 ① 只读模型信息（不再在编辑面板里重复铺开 5 个只读值）；
     · 从浇注系统跳回冒口设计（H/D、形状、Mc 的修改入口仍只有一个）。 */
  panel.querySelectorAll('[data-goto-model]').forEach(btn => {
    btn.addEventListener('click', () => openTaskPanel(container, 'model'));
  });
  /* ⚠⚠ 页脚三个常驻按钮（✕ / 取消 / 保存）**一律不在这里 addEventListener**。
     它们长在 render() 建的那层 DOM 上（不像 `#dc_condBody` / `#dc_paramBody` 的内容会被
     innerHTML 整体换掉），而本函数每渲染一次就被调一次 ⇒ 直接绑就是"S1 刚修掉的监听堆叠"
     同款缺陷，实测点一次保存会连跑 6 次 `saveParamDraft`（每次渲染 +1）。
     改为**一次性委托**：绑在同样常驻的 `#dc_taskFoot` 上，用 data 标记保证只挂一次。
     （`#dc_taskClose` 更早在 render() 里绑，同样只挂一次、按 state.taskStep 分派。） */
  if (!panel.dataset.footBound) {
    panel.dataset.footBound = '1';
    panel.querySelector('#dc_taskFoot').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.id === 'dc_pfCancel') requestCloseParamPanel(container);
      else if (b.id === 'dc_pfSave') saveParamDraft(container);
    });
  }
  /* 页脚文案与保存按钮可用性 = 渲染的一部分：**不刷新它，页脚就会停在上一次的草稿状态**
     （实测：保存成功后页脚仍写"有 1 项修改尚未保存"，保存按钮也从不进入 disabled）。 */
  refreshTaskFoot(container);
  /* ★ 浮层空白处点击关闭的处理器**已随浮层一起删除**（R6-S2）。
     它当年是为了修"backdrop 监听堆叠"（S0 §6.1：开窗 3 轮后点一次背景弹 4 个 confirm）
     才加的 `dataset.backdropBound` 保险；现在没有浮层，也就不存在这段逻辑。
     面板的关闭入口只有两个，都明确可见：头部 ✕ 与页脚「取消」。 */

  if (focusPath) {
    const sec = fields.find(f => f.path === focusPath);
    if (sec) {
      const el = panel.querySelector(`#dc_sec_${sec.mod}`);
      el?.scrollIntoView?.({ block: 'nearest' });
      panel.querySelector(`[data-pf="${focusPath}"]`)?.focus();
    }
  }
}

/** 面板若正停在编辑步骤，重渲染一遍（分析完成 / 回写自动参数后调用）。
    ⚠ 只重渲染**面板内容**，不动 3D 容器、不动 `state.taskStep` ⇒ 相机与选中热结不受影响。
    草稿优先（`dlgValue` 先读 paramDraft），所以正在输入的值不会被这次刷新抹掉。 */
function refreshParamPanelIfOpen(container) {
  if (TASK_IS_EDIT(state.taskStep)) renderParamPanel(container, null);
}

/** 页脚提示随草稿实时更新（让用户随时看到"改了几项、还没保存"）
    —— 与浮层版**逐字同文**，只是宿主由 `.dc-dlg-hint` 换成 `#dc_taskHint`。 */
function refreshTaskFoot(container) {
  const panel = container.querySelector('#dc_taskPanel');
  const hint = panel?.querySelector('#dc_taskHint');
  if (!hint) return;
  const n = dlgDirtyCount();     // 149 §五：待恢复项也要计入，否则"改了却说没改"
  const issues = paramIssues(true);
  if (issues.length) { hint.textContent = tr('⚠️ 缺少必要条件时无法开始分析；请补全后再保存。'); }
  else {
    hint.textContent = n
      ? tr('有 {n} 项修改尚未保存 —— 点「保存」写入项目；已有结果会标记为过期，需点顶部 ④「分析」重新计算。', [n])
      : tr('同一参数被多个计算器共享，只需输入一次。点「保存」只写入参数，不执行分析；需要更新结果时点顶部 ④「分析」。');
  }
  /* 保存按钮的禁用只看**真实必要条件**（`paramIssues(true)` 读草稿）——
     与 146 §3.4 的既有判定同一口径，不新增任何门禁。 */
  const save = panel.querySelector('#dc_pfSave');
  if (save) save.disabled = issues.length > 0;
}
const canSaveDraft = () => true;

/* ============================================================
   149 §三：Mc 来源说明 —— **判据必须是 `hotspots.status`，不是 `hotspots.items` 有没有**。
   148-S0 §3.2 实测：原判据下 `LOW_CONFIDENCE` 显示成「来源：STL 热结检测（最大热结 H1）」、
   `INSUFFICIENT_RESOLUTION` 显示成「按主体壁厚 ÷ 2 估算」，**而这两态在 calcManifest 里是
   `return {blocked:true}`，根本不计算** —— 文字与真实计算路径相反。
   五态判定与文案统一由 `js/views/hsSourceNote.js`（纯函数，可单测）供给，
   本函数只做取值与渲染；**不重复实现任何计算规则**。
   ============================================================ */
function mcSourceNote() {
  const items = proj.getV('hotspots.items') || [];
  const info = hsSourceInfo({
    status: proj.getV('hotspots.status'),
    reasonText: hsReasonText(proj.getV('hotspots.reason')),
    itemCount: items.length,
    itemIds: items.map(h => h.id),
    mcHotspot: proj.get('process.mcHotspot'),
    wallHot: proj.get('process.wallHot'),
    picks: proj.getV('process.hsPick') || [],
    geomStatus: proj.getV('geometry.geomStatus'),
  });
  /* ⚠ 正文含 <b>（与结果页 mcSourceLine 同一口径）⇒ **不能整段 esc**。
     插入量只有两类，都安全：`fmt1`/计数出来的数字，以及 `statusText`/`hsReasonText`
     这两个固定枚举的 tr() 结果 —— 没有一处来自用户自由输入。（旧实现只 esc 主句、
     反而漏了后面那句 extra，口径本来就不统一。） */
  const cls = info.tone === 'bad' ? ' dc-dlg-note-bad' : info.tone === 'warn' ? ' dc-dlg-note-warn' : '';
  /* `data-mc-src-note` 是**行为钩子**（与 `data-pf` / `data-hs-pick-note` 同一约定）：
     这一段是"当前 Mc 从哪来"的唯一权威说明，自动化断言必须能精确取到它，
     而不是在一堆 `.dc-dlg-note` 里挑——帮助块里也含"主体壁厚 ÷ 2"这类字样，挑错了会误判。 */
  /* ⚠ 插值参数里**也有中文串**（`hsSourceNote.statusText()` 给的状态名，如「未检出热结」）。
     它们现在会被原样插进译文里 ⇒ 英文界面出现"英文字句里夹中文"。
     `hsSourceNote.js` 是**纯模块**（零依赖、可单测），不能让它 import i18n；
     所以在这里把字符串型参数**再过一次 tr()**（查不到就原样返回，数值参数不受影响）。 */
  const tParam = (p) => (typeof p === 'string' ? tr(p) : p);
  const textHtml = tr(info.text, (info.params || []).map(tParam));
  const extraHtml = info.extra ? tr(info.extra, (info.extraParams || []).map(tParam)) : '';
  /* 155 §5：STL 自动值的“未验证”长句属于 P2 说明，折进同一来源行的详细信息；
     阻断态（P0）和主体壁厚兜底的原因仍全部可见，不藏工程依据。 */
  const foldExtra = info.kind === 'stl' && !info.blocked && !!extraHtml;
  return `<div class="dc-dlg-note${cls}" data-mc-src-note
    data-mc-src-kind="${esc(info.kind)}" data-mc-src-blocked="${info.blocked ? '1' : '0'}">${textHtml}${extraHtml && !foldExtra ? ' ' + extraHtml : ''}
    ${foldExtra ? `<details class="dc-dlg-help"><summary>${tr('来源与复核说明')}</summary><div class="dc-dlg-help-body">${extraHtml}</div></details>` : ''}
  </div>`;
}

/* ============================================================
   149 §二：恢复的旧版帮助内容（**全部来自既有资源，未新编任何工程规则**）
   ── 逐块出处 ──────────────────────────────────────────────
   · 来源图例 / 参数共享说明 / Ho·ph 兜底说明 / 结果页指路 → v1.1.0 设计中心参数区原文
     （`git show HEAD:js/views/designCenter.js`），i18n 词条仍在 `en-US.js` 里
   · 浇注比例适用范围 `RATIO_APPLIC` + 「浇注比例怎么选？」→ 独立计算器 `gatingView.js`（**直接 import，不抄一份**）
   · Mc 的四种估法 → 独立「冒口设计」计算器的 `r_ mc_mode` 四个选项
   · 冒口补缩效率 → `calcs/riser.js` 的 `RISER_EFF`（**读表，不在 UI 里硬编码百分比**）
   · 排气规则 → `gatingView.js` 排气区 title 原文（1.5~4 倍 S直 / 3~10mm / 方片 ≤ 铸件壁厚）
   · 浇注系统工程原则五条 → `gatingView.js` 的 `ENG_NOTES`（**直接 import**）
   ============================================================ */

/** 冒口形状：公式 + 该形状的补缩效率参考值（149 §二.3）
 *  S2.2-A：`shapeKey` 可以是**草稿值**（尚未保存）。此时帮助文案必须按草稿形状显示，
 *  并额外说明"结果还没按它重算"——否则用户会误以为切换已经影响结果。 */
function shapeNoteHtml(shapeKey) {
  const k = RISER_SHAPES[shapeKey] || shapeKey === 'insulated' ? shapeKey : 'cyl';
  const savedKey = proj.getV('process.riserShape') || 'cyl';
  const pending = k !== savedKey;
  const nameOf = (key) => key === 'insulated'
    ? tr('发热/保温冒口（经验估算）')
    : tr((RISER_SHAPES[key] || RISER_SHAPES.cyl).name);
  /* S6（160.txt §三.S6）：冒口形状下不再重复公式/补缩效率长说明；
     只保留“草稿尚未保存”这一操作结果提示（否则用户会以为切换已影响结果）。 */
  return pending
    ? `<div class="dc-dlg-note dc-dlg-note-warn" data-shape-pending>${tr('草稿尚未保存：当前结果仍按已保存的「{saved}」计算；点「保存」写入后，再点顶部 ④「分析」才会按「{cur}」更新。', [nameOf(savedKey), nameOf(k)])}</div>`
    : '';
}

/** 「浇注比例怎么选？」+ 7 条适用范围（149 §二.2；正文与预设清单来自独立计算器同一份导出） */
function ratioHelpHtml() {
  const cur = proj.getV('process.ratioKey') || '';
  const rows = ratioHelpRows().map(r =>
    `<div class="dc-ratio-row"><b>${esc(r.key)}</b> · S直:S横:S内 = ${esc(r.ratio)}
      <div class="dc-ratio-applic">${tr('适用：')}${esc(r.applic)}${r.note ? `（${esc(r.note)}）` : ''}</div></div>`).join('');
  return `<details class="dc-dlg-help"><summary>ⓘ ${tr('浇注比例怎么选？')}</summary>
    <div class="dc-dlg-help-body">
      <div class="dc-dlg-note">${tr(RATIO_HELP_INTRO)}</div>
      <div class="dc-dlg-note">${tr(RATIO_HELP_AUTO)}</div>
      ${cur ? `<div class="dc-dlg-note">${tr('当前采用「{k}」：{a}', [tr(cur), esc(RATIO_APPLIC[cur] || '—')])}</div>` : ''}
      <div class="dc-dlg-help-sub">${tr('预设一览')}</div>
      ${rows}
      <div class="dc-dlg-help-tip">${tr(RATIO_HELP_TIP)}</div>
    </div></details>`;
}

/**
 * 浇注方向示意图（149 §二.1）——**接回 v1.1.0 的调用点**，图本身零改动：
 *   `gatingDiagramSvg(pos)`（`js/views/gatingDiagram.js`，PHASE 45 用户逐轮审到 v8 的正式版）
 *   + 既有 CSS `.dc-gating-diagram`（`app.css`）。
 *   三态随「浇注位置」下拉即时切换；Ho/ph/rh 的含义由图形自带的三行图注解释（`diag.ho/ph/rh`）。
 * ⚠ 它渲染在参数窗口内，**与 `#dc_view3dBox` 没有任何关系** ——
 *   146 §五 那条"按钮不能放进 OrbitControls 的 domElement"的红线天然不触及（§二.1）。
 */
function gatingDiagramHtml(pos) {
  const svg = gatingDiagramSvg(pos) || '';
  if (!svg) return '';
  return `<div class="dc-gating-diagram-wrap">
    <div class="dc-dlg-help-sub">${tr('浇注方向示意图')} <span class="chip">${tr('Ho / ph / rh 的含义见图')}</span></div>
    <div class="dc-gating-diagram">${svg}</div>
  </div>`;
}

/**
 * 「↺ 恢复自动原值」的**状态行**（149 §五）——入口按钮本身在来源徽章旁边
 * （`srcTagHtml(…, {restorePath})`，v1.1.0 的位置），这里只在**已点了 ↺、尚未保存**时
 * 显示一句明确的状态 + 一个撤销，避免"点了没反应"和"以为已经改了"。
 * 没有可恢复原值时本函数返回空串 ⇒ 屏幕上不会出现任何假入口（§五.1 / §四末条）。
 */
function restoreRowHtml(path) {
  if (!restorePending(path)) return '';
  const p = proj.get(path);
  const ovTxt = p?.orig ? (Array.isArray(p.orig.v) ? p.orig.v.join('×') : fmt(p.orig.v, 2)) : '—';
  return `<div class="dc-dlg-note dc-restore-pending">↺ ${tr('已标记：保存后恢复为自动原值 {v}（数值、来源、置信度一并还原；现在还没写进项目）', [ovTxt])}
    <button type="button" class="dc-restore-undo" data-undo-restore="${esc(path)}">${tr('撤销')}</button></div>`;
}

/**
 * 热结勾选 + **逐项 Mc 编辑**（149 §四；v1.1.0 的「✎ 改 Mc」在 146 轮被删，本轮按 149 恢复）。
 * 语义与约束：
 *   · 每行 = ID（H1/H2…）+ **检出模数** + 区域体积 + 置信度 + 该热结自己的「冒口设计 Mc」输入框；
 *   · 编辑只改**这一行**对应的 `hsPick` 元素（id 绑定，不碰其他热结）；
 *   · 写入的是**草稿**（§七：保存前项目不变），点「保存」才落盘；
 *   · 勾选/取消勾选的既有语义**一字未改**（勾选 = 该热结参与冒口设计）；
 *   · `calcManifest` 的多热结优先级与计算路径**没有任何改动**（§四末二条）——
 *     这里只是恢复"把值填进去"的入口，`picks.length ? … : …` 那一整套判定原样不动。
 */
function hotspotPickHtml() {
  const items = proj.getV('hotspots.items') || [];
  if (!items.length) return '';
  const picks = dlgValue({ path: 'process.hsPick' }) || [];
  const rows = items.map((h, i) => {
    const pick = picks.find(p => p.id === h.id);
    const on = !!pick;
    const det = h.mc;
    const mc = on ? pick.mc : det;
    const changed = on && Math.abs(mc - det) > 1e-9;
    return `<div class="dc-hsp${on ? ' on' : ''}">
      <label class="dc-hsp-main">
        <input type="checkbox" data-dlg-hs="${h.id}" ${on ? 'checked' : ''}>
        <span class="dc-hsp-id">H${i + 1}</span>
        <span class="dc-hsp-sub">${tr('检出模数')} <b>${fmt(det, 1)}</b> mm
          · ${tr('区域')} ${fmt(h.regionVolumeCm3, 1)} cm³${h.confidence ? ` · ${tr('置信度')} ${Math.round(h.confidence * 100)}%` : ''}</span>
      </label>
      <span class="dc-hsp-edit">
        <span class="dc-hsp-editlabel">✎ ${tr('冒口设计 Mc')}</span>
        <input type="number" step="any" min="0.1" class="field-input dc-hsp-mc" data-dlg-hs-mc="${h.id}"
          value="${esc(on ? String(mc) : '')}" placeholder="${esc(fmt(det, 1))}" ${on ? '' : 'disabled'}
          title="${esc(tr('只改热结 H{n} 的冒口设计模数，不影响其他热结', [i + 1]))}">
        <span class="f-unit">mm</span>
        ${changed ? `<button type="button" class="dc-hsp-reset" data-dlg-hs-mc-reset="${h.id}"
          title="${esc(tr('改回检出值 {v} mm', [fmt(det, 1)]))}">↺</button>` : ''}
      </span>
    </div>`;
  }).join('');
  return `<div class="dc-dlg-fld" style="grid-column:1/-1">
    <label>${tr('热结选择（多热结分别设计）')}</label>
    <div class="dc-hsp-list" style="display:flex;flex-direction:column;gap:4px">${rows}</div>
    <div class="dc-dlg-note" data-hs-pick-note>${hsPickNoteText(picks)}</div>
  </div>`;
}

/** 热结选择的当前状态说明（勾选变了 / Mc 改了都要跟着更新，但不重渲染整窗以免丢焦点） */
function hsPickNoteText(picks) {
  if (!picks.length) return tr('当前为自动模式：按主热结 H1 设计冒口。勾选热结可为选中的每一个分别设计。');
  const n = picks.length;
  const edited = picks.filter(p => {
    const det = (proj.getV('hotspots.items') || []).find(x => x.id === p.id)?.mc;
    return det != null && Math.abs(p.mc - det) > 1e-9;
  });
  return (n === 1
    ? tr('已选 1 个热结：冒口设计按该热结单独给出方案；未勾选的不计算。')
    : tr('已选 {n} 个热结：冒口设计将分别给出对应方案；未勾选的不计算。', [n]))
    + (edited.length
      ? ' ' + tr('其中 {n} 个的 Mc 已改（保存后按「用户修改」记账）。', [edited.length])
      : ' ' + tr('Mc 均为检出值。'));
}

/* ---------------- 保存（§3.4：这里才真正写入计算链；S4 起不分析） ----------------
   ⚠ 用户按的是**面板页脚**的「💾 保存」。保存后**面板不关**（工作台里"保存完接着核对
   下一项"是常态）——草稿被终结，页脚提示回到"没有未保存修改"；流程条 ④ 随
   `markChangedStale` 变 !，但**不会**自动重算。完整分析只由顶部 ④「分析」执行。 */
function saveParamDraft(container, opts = {}) {
  const draft = state.paramDraft || {};
  const paths = Object.keys(draft);
  const restorePaths = [...(state.draftRestore || [])];
  /* 155 §七：保存与分析彻底分离。没有实际修改时不得把全部结果误标为过期
     （旧实现 `markChangedStale([])` 会走 `markAllStale()` 兜底，点一次空保存就把结果全标脏）。 */
  if (!paths.length && !restorePaths.length) {
    showToast(tr('参数未发生变化'));
    return true;
  }
  // 单位必须**最先**应用：writeGeometryToProject 会把 geometry.* 全部按新单位重写，
  //   若先写别的参数再改单位，中间态会短暂错位（并可能被 refreshWeight 写坏重量）。
  const unitChanged = paths.includes('geometry.unit');
  const applyOne = (path) => {
    const v = draft[path];
    if (path === 'geometry.unit') { state.unit = v; writeGeometryToProject(); return; }
    if (path === 'material.family') {
      proj.set('material.family', v, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      applyFamilyDefaults(v);          // 按材料带出密度/出品率（用户显式改过的不覆盖）
      return;
    }
    /* 149 §六：热结选择统一写 `USER_INPUT`（与左栏热结列表、与 v1.1.0 完全同一口径）。
       依据现有枚举的定义判定，不是为了一致而一致：
         · `USER_INPUT`   = 用户直接输入
         · `USER_OVERRIDE` = **用户修改了自动值**
       `process.hsPick` 没有任何自动写入口（默认 `[]` = 按主热结 H1 的自动模式），
       不存在"被覆盖掉的自动值"；而 `set()` 也只在原来源是 STL/DERIVED 时才固化 `orig`，
       所以标成 `USER_OVERRIDE` 既与事实不符，又会在图例里承诺一个
       `restoreAutoValue()` 兑现不了的 ↺（它要求 `p.orig` 存在）。
       此处**没有丢失任何真实区别** —— 对这个参数而言那个区别本来就不存在。 */
    if (path === 'process.hsPick') { proj.set(path, v, SRC.USER_INPUT, CONF.USER_CONFIRMED); return; }
    // 其余：proj.set 自带来源判定（自动值 → USER_OVERRIDE 并固化 orig，供「↺ 恢复」）
    proj.set(path, v);
  };
  /* 149 §五.2/§五.5：恢复走的是 `CastingProject.restoreAutoValue()` ——
     它把 **v + src + conf 三件一起**还原并清掉 orig 基准，**不是"把数字改回去"**。
     未通过该函数（返回 false，例如中途 orig 已被清）时**如实反映**：不静默假装成功。 */
  let restored = 0, restoreFailed = [];
  /* S2.2-E：保存失败**不得**清掉草稿、更不得触发分析。
     `proj.set` 正常情况下不会抛；这里仍显式兜底，避免"界面上看似已保存、实际上只写了一半"
     被当成已保存状态继续用。部分写入无法自动回滚 ⇒ 提示里明确说"可能已部分写入"。 */
  let saveError = null;
  try {
    for (const path of restorePaths) {
      if (proj.restoreAutoValue(path)) restored++;
      else restoreFailed.push(path);
    }
    if (unitChanged) applyOne('geometry.unit');
    for (const path of paths) if (path !== 'geometry.unit') applyOne(path);
    // 毛坯重量被用户改过 → 净重保持派生；此处只刷新净重（refreshWeight 不会覆盖 USER_OVERRIDE 的毛坯重）
    proj.refreshWeight();
  } catch (e) {
    saveError = e;
    console.error('saveParamDraft 保存失败:', e);
  }
  if (saveError) {
    renderParamPanel(container, null);   // 草稿仍在 ⇒ 重新渲染必须显示草稿值
    showToast(tr('❌ 保存失败：{e}。未保存的修改仍保留在草稿中（可能已有部分字段写入，请核对后再试）。', [saveError.message || tr('未知错误')]));
    return false;
  }

  clearParamDraft();
  // §3.4：参数发生影响结果的变化 → 已有结果标记过期（恢复同样改变了送进计算的输入）
  markChangedStale([...paths, ...restorePaths]);
  renderOverview(container);
  renderHotspotList(container);
  renderStateChip(container);     // 保存后立即显示“结果已过期”，不等下一次分析
  syncFlowChrome(container);
  /* 面板**保持打开**：重渲染一遍 ⇒ 来源徽章/↺ 入口/热结行/页脚提示全部切到"已保存"的真实状态
     （不是靠改文案假装同步）。这样"改 → 存 → 看徽章变没变"是同一个界面里完成的。 */
  renderParamPanel(container, null);
  const nAll = paths.length + restorePaths.length;
  const savedMsg = restoreFailed.length
    ? tr('⚠️ 有 {n} 项未能恢复为自动值（原值记录已失效），其余修改已保存', [restoreFailed.length])
    : restored
      ? tr('💾 已保存 {n} 项参数（其中 {r} 项恢复为自动值）', [nAll, restored])
      : tr('💾 已保存 {n} 项参数', [nAll]);
  /* 155 §七：**保存只写参数，不触发任何分析**。保存后只把旧结果标为过期，
     完整分析由顶部第 ④ 项「分析」显式执行。 */
  showToast(opts.fromAnalysis
    ? savedMsg + tr('；正在按新参数分析…')
    : savedMsg + (state.results
      ? tr('；结果已标记为过期，请点顶部 ④「分析」更新')
      : tr('；点顶部 ④「分析」开始完整分析')));
  return true;
}

/** §3.4：把**确实影响结果的**已保存参数对应的模块标记为过期。
 *  依赖关系读 `PARAM_OWNERS`（由 calcManifest 的 requiredInputs/optionalInputs 建表）。
 *  ⚠ 有参数**没有登记归属**（典型：`geometry.unit` —— 它通过重写 geometry.* 影响一切），
 *    此时保守地把全部已完成模块标为过期；宁可多标，不可漏标（漏标 = 旧结果冒充当前结果）。 */
function markChangedStale(paths) {
  if (!state.results) return;
  let any = false;
  for (const p of paths) {
    for (const id of PARAM_OWNERS.get(p) || []) {
      if (state.results[id]) { state.stale.add(id); any = true; }
    }
  }
  if (!any) markAllStale();
}

/** 把"进入结果视图"收敛成一个入口（§五：主操作明确；§六：不重复添加同功能按钮） */
function revealResults(container) {
  /* §3.4：带着未保存草稿进结果页 = 用户会看着"旧参数算出来的结果"以为已经改过了。
     这里明确问一次**而不是**静默丢弃、也不静默保存。 */
  if (dlgDirty()) {
    const n = dlgDirtyCount();
    if (window.confirm(tr('有 {n} 项参数修改尚未保存。\n\n「确定」= 先保存这些修改，再进入结果页（当前结果会标记为过期，需点 ④「分析」更新）\n「取消」= 直接查看（结果仍是按已保存的参数算出来的）', [n]))) {
      saveParamDraft(container);
    } else {
      showToast(tr('⚠️ 结果按已保存的参数给出（还有 {n} 项修改没保存）', [n]));
    }
  }
  state.resultsViewed = true;
  setWorkspaceView(container, 'results');
}

/** 第一条未保存的修改落在哪个参数上（用于"把人带回能改它的那一步"） */
function firstDirtyPath() {
  const p = state.paramDraft ? Object.keys(state.paramDraft)[0] : null;
  if (p) return p;
  return state.draftRestore ? ([...state.draftRestore][0] || null) : null;
}

/** 「开始 / 重新分析」——**真正执行分析**的那一步（前置检查齐全后再进 runAnalysis）。
    流程条 ④ 节点与主按钮的"重新分析"分支都走它。
    §3.4：分析只吃**已保存**的参数（R4 起就成立的语义）。有草稿时**不静默用旧值算**，
    也不静默替用户保存 —— 明确说清楚，并把人带回能改它的那一步。 */
function startAnalysis(container, opts = {}) {
  if (state.busy) return;
  /* S5-03：合并后的入口在“结果当前有效”时只做“查看”，**不重复跑同一份分析**。
     结果过期/无结果才走下面的完整分析。
     `force`：结果视图里主按钮明确写的是「重新分析」，此时必须真的重跑（不是死按钮）。 */
  if (!opts.force && !dlgDirty() && state.results && state.lastRun?.ok === true && state.stale.size === 0) {
    setWorkspaceView(container, 'results');
    return;
  }
  /* 155 §七.2.7：有未保存修改时不得静默丢弃，也不得悄悄用旧参数算。
     用户点的是「分析并查看结果」——这里明确询问"先保存再分析"；确认后保存动作只是完成
     这次分析意图的前置步骤，不改变"保存按钮本身不触发分析"的契约。 */
  if (dlgDirty()) {
    const n = dlgDirtyCount();
    if (!window.confirm(tr('有 {n} 项参数修改尚未保存。\n\n「确定」= 先保存这些修改，再按新参数执行分析\n「取消」= 返回参数面板检查（不会丢弃修改）', [n]))) {
      openParamAt(container, firstDirtyPath());
      return;
    }
    if (!saveParamDraft(container, { fromAnalysis: true })) return;
  }
  if (!paramsReady()) { openParamAt(container, paramIssues()[0]?.path); return; }  // 参数待确认
  /* 参数有效 → 分析；**只有成功才切结果页**。失败时留在当前页面，
     旧结果由 runAnalysis 保留并标为过期（不伪装成最新结果）。 */
  const ok = runAnalysis(container, { keepScroll: state.wsView === 'results' });
  if (ok) setWorkspaceView(container, 'results');
}

/** 顶部**主按钮**：文案随真实状态变（syncFlowChrome），动作统一走 startAnalysis。
    S5-03：原「分析」与「结果」两个入口合并——startAnalysis 自己判断
    “结果当前有效就直接查看，否则分析并在成功后自动切结果页”。 */
function handleRunButton(container) {
  const st = workflowState();
  if (st === 'A') { container.querySelector('#dc_file').click(); return; }   // 未导入 STL
  if (st === 'C') return;                                                    // 计算中：按钮已 disabled
  /* 结果视图里按钮写的是「重新分析」→ 必须真的重跑；模型视图里「分析并查看结果」
     在结果有效时只切视图，不重复计算。 */
  const force = state.wsView === 'results' && !!state.results && state.stale.size === 0;
  startAnalysis(container, { force });
}

/* ============================================================
   R6 §3.2：**顶部流程导航**（5 个节点）
   ── 为什么单列一个函数 ────────────────────────────────────
   它的状态**必须能与真实状态对账**，而不是"点过就算完成"。判据全部取自既有函数：
     · `workflowState()`（131）—— A 未导入 / B 已导入未分析 / C 计算中 / D 完成 / E 失败
     · `paramIssues()`（真实必需项，逐条对应计算依赖）
     · `state.hotspots.status` + `process.mcHotspot` 的来源（热结分析到底可不可靠）
     · `state.stale` / `state.results`（结果是否与当前参数一致）
   §3.2 四条禁止，逐条对照：
     · 「不能仅根据按钮是否点击过就显示阶段完成」→ 本函数**不读任何『点过没』标志**
     · 「不能把"有 STL"误判为"全部参数已经确认"」→ ② 看 `paramIssues()`，不看 `state.mesh`
     · 「不能把"存在热结候选"误判为"热结检测可靠"」→ ③ 看 `status`，LOW_CONFIDENCE 判 blocked
     · 「不能把"分析请求已发起"误判为"分析已成功"」→ ④ 看 `state.results`，计算中单独一态
   返回 [{k, n, label, state, title, action}]：
     state ∈ 'todo'（未做）| 'warn'（需人工确认）| 'bad'（有错误/阻断）| 'busy' | 'ok' | 'lock'（前置未满足）
   ============================================================ */
function flowSteps() {
  const st = workflowState();
  const issues = paramIssues();
  const hs = state.hotspots;
  const hsStatus = hs?.status || 'none';
  const geomInvalid = proj.getV('geometry.geomStatus') === 'INVALID';
  const mcP = proj.get('process.mcHotspot');
  const userMc = !!mcP && (mcP.src === SRC.USER_OVERRIDE || mcP.src === SRC.USER_INPUT) && mcP.v > 0;
  const picks = (proj.getV('process.hsPick') || []).filter(p => p && p.mc > 0);
  const hasStl = !!state.mesh;
  const hasResults = !!state.results;
  const stale = state.stale.size > 0 && hasResults;
  /* 自动冒口被门禁阻止（与 calcManifest 同一判据：这两态下没有用户 Mc 就 blocked） */
  const autoRiserBlocked = hasStl && !userMc && !picks.length
    && (hsStatus === HS_STATUS.LOW_CONFIDENCE || hsStatus === HS_STATUS.INSUFFICIENT_RESOLUTION);

  const S = (k, n, label, state, title, action) => ({ k, n, label, state, title, action });

  const step1 = geomInvalid
    ? S('model', '①', tr('模型'), 'bad', tr('网格校验为 INVALID：几何不可信，自动建议一律不可用'), 'model')
    : !hasStl
      ? S('model', '①', tr('模型'), 'todo', tr('尚未导入 STL 模型'), 'model')
      : S('model', '①', tr('模型'), 'ok', tr('模型已导入并完成几何与热结分析'), 'model');

  const step2 = !hasStl
    ? S('cond', '②', tr('分析条件'), 'lock', tr('先导入模型才能确认分析条件'), null)
    : issues.length
      ? S('cond', '②', tr('分析条件'), 'bad', tr('缺少必要条件：{r}', [issues.map(i => i.msg).join('；')]), 'cond')
      : S('cond', '②', tr('分析条件'), 'ok', tr('分析条件已满足（材料大类 / 毛坯重量）'), 'cond');

  const step3 = !hasStl
    ? S('param', '③', tr('工艺参数'), 'lock', tr('先导入模型才能编辑工艺参数'), null)
    : issues.length
      /* ⚠ 状态是 `lock`（真实状态：现在算不了），但**动作保留** ——
         ③ 里仍有可看可改的字段（冒口形状/热结选择/RH/浇注方向都不依赖材料大类），
         把它做成"点不进去"，用户就只能干等着猜 ② 缺了什么。
         真正的门禁在**保存**上：`paramIssues()` 非空时页脚「保存」是禁用的，
         所以"点得进去"不会放出任何非法状态。 */
      ? S('param', '③', tr('工艺参数'), 'lock', tr('还缺分析条件（见 ②）：可以先看和改工艺参数，但保存/分析要等条件补齐'), 'param')
      : autoRiserBlocked
        ? S('param', '③', tr('工艺参数'), 'bad', tr('热结分析未给出可靠结果：自动冒口建议已被阻止，请在冒口设计里人工填写 Mc'), 'param')
        : geomInvalid
          ? S('param', '③', tr('工艺参数'), 'bad', tr('网格 INVALID ⇒ 硬阻断，参数再全也不会给出自动建议'), 'param')
          : (hsStatus === HS_STATUS.OK && !userMc && !picks.length)
            ? S('param', '③', tr('工艺参数'), 'warn', tr('自动 Mc 为未经确认的估算值，建议核对热节壁厚后确认'), 'param')
            : S('param', '③', tr('工艺参数'), 'ok', tr('工艺参数可用；有默认值的项可保持默认'), 'param');

  /* S5-03：原「④ 分析」与「⑤ 结果」合并为一个入口「分析并查看结果」。
     点击后：参数有效且结果未过期 → 直接查看现有结果（不重复跑分析）；
     无结果/已过期 → 执行分析，成功后自动切到结果视图；失败则留在当前页面。 */
  const step4 = st === 'C'
    ? S('run', '④', tr('分析并查看结果'), 'busy', tr('正在计算…'), null)
    : (state.lastRun && state.lastRun.ok === false)
      ? S('run', '④', tr('分析并查看结果'), 'bad', tr('上次分析未完成：{r}', [state.lastRun.reason]), 'run')
      : !hasResults
        ? S('run', '④', tr('分析并查看结果'), 'todo', tr('尚未运行工艺分析'), 'run')
        : stale
          ? S('run', '④', tr('分析并查看结果'), 'warn', tr('参数已修改，当前结果已过期，需要重新分析'), 'run')
          : S('run', '④', tr('分析并查看结果'), 'ok', tr('分析完成，结果与当前参数一致；点击查看结果'), 'run');

  return [step1, step2, step3, step4];
}

/** 流程条状态点文案（**不靠颜色单独表意**：每个点都带文字 title） */
const FLOW_MARK = { ok: '✓', warn: '!', bad: '✕', busy: '⋯', todo: '○', lock: '🔒' };

/** 渲染流程条（唯一写入口；状态全部来自 flowSteps()） */
function renderFlowBar(container) {
  const bar = container.querySelector('#dc_flowbar');
  if (!bar) return;
  const cur = currentFlowKey();
  bar.innerHTML = flowSteps().map((s, i) => `
    ${i ? `<span class="dc-flow-sep" aria-hidden="true">›</span>` : ''}
    <button type="button" class="dc-flow-node${s.k === cur ? ' on' : ''}" data-flow-step="${s.k}"
      data-state="${s.state}" ${s.action ? '' : 'aria-disabled="true"'}
      title="${esc(s.title)}">
      <span class="dc-flow-n">${s.n}</span>
      <span class="dc-flow-label">${esc(s.label)}</span>
      <span class="dc-flow-mark" data-mark="${s.state}">${FLOW_MARK[s.state] || '○'}</span>
    </button>`).join('');
}

/** 当前"处在哪一步"——只用于**高亮**，不参与任何状态判定（判定见 flowSteps） */
function currentFlowKey() {
  if (state.wsView === 'results') return 'run';   // S5-03：结果视图高亮合并后的 ④
  if (state.taskStep === 'model') return 'model';
  if (state.taskStep === 'cond') return 'cond';
  if (state.taskStep === 'param') return 'param';
  if (state.busy || (state.lastRun && state.lastRun.ok === false)) return 'run';
  if (state.results) return 'run';   // S5-03：结果节点已并入 ④「分析并查看结果」
  return state.mesh ? 'model' : 'model';
}

/* ============================================================
   R6 §3.3：右侧**按需任务面板**
   打开/关闭/换步骤**只改 `state.taskStep` + `data-task`** ⇒
     · 三维容器不动（不重建、不 dispose）⇒ 相机/选中热结/指针捕获状态一律保留
     · 宽度变化由 #dc_view3dBox 上的 ResizeObserver 驱动画布跟随（144 D1 既有机制）
   ============================================================ */
/* 面板步骤 → 标题。S2 起有四种真实内容，不是四个装饰性 tab：
     model = 概览 + 热结列表（只读参考）
     cond  = A 分析条件（4 个可编辑 + 5 个只读）
     param = 工艺设计：冒口设计 / 浇注系统设计（子模块切换） */
const TASK_TITLE = {
  model: '模型与几何信息',
  cond: '分析条件',
  param: '工艺参数',
};
const TASK_IS_EDIT = (step) => step === 'cond' || step === 'param';

function openTaskPanel(container, step) {
  if (!TASK_TITLE[step]) return;      // 未注册的步骤
  state.taskStep = step;
  syncTaskPanel(container);
  if (TASK_IS_EDIT(step)) renderParamPanel(container, null);
}

function closeTaskPanel(container) {
  /* 带未保存草稿时，关面板**必须**先问（§3.4 不静默丢失）——
     与 ② / ③ 的页脚「取消」走同一条确认路径。
     R6-S3：判断不能再看 `TASK_IS_EDIT(state.taskStep)` —— 用户可以从编辑步骤切到
     ① 模型信息（草稿仍在 `state.paramDraft`，面板这时不是编辑步骤），再点 ✕。
     旧实现会跳过确认并把草稿留成永久幽灵。 */
  if (dlgDirty()) { requestCloseParamPanel(container); return; }
  if (TASK_IS_EDIT(state.taskStep)) clearParamDraft();
  state.taskStep = null;
  syncTaskPanel(container);
}

/** 面板显隐的**唯一同步点**（与 `data-task` 一一对应，避免两处口径）
    S2 起它还负责：步骤容器互斥、编辑页脚显隐、子模块切换按钮的显示。 */
function syncTaskPanel(container) {
  const ws = container.querySelector('#dc_ws');
  const panel = container.querySelector('#dc_taskPanel');
  const title = container.querySelector('#dc_taskTitle');
  const body = container.querySelector('#dc_taskBody');
  if (!ws || !panel) return;
  const step = state.taskStep;
  const open = !!step;
  const edit = TASK_IS_EDIT(step);
  ws.dataset.task = open ? 'open' : 'closed';
  panel.hidden = !open;
  if (title) title.textContent = open ? tr(TASK_TITLE[step] || '') : '';
  /* 三个步骤容器**互斥**：改 `hidden` 的只有这三个 wrapper。
     `#dc_overviewCard` / `#dc_hotspotsCard` 的 hidden 归 renderOverview / renderHotspotList 所有，
     面板一律不碰——否则"没有热结数据"与"当前不在①"两种原因会互相覆盖。 */
  if (body) body.dataset.step = open ? step : 'model';
  const set = (sel, on) => { const el = container.querySelector(sel); if (el) el.hidden = !on; };
  set('#dc_modelStep', step === 'model');
  set('#dc_condStep', step === 'cond');
  set('#dc_paramStep', step === 'param');
  set('#dc_taskFoot', edit);
  /* ⚠ 结果视图下面板由 CSS 整体隐藏（`.dc-ws[data-wsview="results"] .dc-taskp{display:none}`），
     但 `state.taskStep` 与草稿**都保留**：切回模型视图时面板原样回来，用户填了一半的值不会丢。
     进结果页前若真有未保存修改，`revealResults()` 已经明确问过一次并说清了用哪套参数算。 */
  renderFlowBar(container);
}

/* ============================================================
   146.txt §4.1：**顶部主按钮就是流程引导**（独立的「设计步骤」内容块已删除）
   按钮文案与动作由**真实状态**决定，示例映射逐条落地：
     未导入 STL        → 「📥 选择 STL 文件」  → 打开文件选择
     已导入·参数待确认  → 「⚙️ 确认工艺参数」  → 打开参数窗口并定位到缺失项
     参数有效·未分析    → 「▶ 开始工艺分析」  → 运行分析
     分析中            → 「⏳ 正在分析…」（禁用）
     分析完成          → 「📋 分析并查看结果」→ 直接查看（有效结果不重跑）
     分析失败/条件不足  → 「🔁 重新分析」或先修参数
   ⚠ 「参数是否满足」只看 paramIssues()（逐条对应真实计算依赖），**不看任何 UI 标记**。
   ============================================================ */
function syncFlowChrome(container) {
  const st = workflowState();
  const ws = container.querySelector('#dc_ws');
  if (ws) ws.dataset.flow = st;
  const btn = container.querySelector('#dc_run');
  const taskBtn = container.querySelector('#dc_taskToggle');   // R6：面板开合（替代原 #dc_railToggle）
  const pBtn = container.querySelector('#dc_paramsBtn');
  const ready = paramsReady();
  if (btn) {
    /* S5-03：顶部只保留**一个**操作入口（原「分析」+「结果」已合并）。
       · 模型视图、结果当前有效 → 点击直接查看现有结果（不重复跑分析）；
       · 无结果/结果过期 → 点击执行分析，成功后自动切结果页；
       · 已在结果视图且结果有效 → 按钮表示“重新分析”（显式重跑，仍是同一个入口）。 */
    const inResults = state.wsView === 'results';
    const stale = state.stale.size > 0 && !!state.results;
    const cfg = {
      A: { t: `📥 ${tr('选择 STL 文件')}`, dis: false },
      // B = 已导入未分析：参数没配齐时，主按钮的动作**就是**去配参数（§4.1）
      B: ready ? { t: `▶ ${tr('分析并查看结果')}`, dis: false } : { t: `⚙️ ${tr('确认工艺参数')}`, dis: false },
      C: { t: `⏳ ${tr('正在分析…')}`, dis: true },
      D: inResults
        ? { t: stale ? `🔁 ${tr('重新分析并查看结果')}` : `🔁 ${tr('重新分析')}`, dis: false }
        : stale
          ? { t: `🔁 ${tr('重新分析并查看结果')}`, dis: false }
          : { t: `📋 ${tr('分析并查看结果')}`, dis: false },
      E: ready ? { t: `🔁 ${tr('重新分析并查看结果')}`, dis: false } : { t: `⚙️ ${tr('修正工艺参数')}`, dis: false },
    }[st];
    btn.textContent = cfg.t;
    btn.disabled = cfg.dis;
  }
  // 参数窗口入口：有 STL 才出现（没有模型时窗口里没有可看的内容）
  if (pBtn) pBtn.hidden = !state.mesh;
  // R6 §3.1：面板开关 —— 有 STL 才出现（没模型时面板里没有内容）；
  //   面板**默认收起** ⇒ 这个按钮是桌面端唯一常驻入口，文字随开合变化
  if (taskBtn) {
    taskBtn.hidden = !state.mesh;
    const onModel = state.taskStep === 'model';
    taskBtn.textContent = onModel ? '🧩 ' + tr('收起模型信息') : '🧩 ' + tr('模型信息');
    taskBtn.classList.toggle('on', onModel);
  }
  /* 顶部「分析条件与工艺参数」按钮：**只在参数没配齐、或用户明确要改参数时才需要**。
     它打开的是面板的编辑步骤（缺什么停在哪一步），不再是浮层窗口。 */
  if (pBtn) pBtn.classList.toggle('on', TASK_IS_EDIT(state.taskStep));
  // 流程条与面板：所有状态变化都经由这里刷新（唯一显示位，避免两处口径不一致）
  syncTaskPanel(container);   // 内部会一并 renderFlowBar（面板高亮属于流程条的一部分）
  renderStateChip(container);
}

/* ================= 144.txt §五：工作台内视图切换（不允许页面滚动跳转） =================
   'model'   = 左栏信息 + 中央三维
   'results' = 结果工作区（占满 .dc-body，内部滚动）
   切换只改 `data-wsview`，两个区域都在 DOM 里 ⇒ 3D 画布不被销毁、结果不被重算。 */
function setWorkspaceView(container, v, opts = {}) {
  const ws = container.querySelector('#dc_ws');
  if (!ws) return;
  const box = container.querySelector('#dc_results');
  if (v === 'results' && (!box || box.hidden)) {
    if (!opts.silent) showToast(tr('ℹ️ 尚未产生分析结果：请先填好参数并点击「开始工艺分析」'));
    return;
  }
  state.wsView = v;
  ws.dataset.wsview = v;
  if (v === 'results') state.resultsViewed = true;   // 145 §三：结果是否被查看过的真实判据
  if (v === 'results') {
    // 结果视图下左栏让位：三维被隐藏，画布尺寸归零会触发一次无谓 resize —— 由 ResizeObserver 自然处理
    container.querySelector('#dc_results')?.scrollTo?.({ top: 0 });
  }
  /* 145 §六：结果视图里主按钮必须切成「重新分析」——
     否则它就是"点了没新东西"的死按钮。视图切换即刷新一次外壳。 */
  syncFlowChrome(container);
}

/** 底部状态栏（§三.D / §六）：只显示**真实存在**的状态，全部带文字不靠颜色 */
function renderStatusBar(container) {
  const un = container.querySelector('#dc_unitChip');
  if (un) {
    // PHASE 87 修复保留：该文案有两个 {u}，数组插值按顺序替换，两个都要传。
    un.textContent = tr('单位：{u}（STL 无单位，按 {u} 计）', [state.unit, state.unit]);
  }
  const st = container.querySelector('#dc_stModel');
  if (st) {
    if (!state.mesh) { st.hidden = true; }
    else {
      const sl = state.hotspots?.sampling;
      const bad = sl?.warning && sl.level !== 'local_thin';
      st.hidden = false;
      st.textContent = bad ? tr('🟠 采样分辨率不足') : tr('🟢 模型已分析');
      st.className = 'chip dc-st-item' + (bad ? ' dc-chip-warn' : '');
    }
  }
  const hs = container.querySelector('#dc_stHotspot');
  if (hs) {
    const n = state.hotspots?.hotspots?.length || 0;
    if (!state.hotspots) { hs.hidden = true; }
    else {
      hs.hidden = false;
      hs.textContent = n ? tr('🔴 {n} 个热结', [n]) : tr('⚪ 未检出热结');
    }
  }
}

/* 144.txt §三.2：原「铸件信息卡」(.dc-cast-card) 已**删除**——它列的 文件名/尺寸/体积/毛坯重/
   壁厚/Mc/热结数/采样状态 与左栏 ① 分析结果概览**逐项重复**（规范明确要求消除重复卡片）。
   其中只有"文件名"是概览里没有的，已由工具栏的 #dc_fileName chip 承担；
   采样状态则进底部状态栏（#dc_stModel）与概览的「模型状态」格。 */

/** 分析结果概览卡（PHASE 22 · 30.txt 十五 ②）：热结数量/最大热结/主体壁厚/模型状态 */

function renderOverview(container) {
  const card = container.querySelector('#dc_overviewCard');
  if (!card) return;
  const hs = state.hotspots;
  if (!hs) { card.hidden = true; return; }
  const sl = hs.sampling;
  const chipCls = !sl?.warning ? 'chip-ok' : sl.level === 'local_thin' ? 'dc-chip-warn' : 'dc-chip-bad';
  const chipTxt = !sl?.warning ? tr('✅ 分析正常')
    : sl.level === 'local_thin' ? tr('🟡 局部薄特征')
    : sl.level === 'resolution' ? tr('🟠 采样分辨率不足')
    : tr('🔴 无法可靠分析');
  const n = hs.hotspots?.length || 0;
  const maxMc = n ? Math.max(...hs.hotspots.map(h => h.mc || 0)) : null;
  // PHASE 26：主体壁厚 = 可信链 bodyRef（V3 采样完成后含 tP50；之前 bodyWallOf）。
  //   不用 wallMain——其峰值检测失败时 fallback 到 wallMax，把最大壁厚误当主体壁厚
  //   （ALR2510：17.2 vs 真实 2-3mm，PHASE 25 审计实证）。
  const bodyWall = state.bodyRef != null ? state.bodyRef
    : (state.analysis ? bodyWallOf(state.analysis) : null);
  card.hidden = false;
  // PHASE 71.7（77.txt 一/四）：概览 = 模型信息枢纽。原「模型信息」面板内容并入此处；
  //   145 §三 起参数输入窗口已移除 ⇒ 这些值一律**只读展示**，不再指向任何"去修改"的入口。
  const a = state.analysis;
  const scale = UNIT_SCALE[state.unit];
  const pv = (path, d = 1, unit = '') => {
    const v = proj.getV(path);
    return (v === undefined || v === null || v === '' || v === 0) ? '—' : fmt(v, d) + (unit ? ' ' + unit : '');
  };
  const sizeTxt = a ? a.size.map(v => fmt(v * scale, 0)).join(' × ') + ' mm' : '—';
  const volTxt = a ? fmt(a.volume * scale ** 3 / 1000, 1) + ' cm³' : '—';
  const areaTxt = a ? fmt(a.area * scale ** 2 / 100, 0) + ' cm²' : '—';
  const mcShow = n ? maxMc : (proj.getV('process.wallHot') || null);
  // PHASE 78（78.txt 九）：信息分组 + 卡片化（原来 12 项平铺两列过于拥挤）——
  //   几何 / 重量与壁厚 / 分析结果 三组，每组一行卡片（宽屏 4 列，窄屏自动折行）
  const ovCard = (label, val) => `<div class="dc-ov-card"><span>${label}</span><b>${val}</b></div>`;
  container.querySelector('#dc_overview').innerHTML = `
    <div class="dc-ov-group">
      <div class="dc-ov-gtitle">📐 ${tr('几何')}</div>
      <div class="dc-ov-grid">
        ${ovCard(tr('外形尺寸'), sizeTxt)}
        ${ovCard(tr('体积'), volTxt)}
        ${ovCard(tr('表面积'), areaTxt)}
        ${ovCard(tr('三角面'), state.mesh ? tr('{n} 面', [state.mesh.triCount]) : '—')}
      </div>
    </div>
    <div class="dc-ov-group">
      <div class="dc-ov-gtitle">⚖️ ${tr('重量与壁厚')}</div>
      <div class="dc-ov-grid">
        ${ovCard(tr('主体壁厚'), bodyWall ? fmt(bodyWall, 1) + ' mm' : '—')}
        ${ovCard(tr('最大壁厚'), pv('geometry.wallMax', 1, 'mm'))}
        ${ovCard(tr('净重'), pv('geometry.netWeightKg', 2, 'kg'))}
        ${ovCard(tr('毛坯重'), pv('geometry.blankWeightKg', 2, 'kg'))}
      </div>
    </div>
    <div class="dc-ov-group">
      <div class="dc-ov-gtitle">🔥 ${tr('分析结果')}</div>
      <div class="dc-ov-grid">
        ${ovCard(tr('热结数量'), n ? tr('{n} 个', [n]) : (hs.status === HS_STATUS.NO_HOTSPOT ? tr('未检出') : '—'))}
        ${ovCard(tr('最大热结 Mc'), mcShow ? fmt(mcShow, 1) + ' mm' : '—')}
        ${ovCard(tr('模型状态'), `<span class="chip ${chipCls}">${chipTxt}</span>`)}
        ${ovCard(tr('网格校验'), (state.validation?.issues || []).some(i => i.level === 'error')
          ? `<span class="chip dc-chip-bad">${tr('有错误级问题')}</span>`
          : (state.validation?.issues || []).length ? `<span class="chip dc-chip-warn">${tr('有提示项')}</span>` : `<span class="chip chip-ok">${tr('通过')}</span>`)}
      </div>
    </div>
    <div class="field-hint" style="margin-top:8px">${tr('以上均由 STL 自动识别（本卡只读）。要改工艺参数请点顶部「分析条件与工艺参数」；单项计算请用独立计算器。')}</div>
    ${samplingDiagHtml()}`;
}

/** 结果页恢复（重渲染后：有结果 → 解除隐藏并重画；无结果 → 保持隐藏） */
function restoreResults(container) {
  const box = container.querySelector('#dc_results');
  if (!box) return;
  if (!state.results) {
    box.hidden = true;
    state.wsView = 'model';   // 144 §五：没有结果就不存在"结果工作区"这个视图
    setWorkspaceView(container, 'model', { silent: true });
    syncFlowChrome(container);
    return;
  }
  box.hidden = false;
  renderResults(container);
  setWorkspaceView(container, state.wsView, { silent: true });
}


/* ================= STL 删除（18.txt 三：删除 → 清全部 STL 绑定数据 → 手动模式） ================= */
function deleteStl(container) {
  if (!state.mesh && !proj.get('meta.stlSession')?.v?.fingerprint) return;
  // 1-10. 清项目 STL 绑定数据（geometry/hotspots/STL 派生/旧结果/会话绑定；USER_INPUT 保留）
  proj.clearStlBoundData();
  try { sessionStorage.removeItem(STL_FP_KEY); } catch (e) {}
  // 视图状态与 3D 全部释放
  state.mesh = null; state.geometry = null; state.analysis = null;
  state.hotspots = null; state.diag = null; state.results = null; state.bodyRef = null;
  state.fileName = null; state.hsFake = false; state.hsFakeReason = null;
  if (state.view3d) { state.view3d.dispose(); state.view3d = null; }
  state._view3dBox = null;
  // 11. 145 §三：手动输入模式已移除 ⇒ 退回"尚未导入"的空态（左栏回到三步引导）
  container.querySelector('#dc_importZone').hidden = false;
  container.querySelector('#dc_view3d').hidden = true;
  container.querySelector('#dc_validate').hidden = true;
  container.querySelector('#dc_replaceStl').hidden = true;
  container.querySelector('#dc_deleteStl').hidden = true;
  container.querySelector('#dc_stlStatus').hidden = true;
  state.wsView = 'model'; state.resultsViewed = false;
  closeParamPanel(container);   // 数据被整体清掉 ⇒ 草稿已无意义，不问直接终结
  restoreResults(container);
  renderOverview(container); renderHotspotList(container);
  syncFlowChrome(container); renderStatusBar(container);
  showToast(tr('🗑️ STL 已删除，请重新导入模型'));
}

/**
 * 创建并加载三维视图（170.txt §四.1/§四.4）。
 * 只有「构造成功 + load 成功」才返回实例；任一步失败都由本函数释放本次创建的对象，
 * 绝不把半初始化实例交给调用方。调用方成功后才把它登记为 state.view3d。
 * @param {HTMLElement} box 承载元素
 * @param {object} mesh 已解析 STL
 * @returns {ModelView3D}
 */
function buildView3D(box, mesh) {
  let inst = null;
  try {
    inst = new ModelView3D(box);
  } catch (err) {
    // 构造函数内部已自清理；此处无需也不应该调用 dispose（实例未返回）
    if (err && typeof err === 'object') err.dcViewStage = 'create';
    throw err;
  }
  try {
    inst.load(mesh);
    return inst;
  } catch (err) {
    if (err && typeof err === 'object') err.dcViewStage = 'load';
    try { inst.dispose(); } catch (cleanupErr) {
      console.error('三维视图失败回收异常:', cleanupErr);
    }
    throw err;
  }
}

/** 三维失败标题：区分「实例创建失败」与「实例创建成功但模型加载失败」 */
function viewErrorTitle(err) {
  return err?.dcViewStage === 'load' ? tr('三维模型加载失败') : tr('三维视图初始化失败');
}

/** 把三维失败写到既有 #dc_validate 区域（不新增弹窗/页面结构） */
function showViewFailure(container, title, err, hint) {
  const vEl = container.querySelector('#dc_validate');
  if (!vEl) return;
  vEl.hidden = false;
  vEl.innerHTML = `<div class="dc-warn">❌ <b>${esc(title)}</b><br>`
    + `<span class="field-hint">${esc(err?.message || String(err || ''))}</span><br>`
    + `<span class="field-hint">${esc(hint)}</span></div>`;
}

function restore(container) {
  syncFromContext();   // 146：重进视图时把生产场景里用户从未设过的项补齐（与原 renderParams 时机一致）
  closeParamPanel(container);   // 重进视图不保留上一轮的编辑会话（草稿也不跨次存活）
  container.querySelector('#dc_importZone').hidden = true;
  container.querySelector('#dc_fileName').hidden = false;
  container.querySelector('#dc_fileName').textContent = `📄 ${state.fileName}`;
  container.querySelector('#dc_replaceStl').hidden = false;
  container.querySelector('#dc_deleteStl').hidden = false;
  container.querySelector('#dc_stlStatus').hidden = true;
  const meta = container.querySelector('#dc_metaChip');
  if (meta && state.analysis) {
    meta.hidden = false;
    const n = state.mesh.triCount;
    meta.textContent = `${n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n} ${tr('面')} · ${state.analysis.size.map(v => fmt(v, 0)).join('×')} mm`;
  }
  container.querySelector('#dc_validate').hidden = false;
  container.querySelector('#dc_validate').innerHTML = validateHtml(state.validation);
  const box = container.querySelector('#dc_view3dBox');
  container.querySelector('#dc_view3d').hidden = false;
  /* PHASE V2.0-P1-01 · D1 · 风险 H2：**承载元素本身**必须比对，不能只搬 canvas。
     app.js 切视图会整块重写 #view 的 innerHTML（js/app.js:74），旧 #dc_view3dBox 连同 canvas
     一起消失，但模块级 state.view3d 仍活着。原来只做 box.appendChild(旧 canvas)：画布是搬进
     去了，可 ModelView3D.container / OrbitControls / pointer 监听 / ResizeObserver 仍指向
     **已脱离 DOM 的旧元素** ⇒ clientWidth=0（画布被压成 0），旋转、缩放、热结拾取全部失效。
     承载元素变了就销毁重建——照抄 inspectionCenter.js 的既有范式。 */
  /* 170.txt §四.4：**只有构造 + load 都成功后才登记为 state.view3d**。
     失败时 buildView3D 已回收本次实例；这里再保证不残留半初始化引用，并恢复导入入口。 */
  let viewError = null;
  try {
    if (state.view3d && state._view3dBox !== box) {
      const old = state.view3d;
      state.view3d = null;
      state._view3dBox = null;
      old.dispose();
    }
    if (!state.view3d) {
      const inst = buildView3D(box, state.mesh);
      state.view3d = inst;
      state._view3dBox = box;
    }
  } catch (err) {
    viewError = err;
    state.view3d = null;
    state._view3dBox = null;
    container.querySelector('#dc_view3d').hidden = true;
    container.querySelector('#dc_importZone').hidden = false;
    container.querySelector('#dc_replaceStl').hidden = false;
    container.querySelector('#dc_deleteStl').hidden = false;
    showViewFailure(container, viewErrorTitle(err), err,
      tr('请点击上方「导入 STL」重新选择文件；若反复失败请反馈（附上文件）。'));
  }
  // 恢复热结标记（Fake 已是居中坐标，直接显示；真实结果经 toViewHotspot：
  // 居中平移 + displayPosition 中面修正——计算坐标不变，PHASE 22）
  if (!viewError && state.view3d && state.hotspots?.status === HS_STATUS.OK && state.hotspots.hotspots.length) {
    state.view3d.onSelectHotspot = (i) => highlightHotspot(container, i);
    state.view3d.setHotspots(state.hsFake ? state.hotspots.hotspots : state.hotspots.hotspots.map(toViewHotspot));
  }
  // 恢复热结状态条（悬停可见算法各阶段计数）
  if (state.hotspots) updateHsBadge(container);
  renderOverview(container);
  renderHotspotList(container);
  restoreResults(container);
  syncFlowChrome(container);
}

/* ================= ① 导入 STL ================= */
async function importFile(container, file) {
  if (state.busy) return;
  state.busy = true;
  let stage = 'parse';   // parse → model → view → analysis（失败报告按真实阶段给标题）
  // 145 §三：状态 C —— 主按钮由 syncFlowChrome 统一接管（禁用 + "正在分析…"），不再各写各的
  syncFlowChrome(container);
  try {
    const buf = await file.arrayBuffer();
    const mesh = parseSTL(buf);            // 先解析：失败即抛 → 旧数据不受影响
    stage = 'model';
    // 替换语义（18.txt 一）：新 STL 解析成功后，先清理旧 STL 绑定数据
    // （geometry/hotspots/STL 派生参数/旧计算结果），再执行新 STL 分析——
    // 保证"STL B 的所有自动参数必须来自 B"。USER_INPUT 保留；USER_OVERRIDE
    // 按强绑定规则清（18.txt 二，新 STL 重新生成）。手动模式导入也走此路径。
    /* R6-S3（153.txt §七.5/§七.6）：RH 是**用户可指定**的浇注条件，不属于"新 STL 重新生成"的
       几何派生量。CastingProject.clearStlBoundData 现在保留两类用户来源；这里记下是否保留，
       分析结束后在 toast 里**显式提示复核**（不静默沿用旧模型的 RH）。 */
    const rhBeforeImport = proj.get('process.riserHeight');
    const manualRhKept = !!rhBeforeImport
      && (rhBeforeImport.src === SRC.USER_OVERRIDE || rhBeforeImport.src === SRC.USER_INPUT)
      && rhBeforeImport.v > 0;
    proj.clearStlBoundData();
    sessionStorage.removeItem(STL_FP_KEY);
    syncFromContext();   // 146：生产场景只补未设定项（材料/造型线/铸造方法），用户显式设过的不覆盖
    state.mesh = mesh;
    state.fileName = file.name;
    const validation = validateMesh(state.mesh);
    state.validation = validation;
    state.geometry = buildMesh(state.mesh).geometry;
    state.unit = 'mm';
    state.results = null;
    state.hsFake = false;          // 新导入重置调试标志（上次 Fake 不残留）
    state.hsFakeReason = null;

    // 3D 显示（居中坐标系，只负责显示）
    const box = container.querySelector('#dc_view3dBox');
    stage = 'view';
    if (state.view3d) {
      const old = state.view3d;
      state.view3d = null;
      state._view3dBox = null;
      try { old.dispose(); } catch (e) { console.error('旧三维视图释放异常:', e); }
    }
    container.querySelector('#dc_importZone').hidden = true;
    container.querySelector('#dc_view3d').hidden = false;
    container.querySelector('#dc_fileName').hidden = false;
    container.querySelector('#dc_fileName').textContent = `📄 ${file.name}`;
    /* 170.txt §四.4：构造 + load 成功后**才**登记 state.view3d。
       失败时 buildView3D 已回收本次实例，state 不会留下半初始化对象。 */
    const inst = buildView3D(box, state.mesh);
    state.view3d = inst;
    state._view3dBox = box;
    stage = 'analysis';

    // 验证结果展示（有 warning/error 不静默，允许继续）
    container.querySelector('#dc_validate').hidden = false;
    container.querySelector('#dc_validate').innerHTML = validateHtml(validation);

    // 145 §三：参数输入区已移除 ⇒ 导入提示改由左栏三步引导 + 三维区进度条承担
      syncFlowChrome(container);

    // PHASE 22 进度条：导入/检查阶段（真实快速步骤，完成后直接推进到距离场）
    progressStart(container, 'import');
    if (DEBUG_HS) window.__impStep = 'wait30';
    await new Promise(r => setTimeout(r, 30));   // 让 3D 先渲染一帧
    // 用 MessageChannel 让出（setTimeout 在后台/无头环境会被节流到 1Hz，分析将拖慢数十秒）
    const yieldFn = () => new Promise(r => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); r(); };
      ch.port2.postMessage(0);
    });
    progressTo(container, 'import', 1);
    progressTo(container, 'validate', 0.5);
    if (DEBUG_HS) window.__impStep = 'geom';
    // 几何分析（30.txt 十三：建立距离场/内部采样按真实分片进度报告）
    progressTo(container, 'dfScan', 0);
    const geomProgress = (phase, frac) => {
      if (phase === 'scan') progressTo(container, 'dfScan', frac);
      else progressTo(container, 'dfDist', frac);
    };
    state.analysis = await analyzeGeometrySliced(state.mesh, state.geometry, {}, yieldFn, geomProgress);
    if (DEBUG_HS) window.__impStep = 'geomDone';
    writeGeometryToProject();
    // 模型信息 chip（面数 · 尺寸，Cura 视口状态条同款信息层级）
    const meta = container.querySelector('#dc_metaChip');
    if (meta) {
      const a = state.analysis;
      meta.hidden = false;
      const n = state.mesh.triCount;
      meta.textContent = `${n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n} ${tr('面')} · ${a.size.map(v => fmt(v, 0)).join('×')} mm`;
    }
    // 热结分析（17.txt 十三：生产默认 V3 → Adapter → CastingProject；
    //   ?hsV2=1 开发对照 V2。PHASE 22：V3 分片执行 + 分阶段真实进度）
    if (DEBUG_HS) window.__impStep = 'hs';
    if (USE_V2) {
      progressIndeterminate(container, 'hsScan');   // V2 分片无进度回调 → 阶段 + 流动条
      state.hotspots = await analyzeHotspotsSliced(state.mesh, state.geometry, {}, yieldFn);
    } else {
      progressTo(container, 'hsScan', 0);
      const hsScan = monotonic(container, 'hsScan');
      const hsDist = monotonic(container, 'hsDist');
      const hsField = monotonic(container, 'hsField');
      const hsRefine = monotonic(container, 'hsRefine');
      const hsProgress = (phase, frac) => {
        if (phase === 'scan') hsScan(frac);
        else if (phase === 'dist') hsDist(frac);
        else if (phase === 'field') hsField(frac);
        else if (phase === 'refine') hsRefine(frac);
      };
      state.hotspots = toViewResult(await analyzeHotspotsV3Sliced(state.mesh, state.geometry, {}, yieldFn, hsProgress), {
        wallMax: state.analysis?.wallMax, wallMain: state.analysis?.wallMain, wallAvg: state.analysis?.wallAvg,
      });
      if (state.hotspots.sampling?.warning) showToast('⚠️ ' + tr(state.hotspots.sampling.detail));
    }
    if (DEBUG_HS) window.__impStep = 'hsDone';
    logHotspotDebug(state.hotspots);                 // 调试模式：分层输出（第六阶段）
    // STL 会话绑定（18.txt 四：会话指纹标记"当前 STL"；刷新后 mesh 丢失由
    // stlSessionCheck 检测 → 清理防幽灵）
    proj.set('meta.stlSession', {
      fingerprint: stlFingerprint(file), fileName: file.name, importedAt: Date.now(),
    }, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
    try { sessionStorage.setItem(STL_FP_KEY, stlFingerprint(file)); } catch (e) { /* 隐私模式等 */ }
    // STL 诊断（命令 10.txt 第一节）：bbox/几何质量/距离场统计/厚度代表点
    state.diag = diagnoseSTL(state.mesh, state.geometry, state.hotspots);
    if (DEBUG_HS) console.log('[STL-DIAG]', JSON.stringify(state.diag));
    writeHotspotsToProject();
    // 3D 标记热结（PHASE 22：toViewHotspot = 居中平移 + displayPosition 中面修正，
    // 计算坐标 h.x/y/z 不被覆盖；regionBBox 同步平移）
    if (state.hotspots.status === HS_STATUS.OK && state.hotspots.hotspots.length) {
      state.view3d.setHotspots(state.hsFake ? state.hotspots.hotspots : state.hotspots.hotspots.map(toViewHotspot));
      state.view3d.onSelectHotspot = (i) => highlightHotspot(container, i);
    } else if (DEBUG_HS) {
      // 调试模式：真实算法无结果时注入 Fake TEST-1/2，验证显示链路（第三阶段）
      injectFakeHotspots(container, state.hotspots.reason);
    }
    renderOverview(container);
    renderHotspotList(container);
        syncFlowChrome(container);
    /* R6-S2：分析完成会改写一批**自动来源**的参数（wallUsed / wallHot / mcHotspot / 几何量），
       面板此刻若正停在编辑步骤，必须重渲染——否则用户看到的是这一轮分析之前的旧值，
       而徽章却已经变了（屏幕与真实口径不一致）。草稿优先，所以正在编辑的输入不会被冲掉。 */
    refreshParamPanelIfOpen(container);
      // 生成结果阶段完成 → 隐藏进度条
    progressTo(container, 'result', 1);
    progressEnd(container);
    // STL 生命周期按钮（18.txt 六：[替换 STL][删除 STL] 在已导入 STL 时可用）
    container.querySelector('#dc_replaceStl').hidden = false;
    container.querySelector('#dc_deleteStl').hidden = false;
    container.querySelector('#dc_stlStatus').hidden = true;
      // 热结状态条（3D 视口上方常驻显示，不依赖一闪而过的 toast；悬停可见算法计数）
    updateHsBadge(container);
    const hsMsg = state.hotspots.status === HS_STATUS.OK
      ? tr('✅ 几何与热结分析完成：检测到 {n} 个热结', [state.hotspots.hotspots.length])
      : (state.hsFake
        ? tr('🔧 DEBUG：真实算法{a}，已注入 Fake 热结验证显示链路', [hsReasonText(state.hsFakeReason)])
        : tr('✅ 几何分析完成（热结：{a}）', [hsReasonText(state.hotspots.reason)]));
    showToast(manualRhKept
      ? hsMsg + '　' + tr('⚠️ 手动指定的 RH 已保留；更换模型后请到「浇注系统设计」复核该值是否仍适用。')
      : hsMsg);
  } catch (e) {
    const isView = stage === 'view';
    const title = isView
      ? viewErrorTitle(e)
      : stage === 'analysis' ? tr('分析未完成')
        : stage === 'model' ? tr('模型数据处理失败')
          : tr('STL 解析失败');
    showToast('❌ ' + title);
    console.error('importFile 失败:', e);
    /* 170.txt §四.4/§四.6：失败实例绝不留作可复用实例。
       buildView3D 已释放本次创建的实例；这里只清本流程的引用，
       不碰仍有效的实例（例如分析阶段失败时，三维视图本身仍可用）。 */
    if (isView) { state.view3d = null; state._view3dBox = null; }
    const hasView = !!state.view3d;
    const importZone = container.querySelector('#dc_importZone');
    const viewEl = container.querySelector('#dc_view3d');
    if (importZone) importZone.hidden = hasView;
    if (viewEl) viewEl.hidden = !hasView;
    // 恢复入口：没有三维视图时显示导入区；已有 STL 时顶部「导入 STL」始终可用
    const replaceBtn = container.querySelector('#dc_replaceStl');
    const deleteBtn = container.querySelector('#dc_deleteStl');
    if (replaceBtn) replaceBtn.hidden = !state.mesh;
    if (deleteBtn) deleteBtn.hidden = !state.mesh;
    const hint = isView
      ? tr('请点击「导入 STL」重新选择文件；若反复失败请反馈（附上文件）。')
      : stage === 'analysis'
        ? tr('分析未完成，请点击「导入 STL」重新导入模型。')
        : tr('可更换 STL 文件重试；若反复失败请反馈（附上文件）。');
    const vEl = container.querySelector('#dc_validate');
    if (vEl) {
      vEl.hidden = false;
      vEl.innerHTML = `<div class="dc-warn">❌ <b>${esc(title)}</b><br>`
        + `<span class="field-hint">${esc(e?.message || String(e || ''))}</span><br>`
        + `<span class="field-hint">${esc(hint)}</span></div>`;
    }
  } finally {
    state.busy = false;
    progressEnd(container);   // 无论成败都隐藏进度条
    syncFlowChrome(container);   // 状态 C → 回到 B/E/D，主按钮文案与可用性随之复位
    // 允许重新选择同一个文件再次触发 change（否则失败后重选同一文件没有反应）
    try { const f = container.querySelector('#dc_file'); if (f) f.value = ''; } catch (e) { /* 忽略 */ }
    }
}

/* PHASE 87：网格问题文案的英文覆盖。
   引擎的 `i.msg` 是硬编码中文（`js/engine/meshValidation.js`，本阶段禁改），
   英文界面下这一块原来整段是中文 —— 而它是海外用户导入文件后第一眼看到的东西。
   显示层按 `code` 出文案（中文基准即 key，英文查表），数字从原 msg 里取，不另算。
   已知例外：`PARSE_WARNING` 的 msg 来自解析器（stl.js），模板多变，**不做覆盖，原样显示** ——
   该分支只在文件损坏时出现。 */
const MESH_ISSUE_TEXT = {
  NO_TRIANGLES: 'STL 中没有有效三角形，文件可能损坏或为空',
  NON_FINITE_VERTEX: '存在 {n} 个非法顶点坐标（已归零，结果可能受影响）',
  DEGENERATE_TRIANGLE: '{n} 个退化三角形（面积≈0），已忽略其贡献',
  OPEN_MESH: '网格未闭合（{n} 条边界边）。体积/壁厚/热结分析可能不准确。',
  NON_MANIFOLD_EDGE: '存在 {n} 条非流形边（3 条及以上三角形共享，如双体共边/蝴蝶结）。体积与热结分析结果可能不可靠。',
  INCONSISTENT_WINDING: '存在 {n} 处缠绕方向不一致（相邻三角形法向相对）。体积符号与射线内外判断可能出错。',
  SELF_INTERSECTION: '检测到 {n} 处三角形自交（非相邻三角形相互穿越）。体积与热结分析结果可能不可靠。',
  SELF_INTERSECTION_UNCHECKED: '自交检测因三角形数量/重叠度过大未完整完成（超出检测对上限），可能存在未检出的自交。',
};

/** 单条网格问题的展示文本：命中 code → 走 i18n；未命中 → 原样返回引擎 msg（不猜） */
function meshIssueText(i) {
  const key = MESH_ISSUE_TEXT[i.code];
  if (!key) return i.msg;
  const n = (String(i.msg).match(/\d+/) || [])[0];
  return n != null ? tr(key, [n]) : tr(key);
}

function validateHtml(v) {
  const issues = v?.issues || [];
  if (!issues.length) return `<div class="dc-ok">✅ ${tr('STL 读取成功 · {n} 个三角面 · 网格闭合', [state.mesh?.triCount ?? 0])}</div>`;
  const hasError = issues.some(i => i.level === 'error');
  /* 155 §3.2：几何问题属于 P1（INVALID 为 P0）。主界面只留一行摘要，
     完整 code/解释与“可继续分析”的说明放进同一提示的详细信息；错误时默认展开。 */
  return `<details class="dc-validate-fold" ${hasError ? 'open' : ''}>
    <summary class="dc-${hasError ? 'warn' : 'ok'}">${hasError ? '⚠️' : 'ℹ️'} ${tr('STL 几何存在问题（{n} 项，部分分析可能受影响）', [issues.length])}</summary>
    <ul>${issues.map(i => `<li><b>${i.code}</b>：${esc(meshIssueText(i))}</li>`).join('')}</ul>
    <div>${tr('已显示 3D 模型，可继续分析或更换文件。')}</div>
  </details>`;
}

/** 热结结果 → CastingProject（命令3 第16-21节：区域化热结 + 可解释空结果） */
function writeHotspotsToProject() {
  const hs = state.hotspots;
  if (hs.status === HS_STATUS.OK) {
    proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
    proj.set('hotspots.items', hs.hotspots.map(h => ({
      id: h.id, x: h.x, y: h.y, z: h.z,
      mc: Math.round(h.mc * 10) / 10,
      regionVolumeCm3: Math.round(h.regionVolumeCm3 * 100) / 100,
      peaks: h.peaks,
    })), SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
    // PHASE 28.3-A：热结 Mc 自动值 → mcHotspot（用户未手动修改过才覆盖）
    if (proj.get('process.mcHotspot').src !== SRC.USER_OVERRIDE) {
      proj.set('process.mcHotspot', Math.round(hs.hotspots[0].mc * 10) / 10, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
    }
  } else {
    proj.set('hotspots.status', hs.status, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);   // V2.1：NO_HOTSPOT / LOW_CONFIDENCE / INSUFFICIENT_RESOLUTION
    proj.set('hotspots.reason', hs.reason, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
    proj.set('hotspots.items', hs.hotspots.map(h => ({ id: h.id, x: h.x, y: h.y, z: h.z, mc: h.mc, confidence: h.confidence })), SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  }
  // PHASE 26（34.txt 一）：V3 采样完成后回写完整可信主体壁厚 bodyRef（bodyWallOf + tP50 取大）。
  //   writeGeometryToProject 写入时 V3 尚未运行（无 tP50）——均匀实心件（cube50）bodyWallOf 会
  //   落到 wallAvg=12.5 低估（wallMain=wallMax 不可信，均匀件半距平均=边/8 是几何事实），
  //   而 tP50≈50（全域 t=d+d2）→ bodyRef=50 正确；ALR2510 bodyRef=3.6（≈真实主体 2-3mm）。
  //   用户已手动修改（USER_OVERRIDE）→ 尊重用户不覆盖；仅更新 state.bodyRef 供展示。
  const br = bodyRefOf(state.analysis, state.hotspots?.debug?.v3?.coarse?.thin || {});
  state.bodyRef = br.bodyRef != null ? br.bodyRef : state.bodyRef;
  if (br.bodyRef != null && state.analysis) {
    const scale = UNIT_SCALE[state.unit];
    if (proj.get('process.wallUsed').src !== SRC.USER_OVERRIDE) {
      proj.set('process.wallUsed', parseFloat((br.bodyRef * scale).toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
    }
    // PHASE 28.3-A：无热结时 wallHot = 主体壁厚/2（公式不变）；有热结时上方已覆盖 mcHotspot（既有逻辑）
    if (proj.get('process.wallHot').src !== SRC.USER_OVERRIDE
      && !(hs.status === HS_STATUS.OK && hs.hotspots.length > 0)) {
      proj.set('process.wallHot', parseFloat((br.bodyRef * scale / 2).toFixed(1)), SRC.DERIVED, CONF.MEDIUM);
    }
  }
}

/* 149 §三 末段：`hotspotV3.js:240` 会产出裸字符串 `reason:'rejected'` ——
   它**不在 `HS_REASON` 枚举里**，于是 `hsReasonText` / `HS_NOTE` 都查不到，
   文案一律回落到「无热结」，把"有候选但全被筛掉"说成了"没有热结候选"。
   ⚠ `js/engine/**` 冻结（§九），所以这个键**只加在显示层**，不回写引擎枚举。
   语义出处：`hotspotV3.js:239` `reason = audit.length ? 'rejected' : HS_REASON.NO_CANDIDATE`
   —— 走到这一支说明**有候选、也做了审计，但一条都没通过**。 */
const HS_REASON_REJECTED = 'rejected';
const HS_REASON_REJECTED_TEXT = '有热结候选但均未通过筛选（未达热结判定标准）';

function hsReasonText(reason) {
  return tr({
    [HS_REASON.NO_CANDIDATE]: '未检测到热结候选',
    [HS_REASON.UNIFORM]: '模型壁厚均匀，无相对厚区',
    [HS_REASON.ALL_LOW_CONFIDENCE]: '有候选但置信度不足（详见列表）',
    [HS_REASON.INVALID_MESH]: '网格无效，无法分析',
    [HS_REASON.NO_INSIDE_POINTS]: '无法可靠进行热结分析（未获得有效内部采样点）',
    [HS_REASON.REFINE_LIMIT]: '局部细化超限，置信度不足',
    [HS_REASON_REJECTED]: HS_REASON_REJECTED_TEXT,
  }[reason] || '无热结');
}

/* ================= 调试模式：热结问题分层定位（命令文件第六阶段） ================= */
/**
 * 输出热结分析的完整分层信息：算法是否产生结果 → 数量 → 每个 XYZ/Score → 各阶段计数。
 * 用于判断"热结不显示"问题在哪一层（算法 / 数据 / UI / Viewer）。
 */
function logHotspotDebug(hs) {
  if (!DEBUG_HS) return;
  const d = hs.debug || {};
  console.log(`[HS-DEBUG] status=${hs.status} reason=${hs.reason || '-'}`);
  console.log(`[HS-DEBUG] 网格: gs=${d.gs}³ vs=${d.vs ? d.vs.toFixed(2) : '-'}mm · 内部点=${d.insidePoints}/${d.totalPoints} · 耗时=${d.elapsedMs}ms`);
  console.log(`[HS-DEBUG] 各阶段计数: 候选=${d.candidates} 区域=${d.regions} 峰=${d.peaks} 拒绝=${d.rejected}`);
  if (hs.status === HS_STATUS.OK) {
    hs.hotspots.forEach(h => console.log(
      `[HS-DEBUG] H${h.id} x=${h.x.toFixed(2)} y=${h.y.toFixed(2)} z=${h.z.toFixed(2)} mc=${h.mc.toFixed(2)} score=${h.peaks?.[0]?.score ?? '-'} 区域=${h.regionVolumeCm3.toFixed(2)}cm³`));
  } else {
    console.log(`[HS-DEBUG] 算法未产生热结结果（${hsReasonText(hs.reason)}）`);
  }
}

/**
 * 注入 Fake 热结（命令文件第三阶段：暂时绕过真实算法，验证显示链路）。
 * 只覆盖 UI 显示层；CastingProject 数据仍保持真实算法结果。
 * 仅在 hsDebug 模式 + 真实算法无结果时使用。
 */
function injectFakeHotspots(container, realReason) {
  if (!state.view3d) return;
  state.hotspots = { status: HS_STATUS.OK, reason: null, hotspots: FAKE_HOTSPOTS };
  state.hsFake = true;
  state.hsFakeReason = realReason;
  state.view3d.setHotspots(FAKE_HOTSPOTS);
  state.view3d.onSelectHotspot = (i) => highlightHotspot(container, i);
  updateHsBadge(container);
  renderHotspotList(container);
}

/** 热结状态条（3D 视口上方常驻；悬停 title 显示算法各阶段计数，便于反馈定位问题层） */
function updateHsBadge(container) {
  const badge = container.querySelector('#dc_hsBadge');
  if (!badge) return;
  badge.hidden = false;
  const d = state.hotspots?.debug;
  if (d) {
    /* ⚠ 原来是裸模板字符串 ⇒ 英文界面里这段 title 一直是中文（i18n 审计记为遗漏）。
       改成词条 + 具名插值：中文原文即 key，查不到时行为与原来逐字相同。 */
    badge.title = tr('算法内部：gs={gs}³ · vs={vs}mm · 内部点={ip}/{tp} · 候选={c} · 区域={r} · 峰={p} · 拒绝={rj} · {ms}ms',
      { gs: d.gs, vs: (d.vs || 0).toFixed(2), ip: d.insidePoints, tp: d.totalPoints,
        c: d.candidates, r: d.regions, p: d.peaks, rj: d.rejected, ms: d.elapsedMs });
  }
  if (state.hsFake) {
    badge.innerHTML = tr('hs.badge.fake', [hsReasonText(state.hsFakeReason)]);
    badge.className = 'dc-hs-badge dbg';
    return;
  }
  /* 155 §3.3：三维视口里的状态条只留**一句结论**；完整原因/限制进 title。
     它在视口顶部悬浮，长段落会直接遮住模型（人工截图拍到 cube50 的两行警告占满上半屏）。 */
  const setBadge = (cls, shortHtml, fullHtml = shortHtml) => {
    badge.innerHTML = shortHtml;
    badge.className = 'dc-hs-badge ' + cls;
    badge.title = String(fullHtml).replace(/<[^>]+>/g, '');
  };
  if (state.hotspots.status === HS_STATUS.OK && state.hotspots.hotspots.length) {
    const hs = state.hotspots.hotspots;
    setBadge('ok', tr('hs.badge.ok', [hs.length, fmt(hs[0].mc, 1)]));
  } else if (state.hotspots.status === HS_STATUS.LOW_CONFIDENCE && state.hotspots.hotspots.length) {
    const full = tr('hs.badge.lowconf', [state.hotspots.hotspots.length, hsReasonText(state.hotspots.reason)]);
    setBadge('warn', tr('hs.badge.lowconf.short', [state.hotspots.hotspots.length]), full);
  } else if (state.hotspots.status === HS_STATUS.NO_HOTSPOT) {
    // PHASE 28.5（42.txt 十一）：真均匀件 → 明确"未检出"，与"分析失败"分开
    // PHASE 71.5：uniform（真均匀）与 no_candidate（未达阈值，不等于无热节）分开表述，不冒充"均匀属正常"
    const unif = state.hotspots.reason === HS_REASON.UNIFORM;
    const full = unif
      ? tr('hs.badge.uniform', [hsReasonText(state.hotspots.reason)])
      : tr('hs.badge.nocand', [hsReasonText(state.hotspots.reason)]);
    setBadge('none', tr(unif ? 'hs.badge.uniform.short' : 'hs.badge.nocand.short'), full);
  } else if (state.hotspots.status === HS_STATUS.INSUFFICIENT_RESOLUTION) {
    // 42.txt 六/十一：分析失败绝不能说"属正常"——必须阻断并给出人工入口
    const full = tr('hs.badge.insufficient', [hsReasonText(state.hotspots.reason)]);
    setBadge('warn', tr('hs.badge.insufficient.short'), full);
  } else {
    setBadge('none', tr('hs.badge.manual'));
  }
}

/* 几何分析结果 → CastingProject（命令3 第11/12节：自动获得 + 来源标记） */
function writeGeometryToProject() {
  const a = state.analysis, scale = UNIT_SCALE[state.unit];
  // PHASE 29（R2）：geometry.valid 真实化——validateMesh error 级（NO_TRIANGLES/非有限顶点）
  //   置 false，runAnalysis 据此阻止自动工艺建议（坏网格不静默污染重量链）。
  //   注意：NaN 顶点 validateMesh 会归零篡改（meshValidation.js:23）——valid=false 拦截其下游污染。
  proj.set('geometry.valid', state.validation?.ok !== false, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  // PHASE 28.5（42.txt 五）：结构化状态 VALID/WARNING/INVALID（deriveGeomStatus 纯函数派生，与 valid 同源）
  proj.set('geometry.geomStatus', deriveGeomStatus(state.validation?.issues || []), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.triCount', state.mesh.triCount, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.unit', state.unit, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('geometry.size', a.size.map(v => Math.round(v * scale * 10) / 10), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.volumeCm3', parseFloat((a.volume * scale ** 3 / 1000).toFixed(2)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.areaCm2', parseFloat((a.area * scale ** 2 / 100).toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.wallMax', parseFloat((a.wallMax * scale).toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.wallAvg', parseFloat((a.wallAvg * scale).toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.wallHist', a.wallHist, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  // 主体壁厚 → 浇注时间用主壁厚（自动值，可改）。
  // PHASE 26（34.txt 一方案 A）：wallMain 峰值检测失败时 fallback 到 wallMax（=最大壁厚），
  //   薄壁主体+厚大结构模型会把"最大壁厚"误当"主体壁厚"（ALR2510：17.2 vs 真实 2-3mm）——
  //   改用与 samplingWarn 同链的可信参考 bodyWallOf（wallMain 可信校验 → wallAvg → wallMax）。
  //   V3 采样完成后 importFile 再以完整 bodyRefOf（含 tP50 取大）回写，见 writeHotspotsToProject。
  const bodyWall = bodyWallOf(a);
  if (bodyWall != null) {
    // PHASE 28.4 修复：USER_OVERRIDE 保护（与 writeHotspotsToProject 同模式）——单位切换会重跑本函数，
    //   无条件写入会把用户手动改过的 wallUsed/wallHot 静默还原（P2-13 具体路径；替换 STL 时数据已先被
    //   clearStlBoundData 清空，src=DEFAULT，不影响自动刷新）。
    if (proj.get('process.wallUsed').src !== SRC.USER_OVERRIDE) {
      proj.set('process.wallUsed', parseFloat((bodyWall * scale).toFixed(1)), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
    }
    // PHASE 28.3-A：壁厚模数 wallHot = 主体壁厚/2（板件近似；公式不变，参数来源随可信主体壁厚；导入 STL 自动获得，可改）
    if (proj.get('process.wallHot').src !== SRC.USER_OVERRIDE) {
      proj.set('process.wallHot', parseFloat((bodyWall * scale / 2).toFixed(1)), SRC.DERIVED, CONF.MEDIUM);
    }
  }
  // 几何问题清单
  const issues = (state.validation?.issues || []).map(i => i.msg);
  proj.set('geometry.meshIssues', issues, SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  proj.refreshWeight();
}

/* ================= ② PHASE 71.6：模块导航选择区已删除 =================
   设计中心定位为"明确的铸造工艺设计流程"：导入 STL 后直接给出固定范围的工艺信息与设计结果，
   不再让用户思考"我要不要运行这个分析"。其余独立计算器（冷铁/砂型/加料/开箱/CT/Campbell…）
   文件与视图均保留，从「计算器」入口使用。 */

/* ================= 右侧面板：热结列表（点击 ↔ 3D 双向联动） ================= */
function renderHotspotList(container) {
  const card = container.querySelector('#dc_hotspotsCard');
  const list = container.querySelector('#dc_hotspotList');
  const hs = state.hotspots;
  const showable = hs && (hs.status === HS_STATUS.OK || hs.status === HS_STATUS.LOW_CONFIDENCE) && hs.hotspots.length;
  if (!showable) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const lowConf = hs.status === HS_STATUS.LOW_CONFIDENCE;
  // 83.txt 三：三个数字加上用户能读懂的名字（原先只有 Mc / cm³ / 置信 三个缩写，
  //   首次使用看不懂；单位是 cm³ 体积不是面积，置信度是算法评分不是概率——文案必须说清）。
  /* S2.2-B：本列表只负责**查看 / 定位**（点击行 → 3D 高亮，相机不动）。
     「哪些热结参与冒口设计」是**冒口设计的输入参数**，只在 ③ → B 冒口设计里勾选，
     并与逐热结 Mc 共用同一个草稿 `process.hsPick`：保存后才写入项目。
     这样三维选择（会话内查看）与参数选择（要落盘的工程输入）不再共用一套写语义。
     设计参数的当前状态仍在这里以只读徽标显示，用户不必打开面板也能看到谁参与了。 */
  const picks = proj.getV('process.hsPick') || [];
  list.innerHTML = hs.hotspots.map((h, i) => {
    const pick = picks.find(p => p.id === h.id);
    return `<div class="dc-hs-row">
      <button class="dc-hs-item${pick ? ' on' : ''}" data-hs="${i}" title="${esc(h.displayCenterReliable === false
        ? tr('⚠ 该热结位置修正不可靠，当前显示计算坐标（复杂结构或开放边界）')
        : tr('显示位置已按局部壁厚中部修正；计算坐标不受影响'))}">
        <span class="dc-hs-id">${lowConf ? '?' : 'H' + (i + 1)}</span>
        <span class="dc-hs-main">${tr('模数')} <b>${fmt(h.mc, 1)}</b> mm</span>
        <span class="dc-hs-sub">${tr('区域')} ${fmt(h.regionVolumeCm3, 1)} cm³${h.confidence ? ` · ${tr('置信度')} ${Math.round(h.confidence * 100)}%` : ''}</span>
      </button>
      <span class="dc-hs-pick${pick ? ' on' : ''}" data-hs-pick-state="${h.id}"
        title="${esc(tr('冒口设计的当前已保存状态；勾选/取消请到 ③ 工艺设计 → 冒口设计（草稿，保存后生效）'))}">${pick ? `✓ ${tr('参与冒口')}` : tr('未参与冒口')}</span>
    </div>`;
  }).join('');
  // 一句话解释「置信度」的真实含义：算法内部评分，不是"正确概率"（83.txt 二·1 的结论）
  const hint = container.querySelector('#dc_hsHint');
  if (hint) {
    hint.innerHTML = (hs.hotspots.some(h => h.confidence)
      ? tr('模数 = 热结区域的体积/表面积（越大越慢冷）；区域 = 热结体积；置信度 = 算法内部评分（模数、显著度、区域占比、多尺度稳定性加权），<b>不是"正确概率"</b>。')
      : tr('模数 = 热结区域的体积/表面积（越大越慢冷）；区域 = 热结体积。'))
      + (picks.length ? `<br>${tr('已选 {n} 个热结参与冒口设计。', [picks.length])}` : `<br>${tr('未勾选：按主热结 H1 自动设计冒口。')}`)
      + `<br>${tr('点热结行只用于查看/定位（不会改变冒口设计）。要选择哪些热结参与冒口设计，请到 ③ 工艺设计 → 冒口设计勾选 —— 那里是草稿，保存后生效。')}`;
  }
  list.querySelectorAll('[data-hs]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.hs;
      /* ⚠ 146.txt §六：**第二个参数必须显式传 false**。
         `selectHotspot` 的占位是 `focus = false`，但这里历史上传的是单参 + 旧默认值 true
         ⇒ 点一下列表，相机就被拽到热点上方（"点击热结自动放大"的另一半根因）。
         现在显式 false：只选中/高亮，相机位置、朝向、缩放、观察状态一律不动。 */
      state.view3d?.selectHotspot(i, false);
      highlightHotspot(container, i);
      /* 窄屏：面板是**覆盖三维的全宽浮层** ⇒ 选中热结后自动收起，
         否则"3D ↔ 列表双向联动"根本看不见（选中了三維上却什么都没发生）。
         R6：改走 closeTaskPanel()（同一条同步链），不再直接操作 class。 */
      if (window.matchMedia('(max-width: 959px)').matches) closeTaskPanel(container);
    });
  });
  /* S2.2-B：**设计参数的勾选不再在这里写项目。**
     左栏只保留 `[data-hs]` 的查看/定位行为；`process.hsPick` 的唯一编辑入口是
     ③ → B 冒口设计的草稿（保存后落盘）。这样同一个参数不会有两个保存语义。 */
}

/** 全部已完成模块标记为"需重算"（145 §三：参数改动即落盘，随即按既有防抖链自动重算） */
function markAllStale() {
  if (!state.results) return;
  for (const id of Object.keys(state.results)) if (state.results[id]) state.stale.add(id);
}

/** 面板热结列表高亮（3D 点击回调与列表点击共用） */
function highlightHotspot(container, i) {
  const list = container.querySelector('#dc_hotspotList');
  if (!list) return;
  list.querySelectorAll('[data-hs]').forEach(b => b.classList.toggle('on', +b.dataset.hs === i));
}

/* ================= 右侧面板：采样/厚度诊断行（PHASE 71.7：并入 ① 概览；原独立「模型信息」面板取消） =================
   数据来自 GeometryResult / diagnoseSTL，UI 只显示。 */
function samplingDiagHtml() {
  // 厚度诊断（命令 10.txt 一/二：距离场采样状态——PHASE 22 30.txt 二十：
  // 生产界面不暴露 gs/vs/内部点等工程细节，只给用户可理解的状态；hsDebug 显示全量）
  const diag = state.diag;
  const ts = diag?.thickness;
  const tsStatus = ts?.status || '';
  const tsBad = tsStatus.startsWith('INSUFF');
  const tsChip = tsBad ? `<span class="chip dc-chip-bad">${tr('采样不足')}</span>`
    : tsStatus === 'LOW' ? `<span class="chip dc-chip-warn">${tr('精度低')}</span>`
    : `<span class="chip chip-ok">${tr('正常')}</span>`;
  const thickHtml = diag && diag.distanceField.gs
    ? `<div class="dc-diag-line ${tsBad ? 'dc-diag-bad' : ''}">
        <span>${tr('距离场采样')}</span><b>${tsBad ? tr('⚠ 采样点不足，壁厚估计不可靠（分析结果仅供参考）') : tr('✅ 采样正常')}</b>${tsChip}</div>
      ${diag.thickness ? `<div class="dc-diag-line">
        <span>${tr('厚度估计（P95×2 / max×2）')}</span><b>${fmt(diag.thickness.p95, 1)} / ${fmt(diag.thickness.max, 1)} mm</b></div>
      ${tsBad && diag.thickness.reason ? `<div class="dc-diag-line"><span>${tr('原因')}</span><b>${esc(diag.thickness.reason)}</b></div>` : ''}` : ''}
      ${DEBUG_HS ? `<div class="dc-diag-line"><span>${tr('采样网格')}</span><b>gs=${diag.distanceField.gs}³ · vs=${fmt(diag.distanceField.vs, 2)} mm · ${tr('内部点')} ${diag.distanceField.insidePoints}/${diag.distanceField.totalPoints}</b></div>` : ''}
      </div>`
    : '';
  const debugHtml = DEBUG_HS && diag
    ? `<div class="dc-diag">
        <div class="dc-sec-title">🔬 ${tr('STL 诊断')} <span class="chip">DEBUG</span></div>
        <div class="dc-diag-line"><span>${tr('单位假设')}</span><b>STL = ${esc(diag.stl.assumedUnit)}${tr('（无单位信息，按 mm 计）')}</b></div>
        <div class="dc-diag-line"><span>${tr('水密')}</span><b>${diag.quality.watertight ? tr('是') : tr('否（{n} 项问题）', [diag.quality.issues.length])}</b></div>
        ${diag.quality.issues.slice(0, 5).map(i => `<div class="dc-diag-line"><span>${esc(i.code)}</span><b>${esc(i.msg)}</b></div>`).join('')}
        <div class="dc-diag-line"><span>${tr('体积')}</span><b>${fmt(diag.stl.volumeCm3, 1)} cm³</b></div>
        ${diag.thickness?.thickSamples?.map(s => `<div class="dc-diag-line"><span>${tr('厚区采样')}</span><b>(${s.position.join(',')}) ${tr('厚')} ${fmt(s.thickness, 1)} mm</b></div>`).join('') || ''}
      </div>`
    : '';
  return thickHtml + debugHtml;
}


/** 自动重算（命令 9.txt STEP 5：修改共享参数后相关结果自动重新计算）——已有结果时防抖重跑 */
function autoRecompute(container) {
  if (!state.results) return;
  clearTimeout(autoRecompute._h);
  autoRecompute._h = setTimeout(() => {
    if (!state.results) return;
    // PHASE 78：结果页内联改参数也走这条链 → keepScroll（不跳回顶部、保持当前结果页与输入焦点）
    const ok = runAnalysis(container, { keepScroll: true });
    /* S2.2-E：防抖链的完成提示必须读**真实结局** ——
       分析失败/被门禁挡住时再说"已自动重新计算"就是拿旧结果冒充新结果。
       R6-S3.1/S4：RH 复核提示优先显示（结果页内联改参数重算后不能只留下“已重算”）。 */
    const review = state.pendingRhReview;
    state.pendingRhReview = null;
    showToast(ok
      ? (review || tr('🔄 共享参数已变化，结果已按当前参数重新计算'))
      : tr('⚠️ 参数已变化，但重新分析未完成 —— 旧结果保留并标记为过期，请处理后再试'));
  }, 600);
}

function matKeyOf(fam) {
  return { '灰铁': '灰铁(HT)', '球铁': '球铁(QT)', '铸钢': '铸钢(ZG)', '铝合金': '铝合金(Al)', '铜合金': '铜合金(Cu)' }[fam] || '灰铁(HT)';
}

/** 用户是否显式设定过该参数（显式设定 → 材料切换时不覆盖） */
function isUserSetPath(path) {
  const p = proj.get(path);
  return !!p && (p.src === SRC.USER_OVERRIDE || p.src === SRC.USER_INPUT);
}

/**
 * PHASE 79（79.txt 一）：**材料大类切换 → 该材料的密度/出品率随动**。
 * 旧行为：在「基础工艺参数」把球铁改成铝合金，只写了 material.family，
 *   solidDensity 仍是 7.1 → 净重/毛坯重不变（用户实测）→ 而且浇注/冒口/出品率全用旧密度算，属实质性错误。
 * 现行为：按材料表带出 液态密度/固态密度/出品率区间（**用户显式改过的项不覆盖**），
 *   并 refreshWeight() 重算净重/毛坯重 → 概览与下游计算同步。
 */
function applyFamilyDefaults(fam) {
  const md = GATING_MATS[matKeyOf(fam)];
  const rm = RISER_MATERIALS[fam];
  const put = (path, v) => { if (!isUserSetPath(path) && v > 0) proj.set(path, v, SRC.DERIVED, CONF.HIGH); };
  if (md) {
    put('material.liquidDensity', md.rho);
    put('material.yieldMin', md.y_min);
    put('material.yieldMax', md.y_max);
    put('material.yieldSug', md.y_sug);
  }
  if (rm) put('material.solidDensity', rm.rho);
  proj.refreshWeight();   // 体积 × 固态密度 → 净重；毛坯重（非用户覆盖时）同步
}

/**
 * PHASE 79（79.txt 一·举一反三）：参数联动提示——把"改了 A 会影响哪些下游"直接写在参数区，
 * 让用户看得见随动关系（材料→密度/重量；造型线→出品率参考区间；铸造方法→加工余量等级）。
 * 纯展示：数值全部来自既有数据表（MATERIALS / resolveYield / methodGradeRec）。
 */
function applyMaterialDefaults(fam, src = SRC.SCENARIO, conf = CONF.MEDIUM) {
  const md = GATING_MATS[matKeyOf(fam)];
  const rm = RISER_MATERIALS[fam];
  const put = (path, v) => { if (!isUserSetPath(path) && v > 0) proj.set(path, v, src, conf); };
  if (md) {
    put('material.liquidDensity', md.rho);
    put('material.yieldMin', md.y_min);
    put('material.yieldMax', md.y_max);
    put('material.yieldSug', md.y_sug);
  }
  if (rm) put('material.solidDensity', rm.rho);
  proj.refreshWeight();
}

/* PHASE 71.7（77.txt 末）：生产场景联动的实现已迁至 CastingProject.syncFromContext（可单测）；
   设计中心只负责：把场景里的材料归一为材料大类 + 提供材料默认值回填函数。
   ⚠ 146 修复：145 删掉参数区时把它的**唯一调用点**（renderParams 开头那次）也带走了 ⇒
     首页/顶栏「生产场景」填好的材料·造型线·铸造方法不再自动带进设计中心（能力静默丢失）。
     现在改为在**导入模型后**与**重进视图时**各调一次（与原调用时机一致）。 */
function syncFromContext() {
  const ctx = context.get();
  if (!ctx) return;
  if (ctx.material) ctx.family = context.familyOf(ctx.material) || ctx.material;
  proj.syncFromContext(ctx, (fam) => applyMaterialDefaults(fam, SRC.SCENARIO, CONF.MEDIUM));
}


/* ================= 执行分析 =================
   V2.3（命令 9.txt）：manifest 驱动——勾选任务按 calcManifest 声明执行，
   共享参数自动复用（calculate 内从 CastingProject 取），缺失参数在分页输入中补齐。 */
function runAnalysis(container, opts = {}) {
  if (state.busy) { showToast(tr('⏳ 分析中，请稍候再执行')); return false; }
  /* S4 / 155 §7.3：同一帧内的重复点击不得重复执行整套分析。
     分析链是同步的，`state.busy` 在两次 click 之间来不及形成保护；这里加 250ms 去重。
     不影响结果页内联参数的 600ms 防抖重算（它不会在同一帧连点）。 */
  const now = Date.now();
  if (now - (runAnalysis._lastAt || 0) < 250) return state.lastRun?.ok === true;
  runAnalysis._lastAt = now;
  /* 手动分析优先于防抖链：取消尚未触发的自动重算，避免"刚算完又被 600ms 定时器再算一遍"。 */
  clearTimeout(autoRecompute._h);
  /* D8：被门禁挡住时必须**显式记账**——旧结果保持显示，但状态转为"分析未完成"，
     结果区出现横幅说明原因并提供重算入口（不隐藏、不清空、不静默）。 */
  const blocked = (reason, openDlgFor) => {
    state.lastRun = { ok: false, reason: tr(reason) };
    /* 旧结果此时**不再与当前参数一致**：即使参数没写进去，用户刚表达了"想用新条件算"的意图。
       把它标为过期，避免界面同时出现"分析未完成"与"结果与当前参数一致"两种说法。 */
    markAllStale();
    renderStateChip(container);
    syncFlowChrome(container);
    /* §3.3：**必要字段缺失时，开始分析前必须明确提示，并提供打开参数窗口的入口** ——
       只弹 toast 让人自己去菜单里找，等于没给入口。这里直接把窗口打开并定位到缺的那一项。 */
    if (openDlgFor) openParamAt(container, openDlgFor);
    return false;
  };
  // PHASE 29（R2）STL 质量门禁：INVALID 阻止自动工艺建议（不静默）；OPEN_MESH 显著警示
  // PHASE 71.6 修复：门禁只对"本会话导入了 STL"生效——geometry.valid 默认 false（=无 STL），
  //   对所有任务一刀切会让手动输入模式永远无法执行（实测：手动模式点执行被 STL 门禁挡住）。
  const hasStlNow = !!state.mesh;
  const valid = proj.get('geometry.valid');
  if (hasStlNow && valid && valid.v === false) {
    showToast(tr('❌ STL 网格无效（空/损坏/含非法顶点）：已阻止自动工艺建议。请更换 STL 文件后重新导入。'));
    return blocked('STL 网格无效');
  }
  const issues = hasStlNow ? (proj.getV('geometry.meshIssues') || []) : [];
  if (issues.some(i => typeof i === 'string' && i.includes('未闭合'))) {
    showToast(tr('⚠️ 网格未闭合：体积/重量链可能偏小，自动建议仅供参考（建议修复 STL 后重导入）'));
  }
  /* 146 §3.3/§3.4：**只有有效参数才能用于分析** —— 必需项由 paramIssues() 逐条判定
     （材料大类 / 毛坯重量），缺则阻断并**打开参数窗口定位到该字段**，不猜、不兜默认值。 */
  const miss = paramIssues();
  if (miss.length) {
    showToast(tr('⚠️ 还缺必要条件：{r}', [miss.map(m => m.msg).join('；')]));
    return blocked(miss[0].msg, miss[0].path);
  }
  const tasks = [...state.tasks];   // PHASE 71.6：固定任务集（无 UI 选择，始终全部执行）

  const results = {};
  /* S2.2-E：计算过程中会**逐模块写回**项目（runner.result / risers.items / yield.result）。
     先留一份写回前快照：若后续任一模块失败，回滚这些共享结果字段，
     避免"旧结果仍显示、项目里的 RH/runner 已是新一次的半成品"。
     正常路径不受影响（快照只在失败分支使用）。
     R6-S3.1（154.txt §五.3）：RH 不再由冒口计算自动回写，故不在写回清单里。 */
  const WRITEBACK_PATHS = ['runner.result', 'risers.items', 'yield.result'];
  const writebackSnapshot = WRITEBACK_PATHS.map(path => {
    const e = proj.get(path);
    return e ? { path, v: e.v, src: e.src, conf: e.conf } : null;
  }).filter(Boolean);
  /* R6-S3.1：重算后如果冒口高度改变而用户已指定 RH，明确提示复核（不静默假定仍适用）。 */
  const prevRiserH = (state.results?.riser && !state.results.riser.blocked && state.results.riser.H > 0)
    ? state.results.riser.H : null;
  /* 分析期间的真实忙碌标志（S2.2-E）：重复触发一律走上面的 `state.busy` 守卫；
     计算全部是同步的，所以这个标志也保证"结束后才刷新成 D/E"，不会停在 C。 */
  state.busy = true;
  syncFlowChrome(container);
  const failed = [];
  const failureKeys = new Map();   // 模块 id → 失败原因 key（目前只有 gating 的 Hp/A 物理无效）

  // 按依赖顺序执行（RUN_ORDER：shrinkage/machining 独立 → gating/riser → yield → charge）
  try {
    for (const id of RUN_ORDER) {
      if (!tasks.includes(id)) continue;
      const m = CALC_MANIFEST.find(c => c.id === id);
      if (!m) continue;
      try {
        let r = m.calculate(results);
        /* 164.txt 四/五：设计类型决定当前主结果。
           · 发热/保温：核心仍用圆柱 V0 作基准；转成目标体积 + 当前 H/D 反算的几何。
           · 梯形：核心 A_run 为目标总面积；按条数均分后转成梯形尺寸与面积校核。
           转换函数与两个独立计算器共用；核心冻结文件不修改。 */
        if (r && !r.blocked && id === 'riser' && proj.getV('process.riserShape') === 'insulated') {
          r = applyInsulatedRiserResult(r, { hdRatio: proj.getV('process.hdRatio') });
        }
        if (r && !r.blocked && id === 'gating') {
          const section = effectiveRunnerSection(r, proj.getV('process.runnerSection'));
          const count = section === 'rect'
            ? (proj.getV('production.runnerN') > 0 ? proj.getV('production.runnerN') : r.rc)
            : normalizeRunnerCount(proj.getV('production.trapezoidN'), 1);
          r = applyRunnerSection(r, { section, count });
        }
        results[id] = r;
        if (!r) failed.push(id);
        /* R6-S3.1（154.txt §五.7）：RH 组合可能把平均静压头算到 ≤0（实测中注 RH=400 时
           Hp=−172.5、A=0、直浇道退化为 ⌀5）。这是**物理上不可用的结果**，不能当成有效分析；
           这里只做有效性门禁，不改变 runGating 的任何公式或数值。 */
        if (id === 'gating' && r && !r.blocked) {
          const gv = gatingValidity(r);
          if (!gv.ok) { failed.push(id); failureKeys.set(id, gv.textKey); }
        }
        // 结果写回项目（共享：runner.result / risers.items / yield.result）
        // PHASE 71.6 修复：riser 结果存在（门禁阻止时为真值对象）→ 写入结果；回写前判空
        if (r && !r.blocked) {
          if (id === 'gating') proj.setResult('runner.result', r);
          if (id === 'riser') {
            // PHASE 71.7：多热结 → 全部冒口入库（risers.items）；单热结 = [r]
            proj.setResult('risers.items', (r.items && r.items.length) ? r.items : [r]);
            /* R6-S3.1（154.txt §五.3）：**不再**把冒口总高 H 自动回写到 process.riserHeight。
               该字段是 RH（冒口顶面高出铸件顶面），只有顶冒口直接坐铸件顶面时才等于 H；
               自动回写会让侧冒口/冒口座场景静默使用错误 RH。参考值只由面板显式“采用”。 */
          }
          if (id === 'yield') proj.setResult('yield.result', r);
        }
      } catch (e) {
        console.error(`[${id}] 计算失败:`, e);
        results[id] = null;
        failed.push(id);
      }
    }
  } finally {
    state.busy = false;
  }
  /* S2.2-E：**保存成功 ≠ 分析成功**。任何一个任务抛异常/返回空对象 ⇒ 本次分析未完成：
       ① 不把这份不完整的结果对象当成"当前有效结果"（保留旧结果，若有）；
       ② 旧结果标记过期，状态 chip/横幅写明失败原因；
       ③ 明确返回 false，调用方（防抖链 / 保存链）不得再显示"已重新计算"。 */
  if (failed.length) {
    const first = failed[0];
    const m = CALC_MANIFEST.find(c => c.id === first);
    /* 失败原因本身可能以「。」结尾；状态模板还会再补一个句号 ⇒ 去掉尾部标点，
       避免出现「…Hp ≤ 0。以下为…」这类重复句号。 */
    const reason = (failureKeys.has(first) ? tr(failureKeys.get(first)) : tr('{m} 计算失败', [tr(m?.name || first)]))
      .replace(/[。；;]\s*$/, '');
    state.lastRun = { ok: false, reason };
    /* 回滚本次分析已经写回的共享结果字段（旧结果若存在，必须仍对应旧结果）。 */
    for (const s of writebackSnapshot) proj.set(s.path, s.v, s.src, s.conf);
    markAllStale();
    renderStateChip(container);
    syncFlowChrome(container);
    refreshParamPanelIfOpen(container);
    showToast(tr('❌ 分析未完成：{r}。{old}',
      [reason, state.results ? tr('旧结果仍保留显示，但已标记为过期。') : tr('没有可用的旧结果。')]));
    return false;
  }

  state.results = results;
  state.stale.clear();             // 重算完成 → 清除"需重算"标记（19.txt 十）
  state.lastRun = { ok: true };    // D8：本次分析完成 → 状态回到"结果与当前参数一致"
  proj.exportToContext(context);   // 同步生产场景（计算器预填）
  /* R6-S3.1（154.txt §五.6）：用户已指定 RH 时，冒口方案变化后明确提示复核——
     不自动改数，也不假定旧 RH 仍适用。 */
  const rhP = proj.get('process.riserHeight');
  const userRh = !!rhP && rhP.v > 0 && (rhP.src === SRC.USER_OVERRIDE || rhP.src === SRC.USER_INPUT);
  const nextRiserH = (results.riser && !results.riser.blocked && results.riser.H > 0) ? results.riser.H : null;
  const rhReviewMsg = (userRh && prevRiserH != null && nextRiserH != null && Math.abs(prevRiserH - nextRiserH) > 0.5)
    ? tr('⚠️ 冒口高度已由 {a} mm 变为 {b} mm：请复核已指定的 RH={rh} mm 是否仍适用', { a: fmt(prevRiserH, 1), b: fmt(nextRiserH, 1), rh: fmt(rhP.v, 1) })
    : null;
  const box = container.querySelector('#dc_results');
  box.hidden = false;
  renderResults(container);
  renderStateChip(container);   // D8：结果区横幅与顶部状态 chip 同步
  syncFlowChrome(container);    // S5-03：状态 D → 合并入口「分析并查看结果」/「重新分析」
  refreshParamPanelIfOpen(container);   // 重算会回写 risers.items 等共享结果，面板要跟着刷新（RH 不再自动回写）
  /* 144.txt §五：**必须消除"点分析结果 → 页面往下滚"这一行为**。
     结果区是工作台内的一个视图，由 `setWorkspaceView` 切换，页面滚动位置分毫不变。
     S5-03：视图切换由**调用方** `startAnalysis` 在分析成功后执行（自动进入结果页）；
     `runAnalysis` 这里只给“已完成”反馈。keepScroll（结果页内联改参数触发的重算）
     保持当前视图与焦点，不做任何跳转。 */
  if (!opts.keepScroll) {
    flagResultsReady(container, rhReviewMsg);
    state.pendingRhReview = null;
  } else if (rhReviewMsg) {
    /* autoRecompute 会在本函数返回后立刻显示“已重新计算”的 toast；
       把复核提示挂起，由它统一显示，避免被后一条覆盖。 */
    state.pendingRhReview = rhReviewMsg;
  }
  return true;
}

/** 分析完成后把"结果已就绪"表示出来：高亮主入口 + 明确文案。
 *  视图切换由 startAnalysis 负责（成功后自动进入结果页），这里不抢切换。
 *  `reviewMsg`（R6-S3.1）：需要用户复核的 RH 变化提示；有它时优先显示，不丢失就绪状态。 */
function flagResultsReady(container, reviewMsg = null) {
  const btn = container.querySelector('#dc_run');
  if (btn) {
    btn.classList.add('ready');
    clearTimeout(flagResultsReady._h);
    flagResultsReady._h = setTimeout(() => btn.classList.remove('ready'), 6000);
  }
  showToast(reviewMsg || tr('✅ 工艺分析完成'));
}

/* ================= 结果（PHASE 71.5：三页结果中心；data-calc-link 绑定移交 resultsCenter 随重渲染重建） ================= */
function renderResults(container) {
    renderStateChip(container);
  const box = container.querySelector('#dc_results');
  // Page1 内存态上下文（V3 采样定性信号/主体壁厚链/有无 STL）——仅会话内有效，刷新后 STL 会话已清理
  const ctx = {
    sampling: state.hotspots?.sampling || null,
    bodyRef: state.bodyRef ?? null,
    hasStl: !!state.mesh,
    manual: false,
  };
  // PHASE 78：重渲染前记住正在编辑的输入框（结果页内联参数），渲染后恢复焦点与光标
  const focusId = box.contains(document.activeElement) ? document.activeElement?.id : null;
  /* 153.txt §十.C：结果页内的四态条。状态仍由 computeState() 单一来源判定，
     不另造一套"结果有效"标志；文案只补充"下面是上一次结果"这一层含义。 */
  const resultStatus = resultStatusInfo();
  renderResultsCenter(box, state.results, {
    ctx,
    active: state.activePage,
    status: resultStatus,
    onRerun: () => runAnalysis(container, { keepScroll: true }),
    /* R6-S3：结果页的"去修改"必须回到**唯一编辑入口**（参数面板）。先切回模型视图，
       否则面板被 `.dc-ws[data-wsview="results"] .dc-taskp{display:none}` 隐藏，用户会以为点了没反应。 */
    onEditParam: (path) => {
      setWorkspaceView(container, 'model');
      openParamAt(container, path);
    },
    onNav: (k) => { state.activePage = k; },
    /* S2.2-E/F：结果页内联控件写的仍是**同一份** CastingProject 参数（没有第二套存储）；
       改动必须在 600ms 防抖之前就标记为过期 —— 否则在等待重算的窗口里，
       界面会同时说"参数已改"和"结果与当前参数一致"。
       重算成功后 `runAnalysis` 会清除过期标记，失败则保留并要求处理。 */
    onParamChange: () => {
      markAllStale();
      renderStateChip(container);
      syncFlowChrome(container);
      autoRecompute(container);
    },
    /* 146：**返回按钮由 resultsCenter 自己绑**（它重建 DOM，绑在那边才不会因换页签而丢监听） */
    onBack: () => {
      setWorkspaceView(container, 'model');
      syncFlowChrome(container);   // 回到模型视图后主按钮回到「分析并查看结果 / 重新分析」的正确形态
    },
  });
  if (focusId) {
    const el = box.querySelector('#' + focusId);
    if (el) { el.focus(); try { el.select?.(); } catch (e) {} }
  }
  /* 145 §二 P0-2：**返回工作台不得丢弃已完成的工艺分析结果**。
     原实现是 `state.results = null; box.hidden = true;`——点一下返回，结果对象就没了：
       · 再点「结果」会被 `setWorkspaceView` 判定为"尚未产生分析结果"并弹提示；
       · 步骤卡退回"④ 开始工艺分析并查看结果（未完成）"；
       · 用户想再看结果必须**重新点开始分析重跑一遍**。
     而 `#dc_results` 的 DOM 又没被清空 ⇒ 屏幕上"看不见但还在"的不一致状态。
     现在：只切视图，STL / 三维 / 结果 / 参数一律保留。返回后再点「结果」立即回到同一份结果。 */
  /* ⚠ 「返回三维工作台」的监听**不在这里绑**——resultsCenter 每次重建 DOM 都会自己绑一次
     （见那边 `#dc_again` 的注释）。若在这里再绑一份，本函数每被调用一次就叠加一个监听，
     正好是 R2 踩过的"监听器堆叠"坑。这里只保留独立计算器入口。 */
  const openCalcs = box.querySelector('#dc_openCalcs');
  if (openCalcs) openCalcs.addEventListener('click', () => {
    history.pushState({ view: 'calculators' }, '', '#/calculators');
    window.dispatchEvent(new Event('hashchange'));
  });
}
