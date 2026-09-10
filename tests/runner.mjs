// ============================================================
// 最小测试框架：tests/*_test.mjs 每个文件导出 tests = [{name, fn}]
// node tests/runner.mjs 或 npm test 运行；退出码 0=全过 1=有失败
// 过滤：node tests/runner.mjs phase45a           （文件名包含子串）
//        node tests/runner.mjs "phase28,phase29" （逗号=任一匹配）
// ============================================================
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0, skipped = 0;
const failures = [];

async function runSuite(file) {
  // PHASE 73：不入库的测试夹具（大件 STL / 真实件模型）缺失时**跳过**该文件而不是失败，
  //   并打印再生方法——保证克隆者 `npm test` 不会看到一片红。详见 tests/FIXTURES.md。
  {
    const { missingFixturesFor, REGEN_HINT } = await import('./helpers/fixtures.mjs');
    const src = readFileSync(file, 'utf8');
    const miss = missingFixturesFor(src, __dirname);
    if (miss.length) {
      skipped++;
      console.log(`  ⏭  ${file.split(/[\/]/).pop()} 跳过（缺 ${miss.length} 个夹具：${miss.slice(0, 3).join(', ')}${miss.length > 3 ? ' …' : ''}）`);
      console.log(`     ${REGEN_HINT}`);
      return;
    }
  }
  const mod = await import(pathToFileURL(file).href);
  if (!mod.tests || !Array.isArray(mod.tests)) return;   // 独立运行的文件（如 snapshot/生成脚本）跳过
  for (const t of mod.tests) {
    try {
      await t.fn();
      pass++;
      console.log(`  ✅ ${file.split(/[\\/]/).pop()} :: ${t.name}`);
    } catch (e) {
      fail++;
      failures.push({ file, name: t.name, err: e });
      console.log(`  ❌ ${file.split(/[\\/]/).pop()} :: ${t.name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
    }
  }
}

const filterArg = process.argv[2];
const patterns = filterArg ? filterArg.split(',').map(s => s.trim()).filter(Boolean) : null;
const files = readdirSync(__dirname)
  .filter(f => f.endsWith('_test.mjs'))
  .filter(f => !patterns || patterns.some(p => f.includes(p)))
  .sort();
console.log(`\n══ Casting Toolbox 回归测试 ══ (${files.length} 个测试文件)\n`);
for (const f of files) {
  await runSuite(join(__dirname, f));
}
console.log(`\n结果：${pass} 通过 / ${fail} 失败${skipped ? `（另有 ${skipped} 个测试文件因缺夹具跳过，见 tests/FIXTURES.md）` : ''}`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) {
    console.log(`  ❌ ${f.file} :: ${f.name}\n    ${f.err.stack ? f.err.stack.split('\n').slice(0, 4).join('\n    ') : f.err.message}`);
  }
  process.exit(1);
}
