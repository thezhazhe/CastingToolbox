// ============================================================
// 机械加工余量 · 纯计算模块
// 数据来源：GB/T 6414-1999《铸件 尺寸公差与机械加工余量》
// RMA = Required Machining Allowance（要求的机械加工余量）
// 注意：J/K 级用于特殊场合，未收录；个别数值 M2 复核标准原文
// ============================================================

export const RMA_GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// 行区间为（上一行 max, 本行 max]，首行即 ≤40
export const RMA_TABLE = [
  { max: 40,    A: 0.1, B: 0.1, C: 0.2, D: 0.3, E: 0.4, F: 0.5, G: 0.5, H: 0.7 },
  { max: 63,    A: 0.1, B: 0.2, C: 0.3, D: 0.3, E: 0.4, F: 0.5, G: 0.7, H: 1 },
  { max: 100,   A: 0.2, B: 0.3, C: 0.4, D: 0.5, E: 0.7, F: 1,   G: 1.4, H: 2 },
  { max: 160,   A: 0.3, B: 0.4, C: 0.5, D: 0.8, E: 1.1, F: 1.5, G: 2.2, H: 3 },
  { max: 250,   A: 0.3, B: 0.5, C: 0.7, D: 1,   E: 1.4, F: 2,   G: 2.8, H: 4 },
  { max: 400,   A: 0.4, B: 0.7, C: 0.9, D: 1.3, E: 1.4, F: 2.5, G: 3.5, H: 5 },
  { max: 630,   A: 0.5, B: 0.8, C: 1.1, D: 1.5, E: 2.2, F: 3,   G: 4,   H: 6 },
  { max: 1000,  A: 0.6, B: 0.9, C: 1.2, D: 1.8, E: 2.5, F: 3.5, G: 5,   H: 7 },
  { max: 1600,  A: 0.7, B: 1,   C: 1.4, D: 2,   E: 2.8, F: 4,   G: 5.5, H: 8 },
  { max: 2500,  A: 0.8, B: 1.1, C: 1.6, D: 2.2, E: 3.2, F: 4.5, G: 6,   H: 9 },
  { max: 4000,  A: 0.9, B: 1.3, C: 1.8, D: 2.5, E: 3.5, F: 5,   G: 7,   H: 10 },
  { max: 6300,  A: 1,   B: 1.4, C: 2,   D: 2.8, E: 4,   F: 5.5, G: 8,   H: 11 },
  { max: 10000, A: 1.1, B: 1.5, C: 2.2, D: 3,   E: 4.5, F: 6,   G: 9,   H: 12 },
];

/** 按最大轮廓尺寸查 RMA（mm，单侧） */
export function lookupRMA(size, grade) {
  const row = RMA_TABLE.find(r => size <= r.max);
  if (!row) return null;
  return { value: row[grade], range: size <= 40 ? '≤40' : `(上一档, ${row.max}]`, row };
}

/** 更粗一级的等级（A→B→…→H，到 H 封顶）—— 砂型顶面比底/侧面低一级 */
export function nextCoarserGrade(grade) {
  const idx = RMA_GRADES.indexOf(grade);
  if (idx < 0) return grade;
  return RMA_GRADES[Math.min(idx + 1, RMA_GRADES.length - 1)];
}

/**
 * 由「推荐等级区间」+ 尺寸算余量范围（mm，单侧）
 * gradeRangeStr 如 'E~G' / 'G~K'（K 未收录则止于 H）/ 'E'。返回 { min, max, mid, grades }；
 * 无可用等级或尺寸超表返回 null。
 */
export function rmaRange(size, gradeRangeStr) {
  const grades = (gradeRangeStr.match(/[A-HJ-K]/g) || []).filter(g => RMA_GRADES.includes(g));
  if (!grades.length) return null;
  const vals = grades.map(g => lookupRMA(size, g)).filter(Boolean);
  if (!vals.length) return null;
  const values = vals.map(v => v.value);
  return { min: Math.min(...values), max: Math.max(...values), mid: (Math.min(...values) + Math.max(...values)) / 2, grades: grades.filter(g => lookupRMA(size, g)) };
}

/** 该 工艺×材质 是否有标准推荐等级（无则返回 null） */
export function methodGradeRec(method, matKey) {
  const rec = (METHOD_GRADES[method] || {})[matKey];
  return rec && rec !== '—' ? rec : null;
}

// 各铸造方法推荐 RMA 等级（GB/T 6414；熔模铸造余量极小、无标准 RMA 等级，不收录）
export const METHOD_GRADES = {
  '砂型 · 手工造型': { 铸钢: 'G~K', 灰铸铁: 'F~H', 铝合金: 'F~H' },
  '砂型 · 机器造型/壳型': { 铸钢: 'F~H', 灰铸铁: 'E~G', 铝合金: 'E~G' },
  '金属型（重力/低压）': { 铸钢: '—', 灰铸铁: 'D~F', 铝合金: 'D~F' },
  '压力铸造': { 铸钢: '—', 灰铸铁: '—', 铝合金: 'B~D' },
};
