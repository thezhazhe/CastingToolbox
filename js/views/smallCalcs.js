// ============================================================
// 小计算器视图（单列居中）：线收缩率 / 加工余量 / 铁液重量 / 出品率
// ============================================================
import { SHRINKAGE, SHRINK_MODE_LABEL, SPLIT_RATE_DIFF, SIZE_SMALL, SIZE_LARGE, calcShrinkageDir } from '../../calcs/shrinkage.js';
import { RMA_GRADES, RMA_TABLE, lookupRMA, nextCoarserGrade, rmaRange, methodGradeRec, METHOD_GRADES } from '../../calcs/machining.js';
import { MATERIALS } from '../../calcs/gating.js';
import { resolveYield, PRODUCT_YIELD, YIELD_PROCESSES } from '../../calcs/yield.js';
import { CAST_MATS, MIN_WALL_TABLE, HT_MIN_WALL_BY_GRADE, DRAFT_MODELS, DRAFT_SANDS, SAND_TYPES, sandCategory, MIN_HOLE_NOTE, suggestCastability, DRAFT_PROCESS, DRAFT_HEIGHT_ADJ, FILLET_ALT_NOTE, METAL_HOLE, MATERIAL_TIPS } from '../../calcs/castability.js';
import { CHILL_MATS, CHILL_TYPES, CHILL_COEF, CHILL_DEFAULT_MAT } from '../../data/chill_calc.js';
import { runChill } from '../../calcs/chill.js';
import { SB_MODES, SB_BURROW, SB_NOTE } from '../../data/sandbox_calc.js';
import { runSandbox } from '../../calcs/sandbox.js';
import { prefillMaterial, prefillSelect, get as getContext } from '../context.js';
import { renderNextSteps } from './nextSteps.js';
import { checkNum, firstErr, parseNum } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';
// PHASE 72（80.txt §八/§十四）：核心计算器 UI 中英双语（只译显示，公式/单位/变量名不动）
import { t } from '../i18n/index.js';
import { setRecompute } from '../i18n/viewState.js';

/* PHASE 72：属性值转义（下拉 value 等） */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));

/* ---- 通用外壳：单列居中 ---- */
function shell(container, calc, formHtml, sourceHtml) {
  // PHASE 72：说明与依据为长技术参考正文（本阶段不翻译）→ 英文界面下显式声明
  const zhNote = t('note.zhOnly');
  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn btn-ghost" data-back>${t('common.back')}</button>
          <span class="tool-icon" style="width:36px;height:36px;font-size:1.05rem">${calc.icon}</span>
          <h1 class="page-title" style="font-size:1.2rem">${t(calc.name)}</h1>
        </div>
        <p class="page-sub">${t(calc.desc)}</p>
      </div>
      <span class="badge-status badge-ready">${t('✓ 可用')}</span>
    </div>
    <div class="calc-single">
      <div class="calc-col">
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>📋 ${t('输入')}</div>
          ${formHtml}
        </div>
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 ${t('结果')}</div>
          <div class="results" id="sc_results"><div class="empty" style="padding:26px"><span class="empty-sub">${t('填写参数后自动计算…')}</span></div></div>
        </div>
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 ${t('说明与依据')}</div>
          ${zhNote ? `<div class="field-hint" style="margin-bottom:6px;color:var(--warning,#B45309)">🌐 ${zhNote}</div>` : ''}
          <div class="field-hint p72-cn" style="line-height:1.8">${sourceHtml}</div>
        </div>
      </div>
    </div>
  `;
  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });
  renderNextSteps(container, calc);
  return (id) => container.querySelector(id);
}

const bindLive = (container, fn) => {
  let timer;
  container.querySelectorAll('.section-card input, .section-card select').forEach(el =>
    el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(fn, 160); }));
  container.querySelectorAll('.section-card select').forEach(el =>
    el.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(fn, 160); }));
};

/* ============ 1. 线收缩率（按方向推荐 · 综合比例/分方向放缩水） ============ */
export function renderShrinkage(container, calc) {
  const q = shell(container, calc, `
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">${t('🔩 材质')}</label>
      <div class="f-row"><select class="field-select" id="s_mat">
        ${Object.keys(SHRINKAGE).map(k => `<option value="${k}">${t(k)}</option>`).join('')}
      </select><span class="f-unit" id="s_hint" style="width:auto"></span></div>
    </div>
    <div class="field" style="margin-bottom:14px">
      <label class="field-label">${t('🧱 收缩档位')}</label>
      <div class="f-row"><select class="field-select" id="s_mode">
        <option value="free">${t('自由收缩（开放结构、少阻碍）')}</option>
        <option value="common" selected>${t('常用值（生产·模具缩尺）')}</option>
        <option value="restrained">${t('受阻收缩（有筋板/法兰/型芯/内腔/结构复杂）')}</option>
      </select></div>
    </div>
    <div class="field-grid3">
      <div class="field"><label class="field-label">${t('📏 方向 X（长）')}</label><div class="f-row"><input class="field-input" type="number" id="s_d1" value="500" step="1" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">${t('📏 方向 Y（宽）')}</label><div class="f-row"><input class="field-input" type="number" id="s_d2" value="300" step="1" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">${t('📏 方向 Z（高）')}</label><div class="f-row"><input class="field-input" type="number" id="s_d3" value="150" step="1" min="0"><span class="f-unit">mm</span></div></div>
    </div>
  `, `
    · <b>为什么 1% 还是 0.8%？</b>同一种材料没有唯一收缩率：自由收缩（开放结构）最大，受阻收缩（有筋板/法兰/型芯/内腔）最小，常用值（生产模具缩尺）在两者之间。<b>选档位即选条件</b>。<br>
    · <b>按方向推荐</b>：按<b>绝对尺寸锚定</b>——方向尺寸 <b>≥${SIZE_LARGE}mm 取档位上限</b>（阻碍相对小），<b>≤${SIZE_SMALL}mm 取档位下限</b>（薄壁小件受约束、收缩小），之间线性过渡。<br>
    · <b>率 vs 绝对量</b>：收缩率是<b>"率"</b>，同材同约束下与尺寸大小关系不大（1500mm 与 10mm 同约 1%）；真正拉开差距的是<b>绝对放尺量</b>——1500×1%=15mm、10×1%=0.1mm，一个方向多放 15mm、另一个只放 0.1mm，这才是方向差异的实质。<br>
    · <b>分开放缩水</b>：各方向推荐率差 <b>≥${SPLIT_RATE_DIFF}%</b> 时，不宜用统一综合比例，需按方向分别放尺（X/Y/Z 分开缩放）；差得小就给一个总的比例。<br>
    · <b>砂型退让性</b>：退让性好（湿型/水玻璃砂）收缩率取大；深内腔/长芯头/芯骨处阻碍大，模型该方向要多放一点（按受阻值）。<br>
    · 数据来源：三档参考《木模结构工艺》《铸钢手册》《金属液态成型原理》；方向性推荐为工程经验做法（参考值，以生产试制修正为准）。
  `);

  const ex = installExampleTags(container, ['s_d1', 's_d2', 's_d3']);
  const sync = () => {
    const d = SHRINKAGE[q('#s_mat').value];
    q('#s_hint').textContent = t('资料典型 {r}（口径与档位值不同，见说明）', [d.range]);
  };

  const update = () => {
    const mat = q('#s_mat').value;
    const mode = q('#s_mode').value;
    const raws = [q('#s_d1').value, q('#s_d2').value, q('#s_d3').value];
    // PHASE 63 P0-1：负值 / NaN / Infinity 不静默跳过 → 明确提示（留空 = 该方向不参与）
    const err = firstErr(raws.map((raw, i) => checkNum(raw, { label: t('方向 {a}', [['X（长）', 'Y（宽）', 'Z（高）'][i]]), min: 0 })));
    const dims = raws.map(parseNum);
    const r = calcShrinkageDir(mat, dims, mode);
    if (err) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    if (!r) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">${t('请填写至少一个方向尺寸（>0）')}</span></div>`; return; }
    const d = SHRINKAGE[mat];
    const tips = {
      free: t('已按自由收缩取值（开放结构、少阻碍）。若铸件有内腔/型芯/筋板阻碍，请改选"常用值"或"受阻收缩"。'),
      common: t('已按常用生产值取值（模具缩尺常用档）。结构复杂请改选"受阻收缩"。'),
      restrained: t('已按受阻收缩取值（有筋板/法兰/型芯等阻碍）。受阻处模型可再按局部多放 0.1~0.2%。'),
    };
    // P1-7：按原始下标 idx 对应 长/宽/高 —— 任一方向留空不会让其余尺寸错位改名
    const dirRows = r.dirs.map(row_ =>
      row(`📏 ${t('方向 {a}', [['X', 'Y', 'Z'][row_.idx]])} ${t('收缩率')}`, `${row_.rate.toFixed(2)}`, '%', row_.idx === 0 ? 'ok' : '', `${row_.size}mm × ${row_.rate.toFixed(2)}% → ${t('放尺')} ${fmt(row_.pattern, 2)}mm`));
    // PHASE 78（78.txt 十）：**只突出综合比例**，X/Y/Z 分方向数值收进折叠区。
    //   用户困惑点："X/Y/Z 都是 0.6 左右，综合比例却是 0.8，改 X/Y/Z 综合比例也不变"——
    //   原因：综合比例取的是**档位上限**（= 大尺寸方向的值），而 X/Y/Z 是按各自尺寸在档位区间内
    //   锚定的插值（小方向偏低）→ 两者本来就不同源。此处如实说明，并把综合比例的算法讲清楚。
    const rates = r.dirs.map(x => x.rate);
    const dirLo = Math.min(...rates), dirHi = Math.max(...rates);
    const combinedHtml = r.directional
      ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ ${t('各方向推荐率差')} <b>${r.spread.toFixed(2)}% ≥ ${SPLIT_RATE_DIFF}%</b>，<b>${t('不宜用统一综合比例')}</b>——${t('请按下方分方向放缩水（X/Y/Z 分别放尺）。')}</div>`
      : row(`📏 ${t('综合比例（整体放尺）')}`, fmt(r.combined, 2), '%', 'ok', t(SHRINK_MODE_LABEL[mode]) + ' · ' + t('按此值统一缩放模型'));
    const dirDetail = `<details class="sc-fold" ${r.directional ? 'open' : ''}>
      <summary>${t('按方向细分（X/Y/Z 分别放尺）')}<span class="chip">${t('{n} 个方向', [r.dirs.length])}</span></summary>
      <div style="margin-top:6px">${dirRows.join('')}</div>
      <div class="field-hint" style="padding:6px 4px 0">${t('shr.note.anchor', [SIZE_SMALL, SIZE_LARGE])}${r.dirs.length > 1 ? `，${t('当前')} ${dirLo.toFixed(2)}~${dirHi.toFixed(2)}%` : ''}。</div>
    </details>`;
    // P1-6：工具档位值（计算用）与资料典型范围（参考）语义分离 —— 两源口径不同，不互替
    q('#sc_results').innerHTML = `
      ${ex.exampleNote()}
      ${row(`🧭 ${t('当前档位')}`, t(SHRINK_MODE_LABEL[mode]), '', '', t('工具工程参考值 · 用于放尺计算'))}
      ${combinedHtml}
      ${!r.directional ? `<div class="field-hint" style="padding:4px 4px 0">${t('shr.note.combined', [SIZE_LARGE, dirLo.toFixed(2), dirHi.toFixed(2), SPLIT_RATE_DIFF])}</div>` : ''}
      ${dirDetail}
      <div class="field-hint" style="padding:8px 4px 0">${t('shr.note.range', [d.range])}</div>
      <div class="field-hint" style="padding:8px 4px 0">${tips[mode]}<br>${t(d.note)}</div>`;
  };
  setRecompute(update);   // PHASE 72：语言切换 → 重新渲染视图后原地重算（数值不变，只换文案）
  prefillMaterial(container, '#s_mat');   // 当前工况材料 → 预选材质
  sync(); bindLive(container, update); update();
}

/* ============ 2. 加工余量（等级自动→余量范围 · 顶底面分级 · 无推荐则诚实提示） ============ */
export function renderMachining(container, calc) {
  const q = shell(container, calc, `
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">${t('🏭 铸造方法')}</label>
      <div class="f-row"><select class="field-select" id="m_method">${Object.keys(METHOD_GRADES).map(k => `<option value="${esc(k)}">${t(k)}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">${t('🔩 材质')}</label>
      <div class="f-row"><select class="field-select" id="m_mat">${['灰铸铁', '球铁', '铸钢', '铝合金', '铜合金'].map(k => `<option value="${k}">${t(k)}</option>`).join('')}</select><span class="f-unit" id="m_rec" style="width:auto"></span></div>
    </div>
    <div class="field">
      <label class="field-label">${t('📏 铸件最大轮廓尺寸（最终加工后）')}</label>
      <div class="f-row"><input class="field-input" type="number" id="m_size" value="300" step="1" min="1"><span class="f-unit">mm</span></div>
    </div>
  `, `
    · <b>余量由标准自动推荐，无需选等级</b>：按「铸造方法 + 材质」查推荐等级区间（RMAG 等级 A~K 十级），结果直接给<b>单侧余量范围</b>，等级仅供了解。<br>
    · <b>现行标准</b>：GB/T 42124.3-2025（2025-12-01 实施，全部代替 GB/T 6414-2017；修改采用 ISO 8062-3:2023）。等级代号 RMAG，数值表与 GB/T 6414-2017 一致（正式判定以标准原文为准）。<br>
    · <b>熔模铸造</b>：现行标准资料性附录建议 RMAG E 级（1999 旧版无此条目）——已收录。<br>
    · <b>顶面比底/侧面粗一级</b>：砂型铸件顶面（浇注位置朝上）气孔/夹杂多，加工余量等级比底/侧面<b>低一级</b>（余量更大）。<br>
    · <b>小加工面</b>：RMA 是按"铸件最大轮廓尺寸"查表给出的<b>单侧最小余量</b>；局部小加工面（如凸台、小孔）实际可适当减小，但不得小于该值，否则加工后可能留黑皮。<br>
    · <b>圆柱/双侧加工</b>：余量×2。<br>
    · <b>实战提示</b>：RMA 是标准<b>最小</b>余量；考虑变形、错芯、清砂，工厂实际常按 RMA 的 <b>1.5~2 倍</b>留余量，重要面建议放大 1~2 级（此为工厂实践经验，非标准规则）。<br>
    · <b>GB/T 42124.3-2025 单侧余量表（按最大轮廓尺寸 × RMAG 等级，mm）</b>：<br>
    <table class="calc-table">
      <tr><th>尺寸 ≤mm</th>${RMA_GRADES.map(g => `<th>${g}</th>`).join('')}</tr>
      ${RMA_TABLE.map(rw => `<tr><th>${rw.max}</th>${RMA_GRADES.map(g => `<td>${rw[g]}</td>`).join('')}</tr>`).join('')}
    </table>
  `);

  // GB/T 6414 只列 铸钢/灰铸铁/铝合金 的等级，球铁/铜合金按灰铸铁参考
  const matKeyMap = { '灰铸铁': '灰铸铁', '球铁': '灰铸铁', '铸钢': '铸钢', '铝合金': '铝合金', '铜合金': '灰铸铁' };

  const syncRec = () => {
    const method = q('#m_method').value;
    const mat = matKeyMap[q('#m_mat').value];
    const rec = methodGradeRec(method, mat);
    q('#m_rec').textContent = rec
      ? t('推荐 RMAG {g}（余量范围见结果）', [rec])
      : t('此 工艺×材质 无标准等级');
  };

  const ex = installExampleTags(container, ['m_size']);
  const update = () => {
    syncRec();
    const method = q('#m_method').value;
    const mat = matKeyMap[q('#m_mat').value];
    const rec = methodGradeRec(method, mat);
    // PHASE 63 P0-1：非法输入 → 明确提示（不再静默清空）
    const err = checkNum(q('#m_size').value, { label: t('铸件最大轮廓尺寸'), gt: 0, required: true });
    if (err) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    const size = parseNum(q('#m_size').value);
    if (!rec) {
      q('#sc_results').innerHTML = `
        <div class="empty" style="padding:20px">
          <span class="empty-sub">${t('「{a}」+「{b}」无标准 RMA 等级（GB/T 6414 未给出）。', [t(method), t(q('#m_mat').value)])}</span>
        </div>
        <div class="field-hint" style="padding:8px 4px 0">${t('该组合余量请按本厂工艺/图纸直接定（如压铸余量极小、多为不加工或精加工），<b>宁缺毋滥</b>。')}</div>`;
      return;
    }
    const range = rmaRange(size, rec);
    if (!range) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">${t('尺寸超出表范围（>10000mm）')}</span></div>`; return; }
    const grades = range.grades;
    const grade = grades[Math.floor((grades.length - 1) / 2)] || grades[0];   // 取中档展示顶面
    const gradeLabel = (arr) => arr.length > 1 ? `${arr[0]}~${arr[arr.length - 1]}` : arr[0];
    const top = lookupRMA(size, nextCoarserGrade(grade));
    const isSand = method.includes('砂型');
    q('#sc_results').innerHTML = `
      ${ex.exampleNote()}
      ${row(`📏 ${t('单侧余量范围')}`, `${fmt(range.min, 1)}~${fmt(range.max, 1)}`, 'mm', 'ok', `RMAG ${gradeLabel(grades)} · ${t('尺寸档')} ${lookupRMA(size, grade).range}`)}
      ${row(`🎯 ${t('推荐取值（中档）')}`, fmt(range.mid, 1), 'mm', '', `RMAG ${grade}`)}
      ${isSand && top ? row(`🔺 ${t('顶面单侧（粗一级）')}`, fmt(top.value, 1), 'mm', '', `RMAG ${nextCoarserGrade(grade)}`) : ''}
      ${row(`🔁 ${t('圆柱 / 双侧加工')}`, fmt(range.mid * 2, 1), 'mm', '', t('单侧 ×2'))}
      <div class="field-hint" style="padding:8px 4px 0">${t('rma.note.b')}</div>`;
  };
  setRecompute(update);   // PHASE 72：语言切换后原地重算（数值不变）
  // 当前工况：铸造方法/生产方式 → 预选铸造方法下拉
  const mc = getContext();
  if (mc.method === '金属型') prefillSelect(container, '#m_method', ['金属型']);
  if (mc.prod === '手工线') prefillSelect(container, '#m_method', ['手工造型']);
  if (mc.prod === '自动线' || mc.method === '3D打印') prefillSelect(container, '#m_method', ['机器造型', '壳型']);
  prefillMaterial(container, '#m_mat');   // 当前工况材料 → 预选材质
  syncRec(); bindLive(container, update); update();
}

/* ============ 3. 出品率与铁水重量（预估出品率 → 现场实测 → 铁液重量） ============ */
export function renderYield(container, calc) {
  const q = shell(container, calc, `
    <div class="section-card-title" style="margin-bottom:10px"><span class="step-badge">A</span>📊 ${t('① 预估出品率')}</div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">📦 ${t('产品类型')} <span class="field-hint" style="display:inline">${t('（可不选，选得越细越准）')}</span></label>
      <div class="f-row"><select class="field-select" id="y_product">
        <option value="">${t('ctx.unspecified')}</option>
        ${Object.keys(PRODUCT_YIELD).map(k => `<option value="${esc(k)}">${esc(t(k))}</option>`).join('')}
      </select></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🏭 ${t('铸造工艺 / 产线')}</label>
      <div class="f-row"><select class="field-select" id="y_process">
        <option value="">${t('ctx.unspecified')}</option>
        ${YIELD_PROCESSES.map(k => `<option value="${esc(k)}">${t(k)}</option>`).join('')}
      </select></div>
    </div>
    <div class="field">
      <label class="field-label">🔩 ${t('材质')}</label>
      <div class="f-row"><select class="field-select" id="y_mat">
        <option value="">${t('ctx.unspecified')}</option>
        ${Object.keys(MATERIALS).map(k => `<option value="${esc(k)}">${t(k)}</option>`).join('')}
      </select></div>
    </div>
    <div class="divider" style="margin:14px 0"></div>
    <div class="section-card-title" style="margin-bottom:10px"><span class="step-badge">B</span>⚖️ ${t('② 现场实测 → 铁液重量')}</div>
    <div class="field-grid3">
      <div class="field"><label class="field-label">⚖️ ${t('单件铸件重量')}</label><div class="f-row"><input class="field-input" type="number" id="y_part" value="50" step="0.1" min="0"><span class="f-unit">Kg</span></div></div>
      <div class="field"><label class="field-label">🔢 ${t('一模件数')}</label><div class="f-row"><input class="field-input" type="number" id="y_cav" value="2" step="1" min="1"><span class="f-unit">${t('件')}</span></div></div>
      <div class="field"><label class="field-label">📊 ${t('现场实测出品率')} <span class="field-hint" style="display:inline">${t('（默认=预估中值，请改为本厂实绩）')}</span></label><div class="f-row"><input class="field-input" type="number" id="y_yield" step="0.5" min="1" max="100" placeholder="${esc(t('自动填预估中值'))}"><span class="f-unit">%</span></div></div>
    </div>
  `, `
    · <b>两步走</b>：第 ① 步输入 产品/工艺/材质 → 得<b>预估出品率区间</b>（行业经验参考）；第 ② 步<b>现场实测出品率默认自动预填预估中值</b>，<b>请改成贵厂本批实绩</b>（改一次即记住，不再被覆盖）→ 铁液/浇冒口重量按它计算。<br>
    · <b>为什么分两步</b>：出品率受浇冒口设计、工艺水平、设备影响，<b>各厂各件差异很大</b>——预估是"参考值"，算铁液、配炉料必须用本厂实测值。<br>
    · <b>回退规则</b>：优先「产品×工艺」→「材质×工艺」→「工艺」→「材质」→ 通用，只显示一个最准结果。产品少见可以不选，用材质+工艺参考。<br>
    · 垂直线（DISA）一般出品率<b>偏低</b>（约 45~65%），水平线/金属型通常更高。<br>
    · 出品率 = 铸件重量 ÷ 浇注重量 × 100%；铁液重量 = 单件铸件重量 ÷ 出品率。<br>
    · <b>本页数据仅供参考</b>（行业经验典型值，待各厂实际修正）。
  `);

  // 现场实测出品率：默认预填"预估中值"，用户手动改过后不再自动覆盖
  let yieldTouched = false;
  q('#y_yield').addEventListener('input', () => { yieldTouched = true; });

  const ex = installExampleTags(container, ['y_part', 'y_cav']);
  const update = () => {
    const product = q('#y_product').value;
    const process = q('#y_process').value;
    const mat = q('#y_mat').value;
    const res = resolveYield(mat || null, product || null, process || null);
    // 预估区间解析后，若用户还没手填 → 预填中值（用户可改）
    if (!yieldTouched && res.range) {
      const mid = (res.range[0] + res.range[1]) / 2;
      const v = Math.round(mid * 2) / 2;   // 0.5 步进
      if (parseFloat(q('#y_yield').value) !== v) q('#y_yield').value = v;
    }
    const yieldRaw = q('#y_yield').value;
    // PHASE 63 P0-1：② 步数值校验 —— 空/0/负/NaN/Inf 不再静默（件数不再"空→1"）
    const partWt = parseNum(q('#y_part').value);
    const cav = parseInt(q('#y_cav').value, 10);
    const yieldPct = parseNum(yieldRaw);
    let err = firstErr([
      checkNum(q('#y_part').value, { label: t('单件铸件重量'), gt: 0, required: true }),
      checkNum(q('#y_cav').value, { label: t('一模件数'), gt: 0, int: true, required: true }),
      checkNum(yieldRaw, { label: t('现场实测出品率'), gt: 0, max: 100, required: true }),
    ]);
    if (!err && String(yieldRaw).trim() === '' && !res.range) {
      err = t('现场实测出品率未自动预填：请先选择 ① 的产品 / 工艺 / 材质（自动回填预估中值），或直接手填本厂实绩');
    }
    const G = partWt / (yieldPct / 100);   // 单件铁液（err 门禁后保证 >0）
    const md = MATERIALS[mat] || null;

    const estHtml = row(`📊 ${t('预估出品率（参考）')}`, res.range ? `${res.range[0]}~${res.range[1]}` : '—', '%', 'ok', res.basis + ' · ' + t('行业经验参考，非实绩'));
    const calHtml = err ? `
      <div class="empty" style="padding:14px"><span class="empty-sub">⚠️ ${err}</span></div>`
      : `
      <div class="group-title">${t('铁液重量（按现场实测 {p}%）', [fmt(yieldPct, 1)])}</div>
      ${row(`⚖️ ${t('单件铁液重量')}`, fmt(G, 2), 'Kg', 'ok', `${fmt(partWt, 2)} ÷ ${fmt(yieldPct, 1)}%`)}
      ${row(`🔢 ${t('一模铁液总重')}`, fmt(G * cav, 2), 'Kg', '', t('单件铁液 × {n} 件', [cav]))}
      ${row(`🫗 ${t('浇注系统及冒口等非铸件金属重量')}`, fmt(G * cav - partWt * cav, 2), 'Kg', '', t('一模铁液 − 一模铸件重量'))}
      ${md ? row(`📏 ${t('材料密度')}`, md.rho, 'kg/dm³', '', t('估算铁液体积用')) : ''}
      <div class="field-hint" style="padding:8px 4px 0">${t('用于估算一炉铁液用量 / 熔炼配料（配合加料计算）/ 浇包容量。')}</div>`;
    q('#sc_results').innerHTML = `
      ${ex.exampleNote()}
      ${estHtml}
      ${calHtml}`;
  };
  setRecompute(update);   // PHASE 72：语言切换后原地重算（数值不变）
  // 当前工况：造型线/铸造方法 → 预选工艺下拉（垂直线/水平线/金属型 与选项精确对应）
  const yc = getContext();
  if (yc.line) prefillSelect(container, '#y_process', [yc.line]);
  if (yc.method === '金属型') prefillSelect(container, '#y_process', [yc.method]);
  prefillMaterial(container, '#y_mat');   // 当前工况材料 → 预选材质
  bindLive(container, update); update();
}

/* ============ 4. 冷铁计算（激冷厚度 · 失效提醒 · 布置规则） ============ */
// 冷铁材料下拉：只列当前 铸件材质 的可用组合（避免 灰铁×铝冷铁 这种无数据搭配）
const chillMatsOf = (mat) => Object.keys(CHILL_COEF[mat] || {});
export function renderChill(container, calc) {
  const q = shell(container, calc, `
    <div class="field-grid2" style="margin-bottom:12px">
      <div class="field"><label class="field-label">🔩 铸件材质</label><div class="f-row"><select class="field-select" id="ch_mat">${CHILL_MATS.map(k => `<option>${k}</option>`).join('')}</select></div></div>
      <div class="field"><label class="field-label">❄️ 冷铁类型</label><div class="f-row"><select class="field-select" id="ch_type">${CHILL_TYPES.map(k => `<option>${k}</option>`).join('')}</select></div></div>
    </div>
    <div class="field-grid2">
      <div class="field"><label class="field-label">📐 热节壁厚 T</label><div class="f-row"><input class="field-input" type="number" id="ch_T" value="40" step="1" min="1"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">🧊 冷铁材料</label><div class="f-row"><select class="field-select" id="ch_mm">${chillMatsOf('灰铸铁').map(k => `<option>${k}</option>`).join('')}</select></div></div>
    </div>
  `, `
    · <b>为什么内冷是"直径"、外冷是"厚度"？</b>——看冷铁形状：<b>外冷铁</b>是贴在砂型表面的<b>平板/块</b>，贴住铸件的是它的<b>工作面厚度 δ</b>；<b>内冷铁</b>是预埋在铸件型腔内的<b>圆杆/铁丝</b>，截面是圆，所以按<b>直径 d</b> 定；<b>间接冷铁</b>也是平板但隔砂，仍按厚度。三者都由<b>热节壁厚 T</b> 按比例定：<br>
    · <b>外冷铁厚度 δ = 系数 × 热节壁厚 T</b>：灰铁 0.25~0.5、球铁 0.3~0.8、可锻 1.0、铸钢 0.3~0.8、铝 0.8~1.5、铜 0.8~2.0（依冷铁材料）。<br>
    · <b>为什么"铝"和"铁"厚度不一样？</b>——冷铁是<b>靠自身吸热/导热</b>来激冷的，材料不同能力不同：<b>铜冷铁吸热/导热最强</b>（可做薄些，0.2~0.6×T），<b>铸铁/钢板冷铁次之</b>，<b>铝冷铁最弱</b>（蓄热量小，得做厚些才能有同等激冷效果，铝铸件用铝冷铁 1.2~1.5×T）。所以<b>同样厚度、不同材质，激冷效果并不相同</b>——工具按 铸件材质×冷铁材料 分别给系数，切材质时厚度跟着变。<br>
    · <b>内冷铁直径 d ≈ 0.3~0.5×T</b>（一般取热节圆直径的 1/3 左右），须与铸件熔合，除锈去油。<br>
    · <b>失效</b>：壁厚 >100mm 外冷铁失效；间接冷铁挂砂层 >40mm 失效；厚度超过约 1×壁厚激冷饱和（二分之一原则）。<br>
    · <b>布置</b>：冷铁长 ≤300mm、块间留 10~30mm、厚大冷铁工作面 45° 薄口、表面光洁刷涂料、放底部/侧面、不阻塞补缩。<br>
    · <b>口径说明</b>：本工具采用材质组合经验系数法；部分专业资料也采用按冷铁几何厚度直接取系数的方法，两者属于不同计算口径，不应直接混用。<br>
    · <b>工程原则</b>：补缩设计并非只有增大冒口一种方式。通过冷铁、激冷片等措施强化局部冷却，可以改变凝固顺序，降低部分热节的补缩压力。具体方案应结合铸件结构和实际凝固条件确定。<br>
    · <b>激冷片（Chill Pad）</b>：与冷铁同属"强化局部冷却改变凝固顺序"的手段，可用于控制局部热节、在部分情况下减少补缩需求。<b>尺寸参考（书 5.1.2 实验数据）</b>：按该处热节壁厚 T——参考厚度 ≈ 5~10%×T（约 5% 最佳，小于 1/10×T 才有效，过薄无效；接近 0.5×T 冷却与热节平衡、≥1×T 自身成热节），参考长度 ≈ 2×T（更长增益递减）。数据基础为高导热合金（99.9% 纯铝）实验；铸铁/铸钢等低导热合金散热片效果有限，Campbell 建议此类合金优先考虑冷铁，实际应用宜经模拟或首件验证。<br>
    · 数据来源：《铸造工艺设计及应用》· CNKI 冷铁词条（权威）。
  `);

  // 铸件材质切换 → 冷铁材料下拉只保留该材质的可用组合，并默认选推荐材料
  const sync = () => {
    const mat = q('#ch_mat').value;
    const rec = CHILL_DEFAULT_MAT[mat];
    const opts = chillMatsOf(mat);
    const cur = q('#ch_mm').value;
    if (!opts.includes(cur)) {
      q('#ch_mm').innerHTML = opts.map(k => `<option>${k}</option>`).join('');
    }
    if (rec && opts.length) q('#ch_mm').value = rec;
  };

  const ex = installExampleTags(container, ['ch_T']);
  const update = () => {
    // PHASE 63 P0-1：非法输入 → 明确提示
    const err = checkNum(q('#ch_T').value, { label: '热节壁厚 T', gt: 0, required: true });
    if (err) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    const r = runChill({
      mat: q('#ch_mat').value,
      type: q('#ch_type').value,
      T: parseNum(q('#ch_T').value),
      chillMat: q('#ch_mm').value,
    });
    if (!r) { q('#sc_results').innerHTML = '<div class="empty" style="padding:20px"><span class="empty-sub">请填写热节壁厚</span></div>'; return; }
    // 激冷片（Chill Pad，59.txt；60.txt：按书中实验规则给参考尺寸）
    if (r.pad) {
      const p = r.pad;
      q('#sc_results').innerHTML = `
        ${ex.exampleNote()}
        <div class="rrow ok"><span class="rl">🟨 激冷片（Chill Pad）</span><span class="rv">强化局部冷却 · 调整凝固顺序</span></div>
        ${r.padRef ? row('📐 参考厚度（约 5%×T 最佳）', `${r.padRef.thick[0]}~${r.padRef.thick[1]}`, 'mm', 'ok', `该处热节壁厚 T=${r.padRef.T} mm 的 5~10%`) : ''}
        ${r.padRef ? row('📏 参考长度（约 2×T）', r.padRef.len, 'mm', 'ok', `更长增益递减；超过约 0.5×T 厚则失去"片"的作用`) : ''}
        <div class="field-hint" style="padding:8px 4px 0">🧊 <b>工程说明：</b>${p.note}${r.padRef ? '' : '<br>填写上方「热节壁厚 T」后可给出参考厚度与长度。'}</div>
        <div class="field-hint" style="padding:6px 4px 0">${p.tip}</div>
        <div class="field-hint" style="padding:8px 4px 0">📏 ${p.rules.join('<br>📏 ')}</div>
        <div class="field-hint" style="padding:8px 4px 0;color:#94a3b8;font-size:.72rem">${p.source}</div>`;
      return;
    }
    const isInner = r.type === '内冷铁';
    const warnHtml = r.warnings.length
      ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ ${r.warnings.join('<br>⚠️ ')}</div>` : '';
    const thicknessRow = r.thickness
      ? (isInner
          ? row('🔩 内冷铁直径', `${r.thickness[0]}~${r.thickness[1]}`, 'mm', 'ok', '内冷铁是圆杆，定直径 ≈0.3~0.5×T')
          : row('❄️ 外冷铁厚度', `${r.thickness[0]}~${r.thickness[1]}`, 'mm', 'ok', '外冷铁是平板，定厚度 δ=' + r.deltaText))
      : `<div class="empty" style="padding:14px">该组合无厚度系数，请切换冷铁材料</div>`;
    q('#sc_results').innerHTML = `
      ${ex.exampleNote()}
      ${thicknessRow}
      ${isInner ? row('🧊 推荐取中值', fmt(r.mid, 1), 'mm', '', '按需调整') : ''}
      ${!isInner && r.thickness ? row('🔍 推荐取中值', fmt(r.mid, 1), 'mm', '', '首件建议略偏厚保险') : ''}
      ${!isInner ? row('🧊 当前冷铁材料', r.recommendedMat, '', '', '按铸件材质可用组合') : ''}
      ${warnHtml}
      ${r.rules.length ? `<div class="field-hint" style="padding:8px 4px 0">📏 ${r.rules.join('<br>📏 ')}</div>` : ''}`;
  };
  q('#ch_mat').addEventListener('change', () => { sync(); update(); });
  prefillMaterial(container, '#ch_mat');
  sync(); bindLive(container, update); update();
}

/* ============ 5. 3D 砂型吃砂量（埋箱查表 / 裸浇原则 · 砂型最小壁厚） ============ */
export function renderSandbox(container, calc) {
  const q = shell(container, calc, `
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🏗️ 造型方式</label>
      <div class="f-row"><select class="field-select" id="sb_mode">${SB_MODES.map(k => `<option>${k}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">📐 砂型最大轮廓尺寸</label><div class="f-row"><input class="field-input" type="number" id="sb_dim" value="800" step="10" min="10"><span class="f-unit">mm</span></div>
    </div>
    <div id="sb_burrow" class="field" style="margin-bottom:12px">
      <label class="field-label">⚖️ 砂型重量</label><div class="f-row"><input class="field-input" type="number" id="sb_wt" value="300" step="10" min="0"><span class="f-unit">Kg</span></div>
    </div>
    <div id="sb_bare" class="field-grid2" style="margin-bottom:12px;display:none">
      <div class="field"><label class="field-label">📏 铸件高度</label><div class="f-row"><input class="field-input" type="number" id="sb_castH" value="200" step="10" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">💧 静水压头高度</label><div class="f-row"><input class="field-input" type="number" id="sb_headH" value="300" step="10" min="0"><span class="f-unit">mm</span></div></div>
    </div>
  `, `
    · <b>三种壁厚的概念区分（61 批次审计补说明，避免 8/30 混读）</b>：<br>
    &nbsp;&nbsp;· <b>砂型最小壁厚（表5）</b>= 结构可制造/强度下限，任何部位不得低于：轮廓 &lt;100mm → 8mm（小砂型可打印下限）；100~4000mm → 30mm。<br>
    &nbsp;&nbsp;· <b>非承重壁 30mm</b> = 常规设计建议值（砂型自身强度：翻转/施涂/转运），恒取 30，不低于表5 下限。<br>
    &nbsp;&nbsp;· <b>承重壁（表3）</b> = 按 轮廓×重量 查表（40~160mm），是三者中最厚的。<br>
    · <b>埋箱</b>：吃砂量只须满足砂型自身强度（翻转/施涂/转运不变形），承重壁按 轮廓×重量 查<b>表3</b>（下表）：<br>
    <table class="calc-table">
      <tr><th>轮廓 mm</th><th>重量 kg</th><th>承重 mm</th></tr>
      ${SB_BURROW.map(r => `<tr><td>${r.dimLo}~${r.dimHi}</td><td>${r.wtLo}~${r.wtHi}</td><td>${r.load}</td></tr>`).join('')}
    </table>
    · <b>裸浇</b>：须同时满足自身强度 + 浇注抗金属液冲击，按资料公式：<br>
    &nbsp;&nbsp;<b>吃砂量 D = 溃散层(5mm) + (静水压头高度 − 铸件高度)</b>，最低 40mm；<b>底面 = 1.5×D</b>。<br>
    &nbsp;&nbsp;<small>静水压头高度 = 浇口盆（浇杯）液面高度差，侧壁按"压头超出铸件顶面段"的附加压力取均匀厚度（企业规范原表为图示推导，此处为原则换算，基准口径以企业规范为准）。</small><br>
    · <b>适用范围</b>：3D 打印砂型（低强度 6±1MPa、随型轻量化），与常规树脂砂/湿型砂吃砂量不同，勿直接套用。<br>
    · ${SB_NOTE[4]}
  `);

  const syncMode = () => {
    const bare = q('#sb_mode').value === '裸浇';
    q('#sb_burrow').style.display = bare ? 'none' : '';
    q('#sb_bare').style.display = bare ? '' : 'none';
  };

  const ex = installExampleTags(container, ['sb_dim', 'sb_wt', 'sb_castH', 'sb_headH']);
  const update = () => {
    const bare = q('#sb_mode').value === '裸浇';
    // PHASE 63 P0-1：按造型方式校验各自必填数值
    const err = bare
      ? firstErr([
          checkNum(q('#sb_dim').value, { label: '砂型最大轮廓尺寸', gt: 0, required: true }),
          checkNum(q('#sb_castH').value, { label: '铸件高度', gt: 0, required: true }),
          checkNum(q('#sb_headH').value, { label: '静水压头高度', gt: 0, required: true }),
        ])
      : firstErr([
          checkNum(q('#sb_dim').value, { label: '砂型最大轮廓尺寸', gt: 0, required: true }),
          checkNum(q('#sb_wt').value, { label: '砂型重量', gt: 0, required: true }),
        ]);
    if (err) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    const r = runSandbox(bare
      ? { mode: '裸浇', dim: parseNum(q('#sb_dim').value), castH: parseNum(q('#sb_castH').value), headH: parseNum(q('#sb_headH').value) }
      : { mode: '埋箱（树脂砂埋箱）', dim: parseNum(q('#sb_dim').value), wt: parseNum(q('#sb_wt').value) });
    if (!r) { q('#sc_results').innerHTML = '<div class="empty" style="padding:20px"><span class="empty-sub">请填写砂型轮廓尺寸</span></div>'; return; }
    const warnHtml = r.warning ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ ${r.warning}</div>` : '';
    q('#sc_results').innerHTML = `
      ${ex.exampleNote()}
      ${r.load != null ? `
      ${row('🟰 非承重壁厚（设计值）', `${r.noload}`, 'mm', '', '常规 30mm，不低于表5 下限')}
      ${row('🛠️ 承重壁厚', `${r.load}`, 'mm', 'ok', r.basis)}
      ` : bare ? `
      ${row('🛠️ 侧壁吃砂量', `${r.side}`, 'mm', 'ok', r.basis)}
      ${row('⬇️ 底面吃砂量', `${r.bottom}`, 'mm', '', '1.5 × 侧壁')}
      ${row('📏 铸件高度 / 压头', `${r.castH} / ${r.headH}`, 'mm', '', '裸浇须抗金属液冲击')}
      ` : ''}
      ${row('🧱 砂型最小壁厚（下限）', r.minWall == null ? '—' : `${r.minWall}`, 'mm', r.minWall == null ? 'warn' : '', r.minWall == null ? '轮廓超表5 上限，未自动给值' : `表5 · 轮廓 ${r.minWallRange}mm`)}
      ${warnHtml}
      <div class="field-hint" style="padding:8px 4px 0">${bare ? '裸浇芯包轮廓应 ≤1200×1200mm；底面 1.5× 侧壁。' : r.minWall == null ? '' : '埋箱吃砂量已满足自身强度，浇注抗冲击由箱砂承担。'}</div>`;
  };
  q('#sb_mode').addEventListener('change', () => { syncMode(); update(); });
  syncMode(); bindLive(container, update); update();
}

/* ============ 6. 铸件结构工艺性（最小壁厚/临界壁厚/圆角/拔模斜度/最小铸孔） ============ */
export function renderCastability(container, calc) {
  const BATCHES = ['大量生产', '成批生产', '单件小批'];
  const q = shell(container, calc, `
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🔩 材质</label>
      <div class="f-row"><select class="field-select" id="ca_mat">${CAST_MATS.map(k => `<option>${k}</option>`).join('')}</select></div>
    </div>
    <div class="field-grid2">
      <div class="field"><label class="field-label">📏 铸件最大轮廓尺寸</label><div class="f-row"><input class="field-input" type="number" id="ca_size" value="300" step="1" min="1"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">🔁 两相连壁各自厚度 <span class="field-hint" style="display:inline">（算圆角，自动取均值）</span></label><div class="f-row"><input class="field-input" type="number" id="ca_w1" value="10" step="1" min="1" title="第一壁厚度" style="width:90px"><span class="f-unit">×</span><input class="field-input" type="number" id="ca_w2" value="14" step="1" min="1" title="第二壁厚度" style="width:90px"><span class="f-unit">mm</span></div></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🏭 生产批量（算最小铸孔）</label>
      <div class="f-row"><select class="field-select" id="ca_batch">${BATCHES.map(k => `<option>${k}</option>`).join('')}</select></div>
    </div>
    <div class="divider"></div>
    <div class="field-grid3">
      <div class="field"><label class="field-label">📐 起模面高度</label><div class="f-row"><input class="field-input" type="number" id="ca_draftH" value="50" step="1" min="1"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">🧱 模样材质</label><div class="f-row"><select class="field-select" id="ca_draftMold">${DRAFT_MODELS.map(k => `<option>${k}</option>`).join('')}</select></div></div>
      <div class="field"><label class="field-label">⏳ 造型方式</label><div class="f-row"><select class="field-select" id="ca_sand">${DRAFT_SANDS.map(k => `<option>${k}</option>`).join('')}</select></div></div>
    </div>
  `, `
    · <b>最小壁厚</b>按「材质 × 最大轮廓尺寸」查砂型铸造表（铸造工程师手册分档），见下表：<br>
    <table class="calc-table">
      <tr><th>材质</th><th>轮廓≤200</th><th>200~500</th><th>＞500</th></tr>
      ${Object.entries(MIN_WALL_TABLE).map(([m, r]) => `<tr><th>${m}</th><td>${r.s}</td><td>${r.m}</td><td>${r.l}</td></tr>`).join('')}
    </table>
    <small>· <b>分档说明</b>：手册原表按 轮廓 &lt;200 / 200~400 / 400~800 / 800~1250mm 四档，本表简化为三档（以 200/500 为界、中档近似合并）——300~800mm 轮廓附近的精确取值请以手册原文复核；表值为<b>工程经验参考，非标准条文</b>。<br></small>
    · <b>临界壁厚 ≈ 3× 最小壁厚</b>（工程经验参考值，非标准规定）：最小与临界之间为<b>适宜壁厚</b>；超过临界壁厚，厚壁内部补缩困难、易缩松/缩孔，且厚薄过渡处易裂纹——<b>设计上应把壁厚控制在适宜区间</b>，必要时加冷铁/补缩。<br>
    · <b>铸造圆角</b>：填<b>两相连壁各自的厚度</b>（如 T 字筋两腿），工具自动取均值——外圆角取均值 1/5~1/3、内圆角取 1/3~1/2（薄壁件平均值 ≤7mm 时按工艺最小圆角 2/3mm 控制，不随比例继续缩小）；紧靠分型面的垂直壁除外。<br>
    · <b>拔模斜度（JB/T 5105-2022 分档结构）</b>：按「起模面高度 × 模样材质 × 造型方式」查表——粘土砂外壁：金属/塑料模 0°15′~2°20′、木模 0°20′~2°55′（表1）；<b>凹处内表面查独立表2</b>：金属/塑料模 0°30′~4°35′、木模 0°35′~5°45′（值约为表1 的 1.7~2 倍，非简单倍率）。<b>自硬砂（表3）更大</b>：外壁金属/塑料模 0°20′~3°30′、木模 0°25′~4°0′；自硬砂造型时模样<b>凹处内表面</b>允许按表3 值再增 50% 选取（上限授权，工具按允许上限取值作推荐——斜度宁大勿小，卡砂即废件）；金属/塑料模至 5°15′、木模至 6°0′；凹处过深时用活块或砂芯形成。立壁越高斜度越小；木模比金属模大。标准另注：起模困难时可加大，但不应超过表值一倍；机器造型压实比 &gt;700kPa 时允许再增（旧版上限 ≤50%，2022 原文表述未核）。<br>
    · <b>常用砂种 → 两类</b>：JB/T 5105 只区分 <b>粘土砂 / 自硬砂</b> 两档，本工具把常见砂种直接列出来并自动归类——<b>潮模砂/干型砂 → 粘土砂</b>；<b>树脂砂/水玻璃砂/覆膜壳型 → 自硬砂</b>；拿不准选「其他」按粘土砂取小值（宁小勿大）。<br>
    · <b>按造型工艺的快速参考</b>（Casting Assistant 设计规则 · 学习版；精确值仍以 JB/T 5105 为准）：<br>
    <table class="calc-table">
      <tr><th>工艺</th><th>最小</th><th>推荐</th><th>安全</th></tr>
      ${DRAFT_PROCESS.map(p => `<tr><th>${p.process}</th><td>${p.min}</td><td>${p.rec}</td><td>${p.safe}</td></tr>`).join('')}
    </table>
    <b>拔模高度修正</b>：${DRAFT_HEIGHT_ADJ.map(a => `${a.h} → ${a.adj}`).join('；')}。<br>
    · <b>铸造圆角（两种口径）</b>：${FILLET_ALT_NOTE}<br>
    · <b>最小铸孔</b>：砂型按生产批量查表（${METAL_HOLE.note}）。<br>
    · 数据来源：铸造工程师手册（壁厚）+ JB/T 5105-2022（拔模斜度，表1/表2/表3 结构经 2022 目次确认；档位数值经公开资料与 1991 版多源交叉核验一致、2022 前言未列数值修订条目——若未来取得 2022 正式全文发现档位修订，以标准原文为准）+ 机械设计手册（圆角）；知识库「材料 → 结构工艺性」有完整表。
  `);

  const ex = installExampleTags(container, ['ca_size', 'ca_w1', 'ca_w2', 'ca_draftH']);
  const update = () => {
    const mat = q('#ca_mat').value;
    // PHASE 63 P0-1：非法输入 → 明确提示（不再静默清空）
    const err = firstErr([
      checkNum(q('#ca_size').value, { label: '铸件最大轮廓尺寸', gt: 0, required: true }),
      checkNum(q('#ca_w1').value, { label: '第一壁厚度', gt: 0, required: true }),
      checkNum(q('#ca_w2').value, { label: '第二壁厚度', gt: 0, required: true }),
      checkNum(q('#ca_draftH').value, { label: '起模面高度', gt: 0, required: true }),
    ]);
    if (err) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">⚠️ ${err}</span></div>`; return; }
    const size = parseNum(q('#ca_size').value);
    const w1 = parseNum(q('#ca_w1').value);
    const w2 = parseNum(q('#ca_w2').value);
    const avg = (w1 + w2) / 2;
    const batch = q('#ca_batch').value;
    const draftH = parseNum(q('#ca_draftH').value);
    const draftMold = q('#ca_draftMold').value;
    const sandType = q('#ca_sand').value;
    const r = suggestCastability(mat, size, avg, batch, draftH, draftMold, sandType);
    const hole = r.holeRow ? r.holeRow[batch] : null;
    q('#sc_results').innerHTML = `
      ${ex.exampleNote()}
      ${row('📏 最小壁厚建议', r.mw.text, 'mm', 'ok', `${mat} · ${r.mw.bucketLabel}`)}
      ${row('🔺 临界壁厚（≈3×最小）', fmt(r.crit, 1), 'mm', '', '适宜壁厚在两者之间')}
      ${row('🔘 铸造圆角 · 外', 'R' + fmt(r.fillet.outer, 1), 'mm', '', `壁均值 ${fmt(avg,1)}（${w1}+${w2}）/2 · 取 1/5~1/3（${r.fillet.outerRange}）${r.fillet.outer === 2 ? ' · 已达工艺最小圆角 2mm，不随比例缩小' : ''}`)}
      ${row('🔘 铸造圆角 · 内', 'R' + fmt(r.fillet.inner, 1), 'mm', '', `壁均值 ${fmt(avg,1)} · 取 1/3~1/2（${r.fillet.innerRange}）${r.fillet.inner === 3 ? ' · 已达工艺最小圆角 3mm，不随比例缩小' : ''}`)}
      ${row('📐 拔模斜度 · 外壁', r.draft.outer, '', 'ok', `H=${draftH}mm · ${draftMold} · ${sandType} → ${r.draft.cat}${r.draft.outOfRange ? ' · H>1000mm 超常规末档（金属/塑料模标准档止于 1000；木模旧版另有 >1000~2500 续档，2022 修订未核），末档值仅供参考' : ''}`)}
      ${row('📐 拔模斜度 · 凹处内表面', r.draft.inner, '', '', r.draft.cat === '自硬砂' ? '按表3 值 +50%（允许上限，JB/T 5105 第 5 章）' : '查独立表2（约为表1 的 1.7~2 倍）')}
      ${row('📐 拔模斜度 · 铸孔', '1°~4°', '', '', '工程经验参考（无孔深输入，仅提示范围）；精确值按外/内壁行查 JB/T 5105')}
      ${hole
        ? row('🕳️ 最小铸出孔', hole, 'mm', '', `${batch} · ${mat}`)
        : row('🕳️ 最小铸出孔', '—', '', '', '砂型常规孔径见表，孔小留钻')}
      ${mat === '灰铸铁(HT)' ? `<div class="field-hint" style="padding:8px 4px 0"><b>灰铁按牌号最小壁厚</b>：${Object.entries(HT_MIN_WALL_BY_GRADE).map(([k, v]) => `${k} ${v}mm`).join(' · ')}</div>` : ''}
      <div class="field-hint" style="padding:8px 4px 0">${MIN_HOLE_NOTE}</div>
      ${r.tip ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--warning,#B45309)">💡 <b>${mat} 设计提示</b>：${r.tip}</div>` : ''}`;
  };
  prefillMaterial(container, '#ca_mat');  // 当前工况材料 → 预选材质
  bindLive(container, update); update();
}
