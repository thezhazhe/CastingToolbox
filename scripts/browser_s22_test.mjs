// ============================================================
// PHASE V2.0-P1-R6-S2.2 · 工作台关键交互验收
//   覆盖：形状切换即时反馈 / RH 只读关联 / 宽屏面板 / 保存并分析语义 / 结果页内联失效
// 用法: node scripts/browser_s22_test.mjs   （退出码 0=通过 1=有失败）
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9268;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_s22');
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
  let id = 0; const pending = new Map(); const exceptions = [];
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
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
  };
  await new Promise(r => (ws.onopen = r));
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const poll = async (expr, timeoutMs = 40000, step = 500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const viewport = async (w, h, mobile = false) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await wait(400);
  };
  const importStl = async (file) => {
    const full = ['golden', 'real-stl', 'fixtures'].map(d => path.join(ROOT, 'tests', d, file)).find(p => { try { return existsSync(p); } catch (e) { return false; } });
    if (!full) throw new Error('测试 STL 不存在: ' + file);
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [full.replace(/\\/g, '/')] });
  };
  const ensureModelView = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(500);
    }
  };
  const setSelect = async (sel, val) => evalJs(`(() => {
    const el = document.querySelector('${sel}'); if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(val)});
    el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const openParamStep = async (tab) => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.task !== 'open'`)) {
      await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(400);
    }
    if (!(await evalJs(`!!document.querySelector('#dc_paramBody [data-shape-note]')`))) {
      await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(400);
    }
    if (tab) { await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300); }
  };
  const project = async (expr) => JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(${expr}); })()`));

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1500);
  await viewport(1600, 1000);
  await importStl('cube50.stl');
  await poll(`document.querySelector('#dc_hsBadge')?.textContent ? 1 : 0`, 90000, 700);
  await ensureModelView();

  /* ------------------------------------------------------------
     A · 形状切换即时反馈（草稿态）与结果页可见说明
     ------------------------------------------------------------ */
  console.log('\n【S2.2-A】形状切换即时反馈');
  await openParamStep('riser');
  /* 必填项（材料大类）未选时：保存按钮必须禁用 —— 「保存」不能绕过真实门禁 */
  const saveDisabledAtStart = await evalJs(`document.querySelector('#dc_pfSave')?.disabled === true`);
  check('S2.2-E · 必填项缺失时「保存」禁用（不是只改文案）', saveDisabledAtStart === true);
  await setSelect('[data-pf="material.family"]', '球铁'); await wait(200);
  const meta = JSON.parse(await evalJs(`(async () => {
    const m = await import('/calcs/riser.js');
    const out = {};
    for (const k of Object.keys(m.RISER_SHAPES)) out[k] = {
      name: m.RISER_SHAPES[k].name, formula: m.RISER_SHAPES[k].formula,
      eff: m.RISER_EFF[m.RISER_SHAPES[k].effKey],
    };
    return JSON.stringify(out); })()`));
  const savedShape = await project(`p.getV('process.riserShape') || 'cyl'`);
  const shapes = ['cyl', 'sphere', 'square', 'sphere_head'];
  const shapeSnap = {};
  for (const k of shapes) {
    await setSelect('[data-pf="process.riserShape"]', k); await wait(120);
    shapeSnap[k] = JSON.parse(await evalJs(`(() => {
      const sel = document.querySelector('[data-pf="process.riserShape"]');
      const note = document.querySelector('[data-shape-note]');
      return JSON.stringify({ value: sel?.value || '', text: note?.textContent || '',
        pending: !!note?.querySelector('[data-shape-pending]') }); })()`));
    check(`S2.2-A · 选中 ${k}：下拉即时更新，且不再显示公式/效率长说明（S6）`,
      shapeSnap[k].value === k && !/公式|补缩效率/.test(shapeSnap[k].text),
      shapeSnap[k].text.slice(0, 80));
    check(`S2.2-A · 选中 ${k}：草稿未保存提示${k === savedShape ? '不出现' : '出现'}`,
      shapeSnap[k].pending === (k !== savedShape)
      && (k === savedShape || shapeSnap[k].text.includes(meta[k].name)));
  }
  check('S2.2-A · 切换只写草稿，保存前项目里的形状不变',
    (await project(`p.getV('process.riserShape') || 'cyl'`)) === savedShape, savedShape);
  await setSelect('[data-pf="process.riserShape"]', 'sphere_head'); await wait(120);
  await evalJs(`document.querySelector('[data-ptab="gating"]')?.click()`); await wait(200);
  await evalJs(`document.querySelector('[data-ptab="riser"]')?.click()`); await wait(200);
  const afterTabs = await evalJs(`document.querySelector('[data-shape-note]')?.textContent || ''`);
  check('S2.2-A · B/C 页签切换后，草稿形状提示仍在（不回到已保存形状）',
    /草稿尚未保存/.test(afterTabs) && afterTabs.includes(meta.sphere_head.name), afterTabs.slice(0, 80));
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'cond')?.click()`); await wait(300);
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(300);
  const afterStep = await evalJs(`document.querySelector('[data-shape-note]')?.textContent || ''`);
  check('S2.2-A · 切到 ② 再回 ③，草稿形状仍在',
    /草稿尚未保存/.test(afterStep) && afterStep.includes(meta.sphere_head.name), afterStep.slice(0, 80));

  const saveText = await evalJs(`document.querySelector('#dc_pfSave')?.textContent || ''`);
  check('S4 · 参数面板底部按钮只写「保存」', /保存/.test(saveText) && !/分析/.test(saveText), saveText.trim());
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(700);
  const saveOnly = await evalJs(`(() => ({
    chip: document.querySelector('#dc_stateChip')?.textContent || '',
    busy: document.querySelector('#dc_ws')?.dataset.flow === 'C',
    resStatus: !!document.querySelector('#dc_results [data-res-status]') }))()`);
  check('S4 · 点「保存」只写参数，不触发分析（未出现分析中/未生成结果）',
    saveOnly.busy === false && !/一致/.test(saveOnly.chip) && saveOnly.resStatus === false, JSON.stringify(saveOnly));
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  const firstOk = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('S4 · 顶部 ④「分析」执行完整分析并成功', !!firstOk,
    await evalJs(`document.querySelector('#dc_stateChip')?.textContent || ''`));
  check('S2.2-A · 保存后项目形状 = 草稿形状',
    (await project(`p.getV('process.riserShape')`)) === 'sphere_head');
  const riserShapeKey = await project(`(p.getV('risers.items') || [])[0]?.shapeKey || ''`);
  check('S2.2-A · 计算结果实际使用该形状（shapeKey）', riserShapeKey === 'sphere_head', riserShapeKey);

  await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(500);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(500);
  const resultShapeInfo = JSON.parse(await evalJs(`(() => {
    const box = document.querySelector('#dc_resultActive');
    const cards = [...(box?.querySelectorAll('.dc-core-row .dc-core-card') || [])].map(c => (c.querySelector('.dc-core-label')?.textContent || '').trim());
    const details = [...(box?.querySelectorAll('details') || [])].map(d => d.textContent.replace(/\\s+/g, ' ').trim());
    const visibleLong = [...(box?.querySelectorAll('.field-hint, .dc-hint-line') || [])]
      .filter(el => el.offsetParent !== null && /M = D\\/6/.test(el.textContent)).length;
    return JSON.stringify({ cards, details, visibleLong }); })()`));
  check('S4 §4.1 · “换形状不改 D/H”的公式化简只在详细信息，不再占据冒口卡片旁',
    resultShapeInfo.visibleLong === 0
    && resultShapeInfo.details.some(t => t.includes('换形状不改变') && t.includes('M = D/6') && t.includes('当前 H/D = 1.00')),
    JSON.stringify({ visibleLong: resultShapeInfo.visibleLong, details: resultShapeInfo.details.length }));
  check('S2.2-A · 结果页卡片同时给出真正变化的 Vr 与补缩效率',
    resultShapeInfo.cards.some(c => c.includes('冒口体积 Vr')), resultShapeInfo.cards.join(' | '));

  /* R6-S3（153 §六.3/§八）：结果页**不再有第二个形状下拉**；形状唯一编辑入口在参数面板。
     内联失效仍由结果页真实可编辑的浇道参数验证（内浇道厚度）。 */
  check('S2.2-A · 结果页不再维护第二个冒口形状选择器（唯一入口在参数面板）',
    !(await evalJs(`!!document.querySelector('#dc_riserShape')`)));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(400);
  const gtBefore = await project(`p.getV('runner.result')?.gt`);
  await evalJs(`(() => { const el = document.querySelector('#dc_gtEdit'); if (!el) return 0;
    el.value = String(${Number(gtBefore) + 1}); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  const staleNow = await evalJs(`!document.querySelector('#dc_staleBar')?.hidden`);
  check('S2.2-F · 结果页内联改参数 → 旧结果**立即**标记过期（不等 600ms 重算）', staleNow === true);
  const reOk = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 30000, 500);
  const gtAfter = await project(`p.getV('runner.result')?.gt`);
  check('S2.2-F · 自动重算成功后过期标记消失且结果确实更新',
    !!reOk && Math.abs(gtAfter - (gtBefore + 1)) < 1e-9 && !(await evalJs(`!document.querySelector('#dc_staleBar')?.hidden`)), `${gtBefore}→${gtAfter}`);

  /* ------------------------------------------------------------
     C · RH：唯一权威值 + 用户可指定（R6-S3 取代 S2.2 的只读展示）
     ------------------------------------------------------------ */
  console.log('\n【S2.2-C/R6-S3】RH 可指定与唯一存储');
  await ensureModelView();
  await openParamStep('gating');
  const rhInfo = JSON.parse(await evalJs(`(() => {
    const box = document.querySelector('[data-rh-linked]');
    return JSON.stringify({ exists: !!box, src: box?.dataset.rhSrc || '',
      input: !!box?.querySelector('input[data-pf="process.riserHeight"]'),
      text: box?.textContent || '' }); })()`));
  const rhProj = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src })`);
  check('R6-S3 · RH 在浇注系统中是唯一可编辑权威值（同一 process.riserHeight）',
    rhInfo.exists && rhInfo.input && rhInfo.src === rhProj.src, JSON.stringify({ ...rhInfo, text: '' }));
  check('R6-S3.1 · RH 只显示“冒口计算 H 参考”+ 简短距离提示，不再展开长说明（S7）',
    rhInfo.text.includes('本次冒口计算 H 参考') && rhInfo.text.includes('冒口顶高于周边顶面的距离')
    && !rhInfo.text.includes('RH = 冒口顶面 − 铸件顶面'), rhInfo.text.slice(0, 140));
  const gatingRh = await project(`p.getV('runner.result')?.rh`);
  check('S2.2-C · 浇注计算结果读取的就是同一个 RH（无第二份存储）', Math.abs(gatingRh - rhProj.v) < 1e-9,
    `gating=${gatingRh} project=${rhProj.v}`);

  /* 手动指定 222 → 保存并分析 → 写入同一字段；冒口重算不得覆盖 */
  await evalJs(`(() => { const el = document.querySelector('[data-pf="process.riserHeight"]');
    el.value = '222'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(220);
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  const rhOk = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 30000, 500);
  const rhManual = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src,
    rh: p.getV('runner.result')?.rh, orig: p.get('process.riserHeight')?.orig?.v })`);
  check('R6-S3 · 用户指定 RH=222 保存后写入项目，且浇注链使用 222',
    !!rhOk && Math.abs(rhManual.v - 222) < 1e-9 && Math.abs(rhManual.rh - 222) < 1e-9,
    JSON.stringify(rhManual));
  check('R6-S3.1 · 用户指定 RH 为 USER_OVERRIDE，且不存在自动 orig（没有可“恢复”的自动值）',
    rhManual.src === 'USER_OVERRIDE' && rhManual.orig == null, JSON.stringify(rhManual));
  await openParamStep('gating');
  const restoreBtn = await evalJs(`!!document.querySelector('[data-reset-orig="process.riserHeight"]')`);
  const useRef = await evalJs(`(() => { const b = document.querySelector('[data-rh-use-ref]');
    return b ? { exists: true, v: parseFloat(b.dataset.rhUseRef) } : { exists: false }; })()`);
  check('R6-S3.1 · RH 不提供自动恢复入口；提供显式“采用冒口 H 参考值”入口',
    restoreBtn === false && useRef.exists === true && useRef.v > 0, JSON.stringify(useRef));
  /* 显式采用参考值：写入草稿 → 保存后才进入项目；仍是用户指定（USER_OVERRIDE），不是自动回读 */
  if (useRef.exists) {
    await evalJs(`document.querySelector('[data-rh-use-ref]')?.click()`); await wait(250);
    const draftVal = await evalJs(`parseFloat(document.querySelector('[data-pf="process.riserHeight"]')?.value || '0')`);
    const projBefore = await project(`p.getV('process.riserHeight')`);
    check('R6-S3.1 · “采用参考值”只进草稿，未保存前项目值不变',
      Math.abs(draftVal - useRef.v) < 1e-9 && Math.abs(projBefore - 222) < 1e-9,
      `draft=${draftVal} ref=${useRef.v} project=${projBefore}`);
    await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(220);
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
    const rhAdopted = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 30000, 500);
    const rhAfter = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src })`);
    check('R6-S3.1 · 采用参考值保存后仍记为用户指定（不是自动回写）',
      !!rhAdopted && Math.abs(rhAfter.v - useRef.v) < 1e-9 && rhAfter.src === 'USER_OVERRIDE', JSON.stringify(rhAfter));
  }
  await openParamStep('gating');

  /* ------------------------------------------------------------
     D · 宽屏任务面板
     ------------------------------------------------------------ */
  console.log('\n【S2.2-D】宽屏任务面板');
  const panelW = async () => evalJs(`Math.round(document.querySelector('#dc_taskPanel')?.getBoundingClientRect().width || 0)`);
  await ensureModelView();
  await openParamStep('gating');
  await viewport(1600, 1000); const w1600 = await panelW();
  await viewport(1700, 1000); const w1700 = await panelW();
  await viewport(1366, 900); const w1366 = await panelW();
  check('R6-S3 · 1600px 面板 420px（不再扩大；任务参考区间 380–440）', Math.abs(w1600 - 420) <= 2, w1600);
  check('R6-S3 · ≥1700px 面板仍 420px（不随宽度无限放大）', Math.abs(w1700 - 420) <= 2, w1700);
  check('R6-S3 · 普通桌面（1366px）面板 400px', Math.abs(w1366 - 400) <= 2, w1366);
  await viewport(1600, 1000); await openParamStep('gating');
  const panelLayout = await evalJs(`(() => {
    const body = document.querySelector('#dc_taskBody'); const foot = document.querySelector('#dc_taskFoot');
    const br = body.getBoundingClientRect(), fr = foot.getBoundingClientRect();
    return { scrollable: body.scrollHeight > body.clientHeight, bodyBottom: Math.round(br.bottom),
      footTop: Math.round(fr.top), footBottom: Math.round(fr.bottom), vh: window.innerHeight }; })()`);
  check('S2.2-D · 宽屏长表单可滚动、页脚常驻且完整在视口内',
    panelLayout.scrollable && panelLayout.footTop >= panelLayout.bodyBottom - 2
    && panelLayout.footBottom <= panelLayout.vh + 1, JSON.stringify(panelLayout));
  await viewport(390, 844, true); await openParamStep('gating');
  const mobile = JSON.parse(await evalJs(`(() => {
    const p = document.querySelector('#dc_taskPanel'); const r = p.getBoundingClientRect();
    return JSON.stringify({ w: Math.round(r.width), right: Math.round(r.right),
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }); })()`));
  check('S2.2-D · 390px 移动端面板不超视口、页面无横向溢出',
    mobile.w > 0 && mobile.right <= 391 && mobile.sw <= mobile.cw + 1, JSON.stringify(mobile));
  await viewport(1600, 1000);

  /* ------------------------------------------------------------
     E · 保存并分析：失败/旧结果/重复触发
     ------------------------------------------------------------ */
  console.log('\n【S2.2-E】保存并分析状态');
  await ensureModelView();
  await project(`(p.set('geometry.valid', false, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH), 1)`);
  /* S5-03：顶部主按钮在模型视图先“查看现有结果”，进入结果视图后再点一次才强制重跑。
     这里用后者触发一次失败分析（失败时留在当前结果页，旧结果标为过期）。 */
  await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(400);
  await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(500);
  const failState = await evalJs(`(() => ({
    chip: document.querySelector('#dc_stateChip')?.textContent || '',
    bar: !document.querySelector('#dc_staleBar')?.hidden,
    barText: document.querySelector('#dc_staleBar')?.textContent || '',
    resStatus: document.querySelector('#dc_results [data-res-status]')?.textContent || '' }))()`);
  const oldStill = await project(`(p.getV('risers.items') || []).length > 0`);
  check('S2.2-E · 分析失败：旧结果保留但状态明确失败/过期（不冒充最新）',
    failState.chip.includes('未完成') && failState.bar && /未完成|过期/.test(failState.barText)
    && /上次分析未完成/.test(failState.resStatus) && oldStill,
    `${failState.chip} | ${failState.barText.slice(0, 50)} | ${failState.resStatus.slice(0, 50)}`);
  await project(`(p.set('geometry.valid', true, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH), 1)`);
  /* 失败态下真实入口仍是主按钮（结果视图里它表示“重新分析”）。 */
  await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(500);
  const recovered = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 30000, 500);
  check('S2.2-E · 修复原因后重新分析成功 → 过期标记消失', !!recovered
    && (await evalJs(`document.querySelector('#dc_staleBar')?.hidden === true`)));
  /* 同一帧内连点两次：同步分析链不得进入并发/卡在 busy */
  await evalJs(`(() => { const b = document.querySelector('#dc_run'); b?.click(); b?.click(); return 1; })()`);
  await wait(600);
  const afterDouble = await evalJs(`(() => ({
    chip: document.querySelector('#dc_stateChip')?.textContent || '',
    busy: document.querySelector('#dc_ws')?.dataset.flow === 'C' }))()`);
  check('S2.2-E · 重复触发不会留下"分析中"卡死状态',
    !afterDouble.busy && !afterDouble.chip.includes('正在计算'), JSON.stringify(afterDouble));

  console.log('\n运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  if (exceptions.length) failures++;
  console.log(`\nS2.2 验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
}
