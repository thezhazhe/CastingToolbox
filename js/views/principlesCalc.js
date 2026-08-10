// ============================================================
// 铸造原则 · Campbell 十规则（展示型计算器）
// 数据复用知识库 data/rules/*.json（不重复维护），此处只做"漂亮呈现"
// 交互：全景分组 + 逐条可展开卡（机理/参数/违反后果/检查要点/相关计算器）
// ============================================================
import { loadKnowledge } from '../search.js';
import { CALCULATORS } from '../../calcs/registry.js';
import { renderNextSteps } from './nextSteps.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 十规则的阶段分组（Campbell 按铸件生命周期）
const STAGES = [
  { n: '①', label: '液态 · 金属液质量', rules: [1], color: 'var(--cat-mat)' },
  { n: '②', label: '充型 · 浇注系统', rules: [2, 3, 4, 5], color: 'var(--cat-def)' },
  { n: '③', label: '凝固 · 补缩', rules: [6, 7, 8], color: 'var(--cat-tool)' },
  { n: '④', label: '冷却 · 应力与尺寸', rules: [9, 10], color: 'var(--cat-std)' },
];

export async function renderPrinciples(container, calc) {
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
        <!-- 全景分组 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>🧭 十规则全景</div>
          <div class="field-hint" style="line-height:1.8">Campbell《Complete Casting Handbook》的核心思想：<b>绝大多数铸造缺陷，在浇注之前就已经被「金属液本身」和「浇注系统设计」决定了</b>。十规则按铸件生命周期分四阶段，从金属液质量一路管到冷却定位——逐条检查，缺陷就能从根源上堵住。</div>
          <div class="prin-stages">
            ${STAGES.map(s => `<div class="prin-stage" style="--stage:${s.color}">
              <span class="prin-stage-n">${s.n}</span>
              <span class="prin-stage-label">${s.label}</span>
              <span class="prin-stage-rules">规则 ${s.rules.map(r => String(r).padStart(2, '0')).join(' · ')}</span>
            </div>`).join('')}
          </div>
        </div>

        <!-- 逐条规则 -->
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>📜 十规则详解<small>点击任意一条展开</small></div>
          <div class="prin-list" id="prinList">
            <div class="empty" style="padding:20px"><span class="empty-sub">加载中…</span></div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });

  // 加载 10 条规则（复用知识库索引，避免数据双份维护）
  const docs = await loadKnowledge();
  const rules = docs
    .filter(d => d._cat === 'rules')
    .sort((a, b) => a.id.localeCompare(b.id));
  const calcName = (id) => { const c = CALCULATORS.find(x => x.id === id); return c ? `${c.icon} ${c.name}` : id; };

  const prinCard = (doc, idx) => {
    const c = doc.content || {};
    const cals = (doc.related_calcs || []).filter(id => CALCULATORS.find(x => x.id === id && x.status === 'ready'));
    return `<div class="card prin-card">
      <button class="prin-head" data-toggle="${esc(doc.id)}">
        <span class="prin-num">${String(idx + 1).padStart(2, '0')}</span>
        <span class="prin-title">${esc(doc.title)}</span>
        <span class="prin-arrow">▾</span>
      </button>
      <div class="prin-body" hidden>
        ${c.rule ? `<div class="rule-headline">${esc(c.rule)}</div>` : ''}
        ${c.mechanism ? `<div class="prin-sec"><b>⚙️ 机理</b><p>${esc(c.mechanism)}</p></div>` : ''}
        ${c.parameter ? `<div class="prin-sec"><b>🔑 关键参数</b><p>${esc(c.parameter)}</p></div>` : ''}
        ${Array.isArray(c.violation) && c.violation.length ? `
          <div class="prin-sec"><b>⚠️ 违反后果</b><ul>${c.violation.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
        ${Array.isArray(c.check) && c.check.length ? `
          <div class="prin-sec"><b>✅ 检查要点</b><ul>${c.check.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>` : ''}
        ${cals.length ? `
          <div class="prin-calcs">🛠️ 相关计算器：
            ${cals.map(id => `<button class="btn btn-ghost" data-open-calc="${esc(id)}" style="padding:3px 10px;font-size:.72rem">${calcName(id)} →</button>`).join('')}
          </div>` : ''}
      </div>
    </div>`;
  };

  container.querySelector('#prinList').innerHTML = rules.map(prinCard).join('');

  // 展开/收起（默认展开第一条）
  const toggle = (id) => {
    const head = container.querySelector(`[data-toggle="${id}"]`);
    if (!head) return;
    const body = head.nextElementSibling;
    if (!body) return;
    const isOpen = !body.hidden;
    body.hidden = isOpen;
    head.classList.toggle('open', !isOpen);
  };
  container.querySelectorAll('[data-toggle]').forEach((el, i) => {
    el.addEventListener('click', () => toggle(el.dataset.toggle));
    if (i === 0) toggle(el.dataset.toggle);
  });
  container.querySelectorAll('[data-open-calc]').forEach(el =>
    el.addEventListener('click', () => { location.hash = '#/calculators/' + el.dataset.openCalc; }));

  renderNextSteps(container, calc);
}
