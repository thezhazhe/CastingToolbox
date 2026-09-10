// ============================================================
// PHASE 73 · Windows 便携版打包（复用 v0.15/v0.16 的既有形态：文件夹 + zip）
//
// 产物：
//   dist/CastingToolbox-v<版本>-win64/        单文件 EXE + 全部静态资源 + LICENSE + README
//   dist/CastingToolbox-v<版本>-win64.zip
//
// 为什么要有这个脚本：v0.16 的发布目录是手工拼的，会漏文件——
//   PHASE 73 审计发现旧 APK 就漏了 vendor/（设计中心 3D 依赖 three.js）。
//   这里把"EXE 运行真正需要的文件"写成显式清单，并有测试断言清单完整性。
// 用法：node scripts/pack_win.mjs    （先跑 build_exe.bat 生成 CastingToolbox.exe）
// ============================================================
import { existsSync, mkdirSync, copyFileSync, cpSync, rmSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../js/version.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAME = `CastingToolbox-v${VERSION}-win64`;
const OUT = path.join(ROOT, 'dist', NAME);
const ZIP = path.join(ROOT, 'dist', NAME + '.zip');

/* EXE 运行（本地 HTTP 服务）真正需要的东西 —— 少一个就会在用户机器上白屏 */
export const WIN_FILES = ['CastingToolbox.exe', 'index.html', 'favicon.svg', 'LICENSE', 'README.md'];
export const WIN_DIRS = ['assets', 'calcs', 'css', 'data', 'js', 'vendor'];

const exe = path.join(ROOT, 'CastingToolbox.exe');
if (!existsSync(exe)) { console.error('[pack_win] 缺少 CastingToolbox.exe —— 请先运行 build_exe.bat'); process.exit(1); }

console.log('[1/3] 准备目录 ' + path.relative(ROOT, OUT));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('[2/3] 拷贝运行所需文件');
for (const f of WIN_FILES) {
  const src = path.join(ROOT, f);
  if (!existsSync(src)) { console.error('  缺少 ' + f); process.exit(1); }
  copyFileSync(src, path.join(OUT, f));
  console.log('  + ' + f);
}
for (const d of WIN_DIRS) {
  const src = path.join(ROOT, d);
  if (!existsSync(src)) { console.error('  缺少目录 ' + d); process.exit(1); }
  cpSync(src, path.join(OUT, d), { recursive: true });
  console.log('  + ' + d + '/');
}

console.log('[3/3] 压缩 ' + path.basename(ZIP));
rmSync(ZIP, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`], { stdio: 'inherit' });

const size = (p) => (statSync(p).size / 1048576).toFixed(1) + ' MB';
console.log(`\n完成：\n  ${path.relative(ROOT, OUT)}  (${readdirSync(OUT).length} 个条目)\n  ${path.relative(ROOT, ZIP)}  (${size(ZIP)})`);
