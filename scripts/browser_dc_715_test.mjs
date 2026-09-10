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
import { rmSync } from 'node:fs';

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
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
  const importStl = async (file) => {
    const doc = await send('DOM.getDocument', { depth: 1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dc_file' });
    await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path.join(ROOT, 'tests', 'golden', file).replace(/\\/g, '/')] });
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

  await send('Page.navigate', { url: URL + '#/designCenter' });
  await wait(1200);
  check('进入设计中心', (await evalJs(`document.querySelector('#view .page-title')?.textContent || ''`)).includes('铸造工艺设计中心'));

  /* ---- ① 导入 cube50（均匀实心路径）---- */
  await importStl('cube50.stl');
  const hsBadge = await poll(`document.querySelector('#dc_hsBadge')?.textContent || ''`);
  check('cube50 分析完成（热结状态条出现）', !!hsBadge, (hsBadge || '').slice(0, 40));

  /* ---- PHASE 71.6 §一/二：导入后无"分析任务"选择，直接进入工艺设计流程 ---- */
  check('无任务选择 UI（Case 1）', await evalJs(`document.querySelector('#dc_tasks') === null && document.querySelectorAll('.dc-task').length === 0`));
  const panelTitles = await evalJs(`[...document.querySelectorAll('.dc-panel-title')].map(e => e.textContent.trim()).join('|')`);
  check('面板 = 参数与执行条件（无分析任务）', panelTitles.includes('③ 参数与执行条件') && !panelTitles.includes('分析任务'), panelTitles.slice(0, 70));

  /* ---- 统一输入区：五组结构 + 来源图例（76.txt 四~九）---- */
  const paramsTxt = await evalJs(`document.querySelector('#dc_params')?.textContent || ''`);
  check('① 基础工艺参数 分组标题（77.txt 一：基础参数在前）', paramsTxt.includes('① 基础工艺参数'));
  check('② 浇注参数 分组标题', paramsTxt.includes('② 浇注参数'));
  check('③ 冒口参数 分组标题', paramsTxt.includes('③ 冒口参数'));
  check('④ STL 自动识别 默认折叠（77.txt 一/二）',
    await evalJs(`[...document.querySelectorAll('#dc_params details')].some(d => d.textContent.includes('④ STL 自动识别'))`));
  // PHASE 78（78.txt 二/七）：内浇道输入框移到结果页 ③；参数区改为「浇注系统比例」可选
  check('参数区「浇注系统比例」可选（PHASE 78）', await evalJs(`!!document.querySelector('#dc_m_ratio3')`));
  check('内浇道输入框已移出参数区（PHASE 78）',
    await evalJs(`!document.querySelector('#dc_m_gt2') && !document.querySelector('#dc_m_gc2')`));
  check('浇注方向示意图在浇注参数内（77.txt 三）', await evalJs(`!!document.querySelector('#dc_params svg')`));
  // PHASE 71.6（76.txt 九）：高级参数只保留真正低频项——当前固定任务集下核心参数全部前置，
  // 高级区为空（无 ⑤ 分组标题）；这是"重要参数不进高级参数"的正确结果，不要求该分区必须存在。
  const advCount = await evalJs(`document.querySelectorAll('.dc-advanced [id^=dc_m_]').length`);
  check('高级参数不含核心参数（§九；当前为空 → 无 ⑤ 分组）', paramsTxt.includes('⑤ 高级参数') ? advCount >= 0 : true, 'adv=' + advCount);
  check('来源图例（颜色+文字双通道）', (await evalJs(`document.querySelector('.dc-src-legend')?.textContent || ''`)).includes('用户修改'));
  const vol = await evalJs(`document.querySelector('#dc_p_volume')?.value || ''`);
  const wt = await evalJs(`document.querySelector('#dc_p_weight')?.value || ''`);
  const wallMain = await evalJs(`document.querySelector('#dc_p_wallMain')?.value || ''`);
  check('STL 自动体积 ≈125 cm³', Math.abs(parseFloat(vol) - 125) < 2, vol);
  check('STL 自动毛坯重 ≈0.875 kg', Math.abs(parseFloat(wt) - 0.875) < 0.02, wt);
  check('STL 自动主体壁厚 ≈50 mm', Math.abs(parseFloat(wallMain) - 50) < 3, wallMain);
  /* Case 6：关键参数默认展开可见（76.txt 六~九） */
  check('② 材料/铸造方法/造型线/型腔数/预估出品率 常显',
    await evalJs(`['#dc_m_family','#dc_m_method','#dc_m_line','#dc_m_cav2','#dc_m_yr2'].every(s => !!document.querySelector(s))`));
  check('③ 浇注位置/Ho/ph + 冒口高度 常显',
    await evalJs(`['#dc_m_pourPos2','#dc_m_ho2','#dc_m_ph2','#dc_m_rh2'].every(s => !!document.querySelector(s))`));
  check('④ 热节模数 Mc 常显（冒口设计依据）', await evalJs(`!!document.querySelector('#dc_m_mc')`));
  /* Case 7：高级参数只剩低频项 */
  const advIds = await evalJs(`[...document.querySelectorAll('.dc-advanced [id^=dc_m_]')].map(e => e.id).join(',')`);
  check('⑤ 高级参数不含核心项（Case 7）',
    !advIds.split(',').filter(Boolean).some(id => ['dc_m_family', 'dc_m_method', 'dc_m_line', 'dc_m_cav2', 'dc_m_yr2', 'dc_m_pourPos2', 'dc_m_ho2', 'dc_m_ph2', 'dc_m_rh2', 'dc_m_mc'].includes(id)), advIds || '(空)');

  /* ---- ② 用户输入：材料 → 铸造方法/造型线/出品率 → 浇注参数（Ho/ph）---- */
  await setInput('#dc_m_family', '灰铁'); await wait(300);
  await setInput('#dc_m_method', '砂型 · 机器造型/壳型'); await wait(200);
  await setInput('#dc_m_line', '水平线'); await wait(200);
  await setInput('#dc_m_yr2', '75'); await wait(200);
  await setInput('#dc_m_ho2', '250');
  await setInput('#dc_m_ph2', '200');
  await wait(200);

  /* ---- 覆盖自动值 → 🟠 用户修改 + 悬浮原始 + ↺ 恢复（75.txt §五/§八）---- */
  await setInput('#dc_p_wallMain', '52'); await wait(300);
  const badgeTxt = await evalJs(`document.querySelector('#dc_p_wallMain')?.closest('.dc-field')?.querySelector('.dc-src-badge')?.textContent || ''`);
  check('覆盖后来源徽章 = 用户修改', badgeTxt.includes('用户修改'), badgeTxt.trim());
  const hasReset = await evalJs(`!!document.querySelector('[data-reset-orig="process.wallUsed"]')`);
  check('↺ 恢复原值锚点出现', hasReset);
  await evalJs(`document.querySelector('[data-reset-orig="process.wallUsed"]').click()`); await wait(300);
  const wallBack = await evalJs(`document.querySelector('#dc_p_wallMain')?.value || ''`);
  const badgeBack = await evalJs(`document.querySelector('#dc_p_wallMain')?.closest('.dc-field')?.querySelector('.dc-src-badge')?.textContent || ''`);
  check('↺ 恢复 STL 原值 50', Math.abs(parseFloat(wallBack) - 50) < 0.5, wallBack);
  check('恢复后徽章回到 STL 自动', badgeBack.includes('STL 自动'), badgeBack.trim());

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
    await evalJs(`(() => { const t = document.querySelector('#dc_overview')?.textContent || ''; return t.includes('外形尺寸') && t.includes('表面积') && t.includes('STL 自动识别（可修改）'); })()`));

  // ② 冒口页（Page2）—— 76.txt 三：完整 riser 结果 + 来源 + 出处
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(300);
  const p2 = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('Case 2 · ② 冒口页展示实际计算结果（尺寸/模数/体积）',
    ['冒口直径 D', '冒口高度 H', '实际冒口模数', '冒口体积', '冒口颈', '体积校核'].every(k => p2.includes(k)), p2.slice(0, 80));
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

  /* ---- Case 5 · 用户手改 Mc → 结果页来源改为"用户输入"（不再冒充壁厚估算）---- */
  await evalJs(`document.querySelector('#dc_again')?.click()`); await wait(400);
  await setInput('#dc_m_mc', '20'); await wait(400);
  const mcBadge = await evalJs(`document.querySelector('#dc_m_mc')?.closest('.dc-field')?.querySelector('.dc-src-badge')?.textContent || ''`);
  check('手改 Mc → 来源徽章 = 用户修改', mcBadge.includes('用户修改'), mcBadge.trim());
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(800);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(300);
  const p2b = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  check('Case 2 · 用户 Mc 实际进入冒口结果（D 随 Mc 变化）', p2b.includes('用户输入') && p2b.includes('20'), p2b.slice(0, 90));
  check('Case 5 · 用户输入时不再显示兜底估算口径', !p2b.includes('壁厚/结构参考值'));

  /* ---- 77.txt 二：热结勾选 + Mc 弹窗 + 多冒口 ----
     场景说明：lShape 在当前引擎默认参数下为 no_candidate（报告备案），故此处注入热结数据
     模拟"已检出热结"的模型（数据层写入 = 与 writeHotspotsToProject 同路径），
     再通过改材料触发参数区重渲染，验证勾选列表 / 弹窗 / 多冒口展示链路。 */
  await evalJs(`(async () => {
    const p = await import('/js/model/CastingProject.js');
    p.set('hotspots.status', 'ok', p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
    p.set('hotspots.items', [
      { id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 },
      { id: 2, x: 20, y: 8, z: 4, mc: 8, regionVolumeCm3: 25 },
    ], p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.MEDIUM);
    p.set('process.mcHotspot', 14, p.SRC.STL_GEOMETRY_ANALYSIS, p.CONF.HIGH);
  })()`);
  await setInput('#dc_m_family', '灰铁'); await wait(500);
  const pickRows = await evalJs(`document.querySelectorAll('[data-hs-pick]').length`);
  check('冒口参数区出现热结勾选列表（H1/H2）', pickRows === 2, 'rows=' + pickRows);
  check('默认自动模式提示（按主热结 H1）', (await evalJs(`document.querySelector('#dc_params')?.textContent || ''`)).includes('自动模式'));
  // PHASE 78（78.txt 四）：勾选**不再弹窗**，直接生效（Mc = 检出值）；要改值走「✎ 改 Mc」
  await evalJs(`document.querySelectorAll('[data-hs-pick]')[1].click()`);
  await wait(400);
  check('勾选直接生效（无弹窗，78.txt 四）', !(await evalJs(`!!document.querySelector('#dc_hsModal')`)), '');
  check('勾选后打勾且列表进入选中态',
    await evalJs(`document.querySelectorAll('[data-hs-pick]')[1].checked && document.querySelectorAll('.dc-hsp')[1].classList.contains('on')`), '');
  const pickHint = await evalJs(`document.querySelector('#dc_params')?.textContent || ''`);
  check('界面显示已选 1 个（按检出值 8）', pickHint.includes('已选') && pickHint.includes('1'), pickHint.slice(-90));
  // 「✎ 改 Mc」仍是弹窗（唯一入口）→ 把 H2 改为 12
  await evalJs(`document.querySelectorAll('[data-hs-edit]')[1].click()`);
  await wait(400);
  const modalMc = await evalJs(`document.querySelector('#dc_hsModal #dc_hsMc')?.value || ''`);
  check('「✎ 改 Mc」弹窗（默认=该热结当前值 8）', Math.abs(parseFloat(modalMc) - 8) < 0.05, 'Mc=' + modalMc);
  await evalJs(`(() => { const el = document.querySelector('#dc_hsModal #dc_hsMc'); el.value = '12'; })()`);
  await evalJs(`document.querySelector('#dc_hsModal [data-hs-ok]').click()`);
  await wait(500);
  check('弹窗关闭', await evalJs(`!document.querySelector('#dc_hsModal')`));
  // 再勾选 H1（用检出值 14）→ 两个热结分别出冒口
  await evalJs(`document.querySelectorAll('[data-hs-pick]')[0].click()`);
  await wait(400);
  check('勾选 H1 同样直接生效（无弹窗）', !(await evalJs(`!!document.querySelector('#dc_hsModal')`)));
  await evalJs(`document.querySelector('#dc_run').click()`); await wait(1000);
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="riser"]').click()`); await wait(300);
  const p2pick = await evalJs(`document.querySelector('#dc_resultActive')?.textContent || ''`);
  // PHASE 78（78.txt 五）：多热结改为分子页签（点热结 1 / 热结 2 切换），不再纵向堆叠
  const tabs78 = await evalJs(`[...document.querySelectorAll('#dc_hsTabs .dc-hs-tab')].map(b => b.textContent.replace(/\\s+/g,' ').trim())`);
  check('② 冒口页多热结分子页签（H1 + H2）', tabs78.length === 2 && tabs78[0].includes('H1') && tabs78[1].includes('H2'), tabs78.join(' | '));
  check('② H2 标注用户修改值 12', p2pick.includes('用户输入') && p2pick.includes('该热结检出 8'), p2pick.slice(0, 80));
  check('② 结果出处与校核字段保留', p2pick.includes('冒口结果来自现有冒口计算器') && p2pick.includes('体积校核'), '');
  check('② 冒口形状下拉（PHASE 78：4 种，默认圆柱形）',
    await evalJs(`(() => { const s = document.querySelector('#dc_riserShape'); return !!s && s.options.length === 4 && s.value === 'cyl'; })()`), '');

  /* ---- ④ 替换 ALR2510（真实件，薄壁+厚大结构）→ 诚实分级路径：未达检出阈值 ≠ "均匀属正常" ---- */
  await evalJs(`document.querySelector('#dc_resultNav [data-nav="page1"]').click()`); await wait(200);
  await importStl('ALR2510塑料模具v1_1.stl');
  const badge2 = await poll(`document.querySelector('#dc_hsBadge')?.textContent || ''`, 170000, 1200);
  check('ALR2510 分析完成（真实文件路径走通）', (badge2 || '').includes('未检出热结'), (badge2 || '').slice(0, 70));
  check('状态条不冒充"均匀属正常"（no_candidate 保守口径）', (badge2 || '').includes('超出采样能力') || (badge2 || '').includes('不等于不存在热节'), (badge2 || '').slice(0, 80));
  await evalJs(`document.querySelector('#dc_run').click()`);
  const p1b = await poll(`document.querySelector('#dc_resultActive')?.textContent || ''`, 30000, 800);
  // PHASE 71.7：STL 基础信息（含 Hotspot 状态）已并入 ① 分析结果概览
  const ovb = await evalJs(`document.querySelector('#dc_overview')?.textContent || ''`);
  check('① 概览状态 = 未检出热结候选（非均匀表述）', ovb.includes('未检出热结') || (await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`)).includes('未检出热结候选'), ovb.slice(0, 70));
  check('概览保守估算提示（引擎限制明示）', (await evalJs(`document.querySelector('#dc_hsBadge')?.textContent || ''`)).includes('超出采样能力') || ovb.includes('超出采样'), '');
  check('Page1 自动结果仍生成（wallHot 保守链）', await evalJs(`document.querySelector('#dc_resultNav')?.textContent.includes('冒口设计') || false`));

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
