// PHASE 22 视觉验证截图：Design Center + 真实 STL + 热结 marker
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9234;
const URL = 'http://localhost:8090/?hsDebug=1';
const STL = process.argv[2] || 'D:/LOCAD/STL文件/ALHR4510V2/ALHR4510塑料模具v2-2.1.stl';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(ROOT, 'screenshots');

async function waitForServer() { for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch (e) {} await wait(250); } throw new Error('server not reachable'); }
async function getWsUrl() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } } catch (e) {} await wait(200); } throw new Error('CDP not reachable'); }

let server = null;
try { await fetch(URL); } catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--window-size=1600,1000', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_shot_p22`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
try {
  await waitForServer();
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await wait(1500);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="designCenter"]').click()` });
  await wait(500);
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [STL] });
  // 等待分析完成
  let step = '', waited = 0;
  while (waited < 150) { await wait(200); waited++; const r = await send('Runtime.evaluate', { expression: `window.__impStep || ''`, returnByValue: true }); step = r.result.value; if (step === 'hsDone') break; }
  console.log('分析完成:', step, `(${waited * 0.2}s)`);
  await wait(400);
  // 截图 1：默认视角（热结 marker 全貌）
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('保存', name); };
  await shot('p22_dc_hotspots.png');
  // 截图 2：透明模式看热结在壁内的位置
  await send('Runtime.evaluate', { expression: `document.getElementById('dc_dispMode').value='transparent'; document.getElementById('dc_dispMode').dispatchEvent(new Event('change'));` });
  await wait(300);
  await shot('p22_dc_transparent.png');
  // 截图 3：选中 H1 聚焦
  await send('Runtime.evaluate', { expression: `window.__view3d?.selectHotspot(0, true);` });
  await wait(400);
  await shot('p22_dc_focus_h1.png');
} catch (e) { console.error('失败:', e.message); } finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
}
