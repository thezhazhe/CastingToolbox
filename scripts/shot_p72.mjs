// ============================================================
// PHASE 72（80.txt）中英双语界面截图（供人工查看显示层效果）
// 输出 screenshots/p72_*.png：中文态 / 英文态 对照（首页 / 计算器 / 设计中心）
// 用法: node scripts/shot_p72.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9263;
const URL = 'http://localhost:8090/';
const OUT = path.join(ROOT, 'screenshots');
const PROFILE = path.join(ROOT, '_edge_profile_shot72');
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
await send('Page.enable'); await send('Runtime.enable');
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(s.data, 'base64'));
  console.log('saved', name + '.png');
};
const lang = async (l) => { await evalJs(`document.querySelector('.lang-btn[data-lang="${l}"]')?.click()`); await wait(900); };
const setInput = async (sel, val) => evalJs(`(() => {
  const el = document.querySelector('${sel}'); if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '${val}');
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true;
})()`);

await send('Page.navigate', { url: URL });
await wait(1600);

await shot('p72_01_首页_中文');
await lang('en-US');
await shot('p72_02_首页_English');

await evalJs(`location.hash = '#/calculators/gating'`); await wait(1200);
await setInput('#g_pw', '52.5'); await wait(700);
await shot('p72_03_浇注系统_中文');
await lang('en-US');
await shot('p72_04_浇注系统_English（参数与结果不变）');

await lang('zh-CN');
await evalJs(`location.hash = '#/designCenter'`); await wait(1200);
await evalJs(`document.querySelector('#dc_manualLink')?.click()`); await wait(500);
await setInput('#dc_m_family', '灰铁'); await wait(400);
await setInput('#dc_p_volume', '900');
await setInput('#dc_p_wallMain', '22');
await setInput('#dc_m_mc', '13'); await wait(600);
await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(2500);
await evalJs(`document.querySelector('#dc_results')?.scrollIntoView({behavior:'auto',block:'start'})`); await wait(500);
await shot('p72_05_设计中心结果_中文');
await lang('en-US');
await evalJs(`document.querySelector('#dc_results')?.scrollIntoView({behavior:'auto',block:'start'})`); await wait(500);
await shot('p72_06_设计中心结果_English');
await evalJs(`document.querySelector('#dc_panel')?.scrollIntoView({behavior:'auto',block:'start'})`); await wait(400);
await shot('p72_07_设计中心参数区_English（来源徽章英文）');
await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(600);
await evalJs(`document.querySelector('#dc_resultActive')?.scrollIntoView({behavior:'auto',block:'start'})`); await wait(400);
await shot('p72_08_设计中心_浇注系统页_English');

ws.close(); edge.kill(); server?.kill();
process.exit(0);
