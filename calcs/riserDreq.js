// ============================================================
// 冒口理论直径 D_req · 独立纯计算模块（PHASE V2.0-19 / 130.txt）
// ============================================================
// 本模块**只**回答一个问题：在 `calcs/riser.js` 当前那一条**体积约束**下，
//   最小需要多大的**整数直径**。
//
// ⚠ 它不是"保证不缩孔的直径"，也不是"应该选用的冒口尺寸"。见返回值的 `basis`。
//
// ── 为什么与 `runRiser` 无关也能算 ─────────────────────────────────────────────
//   体积约束（`calcs/riser.js:213-216`）逐字为：
//       Vc     = cw × 1000000 / rhoUsed
//       volOk ⟺ Vr × eff ≥ Vc × md.shrink,   Vr = 形状.V(D, H)
//   式子里**没有 Mc** —— `D_req` 因此与热节模数无关，本模块也就不接收 `mc`/`mc_mode`
//   （130.txt §4.4「不要把模数约束混入 D_req」；依据见 `docs/PHASE_V2.0-17_DREQ_FORMULA_AUDIT.md` §2.3）。
//   ⚠ 由此得到的**不是** `runRiser` 会采用的那组尺寸：后者还要过模数判据与 f 搜索上限。
//
// ── 参数表不复制 ──────────────────────────────────────────────────────────────
//   `RISER_SHAPES` / `RISER_MATERIALS` / `RISER_EFF` 一律从 `./riser.js` **导入**，
//   不另抄一份 —— 抄一份就会在将来 riser.js 改参数时**悄悄不一致**。
//   ⚠ 但**不**调用 `runRiser`：本模块自己按体积约束正向搜索（130.txt §三）。

import { RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from './riser.js';

// §七 要求逐字声明：D_req 是**模型内**的理论直径，不是工程保证。
const BASIS = '当前算法的体积约束（Vr × eff ≥ Vc × shrink）下所需的理论直径；'
  + '不代表实际补缩保证 —— 本约束既不保证铸件不产生缩孔缩松，也不含模数判据与 f 搜索上限';

/** 供 UI/报告/测试引用同一句话，避免各处措辞漂移（§4.4「不得宣传为实际补缩保证」）。 */
export const DREQ_DISCLAIMER =
  'D_req 是满足当前算法体积约束所需的理论直径，不是保证实际铸件不产生缩孔或缩松的工程保证。';

// ════════════════════════════════════════════════════════════════════════════
// 一、几何：由**整数直径 D** 得到 (H, V)
// ════════════════════════════════════════════════════════════════════════════
// ★★ 本模块最关键的一处口径选择，必须写在最前面 ★★
//
//   `calcs/riser.js` 里"由直径得到高度"有**两条**规则，它们**不是**同一个函数：
//     ① 主路径（:189-190）`d = round(raw); h = round(raw × hdR)` —— H 由**连续** raw 算；
//     ② 升档路径（:196，PHASE V2.0-13 C′）`d += 1; h = round(d × hdR)` —— H 由**整数** d 算。
//
//   探针实测（`tests/experiments/_probe19_geom.mjs` P4，120 个收敛样本）：
//     ① 与 ② 的结果相差 ΔH ∈ {−1, 0, +1}（实测分布 −1:12 / 0:103 / +1:5），**从不超过 1mm**。
//
//   本模块取 **②**（即 `H = round(D × hd)`），理由：
//     · 主路径的 H 依赖 `raw`，而 `raw` 来自 `sd.DfromM(Mr, hd)` —— **依赖模数 Mc**。
//       D_req 的定义里没有 Mc（见上），故主路径**不可用**。
//     · ② 是**唯一**存在的"由整数直径求 H"的规则，且是项目**已经采纳**的口径
//       （V2.0-13 修复的用意正是"当取整后的 H 不够好时，改用 round(D×hd)"）。
//     · §4.2「按现有模型的**真实**高度舍入规则计算 H」—— ② 就是那条真实规则。
//
//   ⚠ 后果（如实披露，不掩饰）：因为 ΔH 可能为 +1，本模块判定的"满足"是在
//     H = round(D×hd) 这一组几何下成立的；`runRiser` 的实际解在 ΔH=+1 时体积**更大**（更容易满足），
//     在 ΔH=−1 时体积**更小**。两者关系见报告 §C.4 的实测对比。
export function riserDreqSizeAt(D, shape, hd) {
  let H = Math.round(D * hd);
  if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
  if (shape === 'sphere') H = D;      // 球形：H ≡ D，与 hd 无关（`calcs/riser.js:192`）
  return H;
}

/** 由整数直径 D 得到该形状的实际体积（用 `RISER_SHAPES[shape].V`，不另立公式）。 */
export function riserDreqVolumeAt(D, shape, hd) {
  const sd = RISER_SHAPES[shape];
  if (!sd) return NaN;
  return sd.V(D, riserDreqSizeAt(D, shape, hd));
}

// ════════════════════════════════════════════════════════════════════════════
// 二、输入解析：**三态**（未提供 / 非法 / 合法）
// ════════════════════════════════════════════════════════════════════════════
//   ⚠ 语义与 `calcs/riser.js` 的 `readNum`（PHASE V2.0-18）**刻意保持一致**，但**必须另写一份**：
//     `riser.js` 的 `readNum` **没有导出**，而 130.txt §八 明令不得修改 `riser.js`。
//     两份实现若将来漂移，`tests/phasev2019_test.mjs` 的 D 组会变红（有交叉断言钉住）。
//   · **未提供** = `undefined` / `null` / 空串 ⇒ 用**既有**默认值（每条默认值都在调用处注明出处）。
//   · **非法** = `±Infinity` / 非空且非数值的字符串 / 越界数值 ⇒ 调用方返回 `invalid_input`。
//   · `NaN` 默认按**非法**处理；唯一例外 `eff` ⇒ `{ nanIsAbsent: true }`
//     （生产侧 `riserView.js:170` 的效率框清空即为 NaN，回退表值是既有约定）。
const ABSENT = Symbol('absent'), BAD = Symbol('bad');

function readNum(raw, { nanIsAbsent = false } = {}) {
  if (raw === undefined || raw === null) return ABSENT;
  if (typeof raw === 'number') {
    if (Number.isNaN(raw)) return nanIsAbsent ? ABSENT : BAD;
    return Number.isFinite(raw) ? raw : BAD;
  }
  const s = String(raw).trim();
  if (s === '') return ABSENT;
  const v = Number(s);
  return Number.isFinite(v) ? v : BAD;
}

// 安全自有属性查表（§五「不要仅依靠 if (!obj[key])」）
const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;

// ════════════════════════════════════════════════════════════════════════════
// 三、搜索上界的**依据**（§4.3.6「不得任意设置未经说明的工程上限」）
// ════════════════════════════════════════════════════════════════════════════
//   记 A = needVol / eff（所需的冒口体积，mm³）。要找一个**已证明**满足 V(D) ≥ A 的 D_hi，
//   使得"解一定落在 [1, D_hi] 内"。四种形状各用一条**无条件或条件明确**的下界：
//
//   sphere       V = πD³/6                       （精确）      ⇒ D_hi = ⌈∛(6A/π)⌉
//   sphere_head  V ≥ 2/3·π·(D/2)³ = πD³/12      （**无条件**：Hc ≤ 0 时 V 恰为半球）⇒ D_hi = ⌈∛(12A/π)⌉
//   cyl          D·hd ≥ 0.5 ⇒ round(D·hd) ≥ 1 ⇒ V ≥ πD²/4    ⇒ D_hi = max(⌈0.5/hd⌉, ⌈√(4A/π)⌉)
//   square       同上，V = D²·round(D·hd) ≥ D²                ⇒ D_hi = max(⌈0.5/hd⌉, ⌈√A⌉)
//
//   验算（探针 P3，728 个 (shape, hd, A) 组合，含 hd=1e-6 与 A=1e15）：V(D_hi) ≥ A **全部成立**。
//   ⚠ `max(⌈0.5/hd⌉, …)` 里的 `0.5/hd` 在 hd 极小时会很大（hd=1e-6 ⇒ 5e5）—— 这正是
//     必须用**二分**兜底、而不能死扫的原因（见 §四）。
//   ⚠ sphere_head 的 `V ≥ πD³/12` 与 hd **无关** ⇒ hd 再小也成立（这是它比 cyl/square 幸运的地方）。
function upperBound(shape, hd, A) {
  if (shape === 'sphere')      return Math.ceil(Math.cbrt(6 * A / Math.PI));
  if (shape === 'sphere_head') return Math.ceil(Math.cbrt(12 * A / Math.PI));
  if (shape === 'square')      return Math.max(Math.ceil(0.5 / hd), Math.ceil(Math.sqrt(A)));
  return Math.max(Math.ceil(0.5 / hd), Math.ceil(Math.sqrt(4 * A / Math.PI)));   // cyl
}

// 连续式系数 k：V(D) ≈ k·D³（**忽略 H 的整数取整**，即 H 恰为 D·hd）
//   ⚠ sphere_head 只在 hd ≥ 0.5 时定义域成立（此时 Hc = D(hd−0.5) ≥ 0）——
//     探针 P2 实测：hd = 0.49 时朴素式相对误差 3%，hd = 0.3 时 60%，hd ≤ 1/6 时**变负**；
//     而 hd = 0.5 时误差 0.0000%。故 hd < 0.5 ⇒ 不提供 continuous（§4.2）。
const CONT_K = {
  cyl: (hd) => Math.PI * hd / 4,
  square: (hd) => hd,
  sphere: () => Math.PI / 6,
  sphere_head: (hd) => (hd >= 0.5 ? Math.PI * (3 * hd - 0.5) / 12 : null),
};

// 完整扫描的规模上限。**依据**：单次 `satisfies` 是 O(1) 的几次浮点运算，
//   1e6 次在 Node 上约 10ms 量级，属于交互可接受范围；超出则改用**已证明单调性**的二分，
//   并在 `assumptions` 中显式记录。⚠ 这个切换**只影响速度，不影响结果**（同样验证 D 与 D−1）。
const SCAN_LIMIT = 1e6;
const MAX_D = Number.MAX_SAFE_INTEGER;

// ════════════════════════════════════════════════════════════════════════════
// 四、主函数
// ════════════════════════════════════════════════════════════════════════════
/**
 * 计算满足当前算法**体积约束**所需的最小合法整数直径。
 *
 * @param {object} input
 *   @param {string} input.shape      必需。`RISER_SHAPES` 的键（cyl / sphere_head / sphere / square）。
 *   @param {number} [input.cast_wt]  铸件重量 kg。合法区间 [0, +∞)。**缺省 0 ⇒ `not_applicable`**：
 *                                    体积约束 `cw > 0 ? … : true`（`riser.js:213`）在 cw=0 时**未启用**，
 *                                    不能反过来当成"约束已满足"（130.txt §3.1）。
 *   @param {number} [input.hd_ratio] H/D 比。合法区间 (0, +∞)。缺省 1.0（`calcManifest.js:280` 硬编码 + 视图默认项）。
 *   @param {number} [input.eff]      补缩效率，**百分数**。合法区间 (0, +∞)。缺省 `RISER_EFF[sd.effKey]`（《铸造手册》表值）。
 *   @param {number} [input.rho]      固态密度 g/cm³。合法区间 (0, +∞)。缺省 `RISER_MATERIALS[mat].rho`。
 *   @param {string} [input.mat]      材料键。未识别时按 `riser.js` 既有语义回退球铁，并在 `used.matFellBack` 标记。
 *   ⚠ **不接收** `mc` / `mc_mode`：体积约束里没有 Mc（见文件头）。传了也会被忽略。
 * @returns {{status:'ok'|'invalid_input'|'not_applicable'|'unsupported'|'no_solution',
 *            value:number|null, height:number|null, continuous:number|null, gap:number|null,
 *            reason:string|null, assumptions:string[], basis:string, used:object, search:object}}
 *   ⚠ **`status !== 'ok'` 时 `value === null`**（130.txt §五 硬要求），且不返回任何 NaN/Infinity 数值字段。
 */
export function calculateRiserDreq(input) {
  const inp = (input && typeof input === 'object') ? input : {};
  const assumptions = [];

  const mk = (status, reason, extra = {}) => ({
    status, value: null, height: null, continuous: null, gap: null,
    reason, assumptions, basis: BASIS,
    used: null, search: null, ...extra,
  });

  // ── 形状：必需，且必须用自有属性查表（`'constructor'` / `'__proto__'` 会沿原型链取到函数/对象）──
  const sd = own(RISER_SHAPES, inp.shape);
  if (!sd) {
    return mk('invalid_input',
      `形状不合法：${JSON.stringify(inp.shape)} 不是支持的形状（${Object.keys(RISER_SHAPES).join(' / ')}）`);
  }
  const shape = inp.shape;

  // ── 材料：未识别 ⇒ 回退球铁（与 `riser.js:127` 逐字同语义，**非**静默：`used.matFellBack` 标记）──
  const mdOwn = own(RISER_MATERIALS, inp.mat);
  const md = mdOwn || RISER_MATERIALS.球铁;
  const matFellBack = !mdOwn;
  if (matFellBack && inp.mat !== undefined) {
    assumptions.push(`材料键 ${JSON.stringify(inp.mat)} 未识别，按 calcs/riser.js 的既有语义回退到球铁`);
  }

  // ── 四个数值参数：先解析，再逐条按区间判定（区间与 `riser.js:149-169` 完全一致）──
  const hdRaw = readNum(inp.hd_ratio);
  if (hdRaw === BAD || (hdRaw !== ABSENT && !(hdRaw > 0))) {
    return mk('invalid_input', 'hd_ratio 不合法：合法区间为 (0, +∞)，且不接受 ±Infinity / 非数值字符串');
  }
  const hd = hdRaw === ABSENT ? 1.0 : hdRaw;                 // 缺省 1.0（calcManifest.js:280）

  const effRaw = readNum(inp.eff, { nanIsAbsent: true });     // 与 riser.js 一致：eff 的 NaN 视为未提供
  if (effRaw === BAD || (effRaw !== ABSENT && !(effRaw > 0))) {
    return mk('invalid_input', 'eff 不合法：合法区间为 (0, +∞)（百分数）');
  }
  const effPct = effRaw === ABSENT ? RISER_EFF[sd.effKey] : effRaw;
  const eff = effPct / 100;                                   // 与 riser.js:157 同口径

  const cwRaw = readNum(inp.cast_wt, { nanIsAbsent: false }); // cw 的 NaN **不**算未提供（见 riser.js 注释）
  if (cwRaw === BAD || (cwRaw !== ABSENT && cwRaw < 0)) {
    return mk('invalid_input', 'cast_wt 不合法：合法区间为 [0, +∞)，且不接受 NaN / ±Infinity / 非数值字符串');
  }
  const cw = cwRaw === ABSENT ? 0 : cwRaw;

  const rhoRaw = readNum(inp.rho);
  if (rhoRaw === BAD || (rhoRaw !== ABSENT && !(rhoRaw > 0))) {
    return mk('invalid_input', 'rho 不合法：合法区间为 (0, +∞)');
  }
  const rhoUsed = rhoRaw === ABSENT ? md.rho : rhoRaw;

  // ── 体积约束是否启用 ──────────────────────────────────────────────────────
  //   `calcs/riser.js:213` 是 `cw > 0 ? effV >= Vc*shrink : true` —— cw ≤ 0 时**整条不执行**。
  //   ⇒ 这是"约束未启用"，必须返回 `not_applicable`，**不得**返回一个"看起来满足"的直径（130.txt §3.1/§4.4）。
  if (!(cw > 0)) {
    return mk('not_applicable',
      '铸造重量 cast_wt 为 0 或未提供 ⇒ 当前算法的体积约束未启用（calcs/riser.js 的 `cw > 0 ? … : true`），本模块无对象可算');
  }

  // 逐字复刻 `calcs/riser.js:214-215` 的两行，不改变结合次序
  const Vc = cw * 1000000 / rhoUsed;
  const needVol = Vc * md.shrink;
  if (!Number.isFinite(needVol) || !(needVol > 0)) {
    return mk('unsupported', `换算出的需求补缩体积不合理（needVol = ${needVol}）⇒ 无法建立有依据的搜索区间`);
  }
  const A = needVol / eff;                                    // 所需的冒口体积（V ≥ A ⟺ Vr·eff ≥ needVol）
  if (!Number.isFinite(A) || !(A > 0)) {
    return mk('unsupported', `所需的冒口体积 A = needVol / eff = ${A} 不合理 ⇒ 无法建立有依据的搜索区间`);
  }

  // ── 判定：与 `calcs/riser.js:209/215` **逐字同式**（Vr × eff ≥ needVol）──
  const satisfies = (D) => {
    const Vr = sd.V(D, riserDreqSizeAt(D, shape, hd));
    return Vr * eff >= needVol;
  };

  // ── 有依据的上界 ─────────────────────────────────────────────────────────
  let hi = upperBound(shape, hd, A);
  if (!Number.isFinite(hi) || hi < 1 || hi > MAX_D) {
    return mk('unsupported',
      `该输入组合下有依据的搜索上界超出可精确表示的整数范围（上界 = ${hi}）⇒ 本模块不给出结果`);
  }
  // 浮点保险：`⌈∛()⌉` / `⌈√()⌉` 可能因舍入差 1。理论上 1~2 次即足；8 次仍不足 ⇒ 如实报无解。
  let grown = 0;
  while (!satisfies(hi)) {
    const next = Math.ceil(hi * 2) + 2;
    if (grown++ >= 8 || !Number.isFinite(next) || next > MAX_D) {
      return mk('no_solution',
        `在已证明有界的搜索范围 [1, ${hi}] 内未找到满足体积约束的整数直径（逐字判定式 Vr×eff ≥ needVol）`);
    }
    hi = next;
  }

  // ── 搜索最小整数直径 ──────────────────────────────────────────────────────
  //   · `scan`  —— 从 1 逐个试，**第一个满足的就是全局最小**，这条最小性**不依赖任何假设**
  //                 （所有更小的 D 都被实际检查过且为假）。规模 ≤ SCAN_LIMIT。
  //   · `bisect`—— 规模超出预算时改用二分。二分的正确性**依赖 V(D) 对整数 D 单调不减**：
  //                 该性质在报告 §C.3 有证明（四种形状分别论证），并由探针 P1 在
  //                 120,000 个 (形状, hd, D) 点上实测（违反 0 次）。
  //                 二分后仍会验证 `satisfies(D) && !satisfies(D−1)`。
  //   ⚠ 两条路径都**必须**通过同一组终检，任何一条算错都会在下一次检查里暴露。
  let D, method, scanned;
  if (satisfies(1)) {
    D = 1; method = 'scan'; scanned = 1;
  } else if (hi <= SCAN_LIMIT) {
    D = 0; method = 'scan';
    for (let d = 1; d <= hi; d++) if (satisfies(d)) { D = d; break; }
    scanned = hi;
  } else {
    method = 'bisect'; scanned = 0;
    let lo = 0, up = hi;                    // 不变式：satisfies(up) 为真；satisfies(lo) 为假（lo=0 恒假）
    while (up - lo > 1) {
      const mid = lo + Math.floor((up - lo) / 2);
      scanned++;
      if (satisfies(mid)) up = mid; else lo = mid;
    }
    D = up;
    assumptions.push('该输入的搜索上界超出完整扫描预算（1e6），本次改用**二分**；'
      + '二分的正确性依赖 V(D) 对整数 D 单调不减，该性质在 PHASE V2.0-19 报告 §C.3 有证明并有实测支撑');
  }
  if (!(D >= 1)) {
    return mk('no_solution', `在已证明有界的搜索范围 [1, ${hi}] 内未找到满足体积约束的整数直径`);
  }

  // ── 终检（§6.3）：①返回的 D 满足；②所有更小的合法整数直径都不满足 ──────────
  if (!satisfies(D)) {
    return mk('unsupported', `内部一致性检查失败：搜索返回的 D=${D} 未通过体积约束复核，本模块不给出结果`);
  }
  if (D > 1 && satisfies(D - 1)) {
    // 在"完整扫描"下不可能发生；在二分下意味着单调性假设不成立 ⇒ 不给出结果，而不是给出错的
    return mk('unsupported', `内部一致性检查失败：D=${D - 1} 也满足体积约束 ⇒ 最小性无法保证，本模块不给出结果`);
  }

  assumptions.push(`高度按 H = round(D × hd) 取整（与 calcs/riser.js:196 的升档规则同式）；`
    + `runRiser 的收敛解有时用另一条口径 H = round(raw × hd)（:190），两者实测相差 ΔH ∈ {−1,0,+1}`);
  if (shape === 'sphere') assumptions.push('球形冒口的 H ≡ D，与 hd 无关（calcs/riser.js:192）');
  if (shape === 'sphere_head' && hd < 0.5) {
    assumptions.push('sphere_head 且 hd < 0.5：H 被抬高到 round(D/2)（calcs/riser.js:191），'
      + '体积退化为半球；连续公式在该区间**无定义域**，故 continuous 为 null');
  }

  const H = riserDreqSizeAt(D, shape, hd);
  const Vr = sd.V(D, H);

  // ── 连续参考解（§4.2：只有条件明确成立时才作为参考信息）────────────────────
  //   k 见 `CONT_K`；它表示"H 不取整"时的 V/D³。解 D_c = ∛(A/k)。
  //   ⚠ 它是**实数解**，且**故意不取整** —— 用来说明整数化带来的差距 `gap`，不参与上面的搜索。
  const kf = CONT_K[shape];
  const k = kf ? kf(hd) : null;
  const continuous = (k !== null && Number.isFinite(k) && k > 0) ? Math.cbrt(A / k) : null;

  return {
    status: 'ok',
    value: D,
    height: H,
    continuous: (continuous !== null && Number.isFinite(continuous)) ? continuous : null,
    gap: (continuous !== null && Number.isFinite(continuous)) ? D - continuous : null,
    reason: null,
    assumptions,
    basis: BASIS,
    used: { shape, hd, effPct, eff, rho: rhoUsed, cw, shrink: md.shrink, mat: mdOwn ? inp.mat : '球铁', matFellBack },
    search: { hi, method, scanned, Vr, effV: Vr * eff, needVol, A, ok: Vr * eff >= needVol },
  };
}

