// ============================================================
// CastingProject · 统一项目数据模型（命令3 第10/26/27节）
// 所有计算器从这个模型读参数，计算结果写回模型。
// 每个参数携带来源元数据：{v, src, conf, editable} —— 可解释、可追溯。
// 内存单例 + localStorage 持久化 + onChange 订阅（沿用 context.js 模式）。
// 第一阶段只建实际用到的子结构，其余（Mold/Pattern/Cooling/Melting/Shakeout）按需扩展。
// ============================================================

const KEY = 'ct-project';
const LISTENERS = new Set();

/* ---- 参数来源枚举（命令3 第27节） ---- */
export const SRC = {
  STL_GEOMETRY_ANALYSIS: 'STL_GEOMETRY_ANALYSIS', // 从 STL 自动提取
  DERIVED: 'DERIVED',                 // 从已有参数计算推导
  USER_INPUT: 'USER_INPUT',           // 用户直接输入
  USER_OVERRIDE: 'USER_OVERRIDE',     // 用户修改了自动值
  SCENARIO: 'SCENARIO',               // 来自生产场景预填
  DEFAULT: 'DEFAULT',                 // 系统默认值
  CALC_RESULT: 'CALC_RESULT',         // 计算器计算结果
};

/* ---- 置信度 ---- */
export const CONF = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low', USER_CONFIRMED: 'user_confirmed' };

/** 创建参数：v=值，src=来源，conf=置信度，editable=是否允许用户修改 */
export function P(v, src = SRC.DEFAULT, conf = CONF.MEDIUM, editable = true) {
  return { v, src, conf, editable };
}

/* ---- 项目默认结构（参数均为 P() 对象；聚合结果用裸对象） ---- */
export function defaultProject() {
  return {
    meta: {
      name: '', createdAt: '', updatedAt: '',
      stlSession: P(null, SRC.DEFAULT, CONF.LOW, false),   // {fingerprint, fileName, importedAt}（18.txt 会话绑定）
    },
    geometry: {
      valid: P(false, SRC.DEFAULT, CONF.LOW, false),
      // PHASE 28.5（42.txt 五）：结构化几何状态（VALID/WARNING/INVALID）——valid 是布尔门禁，
      //   geomStatus 是结构化状态（WARNING=可继续但体积仅供参考），两者同源派生不重复语义。
      geomStatus: P('VALID', SRC.DEFAULT, CONF.LOW, false),
      triCount: P(0, SRC.DEFAULT, CONF.LOW, false),
      unit: P('mm', SRC.USER_INPUT, CONF.USER_CONFIRMED, true),   // STL 无单位，导入时确认
      size: P([0, 0, 0], SRC.DEFAULT, CONF.LOW, false),            // X/Y/Z mm
      bounds: P(null, SRC.DEFAULT, CONF.LOW, false),
      center: P(null, SRC.DEFAULT, CONF.LOW, false),
      volumeCm3: P(0, SRC.DEFAULT, CONF.LOW, true),                // 体积 cm³（自动计算，可改）
      areaCm2: P(0, SRC.DEFAULT, CONF.LOW, true),                  // 表面积 cm²
      // PHASE 28.3-A canonical：重量三语义拆分（禁止 weightKg 混用）
      netWeightKg: P(0, SRC.DEFAULT, CONF.LOW, true),              // 净重（STL 体积×固态密度 派生，可改；仅展示/校准）
      blankWeightKg: P(0, SRC.DEFAULT, CONF.LOW, true),            // 毛坯重（含加工余量，用户可改；gating/yield/riser/sandbox/shakeout 统一口径）
      wallMax: P(0, SRC.DEFAULT, CONF.LOW, true),                  // 最大壁厚 mm
      wallAvg: P(0, SRC.DEFAULT, CONF.LOW, true),                  // 平均壁厚 mm
      wallHist: P([], SRC.DEFAULT, CONF.LOW, false),               // 壁厚分布直方图
      meshIssues: P([], SRC.DEFAULT, CONF.LOW, false),             // Geometry Validation 问题清单
    },
    material: {
      family: P('', SRC.DEFAULT, CONF.LOW, true),                  // 材料大类 灰铁/球铁/铸钢/铝合金/铜合金
      grade: P('', SRC.DEFAULT, CONF.LOW, true),                   // 牌号（如 QT500-7）
      // PHASE 28.3-A canonical：密度双语义拆分（禁止一个 density 同时代表液态/固态）
      liquidDensity: P(7.0, SRC.SCENARIO, CONF.MEDIUM, true),      // 液态密度 g/cm³（gating 用，材料表自动）
      solidDensity: P(7.0, SRC.SCENARIO, CONF.MEDIUM, true),       // 固态密度 g/cm³（净重计算/riser 体积换算用）
      pourTemp: P('', SRC.DEFAULT, CONF.LOW, true),                // 浇注温度 ℃
      linearShrinkage: P('', SRC.DEFAULT, CONF.LOW, true),         // 线收缩率
      yieldMin: P(65, SRC.DEFAULT, CONF.MEDIUM, true),             // 出品率区间（材料推荐）
      yieldMax: P(85, SRC.DEFAULT, CONF.MEDIUM, true),
      yieldSug: P(75, SRC.DEFAULT, CONF.MEDIUM, true),
    },
    production: {
      qty: P(1000, SRC.USER_INPUT, CONF.USER_CONFIRMED, true),     // 目标产量 件
      cavities: P(1, SRC.USER_INPUT, CONF.USER_CONFIRMED, true),   // 一模件数
      ingateN: P(0, SRC.DEFAULT, CONF.LOW, true),                  // 内浇道个数（0=按推荐自动 2~3）
      // PHASE 80（79.txt 追问）：横浇道条数——与内浇道同级，结果页 ③ 可直接改（0=用默认 2 条）
      runnerN: P(0, SRC.DEFAULT, CONF.LOW, true),                  // 横浇道条数
      line: P('不指定', SRC.DEFAULT, CONF.LOW, true),               // 造型线
      prod: P('不指定', SRC.DEFAULT, CONF.LOW, true),               // 生产方式
      method: P('不指定', SRC.DEFAULT, CONF.LOW, true),             // 铸造方法
    },
    process: {
      pourPos: P('顶注', SRC.DEFAULT, CONF.LOW, true),              // 浇注方向
      wallUsed: P(0, SRC.DEFAULT, CONF.LOW, true),                  // 浇注时间用主壁厚（自动=wallAvg 可改）
      // PHASE 28.3-A canonical：mcUsed 双语义拆分（热结模数 vs 壁厚/2）
      mcHotspot: P(0, SRC.DEFAULT, CONF.LOW, true),                 // 热结模数 Mc（STL 热结自动；riser 有热结时用）
      wallHot: P(0, SRC.DEFAULT, CONF.LOW, true),                   // 壁厚模数 = 主体壁厚/2（DERIVED；无热结时 riser 用；chill T=2×wallHot）
      riserHeight: P(0, SRC.DEFAULT, CONF.LOW, true),               // 冒口高度 mm（riser 结果回写 CALC_RESULT；gating Hp 用，可改）
      // PHASE 71.7（77.txt 二）：冒口热结选择——[{id, mc}]，空 = 自动（主热结 H1）
      hsPick: P([], SRC.DEFAULT, CONF.LOW, true),                   // 用户勾选的热结 + 各自 Mc（弹窗改值）
      // PHASE 71.7（77.txt 六）：内浇道厚度/个数（推荐 = 主体壁厚÷3 / 2~3 个；0=按推荐自动）
      gateThk: P(0, SRC.DEFAULT, CONF.LOW, true),                   // 内浇道厚度 mm
      // PHASE 80（79.txt 追问）：横浇道厚度——同上，0 = 用工具既有默认 25 mm
      runnerThk: P(0, SRC.DEFAULT, CONF.LOW, true),                 // 横浇道厚度 mm
      // PHASE 78（78.txt 二/三/八）：三项用户可选的工艺设计口径（默认值=工程常用档）
      ratioKey: P('', SRC.DEFAULT, CONF.LOW, true),                 // 浇注系统比例预设（'' = 按材料/重量自动推荐）
      riserShape: P('cyl', SRC.DEFAULT, CONF.LOW, true),            // 冒口形状（riser.RISER_SHAPES 键；默认圆柱形）
      // PHASE 79（79.txt 四）：排气 = 用户定**直径**、系统按企业标准反算**孔数**
      //   （79.txt 原文："直径用户可以输入，默认 3，可以改成 2 或 1；数量根据总排气面积由系统自动生成"）
      ventD: P(3, SRC.DEFAULT, CONF.LOW, true),                     // 排气孔直径 mm（默认 3）
      chillT: P(0, SRC.DEFAULT, CONF.LOW, true),                    // 热节壁厚 T_hot mm（chill 独立输入；默认 2×热节模数 自动派生）
      // PHASE 28.3-B：gating 声明了 process.Ho/ph 但模型无字段 → 用户输入静默失败（set 返回 false）
      //   → calculate 永远用 fallback 150/100。补字段（默认 0=缺失→设计中心提示输入；未填时 calculate fallback 150/100 不变）。
      Ho: P(0, SRC.DEFAULT, CONF.LOW, true),                        // 内浇道至上箱面距离 mm
      ph: P(0, SRC.DEFAULT, CONF.LOW, true),                        // 铸件高度（浇注方向）mm
    },
    hotspots: {
      status: P('none', SRC.DEFAULT, CONF.LOW, false),              // none/ok/no_valid_hotspot
      reason: P('', SRC.DEFAULT, CONF.LOW, false),                  // NO_VALID_HOTSPOT 原因（命令3 第21节）
      items: P([], SRC.DEFAULT, CONF.LOW, false),                   // [{id, x,y,z, mc, vol, region, peaks[]}]
    },
    runner: { result: P(null, SRC.DEFAULT, CONF.LOW, false) },      // 浇注系统计算结果
    risers: { items: P([], SRC.DEFAULT, CONF.LOW, false) },         // 冒口建议（按热点/整体）
    yield: { result: P(null, SRC.DEFAULT, CONF.LOW, false) },       // 出品率结果
    results: { summary: P([], SRC.DEFAULT, CONF.LOW, false) },      // 结果中心汇总条目
  };
}

/**
 * PHASE 28.3-A 旧参数迁移（只拆分语义，不改变数值）：
 *   material.density  → liquidDensity/solidDensity（同值同 src）
 *   geometry.weightKg → netWeightKg/blankWeightKg（同值同 src）
 *   process.mcUsed    → mcHotspot/wallHot（同值同 src；riser/chill 消费逻辑等价，数值不变）
 * 迁移后旧字段从结构移除（defaultProject 无旧字段），get() 返回 null → 杜绝旧路径继续被使用。
 */
export function migrateProject(p) {
  if (!p || typeof p !== 'object') return defaultProject();   // 防御：空项目直接给默认骨架（不返回 null）
  const old = (path) => {
    let o = p;
    for (const k of path.split('.')) { if (o == null) return null; o = o[k]; }
    return o && typeof o === 'object' && 'v' in o ? o : null;
  };
  const dup = (dst, srcObj, srcKey) => {
    if (!srcObj) return;
    if (!dst[srcKey]) dst[srcKey] = { v: 0, src: SRC.DEFAULT, conf: CONF.LOW, editable: true };   // 目标字段缺失时创建（防御）
    const n = dst[srcKey];
    n.v = srcObj.v; n.src = srcObj.src; n.conf = srcObj.conf;
    if (srcObj.editable !== undefined) n.editable = srcObj.editable;
  };
  const src = old('material.density');
  if (src) { dup(p.material, src, 'liquidDensity'); dup(p.material, src, 'solidDensity'); delete p.material.density; }
  const wt = old('geometry.weightKg');
  if (wt) { dup(p.geometry, wt, 'netWeightKg'); dup(p.geometry, wt, 'blankWeightKg'); delete p.geometry.weightKg; }
  const mc = old('process.mcUsed');
  if (mc) { dup(p.process, mc, 'mcHotspot'); dup(p.process, mc, 'wallHot'); delete p.process.mcUsed; }
  return p;
}

/**
 * PHASE 78 修复（78.txt 四·交互 Bug 根因）：**深合并恢复**。
 * 原先 `{ ...defaultProject(), ...saved }` 是顶层浅合并——持久化项目里的 `process` 子对象
 * 会整体替换默认值，于是**版本升级后新增的参数字段**（process.hsPick / gateThk /
 * production.ingateN / process.riserShape …）在旧项目上根本不存在：
 *   get(path) → null → set(path, …) 直接 return false（静默失败）
 *   → UI 写不进去、勾选框不打勾、内浇道厚度改了没反应（用户实测："点确认后前面的选项不打对号"）。
 * 规则：以 defaultProject 为骨架，持久化值覆盖同名字段；两侧同为**普通对象**才递归下降，
 *   参数对象（含 v 的 {v,src,conf,editable}）与数组**整体覆盖**，不做深挖（保护参数语义）。
 */
const isParamObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && 'v' in o;
export function mergeDeep(base, saved) {
  // 无存档（首次运行 / localStorage 为空）→ 直接用默认骨架。
  //   注意 null 与 undefined 都必须回落到 base：早期写成 `saved === undefined ? base : saved`
  //   会让首次运行得到 project = null → get() 恒 null → 全站静默失效（实测踩坑）。
  if (saved === undefined || saved === null) return base;
  if (typeof saved !== 'object' || Array.isArray(saved)) return saved;
  const out = { ...base };
  for (const [k, s] of Object.entries(saved)) {
    const b = out[k];
    if (!isParamObj(b) && !isParamObj(s) && b && typeof b === 'object' && !Array.isArray(b) && s && typeof s === 'object' && !Array.isArray(s)) {
      out[k] = mergeDeep(b, s);          // 结构层（material/geometry/process/…）
    } else {
      out[k] = s;                        // 参数对象/数组/标量：以持久化值为准
    }
  }
  return out;
}

let project = defaultProject();
try {
  project = migrateProject(mergeDeep(defaultProject(), JSON.parse(localStorage.getItem(KEY) || 'null')));
} catch (e) { /* 首次运行 */ }

/* ---- 基础 API ---- */

/** 取参数对象（含元数据）。path 如 'geometry.volumeCm3'；不存在返回 null */
export function get(path) {
  let o = project;
  for (const k of String(path).split('.')) {
    if (o == null) return null;
    o = o[k];
  }
  return o && typeof o === 'object' && 'v' in o ? o : null;
}

/** 取裸值（计算器适配层常用）：p.getV('geometry.volumeCm3') */
export function getV(path) { const p = get(path); return p ? p.v : undefined; }

/**
 * 设置参数：自动附带来源元数据。
 * @param {string} path  'geometry.volumeCm3'
 * @param {*} v          值
 * @param {string} [src]  SRC 枚举；缺省：原参数是自动来源且可编辑 → USER_OVERRIDE，否则保持原 src
 * @param {string} [conf] CONF 枚举
 */
export function set(path, v, src, conf) {
  const p = get(path);
  if (!p) return false;
  if (src === undefined) {
    // 未显式给来源：若原是自动值且可编辑 → 标记为"用户修改过"（命令3 第12节）
    // PHASE 28.3-B：CALC_RESULT 同样算自动值——用户直接改计算结果（如 riserHeight 冒口高度）
    //   必须标记 USER_OVERRIDE，否则计算器重算会静默覆盖用户输入。
    if (p.editable && (p.src === SRC.STL_GEOMETRY_ANALYSIS || p.src === SRC.DERIVED || p.src === SRC.DEFAULT || p.src === SRC.SCENARIO || p.src === SRC.CALC_RESULT)) {
      src = SRC.USER_OVERRIDE;
      conf = CONF.USER_CONFIRMED;
    } else src = p.src, conf = p.conf;
  }
  // PHASE 71.5（75.txt §八）：自动值基准 orig——用户覆盖 STL/派生自动值时保留"原始值"，
  //   支持 UI 显示"STL 原始 X · 当前采用 Y"与一键恢复（不丢来源语义）。
  //   自动写入（STL/DERIVED）→ 基准随时刷新为最新自动值；
  //   非自动写入且原值是自动值 → 首次覆盖时固化基准（orig ??= 旧值，多次覆盖只保留最初的自动值）。
  const wasAuto = p.src === SRC.STL_GEOMETRY_ANALYSIS || p.src === SRC.DERIVED;
  if (src === SRC.STL_GEOMETRY_ANALYSIS || src === SRC.DERIVED) {
    // 自动写入本身即基准值（STL 重算/单位切换后 orig 随最新自动值刷新）
    p.orig = { v, src, conf: conf || p.conf };
  } else if (wasAuto && (src === SRC.USER_OVERRIDE || src === SRC.USER_INPUT) && !p.orig) {
    p.orig = { v: p.v, src: p.src, conf: p.conf };   // 首次覆盖：固化覆盖前的自动原值
  }
  p.v = v; p.src = src; if (conf) p.conf = conf;
  touch();
  return true;
}

/** 恢复自动原值（PHASE 71.5：orig 存在且用户已覆盖时；自动值来源一并还原）。返回是否成功。 */
export function restoreAutoValue(path) {
  const p = get(path);
  if (!p || !p.orig || p.src !== SRC.USER_OVERRIDE) return false;
  const { v, src, conf } = p.orig;
  p.orig = undefined;   // 清除基准：恢复后再改 = 以当前自动值为新基准
  set(path, v, src, conf);
  return true;
}

/** 设置 + 显式来源（计算器写回结果用） */
export function setResult(path, v) {
  return set(path, v, SRC.CALC_RESULT, CONF.HIGH);
}

/* ---- 持久化 / 订阅 ---- */
function touch() {
  project.meta.updatedAt = new Date().toISOString();
  save(); notify();
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(project)); } catch (e) {}
}
export function onChange(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }
export function notify() { LISTENERS.forEach(fn => fn(project)); }
export function reset() { project = defaultProject(); save(); notify(); }
export function getProject() { return project; }

/* ---- 便捷派生 ---- */

/**
 * 根据体积×固态密度刷新净重（密度变化/体积变化后调用；PHASE 28.3-A：净重用固态密度）。
 * 毛坯重 blankWeightKg 未手动覆盖时默认同步净重（毛坯=净重，用户可上调含余量值）。
 */
export function refreshWeight() {
  const v = getV('geometry.volumeCm3');
  const d = getV('material.solidDensity');
  if (v > 0 && d > 0 && get('geometry.netWeightKg').src !== SRC.USER_OVERRIDE) {
    const nw = parseFloat((v * d / 1000).toFixed(3));
    set('geometry.netWeightKg', nw, SRC.DERIVED, CONF.HIGH);
    if (get('geometry.blankWeightKg').src !== SRC.USER_OVERRIDE) {
      set('geometry.blankWeightKg', nw, SRC.DERIVED, CONF.HIGH);
    }
  }
}

/** 生产场景 → 项目（与 context.js 对接：材料大类/造型线/生产方式/铸造方法） */
export function importFromContext(ctx) {
  if (ctx?.material) set('material.family', ctx.material, SRC.SCENARIO, CONF.MEDIUM);
  if (ctx?.line)     set('production.line', ctx.line, SRC.SCENARIO, CONF.MEDIUM);
  if (ctx?.prod)     set('production.prod', ctx.prod, SRC.SCENARIO, CONF.MEDIUM);
  if (ctx?.method)   set('production.method', ctx.method, SRC.SCENARIO, CONF.MEDIUM);
}

/* ---- PHASE 71.7（77.txt 末）：生产场景 → 设计中心参数的"柔性"联动 ----
   与 importFromContext 的区别：只写"用户从未显式设定过"的参数（DEFAULT/SCENARIO），
   已有 USER_INPUT / USER_OVERRIDE 的一律不覆盖——让场景成为默认值来源而不是覆盖源。 */
/** 场景弹窗取值 → 设计中心铸造方法选项（含工艺细分档；3D 打印砂型按砂型机器造型档参考） */
export const CTX_METHOD_MAP = {
  '砂型': '砂型 · 机器造型/壳型',
  '金属型': '金属型（重力/低压）',
  '3D打印': '砂型 · 机器造型/壳型',
};
const isUserSet = (path) => {
  const p = get(path);
  return !!p && (p.src === SRC.USER_INPUT || p.src === SRC.USER_OVERRIDE);
};
/**
 * 从生产场景补齐设计中心参数（不覆盖用户选择）。
 * @param {object} ctx  context.get() 的返回值
 * @param {(fam:string)=>void} [applyMaterialDefaults] 材料大类 → 密度/出品率回填（由 UI 层提供，避免 model 依赖材料表）
 * @returns {string[]} 实际写入的参数路径
 */
export function syncFromContext(ctx, applyMaterialDefaults) {
  const written = [];
  if (!ctx) return written;
  if (!getV('material.family') && ctx.material) {
    const fam = ctx.family || ctx.material;   // 调用方（designCenter）可先用 context.familyOf 归一
    if (set('material.family', fam, SRC.SCENARIO, CONF.MEDIUM)) written.push('material.family');
    applyMaterialDefaults?.(fam);
  }
  const pair = [['production.line', ctx.line, null], ['production.method', ctx.method, CTX_METHOD_MAP],
    ['production.prod', ctx.prod, null]];
  for (const [path, val, map] of pair) {
    if (!val || isUserSet(path)) continue;
    if (set(path, map?.[val] || val, SRC.SCENARIO, CONF.MEDIUM)) written.push(path);
  }
  return written;
}

/* ---- STL 生命周期（18.txt PHASE 16-B） ---- */

/**
 * 清除与 STL 强绑定的数据（替换/删除/刷新共用清理语义，18.txt 一/三/四）。
 *
 * 清理规则：
 *   ① 无条件清（STL 专属，无用户价值）：geometry 校验/统计（valid/triCount/size/
 *      bounds/center/wallHist/meshIssues）、hotspots.*、旧计算结果
 *      （runner.result / risers.items / yield.result / results.summary——18.txt 六：
 *      旧模型结果不能冒充新模型结果）、meta.stlSession（会话绑定）。
 *   ② 按来源清（STL 绑定 vs 用户数据，18.txt 二）：
 *      - volumeCm3 / areaCm2 / wallMax / wallAvg / netWeightKg / blankWeightKg：
 *        src ∈ {STL_GEOMETRY_ANALYSIS, USER_OVERRIDE} → 清（STL 几何属性 + 用户对它的
 *        修改都绑定旧几何，"强绑定 STL 几何" → 新 STL 必须重新生成）；
 *        src = USER_INPUT（手动模式填写）→ 保留（与 STL 无关）。
 *      - process.wallUsed / mcHotspot / wallHot：src = USER_INPUT（手动模式填写）→ 保留；
 *        其他（STL_GEOMETRY_ANALYSIS / DERIVED / USER_OVERRIDE）→ 清。
 *   保留：material.*、production.*、process.pourPos 等与 STL 无关的用户输入。
 *
 * @returns {string[]} 实际清理的参数路径（测试断言用）
 */
export function clearStlBoundData() {
  const cleared = [];
  /**
   * PHASE 73 P1 修复：清参数时**一并清掉 orig 基准**。
   *   回归现象：导入 cube50 → 刷新（STL 数据按会话语义清空）→ 手动模式把体积改成 777
   *   → 该行出现 ↺ 锚点（title「恢复 STL/自动原值（当前：125）」）→ 点击后体积变回 125，
   *   而本次会话根本没有 STL。根因是本函数只清 v/src，从不动 p.orig，
   *   而 ↺ 锚点的判定是 `src === USER_OVERRIDE && p.orig` —— 陈旧的基准于是复活。
   *   语义上 orig 是"被覆盖前的自动原值"，自动值既然清了，基准必须一起失效。
   */
  const dropOrig = (path) => { const p = get(path); if (p && p.orig !== undefined) p.orig = undefined; };
  /** 无条件清空（STL 专属数据）——已空且 DEFAULT 来源则跳过 */
  const clearAll = (path, v, conf) => {
    const p = get(path);
    if (!p) return;
    if (p.src === SRC.DEFAULT && JSON.stringify(p.v) === JSON.stringify(v)) return;
    set(path, v, SRC.DEFAULT, conf);
    cleared.push(path);
  };
  /** 按来源清空（STL 绑定才清，用户数据保留） */
  const clearIfBound = (path) => {
    const p = get(path);
    if (!p || (p.src !== SRC.STL_GEOMETRY_ANALYSIS && p.src !== SRC.USER_OVERRIDE)) return;
    const empty = typeof p.v === 'number' ? 0 : (Array.isArray(p.v) ? [] : null);
    if (p.v === empty) return;
    set(path, empty, SRC.DEFAULT, CONF.LOW);
    cleared.push(path);
  };
  /** 按来源清空（仅 USER_INPUT 保留——手动模式填写，与 STL 无关） */
  const clearIfNotUserInput = (path) => {
    const p = get(path);
    if (!p || p.src === SRC.USER_INPUT) return;
    set(path, 0, SRC.DEFAULT, CONF.LOW);
    cleared.push(path);
  };

  // ① 无条件清（STL 专属）
  clearAll('geometry.valid', false, CONF.LOW);
  clearAll('geometry.geomStatus', 'VALID', CONF.LOW);
  clearAll('geometry.triCount', 0, CONF.LOW);
  clearAll('geometry.size', [0, 0, 0], CONF.LOW);
  clearAll('geometry.bounds', null, CONF.LOW);
  clearAll('geometry.center', null, CONF.LOW);
  clearAll('geometry.wallHist', [], CONF.LOW);
  clearAll('geometry.meshIssues', [], CONF.LOW);
  clearAll('hotspots.status', 'none', CONF.LOW);
  clearAll('hotspots.reason', '', CONF.LOW);
  clearAll('hotspots.items', [], CONF.LOW);
  clearAll('process.hsPick', [], CONF.LOW);   // PHASE 71.7：热结选择绑定旧热结 id，替换 STL 必须清
  clearAll('runner.result', null, CONF.LOW);        // 18.txt 六：旧计算结果
  clearAll('risers.items', [], CONF.LOW);
  clearAll('yield.result', null, CONF.LOW);
  clearAll('results.summary', [], CONF.LOW);
  clearAll('meta.stlSession', null, CONF.LOW);
  // 无条件清的那批 + 按来源清的那批，orig 基准全部失效（见上）
  for (const path of ['geometry.volumeCm3', 'geometry.areaCm2', 'geometry.wallMax', 'geometry.wallAvg',
    'geometry.netWeightKg', 'geometry.blankWeightKg', 'process.wallUsed', 'process.mcHotspot',
    'process.wallHot', 'process.riserHeight', 'geometry.size', 'geometry.unit']) dropOrig(path);

  // ② 按来源清（STL 绑定几何属性）
  const vol = get('geometry.volumeCm3');
  const volBound = !!vol && (vol.src === SRC.STL_GEOMETRY_ANALYSIS || vol.src === SRC.USER_OVERRIDE);
  clearIfBound('geometry.volumeCm3');
  clearIfBound('geometry.areaCm2');
  clearIfBound('geometry.wallMax');
  clearIfBound('geometry.wallAvg');
  // 重量（PHASE 28.3-A 双字段）：DERIVED 时需联动源头——源体积是 STL 绑定（将被清）→ 重量必须清
  //   （否则"STL B + STL A 的重量"残留）；源体积是手动 USER_INPUT → 保留。
  const clearWt = (path) => {
    const wt = get(path);
    if (wt && (volBound || wt.src === SRC.STL_GEOMETRY_ANALYSIS || wt.src === SRC.USER_OVERRIDE) && wt.v !== 0) {
      set(path, 0, SRC.DEFAULT, CONF.LOW);
      cleared.push(path);
    }
  };
  clearWt('geometry.netWeightKg');
  clearWt('geometry.blankWeightKg');
  clearIfNotUserInput('process.wallUsed');
  clearIfNotUserInput('process.mcHotspot');
  clearIfNotUserInput('process.wallHot');
  // PHASE 28.4 修复：process.riserHeight（riser 结果回写）随 risers.items 一并清理——
  //   替换 STL 后旧模型的冒口高度残留会让 gating Hp 用旧模型值（新模型只跑 gating 不跑 riser 时不自愈）。
  //   与 risers.items 无条件清语义一致；USER_INPUT（用户手动填预估）保留。
  clearIfNotUserInput('process.riserHeight');

  return cleared;
}

/**
 * STL 会话校验（18.txt 四：页面刷新/重进不得出现"无 STL 但有 STL 数据"幽灵状态）。
 * 规则：内存 mesh 在（同页路由切换，未刷新）→ 会话有效，不动；
 *   否则（刷新/新会话/重进）只要项目里有 STL 会话或 STL 来源数据 → 清理绑定数据。
 * @param {boolean} hasMeshInMemory  designCenter 内存里是否有当前 STL mesh
 * @returns {{stale:boolean, cleared:boolean}}  stale=检测到失效 STL 会话；cleared=是否清理了数据
 */
export function stlSessionCheck(hasMeshInMemory) {
  if (hasMeshInMemory) return { stale: false, cleared: false };
  const stl = get('meta.stlSession');
  const hasStlData = !!stl?.v?.fingerprint
    || getV('geometry.triCount') > 0
    || (getV('hotspots.items') || []).length > 0;
  if (!hasStlData) return { stale: false, cleared: false };
  const n = clearStlBoundData().length;
  return { stale: true, cleared: n > 0 };
}

/** 项目 → 生产场景（设计中心完成后同步，保持现有计算器预填可用） */
export function exportToContext(ctxApi) {
  const fam = getV('material.family');
  if (fam) ctxApi.set({ material: fam });
  const line = getV('production.line'), prod = getV('production.prod'), method = getV('production.method');
  const patch = {};
  if (line && line !== '不指定') patch.line = line;
  if (prod && prod !== '不指定') patch.prod = prod;
  if (method && method !== '不指定') patch.method = method;
  if (Object.keys(patch).length) ctxApi.set(patch);
}
