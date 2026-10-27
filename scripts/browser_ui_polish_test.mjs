// ============================================================
// 168.txt UI POLISH · 首页信息 / 三维按需加载 / 支持页
// 用法: node scripts/browser_ui_polish_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';
import { VERSION_LABEL } from '../js/version.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9281;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_ui_polish');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } }
  } catch (e) {}
  await wait(200);
}
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
let ws = null;
try {
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const netOk = new Set();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
    if (msg.method === 'Network.responseReceived') {
      const res = msg.params.response;
      if (res && res.status > 0 && res.status < 400) netOk.add(res.url);
    }
  };
  await new Promise(r => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Network.enable');
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      console.log('  [eval]', r.exceptionDetails.text, r.exceptionDetails.exception?.description || '');
      return undefined;
    }
    return r.result.value;
  };
  const poll = async (expr, timeout = 30000, step = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const viewport = async (w, h, mobile = false) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await wait(250);
  };

  await send('Page.navigate', { url: URL });
  await viewport(1366, 900);
  await wait(1300);

  const home = await evalJs(`(() => {
    const sf = document.querySelector('.sidebar-foot');
    const lines = [...document.querySelectorAll('.sidebar-foot .sf-line')];
    const links = [...document.querySelectorAll('.sidebar-foot a')].map(a => a.getAttribute('href'));
    const styles = lines.map(x => { const s = getComputedStyle(x); return [s.fontSize, s.fontWeight]; });
    return {
      version: document.querySelector('#appVersion')?.textContent || '',
      groups: document.querySelectorAll('.sidebar-foot .sf-group').length,
      groupTitles: [...document.querySelectorAll('.sidebar-foot .sf-group-title')].map(x => x.textContent.trim()),
      links, note: document.querySelector('.sidebar-foot .sf-note')?.textContent || '',
      text: sf?.textContent || '',
      overflow: sf ? sf.scrollWidth > sf.clientWidth + 1 : false,
      consistent: styles.length > 0 && styles.every(x => x[0] === styles[0][0] && x[1] === styles[0][1]),
    };
  })()`);
  const netThree = () => [...netOk].filter(u => /vendor\/(three|mesh-bvh)\.module\.js|modelView3D/.test(u)).length;
  home.threeLoaded = netThree();
  console.log('\n【A 首页信息区 / B 首屏资源】');
  check(`首页侧栏显示正式版本 ${VERSION_LABEL}`, home.version === VERSION_LABEL, home.version);
  check('信息分为产品下载 / 作者联系 / 社区 / 开源四组（中文文案已翻译）',
    home.groups === 4 && home.groupTitles.join('|') === '产品与下载|作者与联系|社区|开源声明',
    JSON.stringify(home.groupTitles));
  check('产品区仅保留在线 / GitHub / Releases 三个入口，邮箱仍可点击',
    home.links.some(x => x === 'https://thezhazhe.github.io/CastingToolbox/')
    && home.links.some(x => x === 'https://github.com/thezhazhe/CastingToolbox')
    && home.links.some(x => x === 'https://github.com/thezhazhe/CastingToolbox/releases')
    && home.links.some(x => x === 'mailto:320451242@QQ.COM')
    && home.links.some(x => x === 'mailto:THEZHAZHE@gmail.com'), JSON.stringify(home.links));
  check('首页侧栏不再直接展示国内网盘地址或提取码',
    !/lanzouu|5432/.test(home.text) && !home.links.some(x => /lanzouu/.test(x || '')), JSON.stringify(home.links));
  check('社区说明包含更新动态 / 国内下载方式 / 使用帮助',
    /更新动态/.test(home.note) && /国内下载方式/.test(home.note) && /使用帮助/.test(home.note), home.note);
  check('信息项字号/字重统一，侧栏无横向溢出', home.consistent && !home.overflow, JSON.stringify(home));
  check('首页首次加载不请求 Three.js / 三维组件', home.threeLoaded === 0, String(home.threeLoaded));

  await evalJs(`document.querySelector('[data-lang="en-US"]')?.click()`); await wait(650);
  const enHome = await evalJs(`(() => ({
    groups: [...document.querySelectorAll('.sidebar-foot .sf-group-title')].map(x => x.textContent.trim()),
    note: document.querySelector('.sidebar-foot .sf-note')?.textContent || '',
    text: document.querySelector('.sidebar-foot')?.textContent || '',
  }))()`);
  check('英文界面同步：分组标题与社区说明为英文，网盘/提取码不出现',
    enHome.groups.join('|') === 'Product & downloads|Author & contact|Community|Open source'
    && /product updates/i.test(enHome.note) && /China download/i.test(enHome.note) && /usage help/i.test(enHome.note)
    && !/lanzouu|5432/.test(enHome.text), JSON.stringify(enHome));
  await evalJs(`document.querySelector('[data-lang="zh-CN"]')?.click()`); await wait(450);

  await send('Network.setBlockedURLs', { urls: ['*vendor/three.module.js*', '*vendor/mesh-bvh.module.js*'] });
  await evalJs(`location.hash = '#/designCenter'`);
  const failed = await poll(`document.querySelector('[data-lazy-state="error"]') ? 1 : 0`, 20000, 400);
  const errUi = await evalJs(`(() => { const e = document.querySelector('[data-lazy-state="error"]');
    return e ? { title: e.textContent.includes('三维模块加载失败'), retry: !!e.querySelector('[data-lazy-retry]'),
      hasPercent: /\\d+\\s*%/.test(e.textContent) } : null; })()`);
  check('三维资源首次加载失败：显示明确错误和重试入口，不伪造百分比',
    !!failed && errUi && errUi.title && errUi.retry && !errUi.hasPercent, JSON.stringify(errUi));

  await send('Network.setBlockedURLs', { urls: [] });
  await evalJs(`document.querySelector('[data-lazy-retry]')?.click()`);
  const success = await poll(`document.querySelector('#dc_importZone') || document.querySelector('#dc_ws') ? 1 : 0`, 30000, 500);
  const afterLoad = await evalJs(`(() => ({
    error: !!document.querySelector('[data-lazy-state="error"]'),
    loading: !!document.querySelector('[data-lazy-state="loading"]'),
  }))()`);
  const threeAfterLoad = netThree();
  check('解除阻断后重试成功进入设计中心', !!success && !afterLoad.error, JSON.stringify(afterLoad));
  check('重试成功后 Three.js 真正响应加载且无残留错误层', threeAfterLoad >= 1 && !afterLoad.loading,
    JSON.stringify({ ...afterLoad, three: threeAfterLoad }));

  const beforeThree = threeAfterLoad;
  await evalJs(`location.hash = '#/home'`); await wait(500);
  await evalJs(`location.hash = '#/designCenter'`);
  const reuse = await poll(`document.querySelector('#dc_importZone') || document.querySelector('#dc_ws') ? 1 : 0`, 10000, 300);
  const afterReuse = await evalJs(`(() => ({
    error: !!document.querySelector('[data-lazy-state="error"]'),
    loading: !!document.querySelector('[data-lazy-state="loading"]'),
  }))()`);
  const threeAfterReuse = netThree();
  check('重复进入设计中心复用已加载模块，不重复下载/不重复初始化错误',
    !!reuse && !afterReuse.error && !afterReuse.loading && threeAfterReuse === beforeThree,
    JSON.stringify({ beforeThree, afterReuse, threeAfterReuse }));

  await evalJs(`location.hash = '#/inspection'`);
  const inspectOk = await poll(`document.querySelector('.pi-ws') ? 1 : 0`, 20000, 400);
  const inspectState = await evalJs(`(() => ({
    title: document.querySelector('.page-title')?.textContent || '',
    error: !!document.querySelector('[data-lazy-state="error"]'),
    loading: !!document.querySelector('[data-lazy-state="loading"]'),
  }))()`);
  check('工艺检测中心同样按需加载并正常渲染', !!inspectOk && !inspectState.error
    && !inspectState.loading && /工艺检测中心/.test(inspectState.title), JSON.stringify(inspectState));

  await evalJs(`location.hash = '#/donate'`); await wait(500);
  const donate = await evalJs(`(() => { const p = document.querySelector('.donate-page'); return {
    ad: p?.textContent.includes('一个重要说明') || false,
    disclaimer: p?.textContent.includes('关于支持者名单') || false,
    cards: document.querySelectorAll('.donate-page .sr-card').length }; })()`);
  console.log('\n【C 支持与资源】');
  check('“一个重要说明”整段已移除，支持者说明/页面内容保留',
    !donate.ad && donate.disclaimer && donate.cards >= 3, JSON.stringify(donate));

  await evalJs(`location.hash = '#/home'`); await wait(600);
  await viewport(390, 844, true); await wait(400);
  const mobile = await evalJs(`(() => { const e = document.querySelector('.home-siteinfo');
    return e ? { display: getComputedStyle(e).display, groups: e.querySelectorAll('.sf-group').length,
      links: e.querySelectorAll('a').length, text: e.textContent || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 } : null; })()`);
  console.log('\n【A 手机】');
  check('390px 首页提供同一份分组信息，且不含网盘地址/提取码、无横向溢出',
    !!mobile && mobile.display !== 'none' && mobile.groups === 4 && mobile.links >= 5
    && /国内下载方式/.test(mobile.text) && !/lanzouu|5432/.test(mobile.text) && !mobile.overflow,
    JSON.stringify(mobile));

  console.log('\nUI POLISH 验收：' + (failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'));
} catch (e) {
  failures++; console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
}
