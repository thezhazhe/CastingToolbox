// ============================================================
// 149.txt §八 · S1 浏览器验收（恢复参数说明 / 工程示意图 / 帮助内容 + 状态与交互）
//
// 逐条对应 149 §八「至少验证」的前 11 条（第 12 条冻结指纹在报告里用 sha256sum 核对）：
//   1  三种浇注方向对应正确的示意图
//   2  参数来源图例和帮助内容确实可见
//   3  五种热结状态显示与实际计算路径一致
//   4  "rejected" 不再显示为"无热结"
//   5  多热结逐项编辑能正确保存        → 已在 browser_p78_test.mjs 的 E(149) 里覆盖（更完整：含草稿/绑定）
//   6  自动值恢复能正确恢复来源和状态
//   7  未保存草稿不会改变项目          → 同上（E(149)）
//   8  保存后项目确实更新、结果标记过期
//   9  七个标准视图按钮仍通过真实鼠标事件正常工作
//   10 明暗主题和至少三档视口没有明显溢出
//   11 i18n 审计                      → scripts/browser_i18n_audit.mjs 单独跑
//
// 用法: node scripts/browser_s1_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, readFileSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9256;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_s1');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--window-size=1440,900', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    if (r.ok) { const l = await r.json(); const p = l.find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } }
  } catch (e) {}
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
const poll = async (expr, timeout = 60000, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await evalJs(expr); if (v) return v; await wait(step); }
  return null;
};

/* ---------- 导入 STL ---------- */
const importStl = async (name) => {
  const p = path.join(ROOT, 'tests', 'golden', name);
  const b64 = readFileSync(p).toString('base64');
  await evalJs(`(async () => { const r = await fetch('data:application/octet-stream;base64,${b64}');
    const b = await r.blob(); const f = new File([b], '${name}', { type: 'application/octet-stream' });
    const dt = new DataTransfer(); dt.items.add(f);
    const inp = document.querySelector('#dc_file'); inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
};
const projEval = (expr) => evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); ${expr} })()`);

await send('Page.navigate', { url: URL });
await wait(1200);
await evalJs(`location.hash = '#/designCenter'`); await wait(900);

/* ⚠ 2026-10-16 · R6-S2：参数编辑的载体从浮层窗口 `#dc_paramDlg` 换成右侧任务面板
   （150.txt §3.3）。字段分布在 ② 分析条件 与 ③ 的 B/C 两个子模块里 ⇒
   `openParams(path)` 按**真实 UI**（流程条 + 子模块页签）切到含该字段的那一步；
   断言判据本身一字未动，只换了"怎么走到那个界面"。 */
const setField = async (path, val) => {
  const ok = await evalJs(`(() => {
    const el = document.querySelector('[data-pf="${path}"]');
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    return true; })()`);
  if (!ok) throw new Error('参数界面上找不到字段: ' + path);
  await wait(220);
};
const openParams = async (path) => {
  await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(430);
  if (!path) return;
  if (await evalJs(`!!document.querySelector('[data-pf="${path}"]')`)) return;
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`);
  await wait(380);
  if (await evalJs(`!!document.querySelector('[data-pf="${path}"]')`)) return;
  for (const tab of ['riser', 'gating']) {
    await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300);
    if (await evalJs(`!!document.querySelector('[data-pf="${path}"]')`)) return;
  }
};
/* S4 契约：保存只写参数；分析由顶部 ④「分析」显式执行。
   旧用例仍按“改参数 → 看结果”的链路走，因此 helper 先保存、再点分析。 */
const saveParams = async (ms = 1600) => {
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`);
  await wait(220);
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  await wait(ms);
};
const cancelParams = async () => { await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(350); };

/* ============================================================
   1 · 三种浇注方向 → 对应的示意图（149 §二.1）
   ============================================================ */
await importStl('cube50.stl');
await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 800);
await wait(600);
// 材料大类是硬门禁 ⇒ 先选上，否则保存按钮是禁用的
await openParams('material.family');
await setField('material.family', '球铁');
await saveParams(1500);

const diagramOf = async () => evalJs(`(() => {
  const svg = document.querySelector('#dc_paramBody .dc-gating-diagram svg');
  if (!svg) return null;
  return JSON.stringify({ label: svg.getAttribute('aria-label'),
    hasHo: svg.textContent.includes('Ho'), hasPh: svg.textContent.includes('ph'), hasRh: svg.textContent.includes('rh'),
    notes: [...svg.querySelectorAll('text')].map(t => t.textContent).filter(x => /^Ho|^ph|^rh/.test(x)).length,
    gid: (svg.querySelector('marker') || {}).id || '' });
})()`);
const seen = {};
for (const pos of ['顶注', '中注', '底注']) {
  await openParams('process.pourPos');          // 浇注位置在 ③ → C 浇注系统
  await setField('process.pourPos', pos);
  await saveParams(1700);
  await openParams('process.pourPos');
  seen[pos] = await diagramOf();
  await cancelParams();
}
const parsed = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v ? JSON.parse(v) : null]));
check('S1-1 三种浇注位置都能渲染出示意图', Object.values(parsed).every(d => d && d.label),
  JSON.stringify(Object.fromEntries(Object.entries(parsed).map(([k, d]) => [k, d?.label]))));
check('S1-1 图的 aria-label 随浇注位置切换（顶注/中注/底注各不同）',
  new Set(Object.values(parsed).map(d => d?.label)).size === 3,
  Object.values(parsed).map(d => d?.label).join(' | '));
check('S1-1 三态的图形确实不同（marker id 随状态变化 ⇒ 不是同一张图）',
  new Set(Object.values(parsed).map(d => d?.gid)).size === 3,
  Object.values(parsed).map(d => d?.gid).join(' | '));
// 图上有 3 处尺寸标注（Ho/rh/ph）+ 图底 3 行同名图注 = 6 个以 Ho/ph/rh 开头的 text
check('S1-1 图上有 Ho / ph / rh 三处尺寸标注 + 图底三行图注（图注解释三个量的含义）',
  Object.values(parsed).every(d => d && d.hasHo && d.hasPh && d.hasRh && d.notes === 6),
  JSON.stringify(parsed['顶注']));

/* ============================================================
   2 · 参数来源图例 + 帮助内容确实可见（149 §二.2）
   （上一段循环结束时窗口是关的 ⇒ 这里必须重新打开再读）
   ============================================================ */
await openParams('process.pourPos');
const diagramNote = await evalJs(`(() => { const el = [...document.querySelectorAll('#dc_paramBody .dc-gating-diagram-wrap')][0];
  if (!el) return null;
  const fld = document.querySelector('#dc_paramBody [data-pf="process.pourPos"]')?.closest('.dc-dlg-fld');
  // 图块必须与「浇注位置」字段**相邻**（同一字段块之前最近的兄弟），不是散落在别处
  return JSON.stringify({ txt: el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 48),
    inPourField: !!fld && fld.contains(el) }); })()`);
const dn = diagramNote ? JSON.parse(diagramNote) : null;
check('S1-1 示意图紧邻「浇注位置」字段，并带「Ho / ph / rh 的含义见图」提示',
  !!dn && dn.inPourField === true && dn.txt.includes('浇注方向示意图'), diagramNote);
const helpVisible = await evalJs(`(() => {
  /* R6-S2：参数界面 = 面板的编辑区（② 的 #dc_condBody + ③ 的 #dc_paramBody）。
     帮助内容按步骤分布，这里取"当前这一步"能看到的那些 —— 与浮层时代"一次看全"等价。 */
  const dlg = document.querySelector('#dc_taskPanel');
  const legend = dlg.querySelector('.dc-src-legend');
  const details = [...dlg.querySelectorAll('details.dc-dlg-help')];
  const texts = details.map(d => d.querySelector('summary')?.textContent.trim());
  const g = dlg.querySelector('.dc-gating-diagram svg');
  return JSON.stringify({
    legend: legend ? legend.textContent.trim() : null,
    details: texts,
    // 常驻（未展开也要在 DOM 里）的一行短说明
    hasVentRule: /1\\.5~4 倍 S直/.test(dlg.textContent),
    hasRatioApplic: /适用：/.test(dlg.textContent) || details.some(d => d.open),
    foot: dlg.querySelector('#dc_taskHint')?.textContent || '',
    diagramInDialog: !!g, diagramInside3dBox: !!document.querySelector('#dc_view3dBox .dc-gating-diagram'),
  });
})()`);
const hv = JSON.parse(helpVisible);
check('S1-2 参数来源图例可见（🟢🟡🔵🟠 四色说明，v1.1.0 原文）',
  !!hv.legend && /STL 自动识别/.test(hv.legend) && /用户修改/.test(hv.legend), hv.legend);
/* ⚠ R6-S2：三块帮助现在分属两个子模块（Mc 估法在 B 冒口设计；比例帮助与工程原则在 C 浇注系统）。
   判据不变（三块都必须存在且是 <details> 按需展开），只是要**把两个子模块都走一遍**再取并集。 */
await evalJs(`document.querySelector('[data-ptab="riser"]')?.click()`); await wait(320);
const helpB = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#dc_paramBody details.dc-dlg-help')].map(d => d.querySelector('summary')?.textContent.trim()))`));
await evalJs(`document.querySelector('[data-ptab="gating"]')?.click()`); await wait(320);
const helpC = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#dc_paramBody details.dc-dlg-help')].map(d => d.querySelector('summary')?.textContent.trim()))`));
const helpAll = [...hv.details, ...helpB, ...helpC];
check('S1-2 帮助按需展开：浇注比例保留；Mc 四种估法已移除（S6）',
  helpAll.some(t => /浇注比例怎么选/.test(t))
  && !helpAll.some(t => /Mc 怎么估/.test(t)), helpAll.join(' | '));
// 168 D1：排气规则和浇注系统工程原则已从输入区移到结果页「详细信息」；
// 参数窗口不再显示（结果页位置由 browser_ui_polish_test 覆盖）。
check('S1-2 排气规则/浇注系统工程原则不再占用参数窗口', hv.hasVentRule === false
  && !helpAll.some(t => /工程原则/.test(t)), helpAll.join(' | '));
check('S1-2 参数共享与保存语义写进页脚（常驻，不折叠；保存与分析分离）',
  /同一参数被多个计算器共享/.test(hv.foot) && /点「保存」只写入参数/.test(hv.foot)
  && /④「分析」/.test(hv.foot), hv.foot.slice(0, 80) + '…');
// 展开「浇注比例怎么选？」→ 7 条适用范围必须在里面
await evalJs(`(() => { const d = [...document.querySelectorAll('#dc_taskPanel details.dc-dlg-help')]
  .find(x => /浇注比例怎么选/.test(x.querySelector('summary').textContent)); if (d) d.open = true; })()`);
await wait(300);
const ratioBody = await evalJs(`(() => { const d = [...document.querySelectorAll('#dc_taskPanel details.dc-dlg-help')]
  .find(x => /浇注比例怎么选/.test(x.querySelector('summary').textContent));
  if (!d) return null; const b = d.querySelector('.dc-dlg-help-body');
  return JSON.stringify({ rows: b.querySelectorAll('.dc-ratio-row').length, applic: b.querySelectorAll('.dc-ratio-applic').length,
    txt: b.textContent.replace(/\\s+/g,' ').slice(0, 80) }); })()`);
const rb = JSON.parse(ratioBody || 'null');
check('S1-2 「浇注比例怎么选？」里 7 条预设各自带适用范围（RATIO_APPLIC，非另抄一份）',
  !!rb && rb.rows === 7 && rb.applic === 7, JSON.stringify(rb));
check('S1-2 图示与按钮都在参数窗口内，**没有**被放进 #dc_view3dBox（146 §五 红线）',
  hv.diagramInDialog === true && hv.diagramInside3dBox === false, '');

/* ============================================================
   3 · 五种热结状态：界面文案与实际计算路径一致（149 §三.1）
   ============================================================ */
/* 只取「当前 Mc 从哪来」那一段（`data-mc-src-note` 是源码里专为断言留的行为钩子）；
   不能在一堆 .dc-dlg-note 里挑 —— 帮助块里也含"主体壁厚 ÷ 2"字样，挑错会误判。 */
const noteOf = async () => evalJs(`(() => {
  const el = document.querySelector('#dc_paramBody [data-mc-src-note]');
  if (!el) return null;
  return JSON.stringify({ notes: [el.textContent.replace(/\\s+/g, ' ').trim()],
    kind: el.dataset.mcSrcKind, blocked: el.dataset.mcSrcBlocked === '1',
    bad: el.classList.contains('dc-dlg-note-bad') });
})()`);
const STATES = [
  // mcHotspot 只有 ok 态才该有值（writeHotspotsToProject 的写入条件），其余态保持 0
  { st: 'ok', items: [{ id: 1, mc: 10.3 }, { id: 2, mc: 6.8 }], reason: '', mc: 10.3,
    must: /STL 热结检测/, mustNot: /主体壁厚 ÷ 2/, blocked: false },
  { st: 'NO_HOTSPOT', items: [], reason: 'no_candidate', mc: 0,
    must: /主体壁厚 ÷ 2/, mustNot: /来源：STL 热结检测/, blocked: false },
  // S0 查出的两处相反文案：这两态下 calcManifest 是 blocked，界面**不能说**成正常来源
  { st: 'LOW_CONFIDENCE', items: [{ id: 1, mc: 10.3 }], reason: 'all_low_confidence', mc: 0,
    must: /不会/, mustNot: /来源：STL 热结检测/, blocked: true },
  { st: 'INSUFFICIENT_RESOLUTION', items: [], reason: 'no_inside_points', mc: 0,
    must: /不是/, mustNot: /主体壁厚 ÷ 2 =/, blocked: true },
  { st: 'none', items: [], reason: '', mc: 0,
    must: /没有 STL 热结检测结果/, mustNot: /来源：STL 热结检测/, blocked: false },
];
let stateOk = true, stateDetail = [];
for (const s of STATES) {
  await projEval(`p.set('hotspots.status', ${JSON.stringify(s.st)}, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
    p.set('hotspots.reason', ${JSON.stringify(s.reason)}, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
    p.set('hotspots.items', ${JSON.stringify(s.items)}, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
    p.set('process.wallHot', 25, p.SRC.DERIVED, p.CONF.MEDIUM);
    p.set('process.mcHotspot', ${s.mc}, ${s.mc > 0 ? 'p.SRC.STL_GEOMETRY_ANALYSIS' : 'p.SRC.DEFAULT'}, ${s.mc > 0 ? 'p.CONF.HIGH' : 'p.CONF.LOW'});
    return 1;`);
  await openParams('process.mcHotspot');    // R6-S2：Mc 来源说明在 ③ → B 冒口设计
  const raw = await noteOf();
  const n = raw ? JSON.parse(raw) : null;
  const txt = n ? n.notes.join(' || ') : '';
  // blocked 标志既要看渲染出的样式，也要看模块给出的 kind（两处必须一致）
  const ok = !!n && s.must.test(txt) && !s.mustNot.test(txt)
    && n.bad === s.blocked && n.blocked === s.blocked;
  if (!ok) stateOk = false;
  stateDetail.push(`${s.st}: ${ok ? 'OK' : 'FAIL'} [${n?.kind ?? '-'} blocked=${n?.blocked}] ${txt.slice(0, 62)}`);
  await cancelParams();
}
check('S1-3 五种热结状态的 Mc 来源文案都与实际计算路径一致（含 S0 查出的两处相反文案）',
  stateOk, stateDetail.join('\n      '));

/* ============================================================
   4 · rejected 不再显示为「无热结」（149 §三 末段）
   ============================================================ */
await projEval(`p.set('hotspots.status', 'NO_HOTSPOT', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
  p.set('hotspots.reason', 'rejected', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
  p.set('hotspots.items', [], p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM); return 1;`);
await openParams('process.mcHotspot');
const rejRaw = await noteOf();
await cancelParams();
const rejTxt = rejRaw ? JSON.parse(rejRaw).notes.join(' ') : '';
check('S1-4 reason="rejected" 显示为"有候选但均未通过筛选"，不再回落成"无热结"',
  /均未通过筛选/.test(rejTxt) && !/未检测到热结候选/.test(rejTxt), rejTxt.slice(-70));
// 对照组：真·无候选（no_candidate）仍应是"未检测到热结候选"，两者不能被合并
await projEval(`p.set('hotspots.reason', 'no_candidate', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM); return 1;`);
await openParams('process.mcHotspot');
const ncRaw = await noteOf();
await cancelParams();
const ncTxt = ncRaw ? JSON.parse(ncRaw).notes.join(' ') : '';
check('S1-4 对照：no_candidate 仍显示"未检测到热结候选"（两种原因没有被合并成一句）',
  /未检测到热结候选/.test(ncTxt) && !/均未通过筛选/.test(ncTxt), ncTxt.slice(-70));

/* ============================================================
   6 · 自动值恢复（149 §五）
   ============================================================ */
// 先制造一次"用户覆盖"：改主体壁厚并保存 → 应固化 orig
await openParams('process.wallUsed');
const wallAuto = Number(await evalJs(`(() => { const el = document.querySelector('[data-pf="process.wallUsed"]'); return el ? el.value : null; })()`));
await evalJs(`(() => { const el = document.querySelector('[data-pf="process.wallUsed"]');
  el.value = '77'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await wait(200);
await saveParams();
const afterOverride = await projEval(`const w = p.get('process.wallUsed');
  return JSON.stringify({ v: w.v, src: w.src, orig: w.orig ? w.orig.v : null });`);
const ao = JSON.parse(afterOverride);
check('S1-6 前置：用户改主体壁厚并保存 ⇒ 记为「用户修改」且固化自动原值',
  ao.v === 77 && ao.src === 'USER_OVERRIDE' && Math.abs(ao.orig - wallAuto) < 0.11,
  afterOverride);
// 重开面板 → ↺ 入口应出现（且只在真有 orig 时）
await openParams('process.wallUsed');
const hasRestore = await evalJs(`!!document.querySelector('[data-reset-orig="process.wallUsed"]')`);
// 没有 orig 的字段不得出现 ↺
const noFalseRestore = await evalJs(`!document.querySelector('[data-reset-orig="process.Ho"]')
  && !document.querySelector('[data-reset-orig="process.ratioKey"]')`);
check('S1-6 有自动原值的字段出现 ↺，没有的字段**不出现**（不给假入口，§五.1）',
  hasRestore === true && noFalseRestore === true, `wallUsed↺=${hasRestore} 无orig不出现=${noFalseRestore}`);
// 点 ↺ → 只标记意图，项目不变
await evalJs(`document.querySelector('[data-reset-orig="process.wallUsed"]')?.click()`); await wait(400);
const pendingProj = await projEval(`const w = p.get('process.wallUsed'); return JSON.stringify({ v: w.v, src: w.src });`);
const pendingShown = await evalJs(`(() => { const fld = document.querySelector('[data-pf="process.wallUsed"]').closest('.dc-dlg-fld');
  return JSON.stringify({ note: !!fld.querySelector('.dc-restore-pending'),
    preview: document.querySelector('[data-pf="process.wallUsed"]').value }); })()`);
const ps = JSON.parse(pendingShown);
check('S1-6 点 ↺ 只是标记意图：**项目一字未改**（149 §七「保存前项目数据不变」）',
  JSON.parse(pendingProj).v === 77 && JSON.parse(pendingProj).src === 'USER_OVERRIDE', pendingProj);
check('S1-6 标记后界面给出明确状态 + 预览值，且可撤销',
  ps.note === true && Math.abs(Number(ps.preview) - ao.orig) < 0.11, pendingShown);
// 保存 → 值 + 来源 + 置信度三件一起还原
await saveParams(1700);
const restored = await projEval(`const w = p.get('process.wallUsed');
  return JSON.stringify({ v: w.v, src: w.src, conf: w.conf, hasOrig: w.orig !== undefined });`);
const rs = JSON.parse(restored);
check('S1-6 保存后：数值 + **来源** + 置信度一并还原（不是"把数字改回去"）',
  Math.abs(rs.v - ao.orig) < 0.11 && rs.src === 'STL_GEOMETRY_ANALYSIS' && rs.conf === 'high',
  restored);
/* ⚠ 这里刻意**不**断言 `orig === undefined`。`CastingProject.set()` 对 STL/DERIVED 来源的写入
   本来就会把 `orig` 刷成"最新的自动值"（`set()` 内 `if (src === STL… || DERIVED) p.orig = {v,src,conf}`），
   那是模型既有契约。恢复后真正该成立的是：**orig 与当前值/来源一致（基准已随新自动值刷新）**，
   且**不能**再被当成"可恢复状态"（否则会出现恢复按钮反复出现/恢复不生效）。 */
const restoredOk = /"src":"STL_GEOMETRY_ANALYSIS"/.test(restored)
  && (await projEval(`return String(p.restoreAutoValue('process.wallUsed'));`)) === 'false';
check('S1-6 恢复后基准刷新为最新自动值，且不再是"可恢复状态"（restoreAutoValue 返回 false）',
  restoredOk, restored);

/* ============================================================
   8 · 保存后项目确实更新，受影响结果标记过期（149 §七）
   ============================================================ */
const before8 = await projEval(`return JSON.stringify({ shape: p.getV('process.riserShape') });`);
await openParams('process.riserShape');
await setField('process.riserShape', 'sphere');
await saveParams();
const after8 = await projEval(`return JSON.stringify({ shape: p.getV('process.riserShape'), src: p.get('process.riserShape').src });`);
const a8 = JSON.parse(after8);
check('S1-8 保存后项目确实更新，且来源记为「用户修改」',
  a8.shape === 'sphere' && a8.src === 'USER_OVERRIDE', `${before8} → ${after8}`);
// 冒口形状旁应显示当前形状的补缩效率（读 RISER_EFF，球形 = 20%）
await openParams('process.riserShape');
const shapeNote = await evalJs(`(() => { const fld = document.querySelector('[data-pf="process.riserShape"]').closest('.dc-dlg-fld');
  return fld ? fld.textContent.replace(/\\s+/g, ' ') : null; })()`);
check('S1-4 冒口形状输入不再展示公式/补缩效率长说明（S6）',
  !/补缩效率/.test(shapeNote || '') && !/公式/.test(shapeNote || ''), (shapeNote || '').slice(0, 90));
check('S1-4 球形仍显示 H≡D 限制说明（不是删除有效限制）',
  /H ≡ D/.test(shapeNote || ''), (shapeNote || '').slice(0, 90));
await cancelParams();

/* ============================================================
   9 · 七个标准视图按钮（真实鼠标，146 §5 既有防线不得回退）
   ============================================================ */
await send('Page.navigate', { url: URL + '?hsDebug=1#/designCenter' });
await wait(1200);
await importStl('cube50.stl');
await poll(`window.__view3d ? 1 : 0`, 90000, 500);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await wait(600);
check('S1-9 视口浮层控件仍在 OrbitControls 容器（#dc_view3dBox）之外',
  await evalJs(`(() => { const box = document.querySelector('#dc_view3dBox');
    return !!box && !box.querySelector('.dc-view-controls') && !box.querySelector('#dc_viewReset')
      && !!document.querySelector('#dc_view3d > .dc-view-controls'); })()`));
const realClick = async (sel) => {
  const info = await evalJs(`(() => { const b = document.querySelector('${sel}'); if (!b) return null;
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const q = b.getBoundingClientRect(); const x = q.left + q.width / 2, y = q.top + q.height / 2;
    const t = document.elementFromPoint(x, y);
    return JSON.stringify({ x, y, hit: !!t && (t === b || b.contains(t)) }); })()`);
  if (!info) return false;
  const { x, y, hit } = JSON.parse(info);
  if (!hit) { console.warn('    ⚠ realClick 命中失败:', sel); return false; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await wait(380);
  return true;
};
const camOf = () => evalJs(`(() => { const v = window.__view3d; if (!v) return null;
  return v.camera.position.toArray().map(n => +n.toFixed(1)).join(','); })()`);
const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric'];
const cams = new Map(); let allClicked = true;
for (const v of VIEWS) {
  if (!await realClick(`.dc-view-btns button[data-view="${v}"]`)) { allClicked = false; break; }
  cams.set(v, await camOf());
}
check('S1-9 7 个标准视图按钮都能被真实鼠标点到', allClicked && cams.size === 7, [...cams.keys()].join('/'));
check('S1-9 每个视图点完后相机位置都不同（真实生效）', new Set(cams.values()).size === 7,
  `${new Set(cams.values()).size}/7 个不同机位`);

/* ============================================================
   10 · 明暗主题 × 三档视口：参数窗口与示意图无溢出
   ============================================================ */
const overflowAt = async (w, h, theme) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  if (theme) { await evalJs(`document.documentElement.setAttribute('data-theme', '${theme}')`); }
  await wait(500);
  /* R6-S2：载体改为面板 ③ → C 浇注系统（示意图与 13 个字段都在那里）。
     判据原意保留：**编辑界面自身不横向溢出、示意图不被裁、图表容器有实际宽度**。 */
  await openParams('process.pourPos');
  await wait(300);
  const r = await evalJs(`(() => {
    const card = document.querySelector('#dc_taskPanel');
    const wrap = document.querySelector('#dc_paramBody .dc-gating-diagram-wrap');
    const svg = document.querySelector('#dc_paramBody .dc-gating-diagram svg');
    const body = document.querySelector('#dc_taskBody');
    const doc = document.documentElement;
    const vis = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), over: Math.round(el.scrollWidth - el.clientWidth), right: Math.round(b.right) }; };
    return JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme') || 'light',
      docOverflow: doc.scrollWidth - doc.clientWidth,
      card: vis(card), body: vis(body), svg: vis(svg), wrap: vis(wrap),
      svgRight: svg ? Math.round(svg.getBoundingClientRect().right) : null,
      cardRight: card ? Math.round(card.getBoundingClientRect().right) : null,
      // 图在深色主题下仍是白底浅色工程图（§二.1 允许保留白底）
      svgBg: svg ? getComputedStyle(svg.parentElement).backgroundColor : null,
    });
  })()`);
  await cancelParams();
  return JSON.parse(r);
};
const shots = [];
for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]]) {
  for (const th of ['light', 'dark']) shots.push({ at: `${w}×${h}/${th}`, ...(await overflowAt(w, h, th)) });
}
const overflowBad = shots.filter(s => s.docOverflow > 1 || (s.svg && s.svg.over > 1)
  || (s.card && s.card.over > 1) || (s.svgRight != null && s.cardRight != null && s.svgRight > s.cardRight + 1));
check('S1-10 三档视口 × 明暗主题：页面/参数面板/示意图均无横向溢出（6 组）',
  overflowBad.length === 0, overflowBad.length ? JSON.stringify(overflowBad.map(s => ({ at: s.at, doc: s.docOverflow, svgOver: s.svg?.over, cardOver: s.card?.over }))) : '6/6 干净');
const darkSvg = shots.find(s => s.at.endsWith('/dark') && s.at.startsWith('1440'));
check('S1-10 深色主题下示意图保留白底（图内墨色未改），外围容器已适配主题',
  darkSvg.theme === 'dark' && /250, 250, 250|#fafafa/i.test(darkSvg.svgBg || ''), `svgBg=${darkSvg.svgBg}`);

/* ============================================================
   运行期异常（任何未捕获异常都是失败）
   ============================================================ */
check('S1 全程无未捕获的运行期异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

console.log(`\n结果：${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}\n`);
try { ws.close(); } catch (e) {}
try { edge.kill(); } catch (e) {}
if (server) try { server.kill(); } catch (e) {}
process.exit(failures === 0 ? 0 : 1);
