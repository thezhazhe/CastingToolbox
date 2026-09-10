// ============================================================
// Campbell 浇注系统速算 · 视图（65.1/65.2/65.3/70/71 布局）
// 输入（上半）：材料 / 单件重量 / 主体壁厚 / 一模件数 / 内浇口数量(单件)
// 结果卡内编辑（随结果就近填写，用户可改）：内浇口厚度 t、横浇道高度 h
// → 500/1000 主方法 + 速度内部校验自动放大 → 唯一最终推荐
// ============================================================
import { runCampbellGating, CAMPBELL_GATE_SPEED, CAMPBELL_RULE_MM2_PER_KGS, RULE_GROUP, MAX_TOTAL_GATES } from '../../calcs/campbellGating.js';
import { MATERIALS } from '../../calcs/gating.js';
import { renderNextSteps } from './nextSteps.js';
import { checkNum, firstErr, parseNum } from './numcheck.js';
import { installExampleTags } from './exampleTag.js';

const row = (label, value, unit, cls = '', note = '') =>
  `<div class="rrow ${cls}"><span class="rl">${label}</span><span class="rv">${value}${unit ? `<span class="ru">${unit}</span>` : ''}${note ? `<span class="rf">${note}</span>` : ''}</span></div>`;
const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));
const KB = (id, text) => `<a class="chip kb-chip" href="#/search/${id}" style="cursor:pointer;text-decoration:none">${text} ⓘ</a>`;

const DEFAULTS = { w: 10, wall: 20, cavity: 1, n: 4 };

export function renderCampbell(container, calc) {
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
          <div class="section-card-title"><span class="step-badge">1</span>📋 输入 <small>已填示例值，改成你的产品即自动重算</small></div>
          <div class="field" style="margin-bottom:12px">
            <label class="field-label">🔩 材料</label>
            <div class="f-row"><select class="field-select" id="cg_mat">
              ${Object.keys(MATERIALS).map(k => `<option>${k}</option>`).join('')}
            </select><span class="f-unit" id="cg_rule" style="width:auto"></span></div>
            <div class="field-hint" id="cg_speedNote" style="margin-top:2px"></div>
          </div>
          <div class="field-grid2" style="margin-bottom:12px">
            <div class="field"><label class="field-label">⚖️ 单件铸件重量</label><div class="f-row"><input class="field-input" type="number" id="cg_w" value="${DEFAULTS.w}" step="0.1" min="0"><span class="f-unit">kg</span></div><div class="field-hint" style="margin-top:2px">不含浇冒口，含加工余量</div></div>
            <div class="field"><label class="field-label">📐 主体（代表性）壁厚 <span class="field-hint" style="display:inline">（≈ 平均壁厚）</span></label><div class="f-row"><input class="field-input" type="number" id="cg_wall" value="${DEFAULTS.wall}" step="0.5" min="0"><span class="f-unit">mm</span></div><div class="field-hint" style="margin-top:2px">按平均壁厚取，进入浇注时间模型分档</div></div>
          </div>
          <div class="field-grid2">
            <div class="field"><label class="field-label">🔢 一模件数</label><div class="f-row"><input class="field-input" type="number" id="cg_cav" value="${DEFAULTS.cavity}" step="1" min="1" max="64" style="width:120px"><span class="f-unit">件/模</span></div><div class="field-hint" style="margin-top:2px">一模同时浇几个铸件（浇注重量按 单件 × 件数）</div></div>
            <div class="field"><label class="field-label">🔢 内浇口数量 <span class="field-hint" style="display:inline">（单件）</span></label><div class="f-row"><input class="field-input" type="number" id="cg_n" value="${DEFAULTS.n}" step="1" min="1" max="64" style="width:120px"><span class="f-unit">个/件</span></div><div class="field-hint" style="margin-top:2px">每个铸件的内浇口数；按 总口数（件数×口数）组织 1:1:n</div></div>
          </div>
        </div>

        <!-- 结果卡：固定骨架 + 分区刷值（编辑行不随重算重建，输入不丢焦点） -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📊 计算结果</div>
          <div class="results" id="cg_head"></div>

          <div class="group-title" style="margin-top:14px">内浇口尺寸</div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">📐 内浇口厚度 t <span class="field-hint" style="display:inline">（可改）</span></label>
            <div class="f-row"><input class="field-input" type="number" id="cg_t" step="1" min="1" style="width:110px"><span class="f-unit">mm</span><span class="f-unit" style="width:auto" id="cg_tMeta"></span></div>
          </div>
          <div class="results" id="cg_gate"></div>

          <div class="group-title" id="cg_sysTitle" style="margin-top:14px"></div>
          <div class="results" id="cg_sprue"></div>
          <div class="field" style="margin:10px 0 8px">
            <label class="field-label">📐 横浇道高度 h <span class="field-hint" style="display:inline">（可改）</span></label>
            <div class="f-row"><input class="field-input" type="number" id="cg_rh" step="1" min="1" style="width:110px"><span class="f-unit">mm</span><span class="f-unit" style="width:auto" id="cg_rhMeta"></span></div>
          </div>
          <div class="results" id="cg_runner"></div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 说明与依据</div>
          <div class="field-hint" style="line-height:1.8">
            · <b>定位</b>：浇注系统速算（流量—进浇面积思想），不是完整浇注系统设计器，也不替代现有浇注系统计算器。<br>
            · <b>主方法</b>：<b>500/1000 经验规则</b>——轻合金 1000 / 重合金 500 mm² 内浇口面积 每 (kg/s)：总内浇口面积 = 质量流率 × 规则值。速度校验在程序内部完成（超目标自动放大），你只看到最终一个推荐结果。${KB('campbell_quick_rule_500_1000', '规则说明 ⓘ')}<br>
            · <b>速度依据</b>：灰铁 1.0 / 球铁 0.5 = 用户确认的工程设定；铝 0.5 = Campbell 明确；钢 0.5 = Campbell 算例目标；铜及铜合金 0.5 = 工程参考值（文献口径）。全部 ENGINEERING_REFERENCE。${KB('campbell_speed_critical', '速度思想 ⓘ')}<br>
            · <b>1:1:n</b>：直浇道底部 : 横浇道 : 总内浇口面积 = 1 : 1 : n（n = 总内浇口数 = 一模件数 × 单件口数）——基准为 V1 简化：Runner ≈ Sprue 出口；<b>Runner 实际参考面积取 Sprue 的 ×1.2 略大</b>（弯角摩擦裕度，仍循"尽可能小"）。${KB('campbell_ratio_1_1_n', '比例原意 ⓘ')}<br>
            · <b>直浇道高度</b>：速算给 Sprue 出口有效面积与对应直径；具体高度与实际液面/浇包位置/模具布置有关（v=√(2gh)）。<br>
            · <b>未覆盖</b>：过滤器/涌流冒口/扇形内浇口等独立减速机构不参与计算（见"工艺提示"）。<br>
            · 证据：全部数值/规则为 ENGINEERING REFERENCE（工程方法/经验），非标准条文。
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });
  const q = (id) => container.querySelector(id);
  const ex = installExampleTags(container, ['cg_w', 'cg_wall', 'cg_cav', 'cg_n']);
  let tTouched = false, rhTouched = false;
  q('#cg_t').addEventListener('input', () => { tTouched = true; });
  q('#cg_rh').addEventListener('input', () => { rhTouched = true; });
  const tMin = (wall) => Math.max(1, Math.floor(wall / 2));

  const syncMeta = () => {
    const mat = q('#cg_mat').value;
    const rule = CAMPBELL_RULE_MM2_PER_KGS[mat] ?? 500;
    const sp = CAMPBELL_GATE_SPEED[mat] || CAMPBELL_GATE_SPEED['灰铁(HT)'];
    q('#cg_rule').textContent = `${RULE_GROUP[mat] || '重合金'} · ${rule} mm²/(kg/s) · 目标 ${sp.v.toFixed(1)} m/s`;
    q('#cg_speedNote').textContent = `速度依据：${sp.provLabel}。${sp.provNote}`;
  };

  const update = () => {
    syncMeta();
    const wallRaw = q('#cg_wall').value;
    const wallNum = parseNum(wallRaw);
    if (!tTouched && wallNum > 0) {
      const m = tMin(wallNum);
      if (String(q('#cg_t').value).trim() !== String(m)) q('#cg_t').value = m;
    }
    const rhRaw = String(q('#cg_rh').value).trim();
    const err = firstErr([
      checkNum(q('#cg_w').value, { label: '单件铸件重量', gt: 0, required: true }),
      checkNum(wallRaw, { label: '主体（代表性）壁厚', gt: 0, required: true }),
      checkNum(q('#cg_cav').value, { label: '一模件数', gt: 0, max: 64, int: true, required: true }),
      checkNum(q('#cg_n').value, { label: '内浇口数量', gt: 0, max: 64, int: true, required: true }),
      checkNum(q('#cg_t').value, { label: '内浇口厚度', gt: 0, max: 200, int: true, required: true }),
      ...(rhRaw !== '' ? [checkNum(rhRaw, { label: '横浇道高度', gt: 0, int: true })] : []),
    ]);
    const head = q('#cg_head'), gate = q('#cg_gate'), sprueOut = q('#cg_sprue'), runnerOut = q('#cg_runner'), sysT = q('#cg_sysTitle');
    if (err) {
      head.innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">⚠️ ${err}</span></div>`;
      gate.innerHTML = ''; sprueOut.innerHTML = ''; runnerOut.innerHTML = ''; sysT.innerHTML = '';
      q('#cg_tMeta').textContent = wallNum > 0 ? `默认 ⌊壁厚/2⌋ = ${tMin(wallNum)}mm` : '';
      q('#cg_rhMeta').textContent = '';
      return;
    }
    const cav = parseInt(q('#cg_cav').value, 10);
    const nPer = parseInt(q('#cg_n').value, 10);
    if (cav * nPer > MAX_TOTAL_GATES) {
      head.innerHTML = `<div class="empty" style="padding:16px"><span class="empty-sub">⚠️ 总内浇口数量过大（一模件数 × 单件口数 = ${cav}×${nPer} > ${MAX_TOTAL_GATES}），请减少件数或口数</span></div>`;
      gate.innerHTML = ''; sprueOut.innerHTML = ''; runnerOut.innerHTML = ''; sysT.innerHTML = '';
      return;
    }
    const r = runCampbellGating({
      mat: q('#cg_mat').value,
      weightKg: parseNum(q('#cg_w').value),
      wallMm: wallNum,
      cavity: cav,
      gateCount: nPer,
      slotT: parseInt(q('#cg_t').value, 10),
      runnerH: rhRaw !== '' ? parseNum(rhRaw) : undefined,
    });
    if (!r) { head.innerHTML = '<div class="empty" style="padding:16px"><span class="empty-sub">⚠️ 参数无法计算，请检查输入</span></div>'; gate.innerHTML = sprueOut.innerHTML = runnerOut.innerHTML = ''; sysT.innerHTML = ''; return; }
    q('#cg_tMeta').textContent = `默认 ⌊壁厚/2⌋=${r.slot ? r.slot.minT : tMin(wallNum)}mm${tTouched ? '（已用你修改的厚度）' : '（随壁厚自动，可改）'}`;
    if (!rhTouched || rhRaw === '') q('#cg_rh').value = r.runnerAutoH;
    q('#cg_rhMeta').textContent = rhTouched && rhRaw !== ''
      ? `已用你修改的高度 ${r.runner.h}mm（长度已联动）`
      : `自动参考 ${r.runnerAutoH}mm（可改，长度自动更新）`;

    const velRow = r.adjusted
      ? row('✅ 速度自动校验', '已放大至满足目标速度', '', 'ok', `经验法初始 ${fmt(r.A0_mm2, 0)} mm² 超速 → 自动调整至 ${fmt(r.A_mm2, 0)} mm²`)
      : row('✅ 速度校验通过', `v=${fmt(r.vActual, 2)} m/s ≤ ${r.v.toFixed(1)} m/s`, '', 'ok', '经验规则结果经内部速度校验合格');

    head.innerHTML = `
      ${ex.exampleNote()}
      <div class="group-title">推荐结果 ${KB('campbell_ratio_is_result', '比例是结果 ⓘ')}</div>
      ${row('⏱️ 浇注时间 t', fmt(r.t, 2), 's', '', `一模总重 ${fmt(r.Wtotal, 1)}kg（单件 ${fmt(r.Wtotal / r.cavity, 1)} × ${r.cavity} 件）`)}
      ${row('⚖️ 平均质量流率 ṁ', fmt(r.mdot, 2), 'kg/s', '', '= 一模总重 ÷ 浇注时间')}
      ${row('🧮 总内浇口面积', fmt(r.A_mm2, 0), 'mm²', 'ok', `= ṁ × ${r.ruleMM2} mm²/(kg/s)（${r.ruleGroup}经验规则）${r.adjusted ? `（初始 ${fmt(r.A0_mm2, 0)} 经速度校验放大）` : ''}`)}
      ${row('🔢 总内浇口数 n', `${r.nTotal} 口（${r.cavity} 件 × ${r.gateCount} 口/件）`, '', '', '1:1:n 的 n')}
      ${row('📐 单个内浇口面积 Ai', fmt(r.Ai, 0), 'mm²/口', '', `= 总面积 ÷ ${r.nTotal}（内浇口长度由 Ai 与厚度生成）`)}
      ${velRow}
      <div class="field-hint" style="padding:4px 4px 0">${r.provNote}</div>
      <details style="margin-top:8px">
        <summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:4px 0;user-select:none">⌄ 计算过程（工程师可查）</summary>
        <div class="results" style="margin-top:4px">
          ${r.process.map(p => p.pass === undefined
            ? row(`Step · ${p.step}`, typeof p.value === 'number' ? fmt(p.value, p.unit === 'kg/s' || p.unit === 's' || p.unit === 'kg' ? 3 : 0) : p.value, p.unit || '', '', '')
            : row(`Step · ${p.step}`, p.pass ? '通过 ✓' : '超目标 → 自动放大', '', p.pass ? 'ok' : 'warn')).join('')}
        </div>
        <div class="field-hint" style="padding:6px 4px">注：500/1000 经验法为主方法（primary sizing）；速度法为内部工程校验（engineering validation），不是第二套用户可选设计。</div>
      </details>
      <details style="margin-top:6px">
        <summary style="cursor:pointer;font-size:.82rem;color:#475569;padding:4px 0;user-select:none">⌄ 工艺提示 · 自然摩擦 ≠ 独立减速</summary>
        <div class="field-hint" style="padding:6px 4px">浇注系统不仅要保证充型，还要控制金属液速度：<b>基础 1:1:n 不能替代减速设计</b>——过滤器（首选，降速至约 1/4~1/5）、涌流/旁通冒口、垂直扇形内浇口等属独立减速方案，本速算暂不计算。对高速、薄壁或对夹杂/卷气敏感的工艺，应进一步考虑。${KB('campbell_deceleration_independent', '过滤器减速思想 ⓘ')}</div>
      </details>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <span class="kb-chip-label">继续了解：</span>${KB('campbell_speed_critical', '0.5/1.0 速度思想')} ${KB('campbell_continuous_throttle', '摩擦/持续节流')} ${KB('campbell_gating_flow_area', '流量与进浇面积')}
      </div>
      <div class="field-hint" style="padding:8px 4px 0;font-size:.72rem;color:#94a3b8">证据等级：ENGINEERING REFERENCE。与现有浇注系统计算器是两种独立方法，结果不可跨方法拼合。</div>
    `;

    gate.innerHTML = r.slot ? `
      ${row('📏 内浇口长度 L', r.slot.l, 'mm', 'ok', `= ⌈单口面积 Ai ${fmt(r.Ai, 0)} ÷ 厚度 ${r.slot.t}⌉（5mm 网格）`)}
      ${row('📐 内浇口宽度（厚度）W', r.slot.t, 'mm', '', '= 你填的厚度（默认 ⌊壁厚/2⌋）')}
      ${row('📐 实际截面积', fmt(r.slot.area, 0), 'mm²', '', `长 × 宽 = ${r.slot.l} × ${r.slot.t} ≥ 单口 ${fmt(r.Ai, 0)}mm²`)}
      ${r.slot.overThin
        ? `<div class="field-hint" style="padding:4px 4px 0;color:var(--danger,#DC2626)">⚠️ 内浇口厚度 ${r.slot.t}mm 已超过壁厚一半（${(r.wall / 2).toFixed(1)}mm）——可能形成"内浇口下热节"；如非必要请改回 ≤ ${r.slot.minT}mm（长度会自动重算）。</div>`
        : `<div class="field-hint" style="padding:4px 4px 0">规则：厚度 ≤ 壁厚/2 可消除 T 形热节；想改厚/改薄在输入框直接改，长度实时更新。</div>`}
      <div class="field-hint" style="padding:6px 4px 0">🍕 <b>内浇口款式（Campbell）</b>：宜做成<b>垂直扇形</b>——从横浇道底部向上扩张、开口呈扇形展开，本身是有效的减速器（可靠性约提高 4 倍）；本速算按等截面矩形口给出面积，扇形属于布置款式，面积需求不变。</div>
    ` : '';

    sysT.innerHTML = `浇注系统 1 : 1 : ${r.nTotal} ${KB('campbell_ratio_1_1_n', '为什么 ⓘ')}`;
    sprueOut.innerHTML = row('⏬ 直浇道底部（Sprue 出口）', `面积 ${fmt(r.sprue.area, 0)} mm² · ⌀${r.sprue.d}`, 'mm', 'ok',
      `参考 ${fmt(r.Ai, 0)} mm²（=单口面积）→ 圆取 ⌀${r.sprue.d}（实际 ${fmt(r.sprue.area, 0)} ≥ 参考）；直浇道一般圆形，高度取决于实际液面与布置（v=√(2gh)）——此处不是排气面积`) +
      `<div class="field-hint" style="padding:6px 4px 0">🔻 <b>直浇道形状（Campbell）</b>：宜做成<b>上大下小的锥形</b>，锥度匹配金属液下落流股的自然收缩（平行/倒锥直浇道会卷气）；自动造型线只能做倒锥起模时，补救=入口尺寸正确 + 锥度尽量小 + <b>底部紧跟过滤器</b>。<br>🏺 <b>浇口窝（直浇道底部）</b>：注意——Campbell 明确<b>不推荐</b>传统教科书式的"直浇道窝/扩张窝"（先膨胀再加速是卷气源）；底部要做的是与横浇道<b>平滑过渡、不突然变截面</b>。</div>`;
    runnerOut.innerHTML = `
      ${row('➡️ 横浇道（Runner）', `面积 ${fmt(r.runner.area, 0)} mm² · ${r.runner.l} × ${r.runner.h}（长 × 高）`, 'mm', 'ok',
        `${r.runnerCustom ? '高度用你输入的值' : '高度为自动值（可在上方输入框修改）'}；参考 = Sprue ×1.2 ≈ ${fmt(r.runnerRefArea, 0)} mm²（弯角摩擦裕度，略大于直浇道；仍循"满足流量下尽可能小"）；弯道内侧建议大圆角（1~2 倍通道厚度）${KB('campbell_runner_sprue', '为什么 1:1 ⓘ')}`)}
      <div class="field-hint" style="padding:6px 4px 0">🔧 <b>工程提示</b>：直浇道与横浇道连接处避免突然变截面与尖锐转角（弯角摩擦降速约 20%，三个直角弯≈半速；内弯做大圆角）；横浇道宜保持在下箱、金属液先充满横浇道再进内浇口（<b>放上箱不推荐</b>——金属液要"爬"进型腔，违反无跌落原则，传统铸铁这么做是错的）。</div>
    `;
  };
  let timer;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(update, 160); };
  container.querySelectorAll('.section-card input, .section-card select').forEach(el => {
    el.addEventListener('input', debounced);
    if (el.tagName === 'SELECT') el.addEventListener('change', debounced);
  });
  syncMeta();
  update();
  renderNextSteps(container, calc);
}
