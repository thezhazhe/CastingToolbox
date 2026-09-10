// ============================================================
// Validation 全量运行器：顺序跑全部实验 → 聚合 → 生成 report
// 用法: node tests/tools/runAll.mjs [--skip expName]
// ============================================================
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { OUT_DIR, RAW_DIR } from './validationConfig.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const skip = new Set(process.argv.slice(2).filter(a => a.startsWith('--skip')).map(a => a.split(':')[1]));

const EXPERIMENTS = [
  ['exp00_core', '核心三测（22 模型 + 分辨率对照）'],
  ['exp_paramScan', '参数扫描（厚度梯度/位置/尺寸）'],
  ['exp_thinwall_fillet', '薄壁极限 + 圆角噪声'],
  ['exp05b_filletShell', '薄壁壳圆角敏感性'],
  ['exp_pvp_multi', 'PVP 压力 + 多厚区'],
  ['exp_invariance', '不变量（旋转/平移/尺度/确定性）'],
  ['exp_perf', '性能压力（10万~500万面）'],
];

console.log('=== Hotspot V2.1 Self Validation 全量运行 ===\n');
for (const [file, desc] of EXPERIMENTS) {
  if (skip.has(file)) { console.log(`⏭ 跳过 ${file}`); continue; }
  console.log(`▶ ${file} — ${desc}`);
  try {
    execSync(`node "${join(HERE, file + '.mjs')}"`, { stdio: 'inherit', cwd: join(HERE, '..', '..') });
  } catch (e) {
    console.log(`  ✗ ${file} 失败：${e.message.split('\n')[0]}`);
  }
  console.log('');
}

/* ---- 聚合报告 ---- */
const rawFiles = ['exp00_core', 'exp01_gradient', 'exp02_position', 'exp03_size',
  'exp04_thinWall', 'exp05_fillet', 'exp05b_filletShell', 'exp06_pvp', 'exp07_multi',
  'exp08_rotation', 'exp08_translation', 'exp08_scale', 'exp08_determinism', 'exp09_perf'];
const all = [];
for (const f of rawFiles) {
  const p = join(RAW_DIR, f + '.json');
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  all.push(...j.records.map(r => ({ ...r, _exp: f })));
}
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'validation_results.json'), JSON.stringify(all, null, 1));
console.log(`聚合 ${all.length} 条记录 → tests/golden/analytical/validation_results.json`);
console.log('下一步：node tests/tools/report.mjs 生成报告');
