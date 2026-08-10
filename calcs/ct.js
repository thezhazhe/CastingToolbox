// ============================================================
// 铸件尺寸公差 CT · 逻辑层（纯函数）
// 输入：铸造方法 × 材质 → 推荐 CT 区间；基本尺寸 → 查公差值（±）
// ============================================================
import { CT_TABLE, CT_GRADES, CT_METHOD_GRADES } from '../data/ct_calc.js';

/** 按基本尺寸查公差行（返回该尺寸所在行对象 + 区间标签） */
export function lookupCTRow(size) {
  if (!(size > 0)) return null;
  const row = CT_TABLE.find(r => size > r.lo && size <= r.hi);
  if (!row) return null;
  return { row, rangeLabel: row.lo === 0 ? `≤${row.hi}` : `${row.lo}~${row.hi}mm` };
}

/** 等级名归一：'11' 或 'CT11' → 'CT11' */
export function normGrade(g) {
  const m = String(g).match(/(\d+)/);
  return m ? 'CT' + m[1] : g;
}

/** 该尺寸 × 等级 → 公差值（± 对称；null = 该等级此尺寸段不采用） */
export function ctTolerance(size, grade) {
  const g = normGrade(grade);
  if (!CT_GRADES.includes(g)) return null;
  const hit = lookupCTRow(size);
  if (!hit) return null;
  const v = hit.row[g];
  if (v == null) return null;
  return { value: v, half: v / 2, range: hit.rangeLabel, grade: g };
}

/** 推荐等级区间内的 公差范围（min~max） + 中档推荐值 */
export function ctRange(size, gradeRangeStr) {
  if (!(size > 0)) return null;
  const grades = (String(gradeRangeStr).match(/\d+/g) || []).map(normGrade).filter(g => CT_GRADES.includes(g));
  if (!grades.length) return null;
  const hit = lookupCTRow(size);
  if (!hit) return null;
  const vals = grades.map(g => hit.row[g]).filter(v => v != null);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  // 中档等级（可用值里居中者）
  const mid = (lo + hi) / 2;
  return { min: lo, max: hi, mid, grades: grades.filter(g => hit.row[g] != null), range: hit.rangeLabel };
}

/** 推荐 CT 等级（方法×材质），无则返回 null */
export function methodCTRec(method, mat) {
  const rec = (CT_METHOD_GRADES[method] || {})[mat];
  return rec || null;
}
