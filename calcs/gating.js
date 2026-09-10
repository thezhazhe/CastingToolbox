// ============================================================
// 浇注系统设计 · 纯计算模块（从 casting_design_web.html v3.8 提取）
// 公式来源：
//   浇注时间 T —— PHASE 47（47.txt 指定经典教材经验公式，材料分派：
//                 灰铁/球铁/铸钢针对性公式，铝/铜保持原 Dietert 扩展式）
//   阻流截面   —— 奥赞：A = 71.47 × G/(ρ·t·fv·√Hp) × 100（企业 Excel 22.6 式）
// ============================================================

// ---- 材料数据库（密度 ρ / 材质系数 f / 出品率区间） ----
// PHASE 28.6（43.txt A P0-3 审计）：rho 语义=液态金属密度（浇注系统流量计算用）。
//   来源：企业 Excel（浇注系统尺寸计算 F13 注释"液态金属密度"）——企业经验值，非物理标准值。
// PHASE 28.7-A（44.txt）：**已人工批准保持全部液态原值**（球铁 6.9/铝 2.6 等作为企业工艺参数保留，不得修改）。
//   注意：与 riser.js RISER_MATERIALS 的 rho（固态，球铁 7.1/铝 2.7）同材料不同值——液态/固态语义分开，勿合并。
// fc（材质系数）：PHASE 47 后仅用于铝合金/铜合金的 Dietert 浇注时间模型
//   （灰铁/球铁/铸钢改用 47.txt 针对性公式，不再使用 fc）。
export const MATERIALS = {
  '灰铁(HT)':   { rho: 7.0, fc: 1.00, y_min: 65, y_max: 85, y_sug: 75 },
  '球铁(QT)':   { rho: 6.9, fc: 0.85, y_min: 55, y_max: 75, y_sug: 65 },
  '铸钢(ZG)':   { rho: 7.5, fc: 0.80, y_min: 50, y_max: 65, y_sug: 58 },
  '铝合金(Al)': { rho: 2.6, fc: 1.20, y_min: 70, y_max: 90, y_sug: 80 },
  '铜合金(Cu)': { rho: 8.4, fc: 0.90, y_min: 55, y_max: 70, y_sug: 62 },
};

// ---- 浇注比例预设（S直 : S横 : S内） ----
export const RATIO_PRESETS = {
  '封闭式 保守型(灰铁)': { type: '封闭', r: [1.0, 1.5, 0.8],  note: '阻流在内浇口' },
  '封闭式 常用型':       { type: '封闭', r: [1.0, 2.0, 0.85], note: '阻流在内浇口' },
  '封闭式 大件型':       { type: '封闭', r: [1.0, 2.5, 0.9],  note: '阻流在内浇口' },
  '开放式 标准型':       { type: '开放', r: [1.0, 2.0, 2.0],  note: '阻流在直浇道' },
  '开放式 宽大型':       { type: '开放', r: [1.0, 2.5, 2.5],  note: '阻流在直浇道' },
  '开放式 铝合金属':     { type: '开放', r: [1.0, 3.0, 3.0],  note: '阻流在直浇道' },
};

// ---- 浇注系统类型智能推荐（按材料家族 + 铸件重量） ----
// 原理：有色合金（铝/铜）与球铁/铸钢常用开放式（阻流在直浇道）平稳充型防氧化；
//       灰铁常用封闭式（阻流在内浇口）；大件升档为大件型。
export function recommendGatingRatio(matKey, partWt) {
  const byMat = {
    '灰铁(HT)':   '封闭式 常用型',
    '球铁(QT)':   '开放式 标准型',
    '铸钢(ZG)':   '开放式 宽大型',
    '铝合金(Al)': '开放式 铝合金属',
    '铜合金(Cu)': '开放式 标准型',
  };
  let rec = byMat[matKey] || '封闭式 常用型';
  if (partWt > 200) {
    const big = {
      '灰铁(HT)':   '封闭式 大件型',
      '球铁(QT)':   '开放式 宽大型',
      '铸钢(ZG)':   '开放式 宽大型',
      '铝合金(Al)': '开放式 宽大型',
      '铜合金(Cu)': '开放式 宽大型',
    }[matKey];
    if (big) rec = big;
  }
  return rec;
}

// 水口盆高度 Hb 查表（按浇注重量 G 分段）
function calc_Hb(G) {
  if (G < 10)     return 150;
  if (G < 50)     return 200;
  if (G < 200)    return 250;
  if (G < 1000)   return 300;
  if (G < 3000)   return 500;
  if (G < 8000)   return 750;
  return 1100;
}

// 浇注时间 T (s) —— PHASE 47（47.txt 正式指定，唯一权威入口）
//   W = castingMass（= 单件×型腔数；PHASE 49 定稿：时间公式 W 只取铸件本体质量，不出品率）
//   t_wall = 主体/代表性壁厚（mm）
// 分派（材料针对性成熟经验公式；铝/铜无可靠替换依据 → 保持原 Dietert 模型）：
//   灰铁  W≤450: T = 0.70(1.41 + t_wall/14.59)·√W；W>450: T = 0.70(1.236 + t_wall/16.65)·∛W
//   球铁  T = K₁·√W，K₁ 按壁厚严格分档（t<10→2.080；10≤t≤25→2.670；t>25→2.970）
//   铸钢  T = (2.4335 − 0.3953·log₁₀W)·√W（不用壁厚）
//   铝/铜 T = f·(√W + ∛(t_wall·W/5))·2/3（原 Dietert，f = MATERIALS 材质系数）
// 未知材料沿用现有 fallback（静默当灰铁，mdFellBack 提示仍由 runGating 输出）。
export function calc_t(mat, W, wall) {
  if (!(W > 0)) return 0;
  const fam = MATERIALS[mat] ? mat : '灰铁(HT)';
  if (fam === '灰铁(HT)') {
    return W <= 450
      ? 0.70 * (1.41 + wall / 14.59) * Math.sqrt(W)
      : 0.70 * (1.236 + wall / 16.65) * Math.cbrt(W);
  }
  if (fam === '球铁(QT)') {
    const K1 = wall < 10 ? 2.080 : wall <= 25 ? 2.670 : 2.970;  // 严格分档，不连续化
    return K1 * Math.sqrt(W);
  }
  if (fam === '铸钢(ZG)') {
    return (2.4335 - 0.3953 * Math.log10(W)) * Math.sqrt(W);
  }
  // 铝合金 / 铜合金：保持原模型（47.txt §6/§7 明确不改）
  const fc = MATERIALS[fam].fc;
  return fc * (Math.sqrt(W) + Math.pow(wall * W / 5, 1 / 3)) * 2 / 3;
}

// 平均静压头 Hp (mm)：顶注 / 中注 / 底注
// PHASE 28.3-B：中注改方案 A（企业 Excel 原式，已真实案例验证 100% 复现，39.txt 正式批准）：
//   中注 Hp = Ho + Hb/2 − (Pv + riserHeight)²/(2C)，Pv = C/2（中注面在件高一半），C = ph + riserHeight
//   rh=0（无冒口）时退化为文献式 Ho + Hb/2 − C/8 ✓（海德曼基座 153.9/320.5 回归锁定）
export function calc_Hp(pos, Ho, Hb, P, C, rh) {
  if (pos === '顶注') return Ho + Hb / 2 - rh * rh / (2 * C);
  if (pos === '中注') return Ho + Hb / 2 - (P + rh) * (P + rh) / (2 * C);
  return Ho + Hb / 2 - Ho / 2; // 底注
}

// 阻流截面积 A_choke (mm²) —— 奥赞：A = 71.47 × G / (ρ×t×fv×√Hp) × 100
export function calc_A(G, rho, t, fv, Hp) {
  if (t <= 0 || Hp <= 0) return 0;
  return 71.47 * G / (rho * t * fv * Math.sqrt(Hp)) * 100;
}

// 内浇口流速 v (m/s)
// PHASE 28.3-C：企业经验标准（Excel 无缺陷工艺审核 R7）——封闭式 ≤1.5 / 开放式 ≤1.0 m/s。
//   标注：企业经验标准审核红线（R7 参考面=内浇口，Excel K16 同形公式，PHASE 48-A 溯源确认）。
export const V_LIMIT = { 封闭: 1.5, 开放: 1.0 };
export function calc_v(G, rho, t, F) {
  if (t > 0 && F > 0) return 10 * G / (t * rho * F / 100);
  return 0;
}

// 材料目标平均内浇口速度（PHASE 48-B FINAL，49.txt 定案：Casting Toolbox 工程设计目标）
//   t  = 目标速度（A_target = Q/v_target 反算依据）
//   lo/hi = 推荐区间（球铁/铝 0.40~0.50；灰铁只有上限 1.00）
//   v_theory（内部特征流速 fv·√(2gHp)）> hi 时自动放大内浇口至 A_target；
//   < lo 时提示偏低但**不缩小**已够面积（49.txt §五）。
// 铸钢/铜：本阶段不设目标、不自动调整（仅显示结果，49.txt §二）。
export const V_TARGET = {
  '灰铁(HT)':   { t: 1.00, hi: 1.00 },
  '球铁(QT)':   { t: 0.45, lo: 0.40, hi: 0.50 },
  '铝合金(Al)': { t: 0.45, lo: 0.40, hi: 0.50 },
};

// ---- 主计算：返回完整结果对象 ----
export function runGating(input) {
  // PHASE 28.6（P0-3）：密度接线——input.rho 显式覆盖（manifest 层在项目 liquidDensity 为
  //   USER_OVERRIDE 时传入，修复"用户改密度不生效"的静默脱节）；默认仍用内部表（行为不变）。
  //   未知材料不再静默：mdFellBack 标记供 UI/报告提示（数值不变，仅可观察）。
  const md = MATERIALS[input.mat] || MATERIALS['灰铁(HT)'];
  const rho = input.rho ?? md.rho, fc = md.fc;
  const mdFellBack = !MATERIALS[input.mat];

  const pw   = input.pw || 0;
  const cav  = input.cav || 1;
  const yv   = (input.yr || md.y_sug) / 100;
  const wall = input.wall || 0;
  const Ho   = input.Ho || 0;
  const ph   = input.ph || 0;
  const rh   = input.rh || 0;
  const pos  = input.pos || '顶注';

  // PHASE 49（50.txt）：重量变量职责分离，禁止同一变量承担两个物理定义——
  //   castingMass (W_c) = 单件铸件重量 × 型腔数（铸件本体质量）：仅 P47 浇注时间经验公式的 W 使用，不出品率
  //   pouringMetalMass (G) = W_c ÷ 出品率（浇注重量）：奥赞阻流面积/流量 Q/目标面积等下游全部使用
  const castingMass = pw * cav;

  // 比例预设 or 自定义
  let rd;
  if (input.custom) {
    rd = { type: '自定义', r: [input.cs || 1, input.cr || 1, input.cg || 1], note: '用户自定义比例' };
  } else {
    rd = RATIO_PRESETS[input.ratioKey] || RATIO_PRESETS['封闭式 保守型(灰铁)'];
  }
  const [s_r, r_r, g_r] = rd.r;

  // 浇注重量 G = pouringMetalMass = 铸件质量 ÷ 出品率（奥赞/流量口径，与 Excel K5/K22 一致）
  const G = yv > 0 ? castingMass / yv : 0;
  const Cmm = ph + rh;
  const Hb = calc_Hb(G);

  // P 值依浇注方向
  const Pv = pos === '顶注' ? 0 : pos === '中注' ? Cmm / 2 : Cmm;

  const Hp = calc_Hp(pos, Ho, Hb, Pv, Cmm, rh);
  // fv 流速系数：来源=企业 Excel 参数运算表（顶/中/底 0.8/0.6/0.45），
  //   企业规则"有过滤网降低 0.1"（工艺设计说明书 V3.2.2 参数运算表原文，PHASE 45-A 实施）。
  //   单点定义：input.filterUsed 时 fv−0.1，全项目唯一消费处（勿在别处重复扣减）。
  const fvBase = { 顶注: 0.8, 中注: 0.6, 底注: 0.45 }[pos] || 0.8;
  const fv = input.filterUsed ? fvBase - 0.1 : fvBase;

  const t = calc_t(input.mat, castingMass, wall);   // PHASE 47/49：P47 公式 W=castingMass（铸件本体质量，不出品率）
  const A = calc_A(G, rho, t, fv, Hp);              // 奥赞阻流面积用 G=pouringMetalMass（浇注重量）

  // PHASE 49（50.txt §四）：经验公式分界点工程提示（保留教材分段，不插值）
  let boundaryNote = null;
  if (input.mat === '灰铁(HT)' && castingMass > 0 && Math.abs(castingMass - 450) <= 450 * 0.05) {
    boundaryNote = `当前 W=${castingMass.toFixed(1)}kg 接近灰铁经验公式 450kg 分界点（±5%），请进行工程复核`;
  } else if (input.mat === '球铁(QT)' && (Math.abs(wall - 10) <= 1 || Math.abs(wall - 25) <= 1)) {
    boundaryNote = `当前壁厚 ${wall}mm 接近球铁 K₁ 壁厚分档点（10/25mm ±1mm），请进行工程复核`;
  }

  // 面积比例分配
  const min_r = Math.min(s_r, r_r, g_r);
  const A_sp  = A * (s_r / min_r);   // 直浇道参考面积
  const A_run = A * (r_r / min_r);   // 横浇道参考面积
  const A_gt  = A * (g_r / min_r);   // 内浇道参考面积（奥赞参考）
  const cp = min_r === g_r ? '内浇口' : min_r === s_r ? '直浇道' : '横浇道';

  // PHASE 48-B（49.txt）+ P50（51.txt）：按目标速度计算推荐总面积
  //   A_target = Q/v_target = 1000·G/(ρ·t·v_target)（Q=G/ρ·t 为充型流量）
  //   A_rec = max(A_gt 奥赞参考, A_target)——超速时放大、已够时不缩小（公式保留，50.txt §五 不回滚）
  //   v_theory=fv·√(2gHp) 保留为内部诊断值（不删除、不被覆盖）
  // P50（51.txt）：交互改为"用户主动一键优化"——
  //   input.optimize=false（默认）：几何基准 = A_gt（基础奥赞设计，不自动放大；超速仅提示+按钮）
  //   input.optimize=true（用户点击"按目标速度优化"后）：几何基准 = A_rec（放大到目标速度）
  //   阻流面积/浇注时间/G/Q 全程不变（只动内浇口几何）
  const vTarget = V_TARGET[input.mat] || null;
  const A_target = vTarget && t > 0 ? 1000 * G / (rho * t * vTarget.t) : 0;
  const A_rec = Math.max(A_gt, A_target);
  const vTheory = Hp > 0 ? Math.sqrt(2 * 9.81 * Hp / 1000) * fv : 0;   // 特征流速 fv·√(2gHp)
  const optimized = input.optimize === true && !!vTarget;               // P50：显式优化入口（布尔化：&& 会返回操作数）
  const geoArea = optimized ? A_rec : A_gt;                             // 几何面积基准（默认=基础）

  // 内浇道尺寸：形状=方形（个数×厚度→自动长度）或圆形（个数→自动直径，PHASE 45-B）
  //   面积基准 = geoArea（P50：默认 A_gt 基础；optimize 后 A_rec）；gateShape 默认方形
  const gateShape = input.gateShape === '圆形' ? '圆形' : '方形';
  const gc = input.gc || 0, gt = input.gt || 0;
  let L_g = 0, Fg = 0, D_g = 0;
  if (gateShape === '圆形') {
    if (gc > 0 && geoArea > 0) {
      // 直径向上取整（宁大勿小：内浇道偏小 → 流速超限风险）
      D_g = Math.max(3, Math.ceil(Math.sqrt(4 * geoArea / (gc * Math.PI))));
      Fg = gc * Math.PI * D_g * D_g / 4;
    }
  } else if (gc > 0 && gt > 0) {
    // PHASE 49（50.txt §十五）：目标面积驱动的设计尺寸一律 ceil——不得因 round 使实际面积小于目标面积
    const Lv = geoArea / (gc * gt);
    L_g = Math.max(5, Math.ceil(Lv / 5) * 5);
    Fg = gt * L_g * gc;
  }

  // 横浇道尺寸（长方形）：条数×厚度
  const rc = input.rc || 0, rt = input.rt || 0;
  let L_r = 0, Fr_act = 0;
  if (rc > 0 && rt > 0) {
    // P52（54.txt PART 10）：线性尺寸与内浇口同规则——目标面积驱动长度不得 round 致面积不足（P49 §十五 同原则）
    L_r = Math.max(10, Math.ceil(A_run / (rc * rt) / 5) * 5);
    Fr_act = rt * L_r * rc;
  }

  // 直浇道（1根圆形）——P52（54.txt PART 0）：圆形直径一律 ceil（P49 规则），
  //   原 Math.round 可使 Fs_act < A_sp（理论直径向下取整时），直浇道失去设计富余
  const D_sp = Math.max(5, Math.ceil(Math.sqrt(4 * A_sp / Math.PI)));
  const Fs_act = Math.PI * D_sp * D_sp / 4;

  // 实际比例
  let rrv = 0, rgv = 0;
  if (Fs_act > 0 && Fr_act > 0) {
    rrv = Fr_act / Fs_act;
    rgv = Fg / Fs_act;
  }

  // P51（52.txt）：阻流位置按最终实际几何面积判定（取整/ceil 后），非理论比例——
  //   A_choke_actual = min(Fs_act, Fr_act, Fg)；相对差 ≤1% 视为临界并列（boundary，纯判定不参与计算）
  //   systemType：ingate→封闭式（加压式）/ sprue→开放式（非加压式）/ runner→横浇道阻流（上游控制）
  const CHOKE_TOL = 0.01;   // 1% 临界容差（P51；纯判定，不改变任何计算面积）
  const chokeParts = [];
  if (Fs_act > 0) chokeParts.push(['sprue', Fs_act]);
  if (Fr_act > 0) chokeParts.push(['runner', Fr_act]);
  if (Fg > 0) chokeParts.push(['ingate', Fg]);
  let chokeArea = 0, chokePosition = null, systemType = null;
  if (chokeParts.length === 3) {
    chokeArea = Math.min(chokeParts[0][1], chokeParts[1][1], chokeParts[2][1]);
    const mins = chokeParts.filter((p) => Math.abs(p[1] - chokeArea) / chokeArea <= CHOKE_TOL).map((p) => p[0]);
    chokePosition = mins.length > 1 ? 'boundary' : mins[0];
    // P51 收尾（53.txt §二）：文案收紧——面积判断不包装成绝对物理分类，用"特征"表述
    systemType = chokePosition === 'ingate' ? '封闭式/加压式特征：内浇口为阻流截面'
      : chokePosition === 'sprue' ? '开放式/非加压式特征：直浇道为阻流截面'
        : chokePosition === 'runner' ? '横浇道阻流：上游截面控制流量' : '阻流位置临界：建议人工复核';
  } else {
    chokePosition = 'unset';   // 内浇口/某段未设时系统不完整，不做阻流判定
    chokeArea = Fs_act;
  }
  const ingateChoke = chokePosition === 'ingate';
  const boundaryChoke = chokePosition === 'boundary';

  // 流速（PHASE 48-B FINAL，49.txt）：
  //   v = Q/Fg 实际平均速度（几何已按 A_rec → 等于 v_final，保留两字段不互相覆盖）
  //   vFinal 是用户看到的"推荐平均内浇口速度"；vTheory 为内部诊断值（保留不删）
  //   vState：rec 推荐 / high 偏高（自动放大后理论不可达时） / low 偏低（可保留，不缩小） / none 无目标（铸钢/铜）
  //   R7（V_LIMIT）保留为审核红线提示，不再作为"错误"判定
  const vLimit = V_LIMIT[rd.type] || 1.5;
  const v = Fg > 0 ? calc_v(G, rho, t, Fg) : 0;
  const vFinal = v;
  let vState = 'none';
  if (vTarget) {
    if (vTarget.hi && vFinal > vTarget.hi) vState = 'high';
    else if (vTarget.lo && vFinal < vTarget.lo) vState = 'low';
    else vState = 'rec';
  }
  const v_ok = vState !== 'high';   // 兼容字段：偏高=需优化（不再有"计算错误"语义）
  const r7Exceed = v > vLimit;      // 超过企业 R7 审核红线（提示用）

  // 液面上升速度 vL (mm/s) 校核接口（PHASE 28.3-C §七.3；仅计算参考，不参与 allOk）：
  //   vL = 铸件高度 ph / 浇注时间 t（简化按铸件高，大平面件冷隔风险；下限标准无企业表，文献值待核对 → 不硬判定）
  const vL = t > 0 ? ph / t : 0;

  // 排气（PHASE 45-B：完全自动生成，用户不填；按企业标准 1.5~4 倍 + 壁厚约束）
  //   - 圆孔：直径尽量小（默认 3mm，Campbell 10.5.2"约 3mm 铁丝出气孔"）；
  //           仅当数量超 40 个才逐级升 4→5mm（用户规则：3mm 优先，非要增加再 4/5）
  //   - 方片：厚度 ≤ min(3, 铸件壁厚)（薄排气片），宽度 50mm，数量反算
  const ventType = input.ventType || '圆孔';
  const wallCap = Math.max(1, Math.floor(input.wall || 3));      // 壁厚上限（方片厚约束）
  let sugVent = null;
  if (Fs_act > 0) {
    const Sneed = Fs_act * 1.5;
    let d = 3, nRound = Math.max(1, Math.ceil(Sneed / (Math.PI * d * d / 4)));
    while (nRound > 40 && d < 5) { d += 1; nRound = Math.max(1, Math.ceil(Sneed / (Math.PI * d * d / 4))); }
    const w = 50;
    const t = Math.max(1, Math.min(3, wallCap));                        // 薄排气片 ≤3mm（≤壁厚）
    const nSq = Math.max(1, Math.ceil(Sneed / (w * t)));
    sugVent = {
      round: { d, n: nRound },
      square: { w, t, n: nSq },
      target: 1.5, max: 4,
    };
  }
  // 排气面积：用户未显式提供参数 → 自动采用建议值（默认流程）；显式提供（测试/旧调用）→ 尊重
  const hasVent = !!(input.vr || input.vrc || input.vs || input.vst || input.vsc);
  const vrd = hasVent ? (input.vr || 0) : (sugVent?.round.d || 0);
  const vrc = hasVent ? (input.vrc || 0) : (sugVent?.round.n || 0);
  const vsw = hasVent ? (input.vs || 0) : (sugVent?.square.w || 0);
  const vst = hasVent ? (input.vst || 0) : (sugVent?.square.t || 0);
  const vsc = hasVent ? (input.vsc || 0) : (sugVent?.square.n || 0);
  let vt = 0;
  if (ventType === '方片') vt = vsw * vst * vsc;
  else vt = Math.PI * vrd * vrd / 4 * vrc;
  const vr  = Fs_act > 0 ? vt / Fs_act : 0;
  // 企业审核标准（R7）：4S阻 > S出气 > 1.5S阻（PHASE 45-B 从 ≥1.5 单边改为区间）
  const vr_ok = vr >= 1.5 && vr <= 4;

  // 实际出品率
  const ya = G > 0 ? pw * cav / G * 100 : 0;

  // 优化建议（PHASE 48-B + P50：流速为"设计校核状态"；放大必须用户主动点击"按目标速度优化"）
  const sugs = [];
  if (vState === 'high') {
    // P50：默认基础设计超目标 → 提示（按钮由 UI 层在 vState=high 时显示）
    sugs.push(`⚠️ 内浇口平均流速 ${vFinal.toFixed(2)} > ${vTarget.hi} m/s（目标 ${vTarget.t}）偏高`);
  } else if (vState === 'low') {
    sugs.push(`ℹ️ 内浇口流速 ${vFinal.toFixed(2)} < ${vTarget.lo} m/s（偏低，可保留；充型速度较低，需关注充型时间，不缩小面积）`);
  } else if (vState === 'none' && r7Exceed) {
    sugs.push(`ℹ️ 流速 ${v.toFixed(2)} > ${vLimit} m/s（超过企业 R7 审核上限 ${rd.type}式），仅提示参考`);
  }
  if (optimized && A_rec > A_gt) {
    sugs.push(`ℹ️ 已按目标流速优化内浇口：总面积 ${A_gt.toFixed(0)} → ${A_rec.toFixed(0)} mm²（目标 ${vTarget.t} m/s）${A_rec > A_gt * 1.5 ? '；放大较多，请结合内浇口数量/位置及浇注方式工程复核' : ''}`);
  }
  if (vr < 1.5) sugs.push(`❌ 排气 ${vr.toFixed(1)} < 1.5 倍！需增加排气面积`);
  if (vr > 4)   sugs.push(`⚠️ 排气 ${vr.toFixed(1)} > 4 倍（企业标准 1.5~4 倍），排气过大可适当减少`);
  if (Fg < A_gt * 0.7) sugs.push(`⚠️ 内浇道偏小（参考 ${A_gt.toFixed(0)} mm²）`);
  if (Fg > A_gt * 1.3 && vState !== 'rec') sugs.push(`⚠️ 内浇道偏大（可适当减小）`);
  if (Fr_act < A_run * 0.8) sugs.push(`⚠️ 横浇道不足（需 ${A_run.toFixed(0)} mm²）`);
  if (sugs.length === 0) sugs.push('✅ 参数合理，无需优化');
  // 综合判定：流速已改为优化提示（不参与硬性 allOk，49.txt §一）；排气仍为硬项
  const allOk = vr_ok && vState !== 'high';

  return {
    mat: input.mat, rho, fc, mdFellBack, pw, cav, wall,
    // PHASE 49：castingMass（P47 公式 W）与 G（浇注重量）分离输出
    castingMass, boundaryNote,
    yv: Math.round(yv * 100), pos, Ho, ph, rh,
    ratioKey: input.ratioKey, rd,
    G, Cmm, Hb, Pv, Hp, fv, fvBase, filterUsed: !!input.filterUsed, t, A,
    A_sp, A_run, A_gt, cp,
    // PHASE 48-B（49.txt）+ P50（51.txt）：目标/推荐面积/最终速度/状态
    //   optimized=false → Fg 为基础设计（A_gt 基准）；true → Fg 为优化设计（A_rec 基准）
    vTarget: vTarget?.t ?? null, vTargetHi: vTarget?.hi ?? null, vTargetLo: vTarget?.lo ?? null,
    A_target, A_rec, vTheory, vFinal, vState, r7Exceed, optimized,
    // P51（52.txt）：实际阻流位置（按 Fs_act/Fr_act/Fg 判定）
    chokeArea, chokePosition, systemType, ingateChoke, boundaryChoke,
    // P51：优化后 choke 迁移检查（供 UI 拒绝流程；仅 optimize=true 时有意义）
    optChokeMigrated: optimized ? (Fg > 0 && Fg <= Fs_act && Fg <= Fr_act) : null,
    gateShape, gc, gt, L_g, Fg, D_g, rc, rt, L_r, Fr_act,
    D_sp, Fs_act, rrv, rgv, v, vLimit, v_ok, vL, vr, vt, ventType, vr_ok, sugVent, ya, sugs, allOk,
    s_r, r_r, g_r, min_r,
  };
}
