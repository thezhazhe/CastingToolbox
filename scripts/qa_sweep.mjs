// ============================================================
// 全面测试 · 浏览器巡检（headless Edge）
// 覆盖：7 计算工具 · 6 知识主题 · 全部 135 条详情 · 搜索语料 · 向导全流程 · 弹窗
// 全程收集：JS 运行时异常 + 网络加载失败
// 用法: node scripts/qa_sweep.mjs
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALCULATORS } from '../calcs/registry.js';
import { TAXONOMY } from '../data/taxonomy.js';
import { DATA_INDEX } from '../data/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9237;
const URL = 'http://localhost:8090/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

let server = null;
try { await fetch(URL); } catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_qa_profile`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
try {
  // 等服务器
  for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch {} await wait(250); }
  // 等 Edge CDP（冷启动稍慢）
  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    let r; try { r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); } catch { await wait(200); continue; }
    const list = await r.json();
    const p = list.find(t => t.type === 'page');
    if (p) { wsUrl = p.webSocketDebuggerUrl; break; }
    await wait(200);
  }
  if (!wsUrl) throw new Error('Edge CDP 未就绪');
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const exceptions = []; const failedLoads = [];
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && d.exception.description) || d.text || JSON.stringify(d));
    }
    else if (m.method === 'Network.loadingFailed') {
      const f = m.params; failedLoads.push(`${f.errorText || 'ERR'} ${f.type || ''}`);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');

  async function evalJ(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result.value;
  }
  // 轮询直到表达式为真（防渲染时序）
  async function waitFor(expr, timeout = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await evalJ(expr);
      if (v) return true;
      await wait(120);
    }
    return false;
  }

  // 准备：落到应用源 → 解锁开发者模式 → 清生产场景
  await send('Page.navigate', { url: URL });
  await wait(1500);
  await evalJ(`localStorage.setItem('ct-dev','1'); localStorage.removeItem('ct-context')`);
  await send('Page.reload', {});
  await wait(1500);

  // ---- 1. 首页 ----
  await waitFor(`!!document.getElementById('homeSearch')`);
  const homeCards = await evalJ(`document.querySelectorAll('.tool-card').length`);
  check('首页渲染（常用工具卡）', homeCards === 13, String(homeCards));

  // ---- 1b. 生产场景：5 材质族逐一验证参数速查卡 ----
  const SC_FAM = { 灰铁: 'HT200', 球铁: 'QT450', 铸钢: 'ZG270-500', 铝合金: 'ZL101', 铜合金: 'ZCuSn10Pb1' };
  console.log('\n[场景速查 ×' + Object.keys(SC_FAM).length + ']');
  for (const [fam, grade] of Object.entries(SC_FAM)) {
    await evalJ(`localStorage.setItem('ct-context', JSON.stringify({material:${JSON.stringify(fam)}}))`);
    await send('Page.reload', {});   // 强制重载：context 模块在模块加载时读 localStorage
    const ok = await waitFor(`(function(){ var b = document.body.innerHTML; return b.indexOf('参数速查') >= 0 && b.indexOf(${JSON.stringify(grade)}) >= 0 && b.indexOf('已匹配') >= 0; })()`, 5000);
    check('场景 ' + fam + '（' + grade + '）速查卡', ok);
  }
  await evalJ(`localStorage.removeItem('ct-context')`);

  // ---- 2. 全部 7 个计算工具 ----
  console.log('\n[计算工具 ×' + CALCULATORS.length + ']');
  for (const c of CALCULATORS) {
    if (c.status !== 'ready') continue;
    await send('Page.navigate', { url: URL + '#/calculators/' + c.id });
    const ok = await waitFor(`(()=>{ var t = document.querySelector('.page-title'); return t && t.textContent.trim() === ${JSON.stringify(c.name)}; })()`);
    check(c.name, ok, '#/calculators/' + c.id);
  }

  // ---- 3. 6 个知识主题（开发者树） ----
  console.log('\n[知识主题 ×' + TAXONOMY.length + ']');
  for (const t of TAXONOMY) {
    await send('Page.navigate', { url: URL + '#/knowledge/' + t.id });
    const ok = await waitFor(`document.querySelectorAll('.kb-theme').length > 0`);
    check(t.name, ok, t.id);
  }

  // ---- 4. 全部 135 条详情（工艺卡片） ----
  const docs = [];
  for (const [cat, files] of Object.entries(DATA_INDEX)) {
    for (const f of files) {
      try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', cat, f), 'utf8')); docs.push({ id: j.id, title: j.title }); }
      catch (e) { check(`读取 ${cat}/${f}`, false, e.message); }
    }
  }
  console.log('\n[全部详情 ×' + docs.length + ']');
  let detailFail = 0;
  for (const d of docs) {
    await send('Page.navigate', { url: URL + '#/search/' + encodeURIComponent(d.id) });
    const ok = await waitFor(`(()=>{ var t = document.querySelector('.page-title'); return t && t.textContent.indexOf(${JSON.stringify(d.title)}) >= 0; })()`, 3000);
    if (!ok) { detailFail++; check('详情: ' + d.id, false, d.title); }
  }
  check('全部详情渲染成功', detailFail === 0, `${docs.length - detailFail}/${docs.length}`);

  // ---- 5. 搜索语料 ----
  const QUERIES = ['缩松', 'QT450', '浇注温度', '冒口', '垂直线', '3D打印', '球化剂', '涂料', '加工余量', '出品率', '熔炼配料', 'GB/T 6414', '线收缩', '树脂', '缩孔'];
  console.log('\n[搜索 ×' + QUERIES.length + ']');
  for (const q of QUERIES) {
    await send('Page.navigate', { url: URL });
    await wait(800);
    await evalJ(`document.getElementById('globalSearch').value=${JSON.stringify(q)}; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`);
    const ok = await waitFor(`document.body.innerHTML.indexOf('搜索结果') >= 0`);
    const groups = await evalJ(`document.querySelectorAll('.group-title').length`);
    check('搜「' + q + '」', ok && groups > 0, `分组 ${groups}`);
  }

  // ---- 6. 向导全流程 ----
  console.log('\n[工艺向导]');
  await send('Page.navigate', { url: URL + '#/wizard' });
  await waitFor(`!!document.getElementById('wzStart')`);
  await evalJ(`document.getElementById('wzStart').click()`);
  await waitFor(`document.body.innerHTML.indexOf('第 1 / 6 步') >= 0`);
  await evalJ(`document.querySelector('[data-mat="QT450"]').click()`);
  await wait(500);
  for (let i = 0; i < 5; i++) { await evalJ(`document.getElementById('wzNext').click()`); await wait(400); }
  const wizOk = await waitFor(`document.body.innerHTML.indexOf('冒口建议') >= 0`);
  check('向导走到报告步', wizOk);

  // ---- 7. 弹窗回归 ----
  console.log('\n[弹窗]');
  await send('Page.navigate', { url: URL + '#/calculators/gating' });
  await waitFor(`!!document.getElementById('g_reportBtn')`);
  const gatingModalHidden0 = await evalJ(`document.getElementById('g_modal').hidden`);
  await evalJ(`document.getElementById('g_reportBtn').click()`);
  await wait(300);
  const gatingModalOpen = await evalJ(`!document.getElementById('g_modal').hidden`);
  await evalJ(`document.getElementById('g_modal').querySelector('[data-close]').click()`);
  await wait(200);
  const gatingModalClosed = await evalJ(`document.getElementById('g_modal').hidden`);
  check('浇注报告弹窗默认隐藏/可开/可关', gatingModalHidden0 && gatingModalOpen && gatingModalClosed);

  // 捐助弹窗
  await send('Page.navigate', { url: URL });
  await wait(1000);
  await evalJ(`document.getElementById('btnDonate').click()`);
  await wait(400);
  const donateOpen = await evalJ(`!document.getElementById('donateModal').hidden`);
  await evalJ(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  await wait(200);
  const donateClosed = await evalJ(`document.getElementById('donateModal').hidden`);
  check('捐助弹窗可开/可关', donateOpen && donateClosed);

  // ---- 汇总 ----
  console.log('');
  check('无 JS 运行时异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
  check('无网络加载失败', failedLoads.length === 0, failedLoads.slice(0, 5).join(' | '));
  console.log('\n结果: ' + (failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'));
} catch (e) {
  console.error('巡检失败:', e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch {}
  try { edge.kill(); } catch {}
  try { server && server.kill(); } catch {}
  process.exit(failures === 0 ? 0 : 1);
}
