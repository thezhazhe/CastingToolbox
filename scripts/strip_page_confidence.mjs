// ============================================================
// 1) 移除所有知识 JSON 的 reference.page（页码不再维护，国标会更新）
// 2) 按来源映射给每条加 confidence：high / medium-high / medium
//    新数据若与旧数据冲突，以置信度高的为准
// 用法: node scripts/strip_page_confidence.mjs
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CATS = ['materials', 'rawmaterials', 'defects', 'process', 'equipment', 'disa'];

// 一手工厂资料 / 官方手册提取值 → 高置信
const HIGH_PROCESS_IDS = new Set([
  'melting_charge', 'sand_recipe', 'green_sand_control', 'vertical_gating_design',
]);

function confidenceFor(cat, id) {
  if (cat === 'rawmaterials' || cat === 'equipment' || cat === 'disa') return 'high';
  if (cat === 'process') {
    if (HIGH_PROCESS_IDS.has(id) || id.startsWith('charge_')) return 'high';
    return 'medium-high';
  }
  if (cat === 'materials') {
    if (id.startsWith('cross_ref')) return 'medium';
    return 'medium-high';
  }
  if (cat === 'defects') return 'medium-high';
  return 'medium-high';
}

let total = 0, changed = 0;
for (const cat of CATS) {
  const dir = path.join(ROOT, 'data', cat);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    total++;
    const file = path.join(dir, f);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    let c = 0;
    if (j.reference && 'page' in j.reference) { delete j.reference.page; c++; }
    const conf = confidenceFor(cat, j.id || f.replace(/\.json$/, ''));
    if (j.confidence !== conf) { j.confidence = conf; c++; }
    if (c) { fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n', 'utf8'); changed++; }
  }
}
console.log(`处理 ${total} 条，更新 ${changed} 条（移除页码 / 标记置信度）。`);
