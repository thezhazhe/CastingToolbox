// ============================================================
// PHASE 78（78.txt）界面效果截图（供人工查看显示层改动）
// 输出 screenshots/p78_*.png
// 用法: node scripts/shot_p78.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9261;
const URL = 'http://localhost:8090/';
const OUT = path.join(ROOT, 'screenshots');
const PROFILE = path.join(ROOT, '_edge_profile_shot78');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--window-size=1600,1000', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } } catch (e) {}
  await wait(200);
}
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await new Promise(r => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
  console.log('saved', name + '.png');
};
const scrollTo = async (sel) => { await evalJs(`document.querySelector('${sel}')?.scrollIntoView({behavior:'auto', block:'start'})`); await wait(400); };

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1.25, mobile: false });
await send('Page.navigate', { url: URL + '#/designCenter' });
await wait(1500);

// 导入 cube50（真实 STL 路径）→ 注入热结（模拟检出热结的模型，展示勾选列表）
const doc = await send('DOM.getDocument', { depth: 1 });
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, 'tests', 'golden', 'cube50.stl').replace(/\\/g, '/')] });
await wait(6000);
await evalJs(`(async () => {
  const p = await import('/js/model/CastingProject.js');
  p.set('hotspots.status', 'ok', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  p.set('hotspots.items', [
    { id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 },
    { id: 2, x: 20, y: 8, z: 4, mc: 8, regionVolumeCm3: 25 },
  ], p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
  p.set('process.mcHotspot', 14, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  p.set('process.hsPick', [{ id: 1, mc: 14 }, { id: 2, mc: 12 }], p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
  return true;
})()`);
await evalJs(`(() => { const el = document.querySelector('#dc_m_family'); el.value = '灰铁';
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, '灰铁');
  el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await wait(900);
await shot('p78_01_参数区顶（概览枢纽·全屏单列）');
await scrollTo('#dc_params');
await shot('p78_02_参数与执行条件（比例可选·热结勾选）');
await scrollTo('#dc_run');
await wait(300);
await shot('p78_03_参数区底部（STL 自动识别折叠）');

// 执行 → 结果页
await evalJs(`document.querySelector('#dc_run').click()`);
for (let i = 0; i < 40; i++) { if (await evalJs(`!!document.querySelector('#dc_resultActive')?.textContent.length`)) break; await wait(600); }
await wait(600);
await scrollTo('#dc_results');
await shot('p78_04_结果①铸件结构工艺性（4 张卡）');
await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(600);
await scrollTo('#dc_resultActive');
await shot('p78_05_结果②冒口设计（形状下拉·热结分页签）');
await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]').click()`); await wait(600);
await scrollTo('#dc_resultActive');
await shot('p78_06_结果③浇注系统（内浇道与排气可改框）');
// PHASE 79（79.txt 三）：切到「正方柱」→ 尺寸应显示 边长（长×宽），不再是 ⌀ 直径
await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(600);
await evalJs(`(() => { const s = document.querySelector('#dc_riserShape'); if (!s) return false;
  s.value = 'square'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
await wait(2800);
await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
await scrollTo('#dc_resultActive');
await shot('p78_09_冒口形状=正方柱（显示边长·长x宽）');

// 线收缩率工具 + 工具分类
await evalJs(`location.hash = '#/calculators/shrinkage'`); await wait(900);
await shot('p78_07_线收缩率（只突出综合比例·分方向折叠）');
await evalJs(`location.hash = '#/calculators'`); await wait(900);
await shot('p78_08_计算工具（6 类分组）');

ws.close(); edge.kill(); server?.kill();
process.exit(0);
