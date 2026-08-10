// ============================================================
// 无头浏览器冒烟测试：Shell 渲染 + 三视图切换 + 无 JS 异常
// 用法: node scripts/browser_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9231;
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

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--disable-extensions', `--user-data-dir=${process.cwd()}/_edge_profile`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
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
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      exceptions.push((d.exception && d.exception.description) || d.text);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  await send('Page.enable'); await send('Runtime.enable');

  // ---- 1. 加载首页（Bing 式搜索首页） ----
  await send('Page.navigate', { url: URL });   // 先落在应用源，再清存储（about:blank 清不到同源数据）
  await wait(500);
  await send('Runtime.evaluate', { expression: `localStorage.clear()` });
  await send('Page.reload', {});
  await wait(1800);
  let r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    title: document.title,
    navItems: Array.from(document.querySelectorAll('.nav-item')).filter(n => !n.hidden).length,
    toolCards: document.querySelectorAll('.tool-card').length,
    search: !!document.getElementById('globalSearch'),
    homeHero: !!document.querySelector('.home-hero'),
    homeSearch: !!document.getElementById('homeSearch'),
    homeNavActive: document.querySelector('[data-view="home"]').classList.contains('active'),
    topSearchVisible: getComputedStyle(document.querySelector('.search-wrap')).display !== 'none',
    hasHot: !!document.querySelector('.home-hot'),
  })`, returnByValue: true });
  const shell = JSON.parse(r.result.value);
  console.log('\n[Shell]');
  check('页面标题', shell.title.includes('Casting Toolbox'), shell.title);
  check('侧边栏 4 个导航（首页/计算器/向导/捐助）', shell.navItems === 4, String(shell.navItems));
  check('首页渲染（大搜索框）', shell.homeHero && shell.homeSearch);
  check('首页导航高亮', shell.homeNavActive);
  check('首页常用工具 13 个', shell.toolCards === 13, String(shell.toolCards));
  check('首页隐藏顶栏搜索', !shell.topSearchVisible);
  check('首页无常搜（已删除）', !shell.hasHot);

  // ---- 1a. 首页大搜索框实时下拉（输入即出结果）+ 渐进展示提示条 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('homeSearch').value='qt'; document.getElementById('homeSearch').dispatchEvent(new Event('input'))` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    ddShown: (function(){ var d = document.querySelector('.home-search > .search-drop'); return d && d.style.display === 'block'; })(),
    items: document.querySelectorAll('.home-search .sd-item').length,
    hasHint: !!document.getElementById('homeRecoHint'),
    hintText: (document.getElementById('homeRecoHintText') || {}).textContent || '',
  })`, returnByValue: true });
  const ld = JSON.parse(r.result.value);
  console.log('\n[首页实时下拉]');
  check('首页输入 qt 出现下拉', ld.ddShown && ld.items > 0, String(ld.items));
  check('首页渐进展示提示条存在', ld.hasHint, ld.hintText);
  await send('Runtime.evaluate', { expression: `document.getElementById('homeSearch').value=''; document.getElementById('homeSearch').dispatchEvent(new Event('input'))` });
  await wait(200);

  // ---- 1b. 首页搜索 → 独立搜索页 #/search ----
  await send('Runtime.evaluate', { expression: `document.getElementById('homeSearch').value='缩松'; document.getElementById('homeSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hash: location.hash,
    isSearch: document.body.innerHTML.includes('搜索结果'),
    ctxGroup: document.body.innerHTML.includes('符合生产场景'),
  })`, returnByValue: true });
  const hs = JSON.parse(r.result.value);
  console.log('\n[首页搜索]');
  check('首页搜索跳独立页 #/search', hs.hash === '#/search' && hs.isSearch, hs.hash);
  check('无工况时无符合组', !hs.ctxGroup);

  // ---- 1b. 开发者模式：默认锁定 → 密码解锁 → 解锁后树可浏览 ----
  await send('Runtime.evaluate', { expression: `localStorage.clear()` });
  await send('Page.navigate', { url: URL });
  await wait(900);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    navHidden: document.getElementById('navKnowledge').hidden,
  })`, returnByValue: true });
  const dev0 = JSON.parse(r.result.value);
  console.log('\n[开发者模式]');
  check('默认锁定：知识库导航隐藏', dev0.navHidden === true, String(dev0.navHidden));

  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge'` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    locked: document.body.innerHTML.includes('需要开发者权限'),
    themes: document.querySelectorAll('.kb-theme').length,
  })`, returnByValue: true });
  const dev1 = JSON.parse(r.result.value);
  check('直连 #/knowledge 显示锁屏', dev1.locked && dev1.themes === 0, String(dev1.themes));

  await send('Runtime.evaluate', { expression: `for (let i = 0; i < 5; i++) document.querySelector('.logo').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `!document.getElementById('devModal').hidden`, returnByValue: true });
  check('Logo 5 连击弹出密码框', r.result.value);

  // 首页大 Logo 5 连击（移动端唯一可见入口）也应弹出密码框
  await send('Runtime.evaluate', { expression: `document.getElementById('devModal').hidden = true; location.hash = '#/home'` });
  await wait(500);
  await send('Runtime.evaluate', { expression: `for (let i = 0; i < 5; i++) document.querySelector('.home-logo-mark').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `!document.getElementById('devModal').hidden`, returnByValue: true });
  check('首页大 Logo 5 连击也弹出密码框', r.result.value);

  await send('Runtime.evaluate', { expression: `document.getElementById('devPass').value='wrong'; document.getElementById('devConfirm').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    err: document.getElementById('devErr').textContent,
    stillHidden: document.getElementById('navKnowledge').hidden,
  })`, returnByValue: true });
  const dev2 = JSON.parse(r.result.value);
  check('错误密码不解锁', dev2.err.includes('密码错误') && dev2.stillHidden === true);

  await send('Runtime.evaluate', { expression: `document.getElementById('devPass').value='15878391013'; document.getElementById('devConfirm').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    modalClosed: document.getElementById('devModal').hidden,
    navShown: !document.getElementById('navKnowledge').hidden,
  })`, returnByValue: true });
  const dev3 = JSON.parse(r.result.value);
  check('正确密码解锁', dev3.modalClosed && dev3.navShown);

  // 解锁后顶栏出现锁定按钮；点击可锁定（移动端侧栏徽章隐藏时也有关闭入口）
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    lockVisible: !document.getElementById('devLockBtn').hidden,
  })`, returnByValue: true });
  check('解锁后顶栏锁定按钮可见', JSON.parse(r.result.value).lockVisible === true);
  await send('Runtime.evaluate', { expression: `document.getElementById('devLockBtn').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    lockHidden: document.getElementById('devLockBtn').hidden,
    navHidden: document.getElementById('navKnowledge').hidden,
  })`, returnByValue: true });
  const dev4 = JSON.parse(r.result.value);
  check('顶栏锁定按钮点击后锁定', dev4.lockHidden === true && dev4.navHidden === true);
  // 重新解锁，后续测试需要知识库可用
  await send('Runtime.evaluate', { expression: `for (let i = 0; i < 5; i++) document.querySelector('.logo').click()` });
  await wait(200);
  await send('Runtime.evaluate', { expression: `document.getElementById('devPass').value='15878391013'; document.getElementById('devConfirm').click()` });
  await wait(300);

  // ---- 2. 切到知识库 ----
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="knowledge"]').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.kb-theme').length`, returnByValue: true });
  check('知识库主题树渲染 7 类', r.result.value === 7, String(r.result.value));

  // ---- 3. 切到工艺向导 ----
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="wizard"]').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.querySelector('.wizard-hero') !== null`, returnByValue: true });
  check('向导首页 Hero 渲染', r.result.value);

  // ---- 4. 点开始设计 → 步骤条出现 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('wzStart') ? document.getElementById('wzStart').click() : null` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.view').length, window.location.hash`, returnByValue: true });
  const stepsHtml = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('第 1 / 6 步')`, returnByValue: true });
  check('向导进入步骤 1', stepsHtml.result.value);

  // ---- 5. 浇注系统计算器 ----
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/gating'` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasForm: !!document.getElementById('g_mat'),
    hasBack: !!document.querySelector('[data-back]'),
    tValue: (document.querySelector('#g_results .rrow .rv') || {}).textContent || '',
    judge: (document.querySelector('#g_judge .judge') || {}).textContent || '',
    badge: (document.querySelector('.badge-status') || {}).textContent || ''
  })`, returnByValue: true });
  const gating = JSON.parse(r.result.value);
  console.log('\n[浇注系统计算器]');
  check('表单渲染', gating.hasForm);
  check('返回按钮', gating.hasBack);
  check('自动计算结果出现', gating.tValue.length > 0, gating.tValue);
  check('判定为设计合理', gating.judge.includes('设计合理'), gating.judge);
  check('状态徽章=可用', gating.badge.includes('可用'), gating.badge);

  // 报告弹窗：初始隐藏 → 打开 → 关闭（回归 bug1：弹窗常显关不掉）
  await send('Runtime.evaluate', { expression: `document.getElementById('g_reportBtn').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ open: !document.getElementById('g_modal').hidden, hasCopy: !!document.getElementById('g_reportCopy') })`, returnByValue: true });
  const rm = JSON.parse(r.result.value);
  console.log('\n[报告弹窗]');
  check('报告弹窗可打开', rm.open && rm.hasCopy, String(rm.open));
  await send('Runtime.evaluate', { expression: `document.getElementById('g_modal').querySelector('[data-close]').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('g_modal').hidden`, returnByValue: true });
  check('报告弹窗可关闭', r.result.value === true, String(r.result.value));

  // ---- 6. 冒口设计计算器 ----
  // 先滚到底再切换视图，验证回到顶部（回归 bug3）
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, document.body.scrollHeight); location.hash = '#/calculators/riser'` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `window.scrollY`, returnByValue: true });
  check('切换视图回弹到顶部', r.result.value === 0, String(r.result.value));
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasForm: !!document.getElementById('r_mat'),
    resultText: (document.querySelector('#r_results .rrow .rv') || {}).textContent || '',
    judgeChips: document.querySelectorAll('#r_judge .chip').length,
    mcToggle: !!document.getElementById('r_mc_mode')
  })`, returnByValue: true });
  const riser = JSON.parse(r.result.value);
  console.log('\n[冒口设计计算器]');
  check('表单渲染', riser.hasForm);
  check('结果出现', riser.resultText.length > 0, riser.resultText);
  check('校核芯片出现', riser.judgeChips >= 2, String(riser.judgeChips));
  check('Mc 模式切换', riser.mcToggle);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasNext: document.body.innerHTML.includes('🚀 下一步建议'),
    hasItem: document.body.innerHTML.includes('计算浇道'),
  })`, returnByValue: true });
  const ns = JSON.parse(r.result.value);
  check('冒口页显示下一步建议', ns.hasNext && ns.hasItem);
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('[data-next]')).find(b => b.textContent.includes('计算浇道'))?.click()` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `location.hash`, returnByValue: true });
  check('点击下一步跳转浇道计算器', r.result.value.includes('gating'), r.result.value);
  // 搜索类下一步 → 独立搜索页 #/search（随 v0.6 路由拆分）
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/riser'` });
  await wait(600);
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('[data-next]')).find(b => b.textContent.includes('查缩松'))?.click()` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ hash: location.hash, isSearch: document.body.innerHTML.includes('搜索结果') })`, returnByValue: true });
  const nss = JSON.parse(r.result.value);
  check('搜索类下一步跳 #/search', nss.hash === '#/search' && nss.isSearch, nss.hash);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/riser'` });
  await wait(600);

  // ---- 7. 切换热节输入方式 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('r_mc_mode').value='wall'; document.getElementById('r_mc_mode').dispatchEvent(new Event('change'))` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `getComputedStyle(document.getElementById('r_mc_wall')).display !== 'none'`, returnByValue: true });
  check('热节输入方式切换', r.result.value);

  // ---- 8. 小计算器 ----
  const smallTools = [
    { id: 'shrinkage', formId: 's_mat', title: '线收缩率' },
    { id: 'machining', formId: 'm_size', title: '加工余量' },
    { id: 'yield',     formId: 'y_part', title: '出品率与铁水重量' },
  ];
  for (const t of smallTools) {
    await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/${t.id}'` });
    await wait(550);
    r = await send('Runtime.evaluate', { expression: `JSON.stringify({
      form: !!document.getElementById('${t.formId}'),
      result: (document.querySelector('#sc_results .rrow .rv') || {}).textContent || ''
    })`, returnByValue: true });
    const v = JSON.parse(r.result.value);
    check(`${t.title}表单渲染`, v.form);
    // 出品率默认需先选产品+工艺才出结果
    if (t.id === 'yield') {
      await send('Runtime.evaluate', { expression: `document.getElementById('y_product').value='刹车盘 / 制动鼓'; document.getElementById('y_process').value='垂直线'; document.getElementById('y_product').dispatchEvent(new Event('change')); document.getElementById('y_process').dispatchEvent(new Event('change'));` });
      await wait(450);
      r = await send('Runtime.evaluate', { expression: `(document.querySelector('#sc_results .rrow .rv') || {}).textContent || ''`, returnByValue: true });
      v.result = r.result.value;
    }
    check(`${t.title}自动计算`, v.result.length > 0, v.result);
    r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('下一步建议')`, returnByValue: true });
    check(`${t.title}下一步建议`, r.result.value);
  }

  // 线收缩率：铸钢+自由 方向悬殊(1500/50/20 率差≥0.2%) → 分方向提示；改均衡 → 综合比例
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/shrinkage'` });
  await wait(500);
  await send('Runtime.evaluate', { expression: `document.getElementById('s_mat').value='铸钢(ZG)'; document.getElementById('s_mode').value='free'; document.getElementById('s_d1').value=1500; document.getElementById('s_d2').value=50; document.getElementById('s_d3').value=20; document.getElementById('s_mat').dispatchEvent(new Event('change')); document.getElementById('s_mode').dispatchEvent(new Event('change')); document.getElementById('s_d1').dispatchEvent(new Event('input')); document.getElementById('s_d2').dispatchEvent(new Event('input')); document.getElementById('s_d3').dispatchEvent(new Event('input'));` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    splitWarn: document.body.innerHTML.includes('分方向放缩水'),
    noCombined: !document.body.innerHTML.includes('综合比例（整体放尺）')
  })`, returnByValue: true });
  check('线收缩率：方向悬殊提示分开放缩水', JSON.parse(r.result.value).splitWarn && JSON.parse(r.result.value).noCombined);
  await send('Runtime.evaluate', { expression: `document.getElementById('s_d1').value=300; document.getElementById('s_d2').value=300; document.getElementById('s_d3').value=300; document.getElementById('s_d1').dispatchEvent(new Event('input')); document.getElementById('s_d2').dispatchEvent(new Event('input')); document.getElementById('s_d3').dispatchEvent(new Event('input'));` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('综合比例（整体放尺）')`, returnByValue: true });
  check('线收缩率：方向均衡给综合比例', r.result.value);

  // 加工余量：无等级选择框 + 给余量范围；压铸+铸钢无标准 → 诚实提示
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/machining'` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    noGrade: !document.getElementById('m_grade'),
    hasRange: document.body.innerHTML.includes('单侧余量范围')
  })`, returnByValue: true });
  check('加工余量：去掉等级选择、给余量范围', JSON.parse(r.result.value).noGrade && JSON.parse(r.result.value).hasRange);
  await send('Runtime.evaluate', { expression: `document.getElementById('m_method').value='压力铸造'; document.getElementById('m_mat').value='铸钢'; document.getElementById('m_method').dispatchEvent(new Event('change')); document.getElementById('m_mat').dispatchEvent(new Event('change'));` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('无标准 RMA 等级')`, returnByValue: true });
  check('加工余量：压铸+铸钢无标准→诚实提示', r.result.value);

  // 出品率：预估区间 → 现场实测默认预填预估中值（可改）→ 铁液重量
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/yield'` });
  await wait(550);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasEstimate: document.body.innerHTML.includes('预估出品率'),
    prefilled: (parseFloat(document.getElementById('y_yield')?.value) || 0) > 0,
    hasSingle: document.body.innerHTML.includes('单件铁液重量')
  })`, returnByValue: true });
  check('出品率：显示预估区间、实测框预填中值', JSON.parse(r.result.value).hasEstimate && JSON.parse(r.result.value).prefilled);
  check('出品率：预填后即显示铁液重量', JSON.parse(r.result.value).hasSingle);
  await send('Runtime.evaluate', { expression: `document.getElementById('y_yield').value=65; document.getElementById('y_yield').dispatchEvent(new Event('input'));` });
  await wait(450);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasSingle: document.body.innerHTML.includes('单件铁液重量'),
    hasGroup: document.body.innerHTML.includes('铁液重量（按现场实测'),
    kept: document.getElementById('y_yield').value === '65'
  })`, returnByValue: true });
  check('出品率：用户改实绩后保留', JSON.parse(r.result.value).hasSingle && JSON.parse(r.result.value).hasGroup && JSON.parse(r.result.value).kept);

  // 冷铁计算器
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/chill'` });
  await wait(550);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    form: !!document.getElementById('ch_mat'),
    result: (document.querySelector('#sc_results .rrow .rv') || {}).textContent || ''
  })`, returnByValue: true });
  check('冷铁计算表单渲染', JSON.parse(r.result.value).form);
  check('冷铁计算自动出厚度', JSON.parse(r.result.value).result.length > 0, JSON.parse(r.result.value).result);

  // 3D砂型吃砂量：埋箱查表 + 切裸浇
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/sandbox'` });
  await wait(550);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    form: !!document.getElementById('sb_dim'),
    burrow: (document.querySelector('#sc_results .rrow .rv') || {}).textContent || ''
  })`, returnByValue: true });
  check('吃砂量表单渲染', JSON.parse(r.result.value).form);
  check('埋箱查表出承重壁厚', JSON.parse(r.result.value).burrow.length > 0, JSON.parse(r.result.value).burrow);

  // 结构工艺性计算器（最小壁厚/圆角/斜度/铸孔）
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/castability'` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    form: !!document.getElementById('ca_mat'),
    draftH: !!document.getElementById('ca_draftH'),
    twoWalls: !!document.getElementById('ca_w1') && !!document.getElementById('ca_w2') && !document.getElementById('ca_avg'),
    hasWall: document.body.innerHTML.includes('最小壁厚建议'),
    jb5105: document.body.innerHTML.includes('JB/T 5105'),
    sandTip: document.body.innerHTML.includes('常用砂种') && document.body.innerHTML.includes('潮模砂'),
    result: (document.querySelector('#sc_results .rrow .rv') || {}).textContent || ''
  })`, returnByValue: true });
  const cb = JSON.parse(r.result.value);
  check('结构工艺性计算器渲染', cb.form && cb.draftH && cb.twoWalls, String(cb.result));
  check('结构工艺性自动计算', cb.result.length > 0 && cb.hasWall, cb.result);
  check('结构工艺性拔模斜度 JB/T 5105', cb.jb5105);
  check('结构工艺性型砂选型提示', cb.sandTip);

  // ---- 8b. 熔炼加料计算器 ----
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/charge'` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    form: !!document.getElementById('c_mat'),
    ratioInput: !!document.getElementById('c_pigPct'),
    absEditable: !!document.getElementById('c_pigAbs'),
    customOpt: document.getElementById('c_pig').innerHTML.includes('自定义'),
    rows: document.querySelectorAll('#c_results .rrow').length,
    ceShown: document.body.innerHTML.includes('碳当量'),
    suggestion: !!document.querySelector('#c_results [data-apply]'),
  })`, returnByValue: true });
  const ch = JSON.parse(r.result.value);
  check('加料计算器渲染', ch.form && ch.ratioInput && ch.absEditable, String(ch.rows));
  check('加料计算器自动平衡', ch.rows > 0, String(ch.rows));
  check('加料计算器CE显示', ch.ceShown);
  check('加料计算器自定义选项', ch.customOpt);
  check('加料计算器补料建议', ch.suggestion);
  await send('Runtime.evaluate', { expression: `(function(){ var b = document.querySelector('#c_results [data-apply="feSi"]'); if (!b) return 'nofeSi'; b.click(); return 'clicked'; })()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('c_feSiKg').value`, returnByValue: true });
  check('加料应用建议交互', r.result.value !== '0' && r.result.value !== '', r.result.value);
  // 牌号显示一致性：QT450-10（带后缀，同其它球铁）
  r = await send('Runtime.evaluate', { expression: `document.getElementById('c_mat').innerHTML.includes('QT450-10') && !document.getElementById('c_mat').innerHTML.includes('>QT450<')`, returnByValue: true });
  check('加料牌号显示一致性 QT450-10', r.result.value);
  // 自定义打开预填参考值（选 硅铁 → 自定义 → Si 框非空）
  await send('Runtime.evaluate', { expression: `document.getElementById('c_feSi').value='__custom'; document.getElementById('c_feSi').dispatchEvent(new Event('change'));` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ open: document.getElementById('c_feSiCustom').style.display !== 'none', prefilled: (document.getElementById('c_feSiSi').value || '') !== '' })`, returnByValue: true });
  check('自定义预填参考值', JSON.parse(r.result.value).open && JSON.parse(r.result.value).prefilled);

  // ---- 8c. 开箱时间计算器 ----
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/shakeout'` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    form: !!document.getElementById('so_mat'),
    targetInput: !!document.getElementById('so_target'),
    impSelect: !!document.getElementById('so_imp'),
    timeRow: (document.querySelector('#so_results .rrow .rv') || {}).textContent || '',
    tempText: document.body.innerHTML.includes('开箱温度目标'),
  })`, returnByValue: true });
  const so = JSON.parse(r.result.value);
  check('开箱计算器渲染', so.form && so.targetInput && so.impSelect);
  check('开箱计算器自动计算', so.timeRow.length > 0, so.timeRow);

  // ---- 8d. 尺寸公差 CT 查询（新工具：主输入=直接选 CT 等级） ----
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/ct'` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    form: !!document.getElementById('ct_grade') && !!document.getElementById('ct_size'),
    method: !!document.getElementById('ct_method'),
    rec: (document.getElementById('ct_rec').textContent || ''),
    hasTol: document.body.innerHTML.includes('尺寸公差（总公差）'),
    hasDev: document.body.innerHTML.includes('上 / 下偏差'),
    hasTable: document.body.innerHTML.includes('公差数值表'),
    grade: document.getElementById('ct_grade').value,
  })`, returnByValue: true });
  const ct = JSON.parse(r.result.value);
  check('CT公差查询渲染（主输入=CT等级）', ct.form && ct.method, `CT等级 ${ct.grade}`);
  check('CT公差按所选等级算公差', ct.rec.includes('CT') && ct.hasTol && ct.hasDev, ct.rec);
  check('CT公差说明带数值表', ct.hasTable);
  // 切换等级 → 公差值变化
  await send('Runtime.evaluate', { expression: `document.getElementById('ct_grade').value='CT6'; document.getElementById('ct_grade').dispatchEvent(new Event('change'));` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `(document.querySelector('#ct_results .rrow .rv') || {}).textContent || ''`, returnByValue: true });
  check('CT公差切换等级后变化', r.result.value.length > 0, r.result.value);
  // 「填入推荐」按钮
  await send('Runtime.evaluate', { expression: `document.getElementById('ct_apply').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('ct_grade').value`, returnByValue: true });
  check('CT公差填入推荐等级', r.result.value.startsWith('CT'), r.result.value);
  // 壁厚粗一级
  await send('Runtime.evaluate', { expression: `document.getElementById('ct_wall').value='yes'; document.getElementById('ct_wall').dispatchEvent(new Event('change'));` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('壁厚公差')`, returnByValue: true });
  check('CT公差壁厚粗一级', r.result.value);

  // ---- 8e. 铸造原则 · Campbell 十规则（展示型计算器） ----
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/principles'` });
  await wait(900);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    title: (document.querySelector('.page-title') || {}).textContent || '',
    stages: document.querySelectorAll('.prin-stage').length,
    cards: document.querySelectorAll('.prin-card').length,
    firstOpen: (function(){ var b = document.querySelector('.prin-body'); return b && !b.hidden; })(),
    hasRule: document.body.innerHTML.includes('使用优质金属液'),
    hasCalc: document.body.innerHTML.includes('数据-open-calc') || document.body.innerHTML.includes('浇注系统设计'),
  })`, returnByValue: true });
  const pr = JSON.parse(r.result.value);
  check('铸造原则渲染（十规则卡片）', pr.cards === 10 && pr.stages === 4, `${pr.stages} 阶段 / ${pr.cards} 卡`);
  check('铸造原则默认展开第一条', pr.firstOpen && pr.hasRule);
  check('铸造原则含相关计算器', pr.hasCalc);
  // 点击第 2 条展开
  await send('Runtime.evaluate', { expression: `document.querySelectorAll('.prin-head')[1].click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    openCount: document.querySelectorAll('.prin-body:not([hidden])').length,
    secondOpen: !document.querySelectorAll('.prin-body')[1].hidden,
  })`, returnByValue: true });
  const pr2 = JSON.parse(r.result.value);
  check('铸造原则展开收起交互', pr2.openCount === 2 && pr2.secondOpen, `展开 ${pr2.openCount} 条`);

  // ---- 9. 冒口设计计算器可返回列表 ----
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="calculators"]').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    cards: document.querySelectorAll('.tool-card').length,
    topSearchVisible: getComputedStyle(document.querySelector('.search-wrap')).display !== 'none',
  })`, returnByValue: true });
  const calclist = JSON.parse(r.result.value);
  check('返回计算器列表', calclist.cards === 13, String(calclist.cards));
  check('计算页显示顶栏搜索', calclist.topSearchVisible);

  // ---- 10. 知识库：主题树 ----
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="knowledge"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    themes: document.querySelectorAll('.kb-theme').length,
    items: document.querySelectorAll('.kb-item').length,
    summaries: document.querySelectorAll('.kb-item-summary').length,
  })`, returnByValue: true });
  const kb = JSON.parse(r.result.value);
  console.log('\n[知识库]');
  check('主题树渲染 7 主题', kb.themes === 7, String(kb.themes));
  check('默认展开有卡片+摘要', kb.items >= 1 && kb.summaries >= kb.items, `${kb.items}/${kb.summaries}`);

  // 型砂主题：独立成类 + 双显 DISA 砂条目
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-theme-toggle="sand"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasControl: document.body.innerHTML.includes('湿型砂质量控制'),
    hasDual: document.body.innerHTML.includes('双显条目'),
    hasCompact: document.body.innerHTML.includes('紧实率'),
  })`, returnByValue: true });
  const sand = JSON.parse(r.result.value);
  check('型砂主题独立成类', sand.hasControl);
  check('型砂主题双显 DISA 砂条目', sand.hasDual && sand.hasCompact);

  // 设备主题：含 3D打印 + DISA 两分支
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-theme-toggle="equipment"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasDisa: document.body.innerHTML.includes('DISA 垂直造型线'),
    has3dp: document.body.innerHTML.includes('3D砂型打印关键工艺参数'),
    hasOverview: document.body.innerHTML.includes('DISA 垂直无箱造型'),
  })`, returnByValue: true });
  const eq = JSON.parse(r.result.value);
  console.log('\n[设备主题]');
  check('设备含 3D打印', eq.has3dp);
  check('设备含 DISA 垂直造型线', eq.hasDisa && eq.hasOverview);

  // 原材料 / 工艺配料
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-theme-toggle="rawmaterials"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.kb-item').length > 20 && document.body.innerHTML.includes('球化剂')`, returnByValue: true });
  check('原材料主题有数据', r.result.value);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-theme-toggle="process"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('QT450-10 球墨铸铁熔炼配料')`, returnByValue: true });
  check('配料案例在工艺主题', r.result.value);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-theme-toggle="materials"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('铸件最小壁厚速查') && document.body.innerHTML.includes('铸铁热处理规范')`, returnByValue: true });
  check('新材料（结构工艺性+热处理）', r.result.value);
  await wait(400);

  // ---- 11. 搜索：回车进知识库结果页 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='QT450'` });
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    isSearch: document.body.innerHTML.includes('搜索结果'),
    qtFound: document.body.innerHTML.includes('QT450-10'),
    matGroup: document.body.innerHTML.includes('🧪 材料'),
    kbGroup: document.body.innerHTML.includes('📖 知识'),
    calcFound: document.body.innerHTML.includes('计算工具'),
    ctxGroup: document.body.innerHTML.includes('符合生产场景'),
  })`, returnByValue: true });
  const sr = JSON.parse(r.result.value);
  console.log('\n[搜索]');
  check('进入搜索结果页', sr.isSearch);
  check('命中 QT450 材料', sr.qtFound);
  check('按类别分组（材料/知识）', sr.matGroup && sr.kbGroup);
  check('计算工具分组展示', sr.calcFound);
  check('无工况时无符合组', !sr.ctxGroup);

  // 搜"缩松"：缺陷组应在材料组之前（回归 bug2 搜索优先级）
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='缩松'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `(function(){ var b = document.body.innerHTML; var di = b.indexOf('常见缺陷'), mi = b.indexOf('🧪 材料'); return JSON.stringify({ di: di, mi: mi, hasDefects: di >= 0, defectsFirst: di >= 0 && (mi === -1 || di < mi) }); })()`, returnByValue: true });
  const sp = JSON.parse(r.result.value);
  console.log('\n[搜索优先级]');
  check('搜缩松命中缺陷组', sp.hasDefects, 'di=' + sp.di);
  check('缺陷组在材料组之前', sp.defectsFirst, 'di=' + sp.di + ' mi=' + sp.mi);

  // ---- 12. 知识详情 ----
  await send('Runtime.evaluate', { expression: `document.querySelector('.kb-item') ? document.querySelector('.kb-item').click() : null` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasSource: document.body.innerHTML.includes('出处'),
    noPage: !document.body.innerHTML.includes('待核对'),
    hasConf: document.body.innerHTML.includes('高置信') || document.body.innerHTML.includes('中高置信'),
  })`, returnByValue: true });
  const det = JSON.parse(r.result.value);
  check('知识详情含出处', det.hasSource);
  check('详情无页码（已移除）', det.noPage);
  check('详情显示置信度', det.hasConf);

  // ---- 12b. 通用化验证：湿型砂控制 / 垂直浇注设计 可从通用搜索命中 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='湿型砂'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('湿型砂质量控制')`, returnByValue: true });
  check('搜湿型砂命中通用工艺', r.result.value);
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='垂直线浇注'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('垂直分型浇注系统设计与计算')`, returnByValue: true });
  check('搜垂直线浇注命中通用设计', r.result.value);
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value=''; document.getElementById('kb_clear').click()` });
  await wait(400);

  // ---- 13. 冒口设计计算器可返回列表 ----
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-view="calculators"]').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.querySelectorAll('.tool-card').length`, returnByValue: true });
  check('返回计算器列表', r.result.value === 13, String(r.result.value));

  // ---- 14. 主题切换 + 知识字段中文化 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('themeBtn').click()` });
  await wait(200);
  r = await send('Runtime.evaluate', { expression: `document.documentElement.getAttribute('data-theme')`, returnByValue: true });
  check('主题切换 light', r.result.value === 'light', r.result.value);
  await send('Runtime.evaluate', { expression: `document.getElementById('themeBtn').click()` });
  await wait(200);
  r = await send('Runtime.evaluate', { expression: `document.documentElement.getAttribute('data-theme')`, returnByValue: true });
  check('主题切换 dark', r.result.value === 'dark', r.result.value);
  // 重置回 auto（再点两下：dark→auto）
  await send('Runtime.evaluate', { expression: `document.getElementById('themeBtn').click()` });
  await wait(150);

  // ---- 14b. 捐助弹窗 + 二维码放大 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('btnDonate').click()` });
  await wait(350);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    modalOpen: !document.getElementById('donateModal').hidden,
    hasHeart: document.body.innerHTML.includes('完全开源、永久免费') && document.body.innerHTML.includes('愿中国的铸造行业'),
    qrLoaded: (function(){ var im = document.querySelector('#donateModal .donate-qr'); return im && im.complete && im.naturalWidth > 0; })()
  })`, returnByValue: true });
  const dn = JSON.parse(r.result.value);
  console.log('\n[捐助]');
  check('捐助弹窗打开', dn.modalOpen);
  check('情怀话文案', dn.hasHeart);
  check('二维码完整加载', dn.qrLoaded);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-open-lightbox]').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `!document.getElementById('qrLightbox').hidden`, returnByValue: true });
  check('二维码放大层打开', r.result.value);
  await send('Runtime.evaluate', { expression: `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))` });
  await wait(200);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('qrLightbox').hidden && document.getElementById('donateModal').hidden`, returnByValue: true });
  check('Esc 关闭弹窗', r.result.value);

  // ---- 14c. 反馈弹窗（请用户发邮件 + 感谢） ----
  await send('Runtime.evaluate', { expression: `document.getElementById('btnSource').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    modalOpen: !document.getElementById('feedbackModal').hidden,
    hasMail: document.body.innerHTML.includes('320451242@QQ.COM'),
    hasThanks: document.body.innerHTML.includes('谢谢你') && document.body.innerHTML.includes('完全开源、永久免费')
  })`, returnByValue: true });
  const fbk = JSON.parse(r.result.value);
  console.log('\n[反馈]');
  check('反馈弹窗打开', fbk.modalOpen);
  check('反馈含邮箱+感谢', fbk.hasMail && fbk.hasThanks);
  await send('Runtime.evaluate', { expression: `document.querySelector('#feedbackModal [data-close-modal]').click()` });
  await wait(200);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('feedbackModal').hidden`, returnByValue: true });
  check('反馈弹窗关闭', r.result.value);

  // ---- 14d. 关于/许可弹窗（作者 + 开源 + 禁止盗用，APK/EXE 共用） ----
  await send('Runtime.evaluate', { expression: `document.getElementById('btnAbout').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    modalOpen: !document.getElementById('aboutModal').hidden,
    hasAuthor: document.body.innerHTML.includes('感谢每一天的生活') && document.body.innerHTML.includes('320451242@QQ.COM'),
    hasOpen: document.body.innerHTML.includes('完全开源') && document.body.innerHTML.includes('MIT'),
    hasNoSteal: document.body.innerHTML.includes('禁止') && document.body.innerHTML.includes('署名')
  })`, returnByValue: true });
  const ab = JSON.parse(r.result.value);
  console.log('\n[关于]');
  check('关于弹窗打开', ab.modalOpen);
  check('关于含作者/联系', ab.hasAuthor);
  check('关于含开源许可', ab.hasOpen);
  check('关于含禁止盗用/署名', ab.hasNoSteal);
  await send('Runtime.evaluate', { expression: `document.querySelector('#aboutModal [data-close-about]').click()` });
  await wait(200);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('aboutModal').hidden`, returnByValue: true });
  check('关于弹窗关闭', r.result.value);

  // HT200 详情中文字段
  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge/materials'` });
  await wait(600);
  await send('Runtime.evaluate', { expression: `Array.from(document.querySelectorAll('.kb-item')).find(el => el.textContent.includes('HT200')) ? Array.from(document.querySelectorAll('.kb-item')).find(el => el.textContent.includes('HT200')).click() : null` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasChinese: document.body.innerHTML.includes('抗拉强度') && document.body.innerHTML.includes('化学成分'),
    noEnglishKey: !document.body.innerHTML.includes('tensile_strength')
  })`, returnByValue: true });
  const zh = JSON.parse(r.result.value);
  console.log('\n[中文化]');
  check('字段显示中文', zh.hasChinese && zh.noEnglishKey);

  // ---- 14b2. 工艺卡片：QT450 详情含 相关计算工具/缺陷/标准/知识 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='QT450'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(500);
  await send('Runtime.evaluate', { expression: `document.querySelector('.kb-item[data-id="QT450"]') ? document.querySelector('.kb-item[data-id="QT450"]').click() : null` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasCalcs: document.body.innerHTML.includes('相关计算工具'),
    hasDefects: document.body.innerHTML.includes('常见缺陷'),
    hasStd: document.body.innerHTML.includes('相关标准'),
    hasRel: document.body.innerHTML.includes('相关知识'),
    hasOut: document.body.innerHTML.includes('出处'),
  })`, returnByValue: true });
  const pc = JSON.parse(r.result.value);
  console.log('\n[工艺卡片]');
  check('相关计算工具段', pc.hasCalcs);
  check('常见缺陷·同材质段', pc.hasDefects);
  check('相关标准段', pc.hasStd);
  check('相关知识段', pc.hasRel);
  check('出处段', pc.hasOut);
  // 详情内部：参数小卡网格（成分/力学/物理）+ 分类色圆点（材料=蓝），旧 key-value 行已移除
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    stats: document.querySelectorAll('.kb-stat').length,
    dotMat: document.querySelectorAll('.kb-group-dot.cat-mat').length,
    oldRows: document.querySelectorAll('.kb-kv').length,
  })`, returnByValue: true });
  const pcIn = JSON.parse(r.result.value);
  check('详情内部参数小卡网格+分类色圆点', pcIn.stats >= 15 && pcIn.dotMat >= 1 && pcIn.oldRows === 0, JSON.stringify(pcIn));
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-back]').click()` });
  await wait(300);
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value=''; document.getElementById('kb_clear').click()` });
  await wait(300);

  // ---- 14c. 锁定开发者模式恢复隐藏 ----
  await send('Runtime.evaluate', { expression: `document.getElementById('devBadge').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('navKnowledge').hidden`, returnByValue: true });
  check('锁定后知识库导航恢复隐藏', r.result.value === true);
  await send('Runtime.evaluate', { expression: `location.hash = '#/knowledge'` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('需要开发者权限')`, returnByValue: true });
  check('锁定后直连显示锁屏', r.result.value);

  // ---- 15. 工艺向导全流程 ----
  await send('Runtime.evaluate', { expression: `location.hash = '#/wizard'` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('试用版') && document.body.innerHTML.includes('试用说明')`, returnByValue: true });
  check('向导试用版徽标+试用说明', r.result.value);
  await send('Runtime.evaluate', { expression: `document.getElementById('wzStart').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('退出向导') && document.body.innerHTML.includes('试用版')`, returnByValue: true });
  check('向导步骤页退出链接+徽标', r.result.value);
  // 选材料 QT450
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-mat="QT450"]').click()` });
  await wait(500);
  // 依次下一步到报告
  for (let i = 0; i < 5; i++) {
    await send('Runtime.evaluate', { expression: `document.getElementById('wzNext').click()` });
    await wait(450);
  }
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hasRiser: document.body.innerHTML.includes('冒口建议'),
    hasGating: document.body.innerHTML.includes('浇注系统建议'),
    hasMaterial: document.body.innerHTML.includes('QT450-10'),
    hasNeck: document.body.innerHTML.includes('冒口颈')
  })`, returnByValue: true });
  const wf = JSON.parse(r.result.value);
  console.log('\n[工艺向导]');
  check('材料预填显示', wf.hasMaterial);
  check('浇注系统建议', wf.hasGating);
  check('冒口建议', wf.hasRiser);
  check('冒口颈', wf.hasNeck);

  // ---- 16. Current Context：向导完成自动保存 + 计算器预填 ----
  console.log('\n[生产场景]');
  // 向导已完成 → 场景=球铁；搜索按场景提升"符合生产场景"组
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='熔炼配料'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    isSearch: document.body.innerHTML.includes('搜索结果'),
    ctxGroup: document.body.innerHTML.includes('符合生产场景'),
  })`, returnByValue: true });
  const ctx0 = JSON.parse(r.result.value);
  check('搜索显示"符合生产场景"组', ctx0.isSearch && ctx0.ctxGroup);
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value=''; document.getElementById('kb_clear').click()` });
  await wait(300);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/castability'` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    barShown: !document.getElementById('ctxBar').hidden,
    barText: document.getElementById('ctxBar').textContent,
    matPrefill: document.getElementById('ca_mat').value,
  })`, returnByValue: true });
  const cc = JSON.parse(r.result.value);
  check('向导完成自动保存生产场景', cc.barShown && cc.barText.includes('球铁'), cc.barText.trim());
  check('结构工艺性材质按工况预选球墨铸铁', cc.matPrefill.includes('球墨'), cc.matPrefill);

  // 手动编辑生产场景：改成 铝合金 + 水平线
  await send('Runtime.evaluate', { expression: `document.getElementById('ctxEdit').click()` });
  await wait(900);   // 等材料下拉加载
  await send('Runtime.evaluate', { expression: `document.getElementById('ctxMaterial').value='铝合金'; document.getElementById('ctxLine').value='水平线'; document.getElementById('ctxSave').click()` });
  await wait(400);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    hidden: document.getElementById('ctxBar').hidden,
    text: document.getElementById('ctxBar').textContent,
  })`, returnByValue: true });
  const cc2 = JSON.parse(r.result.value);
  check('手动编辑生产场景保存', !cc2.hidden && cc2.text.includes('铝合金') && cc2.text.includes('水平线'), cc2.text.trim());

  // 首页推荐：生产场景生效时显示「针对你的生产场景」（铝合金 + 水平线）
  await send('Runtime.evaluate', { expression: `location.hash = '#/home'` });
  await wait(900);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    reco: document.body.innerHTML.includes('针对你的生产场景'),
    ctxChip: document.body.innerHTML.includes('材料 铝合金'),
    hasCalcs: document.body.innerHTML.includes('对口计算工具'),
    hasKnow: document.body.innerHTML.includes('相关知识'),
  })`, returnByValue: true });
  const hr = JSON.parse(r.result.value);
  console.log('\n[首页推荐]');
  check('首页显示针对生产场景', hr.reco && hr.ctxChip);
  check('首页对口计算器', hr.hasCalcs);
  check('首页知识推荐', hr.hasKnow);

  // 清除工况 → 工况条隐藏、计算器恢复默认材质
  await send('Runtime.evaluate', { expression: `document.getElementById('ctxClear').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('ctxBar').hidden`, returnByValue: true });
  check('清除工况后工况条隐藏', r.result.value === true);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators'` });
  await wait(400);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/castability'` });
  await wait(600);
  r = await send('Runtime.evaluate', { expression: `document.getElementById('ca_mat').value`, returnByValue: true });
  check('清除后计算器恢复默认材质', r.result.value.includes('铸钢'), r.result.value);

  // ---- 17. 生产场景优化：场景摘要 + 参数速查卡 + 向导预填 ----
  console.log('\n[生产场景优化]');
  await send('Runtime.evaluate', { expression: `localStorage.setItem('ct-context', JSON.stringify({material:'球铁', line:'垂直线'}))` });
  await send('Page.reload', {});
  await wait(1200);
  await send('Runtime.evaluate', { expression: `location.hash = '#/home'` });
  await wait(1000);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    summary: document.body.innerHTML.includes('已匹配'),
    params: document.body.innerHTML.includes('参数速查'),
    paramVal: document.body.innerHTML.includes('1380~1420'),
    reason: document.body.innerHTML.includes('糊状凝固'),
    tips: document.body.innerHTML.includes('操作要点'),
    defects: document.body.innerHTML.includes('常见缺陷'),
    std: document.body.innerHTML.includes('GB/T 1348'),
  })`, returnByValue: true });
  const sc = JSON.parse(r.result.value);
  check('首页场景摘要（已匹配 N 工具）', sc.summary);
  check('参数速查卡渲染（浇温 1380~1420）', sc.params && sc.paramVal);
  check('理由话术 + 操作要点', sc.reason && sc.tips);
  check('缺陷对策 + 相关标准', sc.defects && sc.std);

  // 向导预填：进向导 → 材料预选球铁代表牌号 QT450；生产条件预填垂直线
  await send('Runtime.evaluate', { expression: `location.hash = '#/wizard'` });
  await wait(500);
  await send('Runtime.evaluate', { expression: `document.getElementById('wzStart').click()` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `(document.querySelector('[data-mat="QT450"] .tool-icon') || {}).textContent || ''`, returnByValue: true });
  check('向导材料按场景预选 QT450', r.result.value.includes('✓'), r.result.value.trim());
  for (let i = 0; i < 4; i++) { await send('Runtime.evaluate', { expression: `document.getElementById('wzNext').click()` }); await wait(400); }
  r = await send('Runtime.evaluate', { expression: `document.getElementById('wz_line').value`, returnByValue: true });
  check('向导生产条件预填垂直线', r.result.value === '垂直线', r.result.value);

  // ---- 18. 滚动位置修复：搜索下滑 → 点详情回到顶部 ----
  console.log('\n[滚动位置]');
  await send('Runtime.evaluate', { expression: `document.getElementById('globalSearch').value='缩松'; document.getElementById('globalSearch').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))` });
  await wait(800);
  await send('Runtime.evaluate', { expression: `window.scrollTo(0, document.body.scrollHeight)` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `({ before: window.scrollY, hasCard: !!document.querySelector('[data-id]') })`, returnByValue: true });
  const scPos = r.result.value;
  check('搜索页已下滑（前置）', scPos.before > 0 && scPos.hasCard, 'scrollY=' + scPos.before);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-id]').click()` });
  await wait(300);
  r = await send('Runtime.evaluate', { expression: `({ y: window.scrollY, hasBack: !!document.querySelector('[data-back]') })`, returnByValue: true });
  check('点搜索结果进详情回到顶部', r.result.value.y === 0 && r.result.value.hasBack, 'scrollY=' + r.result.value.y);

  // ---- 19. 生产场景预选覆盖全部计算工具 ----
  console.log('\n[场景预选覆盖]');
  await send('Runtime.evaluate', { expression: `localStorage.setItem('ct-context', JSON.stringify({material:'球铁', line:'水平线', prod:'自动线', method:'砂型'}))` });
  await send('Page.reload', {});
  await wait(1200);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/machining'` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ mat: document.getElementById('m_mat').value, method: document.getElementById('m_method').value })`, returnByValue: true });
  const pMach = JSON.parse(r.result.value);
  check('加工余量：材质球铁+生产方式自动线预选', pMach.mat === '球铁' && pMach.method.includes('机器造型'), JSON.stringify(pMach));
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/yield'` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ mat: document.getElementById('y_mat').value, process: document.getElementById('y_process').value })`, returnByValue: true });
  const pYield = JSON.parse(r.result.value);
  check('出品率：材质球铁+造型线水平线预选', pYield.mat.includes('球铁') && pYield.process === '水平线', JSON.stringify(pYield));

  // 铜合金材质 + 金属型方法（新选项回归）
  await send('Runtime.evaluate', { expression: `localStorage.setItem('ct-context', JSON.stringify({material:'铜合金', method:'金属型'}))` });
  await send('Page.reload', {});
  await wait(1200);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/machining'` });
  await wait(700);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ mat: document.getElementById('m_mat').value, method: document.getElementById('m_method').value })`, returnByValue: true });
  const pCu = JSON.parse(r.result.value);
  check('加工余量：铜合金材质+金属型方法预选', pCu.mat === '铜合金' && pCu.method.includes('金属型'), JSON.stringify(pCu));
  await send('Runtime.evaluate', { expression: `localStorage.removeItem('ct-context')` });

  // ---- 20. 缺陷查找工具 ----
  console.log('\n[缺陷查找]');
  // 清空工况需重载：context 模块在加载时读 localStorage，仅 removeItem 不会更新内存态
  await send('Runtime.evaluate', { expression: `localStorage.removeItem('ct-context')` });
  await send('Page.reload', {});
  await wait(1000);
  await send('Runtime.evaluate', { expression: `location.hash = '#/calculators/defect_finder'` });
  await wait(1200);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    title: document.querySelector('.page-title').textContent.trim(),
    chips: document.querySelectorAll('.df-chip').length,
    hasAll30: document.body.innerHTML.includes('全部（30）'),
    cardCount: document.querySelectorAll('.defect-hit').length,
  })`, returnByValue: true });
  const df0 = JSON.parse(r.result.value);
  check('缺陷查找渲染（标题+8大类+30条）', df0.title.includes('缺陷查找') && df0.chips === 9 && df0.hasAll30 && df0.cardCount === 30, JSON.stringify(df0));
  // 卡片视觉系统：缺陷卡分类色条 + 右侧安静箭头（旧"对策 →"药丸已移除）
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({
    catDef: document.querySelector('.defect-hit').classList.contains('cat-def'),
    hasArrow: !!document.querySelector('.defect-hit .kb-arrow'),
    oldChipGone: !document.querySelector('.defect-hit .kb-item-right .chip'),
  })`, returnByValue: true });
  const dfVis = JSON.parse(r.result.value);
  check('缺陷卡分类色条+安静箭头', dfVis.catDef && dfVis.hasArrow && dfVis.oldChipGone, JSON.stringify(dfVis));

  // 搜索「缩松」→ 首条命中缩孔与缩松
  await send('Runtime.evaluate', { expression: `document.getElementById('df_q').value='缩松'; document.getElementById('df_go').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.querySelector('.defect-hit .kb-item-title') ? document.querySelector('.defect-hit .kb-item-title').textContent.trim() : ''`, returnByValue: true });
  check('搜「缩松」首条命中缩孔与缩松', r.result.value.includes('缩孔'), r.result.value);

  // 材质过滤：灰铁 → 缩松类被过滤（灰铁无缩松标签）
  await send('Runtime.evaluate', { expression: `document.getElementById('df_mat').value='灰铁'; document.getElementById('df_mat').dispatchEvent(new Event('change'))` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `document.body.innerHTML.includes('缩孔与缩松')`, returnByValue: true });
  check('灰铁材质过滤后不出现缩松', r.result.value === false);

  // 分类过滤：金相成分组织（空查询 + 灰铁 → 白口/石墨粗大/反白口）
  await send('Runtime.evaluate', { expression: `document.getElementById('df_q').value=''; document.getElementById('df_go').click()` });
  await wait(400);
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-cat="metal"]').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ n: document.querySelectorAll('.defect-hit').length, hasWhiteIron: document.body.innerHTML.includes('白口') })`, returnByValue: true });
  const dfCat = JSON.parse(r.result.value);
  check('金相类过滤（灰铁白口等）', dfCat.n >= 1 && dfCat.hasWhiteIron, JSON.stringify(dfCat));

  // 点开缺陷 → 工艺卡片详情
  await send('Runtime.evaluate', { expression: `document.getElementById('df_q').value='白口'; document.querySelector('.defect-hit').click()` });
  await wait(500);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ hash: location.hash, hasBack: !!document.querySelector('[data-back]'), hasCauses: document.body.innerHTML.includes('原因') })`, returnByValue: true });
  const dfDetail = JSON.parse(r.result.value);
  check('点缺陷进工艺卡片（含原因对策）', dfDetail.hash.startsWith('#/search/') && dfDetail.hasBack && dfDetail.hasCauses, dfDetail.hash);

  // 详情返回 → 回到缺陷查找（不是首页），且搜索词保留
  await send('Runtime.evaluate', { expression: `document.querySelector('[data-back]').click()` });
  await wait(1200);
  r = await send('Runtime.evaluate', { expression: `JSON.stringify({ hash: location.hash, isFinder: !!document.getElementById('df_q'), queryKept: document.getElementById('df_q')?.value || '' })`, returnByValue: true });
  const dfBack = JSON.parse(r.result.value);
  check('缺陷详情返回回缺陷查找', dfBack.hash.startsWith('#/calculators/defect_finder') && dfBack.isFinder, dfBack.hash);
  check('缺陷返回后搜索词保留', dfBack.queryKept === '白口', 'q=' + dfBack.queryKept);

  // ---- 15. JS 异常检查 ----
  check('无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

  console.log('\n结果: ' + (failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'));
} catch (e) {
  console.error('测试失败:', e.message);
  failures++;
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { edge.kill(); } catch (e) {}
  try { server && server.kill(); } catch (e) {}
  process.exit(failures === 0 ? 0 : 1);
}
