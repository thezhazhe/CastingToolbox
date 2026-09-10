// ============================================================
// 冒口设计 · 纯计算模块（从 riser_design.html v1.4 提取）
// 公式来源：《铸造工艺学》模数公式 · 《铸造手册》第5卷 收缩率/补缩效率
// ============================================================

// ---- 材料（体收缩率 = 凝固收缩率，冒口补缩用；非线收缩率） ----
// PHASE 28.6（43.txt A P0-3 审计）：rho 语义=固态密度（铸件体积 Vc=重量/ρ 换算、冒口体积校验用）。
// PHASE 28.7-A（44.txt）：**已人工批准定稿**——球铁 6.9→7.1、铝 2.6→2.7（其余保持）。
//   注意：与 gating.js MATERIALS（液态，球铁 6.9/铝 2.6 保持企业值）同材料不同值——液态/固态语义分开，勿合并。
export const RISER_MATERIALS = {
  灰铁:   { rho: 7.0, shrink: 0.02,  neck_k: 0.75, name: '灰铁(HT)' },
  球铁:   { rho: 7.1, shrink: 0.03,  neck_k: 1.0,  name: '球铁(QT)' },
  铸钢:   { rho: 7.8, shrink: 0.045, neck_k: 1.1,  name: '铸钢(ZG)' },
  铝合金: { rho: 2.7, shrink: 0.045, neck_k: 1.0,  name: '铝合金(Al)' },
  铜合金: { rho: 8.4, shrink: 0.045, neck_k: 1.0,  name: '铜合金(Cu)' },
};

// ---- 冒口补缩效率（可修改，源自《铸造手册》） ----
export const RISER_EFF = {
  eff_open: 14,   // 明顶圆柱 / 方柱
  eff_blind: 20,  // 暗侧圆柱
  eff_sph: 25,    // 球顶柱暗冒口
  eff_heat: 35,   // 发热保温冒口
};

// ---- 形状库（模数公式均源自《铸造工艺学》） ----
export const RISER_SHAPES = {
  cyl: {
    name: '圆柱形', effKey: 'eff_open',
    formula: 'M = D×H / (2D+4H)（《铸造工艺学》标准公式）',
    M: (D, H) => D * H / (2 * D + 4 * H),
    V: (D, H) => Math.PI * D * D / 4 * H,
    DfromM: (Mr, hd) => Mr * (2 + 4 * hd) / hd,
    label: (D, H) => `⌀${Math.round(D)}×H${Math.round(H)}`,
  },
  sphere_head: {
    name: '球顶圆柱', effKey: 'eff_sph',
    formula: 'M = V/A，半球头+柱体（底面不散热≈接铸件）',
    M: (D, H) => { const r = D / 2, Hc = H - r; if (Hc <= 0) return D / 6;
      const V = 2 / 3 * Math.PI * r * r * r + Math.PI * r * r * Hc;
      const A = 2 * Math.PI * r * r + 2 * Math.PI * r * Hc + Math.PI * r * r; return V / A; },
    V: (D, H) => { const r = D / 2, Hc = H - r;
      return Hc > 0 ? 2 / 3 * Math.PI * r * r * r + Math.PI * r * r * Hc : 2 / 3 * Math.PI * r * r * r; },
    DfromM: (Mr, hd) => { let D = (Mr * (2 + 4 * hd) / hd) / 0.92;
      for (let i = 0; i < 20; i++) D *= Mr / RISER_SHAPES.sphere_head.M(D, D * hd); return D; },
    label: (D, H) => `⌀${Math.round(D)}×H${Math.round(H)}（R${Math.round(D / 2)}）`,
  },
  sphere: {
    name: '球形', effKey: 'eff_blind',
    formula: 'M = D / 6（《铸造手册》）',
    M: (D, H) => D / 6, V: (D, H) => 4 / 3 * Math.PI * Math.pow(D / 2, 3),
    DfromM: (Mr, hd) => Mr * 6,
    label: (D, H) => `球⌀${Math.round(D)}`,
  },
  square: {
    name: '正方柱', effKey: 'eff_open',
    formula: 'M = a×H / (2a+4H)（类比圆柱）',
    M: (a, H) => a * H / (2 * a + 4 * H),
    V: (a, H) => a * a * H,
    DfromM: (Mr, hd) => Mr * (2 + 4 * hd) / hd,
    label: (a, H) => `方${Math.round(a)}×H${Math.round(H)}`,
  },
};

// 按热节输入方式计算 Mc
export function calcMc(mode, v) {
  if (mode === 'direct')  return parseFloat(v.mc) || 0;
  if (mode === 'hot_spot') return (parseFloat(v.hot_d) || 0) / 2;
  if (mode === 'wall')    return (parseFloat(v.wall_t) || 0) / 2;
  if (mode === 'volume') {
    const vol = parseFloat(v.cast_v) || 0, a = parseFloat(v.cast_a) || 1;
    return vol > 0 && a > 0 ? vol / a : 0;
  }
  return 0;
}

// ---- 主计算：自动迭代至全部校核通过 ----
export function runRiser(input) {
  // PHASE 28.6（P0-3）：密度接线——input.rho 显式覆盖（manifest 层在项目 solidDensity 为
  //   USER_OVERRIDE 时传入）；默认仍用内部表。未知材料不再静默：mdFellBack 标记。
  const md = RISER_MATERIALS[input.mat] || RISER_MATERIALS.球铁;
  const rhoUsed = input.rho ?? md.rho;
  const mdFellBack = !RISER_MATERIALS[input.mat];
  const Mc = calcMc(input.mc_mode, input);
  const sd = RISER_SHAPES[input.shape];
  const hd = parseFloat(input.hd_ratio) || 1.0;
  const eff = (parseFloat(input.eff) || RISER_EFF[sd.effKey]) / 100;
  const cw = parseFloat(input.cast_wt) || 0;
  if (Mc <= 0 || !sd) return null;

  // 迭代：从 f=1.10 开始，直到模数+体积均通过
  let f = 1.10, D = 0, H = 0, Mr_act = 0, Vr = 0, effV = 0, Mr_need = 0, final_f = 1.10;
  for (let iter = 0; iter < 50; iter++) {
    Mr_need = Mc * f;
    D = sd.DfromM(Mr_need, hd);
    H = Math.round(D * hd);
    D = Math.round(D);
    if (input.shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
    if (input.shape === 'sphere') H = D;
    // PHASE 73 防御（除零守卫，不改任何公式）：Mc 极小时 DfromM 迭代后 D/H 会取整到 0，
    //   形状模数 M(0,0) = 0/0 → NaN。合法输入下 D、H 恒 > 0，本分支永不触发，数值结果零影响。
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H);
    effV = Vr * eff;
    final_f = f;
    const modOk = Mr_act >= Mr_need * 0.99;   // 取整误差允许1%
    let volOk = true;
    if (cw > 0) {
      const Vc = cw * 1000000 / rhoUsed;
      volOk = effV >= Vc * md.shrink;
    }
    if (modOk && volOk) break;
    f += 0.05;
  }

  // 冒口颈
  const neck_k = md.neck_k;
  const M_neck = Mc * neck_k;
  const d_neck = Math.round(M_neck * 4);   // 圆颈 M=d/4 → d=4M

  // 体积校验相关（PHASE 28.6：Vc 换算用 rhoUsed——支持用户显式固态密度覆盖）
  const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0;
  const needVol = Vc * md.shrink;
  const modOk = Mr_act >= Mr_need * 0.99;
  const volOk = cw > 0 ? effV >= needVol : true;
  const yieldPct = Vc > 0 ? Vc / (Vc + Vr) * 100 : null;

  return { matKey: input.mat, md, rhoUsed, mdFellBack, Mc, shapeKey: input.shape, sd, hd, eff,
    D, H, Mr_act, Vr, effV, Mr_need, final_f,
    d_neck, neck_k, M_neck, cw, Vc, needVol, modOk, volOk, yieldPct,
    dimLabel: input.shape === 'sphere' ? '球直径' : input.shape === 'square' ? '边长 a' : '直径 D' };
}
