// ============================================================
// 浇注时间查表 · 纯函数（PHASE 28.3-E，第二个 80/20 新能力）
// 企业查表体系（C 级）：gating 的 Dietert 公式并列参照，不替代公式
// 数据源：data/pour_time.js（企业 Excel「查表」/「浇注时间查表」）
// 原则：线性插值；#REF!/来源不明数据不猜测，标记待验证
// ============================================================
import { POUR_TIME_WT, POUR_TIME_FAST } from '../data/pour_time.js';

/** 一维线性插值：points=[{w,t}] 升序，x 超界取端点（不外推） */
function interp(points, x) {
  if (x <= points[0].w) return points[0].t;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].w) {
      const [a, b] = [points[i - 1], points[i]];
      return a.t + (b.t - a.t) * (x - a.w) / (b.w - a.w);
    }
  }
  return points[points.length - 1].t;
}

/**
 * 重量-时间查表（企业「查表」sheet）：G(kg) + 有/无冒口 → 浇注时间 s
 * 验证：G=120.22 → 有冒口 16.9099 / 无冒口 10.022（Excel 原值）
 */
export function pourTimeByWeight(G, withRiser = true) {
  const times = withRiser ? POUR_TIME_WT.withRiser : POUR_TIME_WT.noRiser;
  const pts = POUR_TIME_WT.weights.map((w, i) => ({ w, t: times[i] }));
  return interp(pts, G);
}

/**
 * 快浇分段查表（企业「浇注时间查表」sheet）：G(kg) → 快浇时间 s
 * 验证：G=120.22 → 9.5392（Excel 原值）
 */
export function pourTimeFast(G) {
  return interp(POUR_TIME_FAST, G);
}

/**
 * 浇注时间查表总入口：返回 gating 并列参照（Dietert 公式 vs 企业查表）
 * 慢浇表：Excel R14 慢浇 16.011 来源不明确 → 返回 null + 待验证标记（不猜测）
 */
export function pourTimeReference(G, withRiser = true) {
  return {
    G,
    fast: pourTimeFast(G),                      // 快浇分段表
    wtTable: pourTimeByWeight(G, withRiser),    // 重量-时间表（有/无冒口）
    slow: null,                                 // 待验证：慢浇表数据源不明确
    source: '企业 Excel「查表」/「浇注时间查表」（C 级）',
  };
}
