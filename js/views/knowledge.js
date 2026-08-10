// ============================================================
// 知识库视图：主题树浏览 / 搜索 / 详情
// 树结构来自 data/taxonomy.js（组织层，数据文件不动）
// 主题 → 分支 → 分组 → 条目卡片；双显条目（links）跨主题可查
// ============================================================
import { loadKnowledge, searchKnowledge, searchCalcs } from '../search.js';
import { CALCULATORS } from '../../calcs/registry.js';
import { TAXONOMY, themeOfId } from '../../data/taxonomy.js';
import { TAGS } from '../../data/tags.js';
import { isUnlocked } from '../devmode.js';
import * as context from '../context.js';

// 字段键 → 中文标签（材料等结构化内容的详情渲染用）
const FIELD_LABELS = {
  identity: '标识', composition: '化学成分', physical: '物理性能', mechanical: '力学性能',
  pouring: '浇注参数', casting_behavior: '凝固特性', recommendations: '工艺建议', notes: '备注',
  symptoms: '现象', causes: '原因', prevention: '预防措施', inspection: '检验方法',
  // 缺陷诊断式字段（v1.17 升级）
  on_site: '现场表现', priority_causes: '可能原因（按优先级）', check_order: '检查顺序', remedies: '解决措施',
  // Campbell 十规则字段
  rule: '规则', mechanism: '机理', parameter: '关键参数', violation: '违反后果', check: '检查要点', defects: '关联缺陷',
  standard: '标准号', carbon: '碳 C', silicon: '硅 Si', manganese: '锰 Mn', phosphorus: '磷 P',
  sulfur: '硫 S', carbon_equivalent: '碳当量 CE', magnesium: '镁 Mg', copper: '铜 Cu',
  aluminum: '铝 Al', tin: '锡 Sn', lead: '铅 Pb', zinc: '锌 Zn', titanium: '钛 Ti', iron: '铁 Fe',
  magnesium_residual: '残留镁', inoculant: '孕育剂', spheroidizer: '球化剂',
  density: '密度', linear_shrinkage: '线收缩率', volumetric_shrinkage: '体收缩率',
  tensile_strength: '抗拉强度', yield_strength: '屈服强度', elongation: '延伸率', hardness: '硬度',
  pour_temperature: '浇注温度', yield_range: '出品率范围',
  solidification: '凝固特性', riser_efficiency: '补缩效率',
};
const L = (key) => FIELD_LABELS[key] || key;

// 数据置信度：🟢 一手工厂资料/官方手册 → 高；🟡 标准成熟值 → 中高；🟠 二手整理 → 中
const CONF = {
  high:        { label: '高置信',   cls: 'conf-high' },
  'medium-high': { label: '中高置信', cls: 'conf-midhi' },
  medium:      { label: '中置信',   cls: 'conf-mid' },
};
const confText = (c) => {
  const m = CONF[c];
  return m ? `<span class="kb-conf ${m.cls}">${m.label}</span>` : '';
};

let expandedThemes = new Set();
let searchQuery = null;

export function setQuery(q) { searchQuery = q || null; }

export function render(container, params = {}) {
  // 三级树仅开发者可见（后台维护用）；普通用户用搜索（#/search 独立页）
  if (!isUnlocked()) return renderLock(container);
  renderTree(container, params.cat);
}

/* ================= 开发者锁屏（未解锁浏览三级树） ================= */
function renderLock(container) {
  container.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">工艺资料库</h1>
      <p class="page-sub">知识条目通过顶部搜索使用；三级树仅供后台维护浏览。</p>
    </div>
    <div class="card" style="padding:44px;text-align:center">
      <div class="empty-icon">🔒</div>
      <div class="empty-title">需要开发者权限</div>
      <div class="empty-sub">工艺资料库三级树仅对开发者开放（后台维护用）。<br>点击首页 Logo 5 次（或左上角 Logo），输入密码解锁。</div>
    </div>
  `;
}

/* ================= 主题树浏览 ================= */
async function renderTree(container, themeId) {
  searchQuery = null;   // 清陈旧搜索词，详情返回不再误回旧结果
  const docs = await loadKnowledge();
  const byId = new Map(docs.map(d => [d.id, d]));
  if (themeId && TAXONOMY.some(t => t.id === themeId)) expandedThemes.add(themeId);
  if (expandedThemes.size === 0) expandedThemes.add(TAXONOMY[0].id);

  container.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">知识库</h1>
      <p class="page-sub">${docs.length} 条 · 主题树浏览 · 每条保留出处（书/章/页）· 顶部搜索支持全文</p>
    </div>
    <div class="kb-tree">
      ${TAXONOMY.map(t => themeSection(t, byId)).join('')}
    </div>
  `;
  container.querySelectorAll('[data-theme-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.themeToggle;
      if (expandedThemes.has(id)) expandedThemes.delete(id); else expandedThemes.add(id);
      renderTree(container, id);
    });
  });
  container.querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => {
      const doc = byId.get(el.dataset.id);
      if (doc) renderDetail(container, doc, docs);
    }));
}

function themeSection(t, byId) {
  const isExp = expandedThemes.has(t.id);
  return `<div class="kb-theme ${isExp ? 'expanded' : ''}">
    <button class="kb-theme-head" data-theme-toggle="${t.id}">
      <span class="kb-theme-icon">${t.icon}</span>
      <span class="kb-theme-name">${escapeHtml(t.name)}</span>
      <span class="kb-theme-count">${countNode(t)}</span>
      <span class="kb-theme-arrow">${isExp ? '▾' : '▸'}</span>
    </button>
    <div class="kb-theme-desc">${escapeHtml(t.desc || '')}</div>
    ${isExp ? `<div class="kb-theme-body">${themeBody(t.children, byId)}</div>` : ''}
  </div>`;
}

function countNode(node) {
  if (node.items) return node.items.length;
  if (node.children) return node.children.reduce((s, c) => s + countNode(c), 0);
  return 0;
}

function themeBody(nodes, byId) {
  return nodes.map(node => {
    if (node.children && node.children.length) {
      return `<div class="kb-branch">
        <div class="kb-branch-title">${escapeHtml(node.name)}<span class="chip" style="margin-left:6px">${countNode(node)}</span></div>
        <div class="kb-branch-body">${themeBody(node.children, byId)}</div>
      </div>`;
    }
    const items = node.items || [];
    const links = node.links || [];
    let html = `<div class="kb-group">
      <div class="kb-group-title">${escapeHtml(node.name)}${items.length ? `<span class="chip" style="margin-left:6px">${items.length}</span>` : ''}</div>`;
    if (items.length) {
      html += `<div class="kb-list">${items.map(id => byId.get(id) ? cardHtml(byId.get(id)) : missingCard(id)).join('')}</div>`;
    }
    if (links.length) {
      html += `<div class="kb-links-block">
        <div class="kb-links-label">🔗 双显条目 · 主位于其他主题，此处可直达</div>
        <div class="kb-list">${links.map(id => byId.get(id) ? cardHtml(byId.get(id), { linked: true }) : missingCard(id)).join('')}</div>
      </div>`;
    }
    return html + `</div>`;
  }).join('');
}

function missingCard(id) {
  return `<div class="card kb-item"><div class="kb-item-title">${escapeHtml(id)}（数据缺失）</div></div>`;
}

/* ================= 搜索（分类结果） ================= */
// 结果类别（确定性优先级：材料 > 缺陷 > 标准 > 知识）
function searchCategory(doc) {
  if (doc._cat === 'materials') return 'materials';
  if (doc._cat === 'defects') return 'defects';
  if (doc._cat === 'rules') return 'rule';
  const stdText = (doc.title || '') + ' ' + (doc.keywords || []).join(' ') + ' ' + (doc.content?.standard || '');
  if (/GB(\/T)?\s*\d/.test(stdText)) return 'std';
  return 'kb';
}
const SEARCH_GROUP_LABEL = { materials: '🧪 材料', kb: '📖 知识', defects: '🩹 常见缺陷', std: '📜 标准', rule: '🧭 工艺原则' };

/* 分类色条类（复用 searchCategory 判定：材料蓝 / 缺陷玫红 / 标准绿 / 知识紫 / 规则琥珀） */
function catClass(doc) {
  const CAT_CLS = { materials: 'cat-mat', defects: 'cat-def', std: 'cat-std', kb: 'cat-kb', rule: 'cat-rule' };
  return CAT_CLS[searchCategory(doc)] || 'cat-kb';
}

/* #/search 独立页入口（由 views/search.js 委托调用） */
export function renderSearchPage(container) { return renderSearch(container); }

/** 按文档 id 打开工艺卡片（首页推荐 / 搜索结果点击） */
export async function showDetail(container, docId) {
  const docs = await loadKnowledge();
  const doc = docs.find(d => d.id === docId);
  if (!doc) { searchQuery = null; location.hash = '#/home'; return; }
  renderDetail(container, doc, docs);
}

async function renderSearch(container) {
  window.scrollTo(0, 0);   // 详情→返回：回到结果顶部
  const docs = await loadKnowledge();
  const q = searchQuery || '';
  if (!q.trim()) {
    container.innerHTML = `<div class="page-head"><h1 class="page-title">搜索结果</h1><p class="page-sub">在顶部或首页输入关键词开始搜索。</p></div>`;
    return;
  }
  const kResults = searchKnowledge(q, docs);
  // 相关计算器 = 关键词匹配 + 命中知识条目显式关联（related_calcs）
  const calcs = searchCalcs(q);
  for (const r of kResults) {
    for (const id of (r.doc.related_calcs || [])) {
      const c = CALCULATORS.find(x => x.id === id && x.status === 'ready');
      if (c && !calcs.includes(c)) calcs.push(c);
    }
  }
  // 分类分组
  const groups = { materials: [], kb: [], defects: [], std: [], rule: [] };
  for (const r of kResults) groups[searchCategory(r.doc)].push(r);
  // 符合生产场景（按标签匹配，只提升不隐藏，结果稳定）
  const ctxMatches = context.hasAny()
    ? kResults.filter(r => context.matchesContext(r.doc.id, TAGS[r.doc.id]))
    : [];

  // 分组按"组内最高分"降序渲染：搜"缩松"先出缺陷组（标题命中），搜"QT450"先出材料组
  const groupMax = (key) => groups[key].length ? groups[key][0].score : 0;   // 组内已按分排序
  const calcScore = (c) => {
    const name = c.name.toLowerCase(), ql = q.toLowerCase();
    if (name.includes(ql)) return 10;
    if ((c.keywords || []).some(k => k.toLowerCase().includes(ql) || ql.includes(k.toLowerCase()))) return 8;
    return 4;
  };
  const groupHtml = (key) => groups[key].length ? `
    <div class="group-title" style="margin:18px 0 8px">${SEARCH_GROUP_LABEL[key]}（${groups[key].length}）</div>
    <div class="kb-list">${groups[key].map(r => cardHtml(r.doc, { snippet: r.snippet })).join('')}</div>` : '';
  // 分高者先显示；同分时按 材料 > 缺陷 > 标准 > 知识 的偏好顺序（搜 QT450 材料组在前）
  const GROUP_PRIORITY = { ctx: -1, materials: 0, defects: 1, std: 2, rule: 3, kb: 4, calcs: 5 };
  const sections = [];
  if (ctxMatches.length) sections.push({ key: 'ctx', score: Infinity, html: `
    <div class="group-title" style="margin:14px 0 8px;color:var(--primary)">🎯 符合生产场景（${ctxMatches.length}）</div>
    <div class="kb-list">${ctxMatches.map(r => cardHtml(r.doc, { snippet: r.snippet })).join('')}</div>` });
  sections.push(
    { key: 'defects', score: groupMax('defects'), html: groupHtml('defects') },
    { key: 'std', score: groupMax('std'), html: groupHtml('std') },
    { key: 'rule', score: groupMax('rule'), html: groupHtml('rule') },
    { key: 'materials', score: groupMax('materials'), html: groupHtml('materials') },
    { key: 'kb', score: groupMax('kb'), html: groupHtml('kb') },
    { key: 'calcs', score: calcs.length ? Math.max(...calcs.map(calcScore)) : 0, html: calcs.length ? `
      <div class="group-title" style="margin:18px 0 8px">🧮 计算工具（${calcs.length}）</div>
      <div class="tools-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
        ${calcs.map(c => `<div class="card hover tool-card" data-open-calc="${c.id}">
          <div class="tool-top"><div class="tool-icon">${c.icon}</div><div><div class="tool-name">${c.name}</div><div class="tool-desc">${c.desc}</div></div></div>
        </div>`).join('')}
      </div>` : '' },
  );
  sections.sort((a, b) => b.score - a.score || GROUP_PRIORITY[a.key] - GROUP_PRIORITY[b.key]);

  container.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">搜索结果</h1>
      <p class="page-sub">“${escapeHtml(q)}” · 共 ${kResults.length} 条知识 · ${calcs.length} 个计算工具
        <button class="btn btn-ghost" id="kb_clear" style="margin-left:8px;padding:4px 12px">✕ 清除</button></p>
    </div>
    ${sections.map(s => s.html).join('')}
    ${kResults.length === 0 && calcs.length === 0
      ? `<div class="card"><div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">没有找到“${escapeHtml(q)}”</div><div class="empty-sub">试试材料牌号（如 QT450）、缺陷名（如 气孔）、工艺词（如 浇注温度）。</div></div></div>` : ''}
  `;

  container.querySelector('#kb_clear').addEventListener('click', () => {
    searchQuery = null;
    location.hash = '#/home';   // hashchange 触发 app.render() 回首页
  });
  const docsById = new Map(docs.map(d => [d.id, d]));
  container.querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => {
      const doc = docsById.get(el.dataset.id);
      if (doc) renderDetail(container, doc, docs);
    }));
  container.querySelectorAll('[data-open-calc]').forEach(el =>
    el.addEventListener('click', () => { location.hash = '#/calculators/' + el.dataset.openCalc; }));
}

/* ================= 详情（工艺卡片） ================= */
// 共享某前缀标签（mat:/std:/calc:…）→ 确定性互链
function sharesTag(a, b, prefix) {
  const ta = TAGS[a.id] || [], tb = TAGS[b.id] || [];
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb.filter(t => t.startsWith(prefix + ':')));
  return ta.some(t => setB.has(t));
}
// 相关计算工具 = 显式 related_calcs + 标签 calc:
function relatedCalcsOf(doc) {
  const ids = new Set();
  (doc.related_calcs || []).forEach(id => ids.add(id));
  (TAGS[doc.id] || []).filter(t => t.startsWith('calc:')).forEach(t => ids.add(t.slice('calc:'.length)));
  return [...ids].map(id => CALCULATORS.find(c => c.id === id && c.status === 'ready')).filter(Boolean);
}

function renderDetail(container, doc, docs) {
  window.scrollTo(0, 0);   // 搜索结果/相关条目点进详情是"原地渲染"（不走 hash），必须手动回顶部
  const theme = themeOfId(doc.id);
  const themeName = theme ? `${theme.icon} ${theme.name}` : (doc._cat || '');
  // 相关计算工具
  const relCalcs = relatedCalcsOf(doc);
  // 常见缺陷（同材质，共享 mat: 标签；缺陷类条目本身不再互链缺陷）
  const relDefects = doc._cat !== 'defects'
    ? docs.filter(d => d._cat === 'defects' && d.id !== doc.id && sharesTag(doc, d, 'mat'))
    : [];
  // 相关标准（共享 std: 标签；排除带 mat 的牌号卡，避免材料混进"标准"段）
  const relStd = docs.filter(d => d.id !== doc.id && sharesTag(doc, d, 'std') && !(TAGS[d.id] || []).some(t => t.startsWith('mat:')));
  // 相关知识（跨主题同材质优先 + 同主题；缺陷类只看同主题）
  const crossMat = doc._cat !== 'defects'
    ? docs.filter(d => d.id !== doc.id && d._cat !== 'defects' && sharesTag(doc, d, 'mat'))
    : [];
  const sameTheme = docs.filter(d => d.id !== doc.id && themeOfId(d.id)?.id === (theme?.id));
  const related = [];
  const seen = new Set([doc.id]);
  for (const d of [...crossMat, ...sameTheme]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    related.push(d);
    if (related.length >= 8) break;
  }
  const miniCard = (d) => `<div class="card hover kb-item kb-item-sm ${catClass(d)}" data-id="${d.id}">
    <div class="kb-item-title">${escapeHtml(d.title)}</div>
    <div class="kb-item-right"><span class="kb-arrow">›</span></div>
  </div>`;

  container.innerHTML = `
    <div class="page-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
          <button class="btn btn-ghost" data-back>← 返回</button>
          <h1 class="page-title" style="font-size:1.2rem">${escapeHtml(doc.title)}</h1>
        </div>
        <p class="page-sub">${(doc.keywords || []).map(k => `<span class="chip">${escapeHtml(k)}</span>`).join(' ')}</p>
      </div>
      <span class="chip primary">${themeName}</span>${confText(doc.confidence)}${relText(doc)}
    </div>
    ${quickFactsHTML(doc)}
    <div class="card section-card">
      <div class="section-card-title">📖 内容</div>
      <div class="detail-tree">${renderContent(doc.content, catClass(doc))}</div>
    </div>
    ${relCalcs.length > 0 ? `
    <div class="card section-card" style="margin-top:14px">
      <div class="section-card-title">🧮 相关计算工具</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${relCalcs.map(c => `<button class="btn btn-ghost" data-open-calc="${c.id}" style="padding:4px 12px;font-size:.76rem">${c.icon} ${c.name} →</button>`).join('')}
      </div>
    </div>` : ''}
    ${relDefects.length > 0 ? `
    <div class="card section-card" style="margin-top:14px">
      <div class="section-card-title">🩹 常见缺陷 · 同材质</div>
      <div class="kb-list" style="margin-top:8px">${relDefects.map(miniCard).join('')}</div>
    </div>` : ''}
    ${relStd.length > 0 ? `
    <div class="card section-card" style="margin-top:14px">
      <div class="section-card-title">📜 相关标准</div>
      <div class="kb-list" style="margin-top:8px">${relStd.map(miniCard).join('')}</div>
    </div>` : ''}
    ${related.length > 0 ? `
    <div class="card section-card" style="margin-top:14px">
      <div class="section-card-title">🔗 相关知识</div>
      <div class="kb-list" style="margin-top:8px">${related.map(miniCard).join('')}</div>
    </div>` : ''}
    <div class="card section-card" style="margin-top:14px">
      <div class="section-card-title">📌 出处</div>
      <div class="field-hint">《${escapeHtml(doc.reference?.book || '—')}》${doc.reference?.chapter ? ` · ${escapeHtml(doc.reference.chapter)}` : ''}</div>
    </div>
  `;
  container.querySelector('[data-back]').addEventListener('click', () => {
    // 从缺陷查找/其他计算工具跳来的详情（hash 导航）→ 回到来源处，而非首页
    const ret = (() => { try { return sessionStorage.getItem('ct-detail-return'); } catch (e) { return null; } })();
    if (ret) {
      try { sessionStorage.removeItem('ct-detail-return'); } catch (e) {}
      location.hash = ret;
      return;
    }
    if (searchQuery) renderSearch(container);
    else { searchQuery = null; location.hash = '#/home'; }   // 从首页推荐进来 → 回首页
  });
  const docsById = new Map(docs.map(d => [d.id, d]));
  container.querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => {
      const doc = docsById.get(el.dataset.id);
      if (doc) renderDetail(container, doc, docs);
    }));
  container.querySelectorAll('[data-open-calc]').forEach(el =>
    el.addEventListener('click', () => { location.hash = '#/calculators/' + el.dataset.openCalc; }));
}

/* ================= 关键数字速览（全类目） ================= */
function quickFactsItems(doc) {
  const c = doc.content;
  if (!c) return [];
  if (doc._cat === 'materials') {
    return [
      ['浇注温度', c.pouring?.pour_temperature],
      ['密度', c.physical?.density],
      ['线收缩率', c.physical?.linear_shrinkage],
      ['抗拉强度', c.mechanical?.tensile_strength],
      ['出品率', c.pouring?.yield_range],
    ].filter(([, v]) => v);
  }
  if (doc._cat === 'defects' && Array.isArray(c.symptoms)) {
    return c.symptoms.slice(0, 2).map(s => ['典型现象', s]);
  }
  if (doc._cat === 'rules' && c.rule) {
    return [['规则', c.rule]];
  }
  // 其它类目：取前 4 组的第一项作为速览
  return contentChips(c, 4);
}

function contentChips(content, max = 4) {
  const chips = [];
  for (const [gk, gv] of Object.entries(content || {})) {
    if (chips.length >= max) break;
    if (typeof gv === 'string') chips.push([gk, gv]);
    else if (Array.isArray(gv) && gv.length) chips.push([gk, String(gv[0])]);
    else if (gv && typeof gv === 'object') {
      const k = Object.keys(gv)[0];
      if (k) chips.push([gk + '·' + k, gv[k]]);
    }
  }
  return chips;
}

function quickFactsHTML(doc) {
  const items = quickFactsItems(doc);
  if (!items.length) return '';
  return `<div class="kb-quick">${items.map(([k, v]) =>
    `<div class="kb-q"><div class="kb-qk">${escapeHtml(k)}</div><div class="kb-qv">${escapeHtml(String(v))}</div></div>`).join('')}</div>`;
}

/* ================= 条目卡片 ================= */
export function cardHtml(doc, opts = {}) {
  const theme = themeOfId(doc.id);
  const meta = `${theme ? theme.icon + ' ' + theme.name : doc._cat}${opts.linked ? ' · 🔗 双显' : ''} · 《${doc.reference?.book || ''}》`;
  return `<div class="card hover kb-item ${catClass(doc)}" data-id="${doc.id}">
    <div class="kb-item-main">
      <div class="kb-item-title">${escapeHtml(doc.title)}${opts.snippet ? `<span class="field-hint" style="display:block;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(opts.snippet)}</span>` : ''}</div>
      <div class="kb-item-summary">${escapeHtml(cardSummary(doc))}</div>
      <div class="kb-item-meta">${escapeHtml(meta)}${confText(doc.confidence)}</div>
    </div>
    <div class="kb-item-right"><span class="kb-arrow">›</span></div>
  </div>`;
}

function cardSummary(doc) {
  const c = doc.content;
  if (!c) return '';
  if (doc._cat === 'materials') {
    const items = quickFactsItems(doc).slice(0, 3);
    if (items.length) return items.map(([k, v]) => `${k} ${String(v).slice(0, 30)}`).join(' · ');
    return '';
  }
  if (doc._cat === 'defects' && Array.isArray(c.symptoms)) {
    return '典型现象：' + String(c.symptoms[0]).slice(0, 36);
  }
  const chips = contentChips(c, 2);
  if (!chips.length) return '';
  return chips.map(([k, v]) => `${k}：${String(v).slice(0, 28)}`).join(' · ');
}

/* ================= 内容渲染 ================= */
// 可靠等级徽章（txt 规格 A/B/C/D）：A 权威 · B 多源一致 · C 工程经验 · D 待验证
const REL_TEXT = { A: '权威资料', B: '多源一致', C: '工程经验', D: '待验证' };
const REL_CLS = { A: 'conf-high', B: 'conf-midhi', C: 'conf-mid', D: 'conf-mid' };
function relText(doc) {
  const r = doc.reliability;
  if (!r) return '';
  const label = REL_TEXT[r] || r;
  return `<span class="kb-conf ${REL_CLS[r] || 'conf-mid'}">可靠等级 ${r} · ${label}</span>`;
}

// 优先级原因等级徽章（A 最优先检查）
const CAUSE_LEVEL_CLS = { A: 'rel-A', B: 'rel-B', C: 'rel-C', D: 'rel-D' };
function causeLevelHtml(level) {
  const cls = CAUSE_LEVEL_CLS[level] || 'rel-C';
  const label = level === 'A' ? 'A · 最先查' : level === 'B' ? 'B · 其次查' : level === 'C' ? 'C · 再查' : level;
  return `<span class="cause-level ${cls}">${label}</span>`;
}

// catClass = 文档分类色类（材料蓝/缺陷玫红/标准绿/知识紫/规则琥珀），给每组标题加色圆点
function renderContent(content, catClass) {
  if (!content || typeof content !== 'object') return `<div class="field-hint">—</div>`;
  let html = '';
  for (const [group, val] of Object.entries(content)) {
    const dot = catClass ? `<span class="kb-group-dot ${catClass}"></span>` : '';
    html += `<div class="kb-group"><div class="kb-group-title">${dot}${escapeHtml(L(group))}</div>`;
    if (group === 'priority_causes' && val && typeof val === 'object' && !Array.isArray(val)) {
      // 诊断式：可能原因按优先级列出（每条带 A/B/C/D 等级徽章）
      html += `<ul class="kb-list-ul">${Object.entries(val).map(([cause, lv]) =>
        `<li class="cause-li">${causeLevelHtml(lv)}<span>${escapeHtml(cause)}</span></li>`).join('')}</ul>`;
    } else if (group === 'rule' && typeof val === 'string') {
      // 规则卡 headline 强调
      html += `<div class="rule-headline">${escapeHtml(val)}</div>`;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      // 参数小卡网格：每个字段一张小卡（标签在上、数值加粗），与首页速查卡同语言
      html += `<div class="kb-statgrid">${Object.entries(val).map(([k, v]) =>
        `<div class="kb-stat"><span class="kb-stat-k">${escapeHtml(L(k))}</span><span class="kb-stat-v">${escapeHtml(String(v))}</span></div>`).join('')}</div>`;
    } else if (Array.isArray(val)) {
      html += `<ul class="kb-list-ul">${val.map(v => `<li>${escapeHtml(String(v))}</li>`).join('')}</ul>`;
    } else {
      html += `<div class="kb-stat"><span class="kb-stat-k">${escapeHtml(L(group))}</span><span class="kb-stat-v">${escapeHtml(String(val))}</span></div>`;
    }
    html += `</div>`;
  }
  return html;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
