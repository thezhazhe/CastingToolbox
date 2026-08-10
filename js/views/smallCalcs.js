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

const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));

/* ---- 通用外壳：单列居中 ---- */
function shell(container, calc, formHtml, sourceHtml) {
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
          <div class="section-card-title"><span class="step-badge">1</span>📋 输入</div>
          ${formHtml}
        </div>
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 结果</div>
          <div class="results" id="sc_results"><div class="empty" style="padding:26px"><span class="empty-sub">填写参数后自动计算…</span></div></div>
        </div>
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 说明与依据</div>
          <div class="field-hint" style="line-height:1.8">${sourceHtml}</div>
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
      <label class="field-label">🔩 材质</label>
      <div class="f-row"><select class="field-select" id="s_mat">
        ${Object.keys(SHRINKAGE).map(k => `<option>${k}</option>`).join('')}
      </select><span class="f-unit" id="s_hint" style="width:auto"></span></div>
    </div>
    <div class="field" style="margin-bottom:14px">
      <label class="field-label">🧱 收缩档位</label>
      <div class="f-row"><select class="field-select" id="s_mode">
        <option value="free">自由收缩（开放结构、少阻碍）</option>
        <option value="common" selected>常用值（生产·模具缩尺）</option>
        <option value="restrained">受阻收缩（有筋板/法兰/型芯/内腔/结构复杂）</option>
      </select></div>
    </div>
    <div class="field-grid3">
      <div class="field"><label class="field-label">📏 方向 X（长）</label><div class="f-row"><input class="field-input" type="number" id="s_d1" value="500" step="1" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">📏 方向 Y（宽）</label><div class="f-row"><input class="field-input" type="number" id="s_d2" value="300" step="1" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">📏 方向 Z（高）</label><div class="f-row"><input class="field-input" type="number" id="s_d3" value="150" step="1" min="0"><span class="f-unit">mm</span></div></div>
    </div>
  `, `
    · <b>为什么 1% 还是 0.8%？</b>同一种材料没有唯一收缩率：自由收缩（开放结构）最大，受阻收缩（有筋板/法兰/型芯/内腔）最小，常用值（生产模具缩尺）在两者之间。<b>选档位即选条件</b>。<br>
    · <b>按方向推荐</b>：按<b>绝对尺寸锚定</b>——方向尺寸 <b>≥${SIZE_LARGE}mm 取档位上限</b>（阻碍相对小），<b>≤${SIZE_SMALL}mm 取档位下限</b>（薄壁小件受约束、收缩小），之间线性过渡。<br>
    · <b>率 vs 绝对量</b>：收缩率是<b>"率"</b>，同材同约束下与尺寸大小关系不大（1500mm 与 10mm 同约 1%）；真正拉开差距的是<b>绝对放尺量</b>——1500×1%=15mm、10×1%=0.1mm，一个方向多放 15mm、另一个只放 0.1mm，这才是方向差异的实质。<br>
    · <b>分开放缩水</b>：各方向推荐率差 <b>≥${SPLIT_RATE_DIFF}%</b> 时，不宜用统一综合比例，需按方向分别放尺（X/Y/Z 分开缩放）；差得小就给一个总的比例。<br>
    · <b>砂型退让性</b>：退让性好（湿型/水玻璃砂）收缩率取大；深内腔/长芯头/芯骨处阻碍大，模型该方向要多放一点（按受阻值）。<br>
    · 数据来源：三档参考《木模结构工艺》《铸钢手册》《金属液态成型原理》；方向性推荐为工程经验做法（参考值，以生产试制修正为准）。
  `);

  const sync = () => {
    const d = SHRINKAGE[q('#s_mat').value];
    q('#s_hint').textContent = `${d.range} · 自由${d.free} / 常用${d.common} / 受阻${d.restrained}`;
  };

  const update = () => {
    const mat = q('#s_mat').value;
    const mode = q('#s_mode').value;
    const dims = [parseFloat(q('#s_d1').value) || 0, parseFloat(q('#s_d2').value) || 0, parseFloat(q('#s_d3').value) || 0];
    const r = calcShrinkageDir(mat, dims, mode);
    const d = SHRINKAGE[mat];
    const names = ['方向 X', '方向 Y', '方向 Z'];
    const tips = {
      free: '已按自由收缩取值（开放结构、少阻碍）。若铸件有内腔/型芯/筋板阻碍，请改选"常用值"或"受阻收缩"。',
      common: '已按常用生产值取值（模具缩尺常用档）。结构复杂请改选"受阻收缩"。',
      restrained: '已按受阻收缩取值（有筋板/法兰/型芯等阻碍）。受阻处模型可再按局部多放 0.1~0.2%。',
    };
    if (!r) { q('#sc_results').innerHTML = '<div class="empty" style="padding:20px"><span class="empty-sub">请填写至少一个方向尺寸</span></div>'; return; }
    const dirRows = r.dirs.map((row_, i) =>
      row('📐 ' + names[i] + ' 收缩率', `${row_.rate.toFixed(2)}`, '%', i === 0 ? 'ok' : '', `${row_.size}mm × ${row_.rate.toFixed(2)}% → 放尺 ${fmt(row_.pattern, 2)}mm`));
    const combinedHtml = r.directional
      ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ 各方向推荐率差 <b>${r.spread.toFixed(2)}% ≥ ${SPLIT_RATE_DIFF}%</b>，<b>不宜用统一综合比例</b>——请分方向放缩水（X/Y/Z 分别放尺）。</div>`
      : row('📏 综合比例（整体放尺）', fmt(r.combined, 2), '%', 'ok', SHRINK_MODE_LABEL[mode] + ' · 方向均衡可直接用');
    q('#sc_results').innerHTML = `
      ${row('📏 档位说明', SHRINK_MODE_LABEL[mode], '', '', d.range)}
      ${dirRows.join('')}
      ${combinedHtml}
      <div class="field-hint" style="padding:8px 4px 0">${tips[mode]}<br>${d.note}</div>`;
  };
  prefillMaterial(container, '#s_mat');   // 当前工况材料 → 预选材质
  sync(); bindLive(container, update); update();
}

/* ============ 2. 加工余量（等级自动→余量范围 · 顶底面分级 · 无推荐则诚实提示） ============ */
export function renderMachining(container, calc) {
  const q = shell(container, calc, `
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🏭 铸造方法</label>
      <div class="f-row"><select class="field-select" id="m_method">${Object.keys(METHOD_GRADES).map(k => `<option>${k}</option>`).join('')}</select></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🔩 材质</label>
      <div class="f-row"><select class="field-select" id="m_mat"><option>灰铸铁</option><option>球铁</option><option>铸钢</option><option>铝合金</option><option>铜合金</option></select><span class="f-unit" id="m_rec" style="width:auto"></span></div>
    </div>
    <div class="field">
      <label class="field-label">📏 铸件最大轮廓尺寸（最终加工后）</label>
      <div class="f-row"><input class="field-input" type="number" id="m_size" value="300" step="1" min="1"><span class="f-unit">mm</span></div>
    </div>
  `, `
    · <b>余量由标准自动推荐，无需选等级</b>：按「铸造方法 + 材质」查 GB/T 6414 推荐等级区间，结果直接给<b>单侧余量范围</b>，等级仅供了解。<br>
    · <b>熔模铸造不收录</b>：其加工余量极小、由精度要求直接定，GB/T 6414 无标准 RMA 等级——<b>宁缺毋滥</b>。<br>
    · <b>顶面比底/侧面粗一级</b>：砂型铸件顶面（浇注位置朝上）气孔/夹杂多，加工余量等级比底/侧面<b>低一级</b>（余量更大）。<br>
    · <b>小加工面</b>：RMA 是按"铸件最大轮廓尺寸"查表给出的<b>单侧最小余量</b>；局部小加工面（如凸台、小孔）实际可适当减小，但不得小于该值，否则加工后可能留黑皮。<br>
    · <b>圆柱/双侧加工</b>：余量×2。<br>
    · <b>实战提示</b>：RMA 是标准<b>最小</b>余量；考虑变形、错芯、清砂，工厂实际常按 RMA 的 <b>1.5~2 倍</b>留余量，重要面建议放大 1~2 级。<br>
    · 数据：GB/T 6414-1999《铸件 尺寸公差与机械加工余量》（个别数值待复核）。<br>
    · <b>GB/T 6414 单侧余量表（按最大轮廓尺寸 × 等级 RMA）</b>：<br>
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
      ? `推荐等级 ${rec}（余量范围见结果）`
      : `此 工艺×材质 无标准等级`;
  };

  const update = () => {
    syncRec();
    const size = parseFloat(q('#m_size').value) || 0;
    const method = q('#m_method').value;
    const mat = matKeyMap[q('#m_mat').value];
    const rec = methodGradeRec(method, mat);
    if (size <= 0) { q('#sc_results').innerHTML = ''; return; }
    if (!rec) {
      q('#sc_results').innerHTML = `
        <div class="empty" style="padding:20px">
          <span class="empty-sub">「${method}」+「${q('#m_mat').value}」无标准 RMA 等级（GB/T 6414 未给出）。</span>
        </div>
        <div class="field-hint" style="padding:8px 4px 0">该组合余量请按本厂工艺/图纸直接定（如压铸余量极小、多为不加工或精加工），<b>宁缺毋滥</b>。</div>`;
      return;
    }
    const range = rmaRange(size, rec);
    if (!range) { q('#sc_results').innerHTML = `<div class="empty" style="padding:20px"><span class="empty-sub">尺寸超出表范围（>10000mm）</span></div>`; return; }
    const grades = range.grades;
    const grade = grades[Math.floor((grades.length - 1) / 2)] || grades[0];   // 取中档展示顶面
    const top = lookupRMA(size, nextCoarserGrade(grade));
    const isSand = method.includes('砂型');
    q('#sc_results').innerHTML = `
      ${row('📏 单侧余量范围', `${fmt(range.min, 1)}~${fmt(range.max, 1)}`, 'mm', 'ok', `等级 ${grades.join('~')} · 尺寸档 ${lookupRMA(size, grade).range}`)}
      ${row('🎯 推荐取值（中档）', fmt(range.mid, 1), 'mm', '', `等级 ${grade}`)}
      ${isSand && top ? row('🔺 顶面单侧（粗一级）', fmt(top.value, 1), 'mm', '', `等级 ${nextCoarserGrade(grade)}`) : ''}
      ${row('🔁 圆柱 / 双侧加工', fmt(range.mid * 2, 1), 'mm', '', '单侧 ×2')}
      <div class="field-hint" style="padding:8px 4px 0">RMA 是标准<b>最小</b>余量：考虑变形/错芯/清砂，工厂实际常按 <b>1.5~2 倍</b>留；重要面再放大 1~2 级。小加工面可按该面自身尺寸另查一档，但主加工面一律按最大轮廓尺寸。</div>`;
  };
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
    <div class="section-card-title" style="margin-bottom:10px"><span class="step-badge">A</span>📊 ① 预估出品率</div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">📦 产品类型 <span class="field-hint" style="display:inline">（可不选，选得越细越准）</span></label>
      <div class="f-row"><select class="field-select" id="y_product">
        <option value="">不指定</option>
        ${Object.keys(PRODUCT_YIELD).map(k => `<option>${k}</option>`).join('')}
      </select></div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label class="field-label">🏭 铸造工艺 / 产线</label>
      <div class="f-row"><select class="field-select" id="y_process">
        <option value="">不指定</option>
        ${YIELD_PROCESSES.map(k => `<option>${k}</option>`).join('')}
      </select></div>
    </div>
    <div class="field">
      <label class="field-label">🔩 材质</label>
      <div class="f-row"><select class="field-select" id="y_mat">
        <option value="">不指定</option>
        ${Object.keys(MATERIALS).map(k => `<option>${k}</option>`).join('')}
      </select></div>
    </div>
    <div class="divider" style="margin:14px 0"></div>
    <div class="section-card-title" style="margin-bottom:10px"><span class="step-badge">B</span>⚖️ ② 现场实测 → 铁液重量</div>
    <div class="field-grid3">
      <div class="field"><label class="field-label">⚖️ 单件毛重</label><div class="f-row"><input class="field-input" type="number" id="y_part" value="50" step="0.1" min="0"><span class="f-unit">Kg</span></div></div>
      <div class="field"><label class="field-label">🔢 一模件数</label><div class="f-row"><input class="field-input" type="number" id="y_cav" value="2" step="1" min="1"><span class="f-unit">件</span></div></div>
      <div class="field"><label class="field-label">📊 现场实测出品率 <span class="field-hint" style="display:inline">（默认=预估中值，请改为本厂实绩）</span></label><div class="f-row"><input class="field-input" type="number" id="y_yield" step="0.5" min="1" max="100" placeholder="自动填预估中值"><span class="f-unit">%</span></div></div>
    </div>
  `, `
    · <b>两步走</b>：第 ① 步输入 产品/工艺/材质 → 得<b>预估出品率区间</b>（行业经验参考）；第 ② 步<b>现场实测出品率默认自动预填预估中值</b>，<b>请改成贵厂本批实绩</b>（改一次即记住，不再被覆盖）→ 铁液/浇冒口重量按它计算。<br>
    · <b>为什么分两步</b>：出品率受浇冒口设计、工艺水平、设备影响，<b>各厂各件差异很大</b>——预估是"参考值"，算铁液、配炉料必须用本厂实测值。<br>
    · <b>回退规则</b>：优先「产品×工艺」→「材质×工艺」→「工艺」→「材质」→ 通用，只显示一个最准结果。产品少见可以不选，用材质+工艺参考。<br>
    · 垂直线（DISA）一般出品率<b>偏低</b>（约 45~65%），水平线/金属型通常更高。<br>
    · 出品率 = 铸件重量 ÷ 浇注重量 × 100%；铁液重量 = 单件毛重 ÷ 出品率。<br>
    · <b>本页数据仅供参考</b>（行业经验典型值，待各厂实际修正）。
  `);

  // 现场实测出品率：默认预填"预估中值"，用户手动改过后不再自动覆盖
  let yieldTouched = false;
  q('#y_yield').addEventListener('input', () => { yieldTouched = true; });

  const update = () => {
    const product = q('#y_product').value;
    const process = q('#y_process').value;
    const mat = q('#y_mat').value;
    const partWt = parseFloat(q('#y_part').value) || 0;
    const cav = parseInt(q('#y_cav').value) || 1;
    const res = resolveYield(mat || null, product || null, process || null);
    // 预估区间解析后，若用户还没手填 → 预填中值（用户可改）
    if (!yieldTouched && res.range) {
      const mid = (res.range[0] + res.range[1]) / 2;
      const v = Math.round(mid * 2) / 2;   // 0.5 步进
      if (parseFloat(q('#y_yield').value) !== v) q('#y_yield').value = v;
    }
    const yieldPct = parseFloat(q('#y_yield').value) || 0;   // 现场实测（默认=预估中值，可改）
    const G = partWt > 0 && yieldPct > 0 ? partWt / (yieldPct / 100) : 0;   // 单件铁液
    const md = MATERIALS[mat] || null;

    q('#sc_results').innerHTML = `
      ${row('📊 预估出品率（参考）', `${res.range[0]}~${res.range[1]}`, '%', 'ok', res.basis + ' · 行业经验参考，非实绩')}
      ${yieldPct > 0 ? `
      <div class="group-title">铁液重量（按现场实测 ${fmt(yieldPct, 1)}%）</div>
      ${row('⚖️ 单件铁液重量', fmt(G, 2), 'Kg', 'ok', `${partWt} ÷ ${yieldPct}%`)}
      ${row('🔢 一模铁液总重', fmt(G * cav, 2), 'Kg', '', `单件铁液 × ${cav} 件`)}
      ${row('🫗 一模浇冒口重量', fmt(G * cav - partWt * cav, 2), 'Kg', '', '一模铁液 − 一模铸件')}
      ${md ? row('📏 材料密度', md.rho, 'kg/dm³', '', '估算铁液体积用') : ''}
      <div class="field-hint" style="padding:8px 4px 0">用于估算一炉铁液用量 / 熔炼配料（配合加料计算）/ 浇包容量。</div>
      ` : `<div class="field-hint" style="padding:8px 4px 0">请先选择 ① 的产品 / 工艺 / 材质，现场实测出品率会自动预填预估中值（可改）。</div>`}
    `;
  };
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

  const update = () => {
    const r = runChill({
      mat: q('#ch_mat').value,
      type: q('#ch_type').value,
      T: parseFloat(q('#ch_T').value) || 0,
      chillMat: q('#ch_mm').value,
    });
    if (!r) { q('#sc_results').innerHTML = '<div class="empty" style="padding:20px"><span class="empty-sub">请填写热节壁厚</span></div>'; return; }
    const isInner = r.type === '内冷铁';
    const warnHtml = r.warnings.length
      ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ ${r.warnings.join('<br>⚠️ ')}</div>` : '';
    const thicknessRow = r.thickness
      ? (isInner
          ? row('🔩 内冷铁直径', `${r.thickness[0]}~${r.thickness[1]}`, 'mm', 'ok', '内冷铁是圆杆，定直径 ≈0.3~0.5×T')
          : row('❄️ 外冷铁厚度', `${r.thickness[0]}~${r.thickness[1]}`, 'mm', 'ok', '外冷铁是平板，定厚度 δ=' + r.deltaText))
      : `<div class="empty" style="padding:14px">该组合无厚度系数，请切换冷铁材料</div>`;
    q('#sc_results').innerHTML = `
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
    · <b>埋箱</b>：吃砂量只须满足砂型自身强度（翻转/施涂/转运不变形），非承重壁 30mm 恒定，承重壁按 轮廓×重量 查<b>表3</b>。<br>
    <table class="calc-table">
      <tr><th>轮廓 mm</th><th>重量 kg</th><th>承重 mm</th></tr>
      ${SB_BURROW.map(r => `<tr><td>${r.dimLo}~${r.dimHi}</td><td>${r.wtLo}~${r.wtHi}</td><td>${r.load}</td></tr>`).join('')}
    </table>
    · <b>裸浇</b>：须同时满足自身强度 + 浇注抗金属液冲击，按资料公式：<br>
    &nbsp;&nbsp;<b>吃砂量 D = 溃散层(5mm) + (静水压头高度 − 铸件高度)</b>，最低 40mm；<b>底面 = 1.5×D</b>。<br>
    · <b>砂型最小壁厚（表5）</b>：轮廓 &lt;100mm → 8mm；100~4000mm → 30mm。<br>
    · <b>适用范围</b>：3D 打印砂型（低强度 6±1MPa、随型轻量化），与常规树脂砂/湿型砂吃砂量不同，勿直接套用。<br>
    · ${SB_NOTE[4]}
  `);

  const syncMode = () => {
    const bare = q('#sb_mode').value === '裸浇';
    q('#sb_burrow').style.display = bare ? 'none' : '';
    q('#sb_bare').style.display = bare ? '' : 'none';
  };

  const update = () => {
    const bare = q('#sb_mode').value === '裸浇';
    const r = runSandbox(bare
      ? { mode: '裸浇', dim: parseFloat(q('#sb_dim').value) || 0, castH: parseFloat(q('#sb_castH').value) || 0, headH: parseFloat(q('#sb_headH').value) || 0 }
      : { mode: '埋箱（树脂砂埋箱）', dim: parseFloat(q('#sb_dim').value) || 0, wt: parseFloat(q('#sb_wt').value) || 0 });
    if (!r) { q('#sc_results').innerHTML = '<div class="empty" style="padding:20px"><span class="empty-sub">请填写砂型轮廓尺寸</span></div>'; return; }
    const warnHtml = r.warning ? `<div class="field-hint" style="padding:8px 4px 0;color:var(--danger,#DC2626)">⚠️ ${r.warning}</div>` : '';
    q('#sc_results').innerHTML = `
      ${r.load != null ? `
      ${row('🟰 非承重壁厚', `${r.noload}`, 'mm', '', '恒定值')}
      ${row('🛠️ 承重壁厚', `${r.load}`, 'mm', 'ok', r.basis)}
      ` : bare ? `
      ${row('🛠️ 侧壁吃砂量', `${r.side}`, 'mm', 'ok', r.basis)}
      ${row('⬇️ 底面吃砂量', `${r.bottom}`, 'mm', '', '1.5 × 侧壁')}
      ${row('📏 铸件高度 / 压头', `${r.castH} / ${r.headH}`, 'mm', '', '裸浇须抗金属液冲击')}
      ` : ''}
      ${row('🧱 砂型最小壁厚', `${r.minWall}`, 'mm', '', '轮廓 ' + (r.dim < 100 ? '<100' : '100~4000') + 'mm')}
      ${warnHtml}
      <div class="field-hint" style="padding:8px 4px 0">${bare ? '裸浇芯包轮廓应 ≤1200×1200mm；底面 1.5× 侧壁。' : '埋箱吃砂量已满足自身强度，浇注抗冲击由箱砂承担。'}</div>`;
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
    · <b>临界壁厚 ≈ 3× 最小壁厚</b>：最小与临界之间为<b>适宜壁厚</b>；超过临界壁厚，厚壁内部补缩困难、易缩松/缩孔，且厚薄过渡处易裂纹——<b>设计上应把壁厚控制在适宜区间</b>，必要时加冷铁/补缩。<br>
    · <b>铸造圆角</b>：填<b>两相连壁各自的厚度</b>（如 T 字筋两腿），工具自动取均值——外圆角取均值 1/5~1/3、内圆角取 1/3~1/2；紧靠分型面的垂直壁除外。<br>
    · <b>拔模斜度（JB/T 5105-2022）</b>：按「起模面高度 × 模样材质 × 造型方式」分档查表——粘土砂外壁 0°20′~2°20′、内壁 0°30′~4°35′；<b>自硬砂更大</b>（外壁 0°20′~3°30′，内壁再 +50%）。立壁越高斜度越小；木模比金属模大。<br>
    · <b>常用砂种 → 两类</b>：JB/T 5105 只区分 <b>粘土砂 / 自硬砂</b> 两档，本工具把常见砂种直接列出来并自动归类——<b>潮模砂/干型砂 → 粘土砂</b>；<b>树脂砂/水玻璃砂/覆膜壳型 → 自硬砂</b>；拿不准选「其他」按粘土砂取小值（宁小勿大）。<br>
    · <b>按造型工艺的快速参考</b>（Casting Assistant 设计规则 · 学习版；精确值仍以 JB/T 5105 为准）：<br>
    <table class="calc-table">
      <tr><th>工艺</th><th>最小</th><th>推荐</th><th>安全</th></tr>
      ${DRAFT_PROCESS.map(p => `<tr><th>${p.process}</th><td>${p.min}</td><td>${p.rec}</td><td>${p.safe}</td></tr>`).join('')}
    </table>
    <b>拔模高度修正</b>：${DRAFT_HEIGHT_ADJ.map(a => `${a.h} → ${a.adj}`).join('；')}。<br>
    · <b>铸造圆角（两种口径）</b>：${FILLET_ALT_NOTE}<br>
    · <b>最小铸孔</b>：砂型按生产批量查表（${METAL_HOLE.note}）。<br>
    · 数据来源：铸造工程师手册（壁厚）+ JB/T 5105-2022（拔模斜度）+ 机械设计手册（圆角）；知识库「材料 → 结构工艺性」有完整表。
  `);

  const update = () => {
    const mat = q('#ca_mat').value;
    const size = parseFloat(q('#ca_size').value) || 0;
    const w1 = parseFloat(q('#ca_w1').value) || 0;
    const w2 = parseFloat(q('#ca_w2').value) || 0;
    const avg = (w1 + w2) / 2;
    const batch = q('#ca_batch').value;
    const draftH = parseFloat(q('#ca_draftH').value) || 50;
    const draftMold = q('#ca_draftMold').value;
    const sandType = q('#ca_sand').value;
    if (size <= 0 || avg <= 0) { q('#sc_results').innerHTML = ''; return; }
    const r = suggestCastability(mat, size, avg, batch, draftH, draftMold, sandType);
    const hole = r.holeRow ? r.holeRow[batch] : null;
    q('#sc_results').innerHTML = `
      ${row('📏 最小壁厚建议', r.mw.text, 'mm', 'ok', `${mat} · ${r.mw.bucketLabel}`)}
      ${row('🔺 临界壁厚（≈3×最小）', fmt(r.crit, 1), 'mm', '', '适宜壁厚在两者之间')}
      ${row('🔘 铸造圆角 · 外', 'R' + fmt(r.fillet.outer, 1), 'mm', '', `壁均值 ${fmt(avg,1)}（${w1}+${w2}）/2 · 取 1/5~1/3（${r.fillet.outerRange}）`)}
      ${row('🔘 铸造圆角 · 内', 'R' + fmt(r.fillet.inner, 1), 'mm', '', `壁均值 ${fmt(avg,1)} · 取 1/3~1/2（${r.fillet.innerRange}）`)}
      ${row('📐 拔模斜度 · 外壁', r.draft.outer, '', 'ok', `H=${draftH}mm · ${draftMold} · ${sandType} → ${r.draft.cat}`)}
      ${row('📐 拔模斜度 · 内壁', r.draft.inner, '', '', r.draft.cat === '自硬砂' ? '自硬砂内壁 = 表值 +50%' : '内壁摩擦大，高于外壁')}
      ${row('📐 拔模斜度 · 铸孔', '1°~4°', '', '', '高于外壁，按孔深定（JB/T 5105）')}
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
