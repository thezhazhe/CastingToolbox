// ============================================================
// S5（158.txt）· 结果界面清理 / 分析入口合并 / 出品率口径 / H/D 开放
// 用法: node scripts/browser_s5_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9275;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_s5');
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
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push(d.exception?.description || d.text || 'exception');
      console.log('  [runtime]', d.exception?.description || d.text || 'exception');
    }
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
  const saveClick = () => evalJs(`document.querySelector('#dc_pfSave')?.click()`);
  const analyzeClick = () => evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  const chip = () => evalJs(`document.querySelector('#dc_stateChip')?.textContent || ''`);
  const view = () => evalJs(`document.querySelector('#dc_ws')?.dataset.wsview || ''`);
  const activeText = () => evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1800);
  await viewport(1366, 900);

  /* ============================================================
     1 · 分析入口合并 + 成功后自动进入结果页
     ============================================================ */
  console.log('\n【S5-03】分析入口合并 / 自动进入结果');
  await importStl('cube50.stl');
  await poll(`document.querySelector('#dc_hsBadge') && !document.querySelector('#dc_hsBadge').hidden ? 1 : 0`, 90000, 700);
  await wait(500);
  const badgeStyle = await evalJs(`(() => { const b = document.querySelector('#dc_hsBadge'); if (!b) return null;
    const s = getComputedStyle(b); return { border: s.borderTopWidth, bg: s.backgroundColor, padding: s.paddingTop, text: b.innerText }; })()`);
  check('D2 三维顶部状态只保留文字：无边框/背景/卡片内边距',
    !!badgeStyle && badgeStyle.border === '0px' && badgeStyle.padding === '0px'
    && /rgba\(0, 0, 0, 0\)|transparent/.test(badgeStyle.bg) && !!badgeStyle.text, JSON.stringify(badgeStyle));
  await openField('material.family');
  await setInput('[data-pf="material.family"]', '球铁'); await wait(250);
  await saveClick(); await wait(500);
  check('保存后仍留在模型视图（保存不分析）', (await view()) === 'model');
  const flowLabels = await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].map(b => b.dataset.flowStep).join(',')`);
  check('顶部流程条已合并为 4 步，无独立“结果”节点', flowLabels === 'model,cond,param,run', flowLabels);
  const flowParamLabel = await evalJs(`document.querySelector('#dc_flowbar [data-flow-step="param"]')?.textContent || ''`);
  check('D4 顶部第③步显示“工艺参数”，不再是“工艺设计”', /工艺参数/.test(flowParamLabel) && !/工艺设计/.test(flowParamLabel), flowParamLabel);
  check('旧的独立“重新分析”按钮已移除', await evalJs(`!document.querySelector('#dc_rerun')`));
  await analyzeClick();
  const ok1 = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('无草稿点 ④：分析成功', !!ok1, await chip());
  check('分析成功后自动进入结果页', (await view()) === 'results');
  check('结果视图高亮合并后的 ④（不存在 ⑤ 节点）',
    (await evalJs(`document.querySelector('#dc_flowbar .dc-flow-node.on')?.dataset.flowStep || ''`)) === 'run');
  check('主按钮在结果页表示重新分析', /重新分析/.test(await evalJs(`document.querySelector('#dc_run')?.textContent || ''`)));

  /* ============================================================
     1b · S1/S2/S3/S6/S8：界面精简
     ============================================================ */
  console.log('\n【S1/S2/S3/S6/S8】界面精简');
  const ui = await evalJs(`(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; };
    const groups = [...document.querySelectorAll('[data-p1-group]')].map(g => ({
      key: g.dataset.p1Group, head: g.querySelector('.dc-p1-grouphead')?.textContent || '',
      cards: g.querySelectorAll('.dc-core-card').length, text: g.innerText,
    }));
    return { sb: r('.dc-statusbar'), body: r('.dc-body'), groups,
      noMcHowto: !document.body.innerHTML.includes('Mc 怎么估'),
      noHdHelp: !document.body.innerHTML.includes('H/D 的取值范围与作用'),
      noShapeHelp: !document.body.innerHTML.includes('形状公式与补缩效率依据'),
      topBack: !!document.querySelector('.page-head #dc_again'),
      bottomBack: !!document.querySelector('#dc_resultActive + div #dc_again') };
  })()`);
  check('S1 页面底部的状态栏不再被 1fr 行拉高（<80px，且在主体之后）',
    !!ui.sb && ui.sb.h < 80 && ui.body.bottom <= ui.sb.top + 1, JSON.stringify({ sb: ui.sb, body: ui.body }));
  check('S2 六张卡片分为产品结构 / 收缩率 / 加工余量推荐三组',
    ui.groups.length === 3 && ui.groups[0].cards === 4 && ui.groups[1].cards === 1 && ui.groups[2].cards === 1
    && ['产品结构', '收缩率', '加工余量推荐'].every((h, i) => ui.groups[i].head === h), JSON.stringify(ui.groups.map(g => ({ h: g.head, c: g.cards }))));
  check('S3 加工余量显示范围、推荐值、现行标准与中值规则',
    /GB\/T 42124\.3-2025/.test(ui.groups[2].text) && /推荐范围/.test(ui.groups[2].text)
    && /取范围中值/.test(ui.groups[2].text), ui.groups[2].text.slice(0, 160));
  check('S6 输入界面已移除 Mc 估法 / H/D 长说明 / 形状公式长说明',
    ui.noMcHowto && ui.noHdHelp && ui.noShapeHelp, JSON.stringify(ui));
  check('S8 返回三维工作台已移到结果页底部，不在页首',
    ui.topBack === false && ui.bottomBack === true);

  /* ============================================================
     2 · S5-01/02/04：结果界面清理
     ============================================================ */
  console.log('\n【S5-01/02/04】旧体积 / Mc 提示 / 实际出品率');
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
  const riserText = await activeText();
  check('S1 切到冒口页后底部状态栏高度仍正常（不落入 1fr 行）',
    (await evalJs(`document.querySelector('.dc-statusbar')?.getBoundingClientRect().height || 0`)) < 80);
  const refBase = await project(`({ Mf: p.getV('risers.items')?.[0]?.Mr_act, s: p.getV('process.wallUsed') })`);
  const refUi = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('.dc-ref-card')];
    const neck = cards.find(c => c.querySelector('[data-ref-shape]'));
    const feed = cards.find(c => c.querySelector('[data-ref-feed]') || c.textContent.includes('板状参考'));
    return { count: cards.length, neck: neck?.innerText || '', feed: feed?.innerText || '',
      note: document.querySelector('[data-ref-note]')?.textContent || '' };
  })()`);
  const mn = Number(refBase.Mf) / 3;
  const fmt = (v) => String(parseFloat(v.toFixed(2)));
  check('R7 冒口页有两张独立参考卡（颈 / 补缩距离）',
    refUi.count === 2 && /冒口颈尺寸参考/.test(refUi.neck) && /补缩距离经验参考/.test(refUi.feed), JSON.stringify(refUi).slice(0, 180));
  check('R7 颈卡使用 Mr_act：显示 M_N≥M_F/3、理论值和建议取整尺寸',
    Number(refBase.Mf) > 0 && refUi.neck.includes(fmt(mn)) && refUi.neck.includes(fmt(4 * mn))
    && refUi.neck.includes(String(Math.ceil(4 * mn))), refUi.neck.slice(0, 140));
  check('R7 补缩距离卡同时显示板状 2s 与杆状 1.2s',
    Number(refBase.s) > 0 && refUi.feed.includes(fmt(2 * Number(refBase.s))) && refUi.feed.includes(fmt(1.2 * Number(refBase.s))), refUi.feed.slice(0, 140));
  check('R7 两张卡下方有统一经验提醒', /以上为经验参数/.test(refUi.note), refUi.note.slice(0, 80));
  // 长方形交互：有效 a 应给出 b；无效 a 应明确提示，不得输出假尺寸
  await evalJs(`(() => { const s = document.querySelector('[data-ref-shape]'); s.value = 'rect'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await wait(200);
  await evalJs(`(() => { const i = document.querySelector('[data-ref-side]'); i.value = '100'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(200);
  const rectOk = await evalJs(`document.querySelector('[data-ref-neck-result]')?.textContent || ''`);
  check('R7 长方形：a=100 给出 b 参考范围/建议取整 b', /b 参考范围/.test(rectOk) && /建议取整 b/.test(rectOk), rectOk.slice(0, 100));
  check('R8 长方形颈卡：b 上限取整超出 M_N,max 时明确提示，不伪造范围内',
    /回算实际 M_N/.test(rectOk) && /上限取整后超出 M_N,max/.test(rectOk) && /M_N,max/.test(rectOk),
    rectOk.slice(0, 220));
  await evalJs(`(() => { const i = document.querySelector('[data-ref-side]'); i.value = '1'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await wait(200);
  const rectBad = await evalJs(`document.querySelector('[data-ref-neck-result]')?.textContent || ''`);
  check('R7 长方形：a≤2M_N 明确提示输入不适用，不输出假尺寸', /输入不适用/.test(rectBad), rectBad.slice(0, 100));
  check('R8 颈卡显示模数参考范围与尺寸参考范围',
    /颈模数参考范围/.test(refUi.neck) && /参考范围/.test(refUi.neck) && /建议取整范围/.test(refUi.neck), refUi.neck.slice(0, 160));
  check('R8 颈卡回算上下限实际 M_N，并按实际值标注范围状态',
    /回算实际 M_N/.test(refUi.neck)
    && (/上下限均在参考范围内/.test(refUi.neck) || /上限取整后超出 M_N,max/.test(refUi.neck)),
    refUi.neck.slice(0, 220));
  check('R8 旧模数法冒口颈结果不再展示（只保留新参考卡）',
    !/旧模数法冒口颈/.test(riserText) && !/M_neck/.test(riserText));
  check('R8 冒口顶部防封顶/通气/压力锥提示存在且只集中一处',
    await evalJs(`(() => { const n = document.querySelector('[data-top-note]');
      return !!n && n.textContent.includes('压力锥') && n.textContent.includes('1/4')
        && document.querySelectorAll('[data-top-note]').length === 1; })()`));
  check('结果页不再出现旧体积验证/参考不足提示',
    !riserText.includes('旧体积模型参考') && !riserText.includes('旧体积参考不足'), riserText.slice(0, 120));
  check('结果页不再出现“最终实重出品率/暂不能给出”',
    !riserText.includes('最终实重出品率') && !riserText.includes('暂不能给出'));
  check('Mc 为 STL 估计值的说明位于冒口结果底部（普通说明；R7 参考提醒可排在其后）',
    await evalJs(`(() => { const n = document.querySelector('[data-mc-estimate-note]'); if (!n) return false;
      const core = n.closest('.dc-result-sec')?.querySelector('.dc-core-row');
      return n.textContent.includes('Mc 为基于 STL 几何计算的估计值')
        && (!core || n.getBoundingClientRect().top >= core.getBoundingClientRect().bottom); })()`));
  check('顶部风险条不再出现旧体积/自动 Mc/最终出品率',
    await evalJs(`(() => { const t = document.querySelector('[data-risk-strip]')?.textContent || '';
      return !/旧体积|最终实重出品率|自动估计值/.test(t); })()`));
  check('S4 Campbell 提示与补充说明合并为一条可见工程提示，旧的独立折叠块已移除',
    await evalJs(`(() => { const n = document.querySelector('[data-eng-note]');
      const summaries = [...document.querySelectorAll('#dc_resultActive summary')].map(s => s.textContent);
      return !!n && n.textContent.includes('Campbell')
        && !document.querySelector('.dc-campbell-short')
        && !summaries.some(s => s.includes('补充说明（冒口计算）'))
        && summaries.some(s => s.includes('工程说明（Campbell 布置 / 计算补充）')); })()`));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(400);
  const gatingText = await activeText();
  const movedRules = await evalJs(`(() => { const d = document.querySelector('[data-gating-engineering]');
    return d ? { inDetails: !!d.closest('details.dc-adv-detail'), inParam: !!d.closest('#dc_taskPanel'),
      vent: /1\\.5~4 倍 S直/.test(d.textContent), principles: /浇注系统工程原则/.test(d.textContent),
      count: d.querySelectorAll('details').length } : null; })()`);
  check('D1 排气规则与浇注系统工程原则在结果“详细信息”，不在参数输入区',
    !!movedRules && movedRules.inDetails && !movedRules.inParam && movedRules.vent
    && movedRules.principles && movedRules.count >= 2, JSON.stringify(movedRules));
  const pourLabel = await evalJs(`[...document.querySelectorAll('#dc_resultActive .dc-core-card')]
    .map(c => c.querySelector('.dc-core-label')?.textContent || '').find(x => x.includes('预计浇铸重量')) || ''`);
  check('D3 浇注结果主卡使用“预计浇铸重量”', /预计浇铸重量/.test(pourLabel), pourLabel);
  check('S1 切到浇注页后底部状态栏高度仍正常（不落入 1fr 行）',
    (await evalJs(`document.querySelector('.dc-statusbar')?.getBoundingClientRect().height || 0`)) < 80);
  check('结果页保留设计预估出品率', gatingText.includes('设计预估出品率'));
  check('实际出品率改为人工回算指引，不再展示推算值',
    gatingText.includes('实际出品率请用本厂实绩') && !gatingText.includes('最终实重出品率'));
  check('提供“出品率与铁水重量”人工回算入口',
    await evalJs(`!!document.querySelector('#dc_resultActive [data-calc-link="yield"]')`));
  check('S5 整模重量口径核对已移入主“详细信息”折叠区',
    await evalJs(`(() => { const l = document.querySelector('.dc-weight-ledger');
      return !!l && !!l.closest('.dc-adv-detail') && !l.closest('[data-gating-prod]'); })()`));
  check('S7 结果页不再保留 RH 长说明',
    !(await activeText()).includes('RH = 冒口顶面 − 铸件顶面'));
  const sect = await evalJs(`(() => {
    const box = document.querySelector('[data-runner-section-box]');
    const sel = document.querySelector('#dc_runnerSection');
    return { box: !!box, kind: box?.dataset.runnerKind || '', opts: sel ? [...sel.options].map(o => o.value) : [],
      value: sel?.value || '', text: box?.innerText || '', count: document.querySelector('#dc_trapN')?.value || '',
      oldCard: !!document.querySelector('[data-trap-card]') };
  })()`);
  check('R8-FIX 横浇道四种截面进入同一选择器，默认按真实类型自动匹配',
    sect.box && ['rect', 'standard', 'flat', 'tall'].every(v => sect.opts.includes(v))
    && ['standard', 'flat', 'tall'].includes(sect.value) && sect.kind === sect.value
    && /上底/.test(sect.text) && /下底/.test(sect.text) && /总实际/.test(sect.text) && !sect.oldCard,
    JSON.stringify({ value: sect.value, kind: sect.kind, opts: sect.opts }));
  check('R8-FIX 梯形数量默认 1，主结果只显示当前梯形几何',
    sect.count === '1' && sect.value !== 'rect' && !/厚 .*长/.test(sect.text), JSON.stringify({ count: sect.count, value: sect.value }));
  const trapA_run = await project(`p.getV('runner.result')?.A_run || 0`);
  await setInput('#dc_runnerSection', 'tall');
  const tallOk = await poll(`document.querySelector('[data-runner-section-box]')?.dataset.runnerKind === 'tall' ? 1 : 0`, 20000, 500);
  const tall = await evalJs(`(() => ({ text: document.querySelector('[data-runner-section-box]')?.innerText || '', kind: document.querySelector('[data-runner-section-box]')?.dataset.runnerKind || '', count: document.querySelector('#dc_trapN')?.value || '' }))()`);
  check('R8-FIX 手动切换到高梯形后主结果更新且无 NaN/Infinity',
    !!tallOk && tall.kind === 'tall' && /上底/.test(tall.text) && /高/.test(tall.text) && !/NaN|Infinity/.test(tall.text),
    JSON.stringify(tall).slice(0, 160));
  await setInput('#dc_trapN', '2');
  const twoOk = await poll(`(async () => { const p = await import('/js/model/CastingProject.js');
    return p.getV('runner.result')?.runnerSection?.count === 2 ? 1 : 0; })()`, 20000, 500);
  const trapStore = await project(`({ n: p.getV('production.trapezoidN'), g: p.getV('runner.result')?.runnerSection, A: p.getV('runner.result')?.A_run, Fr: p.getV('runner.result')?.Fr_act })`);
  check('R8-FIX 梯形数量参与 A_run/n 分配：数量=2 时单条目标面积减半、总实际仍达目标',
    !!twoOk && trapStore.n === 2 && trapStore.g?.count === 2
    && Math.abs(trapStore.g?.targetEach - trapStore.A / 2) < 1e-6
    && trapStore.Fr >= trapStore.A - 1e-6,
    JSON.stringify({ store: trapStore, trapA_run }));
  await evalJs(`document.querySelector('#dc_runnerAuto')?.click()`); await wait(700);
  const autoExpected = await project(`(() => { const t = p.getV('runner.result')?.rd?.type; return t === '开放' ? 'flat' : t === '封闭' ? 'tall' : 'standard'; })()`);
  const autoBack = await poll(`document.querySelector('[data-runner-section-box]')?.dataset.runnerKind === ${JSON.stringify(autoExpected)} ? 1 : 0`, 20000, 500);
  check('R8-FIX 恢复自动匹配后按开放/封闭类型回到推荐梯形', !!autoBack,
    `expected=${autoExpected} actual=${await evalJs(`document.querySelector('[data-runner-section-box]')?.dataset.runnerKind || ''`)}`);
  check('R8 内浇口数量统一为整模总口径，并有说明',
    gatingText.includes('内浇口总数（整模，全部铸件合计）')
    && gatingText.includes('内浇口总数为整套浇注系统中所有铸件的内浇口数量合计。'));

  /* ============================================================
     3 · S5-05：H/D 四档与结果一致性
     ============================================================ */
  console.log('\n【S5-05】H/D 四档 / 保存分析 / 结果一致');
  await ensureModelView();
  await openField('process.hdRatio');
  const hdUi = JSON.parse(await evalJs(`(() => {
    const s = document.querySelector('[data-pf="process.hdRatio"]');
    return JSON.stringify({ value: s?.value || '', hidden: !!(s && s.closest('[data-hd-field]')?.hidden),
      opts: s ? [...s.options].map(o => o.value) : [] });
  })()`));
  check('H/D 默认 1.0，四档齐备', hdUi.value === '1.0' && ['0.8', '1.0', '1.2', '1.5'].every(v => hdUi.opts.includes(v)) && !hdUi.hidden, JSON.stringify(hdUi));
  check('R8 设计中心冒口形状选择器包含发热/保温经验选项',
    await evalJs(`!!document.querySelector('[data-pf="process.riserShape"] option[value="insulated"]')`));
  await openField('process.riserHeight');
  check('S7 输入界面 RH 长说明已移除，保留简短距离提示',
    await evalJs(`(() => { const box = document.querySelector('[data-rh-linked]');
      return !!box && box.textContent.includes('冒口顶高于周边顶面的距离')
        && !box.textContent.includes('RH = 冒口顶面 − 铸件顶面')
        && !box.querySelector('.dc-rh-fig'); })()`));
  await openField('process.hdRatio');
  const base = await project(`p.getV('risers.items')?.[0] ? { D: p.getV('risers.items')[0].D, H: p.getV('risers.items')[0].H, Vr: p.getV('risers.items')[0].Vr } : null`);
  await setInput('[data-pf="process.hdRatio"]', '1.5'); await wait(250);
  await saveClick(); await wait(500);
  check('改 H/D 保存后旧结果标记过期', await evalJs(`!document.querySelector('#dc_staleBar')?.hidden`));
  await analyzeClick();
  const ok2 = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('改 H/D 后分析成功并自动进入结果页', !!ok2 && (await view()) === 'results');
  const after = await project(`({ D: p.getV('risers.items')[0].D, H: p.getV('risers.items')[0].H, Vr: p.getV('risers.items')[0].Vr, hd: p.getV('process.hdRatio') })`);
  check('H/D=1.5 已落到项目', Math.abs(after.hd - 1.5) < 1e-9, JSON.stringify(after));
  check('几何随 H/D 改变（D/H/Vr 至少一项变化）',
    base && (after.D !== base.D || after.H !== base.H || after.Vr !== base.Vr),
    `${JSON.stringify(base)} → ${JSON.stringify(after)}`);
  check('实际 H/D 接近 1.5（取整误差 ≤0.5/D）',
    Math.abs(after.H / after.D - 1.5) <= 0.5 / after.D + 1e-9, `H/D=${(after.H / after.D).toFixed(4)}`);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
  const hdResult = await activeText();
  const hdShown = String(parseFloat((after.H / after.D).toFixed(2)));   // 页面 fmt 会去掉尾随 0
  check('结果页显示实际 H/D，不再写“设计中心固定 1.00”',
    hdResult.includes('H/D（高度 / 直径）') && !hdResult.includes('设计中心当前固定 hd = 1.00')
    && hdResult.includes(hdShown), `${hdShown}｜${hdResult.slice(0, 140)}`);

  /* 报告与页面同一 H/D */
  await evalJs(`(() => { window.__rep = ''; const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { try { b.text().then(t => { window.__rep = t; }); } catch (e) {} return orig(b); };
    return true; })()`);
  await evalJs(`document.querySelector('#dc_report')?.click()`); await wait(900);
  const rep = await evalJs(`window.__rep || ''`);
  check('报告含 H/D 行且与最终 D/H 一致',
    rep.includes('H/D（高度 / 直径）') && rep.includes((after.H / after.D).toFixed(2)), rep.slice(0, 80));
  check('报告不再出现旧体积提示', !rep.includes('旧体积模型参考') && !rep.includes('旧体积参考不足'));

  /* ============================================================
     4 · 球形：隐藏 H/D，结果 H ≡ D
     ============================================================ */
  console.log('\n【S5-05】球形 H ≡ D');
  await ensureModelView();
  await openField('process.riserShape');
  await setInput('[data-pf="process.riserShape"]', 'sphere'); await wait(350);
  const sphereUi = JSON.parse(await evalJs(`(() => {
    const f = document.querySelector('[data-hd-field]'); const n = document.querySelector('[data-hd-sphere-note]');
    return JSON.stringify({ fieldHidden: !!f?.hidden, noteHidden: !!n?.hidden }); })()`));
  check('球形隐藏 H/D 选择器并显示 H≡D 说明', sphereUi.fieldHidden === true && sphereUi.noteHidden === false, JSON.stringify(sphereUi));
  await saveClick(); await wait(500);
  await analyzeClick();
  const ok3 = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('球形分析成功', !!ok3);
  const sph = await project(`({ shape: p.getV('process.riserShape'), D: p.getV('risers.items')[0].D, H: p.getV('risers.items')[0].H })`);
  check('球形结果 H ≡ D（即使 H/D 仍保存为 1.5）', sph.shape === 'sphere' && sph.H === sph.D, JSON.stringify(sph));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
  check('球形结果页写 H ≡ D', (await activeText()).includes('H ≡ D'));

  /* ============================================================
     5 · 失败留在当前页；旧结果标记过期
     ============================================================ */
  console.log('\n【S5-03】失败不跳转 / 旧结果标过期');
  await ensureModelView();
  await openField('process.riserHeight');
  await setInput('[data-pf="process.riserHeight"]', '60'); await wait(250);
  await saveClick(); await wait(500);
  await project(`(p.set('geometry.valid', false, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH), 1)`);
  await analyzeClick();
  await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('未完成') ? 1 : 0`, 15000, 300);
  const failView = await view();
  const failChip = await chip();
  const failBar = await evalJs(`!document.querySelector('#dc_staleBar')?.hidden`);
  check('分析失败：留在当前页面，旧结果标记过期，不进入看似正常的结果页',
    failView === 'model' && failChip.includes('未完成') && failBar === true,
    `${failView}｜${failChip}｜staleBar=${failBar}`);
  await project(`(p.set('geometry.valid', true, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH), 1)`);
  await wait(400);   // 越过 runAnalysis 的 250ms 重复点击去重窗口
  await analyzeClick();
  const ok4 = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('修复原因后重新分析成功并自动进入结果页', !!ok4 && (await view()) === 'results', `${await chip()}｜${await view()}`);

  /* ============================================================
     6 · 英文同步 + 移动端
     ============================================================ */
  console.log('\n【英文 / 响应式】');
  await evalJs(`document.querySelector('[data-lang="en-US"]')?.click()`); await wait(700);
  const enRiser = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('英文结果页含 H/D (height / diameter) 与 H ≡ D',
    enRiser.includes('H/D (height / diameter)') && enRiser.includes('H ≡ D'));
  await evalJs(`document.querySelector('[data-lang="zh-CN"]')?.click()`); await wait(500);
  await viewport(390, 844, true); await wait(500);
  const mob = await evalJs(`(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))()`);
  check('390px：结果页无横向溢出', mob.sw <= mob.cw + 1, JSON.stringify(mob));

  /* R8-FIX 设计中心：发热/保温为正式选项，主结果切换、沿用 H/D、不再显示第二套卡 */
  await viewport(1366, 900, false); await wait(300);
  await ensureModelView();
  const hdBeforeIns = await project(`p.getV('process.hdRatio')`);
  await openField('process.riserShape');
  await setInput('[data-pf="process.riserShape"]', 'insulated'); await wait(350);
  check('R8-FIX 设计中心发热/保温沿用当前 H/D，选择器不隐藏',
    await evalJs(`(() => { const f = document.querySelector('[data-hd-field]'); const n = document.querySelector('[data-hd-sphere-note]');
      return !!f && f.hidden === false && !!n && n.hidden === true; })()`), `hd=${hdBeforeIns}`);
  check('R8-FIX 切换发热/保温不会重置已设置 H/D', await evalJs(`Number(document.querySelector('[data-pf="process.hdRatio"]')?.value) === ${Number(hdBeforeIns)}`),
    `before=${hdBeforeIns}`);
  await saveClick(); await wait(500);
  await analyzeClick();
  const okIns = await poll(`(document.querySelector('#dc_stateChip')?.textContent || '').includes('一致') ? 1 : 0`, 40000, 500);
  check('R8-FIX 设计中心发热/保温分析成功并进入结果页', !!okIns && (await view()) === 'results');
  if (!okIns || (await view()) !== 'results') {
    console.log('  [diag]', JSON.stringify({ chip: await chip(), view: await view(),
      stale: await evalJs(`document.querySelector('#dc_staleBar')?.innerText || ''`),
      active: (await activeText()).slice(0, 200) }));
  }
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
  const insCenter = await evalJs(`(() => { const m = document.querySelector('[data-insulated-main]');
    return { main: !!m, text: m?.innerText || '', oldCard: !!document.querySelector('[data-insulated-ref]'),
      shape: document.querySelector('[data-shape-readonly]')?.innerText || '' }; })()`);
  const insRaw = await project(`(() => { const it = p.getV('risers.items')[0] || {};
    return { shape: p.getV('process.riserShape'), hdIn: p.getV('process.hdRatio'), designType: it.designType,
      D: it.D, H: it.H, V0: it.V0, V1: it.V1, Vr: it.Vr, Vactual: it.Vactual, hd: it.hd,
      eff: it.eff, Mr_target: it.Mr_target, modOk: it.modOk, Mr_act: it.Mr_act }; })()`);
  check('R8-FIX 结果页主结果只显示换算后的发热/保温几何，无第二套参考卡',
    insCenter.main && !insCenter.oldCard && /发热\/保温/.test(insCenter.shape)
    && /目标体积 V1/.test(insCenter.text) && /实际几何体积/.test(insCenter.text)
    && /几何模数（参考）/.test(insCenter.text) && !/H\/D = 1/.test(insCenter.text),
    JSON.stringify(insCenter).slice(0, 220));
  check('R8-FIX 主结果体积/尺寸同属发热保温方案：V1=0.4V0、Vr=实际几何体积、H≈kD',
    insRaw.designType === 'insulated' && Math.abs(insRaw.V1 - 0.4 * insRaw.V0) < 1e-6
    && Math.abs(insRaw.Vr - insRaw.Vactual) < 1e-6 && insRaw.Vactual >= insRaw.V1 - 1e-6
    && Number.isInteger(insRaw.D) && Number.isInteger(insRaw.H)
    && Math.abs(insRaw.hd - Number(hdBeforeIns)) < 1e-9
    && insRaw.H === Math.max(1, Math.round(insRaw.hd * insRaw.D)),
    JSON.stringify(insRaw));
  check('R8-FIX 不把普通圆柱模数/补缩效率冒充为发热保温结果',
    insRaw.eff === null && insRaw.Mr_target === null && insRaw.modOk === null && insRaw.Mr_act > 0,
    JSON.stringify({ eff: insRaw.eff, Mr_target: insRaw.Mr_target, modOk: insRaw.modOk, Mr_act: insRaw.Mr_act }));
  await evalJs(`document.querySelector('[data-lang="en-US"]')?.click()`); await wait(700);
  const enIns = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('R8-FIX 英文结果页同步发热/保温主结果口径',
    /Exothermic \/ insulating riser/.test(enIns) && /Target volume V1/.test(enIns) && /Actual geometric volume/.test(enIns));
  await evalJs(`document.querySelector('[data-lang="zh-CN"]')?.click()`); await wait(500);
  await evalJs(`document.querySelector('#dc_report')?.click()`); await wait(900);
  const insCenterRep = await evalJs(`window.__rep || ''`);
  check('R8-FIX 设计中心报告同步：发热保温主结果 + 梯形横浇道，不冒充普通目标模数',
    /发热\/保温冒口/.test(insCenterRep) && /目标体积 V1 = 0.4 × V0/.test(insCenterRep)
    && /实际几何体积/.test(insCenterRep) && /梯形横浇道/.test(insCenterRep)
    && !/目标冒口模数 Mr_target/.test(insCenterRep), insCenterRep.slice(0, 200));

  /* 独立冒口设计计算器：同一模块、同一两张卡 */
  await evalJs(`location.hash = '#/calculators/riser'`); await wait(900);
  const calcRef = await evalJs(`(() => {
    const cards = [...document.querySelectorAll('.dc-ref-card')];
    return { count: cards.length, neck: cards.some(c => /冒口颈尺寸参考/.test(c.textContent)),
      feed: cards.some(c => /补缩距离经验参考/.test(c.textContent)) };
  })()`);
  check('R7 独立冒口计算器同样显示颈/补缩距离两张参考卡',
    calcRef.count === 2 && calcRef.neck && calcRef.feed, JSON.stringify(calcRef));
  check('R8-FIX 独立冒口计算器：发热/保温选项存在，补缩效率输入已移除',
    await evalJs(`!!document.querySelector('#r_shape option[value="insulated"]') && !document.querySelector('#r_eff_open')`));
  await evalJs(`(() => { const s = document.querySelector('#r_shape'); s.value = 'insulated'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await wait(300);
  await setInput('#r_hd', '1.2'); await wait(700);
  const insUi = await evalJs(`(() => ({ main: !!document.querySelector('[data-insulated-main]'),
    oldCard: !!document.querySelector('[data-insulated-ref]'),
    hdHidden: !!document.querySelector('#r_hd_field')?.hidden, hdValue: document.querySelector('#r_hd')?.value || '',
    noteHidden: !!document.querySelector('#r_insulated_note')?.hidden,
    text: document.querySelector('#r_results')?.innerText || '' }))()`);
  check('R8-FIX 独立冒口发热/保温：主结果切换、H/D 沿用、无第二套参考卡',
    insUi.main && !insUi.oldCard && insUi.hdHidden === false && insUi.noteHidden === false && insUi.hdValue === '1.2'
    && /目标体积 V1/.test(insUi.text) && /实际几何体积/.test(insUi.text)
    && /发热\/保温/.test(insUi.text) && !/以下为普通圆柱基准/.test(insUi.text),
    JSON.stringify(insUi).slice(0, 200));
  const insText12 = insUi.text;
  await setInput('#r_hd', '0.8'); await wait(700);
  const insText08 = await evalJs(`document.querySelector('#r_results')?.innerText || ''`);
  check('R8-FIX 独立冒口不同 H/D 产生不同尺寸且无 NaN/Infinity',
    insText08 !== insText12 && !/NaN|Infinity/.test(insText08)
    && await evalJs(`document.querySelector('#r_hd')?.value === '0.8'`), `1.2/0.8`);
  await evalJs(`document.querySelector('#r_reportBtn')?.click()`); await wait(300);
  const insRep = await evalJs(`document.querySelector('#r_reportBody')?.innerText || ''`);
  check('R8-FIX 独立冒口报告只印发热/保温主结果，不冒充普通目标模数',
    /发热\/保温冒口/.test(insRep) && /目标体积 V1 = 0.4 × V0/.test(insRep)
    && /实际几何体积/.test(insRep) && !/目标冒口模数 Mr_target/.test(insRep),
    insRep.slice(0, 160));
  await evalJs(`document.querySelector('#r_modal [data-close]')?.click()`); await wait(200);

  await evalJs(`location.hash = '#/calculators/gating'`); await wait(900);
  const gtrap = await evalJs(`(() => {
    const s = document.querySelector('#g_runnerSection');
    return { select: !!s, opts: s ? [...s.options].map(o => o.value) : [], value: s?.value || '',
      rectHidden: !!document.querySelector('#g_runnerRectResults')?.hidden,
      trapHidden: !!document.querySelector('#g_runnerTrapResults')?.hidden,
      oldCard: !!document.querySelector('[data-trap-card]'),
      text: document.querySelector('#g_runnerTrapResults')?.innerText || '' };
  })()`);
  check('R8-FIX 独立浇注计算器四种截面同器可选，默认只显示当前梯形主结果',
    gtrap.select && ['rect', 'standard', 'flat', 'tall'].every(v => gtrap.opts.includes(v))
    && ['standard', 'flat', 'tall'].includes(gtrap.value) && gtrap.rectHidden && !gtrap.trapHidden
    && !gtrap.oldCard && /上底/.test(gtrap.text) && /下底/.test(gtrap.text) && /总实际/.test(gtrap.text),
    JSON.stringify(gtrap).slice(0, 200));
  const top1 = parseFloat(await evalJs(`document.querySelector('#g_tr_top .rv')?.textContent || ''`));
  await setInput('#g_trapN', '2'); await wait(700);
  const trap2 = await evalJs(`(() => { const t = document.querySelector('#g_runnerTrapResults')?.innerText || '';
    return { text: t, top: document.querySelector('#g_tr_top .rv')?.textContent || '',
      count: document.querySelector('#g_trapN')?.value || '',
      total: document.querySelector('#g_tr_total')?.innerText || '', bad: /NaN|Infinity/.test(t) }; })()`);
  const top2 = parseFloat(String(trap2.top));
  check('R8-FIX 独立浇注计算器修改梯形数量后尺寸即时更新，A_run/n 不重复除',
    trap2.count === '2' && !trap2.bad && Number.isFinite(top2) && Number.isFinite(top1) && top2 < top1
    && /目标/.test(trap2.total), JSON.stringify(trap2).slice(0, 180));
  await setInput('#g_runnerSection', 'rect'); await wait(700);
  const rectUi = await evalJs(`(() => ({ value: document.querySelector('#g_runnerSection')?.value || '',
    rectHidden: !!document.querySelector('#g_runnerRectResults')?.hidden,
    trapHidden: !!document.querySelector('#g_runnerTrapResults')?.hidden,
    hasRc: !!document.querySelector('#g_rc') && !document.querySelector('#g_rcField')?.hidden }))()`);
  check('R8-FIX 切回矩形保留原有矩形输入/结果，梯形主结果隐藏',
    rectUi.value === 'rect' && rectUi.rectHidden === false && rectUi.trapHidden === true && rectUi.hasRc,
    JSON.stringify(rectUi));
  await setInput('#g_runnerSection', 'flat'); await wait(700);
  await setInput('#g_yr', '70'); await wait(500);
  const manualUi = await evalJs(`(() => ({ value: document.querySelector('#g_runnerSection')?.value || '',
    hint: document.querySelector('#g_runnerAutoHint')?.textContent || '',
    trapHidden: !!document.querySelector('#g_runnerTrapResults')?.hidden,
    bad: /NaN|Infinity/.test(document.querySelector('#g_runnerTrapResults')?.innerText || '') }))()`);
  check('R8-FIX 用户手动选择截面后普通刷新/输入变化不覆盖选择',
    manualUi.value === 'flat' && /手动选择/.test(manualUi.hint) && manualUi.trapHidden === false && !manualUi.bad,
    JSON.stringify(manualUi));
  await viewport(390, 844, true); await wait(500);
  const mobG = await evalJs(`(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))()`);
  check('390px：独立浇注计算器新增截面/数量控件无横向溢出', mobG.sw <= mobG.cw + 1, JSON.stringify(mobG));
  await viewport(1366, 900, false); await wait(300);

  console.log('\n运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  if (exceptions.length) failures++;
  console.log(`\nS5 验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++; console.error('脚本异常：', e.stack || e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
}
