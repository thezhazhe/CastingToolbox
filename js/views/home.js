// ============================================================
// 首页（Bing 式搜索）：大搜索框（实时下拉）+ 生产场景 + 渐进展示
// 首屏只露搜索 + 生产场景，推荐区在下方（点提示条 / 滚轮展开）
// 无工况 → 「⚡ 常用工具」（8 计算工具 + 工艺向导）
// 有工况 → 「🎯 针对生产场景」（场景摘要 + 参数速查卡 + 对口工具/缺陷/标准/知识）
// 推荐由 js/scenario.js（逻辑）+ data/scenarios.js（数据）驱动，无 AI、结果稳定。
// ============================================================
import { CALCULATORS, calculatorsByCategory } from '../../calcs/registry.js';
import * as context from '../context.js';
import { setQuery } from './search.js';
import { cardHtml } from './knowledge.js';
import { attachLiveSearch } from '../liveSearch.js';
import { buildRecommendation, paramsOf } from '../scenario.js';
// PHASE 72（80.txt §七/§八）：首页 UI 中英双语
import { t } from '../i18n/index.js';
import { markRelocalizable } from '../i18n/viewState.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.remove(), 2200);
}

function doSearch(q) {
  const v = (q || '').trim();
  if (!v) return;
  setQuery(v);
  location.hash = '#/search';
}

const LOGO_SVG = `<svg viewBox="0 0 108 108" width="56" height="56">
  <defs>
    <linearGradient id="homeTile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101A33"/><stop offset="1" stop-color="#0B101F"/>
    </linearGradient>
    <linearGradient id="homeLett" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#E2E8F0"/><stop offset="0.55" stop-color="#60A5FA"/><stop offset="1" stop-color="#34D399"/>
    </linearGradient>
    <linearGradient id="homeBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#60A5FA"/><stop offset="1" stop-color="#34D399"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="100" height="100" rx="24" fill="url(#homeTile)"/>
  <rect x="4" y="4" width="100" height="100" rx="24" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
  <text x="54" y="62" text-anchor="middle" font-family="Bahnschrift, Arial, sans-serif" font-size="46" font-weight="700" fill="url(#homeLett)" letter-spacing="0.5">Cx</text>
  <rect x="30" y="76" width="48" height="6" rx="3" fill="url(#homeBar)"/>
</svg>`;

const toolCard = (c) => `<div class="card hover tool-card" data-open-calc="${c.id}">
  <div class="tool-top"><div class="tool-icon">${c.icon}</div>
    <div><div class="tool-name">${esc(t(c.name))}</div><div class="tool-desc">${esc(t(c.desc))}</div></div>
  </div>
</div>`;

/** 下拉选项：value 恒为中文数据键，仅显示文本随语言变（翻译不动数据） */
const opt = (v) => `<option value="${esc(v)}">${esc(t(v))}</option>`;

export async function render(container) {
  // PHASE 72：首页文案走 t()；表单值来自 context（模型侧），切语言重渲染不丢用户已填内容
  markRelocalizable();
  const prevQuery = document.getElementById('homeSearch')?.value || '';
  container.innerHTML = `
    <div class="home">
      <div class="home-screen">
      <section class="home-hero">
        <div class="home-logo">
          <div class="home-logo-mark">${LOGO_SVG}</div>
          <div>
            <div class="home-title">Casting Toolbox</div>
            <div class="home-sub">${t('home.sub')}</div>
          </div>
        </div>
        <div class="home-search">
          <input id="homeSearch" class="home-search-input" type="text"
            placeholder="${esc(t('search.placeholder'))}" autocomplete="off" spellcheck="false">
          <button class="btn btn-primary btn-lg" id="homeSearchBtn">${t('home.searchBtn')}</button>
        </div>
      </section>

      <section class="card home-ctx">
        <div class="home-ctx-head">
          <span class="home-ctx-title">${t('ctx.title')}</span>
          <span class="field-hint">${t('home.ctxHint')}</span>
        </div>
        <div class="home-ctx-form">
          <div class="field"><label class="field-label">${t('ctx.material')}</label>
            <select class="field-select" id="homeMat"><option value="">${t('ctx.unspecified')}</option></select></div>
          <div class="field"><label class="field-label">${t('ctx.line')}</label>
            <select class="field-select" id="homeLine"><option value="">${t('ctx.unspecified')}</option>${opt('垂直线')}${opt('水平线')}</select></div>
          <div class="field"><label class="field-label">${t('ctx.prod')}</label>
            <select class="field-select" id="homeProd"><option value="">${t('ctx.unspecified')}</option>${opt('自动线')}${opt('手工线')}</select></div>
          <div class="field"><label class="field-label">${t('ctx.method')}</label>
            <select class="field-select" id="homeMethod"><option value="">${t('ctx.unspecified')}</option>${opt('砂型')}${opt('金属型')}${opt('3D打印')}</select></div>
          <div class="home-ctx-actions">
            <button class="btn btn-primary" id="homeCtxApply">${t('home.apply')}</button>
            <button class="btn btn-ghost" id="homeCtxClear">${t('home.clear')}</button>
          </div>
        </div>
      </section>

      <!-- 渐进展示：首屏只露搜索 + 生产场景，推荐区在下方，点此 / 滚轮即可看到 -->
      <button class="home-reco-hint" id="homeRecoHint" title="${esc(t('滚动查看下方内容'))}">
        <span id="homeRecoHintText">${t('home.viewTools')}</span>
        <span class="hrh-arrow">▾</span>
      </button>
      </div>

      <div id="homeReco"></div>
    </div>
  `;
  if (prevQuery) container.querySelector('#homeSearch').value = prevQuery;   // 切语言不丢已输入的搜索词

  // 搜索：回车 + 按钮 + 实时下拉（与顶栏共用一套逻辑）
  container.querySelector('#homeSearchBtn').addEventListener('click', () => doSearch(container.querySelector('#homeSearch').value));
  attachLiveSearch(container.querySelector('#homeSearch'), doSearch);

  // 提示条：点击平滑滚动到推荐区
  container.querySelector('#homeRecoHint').addEventListener('click', () => {
    document.getElementById('homeReco').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // 生产场景面板
  await context.populateMaterialSelect(container.querySelector('#homeMat'));
  const syncCtx = () => {
    const c = context.get();
    container.querySelector('#homeMat').value = c.material || '';
    container.querySelector('#homeLine').value = c.line || '';
    container.querySelector('#homeProd').value = c.prod || '';
    container.querySelector('#homeMethod').value = c.method || '';
  };
  syncCtx();
  container.querySelector('#homeCtxApply').addEventListener('click', async () => {
    context.set({
      material: container.querySelector('#homeMat').value || null,
      line: container.querySelector('#homeLine').value || null,
      prod: container.querySelector('#homeProd').value || null,
      method: container.querySelector('#homeMethod').value || null,
    });
    const reco = await buildRecommendation();
    toast(t('🎯 已应用生产场景 · 匹配 {a} 工具 / {b} 缺陷 / {c} 标准', [reco.counts.calcs, reco.counts.defects, reco.counts.standards]));
  });
  container.querySelector('#homeCtxClear').addEventListener('click', () => { context.clear(); toast(t('已清除生产场景')); });

  await renderReco();
}

/* ---- 自动推荐区 ---- */
async function renderReco() {
  const recoEl = document.getElementById('homeReco');
  if (!recoEl) return;
  const ctx = context.get();
  // 提示条文案随是否有生产场景变化
  const hintText = document.getElementById('homeRecoHintText');
  if (hintText) hintText.textContent = context.hasAny() ? t('home.viewReco') : t('home.viewTools');

  if (!context.hasAny()) {
    // PHASE 78（78.txt 十一）：常用工具按类别分组（与「计算工具」页同一套分类）
    const groups = calculatorsByCategory(CALCULATORS.filter(c => c.status === 'ready'));
    recoEl.innerHTML = `
      <div class="group-title" style="margin:24px 0 10px;color:var(--primary)">${t('home.commonTools')}</div>
      ${groups.map(g => `
        <section class="calc-cat">
          <div class="calc-cat-head">
            <span class="calc-cat-icon">${g.icon}</span>
            <span class="calc-cat-name">${t(g.name)}</span>
            <span class="calc-cat-desc">${t(g.desc)}</span>
            <span class="calc-cat-n">${t('{n} 个', [g.items.length])}</span>
          </div>
          <div class="tools-grid">${g.items.map(toolCard).join('')}</div>
        </section>`).join('')}
      <div class="card hover home-wizard-cta" data-wizard>
        <div class="tool-top"><div class="tool-icon">🧭</div>
          <div><div class="tool-name">${t('home.wizard')} <span class="chip warning" style="font-size:.62rem;padding:1px 6px;vertical-align:2px">${t('home.wizardBeta')}</span></div>
            <div class="tool-desc">${t('home.wizardDesc')}</div></div>
        </div>
        <span class="kb-arrow">›</span>
      </div>
    `;
    recoEl.querySelectorAll('[data-open-calc]').forEach(el =>
      el.addEventListener('click', () => { location.hash = '#/calculators/' + el.dataset.openCalc; }));
    recoEl.querySelector('[data-wizard]')?.addEventListener('click', () => { location.hash = '#/wizard'; });
    return;
  }

  const reco = await buildRecommendation();
  const chips = [
    ctx.material ? `${t('材料')} ${t(ctx.material)}` : null,
    ctx.line ? `${t('造型线')} ${t(ctx.line)}` : null,
    ctx.prod ? `${t('生产')} ${t(ctx.prod)}` : null,
    ctx.method ? `${t('方法')} ${t(ctx.method)}` : null,
  ].filter(Boolean).join(' · ');
  const params = paramsOf(reco.defDoc);

  recoEl.innerHTML = `
    <div class="home-reco-head">
      <span class="group-title" style="color:var(--primary)">${t('home.forScenario')}</span>
      <span class="chip ctx-chip">${esc(chips)}</span>
    </div>
    <div class="card scenario-summary">
      <div class="ss-match">${t('已匹配 {a} 个计算工具 · {b} 条缺陷对策 · {c} 条标准', [reco.counts.calcs, reco.counts.defects, reco.counts.standards])}</div>
      ${reco.reason ? `<div class="ss-reason">${esc(reco.reason)}</div>` : ''}
      ${params.length ? `
        <div class="ss-title">📋 ${t('参数速查')} · ${esc(reco.defDoc?.title || '')}</div>
        <div class="ss-params">${params.map(([k, v]) => `<div class="ss-param"><span class="ss-k">${esc(t(k))}</span><span class="ss-v">${esc(v)}</span></div>`).join('')}</div>` : ''}
      ${reco.tips.length ? `
        <div class="ss-title">✅ ${t('操作要点')}</div>
        <ul class="ss-tips">${reco.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </div>
    ${reco.calcs.length ? `
      <div class="reco-title">${t('🧮 对口计算工具')}</div>
      <div class="tools-grid">${reco.calcs.map(toolCard).join('')}</div>` : ''}
    ${reco.defects.length ? `
      <div class="reco-title">${t('🩹 常见缺陷 · 同材质')}</div>
      <div class="kb-list">${reco.defects.map(d => cardHtml(d)).join('')}</div>` : ''}
    ${reco.standards.length ? `
      <div class="reco-title">${t('📜 相关标准')}</div>
      <div class="kb-list">${reco.standards.map(s => `<div class="card hover kb-item cat-std" data-std="${esc(s)}"><div class="kb-item-title">📜 ${esc(s)}</div><div class="kb-item-right"><span class="kb-arrow">›</span></div></div>`).join('')}</div>` : ''}
    ${reco.know.length ? `
      <div class="reco-title">${t('📚 相关知识 · 同场景')}</div>
      <div class="kb-list">${reco.know.map(d => cardHtml(d)).join('')}</div>` : ''}
  `;
  recoEl.querySelectorAll('[data-open-calc]').forEach(el =>
    el.addEventListener('click', () => { location.hash = '#/calculators/' + el.dataset.openCalc; }));
  recoEl.querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => { location.hash = '#/search/' + el.dataset.id; }));
  recoEl.querySelectorAll('[data-std]').forEach(el =>
    el.addEventListener('click', () => { setQuery(el.dataset.std); location.hash = '#/search'; }));
}

/* ---- 工况变化（含顶栏弹窗编辑）时，首页原地刷新 ---- */
context.onChange(() => {
  const recoEl = document.getElementById('homeReco');
  if (!recoEl) return;
  const c = context.get();
  const map = { homeMat: 'material', homeLine: 'line', homeProd: 'prod', homeMethod: 'method' };
  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.value = c[key] || '';
  }
  renderReco();
});
