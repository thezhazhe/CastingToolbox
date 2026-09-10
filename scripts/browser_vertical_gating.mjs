// ============================================================
// PHASE 70 V1.3 浏览器验收：垂直造型线小件浇注系统计算器
// 用户视角：三系统 / 引入三选(顶入|中入|底入)+C/B / 时间依据二选一(设备|产品) /
// 标注图三张 / 布置示意图白话标注 / 门禁 / 分层增删 / 球铁
// 用法: node scripts/browser_vertical_gating.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9241;
const URL = 'http://localhost:8090/';
const SHOT = 'D:/CDXProject/_disa_tmp/shots';
mkdirSync(SHOT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch (e) { /* noop */ }
    await wait(300);
  }
  throw new Error('server not reachable');
}
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (r.ok) { const list = await r.json(); const p = list.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    } catch (e) { /* noop */ }
    await wait(300);
  }
  throw new Error('CDP not reachable');
}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('no'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); console.log('(serve.js 已启动)'); }
await waitForServer();

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_edge_profile_vg`, 'about:blank'], { stdio: 'ignore' });
const wsUrl = await getWsUrl();
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const exceptions = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id; pending.set(i, { resolve, reject });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') exceptions.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text);
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') exceptions.push(m.params.entry.text);
};
await send('Runtime.enable'); await send('Log.enable');

const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page-exc: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 200));
  return r.result.value;
};
let shotN = 0;
const shot = async (name) => {
  shotN++;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${SHOT}/${String(shotN).padStart(2, '0')}_${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`  📸 ${name}.png`);
};
const nav = async (hash) => { await send('Page.navigate', { url: URL + '#' + hash }); await wait(600); };
const waitFor = async (expr, ms = 6000, label = expr) => {
  const t0 = Date.now();
  let lastErr = '';
  while (Date.now() - t0 < ms) {
    try { if (await evalJS(expr)) return; } catch (e) { lastErr = String(e).slice(0, 180); }
    await wait(180);
  }
  throw new Error(`waitFor 超时: ${label} | ${lastErr || exceptions.slice(0, 2).join(' / ') || '无'}`);
};
const T = (id) => evalJS("Array.from((document.getElementById('" + id + "').textContent || '')).filter(function (c) { return c.trim() !== ''; }).join('')");

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const setInput = (id, val) => evalJS(`(() => { const el = document.getElementById('${id}'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '${val}'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value; })()`);
const setSelect = (id, val) => evalJS(`(() => { const el = document.getElementById('${id}'); Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, '${val}'); el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
const setLayerA = (idx, val) => evalJS(`(() => { const el = document.querySelectorAll('#vg_layers [data-la]')[${idx}]; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '${val}'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);

try {
  await send('Page.enable');
  await evalJS("window.__N = function (el) { return Array.from((el.textContent || '')).filter(function (c) { return c.trim() !== ''; }).join(''); };");

  await nav('calculators');
  await waitFor(`document.body.innerText.includes('垂直造型线小件浇注系统')`, 5000, '列表');
  check('1.1 列表含本计算器', true);
  await nav('calculators/vertical_gating');
  await evalJS("window.__N = function (el) { return Array.from((el.textContent || '')).filter(function (c) { return c.trim() !== ''; }).join(''); };");
  await waitFor(`document.getElementById('vg_head') && document.getElementById('vg_head').textContent.includes('浇注时间')`, 6000, 'vg_head');
  check('1.2 引入方式三选：顶入|中入|底入', (await evalJS(`Array.from(document.getElementById('vg_pos').options).map(o=>o.text).join('|')`)) === '顶入|中入|底入', '');
  check('1.3 材料 4 种含球铁', (await evalJS(`Array.from(document.getElementById('vg_mat').options).map(o=>o.text).join('|')`)).includes('球铁(QT)'), '');
  check('1.4 顶入无 C/B 输入（隐藏）', await evalJS(`document.getElementById('vg_cbWrap').style.display === 'none'`), '');
  const gT = await T('vg_gates');
  check('1.5 加压顶入 28.6/20.6/16.9（auto M=0.52 经验下限；显式 m=0.5 时为手册例 29.7）', gT.includes('28.6') && gT.includes('20.6') && gT.includes('16.9'), '');
  check('1.6 标注图顶入版（H=A + 顶部进入）', (await T('vg_guide')).includes('H=A') && (await T('vg_guide')).includes('顶部进入'), '');
  check('1.7 t 自动推荐 4.2（设备 480）', await evalJS(`document.getElementById('vg_t').placeholder.includes('4.2')`), '');
  // V1.4 推荐优先：第一眼 = 每层怎么做
  const hT = await T('vg_head');
  check('1.8 最终推荐优先：t 行 + 每层 面积→尺寸 行', hT.includes('浇注时间t（推荐）') && hT.includes('层1内浇口') && hT.includes('→推荐3×10') && hT.includes('→推荐3×6'), '');
  check('1.9 两标准取小标注为 V1 安全侧处理', hT.includes('V1安全侧处理'), '');
  check('1.9a M 追溯行：0.52+经验范围 0.52~0.60+下限 V1 安全侧+U8', hT.includes('M内浇口损失系数') && hT.includes('0.52') && hT.includes('工程经验范围0.52~0.60') && hT.includes('区间下限（V1安全侧）') && hT.includes('U8'), '');
  check('1.9b G 提示通俗化（冒口重量也算进去）', await evalJS(`document.body.innerText.includes('冒口重量也算进去')`), '');
  check('1.9c m 自动元信息（→ 自动 0.52）', (await T('vg_miMeta')).includes('自动0.52'), '');
  // 显式 m=0.5 用户路径（手册例 29.7 可回）
  await setInput('vg_mi', '0.5');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('29.7')`, 6000, '显式 m=0.5 → 29.7');
  check('1.9d 高级 m=0.5 → 面积 29.7（t=4.2 下手册例 m 口径）', true);
  await setInput('vg_mi', '');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('28.6')`, 6000, '回自动');
  check('1.9e 清空 m → 回 auto 0.52 → 28.6', true);
  await shot('01_top_default');

  // ── 1.9b Step4：分层厚度 override（展开折叠）──
  await evalJS(`document.querySelector('#vg_sPerWrap summary').click()`);
  await waitFor(`document.querySelectorAll('#vg_sPer [data-ps]').length === 3`, 4000, 'sPer 表');
  check('1.10 分层调整表 3 行（默认跟随统一 3）', true);
  // override 层1 → 4mm：只动层1
  await evalJS(`(() => { const el = document.querySelectorAll('#vg_sPer [data-ps]')[0]; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,'4'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(`document.getElementById('vg_head').textContent.includes('4 × 7.5')`, 6000, '层1 override dims');
  check('1.11 层1 厚度 4 → 推荐 4×7.5（仅该层；L=⌈F/4⌉）', true);
  const gO = await T('vg_gates');
  check('1.12 其他层不受影响（层2 仍 3×7、层3 仍 3×6）', gO.includes('3×7') && gO.includes('3×6'), '');
  check('1.13 层1 单口面积 F 不变（与 s 无关）', gO.includes('28.6'), '');
  check('1.14 分层表 m 参考行显示档', (await T('vg_sPer')).includes('档→m'), '');
  // ↺ 恢复统一
  await evalJS(`document.querySelector('#vg_sPer [data-pr]').click()`);
  await waitFor(`document.getElementById('vg_head').textContent.includes('3 × 10')`, 6000, '恢复统一');
  check('1.15 ↺ 恢复 → 层1 回 3×10', true);
  // 减压：折叠不可用
  await setSelect('vg_sys', 'decompressed');
  await waitFor(`document.getElementById('vg_sPerWrap').style.display === 'none'`, 4000, '减压禁用');
  check('1.16 减压式：分层调整隐藏（手册各层同尺寸）', true);
  await setSelect('vg_sys', 'pressurized');
  await waitFor(`document.getElementById('vg_sPerWrap').style.display !== 'none'`, 4000, '加压恢复');
  check('1.17 回加压 → 分层调整可用', true);

  // ── 2. 时间依据二选一 ──
  await setInput('vg_moldspeed', '600');
  await waitFor(`document.getElementById('vg_t').placeholder.includes('3')`, 5000, '设备 600 → 3s');
  check('2.1 设备为主 600 型/h → 推荐 t=3（循环上限卡住）', true);
  await setSelect('vg_tmode', 'product');
  await waitFor(`document.getElementById('vg_msField').style.display === 'none'`, 4000, '型数隐藏');
  check('2.2 产品为主 → 造型速度输入隐藏', true);
  await waitFor(`document.getElementById('vg_t').placeholder.includes('4.2')`, 5000, '产品 4.2');
  check('2.3 产品为主 → 推荐 t=4.2（B√G 不浇满标准）', true);
  await setSelect('vg_tmode', 'device');
  await waitFor(`document.getElementById('vg_msField').style.display !== 'none'`, 4000, '型数恢复');
  await setInput('vg_moldspeed', '480');
  await waitFor(`document.getElementById('vg_t').placeholder.includes('4.2')`, 5000, '回 480');
  check('2.4 回设备 480 → t=4.2', true);

  // ── 3. 中入：B ──
  await setSelect('vg_pos', 'side');
  await waitFor(`document.getElementById('vg_cbWrap').style.display !== 'none'`, 4000, 'B 出现');
  check('3.1 中入 → B 输入出现（全型一个值）', (await T('vg_cbLabel')).includes('B=') && (await T('vg_cbLabel')).includes('全型共用一个值'), '');
  check('3.2 标注图=中入版（H=A−B/2、侧面中部进入）', (await T('vg_guide')).includes('H=A−B/2') && (await T('vg_guide')).includes('侧面中部进入'), '');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('36')`, 5000, '中入 H=85');
  check('3.3 中入 B=100 → 层1 36（H=A−B/2=85）', true);
  check('3.4 结果头=中入 + H=A−B/2', (await T('vg_head')).includes('中入') && (await T('vg_head')).includes('A−B/2'), '');
  check('3.5 布置示意图中入（H=85）', (await evalJS(`document.getElementById('vg_diagram').textContent`)).includes('中入') && (await evalJS(`document.getElementById('vg_diagram').textContent`)).includes('H=85'), '');
  await shot('02_side_mode');

  // ── 4. 底入：C ──
  await setSelect('vg_pos', 'bottom');
  await waitFor(`document.getElementById('vg_cbLabel').textContent.includes('C = 产品')`, 4000, 'C label');
  check('4.1 底入 → C 显眼输入行', (await T('vg_cbLabel')).includes('C=产品+冒口总高'), '');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('36')`, 5000, '底入 36');
  check('4.2 底入 C=100 → 层1 36（公式与中入一致）', true);
  await setInput('vg_cb', '50');
  await waitFor(`document.getElementById('vg_diagram').textContent.includes('H=110')`, 5000, 'C=50 → H=110');
  check('4.3 C 改 50 → H=110 联动', true);
  await setInput('vg_cb', '100');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('36')`, 5000, 'C 回');
  check('4.4 C=100 恢复', true);

  // ── 5. C/B 门禁 ──
  await setInput('vg_cb', '');
  await waitFor(`__N(document.getElementById('vg_head')).includes('C（产品+冒口总高）不能为空')`, 5000, 'C 空');
  check('5.1 C 清空 → 阻断', true);
  await setInput('vg_cb', '9999');
  await waitFor(`__N(document.getElementById('vg_head')).includes('几何不成立')`, 5000, '几何');
  check('5.2 C 过大 → 几何不成立阻断', true);
  await setInput('vg_cb', '100');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('36')`, 5000, 'C 回');
  check('5.3 恢复 C=100', true);

  // ── 6. 减压 / 混合 ──
  await setSelect('vg_pos', 'top');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('28.6')`, 5000, '顶入回');
  check('6.1 回顶入 → 28.6', true);
  await setSelect('vg_sys', 'decompressed');
  await waitFor(`document.getElementById('vg_runners').textContent.includes('4/8×8')`, 5000, '减压');
  const gatesD = await T('vg_gates');
  const runnersD = await T('vg_runners');
  check('6.2 减压段 48/75/147', runnersD.includes('4/8×8') && runnersD.includes('5/10×10') && runnersD.includes('7/14×14'), '');
  check('6.3 减压各层同尺寸 3×15.5', (gatesD.match(/3×15\.5/g) || []).length === 3, '');
  const diagD = await evalJS(`document.getElementById('vg_diagram').textContent`);
  check('6.4 示意图白话标注：段3：147mm² + 梯形 7/14×14', diagD.includes('段3：147mm²') && diagD.includes('梯形 7/14×14'), '');
  check('6.5 示意图梯形读法说明（(X+Y)÷2×H）', diagD.includes('面积=(X+Y)÷2×H'), '');
  await shot('03_decompressed');
  await setSelect('vg_sys', 'mixed');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('28.6')`, 5000, '混合');
  check('6.6 混合：口=加压逐层 + 流道=减压段', (await T('vg_runners')).includes('段1'), '');

  // ── 7. 层/s/门禁 ──
  await evalJS(`document.getElementById('vg_layerAdd').click()`);
  await waitFor(`document.querySelectorAll('#vg_layers [data-la]').length === 4`, 4000, '加层');
  check('7.1 加一层 → 4 层', true);
  await evalJS(`Array.from(document.querySelectorAll('#vg_layers [data-del]')).pop().click()`);
  await waitFor(`document.querySelectorAll('#vg_layers [data-la]').length === 3`, 4000, '删层');
  check('7.2 删一层 → 3 层', true);
  await setInput('vg_wall', '10');
  await waitFor(`document.getElementById('vg_s').placeholder.includes('1.5')`, 5000, 's1.5');
  check('7.3 壁厚 10 → s 推荐 1.5', true);
  await setInput('vg_wall', '20');
  await waitFor(`document.getElementById('vg_s').placeholder.includes('3')`, 5000, 's3');
  check('7.4 壁厚 20 → s 推荐 3', true);
  await setInput('vg_gc', '');
  await waitFor(`__N(document.getElementById('vg_head')).includes('单件铸件重量不能为空')`, 5000, 'gc');
  check('7.5 清空重量 → 阻断', true);
  await setInput('vg_gc', '0.7');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('28.6')`, 5000, 'gc 回');
  check('7.6 恢复 0.7', true);
  await setLayerA(0, '');
  await waitFor(`__N(document.getElementById('vg_head')).includes('层1A（液面→口）不能为空')`, 5000, 'A');
  check('7.7 层1 A 清空 → 阻断', true);
  await setLayerA(0, '135');
  await waitFor(`document.getElementById('vg_gates').textContent.includes('28.6')`, 5000, 'A 回');
  check('7.8 A 恢复', true);

  // ── 8. 球铁 ──
  await setSelect('vg_mat', '球铁(QT)');
  await waitFor(`document.getElementById('vg_head').textContent.includes('球铁(QT)')`, 5000, '球铁');
  check('8.1 球铁限速 600 上屏（材料行提示）', (await T('vg_matHint')).includes('600'), '');
  await setSelect('vg_mat', '灰铸铁');
  await waitFor(`document.getElementById('vg_head').textContent.includes('灰铸铁')`, 5000, '回');
  check('8.2 切回灰铸铁', true);

  // ── 9. 布局 ──
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  check('9.1 无横向溢出', !(await evalJS(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 2`)), '');
  await shot('04_final_top');
  await nav('calculators');
  await waitFor(`document.body.innerText.includes('垂直造型线小件浇注系统')`, 4000, '返回');
  check('9.2 返回列表正常', true);

  console.log(`\n══ 浏览器验收：${pass} 通过 / ${fail} 失败 ══`);
  console.log(`JS 异常/console.error：${exceptions.length}`);
  if (exceptions.length) console.log(exceptions.slice(0, 5).join('\n'));
  process.exitCode = fail > 0 || exceptions.length > 0 ? 1 : 0;
} finally {
  ws.close(); edge.kill(); if (server) server.kill();
}
