// ============================================================
// PHASE 78（78.txt）· 浏览器验收
//   A 全屏单列布局（宽窗不切成左右两栏）
//   B 浇注系统比例可选（参数区）+ 参数区不再有内浇道输入
//   C 结果页：内浇道厚度/个数框 / 排气个数框 —— 改动 → 长度与总面积联动
//   D 冒口形状下拉（4 种普通形状 + 发热/保温经验选项，默认圆柱形）
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
/* V2.0-P1-01 D6：冒口参数（含热结勾选 / Mc）改为"草稿 → 保存"两段式——
   勾选本身仍是即时打勾（界面反馈不变），但**要进入项目并参与计算必须先保存**。 */
const saveRiser = async () => { await evalJs(`document.querySelector('[data-mod-save="riser"]')?.click()`); await wait(700); };
const saveGating = async () => { await evalJs(`document.querySelector('[data-mod-save="gating"]')?.click()`); await wait(700); };
const setInput = async (sel, val) => evalJs(`(() => {
  const el = document.querySelector('${sel}');
  if (!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '${val}');
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
})()`);
/* ⚠ 2026-10-16 · R6-S2：参数编辑的载体从浮层窗口 `#dc_paramDlg` 换成右侧任务面板
   （150.txt §3.3）。字段分在 ② 分析条件 与 ③ 的 B/C 两个子模块里 ⇒
   `openParams(path)` 按**真实 UI**（流程条 + 子模块页签）切到含该字段的那一步。
   断言判据本身一字未动，只是"怎么走到那个界面"换了。 */
/* ★ 只查**当前可见步骤**里的字段：② 与 ③ 的 body 都常驻 DOM（切换只加 hidden），
   全局 `[data-pf]` 会命中上一步留下的隐藏节点 ⇒ 误判"已经在这里"，
   于是读到旧 DOM（实测：保存后读不到新渲染的 ↺ 按钮）。 */
const fieldInActiveStep = (path) =>
  path === 'process.mcHotspot'
    ? `!!document.querySelector('#dc_paramStep:not([hidden]) [data-mc-adopted], #dc_paramStep:not([hidden]) [data-pf="${path}"]')`
    : `!!document.querySelector('#dc_condStep:not([hidden]) [data-pf="${path}"], #dc_paramStep:not([hidden]) [data-pf="${path}"]')`;
const openParams = async (path) => {
  await evalJs(`document.querySelector('#dc_paramsBtn')?.click()`); await wait(400);
  if (!path) return;
  if (await evalJs(fieldInActiveStep(path))) return;
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'param')?.click()`);
  await wait(380);
  if (await evalJs(fieldInActiveStep(path))) return;
  for (const tab of ['riser', 'gating']) {
    await evalJs(`document.querySelector('[data-ptab="${tab}"]')?.click()`); await wait(300);
    if (await evalJs(fieldInActiveStep(path))) return;
  }
};
const closeParams = async () => { await evalJs(`document.querySelector('#dc_pfCancel')?.click()`); await wait(300); };
/* S4 契约：保存只写参数；旧用例需要结果时再点顶部 ④「分析」。 */
const saveParams = async (ms = 1500) => {
  await evalJs(`document.querySelector('#dc_pfSave')?.click()`); await wait(220);
  await evalJs(`[...document.querySelectorAll('#dc_flowbar [data-flow-step]')].find(b => b.dataset.flowStep === 'run')?.click()`);
  await wait(ms);
};
/* 146 §三：材料在**参数界面**里选，保存后才落盘 ⇒ 材料联动类断言统一走这里 */
const setFamily = async (fam) => {
  await openParams('material.family');
  await setInput('[data-pf="material.family"]', fam);
  await saveParams(1400);
};
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

  /* ---- A 桌面双列工作区（V2.0-P1-01 D2 取代 78.txt 一的"必须单列"）----
     78.txt 一的**原始诉求**是"用户全屏后布局突变、左右来回看很麻烦"。
     142.txt §四 D2 把工作区定为"左栏信息 + 右 3D"的**始终双列**（窄屏才回落单列）。
     因此判据随之更新，但原诉求仍是判据的一部分：两种宽屏下**列结构必须一致（不突变）**，
     且 3D 随窗口变宽而变宽、左栏宽度固定、3D 占主要宽度。 */
  /* ⚠ 2026-10-16 · R6.txt §3.1.1 取代了这条布局断言的**载体**（原判据落在 #dc_rail 上）。
     150.txt §3.1.1 明令取消常驻左栏 ⇒ 原「左栏定宽、在 3D 左侧」的判据不再成立。
     **不是放水**：原诉求完整保留并升级 ——
       · 原：宽屏不突变成左右两栏、3D 占主要宽度
       · 新：**面板默认收起 ⇒ 3D 占满整行**；展开后才分出右列，且**右列定宽 360**、3D 随窗口变宽。
     另外补一条新的（原布局没有的能力）：**面板开合不重建 3D 容器**（画布仍唯一）。 */
  const layoutAt = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await wait(600);
    return evalJs(`(() => {
      const st = document.querySelector('.dc-stage')?.getBoundingClientRect();
      const body = document.querySelector('.dc-body');
      const ws = document.querySelector('#dc_ws');
      const bb = body?.getBoundingClientRect();
      return st ? { cols: getComputedStyle(body).gridTemplateColumns,
        task: ws?.dataset.task,
        stX: Math.round(st.x), stW: Math.round(st.width), bodyW: bb ? Math.round(bb.width) : 0,
        canvasCount: document.querySelectorAll('#dc_view3dBox canvas').length } : null;
    })()`);
  };
  const colsOf = (L) => (L?.cols || '').trim().split(/\s+/).filter(Boolean).length;
  const L1920 = await layoutAt(1920, 1080);
  const L1280 = await layoutAt(1280, 900);
  check('A(R6) 1920 宽屏：面板**默认收起** ⇒ 单列、3D 占满整行（宽屏不突变成左右两栏）',
    !!L1920 && L1920.task === 'closed' && colsOf(L1920) === 1
    && L1920.stW >= L1920.bodyW - 2 && L1920.stW > 1000,
    JSON.stringify(L1920));
  check('A(R6) 1280→1920：列结构一致、3D 随窗口变宽、画布始终唯一（不重建）',
    !!L1280 && colsOf(L1280) === colsOf(L1920) && L1920.stW > L1280.stW
    && L1280.canvasCount === 1 && L1920.canvasCount === 1,
    `${JSON.stringify(L1280)} → ${JSON.stringify(L1920)}`);
  /* R6 §3.3：**展开面板**后 —— 分出右列、右列定宽、3D 让出宽度但仍是主视觉；
     同时画布仍唯一 ⇒ 证明面板开合**没有重建 3D 容器**（相机/选中状态因此不会丢）。 */
  await evalJs(`document.querySelector('#dc_taskToggle')?.click()`); await wait(600);
  const L1920open = await layoutAt(1920, 1080);
  check('R6-S3 §十一 展开面板（1920）：分出两列、右列 420（不再扩大）、3D 仍占主要宽度',
    !!L1920open && L1920open.task === 'open' && colsOf(L1920open) === 2
    // R6-S3：面板固定 420（≥1600px）；列间距计入后允许 420~440；3D 仍 ≥ 900
    && (L1920.stW - L1920open.stW) >= 420 && (L1920.stW - L1920open.stW) <= 440
    && L1920open.stW >= L1920open.bodyW - 420 - 10
    && L1920open.stW >= 900, `${JSON.stringify(L1920)} → ${JSON.stringify(L1920open)}`);
  check('R6 §3.3 面板开合前后：画布**始终唯一**（未重建 3D 容器）',
    L1920open.canvasCount === 1 && L1920open.canvasCount === L1920.canvasCount, '');
  await evalJs(`document.querySelector('#dc_taskToggle')?.click()`); await wait(500);   // 收起，恢复后续断言的前提
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(300);

  /* ---- 79.txt 一：材料切换 → 重量随材料变化（用户报的核心问题）---- */
  const wtOf = () => evalJs(`document.querySelector('#dc_overview')?.textContent.match(/净重\\s*([\\d.]+)/)?.[1]`);
  const setFam = setFamily;
  await setFam('球铁');
  const wtFe = parseFloat(await wtOf());
  check('79 材料=球铁：净重按 7.1 g/cm³ 计', Math.abs(wtFe - 125 * 7.1 / 1000) < 0.02, `${wtFe} kg`);
  await setFam('铝合金');
  const wtAl = parseFloat(await wtOf());
  check('79 改材料为铝合金 → 净重立即随动（2.7 g/cm³）', Math.abs(wtAl - 125 * 2.7 / 1000) < 0.02 && wtAl < wtFe, `${wtFe} → ${wtAl} kg`);
  const densAl = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return [p.getV('material.solidDensity'), p.getV('material.liquidDensity')]; })()`);
  check('79 密度随材料带入（固 2.7 / 液 2.6）', Math.abs(densAl[0] - 2.7) < 0.01 && Math.abs(densAl[1] - 2.6) < 0.01, JSON.stringify(densAl));
  /* 79.txt 一"举一反三"的**行为**（材料 → 密度/出品率区间随动）保留并仍然生效；
     承载它的**提示 UI**（`.dc-link-hint`，长在参数区里）随参数输入窗口一并移除。
     ⇒ 改为直接查数据：材料切换必须真的把该材料的密度与出品率区间带进项目。 */
  const yieldOf = () => evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    return [p.getV('material.yieldMin'), p.getV('material.yieldMax'), p.getV('material.yieldSug')].join('/'); })()`);
  await setFam('球铁');
  const yFe = await yieldOf();
  await setFam('铝合金');
  const yAl = await yieldOf();
  check('79 材料切换 → 出品率区间真的随材料带出（行为保留）', yFe !== yAl && /\d/.test(yAl), `球铁=${yFe} → 铝=${yAl}`);
  check('79 参数联动提示 UI 已随参数窗口移除（不再有 .dc-link-hint）',
    await evalJs(`!document.querySelector('.dc-link-hint')`), '');
  // 恢复灰铁（后续用例沿用）
  await setFam('灰铁');

  /* ---- H 概览卡片分组（78.txt 九）---- */
  const ov = await evalJs(`[...document.querySelectorAll('#dc_overview .dc-ov-gtitle')].map(e => e.textContent.trim())`);
  check('H 概览分三组（几何 / 重量与壁厚 / 分析结果）', ov.length === 3 && ov[0].includes('几何') && ov[1].includes('壁厚') && ov[2].includes('分析'), ov.join(' | '));
  check('H 概览卡片化（dc-ov-card）', (await evalJs(`document.querySelectorAll('#dc_overview .dc-ov-card').length`)) === 12, '');

  /* ============================================================
     145 §三：**参数输入窗口整块移除** ⇒ 原 B 段（浇注系统比例下拉）与 E 段前半（参数区里的
     热结勾选 + ✎ 改 Mc 弹窗）都没有承载物了。按新契约改写：
       · 比例：手工选择入口没了，`process.ratioKey` 退回既有默认（自动推荐，按材料/重量）；
       · 热结勾选：**能力保留**，搬到左栏热结列表（勾选即生效，无弹窗、无草稿）；
       · Mc 手改：入口随窗口移除（默认仍是热结检出值；结果页如实标注"自动估计值"）。
     判据强度不降：仍然要求"能改的东西真的写进项目并影响结果"。
     ============================================================ */
  await setFamily('灰铁');
  await wait(700);
  /* 146 §3：浇注系统比例**回到参数窗口**（B/C 模块）——旧参数区 #dc_params 仍然不存在，
     但比例选择能力必须在（§0：不得把用户需要控制的参数固定成默认值）。
     判据在"窗口打开"状态下取，否则 `!querySelector` 会因为元素没渲染而恒真（等于没测）。 */
  await openParams('process.ratioKey');
  check('146 §3 · 浇注系统比例在参数界面里可选（旧参数区不再存在）',
    await evalJs(`!!document.querySelector('[data-pf="process.ratioKey"]')
      && !document.querySelector('#dc_params') && !document.querySelector('#dc_m_ratio3') && !document.querySelector('#dc_m_gt2')`), '');
  await closeParams();
  check('比例退回既有默认（自动推荐；未手工指定时 process.ratioKey 为空）',
    !(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.ratioKey'); })()`)), '');

  /* ---- E 热结选择：R6-S2.2-B 起统一走 ③ B 的草稿语义 ----
     左栏只保留查看/定位与只读状态；设计勾选写草稿，保存并分析后才写入项目。 */
  await importStl('twoThick.stl');
  await poll(`document.querySelectorAll('#dc_hotspotList .dc-hs-item').length === 2 ? 1 : 0`, 150000, 900);
  await wait(600);
  const pickRows = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs-pick]').length`);
  const pickStates = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs-pick-state]').length`);
  check('E 左栏热结列表存在（H1/H2），但设计勾选入口只在 ③ B',
    pickRows === 0 && pickStates === 2, `inputs=${pickRows} states=${pickStates}`);
  const picksOf = () => evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick') || []); })()`);
  const det1 = JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    return JSON.stringify((p.getV('hotspots.items') || [])[0]); })()`));
  await openParams('process.mcHotspot');       // ③ → B 冒口设计
  const dlgPickRows = await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]').length`);
  check('E ③ B 冒口设计提供 H1/H2 两个草稿勾选', dlgPickRows === 2, `rows=${dlgPickRows}`);
  await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[0].click()`);
  await wait(250);
  check('E 勾选不再弹窗（78.txt 四·2）', !(await evalJs(`!!document.querySelector('#dc_hsModal')`)), '无弹窗');
  check('E 勾选先写草稿：界面已勾选，但项目未变',
    (await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[0].checked`))
    && (await picksOf()) === '[]', await picksOf());
  await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[1].click()`); await wait(250);
  check('E 再勾 H2 → 两个都进入草稿，保存前项目仍为空', (await picksOf()) === '[]', await picksOf());
  /* R6-S3（153 §六.1）：有勾选热结时，主 Mc 不再是可以改但不算数的输入框，
     而是只读“采用值（= 各勾选 Mc 最大值）”；逐项修改入口在下方热结行。 */
  const mcMode = await evalJs(`(() => ({
    mainInput: !!document.querySelector('[data-pf="process.mcHotspot"]'),
    adopted: document.querySelector('[data-mc-adopted]')?.textContent.trim() || '',
  }))()`);
  check('E S3 · 勾选热结后主 Mc 变只读采用值（不再显示无效输入框）',
    mcMode.mainInput === false && /mm/.test(mcMode.adopted), JSON.stringify(mcMode));
  await saveParams(1600);
  check('E 保存后两个热结都参与冒口设计', JSON.parse(await picksOf()).length === 2, await picksOf());
  /* ⚠ 2026-10-16 · 149.txt §四 取代了 146 轮的断言。
     原断言：「E 「✎ 改 Mc」入口已随参数窗口移除（Mc 不可手改）」——
     那是 146 轮删掉该入口时的判据；149 §四 明确要求**恢复**多热结列表中的逐项 Mc 编辑，
     因此这条断言的前提已不成立。**不是放水**：把它换成对"恢复后行为"的断言，
     判据强度只增不减 —— 旧断言只查"入口不存在"，新断言要查"入口存在且真的能存下去"。 */
  {
    const detAll = JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
      return JSON.stringify(p.getV('hotspots.items') || []); })()`));
    const det2 = detAll.find(x => x.id !== det1.id);
    const mcSetter = `(v) => { const el = document.querySelector('[data-dlg-hs-mc="${det1.id}"]');
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }`;
    await openParams('process.mcHotspot');       // 逐热结 Mc 在 ③ → B 冒口设计
    const hsEdit = await evalJs(`(() => {
      const rows = [...document.querySelectorAll('#dc_paramBody .dc-hsp')];
      const inp = document.querySelector('[data-dlg-hs-mc="${det1.id}"]');
      return { rows: rows.length, has: !!inp, disabled: inp ? inp.disabled : null,
        val: inp ? inp.value : null,
        rowTxt: inp ? inp.closest('.dc-hsp').textContent.replace(/\\s+/g,' ').trim() : '' };
    })()`);
    check('E(149) 逐热结「冒口设计 Mc」输入框已恢复，且落在**该热结那一行**（行内含 ID/检出模数/区域）',
      hsEdit.rows === 2 && hsEdit.has && hsEdit.disabled === false
      && Number(hsEdit.val) === det1.mc && hsEdit.rowTxt.includes('H1') && hsEdit.rowTxt.includes('检出模数'),
      JSON.stringify(hsEdit));

    await evalJs(`(${mcSetter})(17.5)`); await wait(250);
    const projNow = JSON.parse(await picksOf());
    check('E(149) 改 Mc **不写项目**（149 §七：保存前项目数据不变）',
      Math.abs(projNow.find(p => p.id === det1.id).mc - det1.mc) < 1e-9,
      `项目里 H1 仍应是检出值 ${det1.mc}：${JSON.stringify(projNow)}`);
    const shown = await evalJs(`document.querySelector('[data-dlg-hs-mc="${det1.id}"]')?.value`);
    check('E(149) 输入框保持用户刚填的值（界面即时反馈）', shown === '17.5', `val=${shown}`);

    await saveParams(1600);
    const saved = JSON.parse(await picksOf());
    const h1 = saved.find(p => p.id === det1.id), h2 = saved.find(p => p.id === det2.id);
    check('E(149) 保存后：H1 = 17.5，H2 **一字未动**（编辑与该热结绑定，不误改其他热结）',
      !!h1 && Math.abs(h1.mc - 17.5) < 1e-9 && !!h2 && Math.abs(h2.mc - det2.mc) < 1e-9,
      `H1=${JSON.stringify(h1)} H2=${JSON.stringify(h2)} 检出H2=${det2.mc}`);

    // ↺ 改回检出值 —— 必须是"点了真能存下去"的按钮（149 §四末条）
    await openParams('process.mcHotspot');
    const resetDbg = await evalJs(`(async () => {
      const p = await import('/js/model/CastingProject.js');
      return JSON.stringify({
        tab: document.querySelector('[data-ptab].on')?.dataset.ptab || '',
        inp: document.querySelector('[data-dlg-hs-mc="${det1.id}"]')?.value ?? null,
        disabled: document.querySelector('[data-dlg-hs-mc="${det1.id}"]')?.disabled ?? null,
        resets: [...document.querySelectorAll('[data-dlg-hs-mc-reset]')].map(b => b.dataset.dlgHsMcReset),
        picks: p.getV('process.hsPick') || [],
        det: p.getV('hotspots.items')?.[0]?.mc });
    })()`);
    const hasReset = await evalJs(`!!document.querySelector('[data-dlg-hs-mc-reset="${det1.id}"]')`);
    await evalJs(`document.querySelector('[data-dlg-hs-mc-reset="${det1.id}"]')?.click()`); await wait(200);
    await saveParams(1600);
    const back = JSON.parse(await picksOf()).find(p => p.id === det1.id);
    check('E(149) 「↺ 改回检出值」入口存在且**保存有效**（不是看起来可点、实际没效果的按钮）',
      hasReset === true && !!back && Math.abs(back.mc - det1.mc) < 1e-9,
      `hasReset=${hasReset} 保存后=${JSON.stringify(back)} 检出=${det1.mc} debug=${resetDbg}`);
  }

  /* ---- 执行分析 → 结果页 ---- */
  await evalJs(`document.querySelector('#dc_run').click()`);
  await poll(`document.querySelector('#dc_resultActive')?.textContent || ''`, 30000);

  /* ---- G 工艺性页：只 4 张卡（78.txt 六）---- */
  const p1 = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  /* 146 §8：Page1 改为「核心结论卡 + 详细信息折叠」⇒ 4 张关键卡从 `.dc-p1-bcard` 变成
     页内 `.dc-core-card`（标题在 `.dc-core-label`）。判据强度不变：仍然是**只 4 张**、
     仍然是那四项、仍然不得出现已删除的「厚薄壁过渡 / 结构风险摘要」。 */
  const cardTitles = await evalJs(`[...document.querySelectorAll('#dc_resultActive .dc-core-row .dc-core-card .dc-core-label')].map(e => e.textContent)`);
  check('G 工艺性卡片 = 最小壁厚 / 圆角 / 拔模 / 最小铸孔（4 张，且不含已删的厚薄/结构风险卡）',
    cardTitles.slice(0, 4).join('|') === '最小壁厚|铸造圆角|拔模斜度|最小铸出孔径'
    && cardTitles.length === 6   // 4 张工艺性 + 线收缩率 + 加工余量
    && !cardTitles.some(t => t.includes('厚薄') || t.includes('结构风险')),
    cardTitles.join('/'));

  /* ---- C 结果页内浇道/排气框（78.txt 七/八）---- */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]').click()`); await wait(400);
  const g0 = await evalJs(`(() => ({
    gt: document.querySelector('#dc_gtEdit')?.value, gc: document.querySelector('#dc_gcEdit')?.value,
    ventN: document.querySelector('#dc_ventN')?.value,
    canvasLen: document.querySelector('#dc_gtEdit')?.closest('.dc-edit-box')?.querySelector('.dc-edit-res')?.textContent.match(/单条长 (\\d+(?:\\.\\d+)?)/)?.[1],
    area: document.querySelector('#dc_resultActive')?.textContent.match(/总截面 (\\d+(?:\\.\\d+)?)/)?.[1],
    ventArea: document.querySelector('#dc_resultActive')?.textContent.match(/总排气面积 (\\d+(?:\\.\\d+)?)/)?.[1],
  }))()`);
  // 内浇道推荐厚度随件而变（原用例的 10 来自被删掉的 seedHotspots 场景）⇒ 只要求"带出了合理推荐值"
  check('C 内浇道厚度/个数框在结果页（推荐值已带出）',
    parseFloat(g0.gt) > 0 && parseFloat(g0.gc) >= 1, JSON.stringify(g0));
  // （排气口径已按 79.txt 四改为"用户定直径、系统算孔数"，详见下方 79 段）
  // 改厚度 → 长度联动（重算链）
  const gtNew = String(Math.max(1, Math.round(parseFloat(g0.gt) * 1.5)));
  await setInput('#dc_gtEdit', gtNew);
  const g1 = await poll(`(() => { const m = document.querySelector('#dc_gtEdit')?.closest('.dc-edit-box')?.querySelector('.dc-edit-res')?.textContent.match(/单条长 (\\d+(?:\\.\\d+)?)/); return m && m[1] !== '${g0.canvasLen}' ? m[1] : ''; })()`, 15000, 500);
  check(`C 改厚度 ${g0.gt} → ${gtNew}：内浇道长度自动重算`, !!g1 && g1 !== g0.canvasLen, `${g0.canvasLen} → ${g1}`);
  const gtStored = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.gateThk'); })()`);
  check('C 厚度写回项目（用户输入）', gtStored === 6, `gateThk=${gtStored}`);
  // 改个数 → 内浇道长度随之重算（阻流面积不变，几何按 个数×厚度 反算长度）
  const len1 = await evalJs(`document.querySelector('#dc_gtEdit')?.closest('.dc-edit-box')?.querySelector('.dc-edit-res')?.textContent.match(/单条长\\s*([\\d.]+)/)?.[1]`);
  await setInput('#dc_gcEdit', '4');
  const g2 = await poll(`(() => { const m = document.querySelector('#dc_gtEdit')?.closest('.dc-edit-box')?.querySelector('.dc-edit-res')?.textContent.match(/单条长\\s*([\\d.]+)/); return m && m[1] !== '${len1}' ? m[1] : ''; })()`, 15000, 500);
  const gcStored = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('production.ingateN'); })()`);
  check('C 改个数 2 → 4：内浇道长度随之重算', !!g2 && gcStored === 4, `${len1} → ${g2} mm（个数写入=${gcStored}）`);
  // PHASE 80（79.txt 追问）：横浇道与内浇道同级可改（厚度 / 条数 → 长度自动重算）
  // 164.txt 五：默认截面改为按浇注类型自动匹配梯形；本段验证矩形功能，先显式选择矩形。
  await setInput('#dc_runnerSection', 'rect');
  const rectReady = await poll(`document.querySelector('#dc_rtEdit') ? 1 : 0`, 20000, 500);
  check('C 横浇道可显式选择矩形并恢复矩形输入/结果', !!rectReady, '');
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

  /* ---- D 冒口形状：R6-S3 起**唯一编辑入口在参数面板**（153 §六.3/§八）----
     结果页只读展示，不再维护第二个下拉。 */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
  const resultShape = await evalJs(`(() => ({
    hasSelect: !!document.querySelector('#dc_riserShape'),
    readonly: !!document.querySelector('#dc_resultActive [data-shape-readonly]'),
    editBtn: !!document.querySelector('#dc_resultActive [data-edit-param="process.riserShape"]'),
  }))()`);
  check('D 结果页不再提供第二个形状下拉，只有只读展示 + 去冒口设计入口',
    resultShape.hasSelect === false && resultShape.readonly && resultShape.editBtn, JSON.stringify(resultShape));
  const before = await evalJs(`document.querySelector('#dc_resultActive')?.textContent.match(/补缩效率\\s*(\\d+)%/)?.[1]`);
  await openParams('process.riserShape');
  const shapeInfo = await evalJs(`(() => {
    const sel = document.querySelector('[data-pf="process.riserShape"]');
    return sel ? { n: sel.options.length, names: [...sel.options].map(o => o.textContent), cur: sel.value } : null;
  })()`);
  check('D 参数面板的冒口形状下拉 4 种普通形状 + 发热/保温经验选项（唯一入口）',
    shapeInfo && shapeInfo.n === 5 && shapeInfo.names.some(n => n.includes('发热/保温')), JSON.stringify(shapeInfo && shapeInfo.names));
  await setInput('[data-pf="process.riserShape"]', 'sphere_head');
  await saveParams(1600);
  const shapeProj = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.riserShape'); })()`);
  check('D 保存并分析后形状写回项目', shapeProj === 'sphere_head', shapeProj);
  await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(500);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`); await wait(400);
  const after = await poll(`(() => { const m = document.querySelector('#dc_resultActive')?.textContent.match(/补缩效率\\s*(\\d+)%/); return m && m[1] !== '${before}' ? m[1] : ''; })()`, 15000, 500);
  check('D 切换形状 → 重算（效率 14% → 25%）', !!after && before === '14' && after === '25', `${before}% → ${after}%`);

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
  /* 145：手动输入入口已移除 ⇒ 刷新后要重新导入一个**真实** 2 热结模型
     （原实现靠 seedHotspots 往项目里塞数据让参数区渲染出勾选列表；
       现在列表由 state.hotspots 驱动，必须走真实导入路径）。 */
  await importStl('twoThick.stl');
  await poll(`document.querySelectorAll('#dc_hotspotList .dc-hs-item').length === 2 ? 1 : 0`, 150000, 900);
  await wait(600);
  const oldPick = await evalJs(`document.querySelectorAll('#dc_hotspotList [data-hs-pick-state]').length`);
  const detF = JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    return JSON.stringify((p.getV('hotspots.items') || [])[0]); })()`));
  await openParams('process.mcHotspot');
  await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[0].click()`); await wait(250);
  const draftVal = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick') || []); })()`);
  await saveParams(1600);
  const oldChecked = await evalJs(`document.querySelectorAll('#dc_paramBody [data-dlg-hs]')[0]?.checked === true`);
  const oldVal = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return JSON.stringify(p.getV('process.hsPick') || []); })()`);
  check('F 旧存档（缺 71.7/78 新增字段）下：勾选 H1 先入草稿，保存后写入项目（根因已修复）',
    oldPick === 2 && draftVal === '[]' && oldChecked === true
    && oldVal === JSON.stringify([{ id: detF.id, mc: detF.mc }]),
    `states=${oldPick} draft=${draftVal} checked=${oldChecked} val=${oldVal} 检出=${JSON.stringify(detF)}`);

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
