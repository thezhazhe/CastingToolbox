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

// ---- 目标冒口模数比（PHASE V2.0-22 / 138.txt §三.1：**唯一命名常量**） ----
//   设计规则：`Mr_target = Mc × MODULUS_TARGET_RATIO` —— 推荐尺寸由 Mr_target 反求，
//   不再由"整件净重"折算的旧体积约束决定（见 runRiser 内的尺寸段）。
//   ⚠ 1.2 是**当前讨论中的暂定设计比例**（137.txt §一.1），不是已验证的通用工程常数。
//   ⚠ 与 `js/model/processInspection.js:57 MODULUS_RATIO_MIN = 1.2` **数值相同、职责不同**：
//     本常量决定"冒口该做多大"（设计侧），那个常量判断"做出来的够不够"（事后校核侧）。
export const MODULUS_TARGET_RATIO = 1.2;

// ---- 浮点比较容差（PHASE V2.0-22 收尾 · 139.txt §3.2：**只吸收浮点表示误差**） ----
//   场景：`Mr_target = Mc × 1.2` 与 `M(D,H)` 都带舍入误差。当数学上 `M(D,H)` **恰好等于**目标时，
//   浮点结果可能低几个 ULP（例：sphere_head / Mc=25 → Mr=30，实测 `M(180,180) = 29.999999999999996`），
//   严格 `>=` 会把它判为"不足"从而**多升一档 +1mm**。
//   ★ 依据（实测，`4 形状 × hd∈{0.5,0.8,1,1.2,1.5,2} × 3000 档 Mc` = 71,760 个"被拒绝的候选"）：
//     · **浮点噪声级**欠缺 ≤ **6.2e-14**（相对量级；主要来源是 `Mc × 1.2` 自身的舍入）
//     · **真实不足**欠缺 ≥ **6.9e-7**（由离散档距造成，实测最小值）
//     ⇒ 两者相差 **1.1e7 倍**，中间是一段**空的**数量级鸿沟。
//   ⇒ 容差取 **1e-12**：高于噪声上界 16 倍，低于真实不足下界 **6.9e5 倍**。
//   ⚠ 这**不是**旧 `0.99`（1%）工程容差的回归：1e-12 相对量在 30mm 模数上 = **3e-11 mm**，
//     比浮点本身还能表示的差异更小，没有任何工程含义（`Mr_act` 仍必须真正达到目标）。
//   ⚠ 唯一的理论代价（如实披露）：若有人把 `Mr_target` 设成一个比 `M(D,H)` **高出不到 1e-12 相对量**
//     的数，该尺寸会被接受 —— 这个差量比 `Mc` 输入本身的精度（1 ULP ≈ 2.2e-16 相对）大 4 个数量级，
//     但在工程上等于"恰好等于目标"。
export const FLOAT_REL_EPS = 1e-12;

/**
 * 模数达标判定：`Mr_act` 是否达到 `Mr_target`（**浮点精度内**）。
 * 全模块**唯一**的达标判据 —— 尺寸搜索、返回守卫、`modOk`/`converged` 必须共用它，
 * 否则会出现"搜索接受、守卫拒绝 ⇒ 合法输入返回 null"的自相矛盾。
 */
export const meetsTarget = (mAct, mTarget) => mAct >= mTarget * (1 - FLOAT_REL_EPS);

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

// ── PHASE V2.0-18（129.txt §四）：可选数值入参的**三态解析** ────────────────────
//   返回 `NUM_ABSENT`（未提供 ⇒ 用既有默认值）· `NUM_BAD`（提供了但不合法 ⇒ 调用方 return null）
//   · 一个**有限的 number**（合法值）。
//   ⚠ 调用方**必须**用 `===` 比较这两个哨兵、用 `typeof x === 'number'` 判合法值 ——
//     `0` 是合法值但 falsy，用真值判断会把 `cw = 0` 误判成"未提供"。
//   · **未提供** = `undefined` / `null` / 空串 / `NaN`：
//     JS 里 `parseFloat('')`、`Number('')`、`parseFloat(undefined)` 都得到 `NaN`，
//     而"空输入框 ⇒ 用默认值"是本项目**已确立且被 `checkNum` 明确允许**的约定
//     （`numcheck.js` 未传 `required` 时空串即通过；`riserView.js:170` 的效率输入框走的就是这条）。
//     故 `NaN` 默认归入"未提供"而非"非法" —— 归为非法会让"清空效率输入框"从"用默认值"
//     变成"整页无结果"，那是**回归**（见报告 §六 的偏离说明）。
//   · **非法** = `±Infinity` / 非空且非数值的字符串 / 数值但越界（区间由调用方按参数判定）。
//   · ⚠ **默认 `NaN` 一律按非法处理**（129.txt §四 明列 NaN）。
//     唯一例外是 `eff` ⇒ `{ nanIsAbsent: true }`：**只有它**在生产侧存在"清空输入框 ⇒ NaN"
//     的真实路径（`riserView.js:170` 的 `eff: parseFloat(...)` 没写 `|| 默认值`），
//     而 `eff` 的缺省值是《铸造手册》表值 —— 既不关校核、也不产生假结果。
//     其余参数（`cw`/`rho`/`hd`）的三个生产调用方全都先做过 `|| 默认值`，
//     不可能传出 NaN（`calcManifest.js:269` 更是只传 `undefined` 或正数）。
function readNum(raw, { nanIsAbsent = false } = {}) {
  if (raw === undefined || raw === null) return NUM_ABSENT;
  if (typeof raw === 'number') {
    if (Number.isNaN(raw)) return nanIsAbsent ? NUM_ABSENT : NUM_BAD;
    return Number.isFinite(raw) ? raw : NUM_BAD;
  }
  const s = String(raw).trim();
  if (s === '') return NUM_ABSENT;
  const v = Number(s);
  return Number.isFinite(v) ? v : NUM_BAD;   // 字符串 "NaN" / "Infinity" / "abc" 一律非法
}
const NUM_ABSENT = 'absent', NUM_BAD = 'bad';

// 按热节输入方式计算 Mc
export function calcMc(mode, v) {
  if (mode === 'direct')  return parseFloat(v.mc) || 0;
  if (mode === 'hot_spot') return (parseFloat(v.hot_d) || 0) / 2;
  if (mode === 'wall')    return (parseFloat(v.wall_t) || 0) / 2;
  if (mode === 'volume') {
    // PHASE V2.0-18（129.txt §四「不得静默地将非法输入转为零或任意默认值」）：
    //   原式 `const a = parseFloat(v.cast_a) || 1` —— **`|| 1` 把 `cast_a = 0` 悄悄换成了 1**，
    //   于是下一行那句 `a > 0` 的除零守卫**永远不可能触发**，`cast_a: 0` 会得到 `Mc = vol/1`
    //   （一个看似正常的模数）而不是被拒绝。改为 `|| 0` 后，`0`/缺失/非数值都会落到
    //   `a > 0` 为假 ⇒ 返回 0 ⇒ `runRiser` 的 `Mc <= 0` 守卫按契约返回 `null`。
    //   ⚠ 合法输入零影响：`cast_a` 缺失/为 0 时**旧行为本身就没有依据**
    //     （riserView 对 `#r_cast_a` 用 `gt: 0, required: true`，根本传不出 0）。
    const vol = parseFloat(v.cast_v) || 0, a = parseFloat(v.cast_a) || 0;
    return vol > 0 && a > 0 ? vol / a : 0;
  }
  return 0;
}

// ---- 主计算：自动迭代至全部校核通过 ----
export function runRiser(input) {
  // PHASE 28.6（P0-3）：密度接线——input.rho 显式覆盖（manifest 层在项目 solidDensity 为
  //   USER_OVERRIDE 时传入）；默认仍用内部表。未知材料不再静默：mdFellBack 标记。
  // PHASE V2.0-18（129.txt §五.5「非法形状不得在守卫之前访问不存在的属性」）：
  //   ⚠ **必须用 `hasOwnProperty` 查表，不能直接下标取值** —— `RISER_SHAPES` / `RISER_MATERIALS`
  //     是对象字面量，`RISER_SHAPES['constructor']` / `['toString']` / `['valueOf']` 会沿原型链
  //     取到**函数**（truthy，`!sd` 拦不住）⇒ 随后 `sd.DfromM is not a function` **抛异常**；
  //     `['__proto__']` 取到 `Object.prototype`（对象，同样 truthy）。
  //     同理 `RISER_MATERIALS['constructor']` 会让 `mdFellBack` **误报"材料已找到"**。
  //   ⚠ 合法输入零影响：4 个形状 / 5 种材料的键都是自有属性，查表结果逐位不变。
  const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
  const md = own(RISER_MATERIALS, input.mat) || RISER_MATERIALS.球铁;
  const mdFellBack = !own(RISER_MATERIALS, input.mat);
  const sd = own(RISER_SHAPES, input.shape);
  // PHASE V2.0-15（126.txt §四.6 · 无效输入）：**守卫必须早于 `sd` 的解引用**。
  //   原顺序为 `const eff = (… || RISER_EFF[sd.effKey])` **之后**才 `if (… || !sd) return null` ——
  //   未显式传 `eff` 时 `sd.effKey` 会先炸出 `TypeError: Cannot read properties of undefined`，
  //   于是"未知形状"不是返回文档承诺的 `null`，而是**抛异常**。
  //   仅调整判定顺序，**不改任何数值**（合法输入下 `sd` 恒存在，行为逐位不变）。
  if (!sd) return null;

  // ── PHASE V2.0-18（129.txt §四/§五）：**输入守卫** ──────────────────────────────
  //   三态语义（见 `readNum`）：未提供 → 用既有默认值；非法 → `null`；合法 → 参与计算。
  //   ⚠ 每一处默认值都是**既有的、有据可查的约定**，不是为免报错临时发明的（逐条注明出处）。
  //   ⚠ 本守卫**不参与任何数值计算** —— 合法输入下 `D/H/f/Mr_act/Vr/effV/modOk/volOk/bind/converged`
  //     **逐位不变**（证据：26,525 行基线 CSV + 扩展网格，见报告 §五）。
  //   ⚠ 关闭的三类旧缺陷（V2.0-17 §4.1 实测）：
  //       ① `Mc = Infinity` 曾穿过 `Mc <= 0` ⇒ 返回 `D=Infinity` / `Mr_act=NaN`
  //       ② `cw = -5` 曾因 `cw > 0 ? … : true` **静默关闭体积校核**，返回看似正常的尺寸
  //       ③ `rho ≤ 0` 曾除零（`rho=0` ⇒ `needVol=Infinity`）或令体积判据恒真（`rho<0`）
  const Mc = calcMc(input.mc_mode, input);
  if (!Number.isFinite(Mc) || Mc <= 0) return null;   // ★ 补 `Number.isFinite`：原 `Mc <= 0` 抓不到 Infinity

  const hdRaw = readNum(input.hd_ratio);              // 合法区间 (0, +∞)：0 ⇒ 零高度冒口，几何不成立
  if (hdRaw === NUM_BAD || (hdRaw !== NUM_ABSENT && !(hdRaw > 0))) return null;
  const hd = hdRaw === NUM_ABSENT ? 1.0 : hdRaw;      // 缺省 1.0：calcManifest.js:280 硬编码 + 两个视图 select 的默认项

  // ★ `nanIsAbsent: true` —— 见 `readNum` 注释：`eff` 是**唯一**在生产侧会出现"空输入框 ⇒ NaN"
  //   的参数（riserView 的效率输入框清空后就是这个值），必须仍回退到表值，否则是行为回归。
  const effRaw = readNum(input.eff, { nanIsAbsent: true });   // 合法区间 (0, +∞)：0 ⇒ "零补缩效率的冒口"不成立
  if (effRaw === NUM_BAD || (effRaw !== NUM_ABSENT && !(effRaw > 0))) return null;
  const eff = (effRaw === NUM_ABSENT ? RISER_EFF[sd.effKey] : effRaw) / 100;   // 缺省 = 本文件 RISER_EFF 表（《铸造手册》）

  // 合法区间 [0, +∞)：0 合法且**有意义**（= 不做体积校核，riserStatus.js:41 已文档化）。
  //   ★ `nanIsAbsent: false` —— 见 `readNum` 注释：cw 的缺省值本身就会关掉整条体积校核，
  //     所以 `NaN` 不能也算"未提供"，否则等于绕个弯把 129.txt §五.2 要杜绝的
  //     "意外关闭体积校核"重新放进来。（生产侧三个调用方都先做过 `|| 0`，不会传 NaN。）
  const cwRaw = readNum(input.cast_wt, { nanIsAbsent: false });
  if (cwRaw === NUM_BAD || (cwRaw !== NUM_ABSENT && cwRaw < 0)) return null;
  const cw = cwRaw === NUM_ABSENT ? 0 : cwRaw;

  const rhoRaw = readNum(input.rho);                  // 合法区间 (0, +∞)：rho 是除数，0 ⇒ 除零
  if (rhoRaw === NUM_BAD || (rhoRaw !== NUM_ABSENT && !(rhoRaw > 0))) return null;
  const rhoUsed = rhoRaw === NUM_ABSENT ? md.rho : rhoRaw;   // 缺省 = 材料表值（原 `input.rho ?? md.rho` 的显式设计）

  // 尺寸变量（由下方的"目标模数反求"赋值；D/H 的取整口径见 sizeAt）
  let D = 0, H = 0, Mr_act = 0, Vr = 0, effV = 0;
  // ── 由目标模数求**整数尺寸**（PHASE V2.0-13 的 C′ 复核 · PHASE V2.0-22 收口）──────────
  //   ① **H 的取整规则只有一条**：`H = round(D × hd)`（再做形状修正）。
  //      旧实现有两条：主路径用 `round(连续 raw × hd)`、升档路径用 `round(整数 d × hd)`
  //      （V2.0-19 §一 记录过二者 ΔH ∈ {−1,0,+1}）。本阶段取消了"连续主路径"（不再有迭代），
  //      只保留后一条 —— 它正是 `calcs/riserDreq.js` 采用的"由整数 D 求 H"规则，
  //      于是两个模块对"给定 D 的 H"**完全一致**，不再有 ΔH 口径差。
  //   ② 判据 `M(D,H) >= Mr`（**严格**，见下）。
  //   ③ 先上探到满足，再**下探**到最小档：H 的取整使 `M(D)` 对 D 非严格单调
  //      （H 可能向下取整），只上探会虚增一档 —— 实测混合口径下 440/14720 点虚增 1mm
  //      （集中在 hd=0.5 一带）；V2.0-16 §裁决 已确立"D = 最小可行整数"这一性质，必须保持。
  //   ⚠ PHASE V2.0-13（123.txt §三 · 方案 C′）的原始用意——"取整后是否真的满足模数校核"——
  //     由本段的 okAt 完整继承；被替换掉的只是"由哪个 Mr 出发"（旧：f 迭代的 Mr_need；
  //     新：Mr_target = Mc × MODULUS_TARGET_RATIO）。
  const sizeAt = (Mr, hdR) => {
    // H 由**整数直径**导出（唯一规则；球顶柱 H≥r、球形 H≡D 的修正统一在这里做）
    const hOf = (dd) => {
      let h = Math.round(dd * hdR);
      if (input.shape === 'sphere_head') { const r = dd / 2; if (h < r) h = Math.round(r); }
      if (input.shape === 'sphere') h = dd;
      return h;
    };
    // PHASE V2.0-22（138.txt §3.3）：判据由 `>= Mr × 0.99` **收紧为 `>= Mr`** ——
    //   Mr_target 是**最低设计目标**，那 1% 容差会让"宣称 1.2 倍"与"实际 1.188 倍"并存。
    // PHASE V2.0-22 收尾（139.txt §3.2）：再补上**浮点比较容差** `meetsTarget`（1e-12 相对量，
    //   只吸收舍入误差）—— 否则数学上恰好等于目标的尺寸会因 ULP 级误差被多升一档。
    const okAt = (dd) => { const hh = hOf(dd); return (dd > 0 && hh > 0) && meetsTarget(sd.M(dd, hh), Mr); };
    let d = Math.round(sd.DfromM(Mr, hdR));
    // ⚠ `d > 0` 这个前置条件**必须保留**：连续解取整到 0 说明输入已超出可用范围
    //   （Mc≈1e-6、hd≈1e-9 一类），此时**不得**靠升档去"救"出一个 ⌀1mm 冒口 ——
    //   那是 V2.0-18 §五.4 明令要拦的"看似有效"假结果。取整为 0 ⇒ 原样返回，由调用方判 null。
    if (!(d > 0)) return { D: 0, H: 0 };
    for (let step = 0; step < 8 && !okAt(d); step++) d += 1;              // 上探：达到目标模数
    for (let step = 0; step < 8 && d > 1 && okAt(d - 1); step++) d -= 1;  // 下探：最小可行档
    return { D: d, H: hOf(d) };
  };
  // ── 推荐尺寸：由**目标冒口模数**直接反求（PHASE V2.0-22 / 138.txt §三.2、§3.4）────────
  //   旧实现是 `for (f = 1.10; f ≤ 3.55; f += 0.05)`，直到"模数 + 体积"双通过才停 ——
  //   在体积主导区，尺寸实际由**整件净重**决定（实测：球铁 77.56kg / Mc=11.43 / cyl，
  //   仅按模数需 ⌀75，实得 ⌀144；`calcs/riserDreq.js` 独立复算同为 ⌀144 ⇒ 与 Mc 无关）。
  //   138.txt §3.4 裁决：旧体积约束**不得再通过提高 f 改变推荐尺寸**，故本阶段
  //   直接按 Mr_target 反求，**迭代与 f 上限（3.55）一并移除**。
  //   ⚠ 两条旧机制随之消失，不要再以任何形式恢复：
  //     ① 未收敛路径（`bind='limit'`）—— 没有迭代就没有"撞上限"；
  //     ② "体积不足 ⇒ f 前进一格"的放大路径。
  const Mr_target = Mc * MODULUS_TARGET_RATIO;
  ({ D, H } = sizeAt(Mr_target, hd));
  // PHASE 73 防御（除零守卫，不改任何公式）：Mc 极小时 DfromM 迭代后 D/H 会取整到 0，
  //   形状模数 M(0,0) = 0/0 → NaN。**合法量级**的输入下 D、H 恒 > 0；
  //   走到 `D = 0` 的只有退化输入（Mc≈1e-6 / hd≈1e-9），由下面的守卫统一拦成 `null`。
  Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
  // PHASE V2.0-22（138.txt §3.3）：**目标模数是最低设计目标** —— 取整/升档之后必须真正达到，
  //   不接受"一边宣称 1.2 倍、一边给出 1.188 倍"。
  //   PHASE V2.0-18（129.txt §五.4）：**算法产不出正尺寸 ⇒ 输入超出可用范围 ⇒ `null`**。
  //     合法但极端的输入（`hd` 极小如 1e-9、`Mc` 极小如 1e-6）会把 `D`/`H` 取整到 **0**，
  //     于是返回 `{D:0, H:0, Vr:0}` —— 这是"**看似有效**"的假结果（V2.0-17 §4.1 的 `ZERO` 类）。
  //     该情形已被本守卫一并覆盖（`Mr_act` 此时为 0 < `Mr_target`）。
  //   ⚠ **合法输入零影响**（实测，非推理）：14,720 点网格
  //     （4 形状 × hd∈{0.5,0.6,0.8,1,1.2,1.5,2,3} × Mc∈[0.3,60] 步长 0.13）中，
  //     `Mr_act < Mr_target` 的点数 = **0**、`D 非最小档` 的点数 = **0**。
  if (!(D > 0 && H > 0) || !meetsTarget(Mr_act, Mr_target)) return null;
  Vr = sd.V(D, H);
  effV = Vr * eff;
  // 模数校核：**由上面的守卫保证恒为 true**。字段保留（展示层、报告、测试都在读），
  //   但它的语义已从"迭代是否满足判据"变成"推荐尺寸是否达到目标模数"（构造上必然达到）。
  //   判据与尺寸搜索**共用** `meetsTarget`（浮点精度内达标）—— 两处口径必须一致，
  //   否则会出现"搜索接受、守卫拒绝 ⇒ 合法输入返回 null"。
  const modOk = meetsTarget(Mr_act, Mr_target);

  // ── 尺寸归因（PHASE V2.0-22 / 138.txt §四.1）──────────────────────────────────────
  //   旧 `bind` 是"f 迭代中哪条约束把尺寸顶上去"的事后描述，取值 start/modulus/volume/both/limit。
  //   本阶段尺寸**只**由目标模数反求 ⇒ 归因恒为 `'modulus'`：
  //   `'volume'` / `'limit'` **在新结果里已不可能出现**，也就不会再暗示"当前尺寸由体积约束决定"。
  //   字段保留（调用方：resultsCenter 的 bindHint、riserStatus 的旧结果回退、若干测试）——
  //   旧结果对象里仍可能是旧取值，展示侧对未知取值保持沉默。
  const bind = 'modulus';
  // 尺寸恒满足目标模数（上面 `Mr_act >= Mr_target` 的守卫）⇒ 状态恒为"已收敛"。
  //   V2.0-15 引入 `converged` 是为了把**状态**与**归因**分开；本阶段已无迭代，
  //   "未收敛"这一状态在新结果上不存在（旧结果对象仍可能带 `converged=false`，
  //   `js/views/riserStatus.js` 的兼容分支保持原样，不清洗）。
  const converged = meetsTarget(Mr_act, Mr_target);
  // 目标模数所需直径的**连续解取整**（不含升档补偿）—— 升档发生时与最终 D 相差 1mm。
  //   PHASE V2.0-13（124.txt §二 裁决）：本字段是纯理论参考值，回答"仅按模数理论上要多大"，
  //     不是"实际该用多大"；该 ≤1mm 差异**有意保留**。
  //   PHASE V2.0-22（138.txt §三.1）：口径**随设计规则同步** —— 原来硬编码 `Mc * 1.10`，
  //     现在与尺寸反求用**同一个** `Mr_target`，避免两处系数各写一份。
  const dModOnly = Math.round(sd.DfromM(Mr_target, hd));

  // 冒口颈
  const neck_k = md.neck_k;
  const M_neck = Mc * neck_k;
  const d_neck = Math.round(M_neck * 4);   // 圆颈 M=d/4 → d=4M

  // ── 旧体积校核（PHASE 28.6：Vc 换算用 rhoUsed——支持用户显式固态密度覆盖）──────────────
  //   ★★ PHASE V2.0-22（138.txt §3.5）：**本段已不影响推荐尺寸，也不是设计判据** ★★
  //     它按**整件净重**折算补缩需求，等于假设"整个铸件的收缩量由这一个冒口单独承担"——
  //     该假设尚无工程依据（V2.0-02 §I.1 / V2.0-04 结论 C）。故：
  //       · 推荐尺寸只由 Mr_target 决定（见上），本段**不参与**任何尺寸计算；
  //       · `volOk` 保留为**内部诊断字段**，展示侧必须标明它是"旧模型参考值"，
  //         **不得**据此宣称按目标模数得到的尺寸不合格（resultsCenter / riserView / 报告均已改）。
  //     未来若要建立真正的补缩能力校核（补缩区口径），应作为独立阶段处理（138.txt §3.5 末段）。
  const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0;
  const needVol = Vc * md.shrink;
  const volOk = cw > 0 ? effV >= needVol : true;   // ⚠ 诊断值；`cw = 0` 时"未校核"，不代表"通过"
  const yieldPct = Vc > 0 ? Vc / (Vc + Vr) * 100 : null;

  return { matKey: input.mat, md, rhoUsed, mdFellBack, Mc, shapeKey: input.shape, sd, hd, eff,
    D, H, Mr_act, Vr, effV,
    // ── PHASE V2.0-22（138.txt §四.6）：模数三个字段的分工，**不得混用** ─────────────
    //   Mr_target —— 设计目标 = `Mc × MODULUS_TARGET_RATIO`（**新代码一律用它**）
    //   Mr_act    —— 最终整数尺寸的**实际**模数（由 D/H 独立重算，恒 ≥ Mr_target）
    //   Mr_need   —— **兼容别名，恒等于 Mr_target**。旧语义是"f 迭代的末次要求"，
    //                该语义已随迭代消失；保留字段名只为不打断既有调用方
    //                （riserView「所需冒口模数」、resultsCenter 展示、若干测试）。
    Mr_target, Mr_need: Mr_target, targetRatio: MODULUS_TARGET_RATIO,
    // `final_f` —— **兼容字段**：旧语义是"迭代停止时的 f"。本阶段不再迭代，
    //   恒等于设计规则的比例 `MODULUS_TARGET_RATIO`（= Mr_target / Mc）。
    final_f: MODULUS_TARGET_RATIO,
    d_neck, neck_k, M_neck, cw, Vc, needVol, modOk, volOk, yieldPct,
    bind, dModOnly,   // PHASE V2.0-22：尺寸归因（恒为 'modulus'，只读，不参与计算）
    // PHASE V2.0-15（126.txt §二.4/§二.5）：**收敛状态**显式导出。
    //   本阶段语义 = "推荐尺寸是否达到目标模数"，由构造保证为 `true`（见上方守卫）。
    //   兼容性：不枚举键的消费方不受影响；旧结果没有该字段时，
    //   `js/views/riserStatus.js` 的 `riserConverged()` 会回退到 `bind === 'limit'`。
    converged,
    dimLabel: input.shape === 'sphere' ? '球直径' : input.shape === 'square' ? '边长 a' : '直径 D' };
}
