// ============================================================
// PHASE 73（81.txt §十二）· 性能与稳定性体检
//   页面首次加载 / 小件与大件 STL 导入耗时 / 重复导入 / 页面刷新 /
//   多次切换语言 / 多次计算 / console error 与未捕获异常
// 用法: node scripts/browser_perf_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, statSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9273;
const URL = process.env.CT_URL || 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_perf');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--window-size=1400,950', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } } catch (e) {}
  await wait(200);
}
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map(); const errors = [];
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails.exception?.description?.split(/\r?\n/)[0] || m.params.exceptionDetails.text));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + (m.params.args?.[0]?.value || '').slice(0, 120));
};
await new Promise(r => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const importStl = async (file) => {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, file).replace(/\\/g, '/')] });
};
const waitBadge = async (timeoutMs = 180000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
    if (t) return Date.now() - t0;
    await wait(500);
  }
  return null;
};

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };
const MB = (p) => (statSync(path.join(ROOT, p)).size / 1048576).toFixed(1) + 'MB';

try {
  /* 1. 首次加载 */
  const t0 = Date.now();
  await send('Page.navigate', { url: URL });
  await wait(200);
  const firstPaint = await evalJs(`(async () => {
    return await new Promise(res => {
      const done = () => res(Math.round(performance.now()));
      if (document.readyState === 'complete') return done();
      window.addEventListener('load', () => setTimeout(done, 0));
      setTimeout(done, 15000);
    });
  })()`);
  check('首次加载完成（load 事件）', firstPaint != null && firstPaint < 8000, `${firstPaint} ms（墙钟 ${Date.now() - t0} ms）`);
  const appUp = await evalJs(`!!document.querySelector('#nav .nav-item') && !!document.querySelector('#view .home')`);
  check('应用壳 + 首页渲染完成', appUp === true);

  /* 2. STL 导入耗时（小件 / 真实件 / 大件） */
  const CASES = [
    { f: 'tests/golden/cube50.stl', name: 'cube50（小件）' },
    { f: 'tests/real-stl/ALR2510塑料模具v1.stl', name: 'ALR2510（真实件）' },
    { f: 'tests/golden/hollowThickRing.stl', name: 'hollowThickRing（大件）' },
  ];
  for (const c of CASES) {
    await evalJs(`location.hash = '#/designCenter'`); await wait(900);
    await evalJs(`document.querySelector('#dc_manualLink')?.click()`); await wait(300);
    await send('Page.reload', {}); await wait(1200);
    await evalJs(`location.hash = '#/designCenter'`); await wait(900);
    const t = Date.now();
    await importStl(c.f);
    const ms = await waitBadge();
    check(`导入并分析 ${c.name}`, ms != null, ms == null ? '超时' : `${((Date.now() - t) / 1000).toFixed(1)} s（${MB(c.f)}）`);
  }

  /* 3. 重复导入同一文件（不应崩溃 / 不应内存失控） */
  for (let i = 0; i < 2; i++) { await importStl('tests/golden/cube50.stl'); await waitBadge(); }
  const afterRepeat = await evalJs(`!!document.querySelector('#dc_hsBadge')?.textContent`);
  check('重复导入 2 次仍正常', afterRepeat === true);

  /* 4. 页面刷新：STL 会话按既有语义清理 */
  await send('Page.reload', {}); await wait(1800);
  await evalJs(`location.hash = '#/designCenter'`); await wait(1000);
  const afterReload = await evalJs(`(() => {
    return { importZone: !document.querySelector('#dc_importZone')?.hidden, hasBadge: !!document.querySelector('#dc_hsBadge')?.textContent };
  })()`);
  check('刷新后回到导入态（STL 会话已清理）', afterReload.importZone === true && afterReload.hasBadge === false, JSON.stringify(afterReload));

  /* 5. 多次切换语言（参数与结果不变、无异常） */
  await evalJs(`location.hash = '#/calculators/gating'`); await wait(1000);
  await evalJs(`(() => { const el=document.querySelector('#g_pw'); const p=HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'52.5'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await wait(700);
  const before = await evalJs(`document.querySelector('#g_summary')?.textContent.replace(/\\s+/g,' ').trim().slice(0,120)`);
  for (let i = 0; i < 6; i++) {
    await evalJs(`document.querySelector('.lang-btn[data-lang="en-US"]')?.click()`); await wait(500);
    await evalJs(`document.querySelector('.lang-btn[data-lang="zh-CN"]')?.click()`); await wait(500);
  }
  const after = await evalJs(`document.querySelector('#g_summary')?.textContent.replace(/\\s+/g,' ').trim().slice(0,120)`);
  const pw = await evalJs(`document.querySelector('#g_pw')?.value`);
  check('切换语言 12 次：结果与参数不变', before === after && pw === '52.5', pw === '52.5' ? '' : `pw=${pw}`);

  /* 6. 多次连续计算 */
  for (let i = 0; i < 8; i++) {
    await evalJs(`(() => { const el=document.querySelector('#g_pw'); const p=HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'${40 + i}'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await wait(260);
  }
  const stillOk = await evalJs(`!!document.querySelector('#g_summary')?.textContent`);
  check('连续改参计算 8 次无异常', stillOk === true);

  console.log('\n  console.error / 未捕获异常：' + (errors.length ? '\n    ' + errors.slice(0, 6).join('\n    ') : '无 ✅'));
  if (errors.length) failures++;
  console.log(`\n性能与稳定性体检：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  process.exit(failures ? 1 : 0);
}
