// ============================================================
// 铸造工艺设计中心（命令3 第2/3/14/24节；PHASE 71.6 76.txt：删除分析任务选择）
// 核心入口：导入 STL → 自动几何/热结分析 → 统一参数与执行条件（自动值可改，保留原值）
// → 执行 → 三页工艺设计结果（① 结构工艺性 ② 冒口 ③ 浇注 + 收缩率/加工余量/出品率）
// 原则：能从 STL 得到的自动得到；自动参数允许修改（标记来源 + ↺ 恢复）；
//       计算器作为底层能力被调用（calcs/ 纯函数 + adapters 参数投影）——核心公式零改动
// ============================================================
import { parseSTL, computeBounds } from '../engine/stl.js';
import { validateMesh, deriveGeomStatus } from '../engine/meshValidation.js';
import { buildMesh } from '../engine/mesh3d.js';
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
import { RISER_MATERIALS } from '../../calcs/riser.js';
// PHASE 79（79.txt 一）：参数联动提示用既有数据表（出品率区间 / 加工余量等级）——无新增数据、无公式改动
import { resolveYield } from '../../calcs/yield.js';
import { methodGradeRec } from '../../calcs/machining.js';
import { CALC_MANIFEST, allMissingInputs, allOptionalInputs, isMissing, RUN_ORDER } from '../../calcs/calcManifest.js';
import { renderResultsCenter } from './resultsCenter.js';
import { gatingDiagramSvg } from './gatingDiagram.js';
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
/* 计算执行顺序（依赖：shrinkage/machining 独立 → riser → gating（读 riserHeight 回写）→ yield → charge）
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
const SRC_BADGE = {
  STL_GEOMETRY_ANALYSIS: ['🟢', 'STL 自动'],
  DERIVED: ['🔵', '计算得到'],
  USER_INPUT: ['🟡', '用户输入'],
  USER_OVERRIDE: ['🟠', '用户修改'],
  SCENARIO: ['🟡', '生产场景'],
  DEFAULT: ['🟡', '系统默认'],
  CALC_RESULT: ['🔵', '计算结果'],
};
const srcBadgeHtml = (p, path = null) => {
  if (!p) return '';
  const [icon, label] = SRC_BADGE[p.src] || ['🟡', p.src];
  // PHASE 71.5（75.txt §八）：用户覆盖 STL/派生值 → 显示"↺ 恢复自动原值"锚点 + 悬浮原始值
  const canRestore = path && p.src === SRC.USER_OVERRIDE && p.orig && p.editable;
  const origTxt = canRestore ? (Array.isArray(p.orig.v) ? p.orig.v.join('×') : String(p.orig.v)) : '';
  return `<span class="dc-src-badge">${icon} ${tr(label)}${canRestore
    ? ` <button class="dc-reset-orig" type="button" data-reset-orig="${path}" title="${esc(tr('恢复 STL/自动原值（当前：{v}）', [origTxt]))}">↺</button>`
    : ''}</span>`;
};

/** PHASE 71.5：就地刷新一行输入的来源徽章（输入即改来源，无需整组重渲染保焦点/及时反馈） */
function refreshRowBadge(el, path, container) {
  if (!el || !path) return;
  const row = el.closest('.f-row');
  if (!row) return;
  const old = row.querySelector('.dc-src-badge');
  if (!old) return;
  const p = proj.get(path);
  if (!p) return;
  const wrap = document.createElement('span');
  wrap.innerHTML = srcBadgeHtml(p, path);
  const fresh = wrap.firstElementChild;
  old.replaceWith(fresh);
  const rb = fresh.querySelector('[data-reset-orig]');
  rb?.addEventListener('click', () => {
    if (proj.restoreAutoValue(path)) {
      markStale(path);
      renderParams(container);
      autoRecompute(container);
      showToast(tr('↺ 已恢复 STL/自动原值'));
    }
  });
}
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
  unit: 'mm',
  manual: false,     // 手动输入模式（不导入 STL，全部参数手填）
  tasks: new Set(FIXED_CALC_TASKS),   // PHASE 71.6：固定任务集（无 UI 选择）
  results: null,     // {gating, riser, yield, ...}
  stale: new Set(),  // 已完成但参数已变化、需重新计算的模块（19.txt 十）
  busy: false,
  hsFake: false,     // 调试模式：当前显示的是 Fake 热结（badge 区分，不误导）
  bodyRef: null,     // 可信主体壁厚（PHASE 26：V3 采样完成后 = bodyRefOf 完整链；之前 = bodyWallOf）
  activePage: null,  // PHASE 78：结果中心当前页（内联改参数触发重算时保持在原页）
};

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

/**
 * 热结 → 3D 视图对象（PHASE 22）：ENGINE 坐标 → 居中坐标；显示位置 = 引擎位置 +
 * 有界中面修正（displayCenterFor，只读计算坐标）；regionBBox 同步平移。
 * 计算坐标 h.x/y/z 永不修改（30.txt 六：计算位置是真实数据）。
 */
function toViewHotspot(h) {
  const c = state.analysis?.center || [0, 0, 0];
  const dp = displayCenterFor(state.geometry, h, {});
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
  // PHASE 72：换语言会重建视图——顺手关掉热结 Mc 弹窗（其文案属于旧语言；重进视图也一并清理）
  document.querySelector('#dc_hsModal')?.remove();
  container.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${tr('dc.title')}</h1>
      <p class="page-sub">${tr('dc.sub')}</p>
    </div>
    <div class="dc-ws">
      <!-- 顶部信息条：项目 / STL 信息（命令文件第二节） -->
      <div class="dc-topbar">
        <span class="chip" id="dc_fileName" hidden></span>
        <span class="chip dc-meta-chip" id="dc_metaChip" hidden></span>
        <span class="chip" id="dc_unitChip"></span>
        <span class="chip" id="dc_stlStatus" hidden></span>
        <span class="dc-topbar-spacer"></span>
        <button class="btn btn-ghost" id="dc_replaceStl" hidden>📥 ${tr('导入 STL')}</button>
        <button class="btn btn-ghost" id="dc_deleteStl" hidden>🗑️ ${tr('删除 STL')}</button>
        <button class="btn btn-ghost" id="dc_manualLink">📝 ${tr('手动输入')}</button>
        <button class="btn btn-ghost" id="dc_backToStl" hidden>📄 ${tr('改用 STL')}</button>
      </div>
      <!-- 铸件信息卡（19.txt 三：文件名/尺寸/体积/重量/壁厚/Mc/热结/采样状态） -->
      <div class="dc-cast-card" id="dc_castCard" hidden></div>

      <div class="dc-main">
        <!-- 左/中：3D 主视图（约 70%） -->
        <div class="dc-stage">
          <div id="dc_importZone" class="dc-import-zone">
            <div class="dc-import-icon">📂</div>
            <div>${tr('拖拽 STL 到此处，或')} <button class="btn btn-primary" id="dc_pick">${tr('选择 STL 文件')}</button></div>
            <div class="field-hint" style="margin-top:6px">${tr('支持 Binary / ASCII STL · 完全本地解析 · 数据不出本机')}</div>
            <input type="file" id="dc_file" accept=".stl" hidden>
          </div>
          <div id="dc_validate" class="dc-validate" hidden></div>
          <!-- PHASE 22 分析进度条（30.txt 十三：分阶段真实进度） -->
          <div id="dc_progress" class="dc-progress" hidden>
            <div class="dc-progress-bar"><div class="dc-progress-fill" id="dc_progressFill"></div></div>
            <div class="dc-progress-text" id="dc_progressText">${tr('正在分析模型…')}</div>
          </div>
          <div id="dc_hsBadge" class="dc-hs-badge" hidden></div>
          <div id="dc_view3d" class="dc-view3d" hidden>
            <div id="dc_view3dBox" class="dc-view3d-box">
              <button class="dc-view-reset" id="dc_viewReset" title="${esc(tr('重置视角（自适应模型）'))}">⟳ ${tr('重置视角')}</button>
            </div>
            <!-- 底部 Viewer Controls：显示模式 + 视角预设 -->
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
          </div>
        </div>

        <!-- 右侧：Analysis Panel（约 30%，可折叠）
             PHASE 71.7（77.txt 一/四）：① 分析结果概览 = 模型信息枢纽（STL 全部关键数据 + 只读自动值），
             原「模型信息」面板并入此处；参数与执行条件只保留需要用户决策的输入 -->
        <div class="dc-panel" id="dc_panel">
          <div class="dc-panel-sec" id="dc_overviewCard" hidden>
            <div class="dc-panel-title">${tr('dc.overview')}<span class="chip">${tr('dc.overviewChip')}</span></div>
            <div id="dc_overview"></div>
          </div>
          <div class="dc-panel-sec" id="dc_hotspotsCard" hidden>
            <div class="dc-panel-title">${tr('dc.hotspotList')}<span class="chip">${tr('dc.hotspotListChip')}</span></div>
            <div id="dc_hotspotList"></div>
          </div>
          <div class="dc-panel-sec" id="dc_paramsCard">
            <div class="dc-panel-title" data-fold="dc_paramsWrap">${tr('dc.params')}</div>
            <div id="dc_paramsWrap">
              <div id="dc_params"></div>
              <button class="btn btn-primary btn-lg" id="dc_run" style="width:100%;margin-top:4px">${tr('dc.run')}</button>
              <div class="field-hint" style="margin-top:8px" id="dc_runHint"></div>
            </div>
          </div>
        </div>
      </div>
      <div id="dc_results" hidden></div>
    </div>
  `;
  // 导入事件
  const fileEl = container.querySelector('#dc_file');
  container.querySelector('#dc_pick').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => { if (fileEl.files[0]) importFile(container, fileEl.files[0]); });
  const zone = container.querySelector('#dc_importZone');
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = 'var(--primary)'; });
  zone.addEventListener('dragleave', () => { zone.style.borderColor = ''; });
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.style.borderColor = '';
    const f = e.dataTransfer?.files?.[0];
    if (f && /\.stl$/i.test(f.name)) importFile(container, f);
    else if (f) showToast(tr('⚠️ 仅支持 .stl 文件'));
  });
  // 执行分析
  container.querySelector('#dc_run').addEventListener('click', () => runAnalysis(container));
  // STL 替换/删除（18.txt 一/三：替换复用导入路径并先清理旧数据；删除回手动模式）
  container.querySelector('#dc_replaceStl').addEventListener('click', () => fileEl.click());
  container.querySelector('#dc_deleteStl').addEventListener('click', () => deleteStl(container));
  // 手动输入模式入口（不导入 STL 也能用）
  container.querySelector('#dc_manualLink').addEventListener('click', () => showManual(container));
  container.querySelector('#dc_backToStl').addEventListener('click', () => backToStl(container));
  // 3D 控件：重置视角 / 显示模式 / 视角预设
  container.querySelector('#dc_viewReset').addEventListener('click', () => state.view3d?.fit());
  container.querySelector('#dc_dispMode').addEventListener('change', (e) => state.view3d?.setDisplayMode(e.target.value));
  container.querySelectorAll('.dc-view-btns button').forEach(btn => {
    btn.addEventListener('click', () => state.view3d?.setView(btn.dataset.view));
  });
  // 面板折叠（点标题收起/展开）
  container.querySelectorAll('[data-fold]').forEach(title => {
    title.addEventListener('click', () => {
      const wrap = container.querySelector('#' + title.dataset.fold);
      if (wrap) wrap.hidden = !wrap.hidden;
      title.classList.toggle('folded', wrap?.hidden);
    });
  });
  // STL 会话校验（18.txt 四：刷新/新会话时项目里有 STL 数据但内存 mesh 已丢
  // → 清理绑定数据防幽灵 STL；同页路由切换 mesh 仍在 → 不动）
  if (!state.mesh) {
    const r = proj.stlSessionCheck(false);
    if (r.stale) {
      sessionStorage.removeItem(STL_FP_KEY);
      showToast(tr('🔄 页面已刷新：STL 数据已清理（手动输入已保留），请重新导入 STL'));
    }
  }
  // 恢复已有状态（导入后重进视图）
  state.container = container;
  if (state.mesh) restore(container);
  else if (state.manual) showManual(container);
}

/** 铸件信息卡（19.txt 三）：STL 导入后显示模型信息汇总 */
function updateCastCard(container) {
  const card = container.querySelector('#dc_castCard');
  if (!card) return;
  if (!state.mesh) { card.hidden = true; return; }
  const a = state.analysis;
  const hs = state.hotspots;
  const mc = hs?.hotspots?.[0]?.mc;
  const sl = state.hotspots?.sampling;
  // PHASE 17 分级 chip（21.txt 六：🟢正常/🟡局部薄特征/🟠采样不足/🔴无法分析）
  const chipCls = !sl?.warning ? 'chip-ok' : sl.level === 'local_thin' ? 'dc-chip-warn' : 'dc-chip-bad';
  const chipTxt = !sl?.warning ? tr('✅ V3 已分析')
    : sl.level === 'local_thin' ? tr('🟡 局部薄特征')
    : sl.level === 'resolution' ? tr('🟠 采样分辨率不足')
    : tr('🔴 无法可靠分析');
  card.hidden = false;
  card.innerHTML = `
    <span class="dc-cast-name">📄 ${esc(state.fileName)}</span>
    <span class="dc-cast-stats">
      ${a ? a.size.map(v => fmt(v, 0)).join('×') + ' mm · ' : ''}${fmt(proj.getV('geometry.volumeCm3'), 1)} cm³ · ${tr('毛坯')} ${fmt(proj.getV('geometry.blankWeightKg'), 2)} kg · ${tr('壁厚')} ${fmt(proj.getV('process.wallUsed'), 1)} mm · Mc ${fmt(mc, 1)} mm · 🔴 ${tr('{n} 热结', [hs?.hotspots?.length ?? 0])}
      <span class="chip ${chipCls}">${chipTxt}</span>
    </span>`;
}

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
  //   STL 自动值以只读形式列出（要改 → ③ 参数与执行条件 → STL 自动识别展开）。
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
    <div class="field-hint" style="margin-top:8px">${tr('以上为 STL 自动识别结果；需要修改时请到 ③ 参数与执行条件 →「STL 自动识别（可修改）」展开修改，修改后会同步显示在此。')}</div>
    ${samplingDiagHtml()}`;
}

/* ================= 手动输入模式（命令6 反馈：不导入 STL 也可用） ================= */
function showManual(container) {
  state.manual = true;
  container.querySelector('#dc_importZone').hidden = true;
  container.querySelector('#dc_manualLink').hidden = true;
  container.querySelector('#dc_backToStl').hidden = false;
  container.querySelector('#dc_fileName').hidden = true;
  container.querySelector('#dc_metaChip').hidden = true;
  container.querySelector('#dc_validate').hidden = true;
  container.querySelector('#dc_view3d').hidden = true;
  container.querySelector('#dc_replaceStl').hidden = true;
  container.querySelector('#dc_deleteStl').hidden = true;
  // 明确显示模式状态（18.txt 三：删除 STL 后显示"未导入"，不显示旧 STL 数据；
  //   mesh 仍在的主动切换则提示数据保留）
  const stlStatus = container.querySelector('#dc_stlStatus');
  if (stlStatus) {
    stlStatus.hidden = false;
    stlStatus.textContent = state.mesh ? tr('✍️ 手动输入（STL 数据保留）') : tr('📭 未导入 STL（手动输入）');
  }
  renderParams(container);
  // PHASE 72：手动模式下的结果页也要随重渲染恢复（语言切换会重建视图）
  restoreResults(container);
}

/** 结果页恢复（重渲染后：有结果 → 解除隐藏并重画；无结果 → 保持隐藏） */
function restoreResults(container) {
  const box = container.querySelector('#dc_results');
  if (!box) return;
  if (!state.results) { box.hidden = true; return; }
  box.hidden = false;
  renderResults(container);
}

function backToStl(container) {
  state.manual = false;
  container.querySelector('#dc_importZone').hidden = false;
  container.querySelector('#dc_manualLink').hidden = false;
  container.querySelector('#dc_backToStl').hidden = true;
  container.querySelector('#dc_stlStatus').hidden = true;
  // 之前导入过模型则恢复完整状态
  if (state.mesh) restore(container);
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
  updateCastCard(container);
  // 11. 退回手动输入模式（界面明确显示"未导入 STL"）
  showManual(container);
  showToast(tr('🗑️ STL 已删除，已回到手动输入模式'));
}

function restore(container) {
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
  if (!state.view3d) { state.view3d = new ModelView3D(box); state.view3d.load(state.mesh); }
  else box.appendChild(state.view3d.renderer.domElement);
  // 恢复热结标记（Fake 已是居中坐标，直接显示；真实结果经 toViewHotspot：
  // 居中平移 + displayPosition 中面修正——计算坐标不变，PHASE 22）
  if (state.hotspots?.status === HS_STATUS.OK && state.hotspots.hotspots.length) {
    state.view3d.onSelectHotspot = (i) => highlightHotspot(container, i);
    state.view3d.setHotspots(state.hsFake ? state.hotspots.hotspots : state.hotspots.hotspots.map(toViewHotspot));
  }
  // 恢复热结状态条（悬停可见算法各阶段计数）
  if (state.hotspots) updateHsBadge(container);
  updateCastCard(container);
  renderOverview(container);
  renderParams(container);
  renderHotspotList(container);
  restoreResults(container);
}

/* ================= ① 导入 STL ================= */
async function importFile(container, file) {
  if (state.busy) return;
  state.busy = true;
  const runBtn = container.querySelector('#dc_run');
  if (runBtn) runBtn.disabled = true;
  try {
    const buf = await file.arrayBuffer();
    const mesh = parseSTL(buf);            // 先解析：失败即抛 → 旧数据不受影响
    // 替换语义（18.txt 一）：新 STL 解析成功后，先清理旧 STL 绑定数据
    // （geometry/hotspots/STL 派生参数/旧计算结果），再执行新 STL 分析——
    // 保证"STL B 的所有自动参数必须来自 B"。USER_INPUT 保留；USER_OVERRIDE
    // 按强绑定规则清（18.txt 二，新 STL 重新生成）。手动模式导入也走此路径。
    proj.clearStlBoundData();
    sessionStorage.removeItem(STL_FP_KEY);
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
    if (state.view3d) state.view3d.dispose();
    container.querySelector('#dc_importZone').hidden = true;
    container.querySelector('#dc_view3d').hidden = false;
    container.querySelector('#dc_fileName').hidden = false;
    container.querySelector('#dc_fileName').textContent = `📄 ${file.name}`;
    state.view3d = new ModelView3D(box);
    state.view3d.load(state.mesh);

    // 验证结果展示（有 warning/error 不静默，允许继续）
    container.querySelector('#dc_validate').hidden = false;
    container.querySelector('#dc_validate').innerHTML = validateHtml(validation);

    container.querySelector('#dc_params').innerHTML = `<div class="dc-analysis-hint">⏳ ${tr('正在自动分析几何与热结…')}</div>`;

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
    renderParams(container);
    renderOverview(container);
    renderHotspotList(container);
      // 生成结果阶段完成 → 隐藏进度条
    progressTo(container, 'result', 1);
    progressEnd(container);
    // STL 生命周期按钮（18.txt 六：[替换 STL][删除 STL] 在已导入 STL 时可用）
    container.querySelector('#dc_replaceStl').hidden = false;
    container.querySelector('#dc_deleteStl').hidden = false;
    container.querySelector('#dc_stlStatus').hidden = true;
    updateCastCard(container);
    // 热结状态条（3D 视口上方常驻显示，不依赖一闪而过的 toast；悬停可见算法计数）
    updateHsBadge(container);
    const hsMsg = state.hotspots.status === HS_STATUS.OK
      ? tr('✅ 几何与热结分析完成：检测到 {n} 个热结', [state.hotspots.hotspots.length])
      : (state.hsFake
        ? tr('🔧 DEBUG：真实算法{a}，已注入 Fake 热结验证显示链路', [hsReasonText(state.hsFakeReason)])
        : tr('✅ 几何分析完成（热结：{a}）', [hsReasonText(state.hotspots.reason)]));
    showToast(hsMsg);
  } catch (e) {
    showToast(tr('❌ STL 解析失败'));
    console.error('importFile 失败:', e);
    const vEl = container.querySelector('#dc_validate');
    if (vEl) {
      vEl.hidden = false;
      vEl.innerHTML = `<div class="dc-warn">❌ ${tr('处理失败：')}<b>${esc(e.message)}</b><br><span class="field-hint">${tr('可更换 STL 文件重试；若反复失败请反馈（附上文件）。')}</span></div>`;
    }
  } finally {
    state.busy = false;
    if (runBtn) runBtn.disabled = false;
    progressEnd(container);   // 无论成败都隐藏进度条
  }
}

function validateHtml(v) {
  const issues = v?.issues || [];
  if (!issues.length) return `<div class="dc-ok">✅ ${tr('STL 读取成功 · {n} 个三角面 · 网格闭合', [state.mesh?.triCount ?? 0])}</div>`;
  return `<div class="dc-${issues.some(i => i.level === 'error') ? 'warn' : 'ok'}">
    ${issues.some(i => i.level === 'error') ? '⚠️' : 'ℹ️'} ${tr('STL 几何存在问题（部分分析可能受影响）：')}
    <ul>${issues.map(i => `<li><b>${i.code}</b>：${esc(i.msg)}</li>`).join('')}</ul>
    ${tr('已显示 3D 模型，可继续分析或更换文件。')}</div>`;
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

function hsReasonText(reason) {
  return tr({
    [HS_REASON.NO_CANDIDATE]: '未检测到热结候选',
    [HS_REASON.UNIFORM]: '模型壁厚均匀，无相对厚区',
    [HS_REASON.ALL_LOW_CONFIDENCE]: '有候选但置信度不足（详见列表）',
    [HS_REASON.INVALID_MESH]: '网格无效，无法分析',
    [HS_REASON.NO_INSIDE_POINTS]: '无法可靠进行热结分析（未获得有效内部采样点）',
    [HS_REASON.REFINE_LIMIT]: '局部细化超限，置信度不足',
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
    badge.title = `算法内部：gs=${d.gs}³ · vs=${(d.vs || 0).toFixed(2)}mm · 内部点=${d.insidePoints}/${d.totalPoints} · 候选=${d.candidates} · 区域=${d.regions} · 峰=${d.peaks} · 拒绝=${d.rejected} · ${d.elapsedMs}ms`;
  }
  if (state.hsFake) {
    badge.innerHTML = tr('hs.badge.fake', [hsReasonText(state.hsFakeReason)]);
    badge.className = 'dc-hs-badge dbg';
    return;
  }
  if (state.hotspots.status === HS_STATUS.OK && state.hotspots.hotspots.length) {
    const hs = state.hotspots.hotspots;
    badge.innerHTML = tr('hs.badge.ok', [hs.length, fmt(hs[0].mc, 1)]);
    badge.className = 'dc-hs-badge ok';
  } else if (state.hotspots.status === HS_STATUS.LOW_CONFIDENCE && state.hotspots.hotspots.length) {
    badge.innerHTML = tr('hs.badge.lowconf', [state.hotspots.hotspots.length, hsReasonText(state.hotspots.reason)]);
    badge.className = 'dc-hs-badge warn';
  } else if (state.hotspots.status === HS_STATUS.NO_HOTSPOT) {
    // PHASE 28.5（42.txt 十一）：真均匀件 → 明确"未检出"，与"分析失败"分开
    // PHASE 71.5：uniform（真均匀）与 no_candidate（未达阈值，不等于无热节）分开表述，不冒充"均匀属正常"
    const unif = state.hotspots.reason === HS_REASON.UNIFORM;
    badge.innerHTML = unif
      ? tr('hs.badge.uniform', [hsReasonText(state.hotspots.reason)])
      : tr('hs.badge.nocand', [hsReasonText(state.hotspots.reason)]);
    badge.className = 'dc-hs-badge none';
  } else if (state.hotspots.status === HS_STATUS.INSUFFICIENT_RESOLUTION) {
    // 42.txt 六/十一：分析失败绝不能说"属正常"——必须阻断并给出人工入口
    badge.innerHTML = tr('hs.badge.insufficient', [hsReasonText(state.hotspots.reason)]);
    badge.className = 'dc-hs-badge warn';
  } else {
    badge.innerHTML = tr('hs.badge.manual');
    badge.className = 'dc-hs-badge none';
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
  list.innerHTML = hs.hotspots.map((h, i) => `
    <button class="dc-hs-item" data-hs="${i}" title="${esc(h.displayCenterReliable === false
      ? tr('⚠ 该热结位置修正不可靠，当前显示计算坐标（复杂结构或开放边界）')
      : tr('显示位置已按局部壁厚中部修正；计算坐标不受影响'))}">
      <span class="dc-hs-id">${lowConf ? '?' : 'H' + (i + 1)}</span>
      <span class="dc-hs-main">Mc <b>${fmt(h.mc, 1)}</b> mm</span>
      <span class="dc-hs-sub">${fmt(h.regionVolumeCm3, 1)} cm³${h.confidence ? ` · ${tr('置信')} ${Math.round(h.confidence * 100)}%` : ''}</span>
    </button>`).join('');
  list.querySelectorAll('[data-hs]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.hs;
      state.view3d?.selectHotspot(i);
      highlightHotspot(container, i);
    });
  });
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

/* ================= ③ 参数面板（PHASE 71.5 · 75.txt §15/§16：统一输入区，不按计算器分） =================
   四组（工程师视角）：
     ① STL 自动识别 —— 只读/可覆盖，覆盖保留原值（↺ 一键恢复）
     ② 基础工艺参数 —— 全局单次输入（材料；材料一次输入，冒口/浇注/出品率共用）
     ③ 浇注参数 —— 仅「经典浇注系统」勾选时出现（浇注方向/一模件数/Ho/ph）
     ④ 高级参数 —— 默认折叠（成熟计算器已有、普通用户不频繁修改的）
   来源标识：🟢STL 自动 / 🟡用户输入 / 🔵自动计算 / 🟠用户修改（颜色 + 文字，75.txt §十四） */
function renderParams(container) {
  const el = container.querySelector('#dc_params');
  // PHASE 71.7（77.txt 末）：生产场景联动——材料/铸造方法/造型线/生产方式，用户未显式设定过就跟随
  //   首页「生产场景」或顶栏长条填写后，此处自动带出（🟡 生产场景来源），不需要用户重复输入。
  syncFromContext();
  const fam = proj.getV('material.family') || '';
  const manual = state.manual;
  const hasStl = !!state.mesh && !manual;
  container.querySelector('#dc_unitChip').textContent = manual
    ? tr('单位：mm（手动输入固定 mm）')
    : tr('单位：{u}（STL 无单位，按 {u} 计）', [state.unit]);
  const size = proj.getV('geometry.size') || [0, 0, 0];
  const vol = proj.getV('geometry.volumeCm3') || 0;
  const wt = proj.getV('geometry.blankWeightKg') || 0;   // PHASE 28.3-A：毛坯重（计算口径）
  const netWt = proj.getV('geometry.netWeightKg') || 0;  // 净重（STL 派生，只读参考）
  // PHASE 28.3-A：Mc 输入框语义 = 冒口模数来源（有热结→mcHotspot；无→wallHot）
  const mcDisplayPath = () => (proj.getV('hotspots.items') || []).length > 0 ? 'process.mcHotspot' : 'process.wallHot';
  const mcDisplayVal = () => proj.getV(mcDisplayPath()) || 0;
  // 手动模式：未填参数显示空输入框（提示用户填写）
  const vfmt = (v, d) => (manual && !v) ? '' : fmt(v, d);
  // 缺失参数（manifest 判定：只显示还缺的；已有共享参数自动跳过）
  const missing = allMissingInputs([...state.tasks]);
  // PHASE 29（P1-40）：高级参数（optionalInputs 中 param 非 null 的——设计中心折叠区）
  // PHASE 71.6（76.txt 六~九）：已被固定分组承载的项（材料/铸造方法/造型线/型腔数/预估出品率/
  //   浇注位置/Ho/ph/冒口高度/Mc）从高级区排除——避免同参双输入，且这些参数不再"可选隐藏"。
  const FIXED_ROW_PARAMS = new Set(['material.family', 'production.method', 'production.line', 'production.cavities',
    'material.yieldSug', 'process.pourPos', 'process.Ho', 'process.ph', 'process.riserHeight', 'process.mcHotspot',
    'process.gateThk', 'production.ingateN', 'process.runnerThk', 'production.runnerN', 'process.hsPick',
    // PHASE 78/79：结果页内联参数（比例在浇注参数组内渲染，其余在结果页）
    'process.ratioKey', 'process.riserShape', 'process.ventD']);
  const advanced = allOptionalInputs([...state.tasks]).filter(p => !FIXED_ROW_PARAMS.has(p.param));
  // 计算依赖提示（20.txt 八：勾选模块但前置模块未完成 → 明确"需要先完成：XXX"）
  const depWarnings = [];
  for (const id of state.tasks) {
    const c = CALC_MANIFEST.find(x => x.id === id);
    if (!c?.dependsOn || state.results?.[id]) continue;
    const missDeps = c.dependsOn.filter(d => !state.results?.[d]);
    if (missDeps.length === c.dependsOn.length) {
      depWarnings.push(tr('「{a}」需要先完成：{b}（才能获得铁水总重）', [tr(c.name), missDeps.map(d => tr(CALC_MANIFEST.find(x => x.id === d)?.name || d)).join(tr(' 或 '))]));
    }
  }

  /* PHASE 71.6（76.txt 四~九）：固定分组——关键工程参数一律默认展开，不再藏进高级参数。
     ② 基础工艺参数（材料/铸造方法/造型线/型腔数/预估出品率）③ 浇注参数 ④ 冒口参数 ⑤ 高级（真正的低频项） */
  const FAM_OPTS = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];
  const BASE_ROWS = [
    { kind: 'select', input: 'family', param: 'material.family', label: tr('材料大类（一次输入，冒口/浇注/出品率共用）'), options: FAM_OPTS },
    { kind: 'select', input: 'method', param: 'production.method', label: tr('铸造方法'), options: ['不指定', '砂型 · 机器造型/壳型', '砂型 · 手工造型', '金属型（重力/低压）', '压力铸造', '熔模铸造'] },
    { kind: 'select', input: 'line', param: 'production.line', label: tr('造型线'), options: ['不指定', '垂直线', '水平线'] },
    { kind: 'number', input: 'cav2', param: 'production.cavities', label: tr('型腔数（一模件数）'), unit: tr('件') },
    { kind: 'number', input: 'yr2', param: 'material.yieldSug', label: tr('预估出品率（工程预估，非 STL 识别）'), unit: '%' },
  ];
  // PHASE 78：未填（0）时输入框留空 + 占位提示，避免"0 mm"被误读为真实几何值
  const POUR_ROWS = [
    { kind: 'select', input: 'pourPos2', param: 'process.pourPos', label: tr('浇注位置（上注 / 中注 / 下注）'), options: ['顶注', '中注', '底注'] },
    { kind: 'number', input: 'ho2', param: 'process.Ho', label: tr('内浇道至上箱面距离 Ho'), unit: 'mm', placeholder: tr('未填（按 150 计）') },
    { kind: 'number', input: 'ph2', param: 'process.ph', label: tr('铸件高度（浇注方向）ph'), unit: 'mm', placeholder: tr('未填（按 100 计）') },
    // PHASE 79（79.txt 二）：标注 RH —— 与下方浇注方向示意图里的 rh 对应，便于对照看图
    { kind: 'number', input: 'rh2', param: 'process.riserHeight', label: tr('冒口高度 RH（冒口设计后自动回写，可改）'), unit: 'mm', placeholder: tr('冒口设计后自动回写') },
  ];
  // PHASE 78（78.txt 七）：内浇道厚度/个数的输入框已移到结果页「③ 经典浇注系统 → 内浇道」，
  //   参数区不再重复渲染；两者仍在 skipInMissing 中（不落进"还需提供"清单）。
  const INGATE_ROWS = [
    { kind: 'number', input: 'gt2', param: 'process.gateThk', label: tr('内浇道厚度'), unit: 'mm' },
    { kind: 'number', input: 'gc2', param: 'production.ingateN', label: tr('内浇道个数'), unit: tr('个') },
    // PHASE 78（78.txt 二）：浇注系统比例（'' = 自动推荐）——与内浇道同属浇注系统设计口径
    { kind: 'select', input: 'ratio3', param: 'process.ratioKey', label: tr('浇注系统比例 S直:S横:S内'), options: ['', ...Object.keys(RATIO_PRESETS)] },
  ];
  // 固定行已承载的参数 → 从"缺失清单"中去重（避免同参双输入）
  const skipInMissing = new Set([...BASE_ROWS, ...POUR_ROWS, ...INGATE_ROWS].map(p => p.param));
  // 手动模式：① 列已覆盖的核心项不再在右侧重复
  const manualAlready = new Set(['geometry.volumeCm3', 'geometry.blankWeightKg', 'geometry.wallMax', 'process.wallUsed', 'process.mcHotspot', 'process.wallHot']);
  const needRows = missing.filter(p => p.param
    && !skipInMissing.has(p.param)
    && p.param !== 'process.riserHeight'
    && p.param !== 'process.mcHotspot'
    && !(manual && manualAlready.has(p.param)));
  // ④ 冒口参数：Mc 输入框的物理路径 = 当前冒口模数来源（有热结→mcHotspot；无→wallHot），
  //   与 riser 门禁读取路径一致（PHASE 71.6 修复：原先 UI 写 wallHot、门禁读 mcHotspot → 用户输入被当自动值）
  const mcRowHtml = () => {
    const path = mcDisplayPath();
    const p = proj.get(path);
    const canRestore = p && p.src === SRC.USER_OVERRIDE && p.orig;
    const origTxt = canRestore ? String(Array.isArray(p.orig.v) ? p.orig.v.join('×') : p.orig.v) : '';
    return `<div class="field dc-field"><label class="field-label">${tr('热节模数 Mc（冒口设计依据）')}</label>
      <div class="f-row"><input class="field-input" type="number" id="dc_m_mc" value="${esc(mcDisplayVal())}" step="any"><span class="f-unit">mm</span>
      ${srcBadgeHtml(p, path)}</div></div>
      ${canRestore ? `<div class="field-hint">${tr('STL/自动原值：{a} mm · 当前采用：{b} mm（点上方 ↺ 可恢复）', [esc(origTxt), esc(String(p.v))])}</div>` : ''}`;
  };
  const mcNoteText = () => {
    const items = proj.getV('hotspots.items') || [];
    const hsStatus = proj.getV('hotspots.status');
    if (items.length) return tr('自动值 = STL 检出的最大热结模数（热结列表 H1）。检出多个热结时，其余热结可能需分别进行补缩判断。');
    if (hsStatus === 'NO_HOTSPOT' || hsStatus === 'none' || !hsStatus) return tr('未检测到可靠热点，本次冒口 Mc 采用壁厚/结构参考值（主体壁厚 ÷ 2）进行初步估算——不是 STL 识别出的热点，建议结合工艺经验复核。');
    return tr('热结分析未能给出可靠结果：请人工确认热节模数 Mc 后再执行（自动建议已按门禁阻止）。');
  };
  // PHASE 71.7（77.txt 二）：热结选择列表——每个热结一行（勾选=参与冒口设计），勾选/✎ 弹出 Mc 弹窗。
  //   无热结（NO_HOTSPOT / 手动模式）时退回单一 Mc 输入框（wallHot 路径，行为不变）。
  const hsPickHtml = () => {
    const items = proj.getV('hotspots.items') || [];
    if (!items.length) return mcRowHtml();
    const picks = proj.getV('process.hsPick') || [];
    const rows = items.map((h, i) => {
      const pick = picks.find(p => p.id === h.id);
      const on = !!pick;
      const mc = pick ? pick.mc : h.mc;
      const changed = pick && Math.abs(pick.mc - h.mc) > 1e-9;
      return `<div class="dc-hsp ${on ? 'on' : ''}">
        <label class="dc-hsp-main">
          <input type="checkbox" data-hs-pick="${h.id}" ${on ? 'checked' : ''}>
          <span class="dc-hsp-id">H${i + 1}</span>
          <span class="dc-hsp-mc">Mc <b>${fmt(mc, 1)}</b> mm${changed ? ` <span class="chip">${tr('检出')} ${fmt(h.mc, 1)}</span>` : ''}</span>
          <span class="dc-hsp-sub">${tr('区域')} ${fmt(h.regionVolumeCm3, 1)} cm³</span>
        </label>
        <button type="button" class="dc-hsp-edit" data-hs-edit="${h.id}" title="${esc(tr('修改该热结的冒口设计模数'))}">✎ ${tr('改 Mc')}</button>
      </div>`;
    }).join('');
    const nonePicked = picks.length === 0;
    return `<div class="dc-hsp-list" data-hs-list>${rows}</div>
      <div class="field-hint" style="margin-top:4px">${nonePicked
        ? tr('当前为自动模式：按<b>主热结 H1</b> 设计冒口。勾选热结可为选中的每一个分别设计冒口（不勾选的不计算）。')
        : tr('已选 <b>{n}</b> 个热结：冒口设计将分别给出对应方案；取消勾选即不计算该热结。', [picks.length])}</div>`;
  };
  // （mcDisplayVal 已在 ① 列定义：手动模式未填时不显示数字，此处同用）
  // PHASE 78（78.txt 二）：浇注系统比例（S直:S横:S内）——以前只能在结果里看到，现在提前到参数区由用户选；
  //   '' = 自动推荐（按材料 + 铸件重量，recommendGatingRatio）——原行为，保持默认。
  const ratioRowHtml = () => {
    const stored = proj.getV('process.ratioKey') || '';
    const cur = (stored === '' || RATIO_PRESETS[stored]) ? stored : '';
    const autoRec = recommendGatingRatio(matKeyOf(fam || '灰铁'), wt);
    const optTxt = (k) => k === ''
      ? tr('自动推荐（按材料/重量 → {r}）', [tr(autoRec)])
      : `${tr(k)}　${RATIO_PRESETS[k].r.map(v => v.toFixed(2)).join(' : ')}`;
    return `<div class="field dc-field"><label class="field-label">${tr('浇注系统比例（直 : 横 : 内）')}</label>
      <div class="f-row"><select class="field-select" id="dc_m_ratio3">
        ${['', ...Object.keys(RATIO_PRESETS)].map(k => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(optTxt(k))}</option>`).join('')}
      </select>${srcBadgeHtml(proj.get('process.ratioKey'), 'process.ratioKey')}</div>
      <div class="field-hint" style="margin-top:2px">${stored
        ? tr('当前采用「{k}」：按该比例分配直/横/内浇道截面（实际面积比与阻流位置在结果页 ③ 校核）', [esc(tr(stored))])
        : tr('封闭式 = 阻流在内浇口；开放式 = 阻流在直浇道。未选定时按材料与铸件重量自动推荐。')}</div></div>`;
  };

  /* ---------- 分组 HTML（PHASE 71.7 · 77.txt 一/二/四/五：基础参数在前，STL 自动值折叠） ---------- */
  const geoGroupHtml = `
    <div class="dc-group">
      <div class="dc-sec-title">${manual ? tr('① 基础几何参数（手动输入）') : tr('④ STL 自动识别（可修改）')}
        <span class="chip">${manual ? tr('必填核心项') : tr('默认折叠 · 修改见上方概览')}</span></div>
      ${manual ? '' : paramRow('unit', tr('单位'), 'select', ['mm', 'cm', 'm', 'inch'], true, '', null, 'geometry.unit')}
      ${manual ? '' : paramRow('size', tr('外形尺寸 X×Y×Z'), 'text', `${size.map(v => fmt(v, 1)).join(' × ')} mm`, true, '', null, 'geometry.size')}
      ${paramRow('volume', tr('铸件体积'), 'number', vfmt(vol, 2), true, 'cm³', null, 'geometry.volumeCm3')}
      <div class="field dc-field"><label class="field-label">${tr('净重（STL×固态密度）')}</label>
        <div class="f-row"><input class="field-input" type="text" id="dc_p_netWt" value="${vfmt(netWt, 2)} kg" readonly tabindex="-1">${srcBadgeHtml(proj.get('geometry.netWeightKg'), 'geometry.netWeightKg')}</div></div>
      ${paramRow('weight', tr('毛坯重量（含余量，计算口径）'), 'number', vfmt(wt, 2), true, 'kg', null, 'geometry.blankWeightKg')}
      ${paramRow('wallMax', tr('最大壁厚'), 'number', vfmt(proj.getV('geometry.wallMax'), 1), true, 'mm', null, 'geometry.wallMax')}
      ${paramRow('wallMain', tr('主体壁厚'), 'number', vfmt(proj.getV('process.wallUsed'), 1), true, 'mm', null, 'process.wallUsed')}
      <div class="field-hint" style="margin-top:2px">${tr('自动值来自 STL 分析（🟢）；修改后标为 🟠「用户修改」，点 ↺ 可恢复 STL 原值。')}</div>
    </div>`;
  // 手动模式：① 基础几何（手填）在前，其余顺延；STL 模式：基础工艺参数为 ①、STL 自动值为 ④
  const nBase = manual ? '②' : '①';
  const nPour = manual ? '③' : '②';
  const baseGroupHtml = `
    <div class="dc-group">
      <div class="dc-group-title">${nBase} ${tr('基础工艺参数')}<span class="chip">${fam ? tr('当前：{a}', [tr(fam)]) : tr('请选择材料')}</span></div>
      ${BASE_ROWS.map(p => manifestRow(p)).join('')}
      ${linkageHintHtml()}
      ${needRows.length ? `<div class="dc-sec-title" style="margin-top:6px">${tr('还需提供')}</div>${needRows.map(p => manifestRow(p)).join('')}` : ''}
    </div>`;
  const pourGroupHtml = `
    <div class="dc-group">
      <div class="dc-group-title">${nPour} ${tr('浇注参数')}<span class="chip">${tr('浇注系统 / 冒口共用')}</span></div>
      ${POUR_ROWS.map(p => manifestRow(p)).join('')}
      <div class="dc-p1-parthead" style="margin-top:8px">${tr('浇注系统口径')} <span class="chip">${tr('关键工艺决策 · 结果页 ③ 按此计算')}</span></div>
      ${ratioRowHtml()}
      <div class="dc-p1-parthead" style="margin-top:8px">${tr('浇注方向示意图')} <span class="chip">${tr('Ho / ph / rh 的含义见图')}</span></div>
      <div class="dc-gating-diagram">${gatingDiagramSvg(proj.getV('process.pourPos') || '顶注') || ''}</div>
      <div class="field-hint" style="margin-top:2px">${tr('Ho/ph 需结合造型方案确定（STL 无法识别分型面）；未填时按内部兜底 Ho=150 / ph=100 计算——建议填写实际值。')}</div>
      <div class="field-hint" style="margin-top:2px">${tr('📐 内浇道厚度/个数、排气孔数在结果页「③ 经典浇注系统」内直接修改（改后长度/总面积自动重算）。')}</div>
    </div>`;
  const riserGroupHtml = `
    <div class="dc-group">
      <div class="dc-group-title">${manual ? '④' : '③'} ${tr('冒口参数')}<span class="chip">${tr('冒口设计依据')}</span></div>
      ${hsPickHtml()}
      <div class="field-hint" style="margin-top:2px">${mcNoteText()}</div>
    </div>`;
  const advancedGroupHtml = advanced.length ? `
    <div class="dc-group">
      <details class="dc-advanced">
        <summary><span class="dc-group-title">⑤ ${tr('高级参数（可选）')}</span><span class="chip">${tr('{n} 项 · 默认折叠', [advanced.length])}</span></summary>
        <div class="dc-advanced-grid" style="margin-top:6px">${advanced.map(p => manifestRow(p)).join('')}</div>
      </details>
    </div>` : '';

  el.innerHTML = `
    <div class="dc-src-legend">${tr('🟢 STL 自动识别 · 🟡 用户输入/默认 · 🔵 自动计算 · 🟠 用户修改（覆盖自动值，可 ↺ 恢复原值）')}</div>
    <div class="dc-params-input">
      ${depWarnings.length ? `<div class="dc-warn" style="margin-bottom:8px">${depWarnings.map(w => '⚠️ ' + esc(w)).join('<br>')}</div>` : ''}
      ${manual ? geoGroupHtml + baseGroupHtml : baseGroupHtml}
      ${pourGroupHtml}
      ${riserGroupHtml}
      ${manual ? '' : `<div class="dc-group">
        <details class="dc-advanced">
          <summary><span class="dc-group-title">④ ${tr('STL 自动识别（可修改）')}</span><span class="chip">${tr('体积 / 重量 / 壁厚 · 默认折叠')}</span></summary>
          <div style="margin-top:6px">${geoGroupHtml}</div>
        </details>
      </div>`}
      ${advancedGroupHtml}
    </div>
    <div class="field-hint" style="margin-top:10px">${manual
      ? tr('手动模式下请填写体积（或直接填重量）、主体壁厚与 Mc；材料大类选定后密度自动带出。')
      : tr('同一参数被多个计算器共享，只需输入一次，修改后相关结果自动重新计算；STL 自动值在 ④ 中可修改（保留原值、可 ↺ 恢复）。')}</div>
  `;
  // ① 自动参数绑定（V2.2 逻辑保留）
  if (!manual) bindParam(container, 'unit', 'select', (v) => {
    state.unit = v;
    writeGeometryToProject();
    renderParams(container);
  });
  bindParam(container, 'size', 'text', (v) => { /* 只读展示 */ });
  bindParam(container, 'volume', 'number', (v) => {
    v = guardNegative(container.querySelector('#dc_p_volume'), v).val;   // PHASE 73：负值按未填处理
    markStale('geometry.volumeCm3');
    proj.set('geometry.volumeCm3', parseFloat(v) || 0);
    if (manual) {   // 体积→重量联动（尊重手动覆盖，不重渲染保焦点）
      proj.refreshWeight();
      const wEl = container.querySelector('#dc_p_weight');
      const w = proj.getV('geometry.netWeightKg');   // PHASE 28.3-A：净重自动 → 毛坯默认同值（可改）
      // PHASE 73 P2 修复：毛坯重被用户显式改过（USER_OVERRIDE）时不得回填净重——
      //   否则输入框显示 4.2 而计算实际用 4.8，屏幕与口径不一致（refreshWeight 本身有保护，
      //   是这里无条件覆写输入框造成的）。
      const bwP = proj.get('geometry.blankWeightKg');
      const bwUserSet = bwP && (bwP.src === SRC.USER_OVERRIDE || bwP.src === SRC.USER_INPUT);
      if (wEl && !bwUserSet) wEl.value = w ? parseFloat(w.toFixed(2)) : '';
    }
    // PHASE 71.5：数值即来源 → 就地刷新徽章（覆盖/恢复立即可见，75.txt §五）
    refreshRowBadge(container.querySelector('#dc_p_volume'), 'geometry.volumeCm3', container);
    refreshRowBadge(container.querySelector('#dc_p_netWt'), 'geometry.netWeightKg', container);
    refreshRowBadge(container.querySelector('#dc_p_weight'), 'geometry.blankWeightKg', container);
    autoRecompute(container);
  });
  bindParam(container, 'weight', 'number', (v) => {
    v = guardNegative(container.querySelector('#dc_p_weight'), v).val;   // PHASE 73：负值按未填处理
    markStale('geometry.blankWeightKg');
    proj.set('geometry.blankWeightKg', parseFloat(v) || 0);
    refreshRowBadge(container.querySelector('#dc_p_weight'), 'geometry.blankWeightKg', container);
    autoRecompute(container);
  });
  bindParam(container, 'wallMax', 'number', (v) => {
    v = guardNegative(container.querySelector('#dc_p_wallMax'), v).val;   // PHASE 73：负值按未填处理
    markStale('geometry.wallMax');
    proj.set('geometry.wallMax', parseFloat(v) || 0);
    refreshRowBadge(container.querySelector('#dc_p_wallMax'), 'geometry.wallMax', container);
    autoRecompute(container);
  });
  bindParam(container, 'wallMain', 'number', (v) => {
    v = guardNegative(container.querySelector('#dc_p_wallMain'), v).val;   // PHASE 73：负值按未填处理
    markStale('process.wallUsed');
    proj.set('process.wallUsed', parseFloat(v) || 0);
    if (proj.get('process.wallHot').src !== SRC.USER_OVERRIDE) {
      // PHASE 73 P2 修复：toFixed 返回字符串 → 项目里存成 "50.0"（typeof string），破坏数值契约
      proj.set('process.wallHot', parseFloat((parseFloat(v) || 0) / 2).toFixed(1) * 1, SRC.DERIVED, CONF.MEDIUM);
    }
    refreshRowBadge(container.querySelector('#dc_p_wallMain'), 'process.wallUsed', container);
    autoRecompute(container);
  });
  // PHASE 28.3-A / 71.6：Mc 输入框绑定"当前冒口模数来源"（有热结→mcHotspot，无→wallHot），
  //   写入即用户覆盖——riser 门禁按同一路径判定 userMc（写用户值 → 实际使用用户值，不再被当自动值）
  // 注意：④ 冒口参数的 Mc 行 id = #dc_m_mc（manifest 行命名）——绑定按该 id 取元素，
  //   PHASE 71.6 修复：此前沿用 ① 列的 #dc_p_mc，元素改名后取不到 → 监听器未挂 → 输入被回写覆盖（实测 bug）
  const mcEl = container.querySelector('#dc_m_mc');
  mcEl?.addEventListener('input', () => {
    const path = mcDisplayPath();
    markStale(path);
    proj.set(path, parseFloat(mcEl.value) || 0);
    refreshRowBadge(mcEl, path, container);
    autoRecompute(container);
  });
  /* PHASE 71.7（77.txt 二）：热结勾选 / Mc 弹窗 —— 勾选=参与冒口设计（弹窗确认 Mc），取消=不计算 */
  const applyPick = (id, mc) => {
    const rest = (proj.getV('process.hsPick') || []).filter(p => p.id !== id);
    if (mc > 0) rest.push({ id, mc });
    rest.sort((a, b) => a.id - b.id);
    proj.set('process.hsPick', rest, SRC.USER_INPUT, CONF.USER_CONFIRMED);
    renderParams(container);
    autoRecompute(container);
    renderOverview(container);
  };
  // PHASE 78（78.txt 四·交互）：**取消勾选弹窗**——点击勾选框直接生效，Mc 默认采用检出的热结值；
  //   要改模数用右侧「✎ 改 Mc」（唯一弹窗入口）。原实现"点击 → 弹窗 → 确定后不打勾"的根因是
  //   旧持久化项目缺 process.hsPick 字段（proj.set 静默返回 false，见 CastingProject.mergeDeep 修复）。
  container.querySelectorAll('[data-hs-pick]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = +cb.dataset.hsPick;
      const h = (proj.getV('hotspots.items') || []).find(x => x.id === id);
      const det = h?.mc > 0 ? h.mc : 0;
      if (cb.checked) {
        if (!(det > 0)) { cb.checked = false; showToast(tr('⚠️ 该热结无有效模数，请用「✎ 改 Mc」手动填写')); return; }
        applyPick(id, det);
        showToast(tr('✅ 热结 H{n} 已加入冒口设计（Mc = {mc} mm；要改点「✎ 改 Mc」）', [id, fmt(det, 1)]));
      } else {
        applyPick(id, 0);
        showToast(tr('ℹ️ 热结 H{n} 不参与冒口计算', [id]));
      }
    });
  });
  container.querySelectorAll('[data-hs-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = +btn.dataset.hsEdit;
      openHsMcModal(container, id, (mc) => {
        applyPick(id, mc);
        showToast(tr('✅ 热结 H{n} 冒口模数已更新为 {mc} mm', [id, mc]));
      });
    });
  });
  // ↺ 恢复 STL/自动原值（75.txt §八：USER_OVERRIDE + orig 存在才渲染锚点）
  container.querySelectorAll('[data-reset-orig]').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.resetOrig;
      if (proj.restoreAutoValue(path)) {
        markStale(path);
        renderParams(container);
        autoRecompute(container);
        showToast(tr('↺ 已恢复 STL/自动原值'));
      }
    });
  });
  // ②/③/④ 固定行绑定（select → 改后整体重渲；数值参数 → 防抖自动重算，不重渲保焦点）
  const rerenderCb = () => { renderParams(container); autoRecompute(container); };
  const silentCb = () => autoRecompute(container);
  // PHASE 79（79.txt 一）：材料大类切换 → 先带出该材料密度/出品率并重算重量，再重渲染（概览同步）
  const familyCb = () => {
    const fam = proj.getV('material.family');
    if (fam) applyFamilyDefaults(fam);
    renderParams(container);
    renderOverview(container);
    renderHotspotList(container);
    autoRecompute(container);
    showToast(tr('🔄 已切换到「{a}」：密度与重量已按该材料重算', [tr(fam)]));
  };
  BASE_ROWS.forEach(p => bindManifestParam(container, p,
    p.param === 'material.family' ? familyCb : (p.kind === 'select' ? rerenderCb : silentCb)));
  POUR_ROWS.forEach(p => bindManifestParam(container, p, p.kind === 'select' ? rerenderCb : silentCb));
  INGATE_ROWS.forEach(p => bindManifestParam(container, p, () => { renderParams(container); autoRecompute(container); }));
  // 缺失参数绑定（manifest 路径写回共享参数）
  for (const p of missing) {
    if (p.param && (skipInMissing.has(p.param) || (manual && manualAlready.has(p.param)))) continue;   // 固定行已绑定
    bindManifestParam(container, p, () => {
      renderParams(container);   // 已填 → 从"需要提供"消失（自动复用）
      autoRecompute(container);
    });
  }
  // PHASE 29（P1-40）：高级参数绑定（④ 折叠区；写回 project → calculate 消费；
  //   select 改后整组重渲（选项值变化要刷新徽章），数值输入只防抖重算不重渲——保输入焦点）
  for (const p of advanced) bindManifestParam(container, p, p.kind === 'select' ? rerenderCb : silentCb);
}

/**
 * PHASE 71.7（77.txt 二）：热结 Mc 编辑弹窗。
 * 勾选热结 / 点「✎ 改 Mc」时弹出：显示该热结的检出模数与区域体积，允许采用或修改 Mc。
 * @param {HTMLElement} container
 * @param {number} hsId 热结 id（hotspots.items 的 id）
 * @param {(mc:number)=>void} onOk 确定（mc > 0）
 * @param {()=>void} [onCancel] 取消（勾选框需回退）
 */
function openHsMcModal(container, hsId, onOk, onCancel) {
  const items = proj.getV('hotspots.items') || [];
  const idx = items.findIndex(x => x.id === hsId);
  const h = items[idx];
  const pick = (proj.getV('process.hsPick') || []).find(p => p.id === hsId);
  const detMc = h?.mc ?? 0;
  const cur = pick ? pick.mc : parseFloat(detMc.toFixed(1));
  document.querySelector('#dc_hsModal')?.remove();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay active';
  ov.id = 'dc_hsModal';
  ov.innerHTML = `
    <div class="modal" style="max-width:390px">
      <div class="modal-head"><div class="modal-title">🔥 ${tr('热结 H{n} · 冒口设计模数', [idx + 1])}</div>
        <button class="modal-close" data-hs-cancel aria-label="${esc(tr('common.close'))}">✕</button></div>
      <p class="field-hint" style="line-height:1.7;margin:2px 0 12px">
        ${tr('STL 分析结果：区域体积 {v} cm³ · 检出模数 Mc = <b>{mc} mm</b>。', [fmt(h?.regionVolumeCm3, 1), fmt(detMc, 1)])}<br>
        ${tr('冒口将按下面填写的模数设计（默认即检出值，可直接采用）。')}</p>
      <div class="field"><label class="field-label">${tr('冒口设计模数 Mc')}</label>
        <div class="f-row"><input class="field-input" type="number" id="dc_hsMc" value="${esc(cur)}" step="any" min="0.1"><span class="f-unit">mm</span></div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-hs-cancel style="flex:1">${tr('common.cancel')}</button>
        <button class="btn btn-primary" data-hs-ok style="flex:1">${tr('common.confirm')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelectorAll('[data-hs-cancel]').forEach(b => b.addEventListener('click', () => { close(); onCancel?.(); }));
  ov.addEventListener('click', (e) => { if (e.target === ov) { close(); onCancel?.(); } });
  ov.querySelector('[data-hs-ok]').addEventListener('click', () => {
    const v = parseFloat(ov.querySelector('#dc_hsMc').value);
    if (!(v > 0)) { showToast('⚠️ 请输入有效的冒口设计模数 Mc'); return; }
    close();
    onOk(v);
  });
  setTimeout(() => ov.querySelector('#dc_hsMc')?.select(), 30);
}

/** manifest 参数行渲染（select/number/dims3；来源徽章） */
function manifestRow(p) {
  // PHASE 73：manifest 声明的标签/模块名走双语（标签来自 calcs/calcManifest.js，只翻显示）
  const label = tr(p.label) + (p.forCalcs?.length > 1 ? ` <span class="chip">${p.forCalcs.map(tr).join('、')}${tr('共用')}</span>` : '');
  const badge = p.param ? srcBadgeHtml(proj.get(p.param), p.param) : '';
  if (p.kind === 'select') {
    // PHASE 29：值不在 options（如 production.method='不指定'）时回退 options[0]——避免选中态与存储值错位
    const stored = proj.getV(p.param);
    const cur = p.options.includes(stored) ? stored : p.options[0];
    // PHASE 72：option 的 value 恒为中文数据键（写回项目用），只翻显示文本
    return `<div class="field dc-field"><label class="field-label">${label}</label>
      <div class="f-row"><select class="field-select" id="dc_m_${p.input}">
        ${p.options.map(o => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(tr(o))}</option>`).join('')}
      </select>${p.unit ? `<span class="f-unit">${p.unit}</span>` : ''}${badge}</div></div>`;
  }
  if (p.kind === 'dims3') {
    // 三方向输入（19.txt：线收缩率按方向；写回 geometry.size 数组对应位）
    const arr = proj.getV(p.param) || [0, 0, 0];
    return `<div class="field dc-field"><label class="field-label">${label}</label>
      <div class="f-row dims3-row">${['X', 'Y', 'Z'].map((ax, i) => `
        <span class="dims3-item"><input class="field-input" type="number" id="dc_m_${p.input}_${i}" value="${arr[i] > 0 ? esc(fmt(arr[i], 1)) : ''}" step="any"><span class="f-unit">${ax} mm</span></span>`).join('')}
        ${badge}</div></div>`;
  }
  const v = p.useMax && Array.isArray(proj.getV(p.param)) ? Math.max(...proj.getV(p.param)) : proj.getV(p.param);
  // PHASE 71.7：placeholder 行（如内浇道"留空=推荐值"）—— 0/空 时输入框留空并显示推荐占位
  const empty = (v === undefined || v === null || v === '' || (p.placeholder && !(v > 0)));
  const val = empty ? '' : fmt(v, 1);
  return `<div class="field dc-field"><label class="field-label">${label}</label>
    <div class="f-row"><input class="field-input" type="number" id="dc_m_${p.input}" value="${esc(val)}" step="any" min="0"${p.placeholder ? ` placeholder="${esc(p.placeholder)}"` : ''}>
    ${p.unit ? `<span class="f-unit">${p.unit}</span>` : ''}${badge}</div></div>`;
}

/** manifest 参数绑定：写回 CastingProject（共享），useMax 数组写回原数组 */

/* ============================================================
   PHASE 73 P1 修复：设计中心数字输入**下限守卫**。
   问题：`<input type="number" step="any">` 没有 min，也没有校验——
     输入 冒口高度 RH = -500 → 平均静压头 Hp = 926（方向反了）；
     输入 RH = 5000 → Hp = -5281、阻流截面 A = 0.00、直浇道 ⌀5mm，
     这些**照样作为"设计结果"展示**（负压头/零面积）。
   口径：本项目里数值参数的 0 一律是"未填/自动"（Ho=0→按 150 计、mcHotspot=0→走壁厚路径…），
     负数在任何一条里都没有意义。因此负值 → 按 0 处理（回到"未填"），并把输入框清空让
     显示与口径一致，同时给一次明确提示——遵循项目"非法输入不静默"的既有纪律。
   ============================================================ */
const NEG_MSG = '⚠️ 该参数不能为负数，已按「未填」处理（0 = 未填 / 自动）';
function guardNegative(el, rawVal) {
  const v = parseFloat(rawVal);
  if (!(v < 0)) return { val: rawVal, blocked: false };
  el.value = '';
  const now = Date.now();
  if (!guardNegative._t || now - guardNegative._t > 2000) { guardNegative._t = now; showToast(tr(NEG_MSG)); }
  return { val: '0', blocked: true };
}

function bindManifestParam(container, p, after) {
  if (p.kind === 'dims3') {
    ['X', 'Y', 'Z'].forEach((ax, i) => {
      const el = container.querySelector(`#dc_m_${p.input}_${i}`);
      if (!el) return;
      el.addEventListener('input', () => {
        const arr = [...(proj.getV(p.param) || [0, 0, 0])];
        const g = guardNegative(el, el.value);
        arr[i] = parseFloat(g.val) || 0;
        proj.set(p.param, arr);
        markStale(p.param);
        after?.();
      });
    });
    return;
  }
  const el = container.querySelector('#dc_m_' + p.input);
  if (!el) return;
  const evt = p.kind === 'select' ? 'change' : 'input';
  el.addEventListener(evt, () => {
    let val = el.value;
    if (p.kind === 'number') { const g = guardNegative(el, val); val = parseFloat(g.val) || 0; }
    if (p.useMax && Array.isArray(proj.getV(p.param))) {
      const arr = [...proj.getV(p.param)];
      const mi = arr.indexOf(Math.max(...arr));
      arr[mi] = val;
      proj.set(p.param, arr);
    } else {
      proj.set(p.param, val);
    }
    markStale(p.param);
    // PHASE 71.5：就地刷新徽章（manifest 行输入即改来源；select 行整组重渲前的即时反馈）
    refreshRowBadge(el, p.param, container);
    // 材料大类 → 液态/固态密度 + 出品率区间联动（PHASE 28.3-A：双密度，数值取自既有材料表不变）
    if (p.param === 'material.family') applyMaterialDefaults(val);
    after?.();
  });
}

/** 参数变化 → 标记使用该参数的已完成模块需重新计算（19.txt 十：不偷偷用旧结果）
 *  PHASE 71.6：任务勾选 UI 已删（模块状态徽标随之移除）；实际行为仍是"有结果时自动重算"。 */
function markStale(paramPath) {
  if (!state.results) return;
  for (const id of PARAM_OWNERS.get(paramPath) || []) {
    if (state.results[id]) state.stale.add(id);
  }
}

/** 自动重算（命令 9.txt STEP 5：修改共享参数后相关结果自动重新计算）——已有结果时防抖重跑 */
function autoRecompute(container) {
  if (!state.results) return;
  clearTimeout(autoRecompute._h);
  autoRecompute._h = setTimeout(() => {
    if (!state.results) return;
    // PHASE 78：结果页内联改参数也走这条链 → keepScroll（不跳回顶部、保持当前结果页与输入焦点）
    runAnalysis(container, { keepScroll: true });
    showToast(tr('🔄 共享参数已变化，结果已自动重新计算'));
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
function linkageHintHtml() {
  const fam = proj.getV('material.family');
  const parts = [];
  if (fam) {
    const rm = RISER_MATERIALS[fam];
    const md = GATING_MATS[matKeyOf(fam)];
    if (rm && md) parts.push(tr('密度 <b>固 {a} / 液 {b} g/cm³</b>', [fmt(rm.rho, 2), fmt(md.rho, 2)]));
  }
  const line = proj.getV('production.line');
  const y = fam ? resolveYield(matKeyOf(fam), null, line && line !== '不指定' ? line : null) : null;
  if (y?.range) parts.push(`${tr('出品率参考')} <b>${y.range[0]}~${y.range[1]}%</b>${line && line !== '不指定' ? `（${esc(tr(line))}）` : ''}`);
  const method = proj.getV('production.method');
  if (fam && method && method !== '不指定') {
    const mk = { '灰铁': '灰铸铁', '球铁': '灰铸铁', '铸钢': '铸钢', '铝合金': '铝合金', '铜合金': '铝合金' }[fam];
    const rec = methodGradeRec(method, mk);
    parts.push(rec ? `${tr('加工余量等级')} <b>RMAG ${rec.join ? rec.join('~') : rec}</b>` : tr('加工余量：该组合无标准等级'));
  }
  if (!parts.length) return '';
  return `<div class="dc-link-hint">📎 ${tr('当前联动：')}${parts.join(' · ')}——${tr('改上面的材料/造型线/铸造方法，这些值会立即随动')}</div>`;
}

/** 材料大类 → 密度/出品率区间（材料表既有数值，不新增数据；冒口固态密度用 riser 表） */
function applyMaterialDefaults(fam, src = SRC.SCENARIO, conf = CONF.MEDIUM) {
  const md = GATING_MATS[matKeyOf(fam)];
  const rm = RISER_MATERIALS[fam];
  if (md) {
    proj.set('material.liquidDensity', md.rho, src, conf);
    proj.set('material.yieldMin', md.y_min, src, conf);
    proj.set('material.yieldMax', md.y_max, src, conf);
    proj.set('material.yieldSug', md.y_sug, src, conf);
  }
  if (rm) proj.set('material.solidDensity', rm.rho, src, conf);
  proj.refreshWeight();
}

/* PHASE 71.7（77.txt 末）：生产场景联动的实现已迁至 CastingProject.syncFromContext（可单测）；
   设计中心只负责：把场景里的材料归一为材料大类 + 提供材料默认值回填函数。 */
function syncFromContext() {
  const ctx = context.get();
  if (!ctx) return;
  if (ctx.material) ctx.family = context.familyOf(ctx.material) || ctx.material;
  proj.syncFromContext(ctx, (fam) => applyMaterialDefaults(fam, SRC.SCENARIO, CONF.MEDIUM));
}

function paramRow(id, label, kind, val, editable = true, unit = '', selValue = '', srcPath = null) {
  const badge = srcPath ? srcBadgeHtml(proj.get(srcPath), srcPath) : '';
  if (kind === 'select') {
    const cur = selValue || val[0];
    return `<div class="field dc-field"><label class="field-label">${label}${editable ? '' : ' <span class="dc-required">*</span>'}</label>
      <div class="f-row"><select class="field-select" id="dc_p_${id}">
        ${val.map(o => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}
      </select>${unit ? `<span class="f-unit">${unit}</span>` : ''}${badge}</div></div>`;
  }
  // number / text：val 即当前值
  return `<div class="field dc-field"><label class="field-label">${label}${editable ? '' : ' <span class="dc-required">*</span>'}</label>
    <div class="f-row"><input class="field-input" type="${kind}" id="dc_p_${id}" value="${esc(val)}" ${kind === 'number' ? 'step="any"' : ''}>${unit ? `<span class="f-unit">${unit}</span>` : ''}${badge}</div></div>`;
}

function bindParam(container, id, kind, fn) {
  const el = container.querySelector('#dc_p_' + id);
  if (!el) return;
  const evt = kind === 'select' ? 'change' : 'input';
  el.addEventListener(evt, () => fn(el.value));
}

/* ================= 执行分析 =================
   V2.3（命令 9.txt）：manifest 驱动——勾选任务按 calcManifest 声明执行，
   共享参数自动复用（calculate 内从 CastingProject 取），缺失参数在分页输入中补齐。 */
function runAnalysis(container, opts = {}) {
  if (state.busy) { showToast(tr('⏳ 分析中，请稍候再执行')); return; }
  // PHASE 29（R2）STL 质量门禁：INVALID 阻止自动工艺建议（不静默）；OPEN_MESH 显著警示
  // PHASE 71.6 修复：门禁只对"本会话导入了 STL"生效——geometry.valid 默认 false（=无 STL），
  //   对所有任务一刀切会让手动输入模式永远无法执行（实测：手动模式点执行被 STL 门禁挡住）。
  const hasStlNow = !!state.mesh && !state.manual;
  const valid = proj.get('geometry.valid');
  if (hasStlNow && valid && valid.v === false) {
    showToast(tr('❌ STL 网格无效（空/损坏/含非法顶点）：已阻止自动工艺建议。请更换 STL 文件，或切手动模式输入参数。'));
    return;
  }
  const issues = hasStlNow ? (proj.getV('geometry.meshIssues') || []) : [];
  if (issues.some(i => typeof i === 'string' && i.includes('未闭合'))) {
    showToast(tr('⚠️ 网格未闭合：体积/重量链可能偏小，自动建议仅供参考（建议修复 STL 后重导入）'));
  }
  const fam = proj.getV('material.family');
  if (!fam) { showToast(tr('⚠️ 请先选择材料大类')); container.querySelector('#dc_m_family')?.focus(); return; }
  const wt = proj.getV('geometry.blankWeightKg');
  if (!wt || wt <= 0) { showToast(tr('⚠️ 毛坯重量无效，请检查体积/固态密度或手动填写')); return; }
  const tasks = [...state.tasks];   // PHASE 71.6：固定任务集（无 UI 选择，始终全部执行）

  const results = {};
  // 按依赖顺序执行（RUN_ORDER：shrinkage/machining 独立 → gating/riser → yield → charge）
  for (const id of RUN_ORDER) {
    if (!tasks.includes(id)) continue;
    const m = CALC_MANIFEST.find(c => c.id === id);
    if (!m) continue;
    try {
      const r = m.calculate(results);
      results[id] = r;
      // 结果写回项目（共享：runner.result / risers.items / yield.result）
      // PHASE 71.6 修复：riser 结果存在（门禁阻止时为真值对象）→ 写入结果；回写前判空
      if (r && !r.blocked) {
        if (id === 'gating') proj.setResult('runner.result', r);
        if (id === 'riser') {
          // PHASE 71.7：多热结 → 全部冒口入库（risers.items）；单热结 = [r]
          proj.setResult('risers.items', (r.items && r.items.length) ? r.items : [r]);
          // PHASE 28.3-B：冒口高度回写（gating Hp 方案 A 用；用户手动改过则尊重）
          // 健壮性（PHASE 71.6）：旧持久化项目可能无 process.riserHeight 字段 →
          //   proj.get() 返回 null，直接读 .src 抛 TypeError → 被下方 catch 吞掉
          //   → results.riser = null → 用户勾了冒口却看不到任何结果（已实测复现的 bug 之一）。
          const rh = proj.get('process.riserHeight');
          if (!rh || rh.src !== SRC.USER_OVERRIDE) {
            proj.setResult('process.riserHeight', r.H);
          }
        }
        if (id === 'yield') proj.setResult('yield.result', r);
      }
    } catch (e) {
      console.error(`[${id}] 计算失败:`, e);
      results[id] = null;
    }
  }

  state.results = results;
  state.stale.clear();             // 重算完成 → 清除"需重算"标记（19.txt 十）
  proj.exportToContext(context);   // 同步生产场景（计算器预填）
  const box = container.querySelector('#dc_results');
  box.hidden = false;
  renderResults(container);
  // PHASE 78（78.txt 七/八）：结果页内联改参数（内浇道厚度/个数、排气孔数、冒口形状）触发的重算
  //   保持当前结果页与滚动位置，并把焦点还给刚在编辑的那个输入框（连续输入不被打断）
  if (!opts.keepScroll) box.scrollIntoView({ behavior: 'smooth' });
}

/* ================= 结果（PHASE 71.5：三页结果中心；data-calc-link 绑定移交 resultsCenter 随重渲染重建） ================= */
function renderResults(container) {
  const box = container.querySelector('#dc_results');
  // Page1 内存态上下文（V3 采样定性信号/主体壁厚链/有无 STL）——仅会话内有效，刷新后 STL 会话已清理
  const ctx = {
    sampling: state.hotspots?.sampling || null,
    bodyRef: state.bodyRef ?? null,
    hasStl: !!state.mesh,
    manual: !!state.manual,
  };
  // PHASE 78：重渲染前记住正在编辑的输入框（结果页内联参数），渲染后恢复焦点与光标
  const focusId = box.contains(document.activeElement) ? document.activeElement?.id : null;
  renderResultsCenter(box, state.results, {
    ctx,
    active: state.activePage,
    onNav: (k) => { state.activePage = k; },
    onParamChange: () => autoRecompute(container),
  });
  if (focusId) {
    const el = box.querySelector('#' + focusId);
    if (el) { el.focus(); try { el.select?.(); } catch (e) {} }
  }
  // 重新分析按钮
  const again = box.querySelector('#dc_again');
  if (again) again.addEventListener('click', () => {
    state.results = null;
    box.hidden = true;
    container.querySelector('#dc_run').scrollIntoView({ behavior: 'smooth' });
  });
  const openCalcs = box.querySelector('#dc_openCalcs');
  if (openCalcs) openCalcs.addEventListener('click', () => {
    history.pushState({ view: 'calculators' }, '', '#/calculators');
    window.dispatchEvent(new Event('hashchange'));
  });
}
