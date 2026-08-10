// ============================================================
// 铸件尺寸公差 CT · 视图（查表工具）
// 主输入：图纸标注的 CT 等级（直接选 CT1~CT16）+ 基本尺寸 → 公差值（±）
// 辅助：铸造方法 × 材质 → 推荐 CT 区间（一键填入）
// 数据：GB/T 6414-2017（≈ISO 8062-3，等级代号 CT/DCTG 通用），多方核对
// ============================================================
import { CT_GRADES, CT_TABLE, CT_MATS, CT_METHOD_GRADES, CT_NOTE } from '../../data/ct_calc.js';
import { methodCTRec, ctTolerance, normGrade } from '../../calcs/ct.js';
import { renderNextSteps } from './nextSteps.js';

const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));

/** 推荐区间 "8~10" → 中档等级索引（选 CT9） */
const recMidGrade = (rec) => {
  const gs = (String(rec).match(/\d+/g) || []).map(normGrade).filter(g => CT_GRADES.includes(g));
  return gs[Math.floor((gs.length - 1) / 2)] || gs[0] || null;
};

export function renderCT(container, calc) {
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
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>📋 输入 <small>图纸已标 CT 等级直接选；没标用推荐</small></div>
          <div class="field" style="margin-bottom:12px">
            <label class="field-label">📏 基本尺寸（毛坯）</label>
            <div class="f-row"><input class="field-input" type="number" id="ct_size" value="120" step="1" min="1"><span class="f-unit">mm</span></div>
          </div>
          <div class="field-grid2">
            <div class="field">
              <label class="field-label">📐 CT 等级 <span class="field-hint" style="display:inline">（按图纸标注选）</span></label>
              <div class="f-row"><select class="field-select" id="ct_grade">${CT_GRADES.map(g => `<option>${g}</option>`).join('')}</select><span class="f-unit">DCTG 同值</span></div>
            </div>
            <div class="field"><label class="field-label">📐 是壁厚？</label><div class="f-row"><select class="field-select" id="ct_wall"><option value="no">否</option><option value="yes">是（粗一级）</option></select></div></div>
          </div>
          <div class="divider" style="margin:14px 0"></div>
          <div class="field" style="margin-bottom:10px">
            <label class="field-label">🔧 没标等级？按 方法×材质 查推荐</label>
            <div class="f-row" style="flex-wrap:wrap;gap:8px">
              <select class="field-select" id="ct_method" style="flex:1;min-width:150px">${Object.keys(CT_METHOD_GRADES).map(k => `<option>${k}</option>`).join('')}</select>
              <select class="field-select" id="ct_mat" style="flex:1;min-width:110px">${CT_MATS.map(k => `<option>${k}</option>`).join('')}</select>
              <button class="btn btn-primary" id="ct_apply" style="white-space:nowrap">填入推荐</button>
            </div>
            <div class="field-hint" id="ct_rec" style="margin-top:6px">…</div>
          </div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 结果</div>
          <div class="results" id="ct_results"><div class="empty" style="padding:20px"><span class="empty-sub">填写参数后自动计算…</span></div></div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 说明与依据</div>
          <div class="field-hint" style="line-height:1.8">
            · <b>怎么用</b>：图纸上通常已标 CT 等级（如 <b>GB/T 6414—CT9</b>）——直接在上面选这个等级，工具给出该基本尺寸的<b>公差 ±值</b>；图纸没标时，用下面的「方法×材质」查推荐等级，点「填入推荐」。<br>
            · <b>CT = 铸件尺寸公差等级</b>（数字越大越粗）：等级由<b>铸造方法 + 材质 + 批量</b>决定；成批/大量生产可比单件小批<b>提高两级</b>（取更小值）。<br>
            · <b>现行标准 GB/T 6414-2017</b>（全部代替 1999 版，对应 ISO 8062-3:2007）：新代号 <b>DCTG</b> 与原 <b>CT</b> 数值一致，图纸上两者通用。<br>
            · <b>公差对称分布</b>：上偏差 = 下偏差 = 公差值 / 2（如 CT10 · 120mm → 公差 3.6mm = ±1.8mm）。<br>
            · <b>壁厚粗一级</b>：壁厚公差比一般尺寸粗一级（平均壁厚 ≤1.2mm 时可同级）。<br>
            · <b>错型（错箱）</b>值必须位于公差值之内，不得另加；公差<b>不含拔模斜度</b>增量。<br>
            · <b>小尺寸</b>：基本尺寸 ≤16mm 不采用 CT13~CT16，须个别标注。<br>
            · <b>不同材质不换标准</b>：灰铁 GB/T 9439、球铁 GB/T 1348、铝压铸 GB/T 15114、铜 GB/T 13819 的<b>尺寸公差均引用 GB/T 6414</b>；材质差异只体现在<b>可达到的等级</b>（推荐区间不同），数值表通用。<br>
            · <b>GB/T 6414 公差数值表（mm，对称分布）</b>：<br>
            <table class="calc-table">
              <tr><th>尺寸 ≤mm</th>${CT_GRADES.map(g => `<th>${g.replace('CT', '')}</th>`).join('')}</tr>
              ${CT_TABLE.map(r => `<tr><th>${r.hi}</th>${CT_GRADES.map(g => `<td>${r[g] ?? '—'}</td>`).join('')}</tr>`).join('')}
            </table>
            · ${CT_NOTE.join('<br>· ')}<br>
            · 数据：GB/T 6414-2017（多方核对：标准解读全文 + 机械设计手册 + 铸造工程师手册 + ISO 8062-3）。
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });
  const q = (id) => container.querySelector(id);

  // 辅助行：方法×材质 → 推荐区间；「填入推荐」把等级设为区间中档
  const syncRec = () => {
    const rec = methodCTRec(q('#ct_method').value, q('#ct_mat').value);
    q('#ct_rec').textContent = rec
      ? `推荐等级：CT${rec}（砂型取松、压铸/熔模取紧；批量大可再提两级）`
      : '该 方法×材质 无标准推荐，按图纸/协议执行';
  };
  q('#ct_apply').addEventListener('click', () => {
    const rec = methodCTRec(q('#ct_method').value, q('#ct_mat').value);
    const g = rec && recMidGrade(rec);
    if (g) q('#ct_grade').value = g;
    update();
  });

  const update = () => {
    syncRec();
    const size = parseFloat(q('#ct_size').value) || 0;
    if (size <= 0) { q('#ct_results').innerHTML = ''; return; }
    const grade = q('#ct_grade').value;
    const tol = ctTolerance(size, grade);
    const isWall = q('#ct_wall').value === 'yes';
    if (!tol) {
      q('#ct_results').innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">基本尺寸 ≤16mm 段不采用 ${grade}（须个别标注），请改选 CT13 以下等级或核对图纸</span></div>`;
      return;
    }
    // 壁厚粗一级
    const wallGrade = isWall ? 'CT' + (CT_GRADES.indexOf(grade) + 1) : null;
    const wallTol = isWall && wallGrade ? ctTolerance(size, wallGrade) : null;

    q('#ct_results').innerHTML = `
      ${row('📏 尺寸公差（总公差）', `${fmt(tol.value, 1)}mm`, 'mm', 'ok', `等级 ${grade} · 尺寸档 ${tol.range}`)}
      ${row('↕️ 上 / 下偏差（对称）', `+${fmt(tol.half, 1)} / −${fmt(tol.half, 1)}`, 'mm', '', '公差值 ÷ 2')}
      ${isWall ? `
      <div class="divider" style="margin:10px 0"></div>
      ${wallTol
        ? row('📐 壁厚公差（粗一级）', `${fmt(wallTol.value, 1)}mm = ±${fmt(wallTol.half, 1)}`, 'mm', 'warn', `等级 ${wallGrade}（壁厚比一般尺寸粗一级）`)
        : `<div class="empty" style="padding:14px">${wallGrade} 在该尺寸段不采用，按图纸标注</div>`}
      ` : ''}
      <div class="field-hint" style="padding:8px 4px 0">标注示例：GB/T 6414—${grade} · ${size}⁺${fmt(tol.half, 1)}₋₀·₈。错型值须在公差内；批量大可再提两级。</div>`;
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 160); };
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => el.addEventListener('input', debounced));
  container.querySelectorAll('.section-card select').forEach(el => el.addEventListener('change', debounced));

  syncRec();
  update();
  renderNextSteps(container, calc);
}
