// ============================================================
// 整模重量/出品率口径核对 · 纯显示派生模块（无 DOM、无计算核心调用）
// ------------------------------------------------------------
// 背景（R6-S3 / 153.txt §四 / R6-S4 / 155.txt §2.2）：
//   `calcs/calcManifest.js` 的旧字段语义**保持不变**（历史消费方仍按旧口径读取）：
//     · gating.G = 单件毛坯重 × 型腔数 ÷ **预估出品率**；
//     · gating.ya = 单件毛坯重 × 型腔数 ÷ G × 100 ≡ 预估出品率（恒等，不是实重反算）；
//     · yield.castWt  = 单件毛坯重；
//     · yield.runnerWt = G − **单件**毛坯重（未乘型腔数，且未扣冒口）；
//     · yield.riserWt  = 单套冒口重量（未乘型腔数）。
//   S4 在核心**新增**整模字段（castingMass / riserUnit / riserWtTotal / gatingWtResidual /
//   finalYield=null），本模块优先使用这些新字段；旧字段仍作回退，兼容旧结果对象。
//   本模块把**已存在的输出**按整模口径列成可核对账目，绝不冒充"最终出品率"：
//     · 正确可算的：整模铸件重、G、差值（冒口+浇道）、冒口单套/整模（假设每腔一套）；
//     · 带假设的：浇道重 = 差值 − 整模冒口重（核心新字段同公式，只是集中计算）；
//     · 不能独立算出的：最终出品率（核心没有独立的浇道实重，G 本身由预估出品率反推）。
// ============================================================

/**
 * @param {object} p
 * @param {number} p.cav          型腔数（一模件数）
 * @param {number} p.blankWt      单件毛坯重 kg（gating.pw）
 * @param {number} p.pourWt       浇注重量 G kg（gating.G）
 * @param {number|null} p.riserWt 单套冒口重 kg（yield.riserWt；多热结时为该件的全部冒口之和）
 * @param {number} [p.castingMass] 整模铸件重（yield.castingMass，S4 新字段）
 * @param {number|null} [p.riserWtTotal] 整模冒口重（yield.riserWtTotal，S4 新字段）
 * @param {number|null} [p.gatingWtResidual] 核心反推的浇道残差（yield.gatingWtResidual）
 * @param {number} p.designYield  预估出品率 %（gating.yv）
 * @returns {object} 账目 + 可解释的缺口
 */
export function buildYieldLedger({ cav, blankWt, pourWt, riserWt, castingMass, riserWtTotal, gatingWtResidual, designYield } = {}) {
  const n = Number.isFinite(cav) && cav > 0 ? cav : 1;
  const blank = Number.isFinite(blankWt) && blankWt > 0 ? blankWt : 0;
  const pour = Number.isFinite(pourWt) && pourWt > 0 ? pourWt : 0;
  const riserUnit = Number.isFinite(riserWt) && riserWt >= 0 ? riserWt : null;
  /* 整模铸件重：优先用核心新字段；旧结果对象没有该字段时按单件 × 型腔数回退。 */
  const blankTotal = Number.isFinite(castingMass) && castingMass > 0 ? castingMass : blank * n;
  const delta = pour > 0 && blankTotal > 0 ? pour - blankTotal : null;
  /* 假设：每一个型腔都配一套同参数的冒口（核心只算单件冒口）。 */
  const riserTotal = Number.isFinite(riserWtTotal) && riserWtTotal >= 0
    ? riserWtTotal
    : (riserUnit != null ? riserUnit * n : null);
  const gatingEst = Number.isFinite(gatingWtResidual)
    ? gatingWtResidual
    : ((delta != null && riserTotal != null) ? delta - riserTotal : null);
  const productShare = pour > 0 ? blankTotal / pour * 100 : null;
  const productPlusRiserShare = (pour > 0 && riserTotal != null) ? (blankTotal + riserTotal) / pour * 100 : null;
  return {
    cav: n,
    blankWt: blank,
    blankTotal,
    pourWt: pour,
    designYield: Number.isFinite(designYield) ? designYield : null,
    delta,                    // G − 整模铸件毛坯重 = 冒口 + 浇道（正确算术）
    riserUnit,
    riserTotal,               // × 型腔数（假设每腔一套）
    gatingEst,                // 差值 − 整模冒口重（带"每腔一套"假设）
    productShare,             // 整模铸件重 / G（≡ 设计预估出品率）
    productPlusRiserShare,    // (整模铸件 + 整模冒口) / G
    finalYield: null,         // 不能由现有核心独立给出
    finalYieldReason: 'missing_independent_gating_weight',
    assumptions: [
      'riser_one_set_per_cavity',
      'gating_weight_is_residual_of_design_yield',
    ],
  };
}
