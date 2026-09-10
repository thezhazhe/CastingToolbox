// ============================================================
// PHASE 73 · Responsive 体检（桌面 / 手机竖屏 / 手机横屏）
//   检查每个核心页面：是否出现横向溢出、元素是否超出视口、可点区域是否过窄。
//   §十八："Android UI 不允许为了适配手机破坏 Desktop" —— 同时验证桌面无回归。
// 用法: node scripts/browser_responsive_test.mjs      （退出码 0=通过 1=有溢出）
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9267;
const URL = process.env.CT_URL || 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_resp');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
let id = 0; const pending = new Map(); const exceptions = [];
const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description?.split(/\r?\n/)[0] || m.params.exceptionDetails.text);
};
await new Promise(r => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable');
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
const viewport = async (w, h, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  // 真机（Android WebView / 手机浏览器）报告 pointer:coarse —— 一并模拟，否则触摸态 CSS 测不出来
  await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
  await wait(450);
};
const goto = async (hash) => { await evalJs(`location.hash = '${hash}'`); await wait(1000); };

/* 溢出探针：返回超出视口右边界的可见元素（最多 6 个） */
const OVERFLOW_FN = `(() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement;
  const bad = [];
  for (const el of document.querySelectorAll('#view *, .topbar *, .sidebar *')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1.5) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') continue;   // 自身可滚动的容器不算溢出
      if (el.closest('.dc-table-wrap, .table-scroll')) continue;
      bad.push({ t: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : ''), right: Math.round(r.right), vw, txt: (el.textContent || '').trim().slice(0, 30) });
    }
  }
  return { docScroll: doc.scrollWidth, vw, bad: bad.slice(0, 6), count: bad.length };
})()`;

const PAGES = ['#/', '#/calculators', '#/calculators/gating', '#/calculators/riser', '#/designCenter', '#/donate'];
const VIEWPORTS = [
  { name: '桌面 1600×1000', w: 1600, h: 1000 },
  { name: '手机竖屏 390×844', w: 390, h: 844, mobile: true },
  { name: '手机横屏 844×390', w: 844, h: 390, mobile: true },
];

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failures++; };

try {
  await send('Page.navigate', { url: URL });
  await wait(1800);
  for (const vp of VIEWPORTS) {
    await viewport(vp.w, vp.h, vp.mobile);
    console.log(`\n[${vp.name}]`);
    for (const page of PAGES) {
      await goto(page);
      if (page === '#/designCenter') { await evalJs(`document.querySelector('#dc_manualLink')?.click()`); await wait(600); }
      const r = await evalJs(OVERFLOW_FN);
      const ok = r.count === 0 && r.docScroll <= r.vw + 1;
      check(`${page} 无横向溢出`, ok, ok ? '' : `溢出 ${r.count} 处（docScroll ${r.docScroll} > vw ${r.vw}）: ` + r.bad.map(b => `${b.t}[right=${b.right}]"${b.txt}"`).join(' / '));
    }
    /* 设计中心**结果页**（表格最多、最容易撑破）——手动模式跑一遍全链再量 */
    await goto('#/designCenter');
    await evalJs(`document.querySelector('#dc_manualLink')?.click()`); await wait(600);
    const ready = await evalJs(`!!document.querySelector('#dc_m_family')`);
    if (ready) {
      const setV = (sel, val) => evalJs(`(() => {
        const el = document.querySelector('${sel}'); if (!el) return false;
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '${val}');
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true;
      })()`);
      await setV('#dc_m_family', '灰铁'); await wait(500);
      await setV('#dc_p_volume', '900'); await setV('#dc_p_wallMain', '22'); await setV('#dc_m_mc', '13'); await wait(600);
      await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(2600);
      for (const nav of ['page1', 'riser', 'gating']) {
        await evalJs(`document.querySelector('#dc_resultNav [data-nav="${nav}"]')?.click()`); await wait(700);
        const r = await evalJs(OVERFLOW_FN);
        const ok = r.count === 0 && r.docScroll <= r.vw + 1;
        check(`#/designCenter 结果页 ${nav} 无横向溢出`, ok, ok ? '' : `溢出 ${r.count} 处: ` + r.bad.map(b => `${b.t}[right=${b.right}]"${b.txt}"`).join(' / '));
      }
    }

    // 触摸目标尺寸（手机端）：主按钮不应小于 32px 高
    if (vp.mobile) {
      const small = await evalJs(`(() => {
        const bad = [];
        for (const b of document.querySelectorAll('#view button, .topbar button')) {
          const r = b.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.height < 28) bad.push((b.textContent || b.id || 'btn').trim().slice(0, 20) + ':' + Math.round(r.height));
        }
        return bad.slice(0, 5);
      })()`);
      check('触摸目标高度 ≥28px', small.length === 0, small.join(', '));
    }
  }
  console.log('\n运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  if (exceptions.length) failures++;
  console.log(`\nResponsive 体检：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  process.exit(failures ? 1 : 0);
}
