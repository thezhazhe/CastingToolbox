// ============================================================
// 缺陷查找 · 逻辑层（只读，不写数据）
// 依赖：data/defects.js（分类+别名）· data/defects/*.json（对策正文）
//       data/tags.js（mat: 材质过滤）
// 入口：searchDefects(query, { mat, cat }) → { hits:[{doc,score,how}], total }
// ============================================================
import { loadKnowledge } from './search.js';
import { DEFECT_ALIASES, categoryOf } from '../data/defects.js';
import { TAGS } from '../data/tags.js';

/** 全部缺陷文档（知识库缓存，一次性加载） */
export async function defectDocs() {
  return (await loadKnowledge()).filter(d => d._cat === 'defects');
}

/** 各分类下的缺陷数量（顶部分类 chips 显示用） */
export function categoryCounts(docs) {
  const counts = { all: docs.length };
  for (const d of docs) {
    const c = categoryOf(d.id) || '其他';
    counts[c] = (counts[c] || 0) + 1;
  }
  return counts;
}

/**
 * 检索缺陷：
 *   query — 缺陷名 / 俗称 / 症状关键词，支持空格/逗号分词（任一词命中即算）
 *   mat   — 材质族（灰铁/球铁/铸钢/铝合金/铜合金），按 TAGS mat: 过滤
 *   cat   — 大类 id（DEFECT_CATEGORIES），按 CATEGORY_OF 过滤
 * 命中权重：别名(100) > 标题(60) > 关键词(40) > 正文全文(20)
 */
export async function searchDefects(query, { mat = '', cat = '' } = {}) {
  const docs = await defectDocs();
  let list = docs;
  if (mat) list = list.filter(d => (TAGS[d.id] || []).includes('mat:' + mat));
  if (cat) list = list.filter(d => categoryOf(d.id) === cat);

  const q = String(query || '').trim().toLowerCase();
  if (!q) return { hits: list.map(d => ({ doc: d, score: 0, how: '' })), total: docs.length };

  const tokens = q.split(/[\s,，、/]+/).filter(Boolean);
  const hits = [];
  for (const d of list) {
    const aliases = DEFECT_ALIASES[d.id] || [];
    const title = d.title.toLowerCase();
    const keywords = (d.keywords || []).map(k => k.toLowerCase());
    const content = JSON.stringify(d.content).toLowerCase();
    let score = 0, how = '';
    if (aliases.some(a => tokens.some(t => a.includes(t)))) { score = 100; how = '按名称/俗称'; }
    else if (tokens.some(t => title.includes(t))) { score = 60; how = '按名称'; }
    else if (keywords.some(k => tokens.some(t => k.includes(t) || t.includes(k)))) { score = 40; how = '按关键词'; }
    else if (tokens.every(t => content.includes(t))) { score = 20; how = '按内容'; }
    if (score) hits.push({ doc: d, score, how });
  }
  hits.sort((a, b) => b.score - a.score);
  return { hits, total: docs.length };
}
