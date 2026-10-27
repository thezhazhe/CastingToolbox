// ============================================================
// 计算器统一声明（命令 9.txt 第二 STEP 3：共享参数 + 自动复用）
// 每个计算器声明：
//   requiredInputs / optionalInputs —— 参数项：{ param: CastingProject 路径,
//     input: 计算器入参键, label, unit, kind: 'number'|'select', options, default }
//   outputs —— 结果字段声明（结果中心展示用）
//   calculate —— 从共享参数取值 → 调用 calcs/ 纯函数 → 返回结果对象
// 系统自动判断哪些参数已存在（getV 非空）→ 缺失项才进入分页输入（STEP 4）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { runGating, MATERIALS as GATING_MATS, RATIO_PRESETS, recommendGatingRatio } from './gating.js';
import { runRiser, RISER_SHAPES } from './riser.js';
import { resolveYield } from './yield.js';
import { runChill } from './chill.js';
import { CHILL_DEFAULT_MAT, CHILL_COEF } from '../data/chill_calc.js';
import { runSandbox } from './sandbox.js';
import { runShakeout } from './shakeout.js';
import { defaultCharge, runCharge } from './charge.js';
import { rmaRange, methodGradeRec } from './machining.js';
import { calcShrinkageDir, SHRINK_MODE_LABEL } from './shrinkage.js';

/** 参数项：kind number/select；param 为 CastingProject 路径（null = 计算器私有，不共享） */
const num = (param, input, label, unit = '', extra = {}) => ({ kind: 'number', param, input, label, unit, ...extra });
const sel = (param, input, label, options, extra = {}) => ({ kind: 'select', param, input, label, options, ...extra });

/**
 * PHASE 78（78.txt 七）：内浇道推荐值——**单一出处**（manifest 计算 + 结果页展示共用，避免两处口径漂移）。
 * 厚度 = max(3, round(主体壁厚 ÷ 3))（77.txt 六定稿口径）；个数推荐 2（工程提示 2~3 个）。
 */
export function ingateRec(wall) {
  const w = wall > 0 ? wall : 0;
  return { gt: w > 0 ? Math.max(3, Math.round(w / 3)) : 10, gc: 2 };
}
/**
 * PHASE 80（79.txt 追问）：横浇道默认值——**工具既有默认（2 条 × 厚 25 mm）**，不新造推荐规则；
 * 结果页与内浇道同级开放可改（改条数/厚度 → 长度按阻流面积反算，公式零改动）。
 */
export function runnerRec() {
  return { rt: 25, rc: 2 };
}
/**
 * 排气（79.txt 四定稿口径）：**直径由用户定，孔数由系统按企业标准反算**。
 *   总排气面积目标 = 1.5 × 直浇道实际面积（企业标准下限，runGating 内既有 sugVent 口径）；
 *   孔数 N = ⌈目标面积 ÷ 单孔面积(πd²/4)⌉ → 实际排气面积 ≥ 目标 → 比值恒 ≥ 1.5（不会再"报错"）。
 *   直径默认 ⌀3mm（Campbell 出气孔口径），用户可改小（⌀1/2）或改大。
 */
export const VENT_D_DEFAULT = 3;
/** 企业标准排气面积下限倍数（与 gating.js sugVent 的 target 同源，仅用于结果页展示口径） */
export const VENT_TARGET_RATIO = 1.5;

/** 材质族 → 浇注系统材料键 / 冒口材料键 */
export const matKeyOf = (fam) => ({
  '灰铁': '灰铁(HT)', '球铁': '球铁(QT)', '铸钢': '铸钢(ZG)', '铝合金': '铝合金(Al)', '铜合金': '铜合金(Cu)',
}[fam] || '灰铁(HT)');

/** PHASE V2.0-08（117.txt §二）：**未确认的自动 Mc** 的统一提示语。
 *  单热结路径与"勾选热结"路径必须逐字相同 —— 06A1 的教训是
 *  「一处说'可直接采用'、一处说'未经确认'」本身就是缺陷（calcManifest.js 旧注释已写明）。
 *  抽成常量后，两处共用一句话，改口径只需改这里。 */
const AUTO_MC_NOTE = '本次冒口 Mc 采用 STL 自动热结估计值（未经确认）——自动估计值尚未验证适用于所有几何，板状/长条状热节可能偏低；请核对热节壁厚后在「冒口参数」确认 Mc 再复算';

/** PHASE V2.0-11（121.txt §二 R1/R2）：**几何无效**时的阻断原因（原因 + 建议操作 + 重要限制）。
 *  只在 `geomStatus === 'INVALID'` 且等级被判为 BLOCK 时**前置**到 note —— 原来这种情形下
 *  卡片要么显示「自动 Mc 未经确认」（属实，但**不是**阻断原因），要么（用户 Mc 时）note 为空、
 *  一句解释都没有 ⇒ 用户看到 ⛔ 却不知道该怎么办（即 R-1）。
 *  措辞刻意止于"**可能**不可信"：网格校验收到的 error 级问题（空网格 / 非法顶点）不等于
 *  "算出来的数一定错"，不得把话说满（121.txt §二 R1 明令）。 */
const GEOM_INVALID_NOTE = '当前 STL 网格校验无效，几何数据可能不可信，因此已阻断自动推荐。请检查并修复网格，或重新导入有效的 STL 后再计算。当前尺寸仅供排查参考，不应直接用于生产设计。';

/** 把阻断原因**前置**到既有 note：既有说明原样保留在后（不被取代），两段用「；」分隔、内容互不重复。 */
const withBlockReason = (existing) => (existing ? GEOM_INVALID_NOTE + '；' + existing : GEOM_INVALID_NOTE);

/** 判断 Mc 是否来自用户（复用项目既有 SRC 语义，不新增状态机） */
const isUserMcSrc = (src) => src === proj.SRC.USER_OVERRIDE || src === proj.SRC.USER_INPUT;

export const CALC_MANIFEST = [
  {
    id: 'shrinkage', name: '线收缩率', icon: '📏',
    requiredInputs: [
      sel('material.family', 'mat', '材料大类', ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], { param: 'material.family' }),
      num('geometry.size', 'dims', '外形尺寸（X×Y×Z）', 'mm', { kind: 'dims3' }),   // 三方向分别输入/自动填
    ],
    optionalInputs: [
      sel(null, 'mode', '收缩方式', ['free', 'common', 'restrained'], { default: 'common' }),
    ],
    outputs: [
      { key: 'combined', label: '综合收缩率', unit: '%' }, { key: 'spread', label: '方向差', unit: '%' },
      { key: 'dirs', label: '分方向推荐', unit: '' }, { key: 'directional', label: '分方向放缩水', unit: '' },
    ],
    calculate: () => {
      const fam = proj.getV('material.family');
      if (!fam) return null;
      const size = proj.getV('geometry.size') || [];
      const r = calcShrinkageDir(matKeyOf(fam), size, 'common');
      if (!r) return null;
      return { ...r, modeLabel: SHRINK_MODE_LABEL['common'] };
    },
  },
  {
    id: 'gating', name: '浇注系统设计', icon: '🌊',
    requiredInputs: [
      num('material.family', 'mat', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
      num('geometry.blankWeightKg', 'pw', '铸件重量（毛坯）', 'kg', { hint: '含加工余量；STL 净重在自动参数区' }),
      num('production.cavities', 'cav', '一模件数', '件'),
      num('process.wallUsed', 'wall', '主体壁厚', 'mm'),
      sel('process.pourPos', 'pos', '浇注方向', ['顶注', '中注', '底注']),
      num('process.Ho', 'Ho', '内浇道至上箱面距离', 'mm'),
      num('process.ph', 'ph', '铸件高度（浇注方向）', 'mm'),
    ],
    optionalInputs: [
      num('material.yieldSug', 'yr', '预估出品率', '%'),
      // PHASE 28.3-B：冒口高度（riser 结果自动回写；未做冒口时用户可填预估，Hp 方案 A 用）
      // PHASE 29（P1-40）：param 非 null → 设计中心"高级参数"折叠区渲染（缺失时才显示；回写后为自动值不打扰）
      num('process.riserHeight', 'rh', '冒口高度', 'mm', { hint: 'riser 设计后自动回写；预估即可' }),
      // PHASE 71.7（77.txt 六）：内浇道厚度/个数——推荐值由主体壁厚推导，用户可改；
      //   厚度/个数变化 → runGating 内部按阻流面积重算内浇道长度 L_g（公式零改动）
      // PHASE 78（78.txt 七）：两个输入框的**入口**移到结果页「③ 经典浇注系统 →内浇道」，
      //   但参数仍走本声明（设计中心侧投影），计算链路与公式不变。
      num('process.gateThk', 'gt', '内浇道厚度', 'mm', { hint: '推荐 = 主体壁厚 ÷ 3' }),
      num('production.ingateN', 'gc', '内浇道个数', '个', { hint: '推荐 2~3 个' }),
      // PHASE 78（78.txt 二）：浇注系统比例（S直:S横:S内）——关键工艺决策，用户可选；'' = 按材料/重量自动推荐
      sel('process.ratioKey', 'ratioKey', '浇注系统比例', [''].concat(Object.keys(RATIO_PRESETS)), { param: 'process.ratioKey' }),
      // PHASE 29：删除 qty（production.qty）——gating calculate 不消费该参数（G=pw×cav/出品率），死声明
    ],
    outputs: [
      { key: 'G', label: '浇注重量', unit: 'kg' }, { key: 't', label: '浇注时间', unit: 's' },
      { key: 'A', label: '阻流截面', unit: 'mm²' }, { key: 'D_sp', label: '直浇道直径', unit: 'mm' },
      { key: 'L_g', label: '内浇道长', unit: 'mm' }, { key: 'L_r', label: '横浇道长', unit: 'mm' },
    ],
    calculate: () => {
      const fam = proj.getV('material.family');
      if (!fam) return null;
      // PHASE 28.3-A：毛坯重统一口径（P0-4 语义拆分，见 docs/PHASE28_3_REPORT.md）
      const wt = proj.getV('geometry.blankWeightKg') || 0;
      const wall = proj.getV('process.wallUsed') || proj.getV('geometry.wallAvg') || 10;
      const matKey = matKeyOf(fam);
      // PHASE 28.6（P0-3）：液态密度接线——项目 liquidDensity 用户显式修改（USER_OVERRIDE）时
      //   传入覆盖（修复"改密度不生效"静默脱节）；默认不传 → 用内部 GATING_MATS 表（行为不变）。
      const ld = proj.get('material.liquidDensity');
      const rho = ld && ld.src === proj.SRC.USER_OVERRIDE && ld.v > 0 ? ld.v : undefined;
      const rec = ingateRec(wall);   // PHASE 78：内浇道推荐值（单一出处）
      const rrec = runnerRec();      // PHASE 80：横浇道默认值（= 工具既有默认，不新造规则）
      const gIn = {
        mat: matKey, pw: wt, cav: proj.getV('production.cavities') || 1,
        // PHASE 73 P1 修复：原为 `|| 70`——出品率留空（0）时被硬编码 70% 顶掉，
        //   连材料表的 y_sug（铸钢 58 / 铝合金 80 / 铜 62）都被忽略，浇注重量最多偏 17%。
        //   改为不传（undefined）→ runGating 内部回退到该材料的 md.y_sug（calcs/gating.js）。
        yr: proj.getV('material.yieldSug') || undefined, wall,
        pos: proj.getV('process.pourPos') || '顶注',
        Ho: proj.getV('process.Ho') || 150, ph: proj.getV('process.ph') || 100,
        rh: proj.getV('process.riserHeight') || 0,   // PHASE 28.3-B：Hp 方案 A 接线（riserHeight 冒口高度）
        // PHASE 78（78.txt 二）：比例由用户在「② 浇注参数」选定；未选（''）→ 仍按材料/重量推荐（原行为）
        ratioKey: proj.getV('process.ratioKey') || recommendGatingRatio(matKey, wt),
        // PHASE 71.7（77.txt 六）：内浇道厚度/个数——未填时按推荐值（厚 = 主体壁厚÷3，下限 3mm；个数 2）
        gc: proj.getV('production.ingateN') > 0 ? proj.getV('production.ingateN') : rec.gc,
        gt: proj.getV('process.gateThk') > 0 ? proj.getV('process.gateThk') : rec.gt,
        // PHASE 80（79.txt 追问）：横浇道条数/厚度——结果页 ③ 可改（未设 → 工具既有默认 2 条 × 25 mm）
        rc: proj.getV('production.runnerN') > 0 ? proj.getV('production.runnerN') : rrec.rc,
        rt: proj.getV('process.runnerThk') > 0 ? proj.getV('process.runnerThk') : rrec.rt,
        rho,
      };
      // PHASE 79（79.txt 四）：排气——**用户定直径（默认 ⌀3，可改 2/1），孔数由总排气面积反算**。
      //   两遍调用 runGating（纯函数、无副作用）：第一遍拿直浇道实际面积 Fs_act；
      //   目标排气面积 = 企业标准下限 1.5×Fs_act（与 gating 内 sugVent 同口径）→
      //   N = ⌈目标 ÷ 单孔面积⌉ → 实际排气面积 ≥ 目标 → 比值恒 ≥1.5（不再出现"排气不足"）。
      const base = runGating(gIn);
      const ventD = proj.getV('process.ventD') > 0 ? proj.getV('process.ventD') : VENT_D_DEFAULT;
      const ventNeed = base.Fs_act * VENT_TARGET_RATIO;
      const ventN = Math.max(1, Math.ceil(ventNeed / (Math.PI * ventD * ventD / 4)));
      const g = runGating({ ...gIn, vr: ventD, vrc: ventN });
      // ventNeed 保留精确值（孔数由它反算；展示层自行取整）——避免先取整再算孔数导致 ±1 误差
      return { ...g, ventD, ventN, ventNeed };
    },
  },
  {
    id: 'riser', name: '冒口设计', icon: '🏗️',
    requiredInputs: [
      num('material.family', 'mat', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
      num('geometry.netWeightKg', 'cast_wt', '铸件净重（补缩金属量）', 'kg'),
      num('process.mcHotspot', 'mc', '热节模数 Mc', 'mm', { hint: '自动=热结 M（无热结=壁厚/2），可改' }),
    ],
    optionalInputs: [
      // PHASE 29（P1-40）：param=null（scope=calculator）→ 独立「冒口设计」工具完整可调；
      //   设计中心用简化默认（球顶圆柱 h/d=1.0，覆盖多数铸件），不渲染、不存储。
      sel(null, 'shape', '冒口形状', ['sphere_head', 'cyl', 'sphere', 'square'], { default: 'sphere_head', scope: 'calculator' }),
      num(null, 'hd_ratio', '高度/直径比', '', { default: 1.0, scope: 'calculator' }),
    ],
    outputs: [
      { key: 'D', label: '冒口直径', unit: 'mm' }, { key: 'H', label: '冒口高度', unit: 'mm' },
      { key: 'Mr_act', label: '实际模数', unit: 'mm' }, { key: 'Vr', label: '冒口体积', unit: 'cm³' },
      { key: 'd_neck', label: '冒口颈直径', unit: 'mm' },
    ],
    calculate: () => {
      const fam = proj.getV('material.family');
      if (!fam) return null;
      // PHASE 29 门禁（41.txt 五/六）：热结分析状态 → 自动冒口建议。
      //   绝不把"分析失败/低置信度"伪装成"无热结"；用户显式输入 Mc 是唯一的人工放行入口。
      //   状态矩阵：userMc(人工) → 放行；INSUFFICIENT_RESOLUTION → 阻止；
      //   LOW_CONFIDENCE → 阻止；ok(有热结) → mcHotspot；NO_HOTSPOT(真均匀) → wallHot 兜底+标注；none(手动) → wallHot/输入不足。
      const hsStatus = proj.getV('hotspots.status') || 'none';
      const hsReason = proj.getV('hotspots.reason') || '';
      const hs = proj.getV('hotspots.items') || [];
      // PHASE 71.6 修复：用户 Mc 输入框的物理路径 = 当前冒口模数来源（有热结→mcHotspot；
      //   无热结→wallHot，见 designCenter mcDisplayPath）。旧实现只认 mcHotspot →
      //   无热结时用户手改 Mc 被当作自动 wallHot，门禁不识别（"已启用冒口却只拿到兜底值"）。
      //   优先级（与设计中心 mcDisplayPath 的显示路径一致）：
      //     ① 有热结 → mcHotspot（自动或用户值）
      //     ② 无热结 → 该场景下 Mc 输入框写的是 wallHot；但若用户显式覆盖过 mcHotspot
      //        （无热结时该参数无自动写入者，USER_OVERRIDE 必为人工意图）→ 仍以用户值为准，
      //        不被另一参数上的自动 wallHot 劫持（PHASE 28.4-3 既有契约）
      const isUserVal = (p) => !!p && (p.src === proj.SRC.USER_OVERRIDE || p.src === proj.SRC.USER_INPUT) && p.v > 0;
      const mcHotSrc = proj.get('process.mcHotspot');
      const wallHotSrc = proj.get('process.wallHot');
      // PHASE 71.7（77.txt 二）：多热结选择——用户在「冒口参数」勾选热结并可在弹窗内改 Mc；
      //   勾选集合非空 → 逐热结计算冒口（runRiser 逐次调用，公式零改动）；不勾选的热结不计算。
      const picks = (proj.getV('process.hsPick') || [])
        .filter(p => p && p.id != null && p.mc > 0)
        .map(p => ({ id: p.id, mc: p.mc }));
      const hsById = new Map(hs.map(h => [h.id, h]));
      const pickedHot = picks.filter(p => hsById.has(p.id));
      let userMc = false, userMcVal = 0;
      if (pickedHot.length) {
        userMc = true;
        userMcVal = Math.max(...pickedHot.map(p => p.mc));
      } else if (hs.length > 0) {
        userMc = isUserVal(mcHotSrc);
        userMcVal = userMc ? mcHotSrc.v : 0;
      } else if (isUserVal(wallHotSrc)) {
        userMc = true; userMcVal = wallHotSrc.v;
      } else if (isUserVal(mcHotSrc)) {
        userMc = true; userMcVal = mcHotSrc.v;
      }
      const geomStatus = proj.getV('geometry.geomStatus') || 'VALID';
      // PHASE V2.0-08（117.txt §三）：`mcSrc` = **实际送进 runRiser 的那个 Mc** 的来源，
      //   在选值处就地标注（复用项目 SRC 语义），供等级判定与来源展示共用同一处事实——
      //   视图层不再从 process.mcHotspot 反推（多热结路径的 Mc 来自 process.hsPick，
      //   反推会把用户手工填的值标成「STL 热结检测」，即 D2）。
      let mc = 0, note = null, mcSrc = null;
      if (userMc) {
        mc = userMcVal;
        mcSrc = proj.SRC.USER_OVERRIDE;
        if (hsStatus !== 'ok') note = '按用户确认的热节模数 Mc = ' + mc + ' mm 计算（热结分析状态：' + hsStatus + '）';
      } else if (hsStatus === 'INSUFFICIENT_RESOLUTION') {
        return { blocked: true, reason: 'analysis_failed', level: 'BLOCK_AUTO_RECOMMEND', note: `热结分析失败（${hsReason || '无法可靠分析'}）：无法自动给出冒口建议。请人工输入热节模数 Mc，或检查模型尺度/网格质量后重新导入。` };
      } else if (hsStatus === 'LOW_CONFIDENCE') {
        return { blocked: true, reason: 'low_confidence', level: 'BLOCK_AUTO_RECOMMEND', note: `热结候选置信度不足（${hsReason || '候选未达阈值'}）：不自动建议冒口（避免偏小误导）。请人工输入热节模数 Mc 后重新计算。` };
      } else if (hsStatus === 'ok' && hs.length) {
        mc = proj.getV('process.mcHotspot') || 0;
        mcSrc = proj.SRC.STL_GEOMETRY_ANALYSIS;
        // PHASE V2.0-06A1（113.txt §四.2）：走这一支 = 用户**没有**改过 Mc 输入框，
        //   Mc 是 STL 自动估计值。06A 实测该量对板状/长条状热节系统性偏低（板 0.33×解析），
        //   方向是"冒口偏小"。故如实标注为**未经确认的初步估算**，
        //   不得让它静默地充当已完成工程确认的最终设计结果。
        // PHASE V2.0-08：文案抽为 AUTO_MC_NOTE，与"勾选热结"路径共用同一句。
        note = AUTO_MC_NOTE;
      } else {
        // NO_HOTSPOT（真均匀件，壁厚模数兜底合理）或无 STL（手动模式，用户已填 wallHot）
        mc = proj.getV('process.wallHot') || 0;
        mcSrc = proj.SRC.DERIVED;
        // PHASE 71.5 诚实口径：NO_HOTSPOT 需区分 uniform（真均匀，估算合理）与 no_candidate
        //   （未达检出阈值——复杂/薄特征可能超采样能力，不能伪装成"均匀件属正常"）
        // PHASE 71.6（76.txt 十二）：明确"未检测到可靠热点 → Mc 采用壁厚/结构参考值初步估算"，
        //   不显示成"STL 自动识别热点 → 精确冒口设计"
        if (hsStatus === 'NO_HOTSPOT') note = '未检测到可靠热点，本次冒口 Mc 采用' + (hsReason === 'uniform' ? '壁厚参考值' : '壁厚/结构参考值') + '（主体壁厚 ÷ 2）进行初步估算——不是 STL 识别出的热点，建议结合工艺经验复核';
      }
      if (mc <= 0) return null;
      // PHASE 28.6（P0-3）：固态密度接线——项目 solidDensity USER_OVERRIDE 时传入覆盖（同 gating rho 模式）
      const sd = proj.get('material.solidDensity');
      const rho = sd && sd.src === proj.SRC.USER_OVERRIDE && sd.v > 0 ? sd.v : undefined;
      // PHASE 71.6（76.txt 十一）重量语义修正：riser 的体积校核对象是「冒口要补缩的金属」——
      //   cw → Vc = cw×1e6/ρ（mm³）是铸件的实际金属体积，物理量 = 铸件净重（STL 体积×固态密度），
      //   不含加工余量（余量是被切掉的金属，不参与补缩）；riser 自身 size 迭代由 Mc 主导，不受影响。
      //   gating.pw / yield.castWt 仍是「浇注重量口径的铸件重量（毛坯含余量）」，语义不变。
      const castWt = proj.getV('geometry.netWeightKg') || proj.getV('geometry.blankWeightKg') || 0;
      // PHASE 78（78.txt 三）：冒口形状由用户在结果页「② 冒口设计」下拉选择（4 种，默认圆柱形）。
      //   形状只改 runRiser 的 shape 入参（几何/模数/补缩效率公式零改动）。
      const riserShape = RISER_SHAPES[proj.getV('process.riserShape')] ? proj.getV('process.riserShape') : 'cyl';
      /* S5-05（158.txt §二.S5-05）：H/D 开放为设计输入。默认 1.0；旧项目没有该字段或
         手动写入非法值时回退 1.0，保证既有结果逐位不变。runRiser 的算法/公式一行未改，
         这里只是把既有入参接到 CastingProject。球形在 runRiser 内仍恒为 H ≡ D。 */
      const hdNum = Number(proj.getV('process.hdRatio'));
      const hdRatio = Number.isFinite(hdNum) && hdNum > 0 ? hdNum : 1.0;
      const runOne = (mcVal) => runRiser({
        mat: fam, cast_wt: castWt,
        mc_mode: 'direct', mc: mcVal, shape: riserShape, hd_ratio: hdRatio, eff: undefined, rho,
      });
      // 多热结路径（PHASE 71.7）：逐热结计算，主结果 = Mc 最大者（供 gating/yield 与写回冒口高度使用）
      if (pickedHot.length) {
        const items = pickedHot.map(p => {
          const det = hsById.get(p.id)?.mc ?? null;
          const rr = runOne(p.mc);
          // PHASE V2.0-08（117.txt §二/§三）：**勾选热结 ≠ 确认 Mc**。
          //   勾选只表示"该热结参与冒口设计"；Mc 若仍等于检出值，它就是**未经确认的自动估计值**。
          //   逐项按"实际送进 runRiser 的 Mc"标注来源（同上文 mcSrc 口径）。
          const editedItem = det === null || Math.abs(p.mc - det) > 1e-9;
          return rr ? { ...rr, hsId: p.id, hsMc: det,
            mcSrc: editedItem ? proj.SRC.USER_OVERRIDE : proj.SRC.STL_GEOMETRY_ANALYSIS } : null;
        }).filter(Boolean);
        if (!items.length) return null;
        const primary = items.reduce((a, b) => (b.Mc > a.Mc ? b : a));
        const mcAllUser = items.every(i => isUserMcSrc(i.mcSrc));
        const parts = [];
        if (items.length > 1) parts.push(`已按您选择的 ${items.length} 个热结分别计算冒口（H${items.map(i => i.hsId).join(' / H')}）——V1 不做 feed-zone 分区补缩，各冒口独立校核`);
        else if (mcAllUser) parts.push(`按用户确认的热节模数 Mc = ${items[0].Mc} mm 计算（热结 H${items[0].hsId}）`);
        // 只要还有冒口的 Mc 是检出值，就补上与单热结路径**逐字相同**的未确认提示。
        if (!mcAllUser) parts.push(AUTO_MC_NOTE);
        const multiNote = parts.length ? parts.join('；') : null;
        // PHASE V2.0-10（120.txt §三）：硬门禁判定（与单热结路径同源同口径）。
        const blocked = isHardBlocked({ geomStatus, hsStatus, humanInput: mcAllUser });
        // PHASE V2.0-11（121.txt §二 R3）：几何无效的阻断原因针对**整份几何数据**（网格校验），
        //   与"某个热结分析失败"无关 —— 因此用同一句、不逐热结改写；同样前置、不取代多热结说明。
        const noteText = (blocked && geomStatus === 'INVALID') ? withBlockReason(multiNote) : multiNote;
        return {
          ...primary, items, multi: items.length > 1,
          // PHASE V2.0-08（117.txt §二）：本路径**恒为 WARNING_REVIEW**，两种情况都不该给"✅ 可直接采用"：
          //   ① 有任一冒口的 Mc 仍是检出值（未经确认的自动估计值）——旧实现此处走 reliabilityLevel()，
          //      它只看几何/分析状态、不知道 Mc 是自动值 ⇒ 勾一下复选框就把 🟡 变 ✅、06A1 提示整条消失（D1）；
          //   ② 全部为人工改值 —— 与 PHASE 28.5 的单热结人工路径同口径（结果来自人工输入，需用户自判）。
          // PHASE V2.0-10（120.txt §三）：本路径原先**恒 WARNING_REVIEW**、根本不调用 reliabilityLevel，
          //   于是几何 INVALID 在多热结路径上同样被降级 ⇒ 改用与单热结路径**同源同口径**的硬门禁判定。
          //   humanInput = 全部冒口的 Mc 都是用户改过的（只要还有一个检出值，就算"未经确认"）。
          level: blocked ? 'BLOCK_AUTO_RECOMMEND' : 'WARNING_REVIEW',
          ...(noteText ? { note: noteText } : {}),
        };
      }
      const r = runOne(mc);
      // PHASE 28.5（42.txt 十）：可靠性等级标签（不改变数值，可观察信号）。
      //   userMc（人工放行）→ WARNING_REVIEW（结果来自人工输入，需用户自判——已非 BLOCK，因建议已按人工输入生成）
      // PHASE V2.0-06A1（113.txt §四.2）：未确认的自动 Mc **也不再给 SAFE_TO_RECOMMEND**
      //   （"✅ 可直接采用"）。它与 note 必须同一口径，否则一处说"可直接采用"、一处说"未经确认"。
      const level = (userMc || note) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus });
      const out = note ? { ...r, note, level } : { ...r, level };
      // PHASE V2.0-10（120.txt §三）：**阻断优先级** —— 硬门禁压过上面的"软降级"（修 N-E；规则见 isHardBlocked）。
      //   只可能把等级【抬升】到 BLOCK，绝不把 BLOCK 降级；数值照常给出（阻断的是"建议"，不是"计算"）。
      //   放在 out 之后只做一次赋值：既不改上面两行被 06A1-2 锁定的口径，也自动带上 mcSrc 等后续新增字段。
      if (isHardBlocked({ geomStatus, hsStatus, humanInput: userMc })) {
        out.level = 'BLOCK_AUTO_RECOMMEND';
        // PHASE V2.0-11（121.txt §二 R1/R2）：阻断必须**说明原因**，且**不取代**既有的 Mc 说明
        //   （自动 Mc 的"未经确认"仍然属实、仍然有用，只是它不再是读者看到的第一句）。
        if (geomStatus === 'INVALID') out.note = withBlockReason(out.note);
      }
      // PHASE V2.0-08：Mc 的来源（mcSrc）随结果一起返回 —— 结果页/参数页据此显示来源，
      //   不再各自从 process.mcHotspot 反推（多热结路径反推会标错，即 D2）。
      return { ...out, mcSrc };
    },
  },
  {
    id: 'yield', name: '出品率与铁水重量', icon: '📊',
    requiredInputs: [
      num('material.family', 'mat', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
      num('geometry.blankWeightKg', 'castWt', '铸件重量（毛坯）', 'kg'),
    ],
    optionalInputs: [
      sel('production.line', 'line', '造型线', ['不指定', '垂直线', '水平线'], { param: 'production.line' }),
    ],
    outputs: [
      { key: 'castWt', label: '铸件重量', unit: 'kg' }, { key: 'pourWt', label: '浇注重量', unit: 'kg' },
      { key: 'runnerWt', label: '浇注系统重', unit: 'kg' }, { key: 'riserWt', label: '冒口重量', unit: 'kg' },
    ],
    calculate: (results) => {
      const fam = proj.getV('material.family');
      if (!fam) return null;
      const wt = proj.getV('geometry.blankWeightKg') || 0;   // PHASE 28.3-A：毛坯重口径
      const y = resolveYield(matKeyOf(fam), null, proj.getV('production.line') || null);
      const g = results?.gating;
      const r = results?.riser;
      /* V2.0-P1-R6-S4（155.txt §2.2）：整模口径**新增字段**，不改旧字段语义。
         旧字段 `castWt` / `runnerWt` / `riserWt` 一字不动（它们仍被历史测试与外部消费方按
         “单件 / G−单件（含冒口，未乘型腔） / 单套”读取）；这里只补四个可验证的新字段，
         供结果页/报告按整模账目消费：
           · castingMass        = 单件毛坯重 × 型腔数
           · riserUnit          = 单套冒口重（与旧 riserWt 同值，名字明确口径）
           · riserWtTotal       = 单套 × 型腔数（假设每腔一套；与既有账目假设一致）
           · gatingWtResidual   = G − 整模铸件 − 整模冒口（只是反推残差，**不是实测浇道重**）
           · finalYield         = null（没有独立浇道实重/实测浇注重量，绝不伪造最终实重出品率）
         型腔数取 gating 的实际采用值；gating 缺失时退回项目参数。 */
      const cav = Math.max(1, Math.round(
        (g && Number.isFinite(g.cav) && g.cav > 0) ? g.cav : (proj.getV('production.cavities') || 1)
      ));
      const riserUnit = r && !r.blocked && r.Vr > 0
        ? (r.items && r.items.length
          ? r.items.reduce((s, it) => s + it.Vr * (it.rhoUsed || it.md?.rho || 0) / 1e6, 0)
          : r.Vr * (r.rhoUsed || r.md?.rho || 0) / 1e6)
        : null;
      /* gating.castingMass 是浇注链实际采用的整模铸件重；缺失时才按单件 × 腔数重算。 */
      const castingMass = (g && Number.isFinite(g.castingMass) && g.castingMass > 0)
        ? g.castingMass
        : wt * cav;
      const riserWtTotal = riserUnit != null ? riserUnit * cav : null;
      const gatingWtResidual = (g && Number.isFinite(g.G) && g.G > 0 && riserWtTotal != null)
        ? g.G - castingMass - riserWtTotal
        : null;
      return {
        range: y.range, basis: y.basis, level: y.level,
        castWt: wt,
        // PHASE 73 P1 修复：同上——无 gating 结果时的兜底出品率不再硬编码 70%
        pourWt: g ? g.G : wt / (yieldSugPct() / 100),
        runnerWt: g ? g.G - wt : wt / (yieldSugPct() / 100) - wt,
        // Vr(mm³)×rho(g/cm³)→kg：mm³×(g/1000mm³)=g/1000 → /1e6 得 kg（PHASE 28 P0-1）
        // PHASE 71.6 健壮性：riser 被门禁阻止时结果对象无 md/Vr（旧代码直接解引用 → TypeError →
        //   被 runAnalysis 的 try/catch 吞掉 → 出品率模块静默消失）；改用 riser 自报的 rhoUsed + 守卫。
        // PHASE 71.7：多热结（items）时冒口总重 = 各冒口之和
        riserWt: riserUnit,
        /* S4 新增整模口径（旧字段语义不变） */
        cavityCount: cav,
        castingMass,
        riserUnit,
        riserWtTotal,
        gatingWtResidual,
        designYield: g && Number.isFinite(g.yv) ? g.yv : null,
        finalYield: null,
      };
    },
  },
  {
    id: 'chill', name: '冷铁计算', icon: '❄️',
    requiredInputs: [
      num('material.family', 'mat', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
    ],
    optionalInputs: [
      // PHASE 28.3-A：T_hot 独立（P1-10/17）——chill 不再读 riser 的 mcUsed；默认自动=2×热节模数（数值不变）
      // PHASE 29（P1-40）：chillT（param 非 null）→ 设计中心高级区；type（scope=calculator）→ 独立「冷铁计算」工具
      num('process.chillT', 'T', '热节壁厚 T_hot', 'mm', { hint: '自动=2×热节模数，可改' }),
      sel(null, 'type', '冷铁类型', ['外冷铁·直接', '外冷铁·间接(隔砂)', '内冷铁'], { default: '外冷铁·直接', scope: 'calculator' }),
    ],
    outputs: [
      { key: 'thickness', label: '冷铁厚度/直径', unit: 'mm' }, { key: 'mid', label: '推荐值', unit: 'mm' },
      { key: 'warnings', label: '失效警告', unit: '' },
    ],
    calculate: () => {
      // PHASE 29 门禁（与 riser 同矩阵）：热结分析失败/低置信度不静默（T 默认派生自 mc，源头不可靠则阻止）；
      //   用户显式 T（chillT）或 Mc → 放行。
      const hsStatus = proj.getV('hotspots.status') || 'none';
      const hsReason = proj.getV('hotspots.reason') || '';
      const hs = proj.getV('hotspots.items') || [];
      const mcSrc = proj.get('process.mcHotspot');
      const userMc = mcSrc && (mcSrc.src === proj.SRC.USER_OVERRIDE || mcSrc.src === proj.SRC.USER_INPUT) && mcSrc.v > 0;
      const chillTSrc = proj.get('process.chillT');
      const userT = chillTSrc && (chillTSrc.src === proj.SRC.USER_OVERRIDE || chillTSrc.src === proj.SRC.USER_INPUT) && chillTSrc.v > 0;
      const geomStatus = proj.getV('geometry.geomStatus') || 'VALID';
      let mc = 0;
      if (userMc) mc = mcSrc.v;
      else if (userT) mc = 0;   // T 独立输入，不依赖 mc
      else if (hsStatus === 'INSUFFICIENT_RESOLUTION') {
        return { blocked: true, reason: 'analysis_failed', level: 'BLOCK_AUTO_RECOMMEND', note: `热结分析失败（${hsReason || '无法可靠分析'}）：无法自动推荐冷铁。请人工输入热节壁厚 T，或检查模型后重新导入。` };
      } else if (hsStatus === 'LOW_CONFIDENCE') {
        return { blocked: true, reason: 'low_confidence', level: 'BLOCK_AUTO_RECOMMEND', note: `热结候选置信度不足（${hsReason || '候选未达阈值'}）：不自动推荐冷铁。请人工输入热节壁厚 T 后重新计算。` };
      } else if (hsStatus === 'ok' && hs.length) {
        mc = proj.getV('process.mcHotspot') || 0;
      } else {
        mc = proj.getV('process.wallHot') || 0;   // NO_HOTSPOT 均匀件/手动模式
      }
      // PHASE V2.0-06A1（113.txt §四.3）：走这一支且非用户输入 = T 由**未确认的自动 Mc** 推出。
      //   数值一律不变（仍 2×Mc），只是如实标注为"初始建议值"，并降级为需人工复核。
      const autoT = !userT && !userMc;
      const T = proj.getV('process.chillT') || mc * 2;   // 独立 T_hot；默认 2×热节模数（保持原数值行为）
      if (T <= 0) return null;
      // CHILL_COEF 键为 灰铸铁/球墨铸铁…（family 是 灰铁/球铁——确定性键映射，与 shakeout 同模式；PHASE 28.3-A 修复）
      const matKey = { '灰铁': '灰铸铁', '球铁': '球墨铸铁', '铸钢': '铸钢', '铝合金': '铝合金', '铜合金': '铜合金' }[proj.getV('material.family') || '灰铁'];
      // PHASE 73 P1 修复：原先不传 chillMat → 系数表取不到 → 走 fallback 分支，
      //   而警告文案里插的是 input.chillMat（undefined）→ 界面出现「没有『undefined』这种搭配」。
      //   这里显式传该材质的推荐冷铁材料（与独立冷铁视图同口径），不再触发 fallback 文案。
      const r = runChill({ mat: matKey, type: '外冷铁·直接', T, chillMat: (CHILL_DEFAULT_MAT[matKey] || Object.keys(CHILL_COEF[matKey] || {})[0]) });
      // 113.txt §四.3：自动 Mc 推出的 T 是**初始建议值**，不是经过本铸件热节验证的设计值
      //   ⇒ 不进 SAFE_TO_RECOMMEND；数值与公式一行未改。
      const chillNote = autoT
        ? 'T_hot 由 STL 自动热结估计值 ×2 推出 —— 这是未经确认的初始建议值，不是本铸件热节的验证结果；自动估计值尚未验证适用于所有几何，请核对热节壁厚后在「冷铁」处确认 T_hot 再复算'
        : null;
      // PHASE V2.0-10（120.txt §三）：**阻断优先级**（与冒口同源，修 N-E 的同一类短路）。
      //   本分支原先写 `(userMc || userT || autoT) ? 'WARNING_REVIEW' : reliabilityLevel(…)`，
      //   autoT 为真即短路 ⇒ 几何 INVALID 被降级。humanInput = 用户显式给了 T_hot 或 Mc（即 !autoT）。
      //   注：本分支只能写成"提前 return"，因为下面那行 return 被 06A1-4 的结构守卫锁定字面；
      //   若将来要在本返回点加顶层字段，这条早返回必须同步（冒口分支已改用 out 赋值以避免该坑）。
      if (isHardBlocked({ geomStatus, hsStatus, humanInput: !autoT })) {
        // PHASE V2.0-11（121.txt §二 R4）：同口径给出阻断原因 —— 复用既有 note 字段，返回结构不变。
        //   ⚠ 冷铁当前**不在** FIXED_CALC_TASKS 里（设计中心不执行冷铁），故本次改动在产品里
        //   暂时**无可观测效果**；记录在案，等冷铁接入主流程时自然生效。
        const bn = geomStatus === 'INVALID' ? withBlockReason(chillNote) : chillNote;
        return bn ? { ...r, note: bn, level: 'BLOCK_AUTO_RECOMMEND' } : { ...r, level: 'BLOCK_AUTO_RECOMMEND' };
      }
      const level = (userMc || userT || autoT) ? 'WARNING_REVIEW' : reliabilityLevel({ geomStatus, hsStatus });
      return chillNote ? { ...r, note: chillNote, level } : { ...r, level };
    },
  },
  {
    id: 'sandbox', name: '3D砂型吃砂量', icon: '📦',
    requiredInputs: [
      num('geometry.size', 'dim', '最大轮廓尺寸', 'mm', { useMax: true }),
      num('geometry.blankWeightKg', 'wt', '铸件重量（毛坯）', 'kg'),
    ],
    optionalInputs: [
      // PHASE 29（P1-40）：scope=calculator → 独立「3D砂型」工具可调；设计中心默认埋箱
      sel(null, 'mode', '砂型方式', ['埋箱（树脂砂埋箱）', '裸浇'], { default: '埋箱（树脂砂埋箱）', scope: 'calculator' }),
    ],
    outputs: [
      { key: 'minWall', label: '砂型最小壁厚', unit: 'mm' }, { key: 'wall', label: '砂型壁厚', unit: 'mm' },
      { key: 'warning', label: '提示', unit: '' },
    ],
    calculate: () => {
      const size = proj.getV('geometry.size') || [0, 0, 0];
      const dim = Math.max(...size);
      if (dim <= 0) return null;
      return runSandbox({ dim, wt: proj.getV('geometry.blankWeightKg') || 0, mode: '埋箱（树脂砂埋箱）' });
    },
  },
  {
    id: 'machining', name: '加工余量', icon: '🛠️',
    requiredInputs: [
      num('material.family', 'mat', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
      num('geometry.size', 'size', '基本尺寸', 'mm', { useMax: true }),
    ],
    optionalInputs: [
      // PHASE 29（P1-18）：options 与 METHOD_GRADES 键名对齐（原 ['砂型','金属型','熔模','压力'] 与
      //   '金属型（重力/低压）' 等键完全不匹配——即使接线也永不消费）；'熔模' 无 RMA 标准 → calculate 明确提示
      sel('production.method', 'method', '铸造方法', ['砂型 · 机器造型/壳型', '砂型 · 手工造型', '金属型（重力/低压）', '压力铸造', '熔模铸造'], { param: 'production.method' }),
    ],
    outputs: [
      { key: 'min', label: '余量下限', unit: 'mm' }, { key: 'max', label: '余量上限', unit: 'mm' },
      { key: 'mid', label: '推荐值', unit: 'mm' }, { key: 'grades', label: '等级', unit: '' },
    ],
    calculate: () => {
      const size = proj.getV('geometry.size') || [0, 0, 0];
      const dim = Math.max(...size);
      if (dim <= 0) return null;
      // PHASE 29（P1-18）：method 接线（设计中心高级区/生产场景均可设置）。旧选项兼容映射
      //   （'砂型'/'金属型'/'压力' 是 29 前选项，可能已存于 production.method）。
      // P52 批 1（57.txt）：熔模铸造按现行标准（GB/T 6414-2017 / GB/T 42124.3-2025 附录）
      //   建议 RMAG E 级——由「无标准」改为正常接线。
      const M_MAP = { '砂型': '砂型 · 机器造型/壳型', '金属型': '金属型（重力/低压）', '压力': '压力铸造', '熔模': '熔模铸造' };
      const method = proj.getV('production.method');
      const mkey = method && method !== '不指定' ? (M_MAP[method] !== undefined ? M_MAP[method] : method) : '砂型 · 机器造型/壳型';
      if (!mkey) {
        return { unsupported: true, note: '未知铸造方法，请按企业规范确定加工余量。' };
      }
      // METHOD_GRADES 键为 铸钢/灰铸铁/铝合金（球铁/铜合金用灰铁近似——GB/T 6414 推荐等级同档）
      // PHASE 28.4（P1-39 记录）：铜合金两条路径口径不一致（manifest 按铝合金 vs 独立视图按灰铸铁）——
      //   近似口径选择属工程判断，待人工决策；本阶段仅统一为显式提示（不静默）。
      const matKey = { '灰铁': '灰铸铁', '球铁': '灰铸铁', '铸钢': '铸钢', '铝合金': '铝合金', '铜合金': '铝合金' }[proj.getV('material.family') || '灰铁'];
      const rec = methodGradeRec(mkey, matKey);
      if (!rec) {
        return { unsupported: true, note: `「${mkey}」×「${proj.getV('material.family')}」无 GB/T 42124.3-2025 推荐 RMAG 等级，请按企业规范确定加工余量。` };
      }
      return { ...rmaRange(dim, rec), methodLabel: mkey };
    },
  },
  {
    id: 'charge', name: '熔炼加料计算', icon: '🏭',
    // 20.txt 八：charge 的铁水总重依赖浇注系统 G 或出品率 pourWt（计算依赖，
    //   不是输入依赖）——勾选但前置未完成时 UI 必须明确提示，不能静默失败。
    dependsOn: ['gating', 'yield'],   // 至少完成其一（yield 自身可由 gating/riser 或默认出品率驱动）
    requiredInputs: [
      num('material.family', 'family', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
      num('geometry.blankWeightKg', 'totalWt', '铁水总重', 'kg', { derived: '毛坯重量 ÷ 出品率' }),
    ],
    optionalInputs: [],
    outputs: [
      { key: 'result', label: '成铁成分', unit: '' }, { key: 'sug', label: '补料建议', unit: '' },
    ],
    calculate: (results) => {
      const fam = proj.getV('material.family');
      if (!fam) return null;
      const pourWt = results?.yield?.pourWt || results?.gating?.G || 0;
      if (pourWt <= 0) return null;
      // 大类 → 默认牌号（数据表以牌号为键）
      const defGrade = { '灰铁': 'HT200', '球铁': 'QT450-10', '铸钢': 'ZG230', '铝合金': 'ZL104', '铜合金': 'ZCuSn10P1' }[fam];
      if (!defGrade) return null;
      // PHASE 28.4 修复（P1-20/21）：CHARGE_TARGETS 无 ZG230/ZL104/ZCuSn10P1 → defaultCharge 对
      //   undefined 解引用抛 TypeError → 被 runAnalysis try/catch 吞掉 → 模块静默消失。
      //   改为明确返回 unsupported 标记（UI 显示提示，不静默、不抛错）。
      const c = defaultCharge(defGrade, pourWt);
      if (!c) return { unsupported: true, note: `暂不支持「${defGrade}」加料计算（企业数据表无此牌号）`, defGrade, pourWt };
      return { ...runCharge(c), defGrade, pourWt };
    },
  },
  {
    id: 'shakeout', name: '开箱时间', icon: '⏱️',
    requiredInputs: [
      num('material.family', 'mat', '材料大类', '', { kind: 'select', options: ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'], param: 'material.family' }),
      num('geometry.blankWeightKg', 'weight', '铸件重量（毛坯）', 'kg'),
      num('process.wallUsed', 'wall', '主壁厚', 'mm'),
    ],
    optionalInputs: [
      // PHASE 29（P1-23/P1-40）：原 mode 误用 production.line（'生产方式'≠'造型线'，且 '砂型' 不在
      //   SHAKE_ADJUST.modes（流水线/地面）→ `?? 1` 静默）。改为 scope=calculator（独立「开箱时间」工具
      //   完整可调 mode/heatTreat/risk/importance）；设计中心用简化默认（砂型=地面系数 1.0）。
      sel(null, 'mode', '生产方式', ['砂型', '流水线'], { default: '砂型', scope: 'calculator' }),
      sel(null, 'importance', '重要性', ['一般', '重要'], { default: '一般', scope: 'calculator' }),
    ],
    outputs: [
      { key: 'timeRange', label: '型内冷却时间', unit: 'min/h' }, { key: 'shakeTemp', label: '开箱温度', unit: '℃' },
      { key: 'warnings', label: '风险提示', unit: '' },
    ],
    calculate: () => {
      const wt = proj.getV('geometry.blankWeightKg') || 0;
      const wall = proj.getV('process.wallUsed') || proj.getV('geometry.wallAvg') || 0;
      if (wt <= 0 || wall <= 0) return null;
      // SHAKE_TEMP 键：灰铸铁/球墨铸铁/铸钢/铝合金/铜合金
      const matKey = { '灰铁': '灰铸铁', '球铁': '球墨铸铁', '铸钢': '铸钢', '铝合金': '铝合金', '铜合金': '铜合金' }[proj.getV('material.family') || '灰铁'];
      return runShakeout({ mat: matKey, weight: wt, wall, mode: '砂型', heatTreat: null, risk: null, importance: '一般' });
    },
  },
];

export const getCalcManifest = (id) => CALC_MANIFEST.find(c => c.id === id) || null;

/**
 * 设计中心执行顺序（原 designCenter.js 内联，PHASE 28.4 迁至声明层便于测试/维护）
 * PHASE 28.4 修复：riser 必须在 gating 前执行——gating 的 Hp 方案 A 读取 process.riserHeight
 * （riser 结果回写）。原顺序 gating 先于 riser → 首轮运行 gating 恒用 rh=0（无冒口退化值），
 * 中注 Hp 偏大 → 阻流截面 A 偏小 ~31%（真实案例 320.5 vs 153.9）。riser 无 gating 依赖，可安全前置。
 * 依赖约束：riser 无 results 依赖；gating 无 results 依赖；yield 依赖 gating+riser；charge 依赖 yield/gating。
 */
export const RUN_ORDER = ['shrinkage', 'machining', 'riser', 'gating', 'chill', 'yield', 'sandbox', 'charge', 'shakeout'];

/**
 * PHASE 28.5（42.txt 十）：最小可靠性等级——当前结果能否自动用于工程建议。
 * 三等级（不复杂评分，42.txt 明确"关键不是名字，而是工程自动建议与算法不确定必须分开"）：
 *   SAFE_TO_RECOMMEND        自动建议可直接使用（几何 VALID + 热结分析 OK）
 *   WARNING_REVIEW           结果可用但需人工复核（几何 WARNING / 均匀件 wallHot 估算 / 手动模式）
 *   BLOCK_AUTO_RECOMMEND     自动建议必须阻止（几何 INVALID / 热结分析失败或低置信度）
 * 与 riser/chill calculate 的状态矩阵同源（门禁是行为，等级是可观察标签，不新增语义）。
 */
export function reliabilityLevel({ geomStatus = 'VALID', hsStatus = 'none' } = {}) {
  if (geomStatus === 'INVALID' || hsStatus === 'INSUFFICIENT_RESOLUTION' || hsStatus === 'LOW_CONFIDENCE') return 'BLOCK_AUTO_RECOMMEND';
  if (hsStatus === 'ok') return geomStatus === 'WARNING' ? 'WARNING_REVIEW' : 'SAFE_TO_RECOMMEND';
  return 'WARNING_REVIEW';   // NO_HOTSPOT（wallHot 估算）/ none（手动模式）/ 几何 WARNING 无热结
}

/**
 * PHASE V2.0-10（120.txt §三）：**可信度等级的阻断优先级** —— 硬门禁是否压过"软降级"（修 N-E）。
 *
 *   背景：V2.0-06A1 为"未确认的自动 Mc"引入降级时写成 `(userMc || note) ? 'WARNING_REVIEW' : reliabilityLevel(…)`，
 *   `note` 为真即短路 ⇒ `reliabilityLevel` 再也轮不到 ⇒ 几何 INVALID（本应 BLOCK）被降成"需人工复核"；
 *   冷铁分支同病（`autoT`）；多热结路径**根本不调用** reliabilityLevel。三处症状相同。
 *
 *   规则（高 → 低）：
 *     ① **几何 INVALID ⇒ 恒阻断**。网格本身不可信 ⇒ 净重/体积/热结位置**全部**不可信；
 *        人工输入 Mc / T_hot 只替代了其中一个量，替代不了这些输入 ⇒ **人工放行在此不适用**。
 *     ② `reliabilityLevel` 判为 BLOCK 的其余阻断（热结分析失败 / 低置信度）⇒ **保留 PHASE 29 的人工放行**：
 *        用户显式输入了本模块关键量（humanInput）时维持软等级，否则阻断。
 *     ③ 无阻断 ⇒ 一律维持软等级（V2.0-06A1 / V2.0-08 的既定口径不变）。
 *
 *   ⚠ 纯标签判定：不参与任何数值计算，也不改变 `reliabilityLevel()` 自身的规则。
 *
 * @param {string} geomStatus 几何状态（'VALID' | 'WARNING' | 'INVALID'）
 * @param {string} hsStatus   热结分析状态
 * @param {boolean} humanInput 用户是否**显式输入了本模块的关键量**（冒口=Mc；冷铁=T_hot 或 Mc）
 * @returns {boolean} true = 硬门禁压过软降级，等级必须是 BLOCK_AUTO_RECOMMEND
 */
function isHardBlocked({ geomStatus, hsStatus, humanInput }) {
  if (geomStatus === 'INVALID') return true;
  return !humanInput && reliabilityLevel({ geomStatus, hsStatus }) === 'BLOCK_AUTO_RECOMMEND';
}

/** 参数缺失判定：从 CastingProject 取共享参数值（useMax 取数组最大值；select 取 options 匹配） */
export function paramValue(p) {
  if (!p.param) return p.default ?? '';
  const v = proj.getV(p.param);
  if (p.useMax && Array.isArray(v)) return v.length ? Math.max(...v) : 0;
  return v;
}

/** 参数是否缺失（需要用户输入） */
export function isMissing(p) {
  const v = paramValue(p);
  if (v === null || v === undefined || v === '') return true;
  if (typeof v === 'number') return !(v > 0);
  if (Array.isArray(v)) return !v.some(x => x > 0);
  return false;
}

/** 某计算器的缺失 requiredInputs（共享参数中尚未满足的） */
export function missingInputs(calcId) {
  const c = getCalcManifest(calcId);
  if (!c) return [];
  return c.requiredInputs.filter(isMissing);
}

/** 缺失参数集合（全部勾选计算器）→ 分页输入用 */
export function allMissingInputs(calcIds) {
  const seen = new Map();   // input 键 → 参数项（同键共享：weightKg 被多个计算器用）
  for (const id of calcIds) {
    const c = getCalcManifest(id);
    if (!c) continue;
    for (const p of c.requiredInputs) if (isMissing(p)) seen.set(p.input, { ...p, forCalcs: [...(seen.get(p.input)?.forCalcs || []), c.name] });
  }
  return [...seen.values()];
}

/**
 * PHASE 29（P1-40）：设计中心"高级参数"集 = 选中任务中 param 非 null 的 optionalInputs（始终可调，
 *   不按缺失过滤——optional 语义是"默认值可调整"，yieldSug 有默认 75 也应在高级区可改）。
 * 生命周期：声明（optionalInputs）→ 设计中心高级折叠区渲染（选中计算器即显示）→ 写回 project →
 *   calculate 消费 → 缺失/无效时由 calculate 内显式默认处理。
 * param=null 的 optional（scope:'calculator'）是独立计算器私有 UI 参数——独立视图是唯一入口，
 *   设计中心不渲染、不存储，calculate 用声明默认（简化行为，符合"计算器独立能力、中心自动串联"边界）。
 */
export function allOptionalInputs(calcIds) {
  const seen = new Map();   // input 键 → 参数项（同键共享）
  for (const id of calcIds) {
    const c = getCalcManifest(id);
    if (!c) continue;
    for (const p of c.optionalInputs || []) {
      if (!p.param) continue;   // scope=calculator：独立计算器入口
      seen.set(p.input, { ...p, forCalcs: [...(seen.get(p.input)?.forCalcs || []), c.name] });
    }
  }
  return [...seen.values()];
}

/** PHASE 73：出品率兜底——用户未填时用该材料的推荐值（材料表 y_sug），而不是硬编码 70% */
function yieldSugPct() {
  const fam = proj.getV('material.family');
  const key = { '灰铁': '灰铁(HT)', '球铁': '球铁(QT)', '铸钢': '铸钢(ZG)', '铝合金': '铝合金(Al)', '铜合金': '铜合金(Cu)' }[fam] || '灰铁(HT)';
  return (GATING_MATS[key] || {}).y_sug || 70;
}
