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
  if (input.risk === '冷裂/变形敏感') adjustments.push('冷裂/变形敏感：×1.15 延长冷却（低温开箱 + 缓冷防应力）');
  if (input.risk === '热裂敏感(红热打箱)') adjustments.push('热裂敏感：×1.0（热裂主因是凝固期收缩受阻，见警告——开箱温度仅配套手段）');
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

  // 开箱温度目标分派（61.txt 拆分，详见 data 头注释）：
  //   · 冷裂/变形敏感 & 一般/复杂：低温开箱路径（重要件 250℃ 封顶 → 热时效放宽 → noHT）；
  //   · 热裂敏感 + 铜合金：800~900℃ 红热打箱特例（文献场景：立即去浇冒口/砂芯 → 热砂坑/入炉缓冷）；
  //   · 热裂敏感 + 其余材质：不自动给高温值（无通用依据），走低温路径 + 人工确认警告。
  const temp = SHAKE_TEMP[input.mat];
  const risk = input.risk;
  const userTemp = Number(input.targetTemp);
  const hotCopper = risk === '热裂敏感(红热打箱)' && input.mat === '铜合金';
  const lowTemp = () => {
    const d0 = importance === '重要' ? Math.min(IMPORTANT_TEMP, temp.noHT)
      : input.heatTreat === '是' ? temp.withHT : temp.noHT;
    if (userTemp > 0) {
      shakeTemp = `${userTemp}℃（自定）`;
      shakeTempSource = temp.noHT + '~' + temp.withHT + '℃ 为默认参考';
      if (userTemp < d0) warnings.push(`目标 ${userTemp}℃ 比默认 ${d0}℃ 更严：建议冷却时间再延长 20~30% 或首件实测冷却曲线`);
      else if (userTemp > temp.withHT) warnings.push(`目标 ${userTemp}℃ 高于常规上限 ${temp.withHT}℃：确认无热应力/组织转变风险`);
      else if (input.heatTreat !== '是') warnings.push(temp.warn);
    } else {
      shakeTemp = `≤${d0}℃`;
      shakeTempSource = importance === '重要' ? `重要件上限（默认）` : input.heatTreat === '是' ? `会热时效 · 放宽（默认）` : `不热时效（默认）`;
      if (input.heatTreat !== '是') warnings.push(temp.warn);
    }
  };

  let shakeTemp = '', shakeTempSource = '';
  if (hotCopper) {
    shakeTemp = '800~900℃（红热打箱 → 去浇冒口 → 砂坑/进炉缓慢冷却）';
    shakeTempSource = '易热裂铜合金工艺特例';
    warnings.push('仅适用于易热裂铜合金（如锡青铜类）：红热 800~900℃ 打箱后必须立即清除阻碍收缩的砂芯与浇冒口，小件入热砂坑缓冷、中大件立即装入预热炉缓慢冷却/去应力——单独高温开箱后空冷会适得其反');
    if (userTemp > 0) warnings.push(`已按红热打箱工艺执行（自定义 ${userTemp}℃ 不适用于该工艺路线；如需低温开箱请改选其他风险项）`);
  } else if (risk === '热裂敏感(红热打箱)') {
    lowTemp();
    warnings.push('热裂主要发生在凝固末期固相线附近，由收缩受阻决定（浇冒口/砂芯退让性/热节/硫等）——开箱温度作用有限；若采用高温开箱去浇冒口，必须立即入炉或保温缓冷，并经人工确认工艺');
    if (input.mat === '铝合金') warnings.push('铝合金熔点约 660℃，不存在 800~900℃ 高温开箱——防热裂以浇注系统/工艺措施为主');
  } else if (risk === '冷裂/变形敏感') {
    lowTemp();
    warnings.push('冷裂/变形敏感：开箱后避免激冷与磕碰（不得立即水冷/风冷/裸放车间风口），控制转运温差，防冷裂/变形');
  } else {
    lowTemp();
  }

  return { timeRange, unit, shakeTemp, shakeTempSource, adjustments, warnings, row, large };
}
