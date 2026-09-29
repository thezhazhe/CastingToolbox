// ============================================================
// 工艺检验中心 · 数据模型（PHASE 88 · 88.txt §六/§八~§二十二/§二十七）
//
// 定位（88.txt §五）：用户已经有一个产品 STL 和一套工艺 STL，
//   快速检查这套工艺方案有没有明显问题。
//   **不是**"模拟这个铸件到底怎么凝固"。
//
// 本模块 = 纯函数层：不碰 DOM、不碰 three.js、不碰 localStorage。
//   Hotspot 由调用方传入（= 引擎 V3 的既有输出，88.txt §八：不重新计算 Hotspot）。
//   → Node 可直接测（88.txt §二十九 Case A~F 全部在本层验证）。
//
// ★ 多实例（88.txt §六）：所有容器从一开始就是 N 个。
//   Product×1 / Hotspots×N / Risers×N / Sprues×N / Runners×N / Ingates×N
//
// ★ PHASE 95（95.txt §六）：本模块开始**引用经典浇注系统计算器**（calcs/gating.js）。
//   这是全项目唯一一份浇注时间/流速公式（PHASE 47/48/49/50 冻结链），
//   检测中心**只调用、不复制**（95.txt §十二："禁止复制一套公式"）。
//   calcs/gating.js 自身零 import → 不构成循环依赖。
// ============================================================
import { MATERIALS, calc_t, calc_v, V_LIMIT } from '../../calcs/gating.js';

/* ---------- 对象类别 ---------- */

export const KIND = {
  PRODUCT: 'product',
  RISER: 'riser',
  /** PHASE 89 §四：用户只导入**一整份**浇注系统 STL，直浇道/横浇道/内浇口由程序追踪得出 */
  GATING: 'gating',
  // PHASE 88 的独立导入类别（89.txt §十四 已从输入区移除）。
  // 仍保留常量：S1/G1/I1 的编号前缀与 gatingTrace 的分段分类共用同一套命名，删掉会让两边对不上。
  SPRUE: 'sprue',
  RUNNER: 'runner',
  INGATE: 'ingate',
};

/** 类别元数据：ID 前缀（R1/R2、S1、G1、I1 命名）+ 是否允许多实例 */
export const KIND_META = {
  [KIND.PRODUCT]: { prefix: 'P', zh: '产品', en: 'Product', multi: false },
  [KIND.RISER]: { prefix: 'R', zh: '冒口', en: 'Riser', multi: true },
  [KIND.GATING]: { prefix: 'GS', zh: '浇注系统', en: 'Gating System', multi: false },
  [KIND.SPRUE]: { prefix: 'S', zh: '直浇道', en: 'Sprue', multi: true },
  [KIND.RUNNER]: { prefix: 'G', zh: '横浇道', en: 'Runner', multi: true },
  [KIND.INGATE]: { prefix: 'I', zh: '内浇口', en: 'Ingate', multi: true },
};

/** PHASE 89 §十四：输入区只保留这三个槽 */
export const IMPORT_KINDS = [KIND.PRODUCT, KIND.RISER, KIND.GATING];

/** 多实例类别（PHASE 88 的导入槽顺序；PHASE 89 起只用于分段编号） */
export const MULTI_KINDS = [KIND.RISER, KIND.SPRUE, KIND.RUNNER, KIND.INGATE];

/**
 * 冒口模数经验判据（88.txt §十）：
 *   M_riser × 1.0 ≥ M_hotspot × 1.2   ⇔   M_riser / M_hotspot ≥ 1.2
 * ⚠ 1.2 是**经验设计参数**，不是凝固模拟结论；UI 必须如实标注（88.txt §十末段）。
 */
export const MODULUS_RATIO_MIN = 1.2;

/** 生成对象 ID：R1 / R2 / S1 / G1 / I1（按导入顺序） */
export function objectId(kind, index) {
  return (KIND_META[kind]?.prefix || 'X') + (index + 1);
}

/* ---------- 距离与配对 ---------- */

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Hotspot × Riser 全关系（88.txt §十一：内部必须能算 N×N）
 *
 * 坐标语义（重要，UI 必须如实说明）：
 *   · 热结位置 = 引擎 V3 输出的代表点（region 质心），**不是显示层的微调点**——
 *     显示微调是纯展示行为（PHASE 86），工程计算一律用引擎原值。
 *   · 冒口位置 = 冒口 STL 包围盒中心。
 *   · 距离 = 上述两点的直线距离（中心距）。各对象必须在**同一坐标系**导出。
 *
 * ⚠ 88.txt §二十六：本层只能确定"几何上最近的冒口"，
 *   **不能**声称"这个冒口负责这个热结"——故字段名一律用 nearest（最近），不用 responsible。
 *
 * @param {Array<{id:number|string, x:number, y:number, z:number, mc:number}>} hotspots
 * @param {Array<{id:string, name:string, metrics:{modulusMm:number|null, center:number[]}}>} risers
 * @returns {{rows:Array, counts:object, distances:number[]}}
 */
export function buildRelationRows(hotspots = [], risers = []) {
  const hsList = hotspots || [];
  const rList = (risers || []).filter(r => r?.metrics);
  const rows = hsList.map(h => {
    const all = rList.map(r => {
      const rm = r.metrics.modulusMm;
      const d = r.metrics.center ? dist3([h.x, h.y, h.z], r.metrics.center) : NaN;
      const ratio = (rm != null && rm > 0 && h.mc > 0) ? rm / h.mc : null;
      return {
        riserId: r.id, riserName: r.name,
        distance: d,
        riserModulus: rm,
        ratio,
        ok: ratio != null ? ratio >= MODULUS_RATIO_MIN : null,
      };
    }).sort((a, b) => a.distance - b.distance);      // 最近优先（88.txt §十三 默认关联最近冒口）
    return {
      hsId: h.id, hsMc: h.mc, hsX: h.x, hsY: h.y, hsZ: h.z,
      hsVolumeCm3: h.regionVolumeCm3 ?? null,
      hsConfidence: h.confidence ?? null,
      nearest: all.length ? all[0] : null,
      all,
    };
  });

  const withRiser = rows.filter(r => r.nearest);
  const counts = {
    hsTotal: rows.length,
    riserTotal: rList.length,
    covered: withRiser.length,
    modulusOk: withRiser.filter(r => r.nearest.ok === true).length,
    modulusLow: withRiser.filter(r => r.nearest.ok === false).length,
    // 冒口存在但模数不可得（STL 无效/零面积）→ 单独计数，不算"不足"也不算"满足"
    modulusUnknown: withRiser.filter(r => r.nearest.ok === null).length,
  };
  const distances = withRiser.map(r => r.nearest.distance).filter(Number.isFinite);
  return { rows, counts, distances };
}

/* ============================================================
   冒口检测（PHASE 93 · 93.txt §九~§十三）
   ------------------------------------------------------------
   与上面 buildRelationRows 的**方向相反**，两者并存、各管一件事：
     · buildRelationRows（PHASE 88）：每个**热结**一行 → 它最近的冒口。回答"热结有没有被覆盖"。
     · buildRiserRows   （PHASE 93）：每个**冒口**一行 → 它最近的热点。回答"这个冒口够不够大"。
   93.txt §九 明确的默认展示单元是**冒口**，所以检测页用后者；前者仍是完整关系的来源。

   ★ 命名纪律（93.txt §十一，与 88.txt §二十六 同一条，绝不能违反）：
     只能叫「最近热点 / 最近冒口 / 几何关系」，
     **禁止**出现「负责冒口 / feeding riser / responsible」——
     几何距离推导不出工艺上的补缩责任关系，那是另一个工程问题。

   ★ 不给猜值（93.txt §八末段 / §十八.10）：
     冒口几何不是有效封闭实体时，**模数一律为 null**，不拿一个算不准的 V/A 去参与判定。
   ============================================================ */

/** 冒口模数为什么不可用（给视图层查 i18n，不在这里放文案） */
export const RISER_REASON = {
  NOT_CLOSED: 'not_closed',     // 组件不是闭合实体 → 体积不可信（§八）
  ZERO_AREA: 'zero_area',       // 表面积为 0 / 没有三角形 → M = V/A 无定义
};

/**
 * 冒口 → 最近热点（93.txt §九~§十一）
 *
 * 距离口径与 88 口径**完全一致**（两处必须是同一个定义，否则同一份数据会出现两个数）：
 *   热点位置 = 引擎 V3 的代表点；冒口位置 = 冒口包围盒中心；距离 = 两点直线距离。
 *
 * @param {Array<{id,x,y,z,mc,regionVolumeCm3,confidence}>} hotspots
 * @param {Array<{id,name,metrics:{modulusMm,volumeMm3,areaMm2,center},volumeReliable?}>} risers
 * @returns {{rows:Array, counts:object, distances:number[]}}
 *   rows[i] = { riserId, riserModulus, modulusUsable, reason, nearest, all, ok }
 *   counts  = { riserTotal, hotspotTotal, withHotspot, modulusOk, modulusLow,
 *               modulusUnknown, modulusUnreliable, noHotspot }
 */
export function buildRiserRows(hotspots = [], risers = []) {
  const hsList = (hotspots || []).filter(h => h && Number.isFinite(h.x) && Number.isFinite(h.mc));
  const rList = (risers || []).filter(r => r?.metrics);

  const rows = rList.map(r => {
    // volumeReliable === false → 组件不闭合；undefined（旧路径直接 makeObject 出来的）按可信处理
    const reliable = r.volumeReliable !== false;
    const v = r.metrics.volumeMm3, a = r.metrics.areaMm2;
    const rawModulus = reliable ? r.metrics.modulusMm : null;
    // M = V / A；面积为 0 或体积非正 → 无定义，同样是"不给猜值"
    const usable = rawModulus != null && Number.isFinite(rawModulus) && rawModulus > 0
      && Number.isFinite(v) && v > 0 && Number.isFinite(a) && a > 0;
    const modulusMm = usable ? rawModulus : null;

    // 与**所有**热点的距离（N×M 内部算全，UI 默认只显示最近的一个 —— §九）
    const all = hsList.map(h => {
      const d = r.metrics.center ? dist3([h.x, h.y, h.z], r.metrics.center) : NaN;
      const mcOk = Number.isFinite(h.mc) && h.mc > 0;
      const ratio = usable && mcOk ? modulusMm / h.mc : null;
      return {
        hsId: h.id, hsMc: h.mc,
        hsVolumeCm3: h.regionVolumeCm3 ?? null,
        hsConfidence: h.confidence ?? null,
        distance: d,
        ratio,
        ok: ratio != null ? ratio >= MODULUS_RATIO_MIN : null,
      };
    }).sort((x, y) => x.distance - y.distance);   // 最近优先 —— §九"最近热点"

    return {
      riserId: r.id, riserName: r.name,
      riserModulus: modulusMm,
      riserVolumeMm3: Number.isFinite(v) ? v : null,
      riserAreaMm2: Number.isFinite(a) ? a : null,
      modulusUsable: usable,
      reason: reliable ? (usable ? null : RISER_REASON.ZERO_AREA) : RISER_REASON.NOT_CLOSED,
      nearest: all.length ? all[0] : null,
      all,
      ok: all.length ? all[0].ok : null,      // true / false / null（不可得）
    };
  });

  // 三分类是**互斥且完备**的：ok + low + unknown = 冒口总数（测试 93-I/J/K 直接断言这条）
  const counts = {
    riserTotal: rows.length,
    hotspotTotal: hsList.length,
    withHotspot: rows.filter(r => r.nearest).length,
    modulusOk: rows.filter(r => r.ok === true).length,
    modulusLow: rows.filter(r => r.ok === false).length,
    // ok === null 的两种成因分开计数，UI 才能说清"是没法算"还是"没有热点可比"
    modulusUnreliable: rows.filter(r => !r.modulusUsable).length,
    modulusUnknown: rows.filter(r => r.ok === null && r.modulusUsable).length,
  };
  counts.noHotspot = rows.filter(r => !r.nearest).length;

  const distances = rows.map(r => r.nearest?.distance).filter(Number.isFinite);
  return { rows, counts, distances };
}

/** 冒口检测的汇总语义码（与 SUMMARY_CODE 同样：只给 code，文案由视图查 i18n） */
export const RISER_CODE = {
  NO_PRODUCT: 'no_product',
  NO_RISER: 'no_riser',
  NO_HOTSPOT: 'riser_no_hotspot',
  MODULUS_OK: 'riser_modulus_ok',
  MODULUS_LOW: 'riser_modulus_low',
  MODULUS_UNKNOWN: 'riser_modulus_unknown',
  MODULUS_UNRELIABLE: 'riser_modulus_unreliable',
  DISTANCE_RANGE: 'distance_range',
};

/**
 * 冒口检测总览（93.txt §十：只有**几何模数比**是判据，结果只有 PASS / WARNING / INFO）
 *
 * 纪律（93.txt §十末段）：这只是几何模数检查，
 *   不得表述为"一定不会缩孔 / 一定能补缩 / 工艺一定正确"。
 * 阈值只有一个：MODULUS_RATIO_MIN（1.2），**不引入** 1.3 / 1.5 / 安全系数 / 材料修正。
 */
export function summarizeRisers({ product, hotspots = [], risers = [], rows } = {}) {
  const items = [];
  const r = rows || buildRiserRows(hotspots, risers);
  const c = r.counts;

  if (!product) {
    items.push({ level: LEVEL.INFO, code: RISER_CODE.NO_PRODUCT, params: [] });
  } else if (risers.length === 0) {
    items.push({ level: LEVEL.INFO, code: RISER_CODE.NO_RISER, params: [] });
  } else if (hotspots.length === 0) {
    // 没有热点 → 没有可比的热点模数。不是缺陷（均匀件本来就没有热结），如实说明。
    items.push({ level: LEVEL.INFO, code: RISER_CODE.NO_HOTSPOT, params: [] });
  } else {
    items.push({ level: LEVEL.PASS, code: RISER_CODE.MODULUS_OK, params: [c.modulusOk, MODULUS_RATIO_MIN] });
    if (c.modulusLow > 0) {
      items.push({ level: LEVEL.WARNING, code: RISER_CODE.MODULUS_LOW, params: [c.modulusLow, MODULUS_RATIO_MIN] });
    }
    // 算不出来的单独说清楚，既不混进"满足"也不混进"不足"
    if (c.modulusUnreliable > 0) {
      items.push({ level: LEVEL.INFO, code: RISER_CODE.MODULUS_UNRELIABLE, params: [c.modulusUnreliable] });
    }
    if (c.modulusUnknown > 0) {
      items.push({ level: LEVEL.INFO, code: RISER_CODE.MODULUS_UNKNOWN, params: [c.modulusUnknown] });
    }
    // 距离只计算 + 展示，**不设红线**（88.txt §十三 原纪律，93.txt 未改）
    if (r.distances.length) {
      items.push({
        level: LEVEL.INFO, code: RISER_CODE.DISTANCE_RANGE,
        params: [round1(Math.min(...r.distances)), round1(Math.max(...r.distances))],
      });
    }
  }

  const warns = items.filter(i => i.level === LEVEL.WARNING).length;
  return { level: warns ? LEVEL.WARNING : LEVEL.PASS, warns, items, counts: c };
}

/* ---------- 浇注系统（88.txt §十五~§二十二） ---------- */

/**
 * 单个类别的几何汇总。88.txt §十六/§十七：
 *   数量 / 总体积 / 几何尺寸 / 截面信息（可靠才算）。
 * @param {Array<{id,name,metrics}>} objs
 */
function kindSummary(objs = []) {
  const list = objs || [];
  const totalVolumeMm3 = list.reduce((s, o) => s + (o.metrics?.volumeMm3 || 0), 0);
  const totalAreaMm2 = list.reduce((s, o) => s + (o.metrics?.areaMm2 || 0), 0);
  // 截面：只有**每个对象都算得出来**时，汇总值才有意义（否则 min/max 是假的）
  const usableList = list.map(o => (o.metrics?.section?.usable ? o.metrics.section : null));
  const allUsable = usableList.length > 0 && usableList.every(Boolean);
  const reps = usableList.filter(Boolean).map(s => s.rep);
  return {
    count: list.length,
    totalVolumeMm3,
    totalAreaMm2,
    items: list,
    section: {
      usable: allUsable,
      perObject: usableList.map((s, i) => ({ id: list[i].id, name: list[i].name, rep: s ? s.rep : null, usable: !!s })),
      rep: allUsable && reps.length ? reps.reduce((a, b) => a + b, 0) / reps.length : null,
      min: allUsable && reps.length ? Math.min(...reps) : null,
      max: allUsable && reps.length ? Math.max(...reps) : null,
    },
  };
}

/**
 * 浇注系统汇总（88.txt §二十二：第一版只做几何统计 + 汇总 + 数据关系，不自建 PASS/FAIL）
 * @param {{sprues?:Array, runners?:Array, ingates?:Array}} o
 */
export function gatingSummary(o = {}) {
  const sprue = kindSummary(o.sprues);
  const runner = kindSummary(o.runners);
  const ingate = kindSummary(o.ingates);

  // 88.txt §二十：总截面积 = ΣAi（逐个相加），**不是** 平均面积 × 数量。
  //   两者只在等截面时数值巧合一致；此处按定义逐个求和，并把每个 Ii→Ai 独立保留。
  const areas = ingate.items.map(x => (x.metrics?.section?.usable ? x.metrics.section.rep : null));
  const usableAreas = areas.filter(a => a != null && a > 0);
  const ingateArea = {
    usable: ingate.items.length > 0 && usableAreas.length === ingate.items.length,
    perIngate: ingate.items.map((x, i) => ({ id: x.id, name: x.name, area: areas[i] })),
    totalMm2: usableAreas.reduce((s, a) => s + a, 0),     // ΣAi —— 定义式
    countUsed: usableAreas.length,
    avgMm2: usableAreas.length ? usableAreas.reduce((s, a) => s + a, 0) / usableAreas.length : null,
    minMm2: usableAreas.length ? Math.min(...usableAreas) : null,
    maxMm2: usableAreas.length ? Math.max(...usableAreas) : null,
  };

  return { sprue, runner, ingate, ingateArea, totalCount: sprue.count + runner.count + ingate.count };
}

/* ---------- 总览状态（88.txt §二十四：只用 PASS / WARNING / INFO 三级） ---------- */

export const LEVEL = { PASS: 'pass', WARNING: 'warning', INFO: 'info' };

/**
 * 汇总条目的语义码（**不放显示文案**）。
 * 理由：① 文案属显示层，由视图查 i18n（中英同步、缺译可查）；
 *       ② 测试可以断言 code + 数值，不被中文措辞绑架（88.txt §二十九/§三十）。
 */
export const SUMMARY_CODE = {
  NO_PRODUCT: 'no_product',
  NO_HOTSPOT: 'no_hotspot',
  NO_RISER: 'no_riser',
  MODULUS_OK: 'modulus_ok',
  MODULUS_LOW: 'modulus_low',
  MODULUS_UNKNOWN: 'modulus_unknown',
  DISTANCE_RANGE: 'distance_range',
};

/**
 * 首屏"一眼看到问题数量"（88.txt 最终目标）。
 * 纪律：**只有模数比是判据**（88.txt §十）；距离只给 INFO（88.txt §十三 明确禁止拍脑袋设红线）。
 * @returns {{level:string, warns:number, items:Array<{level,code,params}>}}
 */
export function summarize({ hotspots = [], risers = [], relations, gating, product } = {}) {
  const items = [];
  const hsTotal = hotspots.length;
  const riserTotal = risers.length;
  const rel = relations || buildRelationRows(hotspots, risers);

  if (!product) {
    items.push({ level: LEVEL.INFO, code: SUMMARY_CODE.NO_PRODUCT, params: [] });
  } else if (hsTotal === 0) {
    // 88.txt §八：N ≥ 0；没有热结不是缺陷（可能是均匀件）
    items.push({ level: LEVEL.INFO, code: SUMMARY_CODE.NO_HOTSPOT, params: [] });
  } else if (riserTotal === 0) {
    // 88.txt §二十九 Case F：必须优雅显示"暂无冒口"，不能报错、不能算成"全部不足"
    items.push({ level: LEVEL.INFO, code: SUMMARY_CODE.NO_RISER, params: [] });
  } else {
    items.push({ level: LEVEL.PASS, code: SUMMARY_CODE.MODULUS_OK, params: [rel.counts.modulusOk, MODULUS_RATIO_MIN] });
    if (rel.counts.modulusLow > 0) {
      items.push({ level: LEVEL.WARNING, code: SUMMARY_CODE.MODULUS_LOW, params: [rel.counts.modulusLow, MODULUS_RATIO_MIN] });
    }
    if (rel.counts.modulusUnknown > 0) {
      items.push({ level: LEVEL.INFO, code: SUMMARY_CODE.MODULUS_UNKNOWN, params: [rel.counts.modulusUnknown] });
    }
    // 88.txt §十三：距离只计算 + 展示，**不设 PASS/FAIL 红线**，故恒为 INFO
    if (rel.distances.length) {
      items.push({
        level: LEVEL.INFO, code: SUMMARY_CODE.DISTANCE_RANGE,
        params: [round1(Math.min(...rel.distances)), round1(Math.max(...rel.distances))],
      });
    }
  }

  const warns = items.filter(i => i.level === LEVEL.WARNING).length;
  return { level: warns ? LEVEL.WARNING : LEVEL.PASS, warns, items };
}

const round1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/* ---------- 便捷投影：从"文件 → 对象" ---------- */

/**
 * 由 STL 度量结果构造一个检验对象
 * @param {string} kind  KIND.*
 * @param {number} index 同类第几个（0 起）
 * @param {string} name  文件名
 * @param {object} metrics  objectMetrics() 结果
 */
export function makeObject(kind, index, name, metrics) {
  return { id: objectId(kind, index), kind, index, name, metrics };
}

/**
 * 从 CastingProject 已有的热结条目取引擎原值（88.txt §八：直接消费现有输出）
 * @param {Array<{id,x,y,z,mc,regionVolumeCm3,confidence}>} items
 */
export function hotspotsFromProject(items = []) {
  return (items || [])
    .filter(h => h && Number.isFinite(h.x) && Number.isFinite(h.mc))
    .map(h => ({ id: h.id, x: h.x, y: h.y, z: h.z, mc: h.mc, regionVolumeCm3: h.regionVolumeCm3, confidence: h.confidence }));
}

/* ============================================================
   单一 STL 内多实体自动识别（PHASE 89 · 89.txt §二/§三）
   ============================================================ */

/**
 * 把一份 STL 按**连通分量**拆成多个对象。
 *
 * 89.txt §二 明确要求：**不要要求用户分别导入**。
 *   · 单个连通实体 → 1 件
 *   · 多个互不相连的封闭组件 → 按组件识别为 P1/P2/…、R1/R2/…
 *   · 组件不闭合 → **不得假装得到可靠体积**（沿用既有网格有效性规则 + WARNING）
 *
 * 89.txt §二 同时明确：**不要增加"请输入产品件数"输入框**，
 *   **不要通过复制一个 STL 来人为制造多个产品**。件数只由几何决定。
 *
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {string} kind KIND.*
 * @param {string} name 文件名
 * @param {object} metricsOf 单对象度量函数（(mesh)=>metrics），由调用方注入以避免本模块依赖几何实现
 * @returns {{objects:Array, components:Array, totalVolumeMm3:number, totalAreaMm2:number,
 *            closedCount:number, bounds:object|null, warnings:Array<{code,params}>}}
 */
export function objectsFromComponents(mesh, kind, name, components, metricsOf, weld) {
  const warnings = [];
  const list = (components || []).filter(c => c.triCount > 0);
  // 只保留有实质体量的组件；碎片（几个面片）不是"一件"
  const solid = list.filter(c => c.volumeMm3 > 0 || c.areaMm2 > 0);
  const objects = solid.map((c, i) => {
    const sub = { vertices: subVertices(mesh, c.tris), triCount: c.triCount };
    // ⚠ metricsOf 的第 2 个参数是**组件序号**（PHASE 97 追加，纯 additive）：
    //   内浇口的切面方向要由"这个单元跟产品/横浇道的连接面"决定，调用方需要知道在算哪一个。
    //   既有调用方写成 (m) => … 时多收到的参数被忽略，行为一字不变。
    const m = metricsOf ? metricsOf(sub, i, c) : null;
    return {
      id: objectId(kind, i),
      kind, index: i, name,
      componentIndex: c.index,
      closed: c.closed,
      boundaryEdges: c.boundaryEdges,
      bounds: c.bounds,
      metrics: m,
      // 体积可信度：不闭合 → 体积不可信（89.txt §二："不得假装得到可靠体积"）
      volumeReliable: c.closed,
    };
  });
  const totalVolumeMm3 = objects.reduce((s, o) => s + (o.volumeReliable ? (o.metrics?.volumeMm3 || 0) : 0), 0);
  const totalAreaMm2 = objects.reduce((s, o) => s + (o.metrics?.areaMm2 || 0), 0);
  const openCount = objects.filter(o => !o.closed).length;
  if (openCount) warnings.push({ code: 'component_open', params: [openCount] });
  // 缠绕方向不一致：只提示（会让有符号体积有小偏差），不判"体积不可信"
  const windCount = solid.filter(c => c.windingConsistent === false).length;
  if (windCount) warnings.push({ code: 'component_winding', params: [windCount] });
  if (objects.length === 0) warnings.push({ code: 'no_solid_component', params: [] });
  return {
    objects, components: list, totalVolumeMm3, totalAreaMm2,
    closedCount: objects.length - openCount,
    bounds: list.length ? unionBounds(list.map(c => c.bounds)) : null,
    warnings,
  };
}

/** 抽取三角形子集的顶点（不依赖 meshComponents，避免循环引用） */
function subVertices(mesh, tris) {
  const out = new Float32Array(tris.length * 9);
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    for (let k = 0; k < 9; k++) out[i * 9 + k] = mesh.vertices[o + k];
  }
  return out;
}

/** 多个包围盒的并 */
export function unionBounds(list) {
  const ok = (list || []).filter(Boolean);
  if (!ok.length) return null;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const b of ok) {
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < mn[k]) mn[k] = b.min[k];
      if (b.max[k] > mx[k]) mx[k] = b.max[k];
    }
  }
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  return {
    min: mn, max: mx, size,
    center: [mn[0] + size[0] / 2, mn[1] + size[1] / 2, mn[2] + size[2] / 2],
    diagonal: Math.hypot(size[0], size[1], size[2]),
  };
}

/* ============================================================
   浇注系统结果汇总（PHASE 89 · 89.txt §十五）
   ============================================================ */

/**
 * 把 traceGating 的输出整理成 §十五 要求的展示口径。
 *
 * ★ 89.txt §十五 的硬要求：
 *   · 多直浇道时要逐个列出并给"合计"（A_sprue_total = ΣA_sprue_i，§八）
 *   · 内浇口给 **ΣAi 总有效截面积**，**绝不允许** 平均截面积 × 数量（§十）
 *   · 不默认把内部算法细节全铺开，需要时可以展开 Details
 *
 * ★ 89.txt §十三/§十七：算不出来的**不给数**，只给原因码，由视图层查 i18n 显示为 WARNING。
 *
 * @param {object} trace traceGating() 的返回值
 */
export function gatingResultSummary(trace) {
  const usableMin = (seg) => (seg.section && seg.section.usable ? seg.section.min : null);
  const rollup = (list) => {
    const vals = list.map(usableMin).filter(v => v != null);
    const allUsable = list.length > 0 && vals.length === list.length;
    return {
      count: list.length,
      // 一个类别里有多条流道 → 逐个列出 + 合计（§八：A_total = ΣAi）
      items: list.map(s => ({
        id: s.id, parentId: s.parentId ?? null, depth: s.depth ?? 0,
        minMm2: usableMin(s),
        repMm2: s.section?.usable ? s.section.rep : null,
        usable: !!s.section?.usable,
        reason: s.section?.usable ? null : (s.section?.reason || 'unusable'),
        axis: s.axisConfident ? s.axis : null,
        distanceToProductMm: s.distanceToProductMm ?? null,
        triCount: s.triCount,
      })),
      totalMm2: vals.length ? vals.reduce((a, b) => a + b, 0) : null,
      allUsable,
      usableCount: vals.length,
    };
  };
  const sprue = rollup(trace?.sprues || []);
  const runner = rollup(trace?.runners || []);
  const ingate = rollup(trace?.ingates || []);
  return {
    componentCount: trace?.componentCount ?? 0,
    totalVolumeMm3: trace?.totalVolumeMm3 ?? 0,
    totalAreaMm2: trace?.totalAreaMm2 ?? 0,
    traceable: !!trace?.traceable,
    degenerateTris: trace?.degenerateTris ?? 0,
    sprue, runner, ingate,
    // §十：总内浇口面积 = ΣAi（逐个相加），不可用则为 null —— 绝不用 平均×数量 顶上
    ingateTotalMm2: ingate.allUsable ? ingate.totalMm2 : null,
    sprueTotalMm2: sprue.allUsable ? sprue.totalMm2 : null,
    productTouchTolMm: trace?.productTouchTolMm ?? null,
    warnings: trace?.warnings || [],
  };
}

/* ============================================================
   浇注系统检测 · 手动语义版（PHASE 94 · 94.txt §二~§九）
   ------------------------------------------------------------
   与上面 gatingResultSummary（PHASE 89，**自动**追踪出来的分段）是两条不同的路：
     · gatingResultSummary：喂进去的是 traceGating() 的输出，直/横/内由**程序追踪**得出；
     · 下面这一套：直/横/内由**用户导入时指定**（94.txt §一 的产品路线决策），
       程序只负责"一个 STL 里有几个独立实体、各自截面多大、加起来多少、三者什么比例"。
   PHASE 89~92 的自动链一行没删（94.txt §十六），但它不在这条路上。

   ★ 本层输出**没有任何 PASS/FAIL**（94.txt §九）：
     不判断比例合不合理、不判断内浇口小不小、不算流速流量充型时间。
     只有"量得出来 / 量不出来"，量不出来的给原因码，不给数。
   ============================================================ */

/** 浇注系统的三个语义类别（顺序即 94.txt §七 主界面的 直 : 横 : 内 顺序） */
export const GATING_KINDS = [KIND.SPRUE, KIND.RUNNER, KIND.INGATE];

/** 单元截面积为什么不可用（只给码，文案由视图查 i18n） */
export const GATING_REASON = {
  NOT_CLOSED: 'not_closed',             // 组件不是闭合实体 → 截面可能是缺了一块却仍闭合的假轮廓
  SECTION_UNUSABLE: 'section_unusable', // 截面剖面本身不可用（切不到环 / 环不闭合）
  MULTI_LOOP: 'multi_loop',             // 一刀切出 ≥2 个独立环 → 这个方向没有唯一截面
  AMBIGUOUS_AXIS: 'ambiguous_axis',     // 平板件（扇形/喇叭口薄片）→ 方向不唯一，要算对得先知道充型方向
  NO_LOOP: 'no_loop',
  DEGENERATE: 'degenerate',
};

/** 把 sectionShape 的原因码翻译成浇注系统这一侧的原因码 */
function gatingReason(closed, shape) {
  if (!closed) return GATING_REASON.NOT_CLOSED;
  if (!shape || shape.usable) return null;
  switch (shape.reason) {
    case 'multi_loop': return GATING_REASON.MULTI_LOOP;
    case 'ambiguous_axis': return GATING_REASON.AMBIGUOUS_AXIS;
    case 'no_loop': return GATING_REASON.NO_LOOP;
    case 'degenerate': return GATING_REASON.DEGENERATE;
    default: return GATING_REASON.SECTION_UNUSABLE;
  }
}
/* ⚠ PHASE 96：AMBIGUOUS_AXIS 从"不给面积"的原因码，降级为**历史兼容码**。
   sectionShapeOf 现在对方向不唯一的单元照常给实测面积，只会带上 axisUncertain 标记，
   所以这条分支实际已经走不到（shape.usable 恒为 true）。
   常量与文案保留：① 老结果里可能出现；② 万一将来 sectionShape 又收紧，
   这里的翻译不会跟着失效。 */

/**
 * 一份浇注系统 STL → 若干独立单元（94.txt §二/§四/§十三）。
 *
 * ★ 数量按**几何连通分量**数，绝不按文件数（94.txt §二 逐字要求）：
 *   一个 STL 里有 4 个独立横浇道，横浇道数量就是 4。
 *   分量拆分直接复用 objectsFromComponents / meshComponents（自有能力，不新写 parser）。
 *
 * @param {{vertices,triCount}} mesh
 * @param {string} kind   KIND.SPRUE | KIND.RUNNER | KIND.INGATE（**用户给的语义**，不是程序猜的）
 * @param {string} name   文件名
 * @param {Array} components triangleComponents() 的 components
 * @param {Function} metricsOf (mesh) => objectMetrics(mesh, {withPoly:true})
 * @param {Function} shapeOf   (metrics) => sectionShapeOf(metrics)
 */
export function gatingUnitsFromComponents(mesh, kind, name, components, metricsOf, shapeOf) {
  const parts = objectsFromComponents(mesh, kind, name, components, metricsOf);
  // ⚠ 序号 i 必须一路传到 shapeOf（PHASE 97）：内浇口的"方向来源"是按**组件**给的，
  //   漏传就变成"面积按连接方向切了、但形状那边不知道"，两边对不上（实测踩到过）。
  parts.objects.forEach((o, i) => {
    const shape = shapeOf ? shapeOf(o.metrics, i) : null;
    const reason = gatingReason(o.closed, shape);
    o.shape = shape;
    o.lengthMm = Number.isFinite(o.metrics?.axisLengthMm) ? o.metrics.axisLengthMm : null;
    // ★ 有效截面积：口径见 model/sectionShape.js 文件头（圆 πD²/4 / 矩 W×H / 梯 (a+b)h/2 / 异形取实测）
    o.areaMm2 = reason ? null : shape.areaMm2;
    o.areaReason = reason;
    // PHASE 96：方向不唯一（平板件）—— 面积照给，但必须让 UI 能如实标注"方向是约定值"。
    //   不是错误标记，是**事实标记**：这一刀切的是主轴方向，换一条轴面积会不同（值见 altAreaMm2）。
    o.axisUncertain = !!(shape && shape.axisUncertain && o.areaMm2 != null);
  });
  return parts;
}

/**
 * 三类各自汇总 + 总截面积 + 比例（94.txt §七/§八）。
 *
 * ★ "总截面积"的工程定义（94.txt §七 要求必须明确）：
 *     某类总截面积 = 该类**每一个单元的有效截面积**之和（ΣAi，逐个相加，
 *     绝不是"平均面积 × 数量"—— 两者只在等截面时数值巧合一致）。
 *
 * ★ 缺类别不伪造（94.txt §八）：
 *     只导入横浇道 + 内浇口时，比例就是"横 : 内"，**不会**把直浇道当成 0 补进来说"直:横:内 = 0:X:Y"。
 *
 * ★ 部分测不出（94.txt §六末段）：
 *     某类里有单元量不出截面积时，该类 totalMm2 是**已测得部分之和**，并被标 partial，
 *     UI 必须把"还有 N 个没算进这个总和"写出来 —— 不能让它看起来像完整的总和。
 *
 * @param {Object<string, Array>} byKind { [KIND.SPRUE]: [...], [KIND.RUNNER]: [...], [KIND.INGATE]: [...] }
 */
/* 「同一个规格」的判据容差（PHASE 95 建立，PHASE 96 扩了一条面积兜底）。
   ⚠ 为什么不能用**精确相等**：MC 面片化对同一个尺寸会给出 ~1% 量级的离散 ——
     实测 4 个完全相同的 ⌀10 圆柱，等效直径落在 9.99 ~ 10.02 之间。
     精确相等会把"4 个一模一样的内浇口"判成「多种规格」，主界面就永远写不出那个尺寸
     （截图抓到的真缺陷）。取"显示精度 0.05mm"与"0.5% 相对量"的较大者：
     同一规格必然落在容差内，真不同的规格（相差 5% 以上）必然落在容差外。 */
export const DIM_SAME_ABS = 0.05;
export const DIM_SAME_REL = 0.005;
/**
 * 形状分类不一致时的**面积兜底容差**（PHASE 96 新增）。
 *
 * 什么时候会用到：两个几何**完全相同**的单元，一个被分类成 rect、另一个因网格相位
 * 被判成 irregular（PHASE 96 修掉的那类抖动，见 sectionShape.SHAPE_GATE.RECT_FILL_MIN）。
 * 此时按"类型必须逐字相同"比 → 判成「多种规格」→ 用户实测到的第 2 个现象。
 *
 * 容差怎么来的（量出来的，不是拍的）：
 *   · 同一块 20×5×30 的截面，跨网格相位/分辨率的实测面积散落在 99.50 ~ 100.00 mm²，
 *     即离散度约 **0.5%**；
 *   · 真实不同的规格至少要差一个可辨认的尺寸档 —— 20 vs 21 就已是 **5%**。
 *   取 1.5%：比离散度大 3 倍（不会把同一规格拆开），比真实规格差小 3 倍以上（不会合并错）。
 *   ⚠ 这条兜底**只在类型不可比时**生效；类型相同且都量出了尺寸参数时，一律按尺寸比
 *     （尺寸比更严，能拆开"面积凑巧相等但长宽不同"的两组，例如 20×5 与 10×10）。
 */
export const SPEC_AREA_REL = 0.015;
const sameVal = (a, b) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= Math.max(DIM_SAME_ABS, DIM_SAME_REL * Math.max(Math.abs(a), Math.abs(b)));
const sameArea = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0
  && Math.abs(a - b) <= SPEC_AREA_REL * Math.max(a, b);

/** 三种"量得出尺寸参数"的形状 —— 只有这三种才谈得上逐尺寸比规格 */
const DIM_TYPES = new Set(['circular', 'rect', 'trapezoid']);

/**
 * 两个单元的"截面尺寸"是不是同一个规格。
 *
 * PHASE 96 的改动：**不再要求 type 逐字相同**。类型可比就按尺寸比（更严），
 * 类型不可比（一个 rect 一个 irregular）就退回实测面积比（见 SPEC_AREA_REL）。
 */
export function sameSpec(a, b) {
  const sa = a?.shape, sb = b?.shape;
  if (!sa || !sb || !sa.usable || !sb.usable) return false;
  if (sa.type === sb.type && DIM_TYPES.has(sa.type)) {
    switch (sa.type) {
      case 'circular': return sameVal(sa.dMm, sb.dMm);
      case 'rect': return sameVal(sa.wMm, sb.wMm) && sameVal(sa.hMm, sb.hMm);
      default: return sameVal(sa.topMm, sb.topMm) && sameVal(sa.bottomMm, sb.bottomMm) && sameVal(sa.heightMm, sb.heightMm);
    }
  }
  return sameArea(sa.areaMm2, sb.areaMm2);
}

/**
 * 按规格把单元聚成组（96.txt §七）。
 *
 * ★ **分组只负责 UI 展示，绝不参与计算**（96.txt §八 逐字要求）：
 *     · 组的"小计"= 该组**每个单元实测面积之和**（不是 单个面积 × 数量）；
 *     · 类的"总面积"仍然是全部单元实测面积之和，与分组无关（测试 96-I 直接断言）。
 * ★ 匹配方式：按出现顺序贪心聚类，用组内**第一个**单元的截面作代表
 *   （不用均值当代表 —— 均值会随加入顺序漂移，导致同样的输入在不同顺序下分出新组）。
 */
export function groupBySpec(items = []) {
  const groups = [];
  for (const it of items) {
    if (it.areaMm2 == null) continue;                 // 没量出面积的单元不参与分组（它们本来就不进总和）
    const g = groups.find((x) => sameSpec(x.rep, it));
    if (g) {
      g.items.push(it);
      g.subtotalMm2 += it.areaMm2;                    // 小计 = Σ 实测（禁止 × 数量）
      g.unitAreaMm2 = g.subtotalMm2 / g.items.length; // 显示用的"单个面积"（= 组内实测均值）
    } else {
      groups.push({ rep: it, shape: it.shape, items: [it], subtotalMm2: it.areaMm2, unitAreaMm2: it.areaMm2 });
    }
  }
  return groups.map((g) => ({
    count: g.items.length,
    shape: g.shape,
    ids: g.items.map((i) => i.id),
    unitAreaMm2: g.unitAreaMm2,      // 单个面积（mm²）—— 组内实测均值，仅展示
    subtotalMm2: g.subtotalMm2,      // 小计（mm²）—— **Σ 实测**，加进类总面积的就是它
    // 单件面积的真实离散（组内 max−min），UI 需要时如实展示"不是完全一样"
    spreadMm2: g.items.length > 1 ? Math.max(...g.items.map((i) => i.areaMm2)) - Math.min(...g.items.map((i) => i.areaMm2)) : 0,
  }));
}

export function buildGatingAreas(byKind = {}) {
  const kinds = GATING_KINDS.map((kind) => {
    const list = Array.isArray(byKind[kind]) ? byKind[kind] : [];
    const items = list.map((o) => ({
      id: o.id, name: o.name, closed: !!o.closed,
      areaMm2: o.areaMm2 ?? null,
      areaReason: o.areaReason ?? null,
      shape: o.shape || null,
      // PHASE 96：方向是约定值时如实带出（含"换另一条主轴会是多少"）
      axisUncertain: !!o.axisUncertain,
      altAreaMm2: Number.isFinite(o.shape?.altAreaMm2) ? o.shape.altAreaMm2 : null,
      altSpreadPct: Number.isFinite(o.shape?.altSpreadPct) ? o.shape.altSpreadPct : null,
      // PHASE 97：方向是不是由**真实连接面**定的（有就写来源与置信度；没有 = null → 主轴约定）
      directionSource: o.shape?.directionSource || null,
      directionConfidence: o.shape?.directionConfidence || null,
      connectionAreaMm2: Number.isFinite(o.shape?.connectionAreaMm2) ? o.shape.connectionAreaMm2 : null,
      lengthMm: o.lengthMm ?? null,
      volumeMm3: o.volumeReliable === false ? null : (o.metrics?.volumeMm3 ?? null),
      size: o.metrics?.size || null,
      center: o.metrics?.center || null,
      bounds: o.bounds || null,
      axisLabel: o.metrics?.axisDir ? ['X', 'Y', 'Z'][
        (() => { const a = o.metrics.axisDir.map(Math.abs); return a[0] >= a[1] && a[0] >= a[2] ? 0 : (a[1] >= a[2] ? 1 : 2); })()
      ] : null,
    }));
    const usable = items.filter((i) => i.areaMm2 != null && i.areaMm2 > 0);
    const total = usable.reduce((s, i) => s + i.areaMm2, 0);
    // PHASE 95（95.txt §五）：主界面还要给"单个 / 最小 / 最大"面积 —— 纯追加字段，
    //   既有 totalMm2 / partial / usableCount 语义一个字没改。
    const areas = usable.map((i) => i.areaMm2);
    const minA = areas.length ? Math.min(...areas) : null;
    const maxA = areas.length ? Math.max(...areas) : null;
    const avgA = areas.length ? total / areas.length : null;
    // PHASE 96（96.txt §七）：同规格聚合成一行。**分组纯展示，小计 = Σ 实测**
    const groups = groupBySpec(usable);
    return {
      kind,
      imported: list.length > 0,
      count: items.length,
      usableCount: usable.length,
      unreliableCount: items.length - usable.length,
      totalMm2: usable.length ? total : null,
      // 有单元没算进去 → 这个总和只是"已测得部分"，UI 必须如实标注
      partial: usable.length > 0 && usable.length < items.length,
      items,
      groups,
      // 单元方向不唯一的个数（平板件）—— 只提示，不影响面积是否给（96.txt §六/§二十一）
      uncertainCount: items.filter((i) => i.axisUncertain).length,
      // PHASE 97：方向由**连接面**定出来的单元个数（97.txt §八）—— 与上面互斥
      connCount: items.filter((i) => i.directionSource && i.areaMm2 != null).length,
      // PHASE 95 追加：一致性检查要用的四个统计量（等截面时 min=max=avg）
      minMm2: minA,
      maxMm2: maxA,
      avgMm2: avgA,
      // 最大偏差 = (最大 − 最小) ÷ 平均 × 100（%）。**只算不判** —— 没有任何标准说多大算大。
      spreadPct: (minA != null && avgA > 0) ? ((maxA - minA) / avgA) * 100 : null,
      // "只有一个规格" ⇔ 只聚出一组。⚠ 参与判定的是**量出面积的**单元：
      //   一个单元量不出面积时它根本不在任何组里，此时不该说"规格一致"（会掩盖缺失）。
      allSameDims: groups.length === 1 && usable.length === items.length,
    };
  });

  const present = kinds.filter((k) => k.imported);
  const totalMm2 = present.some((k) => k.totalMm2 != null)
    ? present.reduce((s, k) => s + (k.totalMm2 || 0), 0)
    : null;
  const totalPartial = present.some((k) => k.partial || (k.imported && k.totalMm2 == null));

  // 比例：以**第一个已导入且有值**的类别为 1（§八：只导入两类就只写两类）
  const base = present.find((k) => k.totalMm2 > 0) || null;
  const ratio = base ? {
    base: base.kind,
    entries: present.map((k) => ({
      kind: k.kind,
      value: k.totalMm2 != null ? k.totalMm2 / base.totalMm2 : null,
      totalMm2: k.totalMm2,
    })),
  } : null;

  // 占比：只在**已导入且有值**的类别之间算，总和 = 100%（§八）
  const shareBase = present.reduce((s, k) => s + (k.totalMm2 || 0), 0);
  const share = shareBase > 0
    ? present.map((k) => ({ kind: k.kind, pct: ((k.totalMm2 || 0) / shareBase) * 100 }))
    : null;

  return { kinds, present, presentKinds: present.map((k) => k.kind), totalMm2, totalPartial, ratio, share };
}

/** 浇注系统检测的汇总语义码 */
export const GATING_CODE = {
  NO_INPUT: 'gating_no_input',
  NO_SOLID: 'gating_no_solid',
  AREA_UNRELIABLE: 'gating_area_unreliable',
  PARTIAL_TOTAL: 'gating_partial_total',
  NO_BASE: 'gating_no_base',
};

/**
 * 浇注系统检测总览（94.txt §九：**不输出 PASS / FAIL**）
 *
 * 这里只回答"量到了什么、哪些没量到"，一句工程判断都不给 ——
 * 所以 items 的 level 只可能是 INFO 或 WARNING，**永远不会是 PASS**（测试 94-P 直接断言这条）。
 */
export function summarizeGatingAreas({ areas } = {}) {
  const items = [];
  const a = areas || buildGatingAreas({});
  const present = a.present;

  if (!present.length) {
    items.push({ level: LEVEL.INFO, code: GATING_CODE.NO_INPUT, params: [] });
  } else if (!present.some((k) => k.count > 0)) {
    items.push({ level: LEVEL.WARNING, code: GATING_CODE.NO_SOLID, params: [] });
  } else {
    const bad = present.reduce((s, k) => s + k.unreliableCount, 0);
    if (bad > 0) items.push({ level: LEVEL.WARNING, code: GATING_CODE.AREA_UNRELIABLE, params: [bad] });
    if (a.totalPartial) items.push({ level: LEVEL.WARNING, code: GATING_CODE.PARTIAL_TOTAL, params: [] });
    if (!a.ratio) items.push({ level: LEVEL.INFO, code: GATING_CODE.NO_BASE, params: [] });
  }

  const warns = items.filter((i) => i.level === LEVEL.WARNING).length;
  // ⚠ 没有 PASS 这一档：warns 为 0 也只说明"都量到了"，不说明"浇注系统设计正确"（§九）
  return { level: warns ? LEVEL.WARNING : LEVEL.INFO, warns, items, areas: a };
}

/* ============================================================
   浇注工艺计算（PHASE 95 · 95.txt §六/§八/§十/§十三）
   ------------------------------------------------------------
   一句话（95.txt 结尾）：用户导入 STL → 选材质/少量工艺条件 → 软件自动算 →
   一眼看到浇注时间、面积、流量、内浇口速度以及真正值得注意的问题。

   ★ 唯一的公式来源 = calcs/gating.js（经典浇注系统计算器）：
       浇注时间 T   → calc_t(mat, W, wall)      W = 产品金属液重量
       平均内浇口速度 v → calc_v(G, rho, t, A)  G = 浇注金属液重量
     **本模块一行公式都不新造**（95.txt §六/§十二）。检测中心与设计中心算出的
     同一个浇注系统的流速必须是同一个数，不能有两个定义。

   ★ 重量口径（PHASE 49 的职责分离，必须照抄）：
       castingMass W = 单件铸件重量 × 型腔数 → **只喂给浇注时间公式**，不出品率；
       pouringMetalMass G = W ÷ 出品率      → 奥赞/流量/目标面积口径。
     所以本层同时输出 weightKg(W) 与 pourMassKg(G)，UI 要把两个都摆出来。

   ★ 流量口径（95.txt §六：Q = V / t）：这里的 V 取**浇注金属液体积**（含出品率折算），
     不是"只算产品本体"。理由（报告里也写了）：内浇口速度的物理意义是"金属液通过
     内浇口的平均速度"，通过内浇口的是**全部要浇进去的金属**（产品 + 冒口 + 浇道自身），
     而且项目里唯一的流速参考红线（企业 R7）就是按这个口径定的 —— 只算产品本体会把
     流速系统性低估 1/出品率 倍（灰铁约 25%）。产品金属液体积本身也一并输出（volumeCm3）。
     公式恒等式：Q/A ≡ calc_v，两条路给出逐位相同的 v（测试 95-G 直接断言）。
   ============================================================ */

/** 浇注计算结果里"为什么算不出来"的原因码（只给码，文案由视图查 i18n） */
export const POUR_REASON = {
  NO_MAT: 'pour_no_mat',             // 没选材质（无密度）
  NO_PRODUCT: 'pour_no_product',     // 没导入产品 STL
  NO_VOLUME: 'pour_no_volume',       // 产品没有可用的闭合体积（组件不闭合 / 网格无效）
  NO_WALL: 'pour_no_wall',           // 主体壁厚不可得（采样失败或模型无效）
  NO_INGATE: 'pour_no_ingate',       // 没有可用的内浇口截面积
  ZERO_VOLUME: 'pour_zero_volume',   // 体积/重量算出来是 0
};

/** 浇注计算的提示语义码（同样只给码） */
export const POUR_CODE = {
  READY: 'pour_ready',                       // ✓ 数据完整，可以进行工艺检查
  MISSING_MAT: 'pour_missing_mat',           // ⚠ 没选材质（无密度）
  MISSING_PRODUCT: 'pour_missing_product',   // ⚠ 缺产品 STL：几何照常，工艺量给不出
  MISSING_VOLUME: 'pour_missing_volume',     // ⚠ 产品没有可用的闭合体积
  MISSING_WALL: 'pour_missing_wall',         // ⚠ 主体壁厚不可得
  MISSING_INGATE: 'pour_missing_ingate',     // ⚠ 没有内浇口截面积 → 流速给不出
  VOLUME_PARTIAL: 'pour_volume_partial',     // ⚠ 产品有 N 个实体不闭合，未计入体积
  AREA_PARTIAL: 'pour_area_partial',         // ⚠ 内浇口有 N 个单元没量出截面积
  INGATE_SPREAD: 'pour_ingate_spread',       // ℹ 内浇口最大偏差 —— **只报数，不设阈值**
  V_NO_CRITERION: 'pour_v_no_criterion',     // ℹ 未指定浇注系统类型 → 不启用速度判定标准
  V_PASS: 'pour_v_pass',                     // ✓ 未超过企业经验审核参考（R7）
  V_EXCEED: 'pour_v_exceed',                 // ⚠ 超过企业经验审核参考（R7）—— **只讲比较结果**
  // 96.txt §十七：事实 / 计算结果 / 比较结果 / 建议 四层不许揉进一句话。
  //   所以"超了"是一条（比较结果），"建议检查什么"是**另一条**（建议）。
  V_SUGGEST: 'pour_v_suggest',               // ℹ 建议（只在真的超了的时候出现，措辞照 96.txt §十一）
  AXIS_UNCERTAIN: 'pour_axis_uncertain',     // ℹ 有单元截面方向未确认（平板件）——只提示，不阻拦给数
};

/** 浇注系统类型 → 企业经验审核参考（R7，calcs/gating.js 的 V_LIMIT，PHASE 48-A 溯源）
 *  ⚠ 这是**企业经验审核红线**（Excel 无缺陷工艺审核 R7），不是国标；
 *    只作参考提示，不作"错误"判定（gating.js 里也是这么用的）。
 *    UI 上一律叫「企业 R7 参考」，**不许写成"行业标准"**（96.txt §十末段）。 */
export const SYSTEM_TYPE = {
  '封闭': { key: '封闭', label: '封闭式', note: '阻流在内浇口' },
  '开放': { key: '开放', label: '开放式', note: '阻流在直浇道' },
};

/* ============================================================
   工艺参数解析（PHASE 96 · 96.txt §十一~§十五）
   ------------------------------------------------------------
   用户已经在前面的"生产场景 / 产品设计"里设过材质、浇注系统类型、出品率，
   进工艺检测中心不该再填一遍（96.txt §十二）。

   ★ 数据源审计结论（96.txt §十一 要求"不要猜变量名，必须找到真正的单一来源"）：
     · 生产场景 = `js/context.js`，localStorage 键 `ct-context`，
       字段只有四个：material / line / prod / method。
       —— **材质在里面**（值就是材料大类键，如 '灰铁'；兼容旧数据里的牌号 doc id）。
       —— **浇注系统类型和出品率不在里面**（生产场景弹窗里根本没有这两项）。
     · 设计中心项目 = `js/model/CastingProject.js`，localStorage 键 `ct-project`，
       里面才有：material.family / material.yieldSug（出品率 %）/ process.ratioKey（浇注比例预设）。
       ratioKey 指向 `calcs/gating.js` 的 RATIO_PRESETS，每个预设自带 `type: '封闭'|'开放'`
       —— 这就是"浇注系统类型"在本项目里的真实出处。
     · 密度表只有一份：`calcs/gating.js` 的 MATERIALS。生产场景/项目里存的是**键**
       （material.family 存 '灰铁' 这种大类），不复制密度（96.txt §十四）。

   ★ 优先级（96.txt §十三，逐字照抄）：
       1. 用户本次手动设置   2. 当前生产场景   3. 项目默认值   4. 空值 / 不判定
   ★ 只读不写（96.txt §十二末段）：检测中心手动改的只影响本次检测，
     **绝不反向写回生产场景**（本项目没有双向同步机制，也不新增）。
   ============================================================ */

/** 参数来源（UI 要如实标出来源，96.txt §十二/§十五："不要让用户猜这个数字从哪里来的"） */
export const PARAM_SRC = {
  MANUAL: 'manual',     // 本次检测手动设置
  SCENARIO: 'scenario', // 生产场景 / 设计中心项目
  DEFAULT: 'default',   // 材质表 / 项目默认值
};

/** 没有生产场景、用户也没选时的材质兜底（与 UI 下拉的第一项一致） */
export const DEFAULT_MAT_FAMILY = '灰铁';

/**
 * 解析本次检测实际采用的工艺参数（纯函数：不碰 localStorage，调用方把取值喂进来）。
 *
 * @param {object} o
 *   manualFamily  用户本次在检测中心选的材质大类（'' = 没选过）
 *   manualType    用户本次选的浇注系统类型（'' = 自动/未指定）
 *   manualYield   用户本次填的出品率 %（null/undefined/非正 = 没填）
 *   scenario      { family, gatingType, yieldPct, yieldSrc } —— 从 context + CastingProject 读出来的
 *                 · yieldSrc 是 CastingProject 的 SRC 枚举，只有 用户输入/用户覆盖/生产场景 三种
 *                   才算"场景明确设置过"；DEFAULT 视为"没设置"（那只是材料表的默认值）
 * @returns {{matFamily, matSource, gatingType, typeSource, yieldPct, yieldSource}}
 *   gatingType 为 '' 表示**未指定** —— 此时不启用任何速度判定标准（96.txt §十）
 */
export function resolveProcessParams({ manualFamily, manualType, manualYield, scenario } = {}) {
  const sc = scenario || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const num = (v) => (Number.isFinite(v) && v > 0 ? v : null);

  const famManual = str(manualFamily);
  const famScenario = str(sc.family);
  const matFamily = famManual || famScenario || DEFAULT_MAT_FAMILY;
  const matSource = famManual ? PARAM_SRC.MANUAL : (famScenario ? PARAM_SRC.SCENARIO : PARAM_SRC.DEFAULT);

  // 浇注系统类型：用户选了就用用户的；没选才看生产场景。
  //   ⚠ 默认**不猜**：两边都没有 → ''（未指定）→ 一句速度判定都不给（96.txt §十）
  const typeManual = SYSTEM_TYPE[str(manualType)] ? str(manualType) : '';
  const typeScenario = SYSTEM_TYPE[str(sc.gatingType)] ? str(sc.gatingType) : '';
  const gatingType = typeManual || typeScenario || '';
  const typeSource = typeManual ? PARAM_SRC.MANUAL : (typeScenario ? PARAM_SRC.SCENARIO : PARAM_SRC.DEFAULT);

  // 出品率：只有"场景真的设置过"才算（yieldSrc 为 DEFAULT 的 75 只是材料表默认值，
  //   不是用户的选择 —— 那种情况要走材质默认值这条路，UI 标「默认值」）
  const yManual = num(manualYield);
  const scenarioSet = sc.yieldSrc === 'USER_INPUT' || sc.yieldSrc === 'USER_OVERRIDE' || sc.yieldSrc === 'SCENARIO';
  const yScenario = scenarioSet ? num(sc.yieldPct) : null;
  const yieldPct = yManual != null ? yManual : yScenario;
  const yieldSource = yManual != null ? PARAM_SRC.MANUAL
    : (yScenario != null ? PARAM_SRC.SCENARIO : PARAM_SRC.DEFAULT);

  return { matFamily, matSource, gatingType, typeSource, yieldPct, yieldSource };
}

/** 有限性兜底：NaN / ±Infinity / 非数字一律变 null（95.txt §十三.12 的硬要求） */
function finiteOrNull(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

/**
 * 从产品几何汇总出"可用于浇注计算"的体积（95.txt §六：产品 STL → 体积）。
 *
 * ★ 只累加**闭合**组件的体积（objectsFromComponents 的 volumeReliable 语义，
 *   89.txt §二："组件不是闭合实体就不得假装得到可靠体积"）。
 *   有实体被排除时如实报 volumePartial —— 由视图显示为 WARNING，
 *   绝不让"缺了一块的体积"看起来像一个完整的产品体积。
 *
 * @param {Array<{id,closed,metrics,volumeReliable}>} objects state.product.objects
 * @returns {{volumeMm3:number|null, partCount:number, closedCount:number,
 *            excludedCount:number, partial:boolean}}
 */
export function productVolumeOf(objects = []) {
  const list = (objects || []).filter(Boolean);
  const usable = list.filter((o) => o.volumeReliable !== false
    && Number.isFinite(o.metrics?.volumeMm3) && o.metrics.volumeMm3 > 0);
  const total = usable.reduce((s, o) => s + o.metrics.volumeMm3, 0);
  return {
    volumeMm3: usable.length ? total : null,
    partCount: list.length,
    closedCount: usable.length,
    excludedCount: list.length - usable.length,
    partial: usable.length > 0 && usable.length < list.length,
  };
}

/**
 * 浇注工艺计算（PHASE 95 主入口）。
 *
 * @param {object} o
 *   matKey     材质键（MATERIALS 的键，如 '灰铁(HT)'）。未知/缺省 → 算不出，给原因码。
 *   product    productVolumeOf() 的结果（{volumeMm3, partial, excludedCount, partCount}）
 *   wallMm     主体壁厚（自动链 bodyRefOf；见视图层的 wallOfProduct）
 *   ingate     buildGatingAreas() 的内浇口那一项（要 totalMm2 / usableCount / partial / count）
 *   yieldPct   出品率 %（缺省 → 用材质表的 y_sug，并标 yieldIsDefault）
 *   systemType '' | '封闭' | '开放'（用户指定才启用企业 R7 参考，不猜 —— 95.txt §八）
 *
 * @returns {object} 见下方字段注释。**任何算不出来的量一律 null + missing 原因码，
 *   绝不出现 NaN / Infinity**（95.txt §十三.12，末尾统一兜底）。
 */
export function buildPouringResult({
  matKey, product, wallMm, ingate, yieldPct, systemType,
} = {}) {
  const md = MATERIALS[matKey] || null;
  const mat = md ? matKey : null;
  const rho = md ? md.rho : null;
  const hasYield = Number.isFinite(yieldPct) && yieldPct > 0;
  const yieldIsDefault = !hasYield;
  const yv = hasYield ? yieldPct : (md ? md.y_sug : null);

  const missing = [];
  if (!mat) missing.push(POUR_REASON.NO_MAT);

  const pv = product || {};
  const volumeMm3 = Number.isFinite(pv.volumeMm3) && pv.volumeMm3 > 0 ? pv.volumeMm3 : null;
  if (!pv.partCount) missing.push(POUR_REASON.NO_PRODUCT);
  else if (volumeMm3 == null) missing.push(POUR_REASON.NO_VOLUME);

  const wall = Number.isFinite(wallMm) && wallMm > 0 ? wallMm : null;
  const ingateArea = Number.isFinite(ingate?.totalMm2) && ingate.totalMm2 > 0 ? ingate.totalMm2 : null;

  let volumeCm3 = null, weightKg = null, pourMassKg = null, pourVolCm3 = null;
  let pourTimeS = null, flowCm3s = null, vMs = null;

  if (mat && volumeMm3 != null && rho > 0 && yv > 0) {
    // mm³ → cm³ 是 ÷1000；g = cm³ × ρ(g/cm³)；kg = g ÷1000  ⇒  weightKg = mm³ × ρ / 1e6
    volumeCm3 = volumeMm3 / 1000;
    weightKg = (volumeMm3 * rho) / 1e6;
    pourMassKg = weightKg / (yv / 100);            // 浇注金属液重量 G（奥赞/流量口径，PHASE 49）
    pourVolCm3 = (pourMassKg * 1000) / rho;        // 浇注金属液体积（mm³ 等价物）
    if (weightKg <= 0) missing.push(POUR_REASON.ZERO_VOLUME);

    // ★ 浇注时间：直接调经典浇注系统计算器（PHASE 47 唯一权威入口）
    if (wall == null) missing.push(POUR_REASON.NO_WALL);
    else if (weightKg > 0) {
      pourTimeS = finiteOrNull(calc_t(mat, weightKg, wall));
      if (!(pourTimeS > 0)) pourTimeS = null;
    }
    // ★ 总流量 Q = V / t（V = 浇注金属液体积，见文件头口径说明）
    if (pourTimeS != null) flowCm3s = finiteOrNull(pourVolCm3 / pourTimeS);
    // ★ 平均内浇口速度：直接调经典计算器的 calc_v —— 与 Q/A 恒等（同一口径，不是第二套）
    if (ingateArea == null) missing.push(POUR_REASON.NO_INGATE);
    else if (pourTimeS != null) {
      vMs = finiteOrNull(calc_v(pourMassKg, rho, pourTimeS, ingateArea));
      if (!(vMs > 0)) vMs = null;
    }
  }

  // 企业经验审核参考（R7）：**只有用户明确指定了浇注系统类型才启用**（95.txt §八：
  //   不知道工艺类型就给判定标准 = 伪造标准；这里宁可不判）
  const typeKey = SYSTEM_TYPE[systemType] ? systemType : null;
  const vLimit = typeKey ? (V_LIMIT[typeKey] ?? null) : null;
  const vExceed = (vLimit != null && vMs != null) ? vMs > vLimit : null;

  // ---- 重点提示（95.txt §十：只做几个真正有意义的检查，不做十几个 PASS/FAIL）----
  const items = [];
  const push = (level, code, params = []) => items.push({ level, code, params });
  // ⚠ 这一段必须**穷尽**每一条断链：任意一个输入取不到，都要有一条人话解释，
  //   绝不允许"重点提示"整块空着（用户会以为算过了）。顺序 = 计算链的顺序。
  const dataOk = volumeMm3 != null && wall != null && pourTimeS != null;
  if (dataOk) push(LEVEL.PASS, POUR_CODE.READY);
  if (!mat) push(LEVEL.WARNING, POUR_CODE.MISSING_MAT);
  if (!pv.partCount) push(LEVEL.WARNING, POUR_CODE.MISSING_PRODUCT);
  else if (volumeMm3 == null) push(LEVEL.WARNING, POUR_CODE.MISSING_VOLUME);
  else if (pv.partial && pv.excludedCount > 0) {
    push(LEVEL.WARNING, POUR_CODE.VOLUME_PARTIAL, [pv.excludedCount]);
  }
  if (volumeMm3 != null && wall == null) push(LEVEL.WARNING, POUR_CODE.MISSING_WALL);
  if (ingate?.partial && ingate.unreliableCount > 0) {
    push(LEVEL.WARNING, POUR_CODE.AREA_PARTIAL, [ingate.unreliableCount]);
  }
  // 内浇口总面积不可得 —— 不论是不是"上游也缺"，都要点名（用户最需要知道的一环）
  if (ingateArea == null) push(LEVEL.WARNING, POUR_CODE.MISSING_INGATE);
  if (vMs != null) {
    // 速度算得出来 → 只有"要不要拿企业 R7 比"这一个问题（95.txt §八：不指定就不比）
    if (typeKey == null) push(LEVEL.INFO, POUR_CODE.V_NO_CRITERION);
    else if (vExceed === true) push(LEVEL.WARNING, POUR_CODE.V_EXCEED, [round2(vMs), typeKey, vLimit]);
    else push(LEVEL.PASS, POUR_CODE.V_PASS, [round2(vMs), typeKey, vLimit]);
  }
  // vMs 为 null 且面积也在 → 说明上游就断了（产品/壁厚），上面已分别点名，这里不重复、不误导
  // 内浇口一致性：**只报数，不设阈值**（95.txt §十.4 要求给最大偏差；
  //   全项目没有任何"偏差多少算不合格"的可靠依据 → 不编一个）
  if (ingate?.count > 1 && ingate.spreadPct != null && ingate.spreadPct > 0) {
    push(LEVEL.INFO, POUR_CODE.INGATE_SPREAD, [round1(ingate.spreadPct)]);
  }
  // PHASE 96（96.txt §六/§二十一）：有单元的截面方向是按主轴取的约定值 —— 面积照给，
  //   但必须说出来（只提示，不进 missing、不影响 level 之外的东西）
  if (ingate?.uncertainCount > 0) {
    push(LEVEL.INFO, POUR_CODE.AXIS_UNCERTAIN, [ingate.uncertainCount]);
  }
  // 建议（96.txt §十七：建议单独一层，措辞照 §十一，只在中性描述之后出现）
  //   ⚠ 只在"速度确实超了企业 R7 参考"时给，且**不给任何百分比/幅度建议**（96.txt §十一）
  if (vExceed === true) push(LEVEL.INFO, POUR_CODE.V_SUGGEST);

  const warns = items.filter((i) => i.level === LEVEL.WARNING).length;
  // ★ 数值一律**原样返回、不预先取整**（只做有限性兜底）：显示精度是视图 layer 的事
  //   （fmt(v, d)）。这样测试才能断言"检测中心算出来的浇注时间 == 经典计算器算出来的"，
  //   而不是"四舍五入到两位后相等"—— 后者会掩盖真实的公式漂移。
  const fin = finiteOrNull;
  return {
    matKey: mat, matName: mat, rho,
    yieldPct: yv, yieldIsDefault,
    volumeCm3: fin(volumeCm3),        // 产品金属液体积
    weightKg: fin(weightKg),          // 产品重量（浇注时间公式的 W）
    pourMassKg: fin(pourMassKg),      // 浇注金属液重量 G
    pourVolCm3: fin(pourVolCm3),      // 浇注金属液体积
    wallMm: fin(wall),
    pourTimeS: fin(pourTimeS),
    flowCm3s: fin(flowCm3s),
    ingateAreaMm2: fin(ingateArea),
    vMs: fin(vMs),
    systemType: typeKey,
    vLimit,
    vExceed,
    volumePartial: !!pv.partial,
    volumeExcluded: pv.excludedCount || 0,
    partCount: pv.partCount || 0,
    missing,
    // 数据完整度（视图用一句话概括，不用它做工程判断）
    complete: missing.length === 0,
    level: warns ? LEVEL.WARNING : LEVEL.PASS,
    warns,
    items,
  };
}

// ⚠ round1 复用文件上方 summarize 已经定义的那一个（同名 const 在本模块作用域内只能有一份）。
//   round2 只用于**提示文案的参数**（"1.72 m/s 超过…"），不用于结果字段 —— 见上面 return 的说明。
const round2 = (v) => (finiteOrNull(v) == null ? null : Math.round(v * 100) / 100);
