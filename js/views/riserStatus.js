// ============================================================
// PHASE V2.0-15（126.txt）· 冒口**收敛状态**的单一来源
//
//   背景（PHASE V2.0-14 §2.3 / §4.1）：
//     ① `runRiser` 原先**不导出** `converged`，外部只能靠 `bind === 'limit'` **反推**收敛性；
//     ② 未收敛的披露**只有设计中心结果卡一处**，导出报告 / 独立计算器 / 向导都看不到；
//     ③ 原结果卡的 limit 文案写「仍未**同时**满足模数与体积校核」——但实测 26,768 点里
//        limit 的 **89% 其实是 `modOk === true`**（只有体积不过）⇒ 那句话**与事实不符**。
//
//   ★ 职责边界（126.txt §二.5）：`bind` 是**搜索归因**（"为什么必须继续前进"），
//     `converged` 才是**状态**（"这是不是收敛解"）。二者**不可互相替代**，
//     本模块把"状态"从"归因"里**独立出来**，四个入口共用同一份判定与同一份文案。
//
//   ★ 本模块**不参与任何数值计算**，只读 `runRiser` 的返回字段。
// ============================================================

/**
 * 是否收敛（未收敛 = `bind === 'limit'` = 撞上 f 上限仍未同时满足两条校核）。
 *
 * **兼容**（126.txt §二.6）：V2.0-15 起 `runRiser` 恒带布尔 `converged`；
 * 但**旧结果 / 测试构造的假数据**可能没有该字段 ⇒ 此时**回退到既有的 `bind === 'limit'` 推断**
 * （与 V2.0-08 起 `bindHint` 对缺失 `bind` 的保守处理同一口径）。
 *
 * @returns {boolean|null} `null` = 没有结果对象（调用方不应出任何结论）
 */
export function riserConverged(r) {
  if (!r) return null;
  return typeof r.converged === 'boolean' ? r.converged : r.bind !== 'limit';
}

/**
 * 未收敛警告。**已收敛 / 无结果时返回 `null`**（调用方保持沉默，避免噪音）。
 *
 * @returns {{key: string, params: Array}|null}
 *   `key` = 中文原文（本项目 i18n 以中文原文为 key）；UI 侧用 `tr(key, params)`；
 *   导出报告侧（中文单语）用本地填充。
 */
export function riserWarning(r) {
  if (!r || riserConverged(r) !== false) return null;
  const f = (typeof r.final_f === 'number' && Number.isFinite(r.final_f)) ? r.final_f.toFixed(2) : '—';
  const volChecked = (r.cw || 0) > 0;   // cw=0 时 runRiser 不做体积校核（volOk 恒 true，不代表"通过"）
  const modOk = r.modOk === true;
  const volOk = r.volOk === true;

  // 实测（PHASE V2.0-14，26,768 点）只存在这两种 limit 组合：
  //   modOk=true  + volOk=false  → 35,961 点（89%）
  //   modOk=false + volOk=false  →  4,688 点（迭代还原到原取整口径后模数也差一点）
  if (modOk && !volOk) {
    return { key: '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：<b>模数校核通过，体积校核未通过</b>。当前 D/H 不是收敛解，<b>不能当作已通过全部约束的设计结果</b>——可按需加大冒口、增设冷铁或改用发热/保温冒口后重新评估。', params: [f] };
  }
  if (!modOk && !volOk) {
    return { key: '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：<b>模数校核与体积校核均未通过</b>。当前 D/H 不是收敛解，<b>不能当作已通过全部约束的设计结果</b>——可按需加大冒口、增设冷铁或改用发热/保温冒口后重新评估。', params: [f] };
  }
  if (!modOk && !volChecked) {
    return { key: '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：<b>模数校核未通过</b>（本次未填写铸件重量，未做体积校核）。当前 D/H 不是收敛解，<b>不能当作已通过全部约束的设计结果</b>。', params: [f] };
  }
  // 兜底：不臆造结论，只陈述"未收敛"这一确定事实
  return { key: '⚠️ <b>未收敛</b>（迭代已达上限 f = {f}）：当前 D/H <b>不是收敛解，不能当作已通过全部约束的设计结果</b>。', params: [f] };
}

/**
 * 供导出报告（中文单语）使用的本地填充 —— 报告层不引入 i18n，与其余报告文案同口径。
 * 占位符**按出现顺序**代入 `params`（与 `tr(key, params)` 的位置参数规则一致）。
 */
export function fillWarning(w) {
  if (!w) return '';
  let i = 0;
  return String(w.key).replace(/\{\w+\}/g, (m) => (w.params && w.params[i] != null ? String(w.params[i++]) : m));
}
