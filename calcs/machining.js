// ============================================================
// 机械加工余量 · 纯计算模块
// 数据来源：GB/T 6414-2017《铸件 尺寸公差、几何公差与机械加工余量》
//   （= ISO 8062-3:2007 修改采用；RMAG 等级 A~K 十级）
//   —— 现行版 GB/T 42124.3-2025《GPS 模制件的尺寸和几何公差 第3部分：
//   铸件尺寸公差、几何公差与机械加工余量》（2025-12-01 实施，全部代替
//   GB/T 6414-2017；修改采用 ISO 8062-3:2023）。本表数值经多方公开文本
//   （标准官方 PDF 表7/国家标准解读/专业资料）交叉核对与 6414-2017 一致；
//   正式判定以标准原文为准。
// RMA = Required Machining Allowance（要求的机械加工余量）；等级代号 RMAG。
// 注意：等级序列无 I（A B C D E F G H J K 十级）；A/B 级仅适用于特殊场合
//   （工装定位面/夹紧面/基准面）；J/K 为正式常规等级（1999 版仅收录至 H 属旧版）。
// ============================================================

export const RMA_GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'];

// 行区间为（上一行 max, 本行 max]，首行即 ≤40；数值=单侧加工余量 mm（RMAG 表，GB/T 6414-2017 = GB/T 42124.3-2025）
export const RMA_TABLE = [
  { max: 40,    A: 0.1, B: 0.1, C: 0.2, D: 0.3, E: 0.4, F: 0.5, G: 0.5, H: 0.7, J: 1,   K: 1.4 },
  { max: 63,    A: 0.1, B: 0.2, C: 0.3, D: 0.3, E: 0.4, F: 0.5, G: 0.7, H: 1,   J: 1.4, K: 2 },
  { max: 100,   A: 0.2, B: 0.3, C: 0.4, D: 0.5, E: 0.7, F: 1,   G: 1.4, H: 2,   J: 2.8, K: 4 },
  { max: 160,   A: 0.3, B: 0.4, C: 0.5, D: 0.8, E: 1.1, F: 1.5, G: 2.2, H: 3,   J: 4,   K: 6 },
  { max: 250,   A: 0.3, B: 0.5, C: 0.7, D: 1,   E: 1.4, F: 2,   G: 2.8, H: 4,   J: 5.5, K: 8 },
  { max: 400,   A: 0.4, B: 0.7, C: 0.9, D: 1.3, E: 1.8, F: 2.5, G: 3.5, H: 5,   J: 7,   K: 10 },
  { max: 630,   A: 0.5, B: 0.8, C: 1.1, D: 1.5, E: 2.2, F: 3,   G: 4,   H: 6,   J: 9,   K: 12 },
  { max: 1000,  A: 0.6, B: 0.9, C: 1.2, D: 1.8, E: 2.5, F: 3.5, G: 5,   H: 7,   J: 10,  K: 14 },
  { max: 1600,  A: 0.7, B: 1,   C: 1.4, D: 2,   E: 2.8, F: 4,   G: 5.5, H: 8,   J: 11,  K: 16 },
  { max: 2500,  A: 0.8, B: 1.1, C: 1.6, D: 2.2, E: 3.2, F: 4.5, G: 6,   H: 9,   J: 13,  K: 18 },
  { max: 4000,  A: 0.9, B: 1.3, C: 1.8, D: 2.5, E: 3.5, F: 5,   G: 7,   H: 10,  J: 14,  K: 20 },
  { max: 6300,  A: 1,   B: 1.4, C: 2,   D: 2.8, E: 4,   F: 5.5, G: 8,   H: 11,  J: 16,  K: 22 },
  { max: 10000, A: 1.1, B: 1.5, C: 2.2, D: 3,   E: 4.5, F: 6,   G: 9,   H: 12,  J: 17,  K: 24 },
];

/** 按最大轮廓尺寸查 RMA（mm，单侧） */
export function lookupRMA(size, grade) {
  const row = RMA_TABLE.find(r => size <= r.max);
  if (!row) return null;
  return { value: row[grade], range: size <= 40 ? '≤40' : `(上一档, ${row.max}]`, row };
}

/** 更粗一级的等级（A→B→…→H→J→K，无 I；到 K 封顶）—— 砂型顶面比底/侧面低一级 */
export function nextCoarserGrade(grade) {
  const idx = RMA_GRADES.indexOf(grade);
  if (idx < 0) return grade;
  return RMA_GRADES[Math.min(idx + 1, RMA_GRADES.length - 1)];
}

/**
 * 由「推荐等级区间」+ 尺寸算余量范围（mm，单侧）
 * gradeRangeStr 如 'E~G' / 'G~K' / 'E'。区间按 A~K 序完整展开（'G~K' → G,H,J,K）。
 * 返回 { min, max, mid, grades }；无可用等级或尺寸超表返回 null。
 */
const RMA_SEQ = 'ABCDEFGHJK';
export function rmaRange(size, gradeRangeStr) {
  const m = String(gradeRangeStr || '').match(/^([A-K])\s*(?:[-~]\s*([A-K]))?$/);
  if (!m) return null;
  const a = RMA_SEQ.indexOf(m[1]), b = m[2] ? RMA_SEQ.indexOf(m[2]) : a;
  const grades = [];
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) grades.push(RMA_SEQ[i]);
  const vals = grades.map(g => lookupRMA(size, g)).filter(Boolean);
  if (!vals.length) return null;
  const values = vals.map(v => v.value);
  return { min: Math.min(...values), max: Math.max(...values), mid: (Math.min(...values) + Math.max(...values)) / 2, grades };
}

/** 该 工艺×材质 是否有标准推荐等级（无则返回 null） */
export function methodGradeRec(method, matKey) {
  const rec = (METHOD_GRADES[method] || {})[matKey];
  return rec && rec !== '—' ? rec : null;
}

// 各铸造方法推荐 RMA/RMAG 等级（GB/T 6414-2017 表/资料性附录；6414-1999 版 1999 年表
//   加工余量 A~H 段数值与现行一致但缺 J/K——现按现行十级体系）
//   熔模铸造：标准资料性附录建议 RMAG E（1999 版无熔模条目属旧版缺失，现行已收录）
export const METHOD_GRADES = {
  '砂型 · 手工造型': { 铸钢: 'G~K', 灰铸铁: 'F~H', 铝合金: 'F~H' },
  '砂型 · 机器造型/壳型': { 铸钢: 'F~H', 灰铸铁: 'E~G', 铝合金: 'E~G' },
  '金属型（重力/低压）': { 铸钢: '—', 灰铸铁: 'D~F', 铝合金: 'D~F' },
  '压力铸造': { 铸钢: '—', 灰铸铁: '—', 铝合金: 'B~D' },
  '熔模铸造': { 铸钢: 'E', 灰铸铁: 'E', 铝合金: 'E' },
};
