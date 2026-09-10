// ============================================================
// 冒口设计 · 视图（重建于工具箱统一设计系统）
// ============================================================
import { RISER_MATERIALS, RISER_EFF, RISER_SHAPES, calcMc, runRiser } from '../../calcs/riser.js';
import { prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { saveFile } from '../download.js';
import { checkNum, firstErr } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';
// PHASE 72（80.txt §八）：核心计算器 UI 中英双语（公式/变量/单位不动）
import { t as tr } from '../i18n/index.js';
import { setRecompute } from '../i18n/viewState.js';

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
                </select>
              </div>
            </div>
            <div class="field">
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
          <div class="divider"></div>
          <div class="field-hint" style="margin-bottom:8px">${tr('冒口补缩效率（可修改，源自《铸造手册》第5卷）')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="f-row"><span class="field-label" style="flex:1">🏕 ${tr('明顶圆柱/方柱')}</span><input class="field-input" type="number" id="r_eff_open" value="${DEFAULTS.eff_open}" style="width:70px" min="1" max="60"><span class="f-unit">%</span></div>
            <div class="f-row"><span class="field-label" style="flex:1">🕳️ ${tr('暗侧圆柱')}</span><input class="field-input" type="number" id="r_eff_blind" value="${DEFAULTS.eff_blind}" style="width:70px" min="1" max="60"><span class="f-unit">%</span></div>
            <div class="f-row"><span class="field-label" style="flex:1">🔵 ${tr('球顶柱暗冒口')}</span><input class="field-input" type="number" id="r_eff_sph" value="${DEFAULTS.eff_sph}" style="width:70px" min="1" max="60"><span class="f-unit">%</span></div>
            <div class="f-row"><span class="field-label" style="flex:1">🔥 ${tr('发热保温')}</span><input class="field-input" type="number" id="r_eff_heat" value="${DEFAULTS.eff_heat}" style="width:70px" min="1" max="80"><span class="f-unit">%</span></div>
          </div>
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
    const shape = q('#r_shape').value;
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
      hd_ratio: q('#r_hd').value,
      eff: parseFloat(q('#r_eff_' + (RISER_SHAPES[shape].effKey).replace('eff_', '')).value),
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
      checkNum($('#r_eff_open').value, { label: tr('明顶圆柱/方柱效率'), min: 0, max: 100 }),
      checkNum($('#r_eff_blind').value, { label: tr('暗侧圆柱效率'), min: 0, max: 100 }),
      checkNum($('#r_eff_sph').value, { label: tr('球顶柱暗冒口效率'), min: 0, max: 100 }),
      checkNum($('#r_eff_heat').value, { label: tr('发热保温效率'), min: 0, max: 100 }),
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
    lastResult = runRiser(input);
    renderResults(lastResult);
    renderJudge(lastResult);
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 180); };

  mcModeSel.addEventListener('change', () => { toggleMc(); debounced(); });
  container.querySelectorAll('.section-card input, .section-card select').forEach(el =>
    el.addEventListener('input', debounced));

  const row = (label, value, unit, cls = '', note = '') =>
    `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
  // PHASE 73：非有限值一律显示 '—'（与设计中心 fmt 同口径）——原实现 String(NaN) 会把 NaN 直接印到界面上
  const fmt = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');

  function renderResults(r) {
    const el = container.querySelector('#r_results');
    if (!r) { el.innerHTML = `<div class="empty" style="padding:26px"><span class="empty-sub">${tr('请输入有效的热节模数')}</span></div>`; return; }
    const md = r.md, sd = r.sd;
    // 灰铸铁低补缩需求工程提示（59.txt；仅灰铁显示，防绝对化：保留工程条件限制）
    const grayIronNote = md.name === '灰铁(HT)'
      ? `<div class="field-hint" style="padding:8px 4px 4px;background:#fffbeb;border-radius:8px;margin:4px 0 8px">🧊 <b>${tr('工程提示')}</b>${tr('：灰铸铁具有石墨化膨胀特性，接近共晶成分时净补缩需求通常较低，部分铸件可采用无冒口或小冒口工艺。对于热节明显、壁厚差较大的铸件，仍应结合冷铁及实际补缩条件进行校核。')}</div>`
      : '';
    // Campbell《Complete Casting Handbook》：冒口位置理论（T 字交叉 vs 侧上方错位连接）。
    // 纯提示层（59.txt 模式），不参与计算；措辞保留工程条件（顶置可用、侧放更优），防绝对化。
    const campbellNote = `<div class="field-hint" style="padding:8px 4px 4px;background:#eef4fb;border-radius:8px;margin:4px 0 8px">${tr('riser.note.campbell')}</div>`;
    // PHASE 73：输入极小（如 Mc < 0.1mm）时迭代把 D/H 取整到 0，形状模数 0/0 会产出 NaN。
    //   不改计算（公式冻结），改为**明确告知输入不适用**，不让 NaN 流到界面。
    const degenerate = !Number.isFinite(r.Mr_act) || !(r.D > 0) || !(r.H > 0);
    el.innerHTML = `
      ${ex.exampleNote()}
      ${degenerate ? `<div class="field-hint p72-cn" style="padding:8px 10px;background:#fffbeb;border-radius:8px;margin:4px 0 8px;color:#b45309">⚠️ 输入值过小（当前热节模数 Mc = ${fmt(r.Mc, 3)} mm），迭代后的冒口尺寸取整为 0，无法给出有效的模数/体积校核。<br>请检查输入：实际铸件的热节模数通常为 1~80 mm 量级。</div>` : ''}
      ${grayIronNote}
      ${campbellNote}
      <div class="group-title">${tr('推荐冒口（自动迭代最优解）')}</div>
      ${row('🏗️ ' + tr(sd.name), sd.label(r.D, r.H), '', '', tr('f 迭代至校核通过'))}
      ${row('📐 ' + tr(r.dimLabel), r.D, 'mm')}
      ${row(`📏 ${tr('高度 H')}`, r.H, 'mm')}
      ${row(`📐 ${tr('H/D 比')}`, (r.H / r.D).toFixed(1))}
      ${row(`🔢 ${tr('模数放大系数 f')}`, r.final_f.toFixed(2), '', '', tr('从1.10迭代'))}
      ${row(`🧲 ${tr('铸件热节模数 Mc')}`, r.Mc.toFixed(2), 'mm')}
      ${row(`🎯 ${tr('所需冒口模数 Mr_need')}`, r.Mr_need.toFixed(2), 'mm')}
      ${row(`✅ ${tr('实际冒口模数 Mr_act')}`, r.Mr_act.toFixed(2), 'mm', r.modOk ? 'ok' : 'bad', r.modOk ? `≥${r.Mr_need.toFixed(2)} ✓` : `< ${r.Mr_need.toFixed(2)} ✗`)}
      <div class="group-title">💧 ${tr('体积校验')}</div>
      ${row(`📦 ${tr('冒口体积')}`, (r.Vr / 1000).toFixed(1), 'cm³')}
      ${row(`💧 ${tr('补缩效率')}`, (r.eff * 100).toFixed(1), '%', '', tr(sd.name))}
      ${row(`🫗 ${tr('有效补缩量')}`, (r.effV / 1000).toFixed(1), 'cm³')}
      ${r.cw > 0 ? `
        ${row(`📦 ${tr('铸件体积（补缩区）')}`, (r.Vc / 1000).toFixed(0), 'cm³')}
        ${row(`📉 ${tr('收缩率')}`, (md.shrink * 100).toFixed(1), '%', '', tr(md.name))}
        ${row(`🎯 ${tr('所需补缩量')}`, (r.needVol / 1000).toFixed(1), 'cm³')}
        ${row(`✅ ${tr('补缩判定')}`, (r.effV / 1000).toFixed(1) + ' ≥ ' + (r.needVol / 1000).toFixed(1), 'cm³', r.volOk ? 'ok' : 'bad', tr(r.volOk ? '充足 ✓' : '不足 ✗'))}
        ${row(`📊 ${tr('工艺出品率')}`, r.yieldPct !== null ? fmt(r.yieldPct, 1) : '—', '%')}
      ` : `<div class="field-hint" style="padding:4px">${tr('输入铸件重量后可做体积校验')}</div>`}
      <div class="field-hint" style="padding:4px 4px 0;font-size:.74rem;color:#94a3b8">${tr('riser.note.volSimplified')}</div>
      <div class="group-title">🔗 ${tr('冒口颈')}</div>
      ${row(`🔗 ${tr('冒口颈模数 M_neck')}`, r.M_neck.toFixed(2), 'mm', '', `Mc×${r.neck_k}（${tr(md.name)}${tr('系数')}）`)}
      ${row(`⭕ ${tr('圆形冒口颈 ⌀')}`, '⌀' + r.d_neck, 'mm', '', 'M=d/4')}
      ${row(`🟦 ${tr('方形冒口颈 a×a')}`, r.d_neck + '×' + r.d_neck, 'mm', '', 'M=a/4')}
      ${row(`📏 ${tr('颈长建议')}`, Math.round(r.d_neck * 0.5) + '~' + Math.round(r.d_neck * 1.0), 'mm', '', tr('≈0.5~1.0倍颈径'))}
      <div class="group-title">📖 ${tr('数据来源')}</div>
      <div class="field-hint p72-cn" style="line-height:1.7">${tr('· 模数公式：')}${tr(sd.formula)}<br>${tr('· 收缩率：')}${tr(md.name)} = ${(md.shrink * 100).toFixed(1)}%${tr('（《铸造手册》体收缩率，非线收缩率）')}<br>${tr('· 补缩效率：《铸造手册》第5卷典型值')}<br>${tr('· 冒口颈系数：')}${tr(md.name)}=${r.neck_k}×Mc${tr('riser.note.neckCoef')}</div>
    `;
  }

  function renderJudge(r) {
    const el = container.querySelector('#r_judge');
    if (!r) { el.innerHTML = `<div class="judge bad">⚠️ ${tr('请输入有效的热节模数')}</div>`; return; }
    const parts = [];
    parts.push(`<span class="chip ${r.modOk ? 'success' : 'danger'}">${tr('模数')} ${r.modOk ? '✓' : '✗'}</span>`);
    if (r.cw > 0) parts.push(`<span class="chip ${r.volOk ? 'success' : 'danger'}">${tr('体积')} ${r.volOk ? '✓' : '✗'}</span>`);
    el.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${parts.join('')}<span class="field-hint">${tr('推荐：')}${tr(r.sd.name)} ${r.sd.label(r.D, r.H)}</span></div>`;
  }

  // ---- 报告 ----
  function buildReportHtml() {
    if (!lastResult) return '';
    const r = lastResult;
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const t = (label, val) => `<tr><td style="width:38%">${label}</td><td>${val}</td></tr>`;
    let volHtml = '';
    if (r.cw > 0) {
      volHtml = `<h3>四、体积校验</h3><table>${t('铸件体积（补缩区）', (r.Vc / 1000).toFixed(0) + ' cm³')}${t('收缩率', (r.md.shrink * 100).toFixed(1) + '%')}${t('所需补缩量', (r.needVol / 1000).toFixed(1) + ' cm³')}${t('有效补缩量', (r.effV / 1000).toFixed(1) + ' cm³')}${t('补缩判定', r.volOk ? '✅ 充足' : '❌ 不足')}${t('工艺出品率', r.yieldPct !== null ? r.yieldPct.toFixed(1) + '%' : '—')}</table>`;
    }
    return `
      <h2>🏗️ 铸造冒口设计计算记录</h2>
      <p class="meta">生成时间：${now}</p>
      <h3>一、输入参数</h3>
      <table>${t('材质', r.md.name)}${t('热节模数 Mc', r.Mc.toFixed(2) + ' mm')}${t('冒口形状', r.sd.name)}${t('H/D 比', (r.H / r.D).toFixed(1))}${t('模数放大系数 f', r.final_f.toFixed(2))}${t('补缩效率', (r.eff * 100).toFixed(1) + '%')}${r.cw > 0 ? t('铸件重量（补缩区）', r.cw.toFixed(2) + ' Kg') : ''}</table>
      <h3>二、冒口推荐尺寸</h3>
      <table>${t('冒口规格', r.sd.label(r.D, r.H))}${t(r.dimLabel, r.D + ' mm')}${t('高度 H', r.H + ' mm')}${t('所需冒口模数', r.Mr_need.toFixed(2) + ' mm')}${t('实际冒口模数', r.Mr_act.toFixed(2) + ' mm ' + (r.modOk ? '✅' : '❌'))}${t('冒口体积', (r.Vr / 1000).toFixed(1) + ' cm³')}</table>
      <h3>三、冒口颈</h3>
      <table>${t('冒口颈模数 M_neck', r.M_neck.toFixed(2) + ' mm（系数' + r.neck_k + '）')}${t('圆形冒口颈 ⌀', '⌀' + r.d_neck + ' mm')}${t('方形冒口颈', r.d_neck + '×' + r.d_neck + ' mm')}${t('颈长建议', Math.round(r.d_neck * 0.5) + '~' + Math.round(r.d_neck * 1.0) + ' mm')}${t('颈径占比', r.D > 0 ? (r.d_neck / r.D * 100).toFixed(0) + '%' : '—')}</table>
      ${volHtml}
      <h3>五、数据来源</h3>
      <div style="font-size:.76rem;color:#6b7280;line-height:1.8">· 模数公式：${r.sd.formula}<br>· 收缩率：${r.md.name}=${(r.md.shrink * 100).toFixed(1)}%（《铸造手册》体收缩率）<br>· 补缩效率：源自《铸造手册》第5卷典型值<br>· 冒口颈系数：${r.md.name}=${r.neck_k}×Mc（工程参考值）</div>`;
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
