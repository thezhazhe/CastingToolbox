// ============================================================
// PHASE V2.0-15（126.txt §四.4 / §五）· 未收敛披露的**真实浏览器**验收
//
//   为什么还要浏览器验收：Node 侧的渲染测试喂的是构造好的结果对象，
//   证不了"用户真的能在页面上看到"。本脚本**从真实输入出发**（Type 到输入框里），
//   走真实 `runRiser`，再读真实 DOM。
//
//   用例来源：V2.0-14 §4.2 已证 `cw=77.56kg + 小 Mc` **必然撞 f 上限**（100% 体积不过）。
//
//   用法: node scripts/browser_v2015_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9236;                      // 与其它脚本错开，避免端口打架
const URL = 'http://localhost:8090/';
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

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${process.cwd()}/_edge_v2015`, 'about:blank'], { stdio: 'ignore' });

let ws = null, failures = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };

try {
  await waitForServer();
  ws = new WebSocket(await getWsUrl());
  let id = 0; const pending = new Map(); const exceptions = [];
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
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable');

  await send('Page.navigate', { url: URL });
  await wait(500);
  await send('Runtime.evaluate', { expression: `localStorage.clear()` });
  await send('Page.reload', {});
  await wait(900);

  /** 在页面里求值并取回字符串 */
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };

  /* ---------------- 1. 独立冒口计算器：未收敛 ---------------- */
  console.log('\n【1】独立冒口计算器 #/calculators/riser —— 真实输入 → 未收敛');
  await ev(`location.hash = '#/calculators/riser'`);
  await wait(500);

  // 真实输入：铸件净重 77.56kg（现有夹具重量）+ Mc 5mm ⇒ 必然撞 f 上限（V2.0-14 §4.2）
  const setInputs = (wt, mc) => ev(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); if (!el) return false;
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); return true; };
    const a = set('#r_cast_wt', ${wt}); const b = set('#r_mc', ${mc});
    return JSON.stringify({ cast_wt: a, mc: b });
  })()`);
  const setOk = JSON.parse(await setInputs(77.56, 5));
  check('输入框可写入（#r_cast_wt / #r_mc）', setOk.cast_wt && setOk.mc, JSON.stringify(setOk));
  await wait(600);   // 等 debounce(180ms) + 渲染

  const probe = () => ev(`(() => {
    const g = (sel) => { const el = document.querySelector(sel); return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null; };
    return JSON.stringify({ results: g('#r_results'), judge: g('#r_judge') });
  })()`);

  let p = JSON.parse(await probe());
  check('结果区已渲染 #r_results', !!p.results && p.results.length > 50, (p.results || '').slice(0, 60));
  check('★ 结果区出现「未收敛」', (p.results || '').includes('未收敛'));
  check('★ 结果区说明「模数校核通过」', (p.results || '').includes('模数校核通过'));
  check('★ 结果区说明「体积校核未通过」', (p.results || '').includes('体积校核未通过'));
  check('★ 结果区点明「不能当作已通过全部约束的设计结果」', (p.results || '').includes('不能当作已通过全部约束的设计结果'));
  check('★ 标题不再称「自动迭代最优解」', !(p.results || '').includes('自动迭代最优解'),
    (p.results || '').includes('计算所得冒口（未收敛，非最终建议）') ? '已改为「计算所得冒口（未收敛，非最终建议）」' : '');
  check('★ 判定区出现「未收敛」徽标', (p.judge || '').includes('未收敛'));
  check('判定区不再称「推荐：」', !(p.judge || '').includes('推荐：'));
  check('措辞不外推（无「缩孔」）', !(p.results || '').includes('缩孔'));

  /* 导出报告（独立计算器自己的 HTML）—— 按钮 id = #r_reportBtn（源码 riserView.js:317） */
  const rep = await ev(`(() => {
    const b = document.querySelector('#r_reportBtn');
    if (!b) return 'NO_BUTTON';
    b.click();
    return 'CLICKED';
  })()`);
  await wait(500);
  const repBody = await ev(`(() => { const el = document.querySelector('#r_reportBody'); return el ? (el.textContent||'').replace(/\\s+/g,' ').trim() : 'NO_BODY'; })()`);
  check('独立计算器导出入口存在并可点击', rep === 'CLICKED', rep);
  if (rep === 'CLICKED') {
    check('★ 独立计算器导出报告含「未收敛」', (repBody || '').includes('未收敛'), (repBody || '').slice(0, 80));
    check('★ 独立计算器导出报告说明未通过的约束', (repBody || '').includes('体积校核未通过'));
  }

  /* ---------------- 2. 反例：收敛解不得被标未收敛 ---------------- */
  console.log('\n【2】反例：收敛解（Mc 30 / 77.56kg）不得被标未收敛');
  await setInputs(77.56, 30);
  await wait(600);
  p = JSON.parse(await probe());
  check('★ 收敛解不出现「未收敛」', !(p.results || '').includes('未收敛'), (p.results || '').includes('自动迭代最优解') ? '标题仍为「自动迭代最优解」' : '');
  check('收敛解判定区无「未收敛」徽标', !(p.judge || '').includes('未收敛'));
  check('收敛解判定区仍称「推荐：」', (p.judge || '').includes('推荐：'));

  /* ---------------- 3. 无冒口结果（Mc=0）不得显示为成功 ---------------- */
  console.log('\n【3】无效输入（Mc=0）不得显示为成功结果');
  await setInputs(77.56, 0);
  await wait(600);
  p = JSON.parse(await probe());
  check('★ Mc=0 不出「未收敛」警告（提示的是输入无效）', !(p.results || '').includes('未收敛'), (p.results || '').slice(0, 50));
  // Mc=0 由输入校验拦下（numcheck → renderInvalid），给的是具体原因，而不是冒充"未收敛"
  check('★ Mc=0 给出输入无效提示（含"Mc 需大于 0"）',
    /Mc\s*需大于\s*0/.test(p.results || '') || /Mc\s*需大于\s*0/.test(p.judge || ''),
    ((p.results || '').slice(0, 40)));
  check('★ Mc=0 不显示任何冒口尺寸（不冒充成功结果）', !/⌀\s*\d+/.test(p.results || ''), (p.results || '').slice(0, 60));

  /* ---------------- 4. 全站无 JS 异常 ---------------- */
  console.log('\n【4】运行时异常');
  check('无 JS 异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

} catch (e) {
  console.log('  ✗ 脚本异常：' + e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
}

console.log(`\nPHASE V2.0-15 浏览器验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
process.exit(failures ? 1 : 0);
