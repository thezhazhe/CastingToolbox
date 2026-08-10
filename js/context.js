// ============================================================
// Current Context（生产场景共享）
// 跨计算器 / 搜索 / 工艺卡片共享的"大信息"：材料 / 造型线 / 生产方式 / 铸造方法。
// 向导完成后自动保存；计算器优先读取预填（无匹配仍可手输，不破坏现有功能）。
// 纯本地 localStorage 持久化，数据不落任何 JSON。
// ============================================================
const KEY = 'ct-context';
let ctx = {};
try { ctx = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { ctx = {}; }
const LISTENERS = new Set();

export function get() { return ctx; }
export function set(partial) { ctx = { ...ctx, ...partial }; save(); notify(); }
export function clear() { ctx = {}; save(); notify(); }
export function onChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }
function notify() { LISTENERS.forEach(fn => fn(ctx)); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(ctx)); } catch (e) {} }

/* ---- 材料文档 id → 材质族（HT/QT/ZG/ZL/ZCu 前缀） ---- */
export function familyOfDoc(docId) {
  const id = String(docId || '');
  if (id.startsWith('HT')) return '灰铁';
  if (id.startsWith('QT')) return '球铁';
  if (id.startsWith('ZG')) return '铸钢';
  if (id.startsWith('ZL')) return '铝合金';
  if (id.startsWith('ZCu')) return '铜合金';
  return '';
}

/* ---- 工况材料按"大类"（工厂不做单一牌号）：灰铁/球铁/铸钢/铝合金/铜合金 ---- */
export const FAMILIES = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];

/** 工况材料值 → 材质族（值即大类则直接用；兼容旧数据存的牌号 doc id） */
export function familyOf(value) {
  const v = String(value || '');
  if (FAMILIES.includes(v)) return v;
  return familyOfDoc(v);
}

/* ---- 各计算器材质下拉的写法不一（灰铁(HT)/灰铸铁(HT)…），用家族子串覆盖 ---- */
const FAM_SUBSTR = {
  灰铁:   ['灰铁', '灰铸'],
  球铁:   ['球铁', '球墨'],
  铸钢:   ['铸钢'],
  铝合金: ['铝合金', '铝'],
  铜合金: ['铜合金', '铜'],
};

/** 按生产场景材料，预选计算器的材质下拉（无匹配则不动，保留手输） */
export function prefillMaterial(container, selectId) {
  const docId = ctx.material;
  if (!docId) return;
  const fam = familyOf(docId);
  const subs = FAM_SUBSTR[fam];
  if (!subs) return;
  const sel = container.querySelector(selectId);
  if (!sel) return;
  const hit = [...sel.options].find(o =>
    subs.some(s => (o.text || '').includes(s) || (o.value || '').includes(s)));
  if (hit) sel.value = hit.value;
}

/** 按关键词预选一个下拉（选项文本或值含任一关键词即命中；返回是否命中） */
export function prefillSelect(container, selectId, keywords) {
  const sel = container.querySelector(selectId);
  if (!sel || !keywords || !keywords.length) return false;
  const keys = keywords.filter(Boolean);
  const hit = [...sel.options].find(o =>
    keys.some(k => (o.text || '').includes(k) || (o.value || '').includes(k)));
  if (hit) { sel.value = hit.value; return true; }
  return false;
}

/** 是否有任一工况维度 */
export function hasAny() { return !!(ctx.material || ctx.line || ctx.prod || ctx.method); }

/** 生产场景是否为某条文档的"匹配"（标签过滤用；tags 见 data/tags.js） */
export function matchesContext(docId, tags) {
  const list = tags || [];
  const set = new Set(list);
  if (ctx.material) {
    const fam = familyOf(ctx.material);
    if (fam && set.has('mat:' + fam)) return true;
  }
  if (ctx.line && set.has('line:' + ctx.line)) return true;
  if (ctx.prod && set.has('prod:' + ctx.prod)) return true;
  if (ctx.method && set.has('method:' + ctx.method)) return true;
  return false;
}

/* ---- 顶栏工况条 ---- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderContextBar() {
  const bar = document.getElementById('ctxBar');
  if (!bar) return;
  const chips = [];
  if (ctx.material) chips.push(['材料', ctx.material]);
  if (ctx.line) chips.push(['造型线', ctx.line]);
  if (ctx.prod) chips.push(['生产', ctx.prod]);
  if (ctx.method) chips.push(['方法', ctx.method]);
  bar.hidden = chips.length === 0;
  const el = document.getElementById('ctxChips');
  if (el) el.innerHTML = chips.map(([k, v]) => `<span class="chip ctx-chip">${esc(k)}：${esc(v)}</span>`).join('');
}

/* ---- 材料下拉（首页面板 / 编辑弹窗共用）：按大类选，不做单一牌号 ---- */
export function populateMaterialSelect(sel) {
  sel.innerHTML = '<option value="">不指定</option>'
    + FAMILIES.map(f => `<option value="${f}">${f}</option>`).join('');
}

/* ---- 编辑弹窗 ---- */
export async function openContextModal() {
  const m = document.getElementById('ctxModal');
  if (!m) return;
  m.hidden = false;
  const sel = document.getElementById('ctxMaterial');
  if (sel && sel.options.length <= 1) await populateMaterialSelect(sel);   // 材料列表懒加载一次
  document.getElementById('ctxMaterial').value = ctx.material || '';
  document.getElementById('ctxLine').value = ctx.line || '';
  document.getElementById('ctxProd').value = ctx.prod || '';
  document.getElementById('ctxMethod').value = ctx.method || '';
}

export function saveContextModal() {
  const val = (id) => document.getElementById(id).value || null;
  set({
    material: val('ctxMaterial'),
    line: val('ctxLine'),
    prod: val('ctxProd'),
    method: val('ctxMethod'),
  });
  document.getElementById('ctxModal').hidden = true;
}
