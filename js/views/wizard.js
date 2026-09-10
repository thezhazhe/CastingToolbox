// ============================================================
// 工艺向导 · 应用门面（Win 激活式全屏分步引导）
// 选材料 → 重量 → 壁厚/热节 → 尺寸 → 工艺 → 工艺建议报告
// 每步自动预填材料参数，最后联动 gating + riser 计算器生成报告
// ============================================================
import { loadKnowledge } from '../search.js';
import * as context from '../context.js';
import { prefillDocId } from '../scenario.js';
import { runGating, MATERIALS, RATIO_PRESETS, recommendGatingRatio } from '../../calcs/gating.js';
import { runRiser, RISER_SHAPES } from '../../calcs/riser.js';
import { saveFile } from '../download.js';

const STEPS = [
  { key: 'material', name: '选择材料', icon: '🔩' },
  { key: 'weight',   name: '输入重量', icon: '⚖️' },
  { key: 'wall',     name: '壁厚 / 热节', icon: '📐' },
  { key: 'size',     name: '输入尺寸', icon: '📏' },
  { key: 'process',  name: '选择工艺', icon: '⚙️' },
  { key: 'report',   name: '工艺建议', icon: '✅' },
];

// 浇注系统组元默认值（进报告步自动算长度）
const G_DEFAULTS = { gc: 2, gt: 15, rc: 2, rt: 25, vr: 15, vrc: 4, vs: 75, vst: 8, vsc: 4 };

let stepIndex = -1;      // -1 = 首页 Hero
let state = {};

export function render(container) {
  // 每次进入向导视图都回到首页（向导流程为内部状态，不参与 hash 路由）
  stepIndex = -1;
  state = {};
  return renderHero(container);
}

/* ---- 家族映射（材料文档 id 前缀 → gating/riser 材料键） ---- */
function familyOf(doc) {
  const id = doc.id || '';
  if (id.startsWith('HT'))  return '灰铁(HT)';
  if (id.startsWith('QT'))  return '球铁(QT)';
  if (id.startsWith('ZG'))  return '铸钢(ZG)';
  if (id.startsWith('ZL'))  return '铝合金(Al)';
  if (id.startsWith('ZCu')) return '铜合金(Cu)';
  return '灰铁(HT)';
}
function riserMatOf(doc) {
  return { '灰铁(HT)': '灰铁', '球铁(QT)': '球铁', '铸钢(ZG)': '铸钢', '铝合金(Al)': '铝合金', '铜合金(Cu)': '铜合金' }[familyOf(doc)];
}
const FAMILY_NAME = { '灰铁(HT)': '灰铁 HT', '球铁(QT)': '球铁 QT', '铸钢(ZG)': '铸钢 ZG', '铝合金(Al)': '铝合金', '铜合金(Cu)': '铜合金' };

/* ================= 首页 Hero ================= */
function renderHero(container) {
  container.innerHTML = `
    <div class="card wizard-hero">
      <div style="display:flex;align-items:center;gap:10px;justify-content:center">
        <div class="wh-icon">🧭</div>
        <div>
          <div class="wh-title">工艺设计向导</div>
          <span class="chip warning" style="margin-top:2px">🧪 试用版 · 持续完善中</span>
        </div>
      </div>
      <p class="wh-sub">跟着引导一步步完成：选材料 → 定参数 → 自动计算浇注系统、冒口与排气，
        最后生成一份完整工艺建议报告。全程本地计算，无需联网。</p>
      <div class="wh-cta"><button class="btn btn-primary btn-lg" id="wzStart">开始设计 →</button></div>
      <p class="field-hint" style="margin-top:12px;line-height:1.8">🧪 <b>试用说明</b>：向导仍在打磨，推荐结果请结合本厂工艺复核后再投产使用；计算工具与知识库（搜索、资料）已稳定，可放心日常使用。</p>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;justify-content:center">
      <span class="chip">完全离线</span>
      <span class="chip">数据本地</span>
      <span class="chip">自动出报告</span>
      <span class="chip">试用手册</span>
    </div>
  `;
  container.querySelector('#wzStart').addEventListener('click', async () => {
    state = {}; stepIndex = 0;
    renderStep(container, 0);
  });
}

/* ================= 步骤框架 ================= */
function stepFrame(container, idx, contentHtml, opts = {}) {
  const { validate, extra = '' } = opts;
  const step = STEPS[idx];
  container.innerHTML = `
    <div class="page-head" style="margin-bottom:14px">
      <h1 class="page-title" style="font-size:1.15rem">工艺设计向导 · <span style="color:var(--primary)">${step.icon} ${step.name}</span> <span class="chip warning" style="font-size:.6rem;padding:1px 6px;vertical-align:2px">试用版</span></h1>
      <p class="page-sub">第 ${idx + 1} / ${STEPS.length} 步 <a href="#/calculators" style="margin-left:10px;font-size:.72rem;color:var(--text-muted)">退出向导 →</a></p>
    </div>
    <div class="card step-card" style="padding:22px 24px 26px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:22px">
        ${STEPS.map((s, i) => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px">
            <div style="width:100%;height:4px;border-radius:2px;background:${i < idx ? 'linear-gradient(90deg,#2F6BE0,#4F8CFF)' : i === idx ? 'linear-gradient(90deg,#4F8CFF,#34D399)' : 'var(--bg-hover)'};transition:background .4s"></div>
            <span style="font-size:.66rem;color:${i === idx ? 'var(--primary)' : 'var(--text-muted)'};font-weight:${i <= idx ? '600' : '400'}">${i + 1}. ${s.name}</span>
          </div>`).join('')}
      </div>
      ${summaryBar()}
      <div id="wzBody">${contentHtml}</div>
      ${extra}
      <div class="field-error" id="wzHint" style="min-height:18px;margin-top:14px"></div>
      <div style="display:flex;justify-content:space-between;gap:12px">
        <button class="btn btn-ghost" id="wzPrev" ${idx === 0 ? 'disabled style="opacity:.4"' : ''}>← 上一步</button>
        <button class="btn btn-primary" id="wzNext">${idx === STEPS.length - 1 ? '🔄 重新开始' : '下一步 →'}</button>
      </div>
    </div>
  `;
  const next = container.querySelector('#wzNext');
  const hint = container.querySelector('#wzHint');
  const revalidate = () => {
    if (!validate) { next.disabled = false; next.style.opacity = ''; hint.textContent = ''; return; }
    const v = validate();
    next.disabled = !v.ok;
    next.style.opacity = v.ok ? '' : '.45';
    hint.textContent = v.msg || '';
  };
  container.querySelector('#wzPrev').addEventListener('click', () => {
    stepIndex--; renderStep(container, stepIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  next.addEventListener('click', async () => {
    if (next.disabled) return;
    if (idx === STEPS.length - 1) { stepIndex = -1; renderHero(container); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    stepIndex++; await renderStep(container, stepIndex);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  // 输入变化时重新校验（setTimeout 0 → 等步骤自身监听更新完 state 再校验）
  const scheduleRevalidate = () => setTimeout(revalidate, 0);
  container.querySelectorAll('#wzBody input, #wzBody select').forEach(el =>
    el.addEventListener('input', scheduleRevalidate));
  container.querySelectorAll('#wzBody select').forEach(el =>
    el.addEventListener('change', scheduleRevalidate));
  revalidate();
}

/* ---- 已选参数摘要条（恒占位，避免布局跳动） ---- */
function summaryBar() {
  const parts = [];
  if (state.matDoc) parts.push(`🔩 <b>${state.matDoc.id}</b>`);
  if (state.partWt > 0) parts.push(`⚖️ ${state.partWt}Kg × ${state.cav}件`);
  if (state.yield) parts.push(`📊 出品率${state.yield}%`);
  if (state.wall > 0) parts.push(`📐 壁厚${state.wall}mm`);
  if (state.mc > 0) parts.push(`🧲 Mc${state.mc}`);
  if (state.pos) parts.push(`⬇️ ${state.pos}`);
  return `<div style="min-height:34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding:${parts.length ? '8px 14px' : '0'};background:${parts.length ? 'var(--info-soft)' : 'transparent'};border-radius:var(--radius-xs);font-size:.78rem">${parts.join('')}</div>`;
}

/* ================= 各步骤 ================= */
async function renderStep(container, idx) {
  switch (idx) {
    case 0: return renderStepMaterial(container, idx);
    case 1: return renderStepWeight(container, idx);
    case 2: return renderStepWall(container, idx);
    case 3: return renderStepSize(container, idx);
    case 4: return renderStepProcess(container, idx);
    case 5: return renderStepReport(container, idx);
  }
}

/* ---- 1. 选择材料 ---- */
let matFilter = 'all';
async function renderStepMaterial(container, idx) {
  const docs = (await loadKnowledge()).filter(d => d._cat === 'materials');
  // 生产场景预填：设置了材料大类 → 直接选中该族代表牌号（仍可点其他牌号）
  if (!state.matDoc) {
    const fam = context.familyOf(context.get().material);
    const docId = prefillDocId(fam);
    if (docId) state.matDoc = docs.find(d => d.id === docId) || null;
  }
  const groups = {};
  docs.forEach(d => { const f = familyOf(d); (groups[f] = groups[f] || []).push(d); });
  const selected = state.matDoc;
  const fams = Object.keys(groups);

  stepFrame(container, idx, `
    <div class="page-sub" style="margin-bottom:12px">选择一个材料牌号，后续参数将自动预填</div>
    ${state.matDoc ? `<div class="field-hint" style="padding:8px 12px;background:var(--success-soft);border-radius:var(--radius-xs);margin-bottom:12px">✅ 已按生产场景推荐选中 <b>${state.matDoc.title}</b>（可改选其他牌号）</div>`
      : `<div class="field-hint" style="padding:8px 12px;background:var(--info-soft);border-radius:var(--radius-xs);margin-bottom:12px">💡 没设生产场景？点上面分类筛选（如「球铁 QT」）可快速缩小范围；选完后续参数自动预填。</div>`}
    <div class="kb-cats" style="margin-bottom:16px">
      <button class="kb-cat ${matFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>
      ${fams.map(f => `<button class="kb-cat ${matFilter === f ? 'active' : ''}" data-filter="${f}">${FAMILY_NAME[f]}</button>`).join('')}
    </div>
    ${fams.filter(f => matFilter === 'all' || matFilter === f).map(f => `
      <div class="group-title">${FAMILY_NAME[f]}（${groups[f].length}）</div>
      <div class="tools-grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin-bottom:16px">
        ${groups[f].map(d => {
          const c = d.content;
          const pour = c?.pouring?.pour_temperature || '—';
          const shrink = c?.physical?.linear_shrinkage || '—';
          const density = c?.physical?.density || '—';
          const tensile = c?.mechanical?.tensile_strength || '—';
          const active = selected && selected.id === d.id;
          return `<div class="card tool-card" data-mat="${d.id}" style="${active ? 'border-color:var(--primary);box-shadow:0 0 0 2px rgba(79,140,255,.4)' : ''}">
            <div class="tool-top">
              <div class="tool-icon" style="background:${active ? 'var(--primary-soft)' : 'var(--info-soft)'}">${active ? '✓' : '🧪'}</div>
              <div><div class="tool-name">${d.title}</div>
                <div class="tool-desc">浇温 ${pour}<br>密度 ${density} · 线缩 ${shrink}<br>${tensile}</div></div>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}
  `, {
    validate: () => state.matDoc ? { ok: true } : { ok: false, msg: '👆 请先选择一个材料牌号' },
  });

  container.querySelectorAll('[data-filter]').forEach(el =>
    el.addEventListener('click', () => { matFilter = el.dataset.filter; renderStepMaterial(container, idx); }));
  container.querySelectorAll('[data-mat]').forEach(el => {
    el.addEventListener('click', async () => {
      state.matDoc = docs.find(d => d.id === el.dataset.mat);
      const m = MATERIALS[familyOf(state.matDoc)];
      if (m && state.yield === undefined) state.yield = m.y_sug;
      renderStepMaterial(container, idx);
    });
  });
}

/* ---- 2. 输入重量 ---- */
function renderStepWeight(container, idx) {
  if (!state.matDoc) { stepIndex = 0; return renderStep(container, 0); }
  const doc = state.matDoc;
  const c = doc.content;
  const md = MATERIALS[familyOf(doc)];
  state.partWt = state.partWt ?? 50;
  state.cav = state.cav ?? 1;
  state.yield = state.yield ?? md.y_sug;
  stepFrame(container, idx, `
    <div class="card" style="background:var(--bg-hover);border:none;padding:14px 16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:.82rem">
        <span>🔩 <b>${doc.title}</b></span>
        <span>密度 ${c.physical?.density || '—'}</span>
        <span>浇温 ${c.pouring?.pour_temperature || '—'}</span>
        <span>线收缩 ${c.physical?.linear_shrinkage || '—'}</span>
      </div>
    </div>
    <div class="field-grid2">
      <div class="field"><label class="field-label">⚖️ 单件毛重</label><div class="f-row"><input class="field-input" type="number" id="wz_pw" value="${state.partWt}" step="0.1" min="0"><span class="f-unit">Kg</span></div></div>
      <div class="field"><label class="field-label">🔢 一模件数</label><div class="f-row"><input class="field-input" type="number" id="wz_cav" value="${state.cav}" step="1" min="1"><span class="f-unit">件</span></div></div>
    </div>
    <div class="field" style="margin-top:12px"><label class="field-label">📊 预估出品率（材料推荐 ${md.y_min}~${md.y_max}%）</label><div class="f-row"><input class="field-input" type="number" id="wz_yield" value="${state.yield}" step="1" min="10" max="100"><span class="f-unit">%</span></div></div>
  `, {
    validate: () => state.partWt > 0 ? { ok: true } : { ok: false, msg: '👆 请输入铸件毛重（Kg）' },
  });
  container.querySelectorAll('#wzBody input').forEach(el => el.addEventListener('input', () => {
    state.partWt = parseFloat(container.querySelector('#wz_pw').value) || 0;
    state.cav = parseInt(container.querySelector('#wz_cav').value) || 1;
    state.yield = parseFloat(container.querySelector('#wz_yield').value) || 0;
  }));
}

/* ---- 3. 壁厚 / 热节 ---- */
function renderStepWall(container, idx) {
  state.wall = state.wall ?? 20;
  state.mcMode = state.mcMode ?? 'wall';
  state.mc = state.mc ?? 10;
  stepFrame(container, idx, `
    <div class="field-grid2">
      <div class="field"><label class="field-label">📐 产品主壁厚 w（浇注时间用）</label><div class="f-row"><input class="field-input" type="number" id="wz_wall" value="${state.wall}" step="0.5" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">🧲 热节模数 Mc 输入方式</label><div class="f-row"><select class="field-select" id="wz_mcMode">
        <option value="wall" ${state.mcMode === 'wall' ? 'selected' : ''}>按壁厚估算（Mc=壁厚/2）</option>
        <option value="direct" ${state.mcMode === 'direct' ? 'selected' : ''}>直接输入 Mc</option>
        <option value="hot_spot" ${state.mcMode === 'hot_spot' ? 'selected' : ''}>热节圆直径 d（Mc=d/2）</option>
      </select></div></div>
    </div>
    <div class="field" id="wz_mc_field" style="margin-top:12px"></div>
    <div class="field-hint" style="margin-top:8px">热节模数用于冒口设计。若不知热节，用壁厚估算即可（板状热节 Mc≈壁厚/2）。</div>
  `, {
    validate: () => state.wall > 0 ? { ok: true } : { ok: false, msg: '👆 请输入产品主壁厚' },
  });
  const mcField = container.querySelector('#wz_mc_field');
  const syncMcField = () => {
    const m = container.querySelector('#wz_mcMode').value;
    if (m === 'wall') {
      mcField.innerHTML = `<div class="field-hint" style="padding:10px 12px;background:var(--info-soft);border-radius:var(--radius-xs)">将按 Mc = 壁厚 ÷ 2 = <b>${(state.wall / 2).toFixed(1)} mm</b> 进行冒口计算（也可直接改上方壁厚）</div>`;
    } else if (m === 'direct') {
      mcField.innerHTML = `<label class="field-label">热节模数 Mc</label><div class="f-row"><input class="field-input" type="number" id="wz_mc" value="${state.mc}" step="0.1" min="0"><span class="f-unit">mm</span></div>`;
    } else {
      mcField.innerHTML = `<label class="field-label">热节圆直径 d</label><div class="f-row"><input class="field-input" type="number" id="wz_hot" value="${state.mc * 2}" step="1" min="0"><span class="f-unit">mm</span></div>`;
    }
  };
  syncMcField();
  container.querySelector('#wz_wall').addEventListener('input', () => {
    state.wall = parseFloat(container.querySelector('#wz_wall').value) || 0;
    syncMcField();
  });
  container.querySelector('#wz_mcMode').addEventListener('change', () => { state.mcMode = container.querySelector('#wz_mcMode').value; syncMcField(); });
  container.querySelector('#wz_mc_field').addEventListener('input', (e) => {
    if (e.target.id === 'wz_mc') state.mc = parseFloat(e.target.value) || 0;
    if (e.target.id === 'wz_hot') state.mc = (parseFloat(e.target.value) || 0) / 2;
  });
}

/* ---- 4. 输入尺寸 ---- */
function renderStepSize(container, idx) {
  state.ph = state.ph ?? 76;
  state.rh = state.rh ?? 100;
  state.Ho = state.Ho ?? 180;
  state.pos = state.pos ?? '顶注';
  stepFrame(container, idx, `
    <div class="field-grid2">
      <div class="field"><label class="field-label">📏 产品高度（浇注方向）</label><div class="f-row"><input class="field-input" type="number" id="wz_ph" value="${state.ph}" step="1" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">🏗️ 冒口高度（预估）</label><div class="f-row"><input class="field-input" type="number" id="wz_rh" value="${state.rh}" step="1" min="0"><span class="f-unit">mm</span></div></div>
    </div>
    <div class="field-grid2" style="margin-top:12px">
      <div class="field"><label class="field-label">⬆️ Ho（内浇道至上箱面距离）</label><div class="f-row"><input class="field-input" type="number" id="wz_Ho" value="${state.Ho}" step="1" min="0"><span class="f-unit">mm</span></div></div>
      <div class="field"><label class="field-label">⬇️ 浇注方向</label><div class="f-row"><select class="field-select" id="wz_pos">
        <option ${state.pos === '顶注' ? 'selected' : ''}>顶注</option>
        <option ${state.pos === '中注' ? 'selected' : ''}>中注</option>
        <option ${state.pos === '底注' ? 'selected' : ''}>底注</option>
      </select></div></div>
    </div>
    <div class="field-hint" style="margin-top:10px">这些尺寸用于计算平均静压头 Hp（奥赞公式）。冒口高度若未知可先填估算值，结果页会给建议。</div>
  `, {
    validate: () => (state.ph > 0 && state.Ho > 0) ? { ok: true } : { ok: false, msg: '👆 请输入产品高度与 Ho 距离' },
  });
  container.querySelectorAll('#wzBody input, #wzBody select').forEach(el => el.addEventListener('input', () => {
    state.ph = parseFloat(container.querySelector('#wz_ph').value) || 0;
    state.rh = parseFloat(container.querySelector('#wz_rh').value) || 0;
    state.Ho = parseFloat(container.querySelector('#wz_Ho').value) || 0;
    state.pos = container.querySelector('#wz_pos').value;
  }));
}

/* ---- 5. 选择工艺 ---- */
function renderStepProcess(container, idx) {
  const doc = state.matDoc;
  const rec = doc ? recommendGatingRatio(familyOf(doc), state.partWt || 0) : '封闭式 常用型';
  state.gatingRatio = state.gatingRatio ?? rec;
  state.riserShape = state.riserShape ?? 'sphere_head';
  state.hdRatio = state.hdRatio ?? 1.0;
  // 生产场景预填：造型线/生产方式/铸造方法 从场景带入（用户已改过则保留）
  const ctxNow = context.get();
  state.line = state.line ?? (ctxNow.line || '不指定');
  state.prod = state.prod ?? (ctxNow.prod || '不指定');
  state.method = state.method ?? (ctxNow.method || '不指定');
  stepFrame(container, idx, `
    <div class="field" style="margin-bottom:14px">
      <label class="field-label">🌊 浇注系统类型 <span class="chip primary" style="margin-left:6px">⚡ 已按材料+重量推荐</span></label>
      <div class="f-row"><select class="field-select" id="wz_ratio">
        ${Object.keys(RATIO_PRESETS).map(k => `<option ${state.gatingRatio === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select></div>
      <div class="field-hint" style="margin-top:5px">推荐：<b>${rec}</b>（${doc ? FAMILY_NAME[familyOf(doc)] : ''}${state.partWt > 200 ? ' · 大件' : ''} → ${rec.replace(/[（(].*/, '')}式）</div>
    </div>
    <div class="field-grid2">
      <div class="field"><label class="field-label">🏗️ 冒口形状</label><div class="f-row"><select class="field-select" id="wz_shape">
        ${Object.keys(RISER_SHAPES).map(k => `<option value="${k}" ${state.riserShape === k ? 'selected' : ''}>${RISER_SHAPES[k].name}</option>`).join('')}
      </select></div></div>
      <div class="field"><label class="field-label">📐 冒口 H/D 比</label><div class="f-row"><select class="field-select" id="wz_hd">
        <option value="0.8" ${state.hdRatio === 0.8 ? 'selected' : ''}>0.8（矮胖）</option>
        <option value="1.0" ${state.hdRatio === 1 ? 'selected' : ''}>1.0（适中）</option>
        <option value="1.2" ${state.hdRatio === 1.2 ? 'selected' : ''}>1.2（瘦高）</option>
        <option value="1.5" ${state.hdRatio === 1.5 ? 'selected' : ''}>1.5（细长）</option>
      </select></div></div>
    </div>
    <div class="divider"></div>
    <div class="group-title">🏭 生产条件 <span class="chip">可选 · 保存为生产场景</span></div>
    <div class="field-grid2">
      <div class="field"><label class="field-label">📐 造型线</label><div class="f-row"><select class="field-select" id="wz_line"><option>不指定</option><option>垂直线</option><option>水平线</option></select></div></div>
      <div class="field"><label class="field-label">🏭 生产方式</label><div class="f-row"><select class="field-select" id="wz_prod"><option>不指定</option><option>自动线</option><option>手工线</option></select></div></div>
    </div>
    <div class="field" style="margin-top:12px">
      <label class="field-label">⚙️ 铸造方法</label>
      <div class="f-row"><select class="field-select" id="wz_method"><option>不指定</option><option>砂型</option><option>金属型</option><option>3D打印</option></select></div>
    </div>
    <div class="field-hint" style="margin-top:10px">浇注系统与冒口参数已按材料推荐默认值预置；完成设计后生产条件将自动保存为生产场景，计算工具会优先读取预填。</div>
  `);
  const wzLine = container.querySelector('#wz_line'), wzProd = container.querySelector('#wz_prod'), wzMethod = container.querySelector('#wz_method');
  if (wzLine) wzLine.value = state.line;
  if (wzProd) wzProd.value = state.prod;
  if (wzMethod) wzMethod.value = state.method;
  container.querySelectorAll('#wzBody select').forEach(el => el.addEventListener('change', () => {
    state.gatingRatio = container.querySelector('#wz_ratio').value;
    state.riserShape = container.querySelector('#wz_shape').value;
    state.hdRatio = parseFloat(container.querySelector('#wz_hd').value) || 1;
    state.line = wzLine ? wzLine.value : state.line;
    state.prod = wzProd ? wzProd.value : state.prod;
    state.method = wzMethod ? wzMethod.value : state.method;
  }));
}

/* ---- 6. 工艺建议报告 ---- */
function renderStepReport(container, idx) {
  const doc = state.matDoc;
  if (!doc) { stepIndex = 0; return renderStep(container, 0); }
  const fk = familyOf(doc);
  const rk = riserMatOf(doc);
  const md = MATERIALS[fk];

  // 浇注系统
  const g = runGating({
    mat: fk, pw: state.partWt, cav: state.cav, wall: state.wall,
    yr: state.yield, pos: state.pos, Ho: state.Ho, ph: state.ph, rh: state.rh,
    ratioKey: state.gatingRatio, ...G_DEFAULTS,
  });
  // 冒口
  const mc = state.mcMode === 'direct' ? (state.mc || 0)
    : state.mcMode === 'hot_spot' ? (state.mc || 0)
    : (state.wall / 2);
  const r = runRiser({
    mat: rk, cast_wt: state.partWt, mc_mode: 'direct', mc,
    shape: state.riserShape, hd_ratio: state.hdRatio, eff: undefined,
  });

  stepFrame(container, idx, reportHtml(doc, md, g, r, mc), {
    extra: `
    <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
      <div class="f-row" style="gap:8px">
        <input class="field-input" id="wz_prodName" placeholder="给产品起个名字（如：水泵缸体）" value="${state.prodName || ''}">
      </div>
      <button class="btn btn-primary btn-lg" id="wz_download" style="width:100%">⬇️ 下载工艺建议报告</button>
    </div>`,
  });
  container.querySelector('#wz_prodName').addEventListener('input', (e) => { state.prodName = e.target.value; });
  container.querySelector('#wz_download').addEventListener('click', () => {
    const name = (container.querySelector('#wz_prodName').value || '').trim();
    const fname = (name ? name + '_' : '') + doc.id + '.html';
    saveFile(fname, fullReportHtml(doc, md, g, r, mc));
  });

  // 向导完成 → 自动保存生产场景（计算工具优先读取预填）
  const ctxSave = { material: context.familyOfDoc(doc.id) };   // 存材质大类（工厂不做单一牌号）
  if (state.line && state.line !== '不指定') ctxSave.line = state.line;
  if (state.prod && state.prod !== '不指定') ctxSave.prod = state.prod;
  if (state.method && state.method !== '不指定') ctxSave.method = state.method;
  context.set(ctxSave);
  showToast('已保存生产场景 → 计算工具自动预填');
}

/* 下载版：完整独立 HTML（自带样式，无 CSS 变量依赖） */
function fullReportHtml(doc, md, g, r, mc) {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>工艺建议报告</title>
<style>body{font-family:system-ui,'Microsoft YaHei',sans-serif;color:#1f2937;font-size:13px;padding:24px;max-width:780px;margin:auto}
table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #d1d5db;padding:5px 9px;text-align:left}
th{background:#f3f4f6}td:first-child{width:38%;color:#6b7280}td:last-child{font-weight:600}
h3{color:#2563eb;background:#eff6ff;padding:5px 10px;border-radius:6px;margin:16px 0 6px}</style></head><body>
${reportHtml(doc, md, g, r, mc)}
<p style="text-align:center;font-size:.7rem;color:#94a3b8;margin-top:18px">—— 由 Casting Toolbox 离线生成 · 数据源自《铸造手册》/GB 标准 · 页码待核对 ——</p>
</body></html>`;
}

const fmt = (v, d) => (typeof v === 'number' && !isNaN(v) ? parseFloat(v.toFixed(d)).toString() : String(v));
const t = (label, val) => `<tr><td>${label}</td><td>${val}</td></tr>`;
const stat = (k, v) => `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;text-align:center"><div style="font-size:.7rem;color:#64748b">${k}</div><div style="font-size:.95rem;font-weight:700;color:#1e293b;margin-top:2px">${v}</div></div>`;

function reportHtml(doc, md, g, r, mc) {
  const c = doc.content;
  const allOk = g.v_ok && g.vr_ok && (!r || r.volOk);
  return `
    <div style="background:${allOk ? 'linear-gradient(135deg,rgba(14,159,110,.16),rgba(14,159,110,.05))' : 'linear-gradient(135deg,rgba(217,119,6,.16),rgba(217,119,6,.05))'};border:1px solid ${allOk ? 'rgba(14,159,110,.45)' : 'rgba(217,119,6,.45)'};border-radius:12px;padding:16px;margin-bottom:16px;text-align:center">
      <div style="font-size:1.1rem;font-weight:800;color:${allOk ? '#0E9F6E' : '#D97706'}">${allOk ? '✅ 工艺方案已生成 · 参数合理' : '⚠️ 工艺方案已生成 · 需关注优化项'}</div>
      <div style="font-size:.76rem;color:#6b7280;margin-top:5px">流速 ${g.v_ok ? '✓ 合格' : '✗ 超限'} · 排气 ${g.vr_ok ? '✓ 合格' : '✗ 不足'} · 冒口补缩 ${r && r.volOk ? '✓ 合格' : '⚠️ 需加大/加冷铁'}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px">
      ${stat('材料', doc.id)}
      ${stat('浇注重量', fmt(g.G, 1) + ' Kg')}
      ${stat('浇注时间', fmt(g.t, 1) + ' s')}
      ${stat('阻流截面', fmt(g.A, 0) + ' mm²')}
      ${stat('冒口', r ? r.sd.label(r.D, r.H) : '—')}
    </div>
    <h3>🧪 材料与输入</h3>
    <table>${t('材料', doc.title)}${t('浇注温度', c.pouring?.pour_temperature || '—')}${t('密度', c.physical?.density || '—')}${t('线收缩率', c.physical?.linear_shrinkage || '—')}${t('单件毛重', state.partWt + ' Kg × ' + state.cav + ' 件')}${t('出品率', state.yield + '%')}${t('主壁厚', state.wall + ' mm')}${t('热节模数 Mc', mc.toFixed(1) + ' mm')}${t('浇注方向', state.pos)}</table>
    <h3>🌊 浇注系统建议</h3>
    <table>${t('浇注重量 G', fmt(g.G, 2) + ' Kg')}${t('浇注时间 t', fmt(g.t, 2) + ' s')}${t('阻流截面 A_choke', fmt(g.A, 1) + ' mm²')}${t('内浇道', g.gc + '个 × ' + g.gt + 'mm厚 × ' + g.L_g + 'mm长')}${t('横浇道', g.rc + '条 × ' + g.rt + 'mm厚 × ' + g.L_r + 'mm长')}${t('直浇道', '⌀' + g.D_sp + ' mm')}${t('流速校核', fmt(g.v, 2) + ' m/s ' + (g.v_ok ? '✅' : '⚠️ 超' + g.vLimit))}${t('排气面积比', fmt(g.vr, 2) + ' 倍 ' + (g.vr_ok ? '✅' : '⚠️ 需≥1.5'))}</table>
    <h3>🏗️ 冒口建议</h3>
    <table>${t('冒口形状', r ? r.sd.name : '—')}${t('冒口尺寸', r ? r.sd.label(r.D, r.H) : '—')}${t('所需模数 Mr_需', r ? r.Mr_need.toFixed(2) + ' mm' : '—')}${t('实际模数 Mr_实', r ? r.Mr_act.toFixed(2) + ' mm' : '—')}${t('冒口体积', r ? (r.Vr / 1000).toFixed(1) + ' cm³' : '—')}${t('圆形冒口颈', r ? '⌀' + r.d_neck + ' mm' : '—')}${t('补缩判定', r && r.volOk ? '✅ 体积补缩充足' : r ? '⚠️ 体积不足，需加大冒口' : '—')}</table>
    <h3>✅ 综合判定</h3>
    <table>${t('流速', g.v_ok ? '合格' : '需增大内浇道')}${t('排气', g.vr_ok ? '合格' : '需增加排气面积')}${t('补缩', r && r.volOk ? '合格' : '需加大冒口/加冷铁')}${t('材料提醒', (c.recommendations || []).slice(0, 2).join('；') || '—')}</table>
    <p style="text-align:center;font-size:.7rem;color:#94a3b8;margin-top:16px">—— 由 Casting Toolbox 离线生成 · 数据源自《铸造手册》/GB 标准 · 页码待核对 ——</p>`;
}

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.remove(), 2200);
}
