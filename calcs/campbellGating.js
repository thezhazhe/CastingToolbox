// ============================================================
// Campbell 浇注系统速算 · 纯计算模块（PHASE 65.1 V1 + 65.2 + 65.3）
// ------------------------------------------------------------
// Campbell V1 产品逻辑：
//   500/1000 mm²/(kg/s) 经验规则 = 【主计算】方法
//   速度法（A = Q/v）        = 【内部工程校验】，不是第二套用户可选设计方法
// 主链（65.3 支持一模多件）：一模总重 W_total = 单件 × 一模件数
//   → t(复用 CastingToolbox 冻结 calc_t, W=W_total)
//   → ṁ=W_total/t → A_total = ṁ × rule(轻 1000 / 重 500 mm² per kg/s)
//   → 速度校验 v=Q/A vs 材料目标 → 超则自动放大（简单可解释）
//   → 总内浇口数 n_total = 内浇口数量(单件) × 一模件数；Ai = A_total / n_total
//   → 1:1:n_total（V1 简化：Runner≈Sprue 出口=单口面积）
// 几何输出（65.3）：Sprue 圆形（面积+直径）、Runner 矩形（长×高，近方错开）、
//   缝隙式内浇口自动生成（厚度 ≤ 壁厚/2 → 长度）。
// 方法隔离：本模块【不】使用 Ozan 71.47 阻流式 / fv / Hp / 传统比例预设——
//   只复用 calc_t（t 模型）与 MATERIALS 液态密度（校验用）。
// 证据纪律：材料速度区分 Campbell 明确 / Campbell 算例 / 用户确认 / 工程参考（文献）；
//   全部 ENGINEERING_REFERENCE。
// ============================================================
import { calc_t, MATERIALS } from './gating.js';

/** 液态密度（企业 Excel 口径，g/cm³ = kg/dm³；与 gating 同源，校验 v 用） */
export const RHO_LIQUID = MATERIALS;

/** Campbell 500/1000 经验规则材料映射（V1 主方法系数）；未知材料 fallback 500（保守侧，速度校验会兜底放大） */
export const CAMPBELL_RULE_MM2_PER_KGS = {
  '灰铁(HT)': 500, '球铁(QT)': 500, '铸钢(ZG)': 500, '铜合金(Cu)': 500, '铝合金(Al)': 1000,
};
export const RULE_GROUP = { '灰铁(HT)': '重合金', '球铁(QT)': '重合金', '铸钢(ZG)': '重合金', '铜合金(Cu)': '重合金', '铝合金(Al)': '轻合金' };

/** 总内浇口数量上限（单件口数 × 一模件数）；超限视为输入非法 */
export const MAX_TOTAL_GATES = 256;

/**
 * Campbell 目标进浇速度表（V1 定稿；全部 ENGINEERING_REFERENCE）
 * prov: 'user' 用户确认 / 'campbell' Campbell 明确 / 'campbell-example' Campbell 算例 / 'reference' 工程参考（文献）
 */
export const CAMPBELL_GATE_SPEED = {
  '灰铁(HT)': {
    v: 1.0, prov: 'user',
    provLabel: '用户/项目确认设定',
    provNote: 'V1 确认的工程设定（灰铁 1.0 m/s；与工具自身浇注目标 V_TARGET 灰铁 1.0 一致）。Campbell 原书仅给高密度合金临界速度 ≈0.4 m/s（表 2.2/10.2）——1.0 属项目口径，非 Campbell 原值。',
  },
  '球铁(QT)': {
    v: 0.5, prov: 'user',
    provLabel: '用户/项目确认设定',
    provNote: 'V1 确认的工程设定（球铁 0.5 m/s）。Campbell 原书未给球铁专门速度值；球铁（加镁）属成膜敏感合金，从严取 0.5（临界 ≈0.4 同高密度族）。',
  },
  '铝合金(Al)': {
    v: 0.5, prov: 'campbell',
    provLabel: 'Campbell 明确',
    provNote: 'Campbell 明确：铝合金临界速度 ≈0.5 m/s（10.2 规则 2）；>1.2 m/s 似乎总会带来问题（12.4.3）；作者自用 ≤1.0、绝不超过 1.2。V1 取 0.5 安全线。',
  },
  '铸钢(ZG)': {
    v: 0.5, prov: 'campbell-example',
    provLabel: 'Campbell 算例目标',
    provNote: 'Campbell 原书无"设计目标速度"表，高密度合金（铁/钢/铜）临界 ≈0.4 m/s（表 2.2 Fe 0.45）；13.11 钢铸件算例以 0.5 m/s 为设计目标。V1 取 0.5；合金化/高强钢或敏感件建议按 0.4 从严。',
  },
  '铜合金(Cu)': {
    v: 0.5, prov: 'reference',
    provLabel: '工程参考（文献/行业）',
    provNote: '工程参考值：Cu-base 合金常用约 0.5 m/s 作为临界/控制速度（文献；铜铸件研究采用 ≤0.5 m/s 作内浇口控制条件）。Campbell 原书把铜归入高密度族（临界 ≈0.4），未单列铜合金设计速度——0.5 为工程参考定稿值，非标准条文、非唯一标准值。',
  },
};

/** 方形/缝隙参考：按 5mm 网格向上取整 */
export const ceil5 = (x) => Math.ceil(x / 5) * 5;
const round5 = (x) => Math.round(x / 5) * 5;

/**
 * 速度校验 + 自动纠偏（内部工程校验；导出供单元直测与调试）
 * v = Q/A = 1000·ṁ/(ρ·A)（ṁ kg/s、ρ g/cm³、A mm² → m/s）
 */
export function velocityCheckSizing(A0mm2, mdot, rho, vTarget) {
  const vActual0 = 1000 * mdot / (rho * A0mm2);
  if (vActual0 <= vTarget + 1e-9) {
    return { A_mm2: A0mm2, adjusted: false, vActual: vActual0, ok: true };
  }
  const A_mm2 = ceil5(1000 * mdot / (rho * vTarget));
  const vActual = 1000 * mdot / (rho * A_mm2);
  return { A_mm2, adjusted: true, vActual, ok: vActual <= vTarget + 1e-9 };
}

/** Sprue（直浇道底部）圆形：由面积给直径（≥ 所需面积，5mm 网格） */
export function sprueCircular(area) {
  const d = Math.max(5, ceil5(Math.sqrt(4 * area / Math.PI)));
  return { d, area: Math.PI * d * d / 4 };
}

/** Runner（横浇道）矩形：近方但非正方（长 > 高，比例错开），面积 ≥ 所需 */
export function runnerRect(area) {
  let h = Math.max(5, round5(Math.sqrt(area)));
  let l = 0;
  for (let i = 0; i < 8; i++) {
    l = Math.max(5, ceil5(area / h));
    if (l > h) break;
    h = Math.max(5, h - 5);   // 首次接近正方则压低高度让长边出来
    l = Math.max(5, ceil5(area / h));
    if (l > h) break;
  }
  if (l < h) { const t = l; l = h; h = t; }
  return { l, h, area: l * h };
}

/**
 * Runner 自定义高度（用户可改）：h 给定 → 长度 l = ⌈面积/高⌉（5mm 网格）。
 * 高度过大时实际面积可能不足参考 → 返回 under 标记供提示。
 */
export function runnerRectByH(area, h) {
  const hh = Math.max(1, Math.round(h));
  const l = Math.max(5, ceil5(area / hh));
  const areaAct = hh * l;
  return { l, h: hh, area: areaAct, under: areaAct < area - 1e-9, minL: 5, lFromArea: Math.ceil(area / hh) };
}

/**
 * Runner 参考面积：取 max(Sprue 单位面积 ×1.2, Sprue 实际几何面积)——保证
 * 实际给出的 Runner 几何面积 > 直浇道实际面积（弯角摩擦裕度 ~20%；仍遵循
 * "满足流量下尽可能小"原则）。1:1:n 基准不变。
 */
export const RUNNER_FACTOR = 1.2;
export const runnerRefArea = (unit, sprueActual = 0) => Math.max(unit * RUNNER_FACTOR, sprueActual);

/**
 * 缝隙式内浇口几何：由【单口面积 Ai】与【用户可改厚度 t】求长度。
 * 规则：厚度 ≤ 壁厚/2（默认 ⌊壁厚/2⌋）；用户可自行改大/改小（超半壁时 warn）。
 * @returns {{t:number, l:number, area:number, overThin:boolean, minT:number}|null}
 */
export function slotGeometry(Ai, t, wall) {
  if (!Number.isFinite(t) || !(t > 0)) return null;
  const minT = Math.max(1, Math.floor(wall / 2));
  const l = Math.max(5, ceil5(Ai / t));
  return { t, l, area: t * l, overThin: t > wall / 2 + 1e-9, minT };
}

/**
 * 主计算（纯函数）：
 * @param {{mat?:string, weightKg:number, wallMm:number, cavity?:number, gateCount?:number}} input
 *   weightKg 单件重量（不含浇冒口含余量）；cavity 一模件数（≥1）；gateCount 单件内浇口数量
 */
export function runCampbellGating({ mat = '灰铁(HT)', weightKg, wallMm, cavity = 1, gateCount = 4, slotT, runnerH } = {}) {
  const sp = CAMPBELL_GATE_SPEED[mat] || CAMPBELL_GATE_SPEED['灰铁(HT)'];
  const ruleMM2 = CAMPBELL_RULE_MM2_PER_KGS[mat] ?? 500;
  const W1 = Number(weightKg);
  const wall = Number(wallMm);
  const cav = Number(cavity);
  const nPer = Number(gateCount);
  if (!Number.isFinite(W1) || !Number.isFinite(wall) || !Number.isFinite(cav) || !Number.isFinite(nPer)) return null;
  if (!(W1 > 0) || !(wall > 0)) return null;
  if (!Number.isInteger(cav) || cav < 1 || cav > 64) return null;
  if (!Number.isInteger(nPer) || nPer < 1 || nPer > 64) return null;
  const nTotal = cav * nPer;
  if (nTotal > MAX_TOTAL_GATES) return null;

  const Wtotal = W1 * cav;                       // 一模总铸件重量（含各件）
  const t = calc_t(mat, Wtotal, wall);           // 复用冻结浇注时间模型（W = 一模总重）
  if (!(t > 0)) return null;

  const mdot = Wtotal / t;                        // kg/s 平均质量流率（一模）
  // ── 主方法（65.2）：Campbell 500/1000 经验规则 ──
  const A0_mm2 = mdot * ruleMM2;

  // ── 内部工程校验 ──
  const rho = (MATERIALS[mat] || MATERIALS['灰铁(HT)']).rho;
  const vTarget = sp.v;
  const { A_mm2, adjusted, vActual, ok: velocityOk } = velocityCheckSizing(A0_mm2, mdot, rho, vTarget);

  const Ai = A_mm2 / nTotal;                      // 单口面积（= 每口平均）
  // V1 简化 1:1:n_total：Runner ≈ Sprue 出口 = 单口面积
  const unitArea = Ai;
  const squareEdge = ceil5(Math.sqrt(Ai));

  // ── 缝隙式几何（65.3/70）：厚度默认 ⌊壁厚/2⌋，用户可改（slotT）→ 长度 = 面积/厚度 ──
  const slotDef = slotGeometry(Ai, slotT != null ? slotT : Math.max(1, Math.floor(wall / 2)), wall);
  const slot = slotDef || null;

  // ── Sprue / Runner 具体几何（65.3；70：Runner 面积 = Sprue×1.2 略大）──
  const sprue = sprueCircular(unitArea);
  const runnerRef = runnerRefArea(unitArea, sprue.area);
  const runnerAuto = runnerRect(runnerRef);
  // 70 补充：横浇道厚度（高）允许用户自定义 → 长度联动
  let runner, runnerCustom = false;
  if (runnerH != null && Number.isFinite(Number(runnerH)) && Number(runnerH) > 0) {
    runner = runnerRectByH(runnerRef, Number(runnerH));
    runnerCustom = true;
  } else {
    runner = runnerAuto;
  }

  const thinNote = squareEdge > wall / 2
    ? `方形参考 ${squareEdge}mm 大于壁厚一半（${(wall / 2).toFixed(1)}mm）——建议采用缝隙式（见下方缝隙式参考）。`
    : null;

  return {
    // 用户结果
    mat, t, mdot, Wtotal, wall,
    cavity: cav, gateCount: nPer, nTotal,
    A_mm2, Ai, unitArea,
    ratio: `1:1:${nTotal}`,
    sprueOutArea: unitArea, runnerRefArea: runnerRef, runnerArea: runner.area,
    runnerAutoH: runnerAuto.h, runnerCustom,
    squareEdge, slot, sprue, runner,
    velocityOk, adjusted,
    ruleMM2, ruleGroup: RULE_GROUP[mat] || '重合金',
    v: vTarget, prov: sp.prov, provLabel: sp.provLabel, provNote: sp.provNote,
    thinNote,
    // 校验层（调试/测试；UI 不并列展示第二套面积）
    A0_mm2, vActual,
    process: [
      { step: `一模总重 W = 单件 ${W1}kg × ${cav} 件`, value: Wtotal, unit: 'kg' },
      { step: 't 浇注时间（复用 gating.calc_t，W=一模总重）', value: t, unit: 's' },
      { step: 'ṁ = W/t 平均质量流率（一模）', value: mdot, unit: 'kg/s' },
      { step: `Campbell 经验法 A = ṁ × ${ruleMM2}（${RULE_GROUP[mat] || '重合金'}）`, value: A0_mm2, unit: 'mm²（初始）' },
      { step: `速度校验 v = Q/A vs 目标 ${vTarget.toFixed(1)} m/s`, pass: velocityOk && !adjusted },
      ...(adjusted ? [{ step: '超目标 → 自动放大至满足目标速度', value: A_mm2, unit: 'mm²（最终）' }] : []),
      { step: `总内浇口数 = 单件 ${nPer} 口 × ${cav} 件 = ${nTotal}；单口面积 = 总面积 ÷ ${nTotal}`, value: Ai, unit: 'mm²/口' },
      { step: `1:1:${nTotal}（Runner≈Sprue 出口=单口面积，V1 简化）`, pass: true },
    ],
  };
}
