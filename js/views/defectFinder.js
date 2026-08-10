// ============================================================
// 缺陷查找 · 视图（第 8 个计算工具）
// 按 缺陷名 / 俗称 / 症状 → 定位缺陷 → 特征 / 原因 / 解决方式
// 数据：data/defects.js（分类+别名）· data/defects/*.json（对策正文）
// 逻辑：js/defect.js（searchDefects）· 材质过滤走 TAGS mat:
// 点击条目 → #/search/<id> 查看完整工艺卡片（相关标准/计算工具/知识）
// ============================================================
import { searchDefects, categoryCounts, defectDocs } from '../defect.js';
import { DEFECT_CATEGORIES, categoryOf } from '../../data/defects.js';
import { FAMILIES, prefillMaterial } from '../context.js';
import { renderNextSteps } from './nextSteps.js';

const CONF = {
  high: { label: '🟢 高置信', cls: 'conf-high' },
  'medium-high': { label: '🟡 中高置信', cls: 'conf-midhi' },
  medium: { label: '🟠 中置信', cls: 'conf-mid' },
};
const confText = (c) => { const m = CONF[c]; return m ? `<span class="kb-conf ${m.cls}">${m.label}</span>` : ''; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CAT_NAME = (id) => (DEFECT_CATEGORIES.find(c => c.id === id) || {}).name || '其他';

export async function renderDefectFinder(container, calc) {
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
        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">1</span>🔍 描述问题 <small>输入缺陷名 / 俗称 / 症状，越具体越准</small></div>
          <div class="f-row" style="margin:12px 0 14px">
            <input class="field-input" id="df_q" type="text" placeholder="例如：缩松 · 气孔 · 上表面 圆形孔洞 · 球化不良 · 夹渣…" style="flex:1;font-size:.92rem;padding:11px 14px">
            <button class="btn btn-primary" id="df_go" style="margin-left:8px;white-space:nowrap">🔍 查找</button>
          </div>
          <div class="field" style="margin-bottom:12px">
            <label class="field-label">🔩 按材质过滤（可先在生产场景里设材料，自动带入）</label>
            <div class="f-row"><select class="field-select" id="df_mat"><option value="">全部材质</option>${FAMILIES.map(f => `<option>${f}</option>`).join('')}</select></div>
          </div>
          <div class="field">
            <label class="field-label">🗂 按分类过滤（GB/T 5611 八大类）</label>
            <div class="df-chips" id="df_chips"></div>
          </div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">2</span>🩹 命中缺陷 <span id="df_count" class="chip" style="margin-left:6px"></span></div>
          <div class="kb-list" id="df_results" style="margin-top:10px">
            <div class="empty" style="padding:26px"><span class="empty-sub">加载中…</span></div>
          </div>
        </div>

        <div class="card section-card">
          <div class="section-card-title"><span class="step-badge">3</span>📖 说明</div>
          <div class="field-hint" style="line-height:1.8">
            · <b>怎么用</b>：输入缺陷名（缩松/气孔）、俗称（呛火/砂眼）或症状（"上表面 圆形孔洞"）即可定位；也可直接按分类 / 材质浏览。<br>
            · <b>看对策</b>：点击命中条目打开<b>完整工艺卡片</b>，内含 特征·原因·对策·检验方法，以及<b>相关标准 / 相关计算工具 / 相关知识</b>。<br>
            · <b>分类依据</b>：GB/T 5611《铸造术语》八大类；材质过滤按知识库标签匹配。<br>
            · <b>数据可信度</b>：每条对策带置信度（🟢 一手/官方 · 🟡 标准成熟值 · 🟠 二手整理），出处见卡片「📌 出处」。
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('[data-back]').addEventListener('click', () => { location.hash = '#/calculators'; });

  const q = (id) => container.querySelector(id);
  const resultsEl = q('#df_results');
  const countEl = q('#df_count');

  // 按当前生产场景预选材质
  prefillMaterial(container, '#df_mat');

  // 从详情返回时恢复搜索状态（查询词/材质/分类）
  // 注意：不立即删除 sessionStorage（app 一次导航会 render 两次），
  // 改为用户下一次改动搜索条件时再清除，避免第二次渲染把恢复值覆盖掉。
  let cat = '';
  try {
    const saved = JSON.parse(sessionStorage.getItem('ct-defect-state') || 'null');
    if (saved) {
      if (saved.q) q('#df_q').value = saved.q;
      if (saved.mat) q('#df_mat').value = saved.mat;
      if (saved.cat) cat = saved.cat;
    }
  } catch (e) {}

  // 分类计数恒定（不随过滤变化），一次算好
  const counts = categoryCounts(await defectDocs());
  const renderChips = (counts) => {
    q('#df_chips').innerHTML =
      `<button class="chip df-chip ${!cat ? 'active' : ''}" data-cat="">全部（${counts.all || 0}）</button>`
      + DEFECT_CATEGORIES.map(c => {
        const n = counts[c.id] || 0;
        return `<button class="chip df-chip ${cat === c.id ? 'active' : ''}" data-cat="${c.id}" title="${esc(c.desc)}">${c.icon} ${c.name}（${n}）</button>`;
      }).join('');
    q('#df_chips').querySelectorAll('[data-cat]').forEach(el =>
      el.addEventListener('click', () => { cat = el.dataset.cat; try { sessionStorage.removeItem('ct-defect-state'); } catch (e) {} run(); }));
  };

  const run = async () => {
    const query = q('#df_q').value;
    const mat = q('#df_mat').value;
    const { hits, total } = await searchDefects(query, { mat, cat });
    renderChips(counts);   // 分类计数恒定，仅重绘以更新激活态
    countEl.textContent = `共 ${total} 条缺陷`;
    if (!hits.length) {
      resultsEl.innerHTML = `<div class="empty" style="padding:26px"><div class="empty-icon">🔍</div><div class="empty-title">没有匹配的缺陷</div><div class="empty-sub">换个说法，或减少过滤条件再试（如去掉材质/分类过滤）。</div></div>`;
      return;
    }
    // 空查询按分类顺序展示
    const order = Object.fromEntries(DEFECT_CATEGORIES.map((c, i) => [c.id, i]));
    const sorted = query.trim() ? hits : hits.sort((a, b) =>
      (order[categoryOf(a.doc.id)] ?? 99) - (order[categoryOf(b.doc.id)] ?? 99) || a.doc.title.localeCompare(b.doc.title));
    resultsEl.innerHTML = sorted.map(({ doc }) => {
      const causes = Object.keys(doc.content?.priority_causes || {}).length || (doc.content?.causes || []).length;
      const prevents = (doc.content?.remedies || doc.content?.prevention || []).length;
      const sym = (doc.content?.symptoms || [])[0] || '';
      return `
      <div class="card hover kb-item defect-hit cat-def" data-id="${doc.id}">
        <div class="kb-item-main">
          <div class="kb-item-title">${esc(doc.title)}
            <span class="chip" style="margin-left:6px">${CAT_NAME(doc.id)}</span>${confText(doc.confidence)}</div>
          ${sym ? `<div class="kb-item-summary">典型现象：${esc(sym)}</div>` : ''}
          <div class="kb-item-meta">${esc(doc.reference?.book || '')} · 原因 ${causes} 条 · 对策 ${prevents} 条${doc.how ? ` · <span class="df-how">${esc(doc.how)}</span>` : ''}</div>
        </div>
        <div class="kb-item-right"><span class="kb-arrow">›</span></div>
      </div>`;
    }).join('');
    resultsEl.querySelectorAll('[data-id]').forEach(el =>
      el.addEventListener('click', () => {
        // 记下返回地址 + 当前搜索状态，详情返回时回到缺陷查找并恢复
        try {
          sessionStorage.setItem('ct-detail-return', location.hash);
          sessionStorage.setItem('ct-defect-state', JSON.stringify({ q: q('#df_q').value, mat: q('#df_mat').value, cat }));
        } catch (e) {}
        location.hash = '#/search/' + el.dataset.id;
      }));
  };

  // 用户主动改动搜索 → 清除"返回时恢复"的暂存（避免下次误恢复旧词）
  const userChanged = () => { try { sessionStorage.removeItem('ct-defect-state'); } catch (e) {} };
  const go = () => { userChanged(); run(); };
  q('#df_go').addEventListener('click', go);
  q('#df_q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  q('#df_q').addEventListener('input', () => { userChanged(); clearTimeout(go._t); go._t = setTimeout(run, 200); });
  q('#df_mat').addEventListener('change', () => { userChanged(); run(); });

  run();
  renderNextSteps(container, calc);
}
