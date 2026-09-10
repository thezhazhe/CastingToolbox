// ============================================================
// PHASE 73 · 英文界面 DOM 残留审计（浏览器侧，真渲染结果）
//
// 为什么需要它：`scripts/i18n_audit.mjs` 只做"源码字面量 → 词条表"的静态查表，
//   有三个盲区（PHASE 73 审计实测）：
//     ① 范围：只扫 import 了 i18n 的文件 → 整块中文组件（nextSteps/exampleTag）看不见
//     ② 语法：只匹配单引号字面量 → 变量 key / 模板串看不见
//     ③ 语义：不校验"DOM 里到底渲染出什么" → 码点不匹配（'✅ 推荐' vs '✓ 推荐'）、
//        忘包 t()、读错字段（srcLabel → undefined）全都发现不了
//   本脚本在真实浏览器里切到 English 逐页扫可见文本 + 占位符/title/aria + option，
//   按"是否落在允许保留区"分类，输出遗漏清单与 undefined 泄漏。
//
// 用法: node scripts/browser_i18n_audit.mjs        （退出码 0=干净 1=有遗漏）
// ============================================================
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9265;
const URL = process.env.CT_URL || 'http://localhost:8090/';   // 可用 CT_URL 指向已封装产物（如 EXE 起的 8091）做端到端验收
const PROFILE = path.join(ROOT, '_edge_profile_i18naudit');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try { rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}

let server = null;
try { const r = await fetch(URL); if (!r.ok) throw new Error('x'); }
catch (e) { server = spawn(process.execPath, ['serve.js'], { cwd: ROOT, stdio: 'ignore' }); }
for (let i = 0; i < 40; i++) { try { const r = await fetch(URL); if (r.ok) break; } catch (e) {} await wait(250); }

const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--disable-gpu', '--no-first-run', '--window-size=1400,1000', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); if (r.ok) { const p = (await r.json()).find(t => t.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } } catch (e) {}
  await wait(200);
}
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map(); const exceptions = [];
const send = (method, params = {}) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })); });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    const desc = d.exception?.description || '';
    exceptions.push((desc.split(/\r?\n/).slice(0, 2).join(' | ') || d.text));
  }
};
await new Promise(r => (ws.onopen = r));
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

/* 允许保留中文的区域（PHASE 72 §5 声明 + PHASE 73 确认）——用选择器表达 */
const ALLOW_SELECTORS = [
  '.sf-about',            // 侧栏作者署名 / 邮箱 / QQ 群
  '.donate-author',       // 捐助页署名
  '.kb-item', '.kb-list', '.kb-item-title', '.kb-item-meta', '.kb-item-summary',   // 知识库卡片
  '.eng-note',            // 计算器"工程参考/原则"长正文（已翻译，此处兜底）
  '.p72-cn',              // ★ 明确声明"保持中文"的节点：计算器生成的建议条目/数据层公式/依据串
  '#langSwitch',          // 语言切换器：语言名按其母语显示（中文 / English）+ 中英并列 title
  '.rf',                  // 结果行的"依据/公式"注脚位（内容来自 calcs 数据层公式串）
  '.suggestion',          // 浇注系统判定条目（随数值实时生成的中文模板）
  '.dc-result-sec > .dc-p1-bline',  // 结果页里由计算器生成的建议条目（与卡片内已译说明区分）
  '#g_results',           // 浇注系统"详细信息"折叠区（完整计算过程/查表正文）
];

/* 核心页（必须全英文）与已声明不译页（整页中文，PHASE 72 §十七） */
const CORE_ROUTES = /^(home|calculators|donate|modal:|designCenter:|calc:(gating|riser|shrinkage|machining|yield)$)/;

/* 扫描函数：注入页面执行，返回 [{text, attr, path, allowed}] */
const SCAN_FN = `(() => {
  const ALLOW = ${JSON.stringify(ALLOW_SELECTORS)};
  const CJK = /[\\u4e00-\\u9fff]/;
  const ALLOW_TEXT = ['感谢每一天的生活'];   // 作者署名（专有名词，两种语言下都不译）
  const out = [];
  const pathOf = (el) => {
    const parts = [];
    let n = el, depth = 0;
    while (n && n.nodeType === 1 && depth < 6) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (n.className && typeof n.className === 'string') s += '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.');
      parts.unshift(s); n = n.parentElement; depth++;
    }
    return parts.join(' > ');
  };
  const allowed = (el) => {
    for (const sel of ALLOW) { try { if (el.closest(sel)) return true; } catch (e) {} }
    return false;
  };
  const push = (el, text, attr) => {
    const t = String(text || '').replace(/\\s+/g, ' ').trim();
    if (!t || !CJK.test(t)) return;
    if (ALLOW_TEXT.some(x => t.includes(x))) return;
    out.push({ text: t.slice(0, 120), attr, path: pathOf(el), allowed: allowed(el) });
  };
  // 可见文本节点
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el) continue;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE') continue;
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed' && tag !== 'OPTION') continue;
    push(el, node.nodeValue, 'text');
  }
  // 属性 + option + 按钮 value
  for (const el of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')) {
    for (const a of ['placeholder', 'title', 'aria-label', 'alt']) {
      const v = el.getAttribute(a);
      if (v) push(el, v, a);
    }
  }
  for (const o of document.querySelectorAll('option')) push(o, o.textContent, 'option');
  for (const b of document.querySelectorAll('input[type=button],input[type=submit]')) push(b, b.value, 'value');
  return out;
})()`;

const collect = async (label) => {
  const items = (await evalJs(SCAN_FN)) || [];
  const bad = items.filter(i => !i.allowed);
  const dup = new Set();
  const uniq = bad.filter(i => { const k = i.text + '|' + i.path; if (dup.has(k)) return false; dup.add(k); return true; });
  return { label, allowed: items.filter(i => i.allowed).length, bad: uniq };
};

const switchEn = async () => { await evalJs(`document.querySelector('.lang-btn[data-lang="en-US"]')?.click()`); await wait(800); };
const goto = async (hash) => { await evalJs(`location.hash = '${hash}'`); await wait(1100); };

const results = [];
const UNDEF = [];
try {
  await send('Page.navigate', { url: URL });
  await wait(1600);
  await evalJs(`localStorage.removeItem('ct-project'); localStorage.removeItem('ct-context');`);
  await send('Page.reload', {}); await wait(1600);
  await switchEn();

  results.push(await collect('home'));

  // 弹窗
  await evalJs(`document.getElementById('btnAbout')?.click()`); await wait(400);
  results.push(await collect('modal:about'));
  await evalJs(`document.getElementById('aboutModal').hidden = true`);
  await evalJs(`document.getElementById('btnSource')?.click()`); await wait(400);
  results.push(await collect('modal:feedback'));
  await evalJs(`document.getElementById('feedbackModal').hidden = true`);
  await evalJs(`document.getElementById('ctxEdit')?.click()`); await wait(500);
  results.push(await collect('modal:ctx'));
  await evalJs(`document.getElementById('ctxModal').hidden = true`);

  results.push(await (async () => { await goto('#/calculators'); return collect('calculators'); })());
  results.push(await (async () => { await goto('#/donate'); return collect('donate'); })());

  // 核心计算器 + 其余工具（非核心工具整页中文属声明范围，单独统计）
  const CALCS = ['gating', 'riser', 'shrinkage', 'machining', 'yield', 'chill', 'ct', 'charge', 'sandbox', 'shakeout', 'castability', 'defect_finder', 'campbell_gating', 'vertical_gating', 'principles'];
  for (const c of CALCS) {
    await goto('#/calculators/' + c);
    results.push(await collect('calc:' + c));
  }

  // 设计中心：手动模式全链
  await goto('#/designCenter');
  await evalJs(`document.querySelector('#dc_manualLink')?.click()`); await wait(500);
  const q = await evalJs(`(() => { const el = document.querySelector('#dc_m_family'); return !!el; })()`);
  if (q) {
    await evalJs(`(() => { const el = document.querySelector('#dc_m_family'); const p = HTMLSelectElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'灰铁'); el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await wait(400);
    await evalJs(`(() => { const el = document.querySelector('#dc_p_volume'); const p = HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'900'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await evalJs(`(() => { const el = document.querySelector('#dc_p_wallMain'); const p = HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'22'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await evalJs(`(() => { const el = document.querySelector('#dc_m_mc'); const p = HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(el,'13'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await wait(700);
    await evalJs(`document.querySelector('#dc_run')?.click()`); await wait(2500);
    results.push(await collect('designCenter:params'));
    for (const nav of ['page1', 'riser', 'gating']) {
      await evalJs(`document.querySelector('#dc_resultNav [data-nav="${nav}"]')?.click()`); await wait(700);
      results.push(await collect('designCenter:' + nav));
    }
  }

  // undefined / null / NaN 泄漏（全站，含中文态也算问题）
  await goto('#/calculators/vertical_gating');
  const leak = await evalJs(`(() => {
    const txt = document.body.innerText;
    return { undef: (txt.match(/undefined/g) || []).length, nan: (txt.match(/\\bNaN\\b/g) || []).length, obj: (txt.match(/\\[object Object\\]/g) || []).length };
  })()`);
  UNDEF.push({ where: 'vertical_gating', ...leak });
} catch (e) {
  console.error('审计脚本异常：', e.message);
} finally {
  /* ---- 报告 ---- */
  let bad = 0, declared = 0;
  const lines = [];
  lines.push('\n══ PHASE 73 · 英文界面 DOM 残留审计 ══\n');
  for (const r of results) {
    const isCore = CORE_ROUTES.test(r.label);
    if (!isCore) { declared += r.bad.length; continue; }          // 已声明不译页：只计数
    if (!r.bad.length) { lines.push(`  ✓ ${r.label.padEnd(26)} 干净（放行 ${r.allowed} 处）`); continue; }
    bad += r.bad.length;
    lines.push(`  ✗ ${r.label.padEnd(26)} ${r.bad.length} 处遗漏（放行 ${r.allowed} 处）`);
    for (const b of r.bad) lines.push(`      [${b.attr}] ${b.text}\n        @ ${b.path}`);
  }
  const leaks = UNDEF.filter(u => u.undef || u.nan || u.obj);
  lines.push('\n  undefined / NaN / [object Object] 泄漏：' + (leaks.length ? JSON.stringify(leaks) : '无 ✅'));
  lines.push('  运行时异常：' + (exceptions.length ? exceptions.join('; ') : '无 ✅'));
  lines.push(`  （已声明不译页面的中文条目：${declared} 处，不计入失败——非核心工具整页中文，PHASE 72 §十七）`);
  lines.push(`\n结论：${bad === 0 && !leaks.length && !exceptions.length ? '核心页英文界面无遗漏 ✅' : `核心页仍有 ${bad} 处文本遗漏`}`);
  console.log(lines.join('\n'));
  try { ws?.close(); } catch (e) {}
  edge.kill(); server?.kill();
  process.exit(bad === 0 && !leaks.length ? 0 : 1);
}
