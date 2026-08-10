// ============================================================
// 实时搜索下拉（顶栏 + 首页大搜索框共用）
// 输入防抖 150ms → 知识库前 5 + 计算工具前 3 → 下拉
// Esc / 点其它区域关闭；回车 / 点知识项跳搜索页
// ============================================================
import { loadKnowledge, searchKnowledge, searchCalcs } from './search.js';
import { TAXONOMY } from '../data/taxonomy.js';

const CAT_NAME = Object.fromEntries(TAXONOMY.map(t => [t.id, t.name]));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _timer = null;

/** 挂载实时下拉。input：搜索框；onGo(q)：回车 / 点知识项时跳转 */
export function attachLiveSearch(input, onGo) {
  input.addEventListener('input', () => {
    const q = input.value.trim();
    close(input);
    if (!q) return;
    clearTimeout(_timer);
    _timer = setTimeout(async () => {
      const docs = await loadKnowledge();
      if (input.value.trim() !== q) return;   // 输入已变化，丢弃过期结果
      const k = searchKnowledge(q, docs).slice(0, 5);
      const c = searchCalcs(q).slice(0, 3);
      open(input, q, k, c, onGo);
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { close(input); onGo(input.value); }
    else if (e.key === 'Escape') close(input);
  });
}

function wrapOf(input) {
  return input.closest('.search-wrap') || input.parentElement;
}

function open(input, q, k, c, onGo) {
  const wrap = wrapOf(input);
  let dd = wrap.querySelector(':scope > .search-drop');
  if (!dd) { dd = document.createElement('div'); dd.className = 'search-drop'; wrap.appendChild(dd); }
  const items = [
    ...c.map(x => ({ html: `<span class="sd-icon">${x.icon}</span><span class="sd-title">${esc(x.name)}</span><span class="sd-sub">计算工具</span>`, go: () => { location.hash = '#/calculators/' + x.id; } })),
    ...k.map(x => ({ html: `<span class="sd-icon">📖</span><span class="sd-title">${esc(x.doc.title)}</span><span class="sd-sub">${CAT_NAME[x.cat] || x.cat}</span>`, go: () => onGo(q) })),
  ].slice(0, 8);
  if (!items.length) { close(input); return; }
  dd.innerHTML = items.map((it, i) => `<button class="sd-item" data-i="${i}">${it.html}</button>`).join('');
  dd.style.display = 'block';
  dd.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => items[+b.dataset.i].go()));
}

function close(input) {
  const wrap = input && wrapOf(input);
  const dd = wrap && wrap.querySelector(':scope > .search-drop');
  if (dd) dd.style.display = 'none';
}

/** 关闭所有搜索下拉（导航 / 路由切换时调用） */
export function closeAll() {
  document.querySelectorAll('.search-drop').forEach(dd => { dd.style.display = 'none'; });
}

// 点页面其它区域 → 关下拉（顶栏 .search-wrap 与首页 .home-search 内的点击不关）
document.addEventListener('click', (e) => {
  if (e.target.closest('.search-wrap') || e.target.closest('.home-search')) return;
  closeAll();
});
