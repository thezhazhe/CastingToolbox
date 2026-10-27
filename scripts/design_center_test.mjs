// ============================================================
// 铸造工艺设计中心 · 端到端冒烟测试（无头 Edge + CDP）
// 流程：打开设计中心 → 导入 cube50.stl → 验证自动几何 → 执行分析 → 验证结果中心
// 用法: node scripts/design_center_test.mjs（需先启动 serve.js 或自动启动）
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9232;
const URL = 'http://localhost:8090/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(URL); if (r.ok) return; } catch (e) {}
    await wait(250);
  }
  throw new Error('server not reachable');
}
async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (r.ok) { const list = await r.json(); const p = list.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; }
    } catch (e) {}
    await wait(200);
  }
  throw new Error('CDP not reachable on ' + CDP_PORT);
}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('not 200'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${process.cwd()}/_edge_profile_dc`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const consoleMsgs = [];   // Runtime.consoleAPICalled 收集（hsDebug 分层输出断言用）

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
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  /* 146：固定视口工作台下**页面不能滚动**（body.view-dc .main{height:100vh;overflow:hidden}），
     所以 scrollIntoView 是 no-op —— 必须显式给足视口高度，否则 3D 工作区的中点在
     451px 高的 headless 窗口里落在视口外，CDP 的鼠标事件会被别的元素接走（实测踩到）。 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(400);
  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1500);

  // awaitPromise：本脚本有若干 `(async () => …)()` 表达式（动态 import 读项目数据）
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  // 1. 视图渲染
  const title = await evalJs(`document.querySelector('#view .page-title')?.textContent || ''`);
  check('进入设计中心视图', title.includes('铸造工艺设计中心'), title);

  // 2. 导入 STL（CDP 文件注入）
  const doc = await send('DOM.getDocument', { depth: 1 });
  const inputNode = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  check('找到文件输入框', !!inputNode.nodeId);
  const stlPath = path.join(ROOT, 'tests', 'golden', 'cube50.stl').replace(/\\/g, '/');
  await send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: [stlPath] });
  await wait(6000);   // 解析 + 3D + 几何分析

  // 3. 3D canvas + 验证结果
  const hasCanvas = await evalJs(`!!document.querySelector('#dc_view3dBox canvas')`);
  check('3D 模型已显示（canvas）', hasCanvas);
  const validateTxt = await evalJs(`document.querySelector('#dc_validate')?.textContent || ''`);
  check('几何验证通过提示', validateTxt.includes('网格闭合'), validateTxt.slice(0, 40));

  // 4. 自动参数（体积/重量来自 STL，命令3 第5节核心验证）
  /* 145 §三：参数输入窗口已移除 ⇒ 自动值不再有"输入框"，直接从项目数据核对
     （判据一字未变：体积/重量/主体壁厚的取值口径必须仍是 STL 自动识别的结果）。 */
  const autoV = JSON.parse(await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js');
    return JSON.stringify([p.getV('geometry.volumeCm3'), p.getV('geometry.blankWeightKg'), p.getV('process.wallUsed')]); })()`));
  check('自动体积 ≈125 cm³', Math.abs(autoV[0] - 125) < 2, autoV[0]);
  check('自动重量 ≈0.875 kg（灰铁密度 7.0）', Math.abs(autoV[1] - 0.875) < 0.02, autoV[1]);
  check('自动主壁厚 ≈50 mm', Math.abs(autoV[2] - 50) < 3, autoV[2]);

  // 5. 选材料（146 §3：在**参数窗口**里指定并保存）+ 执行分析
  await evalJs(`document.querySelector('#dc_paramsBtn').click()`); await wait(400);
  check('146 · 参数窗口可从工具栏打开', await evalJs(`!document.querySelector('#dc_paramDlg')?.hidden`));
  await evalJs(`(() => {
    const sel = document.querySelector('[data-pf="material.family"]');
    const opts = [...sel.options];
    const ht = opts.find(o => o.text.includes('灰铁'));
    sel.value = ht.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(250);
  check('146 · 未保存的修改不写项目（草稿只在窗口内）',
    await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return !p.getV('material.family'); })()`));
  await evalJs(`document.querySelector('#dc_dlgSave').click()`); await wait(1400);
  check('146 · 保存后材料落盘（真正传入分析链）',
    await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('material.family') === '灰铁'; })()`));
  await evalJs(`document.querySelector('#dc_run').click()`);
  await wait(1200);

  // 6. 结果中心
  const resTitle = await evalJs(`document.querySelector('#dc_results .page-title')?.textContent || ''`);
  check('结果中心已生成', resTitle.includes('工艺分析结果'), resTitle);
  // PHASE 71.6：默认页 = ① 结构工艺性；冒口/浇注结果在本页导航对应页（结果内容分区渲染）
  const navAll = await evalJs(`document.querySelector('#dc_resultNav')?.textContent || ''`);
  check('冒口结果页在导航中', navAll.includes('冒口设计'));
  check('浇注系统结果页在导航中', navAll.includes('经典浇注系统'));
  // PHASE 71.7（77.txt 五）：结果只保留三页；出品率与铁水重量页从设计中心剔除
  check('结果导航 = 三页（工艺性 / 冒口 / 浇注）', navAll.includes('铸件结构工艺性') && navAll.includes('冒口设计') && navAll.includes('经典浇注系统') && !navAll.includes('出品率') && !navAll.includes('线收缩率页'), navAll.slice(0, 60));
  check('工艺性页：铸造工艺性 + 关联工艺卡片（线收缩率/加工余量）',
    await evalJs(`(() => { const t = document.querySelector('#dc_resultActive')?.textContent || ''; return t.includes('铸造工艺性') && t.includes('线收缩率') && t.includes('加工余量'); })()`));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`);
  await wait(300);
  const gTxt = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  const gm = gTxt.match(/浇注重量 G\s*([\d.]+)/);
  const g = gm ? parseFloat(gm[1]) : null;
  check('浇注重量合理（0.875kg/0.75 出品率 ≈1.17kg）', g !== null && g > 0.8 && g < 2.0, g);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`);
  await wait(300);
  const rTxt = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  // S5-01/S5-05：旧体积提示已移除；尺寸/来源/H/D 照旧展示。
  check('冒口结果（完整展示）',
    rTxt.includes('冒口直径') && rTxt.includes('H/D（高度 / 直径）') && rTxt.includes('来源：')
    && !rTxt.includes('旧体积模型参考'));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]')?.click()`);
  await wait(200);

  // 6.5 PHASE 71.6（76.txt 一/二）：分析任务选择 UI 已删除——导入后直接进入工艺设计流程
  check('不再出现"分析任务"选择区（DOM 无任务勾选）', await evalJs(`document.querySelector('#dc_tasks') === null && document.querySelectorAll('.dc-task').length === 0`));
  /* ============================================================
     146 §4：左栏精简为**两个主体区域**；「设计步骤」「分析条件」内容块删除，
     参数查看/输入/修改/确认/保存改由**参数窗口**（§3）承担。
     原判据的**原意**逐条保留：不得有"分析任务"、关键参数必须可达（不再藏在高级参数里）、
     内浇道输入不得出现在左栏。只是承载它的 UI 从"左栏分析条件"换成了"参数窗口"。
     ============================================================ */
  const panelTitles2 = await evalJs(`[...document.querySelectorAll('.dc-panel-title')].map(e => e.textContent.trim()).join('|')`);
  check('146 §4.3 · 左栏标题 = 分析结果概览 | 热结列表（无步骤卡/无分析条件块/无"分析任务"）',
    panelTitles2.includes('分析结果概览') && panelTitles2.includes('热结列表')
    && !panelTitles2.includes('设计步骤') && !panelTitles2.includes('分析条件')
    && !panelTitles2.includes('参数与执行条件') && !panelTitles2.includes('分析任务'), panelTitles2.slice(0, 80));
  check('146 §3 · 参数窗口存在，且旧参数区/模块页签/草稿按钮没有被搬回来',
    await evalJs(`!!document.querySelector('#dc_paramDlg') && !!document.querySelector('#dc_paramsBtn')
      && !document.querySelector('#dc_panel') && !document.querySelector('#dc_params') && !document.querySelector('#dc_modTabs')
      && !document.querySelector('[data-modpanel]') && !document.querySelector('[data-mod-save]') && !document.querySelector('#dc_draftWarn')`), '');
  check('146 §3.2 · 参数窗口含三模块 + 关键参数常显（材料大类必填 / 模型单位 / Mc / 浇注系统比例）',
    await (async () => {
      await evalJs(`document.querySelector('#dc_paramsBtn').click()`); await wait(350);
      const t = await evalJs(`document.querySelector('#dc_paramDlg')?.textContent || ''`);
      const fields = await evalJs(`[...document.querySelectorAll('#dc_paramDlg [data-pf]')].map(e => e.dataset.pf).join(',')`);
      await evalJs(`document.querySelector('#dc_dlgX').click()`); await wait(250);
      return t.includes('A · 分析条件') && t.includes('B · 冒口设计') && t.includes('C · 浇注系统')
        && t.includes('材料大类') && t.includes('必填') && t.includes('模型单位')
        && fields.includes('process.mcHotspot') && fields.includes('process.ratioKey');
    })());
  check('146 §3.5 · 手动输入模式入口仍已移除（无 STL / 单项计算走独立计算器）',
    await evalJs(`!document.querySelector('#dc_manualLink') && !document.querySelector('#dc_backToStl')`), '');
  check('内浇道厚度/个数仍不在工作区（78.txt 七：在结果页 ③）',
    await evalJs(`!document.querySelector('#dc_m_gt2') && !document.querySelector('#dc_m_gc2')`), '');
  check('「替换 STL」已改名「导入 STL」', await evalJs(`document.querySelector('#dc_replaceStl')?.textContent.includes('导入 STL') || false`));

  // 7. 热结分析（cube50 均匀实心 → NO_HOTSPOT；Mc 兜底 主体壁厚/2 = 25 仍自动写入冒口参数）
  const hsTxt = await evalJs(`document.querySelector('#dc_resultActive')?.textContent.includes('Hotspot 状态 / 置信度') || false`);
  const hsNoHot = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent.includes('未检出热结') || false`);
  // 145：Mc 不再有输入框 ⇒ 直接查"无热结时 Mc 兜底 = 主体壁厚 / 2"这条计算链的结果
  const mcAuto = await evalJs(`(async () => { const p = await import('/js/model/CastingProject.js'); return p.getV('process.wallHot'); })()`);
  check('① 概览含热点/模型信息（原「模型信息」面板已并入）', await evalJs(`(() => { const t = document.querySelector('#dc_overview')?.textContent || ''; return t.includes('热结数量') && t.includes('外形尺寸') && t.includes('表面积'); })()`));
  check('概览自动值为只读展示（145：不再指向任何"去修改"的参数入口）',
    await evalJs(`(() => { const t = document.querySelector('#dc_overview')?.textContent || '';
      return t.includes('由 STL 自动识别') && t.includes('只读'); })()`), '');
  check('cube50 均匀实心 → 热结状态条如实（未检出，不冒充有热结）', hsNoHot);
  check('Mc 兜底：无热结时 wallHot = 主体壁厚/2 = 25 自动写入项目', Math.abs(parseFloat(mcAuto) - 25) < 3, mcAuto);

  /* 7.4 布局（命令文件：3D 主视图 70% + 右侧 Analysis Panel 30%；在手动模式前检查——手动模式会隐藏 3D）

     144.txt §二 起设计中心是**固定视口工作台**：三维工作区吃满"工具栏以下、状态栏以上"的全部
     剩余高度，页面本身不再滚动。本脚本的 Edge 窗口只有 750×451（且该 profile 还常驻一条
     57px 的生产场景条）——在"页面可滚动"的旧口径下，三维被撑到 64vh(288px) 是靠**页面溢出**
     换来的；固定视口下那样就是违规。
     ⇒ 因此这里把高度判据拆成两条**更贴合契约、且强度不低于原来**的断言：
        ① 桌面窗口（显式 1440×900）下三维主视图高度仍 > 240（原阈值原样保留）；
        ② 小窗下三维吃满工作区剩余高度，且**整页不出视口**（固定视口的真正契约）。 */
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(400);
  const boxH = await evalJs(`document.querySelector('#dc_view3dBox')?.offsetHeight || 0`);
  check('3D 主视图高度（1440×900 桌面窗口，原 >240 判据不变）', boxH > 240, boxH);
  await send('Emulation.clearDeviceMetricsOverride');
  await wait(400);
  const fit = await evalJs(`(() => {
    const b = document.querySelector('.dc-body')?.getBoundingClientRect().height || 0;
    return { boxH: document.querySelector('#dc_view3dBox')?.offsetHeight || 0, bodyH: Math.round(b),
             sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight };
  })()`);
  check('3D 吃满工作台剩余高度（144 §二 固定视口）', fit.boxH > 0 && fit.boxH >= fit.bodyH - 60, JSON.stringify(fit));
  check('整页无滚动（scrollHeight ≤ clientHeight）', fit.sh <= fit.ch, `scroll=${fit.sh} client=${fit.ch}`);
  const hasStage = await evalJs(`!!document.querySelector('.dc-stage')`);
  const hasRail = await evalJs(`!!document.querySelector('#dc_rail')`);
  check('3D 主工作区 + 左侧信息栏结构（145：参数面板整块移除，左栏承担信息）', hasStage && hasRail);
  const viewBtns = await evalJs(`document.querySelectorAll('.dc-view-btns button').length`);
  check('视角预设按钮 = 7（前后左右顶底等轴）', viewBtns === 7, viewBtns);
  const dispMode = await evalJs(`document.querySelector('#dc_dispMode')?.value || ''`);
  check('显示模式默认实体', dispMode === 'solid', dispMode);
  // 视角切换真实生效（相机位置变化）
  const camBefore = await evalJs(`(() => { const c = document.querySelector('#dc_view3dBox canvas'); return c ? 'canvas' : 'none'; })()`);
  await evalJs(`document.querySelector('[data-view="top"]').click()`);
  await wait(100);
  check('视角按钮可点击（canvas 存在）', camBefore === 'canvas', camBefore);
  const metaChip = await evalJs(`document.querySelector('#dc_metaChip')?.textContent || ''`);
  check('模型信息 chip（面数·尺寸）', metaChip.includes('面') && metaChip.includes('mm'), metaChip);
  const resetBtn = await evalJs(`!!document.querySelector('#dc_viewReset')`);
  check('3D 重置视角按钮', resetBtn);
  const hsBadgeTxt = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  check('热结状态条常驻显示（未检出热结时如实表述）', hsBadgeTxt.includes('未检出热结'), hsBadgeTxt.slice(0, 50));

  // 7.4.1 热结列表（cube50 均匀 → 无列表；3D↔UI 联动在 hsDebug 块用 Fake/真实热结验证）
  const hsListItems = await evalJs(`document.querySelectorAll('.dc-hs-item').length`);
  check('均匀件无热结列表（卡片隐藏）', hsListItems === 0, hsListItems);
  check('原「四级 模型信息」独立面板已取消（并入 ① 概览）', await evalJs(`document.querySelector('#dc_geomCard') === null`));

  // 7.4.2 PHASE 71.6：冒口结果页完整展示（Case 2 结果侧）——默认页之外补查 ② 冒口页
  const navTxt = await evalJs(`document.querySelector('#dc_resultNav')?.textContent || ''`);
  check('结果导航三页（77.txt 五：不分这么多页）', ['铸件结构工艺性', '冒口设计', '经典浇注系统'].every(k => navTxt.includes(k)) && !navTxt.includes('出品率'), navTxt.slice(0, 80));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]')?.click()`);
  await wait(300);
  const riserPage = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('② 冒口页：Mc 来源 + 尺寸/模数/体积/H/D/颈 + 结果出处',
    ['来源：', '冒口直径 D', '冒口高度 H', '实际冒口模数', '冒口体积', 'H/D（高度 / 直径）', '冒口颈', '冒口结果来自现有冒口计算器'].every(k => riserPage.includes(k)), riserPage.slice(0, 90));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`);
  await wait(300);
  check('③ 浇注页：总截面积齐全（直/横/内/排气）', await evalJs(`(() => { const t = document.querySelector('#dc_resultActive')?.textContent || ''; return t.includes('总截面') && t.includes('总排气面积'); })()`));
  check('浇注方向示意图随参数输入窗口一并移除（工作区与结果页都不再出现）',
    await evalJs(`!document.querySelector('.dc-gating-diagram') && !document.querySelector('#dc_resultActive svg')`));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]')?.click()`);
  await wait(200);

  /* ============================================================
     145 §三：**手动输入模式已按产品方向移除**（没有 STL / 只做单项计算 → 用独立计算器）。
     这里把"移除"钉成正面断言，并顺带验证独立计算器**没有被改成必须导入 STL**（§一.9）。
     ============================================================ */
  check('145 · 设计中心无手动输入模式（无入口、无手动几何参数、无手动模式提示）',
    await evalJs(`!document.querySelector('#dc_manualLink') && !document.querySelector('#dc_backToStl')
      && !document.querySelector('#dc_p_volume') && !document.querySelector('#dc_p_wallMain')
      && !(document.querySelector('#dc_stlStatus')?.textContent || '').includes('手动输入')`), '');
  // 独立计算器仍可独立使用（不依赖 STL）
  await evalJs(`location.hash = '#/calculators/riser'`); await wait(1400);
  check('145 · 独立计算器不依赖 STL（直接打开即可用）',
    await evalJs(`!!document.querySelector('#view .page-title')`), await evalJs(`document.querySelector('#view .page-title')?.textContent || ''`));
  await evalJs(`location.hash = '#/designCenter'`); await wait(1600);

  // 7.6 hsDebug 调试模式（命令文件：Fake Hotspot 验证显示链路 + 热结问题分层定位）
  //     cube50 = 均匀实心 → 真实算法 NO_HOTSPOT（uniform）
  //     → 注入 Fake TEST-1/2 验证 3D 显示链路（分层 Debug 输出照常）
  await send('Page.navigate', { url: URL + '?hsDebug=1#/designCenter' });   // search 须在 hash 前
  await wait(1500);
  const doc2 = await send('DOM.getDocument', { depth: 1 });
  const input2 = await send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '#dc_file' });
  await send('DOM.setFileInputFiles', { nodeId: input2.nodeId, files: [path.join(ROOT, 'tests', 'golden', 'cube50.stl').replace(/\\/g, '/')] });
  await wait(6000);

  // ① 分层 Debug 输出（第六阶段：算法层证据——先于任何 UI 判断）
  const dbgStatus = consoleMsgs.filter(m => m.includes('[HS-DEBUG]') && m.includes('status='));
  check('hsDebug：console 输出算法 status/reason', dbgStatus.length > 0, dbgStatus[0]?.slice(0, 70));
  const dbgGrid = consoleMsgs.find(m => m.includes('[HS-DEBUG]') && m.includes('网格'));
  check('hsDebug：输出分辨率参数（gs/vs/内部点）', !!dbgGrid, dbgGrid?.slice(0, 70));

  // ② Fake 注入（第三阶段：绕过真实算法验证显示链路）
  const badgeFake = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  check('真实无热结 → 注入 Fake（badge DEBUG）', badgeFake.includes('DEBUG') && badgeFake.includes('Fake'), badgeFake.slice(0, 60));
  const fakeIds = await evalJs(`[...document.querySelectorAll('.dc-hs-id')].map(e => e.textContent).join(',')`);
  check('Fake 列表 H1,H2', fakeIds === 'H1,H2', fakeIds);
  const markerCnt = await evalJs(`window.__view3d ? window.__view3d.markerMeshes.length : -1`);
  check('Fake marker 进入 3D Viewer（2 个）', markerCnt === 2, markerCnt);

  /* ③ 3D↔UI 双向联动（第五阶段）
     146.txt §六 更正：**点击热结只选择/高亮，不得移动相机**。
     原判据要求"点 TEST-2 → 相机聚焦到 (20,30,40)"——那正是用户要求取消的自动放大行为。
     现在反过来钉住更严的契约：点热结**不改**相机与观察目标，但**必须**完成选中/高亮。 */
  const camBeforeHs = await evalJs(`(() => { const c = window.__view3d.camera.position; const t = window.__view3d.controls.target;
    return JSON.stringify([c.x, c.y, c.z, t.x, t.y, t.z]); })()`);
  await evalJs(`document.querySelectorAll('.dc-hs-item')[1].click()`);
  await wait(250);
  const camAfterHs = await evalJs(`(() => { const c = window.__view3d.camera.position; const t = window.__view3d.controls.target;
    return JSON.stringify([c.x, c.y, c.z, t.x, t.y, t.z]); })()`);
  check('146 §6 · 点击 TEST-2 → 只选中/高亮，相机与观察目标分毫未动',
    camAfterHs === camBeforeHs
    && await evalJs(`document.querySelectorAll('.dc-hs-item')[1].classList.contains('on')`),
    `${camBeforeHs} → ${camAfterHs}`);

  /* ④ 坐标保持（第四阶段）：切视图后**热结标记的世界坐标**必须不变 ——
     显示层只换相机，绝不改写热点数据（原判据问的是 controls.target，那是被 146 取消的聚焦行为，
     这里改成问真正的对象：marker 组的 position）。 */
  const mkPos = () => evalJs(`(() => { const g = window.__view3d.markerMeshes[1]; if (!g) return null;
    return [g.position.x, g.position.y, g.position.z].map(v => +v.toFixed(3)).join(','); })()`);
  const posBefore = await mkPos();
  await evalJs(`document.querySelector('[data-view="top"]').click()`);
  await wait(250);
  const posAfter = await mkPos();
  check('旋转视图后 TEST-2 标记世界坐标保持不变（显示层不改热点数据）',
    posBefore != null && posAfter === posBefore, `${posBefore} → ${posAfter}`);

  // ⑤ Orbit 真实鼠标拖拽（第二阶段：Viewer 交互）
  /* ⚠ 前置条件：相机**不能在极点**上。上一步刚点过「顶视图」，相机位于 (0, D, 0)，
     此时轨道球的极角 φ≈0 —— 水平拖拽只改方位角 θ，而 sinφ≈0 ⇒ 相机位置**数学上不会变**，
     断言必然假红（146 前这条之所以"过"，是因为点热结会把相机自动拽走、恰好离开极点；
     §六 取消自动聚焦后相机老实停在顶视图，问题才暴露）。
     ⇒ 拖拽前先「重置视角」回到等轴测，这与"用户能主动旋转"的判据无关，只是把前提摆正。 */
  await evalJs(`document.querySelector('#dc_viewReset').click()`);
  await wait(400);
  const cam0 = await evalJs(`(() => { const c = window.__view3d.camera.position; return [c.x, c.y, c.z]; })()`);
  const v3dRect = await evalJs(`(() => { const r = document.querySelector('#dc_view3dBox').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: v3dRect.x, y: v3dRect.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v3dRect.x + 90, y: v3dRect.y + 50, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: v3dRect.x + 90, y: v3dRect.y + 50, button: 'left', clickCount: 1 });
  await wait(250);
  const cam1 = await evalJs(`(() => { const c = window.__view3d.camera.position; return [c.x, c.y, c.z]; })()`);
  const orbMoved = cam0 && cam1 && Math.abs(cam0[0] - cam1[0]) + Math.abs(cam0[1] - cam1[1]) + Math.abs(cam0[2] - cam1[2]) > 5;
  check('Orbit 拖拽旋转 → 相机移动', orbMoved, `${cam0.map(v => v.toFixed(0)).join(',')} → ${cam1.map(v => v.toFixed(0)).join(',')}`);

  // ⑥ 重进视图：Fake 无双平移（restore 路径兼容）
  await evalJs(`history.pushState({ view: 'home' }, '', '#/home'); window.dispatchEvent(new Event('hashchange'))`);
  await wait(400);
  await evalJs(`history.pushState({ view: 'designCenter' }, '', '#/designCenter'); window.dispatchEvent(new Event('hashchange'))`);
  await wait(600);
  await evalJs(`document.querySelectorAll('.dc-hs-item')[0].click()`);
  await wait(200);
  const tgt3 = await evalJs(`(() => { const c = window.__view3d?.controls.target; return c ? [c.x, c.y, c.z] : null; })()`);
  check('重进视图 TEST-1 仍在原点（无双平移）', tgt3 && Math.abs(tgt3[0]) < 1 && Math.abs(tgt3[1]) < 1 && Math.abs(tgt3[2]) < 1, tgt3?.map(v => v.toFixed(1)).join(','));

  // ⑦ 真实有热结模型（lShape 角部）→ 不注入 Fake（badge 正常显示真实结果 + 3D↔UI 联动）
  const doc3 = await send('DOM.getDocument', { depth: 1 });
  const input3 = await send('DOM.querySelector', { nodeId: doc3.root.nodeId, selector: '#dc_file' });
  await send('DOM.setFileInputFiles', { nodeId: input3.nodeId, files: [path.join(ROOT, 'tests', 'golden', 'lShape.stl').replace(/\\/g, '/')] });
  await wait(12000);
  const badgeReal = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  check('真实有热结模型（L 形）→ 正常检出（不注入 Fake）', badgeReal.includes('检出 1 个热结') && !badgeReal.includes('Fake'), badgeReal.slice(0, 60));
  const hsRealItems = await evalJs(`document.querySelectorAll('.dc-hs-item').length`);
  check('真实热结列表（H1 条目）', hsRealItems >= 1, hsRealItems);
  await evalJs(`document.querySelector('.dc-hs-item').click()`);
  await wait(200);
  const hsRealOn = await evalJs(`document.querySelector('.dc-hs-item.on')?.textContent || ''`);
  // 83.txt 三：列表文案由 "Mc 18.2 mm" 改为带名字的 "模数 18.2 mm"（同时给出区域/置信度）
  check('真实热结列表点击 → 选中高亮', hsRealOn.includes('模数') && hsRealOn.includes('mm') && hsRealOn.includes('区域'), hsRealOn.slice(0, 50));
  await wait(500);   // 等 consoleAPICalled 事件全部到达 CDP
  const h1Line = consoleMsgs.find(m => m.includes('[HS-DEBUG]') && m.includes('H1 '));
  check('hsDebug：真实热结输出 H1 XYZ/Score', !!h1Line, h1Line?.slice(0, 80));

  // 8. 无 JS 异常
  check('无运行时异常', exceptions.length === 0, exceptions.join('; ').slice(0, 120));
  console.log('\n[console]', consoleMsgs.filter(m => /失败|Error|错误|异常/.test(m)).slice(0, 6).join('\n  '));

  console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
  process.exitCode = failures ? 1 : 0;
} catch (e) {
  console.error('测试执行失败:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill();
  if (server) server.kill();
}
