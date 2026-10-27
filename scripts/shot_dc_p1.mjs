// ============================================================
// 146.txt §十：视觉验收截图（12 个指定状态）
//   1 明亮主题下未导入 STL        7 三类结果速览
//   2 明亮主题下已导入 STL        8 三类详细信息展开
//   3 参数窗口                    9 标准视图切换前后
//   4 参数确认后、开始分析前      10 热结点击前后
//   5 分析完成的三维工作区        11 暗色主题
//   6 左侧结果概览与热结列表      12 移动端
// 用法: node scripts/shot_dc_p1.mjs
// 输出: screenshots/r4_*.png   （**自动化截图 ≠ 视觉验收**：必须逐张人眼看，见交付报告）
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'screenshots');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9271;
const URL = 'http://localhost:8090/';
// 有热结、且**非对称**（前后左右视图必须看得出差别）的模型
const STL = path.join(ROOT, 'tests', 'golden', 'thickOnThin.stl');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { fs.mkdirSync(OUT, { recursive: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
async function waitForServer() { for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch (e) {} await wait(250); } throw new Error('server not reachable'); }
async function getWsUrl() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } } catch (e) {} await wait(200); } throw new Error('CDP not reachable'); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu',
  '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_shot_dc_p1`, 'about:blank'], { stdio: 'ignore' });

const shots = [];
let ws = null;
try {
  await waitForServer();
  ws = new WebSocket(await getWsUrl());
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const viewport = async (w, h, mobile = false) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await wait(600); };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    shots.push(name);
    console.log('  📸', name);
  };
  const poll = async (expr, timeoutMs = 200000, step = 600) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const resolvedTheme = () => evalJs(`(() => { const t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t; return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; })()`);
  const setTheme = async (want) => {
    for (let i = 0; i < 4; i++) {
      if (await resolvedTheme() === want) { await wait(500); return; }
      await evalJs(`document.getElementById('themeBtn').click()`); await wait(450);
    }
    console.warn('  ⚠️ 未能切到主题', want, '当前', await resolvedTheme());
  };
  const setCtl = (sel, v) => evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '${v}');
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true; })()`);
  /* 真实鼠标点击（§5 的教训：合成 .click() 会绕过 OrbitControls 的指针捕获，测不出/也拍不出真实交互） */
  const realClick = async (sel) => {
    const r = await evalJs(`(() => { const b = document.querySelector('${sel}'); if (!b) return null;
      const q = b.getBoundingClientRect(); return JSON.stringify([q.left + q.width / 2, q.top + q.height / 2]); })()`);
    if (!r) return false;
    const [x, y] = JSON.parse(r);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await wait(700);
    return true;
  };

  await viewport(1600, 1000);
  /* ⚠ **不带 `?hsDebug=1`**：那会打开 DEBUG_HS，在左栏渲染「采样网格 / STL 诊断」内部面板、
     状态条也变成调试文案 —— 那样拍出来的**不是产品本身**（第一版截图实拍到过）。
     本脚本只用真实鼠标点击做前后对比，不需要 `window.__view3d` 调试句柄。 */
  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1700);

  /* ① 明亮主题下未导入 STL */
  await setTheme('light');
  await shot('r4_01_明亮_未导入');

  /* ② 明亮主题下已导入 STL（真实导入；状态应为"参数待确认"） */
  const doc = await send('DOM.getDocument', { depth: 1 });
  const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [STL.replace(/\\/g, '/')] });
  await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 240000, 900);
  await wait(900);
  await shot('r4_02_明亮_已导入_参数待确认');

  /* ③ 参数窗口（三模块各一张：分析条件 / 冒口设计 / 浇注系统） */
  await evalJs(`document.querySelector('#dc_paramsBtn').click()`); await wait(700);
  await shot('r4_03a_参数窗口_分析条件');
  await evalJs(`document.querySelector('#dc_sec_riser')?.scrollIntoView({ block: 'start' })`); await wait(600);
  await shot('r4_03b_参数窗口_冒口设计');
  await evalJs(`document.querySelector('#dc_sec_gating')?.scrollIntoView({ block: 'start' })`); await wait(600);
  await shot('r4_03c_参数窗口_浇注系统');

  /* ④ 参数确认后、开始分析前（保存 → 窗口关闭 → 参数有效） */
  await evalJs(`(() => { const el = document.querySelector('[data-pf="material.family"]');
    const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(el, '球铁');
    el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(400);
  await shot('r4_03d_参数窗口_已填写待保存');
  await evalJs(`document.querySelector('#dc_dlgSave').click()`);
  await wait(1400);
  await shot('r4_04_参数已确认_分析前');

  /* ⑤ 分析完成的三维工作区（暗色主题） */
  await evalJs(`document.querySelector('#dc_run').click()`);
  await poll(`document.querySelector('#dc_ws')?.dataset.flow === 'D' ? 1 : 0`, 120000, 700);
  await wait(900);
  await setTheme('dark');
  await shot('r4_11_暗色主题_分析完成');

  /* ⑥ 左侧结果概览与热结列表（桌面双列） */
  await setTheme('light'); await wait(500);
  await shot('r4_06_左栏_概览与热结列表');

  /* ⑨ 标准视图切换前后（真实鼠标点击） */
  await shot('r4_09a_标准视图_切换前');
  await realClick('.dc-view-btns button[data-view="front"]');
  await shot('r4_09b_标准视图_前视图');
  await realClick('.dc-view-btns button[data-view="left"]');
  await shot('r4_09c_标准视图_左视图');
  await realClick('.dc-view-btns button[data-view="isometric"]');
  await shot('r4_09d_标准视图_等轴测');

  /* ⑩ 热结点击前后（真实鼠标点击列表项；相机必须**不动**） */
  const hsN = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs]').length`);
  if (hsN > 0) {
    await shot('r4_10a_热结_点击前');
    await realClick('#dc_hotspotList [data-hs="0"]');
    await shot('r4_10b_热结_点击后');
    if (hsN > 1) { await realClick('#dc_hotspotList [data-hs="1"]'); await shot('r4_10c_热结_点第二个'); }
  } else {
    console.warn('  ⚠️ 该模型未检出热结，跳过 ⑩');
  }

  /* ⑦⑧ 三类结果：速览 + 详细信息展开 */
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(900);   // 状态 D → 查看分析结果
  const NAV = [['page1', '工艺性'], ['riser', '冒口'], ['gating', '浇注']];
  for (const [k, label] of NAV) {
    await evalJs(`document.querySelector('#dc_resultNav [data-nav="${k}"]')?.click()`); await wait(700);
    await shot(`r4_07_结果速览_${label}`);
    await evalJs(`document.querySelectorAll('#dc_resultActive details.dc-adv-detail').forEach(d => d.open = true)`);
    await wait(500);
    await shot(`r4_08_详细信息_${label}`);
  }
  // 结果页返回工作台
  await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(800);

  /* ⑫ 移动端（暗色 + 亮色） */
  await viewport(390, 844, true); await wait(900);
  await shot('r4_12a_移动端_亮色');
  await setTheme('dark');
  await shot('r4_12b_移动端_暗色');
  // 移动端参数窗口（§九 明确要求检查移动端排版）
  await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(700);
  await shot('r4_12c_移动端_参数窗口');

  console.log('\n截图完成：', shots.length, '张 → screenshots/');
  console.log('★ 提醒：自动化截图 ≠ 视觉验收 —— 必须逐张人眼检查（§十）。');
} catch (e) {
  console.error('脚本异常：', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill();
  server?.kill();
}
