// ============================================================
// 浇注系统设计 · 视图（单列居中版式，沿用原工具分区与公式标注）
// 基本参数 → 计算结果 → 组元尺寸 → 综合判定，实时计算 + 计算记录
// ============================================================
import { MATERIALS, RATIO_PRESETS, runGating, recommendGatingRatio } from '../../calcs/gating.js';
import { prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { saveFile } from '../download.js';

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
          <button class="btn btn-ghost" data-back>← 返回</button>
          <span class="tool-icon" style="width:36px;height:36px;font-size:1.05rem">${calc.icon}</span>
          <h1 class="page-title" style="font-size:1.2rem">${calc.name}</h1>
        </div>
        <p class="page-sub">${calc.desc}</p>
      </div>
      <span class="badge-status badge-ready">✓ 可用</span>
    </div>

    <div class="calc-single">
      <!-- 1 基本参数 -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">1</span>📋 基本参数</div>
        <div class="field" style="margin-bottom:12px">
          <label class="field-label">🔩 材质</label>
          <div class="f-row"><select class="field-select" id="g_mat">${Object.keys(MATERIALS).map(k => `<option>${k}</option>`).join('')}</select><span class="f-unit" id="g_mat_hint" style="width:auto"></span></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">⚖️ 单件毛重</label><div class="f-row"><input class="field-input" type="number" id="g_pw" value="${DEFAULTS.pw}" step="0.1" min="0"><span class="f-unit">Kg</span></div></div>
          <div class="field"><label class="field-label">🔢 一模件数</label><div class="f-row"><input class="field-input" type="number" id="g_cav" value="${DEFAULTS.cav}" step="1" min="1"><span class="f-unit">件</span></div></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">📐 产品壁厚</label><div class="f-row"><input class="field-input" type="number" id="g_wall" value="${DEFAULTS.wall}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field"><label class="field-label">📊 预估出品率</label><div class="f-row"><input class="field-input" type="number" id="g_yr" value="${DEFAULTS.yr}" step="1" min="10" max="100"><span class="f-unit">%</span></div></div>
        </div>
        <div class="divider"></div>
        <div class="field" style="margin-bottom:12px">
          <label class="field-label">⬇️ 浇注方向</label>
          <div class="f-row"><select class="field-select" id="g_pos"><option>顶注</option><option>中注</option><option>底注</option></select><span class="f-unit" style="width:auto"></span></div>
        </div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">📏 Ho（内浇道至上箱面）</label><div class="f-row"><input class="field-input" type="number" id="g_Ho" value="${DEFAULTS.Ho}" step="1" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field"><label class="field-label">📏 产品高度（浇注向）</label><div class="f-row"><input class="field-input" type="number" id="g_ph" value="${DEFAULTS.ph}" step="1" min="0"><span class="f-unit">mm</span></div></div>
        </div>
        <div class="field"><label class="field-label">📏 冒口高度</label><div class="f-row"><input class="field-input" type="number" id="g_rh" value="${DEFAULTS.rh}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
        <div class="divider"></div>
        <div class="field">
          <label class="field-label">⚙️ 浇注比例预设（S直:S横:S内）</label>
          <div class="f-row">
            <select class="field-select" id="g_ratio">
              ${Object.keys(RATIO_PRESETS).map(k => `<option>${k}</option>`).join('')}
              <option value="__custom">✏️ 自定义</option>
            </select>
            <span class="f-unit" style="width:auto" id="g_ratio_note"></span>
          </div>
        </div>
        <div id="g_custom_ratio" style="display:none;margin-top:10px">
          <div class="field-grid3">
            <div class="field"><label class="field-label">📐 S直</label><div class="f-row"><input class="field-input" type="number" id="g_cs" value="${DEFAULTS.cs}" step="0.1" min="0.1"><span class="f-unit">份</span></div></div>
            <div class="field"><label class="field-label">📐 S横</label><div class="f-row"><input class="field-input" type="number" id="g_cr" value="${DEFAULTS.cr}" step="0.1" min="0.1"><span class="f-unit">份</span></div></div>
            <div class="field"><label class="field-label">📐 S内</label><div class="f-row"><input class="field-input" type="number" id="g_cg" value="${DEFAULTS.cg}" step="0.1" min="0.1"><span class="f-unit">份</span></div></div>
          </div>
          <div class="field-hint" style="margin-top:6px">填写 S直:S横:S内 比例（正数），如 1 : 2 : 2</div>
        </div>
      </div>

      <!-- 2 计算结果 -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">2</span>📊 计算结果 <small>每行附公式/查表依据</small></div>
        <div class="results" id="g_results"><div class="empty" style="padding:20px"><span class="empty-sub">填写参数后自动计算…</span></div></div>
      </div>

      <!-- 3 组元尺寸 -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">3</span>📐 组元尺寸 <small>改厚度/个数，长度自动算</small></div>
        <div class="group-title">🟦 内浇道（方形）</div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">🔢 个数</label><div class="f-row"><input class="field-input" type="number" id="g_gc" value="${DEFAULTS.gc}" step="1" min="1"><span class="f-unit">个</span></div></div>
          <div class="field"><label class="field-label">📐 厚度</label><div class="f-row"><input class="field-input" type="number" id="g_gt" value="${DEFAULTS.gt}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
        </div>
        <div class="results" style="margin-top:8px">
          <div class="rrow" id="g_ig_len"><span class="rl">📏 推荐长度</span><span class="rv">—</span></div>
          <div class="rrow" id="g_ig_area"><span class="rl">📐 实际总面积</span><span class="rv">—</span></div>
        </div>
        <div class="divider"></div>
        <div class="group-title">🟧 横浇道（长方形）</div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">🔢 条数</label><div class="f-row"><input class="field-input" type="number" id="g_rc" value="${DEFAULTS.rc}" step="1" min="1"><span class="f-unit">条</span></div></div>
          <div class="field"><label class="field-label">📐 厚度</label><div class="f-row"><input class="field-input" type="number" id="g_rt" value="${DEFAULTS.rt}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
        </div>
        <div class="results" style="margin-top:8px">
          <div class="rrow" id="g_rr_len"><span class="rl">📏 推荐长度</span><span class="rv">—</span></div>
          <div class="rrow" id="g_rr_area"><span class="rl">📐 实际总面积</span><span class="rv">—</span></div>
        </div>
        <div class="divider"></div>
        <div class="group-title">⬇️ 直浇道（自动）</div>
        <div class="results" style="margin-top:8px">
          <div class="rrow" id="g_sp_dia"><span class="rl">⭕ 推荐直径（1根圆形）</span><span class="rv">—</span></div>
          <div class="rrow" id="g_sp_area"><span class="rl">📐 实际截面积</span><span class="rv">—</span></div>
        </div>
        <div class="divider"></div>
        <div class="group-title">💭 排气（圆孔 + 方片）</div>
        <div class="field-grid2">
          <div class="field"><label class="field-label">⭕ 圆孔直径</label><div class="f-row"><input class="field-input" type="number" id="g_vr" value="${DEFAULTS.vr}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field"><label class="field-label">🔢 圆孔数量</label><div class="f-row"><input class="field-input" type="number" id="g_vrc" value="${DEFAULTS.vrc}" step="1" min="0"><span class="f-unit">个</span></div></div>
        </div>
        <div class="field-grid3">
          <div class="field"><label class="field-label">📏 方片宽</label><div class="f-row"><input class="field-input" type="number" id="g_vs" value="${DEFAULTS.vs}" step="1" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field"><label class="field-label">📐 方片厚</label><div class="f-row"><input class="field-input" type="number" id="g_vst" value="${DEFAULTS.vst}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
          <div class="field"><label class="field-label">🔢 方片数量</label><div class="f-row"><input class="field-input" type="number" id="g_vsc" value="${DEFAULTS.vsc}" step="1" min="0"><span class="f-unit">个</span></div></div>
        </div>
        <div class="results" style="margin-top:8px">
          <div class="rrow" id="g_vent_ratio"><span class="rl">💭 排气面积比 S出/S直</span><span class="rv">—</span></div>
        </div>
      </div>

      <!-- 4 综合判定 -->
      <div class="card section-card">
        <div class="section-card-title"><span class="step-badge">4</span>✅ 综合判定</div>
        <div id="g_judge" style="color:var(--text-muted);font-size:.8rem">等待计算…</div>
        <div id="g_sugs" style="margin-top:10px"></div>
        <button class="btn btn-primary" id="g_reportBtn" style="width:100%;margin-top:14px">📄 生成计算记录</button>
      </div>
    </div>

    <div class="modal-overlay" id="g_modal" hidden>
      <div class="modal">
        <div class="modal-head"><div class="modal-title">📄 浇注系统设计计算记录</div><button class="modal-close" data-close>&times;</button></div>
        <div class="report-body" id="g_reportBody"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="g_reportCopy" style="flex:1">📋 复制文本</button>
          <button class="btn btn-primary" id="g_reportDl" style="flex:1">⬇️ 下载报告</button>
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
    matHint.textContent = `ρ=${m.rho} · 出品率${m.y_min}~${m.y_max}%`;
    const pw = parseFloat(q('#g_pw').value) || 0;
    const rec = recommendGatingRatio(mat, pw);
    const cur = q('#g_ratio').value;
    if (cur === '__custom') ratioHint.textContent = '自定义比例';
    else if (cur !== rec) ratioHint.textContent = `⚡ 建议 ${rec}`;
    else ratioHint.textContent = '✓ 推荐';
  };

  const toggleCustom = () => {
    q('#g_custom_ratio').style.display = q('#g_ratio').value === '__custom' ? 'block' : 'none';
  };

  let lastResult = null;
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
      vr: parseFloat(q('#g_vr').value) || 0, vrc: parseInt(q('#g_vrc').value) || 0,
      vs: parseFloat(q('#g_vs').value) || 0, vst: parseFloat(q('#g_vst').value) || 0,
      vsc: parseInt(q('#g_vsc').value) || 0,
    };
  };
  const update = () => {
    syncHints();
    lastResult = runGating(read());
    renderResults(lastResult);
    renderComponents(lastResult);
    renderJudge(lastResult);
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 180); };

  const matSel = q('#g_mat'), ratioSel = q('#g_ratio');
  matSel.addEventListener('change', () => {
    if (!ratioTouched) ratioSel.value = recommendGatingRatio(matSel.value, parseFloat(q('#g_pw').value) || 0);
    toggleCustom(); debounced();
  });
  ratioSel.addEventListener('change', () => { ratioTouched = true; toggleCustom(); debounced(); });
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => el.addEventListener('input', debounced));

  const row = (label, value, unit, cls = '', note = '') =>
    `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
  const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));

  function renderResults(r) {
    q('#g_results').innerHTML = `
      <div class="group-title">中间计算</div>
      ${row('⚖️ 密度 ρ', r.rho, 'kg/dm³', '', '查材料表')}
      ${row('🔢 材质系数 f', r.fc, '', '', '查材料表')}
      ${row('🫗 浇注重量 G', fmt(r.G, 2), 'Kg', '', `G = ${r.pw}×${r.cav}÷${r.yv}%`)}
      ${row('📏 C = 件高+冒口高', fmt(r.Cmm, 2), 'mm', '', `${r.ph} + ${r.rh}`)}
      ${row('🏗️ Hb 水口盆高度', r.Hb, 'mm', '', 'G<10→150,<50→200,<200→250,<1000→300,<3000→500,<8000→750,≥8000→1100')}
      ${row('📐 P 值', fmt(r.Pv, 1), 'mm', '', r.pos + '：顶=0/中=C/2/底=C')}
      ${row('📊 Hp 平均静压头', fmt(r.Hp, 4), 'mm', '', r.pos + '公式')}
      ${row('💧 fv 流速系数', r.fv, '', '', r.pos + '=0.8/0.6/0.45')}
      <div class="group-title">最终结果</div>
      ${row('⏱️ 浇注时间 t', fmt(r.t, 4), 's', '', 'Dietert：t=f×(√G+∛(wG/5))×2/3')}
      ${row('🎯 阻流截面 A_choke', fmt(r.A, 2), 'mm²', '', '奥赞：A=71.47×G/(ρ×t×fv×√Hp)×100')}
      ${row('📍 瓶颈位置', r.cp, '', '', `比例 1:${r.r_r.toFixed(2)}:${r.g_r.toFixed(2)} 最小比值处`)}
      ${row('🔽 内浇道参考面积', fmt(r.A_gt, 0), 'mm²', '', 'A×(S内/min)')}
      ${row('➡️ 横浇道参考面积', fmt(r.A_run, 0), 'mm²', '', 'A×(S横/min)')}
      ${row('⬇️ 直浇道参考面积', fmt(r.A_sp, 0), 'mm²', '', 'A×(S直/min)')}
      <div class="group-title">校核</div>
      ${row('💨 内浇口流速 v', fmt(r.v, 4), 'm/s', r.v_ok ? 'ok' : 'bad', 'v=10×G/(t×ρ×F/100)，标准≤1.8')}
      ${row('💭 排气面积比', fmt(r.vr, 2), '倍', r.vr_ok ? 'ok' : 'bad', 'S出/S直，标准≥1.5')}
      ${row('📊 实际出品率', fmt(r.ya, 1), '%', '', 'pw×cav/G×100%')}
      ${row('🔗 实际比例 S直:S横:S内', r.Fr_act > 0 ? `1:${fmt(r.rrv, 2)}:${fmt(r.rgv, 2)}` : '横浇道未设', '', '', `目标 1:${r.r_r.toFixed(2)}:${r.g_r.toFixed(2)}`)}
    `;
  }

  function renderComponents(r) {
    const set = (id, text, cls = '') => {
      const el = q(id);
      el.className = 'rrow ' + cls;
      el.innerHTML = `<span class="rl">${el.querySelector('.rl').textContent}</span><span class="rv">${text}</span>`;
    };
    set('#g_ig_len', r.gc > 0 && r.gt > 0 ? `${r.L_g} mm（厚${r.gt}×长${r.L_g}×${r.gc}个）` : '个数/厚度=0');
    const igOk = r.Fg >= r.A_gt * 0.7 && r.Fg <= r.A_gt * 1.3;
    set('#g_ig_area', `${fmt(r.Fg, 0)} mm²（参考${fmt(r.A_gt, 0)}）`, igOk ? 'ok' : 'warn');
    set('#g_rr_len', r.rc > 0 && r.rt > 0 ? `${r.L_r} mm（厚${r.rt}×长${r.L_r}×${r.rc}条）` : '条数/厚度=0');
    const frOk = r.Fr_act >= r.A_run * 0.8 && r.Fr_act <= r.A_run * 1.2;
    set('#g_rr_area', `${fmt(r.Fr_act, 0)} mm²（参考${fmt(r.A_run, 0)}）`, frOk ? 'ok' : 'warn');
    const fsOk = r.Fs_act >= r.A_sp * 0.9 && r.Fs_act <= r.A_sp * 1.1;
    set('#g_sp_dia', `⌀${r.D_sp} mm（1根圆形）`);
    set('#g_sp_area', `${fmt(r.Fs_act, 0)} mm²（参考${fmt(r.A_sp, 0)}）`, fsOk ? 'ok' : 'warn');
    set('#g_vent_ratio', `${fmt(r.vr, 2)} 倍（需≥1.5）`, r.vr_ok ? 'ok' : 'bad');
  }

  function renderJudge(r) {
    q('#g_judge').innerHTML = `<div class="judge ${r.allOk ? 'ok' : 'bad'}">${r.allOk ? '✅ 设计合理 · 参数合格' : '⚠️ 需优化 · 建议调整参数'}</div>`;
    q('#g_sugs').innerHTML = r.sugs.map(s => `<div class="suggestion">${s}</div>`).join('');
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
      <table>${t('单件毛重', `${r.pw} Kg`)}${t('一模件数', `${r.cav} 件`)}${t('产品壁厚', `${r.wall} mm`)}${t('预估出品率', `${r.yv}%`)}${t('浇注方向', r.pos)}${t('Ho', `${r.Ho} mm`)}${t('产品高度', `${r.ph} mm`)}${t('冒口高度', `${r.rh} mm`)}${t('比例预设', r.ratioKey || '自定义')}</table>
      <h3>二、自动计算结果</h3>
      <table>${t('密度 ρ', `${r.rho} kg/dm³`)}${t('材质系数 f', r.fc)}${t('浇注重量 G', `${fmt(r.G, 2)} Kg`)}${t('C=件高+冒口高', `${fmt(r.Cmm, 2)} mm`)}${t('Hb 水口盆高度', `${r.Hb} mm`)}${t('Hp 平均静压头', `${fmt(r.Hp, 4)} mm`)}${t('fv 流速系数', r.fv)}${t('浇注时间 t', `${fmt(r.t, 4)} s`)}${t('阻流截面 A_choke', `${fmt(r.A, 2)} mm²`)}</table>
      <h3>三、浇注系统尺寸</h3>
      <table>${t('瓶颈位置', r.cp)}${t('内浇道', `${r.gc}个×厚${r.gt}mm×长${r.L_g}mm = ${fmt(r.Fg, 0)}mm²（参考${fmt(r.A_gt, 0)}）`)}${t('横浇道', `${r.rc}条×厚${r.rt}mm×长${r.L_r}mm = ${fmt(r.Fr_act, 0)}mm²（参考${fmt(r.A_run, 0)}）`)}${t('直浇道', `⌀${r.D_sp}mm = ${fmt(r.Fs_act, 0)}mm²（参考${fmt(r.A_sp, 0)}）`)}${t('内浇口流速', `${fmt(r.v, 4)} m/s ${r.v_ok ? '✓' : '✗'}`)}${t('排气面积比', `${fmt(r.vr, 2)} 倍 ${r.vr_ok ? '✓' : '✗'}`)}${t('实际出品率', `${fmt(r.ya, 1)}%`)}</table>
      <h3>四、综合判定</h3>
      <p style="font-weight:700;color:${r.allOk ? '#059669' : '#DC2626'}">${r.allOk ? '✅ 设计合理 · 参数合格' : '⚠️ 需优化 · 建议调整参数'}</p>
      ${r.sugs.filter(s => !s.startsWith('✅')).map(s => `<div style="padding:6px 12px;margin:5px 0;background:#FFFBEB;color:#D97706;border-radius:6px;font-size:.82rem;border-left:3px solid #D97706">${s}</div>`).join('')}
      <h3>五、公式参考</h3>
      <table>${t('浇注时间 t', 't = f×(√G+∛(wG/5))×2/3 [s]  Dietert')}${t('阻流截面 A', 'A = 71.47×G/(ρ×t×fv×√Hp)×100 [mm²]  奥赞')}${t('Hp 顶注', 'Hp = Ho+Hb/2−rh²/(2C)')}${t('Hp 中注', 'Hp = Ho+Hb/2−(P+C−rh)²/(2C)')}${t('Hp 底注', 'Hp = (Ho+Hb)/2')}${t('流速校核', 'v = 10×G/(t×ρ×F/100) [m/s] ≤ 1.8')}${t('排气比', 'S出/S直 ≥ 1.5')}</table>`;
  }
  const openReport = () => {
    if (!lastResult) { showToast('请先完成计算'); return; }
    q('#g_reportBody').innerHTML = buildReportHtml();
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
  prefillMaterial(container, '#g_mat');   // 当前工况材料 → 预选材质
  ratioSel.value = recommendGatingRatio(q('#g_mat').value, DEFAULTS.pw);
  toggleCustom();
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
