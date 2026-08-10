// ============================================================
// 生产场景推荐逻辑层（纯函数 · 视图只调用不写死）
// 数据源：data/scenarios.js（建议映射）+ data/tags.js（工况匹配）+ 注册表
// 以后加信息：只改 data/scenarios.js / data/tags.js，本模块不动。
// ============================================================
import { SCENARIOS, LINES, PRODS, METHODS } from '../data/scenarios.js';
import { CALCULATORS } from '../calcs/registry.js';
import { TAGS } from '../data/tags.js';
import * as context from './context.js';
import { loadKnowledge } from './search.js';

/** 材质族 → 代表牌号文档 id（向导预选用） */
export function prefillDocId(family) {
  return SCENARIOS[family]?.defDoc || '';
}

/** 从代表牌号文档抽"参数速查"行（浇温/密度/线缩/出品率/补缩效率/凝固特性） */
export function paramsOf(doc) {
  const c = doc?.content || {};
  return [
    ['浇注温度', c.pouring?.pour_temperature],
    ['密度', c.physical?.density],
    ['线收缩率', c.physical?.linear_shrinkage],
    ['出品率', c.pouring?.yield_range],
    ['补缩效率', c.casting_behavior?.riser_efficiency],
    ['凝固特性', c.casting_behavior?.solidification],
  ].filter(([, v]) => v && String(v).trim() !== '');
}

/** 场景 → 推荐集（确定性，本地计算）。无场景返回空骨架。 */
export async function buildRecommendation() {
  const ctx = context.get();
  const docs = await loadKnowledge();
  const byId = new Map(docs.map(d => [d.id, d]));
  const fam = context.familyOf(ctx.material);   // 大类；无则为 ''
  const s = SCENARIOS[fam];

  const out = {
    family: fam,
    defDoc: s ? byId.get(s.defDoc) || null : null,
    reason: s?.reason || '',
    tips: [],
    defects: [],
    standards: s?.standards || [],
    calcs: [],
    know: [],
    counts: { calcs: 0, defects: 0, standards: 0, know: 0 },
  };
  // 完全没有场景 → 空骨架（调用方自行处理"无场景"展示）
  if (!s && !ctx.line && !ctx.prod && !ctx.method) return out;

  // 维度增强：tips / defects 叠加去重
  const lineInfo = LINES[ctx.line] || {};
  const prodInfo = PRODS[ctx.prod] || {};
  const methodInfo = METHODS[ctx.method] || {};
  out.tips = [...(s?.tips || []), ...(lineInfo.tips || []), ...(prodInfo.tips || []), ...(methodInfo.tips || [])];

  const defIds = new Set([
    ...(s?.defects || []),
    ...(lineInfo.defects || []),
    ...(prodInfo.defects || []),
    ...(methodInfo.defects || []),
  ]);
  out.defects = [...defIds].map(id => byId.get(id)).filter(Boolean);

  // 对口计算工具：代表牌号 + 命中场景的文档（related_calcs + calc: 标签）去重
  const calcIds = new Set();
  const pushCalcs = (d) => {
    (d?.related_calcs || []).forEach(id => calcIds.add(id));
    (TAGS[d?.id] || []).filter(t => t.startsWith('calc:')).forEach(t => calcIds.add(t.slice(5)));
  };
  pushCalcs(out.defDoc);
  docs.filter(d => context.matchesContext(d.id, TAGS[d.id])).forEach(pushCalcs);
  out.calcs = [...calcIds].map(id => CALCULATORS.find(c => c.id === id && c.status === 'ready'))
    .filter(Boolean).slice(0, 6);

  // 相关知识：命中场景的非缺陷文档，去掉已列缺陷与代表牌号，去重截 6
  const defSet = new Set(out.defects.map(d => d.id));
  const seen = new Set([out.defDoc?.id]);
  out.know = docs.filter(d =>
    d._cat !== 'defects' && !defSet.has(d.id)
    && context.matchesContext(d.id, TAGS[d.id])
    && !seen.has(d.id) && (seen.add(d.id), true)
  ).slice(0, 6);

  out.counts = {
    calcs: out.calcs.length,
    defects: out.defects.length,
    standards: out.standards.length,
    know: out.know.length,
  };
  return out;
}
