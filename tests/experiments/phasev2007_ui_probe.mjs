// ============================================================
// PHASE V2.0-07 只读诊断探针（不改任何生产代码）
// 目的：在**真实浏览器**里量「工艺设计中心 → ② 冒口设计」结果卡的两件事：
//   ① 默认路径（未勾选热结）的等级 / 提示 / 尺寸
//   ② 勾选热结（不改 Mc 值）后的等级 / 提示 / 尺寸
// 场景用「重件」（直径由体积校核主导），以便同时暴露 level 与尺寸的联动关系。
// 用法: node tests/experiments/phasev2007_ui_probe.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9277;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_pv2007');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--window-size=1280,900', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const l = await r.json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } } catch (e) {}
  await wait(200);
}
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
await new Promise(r => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const poll = async (expr, timeoutMs = 30000, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
  return null;
};

const out = [];
const say = (s) => { out.push(s); console.log(s); };

/* 切到结果页的「② 冒口设计」子页，再抓该卡关键文本 */
const GOTO_RISER_PAGE = `(() => {
  const b = [...document.querySelectorAll('#dc_resultNav [data-nav]')]
    .find(x => (x.textContent || '').includes('冒口设计'));
  if (b) { b.click(); return 'clicked:' + b.dataset.nav; }
  return 'nav-not-found:' + [...document.querySelectorAll('#dc_resultNav [data-nav]')].map(x => x.dataset.nav).join(',');
})()`;

const READ_RISER = `(() => {
  const sec = [...document.querySelectorAll('#dc_resultActive .dc-result-sec')]
    .find(s => (s.querySelector('.dc-sec-title')?.textContent || '').includes('冒口设计'));
  if (!sec) {
    return JSON.stringify({ found: false, head: (document.querySelector('#dc_resultActive')?.innerText || '').replace(/\\s+/g,' ').slice(0,160) });
  }
  const chip = (sec.querySelector('.dc-sec-title .chip')?.textContent || '').trim();
  const srcLine = (sec.querySelector('.dc-hint-line')?.textContent || '').trim();
  const note = [...sec.querySelectorAll('.field-hint')].map(e => (e.textContent || '').trim()).join(' || ');
  const txt = (sec.innerText || '').replace(/\\s+/g, ' ');
  return JSON.stringify({ found: true, chip, srcLine, note: note.slice(0, 200), txt: txt.slice(0, 460) });
})()`;

try {
  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1800);
  say('进入设计中心: ' + (await evalJs(`document.querySelector('#view .page-title')?.textContent || ''`)));

  // 导入 cube50（真实 STL 路径）
  const doc = await send('DOM.getDocument', { depth: 1 });
  const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, 'tests', 'golden', 'cube50.stl').replace(/\\/g, '/')] });
  await poll(`document.querySelector('#dc_hsBadge')?.textContent || ''`, 60000, 800);
  say('STL 导入完成');

  // 播撒受控热结（重件：直径由体积校核主导）—— 与 browser_p78_test 同法
  await evalJs(`(async () => {
    const p = await import('/js/model/CastingProject.js');
    p.set('hotspots.status', 'ok', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
    p.set('hotspots.items', [
      { id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 },
      { id: 2, x: 20, y: 8, z: 4, mc: 12, regionVolumeCm3: 25 },
    ], p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
    p.set('process.mcHotspot', 14, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
    p.set('material.family', '球铁', p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
    p.set('material.solidDensity', 7.1, p.SRC.SCENARIO, p.CONF.MEDIUM);
    p.set('geometry.geomStatus', 'VALID', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
    p.set('geometry.blankWeightKg', 77.56, p.SRC.USER_OVERRIDE, p.CONF.USER_CONFIRMED);
    p.set('geometry.netWeightKg', 77.56, p.SRC.USER_OVERRIDE, p.CONF.USER_CONFIRMED);   // USER_OVERRIDE：refreshWeight 不得覆盖
    p.set('process.wallHot', 8, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
    p.set('process.riserShape', 'cyl', p.SRC.DEFAULT, p.CONF.LOW);
    p.set('process.ph', 200, p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
    p.set('process.Ho', 250, p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
    return true;
  })()`);

  // 触发参数区重渲染 → 热结勾选列表按播撒后的项目状态重建（同 browser_p78_test 的做法）
  await evalJs(`(() => { const el = document.querySelector('#dc_m_family');
    if (!el) return 'no-family-sel';
    const proto = HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '球铁');
    el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok'; })()`);
  await wait(1500);
  say('热结勾选框数量: ' + (await evalJs(`document.querySelectorAll('[data-hs-pick]').length`)));
  say('净重(kg): ' + (await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('geometry.netWeightKg'); })()`)));
  say('材料: ' + (await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('material.family'); })()`)));

  // 场景 ①：默认路径（未勾选任何热结）
  await evalJs(`document.querySelector('#dc_run').click()`);
  await poll(`document.querySelector('#dc_resultActive')?.textContent || ''`, 30000);
  await wait(800);
  say('切页: ' + (await evalJs(GOTO_RISER_PAGE)));
  await wait(700);
  const lvl1 = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    const r = (await import('/calcs/calcManifest.js')).getCalcManifest('riser');
    const out = r.calculate(); return JSON.stringify({ level: out?.level, note: (out?.note||'').slice(0,80), D: out?.D, H: out?.H, f: out?.final_f }); })()`);
  say('');
  say('=== 场景 ① 未勾选热结（默认路径） ===');
  say('  calculate(): ' + lvl1);
  say('  卡片: ' + (await evalJs(READ_RISER)));

  // 场景 ②：勾选 H1（不改 Mc 值 —— 点击勾选框直接生效，Mc 取检出值）
  await evalJs(`document.querySelectorAll('[data-hs-pick]')[0].click()`);
  await wait(2000);
  await evalJs(GOTO_RISER_PAGE);
  await wait(700);
  const lvl2 = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    const r = (await import('/calcs/calcManifest.js')).getCalcManifest('riser');
    const out = r.calculate();
    const mc = p.get('process.mcHotspot');
    return JSON.stringify({ mcSrc: mc?.src, level: out?.level, note: (out?.note||'').slice(0,80), D: out?.D, H: out?.H, f: out?.final_f, hsPick: p.getV('process.hsPick') }); })()`);
  say('');
  say('=== 场景 ② 勾选 H1（Mc 仍为检出值 14，未改任何数字） ===');
  say('  calculate(): ' + lvl2);
  say('  卡片: ' + (await evalJs(READ_RISER)));

  // 场景 ③：用「✎ 改 Mc」把 H1 改成 20（06A1 认可的"用户确认"动作）
  await evalJs(`document.querySelectorAll('[data-hs-edit]')[0].click()`);
  await wait(600);
  await evalJs(`(() => { const el = document.querySelector('#dc_hsModal #dc_hsMc'); if (el) el.value = '20'; })()`);
  await evalJs(`document.querySelector('#dc_hsModal [data-hs-ok]')?.click()`);
  await wait(2000);
  await evalJs(GOTO_RISER_PAGE);
  await wait(700);
  const lvl3 = await evalJs(`(async () => {
    const r = (await import('/calcs/calcManifest.js')).getCalcManifest('riser');
    const out = r.calculate(); return JSON.stringify({ level: out?.level, note: (out?.note||'').slice(0,80), D: out?.D, H: out?.H, f: out?.final_f }); })()`);
  say('');
  say('=== 场景 ③ 勾选 H1 + 改 Mc 为 20 ===');
  say('  calculate(): ' + lvl3);
  say('  卡片: ' + (await evalJs(READ_RISER)));
} catch (e) {
  say('!! 探针异常: ' + e.message);
} finally {
  writeFileSync(path.join(ROOT, 'tests', 'experiments', 'out', 'phasev2007_ui_probe.txt'), out.join('\n'), 'utf8');
  try { ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { if (server) server.kill(); } catch (e) {}
  await wait(400);
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
