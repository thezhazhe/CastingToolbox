// ============================================================
// 搜索视图：#/search 分类结果页 · #/search/<docId> 工艺卡片
// 渲染逻辑复用 knowledge.js（renderSearchPage / showDetail），
// 此处只做路由分发，避免重复代码与循环依赖。
// ============================================================
import * as kb from './knowledge.js';

export function setQuery(q) { kb.setQuery(q); }

export async function render(container, params = {}) {
  if (params.id) return kb.showDetail(container, params.id);   // #/search/<docId> → 工艺卡片
  return kb.renderSearchPage(container);                        // #/search → 分类结果页
}
