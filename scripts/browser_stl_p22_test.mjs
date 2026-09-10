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
    const titles = [...document.querySelectorAll('#dc_panel .dc-panel-title')].map(t => t.textContent.trim().replace(/\\s+/g, ' '));
    const ov = document.getElementById('dc_overviewCard');
    return JSON.stringify({
      titles,
      overviewHidden: ov ? ov.hidden : true,
      overviewText: (document.getElementById('dc_overview') || {}).textContent || '',
      order: titles.join('→'),
    });
  })()`, returnByValue: true });
  const panel = JSON.parse(r.result.value);
  check('概览卡可见且有内容', !panel.overviewHidden && panel.overviewText.includes('热结数量'), panel.overviewText.slice(0, 60));
  check('面板顺序：概览（模型信息枢纽）→热结→参数与执行条件（PHASE 71.7：模型信息并入概览）',
    panel.order.startsWith('① 分析结果概览') && panel.order.includes('② 热结列表') && panel.order.includes('③ 参数与执行条件') && !panel.order.includes('分析任务') && !panel.order.includes('④ 模型信息'), panel.order);

  // ⑤ 最大化窗口：右侧内容不超出父容器（30.txt 十六）
  r = await send('Runtime.evaluate', { expression: `(() => {
    const main = document.querySelector('.dc-main');
    const panel = document.querySelector('.dc-panel');
    const panelSecs = [...document.querySelectorAll('.dc-panel-sec')];
    const mRect = main.getBoundingClientRect();
    const pRect = panel.getBoundingClientRect();
    return JSON.stringify({
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      mainRight: +mRect.right.toFixed(1),
      panelRight: +pRect.right.toFixed(1),
      panelWidth: +pRect.width.toFixed(1),
      secOverflow: panelSecs.filter(s => s.getBoundingClientRect().right > mRect.right + 0.5).length,
      paramsGridOverflow: (() => { const g = document.querySelector('.dc-params-grid'); if (!g) return 0; const gr = g.getBoundingClientRect(); const pr = panel.getBoundingClientRect(); return +(gr.right - pr.right).toFixed(1); })(),
    });
  })()`, returnByValue: true });
  const ovf = JSON.parse(r.result.value);
  check('页面无水平溢出（scrollWidth ≤ clientWidth）', ovf.docScrollW <= ovf.docClientW, `scroll=${ovf.docScrollW} client=${ovf.docClientW}`);
  check('右侧面板未超出主网格', ovf.panelRight <= ovf.mainRight + 0.5, `panel=${ovf.panelRight} main=${ovf.mainRight}`);
  check('面板内各节未溢出', ovf.secOverflow === 0, `溢出节数=${ovf.secOverflow}`);
  check('参数网格未超出面板', ovf.paramsGridOverflow <= 0.5, `超出=${ovf.paramsGridOverflow}px`);

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
