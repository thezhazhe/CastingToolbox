// ============================================================
// Casting Toolbox · 应用入口
// hash 路由：#/home · #/calculators[/id] · #/search[/docId] · #/knowledge[/cat] · #/wizard
// 顶栏搜索：实时下拉（Raycast 式）+ 回车进知识库
// ============================================================
import * as calculatorsView from './views/calculators.js';
import * as knowledgeView from './views/knowledge.js';
import * as wizardView from './views/wizard.js';
import * as homeView from './views/home.js';
import * as searchView from './views/search.js';
import * as devmode from './devmode.js';
import * as context from './context.js';
import * as liveSearch from './liveSearch.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
const searchEl = document.getElementById('globalSearch');
liveSearch.attachLiveSearch(searchEl, goSearch);   // 顶栏搜索：实时下拉 + 回车进搜索页

const VIEWS = {
  home: homeView,
  calculators: calculatorsView,
  knowledge: knowledgeView,
  wizard: wizardView,
  search: searchView,
};

/* ---- 主题切换（auto / light / dark，localStorage 记忆） ---- */
const SUN_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const AUTO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>';

function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.innerHTML = mode === 'light' ? SUN_SVG : mode === 'dark' ? MOON_SVG : AUTO_SVG;
}
function cycleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'auto';
  const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
  try { localStorage.setItem('ct-theme', next); } catch (e) {}
  applyTheme(next);
}
try { applyTheme(localStorage.getItem('ct-theme') || 'auto'); } catch (e) { applyTheme('auto'); }
document.getElementById('themeBtn')?.addEventListener('click', cycleTheme);

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view = 'home', ...rest] = h.split('/');
  return { view: VIEWS[view] ? view : 'home', params: { id: rest[0], cat: rest[0] } };
}

function render() {
  const { view, params } = parseHash();
  window.scrollTo(0, 0);   // 切换视图回顶部：点搜索结果进详情不再停留在旧滚动位置
  const activeView = view === 'search' ? 'home' : view;   // 搜索结果页时点亮首页
  document.body.classList.toggle('view-home', view === 'home');   // 首页隐藏顶栏搜索（首页自带大搜索框）
  navEl.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === activeView));
  VIEWS[view].render(viewEl, params);
}

/* ---- 导航点击 ---- */
navEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-item');
  if (!btn) return;
  liveSearch.closeAll();
  if (btn.dataset.action === 'donate') {   // 侧栏「捐助」→ 弹捐助弹窗（非路由）
    document.getElementById('donateModal').hidden = false;
    return;
  }
  history.pushState(null, '', '#/' + btn.dataset.view);
  render();
});

/* ---- 前进/后退 & 手动改 hash ---- */
window.addEventListener('popstate', render);
window.addEventListener('hashchange', () => { liveSearch.closeAll(); render(); });

/* ---- 搜索：回车 / 实时下拉（共用 liveSearch.js） ---- */
function goSearch(q) {
  liveSearch.closeAll();
  searchView.setQuery(q);
  history.pushState(null, '', '#/search');
  render();
}

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.remove(), 2200);
}

/* ---- 开发者模式：Logo 5 连击 → 密码解锁 ----
   事件委托：桌面侧栏 Logo（.logo）与首页大 Logo（.home-logo-mark，移动端可见）都有效。 */
let logoClicks = 0, logoTimer = null;
document.addEventListener('click', (e) => {
  if (!e.target.closest('.logo, .home-logo-mark')) return;
  logoClicks++;
  clearTimeout(logoTimer);
  logoTimer = setTimeout(() => { logoClicks = 0; }, 5000);
  if (logoClicks >= 5) {
    logoClicks = 0;
    const m = document.getElementById('devModal');
    m.hidden = false;
    const pass = document.getElementById('devPass');
    pass.value = '';
    document.getElementById('devErr').textContent = '';
    setTimeout(() => pass.focus(), 60);
  }
});
const devModalEl = document.getElementById('devModal');
const tryUnlock = () => {
  if (devmode.checkPassword(document.getElementById('devPass').value)) {
    devModalEl.hidden = true;
    devmode.unlock();
    showToast('🔓 开发者模式已解锁');
    if ((location.hash || '').startsWith('#/knowledge')) render();
  } else {
    document.getElementById('devErr').textContent = '❌ 密码错误';
  }
};
document.getElementById('devConfirm').addEventListener('click', tryUnlock);
document.getElementById('devPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
document.getElementById('devCancel').addEventListener('click', () => { devModalEl.hidden = true; });
devModalEl.addEventListener('click', (e) => {
  if (e.target === devModalEl || e.target.closest('[data-close-dev]')) devModalEl.hidden = true;
});
const devLock = () => {
  devmode.lock();
  showToast('🔒 开发者模式已锁定');
  if ((location.hash || '').startsWith('#/knowledge')) render();
};
document.getElementById('devBadge').addEventListener('click', devLock);
document.getElementById('devLockBtn').addEventListener('click', devLock);

/* ---- 生产场景（Current Context） ---- */
context.onChange(() => context.renderContextBar());
document.getElementById('ctxEdit').addEventListener('click', () => context.openContextModal());
document.getElementById('ctxClear').addEventListener('click', () => { context.clear(); showToast('已清除生产场景'); });
document.getElementById('ctxSave').addEventListener('click', () => context.saveContextModal());
document.getElementById('ctxCancel').addEventListener('click', () => { document.getElementById('ctxModal').hidden = true; });
const ctxModalEl = document.getElementById('ctxModal');
ctxModalEl.addEventListener('click', (e) => {
  if (e.target === ctxModalEl || e.target.closest('[data-close-ctx]')) ctxModalEl.hidden = true;
});

/* ---- 反馈（请用户发邮件反馈问题 + 感谢） ---- */
document.getElementById('btnSource').addEventListener('click', () => {
  const m = document.getElementById('feedbackModal');
  if (m) m.hidden = false;
});
document.getElementById('feedbackModal').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]') || e.target === document.getElementById('feedbackModal')) document.getElementById('feedbackModal').hidden = true;
});

/* ---- 关于 / 许可 ---- */
document.getElementById('btnAbout').addEventListener('click', () => {
  document.getElementById('aboutModal').hidden = false;
});
document.getElementById('aboutModal').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-about]') || e.target === document.getElementById('aboutModal')) document.getElementById('aboutModal').hidden = true;
});

/* ---- 捐助弹窗 / 二维码放大（打开入口在侧栏「☕ 捐助」，见导航委托） ---- */
const donateModal = document.getElementById('donateModal');
const qrLightbox = document.getElementById('qrLightbox');
donateModal.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-modal]') || e.target === donateModal) donateModal.hidden = true;
});
document.querySelector('[data-open-lightbox]').addEventListener('click', () => { qrLightbox.hidden = false; });
qrLightbox.addEventListener('click', (e) => {
  if (e.target.closest('[data-close-lightbox]') || e.target.tagName !== 'IMG') qrLightbox.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    qrLightbox.hidden = true; donateModal.hidden = true; devModalEl.hidden = true; ctxModalEl.hidden = true;
    // 计算工具的报告弹窗（每次渲染重建，全局兜底关闭）
    document.querySelectorAll('.modal-overlay').forEach(m => { if (!m.hidden) m.hidden = true; });
  }
});

/* ---- 启动 ---- */
devmode.applyNav();
context.renderContextBar();
render();
