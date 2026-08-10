// ============================================================
// 本地全文搜索（离线 · 数据量小，评分式线性扫描足够快）
// 索引字段：标题(权重10) > 关键词(8) > 全文(2)
// 同时检索计算器注册表（名称/描述/关键词）
// ============================================================
import { DATA_INDEX } from '../data/index.js';
import { CALCULATORS } from '../calcs/registry.js';

let docsCache = null;

/** 加载知识库全部 JSON（按 data/index.js 清单） */
export async function loadKnowledge() {
  if (docsCache) return docsCache;
  const docs = [];
  for (const cat of Object.keys(DATA_INDEX)) {
    for (const file of DATA_INDEX[cat]) {
      try {
        const res = await fetch(`data/${cat}/${file}`);
        if (!res.ok) continue;
        const j = await res.json();
        docs.push({ ...j, _cat: cat, _file: file });
      } catch (e) { /* 单条失败不影响整体 */ }
    }
  }
  docsCache = docs;
  return docs;
}

/** 全部可用计算器（ready） */
export function getReadyCalcs() {
  return CALCULATORS.filter(c => c.status === 'ready');
}

function flatText(doc) {
  return JSON.stringify(doc.content).toLowerCase();
}

/** 搜索知识库，返回 [{doc, score, cat, snippet}] */
export function searchKnowledge(query, docs) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const d of docs) {
    const title = (d.title || '').toLowerCase();
    const kw = (d.keywords || []).map(k => k.toLowerCase());
    const content = flatText(d);
    let score = 0;
    if (title.includes(q) || q.includes(title)) score += 10;
    else if (kw.some(k => k.includes(q) || q.includes(k))) score += 8;
    if (content.includes(q)) score += 2;
    if (score <= 0) continue;
    out.push({ doc: d, score, cat: d._cat, snippet: snippetOf(content, q) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 25);
}

/** 搜索计算器 */
export function searchCalcs(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getReadyCalcs().filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.desc.toLowerCase().includes(q) ||
    (c.keywords || []).some(k => k.toLowerCase().includes(q) || q.includes(k.toLowerCase())));
}

function snippetOf(text, q) {
  const idx = text.indexOf(q);
  if (idx < 0) return '';
  const start = Math.max(0, idx - 22);
  return '…' + text.slice(start, idx + q.length + 28).replace(/[":,{}[\]]/g, ' ') + '…';
}
