// ============================================================
// PHASE 72 · i18n 覆盖率审计（开发/CI 用）
// 扫描源码里所有 t('…') / tr('…') 的字面量 key：
//   · 含中文的 key → 必须在 en-US 词条表里有对应英文（否则英文界面回退成中文）
//   · 语义 key（含 '.' 的 ASCII key）→ 必须在 zh-CN 表里有基准值
// 用法: node scripts/i18n_audit.mjs
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ZH from '../js/i18n/zh-CN.js';
import EN from '../js/i18n/en-US.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[一-鿿]/;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'vendor' && f !== 'node_modules') walk(p, out); }
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'js')).concat(walk(join(ROOT, 'calcs')), walk(join(ROOT, 'data')));
const keys = new Map();   // key → 首个出现位置

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // 只统计真正从 i18n 层导入的调用别名（各视图里可能有同名局部 helper，例如报告表格的 t(label,val)）
  const imp = src.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*i18n\/index\.js['"]/);
  if (!imp) continue;
  const alias = imp[1].split(',').map(s => s.trim())
    .map(s => (s.includes(' as ') ? s.split(/\s+as\s+/)[1].trim() : s.trim()))
    .find(n => n === 't' || n === 'tr' || n === 'tt');
  if (!alias) continue;
  const re = new RegExp(`(?<![.\\w$])${alias}\\(\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const key = m[1].replace(/\\'/g, "'");
    if (!keys.has(key)) keys.set(key, relative(ROOT, f));
  }
}

const missingEn = [];
const missingZh = [];
for (const [key, file] of keys) {
  if (CJK.test(key)) {
    if (EN[key] === undefined) missingEn.push([key, file]);
  } else if (/^[a-z][\w.]*$/i.test(key) && key.includes('.')) {
    if (ZH[key] === undefined) missingZh.push([key, file]);
    else if (EN[key] === undefined) missingEn.push([key, file]);   // 语义 key 缺英文 → 英文界面会回退成中文
  }
}

console.log(`扫描 ${files.length} 个文件，发现 ${keys.size} 个字面量 key`);
if (missingZh.length) {
  console.log(`\n❌ 语义 key 缺中文基准（${missingZh.length}）：`);
  for (const [k, f] of missingZh) console.log(`   ${k}   ← ${f}`);
}
if (missingEn.length) {
  console.log(`\n❌ 中文 key 缺英文翻译（${missingEn.length}）：`);
  for (const [k, f] of missingEn) console.log(`   ${k}   ← ${f}`);
}
if (!missingEn.length && !missingZh.length) console.log('\n✅ 全部 key 均有对应词条');
process.exit(missingEn.length || missingZh.length ? 1 : 0);
