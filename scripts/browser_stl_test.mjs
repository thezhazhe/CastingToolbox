// ============================================================
// PHASE 21 真实浏览器 UI 验证（29.txt 第 5/6 条，最强证据）
// 无头 Edge + CDP：真实页面 → 真实 importFile → 真实 3D 渲染路径，
// 注入真实失败 STL「ALHR4510塑料模具v2-2.1.stl」→ 读取诊断结果。
// 断言：insidePoints > 0 且 不再出现「距离场无有效采样」且无 JS 异常。
// 用法: node scripts/browser_stl_test.mjs [stl路径]
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9232;
const URL = 'http://localhost:8090/?hsDebug=1';
const STL = process.argv[2] || 'D:/LOCAD/STL文件/ALHR4510V2/ALHR4510塑料模具v2-2.1.stl';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch (e) {}
    await wait(250);
  }
  throw new Error('server not reachable');
}
async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (r.ok) { const list = await r.json(); const p = list.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    } catch (e) {}
    await wait(200);
  }
  throw new Error('CDP not reachable on ' + CDP_PORT);
}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('not 200'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_edge_profile_p21`, 'about:blank'], { stdio: 'ignore' });

let ws = null, failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
  await waitForServer();
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const exceptions = []; const diagLines = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && d.exception.description) || d.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'log') {
      const t = m.params.args.map(a => a.value ?? '').join(' ');
      if (t.includes('[STL-DIAG]')) diagLines.push(t);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable');

  console.log(`\n══ PHASE 21 真实浏览器 UI 验证 ══\nSTL: ${path.basename(STL)}`);
  await send('Page.navigate', { url: URL });
  await wait(1500);

  // 切到工艺设计中心
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="designCenter"]').click()` });
  await wait(600);
  let r = await send('Runtime.evaluate', { expression: `document.querySelector('.dc-import-zone') !== null`, returnByValue: true });
  check('工艺设计中心渲染（STL 导入区）', r.result.value);

  // 通过真实 file input 注入 STL（触发 change → importFile，同用户拖拽/选择路径）
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  check('找到 #dc_file 文件输入', q.nodeId > 0);
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [STL] });
  console.log('  …文件已注入，等待 importFile 完成…');

  // 轮询完成信号（DEBUG_HS 的 __impStep 链: wait30→geom→geomDone→hs→hsDone）
  let step = '', waited = 0;
  while (waited < 120) {
    await wait(500); waited++;
    r = await send('Runtime.evaluate', { expression: `window.__impStep || ''`, returnByValue: true });
    step = r.result.value;
    if (step === 'hsDone') break;
  }
  console.log(`  …分析完成（__impStep=${step}，等待 ${waited * 0.5}s）`);
  check('importFile 完成（hsDone）', step === 'hsDone', step);

  // 读取诊断结果：DOM 诊断面板 + [STL-DIAG] console 输出
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    fileName: document.getElementById('dc_fileName')?.textContent || '',
    diagText: document.getElementById('dc_validate')?.textContent || '',
    hasWarn: (document.getElementById('dc_validate')?.textContent || '').includes('距离场无有效采样'),
    meta: document.getElementById('dc_metaChip')?.textContent || '',
    hsBadge: (document.querySelector('.dc-hs-badge') || document.querySelector('#dc_hsBadge') || {}).textContent || document.body.textContent.includes('检测到') ? 'has-msg' : '',
    bodyHasSampleWarn: document.body.textContent.includes('距离场无有效采样'),
    bodyHasHotspots: document.body.textContent.includes('检测到'),
  })`, returnByValue: true });
  const dom = JSON.parse(r.result.value);
  console.log(`\n[真实浏览器诊断面板]`);
  console.log(`  文件名: ${dom.fileName || '(空)'}`);
  console.log(`  模型信息: ${dom.meta || '(空)'}`);
  console.log(`  诊断面板: ${dom.diagText.slice(0, 120) || '(空)'}`);
  console.log(`  页面含"距离场无有效采样": ${dom.bodyHasSampleWarn}`);
  console.log(`  页面含"检测到 N 个热结": ${dom.bodyHasHotspots}`);
  for (const l of diagLines) console.log(`  [console] ${l.slice(0, 200)}`);

  // 解析 [STL-DIAG]：insidePoints / status
  const diag = diagLines.map(l => {
    try { return JSON.parse(l.slice(l.indexOf('{'))); } catch { return null; }
  }).find(Boolean);
  const inside = diag?.distanceField?.insidePoints;
  const status = diag?.thickness?.status;
  console.log(`\n[真实 UI 判定] insidePoints=${inside ?? '?'}  thickness.status=${status ?? '?'}`);
  check('真实 UI insidePoints > 0', Number(inside) > 0, `inside=${inside}`);
  check('不再出现"距离场无有效采样"', !dom.bodyHasSampleWarn && status !== 'INSUFFICIENT_NO_SAMPLE' && !dom.hasWarn, `status=${status}`);
  check('热结分析有结果消息', dom.bodyHasHotspots);
  check('无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

  console.log(`\n结果: ${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  console.error('测试失败:', e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
  process.exit(failures === 0 ? 0 : 1);
}
