// ============================================================
// S5（158.txt）视觉验收截图
//   用法: node scripts/shot_s5.mjs
//   输出: screenshots/s5_*.png
//   ⚠ 自动化截图 ≠ 人工验收；必须逐张打开看（H/D 字段/球形隐藏/底部说明/出品率口径）。
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'screenshots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9276;
const URL = 'http://localhost:8090/';
const STL = path.join(ROOT, 'tests', 'golden', 'thickOnThin.stl');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}
try { fs.rmSync(path.join(ROOT, '_shot_s5'), { recursive: true, force: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${path.join(ROOT, '_shot_s5')}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } }
  } catch (e) {}
  await wait(200);
}

let ws = null;
try {
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  };
  await new Promise(r => (ws.onopen = r));
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const poll = async (expr, timeoutMs = 60000, step = 400) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const viewport = async (w, h, mobile = false) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await wait(500);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('  📸', name);
  };
  const importStl = async (file) => {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file.replace(/\\/g, '/')] });
  };
  const setInput = async (sel, val) => evalJs(`(() => {
    const el = document.querySelector('${sel}'); if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true; })()`);
  const openTab = async (tab) => {
    await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(450);
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(400);
    await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(350);
  };
  const analyze = async () => {
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
    await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 60000, 500);
    await wait(500);
  };
  const backToModel = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(500);
    }
  };

  await viewport(1366, 900);
  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1800);
  await importStl(STL);
  await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 700);
  await wait(600);

  /* 先选材料并分析一次 */
  await openTab('cond');
  await setInput('[data-pf="material.family"]', '球铁'); await wait(300);
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(250);
  await analyze();

  /* 1 · 参数面板 ③ 冒口设计：H/D 四档默认 1.0（先回到模型视图，面板才可见） */
  await backToModel();
  await openTab('riser'); await wait(500);
  await evalJs(`document.querySelector('[data-pf="process.hdRatio"]')?.scrollIntoView({ block: 'center' })`); await wait(400);
  await shot('s5_01_hd_param');

  /* 2 · H/D=1.5 保存并分析 → 结果页实际 H/D（展开详细信息） */
  await setInput('[data-pf="process.hdRatio"]', '1.5'); await wait(300);
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(500);
  await analyze();
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(600);
  await evalJs(`document.querySelector('#dc_resultActive details.dc-adv-detail')?.setAttribute('open','')`); await wait(300);
  await shot('s5_02_results_hd_15');

  /* 3 · 球形：H/D 字段隐藏 + H≡D 说明 */
  await backToModel();
  await openTab('riser'); await wait(400);
  await setInput('[data-pf="process.riserShape"]', 'sphere'); await wait(500);
  await evalJs(`document.querySelector('[data-pf="process.riserShape"]')?.scrollIntoView({ block: 'center' })`); await wait(400);
  await shot('s5_03_sphere_hidden');

  /* 4 · 浇注结果：不展示实际出品率，保留人工回算入口 */
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(400);
  await analyze();
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(600);
  await evalJs(`document.querySelector('#dc_resultActive .dc-weight-ledger')?.setAttribute('open','')`); await wait(300);
  await shot('s5_04_results_yield');

  /* 5 · 英文 H/D */
  await evalJs(`document.querySelector('[data-lang="en-US"]')?.click()`); await wait(800);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(500);
  await evalJs(`document.querySelector('#dc_resultActive details.dc-adv-detail')?.setAttribute('open','')`); await wait(300);
  await shot('s5_05_english_hd');
  await evalJs(`document.querySelector('[data-lang="zh-CN"]')?.click()`); await wait(600);

  /* 6 · 移动端参数面板 H/D（切回柱形） */
  await backToModel();
  await openTab('riser'); await wait(400);
  await setInput('[data-pf="process.riserShape"]', 'cyl'); await wait(400);
  await viewport(390, 844, true);
  await openTab('riser'); await wait(600);
  await evalJs(`document.querySelector('[data-pf="process.hdRatio"]')?.scrollIntoView({ block: 'center' })`); await wait(400);
  await shot('s5_06_mobile_hd');

  console.log('\n截图输出目录:', OUT);
} catch (e) {
  console.error('截图脚本异常：', e.stack || e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  try { fs.rmSync(path.join(ROOT, '_shot_s5'), { recursive: true, force: true }); } catch (e) {}
  process.exit();
}
