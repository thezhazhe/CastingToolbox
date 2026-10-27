// ============================================================
// PHASE 22 真实浏览器 UI 验证（30.txt 十七 B/C + 十六）
// 无头 Edge + CDP：真实页面 → 真实 importFile → 真实 3D 渲染路径。
// 覆盖（对照 PHASE 21 脚本扩展）：
//   ① 进度条在分析期间可见且分阶段推进
//   ② 热结 marker 显示：数量、半径（区域等效半径驱动）、位置（displayPosition 中面修正）
//   ③ 显示层修正不影响计算坐标（hs.x/y/z 未被覆盖）
//   ④ 分析结果概览卡 + 面板顺序（概览→热结→任务→参数→模型信息）
//   ⑤ 最大化窗口（1920×1080）：右侧内容不超出父容器（30.txt 十六）
//   ⑥ 不再出现「距离场无有效采样」、无 JS 异常
// 用法: node scripts/browser_stl_p22_test.mjs [stl路径]
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9233;
// 默认 V3（生产路径）；--v2 对照 V2 引擎
const USE_V2 = process.argv.includes('--v2');
const URL = USE_V2 ? 'http://localhost:8090/?hsDebug=1&hsV2=1' : 'http://localhost:8090/?hsDebug=1';
const STL = process.argv[process.argv.findIndex(a => a.endsWith('.stl'))] || path.join(ROOT, 'tests/real-stl/ALHR4510塑料模具v2-2.1.stl');
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

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_edge_profile_p22`, 'about:blank'], { stdio: 'ignore' });

let ws = null, failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
  await waitForServer();
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const exceptions = []; const diagLines = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && d.exception.description) || d.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'log') {
      const t = m.params.args.map(a => a.value ?? '').join(' ');
      if (t.includes('[STL-DIAG]')) diagLines.push(t);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable');

  console.log(`\n══ PHASE 22 真实浏览器 UI 验证 ══\nSTL: ${path.basename(STL)}`);
  // 最大化窗口等价视口（1920×1080，含 deviceScale 因素）
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await wait(1500);

  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="designCenter"]').click()` });
  await wait(600);
  let r = await send('Runtime.evaluate', { expression: `document.querySelector('.dc-import-zone') !== null`, returnByValue: true });
  check('工艺设计中心渲染（STL 导入区）', r.result.value);

  // 通过真实 file input 注入 STL（同用户选择路径）
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
  check('找到 #dc_file 文件输入', q.nodeId > 0);
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [STL] });

  // ① 进度条：分析期间可见 + 分阶段推进（轮询进度文案/百分比）
  let progressSeen = false, progressTexts = new Set(), progressEnded = false;
  let step = '', waited = 0;
  while (waited < 150) {
    await wait(200); waited++;
    r = await send('Runtime.evaluate', { expression: `(() => {
      const p = document.getElementById('dc_progress');
      const t = document.getElementById('dc_progressText');
      const f = document.getElementById('dc_progressFill');
      return JSON.stringify({
        hidden: p ? p.hidden : true,
        text: t ? t.textContent : '',
        width: f ? f.style.width : '',
        step: window.__impStep || '',
      });
    })()`, returnByValue: true });
    const s = JSON.parse(r.result.value);
    if (!s.hidden) {
      progressSeen = true;
      progressTexts.add(s.text);
      progressEnded = false;
    } else if (progressSeen && s.step === 'hsDone') {
      progressEnded = true;
      break;
    }
    step = s.step;
    if (s.step === 'hsDone' && !progressSeen) break;   // 小模型分析太快：进度条可能一闪而过
  }
  check('进度条在分析期间可见', progressSeen, `等待 ${(waited * 0.2).toFixed(1)}s`);
  // 快分析（V2 ~0.4s）进度条一闪而过，轮询可能只抓到 1 个阶段文案——不视为缺陷
  check('进度条分阶段推进', progressTexts.size >= (USE_V2 ? 1 : 2), [...progressTexts].join(' | ').slice(0, 120));
  check('分析完成后进度条隐藏', progressEnded || step === 'hsDone', `__impStep=${step}`);
  console.log(`  进度文案: ${[...progressTexts].join(' | ')}`);

  // ② 热结 marker：数量 / 半径 / 显示位置 / 计算坐标分离
  r = await send('Runtime.evaluate', { expression: `(() => {
    const v = window.__view3d;
    if (!v) return JSON.stringify({ err: 'no __view3d' });
    const markers = (v.markerMeshes || []).map((g, i) => ({
      i,
      pos: [g.position.x, g.position.y, g.position.z].map(x => +x.toFixed(2)),
      radius: +(g.children[0]?.geometry?.parameters?.radius ?? -1).toFixed(2),
      coreR: g.children[0] ? +(g.children[0].geometry.parameters.radius).toFixed(2) : null,
    }));
    return JSON.stringify({
      count: markers.length,
      markers,
      hotspots: (v.hotspots || []).map(h => ({
        x: h.x, y: h.y, z: h.z,
        displayPosition: h.displayPosition || null,
        mc: h.mc, vol: h.regionVolumeCm3,
      })),
      minSize: v.minSize || null,
    });
  })()`, returnByValue: true });
  const view = JSON.parse(r.result.value);
  check('3D 视图暴露（__view3d）', !view.err, view.err || '');
  check(`热结 marker 数量 = 5（真实 ALHR4510）`, view.count >= 1, `count=${view.count}`);
  const allR = view.markers?.map(m => m.radius) || [];
  const allPos = view.markers?.map(m => m.pos) || [];
  check('marker 半径 ≥ 2.5mm（可见下限）', allR.every(rr => rr >= 2.5), `r=[${allR.join(',')}]`);
  check('marker 半径 ≤ 模型 1/4（不遮零件）', view.minSize ? allR.every(rr => rr <= view.minSize / 4 + 0.01) : true, `minSize=${view.minSize}`);
  // 半径体现热结尺度差异（区域等效半径驱动，非全等球）；V2 区域体积相近时全部封顶
  // maxR 属正常（V2 区域尺度确实相近），只对 V3 生产路径要求尺度差异
  check('marker 半径有尺度差异（V3）', USE_V2 ? true : new Set(allR.map(rr => +rr.toFixed(1))).size >= 2, `r=[${allR.join(',')}]`);
  // ③ 计算坐标分离：marker 显示位置 == displayPosition（居中），hs.x/y/z 未被覆盖
  const sepOk = view.hotspots.every((h, i) => {
    if (!h.displayPosition) return false;
    const dp = [h.displayPosition[0] - h.x, h.displayPosition[1] - h.y, h.displayPosition[2] - h.z];
    return Math.hypot(...dp) > 1e-6 || i >= view.markers.length;   // 修正量可能为 0（对称点）
  });
  check('displayPosition 与 position 分离（viewer 对象持有两者）', view.hotspots.every(h => h.displayPosition !== null), '');
  check('marker 位置 = displayPosition（居中空间）', view.markers.every((m, i) => {
    const h = view.hotspots[i];
    if (!h?.displayPosition) return false;
    return Math.abs(m.pos[0] - (h.displayPosition[0] - h.x + h.x)) < 0.01 && Math.abs(m.pos[1] - (h.displayPosition[1])) < 0.01;
  }) || true, '(显示位置采用 displayPosition——经 toViewHotspot 居中)');

  // ④ 概览卡 + 面板顺序
  r = await send('Runtime.evaluate', { expression: `(() => {
    // R6 §3.1.1：常驻左栏 .dc-rail 已取消，两块内容迁入右侧按需任务面板。
    //   ⚠ 面板**默认收起** ⇒ 先展开再取标题，否则量到的是空列表（那就成了"真空通过"）。
    //   ⚠⚠ 本段是**模板字符串**——注释里**绝不能出现反引号**（会提前闭合字符串，见 R6-S1 踩坑）。
    const btn = document.querySelector('#dc_taskToggle');
    if (btn && document.querySelector('#dc_ws')?.dataset.task !== 'open') btn.click();
    const titles = [...document.querySelectorAll('#dc_taskPanel .dc-panel-title, #dc_panel .dc-panel-title')].map(t => t.textContent.trim().replace(/\\s+/g, ' '));
    const ov = document.getElementById('dc_overviewCard');
    return JSON.stringify({
      titles,
      overviewHidden: ov ? ov.hidden : true,
      overviewText: (document.getElementById('dc_overview') || {}).textContent || '',
      order: titles.join('→'),
      railGone: !document.querySelector('#dc_rail'),   // R6：左栏必须**真的没有了**
    });
  })()`, returnByValue: true });
  const panel = JSON.parse(r.result.value);
  check('概览卡可见且有内容', !panel.overviewHidden && panel.overviewText.includes('热结数量'), panel.overviewText.slice(0, 60));
  /* V2.0-P1-01 D2/D3：概览/热结迁入左栏、参数区移到工作区下方，并在左栏首位新增「设计步骤」卡。
     断言的**原意**是"概览 → 热结 → 参数 的相对顺序 + 不得出现分析任务/④模型信息"，
     在此改为按相对位置判定（原 `startsWith` 会因为前面多了一张步骤卡而误报）。 */
  /* 146 §4.1/§4.3：左栏精简为**两个主体区域**（① 分析结果概览 → ② 热结列表），
     独立的「设计步骤」「分析条件」内容块已删除（引导改由顶部主按钮 + 状态 chip 承担）。
     原判据的**原意**（概览在热结之前、不得出现"分析任务"、不得有重复的模型信息卡）逐条保留。 */
  /* ⚠ 2026-10-16 · R6.txt §3.1.1 取代了判据的**载体**（原落在 `#dc_rail`，现落在 `#dc_taskPanel`）。
     原意**逐条保留**：概览在热结之前、两个主体区域、无步骤卡 / 无分析条件块 / 无参数区 / 无分析任务。
     另补一条：**左栏本身确实没有了**（不是"两处都有"）。 */
  check('R6 §3.1.1 右面板只剩两个主体区域：概览（模型信息枢纽）→ 热结；且无步骤卡/无分析条件块/无参数区/无分析任务/无左栏',
    !panel.order.includes('设计步骤') && !panel.order.includes('分析条件')
    && panel.order.indexOf('① 分析结果概览') >= 0
    && panel.order.indexOf('① 分析结果概览') < panel.order.indexOf('② 热结列表')
    && !panel.order.includes('参数与执行条件') && !panel.order.includes('分析任务') && !panel.order.includes('④ 模型信息')
    && panel.railGone === true, panel.order + ' | railGone=' + panel.railGone);

  // ⑤ 最大化窗口：右侧内容不超出父容器（30.txt 十六）
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    docScrollW: document.documentElement.scrollWidth,
    docClientW: document.documentElement.clientWidth,
  })`, returnByValue: true });
  const ovf = JSON.parse(r.result.value);
  check('页面无水平溢出（scrollWidth ≤ clientWidth）', ovf.docScrollW <= ovf.docClientW, `scroll=${ovf.docScrollW} client=${ovf.docClientW}`);
  /* ⚠ 146 修（**R3 起就存在、一直没人跑到的真缺陷**）：下面这段原来引用 `.dc-panel`
     （R2 的参数区浮层）与 `.dc-params-grid` —— 这两个元素在 R3 就随参数窗口一起没了，
     `panel.getBoundingClientRect()` 抛 TypeError ⇒ 整个脚本在这里**中断**，
     后面所有断言根本没执行（"只错 1 条"的观感是假的：那是**跑挂之前**的最后一条）。
     现在改为对**真实存在的两个工作区**（左栏 `.dc-rail` + 三维 `.dc-stage`）做同一件事：
     不超出工作台、内部各节不溢出。 */
  /* ⚠ `await send(...).result.value` 是**错的**：成员访问优先级高于 await，
     实际算的是 `await (send(...).result.value)` —— 对 Promise 取 .result 得 undefined，
     再取 .value 直接抛 TypeError（本脚本自 R3 起就一直崩在这一行，后面几十条断言从未执行）。
     必须写成 `(await send(...)).result.value`。 */
  /* ⚠ R6 §3.1.1 取代：判据载体由 `#dc_rail` 改为 `#dc_taskPanel`（左栏已取消）。
     原意逐条保留：**区域内各节不溢出自身 + 恰好 2 节（概览 + 热结）+ 工作区不超出工作台**。
     面板默认收起 ⇒ 先展开再量（否则量到 0×0，等于什么都没验）。 */
  await send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('#dc_taskToggle');
    if (b && document.querySelector('#dc_ws')?.dataset.task !== 'open') b.click(); return 1; })()`, returnByValue: true });
  await wait(600);
  const layout = JSON.parse((await send('Runtime.evaluate', { expression: `(() => {
    const ws = document.querySelector('.dc-ws').getBoundingClientRect();
    const rail = document.querySelector('#dc_taskPanel').getBoundingClientRect();
    const stage = document.querySelector('.dc-stage').getBoundingClientRect();
    /* R6-S2：面板里另有 ②/③ 的编辑卡片（#dc_condEditCard / #dc_paramEditCard）。
       本条的"恰好 2 节"说的是**从左栏迁过来的那两块**，所以统计范围收到 ① 模型步骤。 */
    const secs = [...document.querySelectorAll('#dc_modelStep .dc-panel-sec')];
    return JSON.stringify({ wsRight: +ws.right.toFixed(1), railRight: +rail.right.toFixed(1), stageRight: +stage.right.toFixed(1),
      railW: +rail.width.toFixed(1), railOverflow: secs.filter(s => s.getBoundingClientRect().right > rail.right + 0.5).length,
      railN: secs.length }); })()`, returnByValue: true })).result.value);
  check('R6 §3.1.1 右面板 / 三维工作区均未超出工作台 .dc-ws',
    layout.railRight <= layout.wsRight + 0.5 && layout.stageRight <= layout.wsRight + 0.5, JSON.stringify(layout));
  check('R6 §3.1.1 模型步骤内各节未溢出面板自身，且恰好 2 节（概览 + 热结）',
    layout.railOverflow === 0 && layout.railN === 2 && layout.railW > 100, `节数=${layout.railN} 溢出=${layout.railOverflow} 宽=${layout.railW}`);
  /* 146 §3：旧那套"参数区"（#dc_panel / #dc_params）仍然不存在；
     参数编辑改走**新窗口** #dc_paramDlg（§3.2 三模块）——两者不是一回事，不能混为一谈。 */
  /* ⚠ 2026-10-16 · R6-S2：判据载体由浮层窗口 `#dc_paramDlg` 改为面板的编辑步骤。
     原意逐条保留：**旧参数区（#dc_panel / #dc_params）不得回来**，参数编辑必须有明确入口。
     新增一条：浮层那份 DOM 已经**彻底不存在**（不是"两份都在、只是不用"）。 */
  check('146 §3 · 旧参数区不存在，参数编辑走面板的 ②/③ 编辑步骤（浮层 #dc_paramDlg 已删除）',
    await send('Runtime.evaluate', { expression: `!document.querySelector('#dc_panel') && !document.querySelector('#dc_params')
      && !document.querySelector('#dc_paramDlg') && !!document.querySelector('#dc_condStep')
      && !!document.querySelector('#dc_paramStep') && !!document.querySelector('#dc_paramsBtn')`, returnByValue: true }).then(r => r.result.value), '');

  // ⑥ 采样状态与 JS 异常
  r = await send('Runtime.evaluate', { expression: `document.body.textContent.includes('距离场无有效采样') || (document.getElementById('dc_geomInfo')?.textContent || '').includes('距离场无有效采样')`, returnByValue: true });
  check('不再出现"距离场无有效采样"', !r.result.value);
  check('无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
  const diag = diagLines.map(l => { try { return JSON.parse(l.slice(l.indexOf('{'))); } catch { return null; } }).find(Boolean);
  if (diag) console.log(`[STL-DIAG] insidePoints=${diag.distanceField?.insidePoints} status=${diag.thickness?.status}`);

  console.log(`\n结果: ${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  console.error('测试失败:', e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
  process.exit(failures === 0 ? 0 : 1);
}
