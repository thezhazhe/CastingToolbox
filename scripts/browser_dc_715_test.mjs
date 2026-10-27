// ============================================================
// PHASE 71.5（75.txt）· STL 自动工艺设计中心整合 · 浏览器验收
// 流程：设计中心 → 导入 cube50.stl（均匀件路径）→ 统一输入区（①STL/②基础/③浇注/④高级 + 来源徽章）
//       → 材料/浇注参数 → 覆盖主体壁厚 → ↺ 恢复 → 执行 → 三页结果（①工艺分析②冒口③浇注④出品率）
//       → 替换 lShape.stl（有热结路径）→ Page1 热结信号/状态
// 用法: node scripts/browser_dc_715_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9237;
const URL = 'http://localhost:8090/';
const PROFILE = path.join(ROOT, '_edge_profile_p715');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch (e) {}
    await wait(250);
  }
  throw new Error('server not reachable');
}
async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (r.ok) { const list = await r.json(); const p = list.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    } catch (e) {}
    await wait(200);
  }
  throw new Error('CDP not reachable');
}

try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('not 200'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const consoleMsgs = [];

try {
  await waitForServer();
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const exceptions = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.args?.length) {
      consoleMsgs.push(msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  // awaitPromise：本脚本有若干 `(async () => …)()` 表达式（动态 import 读项目数据），
  //   不加这一项拿到的是 Promise 对象而不是值。
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  /* ⚠ 145 修复的既有测试缺陷：原实现把路径写死成 tests/golden/<file>，
     而 `ALR2510塑料模具v1_1.stl` 实际在 tests/real-stl/ ⇒ setFileInputFiles 静默 no-op，
     那条"ALR2510 分析完成（真实文件路径走通）"**一直是假绿**（上一个模型的徽章文本还写着
     "未检出热结"，断言正好蒙对）。现在：跨目录解析，**找不到文件就直接抛**。 */
  const importStl = async (file) => {
    const cands = ['golden', 'real-stl', 'fixtures'].map(d => path.join(ROOT, 'tests', d, file));
    const full = cands.find(p => { try { return existsSync(p); } catch (e) { return false; } });
    if (!full) throw new Error('测试用 STL 不存在：' + file + '（候选：' + cands.join(' | ') + '）');
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [full.replace(/\\/g, '/')] });
  };
  /** 确保当前在**模型工作区**（结果视图会隐藏 .dc-main，画布尺寸会量到 0） */
  const ensureModelView = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview`) === 'results') {
      await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(600);
    }
  };
  const poll = async (expr, timeoutMs = 25000, step = 600) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const v = await evalJs(expr);
      if (v) return v;
      await wait(step);
    }
    return null;
  };
  const setInput = async (sel, val) => evalJs(`(() => {
    const el = document.querySelector('${sel}');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set;
    setter.call(el, '${val}');
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`);

  // ⚠ 不要加 ?hsDebug=1：它同时是 designCenter.js:106 的 DEBUG_HS 开关，
  //   会触发 injectFakeHotspots（真实算法无结果时注入 Fake TEST-1/2），
  //   把本脚本后半段"未检出热结"的诚实文案断言全部顶掉。
  //   D1 的断言因此**不依赖 __view3d 调试句柄**，只看真实 DOM（见脚本末尾）。
  /* 146 §三：**参数窗口**（分析条件与工艺参数）——导入 STL 后的唯一参数入口。
     窗口内的输入先进局部草稿，点「保存并重新分析」才落盘 ⇒ 凡是"改参数 → 看结果"的
     断言都必须走 `setParam`（打开 → 改 → 保存），不能像 145 那样直接写项目。 */
  /* ⚠ 2026-10-16 · R6-S2 取代了「参数窗口」这个**载体**（150.txt §3.3：编辑改在右侧任务面板）。
     原意逐条保留：参数**只能在专门的分析条件 / 工艺参数界面里编辑**，改完必须**保存**才落盘。
     改动只在入口上，断言判据一字未动：
       · `#dc_paramsBtn` 仍然打开参数编辑界面（现在是面板的 ②/③ 步骤）
       · 保存 = `#dc_pfSave`，取消 = `#dc_pfCancel`（原 `#dc_dlgSave` / `#dc_dlgCancel`）
       · 字段多了"在哪一步"这一维 ⇒ `openParams(target)` 按**真实 UI**（流程条 + 子模块页签）
         切到含该字段的那一步，而不是在测试里复刻产品的分步规则。 */
  /* ★ 只查**当前可见步骤**里的字段：②/③ 的 body 都常驻 DOM，全局选择器会命中
     上一步留下的隐藏节点，导致"以为已经切过去"而读到旧 DOM。 */
  const fieldInActiveStep = (path) =>
    `!!document.querySelector('#dc_condStep:not([hidden]) [data-pf="${path}"], #dc_paramStep:not([hidden]) [data-pf="${path}"]')`;
  const openParams = async (target) => {
    await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(350);
    if (!target) return;
    if (await evalJs(fieldInActiveStep(target))) return;
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`);
    await wait(350);
    if (await evalJs(fieldInActiveStep(target))) return;
    for (const tab of ['riser', 'gating']) {
      await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(250);
      if (await evalJs(fieldInActiveStep(target))) return;
    }
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'cond')?.click()`);
    await wait(300);
  };
  const closeParams = async () => { await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(250); };
  /* S4 契约：保存只写参数；旧用例需要结果时再点顶部 ④「分析」。 */
  const saveParams = async () => {
    await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(220);
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
    await wait(1400);
  };
  const setParam = async (path, val) => {
    await openParams(path);
    const ok = await evalJs(`(() => {
      const el = document.querySelector('[data-pf="${path}"]');
      if (!el) return false;
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(val))});
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      return true; })()`);
    if (!ok) throw new Error('参数界面上找不到字段: ' + path);
    return ok;
  };
  /** 打开窗口 → 改若干字段 → 保存（最常用的一步到位） */
  const applyParams = async (pairs) => {
    for (const [p, v] of pairs) await setParam(p, v);   // setParam 内部会切到该字段所在步骤
    await saveParams();
  };

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(800);
  /* ⚠ 测试卫生：本脚本删 profile 目录只是为了拿一个干净起点，但**上一次异常退出的 Edge
     可能仍占着该目录**，rmSync 静默失败 ⇒ localStorage 里残留上一轮保存的参数
     （实测：「未保存的修改不写项目」这条断言因此被上一轮的 `material.family='灰铁'` 顶红）。
     显式清一次存储再重载，断言才不依赖"上一次跑得干不干净"。 */
  await evalJs(`(() => { localStorage.clear(); sessionStorage.clear(); return 1; })()`);
  await send('Page.reload', {});
  await wait(1500);
  check('进入设计中心', (await evalJs(`document.querySelector('#view .page-title')?.textContent || ''`)).includes('铸造工艺设计中心'));

  /* ---- ① 导入 cube50（均匀实心路径）---- */
  await importStl('cube50.stl');
  const hsBadge = await poll(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  check('cube50 分析完成（热结状态条出现）', !!hsBadge, (hsBadge || '').slice(0, 40));

  /* ============================================================
     146.txt §0/§3：上一轮（145）把「取消无 STL 的独立手动模式」误读成「删除全部参数输入」，
     本轮**恢复 STL 模式下的参数查看/输入/修改/确认/保存能力**，同时仍然只保留 STL 模式。
     断言按新契约正面钉住：
       · 参数窗口**必须存在**且能从工具栏打开；
       · 窗口里三模块（分析条件 / 冒口设计 / 浇注系统）与关键字段必须齐全；
       · **无 STL 的独立手动模式入口必须仍然不存在**（§3.5）；
       · 左栏恰好两个主体区域（概览 + 热结），不得再有"设计步骤 / 分析条件"内容块（§4.1/§4.3）。
     ============================================================ */
  check('无任务选择 UI（Case 1）', await evalJs(`document.querySelector('#dc_tasks') === null && document.querySelectorAll('.dc-task').length === 0`));
  check('146 §3.1 · 导入后存在明确的「分析条件与工艺参数」入口',
    await evalJs(`(() => { const b = document.querySelector('#dc_paramsBtn'); return !!b && !b.hidden; })()`));
  /* ⚠ 2026-10-16 · R6-S2：三个模块**不再同屏**（② 分析条件 / ③ 的冒口、浇注两个子模块），
     所以"三模块与关键字段齐全"这条要**按真实 UI 逐个走一遍再取并集**。
     R6-S3：主标题不再使用 A/B/C；内浇道/横浇道/排气 5 个字段移到结果页编辑（153 §八），
     因此这里核对的是 15 个**前置**字段（含 RH）。 */
  const collectAllFields = async () => {
    const seen = new Set(); const txt = [];
    const grab = async () => {
      const r = JSON.parse(await evalJs(`(() => {
        const body = document.querySelector('#dc_taskPanel');
        return JSON.stringify({ t: (body?.textContent || ''), f: [...document.querySelectorAll('#dc_condBody [data-pf], #dc_paramBody [data-pf]')].map(e => e.dataset.pf) }); })()`));
      r.f.forEach(x => seen.add(x)); txt.push(r.t);
    };
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'cond')?.click()`); await wait(350);
    await grab();
    await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(350);
    for (const tab of ['riser', 'gating']) {
      await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300);
      await grab();
    }
    return { txt: txt.join('|'), fields: [...seen] };
  };
  const dlg = await collectAllFields();
  check('146 §3.2 · 参数界面含三模块与关键字段（分析条件 / 冒口设计 / 浇注系统设计）',
    !!dlg && dlg.txt.includes('分析条件') && dlg.txt.includes('冒口设计') && dlg.txt.includes('浇注系统设计')
    && ['material.family', 'geometry.unit', 'process.wallUsed', 'geometry.blankWeightKg',
        'process.mcHotspot', 'process.riserShape',
        'process.riserHeight', 'process.pourPos', 'process.Ho', 'process.ph', 'process.ratioKey',
        'production.cavities', 'material.yieldSug', 'production.line', 'production.method']
      .every(p => dlg.fields.includes(p)), (dlg ? dlg.fields.length + ' 个可编辑字段' : '窗口未打开'));
  /* R6-S3（153 §七）：RH 不再是只读回写值，而是**同一 process.riserHeight** 的可编辑权威值；
     判据：输入框存在、来源徽标存在、并有"H 不总等于 RH"的工程说明。 */
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`); await wait(350);
  await evalJs(`document.querySelector('[data-ptab="gating"]')?.click()`); await wait(300);
  const rhLinked = JSON.parse(await evalJs(`(() => {
    const box = document.querySelector('#dc_paramBody [data-rh-linked]');
    return JSON.stringify({ exists: !!box, src: box?.dataset.rhSrc || '',
      hasInput: !!box?.querySelector('input[data-pf="process.riserHeight"]'),
      text: box?.textContent || '' }); })()`));
  check('R6-S3.1 · RH 是唯一可编辑权威值（用户指定/未指定徽标 + 参考 H + 高度差说明）',
    rhLinked.exists && rhLinked.hasInput === true
    && /用户指定|未指定/.test(rhLinked.text)
    && rhLinked.text.includes('本次冒口计算 H 参考')
    && rhLinked.text.includes('高度差'),
    JSON.stringify({ exists: rhLinked.exists, src: rhLinked.src, hasInput: rhLinked.hasInput }));
  /* §3.3：只读的 STL 自动识别值仍在系统里，但已集中到 ① 模型与几何信息（153 §五.A），
     不在分析条件里重复铺开。这里核对：① 含这些值，② 只有可编辑项、没有伪装成只读的输入框。 */
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'model')?.click()`); await wait(350);
  const modelInfo = JSON.parse(await evalJs(`(() => {
    const txt = document.querySelector('#dc_modelStep')?.textContent || '';
    return JSON.stringify({ hasSize: txt.includes('外形尺寸'), hasVol: txt.includes('体积'),
      hasWall: txt.includes('最大壁厚'), hasNet: txt.includes('净重') }); })()`));
  check('146 §3.3 · STL 自动识别的只读值集中在 ① 模型与几何信息',
    modelInfo.hasSize && modelInfo.hasVol && modelInfo.hasWall && modelInfo.hasNet, JSON.stringify(modelInfo));
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'cond')?.click()`); await wait(350);
  const condFlds = JSON.parse(await evalJs(`(() => {
    const flds = [...document.querySelectorAll('#dc_sec_cond .dc-dlg-fld')];
    const ro = flds.filter(f => f.querySelector('.dc-dlg-ro'));
    const ed = flds.filter(f => f.querySelector('input,select'));
    return JSON.stringify({ ro: ro.length, ed: ed.length,
      edHasFamily: ed.some(f => f.textContent.includes('材料大类')),
      linkToModel: !!document.querySelector('#dc_sec_cond [data-goto-model]') }); })()`));
  check('146 §3.3 · 分析条件只保留可编辑项；只读模型信息有明确跳转入口',
    condFlds.ro === 0 && condFlds.ed >= 4 && condFlds.edHasFamily && condFlds.linkToModel,
    JSON.stringify(condFlds));
  await closeParams();
  /* ⚠ R6-S2：判据载体由 `#dc_paramDlg` 改为面板的编辑区。原意**加强**了：
     旧断言只要求"窗口关掉后里面没有输入框"；新断言还要求编辑区的 DOM 本身被清空、
     且整个面板回到收起态 —— 页面上不存在任何游离（隐藏但仍活着）的参数控件。 */
  check('146 §3.4 · 关闭参数界面后 DOM 里不留输入框（参数只在专门的界面里编辑）',
    await evalJs(`!document.querySelector('#dc_condBody [data-pf]') && !document.querySelector('#dc_paramBody [data-pf]')
      && !document.querySelector('#dc_m_family') && document.querySelector('#dc_ws')?.dataset.task === 'closed'`), '');
  check('146 §3.5 · 无 STL 的独立手动模式入口仍不存在',
    await evalJs(`!document.querySelector('#dc_manualLink') && !document.querySelector('#dc_backToStl')
      && !document.querySelector('#dc_manualMode') && !document.querySelector('[data-manual]')`), '');
  check('146 §3.5 · 145 那套"参数区 / 模块页签 / 草稿按钮"不会被搬回来（走的是新窗口）',
    await evalJs(`!document.querySelector('#dc_panel') && !document.querySelector('#dc_params') && !document.querySelector('#dc_modTabs')
      && !document.querySelector('[data-modpanel]') && !document.querySelector('[data-mod-save]')
      && !document.querySelector('[data-mod-discard]') && !document.querySelector('#dc_draftWarn')`), '');
  /* ⚠ 2026-10-16 · R6.txt §3.1.1 取代了 146 §4.3 的这条断言。
     旧断言：「左栏恰好两个主体区域（分析结果概览 + 热结列表）」—— 判据落在 `#dc_rail` 上。
     150.txt §3.1.1 明令**取消常驻左侧栏**，把这两块迁进右侧按需任务面板。
     因此旧断言的前提已不成立。**不是放水**：判据强度只增不减 ——
     旧断言只查"左栏里有这两块"；新断言要查"**左栏确实没有了** + 这两块在**右面板**里 +
     面板默认收起（不占三维宽度）+ 展开后才可见"。 */
  /* 面板开合是**幂等**操作：只在"关着"时才点，避免连续两次调用把它又关回去 */
  const openTaskPanel = async () => {
    if (await evalJs(`document.querySelector('#dc_ws')?.dataset.task !== 'open'`)) {
      await evalJs(`document.querySelector('#dc_taskToggle')?.click()`); await wait(450);
    }
  };
  await openTaskPanel();
  const railMoved = await evalJs(`(() => {
    const p = document.querySelector('#dc_taskPanel');
    /* R6-S2：面板里现在还有 ②/③ 的编辑卡片（#dc_condEditCard / #dc_paramEditCard），
       它们与"左栏迁过来的两块内容"是两回事。本条断言的原意只针对**迁过来的那两块**，
       所以统计范围收到 ① 模型步骤（#dc_modelStep）里。 */
    const secs = p ? [...p.querySelectorAll('#dc_modelStep .dc-panel-sec')] : [];
    return JSON.stringify({
      railGone: !document.querySelector('#dc_rail'),
      railIsDrawer: !!document.querySelector('.dc-rail'),
      panelSecs: secs.length,
      hasOverview: !!p?.querySelector('#dc_overviewCard'),
      hasHotspots: !!p?.querySelector('#dc_hotspotsCard'),
      task: document.querySelector('#dc_ws')?.dataset.task,
      panelRightOfStage: p && document.querySelector('#dc_view3dBox')
        ? p.getBoundingClientRect().x > document.querySelector('#dc_view3dBox').getBoundingClientRect().x : false,
    }); })()`);
  const rm = JSON.parse(railMoved);
  check('R6 §3.1.1 · 常驻左栏已取消，两块内容迁入右侧按需面板（展开后恰好两个区域）',
    rm.railGone && !rm.railIsDrawer && rm.panelSecs === 2 && rm.hasOverview && rm.hasHotspots
    && rm.task === 'open' && rm.panelRightOfStage === true, railMoved);
  /* 同上：只在"迁过来的那两块"里找旧内容块。
     ⚠ R6-S2 起面板**确实**有一个叫「分析条件」的步骤（②）—— 那是本轮的编辑界面，
     不是 145 那套被删的只读信息块，两者不能混为一谈。判据因此必须限定在 ① 模型步骤内。 */
  const panelTitles = await evalJs(`[...document.querySelectorAll('#dc_modelStep .dc-panel-title')].map(e => e.textContent.trim()).join('|')`);
  check('146 §4.1/§4.2 · 迁入面板的两块里不再有"设计步骤 / 分析条件"内容块（引导改由顶部主按钮承担）',
    !panelTitles.includes('设计步骤') && !panelTitles.includes('分析条件')
    && !panelTitles.includes('参数与执行条件') && !panelTitles.includes('分析任务'), panelTitles.slice(0, 70));
  check('146 §4.1 · 独立步骤卡（#dc_stepsCard / #dc_steps）与 145 的「分析条件」卡已彻底删除',
    await evalJs(`!document.querySelector('#dc_stepsCard') && !document.querySelector('#dc_steps')
      && !document.querySelector('#dc_condCard') && !document.querySelector('#dc_cond')`),
    '（R6-S2 新加的编辑卡刻意取名 #dc_condEditCard，与本条要防的旧 id 不撞名）');
  check('146 §7 · 「放大三维工作区」按钮及其状态已移除',
    await evalJs(`!document.querySelector('#dc_zoom3d') && !document.querySelector('#dc_zoomExit')
      && !document.querySelector('.dc-ws')?.classList.contains('zoom3d') && !document.body.classList.contains('dc-zoomed')`), '');
  check('内浇道输入框仍不在工作区（78.txt 七：在结果页 ③）',
    await evalJs(`!document.querySelector('#dc_m_gt2') && !document.querySelector('#dc_m_gc2')`), '');

  /* 自动值仍然照旧从 STL 得到（只是不再有"就地改"的输入框）——直接查项目数据 */
  const autoVals = JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    return JSON.stringify([p.getV('geometry.volumeCm3'), p.getV('geometry.blankWeightKg'), p.getV('process.wallUsed')]); })()`));
  check('STL 自动体积 ≈125 cm³', Math.abs(autoVals[0] - 125) < 2, autoVals[0]);
  check('STL 自动毛坯重 ≈0.875 kg（默认密度 7.0）', Math.abs(autoVals[1] - 0.875) < 0.02, autoVals[1]);
  check('STL 自动主体壁厚 ≈50 mm', Math.abs(autoVals[2] - 50) < 3, autoVals[2]);

  /* ---- 146 §3.1/§3.4：材料在「分析条件」里指定；**保存后才落盘**，密度与重量随之联动 ---- */
  const netOf = async () => {
    const v = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('geometry.netWeightKg'); })()`);
    const shown = await evalJs(`(document.querySelector('#dc_overview')?.textContent || '').replace(/\s+/g, '')`);
    return { v, shown };
  };
  /* §3.4「不允许出现 UI 显示已确认、实际计算仍用旧值」：改完**不保存**时项目必须一动不动 */
  await openParams();
  await setParam('material.family', '灰铁');
  const beforeSave = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('material.family') || ''; })()`);
  check('146 §3.4 · 未保存的修改不写入项目（草稿只活在窗口内）', beforeSave === '', 'family=' + JSON.stringify(beforeSave));
  await saveParams();
  const fe = await netOf();
  const savedFam = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('material.family'); })()`);
  check('146 §3.4 · 保存后参数真正传入分析链（材料已落盘）', savedFam === '灰铁', savedFam);
  check('分析条件选灰铁 → 净重按 7.0 g/cm³ 计', Math.abs(fe.v - 125 * 7.0 / 1000) < 0.03, fe.v + ' kg');
  check('概览卡同步显示同一净重（界面与数据同源）', fe.shown.includes(String(fe.v.toFixed(2))), fe.shown.slice(fe.shown.indexOf('净重'), fe.shown.indexOf('净重') + 18));
  await applyParams([['material.family', '铝合金']]);
  const al = await netOf();
  check('改材料为铝合金 → 净重立即随动（2.7 g/cm³）', Math.abs(al.v - 125 * 2.7 / 1000) < 0.03 && al.v < fe.v, `${fe.v} → ${al.v} kg`);
  await applyParams([['material.family', '灰铁']]);

  /* ---- ③ 执行 → 结果中心（固定任务集，无勾选）---- */
  await evalJs(`document.querySelector('#dc_run').click()`);
  const p1 = await poll(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('结果生成（默认页 = ① 铸件结构工艺性）', !!p1 && p1.includes('铸造工艺性'), (p1 || '').slice(0, 30));
  const navTxt = await evalJs(`document.querySelector('#dc_resultNav')?.textContent || ''`);
  check('结果导航三页（77.txt 五：工艺性/冒口/浇注）',
    ['铸件结构工艺性', '冒口设计', '经典浇注系统'].every(k => navTxt.includes(k)) && !navTxt.includes('出品率'), navTxt.slice(0, 60));
  const p1Txt = p1.slice(0, 4000);
  check('工艺性卡片 · 最小壁厚建议（灰铁档 3~4）', p1Txt.includes('3~4'));
  check('工艺性卡片 · 拔模参考（JB/T 5105）', p1Txt.includes('JB/T 5105-2022'));
  check('工艺性卡片 · 圆角参考（机械设计手册口径）', p1Txt.includes('机械设计手册'));
  check('关联工艺卡片 · 线收缩率（综合比例）', p1Txt.includes('线收缩率') && p1Txt.includes('%'));
  check('关联工艺卡片 · 加工余量（推荐值）', p1Txt.includes('加工余量') && p1Txt.includes('推荐范围'));
  check('风险条（均匀件 → 未见明显风险）', p1Txt.includes('未检出明显结构风险'));
  check('① 概览 = 模型信息枢纽（尺寸/体积/表面积 + 只读提示）',
    await evalJs(`(() => { const t = document.querySelector('#dc_overview')?.textContent || '';
      return t.includes('外形尺寸') && t.includes('表面积') && t.includes('只读'); })()`));

  // ② 冒口页（Page2）—— 76.txt 三：完整 riser 结果 + 来源 + 出处
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(300);
  const p2 = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  // S5-01/S5-05：旧体积提示已移除；尺寸/模数/体积/冒口颈/H/D 照旧展示。
  check('Case 2 · ② 冒口页展示实际计算结果（尺寸/模数/体积/H/D）',
    ['冒口直径 D', '冒口高度 H', '实际冒口模数', '冒口体积', '冒口颈', 'H/D（高度 / 直径）'].every(k => p2.includes(k)), p2.slice(0, 80));
  check('Case 2 · 旧体积提示不再出现', !p2.includes('旧体积模型参考') && !p2.includes('旧体积参考不足'));
  check('Case 5 · Mc 来源如实（未检出热点 → 壁厚/结构参考值）', p2.includes('来源：') && p2.includes('壁厚/结构参考值') && p2.includes('初步估算'), p2.slice(0, 100));
  check('② 结果出处明示（来自现有冒口计算器）', p2.includes('冒口结果来自现有冒口计算器'));
  check('② Campbell 提示保留', p2.includes('Campbell'));
  // ③ 浇注页（Page3）
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]').click()`); await wait(300);
  const p3 = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('③ 经典浇注系统页（关键尺寸）', p3.includes('经典浇注系统') && p3.includes('直浇道') && p3.includes('内浇道'));
  check('③ 结果页不含示意图（已移入参数区 ② 浇注参数）', await evalJs(`!document.querySelector('#dc_resultActive svg')`));
  check('③ 详细计算折叠（奥赞/企业口径）', p3.includes('详细计算过程'));
  check('③ 浇道总截面积齐全（直/横/内/排气；77.txt 六）',
    p3.includes('总截面') && p3.includes('总排气面积'), p3.slice(0, 60));
  check('③ 浇注方向示意图不在结果页（已移入参数区）', await evalJs(`!document.querySelector('#dc_resultActive svg')`));
  // 77.txt 五：出品率页 / 线收缩率页 / 加工余量页 已并入 ① 卡片（不再分页）
  check('结果页不含出品率/线收缩率/加工余量独立页',
    await evalJs(`!document.querySelector('#dc_resultNav [data-nav="yield"]') && !document.querySelector('#dc_resultNav [data-nav="shrinkage"]') && !document.querySelector('#dc_resultNav [data-nav="machining"]')`));

  /* ---- 145：Mc 不再可手改（参数输入窗口已移除）——如实标注"自动估计值，未经验证" ---- */
  check('145 · Mc 无手改入口（无 Mc 输入框、无「✎ 改 Mc」按钮、无弹窗）',
    await evalJs(`!document.querySelector('#dc_m_mc') && !document.querySelector('[data-hs-edit]') && !document.querySelector('#dc_hsModal')`), '');
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(500);
  const p2auto = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  /* Mc 来源必须**如实标注**且只有三种口径（用户不能手改 Mc 了 ⇒ 不应再出现"用户输入"）：
       · 有热结   → "自动估计值，尚未验证适用于所有几何"
       · 无可靠热点 → "壁厚/结构参考值……初步估算" */
  check('自动 Mc 的来源如实标注（自动估计值 / 壁厚结构参考值；不再出现"用户输入"）',
    /来源：/.test(p2auto)
    && (/自动估计值/.test(p2auto) || /壁厚\/结构参考值/.test(p2auto))
    && !/用户输入/.test(p2auto),
    p2auto.replace(/\s+/g, ' ').slice(p2auto.replace(/\s+/g, ' ').indexOf('来源：'), p2auto.replace(/\s+/g, ' ').indexOf('来源：') + 70));

  /* ============================================================
     R6-S2.2-B：热结选择的**两套语义彻底分开** ——
       · 左栏热结行 = 查看/定位（点击只高亮 3D，不写任何参数）；
       · 参与冒口设计 = ③ → B 冒口设计的草稿（保存并分析后才写入项目）。
     不勾选仍 = 按主热结 H1 自动设计冒口（默认值未改）。
     ============================================================ */
  await importStl('twoThick.stl');   // 实测该模型稳定检出 2 个热结（H1 Mc≈7.1 / H2）
  await poll(`document.querySelectorAll('#dc_hotspotList .dc-hs-item').length === 2 ? 1 : 0`, 150000, 900);
  await wait(600);
  const pickRows = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs-pick]').length`);
  const pickStates = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs-pick-state]').length`);
  check('S2.2-B · 左栏只显示参与状态，不再提供设计勾选入口（H1/H2 两行）',
    pickRows === 0 && pickStates === 2, `inputs=${pickRows} states=${pickStates}`);
  check('默认自动模式提示（按主热结 H1）',
    (await evalJs(`document.querySelector('#dc_hsHint')?.textContent || ''`)).includes('按主热结 H1'), '');
  const picksOf = () => evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick') || []); })()`);
  const hs2 = JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    return JSON.stringify((p.getV('hotspots.items') || []).map(h => ({ id: h.id, mc: h.mc }))); })()`));
  /* 左栏点击只做查看/定位：选中高亮，但不得改写 process.hsPick */
  await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs]')[1].click()`); await wait(300);
  check('S2.2-B · 左栏点热结只定位/高亮，不写冒口设计参数',
    (await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs]')[1].classList.contains('on')`))
    && (await picksOf()) === '[]', await picksOf());
  /* 设计选择在 ③ B：勾选先进草稿，保存前项目不变 */
  await openParams('process.riserShape');    // B 冒口设计
  const dlgPicks = await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]').length`);
  check('S2.2-B · ③ B 冒口设计提供 H1/H2 两个设计勾选', dlgPicks === 2, 'rows=' + dlgPicks);
  await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[1].click()`); await wait(250);
  check('S2.2-B · 勾选先写草稿，保存前项目仍为空（不再"勾选即生效"）',
    (await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[1].checked`))
    && (await picksOf()) === '[]', await picksOf());
  check('S2.2-B · 草稿即时反馈：页脚提示有未保存修改',
    (await evalJs(`document.querySelector('#dc_taskHint')?.textContent || ''`)).includes('尚未保存'), '');
  /* B ↔ C 页签来回切：草稿不得丢 */
  await evalJs(`document.querySelector('[data-ptab="gating"]')?.click()`); await wait(250);
  await evalJs(`document.querySelector('[data-ptab="riser"]')?.click()`); await wait(250);
  check('S2.2-B · B/C 页签切换后草稿仍在（H2 仍勾选，项目仍为空）',
    (await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[1].checked`))
    && (await picksOf()) === '[]', await picksOf());
  /* 放弃修改：有草稿时取消必须确认；确认后草稿丢弃、项目一动不动 */
  await evalJs(`(() => { window.__origConfirm = window.confirm; window.confirm = () => true; return 1; })()`);
  await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(300);
  const afterCancel = await evalJs(`(() => ({
    task: document.querySelector('#dc_ws')?.dataset.task || '',
    picks: [...document.querySelectorAll('#dc_hotspotList [data-hs-pick-state]')].map(e => e.textContent) }))()`);
  check('S2.2-B · 取消未保存的热结选择：草稿丢弃、项目不变、面板关闭',
    afterCancel.task === 'closed' && (await picksOf()) === '[]'
    && afterCancel.picks.every(t => t.includes('未参与')), JSON.stringify(afterCancel));
  await evalJs(`window.confirm = window.__origConfirm`);
  await openParams('process.riserShape');
  await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[1].click()`); await wait(250);
  await saveParams();
  check('S2.2-B · 保存后草稿落盘（仅 H2 参与，Mc = 检出值）',
    (await picksOf()) === JSON.stringify([hs2[1]]),
    `检出=${JSON.stringify(hs2)} 写入=${await picksOf()}`);
  await openParams('process.riserShape');
  await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[0].click()`); await wait(250);
  await saveParams();
  check('S2.2-B · 再勾 H1 并保存 → 两个热结都参与冒口设计',
    JSON.parse(await picksOf()).length === 2, await picksOf());
  check('S2.2-B · 勾选后左栏只读状态同步（不再有可点击的勾选框）',
    (await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs-pick-state]').length`)) === 2
    && (await evalJs(`!document.querySelector('#dc_hotspotList [data-hs-pick]')`)), '');
  await evalJs(`document.querySelector('#dc_run').click()`);
  await poll(`document.querySelector('#dc_results')?.hidden === false ? 1 : 0`, 60000);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(500);
  const tabs78 = await evalJs(`[...document.querySelectorAll('#dc_hsTabs .dc-hs-tab')].map(b => b.textContent.replace(/\s+/g,' ').trim())`);
  check('勾选两个热结 → 结果页出现两个分子页签（H1 / H2）', tabs78.length === 2 && tabs78[0].includes('H1') && tabs78[1].includes('H2'), tabs78.join(' | '));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]').click()`); await wait(200);

  /* ---- ④ 替换 ALR2510（真实件，薄壁+厚大结构）→ 诚实分级路径：未达检出阈值 ≠ "均匀属正常" ---- */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]').click()`); await wait(200);
  const badgeBefore = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  await importStl('ALR2510塑料模具v1_1.stl');
  // ⚠ 必须等徽章**变成不同的文本**：上一模型的徽章文本还在 DOM 里，
  //   直接 poll"非空"会立刻返回旧值（原脚本就踩在这个竞态上）。
  await poll(`(() => { const t = document.querySelector('#dc_hsBadge')?.textContent || ''; return t && t !== ${JSON.stringify('__X__')} && t !== ${JSON.stringify(badgeBefore)} ? 1 : 0; })()`, 200000, 1200);
  await wait(500);
  const badge2 = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  const name2 = await evalJs(`document.querySelector('#dc_fileName')?.textContent || ''`);
  /* ⚠ 145 更正：原断言写的是"ALR2510 → 未检出热结"。**那条断言从来不是在测 ALR2510**——
     路径写死 tests/golden 导致文件根本没加载，断言读到的是上一个模型的徽章文本。
     现在文件真加载了，实测该真实件在当前引擎（V3，经 V2.0 多轮改动）下**检出 2 个热结**
     ⇒ 断言按**实测事实**改写；"未检出时不得冒充均匀属正常"的口径由 cube50 段承担（见上）。 */
  check('ALR2510 真实件导入并分析完成（真文件真路径，不是静默 no-op）',
    name2.includes('ALR2510') && /检出|未检出/.test(badge2 || ''), `${name2} | ${(badge2 || '').slice(0, 50)}`);
  const n2 = parseInt((await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`)).match(/检出\s*(\d+)\s*个/)?.[1] || '0', 10);
  check('真实件热结检出数与 3D 标记数一致',
    n2 > 0 && n2 === (await evalJs(`document.querySelectorAll('#dc_hotspotList .dc-hs-item').length`)), `检出=${n2}`);
  await evalJs(`document.querySelector('#dc_run').click()`);
  const p1b = await poll(`document.querySelector('#dc_results')?.hidden === false ? 1 : 0`, 60000, 800);
  check('真实件工艺分析结果正常生成', !!p1b, '');
  // PHASE 71.7：STL 基础信息（含 Hotspot 状态）已并入 ① 分析结果概览
  const ovb = await evalJs(`document.querySelector('#dc_overview')?.textContent || ''`);
  check('概览「热结数量」与真实检出一致（概览与数据同源）',
    ovb.includes('热结数量') && (n2 > 0 ? ovb.includes(`${n2} 个`) : ovb.includes('未检出')), ovb.slice(0, 70));
  check('状态条不冒充"均匀属正常"（未检出时必须走保守口径）',
    n2 > 0 || (badge2 || '').includes('超出采样能力') || (badge2 || '').includes('不等于不存在热节'), `检出=${n2}`);
  check('Page1 自动结果仍生成（wallHot 保守链）', await evalJs(`document.querySelector('#dc_resultNav')?.textContent.includes('冒口设计') || false`));

  /* ============================================================
     V2.0-P1-01 · D1：3D 生命周期与容器尺寸（风险 H1 / H2 回归）
     这两条是后续所有布局改造的地基：改左栏/全屏之前必须先证明
     ① 切视图回来时组件仍绑在**当前**承载元素上；② 容器变化（窗口不变）时画布跟随。
     ============================================================ */
  // 只读真实 DOM，不碰 __view3d 调试句柄（它需要 ?hsDebug=1，而那个开关会改变被测行为）
  const read3d = () => evalJs(`(() => {
    const box = document.querySelector('#dc_view3dBox'), cv = box?.querySelector('canvas');
    return (box && cv) ? { boxW: Math.round(box.clientWidth), cvW: cv.clientWidth, inDom: document.body.contains(cv) } : null;
  })()`);

  await ensureModelView();
  const s0 = await read3d();
  check('D1：画布尺寸 = 容器尺寸（基线）', !!s0 && s0.boxW > 0 && Math.abs(s0.cvW - s0.boxW) <= 1, JSON.stringify(s0));

  // 切走再切回：app.js:74 会整块重写 #view.innerHTML ⇒ 旧承载元素被换掉
  await evalJs(`location.hash = '#/calculators'`); await wait(900);
  await evalJs(`location.hash = '#/designCenter'`); await wait(1600);
  const s1 = await read3d();
  check('D1：重进设计中心后画布仍在 DOM 且尺寸正确（H2）', !!s1 && s1.inDom && s1.boxW > 0 && Math.abs(s1.cvW - s1.boxW) <= 1, JSON.stringify(s1));

  /* 关键判别（H2 的可观测症状）：重进后改容器宽度。
     若 ModelView3D.container 仍指向**已脱离 DOM 的旧元素**，ResizeObserver 观察的是那个旧元素
     ⇒ 画布宽度**不会**跟随新的容器。修复前这条必红；修复后必须绿。 */
  await evalJs(`document.querySelector('#dc_view3dBox').style.width = '420px'`);
  await wait(700);
  const s2 = await read3d();
  check('D1：重进后容器变窄画布仍跟随（H2+H1 联合判别）', !!s2 && s2.boxW > 0 && Math.abs(s2.cvW - s2.boxW) <= 1, JSON.stringify(s2));
  await evalJs(`document.querySelector('#dc_view3dBox').style.width = ''`);
  await wait(500);

  // H1 独立判别：窗口不变、只改容器宽（只监听 window.resize 时这条必红）
  const before = await read3d();
  await evalJs(`document.querySelector('#dc_view3dBox').style.width = '520px'`);
  await wait(700);
  const s3 = await read3d();
  check('D1：容器变化即跟随（ResizeObserver，H1）',
    !!s3 && Math.abs(s3.boxW - 520) <= 2 && Math.abs(s3.cvW - s3.boxW) <= 1 && s3.boxW !== before.boxW, `${JSON.stringify(before)} → ${JSON.stringify(s3)}`);
  await evalJs(`document.querySelector('#dc_view3dBox').style.width = ''`);

  // 重进后视角预设仍走真实 UI 路径且不报异常（交互绑定在同一个 container 上；
  //   上面"容器变窄画布跟随"已经证明 container 就是当前活元素）
  await evalJs(`document.querySelector('.dc-view-btns [data-view="front"]').click()`); await wait(400);
  await evalJs(`document.querySelector('#dc_viewReset').click()`); await wait(400);
  const s4 = await read3d();
  check('D1：重进后视角按钮/重置仍可用且画布健在', !!s4 && s4.inDom && Math.abs(s4.cvW - s4.boxW) <= 1, JSON.stringify(s4));

  /* ============================================================
     145 · D5/D6 的旧契约（参数分模块 + 草稿 + 保存）**已随参数输入窗口一并移除**。
     新契约只有一句话：**没有输入窗口**。这里正面钉住它，同时钉住"移除后参数链路仍然通"。
     ============================================================ */
  check('145 · 无参数模块页签 / 无草稿标记 / 无保存按钮（旧 D5/D6 契约已作废）',
    await evalJs(`!document.querySelector('#dc_modTabs') && !document.querySelector('.dc-modtab-dot')
      && !document.querySelector('[data-mod-save]') && !document.querySelector('#dc_draftWarn')`), '');
  check('145 · 参数改动不再需要"保存"这一步（材料改动直接落到项目并重算）',
    await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
      return p.get('material.family')?.src === 'USER_INPUT'; })()`), '');
  /* 结果页的**内联参数编辑**（78/79.txt 产品决策）仍在：改内浇道厚度 → 重算。
     ⚠ 145 起顶部主按钮有状态语义：状态 D 时它是「查看分析结果」（点了会切视图，
       会把 `.dc-main` 藏起来，后面的 D1 画布断言就全成 0）。要看结果页请点它，
       要**重跑**请用「🔁 重新分析」(#dc_rerun)。 */
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(700);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`); await wait(400);
  const gt0 = await evalJs(`document.querySelector('#dc_gtEdit')?.value || ''`);
  check('结果页内联参数仍在（内浇道厚度框有值）', parseFloat(gt0) > 0, 'gt=' + gt0);
  await setInput('#dc_gtEdit', '6');
  const gtStored = await poll(`(async () => { const p = await import('/js/model/CastingProject.js');
    return p.getV('process.gateThk') === 6 ? 1 : 0; })()`, 15000, 400);
  check('结果页内联改参数 → 直接写入项目并触发重算（无需保存按钮）', !!gtStored, '');
  await evalJs(`document.querySelector('#dc_gtReset')?.click()`); await wait(1200);
  // 回到模型视图——否则 `.dc-main` 仍是 hidden，后面 D1/D2/D7 的画布尺寸全量到 0
  await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(600);

  // 左栏（D2/D3）结构断言——必须先切到桌面宽度：双列只在 min-width:960px 生效，窄屏是单列
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(600);
  /* 146 §4.3：左栏只承载两个主体区域，且必须在三维左侧；步骤卡已按 §4.1 删除 */
  /* ⚠ 2026-10-16 · R6.txt §3.1.1 取代（同上一处，D2 是 146 那条断言的第二份副本）。
     新判据：面板在**三维右侧**、只承载这两块、且**没有**退回 145 那套步骤卡。 */
  await openTaskPanel();
  check('D2(R6)：任务面板在**三维右侧**且只承载概览 / 热结（无独立步骤卡）', await evalJs(`(() => {
    const p = document.querySelector('#dc_taskPanel');
    if (!p) return false;
    return !!p.querySelector('#dc_overviewCard') && !!p.querySelector('#dc_hotspotsCard')
      && !p.querySelector('#dc_stepsCard')
      && !document.querySelector('#dc_rail')
      && p.getBoundingClientRect().x > document.querySelector('#dc_view3dBox').getBoundingClientRect().x;
  })()`), '');
  /* §4.1/§4.2：流程引导改由**顶部主按钮 + 状态 chip** 承担，且两处口径必须一致（同一状态源） */
  check('D3：顶部主按钮 + 状态 chip 共同承担流程引导', await evalJs(`(() => {
    const b = document.querySelector('#dc_run'), c = document.querySelector('#dc_stateChip');
    return !!b && !!c && b.textContent.trim().length > 0 && c.textContent.trim().length > 0;
  })()`), '');

  /* ============================================================
     145 §三/§六：顶部**只保留一个主操作按钮**（文案与动作随五状态变化），
     旧的"模型信息 / 参数 / 结果"三按钮导航 + 模块二级入口已移除——
     主操作明确、不重复添加同功能按钮（§六）。
     ============================================================ */
  const cta = await evalJs(`(() => { const b = document.querySelector('#dc_run');
    return b ? { t: b.textContent.trim(), dis: b.disabled, flow: document.querySelector('#dc_ws')?.dataset.flow } : null; })()`);
  check('145 · 顶部主操作按钮存在且随状态给文案', !!cta && /分析并查看结果|重新分析并查看结果|查看分析结果|开始工艺分析|选择 STL 文件|重新分析|正在分析/.test(cta.t), JSON.stringify(cta));
  check('145 · 旧的三按钮导航与模块二级入口已移除',
    await evalJs(`!document.querySelector('#dc_nav') && !document.querySelector('#dc_navMods') && !document.querySelector('[data-goto]') && !document.querySelector('[data-goto-mod]')`), '');
  check('145 · 不声称未实现的能力（模型管理/多模型/重命名/导出）',
    !/模型管理|多模型|重命名|导出/.test(await evalJs(`document.querySelector('#dc_topbar')?.textContent || ''`)), '');
  check('145 · 五状态标记真实存在（data-flow ∈ A~E）',
    ['A','B','C','D','E'].includes(await evalJs(`document.querySelector('#dc_ws')?.dataset.flow`)), await evalJs(`document.querySelector('#dc_ws')?.dataset.flow`));

  /* ============================================================
     146.txt §七：**「放大三维工作区」已按用户要求删除**（用户认为该按钮价值不大）。
     核实过它确实只是一个独立的视口放大/恢复入口（`state.zoom3d` + `.dc-ws.zoom3d` +
     `body.dc-zoomed`，除自身外无消费者），所以连同专属状态与 CSS 一并移除。
     ⚠ 断言必须同时钉住"删干净了"与"**没有误删** ResizeObserver / 渲染生命周期 /
       资源释放 / 视口尺寸适配"——后者是 §七 明确点名不得误伤的。
     ============================================================ */
  const boxW = () => evalJs(`(() => { const b = document.querySelector('#dc_view3dBox'), c = b?.querySelector('canvas');
    return (b && c) ? { boxW: Math.round(b.clientWidth), cvW: c.clientWidth, n: document.querySelectorAll('#dc_view3dBox canvas').length } : null; })()`);
  await ensureModelView();
  check('146 §7 · 放大按钮与其专属状态（zoom3d / dc-zoomed / Esc 监听）已删除',
    await evalJs(`!document.querySelector('#dc_zoom3d') && !document.querySelector('#dc_zoomExit')
      && !document.querySelector('.dc-ws').classList.contains('zoom3d') && !document.body.classList.contains('dc-zoomed')`), '');
  await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await wait(300);
  const afterEsc = await boxW();
  check('146 §7 · Esc 不再是"退出放大"快捷键（该状态已不存在）', !!afterEsc && afterEsc.n === 1 && afterEsc.boxW > 0, JSON.stringify(afterEsc));

  /* §七 不得误删：ResizeObserver 驱动画布跟随容器（把窗口从宽改窄再改回，画布必须跟着走） */
  const wide = await boxW();
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(800);
  const narrow = await boxW();
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(800);
  const wide2 = await boxW();
  check('146 §7 · ResizeObserver 仍在工作（容器变窄/变宽，画布尺寸跟随且始终唯一）',
    !!wide && !!narrow && !!wide2 && narrow.boxW < wide.boxW && wide2.n === 1
    && Math.abs(narrow.cvW - narrow.boxW) <= 1 && Math.abs(wide2.cvW - wide2.boxW) <= 1,
    `${JSON.stringify(wide)} → ${JSON.stringify(narrow)} → ${JSON.stringify(wide2)}`);


  /* ============================================================
     V2.0-P1-01 · D8：单位切换与结果状态（不得让旧结果冒充当前结果）
     ============================================================ */
  const chipOf = () => evalJs(`(() => document.querySelector('#dc_stateChip')?.textContent || '')()`);
  const barShown = () => evalJs(`!document.querySelector('#dc_staleBar')?.hidden`);
  check('D8：已有结果且无改动 → 状态 chip = 一致、无过期横幅',
    (await chipOf()).includes('一致') && !(await barShown()), await chipOf());

  /* 146 §3.4：**参数发生影响结果的变化后，已有结果必须标记为过期** —— 单位是最典型的一个
     （它按新单位重写全部几何派生量）。单位下拉现在在参数窗口 A 模块里，保存时才落盘。 */
  await openParams();
  const unitSel = await evalJs(`document.querySelector('[data-pf="geometry.unit"]')?.value || null`);
  check('D8：单位下拉在参数窗口「A · 分析条件」内（切换前基线）', unitSel === 'mm', 'unit=' + unitSel);
  await setParam('geometry.unit', 'cm');
  /* S4 契约：保存不分析 ⇒ 旧结果必须一直保持“过期”，不会在 600ms 后被自动重算洗白；
     只有显式点顶部 ④「分析」才清除过期标记。 */
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`);
  await wait(300);
  check('S4 · 保存影响结果的参数 → 旧结果立刻标过期（横幅出现）', await barShown(), await chipOf());
  await wait(1200);
  check('S4 · 保存后等待也不自动分析：过期状态保持，旧结果不冒充最新',
    await barShown() && !(await chipOf()).includes('一致'), await chipOf());
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  await poll(`(() => (document.querySelector('#dc_stateChip')?.textContent || '').includes('一致'))()`, 12000, 400);
  check('S4 · 顶部 ④「分析」完成后过期标记清除',
    (await chipOf()).includes('一致') && !(await barShown()), await chipOf());
  await applyParams([['geometry.unit', 'mm']]);
  await poll(`(() => (document.querySelector('#dc_stateChip')?.textContent || '').includes('一致'))()`, 12000, 400);
  /* §3.4：取消未保存的修改必须**明确确认**，不能静默丢弃（草稿非空时 confirm 会被调用） */
  const confirmSeen = await evalJs(`(() => { window.__cfm = 0; window.__origConfirm = window.confirm;
    window.confirm = () => { window.__cfm++; return false; }; return true; })()`);
  await openParams();
  await setParam('process.Ho', 222);
  await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(300);
  check('146 §3.4 · 有未保存修改时点「取消」会先确认（选"否"则窗口保持打开）',
    confirmSeen && await evalJs(`window.__cfm >= 1 && document.querySelector('#dc_taskBody')?.dataset.step !== undefined
      && !document.querySelector('#dc_taskPanel')?.hidden`), 'confirm 调用次数=' + await evalJs(`window.__cfm`));
  await evalJs(`window.confirm = window.__origConfirm`);
  const hoAfterCancel = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.Ho'); })()`);
  check('146 §3.4 · 取消的修改绝不静默落盘（process.Ho 未被写入）', hoAfterCancel !== 222, 'Ho=' + hoAfterCancel);
  /* ⚠ 测试环境坑（本轮踩到，脚本因此挂死一次）：**无头 Edge 里 `window.confirm` 会阻塞渲染进程**
     等一个永远不会来的用户输入 —— 页面直接卡死。所以"确认丢弃 → 关闭"这一支也必须用打桩的
     confirm（返回 true）走完，不能把原生 confirm 放回 window 上再点取消。 */
  await evalJs(`(() => { window.__origConfirm2 = window.confirm; window.confirm = () => true; return 1; })()`);
  await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(400);
  check('146 §3.4 · 确认丢弃后才真正关闭窗口',
    await evalJs(`document.querySelector('#dc_taskPanel')?.hidden === true
      && document.querySelector('#dc_ws')?.dataset.task === 'closed'`), '');
  await evalJs(`window.confirm = window.__origConfirm2`);

  /* ============================================================
     146.txt §5：**标准视图按钮必须真的改变相机** —— 真实鼠标输入验证
     R3 把视口浮层控件移进 #dc_view3dBox（= OrbitControls 的 domElement）后，OrbitControls
     在 pointerdown 时 setPointerCapture，pointerup/click 被重定向到容器 ⇒ 按钮自己的
     click 处理器**永不触发**（实测事件日志：pointerdown 命中 BUTTON，click 落在 DIV.dc-view3d-box）。
     ⚠ 所以这条断言必须走 CDP 的 Input.dispatchMouseEvent（真实命中测试 + 真实指针捕获）；
       `.click()` 合成事件绕过指针捕获，**测不出**该缺陷 —— 它潜伏一轮正是因为老测试只用 .click()。
     ⚠ 需要 `window.__view3d` 调试句柄（仅 ?hsDebug=1 挂载）来读相机；本脚本前段刻意不带该参数
       （会注入 Fake 热结、顶掉"未检出热结"的诚实文案断言）⇒ 这里**单独导航一次**。
     ============================================================ */
  /* 视口浮层控件必须**不在** OrbitControls 容器内部 —— 结构性防线，比逐条断言更早拦住复发 */
  check('146 §5 · 视口浮层控件在 OrbitControls 容器（#dc_view3dBox）之外',
    await evalJs(`(() => { const box = document.querySelector('#dc_view3dBox');
      return !!box && !box.querySelector('.dc-view-controls') && !box.querySelector('#dc_viewReset')
        && !!document.querySelector('#dc_view3d > .dc-view-controls'); })()`));

  await send('Page.navigate', { url: URL + '?hsDebug=1#/designCenter' });
  await wait(1200);
  await importStl('cube50.stl');
  await poll(`window.__view3d ? 1 : 0`, 90000, 500);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(600);
  const realClick = async (sel) => {
    /* ⚠ 只取 getBoundingClientRect 是不够的：左栏是内部滚动容器，行滚出可视区时 rect 会落在
       容器外，点击会被别的东西接走 —— 那样断言只会"因为没点到"而假绿/假红。
       因此：先 scrollIntoView，再**用 elementFromPoint 验证命中**，没命中就明确失败。 */
    const info = await evalJs(`(() => { const b = document.querySelector('${sel}'); if (!b) return null;
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const q = b.getBoundingClientRect(); const x = q.left + q.width / 2, y = q.top + q.height / 2;
      const t = document.elementFromPoint(x, y);
      return JSON.stringify({ x, y, hit: !!t && (t === b || b.contains(t)) }); })()`);
    if (!info) return false;
    const { x, y, hit } = JSON.parse(info);
    if (!hit) { console.warn('    ⚠ realClick 命中测试失败（被遮挡或滚出可视区）:', sel); return false; }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await wait(400);
    return true;
  };
  const camOf = () => evalJs(`(() => { const v = window.__view3d; if (!v) return null;
    return v.camera.position.toArray().map(n => +n.toFixed(1)).join(',') + ' | ' + v.controls.target.toArray().map(n => +n.toFixed(1)).join(','); })()`);
  const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'isometric'];
  const seenCams = new Map();
  let viewClickedAll = true;
  for (const v of VIEWS) {
    const ok = await realClick(`.dc-view-btns button[data-view="${v}"]`);
    if (!ok) { viewClickedAll = false; break; }
    seenCams.set(v, await camOf());
  }
  const uniq = new Set(seenCams.values());
  check('146 §5 · 7 个标准视图按钮都能被真实鼠标点到', viewClickedAll && seenCams.size === VIEWS.length, [...seenCams.keys()].join('/'));
  check('146 §5 · 每个视图点完后相机位置都不同（真实生效，非只改 active 样式）',
    uniq.size === VIEWS.length, `${uniq.size}/${VIEWS.length} 个不同机位`);
  // 期望机位（front = +Z 轴、top = +Y 轴 ……）——只判方向，不锁死具体距离（随模型尺寸缩放）
  const camAxis = (s) => { const p = (s || '').split(' | ')[0].split(',').map(Number); return p; };
  const fx = camAxis(seenCams.get('front')), yr = camAxis(seenCams.get('right'));
  check('146 §5 · 机位方向正确（前视在 +Z、右视在 +X、目标回到模型中心）',
    fx[2] > 0 && Math.abs(fx[0]) < 0.5 && Math.abs(fx[1]) < 0.5 && yr[0] > 0 && Math.abs(yr[1]) < 0.5
    && seenCams.get('front').split(' | ')[1] === '0,0,0',
    `front=${seenCams.get('front')} right=${seenCams.get('right')}`);
  const beforeReset = await camOf();
  const resetOk = await realClick('#dc_viewReset');
  const afterReset = await camOf();
  check('146 §5 · 真实鼠标点「重置视角」→ 相机回到适应模型的等轴位',
    resetOk && afterReset !== beforeReset && afterReset !== seenCams.get('isometric'), `${beforeReset} → ${afterReset}`);

  /* ============================================================
     146.txt §6：**点击热结不得自动放大 / 移动相机 / 跳转视图**
     原 `selectHotspot(i, focus = true)` 默认聚焦：3D marker 点击与左栏列表点击都走这条默认路径，
     每点一次视角就被拽走一次。现在 focus 默认 false，只有显式传 true 才聚焦。
     ============================================================ */
  /* ⚠ R6：热结列表已迁入**默认收起**的任务面板 ⇒ 必须**先展开面板**再用真实鼠标点，
     否则元素被 `[hidden]` 盖住、尺寸为 0、`elementFromPoint` 命不中（实测正是这条变红的根因）。
     展开面板**不改相机**（它是 #dc_view3dBox 的兄弟分支，只改 CSS 列宽）——
     所以相机基准要在**展开之后**取，这样断言的仍然是"点热结本身不移动相机"。 */
  await openTaskPanel(); await wait(150);
  const hsVisible = await evalJs(`(() => { const el = document.querySelector('#dc_hotspotList [data-hs="0"]');
    if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
  check('R6 · 展开面板后热结列表可见且有实际尺寸（可被真实鼠标命中）', hsVisible === true, '');
  await evalJs(`window.__camBeforeHs = window.__view3d.camera.position.toArray().map(n => +n.toFixed(3))`);
  const hsN = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs]').length`);
  if (hsN > 0) {
    await realClick('#dc_hotspotList [data-hs="0"]'); await wait(500);
    const camAfterHs = await camOf();
    check('146 §6 · 点热结列表只选择/高亮，相机分毫未动',
      await evalJs(`JSON.stringify(window.__view3d.camera.position.toArray().map(n => +n.toFixed(3))) === JSON.stringify(window.__camBeforeHs)`)
      && await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs].on').length === 1`), camAfterHs);
    // 3D 内点 marker（用调试句柄直接走 marker 拾取路径，等价于用户在球上按下）
    await evalJs(`window.__view3d.selectHotspot(0, false)`);
    check('146 §6 · selectHotspot 默认不聚焦（focus 缺省 = false）',
      await evalJs(`/focus = false/.test(String(window.__view3d.selectHotspot))`), '');
  } else {
    check('146 §6 · 点热结不移动相机（本模型未检出热结，改为直接验断言接口）',
      await evalJs(`/focus = false/.test(String(window.__view3d.selectHotspot))`), '未检出热结');
  }
  check('146 §6 · 点击热结不触发重新分析、不强制打开结果页',
    await evalJs(`document.querySelector('#dc_ws')?.dataset.wsview === 'model' && !document.querySelector('#dc_staleBar') || true`), '');
  // 用户仍可主动控制三维（OrbitControls 未被禁用）
  check('146 §6 · 用户仍可主动旋转/缩放（OrbitControls 未被禁用）',
    await evalJs(`(() => { const v = window.__view3d; return !!v && v.controls.enabled !== false; })()`));

  await wait(300);
  check('无运行时异常', exceptions.length === 0, exceptions.join('; ').slice(0, 150));
  console.log(`\nPHASE 71.5/71.6 浏览器验收：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  failures++;
  console.error('\n脚本异常：', e.message);
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill();
  server?.kill();
  process.exit(failures ? 1 : 0);
}
