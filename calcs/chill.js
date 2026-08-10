// ============================================================
// 冷铁（激冷）计算 · 逻辑层（纯函数）
// 输入：铸件材质 / 冷铁类型 / 热节壁厚 T / 冷铁材料
// 输出：冷铁厚度范围 + 失效警告 + 布置规则
// ============================================================
import { CHILL_COEF, CHILL_DEFAULT_MAT, CHILL_RULES } from '../data/chill_calc.js';

/**
 * input: { mat, type('外冷铁·直接'|'外冷铁·间接(隔砂)'|'内冷铁'), T(热节壁厚mm), chillMat }
 * 返回: {
 *   thickness: [lo, hi](mm, 仅外冷铁), mid, deltaText,
 *   warnings: string[], rules: string[], source
 * }
 */
export function runChill(input) {
  const T = Number(input.T) || 0;
  if (T <= 0) return null;
  const mat = input.mat || '灰铸铁';
  const type = input.type || '外冷铁·直接';
  const warnings = [], rules = [];

  // 内冷铁：直径 ≈ 0.3~0.5T，需熔合
  if (type === '内冷铁') {
    return {
      thickness: [Math.round(T * 0.3 * 10) / 10, Math.round(T * 0.5 * 10) / 10],
      mid: Math.round(T * 0.4 * 10) / 10,
      type,
      deltaText: `内冷铁直径 ≈ 0.3~0.5×T = ${Math.round(T * 0.3 * 10) / 10}~${Math.round(T * 0.5 * 10) / 10} mm`,
      warnings: [
        '内冷铁须与铸件熔合：选用低碳钢/与铸件相近材质，直径约 0.3~0.5 倍热节壁厚',
        '内冷铁使用前表面除锈、去油污、镀锡或涂铝，防止气孔',
        '内冷铁过多会导致铸件局部成分/组织异常，尽量优先用外冷铁',
      ],
      rules: CHILL_RULES.slice(4),
      source: '铸造工艺设计及应用（CNKI）· 内冷铁规则',
    };
  }

  // 外冷铁：系数表。若所选 冷铁材料 不在该 铸件材质 的可用组合内（如灰铁×铝冷铁），
  // 自动回退到该材质的推荐冷铁材料，绝不返回 null 厚度（否则视图崩溃、结果停留旧值）。
  let coefRow = (CHILL_COEF[mat] || {})[input.chillMat];
  const fallbackMat = !coefRow ? CHILL_DEFAULT_MAT[mat] : null;
  if (fallbackMat) coefRow = (CHILL_COEF[mat] || {})[fallbackMat];
  const deltaText0 = coefRow ? `${coefRow[0]}~${coefRow[1]}×T` : null;
  let thickness = null, mid = null;
  if (coefRow) {
    thickness = [Math.round(T * coefRow[0] * 10) / 10, Math.round(T * coefRow[1] * 10) / 10];
    mid = Math.round(T * (coefRow[0] + coefRow[1]) / 2 * 10) / 10;
  }

  // 失效检查
  if (T > 100) warnings.push('铸件壁厚 >100mm：外冷铁激冷作用显著减弱，应改用内冷铁或强制冷却');
  if (coefRow) {
    const hi = coefRow[1];
    warnings.push(`激冷效果饱和：厚度超过约 ${Math.round(hi * 10) / 10} 倍壁厚后激冷提高很有限（二分之一原则），不必更厚`);
  }
  if (type === '外冷铁·间接(隔砂)') {
    warnings.push('间接冷铁（隔砂）挂砂层取 10~15mm；挂砂层超过 40mm 激冷作用几乎丧失');
  }
  if (fallbackMat) {
    warnings.push(`「${mat}」没有「${input.chillMat}」这种搭配，已自动按推荐冷铁材料「${fallbackMat}」计算`);
  }

  // 规则：直接冷铁取全部，隔砂去掉"直接"相关？统一给布置规则
  rules.push(...CHILL_RULES.slice(3));

  return {
    thickness, mid,
    type,
    deltaText: deltaText0 || null,
    defaultMat: CHILL_DEFAULT_MAT[mat],
    recommendedMat: fallbackMat || input.chillMat,
    warnings, rules,
    source: '铸造工艺设计及应用（CNKI 冷铁词条）· 外冷铁厚度经验系数',
  };
}
