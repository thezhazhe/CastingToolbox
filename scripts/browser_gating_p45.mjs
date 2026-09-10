// ============================================================
// PHASE 45-A 浏览器人工检查辅助（46.txt 二十三）
// 无头 Edge + CDP：真实页面 → 三方向示意图切换/过滤网使用切换 → 截图+断言
// 用法: node scripts/browser_gating_p45.mjs
// 输出: docs/_p45_gating/*.png + 控制台断言摘要（人工仍需打开页面复核）
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9234;
const URL = 'http://localhost:8090/#/calculators/gating';
const OUT = path.join(ROOT, 'docs', '_p45_gating');
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
  throw new Error('CDP not reachable');
}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('not 200'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${ROOT}/_edge_profile_p45`, 'about:blank'], { stdio: 'ignore' });

let ws = null, failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
  mkdirSync(OUT, { recursive: true });
  await waitForServer();
  const wsUrl = await getWsUrl();
  ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const exceptions = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.text || '');
  };
  await new Promise((res) => (ws.onopen = res));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await wait(1500);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  };
  const waitSel = async (sel, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await evalJs(`!!document.querySelector(${JSON.stringify(sel)})`)) return true; await wait(150); }
    return false;
  };

  await waitSel('#g_diagram svg');
  console.log('\n[A] 三方向示意图（v8：沙箱最宽、流路一线分色、三标注、无直浇道/横浇道文字）');
  await shot('1_顶注.png');
  const topSvg = await evalJs(`document.querySelector('#g_diagram').innerHTML`);
  check('初始=顶注图（Ho 线在内浇口 102）', topSvg.includes('y1="102"') && topSvg.includes('>Ho<'));
  check('三标注+对象标签齐全且无 P/C/分型线', topSvg.includes('>rh<') && topSvg.includes('>ph<') && topSvg.includes('>冒口<') && topSvg.includes('>铸件<') && topSvg.includes('>内浇口<') && !topSvg.includes('P =') && !topSvg.includes('分型线'));
  check('砂箱最宽到边/浇口杯直浇道同轴/流路分色（橙-浅蓝-深蓝）', topSvg.includes('width="322" height="195"') && topSvg.includes('#ffe8cc') && topSvg.includes('#ffd8a8') && topSvg.includes('#a5d8ff') && topSvg.includes('#1971c2') && topSvg.includes('246,24 264,24'));
  check('无直浇道/横浇道文字标识', !topSvg.includes('>直浇道<') && !topSvg.includes('>横浇道<'));

  await evalJs(`(() => { const s = document.querySelector('#g_pos'); s.value = '中注'; s.dispatchEvent(new Event('input')); })()`);
  await wait(500); await shot('2_中注.png');
  const midSvg = await evalJs(`document.querySelector('#g_diagram').innerHTML`);
  check('切换中注 → Ho 线在 150', midSvg.includes('y1="150"'));

  await evalJs(`(() => { const s = document.querySelector('#g_pos'); s.value = '底注'; s.dispatchEvent(new Event('input')); })()`);
  await wait(500); await shot('3_底注.png');
  const botSvg = await evalJs(`document.querySelector('#g_diagram').innerHTML`);
  check('切换底注 → Ho 线在 196', botSvg.includes('y1="196"'));

  console.log('\n[B] 过滤网 使用/不使用（切回顶注：fv 基准 0.8）');
  await evalJs(`(() => { const s = document.querySelector('#g_pos'); s.value = '顶注'; s.dispatchEvent(new Event('input')); })()`);
  await wait(500);
  const fvText = () => evalJs(`(document.querySelector('#g_results').textContent.match(/fv [0-9.]+/)?.[0]) || null`);
  const fv0 = await fvText();
  check('不使用 → fv 原值', fv0 === 'fv 0.8', `实际 ${fv0}`);
  await evalJs(`(() => { const r = document.querySelector('input[name="g_filterUsed"][value="yes"]'); r.click(); r.dispatchEvent(new Event('change')); })()`);
  await wait(500);
  const fv1 = await fvText();
  check('使用 → fv−0.1', fv1 === 'fv 0.7', `实际 ${fv1}`);
  const recHtml = await evalJs(`document.querySelector('#g_filterRec').innerHTML`);
  check('推荐列表出现', recHtml.includes('推荐'), recHtml.includes('暂无满足') ? '（无满足提示）' : '');
  check('无型号下拉残留', !(await evalJs(`!!document.querySelector('#g_filterSpec')`)));
  await shot('4_过滤网使用.png');
  await evalJs(`(() => { const r = document.querySelector('input[name="g_filterUsed"][value="no"]'); r.click(); r.dispatchEvent(new Event('change')); })()`);
  await wait(500);
  const fv2 = await fvText();
  check('切回不使用 → fv 恢复 0.8', fv2 === 'fv 0.8', `实际 ${fv2}`);

  console.log('\n[C] 出品率联动 + 内浇道形状 + 本次计算条件');
  const yrBefore = await evalJs(`document.querySelector('#g_yr').value`);
  await evalJs(`(() => { const s = document.querySelector('#g_mat'); s.value = '球铁(QT)'; s.dispatchEvent(new Event('change')); })()`);
  await wait(400);
  const yrAfter = await evalJs(`document.querySelector('#g_yr').value`);
  check('切球铁 → 出品率自动 65', yrBefore === '75' && yrAfter === '65', `实际 ${yrBefore}→${yrAfter}`);
  await evalJs(`(() => { const s = document.querySelector('#g_mat'); s.value = '灰铁(HT)'; s.dispatchEvent(new Event('change')); })()`);
  await wait(400);
  const yrBack = await evalJs(`document.querySelector('#g_yr').value`);
  check('切回灰铁 → 出品率恢复 75', yrBack === '75', `实际 ${yrBack}`);
  await evalJs(`(() => { const s = document.querySelector('#g_gateShape'); s.value = '圆形'; s.dispatchEvent(new Event('change')); })()`);
  await wait(400);
  const diaVisible = await evalJs(`document.querySelector('#g_ig_dia').style.display !== 'none'`);
  const gtHidden = await evalJs(`document.querySelector('#g_gtField').style.display === 'none'`);
  const tubeText = await evalJs(`document.querySelector('#g_ig_tube').textContent`);
  check('圆形内浇道 → 直径+瓷管显示、厚度隐藏', diaVisible && gtHidden && tubeText.includes('瓷管'), `瓷管：${tubeText.trim()}`);
  await evalJs(`(() => { const s = document.querySelector('#g_gateShape'); s.value = '方形'; s.dispatchEvent(new Event('change')); })()`);
  await wait(300);
  console.log('\n[D] 排气自动生成（用户不填）+ 区间判定');
  const ventSug = await evalJs(`document.querySelector('#g_ventSug').textContent`);
  check('圆孔自动建议（细长出气孔+数量，横条样式）', ventSug.includes('自动生成') && ventSug.includes('圆孔'), ventSug.trim().slice(0, 60));
  await evalJs(`(() => { const r = document.querySelector('input[name="g_ventType"][value="方片"]'); r.click(); r.dispatchEvent(new Event('change')); })()`);
  await wait(400);
  const ventSug2 = await evalJs(`document.querySelector('#g_ventSug').textContent`);
  check('切方片 → 方片自动建议（薄排气片）', ventSug2.includes('方片'), ventSug2.trim().slice(0, 60));
  const ventRange = await evalJs(`document.querySelector('#g_vent_ratio').textContent.includes('1.5~4')`);
  check('排气判定显示 1.5~4 区间', ventRange);
  await evalJs(`(() => { const r = document.querySelector('input[name="g_ventType"][value="圆孔"]'); r.click(); })()`);
  await wait(300);
  const cond = await evalJs(`document.querySelector('#g_results').textContent.includes('本次计算条件')`);
  check('结果区含计算条件块', cond);
  check('无 JS 异常', exceptions.length === 0, exceptions[0] || '');

  console.log(`\n结果: ${failures === 0 ? '全部通过' : failures + ' 项失败'}，截图见 docs/_p45_gating/`);
} finally {
  ws?.close(); edge.kill(); server?.kill();
}
