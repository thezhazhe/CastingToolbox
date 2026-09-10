// ============================================================
// 铸件尺寸公差 CT · 视图（查表工具）
// 主输入：图纸标注的 CT 等级（直接选 CT1~CT16）+ 基本尺寸 → 公差值（±）
// 辅助：铸造方法 × 材质 → 推荐 CT 区间（一键填入）
// 数据：现行 GB/T 42124.3-2025（2025-12-01 实施，全部代替 GB/T 6414-2017，修改采用
//   ISO 8062-3:2023；等级代号 DCTG 与图纸常用 CT 数值一致），多方核对（见数据文件头注释）
// ============================================================
import { CT_GRADES, CT_TABLE, CT_MATS, CT_METHOD_GRADES, CT_NOTE } from '../../data/ct_calc.js';
import { lookupCTRow, methodCTRec, ctTolerance, normGrade } from '../../calcs/ct.js';
import { renderNextSteps } from './nextSteps.js';
import { checkNum, parseNum } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';

const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));
// 自适应精度（61 批次审计：1 位小数把 0.15→0.1、±0.075→±0.1 失真/自相矛盾）
const sfmt = (v) => {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  const abs = Math.abs(n);
  const d = abs < 0.1 ? 3 : abs < 1 ? 2 : abs < 10 ? 1 : 0;
  return parseFloat(n.toFixed(d)).toString();
};

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
              <label class="field-label">📐 CT 等级 <span class="field-hint" style="display:inline">（按图纸标注选；未标 → 用下方推荐）</span></label>
              <div class="f-row"><select class="field-select" id="ct_grade"><option value="" selected>— 请选择 CT 等级 —</option>${CT_GRADES.map(g => `<option>${g}</option>`).join('')}</select><span class="f-unit">DCTG 同值</span></div>
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
            · <b>怎么用</b>：图纸上通常已标 CT/DCTG 等级（如 <b>GB/T 42124.3—DCTG9</b>，旧图纸 <b>CT9</b> 同值）——直接在上面选这个等级，工具给出该基本尺寸的<b>公差 ±值</b>；图纸没标时，用下面的「方法×材质」查推荐等级，点「填入推荐」。<br>
            · <b>CT/DCTG = 铸件尺寸公差等级</b>（数字越大越粗）：等级由<b>铸造方法 + 材质 + 批量</b>决定；成批/大量生产可比单件小批<b>提高两级</b>（取更小值）。<br>
            · <b>现行标准 GB/T 42124.3-2025</b>（2025-12-01 实施，全部代替 GB/T 6414-2017，修改采用 ISO 8062-3:2023）：等级代号 <b>DCTG</b> 与图纸常用 <b>CT</b> 数值一致，两者通用（本工具输入沿用 CT 代号）；等级沿革见下方法规区。<br>
            · <b>公差对称分布</b>：上偏差 = 下偏差 = 公差值 / 2（如 CT10 · 120mm → 公差 3.6mm = ±1.8mm）；非对称公差须单独标注。<br>
            · <b>壁厚粗一级</b>：壁厚公差比一般尺寸粗一级（6414-2017 §9 明文；现行版以壁厚专用级 DCTG15wt 表达，如一般 CT15 → 壁厚按 CT16/DCTG15wt 值）。<br>
            · <b>错型（错箱）</b>值必须位于公差值之内，不得另加；公差<b>不含拔模斜度</b>增量。<br>
            · <b>小尺寸</b>：基本尺寸 ≤16mm 段 CT13~16 无表值，须个别标注（规则源自 1999 版表注，详见法规区）。<br>
            · <b>不同材质不换标准</b>：灰铁 GB/T 9439、球铁 GB/T 1348、铝压铸 GB/T 15114、铜 GB/T 13819 的<b>尺寸公差均引用 GB/T 42124.3</b>（原 GB/T 6414 体系）；材质差异只体现在<b>可达到的等级</b>（推荐区间不同），数值表通用。<br>
            · <b>公差数值表（mm，对称分布；CT/DCTG 代号同值）</b>：<br>
            <table class="calc-table">
              <tr><th>尺寸 ≤mm</th>${CT_GRADES.map(g => `<th>${g.replace('CT', '')}</th>`).join('')}</tr>
              ${CT_TABLE.map(r => `<tr><th>${r.hi}</th>${CT_GRADES.map(g => `<td>${r[g] ?? '—'}</td>`).join('')}</tr>`).join('')}
            </table>
            · ${CT_NOTE.join('<br>· ')}<br>
            · 数据：GB/T 42124.3-2025（2025-12-01 实施）。<b>数值表已对照其母本 ISO 8062-3:2023 Table 7 全表交叉核验</b>（16 档 × 16 级 256 格，多独立来源零冲突，252 格与旧版同值）；唯 3 处 4 格按现行版与 GB/T 6414-1999 旧图纸不同（2007 换代理修订、2023 沿用现行值）：<b>160~250mm 段 CT5 = 0.70</b>（旧 0.72）、<b>630~1000mm 段无 CT4 档</b>（旧 0.72）、<b>1000~1600mm 段无 CT4/CT5 档</b>（旧 0.80/1.1）——本表为现行版值。未逐字核对国标官方全文，条文语义以标准原文为准。
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });
  const q = (id) => container.querySelector(id);
  const ex = installExampleTags(container, ['ct_size']);   // 基本尺寸示例默认值标记（P1-2）

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
    // PHASE 63 P0-1：基本尺寸非法 → 明确提示
    const err = checkNum(q('#ct_size').value, { label: '基本尺寸（毛坯）', gt: 0, required: true });
    if (err) { q('#ct_results').innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    const size = parseNum(q('#ct_size').value);
    // PHASE 63 P1-1：CT 等级不再默认选 CT1 —— 用户必须主动选择后才正式计算（防"假精确"误用）
    const grade = q('#ct_grade').value;
    if (!grade) {
      q('#ct_results').innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">请先选择 CT 等级：图纸已标注 → 按标注选；未标注 → 用下方「方法×材质」查推荐并点「填入推荐」。</span></div>`;
      return;
    }
    const tol = ctTolerance(size, grade);
    const isWall = q('#ct_wall').value === 'yes';
    if (!tol) {
      // 61 批次：空值归因区分（原文案一律归"≤16mm 不采用"——尺寸超表/高档位无值也照显示，误导）
      const hit = lookupCTRow(size);
      const reason = !hit
        ? '基本尺寸超出标准数值表上限（>10000mm）：无表可查，须供需双方协商并个别标注'
        : hit.row.hi <= 16
          ? `基本尺寸 ≤16mm 段 ${grade} 无表值（该段仅 CT13~16 不采用，须个别标注），请改选 ≤CT12 或按图纸标注`
          : `「${grade}」在尺寸档 ${hit.rangeLabel} 无表值（尺寸过大达不到该精度），请改选更大等级号（更粗）或协商个别标注`;
      q('#ct_results').innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">${reason}</span></div>`;
      return;
    }
    // 壁厚粗一级（现行体系壁厚专用级 DCTG15wt = 原 DCTG16；CT16 已为最粗级无法再 +1）
    const wallEdge = isWall && grade === 'CT16';
    const wallGrade = isWall && !wallEdge ? 'CT' + (CT_GRADES.indexOf(grade) + 1) : null;
    const wallTol = isWall && wallGrade ? ctTolerance(size, wallGrade) : null;

    q('#ct_results').innerHTML = `
      ${ex.exampleNote()}
      ${row('📏 尺寸公差（总公差）', `${sfmt(tol.value)}mm`, 'mm', 'ok', `等级 ${grade} · 尺寸档 ${tol.range}`)}
      ${row('↕️ 上 / 下偏差（对称）', `+${sfmt(tol.half)} / −${sfmt(tol.half)}`, 'mm', '', '公差值 ÷ 2')}
      ${isWall ? `
      <div class="divider" style="margin:10px 0"></div>
      ${wallTol
        ? row('📐 壁厚公差（粗一级）', `${sfmt(wallTol.value)}mm = ±${sfmt(wallTol.half)}`, 'mm', 'warn', `等级 ${wallGrade}（壁厚比一般尺寸粗一级）`)
        : `<div class="empty" style="padding:14px">${wallEdge ? 'CT16 已为最粗等级（现行体系壁厚用 DCTG15wt），无法再粗一级——按图纸/协议标注' : `${wallGrade} 在该尺寸段无表值，按图纸标注`}</div>`}
      ` : ''}
      <div class="field-hint" style="padding:8px 4px 0">标注示例（对称）：GB/T 42124.3—${grade.replace('CT', 'DCTG')}（旧图纸 ${grade} 同值）· ${size}±${sfmt(tol.half)}mm（总公差 ${sfmt(tol.value)}mm）。错型值须在公差内；批量大可再提两级。</div>`;
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 160); };
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => el.addEventListener('input', debounced));
  container.querySelectorAll('.section-card select').forEach(el => el.addEventListener('change', debounced));

  syncRec();
  update();
  renderNextSteps(container, calc);
}
