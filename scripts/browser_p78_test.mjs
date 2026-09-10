// ============================================================
// PHASE 78（78.txt）· 浏览器验收
//   A 全屏单列布局（宽窗不切成左右两栏）
//   B 浇注系统比例可选（参数区）+ 参数区不再有内浇道输入
//   C 结果页：内浇道厚度/个数框 / 排气个数框 —— 改动 → 长度与总面积联动
//   D 冒口形状下拉（4 种，默认圆柱形）
//   E 热结勾选：点击直接生效（不弹窗）；✎ 改 Mc 仍弹窗；多热结 → 结果页分子页签
//   F 旧持久化项目（缺 71.7/78 新字段）→ 勾选依然生效（本轮 Bug 端到端验证）
//   G 铸件结构工艺性只 4 张卡；线收缩率突出综合比例 + 无横向溢出；工具 6 分类
// 用法: node scripts/browser_p78_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9251;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_p78');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--window-size=1000,900', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
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
const poll = async (expr, timeoutMs = 20000, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
  return null;
};
const seedHotspots = () => evalJs(`(async () => {
  const p = await import('/js/model/CastingProject.js');
  p.set('hotspots.status', 'ok', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  p.set('hotspots.items', [
    { id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 },
    { id: 2, x: 20, y: 8, z: 4, mc: 8, regionVolumeCm3: 25 },
  ], p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
  p.set('process.mcHotspot', 14, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  p.set('material.family', '灰铁', p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
  p.set('geometry.blankWeightKg', 12, p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
  p.set('geometry.netWeightKg', 11, p.SRC.DERIVED, p.CONF.HIGH);
  p.set('geometry.size', [300, 200, 120], p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  p.set('process.wallUsed', 30, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  p.set('process.ph', 200, p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
  p.set('process.Ho', 250, p.SRC.USER_INPUT, p.CONF.USER_CONFIRMED);
  return true;
})()`);

try {
  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1500);
  check('进入设计中心', (await evalJs(`document.querySelector('#view .page-title')?.textContent || ''`)).includes('铸造工艺设计中心'));

  /* ---- 导入 cube50（真实 STL 路径：概览枢纽只在有 STL 分析时出现）---- */
  const importStl = async (file) => {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, 'tests', 'golden', file).replace(/\\/g, '/')] });
  };
  await importStl('cube50.stl');
  check('导入 cube50 完成（热结状态条出现）', !!(await poll(`document.querySelector('#dc_hsBadge')?.textContent || ''`, 60000, 800)), '');

  /* ---- A 全屏单列布局（78.txt 一）---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await wait(600);
  const layout = await evalJs(`(() => {
    const st = document.querySelector('.dc-stage')?.getBoundingClientRect();
    const pn = document.querySelector('.dc-panel')?.getBoundingClientRect();
    const main = document.querySelector('.dc-main');
    return st && pn ? { cols: getComputedStyle(main).gridTemplateColumns, stX: Math.round(st.x), stW: Math.round(st.width), pnX: Math.round(pn.x), pnW: Math.round(pn.width), stBottom: Math.round(st.bottom), pnTop: Math.round(pn.top) } : null;
  })()`);
  check('A 全屏 1920：单列（左右对齐、面板在 3D 下方）',
    layout && layout.stX === layout.pnX && layout.pnTop >= layout.stBottom - 2 && !layout.cols.includes(' '),
    JSON.stringify(layout));
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(300);

  /* ---- 79.txt 一：材料切换 → 重量随材料变化（用户报的核心问题）---- */
  const wtOf = () => evalJs(`document.querySelector('#dc_overview')?.textContent.match(/净重\\s*([\\d.]+)/)?.[1]`);
  const setFam = async (fam) => { await setInput('#dc_m_family', fam); await wait(1200); };
  await setFam('球铁');
  const wtFe = parseFloat(await wtOf());
  check('79 材料=球铁：净重按 7.1 g/cm³ 计', Math.abs(wtFe - 125 * 7.1 / 1000) < 0.02, `${wtFe} kg`);
  await setFam('铝合金');
  const wtAl = parseFloat(await wtOf());
  check('79 改材料为铝合金 → 净重立即随动（2.7 g/cm³）', Math.abs(wtAl - 125 * 2.7 / 1000) < 0.02 && wtAl < wtFe, `${wtFe} → ${wtAl} kg`);
  const densAl = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return [p.getV('material.solidDensity'), p.getV('material.liquidDensity')]; })()`);
  check('79 密度随材料带入（固 2.7 / 液 2.6）', Math.abs(densAl[0] - 2.7) < 0.01 && Math.abs(densAl[1] - 2.6) < 0.01, JSON.stringify(densAl));
  const linkTxt = await evalJs(`document.querySelector('.dc-link-hint')?.textContent || ''`);
  check('79 参数联动提示显示密度/出品率参考（举一反三）', linkTxt.includes('密度') && linkTxt.includes('出品率参考'), linkTxt.slice(0, 60));
  await setInput('#dc_m_line', '垂直线'); await wait(1000);
  const linkTxt2 = await evalJs(`document.querySelector('.dc-link-hint')?.textContent || ''`);
  check('79 改造型线 → 出品率参考区间随之变化（举一反三）', linkTxt2 !== linkTxt && linkTxt2.includes('垂直线'), linkTxt2.slice(0, 70));
  await setInput('#dc_m_method', '金属型（重力/低压）'); await wait(1000);
  const linkTxt3 = await evalJs(`document.querySelector('.dc-link-hint')?.textContent || ''`);
  check('79 改铸造方法 → 加工余量等级随之出现（举一反三）', linkTxt3.includes('加工余量等级'), linkTxt3.slice(0, 90));
  // 恢复灰铁（后续用例沿用）
  await setFam('灰铁');

  /* ---- H 概览卡片分组（78.txt 九）---- */
  const ov = await evalJs(`[...document.querySelectorAll('#dc_overview .dc-ov-gtitle')].map(e => e.textContent.trim())`);
  check('H 概览分三组（几何 / 重量与壁厚 / 分析结果）', ov.length === 3 && ov[0].includes('几何') && ov[1].includes('壁厚') && ov[2].includes('分析'), ov.join(' | '));
  check('H 概览卡片化（dc-ov-card）', (await evalJs(`document.querySelectorAll('#dc_overview .dc-ov-card').length`)) === 12, '');

  /* ---- B 浇注系统比例可选（78.txt 二）---- */
  await seedHotspots();
  await setInput('#dc_m_family', '灰铁');   // 触发参数区重渲染（有 STL 时不走手动模式入口）
  await wait(700);
  const paramsTxt = await evalJs(`document.querySelector('#dc_params')?.textContent || ''`);
  check('B 参数区出现「浇注系统比例」下拉', await evalJs(`!!document.querySelector('#dc_m_ratio3')`));
  const ratioOpts = await evalJs(`[...document.querySelectorAll('#dc_m_ratio3 option')].map(o => o.textContent)`);
  check('B 比例可选 6 档预设 + 自动推荐', ratioOpts.length === 7 && ratioOpts[0].includes('自动推荐') && ratioOpts.some(o => o.includes('封闭式 常用型')), `opt=${ratioOpts.length}`);
  check('B 参数区不再有内浇道厚度/个数输入框', await evalJs(`!document.querySelector('#dc_m_gt2') && !document.querySelector('#dc_m_gc2')`), '');
  await setInput('#dc_m_ratio3', '开放式 宽大型');
  await wait(400);
  check('B 选比例 → 写入项目（用户输入）', (await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.ratioKey'); })()`)) === '开放式 宽大型');

  /* ---- E 热结勾选：点击直接生效（78.txt 四）---- */
  const pickRows = await evalJs(`document.querySelectorAll('[data-hs-pick]').length`);
  check('E 热结勾选列表（H1/H2）', pickRows === 2, `rows=${pickRows}`);
  await evalJs(`document.querySelectorAll('[data-hs-pick]')[0].click()`);
  await wait(400);
  check('E 勾选不再弹窗（78.txt 四·2）', !(await evalJs(`!!document.querySelector('#dc_hsModal')`)), '无弹窗');
  check('E 勾选立刻打勾', await evalJs(`document.querySelectorAll('[data-hs-pick]')[0].checked`), '');
  const pickVal = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick')); })()`);
  check('E 勾选写入项目（Mc = 检出值 14）', pickVal === '[{"id":1,"mc":14}]', pickVal);
  await evalJs(`document.querySelectorAll('[data-hs-pick]')[1].click()`);
  await wait(400);
  // ✎ 改 Mc 仍走弹窗
  await evalJs(`document.querySelectorAll('[data-hs-edit]')[1].click()`);
  await wait(400);
  check('E 「✎ 改 Mc」仍弹窗（唯一弹窗入口）', await evalJs(`!!document.querySelector('#dc_hsModal')`), '');
  await evalJs(`(() => { document.querySelector('#dc_hsModal #dc_hsMc').value = '12'; })()`);
  await evalJs(`document.querySelector('#dc_hsModal [data-hs-ok]').click()`);
  await wait(500);
  const pickVal2 = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick')); })()`);
  check('E 弹窗改值生效（H2 → 12）', pickVal2 === '[{"id":1,"mc":14},{"id":2,"mc":12}]', pickVal2);

  /* ---- 执行分析 → 结果页 ---- */
  await evalJs(`document.querySelector('#dc_run').click()`);
  await poll(`document.querySelector('#dc_resultActive')?.textContent || ''`, 30000);

  /* ---- G 工艺性页：只 4 张卡（78.txt 六）---- */
  const p1 = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  const cardTitles = await evalJs(`[...document.querySelectorAll('#dc_resultActive .dc-p1-bcard .dc-p1-bhead b')].map(e => e.textContent)`);
  check('G 工艺性卡片 = 最小壁厚 / 圆角 / 拔模 / 最小铸孔（4 张）',
    cardTitles.slice(0, 4).join('|') === '最小壁厚|铸造圆角|拔模斜度|最小铸出孔径' && !cardTitles.some(t => t.includes('厚薄') || t.includes('结构风险')),
    cardTitles.join('/'));

  /* ---- C 结果页内浇道/排气框（78.txt 七/八）---- */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]').click()`); await wait(400);
  const g0 = await evalJs(`(() => ({
    gt: document.querySelector('#dc_gtEdit')?.value, gc: document.querySelector('#dc_gcEdit')?.value,
    ventN: document.querySelector('#dc_ventN')?.value,
    canvasLen: document.querySelector('#dc_resultActive')?.textContent.match(/单条长 (\\d+(?:\\.\\d+)?)/)?.[1],
    area: document.querySelector('#dc_resultActive')?.textContent.match(/总截面 (\\d+(?:\\.\\d+)?)/)?.[1],
    ventArea: document.querySelector('#dc_resultActive')?.textContent.match(/总排气面积 (\\d+(?:\\.\\d+)?)/)?.[1],
  }))()`);
  check('C 内浇道厚度/个数框在结果页', g0.gt === '10' && g0.gc === '2', JSON.stringify(g0));
  // （排气口径已按 79.txt 四改为"用户定直径、系统算孔数"，详见下方 79 段）
  // 改厚度 → 长度联动（重算链）
  await setInput('#dc_gtEdit', '6');
  const g1 = await poll(`(() => { const m = document.querySelector('#dc_resultActive')?.textContent.match(/单条长 (\\d+(?:\\.\\d+)?)/); return m && m[1] !== '${g0.canvasLen}' ? m[1] : ''; })()`, 15000, 500);
  check('C 改厚度 10 → 6：内浇道长度自动重算', !!g1 && g1 !== g0.canvasLen, `${g0.canvasLen} → ${g1}`);
  const gtStored = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.gateThk'); })()`);
  check('C 厚度写回项目（用户输入）', gtStored === 6, `gateThk=${gtStored}`);
  // 改个数 → 内浇道长度随之重算（阻流面积不变，几何按 个数×厚度 反算长度）
  const len1 = await evalJs(`document.querySelector('.dc-edit-res')?.textContent.match(/单条长\\s*([\\d.]+)/)?.[1]`);
  await setInput('#dc_gcEdit', '4');
  const g2 = await poll(`(() => { const m = document.querySelector('.dc-edit-res')?.textContent.match(/单条长\\s*([\\d.]+)/); return m && m[1] !== '${len1}' ? m[1] : ''; })()`, 15000, 500);
  const gcStored = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('production.ingateN'); })()`);
  check('C 改个数 2 → 4：内浇道长度随之重算', !!g2 && gcStored === 4, `${len1} → ${g2} mm（个数写入=${gcStored}）`);
  // PHASE 80（79.txt 追问）：横浇道与内浇道同级可改（厚度 / 条数 → 长度自动重算）
  const r0 = await evalJs(`(() => ({
    rt: document.querySelector('#dc_rtEdit')?.value, rc: document.querySelector('#dc_rcEdit')?.value,
    res: document.querySelectorAll('.dc-edit-box')[1]?.querySelector('.dc-edit-res')?.textContent.replace(/\\s+/g, ' ').trim(),
  }))()`);
  check('横浇道框：厚度/条数默认 25 / 2（工具既有默认）', r0.rt === '25' && r0.rc === '2', JSON.stringify(r0));
  await setInput('#dc_rtEdit', '8');
  const r1 = await poll(`(() => { const el = document.querySelectorAll('.dc-edit-box')[1]?.querySelector('.dc-edit-res')?.textContent.replace(/\\s+/g,' ').trim(); return el && el !== '${(r0.res || '').replace(/'/g, "")}' ? el : ''; })()`, 15000, 500);
  // 注：本用例（cube50）横浇道长度落在 10mm 下限上，故以"结果行随厚度重算"为判据（总截面 500 → 160）
  check('横浇道厚度 25 → 8：结果随重算（长度/总截面）', !!r1, `${r0.res} → ${r1}`);
  const rtStored = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return [p.getV('process.runnerThk'), p.getV('production.runnerN')]; })()`);
  check('横浇道厚度写回项目（用户输入）', rtStored[0] === 8, JSON.stringify(rtStored));
  check('横浇道「↺ 用默认值」入口出现', await evalJs(`!!document.querySelector('#dc_rtReset')`), '');
  await evalJs(`document.querySelector('#dc_rtReset')?.click()`); await wait(1500);
  const rtBack = await evalJs(`document.querySelector('#dc_rtEdit')?.value`);
  check('↺ 恢复默认后回到 25', rtBack === '25', `rt=${rtBack}`);

  // PHASE 79（79.txt 四）：排气只填**直径**，孔数由系统按总排气面积生成
  const v0 = await evalJs(`(() => ({
    d: document.querySelector('#dc_ventD')?.value,
    hasN: !!document.querySelector('#dc_ventN'),
    n: document.querySelector('#dc_resultActive')?.textContent.match(/→\\s*(\\d+)\\s*个 ⌀/)?.[1],
    vr: document.querySelector('#dc_resultActive')?.textContent.match(/比值\\s*([\\d.]+)\\s*倍/)?.[1],
  }))()`);
  check('C 排气直径框默认 ⌀3、孔数为只读生成值', v0.d === '3' && !v0.hasN && +v0.n > 0, JSON.stringify(v0));
  check('C 排气比值恒达标（≥1.5，不再报"排气不足"）', parseFloat(v0.vr) >= 1.5, `比值=${v0.vr}`);
  await setInput('#dc_ventD', '1');
  const v1 = await poll(`(() => { const t = document.querySelector('#dc_resultActive')?.textContent || ''; const m = t.match(/→\\s*(\\d+)\\s*个 ⌀/); return m && +m[1] !== ${v0.n} ? m[1] : ''; })()`, 15000, 500);
  check('C 直径 3 → 1：孔数自动变多', !!v1 && +v1 > +v0.n, `${v0.n} → ${v1} 个`);
  const vdStored = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.ventD'); })()`);
  check('C 直径写回项目（用户输入）', vdStored === 1, `ventD=${vdStored}`);
  const gtReset = await evalJs(`document.querySelector('#dc_gtReset') ? '有' : '无'`);
  check('C 提供「↺ 用推荐值」入口', gtReset === '有', '');

  /* ---- D 冒口形状下拉（78.txt 三）---- */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(400);
  const shapeInfo = await evalJs(`(() => {
    const sel = document.querySelector('#dc_riserShape');
    return sel ? { n: sel.options.length, names: [...sel.options].map(o => o.textContent), cur: sel.value } : null;
  })()`);
  check('D 冒口形状下拉 4 种、默认圆柱形', shapeInfo && shapeInfo.n === 4 && shapeInfo.cur === 'cyl', JSON.stringify(shapeInfo && shapeInfo.names));
  const before = await evalJs(`document.querySelector('#dc_resultActive')?.textContent.match(/补缩效率\\s*(\\d+)%/)?.[1]`);
  await setInput('#dc_riserShape', 'sphere_head');
  const after = await poll(`(() => { const m = document.querySelector('#dc_resultActive')?.textContent.match(/补缩效率\\s*(\\d+)%/); return m && m[1] !== '${before}' ? m[1] : ''; })()`, 15000, 500);
  check('D 切换形状 → 重算（效率 14% → 25%）', !!after && before === '14' && after === '25', `${before}% → ${after}%`);
  check('D 形状写回项目', (await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.riserShape'); })()`)) === 'sphere_head');

  /* ---- E2 多热结 → 结果页分子页签（78.txt 五）---- */
  const tabs = await evalJs(`[...document.querySelectorAll('#dc_hsTabs .dc-hs-tab')].map(b => b.textContent.trim())`);
  check('E 多热结分子页签（热结 H1 / H2）', tabs.length === 2 && tabs[0].includes('H1') && tabs[1].includes('H2'), tabs.join(' | '));
  const pane0Open = await evalJs(`!document.querySelector('[data-hs-pane="0"]').hidden && document.querySelector('[data-hs-pane="1"]').hidden`);
  check('E 默认显示第一个热结的冒口', pane0Open, '');
  await evalJs(`document.querySelectorAll('#dc_hsTabs .dc-hs-tab')[1].click()`); await wait(300);
  const pane1Open = await evalJs(`document.querySelector('[data-hs-pane="0"]').hidden && !document.querySelector('[data-hs-pane="1"]').hidden`);
  check('E 点「热结 H2」切换显示 H2 的冒口', pane1Open, '');

  /* ---- F 旧持久化项目（缺新字段）→ 勾选依然生效（Bug 端到端）---- */
  await evalJs(`(async () => {
    const p = await import('/js/model/CastingProject.js');
    p.set('material.family', '球铁');   // 触发落盘
  })()`);
  await wait(300);
  const stripped = await evalJs(`(() => {
    const raw = JSON.parse(localStorage.getItem('ct-project') || '{}');
    const had = { process: !!raw.process, hsPick: !!(raw.process && 'hsPick' in raw.process), ingateN: !!(raw.production && 'ingateN' in raw.production) };
    if (raw.process) { delete raw.process.hsPick; delete raw.process.gateThk; delete raw.process.riserShape; delete raw.process.ratioKey; delete raw.process.ventN; }
    if (raw.production) { delete raw.production.ingateN; }
    localStorage.setItem('ct-project', JSON.stringify(raw));
    return had;
  })()`);
  check('F 已构造"旧存档"（删除 71.7/78 新增字段）', stripped.process === true, JSON.stringify(stripped));
  await send('Page.reload');
  await wait(1800);
  await seedHotspots();
  await evalJs(`document.querySelector('#dc_manualLink')?.click()`);
  await wait(700);
  const oldPick = await evalJs(`document.querySelectorAll('[data-hs-pick]').length`);
  await evalJs(`document.querySelectorAll('[data-hs-pick]')[0].click()`);
  await wait(500);
  const oldChecked = await evalJs(`document.querySelectorAll('[data-hs-pick]')[0].checked`);
  const oldVal = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick')); })()`);
  check('F 旧存档下：点击 H1 立刻打勾（根因已修复）', oldPick === 2 && oldChecked === true && oldVal === '[{"id":1,"mc":14}]', `rows=${oldPick} checked=${oldChecked} val=${oldVal}`);

  /* ---- G2 线收缩率工具：突出综合比例 + 无横向溢出（78.txt 十）---- */
  await evalJs(`location.hash = '#/calculators/shrinkage'`);
  await wait(900);
  const sc = await evalJs(`(() => {
    const card = document.querySelector('.section-card');
    const res = document.querySelector('#sc_results')?.textContent || '';
    const d3 = document.querySelector('#s_d3')?.getBoundingClientRect();
    const single = document.querySelector('.calc-single')?.getBoundingClientRect();
    return {
      overflow: card ? card.scrollWidth - card.clientWidth : null,
      zRight: d3 ? Math.round(d3.right) : null, limit: single ? Math.round(single.right) : null,
      hasCombined: res.includes('综合比例'), hasFold: !!document.querySelector('#sc_results details'),
    };
  })()`);
  check('G 线收缩率：综合比例置顶 + 分方向折叠', sc.hasCombined && sc.hasFold, JSON.stringify(sc));
  check('G Z 方向输入框不再溢出容器（78.txt 十）', sc.overflow <= 0 && sc.zRight <= sc.limit, `overflow=${sc.overflow} zRight=${sc.zRight} ≤ ${sc.limit}`);

  /* ---- G3 工具分类（78.txt 十一）---- */
  await evalJs(`location.hash = '#/calculators'`);
  await wait(700);
  const cats = await evalJs(`[...document.querySelectorAll('.calc-cat-name')].map(e => e.textContent)`);
  check('G 计算工具页按 6 类分组', cats.length === 6, cats.join(' / '));
  await evalJs(`location.hash = '#/'`);
  await wait(700);
  // 首页在有生产场景时展示的是"对口推荐"；清掉场景才回到"常用工具"分组视图
  await evalJs(`document.querySelector('#homeCtxClear')?.click()`);
  await wait(600);
  const homeCats = await evalJs(`[...document.querySelectorAll('#homeReco .calc-cat-name')].map(e => e.textContent)`);
  check('G 首页常用工具同样分类', homeCats.length === 6, homeCats.join(' / '));

  check('无运行时异常', exceptions.length === 0, exceptions.join('; ').slice(0, 200));
  console.log(`\nPHASE 78 浏览器验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++;
  console.error('\n脚本异常：', e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill();
  server?.kill();
  process.exit(failures ? 1 : 0);
}
