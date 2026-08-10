// ============================================================
// 知识库 JSON 自动校验
// 检查：JSON 语法 / 必填字段 / 分类合法 / 领域规则（数值范围）
// 规则可扩展：FIELD_RULES 增删字段即生效
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_INDEX } from '../data/index.js';
import { TAXONOMY, taxonomyPrimaryIds, taxonomyLinkIds } from '../data/taxonomy.js';
import { TAGS, TAG_PREFIXES } from '../data/tags.js';
import { SCENARIOS, LINES, PRODS, METHODS } from '../data/scenarios.js';
import { DEFECT_ALIASES, CATEGORY_OF, DEFECT_CATEGORIES } from '../data/defects.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CATS = ['materials', 'rawmaterials', 'defects', 'process', 'equipment', 'rules', 'disa'];
const VALID_CATEGORIES = ['material', 'rawmaterial', 'defect', 'process', 'equipment', 'rule', 'disa'];

// ---- 领域规则：字段 → 允许数值范围（抽取字符串中的每个数字校验） ----
const FIELD_RULES = {
  pour_temperature:   { min: 600,  max: 1800, label: '浇注温度℃' },
  density:            { min: 2.5,  max: 9.0,  label: '密度kg/dm³（铝2.6~2.8/铁6.9~7.4/铜7.5~8.9）' },
  carbon:             { min: 0.1,  max: 4.8,  label: '碳%（铸钢0.2~0.45，铸铁3.2~3.8）' },
  silicon:            { min: 0.3,  max: 14,   label: '硅%（铸铁2~3，铝硅合金6~13）' },
  manganese:          { min: 0,    max: 1.5,  label: '锰%' },
  phosphorus:         { min: 0,    max: 0.5,  label: '磷%' },
  sulfur:             { min: 0,    max: 0.2,  label: '硫%' },
  carbon_equivalent:  { min: 3.5,  max: 4.8,  label: '碳当量CE' },
  linear_shrinkage:   { min: 0.3,  max: 2.5,  label: '线收缩率%' },
  volumetric_shrinkage: { min: 1,  max: 8,    label: '体收缩率%' },
  riser_efficiency:   { min: 10,   max: 60,   label: '补缩效率%' },
  elongation:         { min: 0,    max: 30,   label: '延伸率%' },
};

// 任何温度类数值若 >3000 视为异常（如 13800℃）
function extractNumbers(str) {
  if (typeof str === 'number') return [str];
  if (typeof str !== 'string') return [];
  return (str.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

let errors = 0, warnings = 0, total = 0;
const log = (type, msg) => console.error(`  ${type} ${msg}`);

function validateEntry(j, file, cat) {
  const where = `(${cat}/${file})`;
  // ---- 必填字段 ----
  const required = ['id', 'title', 'category', 'keywords', 'content', 'reference', 'confidence'];
  for (const f of required) {
    if (j[f] === undefined || j[f] === null || j[f] === '') {
      errors++; log('ERROR', `缺少必填字段 [${f}] ${where}`); return;
    }
  }
  if (!VALID_CATEGORIES.includes(j.category)) {
    errors++; log('ERROR', `category 非法 "${j.category}"（应为 ${VALID_CATEGORIES.join('/')}）${where}`);
  }
  if (!j.reference.book) {
    errors++; log('ERROR', `reference.book 缺失 ${where}`);
  }
  if (!['high', 'medium-high', 'medium'].includes(j.confidence)) {
    errors++; log('ERROR', `confidence 非法 "${j.confidence}"（应为 high/medium-high/medium）${where}`);
  }
  if (j.reference && 'page' in j.reference) {
    errors++; log('ERROR', `reference.page 已废弃（不再维护页码），请移除 ${where}`);
  }

  // ---- 领域规则 ----
  const content = j.content || {};
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const rule = FIELD_RULES[k];
      if (rule) {
        const nums = extractNumbers(v);
        for (const n of nums) {
          if (n < rule.min || n > rule.max) {
            errors++;
            log('ERROR', `字段 ${prefix}${k} 值 ${n} 超出 ${rule.label} 允许范围 [${rule.min}~${rule.max}] ${where}`);
          }
        }
      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        walk(v, prefix + k + '.');
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'object' && item !== null) walk(item, prefix + k + `[${i}].`);
          else if (rule === undefined) {
            const nums = extractNumbers(item);
            for (const n of nums) if (n > 30000) { warnings++; log('WARN', `数值 ${n} 偏大，请人工复核 ${prefix}${k}[${i}] ${where}`); }
          }
        });
      } else {
        const nums = extractNumbers(v);
        // 温度字段守卫：任何数值若 >3000℃ 视为异常（如 13800℃）
        if (typeof v === 'string' && v.includes('℃')) {
          for (const n of nums) if (n > 3000) { errors++; log('ERROR', `温度值 ${n}℃ 异常（>3000℃）${prefix}${k} ${where}`); }
        }
        for (const n of nums) if (n > 30000) { warnings++; log('WARN', `数值 ${n} 偏大，请人工复核 ${prefix}${k} ${where}`); }
      }
    }
  };
  walk(content, 'content.');
}

for (const cat of CATS) {
  const dir = path.join(ROOT, 'data', cat);
  if (!fs.existsSync(dir)) { console.log(`[${cat}] (none)`); continue; }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  console.log(`[${cat}] ${files.length} file(s)`);
  for (const f of files) {
    total++;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      validateEntry(j, f, cat);
    } catch (e) {
      errors++;
      log('ERROR', `JSON 解析失败 ${f}: ${e.message}`);
    }
  }
}

// ============================================================
// 分类树校验：不丢 / 不重 / links 指向合法主位置
// ============================================================
const indexIds = Object.values(DATA_INDEX).flat().map(f => f.replace(/\.json$/, ''));
const primaryIds = taxonomyPrimaryIds();
const linkIds = taxonomyLinkIds();

// 1. 树中每个 id 都已登记在 index.js（存在且只属于一类）
const primarySet = new Set();
for (const id of primaryIds) {
  if (primarySet.has(id)) { errors++; log('ERROR', `分类树中主位置条目重复：${id}`); }
  primarySet.add(id);
  if (!indexIds.includes(id)) { errors++; log('ERROR', `分类树主位置条目未在 data/index.js 登记：${id}`); }
}
// 2. index.js 每个 id 都出现在树中恰好一次（不丢）
const missing = indexIds.filter(id => !primarySet.has(id));
for (const id of missing) { errors++; log('ERROR', `data/index.js 中条目未挂到分类树：${id}`); }
// 3. links 指向的 id 必须存在且有主位置
for (const id of linkIds) {
  if (!indexIds.includes(id)) { errors++; log('ERROR', `分类树 links 指向未登记的条目：${id}`); }
  else if (!primarySet.has(id)) { errors++; log('ERROR', `分类树 links 指向无主位置的条目：${id}`); }
}
console.log(`[taxonomy] ${primaryIds.length} 条主位置 · ${linkIds.length} 条双显链接`);

// ============================================================
// 标签映射表校验：id 存在 / 前缀合法 / 值非空
// ============================================================
let tagCount = 0;
for (const [id, tags] of Object.entries(TAGS)) {
  if (!Array.isArray(tags) || tags.length === 0) { errors++; log('ERROR', `标签条目为空：${id}`); continue; }
  if (!indexIds.includes(id)) { errors++; log('ERROR', `标签条目 id 未在 data/index.js 登记：${id}`); }
  for (const tag of tags) {
    tagCount++;
    const colon = tag.indexOf(':');
    if (colon <= 0) { errors++; log('ERROR', `标签格式非法（缺少前缀 :）"${tag}"（id=${id}）`); continue; }
    const prefix = tag.slice(0, colon);
    if (!TAG_PREFIXES.includes(prefix)) { errors++; log('ERROR', `标签前缀非法 "${prefix}"（应属于 ${TAG_PREFIXES.join('/')}）id=${id}`); }
    if (tag.slice(colon + 1).trim() === '') { errors++; log('ERROR', `标签值为空："${tag}"（id=${id}）`); }
  }
}
console.log(`[tags] ${Object.keys(TAGS).length} 条已打标签 · ${tagCount} 个标签`);

// ============================================================
// 生产场景建议数据校验：材质族齐全 / 引用文档存在
// ============================================================
const FAMILY_KEYS = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];
for (const fam of FAMILY_KEYS) {
  if (!SCENARIOS[fam]) { errors++; log('ERROR', `材质族 ${fam} 缺场景建议数据（data/scenarios.js）`); }
}
for (const [fam, s] of Object.entries(SCENARIOS)) {
  if (!FAMILY_KEYS.includes(fam)) { errors++; log('ERROR', `场景数据含非法材质族：${fam}`); }
  if (s.defDoc && !indexIds.includes(s.defDoc)) { errors++; log('ERROR', `场景[${fam}] defDoc 未在 data/index.js 登记：${s.defDoc}`); }
  for (const id of (s.defects || [])) {
    if (!indexIds.includes(id)) { errors++; log('ERROR', `场景[${fam}] 缺陷引用未登记：${id}`); }
  }
}
for (const [key, info] of [...Object.entries(LINES), ...Object.entries(PRODS), ...Object.entries(METHODS)]) {
  for (const id of (info.defects || [])) {
    if (!indexIds.includes(id)) { errors++; log('ERROR', `场景维度[${key}] 缺陷引用未登记：${id}`); }
  }
}
console.log(`[scenarios] ${Object.keys(SCENARIOS).length} 材质族 · 维度 ${Object.keys(LINES).length}/${Object.keys(PRODS).length}/${Object.keys(METHODS).length}`);

// ============================================================
// 缺陷查找数据校验：每个缺陷文档有分类+有别名；映射表 id 均登记
// ============================================================
for (const [id, cat] of Object.entries(CATEGORY_OF)) {
  if (!indexIds.includes(id)) { errors++; log('ERROR', `缺陷分类映射 id 未在 data/index.js 登记：${id}`); }
  if (!DEFECT_CATEGORIES.some(c => c.id === cat)) { errors++; log('ERROR', `缺陷分类非法 "${cat}"（id=${id}）`); }
}
for (const [id, aliases] of Object.entries(DEFECT_ALIASES)) {
  if (!indexIds.includes(id)) { errors++; log('ERROR', `缺陷别名表 id 未在 data/index.js 登记：${id}`); }
  if (!Array.isArray(aliases) || aliases.length === 0) { errors++; log('ERROR', `缺陷别名表为空：${id}`); }
}
const defectDir = path.join(ROOT, 'data', 'defects');
const defectIds = fs.existsSync(defectDir) ? fs.readdirSync(defectDir).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(defectDir, f), 'utf8')).id; } catch { return null; } }).filter(Boolean) : [];
for (const id of defectIds) {
  if (!CATEGORY_OF[id]) { errors++; log('ERROR', `缺陷 ${id} 缺少分类（data/defects.js CATEGORY_OF）`); }
  if (!DEFECT_ALIASES[id]) { errors++; log('ERROR', `缺陷 ${id} 缺少检索别名（data/defects.js DEFECT_ALIASES）`); }
}
console.log(`[defects] ${defectIds.length} 条缺陷 · ${Object.keys(DEFECT_ALIASES).length} 个别名组 · ${DEFECT_CATEGORIES.length} 个大类`);

console.log('');
if (errors === 0) {
  console.log(`OK: ${total} 条知识全部通过${warnings ? `（${warnings} 条警告待复核）` : ''}。`);
} else {
  console.log(`FAILED: ${errors} 个错误${warnings ? `，${warnings} 条警告` : ''}。`);
}
process.exit(errors === 0 ? 0 : 1);
