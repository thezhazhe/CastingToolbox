// ============================================================
// Casting Toolbox 本地服务器（完全离线）· 双击 start.bat / serve.cmd
// 单实例：端口探测 + 锁文件，避免重复启动第二个服务器/第二个浏览器页。
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 8090;
const LOCK = path.join(DIR, '.ct-server.json');
let myPort = -1;   // 本进程实际监听的端口；-1 = 未监听（不会清锁）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.stl':  'application/octet-stream',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const filePath = path.normalize(path.join(DIR, urlPath));
    if (!filePath.startsWith(DIR)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); return res.end('Not found: ' + urlPath);
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

/* ================= 单实例 ================= */

/** 探测：端口上是否已经是本应用在服务？ */
function probeApp(port, ms = 700) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: ms }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body.includes('Casting Toolbox')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
function readLock() { try { return JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch { return null; } }
function writeLock(port) {
  myPort = port;
  try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port })); } catch (e) {}
}
/** 只在锁还指向本进程时清除（避免误删已运行实例的锁） */
function cleanup() {
  if (myPort < 0) return;
  try { const l = readLock(); if (l && l.pid === process.pid && l.port === myPort) fs.unlinkSync(LOCK); } catch (e) {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

function openBrowser(port) {
  try { exec('start "" "http://localhost:' + port + '/"', () => {}); } catch (_) {}
}

function banner(port) {
  console.log('');
  console.log('  =============================================');
  console.log('    Casting Toolbox  local server');
  console.log('    http://localhost:' + port + '/');
  console.log('    Fully offline - no network needed');
  console.log('    Press Ctrl+C to stop');
  console.log('  =============================================');
  console.log('');
}

async function tryListen(port) {
  server.removeAllListeners('error');
  server.on('error', async (e) => {
    if (e.code === 'EADDRINUSE') {
      if (await probeApp(port)) {          // 端口已是本应用 → 打开浏览器退出（不重复起服务器）
        console.log('  Casting Toolbox 已在运行（端口 ' + port + '），已打开现有实例。');
        openBrowser(port);
        return;
      }
      if (port - PORT >= 10) { console.error('  没有可用端口，请关闭其他占用 8090~8100 的程序后重试。'); process.exit(1); }
      console.log('  端口 ' + port + ' 被其他程序占用，尝试 ' + (port + 1) + '...');
      tryListen(port + 1);
    } else {
      console.error('  Server error:', e.message);
    }
  });
  server.listen(port, () => {
    writeLock(port);
    banner(port);
    setTimeout(() => openBrowser(port), 500);
  });
}

async function main() {
  // 1) 已运行？（锁文件端口优先，再查默认端口）→ 打开现有实例并退出
  const lock = readLock();
  if (lock && lock.port && (await probeApp(lock.port))) {
    console.log('  Casting Toolbox 已在运行（端口 ' + lock.port + '），已打开现有实例。');
    openBrowser(lock.port);
    return;
  }
  if (await probeApp(PORT)) {
    console.log('  Casting Toolbox 已在运行（端口 ' + PORT + '），已打开现有实例。');
    openBrowser(PORT);
    return;
  }
  // 2) 没有重复实例 → 启动服务器
  tryListen(PORT);
}

main();
