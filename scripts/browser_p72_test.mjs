// ============================================================
// PHASE 72（80.txt）· 浏览器验收：中英双语核心 UI
//   A 默认中文（导航/首页/切换器高亮）
//   B 点 English → 外壳 + 首页立即英文（不刷新）
//   C 刷新页面 → 语言选择保持（localStorage castingToolbox.locale）
//   D 计算器（浇注系统）：切语言后 参数不变 / 结果数值不变 / 文案变英文
//   E 设计中心（手动模式）：切语言后 参数与结果不变 / 标签与来源徽章英文
//   F English → 中文 恢复
//   G 非核心工具（冷铁）切语言：整页保持原状（本阶段不翻译其内部）
//   H 切语言不影响项目数据（CastingProject 序列化对照）
// 用法: node scripts/browser_p72_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9257;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_p72');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--window-size=1200,900', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const l = await r.json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } } catch (e) {}
  await wait(200);
}
let failures = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map(); const exceptions = [];
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
};
await new Promise(r => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const setInput = async (sel, val) => evalJs(`(() => {
  const el = document.querySelector('${sel}');
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '${val}');
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
})()`);
const poll = async (expr, timeoutMs = 20000, step = 400) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
  return null;
};
const click = (sel) => evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return false; el.click(); return true; })()`);
const switchLang = async (loc) => { await click(`.lang-btn[data-lang="${loc}"]`); await wait(900); };
const projSnap = () => evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getProject()); })()`);

try {
  await send('Page.navigate', { url: URL });
  await wait(1600);

  /* ---- A 默认中文 ---- */
  const navZh = await evalJs(`[...document.querySelectorAll('#nav .nav-item')].map(e => e.textContent.trim())`);
  check('A 默认中文：侧栏导航为中文', navZh.includes('首页') && navZh.includes('工艺设计中心'), navZh.join(' / '));
  const activeLang = await evalJs(`document.querySelector('.lang-btn.on')?.dataset.lang`);
  check('A 切换器默认高亮「中文」', activeLang === 'zh-CN', String(activeLang));
  check('A html lang = zh-CN', (await evalJs(`document.documentElement.lang`)) === 'zh-CN');
  const homeZh = await evalJs(`document.querySelector('.home-sub')?.textContent || ''`);
  check('A 首页副标题中文', homeZh.includes('铸造工程师'), homeZh.slice(0, 20));

  /* ---- B 切 English 立即生效（不刷新） ---- */
  await switchLang('en-US');
  const navEn = await evalJs(`[...document.querySelectorAll('#nav .nav-item')].map(e => e.textContent.trim())`);
  check('B 导航立即英文（不刷新页面）', navEn.includes('Home') && navEn.includes('Process Design Center') && navEn.includes('Calculators'), navEn.join(' / '));
  const homeEn = await evalJs(`document.querySelector('.home-sub')?.textContent || ''`);
  check('B 首页副标题英文', /Swiss Army knife/.test(homeEn), homeEn.slice(0, 40));
  check('B 搜索占位符英文', /Search materials/.test(await evalJs(`document.querySelector('#homeSearch')?.placeholder || ''`)));
  check('B 切换器高亮 English', (await evalJs(`document.querySelector('.lang-btn.on')?.dataset.lang`)) === 'en-US');
  check('B html lang = en-US', (await evalJs(`document.documentElement.lang`)) === 'en-US');
  check('B 首页工具卡英文（Gating System Design）', /Gating System Design/.test(await evalJs(`document.querySelector('#homeReco')?.textContent || document.body.textContent`)));

  /* ---- C 刷新后保持 ---- */
  await send('Page.reload', {});
  await wait(1800);
  check('C 刷新后仍为英文', (await evalJs(`document.querySelector('.lang-btn.on')?.dataset.lang`)) === 'en-US');
  check('C 刷新后导航仍英文', (await evalJs(`document.querySelector('#nav .nav-item')?.textContent.trim()`)) === 'Home');
  check('C localStorage 已保存 castingToolbox.locale', (await evalJs(`localStorage.getItem('castingToolbox.locale')`)) === 'en-US');

  /* ---- D 计算器：切语言不影响参数与结果（先回到中文再验一遍中文态） ---- */
  await switchLang('zh-CN');
  await evalJs(`location.hash = '#/calculators/gating'`);
  await wait(1200);
  await setInput('#g_pw', '52.5'); await setInput('#g_Ho', '210');
  await wait(800);
  const gZh = await evalJs(`(() => {
    const txt = s => document.querySelector(s)?.textContent.trim();
    return { title: txt('.page-title'), sum: txt('#g_summary'), judge: txt('#g_judge'),
      pw: document.querySelector('#g_pw')?.value, ho: document.querySelector('#g_Ho')?.value,
      t: window.__g ? null : document.querySelector('#g_summary')?.textContent.match(/浇注时间[^\\d]*([\\d.]+)/)?.[1] || null,
      sec2: [...document.querySelectorAll('.section-card-title')].map(e => e.textContent.trim()).join('|') };
  })()`);
  check('D 中文：计算器标题中文', /浇注系统设计/.test(gZh.title), gZh.title);
  check('D 中文：结果区中文', /核心数据/.test(gZh.sum), gZh.sum.slice(0, 30));
  const projBefore = await projSnap();

  await switchLang('en-US');
  const gEn = await evalJs(`(() => {
    const txt = s => document.querySelector(s)?.textContent.trim();
    return { title: txt('.page-title'), sum: txt('#g_summary'), judge: txt('#g_judge'),
      pw: document.querySelector('#g_pw')?.value, ho: document.querySelector('#g_Ho')?.value,
      sec2: [...document.querySelectorAll('.section-card-title')].map(e => e.textContent.trim()).join('|') };
  })()`);
  check('D 英文：标题为 Gating System Design', /Gating System Design/.test(gEn.title), gEn.title);
  check('D 英文：结果区英文（KEY DATA / Pouring time）', /KEY DATA/.test(gEn.sum) && /Pouring time/.test(gEn.sum), gEn.sum.slice(0, 40));
  check('D 英文：判定区英文', /Sound design|Needs work|usable/.test(gEn.judge), gEn.judge.slice(0, 40));
  check('D 参数值不变（pw 52.5 / Ho 210）', gEn.pw === '52.5' && gEn.ho === '210', `${gEn.pw} / ${gEn.ho}`);
  // 只取"真正的数字"（避免把英文句末的句点也算成一个数）
  const numOf = (s) => { const m = String(s).match(/\d+(?:\.\d+)?/g); return m ? m.join(',') : ''; };
  check('D 结果数值不变（切换前后数字序列一致）', numOf(gEn.sum) === numOf(gZh.sum), `${numOf(gZh.sum)} vs ${numOf(gEn.sum)}`);
  check('D 区块标题英文（Basic Parameters / Results / Component Sizes / Verdict）', /Basic Parameters/.test(gEn.sec2) && /Results/.test(gEn.sec2) && /Component Sizes/.test(gEn.sec2) && /Verdict/.test(gEn.sec2), gEn.sec2);
  check('D 切换语言不改项目数据', (await projSnap()) === projBefore);

  /* ---- E 设计中心（手动模式全链；先回中文取中文态） ---- */
  await switchLang('zh-CN');
  await evalJs(`location.hash = '#/designCenter'`);
  await wait(1200);
  await click('#dc_manualLink');
  await wait(600);
  await setInput('#dc_m_family', '灰铁');
  await wait(500);
  await setInput('#dc_p_volume', '900');
  await setInput('#dc_p_wallMain', '22');
  await setInput('#dc_m_mc', '13');
  await wait(700);
  await click('#dc_run');
  await poll(`document.querySelector('#dc_results') && !document.querySelector('#dc_results').hidden`, 15000);
  await wait(1200);
  const dcZh = await evalJs(`(() => {
    const q = s => document.querySelector(s);
    return {
      title: q('.page-title')?.textContent.trim(),
      panel: [...document.querySelectorAll('#dc_params .dc-group-title')].map(e => e.textContent.trim()).join(' | '),
      legend: q('.dc-src-legend')?.textContent.trim(),
      results: q('#dc_results')?.textContent.trim().slice(0, 400),
      all: q('#dc_results')?.textContent.trim() || '',
      vol: q('#dc_p_volume')?.value, wall: q('#dc_p_wallMain')?.value, mc: q('#dc_m_mc')?.value,
      src: [...document.querySelectorAll('.dc-src-badge')].map(e => e.textContent.trim()).slice(0, 3).join(' ; '),
    };
  })()`);
  check('E 中文：设计中心标题中文', /铸造工艺设计中心/.test(dcZh.title), dcZh.title);
  check('E 中文：结果页含中文页签', /铸件结构工艺性|冒口设计/.test(dcZh.results), dcZh.results.slice(0, 40));
  const projBefore2 = await projSnap();

  await switchLang('en-US');
  const dcEn = await evalJs(`(() => {
    const q = s => document.querySelector(s);
    return {
      title: q('.page-title')?.textContent.trim(),
      panel: [...document.querySelectorAll('#dc_params .dc-group-title')].map(e => e.textContent.trim()).join(' | '),
      legend: q('.dc-src-legend')?.textContent.trim(),
      results: q('#dc_results')?.textContent.trim().slice(0, 500),
      all: q('#dc_results')?.textContent.trim() || '',
      vol: q('#dc_p_volume')?.value, wall: q('#dc_p_wallMain')?.value, mc: q('#dc_m_mc')?.value,
      src: [...document.querySelectorAll('.dc-src-badge')].map(e => e.textContent.trim()).slice(0, 3).join(' ; '),
      overview: q('#dc_overview')?.textContent.trim().slice(0, 200) || '',
      hasUndef: /undefined/.test(document.body.textContent),
    };
  })()`);
  check('E 英文：标题 Process Design Center', /Casting Process Design Center/.test(dcEn.title), dcEn.title);
  check('E 英文：参数分组标题英文', /Basic process parameters/.test(dcEn.panel) && /Pouring Parameters/.test(dcEn.panel) && /Riser Parameters/.test(dcEn.panel), dcEn.panel);
  check('E 英文：来源图例英文（STL detection / user override）', /STL detection/.test(dcEn.legend) && /user override/.test(dcEn.legend), dcEn.legend.slice(0, 60));
  check('E 英文：结果页英文（Casting Processability / Riser Design）', /Casting Processability/.test(dcEn.results) && /Riser Design/.test(dcEn.results), dcEn.results.slice(0, 60));
  check('E 英文：来源徽章英文（User Input / Calculated 等）', /User Input|Calculated|User Override|System default/.test(dcEn.src), dcEn.src);
  check('E 参数值不变（体积 900 / 壁厚 22 / Mc 13）', dcEn.vol === '900' && dcEn.wall === '22' && dcEn.mc === '13', `${dcEn.vol} / ${dcEn.wall} / ${dcEn.mc}`);
  check('E 结果数值不变（切换前后数字序列一致）', numOf(dcEn.all) === numOf(dcZh.all), `${numOf(dcZh.all)} vs ${numOf(dcEn.all)}`);
  check('E 切换语言不改项目数据', (await projSnap()) === projBefore2);
  check('E 英文界面无 undefined 泄漏', dcEn.hasUndef === false);

  /* ---- G 非核心工具：切语言不重渲染（保持原状） ---- */
  await switchLang('zh-CN');
  await evalJs(`location.hash = '#/calculators/chill'`);
  await wait(1000);
  await setInput('#ch_T', '45');
  await wait(600);
  const chillZh = await evalJs(`document.querySelector('#sc_results')?.textContent.trim().slice(0,80)`);
  await switchLang('en-US');
  const chillEn = await evalJs(`document.querySelector('#sc_results')?.textContent.trim().slice(0,80)`);
  check('G 冷铁（非核心工具）切语言：内部保持原状（本阶段不翻译）', chillEn === chillZh && chillZh.length > 0, chillEn.slice(0, 40));
  check('G 但外壳已英文', (await evalJs(`document.querySelector('#nav .nav-item')?.textContent.trim()`)) === 'Home');

  /* ---- F 回到中文 ---- */
  await switchLang('zh-CN');
  check('F 恢复中文导航', (await evalJs(`document.querySelector('#nav .nav-item')?.textContent.trim()`)) === '首页');
  check('F 切换器高亮中文', (await evalJs(`document.querySelector('.lang-btn.on')?.dataset.lang`)) === 'zh-CN');
  await evalJs(`location.hash = '#/calculators/gating'`);
  await wait(1000);
  check('F 计算器回到中文标题', /浇注系统设计/.test(await evalJs(`document.querySelector('.page-title')?.textContent || ''`)));
  // 同一访问内来回切换：参数必须原样保留（52.5 是在 D 段该页面上输入的）
  await setInput('#g_pw', '52.5'); await wait(500);
  await switchLang('en-US'); await switchLang('zh-CN');
  check('F 来回切换语言：参数保持 52.5 不丢', (await evalJs(`document.querySelector('#g_pw')?.value`)) === '52.5',
    await evalJs(`document.querySelector('#g_pw')?.value`));
  check('F 来回切换语言：结果区仍为中文', /核心数据/.test(await evalJs(`document.querySelector('#g_summary')?.textContent || ''`)));

  check('无运行时异常', exceptions.length === 0, exceptions.join('; ').slice(0, 200));
  console.log(`\nPHASE 72 浏览器验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++;
  console.error('\n脚本异常：', e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill();
  server?.kill();
  process.exit(failures ? 1 : 0);
}
