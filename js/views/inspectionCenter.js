// ============================================================
// 工艺检测中心 Process Inspection Center
//   PHASE 88（88.txt）：多热结 / 多冒口 / 关系检查 / 几何统计
//   PHASE 89（89.txt）：输入简化为「产品 + 冒口 + 一整份浇注系统」
//   PHASE 90/91/92：浇注系统全自动连接检测 + 流道网络追踪
//   ★ PHASE 93（93.txt）：**产品路线收敛**。见下。
//
// ============================================================
// PHASE 93 的产品结论（93.txt §一）——这一页现在的定位
// ============================================================
//   经过 89/90/91/92 的真实测试，已经确认：
//     "完整浇注系统 STL → 自动识别直浇道/横浇道/内浇口 → 自动恢复拓扑"
//     当前算法复杂度高，实际工程结果不够可靠。
//   所以本页**不再以"自动识别浇注系统"为目标**，路线改为：
//
//       工程语义由用户提供（这是产品 / 这是冒口 / 这是直浇道 …）
//       软件负责几何识别、几何测量、工程计算、可视化、检查
//
//   核心原则（93.txt §一）：**宁可让用户多做一点明确的输入，
//   也不要让程序猜错一个关键工程量。**
//
//   本阶段正式实现：**冒口检测**（产品 + 冒口 → 模数比）。
//   浇注系统检测：显示「即将支持」，不再向普通用户暴露 PHASE 92 的自动识别（§五/§十四）。
//
// ============================================================
// PHASE 94（94.txt，代号"PHASE 93-B"）—— 浇注系统检测按同一条路线做出来了
// ============================================================
//   94.txt §一 把"用户给语义 → 软件算几何"这条路走完第二步：
//     用户导入【直浇道 STL】【横浇道 STL】【内浇口 STL】（各 1 个文件，§二），
//     每个文件里有多少个独立实体由**几何连通分量**说了算（§二：不按文件数算数量），
//     程序逐个量截面、按类别求和、算三者比例。
//
//   一句话（94.txt 结尾）：**用户告诉软件它是什么，软件准确告诉用户
//   它有多少、尺寸多大、截面积多少，以及三者比例。**
//
//   ★ 本页在 PHASE 94 里**一句工程判断都不加**（§九）：
//     不判断比例合不合理、不判断内浇口小不小、不算流速 / 流量 / 充型时间 / 湍流。
//     判据只有"量得出来 / 量不出来"，量不出来给 WARNING + null，绝不给假精度（§六/§十八）。
//   ★ PHASE 89~92 的自动追踪链一行没删（§十六），仍在下面 `#pi_gating` 那一段里，
//     但它**不是**本阶段的路，也不进普通用户主流程。
//
// 边界：
//   不做流速 / 流量 / 充型时间 / 分流比例 / 压头 / 湍流判断（93.txt §十七：先把
//   "几何截面积可靠"证明出来，再谈 面积 → 流量 → 流速 → 工艺判断）。
//   不做冷铁 / 凝固动画 / 数值模拟 / 新的热点算法。
//   禁止把模数比说成"一定不会缩孔 / 一定能补缩 / 工艺一定正确"（§十末段）。
//
// 复用什么：
//   STL 解析与体积/面积/包围盒 → engine/stl.js（既有纯函数）
//   几何距离场 + Hotspot V3    → engine/geometryAnalysis.js + engine/v3/hotspotV3.js
//   3D 查看与拾取               → views/components/modelView3D.js（PHASE 90 加 setFlowOverlay、
//                                 PHASE 93 加 setHighlight，都是**追加式**，不动 3D engine 结构）
//   连通分量 / 子集             → model/meshComponents.js（通用工具）
//   单对象几何度量              → model/objectMetrics.js（M = V/A 的唯一实现；
//                                 PHASE 94 追加了 withPoly / axisLengthMm，纯 additive）
//   冒口→最近热点 / 模数比       → model/processInspection.js 的 buildRiserRows（PHASE 93 新增）
//   截面形状识别（圆/方/梯/异形）→ model/sectionShape.js（PHASE 94 新增）
//   浇注系统三类汇总 / 比例      → model/processInspection.js 的 buildGatingAreas（PHASE 94 新增）
//
// 冻结：js/engine/ 本阶段**零改动**（93.txt §二/§十八.1；94.txt §十八 同一条）；Hotspot V3 冻结。
// ============================================================
import { parseSTL } from '../engine/stl.js';
import { validateMesh } from '../engine/meshValidation.js';
import { buildMesh } from '../engine/mesh3d.js';
import { analyzeGeometrySliced } from '../engine/geometryAnalysis.js';
import { analyzeHotspotsV3Sliced } from '../engine/v3/hotspotV3.js';
// PHASE 95：bodyRefOf = 可信主体壁厚链（PHASE 26 定稿：bodyWallOf + tP50 取大）。
//   浇注时间公式需要"主体壁厚"，这里**复用设计中心同一条链**，不另起一套口径。
import { toViewResult, bodyRefOf } from '../engine/v3/v3ViewAdapter.js';
// PHASE 95：材质表来自经典浇注系统计算器（唯一来源），检测中心不复制密度表
import { MATERIALS } from '../../calcs/gating.js';
import { ModelView3D } from './components/modelView3D.js';
import { objectMetrics } from '../model/objectMetrics.js';
import { sectionShapeOf, SECTION_TYPE, SECTION_REASON } from '../model/sectionShape.js';
import { triangleComponents, meshSubset } from '../model/meshComponents.js';
import {
  findConnections, traceFlow, flowSummary, flowDiagnostics,
  FLOW_LABEL, FLOW_REASON, SAMPLE_REASON, FLOW_CONFIG, NODE_KIND,
} from '../model/flowTrace.js';
import {
  KIND, KIND_META, LEVEL, MODULUS_RATIO_MIN,
  makeObject, objectsFromComponents,
  // PHASE 93 §九~§十三：冒口检测（冒口 → 最近热点 / 模数比）
  buildRiserRows, summarizeRisers, RISER_CODE, RISER_REASON,
  // PHASE 94 §二~§九：浇注系统手动语义版（用户给语义 → 程序数单元 / 量截面 / 求和 / 比例）
  GATING_KINDS, GATING_REASON, GATING_CODE,
  gatingUnitsFromComponents, buildGatingAreas, summarizeGatingAreas,
  // PHASE 95 §六/§十：浇注工艺计算（产品体积 → 重量 → 浇注时间 → 流量 → 内浇口速度）
  productVolumeOf, buildPouringResult, POUR_CODE, POUR_REASON, SYSTEM_TYPE,
  // PHASE 96 §十一~§十五：工艺参数优先级的纯解析（生产场景 → 检测中心）
  resolveProcessParams, PARAM_SRC,
} from '../model/processInspection.js';
// PHASE 96 §十一：生产场景（ct-context）与设计中心项目（ct-project）—— **只读**。
//   材质在 context；浇注系统类型（process.ratioKey → RATIO_PRESETS[].type）与
//   出品率（material.yieldSug）在设计中心项目里。两者都不复制密度（§十四）。
import * as context from '../context.js';
import * as proj from '../model/CastingProject.js';
// PHASE 97 §四~§十：内浇口进给方向由**与产品/横浇道的真实连接面**决定（不是继续猜主轴）
import { resolveIngateDirection, DIR_ROLE, DIR_CONF, DIR_SOURCE } from '../model/ingateConnection.js';
import { buildTriGrid } from '../model/meshDistance.js';
import { meshDiagonal } from '../model/meshComponents.js';
import { RATIO_PRESETS } from '../../calcs/gating.js';
import { t as tr } from '../i18n/index.js';
import { markRelocalizable } from '../i18n/viewState.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');

/* ---- PHASE 95：材料大类 → 经典浇注系统计算器的材料键 ----
   ⚠ 与 calcs/calcManifest.js 的 matKeyOf 是**同一张表**（测试 95-N 逐项断言两者一致）。
      这里不直接 import calcManifest，是因为它会连带 import js/model/CastingProject.js
      （项目参数中心），检测中心不需要那套东西 —— 用 5 行映射换掉一整棵依赖树。
      唯一的真相仍是 calcs/gating.js 的 MATERIALS（密度/公式分派都从那里来）。 */
const MAT_FAMILIES = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];
const MAT_KEY_OF = {
  '灰铁': '灰铁(HT)', '球铁': '球铁(QT)', '铸钢': '铸钢(ZG)', '铝合金': '铝合金(Al)', '铜合金': '铜合金(Cu)',
};
const matKeyOfFamily = (fam) => MAT_KEY_OF[fam] || MAT_KEY_OF['灰铁'];

/** 3D 场景配色（沿用设计中心 5 色轮的语义分工，不引入新调色板）
 *  PHASE 94：浇注系统三类别各给一色 —— 3D 里一眼能看出"绿的是直浇道、蓝的是横浇道、
 *  粉的是内浇口"，这是 94.txt §十一"点详细信息里的 R1/G1/I1 能定位到组件"的前提。 */
const KIND_COLOR = {
  [KIND.PRODUCT]: 0x9fb4d4,
  [KIND.RISER]: 0xfbbf24,
  [KIND.GATING]: 0x34d399,
  [KIND.SPRUE]: 0x34d399,
  [KIND.RUNNER]: 0x60a5fa,
  [KIND.INGATE]: 0xf472b6,
};
/** PHASE 90 §十五：流道叠加层配色（沿用设计中心的语义分工，不引入新调色板） */
const FLOW_COLOR = {
  connection: 0xff8a65,   // 产品连接口
  path: 0x60a5fa,         // flow path 折线
  branch: 0xa78bfa,       // 交汇点（PHASE 92 起是**节点**，不再是"分叉点"）
  terminal: 0x34d399,     // 末端（PHASE 92）
  minArea: 0xff5252,      // 最小截面积位置
  areaJump: 0xffd54f,     // 明显面积变化位置
};
/** 逐条边的基础色（§十五：不同 Edge 用不同材质，但不引入 legend 系统）——
    只区分"第几条边"，不表达任何工艺含义，配色在蓝—青—绿—黄之间循环 */
const EDGE_COLORS = [0x60a5fa, 0x22d3ee, 0x4ade80, 0xfacc15, 0xf472b6, 0xfb923c, 0xa78bfa, 0x38bdf8];
/** 工程语义标签的显示文案（§十二：只是辅助解释，不是核心结果） */
const LABEL_TEXT = {
  [FLOW_LABEL.INGATE]: '可能的内浇口区域',
  [FLOW_LABEL.RUNNER]: '可能的横浇道区域',
  [FLOW_LABEL.SPRUE]: '可能的直浇道区域',
  [FLOW_LABEL.CHANNEL]: '几何通道',
};

/* ---- 模块状态（离开视图保持；清空按钮重置） ---- */
let state = {
  product: null,     // {name, mesh, metrics, bounds, components, objects, validation, geometry, analysis, hotspots, hotspotsStatus}
  risers: [],        // 多实例（同一 STL 内多个组件也会自动展开为 R1..Rn）
  riserFiles: 0,
  // PHASE 93 §六：③"开始检测"这一步的结果。**不是**随导入自动出现的 ——
  //   任何一边的输入变了就清空，逼着用户重新点一次，避免"结果对不上当前输入"。
  detected: null,    // {rows, counts, summary, ms}
  // 3D 选中项（§十二：点 R1 高亮 R1 / 点 H1 高亮 H1）。{kind:'riser'|'hotspot'|'unit', id}
  sel: null,
  _focusSel: false,   // 这一次重画要不要动相机（只有用户主动点卡片时为真）
  _hsPickAt: 0,       // 最近一次点到热点 marker 的时刻（用来让热点在同一次点击里优先于冒口）

  /* ---- PHASE 94 §二/§三：浇注系统检测（三个语义类别，每类 1 个 STL） ----
     units —— 三类各自的**独立单元**列表。数量按连通分量数，不按文件数（§二）。
     注意这与下面的 state.gating（PHASE 92 的"一整份浇注系统"）是两回事，两者并存。 */
  tab: 'riser',       // 'riser' | 'gating'（模块页签，§十五"浇注系统检测可以打开"）
  units: { [KIND.SPRUE]: [], [KIND.RUNNER]: [], [KIND.INGATE]: [] },
  unitFiles: { [KIND.SPRUE]: null, [KIND.RUNNER]: null, [KIND.INGATE]: null },
  // PHASE 97：内浇口要按"连接面"定方向，而上游（产品/横浇道）可能晚到 —— 留着原始网格，
  //   上游一变就重算一遍（只存内浇口这一类，别把三类都留一份）
  unitMesh: { [KIND.INGATE]: null },
  gatingDetected: false,   // 与 detected 同理：输入一变就作废，必须重新点一次
  /* ---- PHASE 95 §七：浇注工艺条件（用户能填的**全部**东西就这三个） ----
     matKey    材质大类（决定密度 ρ 与浇注时间公式分派）
     gatingType 浇注系统类型：'' = 未指定（→ 不启用任何速度判定标准，95.txt §八）
     gatingYield 出品率 %：null = 用该材质表的推荐值（UI 明确标"默认"） */
  matFamily: '灰铁',
  gatingType: '',
  gatingYield: null,
  /* ---- PHASE 96 §十三：优先级要用到的"用户本次是否手动改过"标记 ----
     用户改过的项重进页面也不被生产场景覆盖（优先级 1 > 2）。 */
  matManual: false,
  typeManual: false,
  yieldManual: false,
  _scenarioApplied: false,   // 生产场景每个视图生命周期只带一次（用户之后手动改的不再回退）
  scenario: null,            // {family, gatingType, yieldPct, yieldSrc} —— 只读快照，供报告/调试
  paramSource: null,         // {mat, type, yield} —— 三项各自的来源（UI 如实标出）
  // PHASE 90~92 的浇注系统状态。93.txt §十四：代码保留、退出普通用户主流程 ——
  //   本页 UI 已不再读写它（loadGating / renderGating 都不再从主流程调用）。
  gating: null,      // {name, mesh, cc, bounds, componentCount, volumeMm3, connections, tree, summary, flowMs}
  dispMode: 'transparent',
  view3d: null,
};

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.remove(), 2400);
}

/* ================= 派生数据 ================= */
/**
 * 派生一律**现算**，不缓存 —— state.detected 只记"这一组输入用户已经点过检测了"。
 * 输入一变 detected 就清空，所以"现算"与"检测那一刻的快照"永远相等，
 * 不会出现"卡片上的数还是上一份 STL 的"（93.txt §十八.10：宁可不给，不给错的）。
 */
function derive() {
  const hotspots = state.product?.hotspotsStatus === 'ok' ? (state.product.hotspots || []) : [];
  const relation = buildRiserRows(hotspots, state.risers);           // {rows, counts, distances}
  const summary = summarizeRisers({ product: state.product, hotspots, risers: state.risers, rows: relation });
  return { hotspots, relation, summary };
}

/** 输入变了 → 之前的检测结论作废（§六：① ② 之后必须重新 ③） */
function invalidateDetection() {
  state.detected = null;
  state.sel = null;
}

/** 能否开始检测：产品和至少一个冒口都在 */
const canDetect = () => !!(state.product?.mesh && state.risers.length);

/* ================= 渲染 ================= */
export function render(container) {
  markRelocalizable();   // PHASE 72：状态全部在本模块 state 里，换语言重渲染无损
  container.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${tr('工艺检测中心')} <span class="pi-trial">${tr('试用中')}</span></h1>
      <p class="page-sub">${tr('检查已经完成的铸造工艺设计。')}</p>
    </div>

    <div class="pi-ws">
      <!-- 检测模块（93.txt §五 / 94.txt §十五：浇注系统检测现在可以打开，两个模块并列） -->
      <div class="pi-mods" role="tablist">
        <button class="pi-mod on" type="button" role="tab" data-pi-tab="riser"><span class="pi-mod-dot"></span>${tr('冒口检测')}</button>
        <button class="pi-mod" type="button" role="tab" data-pi-tab="gating"><span class="pi-mod-dot"></span>${tr('浇注系统检测')}</button>
      </div>

      <!-- ── 模块 A：冒口检测（93.txt §六：① 导入产品 ② 导入冒口 ③ 开始检测） ── -->
      <div class="pi-panel" data-pi-panel="riser">
        <div class="pi-import" id="pi_import">
          ${importSlot(KIND.PRODUCT)}
          ${importSlot(KIND.RISER)}
        </div>
        <div class="pi-runbar">
          <button class="btn btn-primary" id="pi_run" type="button" disabled>${tr('开始检测')}</button>
          <span class="pi-runhint" id="pi_runHint"></span>
        </div>
      </div>

      <!-- ── 模块 B：浇注系统检测 ──
           94.txt §三：三个语义槽，各 1 个 STL，可以只导入一部分。
           95.txt §二：再加上**产品 STL**（几何与工艺计算都要它），但产品是全页唯一的一份
           （与模块 A 共用 state.product 和同一个 file input，见 gatingProductSlot 的说明）。 -->
      <div class="pi-panel" data-pi-panel="gating" hidden>
        <div class="pi-import" id="pi_gimport">
          ${gatingProductSlot()}
          ${gatingSlot(KIND.SPRUE)}
          ${gatingSlot(KIND.RUNNER)}
          ${gatingSlot(KIND.INGATE)}
        </div>
        <!-- 95.txt §七：用户能填的**全部**东西就这三个；三个都有默认值，不动也能出结果。
             96.txt §十一/§十二：生产场景里已经设过的会自动带进来，并标明来源；
             没设过才需要用户在这里填。三个都带来源徽标，用户不用猜数从哪来（§十五）。 -->
        <div class="pi-conds" id="pi_gconds">
          <label class="pi-cond"><span>${tr('材质')}</span>
            <select id="pi_gmat">${MAT_FAMILIES.map(f => `<option value="${esc(f)}">${tr(f)}</option>`).join('')}</select>
            <i class="pi-condsrc" id="pi_gmatSrc" hidden></i>
          </label>
          <label class="pi-cond"><span>${tr('浇注系统类型')}</span>
            <select id="pi_gtype">
              <option value="">${tr('自动')}</option>
              ${Object.values(SYSTEM_TYPE).map(t => `<option value="${esc(t.key)}" title="${esc(tr(t.note))}">${tr(t.label)}</option>`).join('')}
            </select>
            <i class="pi-condsrc" id="pi_gtypeSrc" hidden></i>
          </label>
          <label class="pi-cond"><span>${tr('出品率')}</span>
            <input type="number" id="pi_gyield" min="1" max="100" step="1" inputmode="decimal"
                   placeholder="${tr('默认')}" title="${esc(tr('留空 = 用该材质的推荐出品率'))}">
            <i class="pi-cond-unit">%</i>
            <i class="pi-condsrc" id="pi_gyieldSrc" hidden></i>
          </label>
        </div>
        <div class="field-hint pi-condhint">${tr('浇注系统类型决定要不要拿「企业 R7 参考」比一下平均内浇口速度：开放式 ≤ 1.0 m/s、封闭式 ≤ 1.5 m/s（企业经验审核值，不是行业标准）。选「自动」= 不做这个比较，只给几何与流量估算。')}</div>
        <div class="pi-runbar">
          <button class="btn btn-primary" id="pi_grun" type="button" disabled>${tr('开始检测')}</button>
          <span class="pi-runhint" id="pi_grunHint"></span>
        </div>
      </div>

      <div id="pi_progress" class="dc-progress" hidden>
        <div class="dc-progress-bar"><div class="dc-progress-fill" id="pi_progressFill"></div></div>
        <div class="dc-progress-text" id="pi_progressText">${tr('正在分析模型…')}</div>
      </div>

      <div id="pi_body" hidden>
        <!-- ① 上：3D 模型（93.txt §十二：产品 + 冒口同一场景，保持相对位置） -->
        <section class="card section-card pi-sec pi-hero3d" id="pi_viewSec">
          <div class="dc-view3d">
            <div id="pi_view3dBox" class="dc-view3d-box"></div>
            <div class="dc-view-controls">
              <select id="pi_dispMode" class="dc-disp-mode" title="${esc(tr('显示模式'))}">
                <option value="solid">${tr('实体')}</option>
                <option value="wireframe">${tr('线框')}</option>
                <option value="transparent" selected>${tr('透明')}</option>
              </select>
              <div class="dc-view-btns">
                <button data-view="front">${tr('前')}</button>
                <button data-view="back">${tr('后')}</button>
                <button data-view="left">${tr('左')}</button>
                <button data-view="right">${tr('右')}</button>
                <button data-view="top">${tr('顶')}</button>
                <button data-view="bottom">${tr('底')}</button>
                <button data-view="isometric">${tr('等轴')}</button>
              </div>
              <span class="pi-legend" id="pi_legend"></span>
            </div>
          </div>
          <div class="field-hint">${tr('点击模型中的对象或热点标记，可在下方结果里高亮并定位到它。（3D 只作辅助核对，主结果是下方的数量、总截面积与比例。）')}</div>
        </section>

        <!-- ② 下：检测结果（93.txt §十三：R1/R2/R3 纵向卡片，移动端优先） -->
        <section class="card section-card pi-sec" id="pi_resultSec" data-pi-panel="riser">
          <div class="section-card-title">${tr('检测结果')}</div>
          <div id="pi_result"></div>
        </section>

        <!-- ── 模块 B 的结果（94.txt §七：数量 / 总截面积 / 比例 是第一优先级） ── -->
        <section class="card section-card pi-sec" id="pi_gresSec" data-pi-panel="gating">
          <div class="section-card-title">${tr('浇注系统检测')}</div>
          <div id="pi_gres"></div>
        </section>

        <details class="card section-card pi-sec pi-gdetail" id="pi_gdetailSec" data-pi-panel="gating">
          <summary class="pi-summary">${tr('详细信息')}</summary>
          <div id="pi_gdetail"></div>
        </details>

        <section class="card section-card pi-sec" id="pi_planSec" data-pi-panel="riser">
          <div class="section-card-title">${tr('对象')}</div>
          <div id="pi_plan"></div>
        </section>

        <details class="card section-card pi-sec" id="pi_detailSec" data-pi-panel="riser">
          <summary class="pi-summary">${tr('详细数据')}</summary>
          <div id="pi_detail"></div>
        </details>
      </div>
    </div>
  `;

  bindImport(container);
  container.querySelector('#pi_run')?.addEventListener('click', () => runDetect(container));
  container.querySelector('#pi_grun')?.addEventListener('click', () => runGatingDetect(container));
  container.querySelectorAll('[data-pi-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(container, btn.dataset.piTab));
  });
  const modeSel = container.querySelector('#pi_dispMode');
  modeSel.value = state.dispMode;
  modeSel.addEventListener('change', (e) => { state.dispMode = e.target.value; state.view3d?.setDisplayMode(state.dispMode); });
  container.querySelectorAll('.dc-view-btns button').forEach(btn => {
    btn.addEventListener('click', () => state.view3d?.setView(btn.dataset.view));
  });
  container.querySelector('#pi_detail')?.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-pi-remove]');
    if (!rm) return;
    removeRiser(container, rm.dataset.piRemove);
  });
  // §十二：点卡片 = 选中（3D 高亮 + 相机聚焦）。
  // data-pi-sel = 选中的**类别**（riser / hotspot），data-pi-id = 具体 ID —— 两者都要，别只传一个。
  container.querySelector('#pi_result')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-pi-sel]');
    if (!card) return;
    selectItem(container, card.dataset.piSel, card.dataset.piId);
  });
  // 94.txt §十一：点详细信息里的 S1 / G1 / I1 → 在 3D 里定位到对应组件
  container.querySelector('#pi_gdetail')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pi-sel]');
    if (!row) return;
    selectItem(container, row.dataset.piSel, row.dataset.piId);
  });
  paint(container);
}

/**
 * §六 ③：开始检测。只是把开关打开 + 把结果区画出来 —— 计算本身在 derive() 里现算。
 * 这里不做任何新的工程判定（§十八.9：不加入无法验证的工程结论）。
 */
function runDetect(container) {
  if (!canDetect()) return;
  invalidateDetection();
  state.detected = { at: Date.now() };
  paint(container);
  container.querySelector('#pi_resultSec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** §十二：选中一个冒口或热点 → 3D 高亮（热点另外把相机带过去） */
function selectItem(container, kind, id) {
  const same = state.sel && state.sel.kind === kind && state.sel.id === id;
  state.sel = same ? null : { kind, id };     // 再点一次 = 取消选中
  state._focusSel = true;                     // 用户主动点的 → 这一次允许动相机
  paint(container);
}

/**
 * 导入槽：产品 ×1 / 冒口 ×N（93.txt §六/§七/§八）
 *
 * §六 明确**不要**要求用户：点热点、点冒口、指定负责关系、指定截面、指定方向、手工输入模数。
 * 所以这里的提示只说明"文件里可以有多个实体"，不提任何需要用户判断的事。
 */
function importSlot(kind, extra = '') {
  const meta = KIND_META[kind];
  const multi = kind === KIND.RISER;
  const hint = kind === KIND.PRODUCT ? tr('可含多个产品，自动按连通实体识别')
    : tr('可一次导入多个文件；一个文件里有多个冒口也会自动识别');
  return `<div class="pi-slot" data-slot="${kind}">
    <div class="pi-slot-head">
      <span class="pi-slot-icon">${slotIcon(kind)}</span>
      <span class="pi-slot-name">${tr(meta.zh)}<span class="pi-slot-mul">${multi ? '×N · ' + tr('可多选') : '×1'}</span></span>
      <span class="pi-slot-n" id="pi_n_${kind}">0</span>
    </div>
    <div class="pi-slot-hint">${hint}</div>
    <div class="pi-slot-body">
      <button class="btn btn-ghost pi-pick" data-pick="${kind}" type="button">${tr('选择 STL')}</button>
      <button class="btn btn-ghost pi-clear" data-clear="${kind}" type="button" hidden>${tr('清空')}</button>
    </div>
    <input type="file" accept=".stl" ${multi ? 'multiple' : ''} hidden data-file="${kind}">
    ${extra}
  </div>`;
}

/**
 * 浇注系统的一个语义槽（94.txt §二/§三）。
 *
 * ★ 每个类别**只能导入 1 个 STL**（94.txt §二 逐字）—— 所以这里没有 multiple。
 *   但"1 个文件"不等于"1 个零件"：文件里有几个独立实体由连通分量决定，
 *   角标显示的是**实体个数**（§二：不要按照文件数量计算数量）。
 * ★ 允许留空（§三）：没导入的类别显示"未导入"，不报错，检测照常部分运行。
 */
function gatingSlot(kind) {
  const meta = KIND_META[kind];
  return `<div class="pi-slot" data-slot="${kind}">
    <div class="pi-slot-head">
      <span class="pi-slot-icon">${slotIcon(kind)}</span>
      <span class="pi-slot-name">${tr(meta.zh)}<span class="pi-slot-mul">${tr('×1 个文件')}</span></span>
      <span class="pi-slot-n" id="pi_n_${kind}">0</span>
    </div>
    <div class="pi-slot-hint">${tr('一个文件里的多个独立实体自动分别计数')}</div>
    <div class="pi-slot-body">
      <button class="btn btn-ghost pi-pick" data-pick="${kind}" type="button">${tr('选择 STL')}</button>
      <button class="btn btn-ghost pi-clear" data-clear="${kind}" type="button" hidden>${tr('清空')}</button>
    </div>
    <input type="file" accept=".stl" hidden data-file="${kind}">
  </div>`;
}

/**
 * 模块 B 的**产品**槽（95.txt §二：浇注系统检测也要产品 STL）。
 *
 * ★ 它与模块 A 共用同一个 `state.product`，也共用**同一个 file input**（data-file="product"）。
 *   为什么不做第二个 input：
 *     ① 产品是全页唯一的一份真相，两个 input 就是两条写入路径（88.txt 的串行导入队列守卫
 *        正是为了防这类"ID 与文件错位"）；
 *     ② `[data-pi-panel="gating"]` 里的 file input 必须恰好是"直 / 横 / 内"三个 ——
 *        94.txt §二"每个类别只能导入 1 个 STL"是靠这条计数断言的，多一个就失去意义。
 *   所以这里只提供一个**入口**：点按钮去点模块 A 那个隐藏 input，拖放直接走 addFiles。
 */
function gatingProductSlot() {
  return `<div class="pi-slot" data-slot-shared="${KIND.PRODUCT}">
    <div class="pi-slot-head">
      <span class="pi-slot-icon">${slotIcon(KIND.PRODUCT)}</span>
      <span class="pi-slot-name">${tr('产品')}<span class="pi-slot-mul">×1</span></span>
      <span class="pi-slot-n" id="pi_gn_${KIND.PRODUCT}">0</span>
    </div>
    <div class="pi-slot-hint">${tr('工艺计算要用它：自动读体积 → 重量 → 浇注时间（与冒口检测共用同一份）')}</div>
    <div class="pi-slot-body">
      <button class="btn btn-ghost pi-pick" data-pick-shared="${KIND.PRODUCT}" type="button">${tr('选择 STL')}</button>
      <button class="btn btn-ghost pi-clear" data-clear-shared="${KIND.PRODUCT}" type="button" hidden>${tr('清空')}</button>
    </div>
  </div>`;
}

const slotIcon = (kind) => ({
  [KIND.PRODUCT]: '📦', [KIND.RISER]: '🏗️', [KIND.GATING]: '🌊',
  [KIND.SPRUE]: '⬇️', [KIND.RUNNER]: '➡️', [KIND.INGATE]: '🔻',
}[kind] || '📄');

/** 模块页签切换（94.txt §十五：浇注系统检测**可以打开**）。
 *  只切 hidden，不重画 —— 两边结果都留在 DOM 里，来回切不丢状态、也不重建 3D。 */
function switchTab(container, tab) {
  if (tab !== 'riser' && tab !== 'gating') return;
  state.tab = tab;
  applyTab(container);
}

function applyTab(container) {
  container.querySelectorAll('[data-pi-tab]').forEach(b => b.classList.toggle('on', b.dataset.piTab === state.tab));
  container.querySelectorAll('[data-pi-panel]').forEach(p => { p.hidden = p.dataset.piPanel !== state.tab; });
}

/* ================= 导入绑定 ================= */
/** 93.txt §六：冒口检测两个槽；94.txt §三：浇注系统三个语义槽（各有各的模块页签）。 */
const IMPORT_SLOTS = [KIND.PRODUCT, KIND.RISER, KIND.SPRUE, KIND.RUNNER, KIND.INGATE];

function bindImport(container) {
  for (const kind of IMPORT_SLOTS) {
    const slot = container.querySelector(`[data-slot="${kind}"]`);
    const input = container.querySelector(`[data-file="${kind}"]`);
    if (!slot || !input) continue;
    container.querySelector(`[data-pick="${kind}"]`).addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.value = '';
      if (files.length) addFiles(container, kind, files);
    });
    container.querySelector(`[data-clear="${kind}"]`).addEventListener('click', () => clearKind(container, kind));
    bindDropSlot(slot, container, kind);
  }

  /* ---- PHASE 95：模块 B 的「产品」槽（与模块 A 共用同一个 state 与同一个 file input） ---- */
  const shared = container.querySelector(`[data-slot-shared="${KIND.PRODUCT}"]`);
  const sharedInput = container.querySelector(`[data-file="${KIND.PRODUCT}"]`);
  if (shared && sharedInput) {
    container.querySelector(`[data-pick-shared="${KIND.PRODUCT}"]`)
      .addEventListener('click', () => sharedInput.click());
    container.querySelector(`[data-clear-shared="${KIND.PRODUCT}"]`)
      .addEventListener('click', () => clearKind(container, KIND.PRODUCT));
    bindDropSlot(shared, container, KIND.PRODUCT);
  }

  /* ---- PHASE 95 §七：三个工艺条件（材质 / 浇注系统类型 / 出品率）
     PHASE 96 §十一~§十五：进页面时先把**生产场景**里已经设过的值带进来，
     用户就不用重填；带进来的值在 UI 上标明来源（96.txt §十二"来源：生产场景"）。
     ⚠ 只读不写：这里改的一切只影响本次检测，绝不写回生产场景（96.txt §十二末段）。 ---- */
  applyScenarioDefaults();
  const matSel = container.querySelector('#pi_gmat');
  if (matSel) {
    matSel.value = state.matFamily;
    matSel.addEventListener('change', (e) => {
      state.matFamily = e.target.value;
      state.matManual = true;              // 用户本次手动改过 → 之后重进不再被场景覆盖（§十三 优先级 1）
      invalidateGating(); paint(container);
    });
  }
  const typeSel = container.querySelector('#pi_gtype');
  if (typeSel) {
    typeSel.value = state.gatingType;
    typeSel.addEventListener('change', (e) => {
      state.gatingType = e.target.value;
      state.typeManual = true;
      invalidateGating(); paint(container);
    });
  }
  const yieldIn = container.querySelector('#pi_gyield');
  if (yieldIn) {
    const TIP_OK = '留空 = 用该材质的推荐出品率';
    const TIP_BAD = '出品率要在 1 ~ 100 之间；超出范围不能算，请改正';
    const applyYield = () => {
      const raw = yieldIn.value.trim();
      const v = parseFloat(raw);
      const ok = raw === '' || (Number.isFinite(v) && v > 0 && v <= 100);
      // ⚠ 超范围**不能静默回退默认值**：那样输入框写着 150、结果却按 75% 算，
      //   页面上两个数对不上却都不报错（数据准确 > 一切）。这里显式标红 + 换提示语。
      yieldIn.classList.toggle('invalid', !ok);
      yieldIn.title = ok ? tr(TIP_OK) : tr(TIP_BAD);
      state.gatingYield = ok && raw !== '' ? v : null;
      // ⚠ 清空 ≠ 手动设了一个值：输入框自己的契约就是"留空 = 用该材质的推荐出品率"
      //   （占位符「默认」+ title 都这么写）。所以清空后来源必须标回「默认值 X%」，
      //   不能标成「本次设置」—— 那会告诉用户一个假的来源。
      state.yieldManual = ok && raw !== '';
      invalidateGating();     // 出品率影响流量/流速 → 输入变了结论就作废（PHASE 93 §六 纪律）
      paint(container);
    };
    yieldIn.value = state.gatingYield == null ? '' : String(state.gatingYield);
    yieldIn.title = tr(TIP_OK);
    yieldIn.addEventListener('input', applyYield);
  }
  renderParamSources(container);
}

/**
 * 生产场景 → 工艺检测中心（96.txt §十一/§十二）。
 *
 * ★ 数据源（96.txt §十一 要求先审计、不许猜变量名）：
 *   · 材质 —— `js/context.js`（localStorage `ct-context`）的 `material`，值就是材料大类键。
 *   · 浇注系统类型 —— `CastingProject` 的 `process.ratioKey`，它指向 calcs/gating.js 的
 *     RATIO_PRESETS，每个预设自带 `type: '封闭'|'开放'`。生产场景弹窗里**没有**这个字段，
 *     设计中心里选了比例预设才有。
 *   · 出品率 —— `CastingProject` 的 `material.yieldSug`，且只有 `src` 属于
 *     USER_INPUT / USER_OVERRIDE / SCENARIO 才算"场景真的设过"；src=DEFAULT 只是材料表默认值。
 *
 * ★ 优先级（96.txt §十三）：用户本次手动 > 生产场景 > 项目默认 > 空值不判定。
 *   所以：用户已经在本页手动改过的项**一律不覆盖**（state.matManual / typeManual / yieldManual）。
 * ★ 只读不写：本函数只读 context / project，一个 set 都不调用。
 */
function applyScenarioDefaults() {
  if (state._scenarioApplied) return;
  state._scenarioApplied = true;
  if (state.matManual && state.typeManual && state.yieldManual) return;   // 三项都手动设过 → 无需场景
  let scenario = {};
  try {
    const ctx = context.get();
    const fam = ctx?.material ? (context.familyOf(ctx.material) || ctx.material) : '';
    const rk = proj.getV('process.ratioKey') || '';
    const preset = RATIO_PRESETS[rk];
    const ys = proj.get('material.yieldSug');
    scenario = {
      family: fam,
      gatingType: preset?.type || '',
      yieldPct: ys?.v,
      yieldSrc: ys?.src,
    };
  } catch (e) { scenario = {}; }   // 读不到就按"没有生产场景"走默认值，绝不因此报错
  state.scenario = scenario;
  const r = resolveProcessParams({
    manualFamily: state.matManual ? state.matFamily : '',
    manualType: state.typeManual ? state.gatingType : '',
    manualYield: state.yieldManual ? state.gatingYield : null,
    scenario,
  });
  state.matFamily = r.matFamily;
  state.gatingType = r.gatingType;
  state.gatingYield = r.yieldPct;
  state.paramSource = { mat: r.matSource, type: r.typeSource, yield: r.yieldSource };
}

/**
 * 把三个条件的来源标出来（96.txt §十二/§十五："不要让用户猜这个数字从哪里来的"）。
 *
 * ⚠ 来源必须在**每次重画时现算**，不能只存 applyScenarioDefaults 那一次的结果：
 *   用户改一项之后该项来源就变成「本次设置」了（浏览器测试抓到的真缺陷 ——
 *   改了材质，徽标还写着"生产场景"，等于告诉用户一个假的来源）。
 *   manual 标记是唯一真相；paramSource 只在没手动改过时提供"场景 / 默认"的区分。
 */
function renderParamSources(container) {
  const s = state.paramSource || {};
  const txt = (src) => tr(src === PARAM_SRC.SCENARIO ? '生产场景' : (src === PARAM_SRC.MANUAL ? '本次设置' : '默认值'));
  const put = (id, manual, resolved) => {
    const el = container.querySelector(id);
    if (!el) return;
    el.textContent = txt(manual ? PARAM_SRC.MANUAL : (resolved || PARAM_SRC.DEFAULT));
    el.hidden = false;
  };
  put('#pi_gmatSrc', state.matManual, s.mat);
  put('#pi_gtypeSrc', state.typeManual, s.type);
  // 出品率：来源是"默认值"时还要把用的是哪个数说清楚（材质表的推荐值）
  const yEl = container.querySelector('#pi_gyieldSrc');
  if (yEl) {
    const md = MATERIALS[matKeyOfFamily(state.matFamily)];
    const src = state.yieldManual ? PARAM_SRC.MANUAL : (s.yield || PARAM_SRC.DEFAULT);
    yEl.textContent = src === PARAM_SRC.DEFAULT && md ? tr('默认值 {n}%', [md.y_sug]) : txt(src);
    yEl.hidden = false;
  }
}

/** 拖放导入（模块 A 的槽与模块 B 的共用产品槽走同一条路） */
function bindDropSlot(slot, container, kind) {
  slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('over'); });
  slot.addEventListener('dragleave', () => slot.classList.remove('over'));
  slot.addEventListener('drop', (e) => {
    e.preventDefault(); slot.classList.remove('over');
    const files = [...(e.dataTransfer?.files || [])].filter(f => /\.stl$/i.test(f.name));
    if (!files.length) { showToast(tr('⚠️ 仅支持 .stl 文件')); return; }
    addFiles(container, kind, files);
  });
}

/* 导入串行队列（PHASE 88 回归守卫：并发解析会让完成顺序 ≠ 投放顺序 → R2=R3.stl 这类错位） */
let importQueue = Promise.resolve();
function enqueue(task) {
  const run = importQueue.then(task, task);
  importQueue = run.then(() => {}, () => {});
  return run;
}

async function addFiles(container, kind, files) {
  return enqueue(async () => {
    try {
      // 输入要变了 → 先作废上一次的检测结论（§六 ③ 必须重新点）
      //   两个模块各自作废各自的：改冒口不该把浇注系统的结论也清掉
      if (GATING_KINDS.includes(kind)) { invalidateGating(); await loadGatingKind(container, kind, files[0]); }
      else {
        invalidateDetection();
        if (kind === KIND.PRODUCT) await loadProduct(container, files[0]);
        else await loadRisers(container, files);
      }
    } catch (e) {
      console.error('[工艺检测中心] 导入失败:', e);
      showToast(tr('❌ STL 解析失败：{e}', [String(e.message || e)]));
    }
    paint(container);
  });
}

const readMesh = async (file) => parseSTL(await file.arrayBuffer());

/* ---- 产品：可含多件（89.txt §二：自动按连通实体识别，不要"请输入产品件数"） ---- */
async function loadProduct(container, file) {
  progressShow(container, tr('导入模型'));
  try {
    const mesh = await readMesh(file);
    const validation = validateMesh(mesh);
    const geometry = buildMesh(mesh).geometry;
    progressSet(container, tr('建立距离场'), 0.2);

    const yieldFn = () => new Promise(r => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); r(); };
      ch.port2.postMessage(0);
    });

    const analysis = await analyzeGeometrySliced(mesh, geometry, {}, yieldFn, (phase, frac) => {
      progressSet(container, phase === 'scan' ? tr('建立距离场') : tr('内部采样'), 0.2 + frac * 0.25);
    });
    progressSet(container, tr('热结分析'), 0.5);
    const hotspots = toViewResult(
      await analyzeHotspotsV3Sliced(mesh, geometry, {}, yieldFn, (phase, frac) => {
        progressSet(container, tr('热结分析'), 0.5 + frac * 0.4);
      }),
      { wallMax: analysis?.wallMax, wallMain: analysis?.wallMain, wallAvg: analysis?.wallAvg },
    );
    progressSet(container, tr('识别产品件数'), 0.92);

    // 多件识别（89.txt §二）
    const cc = triangleComponents(mesh);
    const parts = objectsFromComponents(mesh, KIND.PRODUCT, file.name, cc.components, (m) => objectMetrics(m), cc.weld);
    const totalVol = parts.objects.reduce((s, o) => s + (o.metrics?.volumeMm3 || 0), 0);
    const totalArea = parts.objects.reduce((s, o) => s + (o.metrics?.areaMm2 || 0), 0);
    state.product = {
      name: file.name, mesh, validation, geometry, analysis,
      hotspots: hotspots.hotspots || [],
      hotspotsStatus: hotspots.status,
      // PHASE 95：留着 toViewResult 的完整返回值 —— 主体壁厚可信链 bodyRefOf 要用
      //   debug.v3.coarse.thin.tP50（PHASE 26 定稿口径），只留 hotspots 数组是拿不到的。
      analysisView: hotspots,
      components: cc.components, objects: parts.objects, cc,
      partCount: parts.objects.length,
      openCount: parts.objects.filter(o => !o.closed).length,
      bounds: parts.bounds || cc.components[0]?.bounds || null,
      metrics: {
        volumeMm3: totalVol, areaMm2: totalArea,
        triCount: mesh.triCount,
        center: parts.bounds ? parts.bounds.center : [0, 0, 0],
        size: parts.bounds ? parts.bounds.size : [0, 0, 0],
      },
    };
    progressSet(container, tr('生成结果'), 1);
    // PHASE 93 §十四：产品导入不再触发浇注系统追踪（那条链已退出主流程）
    if (hotspots.status === 'ok' && hotspots.hotspots?.length) {
      showToast(tr('✅ 产品分析完成：检出 {n} 个热点', [hotspots.hotspots.length]));
    } else {
      showToast(tr('✅ 产品分析完成（未检出热点）'));
    }
  } finally {
    progressHide(container);
  }
}

/* ---- 冒口：一个文件内多个连通实体 → 自动展开 R1..Rn（89.txt §三） ---- */
async function loadRisers(container, files) {
  for (const f of files) {
    const mesh = await readMesh(f);
    const cc = triangleComponents(mesh);
    const parts = objectsFromComponents(mesh, KIND.RISER, f.name, cc.components, (m) => objectMetrics(m), cc.weld);
    for (const o of parts.objects) {
      o.mesh = meshSubset(mesh, cc.components[o.componentIndex].tris);
      state.risers.push(o);
    }
    if (!parts.objects.length) showToast(tr('⚠️ {name} 中未找到有效实体', [f.name]));
    const badge = container.querySelector(`#pi_n_${KIND.RISER}`);
    if (badge) badge.textContent = String(state.risers.length);
  }
  state.riserFiles += files.length;
  reindexRisers();
}

function reindexRisers() {
  state.risers.forEach((o, i) => { o.index = i; o.id = makeObject(KIND.RISER, i, o.name, o.metrics).id; });
}

/* ============================================================
   模块 B：浇注系统检测（PHASE 94 · 94.txt §二~§十一）
   ------------------------------------------------------------
   用户给的语义：这个文件是直浇道 / 横浇道 / 内浇口（§一 的产品路线）。
   程序算的几何：里面有几个独立实体、每个截面多大（什么形状）、合计多少、三者比例。
   ============================================================ */

/** 至少一个类别里有实体才能点"开始检测"（§三：允许只导入一部分） */
const canDetectGating = () => GATING_KINDS.some((k) => state.units[k].length > 0);

/** 输入变了 → 上一次的浇注系统结论作废（与冒口检测同一条纪律） */
function invalidateGating() {
  state.gatingDetected = false;
  if (state.sel?.kind === 'unit') state.sel = null;
}

/**
 * 一份浇注系统 STL → 该类别下的若干独立单元（94.txt §二/§四）。
 *
 * 每个单元算的是：编号 / 是否闭合 / 包围盒 / 轴向长度 / 截面类型 / 截面尺寸 /
 * 有效截面积 / 体积（闭合才给）。**量不出来的一律 null + 原因码**（§六末段）。
 */
async function loadGatingKind(container, kind, file) {
  if (!file) return;
  const mesh = await readMesh(file);
  buildUnitsFromMesh(container, kind, mesh, file.name);
  // PHASE 97：内浇口的进给方向取决于**产品与上游**，而它们可能比内浇口晚导入
  //   → 上游任一类别到位后，把已有的内浇口重算一遍（否则先导内浇口就永远停在 INFERRED）。
  if (kind !== KIND.INGATE && state.units[KIND.INGATE].length && state.unitMesh[KIND.INGATE]) {
    const im = state.unitMesh[KIND.INGATE];
    buildUnitsFromMesh(container, KIND.INGATE, im.mesh, im.name);
  }
}

/**
 * 内浇口方向所依赖的东西（产品 / 横浇道 / 直浇道 / 冒口）变了就重算一遍。
 *
 * 为什么要这样：内浇口的进给方向**不是**它自己说了算的（97.txt §三）——
 * 它取决于跟谁连着。上游任何一边导入/清空，已经算好的方向就不再成立，
 * 必须重新走一遍 buildUnitsFromMesh，否则页面会继续显示一个**依据已经被拿掉**的面积。
 * 没有内浇口时是空操作。
 */
function rebuildIngatesIfAny(container) {
  const im = state.unitMesh[KIND.INGATE];
  if (im && state.units[KIND.INGATE].length) buildUnitsFromMesh(container, KIND.INGATE, im.mesh, im.name);
}

/** 一份曲线网格 → 该类别下的若干单元（导入与"上游变化后重算"共用同一条路） */
function buildUnitsFromMesh(container, kind, mesh, name) {
  const cc = triangleComponents(mesh);
  if (kind === KIND.INGATE) state.unitMesh[kind] = { mesh, name };
  // PHASE 97（97.txt §四/§七）：**只有内浇口**要按"与产品/横浇道的连接面"定方向，
  //   所以先按组件把方向算出来，再交给 metricsOf 当作切面方向（其余类别照旧走主轴约定）。
  const dirs = kind === KIND.INGATE ? ingateDirections(mesh, cc) : null;
  const parts = gatingUnitsFromComponents(
    mesh, kind, name, cc.components,
    // withPoly：截面形状识别要用到真正那一刀的多边形
    // altAxis（PHASE 96）：方向不唯一的单元还要报"换另一条主轴会切出多少"
    //   —— 对照值必须是真量出来的，不能按长宽比估（96.txt §六）
    // axisDir（PHASE 97）：连接面给出的进给方向；没有就传 null，完全退回 PHASE 96
    (m, i) => objectMetrics(m, { withPoly: true, altAxis: true, axisDir: dirs?.[i]?.direction || null }),
    (m, i) => sectionShapeOf(m, dirs?.[i] || null),
  );
  const units = [];
  for (const o of parts.objects) {
    o.mesh = meshSubset(mesh, cc.components[o.componentIndex].tris);   // 3D 高亮/定位要按单元单独成对象
    // 方向是怎么定出来的（UI 要如实显示"由产品连接面确定"，不许让用户以为都是主轴猜的）
    if (dirs && dirs[o.componentIndex]) o.dir = dirs[o.componentIndex];
    units.push(o);
  }
  state.units[kind] = units;
  state.unitFiles[kind] = name;
  if (!units.length) showToast(tr('⚠️ {name} 中未找到有效实体', [name]));
}

/**
 * 逐个内浇口组件解析"进给方向"（PHASE 97 · 97.txt §四~§十）。
 *
 * ★ 只用**已经存在的真实连接关系**（97.txt 开头："大道至简…优先使用 STL 中已经存在的真实连接关系"）：
 *     内浇口 ↔ 产品（优先） 或 内浇口 ↔ 横浇道/直浇道/冒口（§五 的回退顺序）
 * ★ 目标网格的空间哈希**每次调用只建一次**，所有内浇口共用（产品可能有十万面片，别按件重复建）。
 * ★ 拿不到可靠连接 → 返回 UNCERTAIN，`direction` 为 null → 上层完全退回 PHASE 96 主轴约定（§八.3）。
 *
 * @returns {Array<object>} 与 cc.components 同序；每项 = resolveIngateDirection 的结果
 */
function ingateDirections(mesh, cc) {
  const targets = [];
  const prodMesh = state.product?.mesh;
  if (prodMesh?.triCount) {
    targets.push({ role: DIR_ROLE.PRODUCT, mesh: prodMesh, grid: buildTriGrid(prodMesh, gridCellOf(prodMesh)) });
  }
  // 上游端：把横浇道/直浇道/冒口的单元网格并成一份（§五：找不到产品连接再退到这些）
  for (const [role, k] of [[DIR_ROLE.RUNNER, KIND.RUNNER], [DIR_ROLE.SPRUE, KIND.SPRUE], [DIR_ROLE.RISER, KIND.RISER]]) {
    const merged = mergeUnitMeshes(state.units[k]);
    if (merged) targets.push({ role, mesh: merged, grid: buildTriGrid(merged, gridCellOf(merged)) });
  }
  if (!targets.length) return cc.components.map(() => null);   // 没有任何可比对象 → 全部退回主轴
  return cc.components.map((c) => {
    if (!(c.triCount > 0)) return null;
    const sub = meshSubset(mesh, c.tris);
    return resolveIngateDirection({ ingateMesh: sub, targets });
  });
}

/** 空间哈希的格边长（沿用 meshDistance 的建议：包围盒对角线 / 64） */
function gridCellOf(m) {
  const d = Math.hypot(...(m.bounds?.size || [0, 0, 0]));
  return Math.max((d > 0 ? d : meshDiagonal(m.vertices, m.triCount)) / 64, 1e-3);
}

/** 把若干单元网格并成一份（上游端可能由多个独立实体组成）；没有则返回 null */
function mergeUnitMeshes(units) {
  const list = (units || []).filter((u) => u?.mesh?.triCount > 0);
  if (!list.length) return null;
  const total = list.reduce((s, u) => s + u.mesh.triCount * 9, 0);
  const vertices = new Float32Array(total);
  let off = 0;
  for (const u of list) { vertices.set(u.mesh.vertices.subarray(0, u.mesh.triCount * 9), off); off += u.mesh.triCount * 9; }
  return { vertices, triCount: total / 9 };
}

/** §六 ③（浇注系统版）：打开结果开关，计算本身在 deriveGating() 里现算 */
function runGatingDetect(container) {
  if (!canDetectGating()) return;
  invalidateGating();
  state.gatingDetected = true;
  paint(container);
  container.querySelector('#pi_gresSec')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * 产品的主体壁厚（PHASE 95）。
 * ★ 复用设计中心**同一条可信链** bodyRefOf（PHASE 26 定稿：bodyWallOf + tP50 取大，
 *   含 2×wallMax 的伪 t 保护）—— 浇注时间公式的 wall 参数就用它，不另起一套口径。
 * @returns {number|null} mm；拿不到就给 null（视图如实说"不可得"，不猜一个）
 */
function wallOfProduct(p) {
  if (!p || !p.analysis) return null;
  const thin = p.analysisView?.debug?.v3?.coarse?.thin || {};
  const br = bodyRefOf(p.analysis, thin);
  return br && Number.isFinite(br.bodyRef) && br.bodyRef > 0 ? br.bodyRef : null;
}

/** 浇注系统派生（现算，不缓存 —— 与冒口检测同理，输入一变结论就作废） */
function deriveGating() {
  const areas = buildGatingAreas(state.units);
  const summary = summarizeGatingAreas({ areas });
  const ingate = areas.kinds.find((k) => k.kind === KIND.INGATE) || null;
  const pv = state.product ? productVolumeOf(state.product.objects) : null;
  // PHASE 95 §六：产品 STL → 体积 → 材质密度 → 重量 → 经典浇注时间 → 流量 → 内浇口速度
  const pour = buildPouringResult({
    matKey: matKeyOfFamily(state.matFamily),
    product: pv,
    wallMm: wallOfProduct(state.product),
    ingate,
    yieldPct: state.gatingYield,
    systemType: state.gatingType,
  });
  return { areas, summary, ingate, pour };
}

/* ---- 浇注系统的文案表（code → 中文原文，英文走 i18n 查表） ---- */
const GATING_TEXT = {
  [GATING_CODE.NO_INPUT]: '尚未导入浇注系统 STL。可以只导入其中一个或两个类别。',
  [GATING_CODE.NO_SOLID]: '导入的文件里没有识别到有效实体。',
  [GATING_CODE.AREA_UNRELIABLE]: '有 {n} 个单元无法可靠计算截面积，未计入总截面积',
  [GATING_CODE.PARTIAL_TOTAL]: '总截面积 = 已测得截面积的单元之和（还有单元没算进去），不是全部单元之和',
  [GATING_CODE.NO_BASE]: '所有已导入类别的截面积都不可得，无法给出比例',
};

const GATING_REASON_TEXT = {
  [GATING_REASON.NOT_CLOSED]: '几何不是闭合实体，截面积不可信',
  [GATING_REASON.SECTION_UNUSABLE]: '截面剖面不可用（切不到闭合环）',
  [GATING_REASON.MULTI_LOOP]: '这个方向一刀切出多个独立截面，没有唯一截面',
  [GATING_REASON.AMBIGUOUS_AXIS]: '平板状几何，截面方向不唯一（算准需要知道充型方向，本版不做）',
  [GATING_REASON.NO_LOOP]: '切不到闭合截面',
  [GATING_REASON.DEGENERATE]: '截面退化',
};

const SHAPE_TEXT = {
  [SECTION_TYPE.CIRCULAR]: '圆形',
  [SECTION_TYPE.RECT]: '矩形',
  [SECTION_TYPE.TRAPEZOID]: '梯形',
  [SECTION_TYPE.IRREGULAR]: '不规则',
};

/* ---- PHASE 95：浇注工艺计算的文案表（同样是 code → 中文原文，英文走 i18n 查表） ---- */
const POUR_TEXT = {
  [POUR_CODE.READY]: '数据完整，可以进行工艺检查。',
  [POUR_CODE.MISSING_MAT]: '未选择材质：没有密度就算不出重量与浇注时间。',
  [POUR_CODE.MISSING_PRODUCT]: '未导入产品 STL：几何检测照常，但浇注时间 / 流量 / 速度要先有产品体积。',
  [POUR_CODE.MISSING_VOLUME]: '产品没有可用的闭合体积（实体不闭合或网格无效）：给不出重量与浇注时间。',
  [POUR_CODE.MISSING_WALL]: '产品主体壁厚不可得（模型采样不足或网格无效）：给不出浇注时间。',
  [POUR_CODE.MISSING_INGATE]: '没有可用的内浇口截面积：给不出平均内浇口速度。',
  [POUR_CODE.VOLUME_PARTIAL]: '产品有 {n} 个实体不是闭合网格，体积未计入 —— 重量与浇注时间只按闭合实体算。',
  [POUR_CODE.AREA_PARTIAL]: '内浇口有 {n} 个单元量不出截面积，未计入总面积，也就没进平均速度。',
  [POUR_CODE.INGATE_SPREAD]: '内浇口最大偏差 {n}%（(最大 − 最小) ÷ 平均）。本版只报数，不设合格阈值。',
  [POUR_CODE.V_NO_CRITERION]: '当前仅进行几何与流量估算，未启用对应工艺的速度判定标准。',
  // 96.txt §十七：下面三条分别是【比较结果】【比较结果】【建议】，不揉成一句
  [POUR_CODE.V_PASS]: '平均内浇口速度 {v} m/s，未超过「{type}」的企业 R7 参考值 {lim} m/s。',
  [POUR_CODE.V_EXCEED]: '平均内浇口速度 {v} m/s 高于「{type}」的企业 R7 参考值 {lim} m/s。',
  [POUR_CODE.V_SUGGEST]: '建议：优先检查内浇口总面积、内浇口数量以及目标浇注时间。',
  [POUR_CODE.AXIS_UNCERTAIN]: '有 {n} 个单元的截面方向未确认（该单元两个方向尺度相当，程序按最长方向取），面积照实测给出，换一条轴向会不同 —— 详见详细信息。',
};

/** 产品侧"为什么算不出来"的原因码 → 一句人话（与 POUR_REASON 一一对应） */
const POUR_REASON_TEXT = {
  [POUR_REASON.NO_MAT]: '未选材质',
  [POUR_REASON.NO_PRODUCT]: '未导入产品 STL',
  [POUR_REASON.NO_VOLUME]: '产品没有可用的闭合体积',
  [POUR_REASON.NO_WALL]: '主体壁厚不可得',
  [POUR_REASON.NO_INGATE]: '没有可用的内浇口截面积',
  [POUR_REASON.ZERO_VOLUME]: '产品体积为 0',
};

/**
 * 「方向来源」单元格（PHASE 97 · 97.txt §八）。
 *
 * ⚠ 这一列只讲**这一刀的方向是怎么来的**，不重复「截面可靠性」列说的面积可不可信：
 *   · 连接面定出来的 → 写明是哪一端（产品 / 横浇道），并带上连接面面积供交叉核对；
 *   · 没有连接信息 → 老实说是"主轴（最长方向）"这个约定，PHASE 96 的"方向未确认"照旧标。
 */
function directionCell(it) {
  const src = it.directionSource;
  if (src) {
    const label = src === DIR_SOURCE.CONNECTION ? tr('两端连接面')
      : src === DIR_SOURCE.PRODUCT_CONNECTION ? tr('产品连接面')
        : tr('浇注系统连接面');
    const conf = it.directionConfidence === DIR_CONF.CONFIRMED ? tr('已确认') : tr('单端推定');
    const area = it.connectionAreaMm2 != null ? ` · ${tr('连接面')} ${fmt(it.connectionAreaMm2, 1)} mm²` : '';
    return `<span class="pi-conn">${label}<small>（${conf}${area}）</small></span>`;
  }
  return it.axisUncertain ? `<span class="pi-unc">${tr('主轴约定（未确认）')}</span>` : tr('主轴（最长方向）');
}

/** 截面尺寸的显示文本（每种形状给各自的参数，94.txt §五 A/B/C） */
function shapeDims(sh) {
  if (!sh || !sh.usable) return '—';
  if (sh.type === SECTION_TYPE.CIRCULAR) return `⌀ ${fmt(sh.dMm, 1)} mm`;
  if (sh.type === SECTION_TYPE.RECT) return `${fmt(sh.wMm, 1)} × ${fmt(sh.hMm, 1)} mm`;
  if (sh.type === SECTION_TYPE.TRAPEZOID) {
    // ⚠ 不写"上底/下底"（PHASE 96）：切线平面里哪条边算"上"取决于单元在铸件上的朝向，
    //   而截面是在单元自身的坐标系里切的 —— 那里没有上下。两条平行边按长度排（长边在前）。
    return tr('平行边 {a} / {b} · 高 {h} mm', [fmt(sh.topMm, 1), fmt(sh.bottomMm, 1), fmt(sh.heightMm, 1)]);
  }
  return tr('按实测截面面积计');   // 不规则：不套公式，给的就是实测几何面积（§五D）
}

const kzh = (kind) => tr(KIND_META[kind].zh);

/**
 * 主结果（94.txt §七/§八：**这是本阶段最重要的 UI 要求**）。
 * 只放 数量 / 总截面积 / 比例 / 占比 + 必要的 WARNING，
 * 单件明细一律在下面的「详细信息」里（§十：主界面不要被这些信息淹没）。
 */
function renderGatingResult(container, d) {
  const el = container.querySelector('#pi_gres');
  if (!el) return;
  if (!state.gatingDetected) {
    el.innerHTML = `<div class="pi-empty">${tr('导入直浇道 / 横浇道 / 内浇口 STL（可只导入其中一部分）后，点上方「开始检测」。')}</div>`;
    return;
  }

  const a = d.areas;
  const rows = a.kinds.map((k) => {
    if (!k.imported) {
      return `<div class="pi-grow off"><span class="pi-gname">${kzh(k.kind)}</span><span class="pi-gnone">${tr('未导入')}</span></div>`;
    }
    // ── 规格分组（96.txt §七）：同规格的单元聚成**一行**，而不是 N 行一样的 ──
    //   "20 × 5 mm × 2 / 单个面积 100 mm² / 小计 200 mm²"（96.txt §七 的原文格式）
    //   ⚠ 小计 = 该组每个单元**实测**面积之和，不是 单个面积 × 数量；当组内单元
    //     实测值不完全一样时，把最大离散也如实标出来（§八："不要为了整齐强行修正"）。
    const grpRows = k.groups.map((g) => `
      <div class="pi-ggrp">
        <span class="pi-ggdim">${g.shape?.usable ? shapeDims(g.shape) : tr('异形截面')}</span>
        <span class="pi-ggn">× ${g.count}</span>
        <span class="pi-ggunit">${tr('单个面积')} <b>${fmt(g.unitAreaMm2, 1)}</b> mm²</span>
        <span class="pi-ggsum">${tr('小计')} <b>${fmt(g.subtotalMm2, 1)}</b> mm²</span>
        ${g.count > 1 && g.spreadMm2 > 0.05 ? `<span class="pi-ggsp">${tr('组内最大差 {n} mm²', [fmt(g.spreadMm2, 2)])}</span>` : ''}
      </div>`).join('');
    // 内浇口额外给 最小 / 最大 / 最大偏差（§五 / §十.4）——
    //   ⚠ 只报数，不设阈值：全项目没有任何"偏差多少算不合格"的可靠依据
    const sub = k.kind === KIND.INGATE && k.usableCount > 0
      ? `<span class="pi-gsub">${tr('最小')} ${fmt(k.minMm2, 1)} · ${tr('最大')} ${fmt(k.maxMm2, 1)} mm²${k.spreadPct != null ? ` · ${tr('最大偏差')} ${fmt(k.spreadPct, 1)}%` : ''}</span>`
      : '';
    // 方向不唯一的单元（平板件）：面积照给，但必须让用户知道这一刀是**约定**方向（96.txt §六）
    const unc = k.uncertainCount > 0
      ? `<span class="pi-gunc">${tr('{n} 个单元截面方向未确认（按最长方向取），详情见下表', [k.uncertainCount])}</span>`
      : '';
    // PHASE 97：方向来自真实连接面的单元 —— 这是**好消息**，说清楚它凭什么（用户才知道可信度更高）
    const byConn = k.connCount > 0
      ? `<span class="pi-gconn">${tr('{n} 个单元的截面方向由连接面确定', [k.connCount])}</span>`
      : '';
    return `<div class="pi-grow">
      <div class="pi-ghead">
        <span class="pi-gname">${kzh(k.kind)}</span>
        <span class="pi-gcount">${tr('数量')} <b>${k.count}</b></span>
        <span class="pi-garea">${tr('总截面积')} <b>${k.totalMm2 != null ? fmt(k.totalMm2, 1) : '—'}</b> mm²</span>
        ${k.partial ? `<span class="pi-gwarn">⚠ ${tr('{n} 个未计入', [k.unreliableCount])}</span>` : ''}
      </div>
      ${grpRows ? `<div class="pi-ggroups">${grpRows}</div>` : ''}
      ${unc}${byConn}
      ${sub}
    </div>`;
  }).join('');

  // 比例：只列**已导入**的类别，绝不把缺的类别补成 0（§八）
  const ratioLine = a.ratio
    ? a.ratio.entries.map(e => (e.kind === a.ratio.base ? '1' : (e.value != null ? fmt(e.value, 2) : '—'))).join(' : ')
    : null;
  const ratioKinds = a.ratio ? a.ratio.entries.map(e => kzh(e.kind)).join(' : ') : '';

  const shareLine = a.share
    ? a.share.map(s => `${kzh(s.kind)} ${fmt(s.pct, 1)}%`).join(' · ')
    : '';

  // 几何侧的提示（PHASE 94，保持原样：只报"量到了什么/没量到什么"，不做工程判断）
  const geoRows = d.summary.items.map(i =>
    `<div class="pi-resrow pi-${i.level}">
      <span class="pi-resicon">${LEVEL_ICON[i.level]}</span>
      <span>${tr(GATING_TEXT[i.code] || i.code, i.params)}</span>
    </div>`).join('');
  // 工艺侧的提示（PHASE 95 §十：数据完整性 / 内浇口一致性 / 工艺计算）
  //   params 里的浇注系统类型是**键**（'封闭'/'开放'），显示前翻成它的显示名
  const pourRows = (d.pour?.items || []).map(i => {
    const params = i.params.map((v) => (SYSTEM_TYPE[v] ? tr(SYSTEM_TYPE[v].label) : v));
    return `<div class="pi-resrow pi-${i.level}">
      <span class="pi-resicon">${LEVEL_ICON[i.level]}</span>
      <span>${tr(POUR_TEXT[i.code] || i.code, params)}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="pi-gsum">${rows}</div>
    <div class="pi-gtotal">
      <span>${tr('总截面积')}</span>
      <b>${a.totalMm2 != null ? fmt(a.totalMm2, 1) : '—'}</b><span class="pi-gunit">mm²</span>
      ${a.totalPartial ? `<span class="pi-gwarn">⚠ ${tr('部分单元未计入')}</span>` : ''}
    </div>
    ${pourBlock(d)}
    ${ratioLine ? `<div class="pi-gratio">
      <span class="pi-glab">${tr('检测截面积比')}</span>
      <span class="pi-gratio-v">${ratioKinds} = <b>${ratioLine}</b></span>
    </div>` : ''}
    ${shareLine ? `<div class="pi-gshare"><span class="pi-glab">${tr('占比')}</span><span>${shareLine}</span></div>` : ''}
    ${(pourRows || geoRows) ? `<div class="pi-reslist">${pourRows}${geoRows}</div>` : ''}
    <div class="field-hint">${tr('「检测截面积比」= 按当前检测到的有效截面积算出的比值（直 : 横 : 内）。它不是标准浇注比 —— 有效截面积取的是单元中段的代表性截面，不是最小截面 / 阻流截面，两者的工程含义不同。')}</div>
  `;
}

/**
 * 核心结果区（95.txt §四 / §六）。
 *
 * 只放四个用户最关心的数：浇注时间 / 总流量 / 内浇口总面积 / 平均内浇口速度，
 * 外加一行"这些数是怎么来的"（材质 / 产品重量 / 壁厚 / 出品率）。
 * 算不出来的格子留 "—" 并在下面 重点提示 里说清原因，**绝不给一个看起来合理的数**。
 */
function pourBlock(d) {
  const p = d.pour;
  if (!p) return '';
  const cell = (label, v, unit, dec) => `<div class="pi-pour-cell">
      <span class="pi-pour-lab">${label}</span>
      <b>${v != null ? fmt(v, dec) : '—'}</b><i>${unit}</i>
    </div>`;
  // 出品率：用户没填 → 用材质推荐值，**显式标"默认"**（95.txt §七）
  const yieldTxt = p.yieldPct != null
    ? `${fmt(p.yieldPct, 0)}%${p.yieldIsDefault ? `<em class="pi-pour-def">${tr('默认')}</em>` : ''}`
    : '—';
  const src = [
    `${tr('材质')} ${p.matName ? tr(p.matName) : '—'}`,
    p.weightKg != null ? `${tr('产品重量')} ${fmt(p.weightKg, 3)} kg` : null,
    p.wallMm != null ? `${tr('主体壁厚')} ${fmt(p.wallMm, 1)} mm` : null,
    `${tr('出品率')} ${yieldTxt}`,
  ].filter(Boolean).join(' · ');

  return `<div class="pi-pour">
    <div class="pi-pour-head">${tr('核心结果')}</div>
    <div class="pi-pour-grid">
      ${cell(tr('浇注时间'), p.pourTimeS, 's', 2)}
      ${cell(tr('总流量'), p.flowCm3s, 'cm³/s', 1)}
      ${cell(tr('内浇口总面积'), p.ingateAreaMm2, 'mm²', 1)}
      ${cell(tr('平均内浇口速度'), p.vMs, 'm/s', 2)}
    </div>
    <div class="pi-pour-src">${src}${p.volumeCm3 != null ? ` · ${tr('产品体积')} ${fmt(p.volumeCm3, 1)} cm³` : ''}</div>
    ${p.missing.length ? `<div class="pi-pour-miss">⚠ ${tr('缺少')}：${p.missing.map(m => tr(POUR_REASON_TEXT[m] || m)).join('、')}</div>` : ''}
    <div class="field-hint">${tr('浇注时间 = 经典浇注系统计算器（浇注系统设计工具）按「材质 + 产品重量 + 主体壁厚」算得，与设计中心同一个公式；总流量 = 浇注金属液体积 ÷ 浇注时间；平均内浇口速度 = 总流量 ÷ 内浇口总面积。浇注金属液体积 = 产品重量 ÷ 出品率 ÷ 密度（与经典计算器同口径，含冒口与浇道本身的金属）。')}</div>
  </div>`;
}

/**
 * 详细信息（94.txt §十：默认折叠，展开后能看到每个单元的类型 / 尺寸 / 截面积 / 长度 /
 * 体积 / 封闭状态 / 截面可靠性 / 几何识别依据）。
 */
function renderGatingDetail(container, d) {
  const el = container.querySelector('#pi_gdetail');
  if (!el) return;
  if (!state.gatingDetected) { el.innerHTML = ''; return; }

  const groups = d.areas.kinds.filter(k => k.imported).map((k) => {
    if (!k.items.length) return '';
    const rows = k.items.map((it) => `<tr class="pi-guitem${state.sel?.kind === 'unit' && state.sel.id === it.id ? ' on' : ''}"
        data-pi-sel="unit" data-pi-id="${esc(it.id)}">
      <td><b>${esc(it.id)}</b></td>
      <td>${it.shape?.usable ? tr(SHAPE_TEXT[it.shape.type] || '不规则') : '—'}</td>
      <td>${shapeDims(it.shape)}</td>
      <td>${it.areaMm2 != null ? fmt(it.areaMm2, 1) : `<span class="pi-warn">${tr('不可得')}</span>`}</td>
      <td>${it.axisLabel || '—'}</td>
      <td class="pi-tdname">${directionCell(it)}</td>
      <td>${it.lengthMm != null ? fmt(it.lengthMm, 1) : '—'}</td>
      <td>${it.volumeMm3 != null ? fmt(it.volumeMm3 / 1000, 2) : '—'}</td>
      <td>${it.closed ? '✓' : '⚠'}</td>
      <td class="pi-tdname">${it.areaReason ? `<span class="pi-warn">${tr(GATING_REASON_TEXT[it.areaReason] || it.areaReason)}</span>`
        : (it.axisUncertain
          // 96.txt §六/§二十一：方向是约定值时如实说，并把"另一条轴会是多少"摆出来
          ? `<span class="pi-unc">${tr('方向未确认')}${it.altAreaMm2 != null ? `：${tr('沿次主轴')} ${fmt(it.altAreaMm2, 1)} mm²` : ''}</span>`
          : tr('可靠'))}</td>
      <td class="pi-tdname">${esc(it.name)}</td>
    </tr>`).join('');
    return `<div class="pi-dgroup"><div class="pi-dtitle">${kzh(k.kind)}<small>${tr('{n} 个单元', [k.count])}</small></div>
      <div class="pi-tablewrap"><table class="pi-table pi-gtable">
        <thead><tr><th>ID</th><th>${tr('截面类型')}</th><th>${tr('截面尺寸')}</th><th>${tr('截面积')} mm²</th>
          <th>${tr('截面方向')}</th><th>${tr('方向来源')}</th><th>${tr('长度')} mm</th><th>${tr('体积')} cm³</th><th>${tr('闭合')}</th>
          <th>${tr('截面可靠性')}</th><th>${tr('文件')}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>`;
  }).join('');

  el.innerHTML = groups
    ? `${groups}
      <div class="field-hint">${tr('“截面积”是按单元自身主轴方向切片量的；“长度”是沿这条主轴的轴向长度。圆形给的是等效直径 D = 2√(A/π)。切不出唯一闭合截面的单元一律标 ⚠ 并留空，不给估计值。')}</div>
      <div class="field-hint">${tr('总截面积 = 该类每个单元的有效截面积逐个相加（不是平均面积 × 数量）。有效截面积取单元中段截面的中位值；圆形按 πD²/4、矩形按 W×H、梯形按 (a+b)h/2、不规则按实测截面几何面积。')}</div>
      <div class="field-hint">${tr('切面方向：内浇口优先按**与产品（或横浇道）的实际连接面**定；产品与上游都没导入、或连接判不出来时，退回"垂直于最长主轴"这个约定，并在上表标出「方向未确认」。')}</div>`
    : `<div class="pi-empty">${tr('暂无可展开的单元。')}</div>`;
}

/* ============================================================
   ↓↓↓ PHASE 93 §十四：以下整段已**退出普通用户主流程** ↓↓↓
   ------------------------------------------------------------
   PHASE 89~92 的「一整份浇注系统 STL → 自动找连接 → 自动追踪流道网络」。
   93.txt §一 的产品结论：这条路当前算法复杂度高、实际工程结果不够可靠，
   本阶段**不再以"完整浇注系统自动识别"为目标**。

   处理方式（93.txt §十四 逐字）：
     · **保留** —— 不删除历史代码，公式与几何算法仍可被显式调用、仍有单元测试
       （tests/phase89~92_test.mjs 直接测 model 层，不经过本文件的 UI）；
     · **退出主流程** —— 本页不再有导入槽、不再有结果区块、不再自动触发，
       普通用户无法进入这套实验算法（§五：浇注系统检测显示「即将支持」）。
   ⚠ 恢复使用时注意：render() 已不再输出 #pi_gating / #pi_import 的 GATING 槽，
     需要一并把 UI 挂回去（renderGating 已加空值保护，不会因此崩）。
   ============================================================ */

/* ---- 浇注系统：一整份 STL（89.txt §四） ---- */
async function loadGating(container, file) {
  const mesh = await readMesh(file);
  const cc = triangleComponents(mesh);
  const bounds = cc.components.length
    ? cc.components.reduce((acc, c) => unionAcc(acc, c.bounds), null)
    : null;
  const vol = cc.components.reduce((s, c) => s + (c.closed ? c.volumeMm3 : 0), 0);
  const area = cc.components.reduce((s, c) => s + c.areaMm2, 0);
  state.gating = {
    name: file.name, mesh, cc, bounds,
    componentCount: cc.components.length,
    degenerateTris: cc.degenerateTris,
    openCount: cc.components.filter(c => !c.closed).length,
    volumeMm3: vol, areaMm2: area,
    connections: null, tree: null, summary: null, diag: null,
  };
  // 换了一份浇注系统 → 产品若已在，立刻重跑连接检测与追踪（§三：不需要用户做任何操作）
  // ⚠ 这里**不能**再 enqueue：loadGating 本身就跑在导入队列里，再入队会等自己 → 死锁
  refreshFlow(container);
}

function unionAcc(a, b) {
  if (!a) return b ? { min: [...b.min], max: [...b.max], size: [...b.size], center: [...b.center], diagonal: b.diagonal } : null;
  if (!b) return a;
  const mn = a.min.map((v, i) => Math.min(v, b.min[i]));
  const mx = a.max.map((v, i) => Math.max(v, b.max[i]));
  const size = mn.map((v, i) => mx[i] - v);
  return { min: mn, max: mx, size, center: mn.map((v, i) => v + size[i] / 2), diagonal: Math.hypot(...size) };
}

/* ========== 流道追踪（PHASE 90 §三：全自动，不再要求用户点入口） ==========
   触发时机：产品与浇注系统**都**在了就自动跑；任何一边变化都重跑。
   算法：Product↔Gating 连接区域 → 从连接处向外反向追踪 → 截面积-距离曲线。 */
function refreshFlow(container) {
  const g = state.gating;
  if (!g) return;
  g.connections = null; g.tree = null; g.summary = null; g.diag = null;
  state._sceneSig = null;                       // 叠加层要变 → 3D 重建
  paint(container);
  // §四：Product 是基准。没有产品就没有连接区域，也就没有流道追踪可言。
  if (!state.product?.mesh) return;
  runFlow(container);
}

let flowGen = 0;   // 连点两次导入时，防止先跑完的旧结果覆盖新结果
function runFlow(container) {
  const g = state.gating;
  if (!g || !state.product?.mesh) return;
  const gen = ++flowGen;
  progressShow(container, tr('寻找产品连接并追踪流道'));
  progressSet(container, tr('寻找产品连接并追踪流道'), 0.2);
  // 让浏览器先把进度条画出来（追踪是同步的，几万个三角形约几百毫秒到数秒）
  setTimeout(() => {
    if (gen !== flowGen) return;                 // 已经有更新的一次在跑，这次作废
    try {
      const t0 = Date.now();
      // productComponents 给进去，才能检查产品是否水密 —— 内外判定靠射线法，有洞时奇偶失效，
      // 那种情况必须如实报 product_not_closed，不能假装结论可靠（91.txt §16）
      const conn = findConnections(state.product.mesh, g.mesh, g.cc,
        { productComponents: state.product.cc || null });
      g.connections = conn.connections;
      g.connWarnings = conn.warnings;
      g.tolMm = conn.tol;
      g.tolUsedMm = conn.tolUsed;
      g.tolRelaxed = conn.relaxed;
      g.tree = traceFlow(g.mesh, g.cc, g.connections, {});
      g.summary = flowSummary(g.tree);
      g.diag = flowDiagnostics(g.tree);
      g.flowMs = Date.now() - t0;
      // 调试口（沿用 modelView3D 的 ?hsDebug=1 惯例）：挂出程序到底看到了什么（§十七）
      if (new URLSearchParams(location.search).has('flowDebug')) {
        window.__flowDebug = { tree: g.tree, diag: g.diag, tol: g.tolMm, tolUsed: g.tolUsedMm, warnings: g.connWarnings };
      }
    } catch (e) {
      console.error('[工艺检验中心] 流道追踪失败:', e);
      g.connections = null; g.tree = null; g.summary = null; g.diag = null;
      showToast(tr('❌ 流道追踪失败：{e}', [String(e.message || e)]));
    } finally {
      progressHide(container);
      state._sceneSig = null;
      paint(container);
    }
  }, 30);
}

/* ---- 删除 / 清空 ---- */
function removeRiser(container, id) {
  state.risers = state.risers.filter(o => o.id !== id);
  reindexRisers();
  invalidateDetection();     // 少了一个冒口 → 上一次的检测结论不再对应当前输入
  paint(container);
}

function clearKind(container, kind) {
  if (kind === KIND.PRODUCT) {
    state.product = null;
    invalidateDetection();
    // PHASE 97：内浇口的进给方向是**由产品连接面**定的 —— 产品一清，
    //   那个方向的依据就没了，必须重算（否则面积会继续按"已经不存在的连接"给出来，
    //   用户看到的是一个没有依据的数）。浏览器测试抓到的真缺陷。
    rebuildIngatesIfAny(container);
  }
  else if (kind === KIND.RISER) { state.risers = []; state.riserFiles = 0; invalidateDetection(); }
  else if (GATING_KINDS.includes(kind)) {
    state.units[kind] = []; state.unitFiles[kind] = null;
    state.unitMesh[kind] = null;      // PHASE 97：上游变化后要重算内浇口方向，缓存的网格一并清
    invalidateGating();
    // PHASE 97：清掉上游（横/直/冒）之后，内浇口的"两端连接"前提变了 → 立刻重算一次
    if (kind !== KIND.INGATE) rebuildIngatesIfAny(container);
  }
  // ⚠ PHASE 92 的 state.gating **不在这里清** —— 它在下面的历史代码块里，
  //   本视图已没有任何入口能设置它（没有 GATING 导入槽、没有 loadGating 调用），
  //   所以主流程里连引用都不需要（93.txt §十四 的机器可验证形式：主流程不依赖浇注系统）。
  state._sceneSig = null;
  if (state.view3d && !state.product && !state.risers.length && !hasGatingUnits()) {
    state.view3d.dispose(); state.view3d = null;
  }
  paint(container);
}

const hasGatingUnits = () => GATING_KINDS.some((k) => state.units[k].length > 0);

/* ---- 进度条 ---- */
function progressShow(container, text) {
  const p = container.querySelector('#pi_progress');
  if (p) { p.hidden = false; progressSet(container, text, 0); }
}
function progressSet(container, text, frac) {
  const fill = container.querySelector('#pi_progressFill');
  const txt = container.querySelector('#pi_progressText');
  const pct = Math.round(Math.max(0, Math.min(1, frac)) * 100);
  if (fill) fill.style.width = pct + '%';
  if (txt) txt.textContent = `${text}（${pct}%）`;
}
function progressHide(container) {
  const p = container.querySelector('#pi_progress');
  if (p) p.hidden = true;
}

/* ================= 重画全部区块 ================= */
function paint(container) {
  if (!container?.querySelector) return;
  const body = container.querySelector('#pi_body');
  if (!body) return;
  applyTab(container);
  // 冒口侧看产品/冒口，浇注系统侧看三类单元 —— 任何一边有东西，3D 与结果区就有意义
  const hasRiser = !!state.product || state.risers.length > 0;
  const hasGating = hasGatingUnits();
  const hasAny = hasRiser || hasGating;
  body.hidden = !hasAny;
  syncSlots(container);
  syncRunBar(container);
  // ⚠ 工艺条件的**来源徽标**必须每次重画都刷：改一项之后该项来源就变成「本次设置」了。
  //   paint() 不重跑 bindImport()（那是首屏一次性绑定），所以这里要显式再算一次
  //   —— 浏览器测试抓到的真缺陷：改了材质，徽标还写着"生产场景"。
  renderParamSources(container);
  if (!hasAny) return;
  const d = derive();
  renderResult(container, d);
  renderPlan(container, d);
  renderDetail(container, d);
  const g = deriveGating();
  renderGatingResult(container, g);
  renderGatingDetail(container, g);
  renderScene(container, d);
}

/** 导入槽角标 / 清空按钮显隐 */
function syncSlots(container) {
  const setN = (kind, n) => {
    const el = container.querySelector(`#pi_n_${kind}`);
    if (el) el.textContent = String(n);
    const clr = container.querySelector(`[data-clear="${kind}"]`);
    if (clr) clr.hidden = !n;
  };
  setN(KIND.PRODUCT, state.product ? state.product.partCount : 0);
  setN(KIND.RISER, state.risers.length);
  // §二：浇注系统角标显示的是**实体个数**，不是文件个数（1 个文件里可能有 20 个内浇口）
  for (const k of GATING_KINDS) setN(k, state.units[k].length);
  // PHASE 95：模块 B 的共用产品槽 —— 同一个 state，两个角标必须永远一致
  const nProd = state.product ? state.product.partCount : 0;
  const gn = container.querySelector(`#pi_gn_${KIND.PRODUCT}`);
  if (gn) gn.textContent = String(nProd);
  const gclr = container.querySelector(`[data-clear-shared="${KIND.PRODUCT}"]`);
  if (gclr) gclr.hidden = !nProd;
}

/** §六 ③：按钮什么时候能点、点了会发生什么，都直接写在按钮旁边，不让用户猜 */
function syncRunBar(container) {
  const btn = container.querySelector('#pi_run');
  const hint = container.querySelector('#pi_runHint');
  if (btn) {
    const ok = canDetect();
    btn.disabled = !ok;
    btn.textContent = state.detected ? tr('重新检测') : tr('开始检测');
    if (hint) {
      hint.textContent = !state.product ? tr('请先导入产品 STL')
        : !state.risers.length ? tr('请再导入至少一个冒口 STL')
          : state.detected ? tr('检测已完成，结果在下方。')
            : tr('已就绪：将检查每个冒口的模数比。');
    }
  }
  // 模块 B（94.txt §三：可以只导入一部分，所以只要有一类就能跑）
  const gbtn = container.querySelector('#pi_grun');
  const ghint = container.querySelector('#pi_grunHint');
  if (gbtn) {
    const gok = canDetectGating();
    gbtn.disabled = !gok;
    gbtn.textContent = state.gatingDetected ? tr('重新检测') : tr('开始检测');
    if (ghint) {
      const n = GATING_KINDS.filter(k => state.units[k].length).length;
      ghint.textContent = !gok ? tr('请至少导入一个类别的 STL')
        : state.gatingDetected ? tr('检测已完成，结果在下方。')
          : state.product
            ? tr('已就绪：将数出每类单元数与总截面积，并按产品体积算浇注时间 / 流量 / 平均内浇口速度（已导入 {n} 个类别）。', [n])
            : tr('已就绪：将数出每类单元数与总截面积（已导入 {n} 个类别）。导入产品 STL 后可再算出浇注时间 / 流量 / 平均内浇口速度。', [n]);
    }
  }
}

/* ---- 对象清单（产品本身 + 检出/导入的各有多少） ---- */
function renderPlan(container, d) {
  const p = state.product;
  const card = (label, val, cls = '') => `<div class="dc-ov-card ${cls}"><span>${label}</span><b>${val}</b></div>`;
  const hm = p?.hotspotsStatus;
  const hsN = d.hotspots.length;
  const hsState = !p ? '—'
    : hsN ? tr('{n} 个', [hsN])
      : (hm === 'ok' ? tr('未检出') : tr('无法可靠分析'));

  const row = (color, name, count, sub) => `<div class="pi-planrow">
      <div class="pi-planrow-k"><span class="pi-dot" style="background:#${color}"></span>${name}</div>
      <div class="pi-planrow-v"><b>${count}</b> ${tr('个')}${sub ? `<span class="pi-planrow-sub">${sub}</span>` : ''}</div>
    </div>`;

  container.querySelector('#pi_plan').innerHTML = `
    <div class="dc-ov-group">
      <div class="dc-ov-gtitle">📦 ${tr('产品')}</div>
      ${p ? `<div class="dc-ov-grid">
        ${card(tr('文件'), esc(p.name))}
        ${p.partCount > 1 ? card(tr('件数'), `<b>${p.partCount}</b> ${tr('件')}`, 'pi-hl') : ''}
        ${card(tr('外形尺寸'), p.metrics.size.map(v => fmt(v, 0)).join(' × ') + ' mm')}
        ${card(tr('总体积'), fmt(p.metrics.volumeMm3 / 1000, 1) + ' cm³')}
        ${card(tr('网格校验'), (p.validation?.issues || []).length
      ? `<span class="chip dc-chip-warn">${tr('有 {n} 项提示', [(p.validation.issues || []).length])}</span>`
      : `<span class="chip chip-ok">${tr('通过')}</span>`)}
      </div>` : `<div class="pi-empty">${tr('尚未导入产品 STL')}</div>`}
      ${p && p.openCount ? `<div class="pi-warnline">⚠ ${tr('{n} 个产品组件不是闭合网格，其体积不计入总体积', [p.openCount])}</div>` : ''}
    </div>
    <div class="dc-ov-group">
      <div class="dc-ov-gtitle">🏭 ${tr('检测对象')}</div>
      <div class="pi-planlist">
        ${row('ff5252', tr('热点'), hsN, esc(hsState))}
        ${row('fbbf24', tr('冒口'), state.risers.length,
    state.risers.length ? fmt(state.risers.reduce((s, o) => s + (o.metrics?.volumeMm3 || 0), 0) / 1000, 1) + ' cm³' : '')}
      </div>
    </div>`;
}

/* ============================================================
   ② 检测结果（93.txt §九~§十三）
   ------------------------------------------------------------
   默认展示单元是**冒口**（§九）：一个冒口一张卡，卡上写最近热点与模数比。
   多个热点时给一个「查看全部热点」按钮，**不默认铺开 N×M 矩阵**（§九）。
   措辞纪律（§十一）：只有「最近热点 / 最近冒口」，没有「负责」。
   ============================================================ */
const LEVEL_ICON = { [LEVEL.PASS]: '✓', [LEVEL.WARNING]: '⚠', [LEVEL.INFO]: 'ℹ' };

const RISER_TEXT = {
  [RISER_CODE.NO_PRODUCT]: '请先导入产品 STL',
  [RISER_CODE.NO_RISER]: '暂未导入冒口',
  [RISER_CODE.NO_HOTSPOT]: '未检出热点（模型壁厚均匀或热点低于置信度门槛），没有可比的热点模数',
  [RISER_CODE.MODULUS_OK]: '{n} 个冒口的模数比满足（M冒口 / M热点 ≥ {r}）',
  [RISER_CODE.MODULUS_LOW]: '{n} 个冒口的模数比不足（M冒口 / M热点 < {r}）',
  [RISER_CODE.MODULUS_UNKNOWN]: '{n} 个冒口没有可比的热点模数，未参与判定',
  [RISER_CODE.MODULUS_UNRELIABLE]: '{n} 个冒口的模数无法可靠计算（几何不是有效封闭实体），未参与判定',
  [RISER_CODE.DISTANCE_RANGE]: '冒口中心到最近热点的距离 {a} ~ {b} mm',
};

/** 冒口几何不可用时的原因（§八：明确告诉用户"无法可靠计算冒口模数"，不给猜测值） */
const RISER_REASON_TEXT = {
  [RISER_REASON.NOT_CLOSED]: '几何不是有效封闭实体，无法可靠计算冒口模数',
  [RISER_REASON.ZERO_AREA]: '表面积为 0，模数 M = V / A 无定义',
};

/**
 * 单个冒口的判定（§十）。**只有模数比是判据**，且只分 PASS / WARNING / INFO 三级。
 * 算不出来的一律 INFO + 说明原因，绝不当成"不足"（不制造恐慌），也绝不当成"满足"。
 */
function riserVerdict(row) {
  if (!row.modulusUsable) {
    return { level: LEVEL.INFO, text: tr(RISER_REASON_TEXT[row.reason] || '无法可靠计算冒口模数') };
  }
  const n = row.nearest;
  if (!n) return { level: LEVEL.INFO, text: tr('未检出热点，没有可比的热点模数') };
  if (n.ratio == null) return { level: LEVEL.INFO, text: tr('热点模数不可得，未参与模数比判定') };
  if (n.ok) return { level: LEVEL.PASS, text: tr('模数比满足要求（≥ {r}）', [MODULUS_RATIO_MIN]) };
  return { level: LEVEL.WARNING, text: tr('模数比不足（< {r}），建议加大冒口或调整位置后复核', [MODULUS_RATIO_MIN]) };
}

/** §十三：一张卡只讲一个冒口 —— 冒口模数 / 最近热点 / 热点模数 / 模数比 / 结论 */
function riserCard(row) {
  const n = row.nearest;
  const v = riserVerdict(row);
  const sel = state.sel?.kind === 'riser' && state.sel.id === row.riserId;
  const hsSel = n && state.sel?.kind === 'hotspot' && state.sel.id === ('H' + n.hsId);
  const kv = (k, val, cls = '') => `<div class="pi-rk ${cls}"><span>${k}</span><b>${val}</b></div>`;
  return `<div class="pi-rcard${sel ? ' on' : ''}" data-pi-sel="riser" data-pi-id="${esc(row.riserId)}">
    <div class="pi-rchead">
      <span class="pi-rcid">${esc(row.riserId)}</span>
      <span class="pi-rcname">${esc(row.riserName)}</span>
      <span class="pi-rcverdict pi-${v.level}">${LEVEL_ICON[v.level]} ${v.text}</span>
    </div>
    <div class="pi-rkgrid">
      ${kv(tr('冒口模数'), (row.riserModulus != null ? fmt(row.riserModulus, 1) : '—') + ' mm')}
      ${kv(tr('最近热点'), n ? `<span class="pi-hsref${hsSel ? ' on' : ''}">H${esc(n.hsId)}</span>` : '—')}
      ${kv(tr('热点模数'), n && n.hsMc != null ? fmt(n.hsMc, 1) + ' mm' : '—')}
      ${kv(tr('模数比'), n && n.ratio != null ? fmt(n.ratio, 2) : '—', 'pi-rk-ratio')}
    </div>
    ${n ? `<div class="pi-rcmeta">
      <span>${tr('距离 {d} mm', [fmt(n.distance, 1)])}</span>
      <span class="pi-dim">${tr('几何关系')}</span>
      ${n.hsVolumeCm3 != null ? `<span class="pi-dim">${tr('热点区域')} ${fmt(n.hsVolumeCm3, 1)} cm³</span>` : ''}
    </div>` : ''}
    ${row.all.length > 1 ? `
      <button class="pi-more" type="button" data-pi-all="${esc(row.riserId)}">${tr('查看全部热点（{n} 个）', [row.all.length])}</button>
      <div class="pi-allbox" id="pi_all_${esc(row.riserId)}" hidden>
        <div class="pi-allrow pi-allhead"><span></span><span>${tr('距离')}</span><span>${tr('热点模数')}</span><span>${tr('模数比')}</span><span></span></div>
        ${row.all.map(a => `<div class="pi-allrow" data-pi-sel="hotspot" data-pi-id="H${esc(a.hsId)}">
          <span>H${esc(a.hsId)}</span><span>${fmt(a.distance, 1)} mm</span>
          <span>${fmt(a.hsMc, 1)} mm</span><span>${a.ratio != null ? fmt(a.ratio, 2) : '—'}</span>
          <span class="${a.ok === true ? 'pi-ok' : a.ok === false ? 'pi-warn' : 'pi-info'}">${a.ok === true ? '✓' : a.ok === false ? '⚠' : 'ℹ'}</span>
        </div>`).join('')}
      </div>` : ''}
  </div>`;
}

function renderResult(container, d) {
  const el = container.querySelector('#pi_result');
  if (!el) return;

  // §六 ③：没点"开始检测"之前，这里只说明下一步做什么，不给任何结论
  if (!state.detected) {
    el.innerHTML = `<div class="pi-empty">${tr('导入产品 STL 与冒口 STL 后，点上方「开始检测」。')}</div>`;
    return;
  }

  const { summary } = d;
  const rows = d.relation.rows;
  const head = summary.warns
    ? `<div class="pi-reshead warn">⚠ ${tr('发现 {n} 项需要关注', [summary.warns])}</div>`
    : `<div class="pi-reshead ok">✓ ${tr('未发现明显问题')}</div>`;

  const summaryRows = summary.items.map(i =>
    `<div class="pi-resrow pi-${i.level}">
      <span class="pi-resicon">${LEVEL_ICON[i.level]}</span>
      <span>${tr(RISER_TEXT[i.code] || i.code, i.params)}</span>
    </div>`).join('');

  const cards = rows.length
    ? `<div class="pi-rlist">${rows.map(riserCard).join('')}</div>`
    : `<div class="pi-empty">${tr('暂未导入冒口。')}</div>`;

  el.innerHTML = `${head}<div class="pi-reslist">${summaryRows}</div>${cards}
    <div class="field-hint" style="margin-top:8px">${tr('模数比 M冒口 / M热点 是几何模数检查，阈值 {r} 为经验设计参数，不等同于凝固模拟结论，也不代表“一定不会缩孔”。最近热点按几何距离自动关联，本版不做“哪个冒口负责哪个热点”的判定；距离仅作参考，未设通过/不通过阈值。', [MODULUS_RATIO_MIN])}</div>`;

  el.querySelectorAll('[data-pi-all]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();                      // 展开按钮不是"选中卡片"
      const box = el.querySelector(`#pi_all_${btn.dataset.piAll}`);
      if (!box) return;
      box.hidden = !box.hidden;
      btn.textContent = box.hidden ? tr('查看全部热点（{n} 个）', [box.querySelectorAll('.pi-allrow[data-pi-sel]').length]) : tr('收起');
    });
  });
}

/* ---- ④ 浇注系统（PHASE 90 §十四：结果 UI 最小化） ---- */

/** 单刀为什么没记成有效样本（§七 允许少量 invalid，但必须说清是哪种） */
const SAMPLE_TEXT = {
  [SAMPLE_REASON.NO_LOOP]: '这一刀切不到闭合环',
  [SAMPLE_REASON.AMBIGUOUS]: '切到多个环且离预测点差不多近，有歧义',
  [SAMPLE_REASON.OFF_AXIS]: '环的形心离预测点太远，不像是本流道的截面',
  [SAMPLE_REASON.OPEN]: '该刀存在未闭合环（网格破口或子集被剪断）',
};

/** 这一段为什么停在这里（都是"如实说明"，不是错误码） */
const END_TEXT = {
  [FLOW_REASON.END_OF_DUCT]: '流道到头',
  [FLOW_REASON.DIRECTION_UNSTABLE]: '方向沿程不稳定，已停止（不硬算）',
  [FLOW_REASON.BRANCHED]: '在此分出支路',
  // PHASE 92 §十：走到已有节点上（两条来路汇合）—— 网络里最正常的一种结束
  [FLOW_REASON.REACHED_NODE]: '汇合到已有节点',
  [FLOW_REASON.MAX_STEPS]: '达到步数上限后停止',
  [FLOW_REASON.INSUFFICIENT_SAMPLES]: '有效样本不足',
  [FLOW_REASON.OK]: '正常',
};

/** §十七：连接检测与追踪的提示（只报"没算出来/放宽过"，不制造假的 PASS） */
const FLOW_WARN_TEXT = {
  no_product: '尚未导入产品 STL：没有基准就找不出连接区域',
  no_gating: '尚未导入浇注系统 STL',
  no_connection: '未在浇注系统上找到与产品相接/近接的区域：无法开始追踪',
  tol_relaxed: '按标准判据没有找到连接区域，已把判据放宽到 {tol} mm 才找到（结果请留意）',
  small_connection_dropped: '有 {n} 个过小的相接面被当作噪声忽略',
  connection_no_direction: '连接口 {id} 附近的几何无法可靠确定起始方向，该口不追踪',
  segments_truncated: '流道段数达到上限（{n} 段），有支路未展开',
  // —— PHASE 91 §6：连接判据换成"顶点在产品内/外 + 三角形穿越边界"之后新增的三种如实说明 ——
  inside_unreliable: '有 {n} 个顶点的"在产品内还是外"三条射线未取得一致（几何含糊），这些点没有当作连接证据',
  product_not_closed: '产品网格不是水密的（有洞），"在不在产品内部"的判定依据会变弱，连接结论请留意',
  gating_inside_no_boundary: '有 {n} 个浇注系统三角形完全落在产品内部，但没有任何一条边穿过产品表面：连接关系在几何上无法判定',
  // —— PHASE 92 §十七：网络的图结构如实说明（都不是错误码）——
  spurious_branches: '有 {n} 个候选支路方向探下去没有量到任何通道（该方向没有连续截面），未计入网络',
  duplicate_branches: '有 {n} 个候选支路方向的几何已经被别的边走过，未重复生成（避免图中出现重复边）',
  self_loops_dropped: '有 {n} 段走了个圈又回到起点，作为非法自环丢弃',
};

/** 连接口属于 §6 的哪一种（三种几何情况，不是工艺命名） */
const PORT_KIND_TEXT = {
  contact: '面接触',
  insertion: '插入产品',
  crossing: '穿越产品边界',
};

/**
 * A(s) 曲线：纵轴 = 沿当前流向实测的有效横截面积，横轴 = 沿流道的累积距离（91.txt §19）。
 * 纯内联 SVG —— 不引第三方图表库（§0 大道至简）。
 *
 * 画的是**实测点**，不是拟合曲线：每一刀一个点。被排除出 headline 的那些刀
 *（端面 / 截面不闭合）**照样画出来**，只是不参与最小/最大值 —— 不掩盖，只标注。
 */
function areaChart(seg) {
  const v = seg.samples.filter((s) => s.valid && s.area != null);
  if (v.length < 2) return '';
  const W = 640, H = 168, PL = 52, PR = 14, PT = 12, PB = 26;
  const x0 = v[0].distance, x1 = v[v.length - 1].distance;
  // 纵轴聚焦到**数据本身**，不从 0 起画：一段基本平直的流道，若纵轴从 0 拉到最大值，
  // 十几个点会全被压在顶上一格里，A(s) 的变化完全看不出来 —— 而"变化"正是这张图要说的东西。
  // 刻度值就写在轴上，看的人知道零点在哪里，不靠视觉暗示（不是把图截断冒充波动）。
  const aMin = Math.min(...v.map((s) => s.area));
  const aMax = Math.max(...v.map((s) => s.area));
  const pad = Math.max((aMax - aMin) * 0.25, aMax * 0.02);
  const yLo = Math.max(0, aMin - pad), yHi = aMax + pad;
  const px = (d) => PL + (x1 > x0 ? (d - x0) / (x1 - x0) : 0.5) * (W - PL - PR);
  const py = (a) => H - PB - (yHi > yLo ? (a - yLo) / (yHi - yLo) : 0.5) * (H - PT - PB);
  const line = v.map((s) => `${px(s.distance).toFixed(1)},${py(s.area).toFixed(1)}`).join(' ');

  // 按**下标**定位最小那一刀（按面积值找会同时点亮两刀面积四舍五入后相同的点）
  let minIdx = -1;
  for (let i = 0; i < v.length; i++) if (minIdx < 0 || v[i].area < v[minIdx].area) minIdx = i;
  const dots = v.map((s, i) => {
    const cls = i === minIdx ? ' pi-chart-dot-min'
      : (s.terminal || s.confidence === 'low') ? ' pi-chart-dot-dim' : '';
    return `<circle class="pi-chart-dot${cls}" cx="${px(s.distance).toFixed(1)}" cy="${py(s.area).toFixed(1)}" r="${i === minIdx ? 4 : 2.6}"><title>${fmt(s.distance, 1)} mm · ${fmt(s.area, 1)} mm²</title></circle>`;
  }).join('');

  // 突变位置（§九）在曲线上标一条竖虚线
  const jumps = (seg.jumps || []).filter((j) => j.at >= x0 && j.at <= x1).map((j) =>
    `<line class="pi-chart-jump" x1="${px(j.at).toFixed(1)}" y1="${PT}" x2="${px(j.at).toFixed(1)}" y2="${H - PB}"></line>`).join('');

  const gridY = [0, 0.5, 1].map((f) => {
    const val = yLo + (yHi - yLo) * f;
    const y = py(val);
    return `<line class="pi-chart-grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"></line>
      <text class="pi-chart-tick" x="${PL - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmt(val, val < 100 ? 1 : 0)}</text>`;
  }).join('');

  return `<svg class="pi-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    <title>${tr('截面积 A(s) 随沿流道距离的变化')}</title>
    ${gridY}
    <text class="pi-chart-axis" x="${PL - 6}" y="${PT - 1}" text-anchor="end">mm²</text>
    ${jumps}
    <polyline class="pi-chart-line" points="${line}"></polyline>
    ${dots}
    <text class="pi-chart-tick" x="${PL}" y="${H - 8}" text-anchor="start">${fmt(x0, 1)} mm</text>
    <text class="pi-chart-tick" x="${W - PR}" y="${H - 8}" text-anchor="end">${fmt(x1, 1)} mm</text>
  </svg>`;
}

/** 截面积序列（§十四：把 area(distance) 直接摊给用户看） */
function seriesText(series, max = 24) {
  const arr = series.map((a) => fmt(a, 1));
  if (arr.length <= max) return arr.join(' → ');
  return arr.slice(0, max).join(' → ') + tr(' …（共 {n} 个）', [arr.length]);
}

/** 一段流道的详情（§十四：最小截面积 / 最小位置 / 有效采样 / 截面积变化 / 突变 / 辅助标签） */
function segmentBlock(s) {
  const label = LABEL_TEXT[s.label] || LABEL_TEXT[FLOW_LABEL.CHANNEL];
  const isHint = s.label !== FLOW_LABEL.CHANNEL;
  const rows = [];
  rows.push(`<div class="pi-flrow"><span>${tr('最小截面积')}</span><b>${s.areaMin != null ? fmt(s.areaMin, 1) + ' mm²' : '—'}</b></div>`);
  rows.push(`<div class="pi-flrow"><span>${tr('最小位置')}</span><b>${s.areaMinAt != null ? fmt(s.areaMinAt, 1) + ' mm' : '—'}</b></div>`);
  rows.push(`<div class="pi-flrow"><span>${tr('有效采样')}</span><b>${s.validCount} / ${s.sampleCount}</b></div>`);
  if (s.lowConfidenceCount) {
    rows.push(`<div class="pi-flrow"><span>${tr('截面不闭合')}</span><b>${s.lowConfidenceCount}</b>
      <span class="pi-dim">${tr('刀（未计入最小/最大值）')}</span></div>`);
  }
  if (s.jumps.length) {
    for (const j of s.jumps) {
      rows.push(`<div class="pi-flrow pi-fljump"><span>${tr('截面突变')}</span>
        <b>${fmt(j.at, 1)} mm ${tr('附近')}</b>
        <span class="pi-dim">${fmt(j.from, 1)} → ${fmt(j.to, 1)} mm²（${j.dir === 'up' ? tr('扩张') : tr('收缩')} ${fmt(j.ratio, 2)}×）</span></div>`);
    }
  }
  // PHASE 92 §十四：**每一条边都挂自己的 A(s)** —— 数据属于正确的 Edge，
  // 不再是"把整条路径的样本画一张图"（那样看不出哪一段是哪条流道）。
  return `<div class="pi-flseg">
    <div class="pi-flhead">
      <span class="pi-flid">${esc(s.id)}</span>
      <span class="pi-dim">${tr('长度')} ${fmt(s.lengthMm, 1)} mm · ${tr('层级')} ${s.depth} · ${tr('结束于')} ${tr(END_TEXT[s.endReason] || s.endReason)}</span>
      ${isHint ? `<span class="pi-fltag">${tr(label)}</span>` : `<span class="pi-fltag pi-fltag-dim">${tr(label)}</span>`}
    </div>
    <div class="pi-flgrid">${rows.join('')}</div>
    ${areaChart(s)}
    ${s.series.length ? `<div class="pi-flseries"><span>${tr('截面积变化')}</span>
      <code>${seriesText(s.series)}</code>
      <span class="pi-dim">mm²</span></div>` : ''}
    ${!s.usable ? `<div class="pi-warnline">⚠ ${tr('有效数据不足以给出可靠的最小截面积（以上数值仅供参考）。')}</div>` : ''}
  </div>`;
}

/**
 * 从某个节点出发，按**边的方向**深度优先列出整棵子树（92.txt §十四）。
 * 输出的是行（不是表）：`E3 · 横浇道 · 长 9.6mm · 最小 198.6mm² → J3`
 * —— 让用户一眼看到 C1 → 交汇 → 横浇道 → 直浇道，而不是一条乱跑的线。
 */
function networkRows(tree, nodeId, depth, seen) {
  const rows = [];
  for (const e of (tree.edges || [])) {
    if (e.startNode !== nodeId || seen.has(e.id)) continue;
    seen.add(e.id);
    rows.push({ e, depth });
    rows.push(...networkRows(tree, e.endNode, depth + 1, seen));
  }
  return rows;
}

/** 节点在链里的显示名（kind 用图标区分，id 用原样） */
const NODE_ICON = { connection: '🔌', junction: '⑂', terminal: '⏹' };

function networkOutline(tree, rootEdge) {
  const rows = networkRows(tree, rootEdge.endNode, 1, new Set([rootEdge.id]));
  if (!rows.length) return '';
  const head = `<div class="pi-net-row" style="--d:0">
    <span class="pi-flid">${esc(rootEdge.id)}</span>
    <span class="pi-dim">${fmt(rootEdge.lengthMm, 1)} mm</span>
    <span class="pi-dim">${fmt(rootEdge.areaMin, 1)}${rootEdge.areaMax != null && Math.abs(rootEdge.areaMax - rootEdge.areaMin) > 0.5 ? '~' + fmt(rootEdge.areaMax, 1) : ''} mm²</span>
    <span class="pi-net-arrow">→</span><span class="pi-flid">${esc(rootEdge.endNode)}</span></div>`;
  const body = rows.map((r) => {
    const nd = (tree.nodes || []).find((n) => n.id === r.e.endNode);
    const isEnd = nd && nd.kind !== NODE_KIND.JUNCTION;
    return `<div class="pi-net-row" style="--d:${r.depth}">
      <span class="pi-dim">${'│ '.repeat(Math.max(r.depth - 1, 0))}└</span>
      <span class="pi-flid">${esc(r.e.id)}</span>
      <span class="pi-dim">${fmt(r.e.lengthMm, 1)} mm</span>
      <span class="pi-dim">${fmt(r.e.areaMin, 1)}${r.e.areaMax != null && Math.abs(r.e.areaMax - r.e.areaMin) > 0.5 ? '~' + fmt(r.e.areaMax, 1) : ''} mm²</span>
      <span class="pi-net-arrow">→</span>
      <span class="pi-flid${isEnd ? ' pi-net-end' : ''}">${NODE_ICON[nd?.kind] || ''}${esc(r.e.endNode)}</span>
    </div>`;
  }).join('');
  return `<div class="pi-net"><div class="pi-net-title">${tr('网络结构')}</div>${head}${body}</div>`;
}

/** 连接口的"凭什么算连接"证据行（91.txt §6/§17：可复核的几何事实，不是结论） */
function portEvidence(pc) {
  const bits = [];
  bits.push(`<span class="pi-tag info">${tr(PORT_KIND_TEXT[pc.kind] || '几何通道')}</span>`);
  if (pc.sectionAreaMm2 != null) bits.push(`<span>${tr('口处截面积')} <b>${fmt(pc.sectionAreaMm2, 1)}</b> mm²</span>`);
  bits.push(`<span class="pi-dim">${tr('穿越边界 {a} 面 · 产品内部 {b} 面',
    [pc.crossingTriangleCount || 0, pc.insideTriangleCount || 0])}</span>`);
  if (pc.depthMm != null && pc.depthMm > 0) bits.push(`<span class="pi-dim">${tr('伸入产品内部最深 {d} mm', [fmt(pc.depthMm, 1)])}</span>`);
  bits.push(`<span class="pi-dim">${tr('到产品表面 {g} mm', [fmt(pc.gapMm, 2)])}</span>`);
  return `<div class="pi-flconn">${bits.join('')}</div>`;
}

function renderGating(container, d) {
  const el = container.querySelector('#pi_gating');
  if (!el) return;                 // PHASE 93 §十四：主流程已不再输出这个区块
  const g = state.gating;
  if (!g) { el.innerHTML = `<div class="pi-empty">${tr('尚未导入浇注系统 STL')}</div>`; return; }
  const stat = (label, val, unit = '') =>
    `<div class="pi-gstat"><span>${label}</span><b>${val}</b>${unit ? ' ' + unit : ''}</div>`;

  // 没有产品 → 没有基准，连接区域无从谈起（91.txt §5：Product 是固定边界条件）
  if (!state.product?.mesh) {
    el.innerHTML = `<div class="pi-empty">${tr('导入产品 STL 后，程序会自动寻找产品与浇注系统的连接区域，并从连接处向外追踪流道。')}</div>`;
    return;
  }
  if (!g.tree || !g.summary) {
    el.innerHTML = `<div class="pi-empty">${tr('流道追踪未完成或失败。')}</div>`;
    return;
  }

  const s = g.summary;
  const segs = g.tree.segments;
  const roots = segs.filter((x) => x.depth === 0);

  // —— 总览（§14：网络口径 —— 口 / 交汇 / 末端 / 边）——
  let html = `<div class="pi-flstat">
    <span>${tr('发现流道 {n} 条', [roots.length])}</span>
    <span>${tr('产品连接口 {n} 处', [s.connectionCount])}</span>
    ${s.junctionCount ? `<span>${tr('交汇 {n} 个', [s.junctionCount])}</span>` : ''}
    ${s.terminalCount ? `<span>${tr('末端 {n} 个', [s.terminalCount])}</span>` : ''}
    ${s.edgeCount ? `<span>${tr('流道段 {n} 条', [s.edgeCount])}</span>` : ''}
    <span class="pi-dim">${tr('组件数量')} ${g.componentCount} · ${tr('总体积')} ${fmt(g.volumeMm3 / 1000, 1)} cm³ · ${tr('三角面')} ${g.mesh.triCount}</span>
  </div>
  ${g.openCount ? `<div class="pi-warnline">⚠ ${tr('{n} 个组件不是闭合网格，体积可能不可靠', [g.openCount])}</div>` : ''}
  ${g.degenerateTris ? `<div class="field-hint">${tr('已忽略 {n} 个零面积三角形（不承载几何）', [g.degenerateTris])}</div>` : ''}`;

  if (!s.connectionCount) {
    el.innerHTML = html + `<div class="pi-empty">${tr('未找到产品与浇注系统的连接区域。请确认两者在同一装配坐标系、且确实相接。')}</div>`;
    return;
  }

  // —— 逐条 Path（§14：一个产品连接口一张卡，点开看**它那棵树**与逐边的 A(s)）——
  //   注意 chain 现在是**图**，不是线性链表：从根边出发按边的方向 DFS 收全子树。
  let n = 0;
  for (const root of roots) {
    const rows = networkRows(g.tree, root.endNode, 1, new Set([root.id]));
    const allEdges = [root, ...rows.map((r) => r.e)];
    const reachLen = allEdges.reduce((a, x) => a + (x.lengthMm || 0), 0);
    const pc = (g.connections || []).find((c) => c.id === root.connectionId);
    const minArea = allEdges.reduce((m, x) => (x.areaMin != null && (m == null || x.areaMin < m) ? x.areaMin : m), null);
    const maxArea = allEdges.reduce((m, x) => (x.areaMax != null && (m == null || x.areaMax > m) ? x.areaMax : m), null);
    const label = LABEL_TEXT[root.label] || LABEL_TEXT[FLOW_LABEL.CHANNEL];
    n++;
    html += `<details class="pi-path"${n === 1 ? ' open' : ''}>
      <summary class="pi-path-head">
        <span class="pi-path-id">Path ${n}</span>
        <span class="pi-path-kv">${tr('长度')} <b>${fmt(reachLen, 1)}</b> mm</span>
        <span class="pi-path-kv">${tr('最小截面积')} <b>${minArea != null ? fmt(minArea, 1) : '—'}</b> mm²</span>
        <span class="pi-path-kv">${tr('最大截面积')} <b>${maxArea != null ? fmt(maxArea, 1) : '—'}</b> mm²</span>
        ${allEdges.length > 1 ? `<span class="pi-tag">${tr('{n} 段', [allEdges.length])}</span>` : ''}
        <span class="pi-fltag ${root.label === FLOW_LABEL.CHANNEL ? 'pi-fltag-dim' : ''}">${tr(label)}</span>
      </summary>
      <div class="pi-path-body">
        <div class="pi-path-src">${tr('连接到')} <b>${esc(root.connectionId)}</b>
          ${pc ? `<span class="pi-dim">· ${tr('到产品表面 {g} mm', [fmt(pc.gapMm, 2)])}</span>` : ''}</div>
        ${pc ? portEvidence(pc) : ''}
        ${networkOutline(g.tree, root)}
        ${allEdges.map((x) => segmentBlock(x)).join('')}
      </div>
    </details>`;
  }

  html += `<div class="field-hint" style="margin-top:8px">
    ${tr('浇注系统按**几何网络**追踪：从每个产品连接口向外走，遇到交汇就停下、记成节点，再往每个分支方向各起一条新的流道段（段与段之间共享节点）。截面积按“沿当前流向垂直切一刀”实测，不是用固定 X/Y/Z 平面切。')}
  </div>`;

  // §十七：诊断数据（默认折叠，?flowDebug=1 展开）
  const diag = g.diag;
  if (diag) {
    const open = new URLSearchParams(location.search).has('flowDebug') ? ' open' : '';   // 开发模式下默认展开
    html += `<details class="pi-fldiag"${open}>
      <summary>${tr('算法诊断')}</summary>
      <div class="pi-dgrid">
        <div class="pi-gstat"><span>${tr('连接判据')}</span><b>${fmt(g.tolMm, 2)}</b> mm</div>
        ${g.tolRelaxed ? `<div class="pi-gstat pi-warnline-inline"><span>${tr('实际用了放宽值')}</span><b>${fmt(g.tolUsedMm, 2)}</b> mm</div>` : ''}
        <div class="pi-gstat"><span>${tr('产品连接口')}</span><b>${diag.connectionCount}</b></div>
        <div class="pi-gstat"><span>${tr('流道条数')}</span><b>${diag.flowPathCount}</b></div>
        <div class="pi-gstat"><span>${tr('节点数')}</span><b>${diag.nodeCount}</b></div>
        <div class="pi-gstat"><span>${tr('交汇')}</span><b>${diag.junctionCount}</b></div>
        <div class="pi-gstat"><span>${tr('末端')}</span><b>${diag.terminalCount}</b></div>
        <div class="pi-gstat"><span>${tr('分叉数')}</span><b>${diag.branchCount}</b></div>
        <div class="pi-gstat"><span>${tr('分段数')}</span><b>${diag.segmentCount}</b></div>
        <div class="pi-gstat"><span>${tr('采样总数')}</span><b>${diag.sampleCount}</b></div>
        <div class="pi-gstat"><span>${tr('有效 / 无效')}</span><b>${diag.validSampleCount} / ${diag.invalidSampleCount}</b></div>
        <div class="pi-gstat"><span>${tr('最小截面积')}</span><b>${diag.minimumAreaMm2 != null ? fmt(diag.minimumAreaMm2, 1) : '—'}</b> mm²</div>
        <div class="pi-gstat"><span>${tr('最大截面积')}</span><b>${diag.maximumAreaMm2 != null ? fmt(diag.maximumAreaMm2, 1) : '—'}</b> mm²</div>
      </div>
      ${diag.areaChangeLocations.length ? `<div class="pi-dim">${tr('面积突变位置：')}${diag.areaChangeLocations
        .map((j) => `${esc(j.segmentId)} @ ${fmt(j.at, 1)} mm（${fmt(j.from, 1)}→${fmt(j.to, 1)}）`).join('；')}</div>` : ''}
      <div class="field-hint">${tr('判据 = 产品包围盒对角线 × {a}，下限 {b} mm、上限 {c} mm。几何不支持判断时一律不给数，只说明原因。',
      [FLOW_CONFIG.tolFrac, FLOW_CONFIG.tolAbsMinMm, FLOW_CONFIG.tolMaxMm])}</div>
    </details>`;
  }
  el.innerHTML = html;
}

/* ---- ⑤ 3D 场景 ---- */

/**
 * §十五：连接口 / 流道边 / 交汇点 / 末端 / 最小截面积位置 / 面积突变位置。
 *
 * PHASE 92 的三点变化：
 *   ① 交汇与末端现在是**节点**，直接按节点表画（不再从每段各自的 branchPoint 推）
 *   ② 每条边一个颜色 —— 一眼能看出"C1 → 交汇 → 横浇道 → 直浇道"是几段接起来的，
 *      而不是一条乱跑的线（§十五：不引入 complex legend，就用现成的图例）
 *   ③ 边从交汇点出发、但采样要等切得出干净截面才开始，中间那一小截用 leadIn 补上，
 *      免得图上出现"交汇点与流道之间断了一截"
 */
function flowOverlay() {
  const g = state.gating;
  const markers = [], polylines = [];
  if (!g?.tree) return { markers, polylines };
  for (const c of (g.connections || [])) {
    markers.push({ point: c.centroid, color: FLOW_COLOR.connection, label: c.id, dir: c.initialDir, scale: 1.15 });
  }
  const tree = g.tree;
  for (const n of (tree.nodes || [])) {
    if (n.kind === NODE_KIND.JUNCTION) {
      markers.push({ point: n.point, color: FLOW_COLOR.branch, label: n.id, scale: 1.0 });
    } else if (n.kind === NODE_KIND.TERMINAL) {
      markers.push({ point: n.point, color: FLOW_COLOR.terminal, label: n.id, scale: 0.85 });
    }
  }
  let mi = 0, ji = 0;
  tree.edges.forEach((s, i) => {
    const pts = s.leadIn && s.path?.length ? [s.leadIn, ...s.path] : s.path;
    if (pts && pts.length >= 2) polylines.push({ points: pts, color: EDGE_COLORS[i % EDGE_COLORS.length] });
    if (s.minPoint) markers.push({ point: s.minPoint, color: FLOW_COLOR.minArea, label: `m${++mi}`, scale: 0.8 });
    for (const j of s.jumps) {
      if (j.point) markers.push({ point: j.point, color: FLOW_COLOR.areaJump, label: `j${++ji}`, scale: 0.75 });
    }
  });
  return { markers, polylines };
}

function renderScene(container, d) {
  const box = container.querySelector('#pi_view3dBox');
  if (!box) return;
  if (!state.product && !state.risers.length && !hasGatingUnits()) return;
  const firstUnit = GATING_KINDS.map(k => state.units[k][0]).find(Boolean);
  const center = state.product?.metrics?.center || state.risers[0]?.bounds?.center
    || firstUnit?.metrics?.center || [0, 0, 0];

  // §十二：产品 + 冒口在**同一个场景**里，按统一的 center 平移 —— 相对空间位置不变。
  // 94.txt §十一：浇注系统的三类单元同样进这个场景（各有各的颜色），这样
  // "点详细信息里的 S1/G1/I1 → 看它到底在哪"才有依托；3D 仍然只是辅助验证，不是主结果。
  const items = [];
  if (state.product) items.push({ mesh: state.product.mesh, color: KIND_COLOR[KIND.PRODUCT], key: null });
  // 冒口带 key → 可拾取。key 就是它的 ID，点中即选中该冒口（§十二）。
  for (const o of state.risers) if (o.mesh) items.push({ mesh: o.mesh, color: KIND_COLOR[KIND.RISER], key: o.id });
  for (const k of GATING_KINDS) for (const o of state.units[k]) {
    if (o.mesh) items.push({ mesh: o.mesh, color: KIND_COLOR[k], key: o.id });
  }

  // ⚠ 选中态**不能**进场景指纹：那样每点一次卡片都要重建整个 3D（buildMesh × N）。
  //   高亮是纯材质操作，重建之后单独补一次即可。
  const gsig = GATING_KINDS.map(k => state.units[k].map(o => o.id).join(',')).join(';');
  const sig = [state.product?.name || '', state.risers.map(o => o.id + o.name).join(','), gsig].join('|');
  // 场景指纹必须同时比对**承载元素本身**（PHASE 88 回归守卫）：render() 会整块重写
  // container.innerHTML，旧 canvas 连同元素一起没了，只看指纹会误判"无需重建" → 3D 直接消失。
  if (sig !== state._sceneSig || !state.view3d || state._sceneBox !== box) {
    state._sceneSig = sig;
    state._sceneBox = box;
    if (state.view3d) state.view3d.dispose();
    state.view3d = new ModelView3D(box);
    state.view3d.loadScene(items, center);
    state.view3d.setDisplayMode(state.dispMode);
    // 点 3D 里的热点 marker → 选中（modelView3D 既有机制，PHASE 93 之前没人接）
    state.view3d.onSelectHotspot = (i) => {
      state._hsPickAt = Date.now();
      state.sel = i < 0 ? null : { kind: 'hotspot', id: 'H' + (d.hotspots[i]?.id ?? (i + 1)) };
      paint(container);
    };
    // 点 3D 里的冒口 / 浇注系统单元实体 → 选中它
    state.view3d.setPickMode(({ key }) => {
      if (!key) return;
      // 热点 marker 与实体可能前后重叠：同一次点击里热点优先（marker 是明确的语义标记）
      if (Date.now() - (state._hsPickAt || 0) < 400) return;
      const kind = state.risers.some(o => o.id === key) ? 'riser' : 'unit';
      state.sel = { kind, id: key };
      paint(container);
    });
    if (d.hotspots.length) {
      state.view3d.setHotspots(d.hotspots.map(h => ({
        ...h, x: h.x - center[0], y: h.y - center[1], z: h.z - center[2],
      })));
    }
  }
  applySelection(d);

  const legend = container.querySelector('#pi_legend');
  if (legend) {
    const parts = [];
    if (state.product) parts.push([KIND_COLOR[KIND.PRODUCT], tr('产品')]);
    if (state.risers.length) parts.push([KIND_COLOR[KIND.RISER], tr('冒口')]);
    for (const k of GATING_KINDS) if (state.units[k].length) parts.push([KIND_COLOR[k], kzh(k)]);
    if (d.hotspots.length) parts.push([0xff5252, tr('热点')]);
    legend.innerHTML = parts.map(([c, n]) =>
      `<span class="pi-lgi"><i style="background:#${c.toString(16).padStart(6, '0')}"></i>${n}</span>`).join('');
  }
}

/**
 * 把 state.sel 落到 3D 上（场景重建后也要补一次，所以单独抽出来）。
 * focus 只在"用户刚刚主动点了卡片"那一次为真 —— 否则每次重画都把视角拽走。
 */
function applySelection(d) {
  const v = state.view3d;
  if (!v) return;
  const focus = !!state._focusSel;
  state._focusSel = false;
  // 冒口与浇注系统单元走同一条路：按 key 高亮 + （用户主动点时才）把相机带过去（94.txt §十一"定位"）
  if (state.sel?.kind === 'riser' || state.sel?.kind === 'unit') {
    v.setHighlight(state.sel.id, focus);
    return;
  }
  v.setHighlight(null);
  const i = state.sel?.kind === 'hotspot' ? (d.hotspots || []).findIndex(h => 'H' + h.id === state.sel.id) : -1;
  v.selectHotspot(i, focus && i >= 0);
}

/* ---- ⑥ 详细数据（§八/§九：每个冒口的几何量都摊开，可逐项核对） ---- */
function renderDetail(container, d) {
  // ⚠ 模数这一列取的是**行里那个已经过可用性判定的值**，不是 o.metrics.modulusMm ——
  //   不闭合的冒口 metrics 里仍有一个算得出来的 V/A，直接显示它等于给了一个不可信的猜值（§八）。
  const rowOf = new Map((d.relation?.rows || []).map(r => [r.riserId, r]));
  const riserRows = state.risers.map(o => {
    const m = o.metrics || {};
    const row = rowOf.get(o.id);
    const mm = row ? row.riserModulus : m.modulusMm;
    return `<tr>
      <td><b>${esc(o.id)}</b></td>
      <td class="pi-tdname">${esc(o.name)}</td>
      <td>${m.volumeMm3 != null ? fmt(m.volumeMm3 / 1000, 2) : '—'}</td>
      <td>${m.areaMm2 != null ? fmt(m.areaMm2 / 100, 1) : '—'}</td>
      <td>${mm != null ? fmt(mm, 2) : `<span class="pi-warn">${tr('不可得')}</span>`}</td>
      <td>${row?.nearest ? `<b>H${esc(row.nearest.hsId)}</b>` : '—'}</td>
      <td>${row?.nearest?.ratio != null ? fmt(row.nearest.ratio, 2) : '—'}</td>
      <td>${m.size ? m.size.map(v => fmt(v, 1)).join('×') : '—'}</td>
      <td>${o.closed ? '✓' : '⚠'}</td>
      <td><button class="pi-x" type="button" data-pi-remove="${esc(o.id)}" title="${esc(tr('删除'))}">×</button></td>
    </tr>`;
  }).join('');

  const hsRows = (d.hotspots || []).map(h => `<tr>
      <td><b>H${esc(h.id)}</b></td>
      <td>${fmt(h.mc, 1)}</td>
      <td>${h.regionVolumeCm3 != null ? fmt(h.regionVolumeCm3, 1) : '—'}</td>
      <td>${h.confidence != null ? fmt(h.confidence, 2) : '—'}</td>
      <td>${[h.x, h.y, h.z].map(v => fmt(v, 1)).join(', ')}</td>
    </tr>`).join('');

  const p = state.product;
  container.querySelector('#pi_detail').innerHTML = `
    ${p ? `<div class="pi-dgroup"><div class="pi-dtitle">📦 ${tr('产品几何')}</div>
      <div class="pi-dgrid">
        <div class="pi-gstat"><span>${tr('件数')}</span><b>${p.partCount}</b></div>
        <div class="pi-gstat"><span>${tr('总体积')}</span><b>${fmt(p.metrics.volumeMm3 / 1000, 2)}</b> cm³</div>
        <div class="pi-gstat"><span>${tr('表面积')}</span><b>${fmt(p.metrics.areaMm2 / 100, 1)}</b> cm²</div>
        <div class="pi-gstat"><span>${tr('三角面')}</span><b>${p.metrics.triCount}</b></div>
        ${p.partCount > 1 ? p.objects.map(o => `<div class="pi-gstat"><span>${esc(o.id)}${o.closed ? '' : ' ⚠'}</span>
          <b>${fmt((o.metrics?.volumeMm3 || 0) / 1000, 2)}</b> cm³</div>`).join('') : ''}
      </div></div>` : ''}
    ${state.risers.length ? `
      <div class="pi-dgroup"><div class="pi-dtitle">🏗️ ${tr('冒口几何明细')}</div>
        <div class="pi-tablewrap"><table class="pi-table">
          <thead><tr><th>ID</th><th>${tr('文件')}</th><th>${tr('体积')} cm³</th><th>${tr('表面积')} cm²</th>
            <th>${tr('模数 M')} mm</th><th>${tr('最近热点')}</th><th>${tr('模数比')}</th>
            <th>${tr('尺寸')} mm</th><th>${tr('闭合')}</th><th></th></tr></thead>
          <tbody>${riserRows}</tbody>
        </table></div>
      </div>` : ''}
    ${hsRows ? `
      <div class="pi-dgroup"><div class="pi-dtitle">🔴 ${tr('热点明细')}</div>
        <div class="pi-tablewrap"><table class="pi-table">
          <thead><tr><th>ID</th><th>${tr('热点模数')} mm</th><th>${tr('区域')} cm³</th>
            <th>${tr('置信度')}</th><th>${tr('坐标')} mm</th></tr></thead>
          <tbody>${hsRows}</tbody>
        </table></div>
      </div>` : ''}
    <div class="field-hint">${tr('模数 M = 体积 ÷ 表面积（该对象自身的 V/A）。热点位置与模数取自热点分析引擎的输出，本页不做任何重算。')}</div>`;
}
