// ============================================================
// 下一步建议（Next Steps）· 紧凑细条
// 计算器完成后的确定性"下一步操作"（推荐下一步做什么，非猜你喜欢）。
// 数据在 calcs/registry.js 每条计算的 next 字段：
//   kind 'calc'    → 跳另一个计算器 #/calculators/<target>
//   kind 'wizard'  → 进入工艺向导 #/wizard
//   kind 'search'  → 用关键词进入知识搜索 #/search
// ============================================================
import { setQuery as setSearchQuery } from './search.js';

export function renderNextSteps(container, calc) {
  const next = calc?.next || [];
  if (!next.length) return;
  const strip = document.createElement('div');
  strip.className = 'next-steps';
  strip.innerHTML = `
    <span class="ns-label">🚀 下一步建议</span>
    <div class="ns-items">
      ${next.map((n, i) => `<button class="ns-btn" data-next="${i}">${n.icon} ${n.label} →</button>`).join('')}
    </div>
  `;
  strip.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => {
    const n = next[+b.dataset.next];
    if (n.kind === 'calc') location.hash = '#/calculators/' + n.target;
    else if (n.kind === 'wizard') location.hash = '#/wizard';
    else if (n.kind === 'search') { setSearchQuery(n.target); location.hash = '#/search'; }
  }));
  container.appendChild(strip);
}
