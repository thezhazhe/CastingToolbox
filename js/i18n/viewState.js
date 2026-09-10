// ============================================================
// PHASE 72 · 语言切换时的"视图状态保全"（80.txt §十八硬性要求）
//
// 问题：视图文案在 render 时用 t() 取值，切换语言必须重渲染才能变英文；
//   而计算器视图的**用户输入存在 DOM 里**，重渲染会丢。
// 做法（切换语言时）：
//   ① 快照 #view 内所有表单控件的值 / 勾选态 / 是否有"示例"标
//   ② 重渲染当前视图（文案变英文；设计中心那类从 CastingProject 读值的按模型自然恢复）
//   ③ 快照值写回（结构未变：按 id 优先、否则同标签序位匹配）
//   ④ 调该视图注册的重算钩子 → 结果区用英文重生成；数值是同参数纯函数重算，
//      与切换前**完全一致**（计算链路、项目数据、localStorage 一律未动）
//
// 关键取舍：
//   · **不回放 input/change 事件**——回放会把"重渲染"误当成"用户改过"
//     （示例标被清、设计中心 select 触发整组重渲）。重算只走显式注册的钩子。
//   · 未声明支持换语言的视图（非核心工具）**不重渲染**，整页保持原状，
//     只有外壳/导航变英文——符合 80.txt §十七。
// ============================================================
import { suppressExampleTags } from '../views/exampleTag.js';

let recomputeHook = null;
let relocalizable = false;

/** 视图注册"重新计算结果区"的函数（只重算显示，不得改动用户输入） */
export function setRecompute(fn) {
  recomputeHook = typeof fn === 'function' ? fn : null;
  if (recomputeHook) relocalizable = true;
}
/** 视图声明支持原地换语言（设计中心：结果从模型/内存态重建，无需额外钩子） */
export function markRelocalizable(v = true) { relocalizable = v; }
export function isRelocalizable() { return relocalizable; }

/** 每次进入视图前由 app.js 复位（避免上一次视图的钩子/标志残留） */
export function resetViewHooks() { recomputeHook = null; relocalizable = false; }

/** 调用当前视图的重算钩子（无钩子 → 返回 false，不报错） */
export function runRecompute() {
  if (!recomputeHook) return false;
  try { recomputeHook(); return true; } catch (e) { console.error('[i18n] 重算失败:', e); return false; }
}

/* ---- 表单快照 ---- */
const CTRL = 'input, select, textarea';

/** 快照 root 内表单状态 → {items, hasExampleTag} */
export function captureForm(root) {
  if (!root?.querySelectorAll) return { items: [], hasExampleTag: false };
  const items = [];
  root.querySelectorAll(CTRL).forEach(el => {
    const isCheck = el.type === 'checkbox' || el.type === 'radio';
    items.push({
      id: el.id || '', tag: el.tagName,
      value: isCheck ? null : el.value,
      checked: !!el.checked,
    });
  });
  return { items, hasExampleTag: !!root.querySelector('.tag-example') };
}

/** 快照写回（只写值，不派发事件）；返回成功写回的控件数 */
export function restoreForm(root, snap) {
  if (!root?.querySelectorAll || !snap?.items?.length) return 0;
  const all = [...root.querySelectorAll(CTRL)];
  const byId = new Map();
  all.forEach(el => { if (el.id && !byId.has(el.id)) byId.set(el.id, el); });
  const byPos = new Map();
  const seq = new Map();
  all.forEach(el => {
    const n = seq.get(el.tagName) || 0;
    seq.set(el.tagName, n + 1);
    byPos.set(`${el.tagName}|${n}`, el);
  });
  const pos = new Map();
  let n = 0;
  for (const it of snap.items) {
    const p = pos.get(it.tag) || 0;
    pos.set(it.tag, p + 1);
    const el = (it.id && byId.get(it.id)) || byPos.get(`${it.tag}|${p}`);
    if (!el) continue;
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked !== it.checked) el.checked = it.checked;
    } else if (it.value !== null && el.value !== it.value) {
      el.value = it.value;
    }
    n++;
  }
  return n;
}

/**
 * 语言切换时的整视图换语言：快照 → 重渲染 → 还原 → 重算。
 * @param {HTMLElement} root 视图容器（#view）
 * @param {() => void} rerender 重新渲染当前视图（app.js 的 render）
 * @returns {boolean} 是否执行了重渲染（false = 当前视图不支持换语言，保持原状）
 */
export function relocalizeView(root, rerender) {
  if (!relocalizable) return false;
  const snap = captureForm(root);
  // 用户已改动过（示例标已消失）→ 重渲染时不再生成示例标，观感与切换前一致
  suppressExampleTags(!snap.hasExampleTag);
  try { rerender(); } finally { suppressExampleTags(false); }
  restoreForm(root, snap);
  runRecompute();     // 用**新视图**注册的钩子重算（渲染时已重新注册）
  return true;
}
