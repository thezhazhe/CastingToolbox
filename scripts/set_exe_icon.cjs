// ============================================================
// 给 EXE 设置品牌图标（快捷方式显示用）。
// 用法: node scripts/set_exe_icon.cjs <target.exe> <icon.ico>
// 原理: 优先在 npx 缓存里找 rcedit.exe（@electron/rcedit 的二进制），
//       找不到就先用 npx 联网拉一次包再找；之后直接调用 exe。
// ============================================================
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const target = process.argv[2];
const ico = process.argv[3];
if (!target || !ico) { console.error('用法: node set_exe_icon.cjs <exe> <ico>'); process.exit(1); }

function findRcedit() {
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/rcedit(-x64)?\.exe$/i.test(e.name)) found.push(p);
      }
    };
    walk(root);
  }
  return found.sort((a, b) => b.length - a.length)[0] || null;
}

let rcedit = findRcedit();
if (!rcedit) {
  // 首次联网拉包（拉完缓存里就有 rcedit.exe）
  try { execFileSync('npx', ['--yes', '--package', 'rcedit', 'node', '-e', '1'], { stdio: 'ignore' }); } catch (e) {}
  rcedit = findRcedit();
}
if (!rcedit) { console.error('[set_exe_icon] 未找到 rcedit.exe（首次需联网下载）。可跳过，仅影响快捷方式图标。'); process.exit(2); }

console.log('[set_exe_icon] 用 ' + rcedit + ' 设置图标 → ' + path.resolve(target));
try {
  execFileSync(rcedit, [path.resolve(target), '--set-icon', path.resolve(ico)], { stdio: 'inherit' });
  console.log('[set_exe_icon] 图标设置成功');
} catch (e) {
  console.error('[set_exe_icon] 设置失败: ' + (e && e.message));
  process.exit(3);
}
