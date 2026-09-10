// ============================================================
// 计算器视图：注册表卡片网格 + 工具详情（M1 填充真实计算表单）
// ============================================================
import { CALCULATORS, getCalculator, calculatorsByCategory } from '../../calcs/registry.js';
import { renderGating } from './gatingView.js';
import { renderCampbell } from './campbellGatingView.js';
import { renderVerticalGating } from './verticalGatingView.js';
import { renderRiser } from './riserView.js';
import { renderShrinkage, renderMachining, renderYield, renderChill, renderSandbox, renderCastability } from './smallCalcs.js';
import { renderDefectFinder } from './defectFinder.js';
import { renderCharge } from './chargeCalc.js';
import { renderShakeout } from './shakeoutCalc.js';
import { renderCT } from './ctCalc.js';
import { renderPrinciples } from './principlesCalc.js';
// PHASE 72（80.txt §七/§十七）：列表页与工具名/简介中英双语
import { t } from '../i18n/index.js';
import { markRelocalizable } from '../i18n/viewState.js';

export function render(container, params = {}) {
  const { id } = params;
  if (id) return renderDetail(container, getCalculator(id));
  return renderList(container);
}

// 已接入的独立计算器视图
const DEDICATED_VIEWS = {
  gating: renderGating,
  campbell_gating: renderCampbell,
  vertical_gating: renderVerticalGating,
  riser: renderRiser,
  shrinkage: renderShrinkage,
  machining: renderMachining,
  yield: renderYield,
  chill: renderChill,
  sandbox: renderSandbox,
  castability: renderCastability,
  defect_finder: renderDefectFinder,
  charge: renderCharge,
  shakeout: renderShakeout,
  ct: renderCT,
  principles: renderPrinciples,
};

/* ---- 列表：**按类别分组**的卡片网格（PHASE 78 · 78.txt 十一） ---- */
const toolCardHtml = (c) => `
  <div class="card hover tool-card" data-open="${c.id}">
    <span class="badge-status badge-${c.status === 'ready' ? 'ready' : 'pending'}">${t(c.status === 'ready' ? '✓ 可用' : '接入中')}</span>
    <div class="tool-top">
      <div class="tool-icon">${c.icon}</div>
      <div>
        <div class="tool-name">${t(c.name)}</div>
        <div class="tool-desc">${t(c.desc)}</div>
      </div>
    </div>
    <div class="tool-tags">${c.tags.map(x => `<span class="chip">${t(x)}</span>`).join('')}</div>
  </div>`;

function renderList(container) {
  markRelocalizable();   // PHASE 72：纯列表页，无表单状态
  const groups = calculatorsByCategory();
  container.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">${t('计算工具')}</h1>
      <p class="page-sub">${t('calc.listSub', [CALCULATORS.length, groups.length])}</p>
    </div>
    ${groups.map(g => `
      <section class="calc-cat">
        <div class="calc-cat-head">
          <span class="calc-cat-icon">${g.icon}</span>
          <span class="calc-cat-name">${t(g.name)}</span>
          <span class="calc-cat-desc">${t(g.desc)}</span>
          <span class="calc-cat-n">${t('{n} 个', [g.items.length])}</span>
        </div>
        <div class="tools-grid">${g.items.map(toolCardHtml).join('')}</div>
      </section>`).join('')}
  `;
  container.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => {
      history.pushState({ view: 'calculators', id: el.dataset.open }, '', '#/calculators/' + el.dataset.open);
      renderDetail(container, getCalculator(el.dataset.open));
    });
  });
}

/* ---- 详情：M1 接入真实表单 ---- */
function renderDetail(container, calc) {
  if (!calc) { renderList(container); return; }
  // 有专用视图 → 使用；否则占位
  if (DEDICATED_VIEWS[calc.id]) {
    DEDICATED_VIEWS[calc.id](container, calc);
    return;
  }
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
      <span class="badge-status badge-${calc.status === 'ready' ? 'ready' : 'pending'}">${calc.status === 'ready' ? '✓ 可用' : '接入中'}</span>
    </div>
    <div class="card" style="padding:40px;text-align:center">
      <div class="empty-icon">🚧</div>
      <div class="empty-title">计算模块迁移中（M1）</div>
      <div class="empty-sub">将从现有独立页面提取公式并在统一设计系统下重建此工具界面。</div>
    </div>
  `;
  container.querySelector('[data-back]').addEventListener('click', () => {
    history.pushState({ view: 'calculators' }, '', '#/calculators');
    renderList(container);
  });
}
