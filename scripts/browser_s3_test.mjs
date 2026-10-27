// ============================================================
// R6-S3（153.txt）· 工艺设计中心参数重整 / RH / 整模出品率口径 / 结果闭环
// 用法: node scripts/browser_s3_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9269;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_s3');
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
  const fieldInActiveStep = (path) =>
    `!!document.querySelector('#dc_condStep:not([hidden]) [data-pf="${path}"], #dc_paramStep:not([hidden]) [data-pf="${path}"]')`;
  const openField = async (path) => {
    await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(400);
    if (await evalJs(fieldInActiveStep(path))) return;
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(350);
    if (await evalJs(fieldInActiveStep(path))) return;
    for (const tab of ['riser', 'gating']) {
      await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300);
      if (await evalJs(fieldInActiveStep(path))) return;
    }
    throw new Error('参数面板里找不到字段: ' + path);
  };
  const setInput = async (sel, val) => evalJs(`(() => {
    const el = document.querySelector('${sel}'); if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))});
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true;
  })()`);
  /* S4 契约：保存只写参数；旧用例需要结果时再点顶部 ④「分析」。 */
  const saveAndWait = async () => {
    await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(220);
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
    await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 400);
    await wait(400);
  };
  const clickResultNav = async (nav) => {
    for (let i = 0; i < 25; i++) {
      await evalJs(`(() => { const b = document.querySelector('#dc_resultNav [data-nav="${nav}"]');
        if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); })()`);
      await wait(250);
      if (await evalJs(`document.querySelector('#dc_resultNav .on')?.dataset.nav || ''`) === nav) return true;
    }
    return false;
  };
  const goResults = async (nav) => {
    await evalJs(`document.querySelector('#dc_run')?.click()`);
    await poll(`document.querySelector('#dc_resultActive') ? 1 : 0`, 15000, 200);
    if (nav) {
      await poll(`document.querySelector('#dc_resultNav [data-nav="${nav}"]') ? 1 : 0`, 15000, 200);
      await clickResultNav(nav);
      await wait(400);
    }
  };
  const ensureModel = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(400);
    }
  };
  const textOf = (sel) => evalJs(`(document.querySelector('${sel}')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
  const statPairs = async (sel) => JSON.parse(await evalJs(`(() => {
    const box = document.querySelector('${sel}'); if (!box) return '[]';
    return JSON.stringify([...box.querySelectorAll('.dc-stat')].map(d => [
      (d.querySelector('div')?.textContent || '').trim(),
      (d.querySelector('.dc-stat-v')?.textContent || '').trim()]));
  })()`));

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1600);
  await viewport(1366, 900);

  /* ---------- 1 · 参数面板结构 ---------- */
  console.log('\n【结构】参数面板重整');
  await importStl('cube50.stl');
  const imported = await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 700);
  check('cube50 导入与分析完成', !!imported);

  await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(500);
  const cond = JSON.parse(await evalJs(`(() => {
    const flds = [...document.querySelectorAll('#dc_sec_cond .dc-dlg-fld')];
    return JSON.stringify({
      editable: flds.filter(f => f.querySelector('input,select')).map(f => f.querySelector('[data-pf]')?.dataset.pf).filter(Boolean),
      readonlyRows: flds.filter(f => f.querySelector('.dc-dlg-ro')).length,
      modelLink: !!document.querySelector('#dc_sec_cond [data-goto-model]'),
    }); })()`));
  check('② 分析条件只保留必要前置字段（材料/壁厚/毛坯重/单位）',
    ['material.family', 'process.wallUsed', 'geometry.blankWeightKg', 'geometry.unit'].every(p => cond.editable.includes(p))
    && cond.editable.length === 4, JSON.stringify(cond.editable));
  check('② 不再重复铺开 5 个只读几何值，改为跳转 ① 模型信息',
    cond.readonlyRows === 0 && cond.modelLink === true, JSON.stringify(cond));

  await setInput('[data-pf="material.family"]', '灰铁'); await wait(300);
  await openField('production.cavities');
  const gatingStructure = JSON.parse(await evalJs(`(() => {
    const sec = document.querySelector('#dc_sec_gating');
    const sub = sec?.querySelector('.dc-dlg-subhead[data-group="prod"]');
    const rh = sec?.querySelector('[data-rh-linked]');
    const fields = [...sec.querySelectorAll('[data-pf]')].map(e => e.dataset.pf);
    const subTop = sub ? sub.getBoundingClientRect().top : null;
    const rhTop = rh ? rh.getBoundingClientRect().top : null;
    return JSON.stringify({
      prodFirst: subTop != null && rhTop != null && subTop < rhTop,
      hasRh: !!rh && !!rh.querySelector('input[data-pf="process.riserHeight"]'),
      fields,
      hasEditNote: (sec?.textContent || '').includes('结果页'),
    }); })()`));
  check('③ 生产条件（型腔数/预估出品率/造型线/铸造方法）置顶',
    gatingStructure.prodFirst === true, JSON.stringify({ prodFirst: gatingStructure.prodFirst }));
  check('③ RH 是同一 process.riserHeight 的可编辑权威值',
    gatingStructure.hasRh === true);
  check('③ 内浇道/横浇道/排气已移到结果页，参数面板不再重复入口',
    !gatingStructure.fields.some(p => ['process.gateThk', 'production.ingateN', 'process.runnerThk', 'production.runnerN', 'process.ventD'].includes(p))
    && gatingStructure.hasEditNote === true, gatingStructure.fields.join(', '));

  await evalJs(`document.querySelector('[data-ptab="riser"]')?.click()`); await wait(300);
  const hdUi = JSON.parse(await evalJs(`(() => {
    const s = document.querySelector('[data-pf="process.hdRatio"]');
    return JSON.stringify({ exists: !!s, value: s?.value || '', hidden: !!(s && s.closest('[data-hd-field]')?.hidden),
      opts: s ? [...s.options].map(o => o.value) : [] });
  })()`));
  check('③ 冒口设计提供 H/D 四档（默认 1.0，非只读）',
    hdUi.exists && !hdUi.hidden && hdUi.value === '1.0'
    && ['0.8', '1.0', '1.2', '1.5'].every(v => hdUi.opts.includes(v)), JSON.stringify(hdUi));

  /* ---------- 2 · 1 / 2 / 4 腔整模口径 ---------- */
  console.log('\n【出品率】1 / 2 / 4 腔整模账目');
  await openField('production.cavities');
  await setInput('[data-pf="production.cavities"]', '1');
  await setInput('[data-pf="material.yieldSug"]', '75');
  await saveAndWait();
  await goResults('gating');
  const blankWt = await project(`p.getV('geometry.blankWeightKg')`);
  const readLedger = async () => {
    const sec = await evalJs(`(() => {
      const s = [...document.querySelectorAll('#dc_resultActive .dc-result-sec')]
        .find(x => (x.querySelector('.dc-sec-title')?.textContent || '').includes('经典浇注系统设计'));
      return s ? s.textContent.replace(/\\s+/g, ' ') : '';
    })()`);
    return sec;
  };
  const t1 = await readLedger();
  check('浇注结果页给出设计预估出品率，不把恒等反推标成“实际出品率”',
    t1.includes('设计预估出品率') && t1.includes('铸件重 ÷ G（恒等反算，不是实重统计）')
    && !t1.includes('最终实重出品率') && t1.includes('实际出品率请用本厂实绩'), '');
  check('整模账目不再展示工具推算的实际出品率，并给出人工回算入口',
    t1.includes('整模重量口径核对') && !t1.includes('最终实重出品率') && !t1.includes('暂不能给出')
    && t1.includes('实际出品率请用本厂实绩'), '');
  check('结果页状态条显示“当前结果有效”',
    (await textOf('[data-res-status]')).includes('当前结果有效'));

  /* ---------- 3a · 结果页只读/去修改（先在 riser 页验证，再进入多腔循环） ---------- */
  console.log('【闭环】结果页只读/去修改');
  await clickResultNav('riser');
  const shapeUi = await evalJs(`(() => ({
    ws: document.querySelector('#dc_ws')?.dataset.wsview,
    navActive: document.querySelector('#dc_resultNav .on')?.dataset.nav || '',
    navKeys: [...document.querySelectorAll('#dc_resultNav [data-nav]')].map(b => b.dataset.nav),
    hasSelect: !!document.querySelector('#dc_riserShape'),
    readonly: !!document.querySelector('#dc_resultActive [data-shape-readonly]'),
    editBtn: !!document.querySelector('#dc_resultActive [data-edit-param="process.riserShape"]'),
  }))()`);
  check('结果页无第二形状下拉，提供“去冒口设计修改”', !shapeUi.hasSelect && shapeUi.readonly && shapeUi.editBtn, JSON.stringify(shapeUi));
  await evalJs(`document.querySelector('#dc_resultActive [data-edit-param="process.riserShape"]')?.click()`); await wait(700);
  const back = await evalJs(`(() => ({
    ws: document.querySelector('#dc_ws')?.dataset.wsview,
    panel: !document.querySelector('#dc_taskPanel')?.hidden,
    tab: document.querySelector('[data-ptab].on')?.dataset.ptab || '',
    focus: document.activeElement?.dataset?.pf || '',
  }))()`);
  check('“去冒口设计修改”回到模型视图并打开冒口设计（定位到形状字段）',
    back.ws === 'model' && back.panel && back.tab === 'riser' && back.focus === 'process.riserShape', JSON.stringify(back));
  await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(300);

  for (const cav of [2, 4]) {
    await ensureModel();
    await openField('production.cavities');
    await setInput('[data-pf="production.cavities"]', String(cav));
    await saveAndWait();
    await goResults('gating');
    const pairs = await statPairs('[data-gating-prod]');
    const get = (k) => pairs.find(([a]) => a.includes(k))?.[1] || '';
    const blankShown = parseFloat(get('整模铸件毛坯重'));
    check(`cav=${cav} · 型腔数显示正确`, get('型腔数') === `${cav} 件`, get('型腔数'));
    check(`cav=${cav} · 整模铸件毛坯重 = 单件 × ${cav}`,
      Math.abs(blankShown - blankWt * cav) < 0.011, `${get('整模铸件毛坯重')} vs ${blankWt * cav} kg`);
  }

  /* ---------- 3 · 结果页状态闭环 ---------- */
  console.log('【闭环】结果页状态');
  await ensureModel();
  await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 30000, 400);
  await wait(1200);
  await goResults('gating');
  const gtBefore = await project(`p.getV('runner.result')?.gt`);
  await evalJs(`(() => { const el = document.querySelector('#dc_gtEdit'); if (!el) return 0;
    el.value = String(${Number(gtBefore) + 1}); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  const staleStatus = await textOf('[data-res-status]');
  check('结果页内联改参数 → 状态条立即变为待重新分析', staleStatus.includes('待重新分析') && staleStatus.includes('上一次'), staleStatus.slice(0, 70));
  await poll(`(document.querySelector('[data-res-status]')?.textContent || '').includes('当前结果有效') ? 1 : 0`, 30000, 400);
  check('重新分析成功后状态条恢复“当前结果有效”',
    (await textOf('[data-res-status]')).includes('当前结果有效'));

  /* ---------- 4 · RH 手动指定 + 换 STL 保留 + 显式提示 ---------- */
  console.log('\n【RH】手动指定与换模型保留');
  await ensureModel();
  await openField('process.riserHeight');
  await setInput('[data-pf="process.riserHeight"]', '222');
  await saveAndWait();
  const rhSaved = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src, rh: p.getV('runner.result')?.rh })`);
  check('RH=222 保存后进入浇注链，来源 USER_OVERRIDE',
    Math.abs(rhSaved.v - 222) < 1e-9 && Math.abs(rhSaved.rh - 222) < 1e-9 && rhSaved.src === 'USER_OVERRIDE', JSON.stringify(rhSaved));

  await importStl('plate20.stl');
  const reimported = await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 700);
  const toastSeen = await poll(`(document.querySelector('.toast')?.textContent || '').includes('手动指定的 RH 已保留') ? 1 : 0`, 15000, 150);
  const toastNow = await textOf('.toast');
  const rhAfterStl = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src })`);
  check('换 STL 后手动 RH 保留（不被静默清除）',
    !!reimported && Math.abs(rhAfterStl.v - 222) < 1e-9 && rhAfterStl.src === 'USER_OVERRIDE', JSON.stringify(rhAfterStl));
  check('换 STL 完成后显式提示复核 RH', !!toastSeen, toastNow);
  await openField('process.riserHeight');
  const rhPanel = await textOf('[data-rh-linked]');
  check('面板如实标出“用户指定”，并提示换模型后仍保留/需复核',
    rhPanel.includes('用户指定') && rhPanel.includes('更换 STL 后') && rhPanel.includes('复核'), rhPanel.slice(0, 100));

  /* ---------- 4a · 深色主题可读性 ---------- */
  const darkInfo = await evalJs(`(() => {
    const btn = document.querySelector('#themeBtn');
    for (let i = 0; i < 4 && document.documentElement.getAttribute('data-theme') !== 'dark'; i++) btn?.click();
    const panel = document.querySelector('#dc_taskPanel');
    const cs = panel ? getComputedStyle(panel) : null;
    return JSON.stringify({ theme: document.documentElement.getAttribute('data-theme'),
      bg: cs?.backgroundColor || '', fg: cs?.color || '' });
  })()`);
  const dk = JSON.parse(darkInfo);
  check('深色主题下参数面板可读（非白底、前景与背景不同）',
    dk.theme === 'dark' && dk.bg !== 'rgb(255, 255, 255)' && dk.bg !== dk.fg, darkInfo);

  /* ---------- 4b · 保存失败注入（不污染项目：只在内存冻结一个参数条目，随后 reload） ---------- */
  console.log('【保存失败】注入测试');
  await ensureModel();
  await openField('process.wallUsed');
  const wallBefore = await project(`p.getV('process.wallUsed')`);
  const frozen = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    const e = p.get('process.wallUsed'); if (!e) return false; Object.freeze(e); return true; })()`);
  await setInput('[data-pf="process.wallUsed"]', String(wallBefore + 1));
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(500);
  const failToast = await textOf('.toast');
  const failHint = await textOf('#dc_taskHint');
  const wallAfter = await project(`p.getV('process.wallUsed')`);
  check('保存失败：显式提示且不清草稿、不触发分析',
    !!frozen && failToast.includes('保存失败') && failToast.includes('草稿') && failHint.includes('尚未保存')
    && Math.abs(wallAfter - wallBefore) < 1e-9, `${failToast}｜hint=${failHint}｜${wallBefore}→${wallAfter}`);
  await send('Page.reload'); await wait(1800);

  /* ---------- 5 · 响应式 / 无异常 ---------- */
  await viewport(390, 844, true); await wait(400);
  const overflow = await evalJs(`(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('#view *')) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1.5) continue;
      // 只要祖先已经裁剪（hidden/auto/scroll），就不会造成页面横向溢出
      let clipped = false;
      for (let p = el; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'hidden' || ox === 'auto' || ox === 'scroll') { clipped = true; break; }
      }
      if (!clipped) bad.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className : ''));
    }
    return JSON.stringify({ doc: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 3) });
  })()`);
  const ov = JSON.parse(overflow);
  check('390px 移动端无横向溢出', ov.doc <= ov.vw + 1 && ov.bad.length === 0, overflow);
  await viewport(1366, 900);

  console.log('\n运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  if (exceptions.length) failures++;
  console.log(`\nS3 验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  process.exit(failures ? 1 : 0);
}
