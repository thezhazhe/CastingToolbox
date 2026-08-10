// ============================================================
// 全面测试 · 静态交叉引用检查（不依赖浏览器）
// 覆盖 validate_data 之外的引用完整性：
//   1. 全部 doc id 唯一（跨文件不重）
//   2. data 里 related_calcs 都指向已注册计算工具
//   3. registry 每个 calc 的 next（calc 类）target 有效
//   4. next.kind 合法（calc/wizard/search）
//   5. calc 列表 id 唯一、status 合法
//   6. 每条数据的关键字在索引文件可被检索命中（防"死数据"）
// 用法: node scripts/qa_static.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_INDEX } from '../data/index.js';
import { CALCULATORS } from '../calcs/registry.js';
import { searchKnowledge } from '../js/search.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let errors = 0, warnings = 0;
const log = (type, msg) => console.error(`  ${type} ${msg}`);

// ---- 1. 读全部文档，查重复 id ----
const docs = [];
for (const [cat, files] of Object.entries(DATA_INDEX)) {
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', cat, f), 'utf8'));
      docs.push({ ...j, _cat: cat, _file: f });
    } catch (e) { errors++; log('ERROR', `JSON 读取失败 ${cat}/${f}: ${e.message}`); }
  }
}
const seen = new Map();
for (const d of docs) {
  if (seen.has(d.id)) { errors++; log('ERROR', `doc id 重复：${d.id}（${seen.get(d.id)} 与 ${d._cat}/${d._file}）`); }
  seen.set(d.id, `${d._cat}/${d._file}`);
}
console.log(`[docs] ${docs.length} 条 · id 唯一性检查完成`);

// ---- 2. related_calcs 指向已注册计算工具 ----
const calcById = new Map(CALCULATORS.map(c => [c.id, c]));
for (const d of docs) {
  for (const id of (d.related_calcs || [])) {
    if (!calcById.has(id)) { errors++; log('ERROR', `${d.id} 的 related_calcs 指向未注册计算工具：${id}`); }
  }
}
console.log('[related_calcs] 引用完整性检查完成');

// ---- 3/4. registry next 检查 ----
const calcIds = new Set();
for (const c of CALCULATORS) {
  if (calcIds.has(c.id)) { errors++; log('ERROR', `计算工具 id 重复：${c.id}`); }
  calcIds.add(c.id);
  if (!['ready', 'pending'].includes(c.status)) { errors++; log('ERROR', `${c.id} status 非法：${c.status}`); }
  for (const n of (c.next || [])) {
    if (!['calc', 'wizard', 'search'].includes(n.kind)) { errors++; log('ERROR', `${c.id}.next kind 非法：${n.kind}`); }
    if (n.kind === 'calc' && !calcById.has(n.target)) { errors++; log('ERROR', `${c.id}.next 指向未注册计算工具：${n.target}`); }
    if (!n.label) { warnings++; log('WARN', `${c.id}.next 缺 label`); }
  }
}
console.log(`[registry] ${CALCULATORS.length} 个计算工具 · next 引用检查完成`);

// ---- 5. 关键字可检索性：每条数据用自己的第一个关键字搜索，至少应命中自己 ----
const docsById = new Map(docs.map(d => [d.id, d]));
for (const d of docs) {
  const kw = d.keywords && d.keywords[0];
  if (!kw || String(kw).length < 2) { continue; }
  const hits = searchKnowledge(kw, docs);
  if (!hits.some(h => h.doc.id === d.id)) {
    warnings++; log('WARN', `${d.id} 用关键字 "${kw}" 搜索未命中自己（数据可能无法被检索到）`);
  }
}
console.log('[检索] 关键字自检完成');

console.log('');
if (errors === 0) {
  console.log(`静态检查 OK: ${docs.length} 条数据 · ${CALCULATORS.length} 工具${warnings ? ` · ${warnings} 条警告` : ''}`);
} else {
  console.log(`静态检查 FAILED: ${errors} 个错误${warnings ? ` · ${warnings} 条警告` : ''}`);
}
process.exit(errors === 0 ? 0 : 1);
