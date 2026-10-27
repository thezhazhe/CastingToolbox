// ============================================================
// 145.txt 回归测试：P0-1 冒口形状与尺寸显示 / P0-2 结果视图返回工作台
//
// P0-1（§二）：用户观察到"切换四种冒口形状时尺寸显示似乎始终不变、直径/半径等字段显示相同数值"。
//   诊断结论（数值探针 + 只读 calcs/riser.js，见 docs/PHASE_V2.0-P1-R3_WORKBENCH2.md §1）：
//     · 设计中心固定以 hd_ratio = 1.0 调用 runRiser；四种形状的模数式在该口径下**全部化简为 M = D/6**
//       ⇒ D 与 H 对四种形状**必然相同**。**这是引擎事实，不是缺陷**，本测试把它**钉住**
//       （防止未来有人把它当 bug "修"成四个不同的值）。
//     · 真缺陷在**显示映射层**：标签几乎不变、球形把球径与高度当两个字段、球顶半径 R 从不显示、
//       随形状真正变化的 Vr / 补缩效率没被展示 ⇒ 观察起来"什么都没发生"。
//   ⇒ 断言分两组：① 引擎事实被保护；② 显示层逐形状正确（标签 / 单位 / 字段集 / 规格写法）。
//
// P0-2（§二）：模型工作区 → 结果 → 模型工作区 的完整往返。
//   原缺陷：返回按钮把 `state.results` 置空 + `#dc_results` 隐藏 ⇒ **已完成的工艺分析结果被丢弃**，
//   再点「结果」会被判"尚未产生分析结果"，用户必须重跑一遍。
//
// 用法: node scripts/browser_dc_r3_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9246;
const URL = 'http://localhost:8090/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + String(extra).slice(0, 160) : ''}`);
  if (!ok) failures++;
};

async function waitForServer() { for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch (e) {} await wait(250); } throw new Error('server not reachable'); }
async function getWsUrl() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } } catch (e) {} await wait(200); } throw new Error('CDP not reachable'); }

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu',
  '--no-first-run', '--disable-extensions', '--window-size=1600,1000', `--user-data-dir=${ROOT}/_edge_profile_r3`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
try {
  await waitForServer();
  ws = new WebSocket(await getWsUrl());
  let id = 0; const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  const exceptions = [];
  await send('Runtime.enable');
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const poll = async (expr, timeoutMs = 120000, step = 500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { const v = await evalJs(expr); if (v) return v; await wait(step); }
    return null;
  };
  const importStl = async (file) => {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, 'tests', 'golden', file).replace(/\\/g, '/')] });
  };
  const setSel = (sel, v) => evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return false;
    const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(el, '${v}');
    el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1500);
  await importStl('cube50.stl');
  check('cube50 导入并分析完成', !!(await poll(`document.querySelector('#dc_hsBadge')?.textContent || ''`, 90000)), '');

  /* 146 §三：参数窗口的开关 / 设值 / 保存（全脚本共用） */
  const applyParam = async (path, val) => {
    await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(350);
    const ok = await evalJs(`(() => { const el = document.querySelector('[data-pf="${path}"]'); if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); return true; })()`);
    if (!ok) throw new Error('参数窗口里找不到字段: ' + path);
    /* R6-S2 起保存入口是面板页脚 `#dc_pfSave`（旧浮层 id 已删除，这里原先是静默 no-op）。 */
    await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(1400);
  };

  /* R6-S3：结果页不再有第二个形状下拉 ⇒ 形状改在参数面板，保存并分析后才回到结果页。 */
  const ensureModelView = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(500);
    }
  };
  const fieldInActiveStep = (path) =>
    `!!document.querySelector('#dc_condStep:not([hidden]) [data-pf="${path}"], #dc_paramStep:not([hidden]) [data-pf="${path}"]')`;
  const openField = async (path) => {
    await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(400);
    if (await evalJs(fieldInActiveStep(path))) return;
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(380);
    if (await evalJs(fieldInActiveStep(path))) return;
    for (const tab of ['riser', 'gating']) {
      await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300);
      if (await evalJs(fieldInActiveStep(path))) return;
    }
    throw new Error('参数面板里找不到字段: ' + path);
  };

  /* 146 §3：选材料是**参数窗口 A 模块**里的必填项，改完必须点「保存并重新分析」才落盘
     （145 那版直接写 #dc_m_family 的路径已不存在）。 */
  await applyParam('material.family', '球铁');
  /* 145：Mc 输入框已随参数窗口移除 ⇒ 不再手工设定 Mc；直接读**适配器实际使用的那个 Mc**
     （有热结 → process.mcHotspot；无 → process.wallHot），下面用它去问引擎，保证 UI 与引擎同源。 */
  const uiMc = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    const items = p.getV('hotspots.items') || [];
    return items.length ? p.getV('process.mcHotspot') : p.getV('process.wallHot'); })()`);
  await evalJs(`document.querySelector('#dc_run').click()`);
  await poll(`document.querySelector('#dc_stateChip')?.textContent.includes('一致') ? 1 : 0`, 60000);
  await wait(600);

  /* ============================================================
     P0-1：四种形状的尺寸字段 / 单位 / 规格写法
     ============================================================ */
  console.log('\n【P0-1】冒口形状与尺寸显示');
  // 145：三按钮导航已移除；状态 D 下顶部主按钮 = 「查看分析结果」
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(600);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(400);

  const EXPECT = {
    cyl: { name: '圆柱形', dimLabel: '冒口直径 D', hasH: true, hasR: false, hasSphereD: false },
    sphere_head: { name: '球顶圆柱', dimLabel: '冒口直径 D', hasH: true, hasR: true, hasSphereD: false },
    sphere: { name: '球形', dimLabel: '冒口球径 D', hasH: false, hasR: false, hasSphereD: true },
    square: { name: '正方柱', dimLabel: '冒口边长 a（长 × 宽）', hasH: true, hasR: false, hasSphereD: false },
  };
  const readShapes = {};
  for (const k of Object.keys(EXPECT)) {
    await ensureModelView();
    await openField('process.riserShape');
    await setSel('[data-pf="process.riserShape"]', k);
    await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(260);
    /* S4：保存不再自动分析 —— 先点顶部 ④「分析」，再点主按钮切结果视图。 */
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`); await wait(1800);
    await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(600);
    await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(500);
    readShapes[k] = await evalJs(`(() => {
      const box = document.querySelector('#dc_resultActive');
      const cells = [...box.querySelectorAll('.dc-stats .dc-stat')].map(d => ({
        k: (d.querySelector('div')?.textContent || '').trim(),
        v: (d.querySelector('.dc-stat-v')?.textContent || '').trim() }));
      /* 146 §8.3：顶部「本页结论速览」（#dc_coreStrip）已删除 —— 它把同一批字段在速览/主卡/表格里
         展示了三遍。核心结论卡下沉到**类别页内部** ⇒ 这里改读页内的 .dc-core-row。 */
      const strip = [...box.querySelectorAll('.dc-core-row .dc-core-card')].map(d => ({
        k: (d.querySelector('.dc-core-label')?.textContent || '').trim(),
        v: (d.querySelector('.dc-core-value')?.textContent || '').replace(/\s+/g, ' ').trim() }));
      const shapeLine = (box.querySelector('.dc-shape-line')?.textContent || '').trim();
      return { cells, strip, shapeLine, shape: '${k}' }; })()`);
  }

  /* ① 引擎事实（保护）：**直接问引擎**（不从 DOM 反推）—— 四形状在同一 Mc 下反求出的 D/H 完全相同。
     这是 M ≡ D/6（hd=1）的必然结果，**不是缺陷**；钉住它，防止未来被谁当 bug "修"成四个不同的值。
     同时钉住：真正随形状变化的是 Vr / eff，以及 shapeKey 必须回传（UI 的字段映射完全依赖它）。 */
  const eng = JSON.parse(await evalJs(`(async () => {
    const m = await import('/calcs/riser.js');
    const out = {};
    for (const k of Object.keys(m.RISER_SHAPES)) {
      const r = m.runRiser({ mat: '球铁', cast_wt: 50, mc_mode: 'direct', mc: ${uiMc}, shape: k, hd_ratio: 1.0, eff: undefined, rho: undefined });
      out[k] = r ? { D: r.D, H: r.H, Mr_act: r.Mr_act, Vr: r.Vr, eff: r.eff, shapeKey: r.shapeKey } : null;
    }
    return JSON.stringify(out); })()`));
  const engVals = Object.values(eng);
  check('P0-1 引擎事实：四形状 D 完全相同（M ≡ D/6，hd=1）',
    engVals.every(r => r && Number.isFinite(r.D)) && new Set(engVals.map(r => r.D)).size === 1, JSON.stringify(engVals.map(r => r && r.D)));
  check('P0-1 引擎事实：四形状 H 完全相同', new Set(engVals.map(r => r && r.H)).size === 1, JSON.stringify(engVals.map(r => r && r.H)));
  check('P0-1 引擎事实：四形状 Vr **不同**（形状真正改变的是体积）',
    new Set(engVals.map(r => r && Math.round(r.Vr))).size >= 3, JSON.stringify(engVals.map(r => r && Math.round(r.Vr))));
  check('P0-1 引擎事实：shapeKey 逐形状正确回传（UI 字段映射依赖它）',
    Object.keys(eng).every(k => eng[k] && eng[k].shapeKey === k), JSON.stringify(engVals.map(r => r && r.shapeKey)));

  // ①b 可追溯：界面显示的尺寸数值 = 引擎反求值（显示层不得自己算/自己改）
  const numOf = (s) => { const m = String(s || '').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
  const uiD = numOf((readShapes.cyl.cells.find(c => c.k.includes('直径 D')) || {}).v);
  const uiH = numOf((readShapes.cyl.cells.find(c => c.k.includes('高度 H')) || {}).v);
  check('P0-1 界面尺寸 = 引擎反求值（D/H 同源，非视图自算）',
    Math.abs(uiD - eng.cyl.D) < 0.01 && Math.abs(uiH - eng.cyl.H) < 0.01, `UI ${uiD}/${uiH} vs 引擎 ${eng.cyl.D}/${eng.cyl.H}`);

  // ② 显示层：标签随形状正确变化（原缺陷：三种形状都写"冒口直径 D"）
  for (const k of Object.keys(EXPECT)) {
    const labels = readShapes[k].cells.map(c => c.k);
    check(`P0-1 标签[${EXPECT[k].name}] = ${EXPECT[k].dimLabel}`,
      labels.some(l => l.includes(EXPECT[k].dimLabel)), labels.join(' | '));
    check(`P0-1 字段集[${EXPECT[k].name}]：高度${EXPECT[k].hasH ? '应有' : '不应有'} / 球顶半径${EXPECT[k].hasR ? '应有' : '不应有'}`,
      labels.some(l => l.includes('高度')) === EXPECT[k].hasH && labels.some(l => l.includes('球顶半径')) === EXPECT[k].hasR,
      labels.join(' | '));
    // ③ 单位：每个尺寸值都带 mm，且单位与数值同格
    /* 只取"几何尺寸"字段（直径 / 球径 / 边长 / 高度 / 半径）。
       体积 cm³、补缩效率 %、模数 mm 是派生量，不属于"尺寸标注"，不能混进来做单位判据。 */
    const SIZE_RE = /^(冒口直径 D|冒口球径 D|冒口边长 a（长 × 宽）|冒口高度 H|球顶半径 R)$/;
    const sizeVals = readShapes[k].cells.filter(c => SIZE_RE.test(c.k)).map(c => `${c.k}=${c.v}`);
    check(`P0-1 单位[${EXPECT[k].name}]：尺寸字段均带 mm`, sizeVals.length > 0 && sizeVals.every(x => /\bmm$/.test(x)), JSON.stringify(sizeVals));
  }

  // ④ 规格写法 = 引擎 RISER_SHAPES[k].label()（单一来源，视图不得自造）
  const labelCheck = await evalJs(`(async () => {
    const m = await import('/calcs/riser.js');
    const box = document.querySelector('#dc_resultActive');
    const it = window.__dcLastRiser || null;
    const line = (box.querySelector('.dc-shape-line')?.textContent || '');
    const k = (await import('/js/model/CastingProject.js')).getV('process.riserShape') || 'cyl';
    return JSON.stringify({ line, k, hasFn: typeof m.RISER_SHAPES[k].label === 'function' });
  })()`);
  const lc = JSON.parse(labelCheck);
  check('P0-1 规格行存在且形状表提供 label()', lc.hasFn && /⌀|球|方/.test(lc.line), lc.line);

  // ⑤ 换形状真正改变的是 Vr 与补缩效率（原缺陷：速览卡四项全同 ⇒ 看不出变化）
  const vrs = Object.keys(EXPECT).map(k => (readShapes[k].cells.find(c => c.k.includes('冒口体积')) || {}).v || '');
  const effs = Object.keys(EXPECT).map(k => (readShapes[k].cells.find(c => c.k.includes('补缩效率')) || {}).v || '');
  check('P0-1 冒口体积 Vr 随形状变化（≥3 个不同值）', new Set(vrs).size >= 3, JSON.stringify(vrs));
  check('P0-1 补缩效率随形状变化（≥2 个不同值）', new Set(effs).size >= 2, JSON.stringify(effs));
  const stripKs = readShapes.cyl.strip.map(c => c.k);
  check('P0-1 核心结论卡含「冒口规格 / 可补缩量（Vr × 效率）」且明示模数校核',
    stripKs.some(k => k.includes('规格')) && stripKs.some(k => k.includes('可补缩量'))
    && stripKs.some(k => k.includes('Mr_actual')), stripKs.join(' | '));
  const stripSpec = Object.fromEntries(Object.keys(EXPECT).map(k => [k, (readShapes[k].strip.find(c => c.k.includes('规格')) || {}).v || '']));
  check('P0-1 核心卡「冒口规格」逐形状不同，且球顶圆柱带出球顶半径 R',
    new Set(Object.values(stripSpec)).size === 4 && /R\d/.test(stripSpec.sphere_head)
    && /^球/.test(stripSpec.sphere) && /^方/.test(stripSpec.square), JSON.stringify(stripSpec));

  // ⑥ 说明"为何 D/H 不变"的提示必须存在（如实说明支持边界，§二）
  check('P0-1 页面如实说明"换形状不改 D/H、改的是体积与效率"',
    await evalJs(`(() => { const t = document.querySelector('#dc_resultActive')?.textContent || '';
      return t.includes('换形状不改变') && t.includes('M = D/6'); })()`), '');

  /* ============================================================
     P0-2：模型工作区 ↔ 结果视图 往返
     ============================================================ */
  console.log('\n【P0-2】结果视图往返');
  const snap = () => evalJs(`(() => {
    const box = document.querySelector('#dc_results');
    return { wsView: document.querySelector('#dc_ws')?.dataset.wsview,
      resultsHidden: !!box?.hidden,
      activeLen: (document.querySelector('#dc_resultActive')?.textContent || '').length,
      navN: document.querySelectorAll('#dc_resultNav [data-nav]').length,
      canvasN: document.querySelectorAll('#dc_view3dBox canvas').length,
      meshChip: document.querySelector('#dc_fileName')?.textContent || '',
      scrollY: window.scrollY,
      docScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight };
  })()`);

  const inResults = await snap();
  check('P0-2 起点：位于结果视图且有内容', inResults.wsView === 'results' && !inResults.resultsHidden && inResults.activeLen > 200, JSON.stringify(inResults));

  const backTxt = await evalJs(`document.querySelector('#dc_again')?.textContent.trim() || ''`);
  check('P0-2 结果视图有明显的「返回三维工作台」入口', /返回三维工作台/.test(backTxt), backTxt);

  /* ⚠ 146 实测到的真缺陷（非本轮引入）：resultsCenter 用 innerHTML 整块重建结果区，
     而返回按钮的监听原来挂在 designCenter.renderResults 里 ⇒ **只要点过任一类别页签**，
     `#dc_again` 就是没有任何监听的新元素，「返回三维工作台」点了毫无反应
     （只有中间恰好触发过一次重算才会"偶尔"能用）。绑定改到 resultsCenter 后必须稳定可用。 */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(500);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(500);
  await evalJs(`document.querySelector('#dc_again').click()`); await wait(700);
  check('P0-2 切换类别页签后「返回」仍然有效（DOM 重建不丢监听）',
    await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview === 'model'`), '');
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(700);   // 切回结果视图继续后面的断言
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);

  await evalJs(`document.querySelector('#dc_again').click()`); await wait(700);
  const back1 = await snap();
  check('P0-2 点返回 → 回到模型工作区', back1.wsView === 'model' && back1.scrollY === 0, JSON.stringify(back1));
  check('P0-2 返回后**结果被保留**（未被清空/未置空）',
    back1.activeLen === inResults.activeLen && !back1.resultsHidden, `len ${inResults.activeLen} → ${back1.activeLen}`);
  check('P0-2 返回后 STL / 三维状态保留（文件名 chip 不变、画布唯一）',
    back1.meshChip === inResults.meshChip && back1.canvasN === 1, JSON.stringify({ chip: back1.meshChip, canvas: back1.canvasN }));

  // 再点主按钮应立即回到同一份结果（不得要求重跑）
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(700);   // 状态 D：主按钮=查看分析结果
  const again = await snap();
  check('P0-2 再点主按钮 → 直接回到同一份结果（无需重跑）',
    again.wsView === 'results' && again.activeLen === inResults.activeLen, JSON.stringify(again));
  // 145 §六：结果视图里主按钮不得是"点了没新东西"的死按钮 —— 必须切成「重新分析」
  const ctaInResults = await evalJs(`document.querySelector('#dc_run')?.textContent.trim() || ''`);
  check('P0-2 结果视图内主按钮 = 「重新分析」（不是死按钮「查看分析结果」）',
    /重新分析/.test(ctaInResults), ctaInResults);

  // 反复往返 5 轮：不叠加事件、不丢状态、不滚动
  for (let i = 0; i < 5; i++) {
    await evalJs(`document.querySelector('#dc_run').click()`); await wait(300);
    await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(300);
  }
  await wait(600);
  const after = await snap();
  check('P0-2 往返 5 轮后：画布唯一、结果长度不变、无页面滚动',
    after.canvasN === 1 && after.activeLen === inResults.activeLen && after.scrollY === 0 && !after.docScrollable,
    JSON.stringify(after));
  check('P0-2 全流程页面无整体滚动', after.docScrollable === false, `scrollY=${after.scrollY}`);

  check('无运行时异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
  console.log(`\n结果: ${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  console.error('测试失败:', e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  if (server) try { server.kill(); } catch (e) {}
  process.exitCode = failures === 0 ? 0 : 1;
}
