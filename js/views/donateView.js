// ============================================================
// 支持与资源 · 平铺页面视图（83.txt 四/五：原「捐助」页改版）
// 侧栏「🤝 支持与资源」→ #/donate（路由名保持不变，书签/测试契约不破）
// 二维码放大复用全局 qrLightbox（data-open-lightbox 委托绑定于 app.js）
// 支持者数据来自 data/supporters.js——加人只改那个文件，本视图不动。
// PHASE 72：文案走 i18n（中英）——纯展示页无表单状态，切语言直接重渲染
// ============================================================
import { t } from '../i18n/index.js';
import { markRelocalizable } from '../i18n/viewState.js';
import { SUPPORTERS } from '../../data/supporters.js';

/**
 * 一行支持者卡片（字段为空则不渲染该行，不编造）。
 * ⚠ note 里的换行靠 CSS 的 white-space: pre-line 呈现 —— 全程 esc()，
 *   **不解析任何 HTML**（这份数据来自外部投稿，绝不能当标记注入）。
 */
function personHtml(p) {
  const meta = [p.company, p.city, p.contact, p.since].filter(Boolean).join(' · ');
  return `<div class="sr-person">
    <div class="sr-person-name">${esc(p.name || '')}</div>
    ${meta ? `<div class="sr-person-meta">${esc(meta)}</div>` : ''}
    ${p.note ? `<div class="sr-person-note">${esc(p.note)}</div>` : ''}
  </div>`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function render(container) {
  markRelocalizable();   // PHASE 72：纯展示页，无表单状态 → 切语言直接重渲染
  const people = Array.isArray(SUPPORTERS) ? SUPPORTERS.filter((p) => p && p.name) : [];

  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="tool-icon" style="width:40px;height:40px;font-size:1.15rem">🤝</span>
        <div>
          <h1 class="page-title" style="font-size:1.2rem">${t('支持与资源')}</h1>
          <p class="page-sub">${t('免费工具 · 持续开发中 · 每一份支持都是鼓励')}</p>
        </div>
      </div>
      <span class="badge-status badge-ready">${t('✓ 免费开源')}</span>
    </div>

    <div class="donate-page">
      <p class="sr-lead">${t('Casting Toolbox 是一个面向铸造工程师的免费工具，目前持续开发和完善中。如果你认可这个项目，欢迎通过支付宝支持项目继续开发。')}</p>

      <div class="sr-grid">
        <!-- 左列：① 支持方式（二维码为页面主操作，给固定窄栏） -->
        <div class="card section-card sr-card sr-card-qr">
          <div class="section-card-title">${t('💚 支持方式')}</div>
          <div class="donate-scan" style="margin-top:0">
            <img class="donate-qr" src="assets/alipay_qr.png" alt="${t('支付宝收款码')}" data-open-lightbox>
            <div class="donate-tip">${t('👆 点击二维码可放大 · 金额随意')}</div>
          </div>
          <ul class="sr-list">
            <li>${t('支付宝扫码支持，金额随意，量力而行。')}</li>
            <li>${t('可以在转账备注中填写希望展示的信息。')}</li>
          </ul>
          <div class="donate-author">${t('作者：感谢每一天的生活 · 联系：320451242@QQ.COM · THEZHAZHE@gmail.com · QQ 群：1106396422')}</div>
        </div>

        <!-- 右列：② 支持者展示 + ③ 支持者名单（名单天然需要高度，吸收两列高差） -->
        <div class="sr-col">
          <div class="card section-card sr-card">
            <div class="section-card-title">${t('🏷️ 支持者展示')}</div>
            <ul class="sr-list">
              <li>${t('单次支持 100 元及以上，并主动提供展示信息、同意公开后，可加入支持者名单。')}</li>
              <li>${t('可展示：姓名 / 昵称、公司名称、所在城市、联系方式、简短介绍。')}</li>
              <li>${t('不公开支持金额。')}</li>
            </ul>
            <div class="sr-note">
              <b>⚠️ ${t('一个重要说明')}</b><br>
              ${t('支持与资源不是传统广告位，不承诺首页、计算器或其他核心功能区域的广告曝光。')}
            </div>
            <div class="sr-note sr-disclaimer">
              <b>ℹ️ ${t('关于支持者名单')}</b><br>
              ${t('名单中的信息由支持者本人提供并同意公开，仅作展示之用。我们并未核实其实际经营情况，也不构成任何推荐或背书。设立这一板块的用意，是为大家提供一个互相交流、寻找行业资源的场所，具体情况请自行判断与核实。')}
            </div>
          </div>

          <div class="card section-card sr-card sr-card-grow">
            <div class="section-card-title">${t('👥 支持者名单')}<small>${people.length ? t('共 {n} 位', [people.length]) : ''}</small></div>
            ${people.length
              ? `<div class="sr-people">${people.map(personHtml).join('')}</div>`
              : `<div class="sr-empty">${t('名单暂时为空 —— 第一位支持者的信息会显示在这里。')}</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}
