// ============================================================
// PHASE 72（80.txt）· 轻量 i18n 层（zh-CN / en-US）
//
// 设计要点（为什么这样做）：
//  1) **中文原文即 key**：`t('冒口设计')`。翻译表缺失任何一条时，查表落空 →
//     直接返回 key 本身 = 中文原文。这天然满足 80.txt §19 的 fallback 要求
//     （英文缺译 → 显示中文原文），且**永远不会**出现 undefined / [translation.key]。
//  2) 语义 key（`t('nav.home')`）同样支持——全局导航/首页这类"骨架"文案用语义 key，
//     与 zh-CN.js 里的对照表一一对应；两类 key 共用同一个 t()，查表顺序见下。
//  3) 本层**只做显示**：不读不写 CastingProject、不碰任何公式与计算结果。
//     locale 单独存 localStorage（castingToolbox.locale），与项目数据完全隔离。
// ============================================================
import ZH from './zh-CN.js';
import EN from './en-US.js';

export const LOCALES = ['zh-CN', 'en-US'];
export const LOCALE_KEY = 'castingToolbox.locale';   // 80.txt §五
export const DEFAULT_LOCALE = 'zh-CN';

const DICTS = { 'zh-CN': ZH, 'en-US': EN };
const LISTENERS = new Set();

let locale = DEFAULT_LOCALE;

/** 读持久化语言（无存档 / 非法值 → zh-CN 默认） */
export function readSavedLocale() {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return LOCALES.includes(v) ? v : DEFAULT_LOCALE;
  } catch (e) { return DEFAULT_LOCALE; }
}

export function getLocale() { return locale; }
export function isEn() { return locale === 'en-US'; }

/** 语言显示名（切换器用） */
export const LOCALE_LABEL = { 'zh-CN': '中文', 'en-US': 'English' };

/**
 * 取翻译文本。
 * @param {string} key 语义 key（'nav.home'）或中文原文（'冒口设计'）
 * @param {object|Array} [vars] 插值变量（{n: 3} 或位置参数数组），也可给函数型词条
 * @returns {string} 当前语言文本；缺译 → 中文原文；再缺 → key 本身
 */
export function t(key, vars) {
  if (key == null) return '';
  const dict = DICTS[locale] || {};
  let s = dict[key];
  if (s === undefined) s = ZH[key];        // 语义 key 的中文基准
  if (s === undefined) s = key;            // 中文原文即 key → 原样返回
  if (typeof s === 'function') return String(s(vars));
  if (vars === undefined) return String(s);
  if (Array.isArray(vars)) {
    let i = 0;
    return String(s).replace(/\{(\w*)\}/g, () => String(vars[i++] ?? ''));
  }
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

/**
 * 切换语言：写 localStorage + 更新 <html lang> + 通知订阅者。
 * 不触发任何项目/计算动作（80.txt §十八硬性要求）。
 * @returns {boolean} 是否发生了实际切换
 */
export function setLocale(next) {
  if (!LOCALES.includes(next) || next === locale) return false;
  locale = next;
  try { localStorage.setItem(LOCALE_KEY, next); } catch (e) { /* 隐私模式忽略 */ }
  applyHtmlLang();
  LISTENERS.forEach(fn => { try { fn(locale); } catch (e) { console.error('[i18n] listener 失败:', e); } });
  return true;
}

/** 启动时调用：读存档 → 设 <html lang>（不触发订阅者） */
export function initLocale() {
  locale = readSavedLocale();
  applyHtmlLang();
  return locale;
}

function applyHtmlLang() {
  try { if (typeof document !== 'undefined') document.documentElement.lang = locale; } catch (e) {}
}

export function onChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }

/* ============================================================
   原地翻译：给静态 DOM 节点标 data-i18n（外壳 index.html 用）
     <span data-i18n="nav.home"></span>              → textContent
     <div data-i18n-html="about.body">（含标签的长文案）  → innerHTML
     <input data-i18n-placeholder="search.hint">     → placeholder
     <button data-i18n-title="theme.title">          → title
     <button data-i18n-aria="…">                     → aria-label
   视图内部文案在 render 时直接 t() 取值，不走这里（切换语言时整视图重渲染）。
   ============================================================ */
export function applyDom(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t(el.dataset.i18n);
    if (v !== el.textContent) el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-alt]').forEach(el => { el.alt = t(el.dataset.i18nAlt); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

export default { t, setLocale, getLocale, isEn, initLocale, onChange, applyDom, LOCALES, LOCALE_KEY, LOCALE_LABEL };
