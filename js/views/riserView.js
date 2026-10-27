// ============================================================
// 冒口设计 · 视图（重建于工具箱统一设计系统）
// ============================================================
import { RISER_MATERIALS, RISER_EFF, RISER_SHAPES, calcMc, runRiser } from '../../calcs/riser.js';
import { riserWarning, riserConverged, fillWarning } from './riserStatus.js';
import { prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { saveFile } from '../download.js';
import { checkNum, firstErr } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';
// PHASE 72（80.txt §八）：核心计算器 UI 中英双语（公式/变量/单位不动）
import { t as tr } from '../i18n/index.js';
import { setRecompute } from '../i18n/viewState.js';
import * as proj from '../model/CastingProject.js';
import {
  renderRiserReferenceCards, bindRiserReference, referenceNote, riserTopNote,
  applyInsulatedRiserResult, insulatedFormulaNote, insulatedLimitNote, insulatedNoEfficiencyNote,
} from './riserReference.js';

const DEFAULTS = {
  mat: '球铁', cast_wt: 10,
  mc_mode: 'direct', mc: 12, hot_d: 24, wall_t: 24, cast_v: 50000, cast_a: 5000,
  shape: 'sphere_head', hd_ratio: 1.0,
  eff_open: 14, eff_blind: 20, eff_sph: 25, eff_heat: 35,
};

export function renderRiser(container, calc) {
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
      <div class="calc-col">
        <!-- 输入 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>📋 ${tr('输入参数')}</div>
          <div class="field-grid2">
            <div class="field">
              <label class="field-label">🔩 ${tr('材质')}</label>
              <div class="f-row">
                <select class="field-select" id="r_mat">
                  ${Object.keys(RISER_MATERIALS).map(k => `<option value="${k}" ${k === DEFAULTS.mat ? 'selected' : ''}>${tr(RISER_MATERIALS[k].name)} · ${tr('缩率')}${(RISER_MATERIALS[k].shrink * 100).toFixed(1)}%</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field">
              <label class="field-label">⚖️ ${tr('铸件重量')} <span style="font-weight:400;color:var(--text-muted)">${tr('（体积校验用）')}</span></label>
              <div class="f-row"><input class="field-input" type="number" id="r_cast_wt" value="${DEFAULTS.cast_wt}" step="0.1" min="0"><span class="f-unit">Kg</span></div>
            </div>
          </div>
          <div class="divider"></div>
          <div class="field">
            <label class="field-label">📏 ${tr('热节模数 Mc（被补缩热节处的 V/散热面积）')}</label>
            <div class="f-row">
              <select class="field-select" id="r_mc_mode">
                <option value="direct">${tr('直接输入 Mc')}</option>
                <option value="hot_spot">${tr('输入热节圆直径 d（Mc=d/2）')}</option>
                <option value="wall">${tr('输入壁厚 t（板状 Mc=t/2）')}</option>
                <option value="volume">${tr('输入热节处 V 和 A')}</option>
              </select>
            </div>
          </div>
          <div class="field" id="r_mc_direct" style="margin-top:10px"><label class="field-label">📊 ${tr('热节模数 Mc')}</label><div class="f-row"><input class="field-input" type="number" id="r_mc" value="${DEFAULTS.mc}" step="0.1" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field" id="r_mc_hot" style="margin-top:10px;display:none"><label class="field-label">🔴 ${tr('热节圆直径 d')}</label><div class="f-row"><input class="field-input" type="number" id="r_hot_d" value="${DEFAULTS.hot_d}" step="1" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field" id="r_mc_wall" style="margin-top:10px;display:none"><label class="field-label">📐 ${tr('壁厚 t')}</label><div class="f-row"><input class="field-input" type="number" id="r_wall_t" value="${DEFAULTS.wall_t}" step="1" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field-grid2" id="r_mc_vol" style="margin-top:10px;display:none">
            <div class="field"><label class="field-label">📦 ${tr('热节处体积 V')}</label><div class="f-row"><input class="field-input" type="number" id="r_cast_v" value="${DEFAULTS.cast_v}" step="100" min="0"><span class="f-unit">mm³</span></div></div>
            <div class="field"><label class="field-label">📐 ${tr('热节处表面积 A')}</label><div class="f-row"><input class="field-input" type="number" id="r_cast_a" value="${DEFAULTS.cast_a}" step="100" min="0"><span class="f-unit">mm²</span></div></div>
          </div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>🏗️ ${tr('冒口参数')}</div>
          <div class="field-grid2">
            <div class="field">
              <label class="field-label">${tr('冒口形状')}</label>
              <div class="f-row">
                <select class="field-select" id="r_shape">
                  <option value="cyl">${tr('圆柱形')}</option>
                  <option value="sphere_head" selected>${tr('球顶圆柱暗冒口')}</option>
                  <option value="sphere">${tr('球形')}</option>
                  <option value="square">${tr('正方柱')}</option>
                  <option value="insulated">${tr('发热/保温冒口（经验估算）')}</option>
                </select>
              </div>
            </div>
            <div class="field" id="r_hd_field">
              <label class="field-label">📐 H / D ${tr('比')}</label>
              <div class="f-row">
                <select class="field-select" id="r_hd">
                  <option value="0.8">0.8 ${tr('（矮胖）')}</option>
                  <option value="1.0" selected>1.0 ${tr('（适中）')}</option>
                  <option value="1.2">1.2 ${tr('（瘦高）')}</option>
                  <option value="1.5">1.5 ${tr('（细长）')}</option>
                </select>
              </div>
            </div>
          </div>
          <div class="field-hint" id="r_hd_note" hidden>${tr('球形冒口由球径唯一确定（H ≡ D），不存在独立 H/D 设计自由度；切到圆柱/球顶圆柱/方柱后可选 H/D。')}</div>
          <div class="field-hint" id="r_insulated_note" hidden>${tr('发热/保温冒口沿用当前 H/D；目标体积 V1 = 0.4 × 普通圆柱几何体积 V0，再按 D = ∛(4V1/(πk))、H = kD 反算。')}</div>
          <div class="field-hint" style="margin-top:8px">${tr('补缩效率按形状固定（当前算法采用的模型系数，不可编辑）；详细数值见结果区的计算依据。')}</div>
        </div>
      </div>

      <!-- 结果 -->
      <div class="calc-col">
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📊 ${tr('sec.results')}</div>
          <div id="r_results"><div class="empty" style="padding:26px"><span class="empty-sub">${tr('填写参数后自动计算…')}</span></div></div>
        </div>
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">4</span>✅ ${tr('校核结论')}</div>
          <div id="r_judge" style="color:var(--text-muted);font-size:.8rem">${tr('等待计算…')}</div>
          <button class="btn btn-primary" id="r_reportBtn" style="width:100%;margin-top:14px">📄 ${tr('生成计算记录')}</button>
        </div>
      </div>
    </div>

    <!-- 报告模态框（计算记录文档本身保持中文：与知识库同口径，非 UI 文案） -->
    <div class="modal-overlay" id="r_modal" hidden>
      <div class="modal">
        <div class="modal-head">
          <div class="modal-title">📄 ${tr('冒口设计计算记录')}</div>
          <button class="modal-close" data-close>&times;</button>
        </div>
        <div class="report-body" id="r_reportBody"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="r_reportCopy" style="flex:1">📋 ${tr('复制文本')}</button>
          <button class="btn btn-ghost" id="r_reportPrint" style="flex:1">🖨️ ${tr('打印')}</button>
          <button class="btn btn-primary" id="r_reportDl" style="flex:1">⬇️ ${tr('下载报告')}</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });

  const mcModeSel = container.querySelector('#r_mc_mode');
  const toggleMc = () => {
    const m = mcModeSel.value;
    container.querySelector('#r_mc_direct').style.display = m === 'direct' ? 'block' : 'none';
    container.querySelector('#r_mc_hot').style.display = m === 'hot_spot' ? 'block' : 'none';
    container.querySelector('#r_mc_wall').style.display = m === 'wall' ? 'block' : 'none';
    container.querySelector('#r_mc_vol').style.display = m === 'volume' ? 'grid' : 'none';
  };

  let lastResult = null;
  const read = () => {
    const q = (id) => container.querySelector(id);
    const selectedShape = q('#r_shape').value;
    const insulated = selectedShape === 'insulated';
    // 发热/保温的基准仍是普通圆柱 V0；H/D 从当前选择器读取并沿用（164 §4.3）。
    // 未知的 'insulated' 不传给冻结算法，核心只负责给出普通圆柱 V0。
    const shape = insulated ? 'cyl' : selectedShape;
    return {
      mat: q('#r_mat').value,
      cast_wt: parseFloat(q('#r_cast_wt').value) || 0,
      mc_mode: mcModeSel.value,
      mc: parseFloat(q('#r_mc').value) || 0,
      hot_d: parseFloat(q('#r_hot_d').value) || 0,
      wall_t: parseFloat(q('#r_wall_t').value) || 0,
      cast_v: parseFloat(q('#r_cast_v').value) || 0,
      cast_a: parseFloat(q('#r_cast_a').value) || 0,
      shape,
      hd_ratio: parseFloat(q('#r_hd').value) || 1.0,
      eff: RISER_EFF[RISER_SHAPES[shape].effKey],
    };
  };
  // PHASE 63：示例默认值标记（铸件重量/Mc 组）；P0-1 门禁
  const ex = installExampleTags(container, ['r_cast_wt', 'r_mc', 'r_hot_d', 'r_wall_t', 'r_cast_v', 'r_cast_a']);
  const renderInvalid = (err) => {
    container.querySelector('#r_results').innerHTML = `<div class="empty" style="padding:26px"><span class="empty-sub">⚠️ ${err}</span></div>`;
    container.querySelector('#r_judge').innerHTML = `<div class="judge bad">⚠️ ${err}</div>`;
  };
  const update = () => {
    const $ = (id) => container.querySelector(id);
    const mode = mcModeSel.value;
    const checks = [
      checkNum($('#r_cast_wt').value, { label: tr('铸件重量'), min: 0 }),
    ];
    if (mode === 'direct') checks.push(checkNum($('#r_mc').value, { label: tr('热节模数 Mc'), gt: 0, required: true }));
    else if (mode === 'hot_spot') checks.push(checkNum($('#r_hot_d').value, { label: tr('热节圆直径 d'), gt: 0, required: true }));
    else if (mode === 'wall') checks.push(checkNum($('#r_wall_t').value, { label: tr('壁厚 t'), gt: 0, required: true }));
    else {
      checks.push(
        checkNum($('#r_cast_v').value, { label: tr('热节处体积 V'), gt: 0, required: true }),
        checkNum($('#r_cast_a').value, { label: tr('热节处表面积 A'), gt: 0, required: true }));
    }
    const err = firstErr(checks);
    if (err) { lastResult = null; renderInvalid(err); return; }
    const input = read();
    const base = runRiser(input);
    const insulated = container.querySelector('#r_shape')?.value === 'insulated';
    lastResult = insulated && base
      ? applyInsulatedRiserResult(base, { hdRatio: input.hd_ratio })
      : base;
    renderResults(lastResult);
    renderJudge(lastResult);
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 180); };

  /* R6-S3.1（154.txt §三.8/§九）：球形没有独立高度自由度，H/D 选择器对它无效——
     显式隐藏并说明，不再让用户以为选了 0.8/1.5 会改变球形几何。 */
  const applyShapeUi = () => {
    const shape = container.querySelector('#r_shape')?.value;
    const fixed = shape === 'sphere';   // 164 §4.3：发热/保温沿用当前 H/D，不隐藏
    const hdField = container.querySelector('#r_hd_field');
    const hdNote = container.querySelector('#r_hd_note');
    const insNote = container.querySelector('#r_insulated_note');
    if (hdField) hdField.hidden = fixed;
    if (hdNote) {
      hdNote.hidden = !fixed;
      if (!hdNote.hidden) hdNote.textContent = tr('球形冒口由球径唯一确定（H ≡ D），不存在独立 H/D 设计自由度；切到圆柱/球顶圆柱/方柱后可选 H/D。');
    }
    if (insNote) insNote.hidden = shape !== 'insulated';
  };
  mcModeSel.addEventListener('change', () => { toggleMc(); debounced(); });
  container.querySelector('#r_shape').addEventListener('change', () => { applyShapeUi(); debounced(); });
  /* 164 §4.3：H/D 是发热/保温主结果的有效输入，change 与 input 都触发重算（合成事件/键盘操作均覆盖）。 */
  container.querySelector('#r_hd').addEventListener('change', debounced);
  container.querySelectorAll('.section-card input, .section-card select').forEach(el =>
    el.addEventListener('input', debounced));

  const row = (label, value, unit, cls = '', note = '') =>
    `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
  // PHASE 73：非有限值一律显示 '—'（与设计中心 fmt 同口径）——原实现 String(NaN) 会把 NaN 直接印到界面上
  const fmt = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');

  function renderResults(r) {
    const el = container.querySelector('#r_results');
    if (!r) { el.innerHTML = `<div class="empty" style="padding:26px"><span class="empty-sub">${tr('请输入有效的热节模数')}</span></div>`; return; }
    const insulated = container.querySelector('#r_shape')?.value === 'insulated';
    const md = r.md, sd = r.sd;
    /* R6-S3.1（154.txt §七）：P1 提醒在主界面压缩成一句；完整原理/适用条件进可展开区。
       灰铁提示只在灰铁出现，不隐藏工程条件。 */
    const grayIronNote = md.name === '灰铁(HT)'
      ? `<div class="dc-hint-p1">🧊 ${tr('灰铸铁石墨化膨胀可降低净补缩需求；热节明显或壁厚差大的铸件仍需结合冷铁与补缩条件校核。完整说明见下方“计算依据”。')}</div>`
      : '';
    const campbellNote = `<div class="dc-hint-p1">📌 ${tr('Campbell 提示：冒口优先错位侧上方接入热节；T 字交叉会自成热节、需要更大模数。完整原理见下方“计算依据”。')}</div>`;
    /* 164 §4：发热/保温已经选择为**当前设计类型**，主结果只显示换算后的这一套几何。
       普通圆柱 V0 只作为基准体积出现在明细，不再作为第二套尺寸展示。 */
    if (insulated) {
      if (r.insulatedError) {
        el.innerHTML = `<div class="empty" style="padding:26px"><span class="empty-sub">⚠️ ${tr('无法计算：缺少有效的普通圆柱基准体积或 H/D。')}</span></div>`;
        return;
      }
      const hdAct = r.D > 0 ? r.H / r.D : null;
      el.innerHTML = `
        ${ex.exampleNote()}
        ${grayIronNote}
        ${campbellNote}
        <div class="group-title" data-insulated-main>${tr('发热/保温冒口（经验估算）')}</div>
        ${row(`🏗️ ${tr('当前方案')}`, `⌀${r.D}×H${r.H}`, '', '', tr('按目标体积反算并回算几何'))}
        ${row(`📐 ${tr('直径 D')}`, r.D, 'mm')}
        ${row(`📏 ${tr('高度 H')}`, r.H, 'mm')}
        ${row(`📐 ${tr('实际 H/D')}`, fmt(hdAct, 2), '', '', tr('沿用名义 H/D = {k}', [fmt(r.hd, 2)]))}
        ${row(`📦 ${tr('普通圆柱基准体积 V0')}`, fmt(r.V0 / 1000, 1), 'cm³', '', tr('普通圆柱几何体积，不含补缩效率修正'))}
        ${row(`🎯 ${tr('目标体积 V1 = 0.4 × V0')}`, fmt(r.V1 / 1000, 1), 'cm³', '', tr('40% 为本产品经验系数'))}
        ${row(`🧊 ${tr('实际几何体积（按显示尺寸回算）')}`, fmt(r.Vactual / 1000, 1), 'cm³', r.volumeOk ? 'ok' : 'warn', r.volumeOk ? tr('≥ 目标体积') : tr('小于目标体积，请复核'))}
        ${row(`🧲 ${tr('几何模数（参考）')}`, fmt(r.Mr_act, 2), 'mm', '', tr('由新几何 D×H 计算；不作普通目标模数判定'))}
        ${row(`🧲 ${tr('铸件热节模数 Mc')}`, fmt(r.Mc, 2), 'mm')}
        ${r.weightKg != null ? row(`⚖️ ${tr('冒口重量（按几何体积与密度）')}`, fmt(r.weightKg, 3), 'kg') : ''}
        ${r.cw > 0 && r.yieldPct != null ? row(`📊 ${tr('单件（铸件+冒口）出品率（参考）')}`, fmt(r.yieldPct, 1), '%', '', tr('按换算后的冒口体积计算')) : ''}
        ${renderRiserReferenceCards({ modulus: r.Mr_act, wallThickness: proj.getV('process.wallUsed') })}
        <div class="field-hint dc-ref-note" data-ref-note>${referenceNote()}</div>
        <div class="field-hint dc-top-note" data-top-note>${riserTopNote()}</div>
        <details class="sc-fold">
          <summary>📖 ${tr('计算依据 / 经验性质（展开）')}</summary>
          <div class="field-hint p72-cn" style="line-height:1.7">${insulatedFormulaNote()}</div>
          <div class="field-hint p72-cn" style="line-height:1.7">${insulatedNoEfficiencyNote()}</div>
          <div class="field-hint p72-cn" style="line-height:1.7">${insulatedLimitNote()}</div>
          <div class="field-hint p72-cn" style="line-height:1.7">${tr('· 尺寸反算：')}D = ∛(4V1/(πk))，H = kD；D 取整数 mm，H 按 kD 取整，最后按显示尺寸回算体积。<br>${tr('· 普通圆柱基准：')}${tr('D0/H0 仅用于取得 V0，不作为当前主结果。')}</div>
        </details>`;
      bindRiserReference(el);
      return;
    }
    // PHASE 73：输入极小（如 Mc < 0.1mm）时迭代把 D/H 取整到 0，形状模数 0/0 会产出 NaN。
    //   不改计算（公式冻结），改为**明确告知输入不适用**，不让 NaN 流到界面。
    const degenerate = !Number.isFinite(r.Mr_act) || !(r.D > 0) || !(r.H > 0);
    // PHASE V2.0-15（126.txt §三）：独立计算器此前**完全看不到未收敛** ——
    //   renderJudge 只给模数/体积两个 ✓/✗ 徽标，标题还写「自动迭代最优解」。
    const w = riserWarning(r);
    const okConv = riserConverged(r) !== false;
    // PHASE V2.0-22（138.txt §五）：`Mr_target` 为本阶段新增字段；旧结果对象回退到 `Mr_need`
    //   （两者恒等，见 `calcs/riser.js` 返回对象注释）。
    const MrT = r.Mr_target != null ? r.Mr_target : r.Mr_need;
    el.innerHTML = `
      ${ex.exampleNote()}
      ${degenerate ? `<div class="field-hint p72-cn" style="padding:8px 10px;background:#fffbeb;border-radius:8px;margin:4px 0 8px;color:#b45309">⚠️ 输入值过小（当前热节模数 Mc = ${fmt(r.Mc, 3)} mm），反求后的冒口尺寸取整为 0，无法给出有效的模数校核。<br>请检查输入：实际铸件的热节模数通常为 1~80 mm 量级。</div>` : ''}
      ${w ? `<div class="field-hint p72-cn" style="padding:10px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;margin:4px 0 10px;color:#b91c1c;line-height:1.75">${tr(w.key, w.params)}</div>` : ''}
      ${grayIronNote}
      ${campbellNote}
      <div class="group-title">${tr(okConv ? '推荐冒口（按目标模数反求）' : '计算所得冒口（未收敛，非最终建议）')}</div>
      ${row('🏗️ ' + tr(sd.name), sd.label(r.D, r.H), '', '', tr('由目标模数 Mr_target 反求'))}
      ${row('📐 ' + tr(r.dimLabel), r.D, 'mm')}
      ${r.shapeKey === 'sphere'
        ? row(`📐 ${tr('球形几何')}`, tr('由球径唯一确定（H ≡ D）'))
        : `${row(`📏 ${tr('高度 H')}`, r.H, 'mm')}${row(`📐 ${tr('H/D 比')}`, (r.H / r.D).toFixed(1))}`}
      ${row(`🔢 ${tr('目标模数比 Mr/Mc')}`, (r.targetRatio != null ? r.targetRatio : 1.2).toFixed(2), '', '', tr('设计规则常量，不再迭代'))}
      ${row(`🧲 ${tr('铸件热节模数 Mc')}`, r.Mc.toFixed(2), 'mm')}
      ${row(`🎯 ${tr('目标冒口模数 Mr_target')}`, MrT.toFixed(2), 'mm')}
      ${row(`✅ ${tr('实际冒口模数 Mr_actual')}`, r.Mr_act.toFixed(2), 'mm', r.modOk ? 'ok' : 'bad', r.modOk ? `≥${MrT.toFixed(2)} ✓` : `< ${MrT.toFixed(2)} ✗`)}
      <div class="group-title">💧 ${tr('冒口体积与补缩量')}</div>
      ${row(`📦 ${tr('冒口体积')}`, (r.Vr / 1000).toFixed(1), 'cm³')}
      ${row(`💧 ${tr('补缩效率')}`, (r.eff * 100).toFixed(1), '%', '', tr(sd.name))}
      ${row(`🫗 ${tr('有效补缩量')}`, (r.effV / 1000).toFixed(1), 'cm³')}
      ${r.cw > 0
        ? row(`📊 ${tr('单件（铸件+冒口）出品率（参考）')}`, r.yieldPct !== null ? fmt(r.yieldPct, 1) : '—', '%', '', tr('设计口径，不是整模实际出品率'))
        : `<div class="field-hint" style="padding:4px">${tr('未输入铸件重量：不计算单件出品率（参考）')}</div>`}
      ${renderRiserReferenceCards({ modulus: r.Mr_act, wallThickness: proj.getV('process.wallUsed') })}
      <div class="field-hint dc-ref-note" data-ref-note>${referenceNote()}</div>
      <div class="field-hint dc-top-note" data-top-note>${riserTopNote()}</div>
      <details class="sc-fold">
        <summary>📖 ${tr('计算依据 / 工程提示（展开）')}</summary>
        ${md.name === '灰铁(HT)' ? `<div class="field-hint p72-cn" style="line-height:1.7">🧊 <b>${tr('工程提示')}</b>${tr('：灰铸铁具有石墨化膨胀特性，接近共晶成分时净补缩需求通常较低，部分铸件可采用无冒口或小冒口工艺。对于热节明显、壁厚差较大的铸件，仍应结合冷铁及实际补缩条件进行校核。')}</div>` : ''}
        <div class="field-hint p72-cn" style="line-height:1.7">${tr('riser.note.campbell')}</div>
        <div class="field-hint p72-cn" style="line-height:1.7">${tr('· 模数公式：')}${tr(sd.formula)}<br>${tr('· 收缩率：')}${tr(md.name)} = ${(md.shrink * 100).toFixed(1)}%${tr('（《铸造手册》体收缩率，非线收缩率）')}<br>${tr('· 补缩效率：《铸造手册》第5卷典型值（当前算法固定，不可编辑）')}</div>
      </details>
    `;
    bindRiserReference(el);
  }

  function renderJudge(r) {
    const el = container.querySelector('#r_judge');
    if (!r) { el.innerHTML = `<div class="judge bad">⚠️ ${tr('请输入有效的热节模数')}</div>`; return; }
    if (r.designType === 'insulated' || container.querySelector('#r_shape')?.value === 'insulated') {
      el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="chip">${tr('经验估算')}</span>
        <span class="field-hint">${tr('发热/保温冒口：尺寸按 V1 = 0.4V0 与当前 H/D 反算；普通目标模数判定和补缩效率表不适用于本模式，需结合工艺验证。')}</span></div>`;
      return;
    }
    const parts = [];
    parts.push(`<span class="chip ${r.modOk ? 'success' : 'danger'}">${tr('模数')} ${r.modOk ? '✓' : '✗'}</span>`);
    // S5-01：旧体积参考不再出现在校核结论中（它不是设计判据，用户已明确要求移除该提示）。
    // PHASE V2.0-15（126.txt §三 / §五）：**不得仅因 modOk=true 就显示整体通过** ——
    //   未收敛时先出一个醒目的"未收敛"徽标，且不再称"推荐"。
    const okConv = riserConverged(r) !== false;
    if (!okConv) parts.unshift(`<span class="chip danger">⛔ ${tr('未收敛')}</span>`);
    el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${parts.join('')}<span class="field-hint">${okConv ? tr('推荐：') : tr('当前计算所得（未收敛，非最终建议）：')}${tr(r.sd.name)} ${r.sd.label(r.D, r.H)}</span></div>`;
  }

  // ---- 报告 ----
  function buildReportHtml() {
    if (!lastResult) return '';
    const r = lastResult;
    const MrT = r.Mr_target != null ? r.Mr_target : r.Mr_need;   // PHASE V2.0-22：新增字段，旧结果回退
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const t = (label, val) => `<tr><td style="width:38%">${label}</td><td>${val}</td></tr>`;
    if (r.designType === 'insulated') {
      const hdAct = r.D > 0 ? r.H / r.D : null;
      return `
        <h2>🏗️ 铸造冒口设计计算记录 · 发热/保温冒口（经验估算）</h2>
        <p class="meta">生成时间：${now}</p>
        <h3>一、输入参数</h3>
        <table>${t('材质', r.md.name)}${t('热节模数 Mc', r.Mc.toFixed(2) + ' mm')}${t('冒口类型', '发热/保温冒口（经验估算）')}${t('沿用 H/D', Number(r.hd).toFixed(2))}${r.cw > 0 ? t('铸件重量（整件净重口径）', r.cw.toFixed(2) + ' Kg') : ''}</table>
        <h3>二、体积换算与尺寸反算</h3>
        <table>${t('普通圆柱基准体积 V0', (r.V0 / 1000).toFixed(1) + ' cm³（几何体积，不含补缩效率修正）')}${t('目标体积 V1 = 0.4 × V0', (r.V1 / 1000).toFixed(1) + ' cm³（40% 为本产品经验系数）')}${t('直径 D / 高度 H', `⌀${r.D} × H${r.H} mm（实际 H/D ${hdAct != null ? hdAct.toFixed(2) : '—'}）`)}${t('实际几何体积（按显示尺寸回算）', (r.Vactual / 1000).toFixed(1) + ' cm³' + (r.volumeOk ? ' ✅' : ' ⚠️ 小于目标'))}${t('几何模数（参考）', r.Mr_act.toFixed(2) + ' mm（由新几何计算，不作普通目标模数判定）')}${r.weightKg != null ? t('冒口重量（按几何体积与密度）', r.weightKg.toFixed(3) + ' Kg') : ''}${r.cw > 0 && r.yieldPct != null ? t('单件（铸件+冒口）出品率（参考）', r.yieldPct.toFixed(1) + '%') : ''}</table>
        <h3>三、经验性质与限制</h3>
        <div style="font-size:.8rem;color:#4b5563;line-height:1.8">${insulatedFormulaNote()}<br>${insulatedNoEfficiencyNote()}<br>${insulatedLimitNote()}</div>`;
    }
    /* S5-01：旧体积模型一节已移除。单件出品率是可解释的参考值，保留但明确标为设计口径。 */
    const volHtml = r.cw > 0
      ? `<h3>三、单件（铸件+冒口）出品率（参考）</h3><table>${t('单件（铸件+冒口）出品率', r.yieldPct !== null ? r.yieldPct.toFixed(1) + '%' : '—')}</table>`
        + `<div style="font-size:.76rem;color:#6b7280;line-height:1.8">该值按输入的铸件重量与冒口体积计算，是单件设计口径的参考值，不是整模实际出品率；实际出品率请用本厂实绩回算。</div>`
      : '';
    const sourceNo = r.cw > 0 ? '四' : '三';
    // PHASE V2.0-15（126.txt §三）：独立计算器**自己的导出报告**同样不得遗漏未收敛警告。
    const warnTxt = fillWarning(riserWarning(r));
    return `
      <h2>🏗️ 铸造冒口设计计算记录</h2>
      <p class="meta">生成时间：${now}</p>
      ${warnTxt ? `<div class="warn" style="background:#fef2f2;border-color:#fecaca;color:#b91c1c">${warnTxt}</div>` : ''}
      <h3>一、输入参数</h3>
      <table>${t('材质', r.md.name)}${t('热节模数 Mc', r.Mc.toFixed(2) + ' mm')}${t('冒口形状', r.sd.name)}${r.shapeKey === 'sphere' ? t('H/D 比', '不适用（球形 H ≡ D）') : t('H/D 比', (r.H / r.D).toFixed(1))}${t('目标模数比 Mr/Mc', (r.targetRatio != null ? r.targetRatio : 1.2).toFixed(2))}${t('补缩效率', (r.eff * 100).toFixed(1) + '%')}${r.cw > 0 ? t('铸件重量（整件净重口径）', r.cw.toFixed(2) + ' Kg') : ''}</table>
      <h3>二、冒口推荐尺寸</h3>
      <table>${t('冒口规格', r.sd.label(r.D, r.H))}${t(r.dimLabel, r.D + ' mm')}${r.shapeKey === 'sphere' ? t('球形几何', '由球径唯一确定（H ≡ D）') : t('高度 H', r.H + ' mm')}${t('目标冒口模数 Mr_target', MrT.toFixed(2) + ' mm')}${t('实际冒口模数 Mr_actual', r.Mr_act.toFixed(2) + ' mm ' + (r.modOk ? '✅' : '❌'))}${t('冒口体积', (r.Vr / 1000).toFixed(1) + ' cm³')}</table>
      ${volHtml}
      <h3>${sourceNo}、数据来源</h3>
      <div style="font-size:.76rem;color:#6b7280;line-height:1.8">· 模数公式：${r.sd.formula}<br>· 收缩率：${r.md.name}=${(r.md.shrink * 100).toFixed(1)}%（《铸造手册》体收缩率）<br>· 补缩效率：源自《铸造手册》第5卷典型值（当前算法固定，不可编辑）</div>`;
  }

  const openReport = () => {
    if (!lastResult) { showToast(tr('请先完成计算')); return; }
    container.querySelector('#r_reportBody').innerHTML = buildReportHtml();
    container.querySelector('#r_modal').hidden = false;
  };
  const closeReport = () => { container.querySelector('#r_modal').hidden = true; };
  container.querySelector('#r_reportBtn').addEventListener('click', openReport);
  container.querySelector('[data-close]').addEventListener('click', closeReport);
  container.querySelector('#r_modal').addEventListener('click', (e) => { if (e.target === container.querySelector('#r_modal')) closeReport(); });
  container.querySelector('#r_reportPrint').addEventListener('click', () => {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>冒口设计计算记录</title><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}th{background:#f3f4f6}td:first-child{width:38%;color:#6b7280}td:last-child{font-weight:600}</style></head><body>${buildReportHtml()}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  });
  container.querySelector('#r_reportDl').addEventListener('click', () => {
    saveFile(`冒口设计计算记录_${Date.now()}.html`, `<html><head><meta charset="utf-8"><title>冒口设计计算记录</title></head><body style="font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px">${buildReportHtml()}</body></html>`);
  });
  container.querySelector('#r_reportCopy').addEventListener('click', () => {
    const plain = buildReportHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    navigator.clipboard?.writeText(plain).then(() => showToast(tr('已复制报告文本')), () => showToast(tr('复制失败')));
  });

  // ---- 初始化 ----
  setRecompute(update);   // PHASE 72：语言切换 → 重渲染视图后原地重算（数值不变，只换文案）
  prefillMaterial(container, '#r_mat');   // 当前工况材料 → 预选材质
  toggleMc();
  applyShapeUi();
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
