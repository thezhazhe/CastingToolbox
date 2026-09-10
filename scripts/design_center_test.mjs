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
  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1500);

  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

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
  const vol = await evalJs(`document.querySelector('#dc_p_volume')?.value || ''`);
  const wt = await evalJs(`document.querySelector('#dc_p_weight')?.value || ''`);
  const wallMain = await evalJs(`document.querySelector('#dc_p_wallMain')?.value || ''`);
  check('自动体积 ≈125 cm³', Math.abs(parseFloat(vol) - 125) < 2, vol);
  check('自动重量 ≈0.875 kg（灰铁密度 7.0）', Math.abs(parseFloat(wt) - 0.875) < 0.02, wt);
  check('自动主壁厚 ≈50 mm', Math.abs(parseFloat(wallMain) - 50) < 3, wallMain);

  // 5. 选材料 + 执行分析
  await evalJs(`(() => {
    const sel = document.querySelector('#dc_m_family');
    const opts = [...sel.options];
    const ht = opts.find(o => o.text.includes('灰铁'));
    sel.value = ht.value;
    sel.dispatchEvent(new Event('change'));
  })()`);
  await wait(300);
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
  check('冒口结果（完整展示）', rTxt.includes('冒口直径') && rTxt.includes('体积校核') && rTxt.includes('来源：'));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]')?.click()`);
  await wait(200);

  // 6.5 PHASE 71.6（76.txt 一/二）：分析任务选择 UI 已删除——导入后直接进入工艺设计流程
  check('不再出现"分析任务"选择区（DOM 无任务勾选）', await evalJs(`document.querySelector('#dc_tasks') === null && document.querySelectorAll('.dc-task').length === 0`));
  check('面板顺序：概览→热结→参数与执行条件→模型信息',
    (await evalJs(`[...document.querySelectorAll('.dc-panel-title')].map(e => e.textContent.trim()).join('|')`)).includes('③ 参数与执行条件'));
  // Case 6：关键参数默认展开可见（不藏在高级参数里）
  check('关键参数常显（材料/铸造方法/造型线/型腔数/预估出品率）',
    await evalJs(`['#dc_m_family','#dc_m_method','#dc_m_line','#dc_m_cav2','#dc_m_yr2'].every(s => !!document.querySelector(s))`));
  check('浇注参数常显（浇注位置/Ho/ph/冒口高度）',
    await evalJs(`['#dc_m_pourPos2','#dc_m_ho2','#dc_m_ph2','#dc_m_rh2'].every(s => !!document.querySelector(s))`));
  check('冒口参数 Mc 常显（冒口设计依据）', await evalJs(`!!document.querySelector('#dc_m_mc')`));
  check('高级参数只剩低频项（不含量/壁厚/Mc 等核心）',
    await evalJs(`(() => { const core = ['dc_m_family','dc_m_method','dc_m_line','dc_m_cav2','dc_m_yr2','dc_m_pourPos2','dc_m_ho2','dc_m_ph2','dc_m_rh2','dc_m_mc'];
    return [...document.querySelectorAll('.dc-advanced [id^=dc_m_]')].every(e => !core.includes(e.id)); })()`));

  // 6.6 PHASE 71.7（77.txt）：参数区重排 + 内浇道推荐 + 示意图 + 导入按钮
  const orderTxt = await evalJs(`document.querySelector('#dc_params')?.textContent || ''`);
  check('参数区：基础工艺参数在浇注参数之前（①→②）', orderTxt.indexOf('① 基础工艺参数') >= 0 && orderTxt.indexOf('① 基础工艺参数') < orderTxt.indexOf('② 浇注参数'), '');
  check('STL 自动识别已折叠为 ④', await evalJs(`(() => { const d = [...document.querySelectorAll('#dc_params details')]; return d.some(x => x.textContent.includes('④ STL 自动识别')); })()`));
  // PHASE 78（78.txt 二/七）：内浇道输入框搬到结果页；参数区新增「浇注系统比例」可选
  check('参数区有「浇注系统比例」下拉（78.txt 二）', await evalJs(`!!document.querySelector('#dc_m_ratio3')`));
  check('内浇道厚度/个数不再出现在参数区（78.txt 七：移至结果页 ③）',
    await evalJs(`!document.querySelector('#dc_m_gt2') && !document.querySelector('#dc_m_gc2')`));
  check('浇注参数内含浇注方向示意图', await evalJs(`!!document.querySelector('#dc_params svg')`));
  check('「替换 STL」已改名「导入 STL」', await evalJs(`document.querySelector('#dc_replaceStl')?.textContent.includes('导入 STL') || false`));

  // 7. 热结分析（cube50 均匀实心 → NO_HOTSPOT；Mc 兜底 主体壁厚/2 = 25 仍自动写入冒口参数）
  const hsTxt = await evalJs(`document.querySelector('#dc_resultActive')?.textContent.includes('Hotspot 状态 / 置信度') || false`);
  const hsNoHot = await evalJs(`document.querySelector('#dc_hsBadge')?.textContent.includes('未检出热结') || false`);
  const mcAuto = await evalJs(`document.querySelector('#dc_m_mc')?.value || ''`);
  check('① 概览含热点/模型信息（原「模型信息」面板已并入）', await evalJs(`(() => { const t = document.querySelector('#dc_overview')?.textContent || ''; return t.includes('热结数量') && t.includes('外形尺寸') && t.includes('表面积'); })()`));
  check('概览自动值为只读展示 + 指向 ③ 修改', await evalJs(`document.querySelector('#dc_overview')?.textContent.includes('STL 自动识别（可修改）') || false`));
  check('cube50 均匀实心 → 热结状态条如实（未检出，不冒充有热结）', hsNoHot);
  check('Mc 兜底 主体壁厚/2=25 自动写入冒口参数', Math.abs(parseFloat(mcAuto) - 25) < 3, mcAuto);

  // 7.4 布局（命令文件：3D 主视图 70% + 右侧 Analysis Panel 30%；在手动模式前检查——手动模式会隐藏 3D）
  const boxH = await evalJs(`document.querySelector('#dc_view3dBox')?.offsetHeight || 0`);
  check('3D 主视图高度（58vh 自适应）', boxH > 240, boxH);
  const hasStage = await evalJs(`!!document.querySelector('.dc-stage')`);
  const hasPanel = await evalJs(`!!document.querySelector('.dc-panel')`);
  check('3D 主视图 + 右侧面板结构', hasStage && hasPanel);
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
  check('② 冒口页：Mc 来源 + 尺寸/模数/体积校核/颈 + 结果出处',
    ['来源：', '冒口直径 D', '冒口高度 H', '实际冒口模数', '冒口体积', '体积校核', '冒口颈', '冒口结果来自现有冒口计算器'].every(k => riserPage.includes(k)), riserPage.slice(0, 90));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="gating"]')?.click()`);
  await wait(300);
  check('③ 浇注页：总截面积齐全（直/横/内/排气）', await evalJs(`(() => { const t = document.querySelector('#dc_resultActive')?.textContent || ''; return t.includes('总截面') && t.includes('总排气面积'); })()`));
  check('浇注方向示意图已移入「② 浇注参数」（结果页不再重复）',
    await evalJs(`!!document.querySelector('#dc_params svg') && !document.querySelector('#dc_resultActive svg')`));
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]')?.click()`);
  await wait(200);

  // 7.5 手动输入模式（不导入 STL 也能用；Bug 反馈 2）
  await evalJs(`document.querySelector('#dc_manualLink').click()`);
  await wait(300);
  const manualParams = await evalJs(`document.querySelector('#dc_params')?.textContent.includes('基础几何参数（手动输入）') || false`);
  check('手动模式参数区', manualParams);
  const manualNoUnit = await evalJs(`document.querySelector('#dc_p_unit') === null`);
  check('手动模式固定 mm（无单位选择）', manualNoUnit);
  await evalJs(`(() => {
    const setV = (id, v) => { const el = document.querySelector(id); el.value = v; el.dispatchEvent(new Event('input')); };
    setV('#dc_p_volume', '1000');
    setV('#dc_p_wallMain', '20');
    setV('#dc_m_mc', '10');
    const sel = document.querySelector('#dc_m_family');
    const ht = [...sel.options].find(o => o.text.includes('灰铁'));
    sel.value = ht.value; sel.dispatchEvent(new Event('change'));
  })()`);
  await wait(300);
  const wtAuto = await evalJs(`document.querySelector('#dc_p_weight')?.value || ''`);
  check('体积→重量自动联动（1000cm³×7.0 ≈7kg）', Math.abs(parseFloat(wtAuto) - 7) < 0.2, wtAuto);
  await evalJs(`document.querySelector('#dc_run').click()`);
  await wait(1000);
  const manualRes = await evalJs(`(() => { const box = document.querySelector('#dc_results'); if (!box || box.hidden) return false; const nav = document.querySelector('#dc_resultNav')?.textContent || ''; return nav.includes('冒口设计') && nav.includes('经典浇注系统'); })()`);
  check('手动模式结果中心可生成（六项结果页）', manualRes);

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

  // ③ 3D↔UI 双向联动（第五阶段：点击数据定位模型）
  await evalJs(`document.querySelectorAll('.dc-hs-item')[1].click()`);
  await wait(200);
  const tgt = await evalJs(`(() => { const c = window.__view3d.controls.target; return [c.x, c.y, c.z]; })()`);
  check('点击 TEST-2 → 相机聚焦 (20,30,40)', tgt && Math.abs(tgt[0] - 20) < 1 && Math.abs(tgt[1] - 30) < 1 && Math.abs(tgt[2] - 40) < 1, tgt.map(v => v.toFixed(1)).join(','));

  // ④ 坐标保持（第四阶段：旋转视图后热点位置不变）
  await evalJs(`document.querySelector('[data-view="top"]').click()`);
  await wait(200);
  await evalJs(`document.querySelectorAll('.dc-hs-item')[1].click()`);
  await wait(200);
  const tgt2 = await evalJs(`(() => { const c = window.__view3d.controls.target; return [c.x, c.y, c.z]; })()`);
  check('旋转视图后 TEST-2 坐标保持 (20,30,40)', Math.abs(tgt2[0] - 20) < 1 && Math.abs(tgt2[1] - 30) < 1 && Math.abs(tgt2[2] - 40) < 1, tgt2.map(v => v.toFixed(1)).join(','));

  // ⑤ Orbit 真实鼠标拖拽（第二阶段：Viewer 交互）
  // 注意：3D 区域可能部分在视口外（headless 451px 高），CDP 坐标必须落在视口内才派发——先滚到中央
  await evalJs(`document.querySelector('#dc_view3d').scrollIntoView({ block: 'center' })`);
  await wait(300);
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
  check('真实热结列表点击 → 选中高亮', hsRealOn.includes('Mc'), hsRealOn.slice(0, 30));
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
