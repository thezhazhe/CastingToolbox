// ============================================================
// 工艺检测中心 · 端到端冒烟测试（无头 Edge + CDP）
//   PHASE 88 建立 → PHASE 89/90/91/92 随输入区与流道追踪改造更新
//   → **PHASE 93：产品路线收敛**。主流程改为「产品 + 冒口 → 模数比」，
//     浇注系统的自动识别退出普通用户主流程（93.txt §十四）。
//
// 纯数值侧的几何真值测试在 tests/phase93_test.mjs；这里只测**页面真的这么跑**：
//   ① 页面骨架：2 个导入槽（产品 / 冒口）+ 模块行 + 开始检测；3D 在结果之前
//   ② 产品 STL → 走完整既有链路（几何 + Hotspot V3）→ **不重算 Hotspot**
//   ③ 冒口 STL → ③ 点「开始检测」→ 每个冒口一张卡（§六 三步，不自动出结论）
//   ④ 卡片内容：冒口模数 / 最近热点 / 热点模数 / 模数比 / 结论 + 几何关系声明
//   ⑤ 3D：产品 + 冒口同场景，点卡片 → 高亮对应对象（§十二）
//   ⑥ 移动端 390px 实测排版（§十三/§二十 N）
//   ⑦ 中英切换无中文残留（§二十二.10）
//   ⑧ 离开视图再回来：状态与 3D 都还在（PHASE 88 回归守卫）
//   ⑨ 无控制台异常
//
// 模型在**页面内**用 /tests/helpers/stlGen.js 现生成（serve.js 服务整个项目根），
// 避免把几 MB 的 STL 文本经 CDP 传进去。
//
// 用法: node scripts/browser_inspection_test.mjs
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9239;
// &hsDebug=1 —— 挂出 window.__view3d，好**直接读 three.js 场景**（图例/DOM 只是代理）
const URL = 'http://localhost:8090/?hsDebug=1';
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

const PROFILE = path.join(process.cwd(), '_edge_p93inspect');
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });

let ws = null;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

try {
  await waitForServer();
  ws = new WebSocket(await getWsUrl());
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
    // ⚠ 只记 text 的话永远只有一句 "Uncaught"，出了事根本没法查（PHASE 97 实测踩到）。
    //   记上 description（含消息与栈首行），断言失败时才有东西可看。
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push([d.text, d.exception?.description || ''].filter(Boolean).join(' :: ').split('\n').slice(0, 2).join(' | '));
    }
  };
  await new Promise((r) => (ws.onopen = r));

  await send('Page.enable'); await send('Runtime.enable');
  const evalJs = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };
  const goto = async (hash) => { await evalJs(`location.hash = '${hash}'`); await wait(800); };

  /* ---------- 模型在页面内生成（立方包围盒 + 错开网格点，见 tests/phase90_test.mjs 注释） ---------- */
  const buildModels = () => evalJs(`(async () => {
    const g = await import('/tests/helpers/stlGen.js');
    const cylY = (cx, cz, r, y0, y1) => (p) => Math.max(Math.hypot(p[0]-cx, p[2]-cz) - r, Math.max(y0-p[1], p[1]-y1));
    const gen = (sdf, ext, res) => { const half = ext * 1.1 + 4.7, d = 0.3179;
      return g.genSTL(sdf, [[-half+d,-half+d,-half+d],[half+d,half+d,half+d]], res); };
    window.__m = {
      // 产品：160×60×100 块，顶面 y=0（4 个凸起 → 热点）
      product: gen(g.union(g.BOX([-80,-60,-50],[80,0,50]),
        ...[[-45,-45],[45,-45],[-45,45],[45,45]].map(([x,z]) => g.BOX([x-18,0,z-18],[x+18,35,z+18]))), 110, 96),
      // R1：明显够大（M≈14 vs 热点 M≈9.7 → 比 ≈1.4 → PASS）；R2：明显小（≈0.34 → WARNING）
      // 一页里同时出现两条分支，判据才算真的在这份数据上跑过（§十）
      R1: gen(cylY(-45, 20, 35, 5, 145), 150, 60),
      R2: gen(cylY(45, -20, 9, 5, 30), 90, 44),
    };
    return Object.keys(window.__m).length;
  })()`, true);

  const dropFile = (kind, key, name) => evalJs(`(() => {
    const input = document.querySelector('[data-file="${kind}"]');
    const dt = new DataTransfer();
    dt.items.add(new File([window.__m['${key}']], '${name}', { type: 'model/stl' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);

  const waitFor = async (expr, ms = 120000, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      if (await evalJs(expr)) return true;
      await wait(step);
    }
    return false;
  };

  await send('Page.navigate', { url: URL });
  await wait(2200);
  const n = await buildModels();
  check('页面内生成测试模型', n === 3, `${n} 个（产品 + 2 冒口）`);

  /* ---------- ① 页面骨架（93.txt §四/§五/§六） ---------- */
  console.log('\n[① 页面骨架]');
  await goto('#/inspection');
  check('路由 #/inspection 可达', (await evalJs(`!!document.querySelector('.pi-ws')`)));
  const title = await evalJs(`document.querySelector('.page-title')?.textContent || ''`);
  check('页面标题 = 工艺检测中心（§四 改名）', title.includes('工艺检测中心'), title.trim());
  check('标题带「试用中」标记（§四：明显但克制）',
    (await evalJs(`document.querySelector('.pi-trial')?.textContent || ''`)).trim() === '试用中');
  check('一句话定位（§五：不要长篇介绍）',
    (await evalJs(`document.querySelector('.page-sub')?.textContent || ''`)).trim() === '检查已经完成的铸造工艺设计。');
  // PHASE 94 §三：冒口面板仍是 2 个槽；浇注系统面板另有 3 个语义槽（默认不显示）
  check('冒口面板只有 2 个槽：产品 / 冒口（93.txt §六）',
    (await evalJs(`[...document.querySelectorAll('[data-pi-panel="riser"] .pi-slot')].map(s => s.dataset.slot).join(',')`))
      === 'product,riser');
  check('没有"一整份浇注系统"导入槽（93.txt §十四：自动识别不回到主流程）',
    (await evalJs(`!!document.querySelector('[data-slot="gating"]')`)) === false);
  check('默认停在冒口检测页签（94.txt §三）',
    (await evalJs(`document.querySelector('[data-pi-panel="riser"]').hidden`)) === false
    && (await evalJs(`document.querySelector('[data-pi-panel="gating"]').hidden`)) === true);
  const mods = await evalJs(`[...document.querySelectorAll('.pi-mod')].map(m => m.textContent.replace(/\\s+/g,'')).join('|')`);
  check('模块行 = 冒口检测 + 浇注系统检测（94.txt：浇注系统不再是「即将支持」）',
    mods.includes('冒口检测') && mods.includes('浇注系统检测') && !mods.includes('即将支持'), mods);
  check('不存在入口点选面板（90.txt §三 的结论继续有效）',
    (await evalJs(`!!document.querySelector('#pi_entry, [data-pi-act], #pi_entryN')`)) === false);
  check('未导入时正文隐藏', (await evalJs(`document.querySelector('#pi_body').hidden`)) === true);
  check('未导入时「开始检测」不可点（§六 ③ 有前置条件）',
    (await evalJs(`document.querySelector('#pi_run').disabled`)) === true);
  const hint0 = await evalJs(`document.querySelector('#pi_runHint')?.textContent || ''`);
  check('按钮旁说清下一步做什么', hint0.includes('请先导入产品'), hint0);

  /* ---------- ② 产品导入 → 既有链路 ---------- */
  console.log('\n[② 产品 STL 导入]');
  await dropFile('product', 'product', 'boss.stl');
  const okBody = await waitFor(`!document.querySelector('#pi_body')?.hidden`);
  check('分析完成、正文出现', okBody);
  const hsN = await evalJs(`(() => {
    const row = [...document.querySelectorAll('#pi_plan .pi-planrow')].find(r => r.textContent.includes('热点'));
    return row ? parseInt(row.querySelector('b').textContent, 10) : -1;
  })()`);
  check('检出热点（走既有 Hotspot V3，非重算）', hsN > 0, `${hsN} 个`);
  check('产品信息卡显示文件名',
    /boss\.stl/.test(await evalJs(`document.querySelector('#pi_plan')?.textContent || ''`)));
  const beforeRun = await evalJs(`document.querySelector('#pi_result')?.textContent || ''`);
  check('★ 导入完不自动出结论，要求先点「开始检测」（§六 ① ② ③）',
    beforeRun.includes('开始检测'), beforeRun.slice(0, 40));

  /* ---------- ③ 冒口 + 开始检测 → 卡片（§六/§九/§十/§十三） ---------- */
  console.log('\n[③ 冒口 + 开始检测]');
  await dropFile('riser', 'R1', 'R1.stl');
  await dropFile('riser', 'R2', 'R2.stl');
  await waitFor(`document.querySelector('#pi_n_riser')?.textContent === '2'`, 30000);
  await wait(700);
  check('冒口计数 = 2', (await evalJs(`document.querySelector('#pi_n_riser').textContent`)) === '2');
  check('两个输入都到位后按钮可点', (await evalJs(`document.querySelector('#pi_run').disabled`)) === false);

  // 回归守卫（PHASE 88 遗留）：连续投放若并发解析，完成顺序会与投放顺序不一致 → 编号错位
  await evalJs(`document.querySelector('#pi_detailSec').open = true`); await wait(250);
  const pairs = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_detailSec .pi-table tbody tr')]
    .map(tr => [tr.children[0].textContent.trim(), tr.children[1].textContent.trim()])
    .filter(([id]) => id.startsWith('R')))`));
  check('编号与文件名不错位（导入顺序 = 编号顺序）',
    pairs.length === 2 && pairs.every(([id, nm]) => id + '.stl' === nm), JSON.stringify(pairs));
  await evalJs(`document.querySelector('#pi_detailSec').open = false`); await wait(150);

  await evalJs(`document.querySelector('#pi_run').click()`);
  await wait(900);
  const cards = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_result .pi-rcard')].map(c => ({
    id: c.querySelector('.pi-rcid').textContent.trim(),
    txt: c.textContent.replace(/\\s+/g, ' ').trim(),
    kv: [...c.querySelectorAll('.pi-rk')].map(k => [k.querySelector('span').textContent.trim(), k.querySelector('b').textContent.trim()]),
    verdict: c.querySelector('.pi-rcverdict')?.textContent.trim() ?? '',
    vcls: c.querySelector('.pi-rcverdict')?.className ?? '',
    hasMore: !!c.querySelector('[data-pi-all]'),
    allHidden: c.querySelector('.pi-allbox') ? c.querySelector('.pi-allbox').hidden : true,
  })))`));
  check('每个冒口一张卡（§十三 纵向卡片）', cards.length === 2, `${cards.length} 张`);
  check('卡片编号 R1 / R2', cards.map(c => c.id).join(',') === 'R1,R2', cards.map(c => c.id).join(','));
  const kvNames = cards[0]?.kv.map(k => k[0]).join(',') ?? '';
  check('卡片四项读数：冒口模数 / 最近热点 / 热点模数 / 模数比（§九 默认只显示最近热点）',
    kvNames === '冒口模数,最近热点,热点模数,模数比', kvNames);
  check('读数带单位 mm', /mm/.test(cards[0].kv[0][1]) && /mm/.test(cards[0].kv[2][1]), JSON.stringify(cards[0].kv));
  // 模数比必须是卡片上那两个数的商（页面不许自己再编一个比值）
  const num = (s) => parseFloat(String(s).replace(/[^\d.]/g, ''));
  const ratioOk = cards.every(c => {
    const mr = num(c.kv[0][1]), mh = num(c.kv[2][1]), rr = num(c.kv[3][1]);
    return Number.isFinite(mr) && Number.isFinite(mh) && mh > 0 && Math.abs(mr / mh - rr) <= 0.02;
  });
  check('模数比 = 卡片上的 M冒口 ÷ M热点（三处数字互相对得上）', ratioOk,
    cards.map(c => c.kv.map(k => k[1]).join('/')).join('  |  '));
  check('★ 存在「模数比不足」的 WARNING（判据在真实数据上生效，§十）',
    cards.some(c => c.vcls.includes('pi-warning')), cards.map(c => c.vcls + ':' + c.verdict).join(' | '));
  check('★ 存在「模数比满足」的 PASS', cards.some(c => c.vcls.includes('pi-pass')));
  check('用「最近热点」措辞，且明确标注只是几何关系（§十一）',
    cards.every(c => c.txt.includes('几何关系')) && !cards.some(c => c.txt.includes('负责')),
    cards[0].txt.slice(0, 80));
  check('不默认铺开 N×M 矩阵（§九：多热点时才给「查看全部热点」）',
    cards.every(c => c.hasMore === (hsN > 1)) && cards.every(c => c.allHidden === true),
    `每卡按钮 ${cards.map(c => c.hasMore).join(',')}`);
  const sumTxt = await evalJs(`document.querySelector('#pi_result .pi-reslist')?.textContent || ''`);
  check('总览给出 满足 / 不足 的计数', sumTxt.includes('模数比满足') && sumTxt.includes('模数比不足'),
    sumTxt.replace(/\s+/g, ' ').slice(0, 90));
  // §十末段：不得把几何模数检查说成结论。**按句判**，因为免责声明必须能写
  // "…也不代表『一定不会缩孔』" —— 那句话本身就是在辟谣，不该被自己的规则误伤。
  const promise = await evalJs(`(() => {
    const txt = document.querySelector('#pi_result')?.textContent || '';
    return txt.split(/[。；]/).filter(s => /一定不会缩孔|一定能补缩|工艺一定正确/.test(s) && !/不代表|不等同|不做/.test(s)).join(' / ');
  })()`);
  check('总览区不出现"一定不会缩孔"这类过度承诺（§十末段）', promise === '', promise);

  /* ---------- ④ 3D：同场景 + 点选高亮（§十二） ---------- */
  console.log('\n[④ 3D 场景与点选]');
  check('3D canvas 已渲染', (await evalJs(`!!document.querySelector('#pi_view3dBox canvas')`)));
  const scene0 = JSON.parse(await evalJs(`JSON.stringify((() => {
    const v = window.__view3d;
    return { meshes: v.meshGroup.children.length,
      keys: v.meshGroup.children.map(m => m.userData.pickKey),
      colors: v.meshGroup.children.map(m => m.material.color.getHexString()),
      markers: v.markerMeshes.length };
  })())`));
  check('产品 + 冒口在同一场景，相对位置保留（统一 center 平移）',
    scene0.meshes === 3, JSON.stringify(scene0.keys));
  check('冒口是可拾取对象（带 pickKey）',
    scene0.keys.filter(Boolean).join(',') === 'R1,R2', JSON.stringify(scene0.keys));
  check('热点 marker 已画进场景', scene0.markers === hsN, `${scene0.markers} / ${hsN}`);

  await evalJs(`document.querySelectorAll('#pi_result .pi-rcard')[0].click()`);
  await wait(500);
  check('点卡片 → 卡片进入选中态',
    (await evalJs(`document.querySelectorAll('#pi_result .pi-rcard')[0].className`)).includes('on'));
  const hl = JSON.parse(await evalJs(`JSON.stringify((() => {
    const v = window.__view3d;
    return v.meshGroup.children.map(m => ({ k: m.userData.pickKey, c: m.material.color.getHexString() }));
  })())`));
  check('★ 点 R1 → 3D 里只有 R1 保持原色，其余压暗（§十二 点 R1 高亮 R1）',
    hl.filter(x => x.c === 'fbbf24').length === 1 && hl.find(x => x.k === 'R1').c === 'fbbf24'
    && hl.filter(x => x.k !== 'R1').every(x => x.c !== 'fbbf24'),
    JSON.stringify(hl));
  await evalJs(`document.querySelectorAll('#pi_result .pi-rcard')[1].click()`);
  await wait(400);
  const hl2 = JSON.parse(await evalJs(`JSON.stringify(window.__view3d.meshGroup.children.map(m => ({ k: m.userData.pickKey, c: m.material.color.getHexString() })))`));
  check('★ 改点 R2 → 高亮跟着换到 R2', hl2.find(x => x.k === 'R2').c === 'fbbf24' && hl2.find(x => x.k === 'R1').c !== 'fbbf24',
    JSON.stringify(hl2));
  await evalJs(`document.querySelectorAll('#pi_result .pi-rcard')[1].click()`);
  await wait(400);
  const hl3 = JSON.parse(await evalJs(`JSON.stringify(window.__view3d.meshGroup.children.map(m => m.userData.pickKey + ':' + m.material.color.getHexString()))`));
  check('再点一次 = 取消选中，全部还原', hl3.filter(x => x.endsWith('fbbf24')).length === 2, JSON.stringify(hl3));

  /* ---------- ⑤ 移动端实测（§十三 / §二十 N） ---------- */
  console.log('\n[⑤ 移动端]');
  for (const [w, h, label] of [[1440, 900, '桌面'], [820, 1024, '平板'], [390, 844, '移动']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await wait(700);
    const ov = await evalJs(`(() => {
      const de = document.documentElement;
      const bad = [];
      document.querySelectorAll('#view *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > de.clientWidth + 1) bad.push(el.className || el.tagName);
      });
      return JSON.stringify({ scrollW: de.scrollWidth, clientW: de.clientWidth, bad: bad.slice(0, 3) });
    })()`);
    const o = JSON.parse(ov);
    check(`${label} ${w}px 无横向溢出`, o.scrollW <= o.clientW + 1, `scrollW=${o.scrollW} clientW=${o.clientW} ${o.bad.join(',')}`);
  }
  // 390px 下的具体排版契约
  const mob = JSON.parse(await evalJs(`JSON.stringify((() => {
    const grid = document.querySelector('#pi_result .pi-rkgrid');
    const card = document.querySelector('#pi_result .pi-rcard');
    const list = document.querySelector('#pi_result .pi-rlist');
    const trial = document.querySelector('.pi-trial');
    const navTrial = document.querySelector('.nav-item[data-view="inspection"] .nav-trial');
    const view3dTop = document.querySelector('#pi_view3dBox').getBoundingClientRect().top + scrollY;
    const resTop = document.querySelector('#pi_resultSec').getBoundingClientRect().top + scrollY;
    return {
      gridCols: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      cardW: Math.round(card.getBoundingClientRect().width),
      listDir: getComputedStyle(list).flexDirection,
      trialVisible: getComputedStyle(trial).display !== 'none',
      navTrialVisible: getComputedStyle(navTrial).display !== 'none',
      view3dTop: Math.round(view3dTop), resTop: Math.round(resTop),
    };
  })())`));
  check('移动端读数 4 列降为 2 列（放不下就换行，不硬挤）', mob.gridCols === 2, `实际 ${mob.gridCols} 列`);
  check('移动端卡片纵向堆叠', mob.listDir === 'column', mob.listDir);
  check('移动端卡片占满可用宽度', mob.cardW >= 320, `${mob.cardW}px`);
  check('移动端「试用中」仍在页面上可见（只是从底部标签栏挪到标题旁）',
    mob.trialVisible && !mob.navTrialVisible, JSON.stringify({ page: mob.trialVisible, nav: mob.navTrialVisible }));
  check('★ 页面顺序：3D 在上、检测结果在下（§十二）', mob.view3dTop < mob.resTop, `3D@${mob.view3dTop} 结果@${mob.resTop}`);
  await send('Emulation.clearDeviceMetricsOverride', {});
  await wait(500);

  /* ---------- ⑥ 中英切换（§二十二.10） ---------- */
  console.log('\n[⑥ 中英切换]');
  const navZh = await evalJs(`document.querySelector('.nav-item[data-view="inspection"] span[data-i18n="nav.inspection"]').textContent`);
  check('中文：侧栏栏目名', navZh === '工艺检测中心', navZh);
  await evalJs(`document.querySelector('#langSwitch [data-lang="en-US"]').click()`);
  await wait(2600);
  const enNav = await evalJs(`document.querySelector('.nav-item[data-view="inspection"]').textContent.replace(/\\s+/g,' ').trim()`);
  check('英文：侧栏栏目名 + 试用标记', /Process Inspection/.test(enNav) && /Trial/.test(enNav), enNav);
  check('英文：页面标题', /Process Inspection/.test(await evalJs(`document.querySelector('.page-title')?.textContent || ''`)));
  const cjk = await evalJs(`(() => {
    const bad = [];
    for (const sel of ['#pi_plan','#pi_result','#pi_detail','.pi-import','.pi-mods','.pi-runbar','.pi-hero3d']) {
      const el = document.querySelector(sel); if (!el) continue;
      const m = (el.textContent || '').match(/[\\u4e00-\\u9fff]+/g);
      if (m) bad.push(sel + ':' + m.slice(0, 4).join(','));
    }
    return bad.join(' | ');
  })()`);
  check('英文模式核心区无中文残留', cjk === '', cjk);
  const enCards = await evalJs(`document.querySelectorAll('#pi_result .pi-rcard').length`);
  check('切语言后检测结果仍在（结果不因换语言丢失）', enCards === 2, `${enCards} 张`);
  await evalJs(`document.querySelector('#langSwitch [data-lang="zh-CN"]').click()`);
  await wait(2600);
  check('切回中文后 3D canvas 仍在', (await evalJs(`!!document.querySelector('#pi_view3dBox canvas')`)));
  check('切回中文后卡片仍在', (await evalJs(`document.querySelectorAll('#pi_result .pi-rcard').length`)) === 2);

  /* ---------- ⑦ 离开视图再回来（整视图重渲染） ---------- */
  console.log('\n[⑦ 离开视图再回来]');
  await goto('#/home'); await wait(600); await goto('#/inspection'); await wait(2600);
  check('离开再回来：计数保持',
    (await evalJs(`['product','riser'].map(k => document.querySelector('#pi_n_' + k).textContent).join('/')`)) === '1/2');
  // 回归守卫（PHASE 88 遗留）：整块 innerHTML 重写会抹掉旧 canvas，场景指纹漏判 → 3D 直接消失
  check('离开再回来：3D canvas 重建（非死在缓存上）', (await evalJs(`!!document.querySelector('#pi_view3dBox canvas')`)));
  check('离开再回来：检测结果与卡片还在',
    (await evalJs(`document.querySelectorAll('#pi_result .pi-rcard').length`)) === 2);
  const back3d = await evalJs(`window.__view3d?.meshGroup.children.length ?? -1`);
  check('离开再回来：3D 场景对象数不变', back3d === 3, String(back3d));

  /* ==================================================================
     ⑧ 浇注系统检测（PHASE 94 · 94.txt §三/§七/§八/§十/§十一/§十五）
     ================================================================== */
  console.log('\n[⑧ 浇注系统检测：手动语义版]');
  const gN = await evalJs(`(async () => {
    const g = await import('/tests/helpers/stlGen.js');
    const cylY = (cx, cz, r, y0, y1) => (p) => Math.max(Math.hypot(p[0]-cx, p[2]-cz) - r, Math.max(y0-p[1], p[1]-y1));
    const gen = (sdf, b, res) => g.genSTL(sdf, b, res);
    window.__g = {
      // 直浇道：3 个独立圆台（⌀20→⌀16，高 70），间距 60。
      // ⚠ 包络整体平移 0.0173mm：四面体 MC 在网格点**恰好落在等值面上**时会产出零面积三角形，
      //   它们被退化过滤剔除后邻居就丢了边 → 组件被判"不闭合"（本机实测 res=96 且不平移时 3 个里有 1 个中招）。
      //   平移一点点就躲开了，纯属夹具网格对齐，不是产品逻辑。
      sprue: gen(g.union(...[0,1,2].map(i => (p) => {
        const cx = i*60, r = 10 + (8-10)*(p[1]/70);
        return Math.max(Math.hypot(p[0]-cx, p[2]) - r, Math.max(-p[1], p[1]-70));
      })), [[-21.0173,-11.0121,-21.0173],[140.9827,80.9879,20.9827]], 96),
      // 横浇道：2 个独立方管 60×15×20（截面 20×15 = 300）
      runner: gen(g.union(
        g.BOX([-30, 0, -10], [30, 15, 10]),
        g.BOX([-30, 40, -10], [30, 55, 10]),
      ), [[-36,-10,-16],[36,65,16]], 88),
      // 内浇口：4 个 ⌀10×20 圆柱
      ingate: gen(g.union(...[[0,0],[30,0],[60,0],[90,0]].map(([x]) => cylY(x, 0, 5, 0, 20))),
        [[-11,-12,-11],[101,32,11]], 96),
    };
    return Object.keys(window.__g).length;
  })()`, true);
  check('页面内生成浇注系统测试模型', gN === 3, `${gN} 个（直/横/内）`);

  await evalJs(`document.querySelector('[data-pi-tab="gating"]').click()`); await wait(400);
  check('★ 浇注系统检测可以打开（94.txt §十五）',
    (await evalJs(`document.querySelector('[data-pi-panel="gating"]').hidden`)) === false);
  // ★ 光有 hidden 属性不够：`[hidden]` 是元素选择器权重，会被 `.card.section-card` 的 display 盖掉
  //   → 两个模块的结果会同时铺在页面上。这里按**计算样式**核验，才抓得住那类问题。
  const leak = async (tab) => evalJs(`[...document.querySelectorAll('[data-pi-panel]')]
    .filter(p => p.dataset.piPanel !== '${tab}' && getComputedStyle(p).display !== 'none')
    .map(p => p.id || p.className).join(',')`);
  check('★ 切到浇注系统后，冒口模块的区块真的不显示（按计算样式核验）', (await leak('gating')) === '', await leak('gating'));
  // ⚠ PHASE 95：浇注系统面板里多了**产品**槽（95.txt §二），它用的是 data-slot-shared
  //   （与模块 A 共用同一个 state 与同一个 file input）→ 这里只数三个语义槽。
  check('三个语义槽：直浇道 / 横浇道 / 内浇口（§三）',
    (await evalJs(`[...document.querySelectorAll('[data-pi-panel="gating"] .pi-slot[data-slot]')].map(s => s.dataset.slot).join(',')`))
      === 'sprue,runner,ingate');
  check('★ PHASE 95：浇注系统面板里也有「产品」槽，且**不是**第二个 file input（§二 + 单一真相）',
    (await evalJs(`!!document.querySelector('[data-pi-panel="gating"] [data-slot-shared="product"]')`)) === true
    && (await evalJs(`document.querySelectorAll('[data-file="product"]').length`)) === 1);
  const multi = await evalJs(`[...document.querySelectorAll('[data-pi-panel="gating"] input[type=file]')].map(i => i.hasAttribute('multiple')).join(',')`);
  check('★ 每个类别**只能导入 1 个 STL**（§二：没有 multiple）', multi === 'false,false,false', multi);
  check('未导入任何类别时「开始检测」不可点（§三）',
    (await evalJs(`document.querySelector('#pi_grun').disabled`)) === true);

  // —— 只导入直浇道 → 可以单独检测（§三：允许只导入其中一个类别） ——
  const dropG = (kind, key, name) => evalJs(`(() => {
    const input = document.querySelector('[data-file="${kind}"]');
    const dt = new DataTransfer();
    dt.items.add(new File([window.__g['${key}']], '${name}', { type: 'model/stl' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await dropG('sprue', 'sprue', 'sprue.stl');
  await waitFor(`document.querySelector('#pi_n_sprue')?.textContent === '3'`, 30000);
  await wait(500);
  check('★ 一个 STL → 3 个组件（§二：数量按连通分量数，不按文件数）',
    (await evalJs(`document.querySelector('#pi_n_sprue').textContent`)) === '3');
  check('只导入一个类别也能开始检测（§三）',
    (await evalJs(`document.querySelector('#pi_grun').disabled`)) === false);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(500);
  const onlySprue = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_gres .pi-grow')].map(r => r.textContent.replace(/\\s+/g,' ').trim()))`));
  check('未导入的类别显示「未导入」，不报错（§三）',
    onlySprue.filter(t => t.includes('未导入')).length === 2, JSON.stringify(onlySprue));
  check('比例只列已导入的类别，不伪造缺失类别（§八）',
    !/直浇道\s*:\s*横浇道/.test(await evalJs(`document.querySelector('#pi_gres .pi-gratio')?.textContent || ''`))
    && (await evalJs(`document.querySelector('#pi_gres .pi-gratio')?.textContent || ''`)).includes('直浇道'));

  // —— 补齐其余两类 ——
  await dropG('runner', 'runner', 'runner.stl');
  await dropG('ingate', 'ingate', 'ingate.stl');
  await waitFor(`document.querySelector('#pi_n_ingate')?.textContent === '4'`, 30000);
  await wait(600);
  check('横浇道：一个 STL → 2 个组件', (await evalJs(`document.querySelector('#pi_n_runner').textContent`)) === '2');
  check('内浇口：一个 STL → 4 个组件', (await evalJs(`document.querySelector('#pi_n_ingate').textContent`)) === '4');
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(700);

  const gsum = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_gres .pi-grow')].map(r => ({
    name: r.querySelector('.pi-gname').textContent.trim(),
    count: parseInt(r.querySelector('.pi-gcount b').textContent, 10),
    area: parseFloat(r.querySelector('.pi-garea b').textContent),
  })))`));
  check('主界面给出三类**数量**（§七）',
    gsum.length === 3 && gsum[0].count === 3 && gsum[1].count === 2 && gsum[2].count === 4,
    JSON.stringify(gsum.map(g => g.count)));
  // 解析值：圆台中段 ⌀18 → ≈254.5 / 方管 20×15 → 300 / 圆柱 ⌀10 → 78.5
  check('主界面给出三类**总截面积**（§七）',
    Math.abs(gsum[0].area - 3 * 254.5) / (3 * 254.5) < 0.06
    && Math.abs(gsum[1].area - 2 * 300) / 600 < 0.05
    && Math.abs(gsum[2].area - 4 * 78.5) / 314 < 0.06,
    JSON.stringify(gsum.map(g => g.area)));
  const gtotal = parseFloat(await evalJs(`document.querySelector('.pi-gtotal b').textContent`));
  check('总截面积 = 三类之和（§七）',
    Math.abs(gtotal - (gsum[0].area + gsum[1].area + gsum[2].area)) < 0.5, `${gtotal}`);
  const ratio = await evalJs(`document.querySelector('.pi-gratio')?.textContent.replace(/\\s+/g,' ').trim() || ''`);
  check('比例（直 : 横 : 内）以第一个已导入类别为 1（§八）',
    /直浇道 : 横浇道 : 内浇口 = 1 :/.test(ratio), ratio);
  const share = await evalJs(`document.querySelector('.pi-gshare')?.textContent.replace(/\\s+/g,' ').trim() || ''`);
  const pcts = (share.match(/(\d+(?:\.\d+)?)%/g) || []).map(parseFloat);   // ⚠ 不能用 Number：'45.5%' → NaN
  check('占比三项且总和 = 100%（§八）',
    pcts.length === 3 && Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) < 0.2, share);

  // —— 详细信息：默认折叠、展开有单件数据（§十） ——
  check('★ 详细信息默认折叠（§十）', (await evalJs(`document.querySelector('#pi_gdetailSec').open`)) === false);
  await evalJs(`document.querySelector('#pi_gdetailSec').open = true`); await wait(350);
  // ⚠ PHASE 96：详细表在「截面积」后面**插入了一列「截面方向」**，原来的列号整体后移。
  //   按表头名取列号，别再写死下标（本窗口在 PHASE 94 已经因为写死选择器白折腾过三次）。
  const colIdx = JSON.parse(await evalJs(`JSON.stringify(
    [...document.querySelectorAll('#pi_gdetail .pi-gtable thead th')].map(th => th.textContent.replace(/\\s*mm²|\\s*mm|\\s*cm³/g,'').trim()))`));
  const ci = (name) => colIdx.indexOf(name);
  // ⚠ 按**表头名逐个对齐**断言，不写死"第几列是哪个"——
  //   PHASE 96/97 各插了一列，写死下标的断言每次都要跟着改，而且改错了看不出来。
  //   注意三张表（直/横/内）表头会重复出现，所以这里只看**前 11 个**（一张表的表头）。
  const WANT_COLS = ['ID', '截面类型', '截面尺寸', '截面积', '截面方向', '方向来源', '长度', '体积', '闭合', '截面可靠性', '文件'];
  check('详细表列头齐全且顺序正确（含 PHASE 96「截面方向」/ PHASE 97「方向来源」）',
    WANT_COLS.every((h, i) => colIdx[i] === h), JSON.stringify(colIdx.slice(0, 11)));
  const unitRows = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_gdetail .pi-gtable tbody tr')].map(tr => ({
    id: tr.children[${ci('ID')}].textContent.trim(),
    type: tr.children[${ci('截面类型')}].textContent.trim(),
    dim: tr.children[${ci('截面尺寸')}].textContent.trim(),
    area: tr.children[${ci('截面积')}].textContent.trim(),
    axis: tr.children[${ci('截面方向')}].textContent.trim(),
    len: tr.children[${ci('长度')}].textContent.trim(),
  })))`));
  check('展开后逐单元可见（§十）', unitRows.length === 9, `${unitRows.length} 行`);
  check('单元编号 S/G/I 三类分开（§十）',
    unitRows.filter(r => /^S\d/.test(r.id)).length === 3
    && unitRows.filter(r => /^G\d/.test(r.id)).length === 2
    && unitRows.filter(r => /^I\d/.test(r.id)).length === 4);
  const types = new Set(unitRows.map(r => r.type));
  check('★ 截面类型识别出来了（圆 / 矩形，§五）',
    types.has('圆形') && types.has('矩形'), [...types].join(','));
  check('截面尺寸给的是真实几何量（§五 A/B）',
    unitRows.some(r => /^⌀ 1[08](\.\d)? mm$/.test(r.dim)) && unitRows.some(r => /^20(\.\d)? × 15(\.\d)? mm$/.test(r.dim)),
    JSON.stringify(unitRows.map(r => r.dim)));

  // —— 3D：点详细信息里的单元 → 高亮对应组件（§十一） ——
  const before = await evalJs(`window.__view3d.meshGroup.children.map(m => m.material.color.getHexString()).join(',')`);
  await evalJs(`document.querySelector('#pi_gdetail .pi-gtable tbody tr').click()`); await wait(500);
  const picked = await evalJs(`(() => {
    const cs = window.__view3d.meshGroup.children;
    const on = cs.filter(m => m.material.emissive && m.material.emissive.getHex() !== 0);
    return on.length + '|' + on.map(m => m.userData.pickKey).join(',');
  })()`);
  check('★ 点详细信息里的 S1 → 3D 只高亮对应组件（§十一）',
    picked === '1|S1', picked);
  const afterColors = await evalJs(`window.__view3d.meshGroup.children.map(m => m.material.color.getHexString()).join(',')`);
  check('3D 场景确实变了（不是没反应）', afterColors !== before);
  const lit3d = await evalJs(`window.__view3d.meshGroup.children.length`);
  check('3D 里产品 + 冒口 + 9 个浇注系统单元同场景（§十一）',
    lit3d === 12, `${lit3d} 个对象`);
  await evalJs(`document.querySelector('#pi_gdetail .pi-gtable tbody tr').click()`); await wait(300);

  // —— 冒口检测不受影响 ——
  await evalJs(`document.querySelector('[data-pi-tab="riser"]').click()`); await wait(400);
  check('★ 切回冒口检测：卡片还在、结论还在（两个模块互不干扰）',
    (await evalJs(`document.querySelectorAll('#pi_result .pi-rcard').length`)) === 2);
  check('切回冒口检测：导入计数不变',
    (await evalJs(`['product','riser'].map(k => document.querySelector('#pi_n_' + k).textContent).join('/')`)) === '1/2');
  check('★ 切回冒口后，浇注系统的区块真的不显示', (await leak('riser')) === '', await leak('riser'));
  await evalJs(`document.querySelector('[data-pi-tab="gating"]').click()`); await wait(300);
  check('浇注系统结果切回来也还在',
    (await evalJs(`document.querySelectorAll('#pi_gres .pi-grow').length`)) === 3);

  /* ---------- ⑧-bis PHASE 95：浇注工艺计算（95.txt §四/§六/§七/§八） ---------- */
  console.log('\n[⑧-bis PHASE 95 浇注工艺计算]');
  // 工艺条件：三个控件都在，且材质选项覆盖 5 种材料（都有默认值 → 不动也能出结果）
  check('★ 工艺条件三个控件：材质 / 浇注系统类型 / 出品率（§七）',
    (await evalJs(`['#pi_gmat','#pi_gtype','#pi_gyield'].map(s => !!document.querySelector(s)).join(',')`)) === 'true,true,true');
  check('材质选项 = 5 种，默认灰铁（§七）',
    (await evalJs(`document.querySelector('#pi_gmat').options.length`)) === 5
    && (await evalJs(`document.querySelector('#pi_gmat').value`)) === '灰铁');
  // ⚠ PHASE 96 §十：这一项的显示名从「未指定」改成「自动」（值仍是 ''，语义一字未变）——
  //   "未指定"要用户猜"不指定会怎样"，"自动"直接说明"不选就不做速度判定"。
  check('浇注系统类型默认「自动」= 未指定（§八：不指定就不给速度判定标准）',
    (await evalJs(`document.querySelector('#pi_gtype').value`)) === ''
    && (await evalJs(`document.querySelector('#pi_gtype').selectedOptions[0].textContent.trim()`)) === '自动');
  check('出品率留空 = 用材质推荐值（占位符写着「默认」）',
    (await evalJs(`document.querySelector('#pi_gyield').value`)) === ''
    && (await evalJs(`document.querySelector('#pi_gyield').placeholder`)) === '默认');
  // 超范围值**不许静默回退默认值**（那样输入框写 150、结果按 75% 算，两个数对不上却不报错）
  await evalJs(`(() => { const i = document.querySelector('#pi_gyield'); i.value = '150'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(250);
  check('★ 出品率超范围 → 显式标红（不静默回退默认值）',
    (await evalJs(`document.querySelector('#pi_gyield').classList.contains('invalid')`)) === true);
  await evalJs(`(() => { const i = document.querySelector('#pi_gyield'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(250);
  check('清空出品率 → 标红解除，回落到默认',
    (await evalJs(`document.querySelector('#pi_gyield').classList.contains('invalid')`)) === false);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(400);

  // 核心结果四个格子：产品已导入 → 必须都有数（不是 —）
  const pour = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_gres .pi-pour-cell')].map(c => ({
    lab: c.querySelector('.pi-pour-lab').textContent.trim(),
    val: c.querySelector('b').textContent.trim(),
  })))`));
  check('★ 核心结果四个格子：浇注时间 / 总流量 / 内浇口总面积 / 平均内浇口速度（§四）',
    pour.length === 4
    && pour[0].lab === '浇注时间' && pour[1].lab === '总流量'
    && pour[2].lab === '内浇口总面积' && pour[3].lab === '平均内浇口速度',
    JSON.stringify(pour.map(p => p.lab)));
  check('★ 产品 + 内浇口都在 → 四个数都算得出来（不是 —）',
    pour.every(p => p.val !== '—' && Number.isFinite(parseFloat(p.val))), JSON.stringify(pour.map(p => p.val)));
  const pT = parseFloat(pour[0].val), pQ = parseFloat(pour[1].val), pA = parseFloat(pour[2].val), pV = parseFloat(pour[3].val);
  check('浇注时间 / 流量 / 速度都是正数', pT > 0 && pQ > 0 && pV > 0, `${pT} / ${pQ} / ${pV}`);
  // ★ 端到端恒等式：页面上显示的 v 必须就是 Q ÷ A（容差只留给两位显示取整）
  check('★ v = Q / A 在页面上也成立（§十三.9/10 的端到端形式）',
    Math.abs(pV - pQ / pA) < 0.02, `v=${pV} vs Q/A=${(pQ / pA).toFixed(4)}`);
  check('内浇口总面积那一格 = 主界面三类的内浇口总面积',
    Math.abs(pA - gsum[2].area) < 0.5, `${pA} vs ${gsum[2].area}`);

  // 未指定类型 → 必须明说"未启用速度判定标准"（§八）
  check('★ 未指定浇注系统类型时不伪造速度标准（§八）',
    (await evalJs(`document.querySelector('#pi_gres .pi-reslist')?.textContent || ''`))
      .includes('未启用对应工艺的速度判定标准'));
  // 选了封闭式 → 出现企业 R7 参考（≤1.5 m/s）
  await evalJs(`(() => { const s = document.querySelector('#pi_gtype'); s.value = '封闭'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(300);
  check('指定「封闭式」后开始检测（输入变了要重新点，PHASE 93 §六 纪律）',
    (await evalJs(`document.querySelector('#pi_grun').disabled`)) === false);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(400);
  check('★ 指定类型后才给企业 R7 参考（§八：有可靠参考才复用）',
    ((await evalJs(`document.querySelector('#pi_gres .pi-reslist')?.textContent || ''`)).includes('R7')
      || (await evalJs(`document.querySelector('#pi_gres .pi-reslist')?.textContent || ''`)).includes('企业经验审核参考')));

  // 换材质 → 浇注时间必须变（证明真的调了经典计算器，而不是写死的）
  await evalJs(`(() => { const s = document.querySelector('#pi_gmat'); s.value = '铸钢'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(300);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(400);
  const pT2 = parseFloat(await evalJs(`document.querySelectorAll('#pi_gres .pi-pour-cell b')[0].textContent`));
  check('★ 换材质 → 浇注时间随之改变（真的走的是 calc_t，不是写死的数）',
    Number.isFinite(pT2) && Math.abs(pT2 - pT) > 1e-6, `灰铁 ${pT}s → 铸钢 ${pT2}s`);
  await evalJs(`(() => { const s = document.querySelector('#pi_gmat'); s.value = '灰铁'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(300);
  // ⚠ 改工艺条件同样会作废上一次结论（PHASE 93 §六 纪律）→ 想看结果得重新点一次
  check('改材质会作废上一次结论，必须重新点检测（PHASE 93 §六 纪律）',
    (await evalJs(`document.querySelector('#pi_gres')?.textContent || ''`)).includes('点上方「开始检测」'));
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(400);
  // 面积比必须叫「检测截面积比」，并且页面里说清它不是标准浇注比（§九）
  check('★ 面积关系命名为「检测截面积比」并说明它不是标准浇注比（§九）',
    (await evalJs(`document.querySelector('#pi_gres .pi-gratio')?.textContent || ''`)).includes('检测截面积比')
    && (await evalJs(`document.querySelector('#pi_gres')?.textContent || ''`)).includes('它不是标准浇注比'));
  // 详情/工艺条件里不许出现被 95.txt §十 排除的东西
  const gtext = await evalJs(`document.querySelector('#pi_gres')?.textContent || ''`);
  check('不出现湍流 / 充型动画 / 压力计算这类本阶段不做的量（§十）',
    !/湍流|充型动画|压力计算|流场预测/.test(gtext));
  check('无未捕获异常（PHASE 95 段）', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

  /* ---------- ⑧-ter PHASE 96：浇注系统检测收口（96.txt §七/§八/§十/§十二） ---------- */
  console.log('\n[⑧-ter PHASE 96 浇注系统检测收口]');

  // —— ① 规格分组：夹具里是 4 个**一模一样**的 ⌀10 圆柱 → 主界面必须聚成**一行** ——
  const grp = JSON.parse(await evalJs(`JSON.stringify(
    [...document.querySelectorAll('#pi_gres .pi-grow')].map(r => ({
      name: r.querySelector('.pi-gname')?.textContent.trim(),
      groups: [...r.querySelectorAll('.pi-ggrp')].map(g => ({
        dim: g.querySelector('.pi-ggdim')?.textContent.trim(),
        n: g.querySelector('.pi-ggn')?.textContent.trim(),
        unit: parseFloat(g.querySelector('.pi-ggunit b')?.textContent || 'NaN'),
        sum: parseFloat(g.querySelector('.pi-ggsum b')?.textContent || 'NaN'),
      })),
    })))`));
  const ingRow = grp.find(g => g.name === '内浇口');
  check('★ 96 §七：4 个相同内浇口聚成**一行**规格（不是 4 行一样的）',
    !!ingRow && ingRow.groups.length === 1 && ingRow.groups[0].n === '× 4',
    JSON.stringify(ingRow));
  check('★ 96 §七：规格行给「尺寸 × 数量 + 单个面积 + 小计」',
    !!ingRow && /⌀\s*1[01](\.\d)?\s*mm/.test(ingRow.groups[0].dim)
    && ingRow.groups[0].unit > 0 && ingRow.groups[0].sum > 0,
    JSON.stringify(ingRow?.groups[0]));
  check('★ 96 §八：小计 = 单个面积 × 数量 的实测和（不是拿规格尺寸重算）',
    !!ingRow && Math.abs(ingRow.groups[0].sum - ingRow.groups[0].unit * 4) / ingRow.groups[0].sum < 0.02,
    JSON.stringify(ingRow?.groups[0]));

  // —— ② 参数来源徽标（96.txt §十二/§十五：不要让用户猜这个数字从哪来） ——
  //   ⚠ 显隐要用 getComputedStyle 核验：内容在不在 ≠ 显不显示（交接书 §5.3-11 的坑）
  const srcBadges = JSON.parse(await evalJs(`JSON.stringify(['pi_gmatSrc','pi_gtypeSrc','pi_gyieldSrc']
    .map(id => { const el = document.getElementById(id);
      return { id, text: (el?.textContent || '').trim(), shown: !!el && getComputedStyle(el).display !== 'none' }; }))`));
  check('★ 96 §十五：材质 / 浇注系统类型 / 出品率各自标出来源',
    srcBadges.every(b => b.shown && b.text.length > 0), JSON.stringify(srcBadges));
  check('★ 96 §十五：出品率来源写明用的是哪个默认值（不是干巴巴一个"默认"）',
    /默认值\s*\d+(\.\d+)?%/.test(srcBadges.find(b => b.id === 'pi_gyieldSrc').text),
    srcBadges.find(b => b.id === 'pi_gyieldSrc').text);

  // —— ③ 浇注系统类型：默认「自动」= 不做速度判定；选了才拿企业 R7 参考比 ——
  check('★ 96 §十：类型下拉的第一项是「自动」（不是"未指定"这种要用户猜的词）',
    (await evalJs(`document.querySelector('#pi_gtype option')?.textContent.trim()`)) === '自动');
  await evalJs(`document.querySelector('#pi_gtype').value = ''; document.querySelector('#pi_gtype').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(250);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(500);
  const noTypeTxt = await evalJs(`document.querySelector('#pi_gres')?.textContent || ''`);
  check('★ 96 §十：没选类型 → 明说"未启用对应工艺的速度判定标准"，也不给任何超限结论',
    noTypeTxt.includes('未启用对应工艺的速度判定标准') && !/高于「/.test(noTypeTxt));
  await evalJs(`document.querySelector('#pi_gtype').value = '封闭'; document.querySelector('#pi_gtype').dispatchEvent(new Event('change',{bubbles:true}))`);
  await wait(250);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(500);
  const typedTxt = await evalJs(`document.querySelector('#pi_gres')?.textContent || ''`);
  check('★ 96 §十：选了类型 → 结论写成「企业 R7 参考值」，不得写成"行业标准"',
    /企业 R7 参考值/.test(typedTxt) && !/行业标准/.test(typedTxt));
  const resRows = JSON.parse(await evalJs(`JSON.stringify(
    [...document.querySelectorAll('#pi_gres .pi-reslist .pi-resrow')].map(r => r.textContent.replace(/\\s+/g,' ').trim()))`));
  const cmpRow = resRows.find(t => /平均内浇口速度/.test(t));
  const sugRow = resRows.find(t => /^建议/.test(t));
  check('★ 96 §十七：比较结果单独一条、建议单独一条（四层不混在一句里）',
    !!cmpRow && !/建议/.test(cmpRow) && (!sugRow || sugRow === '建议：优先检查内浇口总面积、内浇口数量以及目标浇注时间。'),
    JSON.stringify({ cmpRow, sugRow }));

  // —— ④ 详情的「截面方向」列：每个单元都要如实给出它切的是哪条轴 ——
  await evalJs(`document.querySelector('#pi_gdetailSec').open = true`); await wait(300);
  const axes = JSON.parse(await evalJs(`JSON.stringify([...document.querySelectorAll('#pi_gdetail .pi-gtable tbody tr')]
    .map(tr => tr.children[4].textContent.trim()))`));
  check('★ 96 §六：详细表逐单元给出「截面方向」（截面是按哪条轴切的，不再是个隐藏假设）',
    axes.length > 0 && axes.every(a => /^[XYZ]$/.test(a)), JSON.stringify(axes.slice(0, 6)));

  // —— ⑤ 生产场景 → 工艺检测中心（96.txt §十一/§十二 的端到端形式） ——
  //   真实数据源：生产场景 = localStorage['ct-context']（材质），
  //   设计中心项目 = localStorage['ct-project']（出品率 material.yieldSug / 比例预设 process.ratioKey）。
  //   这里直接写这两份存储，再整页重载 —— 走的就是用户从设计中心过来的那条路。
  await evalJs(`(() => {
    localStorage.setItem('ct-context', JSON.stringify({ material: '球铁', line: '水平线' }));
    localStorage.setItem('ct-project', JSON.stringify({
      material: { yieldSug: { v: 78, src: 'USER_OVERRIDE', conf: 'user_confirmed', editable: true } },
      process: { ratioKey: { v: '开放式 标准型', src: 'USER_OVERRIDE', conf: 'user_confirmed', editable: true } },
    }));
    return true;
  })()`);
  await send('Page.navigate', { url: URL });
  await wait(2500);
  await goto('#/inspection');
  await evalJs(`document.querySelector('[data-pi-tab="gating"]').click()`); await wait(400);
  const inherited = JSON.parse(await evalJs(`JSON.stringify({
    mat: document.querySelector('#pi_gmat')?.value,
    type: document.querySelector('#pi_gtype')?.value,
    yld: document.querySelector('#pi_gyield')?.value,
    matSrc: document.querySelector('#pi_gmatSrc')?.textContent.trim(),
    typeSrc: document.querySelector('#pi_gtypeSrc')?.textContent.trim(),
    yldSrc: document.querySelector('#pi_gyieldSrc')?.textContent.trim(),
  })`));
  check('★ 96 §十二：生产场景的材质自动带入（球铁）+ 标明来源',
    inherited.mat === '球铁' && inherited.matSrc === '生产场景', JSON.stringify(inherited));
  check('★ 96 §十二：设计中心的浇注比例预设 → 自动带入浇注系统类型（开放式）',
    inherited.type === '开放' && inherited.typeSrc === '生产场景', JSON.stringify(inherited));
  check('★ 96 §十二：设计中心的出品率自动带入（78%）+ 标明来源',
    inherited.yld === '78' && inherited.yldSrc === '生产场景', JSON.stringify(inherited));
  // 用户手动改一项 → 该项来源变成"本次设置"，另两项仍是"生产场景"（§十三 优先级逐项独立）
  await evalJs(`(() => { const s = document.querySelector('#pi_gmat'); s.value = '铸钢'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(300);
  const after = JSON.parse(await evalJs(`JSON.stringify({
    mat: document.querySelector('#pi_gmat')?.value,
    matSrc: document.querySelector('#pi_gmatSrc')?.textContent.trim(),
    typeSrc: document.querySelector('#pi_gtypeSrc')?.textContent.trim(),
  })`));
  check('★ 96 §十三：本次手动改的项标「本次设置」，没改的项仍是「生产场景」',
    after.mat === '铸钢' && after.matSrc === '本次设置' && after.typeSrc === '生产场景', JSON.stringify(after));
  // 只读不写：检测中心里改参数**不得**回写生产场景（§十二末段）
  const ctxAfter = JSON.parse(await evalJs(`localStorage.getItem('ct-context')`));
  check('★ 96 §十二：检测中心只读生产场景，绝不反向写回', ctxAfter.material === '球铁', JSON.stringify(ctxAfter));
  // 清掉场景，免得污染后面的用例
  await evalJs(`(() => { localStorage.removeItem('ct-context'); localStorage.removeItem('ct-project'); return true; })()`);

  check('无未捕获异常（PHASE 96 段）', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

  /* ---------- ⑧-quater PHASE 97：内浇口方向由连接面确定（97.txt §四~§十） ---------- */
  console.log('\n[⑧-quater PHASE 97 内浇口连接面定向]');
  // 造一个**贴在产品顶面上**的短宽内浇口：连接截面 20×5、充型路程 12（< 宽 20）
  //   —— 这正是 PHASE 96 会取最长主轴、算成 12×5 = 60 的那个典型误判。
  // ⚠⚠ 上一段（生产场景）**整页重载**过 —— 页面内存里的导入状态全没了
  //   （产品 / 直横内三类都不在），window.__m 也没了。
  //   所以这里必须**重新导入产品**并**自己造**内浇口夹具，不能假设前面导过的东西还在
  //   （本窗口在 PHASE 94 就因为这类"以为还在"白折腾过）。
  const n97 = await buildModels();                       // 重新生成产品（顶面 y=0）
  check('PHASE 97 段：整页重载后重新生成产品模型', n97 === 3, `${n97} 个`);
  await goto('#/inspection');
  await evalJs(`document.querySelector('[data-pi-tab="gating"]').click()`); await wait(500);
  await dropFile('product', 'product', 'product.stl');
  await waitFor(`document.querySelector('#pi_n_product')?.textContent === '1'`, 60000);
  await wait(500);
  await evalJs(`(async () => {
    const g = await import('/tests/helpers/stlGen.js');
    const d = 0.3179;
    // 内浇口坐在产品顶面 x∈[0,20]、z∈[0,5]、y∈[0,12]（连接截面 20×5、充型路程 12）
    window.__ing97 = g.genSTL(g.BOX([0, 0, 0], [20, 12, 5]),
      [[-8+d, -8+2*d, -8+3*d], [28+d, 20+2*d, 13+3*d]], 96);
    return true;
  })()`, true);
  // 清掉原来的 4 个圆柱内浇口，换成这一个
  await evalJs(`document.querySelector('[data-clear="ingate"]')?.click()`); await wait(500);
  await evalJs(`(() => {
    const input = document.querySelector('[data-file="ingate"]');
    const dt = new DataTransfer();
    dt.items.add(new File([window.__ing97], 'ingate1.stl', { type: 'model/stl' }));
    input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true;
  })()`);
  await waitFor(`document.querySelector('#pi_n_ingate')?.textContent === '1'`, 30000);
  await wait(600);
  await evalJs(`document.querySelector('#pi_grun').click()`); await wait(900);
  const p97 = JSON.parse(await evalJs(`JSON.stringify({
    rows: [...document.querySelectorAll('#pi_gdetail .pi-gtable tbody tr')].map(tr => ({
      id: tr.children[0].textContent.trim(),
      dim: tr.children[2].textContent.trim(),
      area: tr.children[3].textContent.trim(),
      axis: tr.children[4].textContent.trim(),
      src: tr.children[5].textContent.trim(),
    })),
    total: document.querySelector('.pi-gtotal b')?.textContent,
    conn: document.querySelector('#pi_gres .pi-gconn')?.textContent.trim() || '',
    group: [...document.querySelectorAll('#pi_gres .pi-ggrp')].map(g => g.textContent.replace(/\\s+/g,' ').trim()),
  })`));
  check('★ 97 §七：贴在产品上的内浇口，方向由连接面确定（详情表「方向来源」写出来源）',
    p97.rows.length === 1 && /连接面/.test(p97.rows[0].src), JSON.stringify(p97.rows));
  check('★ 97 §十四.C：短宽内浇口按连接面切 → 截面 20 × 5、面积 ≈100（不是 12 × 5 = 60）',
    /^20(\.\d)? × 5(\.\d)? mm$/.test(p97.rows[0].dim) && Math.abs(parseFloat(p97.rows[0].area) - 100) < 5,
    JSON.stringify(p97.rows[0]));
  check('★ 97 §八：主界面标出"截面方向由连接面确定"',
    /由连接面确定/.test(p97.conn), p97.conn);
  check('★ 97 §七/§十四：规格行按连接面方向显示 20 × 5、单个面积 ≈100',
    p97.group.length === 1 && /20(\.\d)? × 5/.test(p97.group[0]) && /100/.test(p97.group[0]),
    JSON.stringify(p97.group));

  // 断开连接（清掉产品）→ 必须退回 PHASE 96 主轴约定，且**仍然给得出面积**（§八.3 / §十四.F）
  await evalJs(`document.querySelector('[data-clear-shared="product"]')?.click()`); await wait(700);
  await evalJs(`document.querySelector('#pi_grun')?.click()`); await wait(900);
  const p97b = JSON.parse(await evalJs(`JSON.stringify({
    total: document.querySelector('.pi-gtotal b')?.textContent,
    src: document.querySelector('#pi_gdetail .pi-gtable tbody tr')?.children[5].textContent.trim() || '',
  })`));
  check('★ 97 §十四.F：没有产品（无连接信息）时退回主轴约定，且仍给得出面积（不整片失败）',
    p97b.total && p97b.total !== '—' && /主轴/.test(p97b.src), JSON.stringify(p97b));

  check('无未捕获异常（PHASE 97 段）', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

  /* ---------- ⑨ 控制台 ---------- */
  console.log('\n[⑨ 控制台]');
  check('无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

  console.log(`\n结果：${failures === 0 ? '全部通过 ✅' : failures + ' 项失败 ❌'}`);
} catch (e) {
  console.error('\n💥 测试异常:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
  failures++;
} finally {
  try { ws?.close(); } catch (e) {}
  edge.kill();
  server?.kill();
  await wait(500);
  process.exit(failures ? 1 : 0);
}
