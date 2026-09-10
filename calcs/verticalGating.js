// ============================================================
// 垂直造型线小件浇注系统 · 纯计算引擎（V1）
// ------------------------------------------------------------
// 方法来源：DISA 230 Application Manual（《DISA 砂造型系统应用手册》2003）
//   第 6.8~6.12 节（手册页码 6.55~6.147）。计算依据：
//   6.9（公式）、6.11（四种系统完整算例）。
// 本模块为"垂直造型线多层铸型"的专用方法：竖型串中不同高度的内浇口
//   具有不同有效静压头 → 各层截面积按各自静压头计算。
//   与 CastingToolbox 现有"通用浇注系统计算器"（Dietert/奥赞体系）逻辑独立。
// 铁律（70 号任务约束）：
//   · 只按手册公式/算例实现：不新增经验系数、不改手册系数；
//   · 手册未明示处 → UNRESOLVED（见 res.basis.unresolved）并取保守行为；
//   · 参数集中定义（含出处页码），无魔法数字。
// ============================================================

// ------------------------------------------------------------
// 常量（手册 6.9.2 / 6.9.2.11 / 6.10.12 / 6.11 算例）
// ------------------------------------------------------------

/** 重力加速度 g [mm/s²] —— 手册 6.9.2.2（p6.63） */
export const G_MM_S2 = 9810;

/** 浇注系统填充时间 ≈1.5 s：t0 = t(进型腔) + 1.5 —— 手册 6.9.2.7（p6.71）与 6.11.3.4 算例 */
export const T_FILL_S = 1.5;

/** 砂型输送时间 ≈1.5 s（手册给 1~2 s，算例取 1.5）—— 6.9.2.7（p6.71） */
export const T_TRANS_S = 1.5;

/**
 * 材料体系（k 与 ρ 来自手册 6.9.2.5 p6.69；内浇口最大速度 6.9.2.11 p6.79）
 *   k = 1/(ρ·√(2g)) 推导核对：铁 1036.2→1036、铜 850.0→850、铝 3103.9→手册取
 *   3100（推导差 0.1%，见验证报告）。
 * 范围：手册仅提供 铁/铜合金/铝合金 三套 k 常数。球墨铸铁无手册 k →
 *   V1.1 经用户裁决并入灰铁参数（k=1036、ρ 同铁）；其内浇口最大速度
 *   600mm/s 为手册 6.9.2.11 表明确值。铸钢等仍无手册 k，不提供（U1）。
 */
export const VG_MATERIALS = {
  '灰铸铁': {
    label: '灰铸铁（手册 k=1036）', k: 1036, rhoKgMm3: 6.89e-6,
    vGateMax: 1000, lightMetal: false,
  },
  '球铁(QT)': {
    label: '球铁(QT)（k 同灰铁）', k: 1036, rhoKgMm3: 6.89e-6,
    vGateMax: 600, lightMetal: false, // 限速：手册 6.9.2.11 表球铁 600mm/s（k 手册无单独值，用户批准同灰铁）
  },
  '铝合金': {
    label: '铝合金（手册 k=3100）', k: 3100, rhoKgMm3: 2.30e-6,
    vGateMax: 500, lightMetal: true,
  },
  '铜合金': {
    label: '铜合金（手册 k=850）', k: 850, rhoKgMm3: 8.40e-6,
    vGateMax: 750, lightMetal: false,
  },
};

/**
 * 浇注不满标准因数 B 表 —— 手册 6.9.2.7（p6.71）：tmax2 = B·√G（G=单件重 kg）
 *   行=最薄壁厚档；列：G≤1kg / G≥4kg。表注：B 对铁/铜有效，轻金属 ×1.5~2.0。
 *   1~4kg 之间手册未给插值 → UNRESOLVED-U2：V1 线性插值并标注。
 */
export const POUR_B_TABLE = {
  '3-5': { bSmall: 3.0, bLarge: 1.5 },
  '5-10': { bSmall: 4.0, bLarge: 2.0 },
  '10-20': { bSmall: 5.0, bLarge: 2.5 },
  '>20': { bSmall: 6.0, bLarge: 3.0 },
};
export const WALL_BANDS = [
  { key: '3-5', min: 3, max: 5 }, { key: '5-10', min: 5, max: 10 },
  { key: '10-20', min: 10, max: 20 }, { key: '>20', min: 20, max: Infinity },
];
/** 轻金属 B 修正因数（手册 6.9.2.7 表注 1.5~2.0；V1 默认 1.5，可改） */
export const LIGHT_B_FACTOR = 1.5;

/**
 * 损失因数 m：手册 6.9.2.1（p6.63-64）；算例取用值见 6.11.3.1/6.11.4.1：
 *   内浇口 m=0.5、较宽流道 m=0.7。图 6.38 给口形状比→m 三档（0.3/0.5/0.6，
 *   见 gateLossMFromRatio）；手册算例全层统一取 0.5（其顶层口比 3.5 已入 3-5
 *   档仍取 0.5）→ 引擎缺省随例 0.5，查表作参考（UNRESOLVED-U3）。
 */
export const M_INGATE = 0.5;   // DISA 算例取用值（6.11.3.1），保留为 DISA 参考资料默认
export const M_RUNNER = 0.7;

/**
 * 内浇口损失/摩擦系数 M —— 国外铸造工程师现场经验区间（PHASE 70.1 接入）
 *  ⚠️ 来源：ENGINEERING_REFERENCE（国外工程现场经验，非 DISA 原文、非标准、非理论公式）。
 *  ⚠️ 区间未按材质区分，V1 对全部材质套用（经验表适用对象未明示 —— 见 UNRESOLVED-U9）。
 * 壁厚边界（V1 固定规则，写入测试）：
 *   w < 3        → 0.25~0.30（最小档，含 <3mm 薄壁 —— 经验表仅"约 3mm"起，V1 保守并入）
 *   3 ≤ w < 5    → 0.30~0.38
 *   5 ≤ w < 7    → 0.38~0.45
 *   7 ≤ w < 9    → 0.45~0.52
 *   9 ≤ w ≤ 12   → 0.52~0.60
 *   w > 12       → 经验表无数据 → V1 保守沿用 0.52~0.60 档下限（UNRESOLVED-U8，不静默外推）
 * 实际取值：默认取【区间下限】（m 小 → F=k·G/(m·t·√H) 大 → 安全侧），
 *   标记为 Casting Toolbox V1 安全侧策略 —— 非经验表原文规定。
 */
export const EXP_M_BANDS = [
  { min: 0, max: 3, lo: 0.25, hi: 0.30, inclMax: true },   // 约 3mm 最小档（含 <3mm，V1 保守并入）
  { min: 3, max: 5, lo: 0.30, hi: 0.38 },
  { min: 5, max: 7, lo: 0.38, hi: 0.45 },
  { min: 7, max: 9, lo: 0.45, hi: 0.52 },
  { min: 9, max: Infinity, lo: 0.52, hi: 0.60 },           // 9~12 档延伸：>12 保守沿用（U8）
];
/** 壁厚 → M 工程经验档（顺序匹配，首档含 3mm：w≤3 → 0.25~0.30） */
export function expIngateM(wallMm) {
  const w = Number(wallMm);
  if (!Number.isFinite(w) || w <= 0) return null;
  const band = EXP_M_BANDS.find((b) => (b.inclMax ? w <= b.max : w >= b.min && w < b.max));
  if (!band) return null;
  return { lo: band.lo, hi: band.hi, over12: w > 12 };
}

/** 加压式垂直流道裕度：≥ 相连全部内浇口总截面积 ×(1+10~20%)，每 90° +10~20%
 *  （6.8.1 p6.57）；算例取 15%（6.11.3.2）。 */
export const RUNNER_MARGIN_P = 0.15;

/** 减压式进入型腔前（横浇道/内浇口）流速限 1 m/s —— 6.11.4.5（p6.133） */
export const V_CAVITY_MAX_MS = 1.0;

/** 垂直流道最小截面 4/8×8=48mm²（"不建议小于"，6.11.4.1 p6.131） */
export const V_RUNNER_MIN_MM2 = 48;
/** 水平流道最小截面 5/10×10=75mm²（6.11.4.5 p6.133） */
export const H_RUNNER_MIN_MM2 = 75;

/** 内浇口厚度 s = 铸件模数 Mc 的 25%~100%；s<1mm 不可用 —— 6.10.12（p6.111） */
export const S_FRAC_MIN = 0.25;
export const S_FRAC_MAX = 1.0;
/** 算例默认 s=3mm（Mc=0.67cm→1.7~6.7mm 内）—— 6.11.3.1/6.11.4.6 */
export const S_DEFAULT_MM = 3;

/** 浇口杯校核产出率默认 70%（6.11.3.4 算例） */
export const YIELD_DEFAULT = 0.7;

/**
 * 内浇口厚度 s 自动推荐（V1.1，UI 同 t 模式：自动值可直接改）
 * 依据（两级锚定 DISA 手册体系，不采用通用教材 50~80% 口径）：
 *   ① 手册 6.10.12：s = 铸件模数 Mc 的 25%~100%（s<1mm 不可用）；
 *   ② 手册 6.11.3.1 算例：Mc=0.67cm（壁厚 20 的 ≈1/3，板盘类近似）→ s=45%×Mc=3mm。
 *   合成：s_rec = max(1, 0.15×wall) —— 自动落在 [0.25,1.0]×Mc 内（Mc≈wall/3），
 *   且 wall=20 → 3mm 精确复现手册例。
 * 注：Mc≈壁厚/3 为板/盘类薄壁件工程近似（手册例反推；见 VALIDATION REPORT）。
 */
export const recommendIngateS = (wallMm) => Math.max(1, Math.round(Math.max(0, wallMm) * 0.15 * 2) / 2);

/**
 * 图 6.38 损失因数查表（V1.1 已按位置化文本还原三列；手册 6.9.2.1/图 6.38, p6.64）：
 *   内浇口形状比（宽:厚 = L:s）1-1.5 → m 0.3（高摩擦）；2-3 → 0.5（较低）；3-5 → 0.6（很低）。
 * 边界约定（手册档间有间隙未说明）：r ≤ 1.5 → 0.3；1.5 < r ≤ 3 → 0.5；r > 3 → 0.6（不继续外推）。
 * ⚠️ 手册算例（6.11.3.1）全层统一取 m=0.5，其顶层口 L/s=3.5 已入 3-5 档仍取 0.5——
 *    本工具引擎缺省 m 随手册例（0.5），此查表作参考建议展示（见 UI"形状比"注），不覆盖引擎默认。
 */
export const gateLossMFromRatio = (r) => (r <= 1.5 ? 0.3 : r <= 3 ? 0.5 : 0.6);

/**
 * 由浇口几何量换算平均有效静压头 H（手册 6.9.2.3 公式 3/4, p6.65-67；V1.1）
 *   type: 'top' 顶部（口在铸件顶缘） H = a
 *         'bottom' 底部（口在铸件底部，铸件高 c） H = a − c/2
 *         'side' 侧面（口在侧壁，口到铸件顶高 b） H = a − b/2
 *   a = 浇口杯液面 → 内浇口的垂直距离 [mm]；bc = c 或 b [mm]（top 时忽略）
 */
export const headFromPosition = (type, a, bc) => {
  const A = Number(a), B = Number(bc);
  if (!Number.isFinite(A) || A <= 0) return NaN;
  let H = A; // top：H = a
  if (type === 'bottom' || type === 'side') {
    if (!Number.isFinite(B)) return NaN;
    H = A - B / 2; // bottom：H = a − c/2；side：H = a − b/2（手册公式 3/4）
  }
  return H > 0 ? H : NaN; // 几何不成立（如 c/2 ≥ a → 内浇口高于液面）→ NaN
};
/** 每型两面布置同型腔组（手册算例 12 件 = 2 面 × 每面 6 件）—— 6.11.3.4 */
export const FACES_PER_MOLD = 2;

/**
 * 标准梯形流道取型：a/2a×2a 简单梯形面积 = 3a²（手册图 6.49 p6.90）。
 * 取型规则：a = 0.5mm 网格向上取整使 3a² ≥ 所需面积。
 *   验证（复现手册选型）：减压例 133.8→a7(147)、230.9→a9(243)、
 *   322.5→a10.5(330.75)、64.3→a5(75)、26.4→a3→受最小 48 约束→a4(48)；
 *   加压例 F5 300→a10。加压 F4 手册取非标 a=8（标注 172 与实际 192 不符）
 *   → V1 按本规则 a=7.5（168.75 ≥ 166.1），差异见 UNRESOLVED-U6。
 */
export const runnerAFromArea = (area, grid = 0.5) =>
  Math.max(0, Math.ceil(Math.sqrt(Math.max(0, area) / 3) / grid) * grid);
export const trapezoidArea = (a) => 3 * a * a;

/** 浇注时间规范化：夹到 [0.5, 60] s，四舍五入 1 位小数（手册例 4.18→4.2） */
export const normTime = (t) => {
  if (!Number.isFinite(t) || t <= 0) return NaN;
  return Math.min(60, Math.max(0.5, Math.round(t * 10) / 10));
};
/** 0.5 网格向上取整（内浇口长度/流道 a 建议） */
export const ceilHalf = (x) => Math.ceil(Math.max(0, x) * 2) / 2;

// ------------------------------------------------------------
// 6.9.2.7 浇注时间标准
// ------------------------------------------------------------
/** B 表取值（G kg；1<G<4 线性插值 —— UNRESOLVED-U2） */
export function pourB(wallMm, Gkg) {
  const band = WALL_BANDS.find((b) => Gkg > 0 && wallMm > b.min && wallMm <= b.max)
    ?? (wallMm <= 3 ? WALL_BANDS[0] : WALL_BANDS[3]);
  const { bSmall, bLarge } = POUR_B_TABLE[band.key];
  if (Gkg <= 1) return bSmall;
  if (Gkg >= 4) return bLarge;
  return bSmall + (bLarge - bSmall) * (Gkg - 1) / 3;
}

/**
 * 推荐浇注时间 = min(两个标准)（手册 6.11.3.1 p6.127 的流程）：
 *   标准1（循环）：tmax1 = 3600/造型速度 − 输送 1.5 − 浇注系统填充 1.5
 *   标准2（浇注不满）：tmax2 = B·√Gc（轻金属 B×1.5）
 * 例：480 型/h → tmax1=4.5；灰铁 0.7kg/壁厚20 → tmax2=5×√0.7=4.2 → tRec=4.2
 *   （手册再取整为 4 s 以留余量 —— UI 上可直接改 t）
 */
export function recommendedPourTime({ mat, Gc, wallMm, moldSpeed, lightFactor = LIGHT_B_FACTOR }) {
  if (!(Number.isFinite(Gc) && Gc > 0) || !(Number.isFinite(wallMm) && wallMm > 0)) return null;
  const b = pourB(wallMm, Gc);
  const bUsed = VG_MATERIALS[mat]?.lightMetal ? b * lightFactor : b;
  const tmax2 = bUsed * Math.sqrt(Gc);
  const tmax1 = (Number.isFinite(moldSpeed) && moldSpeed > 0)
    ? 3600 / moldSpeed - T_TRANS_S - T_FILL_S : null;
  const cands = tmax1 != null ? [tmax1, tmax2] : [tmax2];
  const tRec = normTime(Math.min(...cands));
  if (!Number.isFinite(tRec)) return null;
  const note = [];
  if (tmax1 != null) note.push(`循环标准：3600/${moldSpeed} − 1.5 − 1.5 = ${(Math.round(tmax1 * 10) / 10).toFixed(1)} s（手册 6.11.3.1）`);
  note.push(`浇注不满标准：tmax2 = B√G = ${bUsed}×√${Gc} = ${(Math.round(tmax2 * 10) / 10).toFixed(1)} s（手册 6.9.2.7，B 表）`);
  if (VG_MATERIALS[mat]?.lightMetal) note.push('轻金属：B 按手册 ×1.5~2.0（V1 取 1.5，可改）');
  return { tmax1, tmax2, tRec, b, bUsed, note };
}

// ------------------------------------------------------------
// 6.9.2 核心截面公式
// ------------------------------------------------------------
/** F = k·G/(m·t·√H)（手册公式 8，p6.67-69）→ mm² */
export const secArea = (k, G, m, t, Hmm) => k * G / (m * t * Math.sqrt(Hmm));

/** 内浇口/截面速度 V = m·√(2gH)（mm/s → m/s；手册公式 2） */
export const gateVelocityMs = (m, Hmm) => m * Math.sqrt(2 * G_MM_S2 * Hmm) / 1000;

/**
 * 受控流量速度 v = G/(ρ·t·F)（mm/s → m/s）：开放/减压系统的口速由
 *   流量与面积决定（手册 6.11.4.5 限 1 m/s 的校验口径），与自由落体
 *   速度（6.9.2.11 加压式口径）不同。
 */
export const flowVelocityMs = (Gkg, rhoKgMm3, t, Fmm2) =>
  (Gkg > 0 && rhoKgMm3 > 0 && t > 0 && Fmm2 > 0) ? Gkg / (rhoKgMm3 * t * Fmm2) / 1000 : NaN;

// ------------------------------------------------------------
// 几何建议（工程输出层：recommendation，非手册 Calculation）
// ------------------------------------------------------------
/** 垂直/水平流道标准选型：最小简单梯形 3a² ≥ req（可加最小截面下限） */
export function runnerStd(req, min = 0) {
  const a = runnerAFromArea(Math.max(req, min));
  return { a, area: trapezoidArea(a), dims: `${a}/${a * 2}×${a * 2}` };
}
/** 内浇口尺寸建议：厚 s、长 l=⌈F/s⌉0.5 网格，实际面积 ≥ F（UNRESOLVED-U5 见文末） */
export function gateDims(Fmm2, s) {
  const l = ceilHalf(Fmm2 / s);
  return { s, l, area: s * l };
}
/** 每层件数数组（默认每层 2 件 —— 手册算例对称两侧各 1 件） */
const defaultN = (H) => H.map(() => 2);

/** 按 H 降序（底→顶 b=0..L-1）重排 (H, n) —— 减压/不加压/混合的流道段需要 */
function bottomUp(H, n) {
  const idx = H.map((_, i) => i).sort((a, b) => H[b] - H[a]);
  return { H: idx.map((i) => H[i]), n: idx.map((i) => n[i]) };
}

// ============================================================
// 主入口
// ============================================================
/**
 * @param {{
 *   mat:'灰铸铁'|'铝合金'|'铜合金', system:'pressurized'|'decompressed'|'nonpressurized'|'mixed',
 *   Gc:number, wallMm:number, moldSpeed?:number,
 *   H:number[],                 // 每层平均有效静压头 mm（顺序无关，内部自动识别方向）
 *   n?:number[],                // 每层件数（默认 2）
 *   t?:number,                  // 进型腔浇注时间 s（缺省自动推荐，UI 可改）
 *   sIngate?:number,            // 内浇口厚 mm（默认 3）
 *   mIngate?:number, mRunner?:number, runnerMargin?:number, yieldRate?:number,
 * }} input
 */
export function runVerticalGating(input) {
  const {
    mat, system, Gc, wallMm, moldSpeed, H,
    t: tUser, sIngate = S_DEFAULT_MM, sPerLayer, mIngate, mRunner = M_RUNNER,
    runnerMargin = RUNNER_MARGIN_P, yieldRate = YIELD_DEFAULT, n,
  } = input || {};

  const M = VG_MATERIALS[mat];
  const fail = (error) => ({ ok: false, error });
  if (!M) return fail(`材料「${mat}」无手册系数（手册仅提供灰铸铁/铝合金/铜合金，见 UNRESOLVED-U1）`);
  if (!Number.isFinite(Gc) || !(Gc > 0)) return fail('单件重量需为 >0 的数字');
  if (!Number.isFinite(wallMm) || !(wallMm > 0)) return fail('最薄壁厚需为 >0 的数字');
  if (!Array.isArray(H) || H.length < 1 || H.length > 8) return fail('层数需在 1~8 之间');
  if (H.some((h) => !Number.isFinite(h) || !(h > 0))) return fail('每层静压头需为 >0 的数字');
  const SYSTEMS = ['pressurized', 'decompressed', 'nonpressurized', 'mixed'];
  if (!SYSTEMS.includes(system)) return fail(`浇注方式非法：${system}`);
  const nArr = (Array.isArray(n) && n.length === H.length) ? n.map(Number) : defaultN(H);
  if (nArr.some((v) => !Number.isInteger(v) || v < 1 || v > 64)) return fail('每层件数需为 1~64 的整数');
  if (!Number.isFinite(sIngate) || !(sIngate > 0)) return fail('内浇口厚度需为 >0 的数字');
  if (sIngate < 1) return fail(`内浇口厚度 ${sIngate}mm < 1mm 不可用（手册 6.10.12）`);
  // 分层内浇口厚度（Step4：默认统一 sIngate；加压/混合可逐层 override）
  // 校验：每层 >0 且 ≥1mm（手册 6.10.12）；减压/不加压为"各层同尺寸"（手册明示），忽略 sPerLayer
  if (system === 'pressurized' || system === 'mixed') {
    if (Array.isArray(sPerLayer) && sPerLayer.length !== H.length) {
      return fail(`分层内浇口厚度数量（${sPerLayer.length}）与层数（${H.length}）不符`);
    }
  }
  const sLay = (Array.isArray(sPerLayer) && sPerLayer.length === H.length && (system === 'pressurized' || system === 'mixed'))
    ? sPerLayer.map(Number) : null;
  if (sLay) {
    for (let i = 0; i < sLay.length; i++) {
      if (!Number.isFinite(sLay[i]) || !(sLay[i] >= 1)) return fail(`层${i + 1} 内浇口厚度 ${sLay[i]}mm 非法：需 ≥1mm（手册 6.10.12）`);
    }
  }
  const sOf = (i) => (sLay ? sLay[i] : sIngate);
  if (!Number.isFinite(yieldRate) || yieldRate <= 0 || yieldRate > 1) return fail('产出率需在 (0,1]');
  // 内浇口 m：缺省 = 壁厚→工程经验区间下限（PHASE 70.1）；显式传值 = 用户值
  const expM = expIngateM(wallMm);
  const mSrc = (mIngate != null && Number.isFinite(Number(mIngate)))
    ? { used: Number(mIngate), src: 'user', exp: expM }
    : expM
      ? { used: expM.lo, src: 'exp-safe-low', exp: expM }
      : { used: M_INGATE, src: 'disa-example', exp: null };
  if (!(mSrc.used > 0 && mSrc.used <= 1)) return fail('内浇口损失因数 m 需在 (0,1]');
  if (!(Number.isFinite(mRunner) && mRunner > 0 && mRunner <= 1)) return fail('流道损失因数 m 需在 (0,1]');

  // ── 浇注时间：用户给定 或 自动推荐（UI 展示推荐并允许覆盖） ──
  let tSrc;
  if (tUser != null && Number.isFinite(tUser) && tUser > 0) tSrc = { t: tUser, source: 'user' };
  else {
    const rec = recommendedPourTime({ mat, Gc, wallMm, moldSpeed });
    if (!rec) return fail('无法确定推荐浇注时间：请检查重量/壁厚（或直接输入浇注时间）');
    tSrc = { t: rec.tRec, source: 'auto', rec };
  }
  const t = tSrc.t;
  const t0 = t + T_FILL_S;

  const L = H.length;
  const nTotalFace = nArr.reduce((a, x) => a + x, 0);

  // 每层"加压式单口"（手册公式；四方式内浇口均从该式起步，方式间差异在于：
  // 减压/不加压再按"同时浇注/均分"规则统一，见下）
  const mIngateUsed = mSrc.used;
  const ing = H.map((Hmm, i) => {
    const Fsingle = secArea(M.k, Gc, mIngateUsed, t, Hmm);
    return { level: i + 1, H: Hmm, n: nArr[i], Fsingle, Flevel: nArr[i] * Fsingle,
      vMs: gateVelocityMs(mIngateUsed, Hmm) };
  });

  const res = {
    ok: true, mat, system, Gc, wallMm, moldSpeed, L,
    material: { k: M.k, rhoKgMm3: M.rhoKgMm3, vGateMax: M.vGateMax, label: M.label },
    t, t0, tSource: tSrc.source, ...(tSrc.rec ? { tRec: tSrc.rec } : {}),
    sIngate, mIngate, mRunner, runnerMargin, yieldRate, nPerLevel: nArr, nTotalFace,
    gates: [], runnerSegs: [], horiz: null, summary: null,
    basis: { formulas: [], warnings: [], unresolved: [], recommendations: [] },
    process: [],
  };
  const push = (s) => res.process.push(s);

  if (system === 'pressurized') {
    // ── 加压式（6.11.3）：内浇口逐层不同（各层 H 进公式）＝节流 ──
    // 垂直流道 F4 ≥ (1+margin)×Σ层口总面积（6.11.3.2：例 ×1.15）
    res.gates = ing.map((g, i) => ({ ...g, kind: 'ingate', perCavity: true,
      dims: gateDims(g.Fsingle, sOf(i)),
      shapeRatio: g.Fsingle / (sOf(i) * sOf(i)),
      lossRef: gateLossMFromRatio(g.Fsingle / (sOf(i) * sOf(i))) }));
    const F4req = ing.reduce((a, g) => a + g.Flevel, 0) * (1 + runnerMargin);
    const F4 = runnerStd(F4req, V_RUNNER_MIN_MM2);
    res.runnerSegs = [{ id: 'F4', req: F4req, a: F4.a, Fstd: F4.area, dims: F4.dims,
      note: `垂直流道：≥ Σ各层口面积 ×(1+${Math.round(runnerMargin * 100)}%)（6.11.3.2；每 90° 转弯 +10~20%，6.8.1）` }];
    res.summary = { choke: '内浇口（逐层，各自决定浇注时间）', F4req, F4 };
    res.basis.recommendations.push({ text: '上部水平流道（浇口杯下方）建议选型 a≈1.25×F4 的 a（手册例：F4 a=8 → F5 10/20×20=300mm²）—— 布置相关，V1 给参考不给公式。' });
    push(`加压式（6.11.3.1）：F_i = k·Gc/(m·t·√H_i)，k=${M.k}、G=单件 ${Gc}kg、t=${t}s、m=${mIngateUsed}${mSrc.src !== 'user' ? `（壁厚经验区间下限；区间 ${expM ? expM.lo + '~' + expM.hi : '—'}）` : '（用户指定）'}`);
    push(`垂直流道 F4 ≥ Σ(n_i·F_i)×1.15 = ${F4req.toFixed(1)} mm²（6.11.3.2，例 165.6）`);
  } else if (system === 'decompressed') {
    // ── 减压式（6.11.4）：垂直流道按加压式逐段（m=0.7），段 G=其下游全部铸件 ──
    //   内浇口：各型腔同时浇注 → 全部层同尺寸、位于铸件底部（6.11.4.6）
    const { H: Hb, n: nb } = bottomUp(H, nArr);
    const nCum = []; let acc = 0;
    for (let b = 0; b < L; b++) { acc += nb[b]; nCum.push(acc); }
    const segs = Hb.map((h, b) => {
      const Gseg = nCum[b] * Gc;
      const req = secArea(M.k, Gseg, mRunner, t, h);
      const st = runnerStd(req, V_RUNNER_MIN_MM2);
      return { segNo: b + 1, H: h, nDown: nCum[b], Gseg, req, a: st.a, Fstd: st.area, dims: st.dims };
    });
    const F1 = segs[0]; // 底段（最大 H）
    // 6.11.4.5/6：进腔前流速限 1 m/s → 分支/内浇口 ≥ ½·F1_std×(V1/1.0)
    //   （例：V1=1.9 → ½×48×1.9=45.6；手册取 F8≥45.6→5/10×10=75、F9=16×3=48）
    const V1ms = gateVelocityMs(mRunner, F1.H);
    const branchReq = 0.5 * F1.Fstd * Math.max(V1ms / V_CAVITY_MAX_MS, 1);
    const F8 = runnerStd(branchReq, H_RUNNER_MIN_MM2);
    const F9 = gateDims(branchReq, sIngate);
    res.runnerSegs = segs.map((s, i) => ({ id: `Fv${s.segNo}`, ...s,
      note: `垂直流道第 ${s.segNo} 段（自下而上）：供下游 ${s.nDown} 件 = ${s.Gseg}kg` }));
    res.horiz = { basis: `每层横浇道两侧各一支：≥ ½·F1_std×V1 = ½×${F1.Fstd}×${V1ms.toFixed(2)} = ${branchReq.toFixed(1)} mm²，下限 5/10×10（6.11.4.5）`,
      branchReq, F8a: F8.a, F8std: F8.area, F8dims: F8.dims, sameForAllLevels: true };
    const vGateCtrl = flowVelocityMs(Gc, M.rhoKgMm3, t, F9.area); // 减压：口速由流量/面积决定（设计 ≤1 m/s）
    res.gates = Hb.map((h, b) => ({
      level: b + 1, H: h, n: nb[b], kind: 'ingate', perCavity: true,
      sameForAllLevels: true, Fsingle: F9.area, dims: F9,
      vMs: vGateCtrl,
      basis: `内浇口 ≥ ½·F1_std×(V1/1.0) = ${branchReq.toFixed(1)} mm² → 建议 ${F9.l}×${F9.s}（6.11.4.6）` }));
    res.summary = { choke: '通向减压部分的截面（垂直流道底部段出口处）', F1, V1ms, F9, F8 };
    res.basis.recommendations.push({ text: '手册另含"顶部连接段 F4"与"上横流道（人为取保守小头 H=40 再按实际/平均头比放大）"两步 —— 布置相关，V1 未实现（见 UNRESOLVED-U7）。' });
    push(`减压式（6.11.4.1）：垂直流道按加压公式逐段，m=${mRunner}（宽流道损失小）；段 G=其供液下游全部铸件重`);
    push(`底段流速 V1 = m√(2gH) = ${V1ms.toFixed(2)} m/s；进腔限速 1 m/s（6.11.4.5）→ 分支/内浇口 ≥ ½·F1×V1 = ${branchReq.toFixed(1)} mm²`);
    push('内浇口：各型腔同时浇注 → 全部层同尺寸（6.11.4.6 明示）');
  } else if (system === 'mixed') {
    // ── 混合式（6.11.6）：管道 = 减压式；内浇口 = 加压式逐层（6.11.6.2） ──
    const dec = runVerticalGating({ ...input, system: 'decompressed', t });
    if (!dec.ok) return dec;
    res.gates = ing.map((g, i) => ({ ...g, kind: 'ingate', perCavity: true,
      dims: gateDims(g.Fsingle, sOf(i)),
      shapeRatio: g.Fsingle / (sOf(i) * sOf(i)),
      lossRef: gateLossMFromRatio(g.Fsingle / (sOf(i) * sOf(i))),
      basis: '混合式内浇口按加压式公式逐层计算（6.11.6.2）' }));
    res.runnerSegs = dec.runnerSegs;
    res.horiz = dec.horiz;
    res.summary = { choke: '垂直流道与内浇口相互平衡（混合式）', dec: dec.summary };
    push('混合式（6.11.6.1/2）：浇口杯/上横流道/垂直流道/浇口窝/中间与下部流道 = 减压式计算；内浇口 = 加压式计算');
  } else if (system === 'nonpressurized') {
    // ── 不加压式（6.11.5）：节流 = 上部水平流道；垂直流道例比例 1.42×；
    //   总口面积 = F4×1.2、各腔同尺寸（6.11.5.3） ──
    //   上横流道：按"全部铸件流量、m=0.7、人为保守头 40mm"计算（手册 6.11.4.2
    //   的做法用于不加压例 6.11.5.1）；手册再按实际/平均头比放大（布置相关，
    //   未实现，UNRESOLVED-U7）→ 例差 −24% 记录于验证报告。
    const GAll = nTotalFace * Gc;
    const Htop = H.reduce((a, x) => Math.min(a, x), Infinity); // 最上层头
    const Hup = Math.min(Htop, 40); // 手册 6.11.4.2：选小头确保足够大
    const F5req = secArea(M.k, GAll, mRunner, t, Hup);
    const F5 = runnerStd(F5req);
    const F4req = 1.42 * F5.area;                     // 例比例 468.75/330.75（UNRESOLVED-U4）
    const F4 = runnerStd(F4req);
    const FgPerCavity = F4.area * 1.2 / nTotalFace;   // 例：468.75×1.2/6 = 93.75
    const dims = gateDims(FgPerCavity, sIngate);
    const vGateCtrl = flowVelocityMs(Gc, M.rhoKgMm3, t, FgPerCavity); // 开放系统：口速由流量决定
    res.runnerSegs = [
      { id: 'F5', req: F5req, a: F5.a, Fstd: F5.area, dims: F5.dims,
        note: `上部水平流道（节流）：G=全部 ${GAll}kg、m=${mRunner}、保守头 ${Hup}mm（6.11.4.2 做法；布置放大未实现 U7）` },
      { id: 'F4', req: F4req, a: F4.a, Fstd: F4.area, dims: F4.dims,
        note: '垂直流道 = 上横流道选型 ×1.42（手册算例比例；文字"两倍"与之不符，U4）' },
    ];
    res.gates = ing.map((g, i) => ({ ...g, kind: 'ingate', perCavity: true,
      sameForAllLevels: true, Fsingle: FgPerCavity, dims, vMs: vGateCtrl,
      basis: `总口面积 = F4×1.2 = ${(F4.area * 1.2).toFixed(0)} → 每腔 = ÷${nTotalFace}（6.11.5.3）` }));
    res.summary = { choke: '上部水平流道（靠近浇口杯，6.11.5.1）', F5, F4, FgPerCavity };
    push(`不加压式（6.11.5）：上部水平流道流量=全部铸件 ${GAll}kg；垂直流道=上横×1.42（例比例）；总口面积=F4×1.2 均分各腔`);
    push(`内浇口：全部层同尺寸（各腔同时浇注，6.11.5.3：F3=F2=F1）`);
  }

  // ── 通用：口速校验（6.9.2.11 材料最大速度）──
  const vLimit = M.vGateMax / 1000;
  res.vLimitMs = vLimit;
  // m 来源标注（PHASE 70.1）：工程经验参考 + V1 安全侧取值策略
  res.mInfo = {
    used: mSrc.used,
    src: mSrc.src,
    srcLabel: mSrc.src === 'exp-safe-low' ? '壁厚→工程经验区间下限（V1 安全侧）'
      : mSrc.src === 'user' ? '用户指定' : 'DISA 算例取用值（6.11.3.1）',
    exp: expM ? { lo: expM.lo, hi: expM.hi, over12: expM.over12 } : null,
  };
  const warnedV = new Set();
  for (const g of res.gates) {
    const key = Math.round(g.vMs * 100);
    if (warnedV.has(key)) continue;
    warnedV.add(key);
    if (g.vMs > vLimit) res.basis.warnings.push(`层${g.level}（H=${g.H}mm）：口速 ${g.vMs.toFixed(2)} m/s > 手册最大 ${vLimit} m/s（6.9.2.11 表：${mat}）`);
  }

  // ── 浇口杯校核（6.11.3.4）：平均浇注速度 = 总浇注重量/t0 ──
  const nTotalMold = nTotalFace * FACES_PER_MOLD;
  const GcastMold = nTotalMold * Gc;
  const GpourTotal = GcastMold / yieldRate;
  const wAvg = GpourTotal / t0;
  res.cup = { nTotalMold, GcastMold, GpourTotal, wAvg,
    note: `平均浇注速度 ≈ ${wAvg.toFixed(2)} kg/s → 按 DISA 标准浇口杯（图 6.46/6.47）选额定 ≥ 此值的杯号（手册例 2.2 kg/s → 3 号）` };

  res.basis.formulas = [
    { key: 'F', desc: 'F = k·G/(m·t·√H)', src: '手册 6.9.2（公式 8，p6.67-69）', note: `k=${M.k}（${mat}，p6.69）` },
    { key: 'H', desc: '平均有效静压头：顶部=a；底部=a−c/2；侧面=a−b/2（公式 3/4）', src: '手册 6.9.2.3（p6.65-67）' },
    { key: 't', desc: `t=${t}s（进型腔，${tSrc.source === 'user' ? '用户给定' : '自动推荐'}）；t0=t+1.5=${t0.toFixed(1)}s`, src: '手册 6.9.2.7/6.11.3 算例' },
    // PHASE 73 P1 修复：原先读 mSrc.srcLabel —— mSrc 只构造了 {used, src, exp}，没有 srcLabel，
    //   于是"依据"行永远渲染成 "（undefined；经验区间 …）"。正确来源是同一函数里已算好的
    //   res.mInfo.srcLabel（同一套 src 判定，值完全一致）。仅改取值来源，不动任何公式。
    { key: 'm', desc: `内浇口 m=${mSrc.used}（${res.mInfo.srcLabel}${mSrc.exp ? `；经验区间 ${mSrc.exp.lo.toFixed(2)}~${mSrc.exp.hi.toFixed(2)}` : ''}）、流道 m=${mRunner}`, src: mSrc.src === 'exp-safe-low' ? '国外现场工程经验（ENGINEERING_REFERENCE，非 DISA）；DISA 图 6.38/算例值 0.5 见 U3' : '手册 6.11.3.1/6.11.4.1（图 6.38 见 U3）' },
    { key: 'V', desc: 'V = m√(2gH)；材料最大速度经验值表', src: '手册 6.9.2.11（p6.79）' },
  ];
  const commonU = [
    { id: 'U1', text: '手册仅给铁/铜/铝三套 k 常数；球铁无单独 k → V1.1 用户批准并入灰铁（k=1036），限速取手册 600mm/s；铸钢等仍不支持（宁缺毋猜）。' },
    { id: 'U2', text: 'B 表只给 G≤1kg 与 G≥4kg 两档；1~4kg 插值手册未给 → V1 线性插值并标注，非手册直接给出。' },
    { id: 'U3', text: '图 6.38 已按位置化文本还原：口形状比(宽:厚=L:s) 1-1.5→m0.3、2-3→0.5、3-5→0.6（面积恒 100mm²）。但手册算例全层统一 m=0.5，其顶层口 L/s=3.5 已入 3-5 档仍取 0.5 —— 档间边界与例不一致 → 引擎缺省 0.5 随例，查表值作 UI 参考建议（gateLossMFromRatio）。' },
    { id: 'U5', text: '手册对内浇口长度取整无统一规则（15.2→16、6.17→6、10.4→10.5、31.25→31 混用）→ V1 统一 0.5 网格向上（实际 ≥ 计算面积，工程安全侧），逐处差异见验证报告。' },
    { id: 'U6', text: '加压例垂直流道"圆整到 172mm² 对应 8/16×16"与梯形公式（8+16)/2×16=192 不符 → V1 按 0.5 网格规则取 a=7.5（168.75≥166.1），与手册选型 a=8 的差异见验证报告。' },
    { id: 'U8', text: 'M 工程经验表仅给到壁厚约 12mm；>12mm 无数据 → V1 保守沿用 9~12 档下限 0.52 并标注（不静默外推）。' },
    { id: 'U9', text: 'M 工程经验表来源未明示适用材质（国外现场经验）→ V1 对全部材质套用并标注 ENGINEERING_REFERENCE。' },
  ];
  const npU = [
    { id: 'U4', text: '不加压式文字"垂直流道是上部水平流道的两倍"与算例实际面积比 468.75/330.75=1.42 不符 → 引擎按算例 1.42× 实现（UI 已不提供该方式：手册表 3 最不推荐，见 6.8.3/6.11.5）。' },
    { id: 'U7', text: '"顶部连接段/上横流道按实际头与平均头之比放大"为布置相关步骤（例中 192.5/135），引擎未实现 → 不加压上横流道结果低于手册例约 24%（245.7 vs 322.5mm²），见验证报告差异表。' },
  ];
  res.basis.unresolved = [...commonU, ...(system === 'nonpressurized' ? npU : [])];
  return res;
}

// ---- UI 映射 ----
export const VG_SYSTEMS = {
  pressurized: { name: '加压式', en: 'Pressurized', desc: '内浇口逐层按各自静压头计算（节流=内浇口）' },
  decompressed: { name: '减压式', en: 'Decompressed', desc: '垂直流道逐段加压计算；内浇口同尺寸底注（节流=减压段入口）' },
  mixed: { name: '混合式', en: 'Mixed', desc: '管道同减压式，内浇口同加压式逐层（6.11.6）' },
  nonpressurized: { name: '不加压式', en: 'Non-pressurized', desc: '开放系统；节流=上部水平流道，内浇口同尺寸（6.11.5）' },
};
