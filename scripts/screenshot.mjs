// ============================================================
// 生成界面截图（供查看设计效果）
// 用法: node scripts/screenshot.mjs
// 输出: screenshots/*.png
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9232;
const URL = 'http://localhost:8090/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(ROOT, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const SHOTS = [
  ['home', '#/home', '00_首页'],
  ['calculators', '#/calculators', '01_计算工具列表'],
  ['gating', '#/calculators/gating', '02_浇注系统设计'],
  ['riser', '#/calculators/riser', '03_冒口设计'],
  ['castability', '#/calculators/castability', '03b_结构工艺性'],
  ['wizard', '#/wizard', '04_工艺向导'],
  ['defect_finder', '#/calculators/defect_finder', '08_缺陷查找'],
  ['charge', '#/calculators/charge', '09_熔炼加料计算'],
  ['shakeout', '#/calculators/shakeout', '10_开箱时间'],
  ['principles', '#/calculators/principles', '10c_铸造原则'],
];

async function waitForServer() {
  for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch (e) {} await wait(250); }
  throw new Error('server not reachable');
}
async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (r.ok) { const p = (await r.json()).find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    } catch (e) {}
    await wait(200);
  }
  throw new Error('CDP not reachable');
}

let server = null;
try { await fetch(URL); } catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--window-size=1280,860', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_shot_profile`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
try {
  await waitForServer();
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1.4, mobile: false });

  // 解锁开发者模式（知识库树 / 详情截图需要）
  await send('Page.navigate', { url: URL });
  await wait(800);
  await send('Runtime.evaluate', { expression: `localStorage.setItem('ct-dev','1')` });
  await send('Page.reload', {});
  await wait(800);

  for (const [, hash, name] of SHOTS) {
    await send('Page.navigate', { url: URL + hash });
    await wait(1200);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('saved', file);
  }
  // 首页展开截图（点击提示条 → 推荐区滚入视图，展示渐进展示效果）
  await send('Page.navigate', { url: URL + '#/home' });
  await wait(1200);
  await send('Runtime.evaluate', { expression: `document.getElementById('homeReco').scrollIntoView({behavior:'auto', block:'start'})` });
  await wait(500);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  const file2 = path.join(OUT, '00b_首页展开.png');
  fs.writeFileSync(file2, Buffer.from(shot2.data, 'base64'));
  console.log('saved', file2);

  // 搜索截图
  await send('Page.navigate', { url: URL });
  await wait(800);
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='QT450'; document.getElementById('globalSearch').dispatchEvent(new Event('input'))` });
  await wait(700);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  let file = path.join(OUT, '05_搜索下拉.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 向导报告截图
  await send('Runtime.evaluate', { expression: `location.hash = '#/wizard'` });
  await wait(600);
  await send('Runtime.evaluate', { expression: `document.getElementById('wzStart').click()` });
  await wait(500);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-mat="QT450"]').click()` });
  await wait(500);
  for (let i = 0; i < 5; i++) {
    await send('Runtime.evaluate', { expression: `document.getElementById('wzNext').click()` });
    await wait(350);
  }
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '06_向导报告.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 捐助弹窗截图
  await send('Runtime.evaluate', { expression: `document.getElementById('btnDonate').click()` });
  await wait(700);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '07b_捐助支持.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);
  await send('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))` });
  await wait(200);

  // 亮色主题截图
  await send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme','light')` });
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators'` });
  await wait(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '07_亮色主题.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);
  // 知识详情中文字段截图
  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge/materials'` });
  await wait(700);
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('.kb-item')).find(el => el.textContent.includes('HT200')) ? Array.from(document.querySelectorAll('.kb-item')).find(el => el.textContent.includes('HT200')).click() : null` });
  await wait(600);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '08_知识详情中文.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 主题树截图：型砂主题（含双显）+ 设备主题（3D打印 + DISA）
  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge/sand'` });
  await wait(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '09_知识库型砂.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);
  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge/equipment'` });
  await wait(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '10_知识库设备.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);
  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge/materials'` });
  await wait(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '11_知识库材料对照.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 当前工况截图（设置工况 → 顶栏工况条）
  await send('Runtime.evaluate', { expression: `localStorage.setItem('ct-context', JSON.stringify({material:'球铁', line:'垂直线'}))` });
  await send('Page.reload', {});
  await wait(800);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators'` });
  await wait(800);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '12_当前工况.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 首页带工况推荐截图（🎯 针对你的生产场景）
  await send('Runtime.evaluate', { expression: `location.hash = '#/home'` });
  await wait(1000);
  await send('Runtime.evaluate', { expression: `document.getElementById('homeReco').scrollIntoView({behavior:'auto', block:'start'})` });
  await wait(500);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '15_首页推荐.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 工艺卡片截图（搜 QT450 → 打开详情）
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='QT450'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(600);
  await send('Runtime.evaluate', { expression: `document.querySelector('.kb-item[data-id="QT450"]') ? document.querySelector('.kb-item[data-id="QT450"]').click() : null` });
  await wait(600);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '13_工艺卡片.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 搜索分类截图（返回搜索结果页：符合工况 + 材料 + 计算工具分组）
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-back]')?.click()` });
  await wait(600);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  file = path.join(OUT, '14_搜索分类.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('saved', file);

  // 清理工况
  await send('Runtime.evaluate', { expression: `localStorage.removeItem('ct-context')` });
  await send('Page.reload', {});
  await wait(600);
  // 主题复位
  await send('Runtime.evaluate', { expression: `document.documentElement.setAttribute('data-theme','auto')` });
} catch (e) {
  console.error('screenshot error:', e.message);
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
}
