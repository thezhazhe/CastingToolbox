// ============================================================
// 熔炼加料计算 · 视图 v2
// 金属炉料按比例%输入自动算 kg · 每个料可选规格/自定义成分 ·
// 吸收率可改 · 补料建议一键应用 · CE 显示 · 报告弹窗
// ============================================================
import { CHARGE_GRADES, CHARGE_TARGETS, CHARGE_MATERIALS, CHARGE_RET_ABS, SPHERO_TYPES, INOC_TYPES, returnComposition } from '../../data/charge_calc.js';
import { defaultCharge, runCharge } from '../../calcs/charge.js';
import { prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { saveFile } from '../download.js';
import { checkNum, firstErr, parseNum } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';

const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));
const CUSTOM = '__custom';

const matOpts = (keys) => keys.map(k => `<option value="${k}">${CHARGE_MATERIALS[k].label}</option>`).join('') + `<option value="${CUSTOM}">✏️ 自定义…</option>`;
const typeOpts = (map) => Object.keys(map).map(k => `<option value="${k}">${k}</option>`).join('') + `<option value="${CUSTOM}">✏️ 自定义…</option>`;

export function renderCharge(container, calc) {
  const gradeOpts = CHARGE_GRADES.map(g => `<option value="${g}">${g} · ${CHARGE_TARGETS[g].addons ? '球铁' : '灰铁'}</option>`).join('');

  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn btn-ghost" data-back>← 返回</button>
          <span class="tool-icon" style="width:36px;height:36px;font-size:1.05rem">${calc.icon}</span>
          <h1 class="page-title" style="font-size:1.2rem">${calc.name}</h1>
        </div>
        <p class="page-sub">${calc.desc}</p>
      </div>
      <span class="badge-status badge-ready">✓ 可用</span>
    </div>

    <div class="calc-single">
      <div class="calc-col">
        <!-- 1 输入 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>📋 输入</div>
          <div class="field-grid2" style="margin-bottom:12px">
            <div class="field"><label class="field-label">🔩 材质牌号</label><div class="f-row"><select class="field-select" id="c_mat">${gradeOpts}</select></div></div>
            <div class="field"><label class="field-label">⚖️ 铁液总重</label><div class="f-row"><input class="field-input" type="number" id="c_wt" value="1000" step="100" min="10"><span class="f-unit">Kg</span></div><div class="field-hint" style="margin-top:2px">= 出炉目标铁液量：炉料按此 % 配料、合金/处理剂另按 kg 加（实投略高 = 炉损）；成分按占出炉铁液 % 计</div></div>
          </div>

          <div class="divider"></div>
          <div class="group-title">🔩 金属炉料 <small>填比例%自动算重量 · 可改吸收率</small></div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">🧱 生铁</label>
            <div class="f-row"><select class="field-select" id="c_pig" style="flex:1.4">${matOpts(['pigZ14', 'pigZ18', 'pigZ22', 'pigZ26', 'pigQ10', 'pigQ12'])}</select>
              <input class="field-input" type="number" id="c_pigPct" step="1" min="0" max="100" style="width:70px"><span class="f-unit">%</span>
              <input class="field-input" type="number" id="c_pigAbs" step="1" min="0" max="100" style="width:56px" title="吸收率"><span class="f-unit">吸收%</span>
              <span class="f-unit" id="c_pigKg" style="width:70px"></span></div>
            <div id="c_pigCustom" style="display:none;margin-top:6px">
              <div class="f-row" style="gap:6px">
                ${['c_pigC', 'c_pigSi', 'c_pigMn', 'c_pigP', 'c_pigS'].map((id, i) => `<span class="field-hint">${['C', 'Si', 'Mn', 'P', 'S'][i]}%</span><input class="field-input" type="number" id="${id}" step="0.1" min="0" style="width:64px"><span style="width:6px"></span>`).join('')}
              </div>
            </div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">🪙 废钢</label>
            <div class="f-row"><select class="field-select" id="c_scrap" style="flex:1.4">${matOpts(['scrapC', 'scrapD'])}</select>
              <input class="field-input" type="number" id="c_scrapPct" step="1" min="0" max="100" style="width:70px"><span class="f-unit">%</span>
              <input class="field-input" type="number" id="c_scrapAbs" step="1" min="0" max="100" style="width:56px"><span class="f-unit">吸收%</span>
              <span class="f-unit" id="c_scrapKg" style="width:70px"></span></div>
            <div id="c_scrapCustom" style="display:none;margin-top:6px">
              <div class="f-row" style="gap:6px">
                ${['c_scrapC', 'c_scrapSi', 'c_scrapMn', 'c_scrapP', 'c_scrapS'].map((id, i) => `<span class="field-hint">${['C', 'Si', 'Mn', 'P', 'S'][i]}%</span><input class="field-input" type="number" id="${id}" step="0.1" min="0" style="width:64px"><span style="width:6px"></span>`).join('')}
              </div>
            </div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">🔁 回炉料（本厂）</label>
            <div class="f-row"><input class="field-input" type="number" id="c_retPct" step="1" min="0" max="100" style="flex:1.4"><span class="f-unit">%</span>
              <input class="field-input" type="number" id="c_retAbs" step="1" min="0" max="100" style="width:56px"><span class="f-unit">吸收%</span>
              <span class="f-unit" id="c_retKg" style="width:70px"></span></div>
          </div>
          <div class="field-hint" id="c_pctSum" style="margin:2px 0 0"></div>

          <div class="divider"></div>
          <div class="group-title">🧪 合金与增碳 <small>kg 输入 · 建议可一键应用</small></div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">⬛ 增碳剂</label>
            <div class="f-row"><select class="field-select" id="c_carb" style="flex:1.2">${matOpts(['carb95', 'carb98'])}</select>
              <input class="field-input" type="number" id="c_carbKg" step="0.5" min="0" style="width:76px"><span class="f-unit">Kg</span>
              <input class="field-input" type="number" id="c_carbAbs" step="1" min="0" max="100" style="width:56px"><span class="f-unit">吸收%</span></div>
            <div id="c_carbCustom" style="display:none;margin-top:6px"><div class="f-row" style="gap:6px"><span class="field-hint">C%</span><input class="field-input" type="number" id="c_carbC" step="0.5" min="0" style="width:64px"></div></div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">🔹 硅铁</label>
            <div class="f-row"><select class="field-select" id="c_feSi" style="flex:1.2">${matOpts(['feSi75', 'feSi72'])}</select>
              <input class="field-input" type="number" id="c_feSiKg" step="0.5" min="0" style="width:76px"><span class="f-unit">Kg</span>
              <input class="field-input" type="number" id="c_feSiAbs" step="1" min="0" max="100" style="width:56px"><span class="f-unit">吸收%</span></div>
            <div id="c_feSiCustom" style="display:none;margin-top:6px"><div class="f-row" style="gap:6px"><span class="field-hint">Si%</span><input class="field-input" type="number" id="c_feSiSi" step="0.5" min="0" style="width:64px"></div></div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">🟤 锰铁</label>
            <div class="f-row"><select class="field-select" id="c_feMn" style="flex:1.2">${matOpts(['feMn65', 'feMn78'])}</select>
              <input class="field-input" type="number" id="c_feMnKg" step="0.5" min="0" style="width:76px"><span class="f-unit">Kg</span>
              <input class="field-input" type="number" id="c_feMnAbs" step="1" min="0" max="100" style="width:56px"><span class="f-unit">吸收%</span></div>
            <div id="c_feMnCustom" style="display:none;margin-top:6px"><div class="f-row" style="gap:6px"><span class="field-hint">Mn%</span><input class="field-input" type="number" id="c_feMnMn" step="0.5" min="0" style="width:64px"></div></div>
          </div>

          <div id="c_addons" style="display:none">
            <div class="divider"></div>
            <div class="group-title">⚗️ 球化与孕育 <small>球化多/少可改 · 计入成铁成分</small></div>
            <div class="field" style="margin-bottom:8px">
              <label class="field-label">✨ 球化剂</label>
              <div class="f-row"><select class="field-select" id="c_sphero" style="flex:1.2">${typeOpts(SPHERO_TYPES)}</select>
                <input class="field-input" type="number" id="c_spheroKg" step="0.5" min="0" style="width:76px"><span class="f-unit">Kg</span>
                <span class="f-unit" id="c_spheroPct" style="width:56px"></span></div>
              <div class="f-row" style="margin-top:5px"><span class="field-hint">Mg吸收</span><input class="field-input" type="number" id="c_spheroMgAbs" step="1" min="0" max="100" style="width:52px"><span class="f-unit">%</span><span class="field-hint" style="margin-left:8px">RE吸收</span><input class="field-input" type="number" id="c_spheroReAbs" step="1" min="0" max="100" style="width:52px"><span class="f-unit">%</span><span class="field-hint" style="margin-left:8px">Si吸收</span><input class="field-input" type="number" id="c_spheroSiAbs" step="1" min="0" max="100" style="width:52px"><span class="f-unit">%</span></div>
              <div id="c_spheroCustom" style="display:none;margin-top:6px"><div class="f-row" style="gap:6px">${['c_spheroMg', 'c_spheroRe', 'c_spheroSi'].map((id, i) => `<span class="field-hint">${['Mg', 'RE', 'Si'][i]}%</span><input class="field-input" type="number" id="${id}" step="0.1" min="0" style="width:64px"><span style="width:6px"></span>`).join('')}</div></div>
            </div>
            <div class="field">
              <label class="field-label">🌱 孕育剂</label>
              <div class="f-row"><select class="field-select" id="c_inoc" style="flex:1.2">${typeOpts(INOC_TYPES)}</select>
                <input class="field-input" type="number" id="c_inocKg" step="0.5" min="0" style="width:76px"><span class="f-unit">Kg</span></div>
              <div class="f-row" style="margin-top:5px"><span class="field-hint">Si吸收</span><input class="field-input" type="number" id="c_inocSiAbs" step="1" min="0" max="100" style="width:52px"><span class="f-unit">%</span></div>
              <div id="c_inocCustom" style="display:none;margin-top:6px"><div class="f-row" style="gap:6px"><span class="field-hint">Si%</span><input class="field-input" type="number" id="c_inocSi" step="0.5" min="0" style="width:64px"></div></div>
            </div>
          </div>
        </div>

        <!-- 2 结果 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 成分平衡 <small>目标=原铁液目标 · 差额=目标−计算（正=缺）</small></div>
          <div class="results" id="c_results"><div class="empty" style="padding:20px"><span class="empty-sub">填写参数后自动计算…</span></div></div>
        </div>

        <!-- 3 说明 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 说明与依据</div>
          <div class="field-hint" style="line-height:1.8" id="c_source"></div>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="c_modal" hidden>
      <div class="modal">
        <div class="modal-head"><div class="modal-title">📄 熔炼加料配方记录</div><button class="modal-close" data-close>&times;</button></div>
        <div class="report-body" id="c_reportBody"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="c_reportCopy" style="flex:1">📋 复制文本</button>
          <button class="btn btn-primary" id="c_reportDl" style="flex:1">⬇️ 下载报告</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });

  const q = (id) => container.querySelector(id);
  const ELEM_NAMES = { C: '碳 C', Si: '硅 Si', Mn: '锰 Mn', P: '磷 P', S: '硫 S' };
  let lastResult = null;

  /* ---- 自定义成分解析 ---- */
  const rowContent = (selectId, customIds) => {
    const key = q(selectId).value;
    if (key === CUSTOM) {
      const c = {};
      for (const [id, el] of customIds) { const v = parseFloat(q(id).value); if (!isNaN(v)) c[el] = v; }
      return { content: c, abs: 0.85 };
    }
    return { content: CHARGE_MATERIALS[key], abs: CHARGE_MATERIALS[key].abs };
  };
  const spheroContent = () => {
    const key = q('#c_sphero').value;
    if (key === CUSTOM) {
      return { content: {
        Mg: parseFloat(q('#c_spheroMg').value) || 0,
        RE: parseFloat(q('#c_spheroRe').value) || 0,
        Si: parseFloat(q('#c_spheroSi').value) || 0,
      }, absMg: pct('#c_spheroMgAbs'), absRE: pct('#c_spheroReAbs'), absSi: pct('#c_spheroSiAbs') };
    }
    const t = SPHERO_TYPES[key];
    return { content: t, absMg: pct('#c_spheroMgAbs'), absRE: pct('#c_spheroReAbs'), absSi: pct('#c_spheroSiAbs') };
  };
  const inocContent = () => {
    const key = q('#c_inoc').value;
    if (key === CUSTOM) return { content: { Si: parseFloat(q('#c_inocSi').value) || 0 }, absSi: pct('#c_inocSiAbs') };
    return { content: INOC_TYPES[key], absSi: pct('#c_inocSiAbs') };
  };

  const pct = (id) => (parseFloat(q(id).value) || 0) / 100;

  /* ---- 读取输入（合金建议标签用当前规格名） ---- */
  // PHASE 63 P1-5：增碳剂/硅铁/锰铁吸收率改读输入框（原 read() 用静态默认 → dead input）；
  //   默认值仍由 loadDefaults 按 CHARGE_MATERIALS/CHARGE_RET_ABS 写入输入框（初始值合法来源）
  const read = () => {
    const wt = parseNum(q('#c_wt').value);
    const pig = rowContent('#c_pig', [['#c_pigC', 'C'], ['#c_pigSi', 'Si'], ['#c_pigMn', 'Mn'], ['#c_pigP', 'P'], ['#c_pigS', 'S']]);
    const scrap = rowContent('#c_scrap', [['#c_scrapC', 'C'], ['#c_scrapSi', 'Si'], ['#c_scrapMn', 'Mn'], ['#c_scrapP', 'P'], ['#c_scrapS', 'S']]);
    const carb = rowContent('#c_carb', [['#c_carbC', 'C']]);
    const feSi = rowContent('#c_feSi', [['#c_feSiSi', 'Si']]);
    const feMn = rowContent('#c_feMn', [['#c_feMnMn', 'Mn']]);
    return {
      grade: q('#c_mat').value, totalWt: wt,
      pig: { content: pig.content, kg: wt * pct('#c_pigPct'), abs: pct('#c_pigAbs') },
      scrap: { content: scrap.content, kg: wt * pct('#c_scrapPct'), abs: pct('#c_scrapAbs') },
      ret: { content: returnComposition(q('#c_mat').value), kg: wt * pct('#c_retPct'), abs: pct('#c_retAbs') },
      carb: { content: carb.content, kg: parseFloat(q('#c_carbKg').value) || 0, abs: pct('#c_carbAbs'), label: carbLabel(), key: 'carb' },
      feSi: { content: feSi.content, kg: parseFloat(q('#c_feSiKg').value) || 0, abs: pct('#c_feSiAbs'), label: feSiLabel(), key: 'feSi' },
      feMn: { content: feMn.content, kg: parseFloat(q('#c_feMnKg').value) || 0, abs: pct('#c_feMnAbs'), label: feMnLabel(), key: 'feMn' },
      sphero: spheroContent(), inoc: inocContent(),
    };
  };
  const labelOf = (sel, map) => { const k = q(sel).value; return k === CUSTOM ? '自定义' : CHARGE_MATERIALS[k].label; };
  const carbLabel = () => labelOf('#c_carb');
  const feSiLabel = () => labelOf('#c_feSi');
  const feMnLabel = () => labelOf('#c_feMn');

  /* ---- 装填默认配比 ---- */
  const setAbs = (id, v) => { q(id).value = fmt(v * 100, 0); };
  const loadDefaults = (grade, wt) => {
    const d = defaultCharge(grade, wt);
    q('#c_pig').value = d.pigKey; q('#c_pigPct').value = d.pigPct;
    q('#c_scrap').value = d.scrapKey; q('#c_scrapPct').value = d.scrapPct;
    q('#c_retPct').value = d.retPct;
    q('#c_carb').value = d.carbKey; q('#c_carbKg').value = d.carb;
    q('#c_feSi').value = d.feSiKey; q('#c_feSiKg').value = d.feSi;
    q('#c_feMn').value = d.feMnKey; q('#c_feMnKg').value = d.feMn;
    setAbs('#c_pigAbs', CHARGE_MATERIALS[d.pigKey].abs);
    setAbs('#c_scrapAbs', CHARGE_MATERIALS[d.scrapKey].abs);
    setAbs('#c_retAbs', CHARGE_RET_ABS);   // 本厂熟料少烧损，默认高于生铁/废钢（数据层 CHARGE_RET_ABS）
    setAbs('#c_carbAbs', CHARGE_MATERIALS[d.carbKey].abs);
    setAbs('#c_feSiAbs', CHARGE_MATERIALS[d.feSiKey].abs);
    setAbs('#c_feMnAbs', CHARGE_MATERIALS[d.feMnKey].abs);
    const hasAddons = !!(CHARGE_TARGETS[grade] && CHARGE_TARGETS[grade].addons);
    q('#c_addons').style.display = hasAddons ? 'block' : 'none';
    if (hasAddons) {
      q('#c_sphero').value = d.spheroKey; q('#c_spheroKg').value = d.sphero;
      q('#c_inoc').value = d.inocKey; q('#c_inocKg').value = d.inoc;
      setAbs('#c_spheroMgAbs', 45); setAbs('#c_spheroReAbs', 55); setAbs('#c_spheroSiAbs', 80);
      setAbs('#c_inocSiAbs', 85);
    }
    syncCustom();
    syncKg();
  };

  const syncKg = () => {
    const wt = parseFloat(q('#c_wt').value) || 0;
    q('#c_pigKg').textContent = '= ' + fmt(wt * pct('#c_pigPct'), 1) + ' kg';
    q('#c_scrapKg').textContent = '= ' + fmt(wt * pct('#c_scrapPct'), 1) + ' kg';
    q('#c_retKg').textContent = '= ' + fmt(wt * pct('#c_retPct'), 1) + ' kg';
    const sum = pct('#c_pigPct') + pct('#c_scrapPct') + pct('#c_retPct');
    const sumPct = Math.round(sum * 100);
    q('#c_pctSum').textContent = `金属炉料合计 ${sumPct}%（金属炉料应≈100%；实投另加合金/处理剂 kg，故总投料略高于铁液总重）`;
    if (q('#c_addons').style.display !== 'none' && CHARGE_TARGETS[q('#c_mat').value]?.addons) {
      q('#c_spheroPct').textContent = `= ${fmt((parseFloat(q('#c_spheroKg').value) || 0) / wt * 100, 2)}%`;
    }
  };

  // 各料"自定义"打开时，预填一个靠谱参考（取自该料当前所选/默认牌号成分，用户可改）
  const CUSTOM_PREFILL = {
    'c_pigCustom':   { select: 'c_pig',   fields: { c_pigC: 'C', c_pigSi: 'Si', c_pigMn: 'Mn', c_pigP: 'P', c_pigS: 'S' }, ref: 'pigZ22' },
    'c_scrapCustom': { select: 'c_scrap', fields: { c_scrapC: 'C', c_scrapSi: 'Si', c_scrapMn: 'Mn', c_scrapP: 'P', c_scrapS: 'S' }, ref: 'scrapC' },
    'c_carbCustom':  { select: 'c_carb',  fields: { c_carbC: 'C' }, ref: 'carb95' },
    'c_feSiCustom':  { select: 'c_feSi',  fields: { c_feSiSi: 'Si' }, ref: 'feSi75' },
    'c_feMnCustom':  { select: 'c_feMn',  fields: { c_feMnMn: 'Mn' }, ref: 'feMn65' },
    'c_spheroCustom':{ select: 'c_sphero',fields: { c_spheroMg: 'Mg', c_spheroRe: 'RE', c_spheroSi: 'Si' }, ref: '稀土镁 Mg5.5' },
    'c_inocCustom':  { select: 'c_inoc',  fields: { c_inocSi: 'Si' }, ref: '75硅铁' },
  };
  const prefillCustom = (panelId) => {
    const cfg = CUSTOM_PREFILL[panelId];
    if (!cfg) return;
    const cur = q('#' + cfg.select).value;
    let src = null;
    if (cur !== CUSTOM) {                 // 刚切到自定义前选中的料 → 以其为参考
      src = CHARGE_MATERIALS[cur] || (cfg.select === 'c_sphero' ? SPHERO_TYPES[cur] : cfg.select === 'c_inoc' ? INOC_TYPES[cur] : null);
    } else {
      src = CHARGE_MATERIALS[cfg.ref] || SPHERO_TYPES[cfg.ref] || INOC_TYPES[cfg.ref] || null;
    }
    if (!src) return;
    for (const [inputId, el] of Object.entries(cfg.fields)) {
      const v = src[el];
      if (typeof v === 'number' && !isNaN(v)) q('#' + inputId).value = v;
    }
  };
  const syncCustom = () => {
    const panels = [
      ['c_pig', 'c_pigCustom'], ['c_scrap', 'c_scrapCustom'],
      ['c_carb', 'c_carbCustom'], ['c_feSi', 'c_feSiCustom'], ['c_feMn', 'c_feMnCustom'],
      ['c_sphero', 'c_spheroCustom'], ['c_inoc', 'c_inocCustom'],
    ];
    for (const [sel, panel] of panels) {
      if (q('#' + sel).value === CUSTOM) {
        q('#' + panel).style.display = 'block';
        prefillCustom(panel);   // 打开自定义时预填参考值
      } else {
        q('#' + panel).style.display = 'none';
      }
    }
  };

  /* ---- 渲染结果 ---- */
  const renderResults = (r) => {
    lastResult = r;
    const diffCls = (d) => (d > 0.05 ? 'bad' : d < -0.05 ? 'warn' : 'ok');
    const diffTxt = (d) => (d > 0 ? '+' + fmt(d, 2) : fmt(d, 2));
    const elemsRows = r.elems.map(e =>
      row(`🔤 ${ELEM_NAMES[e.el]}`, `${fmt(e.target, 2)}%`, '',
        diffCls(e.diff),
        `计算 ${fmt(e.base, 2)}% · 差额 ${diffTxt(e.diff)}%`)).join('');
    // CE 行（61 核查口径）：灰铁=原铁液=成铁；球铁区间按成铁（含处理带入 Si）口径对照；
    // 实算超出声明区间 ±0.05 时给警示行（数值不自洽不自动改，交人工核对）
    const ceRngM = String(CHARGE_TARGETS[r.grade].CE || '').match(/([\d.]+)\s*~\s*([\d.]+)/);
    const isQT = r.grade.startsWith('QT');
    const ceFinal = (r.final.C || 0) + 0.33 * ((r.final.Si || 0) + (r.final.P || 0));
    const ceBad = ceRngM && (ceFinal < parseFloat(ceRngM[1]) - 0.05 || ceFinal > parseFloat(ceRngM[2]) + 0.05);
    const ceRows = row('🌡️ 碳当量 CE', fmt(ceFinal, 2), '', ceBad ? 'warn' : 'ok',
      ceBad
        ? `实算 ${fmt(ceFinal, 2)}${isQT ? '（成铁口径；原铁液 ' + fmt(r.baseCE, 2) + '）' : ''} 与声明区间 ${CHARGE_TARGETS[r.grade].CE} 不自洽——数值未自动修改，请人工核对企业牌号目标或区间口径 · CE = C + 0.33(Si+P)`
        : `目标 ${CHARGE_TARGETS[r.grade].CE}${isQT ? `（成铁口径；原铁液 ${fmt(r.baseCE, 2)}，处理带入 Si 后约 ${fmt(ceFinal, 2)}）` : '（灰铁：原铁液 = 成铁）'} · CE = C + 0.33(Si+P)`);
    const finalRows = r.grade.startsWith('QT')
      ? row('🏁 成铁成分预估', '', '', '',
          `C ${fmt(r.final.C, 2)} · Si ${fmt(r.final.Si, 2)} · Mn ${fmt(r.final.Mn, 2)} · Mg ${fmt(r.final.Mg, 3)} · RE ${fmt(r.final.RE, 3)}%`)
      : '';

    // P/S 无常规补料手段，超差时单独提示（不让"✅ 无需补料"掩盖）
    const psBad = r.elems.filter(e => e.el === 'P' || e.el === 'S').filter(e => Math.abs(e.diff) > 0.05)
      .map(e => `${e.el} ${fmt(e.base, 3)}%（目标 ${e.target}%，差 ${e.diff > 0 ? '+' : ''}${fmt(e.diff, 3)}）`).join(' · ');
    const psNote = psBad
      ? `<div class="field-hint" style="padding:6px 4px 0;color:var(--warning,#B45309)">⚠️ P/S 超差（${psBad}）：无常规补料手段——靠炉料选择（低 P/S 料）与脱硫等炉前处理控制，不在 C/Si/Mn 平衡范围</div>`
      : '';
    const sugs = r.sugs.length
      ? r.sugs.map(s => `
          <div class="rrow ok" style="align-items:center">
            <span class="rl">💡 建议补 ${s.label}</span>
            <span class="rv">${fmt(s.kg, 1)} Kg<button class="btn btn-ghost btn-sm" data-apply="${s.key}" style="margin-left:8px;padding:2px 10px;font-size:.75rem">应用</button></span></div>`).join('') + psNote
      : psNote || `<div class="field-hint" style="padding:6px 4px 0">✅ C/Si/Mn 均在目标（±0.05%）内，无需补料</div>`;

    q('#c_results').innerHTML = `
      ${ex.exampleNote()}
      ${row('🧭 目标基准', CHARGE_TARGETS[r.grade].addons ? '原铁液目标（已扣球化/孕育硅）' : '目标成分', '', '')}
      ${elemsRows}
      ${ceRows}
      ${finalRows}
      <div class="divider" style="margin:10px 0"></div>
      <div class="group-title">💡 补料建议</div>
      ${sugs}
      <div class="field-hint" style="padding:8px 4px 0">${r.note}<br>建议量 = 差额% × 铁液总重 ÷（合金含量 × 吸收率）。</div>`;
  };

  const ex = installExampleTags(container, ['c_wt']);   // 铁液总重 1000kg 为示例默认值
  // PHASE 63 P0-1：非法输入门禁 —— 不再静默回退 1000/默认吸收率
  const validateInputs = () => {
    const checks = [
      checkNum(q('#c_wt').value, { label: '铁液总重', gt: 0, required: true }),
      checkNum(q('#c_pigPct').value, { label: '生铁比例', min: 0, max: 100 }),
      checkNum(q('#c_scrapPct').value, { label: '废钢比例', min: 0, max: 100 }),
      checkNum(q('#c_retPct').value, { label: '回炉料比例', min: 0, max: 100 }),
      checkNum(q('#c_carbAbs').value, { label: '增碳剂吸收率', gt: 0, max: 100, required: true }),
      checkNum(q('#c_feSiAbs').value, { label: '硅铁吸收率', gt: 0, max: 100, required: true }),
      checkNum(q('#c_feMnAbs').value, { label: '锰铁吸收率', gt: 0, max: 100, required: true }),
    ];
    if (q('#c_addons').style.display !== 'none') {
      checks.push(
        checkNum(q('#c_spheroMgAbs').value, { label: '球化剂 Mg 吸收率', gt: 0, max: 100, required: true }),
        checkNum(q('#c_spheroReAbs').value, { label: '球化剂 RE 吸收率', gt: 0, max: 100, required: true }),
        checkNum(q('#c_spheroSiAbs').value, { label: '球化剂 Si 吸收率', gt: 0, max: 100, required: true }),
        checkNum(q('#c_inocSiAbs').value, { label: '孕育剂 Si 吸收率', gt: 0, max: 100, required: true }));
    }
    const main = firstErr(checks);
    if (main) return main;   // 先报显式主字段（如铁液总重），再查其余
    // 其余数值输入（合金 kg / 自定义成分等）：非空须为 ≥0 有效数字
    const rowLabel = (el) => {
      const f = el.closest('.field');
      const l = f && f.querySelector('.field-label');
      return (l ? l.textContent.replace(/<[^>]*>/g, '').trim() : '输入').slice(0, 16) || '输入';
    };
    for (const el of container.querySelectorAll('.section-card input[type=number]')) {
      const v = String(el.value).trim();
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return `「${rowLabel(el)}」 需为非负有效数字（当前 ${v}）`;
    }
    return null;
  };
  const update = () => {
    const err = validateInputs();
    if (err) { q('#c_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    const input = read();
    if (!CHARGE_TARGETS[input.grade]) { q('#c_results').innerHTML = '<div class="empty" style="padding:20px"><span class="empty-sub">请设置材质牌号</span></div>'; return; }
    syncKg();
    renderResults(runCharge(input));
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 160); };

  /* ---- 事件 ---- */
  q('#c_mat').addEventListener('change', () => { loadDefaults(q('#c_mat').value, parseFloat(q('#c_wt').value) || 1000); update(); });
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => {
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => { syncCustom(); debounced(); });
    } else {
      el.addEventListener('input', debounced);
    }
  });
  q('#c_results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-apply]');
    if (!btn) return;
    // 建议项 key 由视图 read() 传入（feSi/feMn/carb），映射必须与其一致 —— 应用按钮写回对应 kg 输入
    const map = { feSi: '#c_feSiKg', feMn: '#c_feMnKg', carb: '#c_carbKg' };
    q(map[btn.dataset.apply]).value = lastResult.sugs.find(s => s.key === btn.dataset.apply).kg;
    update();
  });

  /* ---- 报告弹窗 ---- */
  function buildReportHtml() {
    if (!lastResult) return '';
    const r = lastResult;
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const t = (label, val) => `<tr><td style="width:38%">${label}</td><td>${val}</td></tr>`;
    const inr = read();
    const labelOf2 = (sel) => { const k = q(sel).value; return k === CUSTOM ? '自定义' : CHARGE_MATERIALS[k].label; };
    return `
      <h2>⚖️ 熔炼加料配方记录</h2>
      <p class="meta">生成时间：${now} · ${r.grade}（${CHARGE_TARGETS[r.grade].addons ? '球铁' : '灰铁'}）· 铁液总重 ${r.totalWt} Kg</p>
      <h3>一、炉料配比</h3>
      <table>${t('生铁', `${labelOf2('#c_pig')} ${fmt(inr.pig.kg, 1)} Kg（${Math.round(pct('#c_pigPct') * 100)}%）`)}${t('废钢', `${labelOf2('#c_scrap')} ${fmt(inr.scrap.kg, 1)} Kg（${Math.round(pct('#c_scrapPct') * 100)}%）`)}${t('回炉料', `${fmt(inr.ret.kg, 1)} Kg（${Math.round(pct('#c_retPct') * 100)}%）`)}${t('增碳剂', `${labelOf2('#c_carb')} ${inr.carb.kg} Kg`)}${t('硅铁', `${labelOf2('#c_feSi')} ${inr.feSi.kg} Kg`)}${t('锰铁', `${labelOf2('#c_feMn')} ${inr.feMn.kg} Kg`)}${inr.sphero?.kg ? t('球化剂', `${q('#c_sphero').value} ${inr.sphero.kg} Kg`) : ''}${inr.inoc?.kg ? t('孕育剂', `${q('#c_inoc').value} ${inr.inoc.kg} Kg`) : ''}</table>
      <h3>二、成分平衡</h3>
      <table>${r.elems.map(e => t(`${ELEM_NAMES[e.el]}`, `目标 ${e.target}% · 计算 ${e.base.toFixed(2)}% · 差额 ${e.diff > 0 ? '+' : ''}${e.diff}%`)).join('')}${t('碳当量 CE', `计算 ${r.baseCE.toFixed(2)}（目标 ${CHARGE_TARGETS[r.grade].CE}）`)}${r.grade.startsWith('QT') ? t('成铁预估', `C ${r.final.C.toFixed(2)} · Si ${r.final.Si.toFixed(2)} · Mn ${r.final.Mn.toFixed(2)} · Mg ${r.final.Mg.toFixed(3)} · RE ${r.final.RE.toFixed(3)}`) : ''}</table>
      <h3>三、补料建议</h3>
      <p>${r.sugs.length ? r.sugs.map(s => `建议补 ${s.label} ${s.kg} Kg`).join('；') : 'C/Si/Mn 均在目标内'}</p>
      <h3>四、依据</h3>
      <p style="font-size:.8rem">吸收率主源《铸造工程师手册 第3版》表3-316（无芯感应炉）；目标成分摘自知识库材质卡，球铁原铁液已扣球化/孕育硅。吸收率默认值请按本厂实测修正。</p>`;
  }
  const openReport = () => {
    if (!lastResult) { showToast('请先完成计算'); return; }
    q('#c_reportBody').innerHTML = buildReportHtml();
    q('#c_modal').hidden = false;
  };
  const closeReport = () => { q('#c_modal').hidden = true; };
  const reportBtn = document.createElement('button');
  reportBtn.className = 'btn btn-primary';
  reportBtn.id = 'c_reportBtn';
  reportBtn.style.cssText = 'width:100%;margin-top:14px';
  reportBtn.textContent = '📄 生成配方记录';
  q('#c_results').parentElement.appendChild(reportBtn);
  reportBtn.addEventListener('click', openReport);
  q('[data-close]').addEventListener('click', closeReport);
  q('#c_modal').addEventListener('click', (e) => { if (e.target === q('#c_modal')) closeReport(); });
  q('#c_reportDl').addEventListener('click', () => {
    saveFile(`加料配方_${lastResult.grade}_${Date.now()}.html`, `<html><head><meta charset="utf-8"><title>加料配方记录</title><style>body{font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}th{background:#f3f4f6}td:first-child{width:38%;color:#6b7280}td:last-child{font-weight:600}</style></head><body>${buildReportHtml()}</body></html>`);
  });
  q('#c_reportCopy').addEventListener('click', () => {
    const plain = buildReportHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    navigator.clipboard?.writeText(plain).then(() => showToast('已复制报告文本'), () => showToast('复制失败'));
  });

  /* ---- 初始化 ---- */
  const initGrade = q('#c_mat').value;
  loadDefaults(initGrade, parseFloat(q('#c_wt').value) || 1000);
  prefillMaterial(container, '#c_mat');
  if (q('#c_mat').value !== initGrade) loadDefaults(q('#c_mat').value, parseFloat(q('#c_wt').value) || 1000);
  q('#c_source').innerHTML = `
    · <b>比例输入</b>：生铁/废钢/回炉料按占铁液总重的<b>百分比</b>输入，重量自动算出；合金按 kg 手输。<br>
    · <b>「铁液总重」= 目标出炉铁液量</b>（本工具口径，方案A）：成分均按「占出炉铁液 %」计算（与炉前取样同一口径）；金属炉料合计应≈100%，合金/增碳剂/球化/孕育剂再按 kg 加入——<b>实投总料略高于出炉量，差额为熔炼损耗</b>（烧损/渣损/挥发），故无"实投=出炉"的精确闭合，属炉前实用近似。<br>
    · <b>自定义</b>：生铁/废钢/合金/球化剂都可选「✏️ 自定义…」填本厂成分（每个厂都有自己的炉料）。<br>
    · <b>碳当量 CE</b> = C + 0.33(Si+P)，炉前快速判定灰铁/球铁成分倾向；灰铁区间按成铁、球铁区间按成铁（含处理带入硅）口径对照。<br>
    · <b>吸收率</b>默认值来自《铸造工程师手册 第3版》表3-316（中频炉取中值，工程经验参数），可改成本厂实测；回炉料默认 0.95（本厂熟料少烧损）；球化剂 Mg/RE/Si 与孕育 Si 收得率（45/55/80/85%）为冲入法典型经验值（喂丝法 Mg 吸收可至 60%）。<br>
    · 球铁：原铁液目标已扣除默认球化剂 1.3% + 孕育剂 0.6% 带入的硅；球化剂加入量按本厂实际调。<br>
    · 差额 = 目标 − 计算（正=缺，负=超）；建议量 = 差额% × 总重 ÷（合金含量 × 吸收率）；P/S 无常规补料手段，超差时单独警示。
  `;
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
