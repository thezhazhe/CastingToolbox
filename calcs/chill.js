// ============================================================
// 冷铁（激冷）计算 · 逻辑层（纯函数）
// 输入：铸件材质 / 冷铁类型 / 热节壁厚 T / 冷铁材料
// 输出：冷铁厚度范围 + 失效警告 + 布置规则
// ============================================================
import { CHILL_COEF, CHILL_DEFAULT_MAT, CHILL_RULES, CHILL_PAD } from '../data/chill_calc.js';

/**
 * input: { mat, type('外冷铁·直接'|'外冷铁·间接(隔砂)'|'内冷铁'), T(热节壁厚mm), chillMat }
 * 返回: {
 *   thickness: [lo, hi](mm, 仅外冷铁), mid, deltaText,
 *   warnings: string[], rules: string[], source
 * }
 */
export function runChill(input) {
  const T = Number(input.T) || 0;
  const mat = input.mat || '灰铸铁';
  const type = input.type || '外冷铁·直接';
  const warnings = [], rules = [];

  // 激冷片（Chill Pad，59.txt 加入；60.txt：书中散热片实验规则可给出参考尺寸）。
  //   放在 T 校验之前：不依赖壁厚也能返回工程说明（壁厚留空不再被"请填写"拦截）；
  //   参考值 = 书中实验数据换算（Wright & Campbell 1997：最佳厚度≈5%×T、有效<1/10×T；最佳长度≈2×T），
  //   属工程参考非标准参数，不参与外冷铁/内冷铁既有逻辑
  if (type === '激冷片（Chill Pad）') {
    if (T > 0) {
      const lo = Math.round(T * 0.05 * 10) / 10, hi = Math.round(T * 0.10 * 10) / 10;
      return {
        type, pad: CHILL_PAD, warnings: [], rules: [], source: CHILL_PAD.source,
        padRef: {
          thick: [lo, hi], len: Math.round(T * 2), T,
          txt: `参考厚度 ≈ 5~10%×T = ${lo}~${hi} mm（约 5%×T= ${Math.round(T * 0.05 * 10) / 10} mm 时冷却效果接近最佳）｜参考长度 ≈ 2×T = ${Math.round(T * 2)} mm`,
        },
      };
    }
    return { type, pad: CHILL_PAD, warnings: [], rules: [], source: CHILL_PAD.source };
  }

  if (T <= 0) return null;

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

  // 失效检查（P52 批 1/57.txt：经验阈值不用绝对"失效"措辞——按权威资料"超过最优厚度激冷不再增强"的边际递减表述）
  if (T > 100) warnings.push('铸件壁厚较大（约 >100mm，经验值）：外冷铁冷却效果可能明显下降，应考虑内冷铁或强制冷却等强化措施');
  if (coefRow) {
    const hi = coefRow[1];
    warnings.push(`激冷效果饱和：厚度超过约 ${Math.round(hi * 10) / 10} 倍壁厚后激冷提高很有限（二分之一原则），不必更厚`);
  }
  if (type === '外冷铁·间接(隔砂)') {
    warnings.push('间接冷铁（隔砂）挂砂层经验取 10~15mm；挂砂层过厚（约 >40mm，经验值）激冷作用可能大幅下降');
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
