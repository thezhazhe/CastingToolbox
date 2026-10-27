// ============================================================
// PHASE V2.0-18（129.txt §六 / §七.10~12）· 向导输入校验的**真实浏览器**验收
//
//   为什么必须用浏览器：向导的校验不是"一个函数返回 true/false"，
//   而是 **DOM 事件顺序 + 按钮 disabled + 提示文本** 三者协同的结果：
//     `#wzBody` 的 input 事件 → 各步自己的监听器更新 state → `setTimeout(0)` → revalidate
//   这条链只有在真实 DOM + 真实事件里才成立。Node 侧喂状态证明不了"用户按不动下一步"。
//
//   覆盖（129.txt §六 逐条）：
//     · 负重量不能绕过校验
//     · 非有限数值不能进入计算（Infinity）
//     · 非法参数有明确的用户可见反馈
//     · 合法输入的现有行为不变（正数照常放行）
//     · 校验失败后重新输入合法数据，能正常计算（**状态不被污染**）
//
//   用法: node scripts/browser_v2018_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9242;                      // 与其它脚本错开，避免端口打架
const URL = 'http://localhost:8090/#/wizard';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch('http://localhost:8090/'); if (r.ok) return; } catch (e) {}
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
try { const r = await fetch('http://localhost:8090/'); if (!r.ok) throw new Error('not 200'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${process.cwd()}/_edge_v2018`, 'about:blank'], { stdio: 'ignore' });

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
  await wait(600);
  await send('Runtime.evaluate', { expression: `localStorage.clear()` });
  await send('Page.reload', {});
  await wait(1200);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };

  /** 在页面里：取值 / 设值（派发 input+change，模仿真实输入） / 读下一步按钮状态 */
  await ev(`window.__t = {
    set(sel, v) { const el = document.querySelector(sel); if (!el) return 'NO_EL:' + sel;
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK'; },
    next() { const b = document.querySelector('#wzNext'); if (!b) return 'NO_BTN';
      return JSON.stringify({ disabled: !!b.disabled, text: (b.textContent || '').trim() }); },
    hint() { const h = document.querySelector('#wzHint'); return h ? (h.textContent || '').trim() : 'NO_HINT'; },
    clickNext() { const b = document.querySelector('#wzNext'); if (!b) return 'NO_BTN';
      if (b.disabled) return 'BLOCKED'; b.click(); return 'CLICKED'; },
    has(sel) { return !!document.querySelector(sel); }
  }; 'ready'`);

  const nextState = async () => JSON.parse(await ev(`window.__t.next()`));
  const hint = () => ev(`window.__t.hint()`);

  /* ---------------- 0. 进入向导，走到"重量"步 ---------------- */
  // 真实路径：#/wizard → hero 页 → #wzStart → 第1步（选材料：先 .kb-cat 分类，再 .card 牌号）→ 第2步
  console.log('\n【0】进入向导并走到第 2 步（铸件重量）');
  const started = await ev(`(() => { const b = document.querySelector('#wzStart'); if (!b) return 'NO_START'; b.click(); return 'OK'; })()`);
  check('向导首页存在并可开始（#wzStart）', started === 'OK', started);
  await wait(800);

  const catOk = await ev(`(() => { const c = document.querySelectorAll('#wzBody .kb-cat'); if (!c.length) return 'NO_CAT'; c[0].click(); return 'OK'; })()`);
  await wait(600);
  check('材料分类可展开（.kb-cat）', catOk === 'OK', catOk);

  const pickOk = await ev(`(() => { const c = document.querySelector('#wzBody .card'); if (!c) return 'NO_CARD'; c.click(); return 'OK'; })()`);
  await wait(600);
  check('可选材料牌号（.card）', pickOk === 'OK', pickOk);

  const onWeight = await ev(`window.__t.has('#wz_pw')`);
  if (!(onWeight === true || onWeight === 'true')) {
    const r = await ev(`window.__t.clickNext()`); await wait(800);
    if (r === 'BLOCKED') throw new Error('选完材料后"下一步"仍被禁用：' + (await hint()));
  }
  const onWeight2 = await ev(`window.__t.has('#wz_pw')`);
  check('★ 已到"铸件毛重"步（#wz_pw 存在）', onWeight2 === true || onWeight2 === 'true');

  if (onWeight2 !== true && onWeight2 !== 'true') throw new Error('未能到达重量步，后续向导用例无法进行');

  /* ---------------- 1. 负重量不能绕过校验（§六） ---------------- */
  console.log('\n【1】负重量 / 零 / 空：必须拦住"下一步"且给出可见反馈');
  await ev(`window.__t.set('#wz_pw', -5)`); await wait(400);
  let st = await nextState(), h = await hint();
  check('★ 毛重 = -5 ⇒ "下一步"被禁用', st.disabled === true, JSON.stringify(st));
  check('★ 毛重 = -5 ⇒ 有用户可见的反馈文本', h.length > 0, h);

  await ev(`window.__t.set('#wz_pw', 0)`); await wait(300);
  st = await nextState();
  check('毛重 = 0 ⇒ 仍被禁用（不在"合法"里蒙混）', st.disabled === true, JSON.stringify(st));

  await ev(`window.__t.set('#wz_pw', '')`); await wait(300);
  st = await nextState(); h = await hint();
  check('毛重 = 空 ⇒ 被禁用且有提示', st.disabled === true && h.length > 0, h);

  /* ---------------- 2. 非有限数值不能进入计算（§六） ---------------- */
  console.log('\n【2】非有限数值（Infinity）：旧实现能绕过（`Infinity > 0` 为真），现须拦住');
  await ev(`window.__t.set('#wz_pw', 1e999)`); await wait(400);
  st = await nextState(); h = await hint();
  const isInf = await ev(`String(document.querySelector('#wz_pw').value)`);
  check('★ 毛重 = 1e999（⇒ Infinity）⇒ "下一步"被禁用', st.disabled === true,
    `输入框值="${isInf}" · ${JSON.stringify(st)} · 提示："${h}"`);

  /* ---------------- 3. 合法输入行为不变（§六「合法输入的现有行为不变」） ---------------- */
  console.log('\n【3】合法输入：仍应放行（不得误伤）');
  await ev(`window.__t.set('#wz_pw', 12)`); await wait(400);
  st = await nextState(); h = await hint();
  check('★ 毛重 = 12 ⇒ "下一步"恢复可用（**校验失败不污染状态**，§六/§七.11）', st.disabled === false, `${JSON.stringify(st)} · 提示："${h}"`);

  /* ---------------- 4. 真的能走到结果页并出结果（§七.11） ---------------- */
  console.log('\n【4】修好后继续走完向导，能正常出结果');
  const r1 = await ev(`window.__t.clickNext()`); await wait(700);
  check('放行后确实进入第 3 步', r1 === 'CLICKED', r1);
  const onWall = await ev(`window.__t.has('#wz_wall')`);
  check('已到"壁厚 / 热节"步（#wz_wall 存在）', onWall === true || onWall === 'true');

  /* ---------------- 5. 第 3 步：热节模数在 direct 模式下必须被校验（本阶段新增） ---------------- */
  console.log('\n【5】第 3 步"直接输入 Mc"模式：负数必须被拦住（**本阶段新增的校验**）');
  const hasMcMode = await ev(`window.__t.has('#wz_mcMode')`);
  check('#wz_mcMode 存在', hasMcMode === true || hasMcMode === 'true');
  // 默认 wall 模式：只校验壁厚，应放行
  await ev(`window.__t.set('#wz_wall', 20)`); await wait(350);
  st = await nextState();
  check('默认 wall 模式 + 合法壁厚 ⇒ 放行（默认流程行为不变）', st.disabled === false, JSON.stringify(st));
  // 切到 direct
  await ev(`window.__t.set('#wz_mcMode', 'direct')`); await wait(400);
  const hasMc = await ev(`window.__t.has('#wz_mc')`);
  check('切到 direct 后 #wz_mc 出现', hasMc === true || hasMc === 'true');
  await ev(`window.__t.set('#wz_mc', -5)`); await wait(400);
  st = await nextState(); h = await hint();
  check('★ direct 模式下 Mc = -5 ⇒ "下一步"被禁用', st.disabled === true, JSON.stringify(st));
  check('★ direct 模式下 Mc = -5 ⇒ 有用户可见反馈', h.length > 0, h);
  await ev(`window.__t.set('#wz_mc', 10)`); await wait(400);
  st = await nextState();
  check('★ Mc 改回 10 ⇒ 恢复可用（状态不被污染）', st.disabled === false, JSON.stringify(st));

  /* ---------------- 6. 走完并检查结果页 ---------------- */
  console.log('\n【6】走完全流程，结果页应正常渲染');
  let guard = 0;
  while (guard++ < 6) {
    const s = await nextState();
    if (s.disabled) break;
    const r = await ev(`window.__t.clickNext()`);
    await wait(700);
    if (await ev(`window.__t.has('#wzBody')`) !== true && await ev(`window.__t.has('#wzBody')`) !== 'true') break;
    const bodyTxt = await ev(`(() => { const b = document.querySelector('#wzBody'); return b ? (b.textContent||'').slice(0,0) : ''; })()`);
    void bodyTxt;
    if (await ev(`document.body.textContent.includes('工艺方案已生成')`)) break;
  }
  const done = await ev(`document.body.textContent.includes('工艺方案已生成')`);
  check('★ 合法流程能走到结果页（出现"工艺方案已生成"）', done === true || done === 'true');
  const bad = await ev(`document.body.textContent.includes('NaN') || document.body.textContent.includes('Infinity')`);
  check('★ 页面文本中不出现 NaN / Infinity（§五.4「看似有效」的反面）', !(bad === true || bad === 'true'));

  /* ---------------- 7. 无 JS 异常（§七.12） ---------------- */
  console.log('\n【7】运行时异常');
  check('★ 全程无 JS 异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

} catch (e) {
  console.log('  ✗ 脚本异常：' + e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
}

console.log(`\nPHASE V2.0-18 向导校验浏览器验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
process.exit(failures ? 1 : 0);
