// ============================================================
// 捐助支持 · 平铺页面视图（73.txt：由弹窗改为独立导航页，内容不变）
// 侧栏「☕ 捐助」→ #/donate；二维码放大复用全局 qrLightbox（data-open-lightbox 委托绑定于 app.js）
// PHASE 72：文案走 i18n（中英）——视图支持换语言（无表单状态，重渲染即可）
// ============================================================
import { t } from '../i18n/index.js';
import { markRelocalizable } from '../i18n/viewState.js';

const LINES = [
  '这个小工具，写给每一位还在炉前、案头埋头苦干的铸造同行。',
  '它<b>完全开源、永久免费</b>，只想让咱们这行人的日常，少一点差错、省一点时间。',
  '铸造是工业之母，每一件铸件背后，都是几代人的汗水与手艺。',
  '愿这个小小的工具箱，能陪你把铁水浇得更顺、把铸件做得更好。',
  '如果它对你有一点用，随手打个赏、转个发，就是对我们最大的鼓励。',
];

export function render(container) {
  markRelocalizable();   // PHASE 72：纯展示页，无表单状态 → 切语言直接重渲染
  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="tool-icon" style="width:40px;height:40px;font-size:1.15rem">☕</span>
        <div>
          <h1 class="page-title" style="font-size:1.2rem">${t('捐助支持')}</h1>
          <p class="page-sub">${t('完全开源 · 永久免费 · 每一份支持都是鼓励')}</p>
        </div>
      </div>
      <span class="badge-status badge-ready">${t('✓ 免费使用')}</span>
    </div>

    <div class="donate-page">
      <div class="card section-card" style="max-width:560px;margin:0 auto">
        <div class="section-card-title">${t('💝 写在前面')}</div>
        <div class="donate-heart">
          ${LINES.map(l => `<p>${t(l)}</p>`).join('\n          ')}
          <p class="donate-strong">${t('谢谢你，愿中国的铸造行业，越走越亮 🌟')}</p>
        </div>
        <div class="donate-scan">
          <img class="donate-qr" src="assets/alipay_qr.png" alt="${t('支付宝收款码')}" data-open-lightbox>
          <div class="donate-tip">${t('👆 点击二维码可放大 · 金额随意 ☕')}</div>
          <div class="donate-author">${t('作者：感谢每一天的生活 · 联系：320451242@QQ.COM · THEZHAZHE@gmail.com · QQ 群：1106396422')}</div>
        </div>
      </div>
    </div>
  `;
}
