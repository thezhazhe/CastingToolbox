// ============================================================
// 过滤网校核 · 纯函数（PHASE 28.3-D，方案 B 折叠校核区）
// 企业 Excel「过滤网标准」C 级数据；仅灰铁/球铁有标准（铸钢/铝/铜无 → 明确提示）
// 原则：只校核/推荐，绝不自动改变浇注系统（39.txt §八）
// ============================================================
import { FILTER_SPECS, filterCapacityOf } from '../data/filter_calc.js';

/**
 * 过滤网校核：给定浇注重量 G(kg) + 材料大类 + 型号 → 通过/超限
 * @param {number} G 浇注重量 kg（含浇冒口）
 * @param {string} family 灰铁/球铁/铸钢/铝合金/铜合金
 * @param {string} specId FILTER_SPECS 的 id
 * @returns {object|null} null=材料无企业标准；否则 {ok, capacity, usedPct, spec}
 */
export function checkFilter(G, family, specId) {
  const capKey = filterCapacityOf(family);
  if (!capKey) return null;                       // 铸钢/铝/铜：企业标准未覆盖
  const spec = FILTER_SPECS.find(s => s.id === specId);
  if (!spec) return null;
  const capacity = spec[capKey];
  if (!capacity) return null;                     // 该型号不适用（如莫来石×灰铁）
  const usedPct = G > 0 ? G / capacity * 100 : 0;
  return { ok: G <= capacity, capacity, usedPct, spec, family };
}

/**
 * 推荐过滤网：满足 G 的最小过流量规格（低成本优先）
 * @returns {object|null} null=材料无标准或 G 超所有规格
 */
export function recommendFilter(G, family) {
  const capKey = filterCapacityOf(family);
  if (!capKey) return null;
  const usable = FILTER_SPECS.filter(s => s[capKey] != null).sort((a, b) => a[capKey] - b[capKey]);
  if (!usable.length || G <= 0) return null;
  const rec = usable.find(s => G <= s[capKey]) || null;
  return { rec, usable, capKey };
}

/**
 * 过滤网推荐排名（PHASE 45-A，46.txt 十四~十七）：
 *   "使用过滤网"时，计算完成后按浇注重量 G 自动筛选排名——不按"过流量越大越好"排序，
 *   先满足企业最低过流量（capacity ≥ G），满足者按 capacity 升序（越接近需求越优先），
 *   无满足时如实返回 feasible=false（需求 vs 最大可用），不伪造推荐。
 * @param {number} G 浇注重量 kg（含浇冒口）
 * @param {string} family 灰铁/球铁/铸钢/铝合金/铜合金
 * @returns {object|null} null=材料无企业标准或 G 无效；否则
 *   { family, demand, feasible, list: [{spec, capacity, usedPct}...], maxCapacity }
 */
export function rankFilters(G, family) {
  const capKey = filterCapacityOf(family);
  if (!capKey || G <= 0) return null;
  const usable = FILTER_SPECS.filter(s => s[capKey] != null).sort((a, b) => a[capKey] - b[capKey]);
  if (!usable.length) return null;
  const list = usable.filter(s => G <= s[capKey]).map(s => ({ spec: s, capacity: s[capKey], usedPct: G / s[capKey] * 100 }));
  return {
    family, demand: G, capKey,
    feasible: list.length > 0,
    list,                                   // 已按 capacity 升序（= 满足条件中越接近需求越靠前）
    maxCapacity: usable[usable.length - 1][capKey],
  };
}
