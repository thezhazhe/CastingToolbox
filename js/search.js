// ============================================================
// 本地全文搜索（离线 · 数据量小，评分式线性扫描足够快）
// 索引字段：标题(权重10) > 关键词(8) > 全文(2)
// 同时检索计算器注册表（名称/描述/关键词）
// ============================================================
import { DATA_INDEX } from '../data/index.js';
import { CALCULATORS } from '../calcs/registry.js';

let docsCache = null;
let docsLoading = null;          // 进行中的加载：并发调用共享同一轮，不重复发请求
const FETCH_CONCURRENCY = 16;    // 并发上限：172 个文件既要快（瓶颈是往返次数，不是流量），也不一次打满对端

/** 加载知识库全部 JSON（按 data/index.js 清单）
 *
 *  2026-09-11（挂 GitHub Pages 时发现）：原来是 172 个文件**串行** await。
 *  本地磁盘 0.4s 完全无感，挂到网页后实测 **67s**（每次往返约 390ms × 172）——
 *  首页搜索下拉、缺陷查找、工艺向导首屏全被拖住，等于网页版不可用。
 *  改为并发抓取（上限 8）：同一份数据从 67s 降到个位数秒。
 *
 *  语义刻意保持不变：仍是"单条失败即跳过"，返回顺序仍与 DATA_INDEX 清单一致。 */
export async function loadKnowledge() {
  if (docsCache) return docsCache;
  if (docsLoading) return docsLoading;   // 连续输入触发的重复调用，等同一次加载
  const tasks = [];
  for (const cat of Object.keys(DATA_INDEX)) for (const file of DATA_INDEX[cat]) tasks.push({ cat, file });
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      const { cat, file } = tasks[i];
      try {
        const res = await fetch(`data/${cat}/${file}`);
        results[i] = res.ok ? { ...(await res.json()), _cat: cat, _file: file } : null;
      } catch (e) { results[i] = null; }   // 单条失败不影响整体
    }
  };
  docsLoading = Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, tasks.length) }, worker))
    .then(() => { docsCache = results.filter(Boolean); docsLoading = null; return docsCache; },
          (e) => { docsLoading = null; throw e; });
  return docsLoading;
}

/** 全部可用计算器（ready） */
export function getReadyCalcs() {
  return CALCULATORS.filter(c => c.status === 'ready');
}

function flatText(doc) {
  // PHASE 65.1：索引并入 reference（book/chapter/author/school/method）——可按 "Campbell/1:1:n" 搜到来源与方法元数据
  return JSON.stringify({ c: doc.content, r: doc.reference }).toLowerCase();
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
