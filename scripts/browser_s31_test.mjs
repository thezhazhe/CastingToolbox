// ============================================================
// R6-S3.1（154.txt）· RH 归属 / 提示分级 / 三段结果 / 结果—报告一致性
// 用法: node scripts/browser_s31_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9271;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_s31');
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
    await wait(500);
    /* S5-03：分析成功后自动进入结果视图；后续还要继续编辑参数 → 回到模型视图。
       （保留旧用例“保存 → 分析 → 继续改参数”的链路语义。） */
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview === 'results'`)) {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(400);
    }
  };
  const goResults = async (nav) => {
    await evalJs(`document.querySelector('#dc_run')?.click()`);
    await poll(`document.querySelector('#dc_resultActive') ? 1 : 0`, 15000, 200);
    if (nav) {
      await poll(`document.querySelector('#dc_resultNav [data-nav="${nav}"]') ? 1 : 0`, 15000, 200);
      await evalJs(`document.querySelector('#dc_resultNav [data-nav="${nav}"]')?.click()`);
      await wait(500);
    }
  };
  const backToModel = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(400);
    }
  };
  const textOf = (sel) => evalJs(`(document.querySelector('${sel}')?.textContent || '').replace(/\\s+/g, ' ').trim()`);
  const activeText = () => textOf('#dc_resultActive');

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1600);
  await viewport(1366, 900);

  /* ---------- 0 · 初始导入与参数 ---------- */
  await importStl('cube50.stl');
  const imported = await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 700);
  check('cube50 导入与分析完成', !!imported);
  /* 用代表性重量触发“旧体积参考不足”的 P1（否则 50mm 立方体太轻，旧模型会通过） */
  await project(`(() => { p.set('geometry.netWeightKg', 500, 'USER_OVERRIDE', 'USER_CONFIRMED');
    p.set('geometry.blankWeightKg', 500, 'USER_OVERRIDE', 'USER_CONFIRMED'); return true; })()`);
  await openField('material.family');
  await setInput('[data-pf="material.family"]', '灰铁');
  await openField('production.cavities');
  await setInput('[data-pf="production.cavities"]', '2');
  await setInput('[data-pf="material.yieldSug"]', '75');
  await openField('process.riserHeight');
  await setInput('[data-pf="process.riserHeight"]', '80');
  await saveAndWait();

  /* ---------- 1 · RH 位置、状态与测量基准 ---------- */
  console.log('\n【RH】归属 / 状态 / 测量基准');
  await openField('process.riserHeight');
  const rhUi = await evalJs(`(() => {
    const ph = document.querySelector('[data-pf="process.ph"]');
    const rh = document.querySelector('[data-pf="process.riserHeight"]');
    const wrap = document.querySelector('[data-rh-linked]');
    const rp = ph?.getBoundingClientRect(), rr = rh?.getBoundingClientRect();
    return {
      afterPh: !!rp && !!rr && (rr.top > rp.top || (Math.abs(rr.top - rp.top) < 2 && rr.left > rp.left)),
      sameGrid: !!ph && !!rh && ph.closest('.dc-dlg-grid') === rh.closest('.dc-dlg-grid'),
      manual: wrap?.dataset.rhManual,
      badge: wrap?.querySelector('.dc-rh-badge')?.textContent || '',
      hasFig: !!wrap?.querySelector('.dc-rh-fig'),
      hasHelp: !!wrap?.querySelector('.dc-rh-help'),
      refBtn: !!wrap?.querySelector('[data-rh-use-ref]'),
      p1: !!wrap?.querySelector('.dc-hint-p1'),
    };
  })()`);
  check('RH 紧接在 PH 之后、同一参数网格（154 §五.2）', rhUi.afterPh && rhUi.sameGrid, JSON.stringify(rhUi));
  check('RH 显示“用户指定”，不再显示“冒口计算自动值”', rhUi.manual === '1' && rhUi.badge.includes('用户指定'), rhUi.badge);
  check('RH 保留“采用参考值”入口与简短提示；长图/长说明已移除（S7）',
    rhUi.refBtn && rhUi.hasFig === false && rhUi.hasHelp === false, JSON.stringify(rhUi));
  const rhAfter = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src, rh: p.getV('runner.result')?.rh, riserH: p.getV('risers.items')?.[0]?.H })`);
  check('保存后 RH 未被冒口总高静默覆盖（唯一权威值）',
    Math.abs(rhAfter.v - 80) < 1e-9 && Math.abs(rhAfter.rh - 80) < 1e-9 && rhAfter.src === 'USER_OVERRIDE', JSON.stringify(rhAfter));
  check('RH 与冒口总高 H 是两个字段（当前案例不相等）',
    rhAfter.riserH != null && Math.abs(rhAfter.riserH - 80) > 0.01, JSON.stringify(rhAfter));

  /* ---------- 2 · 冒口变化后提示复核 RH ---------- */
  await openField('process.mcHotspot');
  await setInput('[data-pf="process.mcHotspot"]', '20');
  await saveAndWait();
  const reviewToast = await textOf('.toast');
  const rhStill = await project(`({ v: p.getV('process.riserHeight'), src: p.get('process.riserHeight')?.src, h: p.getV('risers.items')?.[0]?.H })`);
  check('冒口方案变化后 RH 保持用户值，并提示复核',
    Math.abs(rhStill.v - 80) < 1e-9 && reviewToast.includes('RH') && reviewToast.includes('复核'), `${JSON.stringify(rhStill)}｜${reviewToast}`);

  /* ---------- 3 · 浇注结果三段 + 风险条 ---------- */
  console.log('\n【结果页】三段卡片 / 风险条 / 最终出品率');
  await goResults('gating');
  const gatingUi = await evalJs(`(() => {
    const areas = [...document.querySelectorAll('.dc-gating-areas .dc-gating-area')];
    const vent = document.querySelector('#dc_ventD');
    const risk = document.querySelector('[data-risk-strip]');
    const core = [...document.querySelectorAll('#dc_resultActive .dc-core-card')]
      .find(c => (c.querySelector('.dc-core-label')?.textContent || '').includes('预计浇铸重量'));
    return {
      areaCount: areas.length,
      areaHeads: areas.map(a => (a.querySelector('.dc-edit-head')?.textContent || '').trim()),
      ventInDetails: !!vent?.closest('details'),
      riskText: (risk?.textContent || '').replace(/\\s+/g, ' ').trim(),
      rhText: [...document.querySelectorAll('#dc_resultActive .dc-hint-line')].map(x => x.textContent).join(' '),
      gText: core?.querySelector('.dc-core-value')?.textContent || '',
      hasFinalYield: (document.querySelector('#dc_resultActive')?.textContent || '').includes('最终实重出品率'),
      hasManualYield: (document.querySelector('#dc_resultActive')?.textContent || '').includes('实际出品率请用本厂实绩'),
      hasRH: (document.querySelector('#dc_resultActive')?.textContent || '').includes('RH（浇注系统用）'),
    };
  })()`);
  check('浇注结果按直/横/内三段统一卡片（3 张）',
    gatingUi.areaCount === 3 && gatingUi.areaHeads.some(x => x.includes('直浇道')) && gatingUi.areaHeads.some(x => x.includes('横浇道')) && gatingUi.areaHeads.some(x => x.includes('内浇道')),
    JSON.stringify(gatingUi.areaHeads));
  check('排气参数在次级折叠区，不占主结果卡', gatingUi.ventInDetails === true);
  check('顶部风险条只保留 P0；旧体积/自动 Mc/最终出品率不再进入风险条',
    !gatingUi.riskText.includes('旧体积') && !gatingUi.riskText.includes('最终实重出品率')
    && !gatingUi.riskText.includes('自动估计值') && gatingUi.rhText.includes('用户指定'), gatingUi.riskText.slice(0, 160));
  check('结果页不再展示工具推算的实际出品率，并给出人工回算指引',
    gatingUi.hasFinalYield === false && gatingUi.hasManualYield === true, JSON.stringify({ hasFinalYield: gatingUi.hasFinalYield, hasManualYield: gatingUi.hasManualYield }));
  const gValue = gatingUi.gText;

  /* ---------- 4 · 报告与结果页一致 ---------- */
  console.log('\n【报告】状态 / RH / 三段 / 整模账目');
  await evalJs(`(() => { window.__rep = ''; const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { try { b.text().then(t => { window.__rep = t; }); } catch (e) {} return orig(b); };
    return true; })()`);
  await evalJs(`document.querySelector('#dc_report')?.click()`);
  const rep = await poll(`window.__rep && window.__rep.length > 1200 ? window.__rep : ''`, 15000, 300);
  const repText = String(rep || '');
  check('报告含结果有效性状态（与结果页同一来源）',
    repText.includes('0. 结果有效性') && repText.includes('当前结果有效'), repText.slice(0, 80));
  check('报告含 RH / 直横内三段 / 整模重量账目，且不再展示推算的实际出品率',
    repText.includes('RH（冒口顶面高出铸件顶面）') && repText.includes('直浇道 S') && repText.includes('横浇道 R')
    && repText.includes('内浇道 G') && repText.includes('整模重量口径与出品率')
    && !repText.includes('最终实重出品率') && repText.includes('当前为工艺预估值'));
  const gNum = String(gValue).replace(/[^0-9.]/g, '');
  check('报告浇注重量与结果页“预计浇铸重量”核心卡一致',
    !!gNum && repText.includes(gNum + ' kg'),
    `page=${gValue}｜num=${gNum}`);
  check('报告无 undefined / NaN / 旧的多腔错误出品率',
    !/undefined|NaN/.test(repText) && !repText.includes('32.5%'), '');

  /* ---------- 5 · 球形只展示一个尺寸自由度 ---------- */
  console.log('\n【球形】尺寸字段');
  await backToModel();
  await openField('process.riserShape');
  await setInput('[data-pf="process.riserShape"]', 'sphere');
  await saveAndWait();
  await goResults('riser');
  const sphereUi = await evalJs(`(() => {
    const active = document.querySelector('#dc_resultActive');
    const stats = [...active.querySelectorAll('.dc-stats .dc-stat')].map(s => (s.querySelector('div')?.textContent || '').trim());
    return {
      text: (active?.textContent || '').replace(/\\s+/g, ' '),
      stats,
      hasH: stats.some(x => x.includes('冒口高度 H')),
      hasD: stats.some(x => x.includes('冒口球径 D')),
      sphereNote: (active?.textContent || '').includes('球形由球径唯一确定'),
    };
  })()`);
  check('球形结果只显示球径，不再把 H 当第二尺寸', sphereUi.hasD && !sphereUi.hasH && sphereUi.sphereNote, JSON.stringify(sphereUi.stats));

  /* ---------- 6 · Page1 核心卡去冗长信息 ---------- */
  console.log('\n【Page1】卡片信息密度');
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]')?.click()`); await wait(500);
  const p1Ui = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('#dc_resultActive .dc-core-card')];
    const card = cards.find(c => (c.querySelector('.dc-core-label')?.textContent || '').includes('最小壁厚'));
    const all = document.querySelector('#dc_resultActive');
    const details = all?.querySelector('details');
    return {
      core: card?.querySelector('.dc-core-value')?.textContent?.trim() || '',
      details: (details?.textContent || '').replace(/\\s+/g, ' '),
    };
  })()`);
  check('最小壁厚核心卡只保留“数值 + 单位”',
    /^[0-9.]+[~\-][0-9.]+ mm$/.test(p1Ui.core) && !p1Ui.core.includes('砂型档') && !p1Ui.core.includes('灰铸铁'), p1Ui.core);
  check('材料/轮廓/砂型档完整依据仍在详细信息', p1Ui.details.includes('砂型档') && p1Ui.details.includes('灰铸铁'), p1Ui.details.slice(0, 100));

  /* ---------- 7 · RH 过大导致 Hp≤0：分析失败，旧结果不得冒充有效 ---------- */
  console.log('\n【失败闭环】RH 过大');
  await backToModel();
  await openField('process.pourPos');
  await setInput('[data-pf="process.pourPos"]', '中注');
  await openField('process.riserHeight');
  await setInput('[data-pf="process.riserHeight"]', '400');
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(220);
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  const failedStatus = await poll(`(() => {
    const t = (document.querySelector('[data-res-status]')?.textContent || '') + ' ' + (document.querySelector('#dc_stateChip')?.textContent || '');
    return /分析未完成|分析失败/.test(t) ? t.replace(/\\s+/g, ' ').trim() : '';
  })()`, 30000, 400);
  check('RH 过大（Hp≤0）被明确记为分析失败，而不是给出有效结果',
    !!failedStatus && /分析未完成|分析失败/.test(failedStatus), failedStatus.slice(0, 180));
  check('失败状态给出 Hp ≤ 0 的具体原因',
    (failedStatus || '').includes('Hp') && (failedStatus || '').includes('0'), failedStatus.slice(0, 180));

  /* ---------- 8 · 恢复有效 + 英文界面 ---------- */
  console.log('\n【英文】结果与风险文案');
  await openField('process.riserHeight');
  await setInput('[data-pf="process.riserHeight"]', '80');
  await openField('process.pourPos');
  await setInput('[data-pf="process.pourPos"]', '顶注');
  await saveAndWait();
  await goResults('gating');
  await evalJs(`document.querySelector('[data-lang="en-US"]')?.click()`); await wait(800);
  const enUi = await evalJs(`(() => {
    const t = document.querySelector('#dc_resultActive')?.textContent || '';
    const risk = document.querySelector('[data-risk-strip]')?.textContent || '';
    return { title: document.querySelector('#dc_resultActive .dc-sec-title')?.textContent || '', risk: risk.replace(/\\s+/g, ' ').trim(), hasZhRisk: /旧体积模型参考不足|RH 未指定/.test(risk) };
  })()`);
  check('英文界面结果标题与风险条已翻译（无残留中文风险文案）',
    enUi.title.includes('Classic Gating System Design') && !enUi.hasZhRisk, JSON.stringify(enUi).slice(0, 220));
  await evalJs(`document.querySelector('[data-lang="zh-CN"]')?.click()`); await wait(600);

  /* ---------- 9 · 390px 无横向溢出 ---------- */
  console.log('\n【响应式】390px');
  await viewport(390, 844, true); await wait(500);
  const overflow = await evalJs(`(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    for (const el of document.querySelectorAll('#view *')) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= vw + 1.5) continue;
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
  check('390px 浇注结果/风险条无横向溢出', ov.doc <= ov.vw + 1 && ov.bad.length === 0, overflow);
  await viewport(1366, 900);

  console.log('\n运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  if (exceptions.length) failures++;
  console.log(`\nS3.1 验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  process.exit(failures ? 1 : 0);
}
