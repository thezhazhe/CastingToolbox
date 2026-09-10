// ============================================================
// 示例默认值标识（PHASE 63 · P1-2）
// 轻量 UI：输入框旁 "示例" 小标 + 结果区一行提示；
// 用户改动任意带标输入后，标识与提示自动消失。
// 不做弹窗、不挡操作。纯 DOM 辅助（不入计算链）。
// ============================================================

import { t } from '../i18n/index.js';   // PHASE 73：示例标与提示接入双语（原先整块中文，英文界面下裸露）

/** 示例提示（按当前语言取词条；中文原文即 key） */
export const exampleNote = () =>
  `<div class="ex-note">${t('⚠️ 上方为<b>示例默认值</b>（演示数据，非你当前产品识别结果）——请替换为你的铸件实际参数，修改任意输入后本提示自动消失。')}</div>`;

/** @deprecated 兼容旧引用；请用 exampleNote() */
export const EXAMPLE_NOTE = '<div class="ex-note">⚠️ 上方为<b>示例默认值</b>（演示数据，非你当前产品识别结果）——请替换为你的铸件实际参数，修改任意输入后本提示自动消失。</div>';

/* PHASE 72：语言切换会重渲染视图。若用户在切换前已改动过输入（示例标早已消失），
   重渲染不应把"示例"标又贴回来——切换期间由 i18n/viewState.js 置位抑制。 */
let SUPPRESS = false;
export function suppressExampleTags(v = true) { SUPPRESS = !!v; }

/**
 * @param {HTMLElement} container 视图容器
 * @param {string[]} ids 要打标的输入 id 列表（须已存在于 DOM）
 * @returns {{ clean:()=>boolean, exampleNote:()=>string }}
 *   clean() —— 是否仍处于"未动过的示例态"；exampleNote() —— 示例态时返回提示 HTML，否则 ''
 */
export function installExampleTags(container, ids) {
  // PHASE 72：语言切换重渲染期间抑制（用户已动过输入 → 不再贴"示例"标、不再出提示）
  if (SUPPRESS) return { clean: () => false, exampleNote: () => '' };
  const tags = [];
  for (const id of ids) {
    const el = container.querySelector('#' + id);
    if (!el) continue;
    const b = document.createElement('span');
    b.className = 'tag-example';
    b.textContent = t('示例');
    el.insertAdjacentElement('afterend', b);
    tags.push({ el, b });
  }
  const clear = () => {
    if (!tags.length) return;
    for (const t of tags) t.b.remove();
    tags.length = 0;
  };
  for (const t of tags) t.el.addEventListener('input', clear);
  return {
    clean: () => tags.length > 0,
    exampleNote: () => (tags.length ? exampleNote() : ''),
  };
}
