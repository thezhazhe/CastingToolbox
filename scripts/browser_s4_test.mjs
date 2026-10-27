// ============================================================
// R6-S4（155.txt）· 保存/分析分离 · 三维—面板布局 · 提示分层 · 出品率整模
// 用法: node scripts/browser_s4_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9272;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_s4');
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
  const poll = async (expr, timeoutMs = 40000, step = 400) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const viewport = async (w, h, mobile = false) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    await wait(300);
  };
  const importStl = async (file) => {
    const full = path.join(ROOT, 'tests', 'golden', file);
    if (!existsSync(full)) throw new Error('测试 STL 不存在: ' + file);
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [full.replace(/\\/g, '/')] });
  };
  const project = (expr) => evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return ${expr}; })()`);
  const fieldInActiveStep = (p) =>
    `!!document.querySelector('#dc_condStep:not([hidden]) [data-pf="${p}"], #dc_paramStep:not([hidden]) [data-pf="${p}"]')`;
  const openField = async (p) => {
    await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(420);
    if (await evalJs(fieldInActiveStep(p))) return;
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(380);
    if (await evalJs(fieldInActiveStep(p))) return;
    for (const tab of ['riser', 'gating']) {
      await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300);
      if (await evalJs(fieldInActiveStep(p))) return;
    }
    throw new Error('参数面板里找不到字段: ' + p);
  };
  const setInput = async (sel, val) => evalJs(`(() => {
    const el = document.querySelector('${sel}'); if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true;
  })()`);
  const ensureModelView = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(450);
    }
  };
  const goResults = async () => {
    await ensureModelView();
    await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(700);
    await poll(`document.querySelector('#dc_resultActive') ? 1 : 0`, 20000, 250);
  };
  const saveClick = () => evalJs(`document.querySelector('#dc_pfSave')?.click()`);
  const analyzeClick = () => evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  const chip = () => evalJs(`document.querySelector('#dc_stateChip')?.textContent || ''`);
  const staleShown = () => evalJs(`!document.querySelector('#dc_staleBar')?.hidden`);

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1800);

  /* ============================================================
     1 · 首轮：保存只落盘，不分析；顶部 ④ 才分析
     ============================================================ */
  console.log('\n【保存/分析分离】首轮');
  await importStl('cube50.stl');
  await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 700);
  await wait(500);
  await openField('material.family');
  const saveText = await evalJs(`document.querySelector('#dc_pfSave')?.textContent || ''`);
  check('参数面板底部按钮只写「保存」', /保存/.test(saveText) && !/分析/.test(saveText), saveText.trim());
  await setInput('[data-pf="material.family"]', '球铁'); await wait(250);
  await saveClick(); await wait(800);
  const afterSave1 = await evalJs(`(() => ({
    chip: document.querySelector('#dc_stateChip')?.textContent || '',
    flow: document.querySelector('#dc_ws')?.dataset.flow || '',
    resStatus: !!document.querySelector('#dc_results [data-res-status]'),
    busy: document.querySelector('#dc_ws')?.dataset.flow === 'C' }))()`);
  check('点「保存」→ 参数落盘，但不触发分析、不生成结果',
    afterSave1.busy === false && afterSave1.resStatus === false && !/一致/.test(afterSave1.chip), JSON.stringify(afterSave1));
  check('保存后项目材料已更新', (await project(`p.getV('material.family')`)) === '球铁');
  await analyzeClick();
  const firstOk = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('顶部 ④「分析」执行完整分析并成功', !!firstOk, await chip());
  check('分析后结果状态条存在', await evalJs(`!!document.querySelector('#dc_results [data-res-status]')`));

  /* 空保存不得把结果误标过期 */
  await saveClick(); await wait(500);
  check('无修改点「保存」不把已有结果误标过期',
    (await chip()).includes('一致') && !(await staleShown()), await chip());

  /* ============================================================
     2 · 修改后保存 → 一直过期；只有 ④ 才更新
     ============================================================ */
  console.log('\n【结果有效性】保存后不自动分析');
  await ensureModelView();
  await openField('process.riserShape');
  const shapeBefore = await project(`p.getV('process.riserShape') || 'cyl'`);
  const nextShape = shapeBefore === 'sphere' ? 'cyl' : 'sphere';
  await setInput('[data-pf="process.riserShape"]', nextShape); await wait(250);
  await saveClick(); await wait(350);
  check('保存影响结果的参数 → 旧结果立即标记过期', await staleShown(), await chip());
  check('过期时主按钮文案改为「重新分析」（动作与文案一致）',
    /重新分析/.test(await evalJs(`document.querySelector('#dc_run')?.textContent || ''`)),
    await evalJs(`document.querySelector('#dc_run')?.textContent || ''`));
  await wait(1300);
  check('保存后等待也不自动分析：过期状态保持',
    await staleShown() && !(await chip()).includes('一致'), await chip());
  await analyzeClick();
  const afterAnalyze = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('④「分析」完成后过期标记清除，结果按新参数更新',
    !!afterAnalyze && !(await staleShown()) && (await project(`p.getV('process.riserShape')`)) === nextShape, await chip());

  /* ============================================================
     3 · 有未保存修改点「分析」：明确确认，不静默丢弃
     ============================================================ */
  console.log('\n【未保存修改】分析前的明确确认');
  await ensureModelView();
  await openField('process.riserShape');
  const beforeDraft = await project(`p.getV('process.riserShape') || 'cyl'`);
  const draftShape = beforeDraft === 'square' ? 'cyl' : 'square';
  await setInput('[data-pf="process.riserShape"]', draftShape); await wait(250);
  const confirmNo = await evalJs(`(() => { window.__s4cfm = 0; window.__s4msg = '';
    window.__origConfirm = window.confirm;
    window.confirm = (m) => { window.__s4cfm++; window.__s4msg = String(m); return false; }; return true; })()`);
  await analyzeClick(); await wait(500);
  check('未保存时点 ④：先弹确认，取消则保留草稿、不落盘、不分析',
    confirmNo && (await evalJs(`window.__s4cfm`)) >= 1 && (await project(`p.getV('process.riserShape')`)) === beforeDraft
    && (await evalJs(`document.querySelector('[data-pf="process.riserShape"]')?.value`)) === draftShape,
    await evalJs(`window.__s4msg`));
  await evalJs(`window.confirm = () => true`);
  await analyzeClick();
  const draftOk = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('确认后：先保存草稿，再按新参数执行分析',
    !!draftOk && (await project(`p.getV('process.riserShape')`)) === draftShape, await chip());
  await evalJs(`window.confirm = window.__origConfirm || (() => true)`);

  /* ============================================================
     4 · 三维与右侧面板：顶部对齐 + 稳定间距 + STL 提示不破坏布局
     ============================================================ */
  console.log('\n【布局】三维—右侧面板');
  const measure = () => evalJs(`(() => {
    const v = document.querySelector('#dc_view3dBox')?.getBoundingClientRect();
    const p = document.querySelector('#dc_taskPanel')?.getBoundingClientRect();
    const val = document.querySelector('#dc_validate');
    return JSON.stringify({
      vTop: v ? Math.round(v.top * 10) / 10 : null, pTop: p ? Math.round(p.top * 10) / 10 : null,
      gap: v && p ? Math.round((p.left - v.right) * 10) / 10 : null,
      validate: val ? { hidden: val.hidden, text: (val.textContent || '').trim().slice(0, 40),
        inChrome: !!val.closest('#dc_chrome'), inStage: !!val.closest('.dc-stage') } : null,
      panelOpen: document.querySelector('#dc_ws')?.dataset.task === 'open',
    }); })()`);
  await ensureModelView();
  await openField('material.family'); await wait(550);
  let m = JSON.parse(await measure());
  check('STL 成功提示在共享 chrome 行，不占用三维列高度', m.validate && m.validate.inChrome === true && m.validate.inStage === false, JSON.stringify(m.validate));
  check('分析进度条也在共享 chrome 行（不会只推低三维列）',
    await evalJs(`!!document.querySelector('#dc_chrome > #dc_progress')`));
  check('展开参数面板后：三维与面板顶部对齐（≤1.5px）', m.vTop != null && m.pTop != null && Math.abs(m.vTop - m.pTop) <= 1.5, `3D=${m.vTop} panel=${m.pTop}`);
  check('三维与右侧面板之间有稳定留白（≥6px）', m.gap != null && m.gap >= 6, `gap=${m.gap}`);

  for (const step of ['cond', 'param', 'model']) {
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === '${step}')?.click()`); await wait(500);
    m = JSON.parse(await measure());
    check(`切到「${step}」：三维与面板顶部仍对齐、间距稳定`,
      m.panelOpen && m.vTop != null && m.pTop != null && Math.abs(m.vTop - m.pTop) <= 1.5 && m.gap >= 6,
      JSON.stringify({ vTop: m.vTop, pTop: m.pTop, gap: m.gap }));
  }
  await viewport(1200, 800); await wait(500);
  m = JSON.parse(await measure());
  check('窗口缩放（1200×800）后顶部仍对齐、间距仍存在',
    m.vTop != null && m.pTop != null && Math.abs(m.vTop - m.pTop) <= 1.5 && m.gap >= 6, JSON.stringify({ vTop: m.vTop, pTop: m.pTop, gap: m.gap }));
  await viewport(1366, 900); await wait(400);
  await evalJs(`document.querySelector('#dc_taskClose')?.click()`); await wait(350);

  /* ============================================================
     5 · 结果页：冒口长公式只在详细信息；风险不重复
     ============================================================ */
  console.log('\n【提示分层】结果页');
  await goResults();
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(500);
  const riserUi = await evalJs(`(() => {
    const box = document.querySelector('#dc_resultActive');
    const visibleLong = [...box.querySelectorAll('.field-hint, .dc-hint-line')]
      .filter(el => el.offsetParent !== null && /M = D\\/6/.test(el.textContent)).length;
    const details = [...box.querySelectorAll('details')].map(d => d.textContent);
    return JSON.stringify({ visibleLong, detailsHas: details.some(t => t.includes('换形状不改变') && t.includes('M = D/6')) });
  })()`);
  const ru = JSON.parse(riserUi);
  check('“换形状不改 D/H”的公式段不再默认占据冒口卡片', ru.visibleLong === 0, riserUi);
  check('完整公式/几何依据仍在冒口详细信息', ru.detailsHas === true);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(500);
  const gUi = await evalJs(`(() => {
    const risk = document.querySelector('[data-risk-strip]')?.textContent || '';
    const active = document.querySelector('#dc_resultActive')?.textContent || '';
    const core = [...document.querySelectorAll('#dc_resultActive .dc-core-card')]
      .find(c => (c.querySelector('.dc-core-label')?.textContent || '').includes('内浇口流速'));
    return JSON.stringify({ risk, active, velState: core?.className || '' });
  })()`);
  const gu = JSON.parse(gUi);
  check('顶部风险条不再重复“最终实重出品率/RH”等已在卡片出现的信息',
    !gu.risk.includes('最终实重出品率') && !gu.risk.includes('RH 未指定'), gu.risk.slice(0, 120));
  check('整模账目不再展示工具推算的实际出品率，并保留人工回算指引',
    !gu.active.includes('最终实重出品率') && !gu.active.includes('暂不能给出')
    && gu.active.includes('实际出品率请用本厂实绩'), gu.active.slice(0, 180));
  check('内浇口流速偏高不再把主卡片打成红色失败态（用 warn）', !/dc-core-card bad/.test(gu.velState), gu.velState);

  /* ============================================================
     6 · 报告与结果页同源（新增整模字段）
     ============================================================ */
  console.log('\n【报告】整模口径');
  await evalJs(`(() => { window.__rep = ''; const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { try { b.text().then(t => { window.__rep = t; }); } catch (e) {} return orig(b); };
    return true; })()`);
  await evalJs(`document.querySelector('#dc_report')?.click()`); await wait(900);
  const rep = await evalJs(`window.__rep || ''`);
  check('报告含整模铸件重/整模冒口重/反推残差浇道重', rep.includes('整模铸件') && rep.includes('整模冒口重') && rep.includes('反推残差'), rep.slice(0, 80));
  check('报告不出现多腔错误出品率 32.5 / 16.25', !rep.includes('32.5') && !rep.includes('16.25'));
  check('报告不再展示工具推算的实际出品率，并说明可人工回算',
    !rep.includes('最终实重出品率') && !rep.includes('暂不能给出') && rep.includes('当前为工艺预估值'));

  /* ============================================================
     7 · 中英文：保存/分析按钮同步
     ============================================================ */
  console.log('\n【中英文】保存 / 分析');
  await ensureModelView();
  await openField('material.family');
  await evalJs(`document.querySelector('[data-lang="en-US"]')?.click()`); await wait(700);
  /* 语言切换会重渲染工作台 —— 重新打开参数面板再读页脚（不是假设它一定还开着）。 */
  await openField('material.family'); await wait(350);
  const en = await evalJs(`(() => ({
    save: document.querySelector('#dc_pfSave')?.textContent || '',
    run: [...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.textContent || '',
    foot: document.querySelector('#dc_taskHint')?.textContent || '' }))()`);
  check('英文：保存按钮为 Save，且不含分析词', /Save/.test(en.save) && !/Analy[sz]e/i.test(en.save), en.save.trim());
  check('英文：顶部第四项为 Analysis/Analyse', /Analysis|Analy[sz]e/i.test(en.run), en.run.replace(/\s+/g, ' ').trim());
  check('英文：页脚说明保存不触发分析', /Save/.test(en.foot) && /Analysis|Analy[sz]e/i.test(en.foot), en.foot.slice(0, 160));
  await evalJs(`document.querySelector('[data-lang="zh-CN"]')?.click()`); await wait(600);
  await openField('material.family'); await wait(350);

  /* ============================================================
     8 · 移动端
     ============================================================ */
  await viewport(390, 844, true); await wait(500);
  const mobile = await evalJs(`(() => {
    const p = document.querySelector('#dc_taskPanel');
    const r = p?.getBoundingClientRect();
    return JSON.stringify({ w: r ? Math.round(r.width) : 0, right: r ? Math.round(r.right) : 0,
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }); })()`);
  const mob = JSON.parse(mobile);
  check('390px：参数面板不超视口、页面无横向溢出',
    mob.w > 0 && mob.right <= 391 && mob.sw <= mob.cw + 1, mobile);

  console.log('\n运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  if (exceptions.length) failures++;
  console.log(`\nS4 验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
}
