// ============================================================
// 数字输入检查（PHASE 63 · P0-1）
// 纯逻辑、无 DOM —— 可被 node 单测直接引用。
// 原则：空/≤边界/NaN/±Infinity/非数字 → 返回明确短提示（不静默换算）；
//       "默认值"只允许作为初始示例值，不允许成为非法输入的兜底。
// ============================================================

/**
 * 检查一个数字输入。
 * @param {*} raw 输入框原始值（string/number/null/undefined）
 * @param {{label:string, gt?:number, min?:number, max?:number, int?:boolean, required?:boolean}} o
 *   gt: 必须 > gt（如 gt:0 → 需 >0，0 即非法）
 *   min/max: 含边界闭区间（如 min:0 → 0 合法）
 *   int: 必须整数；required: 空串视为非法
 * @returns {string|null} null=通过，否则错误短文案
 */
export function checkNum(raw, { label = '数值', gt, min, max, int = false, required = false } = {}) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  if (s === '') return required ? `${label} 不能为空` : null;
  const v = Number(s);
  if (!Number.isFinite(v)) return `${label} 需为有效数字`;
  if (gt !== undefined && !(v > gt)) return `${label} 需大于 ${gt}`;
  if (min !== undefined && v < min) return `${label} 需 ≥ ${min}`;
  if (max !== undefined && v > max) return `${label} 需 ≤ ${max}`;
  if (int && !Number.isInteger(v)) return `${label} 需为整数`;
  return null;
}

/** 一组检查里取第一个错误；全过返回 null */
export function firstErr(checks) {
  for (const c of checks) if (c) return c;
  return null;
}

/** 简单解析：空/非法 → NaN（不静默归零），调用方自行用 checkNum 拦 */
export function parseNum(raw) {
  if (raw === null || raw === undefined) return NaN;
  const s = String(raw).trim();
  if (s === '') return NaN;
  return Number(s);
}
