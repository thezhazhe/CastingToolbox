// ============================================================
// 开箱（打箱）时间计算 · 逻辑层（纯函数）
// 输入：材质 / 重量 / 壁厚 / 造型方式 / 是否热时效 / 风险 / 重要性 / 自定义开箱温度
// 输出：型内冷却时间范围 + 开箱温度目标 + 调整明细 + 风险提示
// ============================================================
import { SHAKE_TEMP, COOL_SMALL, COOL_LARGE, SHAKE_ADJUST, IMPORTANT_TEMP } from '../data/shakeout_calc.js';

/**
 * input: { mat, weight(kg), wall(mm), mode, heatTreat, risk, importance, targetTemp(℃, 可空) }
 * 返回: {
 *   timeRange: [min, max], unit: 'min' | 'h',
 *   shakeTemp, shakeTempSource,       // 开箱温度目标 + 来源说明
 *   adjustments: string[], warnings: string[],
 *   row, large
 * }
 */
export function runShakeout(input) {
  const weight = Number(input.weight) || 0;
  const wall = Number(input.wall) || 0;
  if (weight <= 0 || wall <= 0) return null;

  const importance = input.importance || '一般';
  const adj =
    (SHAKE_ADJUST.modes[input.mode] ?? 1) *
    (SHAKE_ADJUST.heatTreat[input.heatTreat] ?? 1) *
    (SHAKE_ADJUST.risk[input.risk] ?? 1) *
    (SHAKE_ADJUST.importance[importance] ?? 1);

  const adjustments = [];
  if (input.mode === '流水线') adjustments.push('流水线：开箱温度较高，冷却时间 ×0.65');
  if (input.heatTreat === '是') adjustments.push('会热时效：可适当早开箱进炉，时间 ×0.85');
  if (input.risk === '复杂(壁厚差大)') adjustments.push('壁厚差大：+30% 延长冷却，减少热应力');
  if (input.risk === '易裂') adjustments.push('易裂件：×1.15 适当延长');
  if (importance === '重要') adjustments.push(`重要件：×1.1 延长，开箱温度建议 ≤${IMPORTANT_TEMP}℃`);

  const warnings = [];
  let timeRange = null, unit = 'min', row = null, large = false;

  // 大件（≥1t）走大件表
  if (weight >= 1000) {
    const t = weight / 1000;
    const L = COOL_LARGE.find(r => t <= r.tMax);
    if (L) {
      row = L; large = true; unit = 'h';
      timeRange = [+(L.h * adj).toFixed(1), +(L.h * adj).toFixed(1)];
      warnings.push('大型铸件建议以实测（壁厚最大处埋热电偶）或数值模拟校核开箱时间');
    }
  }

  // 中小件走中小件表
  if (!timeRange) {
    const s = COOL_SMALL.find(r => weight <= r.wMax);
    if (!s) {
      return { timeRange: null, unit, shakeTemp: '', shakeTempSource: '', adjustments, warnings, row: null, large: false };
    }
    row = s;
    timeRange = [Math.round(s.min * adj), Math.round(s.max * adj)];
    if (wall > s.tMax) {
      warnings.push(`壁厚 ${wall}mm 超过本档典型壁厚 ${s.tMax}mm，冷却时间建议再延长约 30%`);
    }
  }

  // 开箱温度目标：重要件封顶 250℃；用户可自定义
  const temp = SHAKE_TEMP[input.mat];
  let defaultTemp;
  if (input.risk === '易裂') {
    defaultTemp = null;   // 易裂件走 800~900℃ 特例
  } else if (importance === '重要') {
    defaultTemp = Math.min(IMPORTANT_TEMP, temp.noHT);
  } else {
    defaultTemp = input.heatTreat === '是' ? temp.withHT : temp.noHT;
  }

  let shakeTemp, shakeTempSource;
  if (input.risk === '易裂') {
    shakeTemp = '800~900℃（高温开箱 → 去浇冒口 → 砂坑/进炉缓慢冷却）';
    shakeTempSource = '易热裂件特例';
    warnings.push('易热裂件：高温开箱后必须缓慢冷却，防止内外温差开裂');
  } else {
    const userTemp = Number(input.targetTemp);
    if (userTemp > 0) {
      shakeTemp = `${userTemp}℃（自定）`;
      shakeTempSource = temp.noHT + '~' + temp.withHT + '℃ 为默认参考';
      if (userTemp < defaultTemp) warnings.push(`目标 ${userTemp}℃ 比默认 ${defaultTemp}℃ 更严：建议冷却时间再延长 20~30% 或首件实测冷却曲线`);
      else if (userTemp > temp.withHT) warnings.push(`目标 ${userTemp}℃ 高于常规上限 ${temp.withHT}℃：确认无热应力/组织转变风险`);
      else if (input.heatTreat !== '是') warnings.push(temp.warn);
    } else {
      shakeTemp = `≤${defaultTemp}℃`;
      shakeTempSource = importance === '重要' ? `重要件上限（默认）` : input.heatTreat === '是' ? `会热时效 · 放宽（默认）` : `不热时效（默认）`;
      if (input.heatTreat !== '是') warnings.push(temp.warn);
    }
  }

  return { timeRange, unit, shakeTemp, shakeTempSource, adjustments, warnings, row, large };
}
