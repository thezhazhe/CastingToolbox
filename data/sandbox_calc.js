// ============================================================
// 3D 打印砂型吃砂量 · 数据层（机器可读）
// 来源：《铸造铝合金3D打印砂型工艺设计规范》（企业规范，已脱敏）
// 注意：本表针对 3D 打印砂型（低强度 6±1MPa、随型轻量化），
//       与常规树脂砂/湿型砂吃砂量不同，勿直接套用于传统造型。
// ============================================================

export const SB_MODES = ['埋箱（树脂砂埋箱）', '裸浇'];

/**
 * 埋箱吃砂量（表3）：按 砂型最大轮廓尺寸(mm) × 砂型重量(kg) → 吃砂量(mm)
 * 非承重壁厚恒为 30mm；承重壁厚按档查表。尺寸/重量均为 (lo, hi]。
 */
export const SB_BURROW = [
  { dimLo: 0,    dimHi: 500,  wtLo: 0,    wtHi: 100,  load: 40 },
  { dimLo: 0,    dimHi: 500,  wtLo: 100,  wtHi: 200,  load: 50 },
  { dimLo: 500,  dimHi: 700,  wtLo: 200,  wtHi: 300,  load: 60 },
  { dimLo: 500,  dimHi: 700,  wtLo: 300,  wtHi: 500,  load: 80 },
  { dimLo: 700,  dimHi: 1000, wtLo: 200,  wtHi: 400,  load: 70 },
  { dimLo: 700,  dimHi: 1000, wtLo: 400,  wtHi: 600,  load: 70 },
  { dimLo: 700,  dimHi: 1000, wtLo: 600,  wtHi: 800,  load: 80 },
  { dimLo: 700,  dimHi: 1000, wtLo: 800,  wtHi: 1000, load: 100 },
  { dimLo: 700,  dimHi: 1000, wtLo: 1000, wtHi: 1200, load: 120 },
  { dimLo: 1000, dimHi: 1500, wtLo: 300,  wtHi: 500,  load: 100 },
  { dimLo: 1000, dimHi: 1500, wtLo: 500,  wtHi: 700,  load: 100 },
  { dimLo: 1000, dimHi: 1500, wtLo: 700,  wtHi: 900,  load: 120 },
  { dimLo: 1000, dimHi: 1500, wtLo: 900,  wtHi: 1100, load: 130 },
  { dimLo: 1000, dimHi: 1500, wtLo: 1100, wtHi: 1300, load: 140 },
  { dimLo: 1500, dimHi: 2000, wtLo: 400,  wtHi: 600,  load: 120 },
  { dimLo: 1500, dimHi: 2000, wtLo: 600,  wtHi: 800,  load: 120 },
  { dimLo: 1500, dimHi: 2000, wtLo: 800,  wtHi: 1000, load: 140 },
  { dimLo: 1500, dimHi: 2000, wtLo: 1000, wtHi: 1200, load: 140 },
  { dimLo: 1500, dimHi: 2000, wtLo: 1200, wtHi: 1400, load: 150 },
  { dimLo: 1500, dimHi: 2000, wtLo: 1400, wtHi: 1800, load: 160 },
];
export const SB_BURROW_NOLOAD = 30;

/**
 * 裸浇（表3说明 + 推导原则）：
 * 吃砂量 ≥ max(40, 溃散层5 + (静水压头高度 − 铸件高度))；底面吃砂量 = 1.5 × 该值；
 * 裸浇芯包轮廓 ≤ 1200×1200mm；热溃散层按 5mm 计。
 * 注：规范原表以图表达推导公式，此处为原则值换算，具体仍以原规范为准。
 */
export const SB_BARE = { min: 40, softLayer: 5, bottomFactor: 1.5, maxCore: 1200 };

/** 3D 打印砂型最小壁厚（表5）：<100mm → 8mm；100~4000 → 30mm */
export const SB_MIN_WALL = { small: { max: 100, wall: 8 }, large: { wall: 30 } };

export const SB_NOTE = [
  '埋箱：吃砂量只需满足砂型自身强度（翻转/施涂/转运不变形），非承重壁 30mm 恒定',
  '裸浇：吃砂量须同时满足自身强度 + 浇注抗金属液冲击（溃散层5mm+静水压头），最低 40mm',
  '底面吃砂量 = 1.5 × 侧壁吃砂量（裸浇）',
  '吃砂量不足 → 浇注时砂型断裂/变形；过大 → 砂铝比高、成本高（追求轻量化随型设计）',
  '数据来源：《铸造铝合金3D打印砂型工艺设计规范》（企业规范，3D打印砂型专用）',
];
