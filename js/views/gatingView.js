// ============================================================
// 浇注系统设计 · 视图（单列居中版式，沿用原工具分区与公式标注）
// 基本参数 → 计算结果 → 组元尺寸 → 综合判定，实时计算 + 计算记录
// ============================================================
import { MATERIALS, RATIO_PRESETS, runGating, recommendGatingRatio } from '../../calcs/gating.js';
import { rankFilters } from '../../calcs/filter.js';
import { suggestCeramicTube } from '../../data/ceramic_tube.js';
import { gatingDiagramSvg } from './gatingDiagram.js';
import { pourTimeReference } from '../../calcs/pourTimeTable.js';
import { recommendPourTemp } from '../../calcs/pourTemp.js';
import { prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { saveFile } from '../download.js';
import { checkNum, firstErr } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';
// PHASE 72（80.txt §八）：核心计算器 UI 中英双语（公式/变量/单位/报告正文不动）
import { t as tr } from '../i18n/index.js';
import { setRecompute } from '../i18n/viewState.js';

/* PHASE 72：属性值转义（title 等；i18n 文案可能含引号） */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 材料键 → 大类（过滤网标准按大类） */
const FAMILY_OF_MAT = { '灰铁(HT)': '灰铁', '球铁(QT)': '球铁', '铸钢(ZG)': '铸钢', '铝合金(Al)': '铝合金', '铜合金(Cu)': '铜合金' };

// P51 收尾（53.txt §五）：预设一句话适用范围——依据 recommendGatingRatio 现有自动选择条件整理（不新造阈值）；
//   200kg 分界为代码既有条件（partWt>200 升档），note 取 RATIO_PRESETS 自带注释
const RATIO_APPLIC = {
  '封闭式 保守型(灰铁)': '灰铁保守备选（系统默认兜底方案）',
  '封闭式 常用型': '灰铁常规铸件（≤200kg）系统默认推荐',
  '封闭式 大件型': '灰铁大件（>200kg）系统自动升档',
  '开放式 标准型': '球铁/铜合金常规铸件（≤200kg）系统默认推荐',
  '开放式 宽大型': '大件（>200kg：球铁/铸钢/铝/铜）系统自动升档',
  '开放式 铝合金属': '铝合金铸件系统默认推荐',
};
const ratioFmt = (k) => (RATIO_PRESETS[k] ? RATIO_PRESETS[k].r.join(':') : '');
const fmtRatio3 = (a, b, c) => `${+a.toFixed(2)}:${+b.toFixed(2)}:${+c.toFixed(2)}`;

// 59.txt：Campbell 工程补充信息——纯提示层，参与任何计算/判定
const ENG_NOTES = {
  sprue: '工程原则：直浇道宜采用连续、平滑的锥度，以减少充型过程中卷气和吸气风险，并避免突然变截面。',
  runner: '工程原则：横浇道截面宜平稳过渡，避免突然扩张或剧烈改变流向，以降低紊流和卷气风险。',
  turn: '工程提示：浇道转弯宜尽量平缓，避免尖锐转角和突然改变流向，有利于保持流动稳定。',
  gateVel: '工程参考：浇口速度应兼顾充型时间与平稳充型。Campbell 等资料强调降低过高流速有助于减少卷气和冲刷风险，具体合理范围仍应结合合金、铸件结构和浇注工艺确定。',
  filter: '工程提示：过滤器除过滤夹杂物外，还会对金属液流动产生阻尼作用，从而影响流速和充型过程。实际效果与过滤器规格、面积及安装方式有关。',
};

const DEFAULTS = {
  mat: '灰铁(HT)', pw: 46.8, cav: 2, wall: 37.5, yr: 75,
  pos: '顶注', Ho: 180, ph: 76, rh: 171.5, ratioKey: '封闭式 常用型',
  gc: 2, gt: 15, rc: 2, rt: 25,
  vr: 15, vrc: 4, vs: 75, vst: 8, vsc: 4,
  cs: 1.0, cr: 2.0, cg: 2.0,
};

export function renderGating(container, calc) {
  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn btn-ghost" data-back>${tr('common.back')}</button>
          <span class="tool-icon" style="width:36px;height:36px;font-size:1.05rem">${calc.icon}</span>
          <h1 class="page-title" style="font-size:1.2rem">${tr(calc.name)}</h1>
        </div>
        <p class="page-sub">${tr(calc.desc)}</p>
      </div>
      <span class="badge-status badge-ready">${tr('✓ 可用')}</span>
    </div>

    <div class="calc-single">
      <!-- 1 基本参数 -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">1</span>📋 ${tr('基本参数')}</div>
        <div class="field" style="margin-bottom:12px">
          <label class="field-label">🔩 ${tr('材质')}</label>
          <div class="f-row"><select class="field-select" id="g_mat">${Object.keys(MATERIALS).map(k => `<option value="${k}">${tr(k)}</option>`).join('')}</select><span class="f-unit" id="g_mat_hint" style="width:auto"></span></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">⚖️ ${tr('单件毛重')}</label><div class="f-row"><input class="field-input" type="number" id="g_pw" value="${DEFAULTS.pw}" step="0.1" min="0"><span class="f-unit">Kg</span></div></div>
          <div class="field"><label class="field-label">🔢 ${tr('一模件数')}</label><div class="f-row"><input class="field-input" type="number" id="g_cav" value="${DEFAULTS.cav}" step="1" min="1"><span class="f-unit">${tr('件')}</span></div></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">📐 ${tr('产品壁厚')}</label><div class="f-row"><input class="field-input" type="number" id="g_wall" value="${DEFAULTS.wall}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field"><label class="field-label">📊 ${tr('预估出品率')}</label><div class="f-row"><input class="field-input" type="number" id="g_yr" value="${DEFAULTS.yr}" step="1" min="10" max="100"><span class="f-unit">%</span></div></div>
        </div>
        <div class="divider"></div>
        <div class="field" style="margin-bottom:12px">
          <label class="field-label">⬇️ ${tr('浇注方向')}</label>
          <div class="f-row"><select class="field-select" id="g_pos">${['顶注', '中注', '底注'].map(k => `<option value="${k}">${tr(k)}</option>`).join('')}</select><span class="f-unit" style="width:auto"></span></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">📏 Ho${tr('（内浇道至上箱面）')}</label><div class="f-row"><input class="field-input" type="number" id="g_Ho" value="${DEFAULTS.Ho}" step="1" min="0"><span class="f-unit">mm</span></div><div class="field-hint" style="margin-top:4px">${tr('内浇道基准至上箱面的垂直距离（见图）')}</div></div>
          <div class="field"><label class="field-label">📏 ${tr('产品高度（浇注向）')}</label><div class="f-row"><input class="field-input" type="number" id="g_ph" value="${DEFAULTS.ph}" step="1" min="0"><span class="f-unit">mm</span></div><div class="field-hint" style="margin-top:4px">${tr('浇注方向下铸件有效高度（铸件底→铸件顶）')}</div></div>
        </div>
        <div class="field"><label class="field-label">📏 ${tr('冒口高于铸件顶面的距离')}</label><div class="f-row"><input class="field-input" type="number" id="g_rh" value="${DEFAULTS.rh}" step="0.5" min="0"><span class="f-unit">mm</span></div><div class="field-hint" style="margin-top:4px">${tr('无冒口时填 0')}</div></div>
        <div id="g_diagram" style="margin:12px 0"></div>
        <div class="divider"></div>
        <div class="field">
          <label class="field-label">⚙️ ${tr('浇注比例预设（S直:S横:S内）')}<span id="g_ratioInfo" style="cursor:help;font-size:12px;color:#94a3b8;margin-left:4px" title="${esc(tr('点击查看：开放式/封闭式怎么选'))}">ⓘ</span></label>
          <div class="f-row">
            <select class="field-select" id="g_ratio">
              ${Object.keys(RATIO_PRESETS).map(k => `<option value="${k}">${tr(k)}（${tr('S直:S横:S内')} = ${RATIO_PRESETS[k].r.join(':')}）</option>`).join('')}
              <option value="__custom">✏️ ${tr('自定义')}</option>
            </select>
            <span class="f-unit" style="width:auto" id="g_ratio_note"></span>
          </div>
          <div class="field-hint" style="margin-top:5px" id="g_ratio_desc"></div>
        </div>
        <div id="g_custom_ratio" style="display:none;margin-top:10px">
          <div class="field-grid3">
            <div class="field"><label class="field-label">📐 S直</label><div class="f-row"><input class="field-input" type="number" id="g_cs" value="${DEFAULTS.cs}" step="0.1" min="0.1"><span class="f-unit">${tr('份')}</span></div></div>
            <div class="field"><label class="field-label">📐 S横</label><div class="f-row"><input class="field-input" type="number" id="g_cr" value="${DEFAULTS.cr}" step="0.1" min="0.1"><span class="f-unit">${tr('份')}</span></div></div>
            <div class="field"><label class="field-label">📐 S内</label><div class="f-row"><input class="field-input" type="number" id="g_cg" value="${DEFAULTS.cg}" step="0.1" min="0.1"><span class="f-unit">${tr('份')}</span></div></div>
          </div>
          <div class="field-hint" style="margin-top:6px">${tr('填写 S直:S横:S内 比例（正数），如 1 : 2 : 2')}</div>
        </div>
        <!-- 过滤网工艺条件（PHASE 45-B：放比例预设下方；型号由软件自动推荐） -->
        <div class="divider" style="margin-top:12px"></div>
        <div class="field" style="margin-top:12px">
          <div class="f-row" style="gap:16px">
            <label class="field-label" style="margin:0">🧹 ${tr('过滤网')}</label>
            <label class="radio-label"><input type="radio" name="g_filterUsed" value="no" checked> ${tr('不使用')}</label>
            <label class="radio-label"><input type="radio" name="g_filterUsed" value="yes"> ${tr('使用')}</label>
            <span class="f-unit" style="width:auto" title="${esc(tr('过滤网是否使用应结合材质、铸件质量要求和企业工艺规范确定。使用后可改善金属液洁净度与流动稳定性。'))}">ⓘ</span>
          </div>
          <div class="field-hint" style="margin-top:4px" id="g_filterHint">${tr('过滤网是否使用应结合材质、铸件质量要求和企业工艺规范确定。')}</div>
        </div>
      </div>

      <!-- 2 计算结果（P51 信息减法：第一屏给答案，详细信息给依据） -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">2</span>📊 ${tr('sec.results')}</div>
        <div id="g_summary"></div>
        <details id="g_details" style="margin-top:10px">
          <summary style="cursor:pointer;font-size:.85rem;color:#475569;padding:6px 0;user-select:none">⌄ ${tr('详细信息 · 完整计算过程（公式/查表/参考面积/校核）')}</summary>
          <div class="results" id="g_results" style="margin-top:6px"><div class="empty" style="padding:12px"><span class="empty-sub">${tr('填写参数后自动计算…')}</span></div></div>
        </details>
        <!-- 过滤网工艺条件（仅使用过滤网时显示，PHASE 45-B） -->
        <div class="results" style="margin-top:10px" id="g_filterRec"></div>
      </div>

      <!-- 3 组元尺寸 -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">3</span>📐 ${tr('组元尺寸')} <small>${tr('改厚度/个数，长度或直径自动算')}</small></div>
        <div class="group-title">🟦 ${tr('内浇道')}</div>
        <div class="field" style="margin-bottom:8px">
          <label class="field-label">🔷 ${tr('形状')}</label>
          <div class="f-row"><select class="field-select" id="g_gateShape">${['方形', '圆形'].map(k => `<option value="${k}">${tr(k)}</option>`).join('')}</select><span class="f-unit" style="width:auto" id="g_gateShapeHint"></span></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">🔢 ${tr('个数')}</label><div class="f-row"><input class="field-input" type="number" id="g_gc" value="${DEFAULTS.gc}" step="1" min="1"><span class="f-unit">${tr('个')}</span></div></div>
          <div class="field" id="g_gtField"><label class="field-label">📐 ${tr('厚度')}</label><div class="f-row"><input class="field-input" type="number" id="g_gt" value="${DEFAULTS.gt}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
        </div>
        <div class="results gcards" style="margin-top:8px">
          <div class="rrow" id="g_ig_len"><span class="rl">📏 ${tr('推荐长度')}</span><span class="rv">—</span></div>
          <div class="rrow" id="g_ig_dia" style="display:none"><span class="rl">⭕ ${tr('推荐直径')}</span><span class="rv">—</span></div>
          <div class="rrow" id="g_ig_tube" style="display:none"><span class="rl">🧱 ${tr('瓷管建议')}</span><span class="rv">—</span></div>
          <div class="rrow" id="g_ig_area"><span class="rl">📐 ${tr('实际总面积')}</span><span class="rv">—</span></div>
        </div>
        <!-- 60.txt：浇口速度工程参考（组元尺寸区直接可见，原在详细信息折叠内） -->
        <div class="eng-note">${tr(ENG_NOTES.gateVel)}</div>
        <div class="divider"></div>
        <div class="group-title">🟧 ${tr('横浇道（长方形）')}</div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">🔢 ${tr('条数')}</label><div class="f-row"><input class="field-input" type="number" id="g_rc" value="${DEFAULTS.rc}" step="1" min="1"><span class="f-unit">${tr('条')}</span></div></div>
          <div class="field"><label class="field-label">📐 ${tr('厚度')}</label><div class="f-row"><input class="field-input" type="number" id="g_rt" value="${DEFAULTS.rt}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
        </div>
        <div class="results gcards" style="margin-top:8px">
          <div class="rrow" id="g_rr_len"><span class="rl">📏 ${tr('推荐长度')}</span><span class="rv">—</span></div>
          <div class="rrow" id="g_rr_area"><span class="rl">📐 ${tr('实际总面积')}</span><span class="rv">—</span></div>
        </div>
        <!-- 60.txt：横浇道过渡+转弯工程原则（组元尺寸区直接可见） -->
        <div class="eng-note">${tr(ENG_NOTES.runner)}<br>${tr(ENG_NOTES.turn)}</div>
        <div class="divider"></div>
        <div class="group-title">⬇️ ${tr('直浇道（自动）')}</div>
        <div class="results gcards" style="margin-top:8px">
          <div class="rrow" id="g_sp_dia"><span class="rl">⭕ ${tr('推荐直径（1根圆形）')}</span><span class="rv">—</span></div>
          <div class="rrow" id="g_sp_area"><span class="rl">📐 ${tr('实际截面积')}</span><span class="rv">—</span></div>
        </div>
        <!-- 60.txt：直浇道锥度工程原则（组元尺寸区直接可见） -->
        <div class="eng-note">${tr(ENG_NOTES.sprue)}</div>
        <div class="divider"></div>
        <div class="group-title">💭 ${tr('排气（自动生成，无需填写）')}</div>
        <div class="field" style="margin-bottom:8px">
          <div class="f-row" style="gap:16px">
            <label class="field-label" style="margin:0">🔘 ${tr('形式')}</label>
            <label class="radio-label"><input type="radio" name="g_ventType" value="圆孔" checked> ${tr('圆孔')}</label>
            <label class="radio-label"><input type="radio" name="g_ventType" value="方片"> ${tr('方片')}</label>
            <span class="f-unit" style="width:auto" title="${esc(tr('按企业标准 1.5~4 倍 S直 自动生成；圆孔直径随壁厚（3~10mm），方片厚度 ≤ 铸件壁厚。'))}">ⓘ</span>
          </div>
        </div>
        <div class="results gcards" style="margin-top:8px">
          <div class="rrow ok" id="g_ventSug"><span class="rl">⚡ ${tr('自动生成')}</span><span class="rv">—</span></div>
          <div class="rrow" id="g_vent_ratio"><span class="rl">💭 ${tr('排气面积比 S出/S直')}</span><span class="rv">—</span></div>
        </div>
      </div>

      <!-- 4 综合判定（P51 + 显示优化：判定与问题清单默认平铺显示） -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">4</span>✅ ${tr('判定与建议')}</div>
        <div id="g_judge" style="color:var(--text-muted);font-size:.8rem;margin-top:6px">${tr('等待计算…')}</div>
        <div id="g_sugs" style="margin-top:10px"></div>
        <button class="btn btn-primary" id="g_reportBtn" style="width:100%;margin-top:14px">📄 ${tr('生成计算记录')}</button>
      </div>
    </div>

    <!-- 报告模态框（计算记录文档本身保持中文：与知识库同口径，非 UI 文案） -->
    <div class="modal-overlay" id="g_modal" hidden>
      <div class="modal">
        <div class="modal-head"><div class="modal-title">📄 ${tr('浇注系统设计计算记录')}</div><button class="modal-close" data-close>&times;</button></div>
        <div class="report-body" id="g_reportBody"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="g_reportCopy" style="flex:1">📋 ${tr('复制文本')}</button>
          <button class="btn btn-primary" id="g_reportDl" style="flex:1">⬇️ ${tr('下载报告')}</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });

  const q = (id) => container.querySelector(id);
  const matHint = q('#g_mat_hint');
  const ratioHint = q('#g_ratio_note');
  let ratioTouched = false;

  const syncHints = () => {
    const mat = q('#g_mat').value;
    const m = MATERIALS[mat];
    matHint.textContent = tr('ρ={r} · 出品率 {a}~{b}%', [m.rho, m.y_min, m.y_max]);
    const pw = parseFloat(q('#g_pw').value) || 0;
    const rec = recommendGatingRatio(mat, pw);
    const cur = q('#g_ratio').value;
    if (cur === '__custom') ratioHint.textContent = tr('自定义比例');
    else if (cur !== rec) ratioHint.textContent = `⚡ ${tr('建议')} ${tr(rec)}`;
    else ratioHint.textContent = tr('✓ 推荐');
    // P51 收尾（53.txt §四/§五）：选中预设的 名称+比例+适用 说明行（只读展示，不参与计算）
    const desc = q('#g_ratio_desc');
    if (desc) {
      if (cur === '__custom') {
        desc.textContent = `${tr('自定义比例：S直:S横:S内 =')} ${q('#g_cs').value}:${q('#g_cr').value}:${q('#g_cg').value}${tr('（按实际输入计算）')}`;
      } else {
        desc.textContent = `${tr(cur)} · ${tr('S直:S横:S内')} = ${ratioFmt(cur)} · ${tr(RATIO_APPLIC[cur] || '')}${RATIO_PRESETS[cur]?.note ? `（${tr(RATIO_PRESETS[cur].note)}）` : ''}`;
      }
    }
  };

  const toggleCustom = () => {
    q('#g_custom_ratio').style.display = q('#g_ratio').value === '__custom' ? 'block' : 'none';
  };

  /** 内浇道形状切换（PHASE 45-B）：圆形 → 隐藏厚度/长度，显示推荐直径+瓷管建议 */
  const toggleGateShape = () => {
    const round = q('#g_gateShape').value === '圆形';
    q('#g_gtField').style.display = round ? 'none' : 'block';
    q('#g_ig_len').style.display = round ? 'none' : '';
    q('#g_ig_dia').style.display = round ? '' : 'none';
    q('#g_ig_tube').style.display = round ? '' : 'none';
    q('#g_gateShapeHint').textContent = round ? tr('圆形（如瓷管）：只需个数，直径自动计算') : tr('方形：填个数与厚度，长度自动计算');
  };

  /** 排气形式切换（PHASE 45-B）：圆孔/方片二选一，建议文案随形式更新 */
  const toggleVentType = () => {
    if (lastResult) renderComponents(lastResult);
  };

  let lastResult = null;
  let optMode = false;   // P50（51.txt）：默认基础设计；用户点击"按目标速度优化"后置 true（仅影响内浇口几何）
  // 出品率联动（PHASE 45-B）：用户手改过出品率后，切换材质不再覆盖
  let yrTouched = false;
  const read = () => {
    const ratioSel = q('#g_ratio').value;
    const custom = ratioSel === '__custom';
    return {
      mat: q('#g_mat').value,
      pw: parseFloat(q('#g_pw').value) || 0,
      cav: parseInt(q('#g_cav').value) || 1,
      wall: parseFloat(q('#g_wall').value) || 0,
      yr: parseFloat(q('#g_yr').value) || 0,
      pos: q('#g_pos').value,
      Ho: parseFloat(q('#g_Ho').value) || 0,
      ph: parseFloat(q('#g_ph').value) || 0,
      rh: parseFloat(q('#g_rh').value) || 0,
      ratioKey: custom ? undefined : ratioSel,
      custom,
      cs: parseFloat(q('#g_cs').value) || 1, cr: parseFloat(q('#g_cr').value) || 1, cg: parseFloat(q('#g_cg').value) || 1,
      gc: parseInt(q('#g_gc').value) || 0, gt: parseFloat(q('#g_gt').value) || 0,
      rc: parseInt(q('#g_rc').value) || 0, rt: parseFloat(q('#g_rt').value) || 0,
      // 排气参数自动生成（PHASE 45-B：用户不填），不传 → gating.js 自动采用建议值
      filterUsed: q('input[name="g_filterUsed"]:checked')?.value === 'yes',
      gateShape: q('#g_gateShape')?.value || '方形',
      ventType: q('input[name="g_ventType"]:checked')?.value || '圆孔',
    };
  };
  /** 浇注方向示意图渲染（随 pos 切换；点击放大） */
  const renderDiagram = () => {
    const box = q('#g_diagram');
    if (!box) return;
    const pos = q('#g_pos').value;
    const svg = gatingDiagramSvg(pos);
    box.innerHTML = svg ? `<div class="g-diagram" style="cursor:zoom-in" title="${esc(tr('点击放大'))}">${svg}</div>` : '';
  };
  /** 过滤网推荐渲染（PHASE 45-B：选项在基本参数；仅使用过滤网时结果区显示工艺条件） */
  const renderFilterRec = () => {
    const box = q('#g_filterRec');
    const hint = q('#g_filterHint');
    if (!box || !lastResult) return;
    const used = lastResult.filterUsed;
    hint.textContent = used
      ? tr('使用：过滤网可用于改善金属液洁净度和流动稳定性。具体使用条件应结合材质、铸件质量要求及企业工艺规范确定。')
      : tr('过滤网是否使用应结合材质、铸件质量要求和企业工艺规范确定。');
    if (!used) { box.innerHTML = ''; return; }   // 不使用 → 结果区不写过滤网工艺条件
    const family = FAMILY_OF_MAT[lastResult.mat] || '灰铁';
    const r = rankFilters(lastResult.G, family);
    if (!r) {
      box.innerHTML = `<div class="group-title">🧹 ${tr('过滤网工艺条件')}</div><div class="field-hint" style="padding:6px 4px">⚠️ ${tr('{a}暂无企业过滤网过流量标准（仅灰铁/球铁有），无法推荐。', [tr(family)])}</div>`;
      return;
    }
    if (!r.feasible) {
      box.innerHTML = `
        <div class="group-title">🧹 过滤网工艺条件</div>
        <div class="rrow bad"><span class="rl">⛔ 暂无满足当前计算条件的过滤网规格</span><span class="rv"></span></div>
        <div class="field-hint" style="padding:6px 4px 0">当前需求过流能力：${fmt(r.demand, 1)} kg ｜ 最大可用规格过流能力：${fmt(r.maxCapacity, 0)} kg</div>
        <div class="field-hint" style="padding:6px 4px 0">来源：企业「过滤网标准」（C 级经验数据）</div>`;
      return;
    }
    const medals = ['🥇 推荐', '🥈 可选', '🥉 可选'];
    box.innerHTML = `
      <div class="group-title">🧹 过滤网工艺条件</div>
      <div class="field-hint" style="padding:2px 4px 6px">根据本次浇注条件和企业过滤网过流量标准筛选（先满足过流量，再选规格适配、不过度放大的型号）：</div>
      ${r.list.slice(0, 3).map((it, i) => `
        <div class="rrow ok"><span class="rl">${medals[i]} ${it.spec.type} ${it.spec.model}</span>
          <span class="rv">允许过流量 ${it.capacity} kg ｜ 本次需求 ${fmt(r.demand, 1)} kg ｜ 余量 ${fmt(it.capacity - r.demand, 1)} kg</span></div>`).join('')}
      ${r.list.length > 3 ? `<div class="field-hint" style="padding:4px 4px 0">另有 ${r.list.length - 3} 个规格可选（未全部列出）</div>` : ''}
      <div class="field-hint" style="padding:6px 4px 0">来源：企业「过滤网标准」（C 级经验数据）；推荐仅作建议，不改变浇注系统</div>
      <div class="eng-note" style="margin-top:8px">${ENG_NOTES.filter}</div>`;
  };
  /** 图放大 overlay（简单实现，无复杂弹窗系统） */
  const setupDiagramZoom = () => {
    const body = document.body;
    const open = (svgHtml) => {
      let ov = document.getElementById('g_diagramOverlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'g_diagramOverlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
        ov.addEventListener('click', () => ov.remove());
        body.appendChild(ov);
      }
      ov.innerHTML = `<div style="max-width:min(92vw,560px);width:100%;padding:12px;background:#fff;border-radius:10px">${svgHtml}</div>`;
    };
    q('#g_diagram').addEventListener('click', (e) => {
      const svg = q('#g_diagram svg');
      if (svg) open(svg.outerHTML);
    });
  };

  // PHASE 63 · P1-2：示例默认值（ALR2510 演示件数值）显式标注，用户改动任意一项即消失
  const ex = installExampleTags(container, ['g_pw', 'g_cav', 'g_wall', 'g_Ho', 'g_ph', 'g_rh']);
  // PHASE 63 · P0-1：非法输入门禁 —— 空/≤0/NaN/±Infinity/非数字 → 不进入正式计算、无绿色结论
  const validateInputs = () => {
    const errs = [
      checkNum(q('#g_pw').value, { label: '单件毛重', gt: 0, required: true }),
      checkNum(q('#g_cav').value, { label: '一模件数', gt: 0, int: true, required: true }),
      checkNum(q('#g_wall').value, { label: '产品壁厚', gt: 0, required: true }),
      checkNum(q('#g_yr').value, { label: '预估出品率', gt: 0, max: 100, required: true }),
      checkNum(q('#g_Ho').value, { label: 'Ho（内浇道至上箱面）', gt: 0, required: true }),
      checkNum(q('#g_ph').value, { label: '产品高度（浇注向）', gt: 0, required: true }),
      checkNum(q('#g_rh').value, { label: '冒口高于铸件顶面的距离', min: 0 }),      // 无冒口填 0 合法
      checkNum(q('#g_gc').value, { label: '内浇道个数', min: 0, int: true }),
      checkNum(q('#g_gt').value, { label: '内浇道厚度', min: 0 }),
      checkNum(q('#g_rc').value, { label: '横浇道条数', min: 0, int: true }),
      checkNum(q('#g_rt').value, { label: '横浇道厚度', min: 0 }),
    ];
    if (q('#g_ratio').value === '__custom') {
      errs.push(
        checkNum(q('#g_cs').value, { label: '自定义比例 S直', gt: 0, required: true }),
        checkNum(q('#g_cr').value, { label: '自定义比例 S横', gt: 0, required: true }),
        checkNum(q('#g_cg').value, { label: '自定义比例 S内', gt: 0, required: true }));
    }
    return firstErr(errs);
  };
  const renderInvalid = (err) => {
    q('#g_summary').innerHTML = `<div style="padding:12px 16px;border-radius:12px;background:#FEF2F2;color:#DC2626;font-weight:600">⚠️ 输入不完整：${err}</div>`;
    q('#g_results').innerHTML = '';
    q('#g_judge').innerHTML = `<div class="judge bad">⚠️ ${err}</div>`;
    q('#g_sugs').innerHTML = '';
    q('#g_filterRec').innerHTML = '';
    const blank = (id) => {
      const el = q(id);
      if (el) { el.className = 'rrow'; el.innerHTML = `<span class="rl">${el.querySelector('.rl') ? el.querySelector('.rl').textContent : ''}</span><span class="rv">—</span>`; }
    };
    for (const id of ['#g_ig_len', '#g_ig_dia', '#g_ig_tube', '#g_ig_area', '#g_rr_len', '#g_rr_area', '#g_sp_dia', '#g_sp_area', '#g_ventSug', '#g_vent_ratio']) blank(id);
  };
  const update = () => {
    syncHints();
    const err = validateInputs();
    if (err) { lastResult = null; renderInvalid(err); return; }   // P0-1：非法输入不执行正式计算
    lastResult = runGating({ ...read(), optimize: optMode });   // P50：optimize 仅当用户主动点击后为 true
    renderDiagram();
    renderSummary(lastResult);
    renderResults(lastResult);
    renderComponents(lastResult);
    renderJudge(lastResult);
    renderFilterRec();
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 180); };

  const matSel = q('#g_mat'), ratioSel = q('#g_ratio');
  matSel.addEventListener('change', () => {
    if (!ratioTouched) ratioSel.value = recommendGatingRatio(matSel.value, parseFloat(q('#g_pw').value) || 0);
    // 出品率联动（PHASE 45-B）：用户未手改过 → 随材质自动填该材质建议值
    if (!yrTouched) {
      const m = MATERIALS[matSel.value] || MATERIALS['灰铁(HT)'];
      q('#g_yr').value = m.y_sug;
    }
    toggleCustom(); debounced();
  });
  ratioSel.addEventListener('change', () => { ratioTouched = true; toggleCustom(); debounced(); });
  q('#g_yr').addEventListener('input', () => { yrTouched = true; debounced(); });
  q('#g_gateShape').addEventListener('change', () => { toggleGateShape(); debounced(); });
  container.querySelectorAll('input[name="g_ventType"]').forEach(el => el.addEventListener('change', () => { toggleVentType(); debounced(); }));
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => el.addEventListener('input', debounced));
  // 过滤网"使用/不使用"单选（PHASE 45-A：唯一用户选择，型号由软件自动推荐）
  container.querySelectorAll('input[name="g_filterUsed"]').forEach(el => el.addEventListener('change', debounced));
  setupDiagramZoom();

  // ---- P50（51.txt）：内浇口"按目标速度优化"一键按钮（用户主动执行，默认保持基础设计） ----
  const OPT_CONFIRM_RATIO = 1.5;   // 界面提示阈值（非工程标准，51.txt §十二）
  const OPT_INFO_TEXT = '说明：\n当前内浇口平均速度高于本计算器设定的设计目标。点击"按目标速度优化"后，程序将在保持当前阻流面积、浇注时间及浇注系统流量不变的前提下，增加内浇口总面积，并重新计算内浇口尺寸，使计算得到的平均内浇口速度降低至目标值附近或以下。\n\n该优化属于工程设计建议，并不代表满足某一统一的铸造标准，也不能保证消除型腔内的局部高速流动、卷气或其他铸造缺陷。是否采用，应结合产品结构、浇注位置和实际工艺判断。';
  // 优化确认/说明弹窗复用报告 modal 容器：隐藏容器固有标题与操作条（显示层，P50）
  const optSetChrome = (hide) => {
    const t = q('#g_modal .modal-title'), a = q('#g_modal .modal-actions');
    if (t) t.style.display = hide ? 'none' : '';
    if (a) a.style.display = hide ? 'none' : '';
  };
  const optModal = (html) => { q('#g_reportBody').innerHTML = html; optSetChrome(true); q('#g_modal').hidden = false; };
  const optClose = () => { q('#g_modal').hidden = true; optSetChrome(false); };
  const bindOptModal = () => {
    const go = q('#g_reportBody').querySelector('#g_optGo');
    if (go) go.addEventListener('click', () => { optClose(); optMode = true; update(); });
    q('#g_reportBody').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', optClose));
  };
  const runOptimizeFlow = () => {
    // P51 门禁（防御）：内浇口阻流 / 临界状态 → 不提供优化（按钮本就不显示）
    if (!lastResult || !lastResult.vTarget || lastResult.ingateChoke || lastResult.boundaryChoke) return;
    const opt = runGating({ ...read(), optimize: true });
    // P51 收尾（53.txt §一）：优化提交通用防御——优化前后 chokePosition 任一变化 → 拒绝提交、保留原几何
    //   （未来防御机制：不为制造迁移而修改优化算法）
    const chokeChanged = opt.chokePosition !== lastResult.chokePosition;
    if (chokeChanged || opt.optChokeMigrated) {
      optModal(`<h3 style="margin:0 0 10px">⚠ 优化后阻流位置发生变化，已取消本次优化</h3><p style="font-size:13px;color:#334155;line-height:1.8">优化后阻流位置发生变化，已取消本次优化，请重新调整浇注比例/上游截面积。原设计结果保持不变。</p><div style="margin-top:14px;text-align:right"><button type="button" data-close style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer">返回原设计</button></div>`);
      bindOptModal();
      return;   // 未提交任何修改 → 优化前几何结果保留
    }
    const k = opt.A_rec / Math.max(1, lastResult.Fg);   // A_optimized / A_current（当前实际内浇口总面积）
    const mkBtns = () => '<button type="button" id="g_optGo" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer">继续优化</button><button type="button" data-close style="margin-left:8px;background:#e2e8f0;border:none;border-radius:6px;padding:6px 14px;cursor:pointer">取消</button>';
    if (k >= OPT_CONFIRM_RATIO) {
      // 大幅增加 → 轻量确认（§十二）
      optModal(`<h3 style="margin:0 0 10px">⚠️ 确认优化</h3><p style="font-size:13px;color:#334155;line-height:1.8">当前优化将使内浇口总面积增加约 <b>${fmt(k, 1)} 倍</b>（${fmt(lastResult.Fg, 0)} → ${fmt(opt.A_rec, 0)} mm²），可能明显改变现有浇注系统设计。建议结合内浇口数量、位置及实际浇注方式进行工程复核。</p><p style="font-size:11px;color:#94a3b8">（放大确认阈值 ${OPT_CONFIRM_RATIO}× 仅为界面提示阈值，非工程标准）</p><div style="margin-top:14px;text-align:right">${mkBtns()}</div>`);
    } else {
      // 小幅修正直接执行（§六 A_optimized=max(A_current, A_target)）
      optModal(`<h3 style="margin:0 0 10px">⚡ 按目标速度优化</h3><div style="font-size:13px;color:#334155;line-height:1.8;white-space:pre-line">${OPT_INFO_TEXT}</div><div style="margin-top:14px;text-align:right">${mkBtns()}</div>`);
    }
    bindOptModal();
  };
  container.addEventListener('click', (e) => {
    if (e.target.closest('#g_optBtn')) runOptimizeFlow();
    else if (e.target.closest('#g_optInfo')) {
      optModal(`<h3 style="margin:0 0 10px">ⓘ 按目标速度优化说明</h3><div style="font-size:13px;color:#334155;line-height:1.8;white-space:pre-line">${OPT_INFO_TEXT}</div><div style="margin-top:14px;text-align:right"><button type="button" data-close style="background:#e2e8f0;border:none;border-radius:6px;padding:6px 14px;cursor:pointer">知道了</button></div>`);
      bindOptModal();
    }
  });
  // P51 收尾（53.txt §六）：浇注比例 ⓘ —— 精简版：简介 + 自动推荐说明 + 预设清单（名称/比例/适用）+ 收尾一句
  q('#g_ratioInfo')?.addEventListener('click', () => {
    const presetRows = Object.keys(RATIO_PRESETS).map((k) => {
      const [s, rr, gg] = RATIO_PRESETS[k].r;
      return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;margin:6px 0">
        <div style="font-size:13px;font-weight:700;color:#0f172a">${k} · S直:S横:S内 = ${fmtRatio3(s, rr, gg)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:3px">适用：${RATIO_APPLIC[k] || '—'}${RATIO_PRESETS[k].note ? `（${RATIO_PRESETS[k].note}）` : ''}</div>
      </div>`;
    }).join('');
    optModal(`<h3 style="margin:0 0 10px">ⓘ 浇注比例怎么选？</h3>
      <div style="font-size:13px;color:#334155;line-height:1.8">浇注比例 S直:S横:S内 表示直浇道、横浇道和内浇口的<b>截面积关系</b>，会影响阻流位置、流速和充型平稳性。</div>
      <div style="font-size:13px;color:#334155;line-height:1.8;margin-top:8px"><b>系统会自动推荐</b>：根据材质、铸件重量等已有条件自动选择合适的浇注比例预设；仍可手动选择其他预设。</div>
      <div style="font-size:12px;font-weight:700;color:#64748b;margin:10px 0 4px">预设一览</div>
      ${presetRows}
      <div style="font-size:13px;color:#334155;line-height:1.8;background:#fffbeb;border-radius:8px;padding:8px 12px;margin-top:8px">不知道怎么选时，直接采用系统自动推荐的预设即可；有特殊工艺要求时，再手动调整。</div>
      <div style="margin-top:14px;text-align:right"><button type="button" data-close style="background:#e2e8f0;border:none;border-radius:6px;padding:6px 14px;cursor:pointer">知道了</button></div>`);
    bindOptModal();
  });

  const row = (label, value, unit, cls = '', note = '') =>
    `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
  const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));
  /** 浇注时间公式介绍（PHASE 47：随当前材料/重量/壁厚展示各自公式与档位；纯说明文字，
   *  计算权威入口 = calcs/gating.js calc_t，此处不重复任何计算逻辑） */
  const pourTimeNote = (mat, W, wall) => {
    const w = fmt(wall, 1);
    if (mat === '灰铁(HT)') {
      return W <= 450
        ? `灰铁（≤450kg 段）：T=0.70×(1.41+${w}/14.59)×√W，当前 W=${fmt(W, 1)}kg`
        : `灰铁（>450kg 段）：T=0.70×(1.236+${w}/16.65)×∛W，当前 W=${fmt(W, 1)}kg`;
    }
    if (mat === '球铁(QT)') {
      const K1 = wall < 10 ? 2.080 : wall <= 25 ? 2.670 : 2.970;
      const seg = wall < 10 ? 't<10' : wall <= 25 ? '10≤t≤25' : 't>25';
      return `球铁：T=K₁×√W，壁厚 ${w}mm（${seg}）→ K₁=${K1.toFixed(3)}`;
    }
    if (mat === '铸钢(ZG)') {
      return '铸钢：T=(2.4335−0.3953×lgW)×√W（不依赖壁厚）';
    }
    const fc = (MATERIALS[mat] || MATERIALS['灰铁(HT)']).fc;
    return `铝/铜 Dietert：T=f×(√W+∛(t·W/5))×2/3，f=${fc}`;
  };
  /** 内浇口平均流速状态徽标（PHASE 48-B：设计校核状态，非错误） */
  const velBadge = (r) => {
    if (r.vState === 'rec') return tr('✅ 推荐');
    if (r.vState === 'high') return tr('⚠️ 偏高');
    if (r.vState === 'low') return tr('ℹ️ 偏低（可保留）');
    return r.r7Exceed ? tr('ℹ️ 参考（超过企业 R7 {v}）', [r.vLimit]) : '—';
  };
  /** 内浇口平均流速说明（含目标与内部诊断值） */
  const velNote = (r) => r.vTarget
    ? tr('gel.velNote.target', {
      t: r.vTarget, suffix: r.vTargetLo ? `, ${tr('推荐')} ${r.vTargetLo}~${r.vTargetHi}` : `, ≤ ${r.vTargetHi}`,
      v: fmt(r.vTheory, 2),
    })
    : tr('gel.velNote.notarget', { type: tr(r.rd.type), lim: r.vLimit });

  /** P51 第一屏摘要（52.txt §11-13 + 显示优化：结论色块 / 统计卡网格 / 按比例横截面积 / 速度+排气总面积） */
  function renderSummary(r) {
    const box = q('#g_summary');
    if (!box || !r) return;
    const hard = r.sugs.some(s => s.startsWith('❌')) || r.vr < 1.5;
    let verdict, vc, vs;
    if (hard) { verdict = tr('🔴 需要调整浇注系统'); vc = '#DC2626'; vs = '#FEF2F2'; }
    else if (r.vState === 'high' || r.r7Exceed || r.vr > 4) {
      verdict = r.vState === 'high' ? tr('🟠 建议关注内浇口速度')
        : r.r7Exceed ? tr('🟠 建议关注内浇口速度（超企业 R7 红线）') : tr('🟠 建议关注排气面积');
      vc = '#B45309'; vs = '#FFFBEB';
    } else { verdict = tr('🟢 浇注系统设计可用'); vc = '#059669'; vs = '#ECFDF5'; }
    const posCn = { sprue: tr('直浇道'), runner: tr('横浇道'), ingate: tr('内浇口'), boundary: tr('临界（并列）'), unset: '—' };
    const velLight = r.vState === 'rec' ? tr('🟢 正常')
      : r.vState === 'high' ? (r.r7Exceed ? tr('🔴 明显偏高') : tr('🟠 偏高'))
        : r.vState === 'low' ? tr('ℹ️ 偏低（可保留）') : '—';
    const velColor = r.vState === 'rec' ? '#059669' : r.vState === 'high' ? (r.r7Exceed ? '#DC2626' : '#D97706') : r.vState === 'low' ? '#64748b' : '#334155';
    const stat = (label, value, sub = '', vcolor = '') =>
      `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;min-width:0">
        <div style="font-size:.72rem;color:#64748b;margin-bottom:4px">${label}</div>
        <div style="font-size:1.02rem;font-weight:700;color:${vcolor || '#0f172a'};line-height:1.35;word-break:break-all">${value}</div>
        ${sub ? `<div style="font-size:.68rem;color:#94a3b8;margin-top:3px">${sub}</div>` : ''}
      </div>`;
    const grid = (inner) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px">${inner}</div>`;
    const sec = (t) => `<div style="font-size:.72rem;font-weight:700;color:#64748b;margin:14px 0 6px;letter-spacing:.5px">${t}</div>`;
    // 内浇口参考面积（优化后显示推荐值）
    const gateArea = r.optimized && r.A_rec > r.A_gt ? r.A_rec : r.A_gt;
    const gateAreaSub = r.optimized && r.A_rec > r.A_gt ? `${tr('奥赞参考')} ${fmt(r.A_gt, 0)} → ${tr('已放大')}` : tr('奥赞参考');
    // 速度说明 + 优化按钮（P51 门禁：ingate/boundary choke 不提供）
    let action = '';
    if (r.optimized) {
      action = `<div style="margin-top:14px;padding:9px 12px;background:#ecfdf5;color:#047857;border-radius:8px;font-size:.85rem;border-left:3px solid #10b981">✅ ${tr('已按目标速度优化：内浇口总面积')} ${fmt(r.A_gt, 0)} → ${fmt(r.A_rec, 0)} mm²。${tr('本次优化仅调整内浇口几何面积，浇注时间、总浇注重量及原阻流位置保持不变；优化后实际几何面积已重新检查，未发生阻流位置迁移。')}</div>`;
    } else if (r.vState === 'high' && r.vTarget) {
      if (r.ingateChoke) {
        action = `<div style="margin-top:14px;padding:9px 12px;background:#fffbeb;color:#b45309;border-radius:8px;font-size:.85rem;border-left:3px solid #f59e0b">⚠ ${tr('偏高：当前为内浇口阻流的加压式系统，内浇口承担流量控制，因此不提供自动放大优化。')}</div>`;
      } else if (r.boundaryChoke) {
        action = `<div style="margin-top:14px;padding:9px 12px;background:#fffbeb;color:#b45309;border-radius:8px;font-size:.85rem;border-left:3px solid #f59e0b">⚠ ${tr('阻流位置接近临界状态，请工程复核（不提供自动优化）。')}</div>`;
      } else {
        action = `<div style="margin-top:14px;text-align:center"><button id="g_optBtn" type="button" style="width:100%;max-width:420px;background:linear-gradient(135deg,#2563eb,#3b82f6);color:#fff;border:none;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,.35)">⚡ ${tr('按目标速度优化')}</button><div style="margin-top:6px"><span id="g_optInfo" style="cursor:help;font-size:12px;color:#94a3b8" title="${esc(tr('点击查看说明'))}">ⓘ ${tr('按目标速度优化说明')}</span></div></div>`;
      }
    }
    box.innerHTML = `
      ${ex.exampleNote()}
      <div style="padding:12px 16px;border-radius:12px;font-size:1.02rem;font-weight:700;background:${vs};color:${vc}">${verdict}</div>
      ${sec(tr('核心数据'))}
      ${grid(stat(tr('总浇注重量'), `${fmt(r.G, 1)} kg`, tr('Wc ÷ 出品率'))
        + stat(tr('浇注时间'), `${fmt(r.t, 2)} s`)
        + stat(tr('平均压头 Hp'), `${fmt(r.Hp, 0)} mm`)
        + stat(tr('阻流面积 A_choke'), `${fmt(r.A, 0)} mm²`)
        + stat(tr('阻流位置'), posCn[r.chokePosition] || '—', tr('按最终实际几何面积判定'))
        + stat(tr('系统类型'), tr(r.systemType) || '—'))}
      ${sec(`${tr('横截面积 · 按比例')} ${fmt(r.s_r, 2)}:${fmt(r.r_r, 2)}:${fmt(r.g_r, 2)} ${tr('分配（参考，mm²）')}`)}
      ${grid(stat(tr('S直 · 直浇道'), fmt(r.A_sp, 0), tr('奥赞参考'))
        + stat(tr('S横 · 横浇道'), fmt(r.A_run, 0), tr('奥赞参考'))
        + stat(tr('S内 · 内浇口'), fmt(gateArea, 0), gateAreaSub))}
      ${sec(tr('校核'))}
      ${grid(stat(tr('内浇口平均速度'), `${fmt(r.vFinal, 3)} m/s`, velLight, velColor)
        + stat(tr('排气总面积'), r.vt > 0 ? `${fmt(r.vt, 0)} mm²` : '—', r.sugVent
          ? (r.ventType === '方片' ? `${tr('方片')} ${tr('宽')}${r.sugVent.square.w}×${tr('厚')}${r.sugVent.square.t} × ${r.sugVent.square.n} ${tr('片')}` : `${tr('圆孔')} ⌀${r.sugVent.round.d} × ${r.sugVent.round.n} ${tr('个')}`)
          : ''))}
      ${action}
    `;
  }

  function renderResults(r) {
    // 企业查表对照（PHASE 28.3-E：并列参照，不参与 T 计算链）
    const refWith = pourTimeReference(r.G, true);
    const refNo = pourTimeReference(r.G, false);
    // 浇注温度建议（PHASE 28.3-F：企业壁厚表，一行文本；推荐范围非绝对值）
    const pourT = recommendPourTemp({ family: FAMILY_OF_MAT[r.mat] || '灰铁', wall: r.wall });
    q('#g_results').innerHTML = `
      <div class="group-title">${tr('本次计算条件（结果在什么工艺条件下得出）')}</div>
      ${row(`📋 ${tr('计算条件')}`, `${tr('材质')} ${tr(r.mat)} ｜ ${tr(r.pos)} ｜ ${tr(r.rd.type)}${r.ratioKey ? `（${tr(r.ratioKey)}）` : `（${tr('自定义比例')}）`}${r.filterUsed ? ` ｜ ${tr('过滤网')} ${tr('使用')} ｜ fv ${fmt(r.fv, 2)}（${tr('原')} ${fmt(r.fvBase, 2)} − 0.1）` : ` ｜ fv ${fmt(r.fv, 2)}`}`, '', '', r.filterUsed ? tr('企业规则：有过滤网 fv−0.1') : tr('未使用过滤网，fv 保持原值'))}
      <div class="group-title">${tr('中间计算')}</div>
      ${row(`⚖️ ${tr('密度 ρ')}`, r.rho, 'kg/dm³', '', tr('查材料表'))}
      ${row(`🔢 ${tr('材质系数 f')}`, r.fc, '', '', tr('查材料表'))}
      ${row(`⚖️ ${tr('铸件质量 W_c')}`, fmt(r.castingMass, 2), 'Kg', '', `= ${r.pw}×${r.cav} ${tr('件（P47 浇注时间公式的 W，不出品率，PHASE 49）')}`)}
      ${row(`🫗 ${tr('浇注重量 G')}`, fmt(r.G, 2), 'Kg', '', `G = W_c ÷ ${r.yv}%${tr('（浇注重量：奥赞阻流/流量 Q 用，与企业 Excel 浇注重量同义）')}`)}
      ${r.boundaryNote ? row(`⚠️ ${tr('公式分界点')}`, tr('需工程复核'), '', 'warn', r.boundaryNote) : ''}
      ${row(`📏 ${tr('C = 件高+冒口高')}`, fmt(r.Cmm, 2), 'mm', '', `${r.ph} + ${r.rh}`)}
      ${row(`🏗️ ${tr('Hb 水口盆高度')}`, r.Hb, 'mm', '', 'G<10→150,<50→200,<200→250,<1000→300,<3000→500,<8000→750,≥8000→1100')}
      ${row(`📐 ${tr('P 值')}`, fmt(r.Pv, 1), 'mm', '', `${tr(r.pos)}：${tr('顶=0/中=C/2/底=C')}`)}
      ${row(`📊 ${tr('Hp 平均静压头')}`, fmt(r.Hp, 4), 'mm', '', `${tr(r.pos)}${tr('公式')}`)}
      ${row(`💧 ${tr('fv 流速系数')}`, r.fv, '', '', `${tr(r.pos)}=0.8/0.6/0.45`)}
      ${row(`🧪 ${tr('理论流速 v_theory')}`, fmt(r.vTheory, 3), 'm/s', '', tr('=fv×√(2gHp)，内部诊断值（PHASE 48-B 保留，不参与判定）'))}
      <div class="group-title">${tr('最终结果')}</div>
      ${row(`⏱️ ${tr('浇注时间 t')}`, fmt(r.t, 4), 's', '', pourTimeNote(r.mat, r.castingMass, r.wall))}
      ${row(`📋 ${tr('企业查表对照')}`, `${tr('快浇')} ${fmt(refWith.fast, 1)} · ${tr('有冒口')} ${fmt(refWith.wtTable, 1)} · ${tr('无冒口')} ${fmt(refNo.wtTable, 1)} s`, '', '', tr('企业 Excel C 级数据，并列参照（PHASE 28.3-E）'))}
      ${pourT.range ? row(`🌡️ ${tr('浇注温度建议')}`, `${pourT.range[0]}~${pourT.range[1]} ℃`, '', '', tr('按壁厚 {w}mm 查企业表（企业经验参数，PHASE 28.3-F）', [fmt(r.wall, 1)])) : row(`🌡️ ${tr('浇注温度建议')}`, '—', '', '', `${pourT.note}`)}
      ${row(`🎯 ${tr('阻流截面 A_choke')}`, fmt(r.A, 2), 'mm²', '', 'A=71.47×G/(ρ×t×fv×√Hp)×100')}
      ${row(`📍 ${tr('瓶颈位置')}`, tr(r.cp), '', '', `${tr('比例')} 1:${r.r_r.toFixed(2)}:${r.g_r.toFixed(2)} ${tr('最小比值处')}`)}
      ${row(`🔽 ${tr('内浇道参考面积')}`, fmt(r.A_gt, 0), 'mm²', '', `A×(S内/min)，${tr('奥赞参考')}`)}
      ${r.vTarget ? row(`🧮 ${tr('推荐内浇口总面积')}`, fmt(r.A_rec, 0), 'mm²', r.A_rec > r.A_gt ? 'warn' : '', `=max(A_gt ${fmt(r.A_gt,0)}, A_target=Q/v_target=${fmt(r.A_target,0)})${r.A_rec > r.A_gt ? `：${tr('超目标，已放大')} ×${fmt(r.A_rec / Math.max(1, r.A_gt), 2)} ${tr('并应用于实际尺寸')}` : `：${tr('未超参考，不缩小（48-B）')}`}`) : ''}
      ${row(`➡️ ${tr('横浇道参考面积')}`, fmt(r.A_run, 0), 'mm²', '', 'A×(S横/min)')}
      ${row(`⬇️ ${tr('直浇道参考面积')}`, fmt(r.A_sp, 0), 'mm²', '', 'A×(S直/min)')}
      <div class="group-title">${tr('校核')}</div>
      ${row(`💨 ${tr('内浇口平均流速')}`, `${fmt(r.vFinal, 3)} ${velBadge(r)}`, 'm/s', r.vState === 'rec' ? 'ok' : r.vState === 'high' ? 'warn' : r.vState === 'low' ? 'warn' : r.r7Exceed ? 'warn' : '', velNote(r))}
      ${row(`💨 ${tr('液面上升速度 vL')}`, fmt(r.vL, 2), 'mm/s', '', tr('=铸件高度/浇注时间（参考，下限标准待核对）'))}
      ${row(`💭 ${tr('排气面积比')}`, fmt(r.vr, 2), tr('倍'), r.vr_ok ? 'ok' : 'bad', tr('S出/S直，标准≥1.5'))}
      ${row(`📊 ${tr('实际出品率')}`, fmt(r.ya, 1), '%', '', 'pw×cav/G×100%')}
      ${row(`🔗 ${tr('实际比例 S直:S横:S内')}`, r.Fr_act > 0 ? `1:${fmt(r.rrv, 2)}:${fmt(r.rgv, 2)}` : tr('横浇道未设'), '', '', `${tr('目标')} 1:${r.r_r.toFixed(2)}:${r.g_r.toFixed(2)}`)}
    `;
  }

  function renderComponents(r) {
    const set = (id, text, cls = '') => {
      const el = q(id);
      el.className = 'rrow ' + cls;
      el.innerHTML = `<span class="rl">${el.querySelector('.rl').textContent}</span><span class="rv">${text}</span>`;
    };
    if (r.gateShape === '圆形') {
      // 圆形：直径自动 + 瓷管建议（企业瓷管规格）
      set('#g_ig_dia', r.gc > 0 && r.D_g > 0 ? `⌀${r.D_g} mm（${r.gc}${tr('个')}，${tr('面积')} ${fmt(r.Fg, 0)} mm²）` : tr('个数=0'));
      const tube = r.D_g > 0 ? suggestCeramicTube(r.D_g) : null;
      if (tube?.tube) {
        set('#g_ig_tube', `${tr('建议瓷管')} ${tube.tube.id}（${tr('内径')} ${tube.tube.inner} mm）`, 'ok');
      } else if (tube?.outOfRange) {
        set('#g_ig_tube', `⚠️ ${tr('需求直径')} ⌀${tube.d} mm ${tr('超出常见瓷管规格（最大 F70 内径')} ${tube.maxInner} mm），${tr('需特殊制作或增加个数')}`, 'bad');
      } else {
        set('#g_ig_tube', '—');
      }
    } else {
      set('#g_ig_len', r.gc > 0 && r.gt > 0 ? `${r.L_g} mm（${tr('厚')}${r.gt}×${tr('长')}${r.L_g}×${r.gc}${tr('个')}）` : tr('个数/厚度=0'));
    }
    const igOk = r.Fg >= r.A_rec * 0.7 && r.Fg <= Math.max(r.A_rec, r.A_gt) * 1.3;
    set('#g_ig_area', `${fmt(r.Fg, 0)} mm²`, igOk ? 'ok' : 'warn');   // P51：参考值移 title
    q('#g_ig_area').querySelector('.rv').title = `${tr('奥赞参考')} ${fmt(r.A_gt, 0)}${r.A_rec > r.A_gt ? ` → ${tr('推荐')} ${fmt(r.A_rec, 0)}` : ''} mm²`;
    set('#g_rr_len', r.rc > 0 && r.rt > 0 ? `${r.L_r} mm（${tr('厚')}${r.rt}×${tr('长')}${r.L_r}×${r.rc}${tr('条')}）` : tr('条数/厚度=0'));
    const frOk = r.Fr_act >= r.A_run * 0.8 && r.Fr_act <= r.A_run * 1.2;
    set('#g_rr_area', `${fmt(r.Fr_act, 0)} mm²`, frOk ? 'ok' : 'warn');
    q('#g_rr_area').querySelector('.rv').title = `${tr('参考')} ${fmt(r.A_run, 0)} mm²`;
    const fsOk = r.Fs_act >= r.A_sp * 0.9 && r.Fs_act <= r.A_sp * 1.1;
    set('#g_sp_dia', `⌀${r.D_sp} mm（${tr('1根圆形')}）`);
    set('#g_sp_area', `${fmt(r.Fs_act, 0)} mm²`, fsOk ? 'ok' : 'warn');
    q('#g_sp_area').querySelector('.rv').title = `${tr('参考')} ${fmt(r.A_sp, 0)} mm²`;
    // 排气：自动生成建议（企业标准 1.5~4 倍）+ 区间判定
    const vrState = r.vr >= 1.5 && r.vr <= 4 ? 'ok' : r.vr === 0 ? 'bad' : r.vr < 1.5 ? 'bad' : 'warn';
    set('#g_vent_ratio', `${fmt(r.vr, 2)} ${tr('倍（企业标准 1.5~4 倍）')}`, vrState);
    const sug = q('#g_ventSug');
    if (sug) {
      if (r.sugVent && r.Fs_act > 0) {
        const sv = r.sugVent;
        const round = r.ventType !== '方片';
        if (round) {
          sug.innerHTML = `<span class="rl">⚡ ${tr('自动生成')}</span><span class="rv">${tr('圆孔')} ⌀${sv.round.d} mm × ${sv.round.n} ${tr('个')}${sv.round.n > 20 ? tr('（数量较多，建议改用方片）') : ''}</span>`;
        } else {
          sug.innerHTML = `<span class="rl">⚡ ${tr('自动生成')}</span><span class="rv">${tr('方片')} ${tr('宽')}${sv.square.w} × ${tr('厚')}${sv.square.t} mm × ${sv.square.n} ${tr('个')}</span>`;
        }
      } else {
        sug.innerHTML = `<span class="rl">⚡ ${tr('自动生成')}</span><span class="rv">—</span>`;
      }
    }
  }

  function renderJudge(r) {
    // 综合判定三态（显示层；allOk 逻辑不变）：✅ 合格 / 红色=存在必须修改项（❌ 排气不足等）/
    //   橙色=设计可用、仅可选优化建议（速度偏高可一键优化，非强制修改）
    const hardIssues = r.sugs.filter(s => s.startsWith('❌')).length;
    let judgeCls = 'ok', judgeTxt = tr('✅ 设计合理 · 参数合格');
    if (!r.allOk) {
      if (hardIssues > 0) { judgeCls = 'bad'; judgeTxt = tr('⚠️ 需优化 · 建议调整参数（存在必须处理项，见下方问题）'); }
      else { judgeCls = 'warn'; judgeTxt = tr('ℹ️ 设计可用 · 存在可选优化项（速度偏高可按"一键优化"；非强制修改）'); }
    }
    q('#g_judge').innerHTML = `<div class="judge ${judgeCls}">${judgeTxt}</div>`;
    q('#g_sugs').innerHTML = r.sugs.map(s => `<div class="suggestion p72-cn">${s}</div>`).join('');
    // P51：存在硬问题/偏高/超 R7/排气异常时自动展开问题清单（第一屏结论已在摘要）
    const det = q('#g_details2');
    if (det) det.open = hardIssues > 0 || r.vState === 'high' || r.r7Exceed || !(r.vr >= 1.5 && r.vr <= 4);
  }

  function buildReportHtml() {
    if (!lastResult) return '';
    const r = lastResult;
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const t = (label, val) => `<tr><td style="width:38%">${label}</td><td>${val}</td></tr>`;
    return `
      <h2>🏗️ 铸造浇注系统设计计算记录</h2>
      <p class="meta">生成时间：${now} · 材质 ${r.mat}</p>
      <h3>一、基本参数（输入）</h3>
      <table>${t('单件毛重', `${r.pw} Kg`)}${t('一模件数', `${r.cav} 件`)}${t('产品壁厚', `${r.wall} mm`)}${t('预估出品率', `${r.yv}%`)}${t('浇注方向', r.pos)}${t('Ho', `${r.Ho} mm`)}${t('产品高度', `${r.ph} mm`)}${t('冒口高度', `${r.rh} mm`)}${t('比例预设', `${r.ratioKey || '自定义'} · S直:S横:S内 = ${fmt(r.s_r, 2)}:${fmt(r.r_r, 2)}:${fmt(r.g_r, 2)}`)}</table>
      <h3>二、自动计算结果</h3>
      <table>${t('密度 ρ', `${r.rho} kg/dm³`)}${t('材质系数 f', r.fc)}${t('铸件质量 W_c（P47 公式 W）', `${fmt(r.castingMass, 2)} Kg`)}${t('浇注重量 G（奥赞/流量）', `${fmt(r.G, 2)} Kg`)}${t('C=件高+冒口高', `${fmt(r.Cmm, 2)} mm`)}${t('Hb 水口盆高度', `${r.Hb} mm`)}${t('Hp 平均静压头', `${fmt(r.Hp, 4)} mm`)}${t('fv 流速系数', r.fv)}${t('浇注时间 t', `${fmt(r.t, 4)} s`)}${t('阻流截面 A_choke', `${fmt(r.A, 2)} mm²`)}</table>
      <h3>三、浇注系统尺寸</h3>
      <table>${t('瓶颈位置', r.cp)}${t('内浇道', `${r.gc}个×厚${r.gt}mm×长${r.L_g}mm = ${fmt(r.Fg, 0)}mm²（奥赞参考${fmt(r.A_gt, 0)}${r.A_rec > r.A_gt ? `→推荐${fmt(r.A_rec, 0)}` : ''}）`)}${t('横浇道', `${r.rc}条×厚${r.rt}mm×长${r.L_r}mm = ${fmt(r.Fr_act, 0)}mm²（参考${fmt(r.A_run, 0)}）`)}${t('直浇道', `⌀${r.D_sp}mm = ${fmt(r.Fs_act, 0)}mm²（参考${fmt(r.A_sp, 0)}）`)}${t('内浇口平均流速', `${fmt(r.vFinal, 3)} m/s ${r.vState === 'rec' ? '✅推荐' : r.vState === 'high' ? '⚠️偏高' : r.vState === 'low' ? 'ℹ️偏低' : '—'}`)}${t('目标流速', r.vTarget ? `${r.vTarget} m/s${r.vTargetLo ? `（${r.vTargetLo}~${r.vTargetHi}）` : `（≤${r.vTargetHi}）`}` : '无（铸钢/铜）')}${t('推荐内浇口总面积', `${fmt(r.A_rec, 0)} mm²${r.A_rec > r.A_gt ? `（放大×${fmt(r.A_rec / Math.max(1, r.A_gt), 2)}）` : '=参考'}`)}${t('排气面积比', `${fmt(r.vr, 2)} 倍 ${r.vr_ok ? '✓' : '✗'}`)}${t('实际出品率', `${fmt(r.ya, 1)}%`)}</table>
      <h3>四、综合判定</h3>
      <p style="font-weight:700;color:${r.allOk ? '#059669' : '#DC2626'}">${r.allOk ? '✅ 设计合理 · 参数合格' : '⚠️ 需优化 · 建议调整参数'}</p>
      ${r.sugs.filter(s => !s.startsWith('✅')).map(s => `<div style="padding:6px 12px;margin:5px 0;background:#FFFBEB;color:#D97706;border-radius:6px;font-size:.82rem;border-left:3px solid #D97706">${s}</div>`).join('')}
      <h3>五、公式参考</h3>
      <table>${t('t 灰铁', 'W≤450kg：T=0.70×(1.41+t/14.59)×√W；W>450kg：T=0.70×(1.236+t/16.65)×∛W')}${t('t 球铁', 'T=K₁×√W；K₁ 按壁厚分档：t<10→2.080 / 10≤t≤25→2.670 / t>25→2.970')}${t('t 铸钢', 'T=(2.4335−0.3953×lgW)×√W（不依赖壁厚）')}${t('t 铝/铜', 'Dietert：T=f×(√W+∛(t·W/5))×2/3，f=1.20(铝)/0.90(铜)')}${t('阻流截面 A', 'A = 71.47×G/(ρ×t×fv×√Hp)×100 [mm²]  奥赞（t 取上表分派结果）')}${t('内浇口平均速度', 'v_final=Q/A_rec；Q=G/(ρ·t)；A_rec=max(A_gt, 1000·G/(ρ·t·v_target))；v_target：灰铁≤1.0 / 球铁 0.45 / 铝 0.45 m/s（48-B 设计目标，铸钢/铜无目标）')}${t('Hp 顶注', 'Hp = Ho+Hb/2−rh²/(2C)')}${t('Hp 中注', 'Hp = Ho+Hb/2−(P+rh)²/(2C)（企业 Excel 原式，PHASE 28.3-B）')}${t('Hp 底注', 'Hp = (Ho+Hb)/2')}${t('流速校核', `v = 10×G/(t×ρ×F/100) [m/s] ${r.rd.type}式 ≤ ${r.vLimit}（企业经验标准，PHASE 28.3-C）`)}${t('排气比', 'S出/S直 ≥ 1.5')}</table>`;
  }
  const openReport = () => {
    if (!lastResult) { showToast('请先完成计算'); return; }
    q('#g_reportBody').innerHTML = buildReportHtml();
    optSetChrome(false);   // 恢复弹窗固有标题/操作条（P50：opt 弹窗隐藏后不残留）
    q('#g_modal').hidden = false;
  };
  const closeReport = () => { q('#g_modal').hidden = true; };
  q('#g_reportBtn').addEventListener('click', openReport);
  q('[data-close]').addEventListener('click', closeReport);
  q('#g_modal').addEventListener('click', (e) => { if (e.target === q('#g_modal')) closeReport(); });
  q('#g_reportDl').addEventListener('click', () => {
    saveFile(`浇注系统计算记录_${Date.now()}.html`, `<html><head><meta charset="utf-8"><title>浇注系统计算记录</title><style>body{font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}th{background:#f3f4f6}td:first-child{width:38%;color:#6b7280}td:last-child{font-weight:600}</style></head><body>${buildReportHtml()}</body></html>`);
  });
  q('#g_reportCopy').addEventListener('click', () => {
    const plain = buildReportHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    navigator.clipboard?.writeText(plain).then(() => showToast('已复制报告文本'), () => showToast('复制失败'));
  });

  // ---- 初始化 ----
  setRecompute(update);   // PHASE 72：语言切换 → 重渲染视图后原地重算（数值不变，只换文案）
  prefillMaterial(container, '#g_mat');   // 当前工况材料 → 预选材质
  ratioSel.value = recommendGatingRatio(q('#g_mat').value, DEFAULTS.pw);
  // 出品率随预选材质同步（未手改过时）
  if (!yrTouched) {
    const m = MATERIALS[q('#g_mat').value] || MATERIALS['灰铁(HT)'];
    q('#g_yr').value = m.y_sug;
  }
  toggleCustom();
  toggleGateShape();
  toggleVentType();
  update();
  renderNextSteps(container, calc);
}

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.remove(), 2200);
}
