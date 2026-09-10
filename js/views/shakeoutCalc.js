// ============================================================
// 开箱（打箱）时间计算 · 视图
// 输入产品参数 → 型内冷却时间 + 开箱温度目标 + 风险提示
// ============================================================
import { SHAKE_MATS, SHAKE_TEMP, SHAKE_RISKS, COOL_SMALL, COOL_LARGE } from '../../data/shakeout_calc.js';
import { runShakeout } from '../../calcs/shakeout.js';
import { prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { saveFile } from '../download.js';
import { checkNum, firstErr, parseNum } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';

const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));

export function renderShakeout(container, calc) {
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
          <div class="field" style="margin-bottom:12px">
            <label class="field-label">🔩 材质</label>
            <div class="f-row"><select class="field-select" id="so_mat">${SHAKE_MATS.map(k => `<option>${k}</option>`).join('')}</select></div>
          </div>
          <div class="field-grid2" style="margin-bottom:12px">
            <div class="field"><label class="field-label">⚖️ 铸件重量</label><div class="f-row"><input class="field-input" type="number" id="so_wt" value="50" step="0.5" min="0"><span class="f-unit">Kg</span></div></div>
            <div class="field"><label class="field-label">📐 壁厚</label><div class="f-row"><input class="field-input" type="number" id="so_wall" value="20" step="1" min="0"><span class="f-unit">mm</span></div></div>
          </div>
          <div class="field-grid3" style="margin-bottom:12px">
            <div class="field"><label class="field-label">🏭 造型方式</label><div class="f-row"><select class="field-select" id="so_mode"><option>流水线</option><option selected>地面</option></select></div></div>
            <div class="field"><label class="field-label">⚠️ 铸件风险</label><div class="f-row"><select class="field-select" id="so_risk">${SHAKE_RISKS.map(k => `<option>${k}</option>`).join('')}</select></div><div class="field-hint" style="margin-top:2px">冷裂/变形敏感：低温开箱+缓冷；热裂敏感：仅铜合金给红热打箱特例（见说明）</div></div>
            <div class="field"><label class="field-label">⭐ 铸件重要性</label><div class="f-row"><select class="field-select" id="so_imp"><option>一般</option><option>重要</option></select></div></div>
          </div>
          <div class="field-grid2">
            <div class="field"><label class="field-label">♨️ 开箱后做热时效？ <span class="field-hint" style="display:inline" title="热时效 = 开箱后的去应力退火（如灰铁 500~550℃）。做热时效就不怕开箱残存内应力，开箱温度可放宽、冷却时间可缩短。详见下方说明。">什么是热时效？</span></label><div class="f-row"><select class="field-select" id="so_ht"><option>否</option><option>是</option></select></div></div>
            <div class="field"><label class="field-label">🌡️ 开箱温度目标 <span class="field-hint" style="display:inline" title="默认按「材质 × 是否热时效 × 重要性」给出，可改成本厂规定值；更严目标会提示延长冷却。">（可改）</span></label><div class="f-row"><input class="field-input" type="number" id="so_target" step="10" min="0"><span class="f-unit">℃</span></div></div>
          </div>
        </div>

        <!-- 2 结果 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 结果</div>
          <div class="results" id="so_results"><div class="empty" style="padding:20px"><span class="empty-sub">填写参数后自动计算…</span></div></div>
          <button class="btn btn-primary" id="so_reportBtn" style="width:100%;margin-top:14px">📄 生成计算记录</button>
        </div>

        <!-- 3 依据 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 依据与说明</div>
          <div class="field-hint" style="line-height:1.8">
            · <b>中小件冷却时间表</b>（重量 × 壁厚 → 型内冷却时间）——《实用铸造手册》：<br>
            <table class="calc-table">
              <tr><th>重量 kg</th>${COOL_SMALL.map(s => `<td>&lt;${s.wMax}</td>`).join('')}</tr>
              <tr><th>壁厚 mm</th>${COOL_SMALL.map(s => `<td>&lt;${s.tMax}</td>`).join('')}</tr>
              <tr><th>时间 min</th>${COOL_SMALL.map(s => `<td>${s.min}~${s.max}</td>`).join('')}</tr>
            </table>
            · <b>大型铸件</b>（≥1t，1~100t）：型内冷却 10~270 h 经验表。<b>冷却表均为铸铁件经验值</b>（《实用铸造手册》）：<br>铸钢件导热慢于铸铁、同重件常需更长时间（≥1t 建议热电偶实测校核）；铝/铜散热快、实际时间常短于铸铁表。<br>
            · <b>「热时效」是什么意思</b>：热时效 = 铸件开箱后的<b>去应力退火</b>（如灰铁 500~550℃）。因为铸件开箱后马上要进炉做退火，<b>就不怕开箱时残存内应力</b>，开箱温度可以放宽（如灰铁 200→300℃），冷却时间可缩短；<b>不做热时效</b>则必须低温开箱防内应力/白口。这一步影响开箱温度目标，故保留。<br>
            · <b>开箱温度</b>（不热时效 / 热时效）：${SHAKE_MATS.map(m => `${m} ${SHAKE_TEMP[m].noHT}/${SHAKE_TEMP[m].withHT}℃`).join('；')}；重要件 250℃ 封顶。<br>
            · <b>风险两类（61 拆分，按文献：无"普通易裂件 800~900℃ 打箱"通用做法）</b>：<br>
            &nbsp;&nbsp;· <b>冷裂/变形敏感</b>（壁厚差大/刚性结构/薄大平板等）：冷裂发生在冷却进入弹性状态（铸钢约 620~650℃ 以下）之后，靠<b>低温开箱 + 缓冷</b>防应力累积 → 按材质低温目标 + ×1.15 延长冷却。<br>
            &nbsp;&nbsp;· <b>热裂敏感（红热打箱）</b>：热裂发生在凝固末期固相线附近、由收缩受阻决定，开箱温度本身作用有限；文献中 800~900℃ 红热打箱只属<b>特定工艺</b>——易热裂铜合金（锡青铜等）/耐蚀铸铁红热打箱、金属型铸铁出型、球铁余热正火、大型铸钢件高温打箱+缓冷装置等，且<b>必须配套「立即去浇冒口/砂芯 → 热砂坑或入炉缓冷」</b>。故仅「铜合金」触发 800~900℃ 特例，其余材质给人工确认警告、不自动给高温值（铝合金熔点约 660℃ 无此工艺）。<br>
            · <b>开箱温度可自定</b>：默认按「材质 × 是否热时效 × 重要性」给出（重要件 ≤250℃），可在输入框改成本厂规定值；更严目标会提示延长冷却。<br>
            · <b>调整</b>：流水线 ×0.65（开箱温度较高）；热时效 ×0.85；壁厚差大 ×1.3；冷裂/变形敏感 ×1.15；热裂敏感 ×1.0；重要件 ×1.1。<br>
            · <b>可信度说明</b>：冷却时间/开箱温度为行业经验表（多来源交叉：实用铸造手册、《现代铸铁》2019 打箱时间研究等），须按本厂实际修正；"凝固系数 k"各手册数值差异大（如灰铁0.7/球铁2.0 与糊状凝固实际相悖），本工具不采用。<br>
            · 重要件首件建议在壁厚最大处埋热电偶实测冷却曲线。
          </div>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="so_modal" hidden>
      <div class="modal">
        <div class="modal-head"><div class="modal-title">📄 开箱时间计算记录</div><button class="modal-close" data-close>&times;</button></div>
        <div class="report-body" id="so_reportBody"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="so_reportCopy" style="flex:1">📋 复制文本</button>
          <button class="btn btn-primary" id="so_reportDl" style="flex:1">⬇️ 下载报告</button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });

  const q = (id) => container.querySelector(id);
  let lastResult = null;
  // 61 批次：自动预填的目标温度不是"用户自定"——用户手动改过才按自定口径计算，
  //   否则走默认档（显示 ≤默认℃ + 默认来源），避免结果永远显示"（自定）"
  let targetTouched = false;

  const read = () => ({
    mat: q('#so_mat').value,
    weight: parseNum(q('#so_wt').value),
    wall: parseNum(q('#so_wall').value),
    mode: q('#so_mode').value,
    heatTreat: q('#so_ht').value,
    risk: q('#so_risk').value,
    importance: q('#so_imp').value,
    targetTemp: targetTouched ? parseNum(q('#so_target').value) : 0,
  });

  // 材质/热时效/重要性/风险变化 → 预填默认开箱温度；热裂敏感×铜合金走红热打箱特例：
  //   目标框禁用（800~900℃ 由工艺决定，不填数值），避免与结果冲突
  const syncTarget = () => {
    const t = SHAKE_TEMP[q('#so_mat').value];
    if (!t) return;
    const imp = q('#so_imp').value;
    const ht = q('#so_ht').value;
    const hotCopper = q('#so_risk').value === '热裂敏感(红热打箱)' && q('#so_mat').value === '铜合金';
    const inp = q('#so_target');
    targetTouched = false;   // 重选参数 → 回到"自动默认"口径
    if (hotCopper) {
      inp.value = ''; inp.disabled = true; inp.placeholder = '按红热打箱工艺（800~900℃）执行';
      return;
    }
    inp.disabled = false; inp.placeholder = '';
    let def = ht === '是' ? t.withHT : t.noHT;
    if (imp === '重要') def = Math.min(250, t.noHT);
    inp.value = def;
  };

  const fmtTime = (range, unit) => {
    if (!range) return '—';
    if (unit === 'h') return range[0] === range[1] ? `${fmt(range[0], 1)}` : `${fmt(range[0], 1)}~${fmt(range[1], 1)}`;
    const [a, b] = range;
    if (b < 60) return `${a}~${b}`;
    return `${a}~${b}（${fmt(a / 60, 1)}~${fmt(b / 60, 1)}h）`;
  };

  const renderResults = (r) => {
    lastResult = r;
    if (!r.timeRange) {
      q('#so_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">重量超过经验表上限（大型铸件表至 100t）：无法给可靠经验值，请按本厂工艺实测冷却曲线（壁厚最大处埋热电偶）</span></div>`;
      return;
    }
    const adjRow = r.adjustments.length
      ? r.adjustments.map(a => row('⚙️ ' + a.replace(/：.*?×/, ' ×').split('：')[0], a.includes('×') ? a.split('×')[1] : '', '', '', a)).join('')
      : row('⚙️ 调整', '无（地面 · 不热时效 · 一般）', '', '');
    const warnHtml = r.warnings.length
      ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ ${r.warnings.join('<br>⚠️ ')}</div>`
      : '';
    q('#so_results').innerHTML = `
      ${ex.exampleNote()}
      ${row('⏱️ 建议开箱时间', fmtTime(r.timeRange, r.unit), r.unit === 'h' ? 'h' : 'min', 'ok', r.large ? '大型铸件（≥1t）' : '中小件查表')}
      ${row('🌡️ 开箱温度目标', r.shakeTemp, '', '', r.shakeTempSource)}
      ${row('🔍 查询档位', r.large ? `${r.row.tMin}~${r.row.tMax}t → ${r.row.h}h` : `重量 &lt;${r.row.wMax}kg · 壁厚 &lt;${r.row.tMax}mm → ${r.row.min}~${r.row.max}min`, '', '')}
      ${adjRow}
      ${warnHtml}
      <div class="field-hint" style="padding:8px 4px 0">开箱时间 = 查表值 × 各调整系数（流水线/热时效/风险/重要性）。首件建议实测冷却曲线校核。</div>`;
  };

  const ex = installExampleTags(container, ['so_wt', 'so_wall']);
  const update = () => {
    // PHASE 63 P0-1：空/0/负/NaN/±Infinity → 明确提示（原守卫只挡 ≤0）
    const err = firstErr([
      checkNum(q('#so_wt').value, { label: '铸件重量', gt: 0, required: true }),
      checkNum(q('#so_wall').value, { label: '壁厚', gt: 0, required: true }),
    ]);
    if (err) { q('#so_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    renderResults(runShakeout(read()));
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 160); };
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => {
    el.addEventListener('input', debounced);
    if (el.tagName === 'SELECT') el.addEventListener('change', debounced);
  });
  // 材质/热时效/重要性/风险变化 → 预填默认开箱温度（再计算）
  for (const id of ['#so_mat', '#so_ht', '#so_imp', '#so_risk']) {
    q(id).addEventListener('change', () => { syncTarget(); debounced(); });
  }
  // 用户手动改目标温度 → 转"自定"口径
  q('#so_target').addEventListener('input', () => { targetTouched = true; });

  /* ---- 报告 ---- */
  function buildReportHtml() {
    if (!lastResult) return '';
    const r = lastResult;
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    const inr = read();
    const t = (label, val) => `<tr><td style="width:38%">${label}</td><td>${val}</td></tr>`;
    return `
      <h2>⏱️ 开箱时间计算记录</h2>
      <p class="meta">生成时间：${now} · ${inr.mat} · ${inr.weight} Kg · 壁厚 ${inr.wall}mm · ${inr.mode} · 热时效：${inr.heatTreat} · 风险：${inr.risk}</p>
      <h3>一、结果</h3>
      <table>${t('建议开箱时间', `${fmtTime(r.timeRange, r.unit)} ${r.unit}`)}${t('开箱温度目标', r.shakeTemp)}${t('查询档位', r.large ? `${r.row.tMin}~${r.row.tMax}t → ${r.row.h}h` : `重量&lt;${r.row.wMax}kg · 壁厚&lt;${r.row.tMax}mm → ${r.row.min}~${r.row.max}min`)}</table>
      <h3>二、调整明细</h3>
      <p>${r.adjustments.length ? r.adjustments.join('；') : '地面造型 · 不热时效 · 一般件，无调整'}</p>
      <h3>三、风险提示</h3>
      <p>${r.warnings.length ? r.warnings.join('；') : '—'}</p>
      <h3>四、依据</h3>
      <p style="font-size:.8rem">冷却时间表《实用铸造手册》；开箱温度多来源交叉印证。行业经验值，须按本厂实测修正。</p>`;
  }
  const openReport = () => {
    if (!lastResult) { showToast('请先完成计算'); return; }
    q('#so_reportBody').innerHTML = buildReportHtml();
    q('#so_modal').hidden = false;
  };
  const closeReport = () => { q('#so_modal').hidden = true; };
  q('#so_reportBtn').addEventListener('click', openReport);
  q('[data-close]').addEventListener('click', closeReport);
  q('#so_modal').addEventListener('click', (e) => { if (e.target === q('#so_modal')) closeReport(); });
  q('#so_reportDl').addEventListener('click', () => {
    saveFile(`开箱时间_${Date.now()}.html`, `<html><head><meta charset="utf-8"><title>开箱时间计算记录</title><style>body{font-family:system-ui,sans-serif;color:#1f2937;font-size:13px;padding:24px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}th{background:#f3f4f6}td:first-child{width:38%;color:#6b7280}td:last-child{font-weight:600}</style></head><body>${buildReportHtml()}</body></html>`);
  });
  q('#so_reportCopy').addEventListener('click', () => {
    const plain = buildReportHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    navigator.clipboard?.writeText(plain).then(() => showToast('已复制报告文本'), () => showToast('复制失败'));
  });

  /* ---- 初始化 ---- */
  prefillMaterial(container, '#so_mat');   // 当前工况材料 → 预选材质
  syncTarget();
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
