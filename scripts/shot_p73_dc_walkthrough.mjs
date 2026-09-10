// ============================================================
// PHASE 73（81.txt §八）· Design Center 全流程盲测截图
//   站在第一次使用的铸造工程师视角：导入 STL → 看懂信息 → 填参数 → 出结果
//   输出 screenshots/p73_walk_*.png（供人工判断三个核心问题）
// 用法: node scripts/shot_p73_dc_walkthrough.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9269;
const URL = 'http://localhost:8090/';
const OUT = path.join(ROOT, 'screenshots');
const PROFILE = path.join(ROOT, '_edge_profile_walk');
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
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await new Promise(r => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(s.data, 'base64')); console.log('saved', n + '.png'); };
const scrollTo = async (sel) => { await evalJs(`document.querySelector('${sel}')?.scrollIntoView({behavior:'auto',block:'start'})`); await wait(400); };

await send('Page.navigate', { url: URL + '#/designCenter' });
await wait(1600);
await evalJs(`localStorage.removeItem('ct-project'); localStorage.removeItem('ct-context');`);
await send('Page.reload', {}); await wait(1500);
await evalJs(`location.hash = '#/designCenter'`); await wait(1200);
await shot('p73_walk_1_入口（拖拽导入区）');

// 导入 cube50
const doc = await send('DOM.getDocument', { depth: 1 });
const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, 'tests', 'golden', 'cube50.stl').replace(/\\/g, '/')] });
await wait(1200);
for (let i = 0; i < 60; i++) { const t = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`); if (t) break; await wait(1000); }
await wait(800);
await shot('p73_walk_2_导入完成（3D + 状态条）');
await scrollTo('#dc_panel');
await shot('p73_walk_3_右侧概览+热结列表');
await scrollTo('#dc_params');
await shot('p73_walk_4_参数区顶部（来源徽章）');
await evalJs(`document.querySelector('#dc_paramsWrap')?.scrollIntoView({behavior:'auto',block:'start'})`);
await wait(300);
const st = await evalJs(`(() => { const el = document.querySelector('#dc_m_family'); if (!el) return false; const p = HTMLSelectElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'灰铁'); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
await wait(1000);
await shot('p73_walk_5_选材料后（参数联动提示）');
await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(2500);
await scrollTo('#dc_results');
await shot('p73_walk_6_结果页Page1');
await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(700);
await shot('p73_walk_7_结果页Page2冒口');
await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(700);
await shot('p73_walk_8_结果页Page3浇注');

ws.close(); edge.kill(); server?.kill();
process.exit(0);
