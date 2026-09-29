// ============================================================
// 流道几何追踪（PHASE 90 · 90.txt §三~§十七；PHASE 91 · 91.txt §6 重写连接检测）
//
// ★★ PHASE 92（92.txt）只改一件事：**把"一条路径"改成"一张网络"**。
//      §四 的原话：Junction 是"停止单路径追踪"的节点，不要在 Junction 内部
//      继续用 nearest-loop 强行决定唯一方向。
//      实测（见 docs/PHASE92_ANALYSIS.md §3）：一个最普通的 T 型网络
//      （2 内浇口 ⌀16 → 横浇道 ⌀22 → 直浇道 ⌀30）在当前代码下会
//      跑到直浇道顶上、从 C2 走进 C1 的管口、量出 2222mm²（真值上限 707），
//      而且 C1 与 C2 **结果不对称**。
//      根因不是"算法不聪明"，是**没有交汇这个状态**：
//      交汇处几何给出的信号（截面并成一块板）只有两种反应——继续走，或者报"流道到头"。
//      两种都会错。PHASE 92 补上第三种：**在这里停下，记成节点，往每个方向各起一条边**。
//
//      ★ §十五 明令"复用 PHASE 90/91 已验证的代码，不要为了重新设计全部重写"。
//        所以：切面 sliceArea / 连续性闸门 / headlineStats / 突变检测 / 语义标签
//        **一行都没重写**；连接检测 findConnections **整体冻结**。
//        改的只有两处：① marchSegment 在**切不动的那一刀**上也判一次交汇；
//        ② traceFlow 的递归 walk() → 节点+边的网络遍历。
//
// ★★ PHASE 91 只改了一件事，但它是根上的事：**连接检测**（见 §二 的大段注释）。
//      PHASE 90 用「质心到产品外表面距离」判连接，对"Gating 插入 Product"会把一个口
//      拆成好几个。PHASE 91 换成**顶点内/外分类 + 边界穿越**，与阈值无关。
//      第 7~11 步（中心线推进 / 切片 / 突变 / 语义标签）**原样复用**，没有重写。
//
// ★★ 本模块的立场（90.txt §一 / §二十）：
//      **不首先识别"直浇道、横浇道、内浇口"。**
//      先找 Product 与 Gating 的连接区域，再从连接区域**向外反向追踪**，
//      沿路径持续测量有效截面积，用"截面积-距离"这条曲线描述几何结构。
//      工艺语义（直浇道/横浇道/内浇口）只在最后作为**显示标签**贴上去，
//      而且几何不支持时就写"几何通道"，不硬命名（§十二）。
//
// ★ 为什么推翻了 PHASE 89 的做法（90.txt §一，用户实测反馈）：
//      PHASE 89 走的是「点选入口 → 测地场 → 波前分叉 → 递归分段 → 严格四闸门」。
//      实际用起来：入口点不准、topmost 只能找到最高点、大量结果报"无法可靠计算"。
//      根因是它**先猜语义再让几何去凑**，而且把"最小有效截面积"设计成了一条
//      非常苛刻的判定链 —— 一刀不合规就整段作废。
//      PHASE 90 全部反过来：单向推进 + 逐刀独立判定 + 允许少量 invalid sample。
//
// ★ 核心量（§七）：沿当前 flow path，取与局部流向垂直的截面，
//      求 Gating STL 与该截面的交线 → 闭合 loop → 面积 / 形心 → 继续向外。
//      每一步记录 {distance, area, centroid, direction, confidence}。
//
// ★ 优先输出（§八）：最小测得截面积 + 最小位置 + 截面积-距离序列 + 有效采样率。
//      **只有当有效数据完全不足时**才说"截面积不足以计算"，
//      不轻易显示"该段无法可靠计算"。
//
// ★ 分叉（§十）：不靠测地波前。就看**截面的闭合环数** ——
//      本来 1 个连续闭合 loop，之后出现 ≥2 个空间上独立的闭合 loop → branch。
//      另有一个 §十 字面规则覆盖不到的几何：**垂直 T 型交汇**。
//      那里沿原方向切永远只有 1 个环（切到的是横浇道的纵剖面，一块板），
//      所以加了第二条判据：「截面在平面内被横向拉长 + 面积跳升 + 沿原方向继续走时
//      这种板状在半个横向跨度内就消失」→ 判为交汇。见 detectJunction 注释。
//
// ★ 阈值（§九：集中定义、可在报告中解释）：全部在 FLOW_CONFIG，没有任何散落的魔数。
//
// 冻结：`js/engine/` 零改动（90.txt §十九）。纯函数，不依赖 three.js / DOM，Node 可直接测。
// ============================================================
import { splitByAdjacency, subsetCentroid, meshDiagonal } from './meshComponents.js';
import { buildTriGrid, distanceToMesh } from './meshDistance.js';
import { buildInsideTester } from './meshInside.js';
import { sliceArea } from './objectMetrics.js';

/* ============================================================
   零、集中定义的阈值（90.txt §九：阈值必须集中定义且可解释）
   ============================================================ */

export const FLOW_CONFIG = {
  // —— §四 Product↔Gating 近接判据 ——
  // ★ PHASE 91 §6：这条阈值**只用于"表面带"**（顶点离产品表面多近算贴着），
  //   不再承担"判连接"的全部职责 —— 判连接的主证据是**顶点在产品内/外**
  //   与**三角形是否穿越产品边界**，那两件事与阈值无关。所以 §25 那种
  //   "识别不到就 ×10"的调法在这里既没必要也不管用。
  tolFrac: 0.004,          // 表面带宽度 = 产品包围盒对角线 × 此值
  tolAbsMinMm: 0.05,       // 下限（小件不能退化成 0）
  tolMaxMm: 5,             // ★ 上限（§四：不能无限扩大）
  tolRelaxedMm: 2.0,       // 主判据一无所获时的放宽值（**会在诊断里如实报出**）
  minConnTris: 4,          // 少于这么多面的"连接区域"当噪声丢掉

  // —— 起始方向（§六：从 Product 指向 Gating 内部）——
  dirMinFrac: 0.02,        // 指向分量实质心的位移小于此比例则视为退化

  // —— 单向推进（§六/§七）——
  stepPerRadius: 0.6,      // 步长 = 上一刀等效半径 × 此值
  stepMinMm: 0.4,
  stepMaxMm: 8,
  maxSteps: 240,           // 单段最多走多少刀
  probeFactors: [1, 0.5, 1.6],  // §七：一刀不成，试相邻位置（同向、半程、1.6 倍）
  maxMissStreak: 2,        // 连续几刀完全切不到东西就认定流道到头
  maxTurnDeg: 75,          // 相邻两刀形心位移与当前方向的夹角超过此值 → 记为方向不稳
  maxUnstable: 3,          // 累计几次不稳就收工（§十二：不稳就明说，不硬算）
  maxJumpFrac: 2.5,        // 形心离预测点超过 等效半径×此值 → 该刀不可信
  // §16 第 4 条「与相邻截面变化**连续**」：拿最近几刀的中位数为基准，
  // 低于 中位数 × 此值 的一刀不是"这条流道变细了"，而是切到了畸形碎片
  //（子集被剪断的碎环、斜刀切出的细长条）→ 如实标无效，绝不返回一个看似精确的小数。
  minAreaRatio: 0.05,
  scaleWindow: 3,          // 基准取最近几刀的中位数
  minValidSamples: 3,      // 有效样本少于这么多 → 该段"截面积不足以计算"（§八）

  // —— 分叉（§十）——
  ambigRatio: 1.25,        // 两个环离预测点距离之比小于此值 → 该刀有歧义，标 invalid
  // 判"分叉"要求两环**既分得开、又挨得近**（一个区间，不是单边阈值）：
  //   下界 loopSepMinFrac：太近 → 是同一条流道被网格噪声切成两半，不是分叉
  //   上界 forkSepMaxFrac：★太远 → 那是切面顺带切到了**旁边另一条流道**，也不是分叉
  // 上界是实测加上的：一个两条并排内浇口的浇注系统（相距 90mm、各 ⌀16），
  // 追踪从一条转向竖直后，切面把另一条也切进来了，于是被误判成"分叉"。
  loopSepMinFrac: 0.6,
  forkSepMaxFrac: 2.0,
  // 起步方向校正：初值只是"指向浇注系统内部"的粗估，不是局部流向
  realignDeg: 15,
  maxDepth: 5,             // 流道树最大层级
  maxSegments: 40,         // 整棵树最多多少段
  minSegSamples: 2,        // 少于这么多有效样本的子段不继续递归（但不丢弃，如实报出）

  // —— 交汇处（§十 的第二条判据，垂直 T 型）——
  junctionAspect: 2.0,     // 截面在平面内的长宽比 ≥ 此值 → 板状
  junctionUpRatio: 1.5,    // 且面积比上一刀涨了这么多
  junctionMinSamples: 2,   // 至少已经正常走了这么多刀才允许判交汇
  junctionProbeFrac: [0.15, 0.25, 0.35, 0.45],  // 沿横向找"干净支路截面"的试偏移（× 横向跨度）
  junctionLookaheadMinMm: 5,
  junctionLookaheadMaxMm: 40,

  // —— PHASE 92 §五/§九/§十：交汇 → 分支（网络）——
  // 交汇判据的**空间连续性**一条（§九 明令"禁止从 A 点跳到空间上较远但面积相似的 B 点"）：
  // 我们自己的预测点必须**落在这一刀里面**。实测 T 型交汇处 center2=(0,25)、extent=(12,100)
  // → 25 ≤ 50 成立；而"顺带切到旁边另一条流道"时预测点在人家包围盒外 → 不成立。零新阈值。
  backDeg: 60,             // 候选方向与**来向**夹角大于 180-此值 → 是在回头，丢掉
  dupDirDeg: 20,           // 两个候选方向夹角小于此值 → 是同一个方向，去重
  // 支路起步探针：**从交汇点沿候选方向小步向外走**，取第一刀"干净通道截面"当起步点。
  //   步长/最远距离都以**来向通道**的半径为基准 —— 不是拿交汇截面那块板的 rEq：
  //   那块板又长又薄，拿它当步长基准会一步跨过短支路（实测：横浇道末端离内浇口只有 5mm 时支路整个丢掉）。
  //   ★★ 最关键的一条：**一旦某一刀切到 0 个环就立刻停**（§九 空间连续性）。
  //   为什么必须有：真实通道是连续的 —— 我们正走在里面，每一站都该有截面。
  //   实测反例：内浇口接到横浇道之后继续沿原方向往外探，会越过横浇道顶端落空，
  //   再往前正好撞上 45mm 外的**直浇道**，切出一个又大又圆的截面 ——
  //   看起来完美，其实是"从 A 点直接跳到空间上较远的 B 点"（§九 明令禁止）。
  //   "断了就不许再往前"用一条零阈值的几何事实挡掉了这种跳跃。
  branchProbeStep: 0.5,
  branchProbeMax: 6,       // 最远 = 来向通道等效半径 × 此值
  branchProbeMaxMm: 60,    // 绝对上限
  // —— 节点合并 / 边去重（§十 merge，§十七 Q 无重复 edge）——
  // 判"撞上已有节点"的容差 = 两侧半径较小者 × 此值（实测取 0.6：交汇的支路起点离交汇点
  // 约 8mm，而节点半径 ~6 → 容差 3.6，不会把自己刚生出来的支路立刻掐死）
  nodeMergeFrac: 0.6,
  nodeMergeMinMm: 0.5,
  // 已走访点的空间哈希格边长 —— 必须 ≥ 任何可能的合并容差，否则 27 邻域查不全
  visitedCellMm: 24,

  // —— §九 截面积突变 ——
  jumpRatio: 1.6,          // 后窗中位数 / 前窗中位数 超过此值（或低于其倒数）→ 突变
  jumpWindow: 2,           // 前后各取几个有效样本算中位数
  jumpMergeSamples: 3,     // 相邻的突变点相隔这么近就并成一个
};

/** 各段为什么停在这里（全部是"如实说明"，不是错误码） */
export const FLOW_REASON = {
  NO_PRODUCT: 'no_product',
  NO_GATING: 'no_gating',
  NO_CONNECTION: 'no_connection',
  NO_DIRECTION: 'no_direction',
  END_OF_DUCT: 'end_of_duct',
  DIRECTION_UNSTABLE: 'direction_unstable',
  BRANCHED: 'branched',          // 在这里分出了岔，本段到此为止（是正常结束，不是失败）
  // PHASE 92 §十：走到**已经存在的节点**上（两条来路汇合 / 撞上别的段走过的几何）。
  // 这是网络里最正常的一种结束 —— 它不是失败，是"接上了"。
  REACHED_NODE: 'reached_node',
  MAX_STEPS: 'max_steps',
  TRUNCATED: 'segments_truncated',
  INSUFFICIENT_SAMPLES: 'insufficient_samples',
  OK: 'ok',
};

/** 单刀为什么没记成有效样本 */
export const SAMPLE_REASON = {
  NONE: '',
  NO_LOOP: 'no_loop',            // 这一刀完全切不到闭合环
  AMBIGUOUS: 'ambiguous',        // 切到多个环且离预测点差不多近
  OFF_AXIS: 'off_axis',          // 环的形心离预测点太远（不像是本流道的截面）
  OPEN: 'open',                  // 该刀存在未闭合环（网格破口/子集被剪断）
  TOO_SMALL: 'too_small',        // 面积与相邻几刀不连续（畸形碎片，§16 第 4 条）
};

/* ============================================================
   一、向量小工具
   ============================================================ */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function unit(a, fallback) {
  const l = len(a);
  if (!(l > 1e-12)) return fallback || null;
  return [a[0] / l, a[1] / l, a[2] / l];
}
const angleDeg = (a, b) => {
  const c = Math.min(1, Math.max(-1, dot(a, b)));
  return Math.acos(c) * 180 / Math.PI;
};
const rEq = (area) => Math.sqrt(Math.max(area, 0) / Math.PI);
const round2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const median = (arr) => {
  if (!arr.length) return null;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/* ============================================================
   二、第一步：找 Product ↔ Gating 的连接区域（91.txt §6，重写 PHASE 90 的判据）
   ============================================================
   输出里的每个独立连接区域就是一个 candidate gate，**此时还不命名**（§五/§七）——
   统一叫 flow connection / 产品连接，语义留到最后再解释。

   ★ 为什么推翻 PHASE 90 的判据（91.txt §6 明写 + 实测复现）
     PHASE 90 用的是「浇注系统三角形**质心**到产品**外表面**的距离 ≤ tol」。它对
     **面接触**是对的，对 **Gating 插入 / 嵌入 Product** 完全不可靠，实测：
       ⌀20 内浇口插入 20mm 厚平板 15mm → 一个口被拆成 **4 个**（入口那圈窄带质心
       落在阈值内的只有零星几片，带宽不足一个三角形就把环切碎），形心偏到 6.9mm 外，
       起始方向偏轴 **31°**；贯穿件被拆成 **15 个**。
     根因两条：① 用**质心**而不是**顶点** → 窄带断成弧段；② 压根没有"内 / 外"概念
     → 插入体和悬空件在算法眼里一模一样。**所以调大 tolerance 治不了**（§25 正是这么说的）。

   ★ PHASE 91 的三态判据（§6 点名的 80/20 组合：surface proximity + inside/outside
     + 穿越边界 + 连通区域）
     ① 每个浇注系统顶点先量到产品的最近距离：
          ≤ tol（表面带）      → SURFACE
          否则用射线法判内外   → IN / OUT（见 meshInside.js）
     ② 三角形按顶点状态分三类：
          **穿越 crossing** —— 同时有 IN 和 OUT 顶点 ⇒ 明确穿过产品边界。
             ★ 这是与阈值无关的几何事实，也是"为什么它算连接"的正面证据（§25）。
          **接触 contact**   —— 没有穿越，但有顶点落在表面带内 ⇒ 面接触 / 近接。
          **内部 inside**    —— 顶点全在内且无穿越 ⇒ 插入体的内部，**不参与成口**，
             只用来回答"插进去多深"（诊断数据，§17）。
     ③ 成口 = {穿越 ∪ 接触}，按**浇注系统内部邻接**聚合（不是空间聚类 ——
        空间聚类会把交汇处两条挨得很近的流道并成一个口）。
     ④ 主判据一无所获时才退到放宽阈值，并**如实报出 residual**（§四/§25）。
   ============================================================ */

/**
 * @param {{vertices:Float32Array, triCount:number}} productMesh 产品 STL
 * @param {{vertices:Float32Array, triCount:number}} gatingMesh  浇注系统 STL
 * @param {object} cc  gatingMesh 的 triangleComponents 结果（要它的邻接图与分量）
 * @param {object} [opts] 覆盖 FLOW_CONFIG
 *   opts.productComponents  可选：产品的 triangleComponents 结果。给了就能检查产品是否水密
 *     （射线法要求水密，有洞时奇偶失效 → 必须如实报 product_not_closed，不能假装结论可靠）
 * @returns {{connections:Array, tol:number, tolUsed:number, relaxed:boolean, warnings:Array}}
 */
export function findConnections(productMesh, gatingMesh, cc, opts = {}) {
  const cfg = { ...FLOW_CONFIG, ...opts };
  const warnings = [];
  const empty = (code) => ({ connections: [], tol: 0, tolUsed: 0, relaxed: false, warnings: [{ code }] });

  if (!productMesh || !productMesh.triCount) return empty('no_product');
  if (!gatingMesh || !gatingMesh.triCount) return empty('no_gating');
  if (!cc || !cc.components.length) return empty('no_gating');

  const prodDiag = meshDiagonal(productMesh.vertices, productMesh.triCount);
  const gatingDiag = cc.diagonal || meshDiagonal(gatingMesh.vertices, gatingMesh.triCount);

  // ★ §四：阈值与模型尺度相关 + 有上限 + 可在诊断中显示
  const tol = Math.min(Math.max(prodDiag * cfg.tolFrac, cfg.tolAbsMinMm), cfg.tolMaxMm);
  const tolRelaxed = Math.min(Math.max(tol * cfg.tolRelaxedMm, tol), cfg.tolMaxMm * 2);

  const cell = Math.max(prodDiag / 64, 1e-6);
  const grid = buildTriGrid(productMesh, cell);
  const pb = grid.bb;

  // —— 分离轴预筛（仍然是严格下界，不会漏判）——
  //   三角形 AABB 与产品 AABB 在任一轴上分得比 tolRelaxed 还开 → 既不近接、也**不可能在内部**，
  //   后面的距离查询与射线法都省了。实测：一根从产品往上伸 90mm 的直管，
  //   预筛把逐三角形查询从 10916 次压到几百次。
  const sep = (o) => {
    for (let k = 0; k < 3; k++) {
      if (o[k] > pb.max[k] + tolRelaxed) return true;
      if (o[k + 3] < pb.min[k] - tolRelaxed) return true;
    }
    return false;
  };
  const cand = [];
  const tb = new Float64Array(6);
  for (let t = 0; t < gatingMesh.triCount; t++) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const x = gatingMesh.vertices[o + k * 3], y = gatingMesh.vertices[o + k * 3 + 1], z = gatingMesh.vertices[o + k * 3 + 2];
      if (k === 0) { tb[0] = x; tb[3] = x; tb[1] = y; tb[4] = y; tb[2] = z; tb[5] = z; continue; }
      if (x < tb[0]) tb[0] = x; if (x > tb[3]) tb[3] = x;
      if (y < tb[1]) tb[1] = y; if (y > tb[4]) tb[4] = y;
      if (z < tb[2]) tb[2] = z; if (z > tb[5]) tb[5] = z;
    }
    if (!sep(tb)) cand.push(t);
  }
  if (!cand.length) return { connections: [], tol: round2(tol), tolUsed: null, relaxed: false, warnings: [{ code: 'no_connection' }] };

  // —— 顶点分类（按坐标去重；STL 是非索引三角汤，同一顶点会在多个三角形里重复出现）——
  const V_OUT = 0, V_IN = 1;
  const vs = new Int8Array(gatingMesh.triCount * 3);
  const vd = new Float64Array(gatingMesh.triCount * 3);
  const cache = new Map();               // "x,y,z" → 顶点记录（省掉大量重复的射线法）
  const tester = buildInsideTester(productMesh, grid);
  let unreliableVerts = 0, insideVerts = 0;
  for (const t of cand) {
    const o = t * 9;
    for (let k = 0; k < 3; k++) {
      const x = gatingMesh.vertices[o + k * 3], y = gatingMesh.vertices[o + k * 3 + 1], z = gatingMesh.vertices[o + k * 3 + 2];
      const key = x + ',' + y + ',' + z;
      let rec = cache.get(key);
      if (!rec) {
        const p = [x, y, z];
        const dist = distanceToMesh(grid, productMesh, p);
        rec = { d: dist, s: V_OUT };
        // 只有明确落在表面带**之外**的点才需要判内外 —— 表面带内的点由 tol 直接定性，
        // 这样"端面正好与产品面共面"这类退化情形是**确定**的，不靠射线碰运气。
        if (dist > tol) {
          const r = tester.contains(p);
          if (r.agree < 3) unreliableVerts++;
          rec.s = r.inside ? V_IN : V_OUT;
          if (r.inside) insideVerts++;
        }
        cache.set(key, rec);
      }
      vs[t * 3 + k] = rec.s;
      vd[t * 3 + k] = rec.d;
    }
  }
  if (unreliableVerts) warnings.push({ code: 'inside_unreliable', params: { n: unreliableVerts } });
  // 产品不水密 → 射线法奇偶失效，如实报（§十六：网格质量导致无法可靠判定，就说不可靠）
  const pc = opts.productComponents;
  if (pc && Array.isArray(pc.components) && pc.components.some((c) => !c.closed)) {
    warnings.push({ code: 'product_not_closed' });
  }

  // —— 按 tol 把三角形分三类 ——
  const classify = (useTol) => {
    const crossing = [], contact = [], inside = [];
    for (const t of cand) {
      let hasIn = false, hasOut = false, hasSurf = false;
      for (let k = 0; k < 3; k++) {
        const i = t * 3 + k;
        if (vd[i] <= useTol) { hasSurf = true; continue; }
        if (vs[i] === V_IN) hasIn = true; else hasOut = true;
      }
      // 先判穿越：同时有内外顶点就是明确穿过边界，与阈值无关
      if (hasIn && hasOut) crossing.push(t);
      else if (hasSurf) contact.push(t);
      else if (hasIn) inside.push(t);
    }
    return { crossing, contact, inside };
  };

  let usedTol = tol, relaxed = false;
  let cls = classify(tol);
  let ports = cls.crossing.concat(cls.contact);
  if (!ports.length && tolRelaxed > tol) {
    const alt = classify(tolRelaxed);
    const altPorts = alt.crossing.concat(alt.contact);
    if (altPorts.length) {
      cls = alt; ports = altPorts; usedTol = tolRelaxed; relaxed = true;
      warnings.push({ code: 'tol_relaxed', params: { tol: round2(tolRelaxed) } });
    }
  }

  // 浇注系统整块埋在产品里、没有任何边界穿越 → 连接关系在几何上不可判定，如实说
  if (!ports.length) {
    if (cls.inside.length >= cfg.minConnTris) {
      warnings.push({ code: 'gating_inside_no_boundary', params: { n: cls.inside.length } });
    }
    return { connections: [], tol: round2(tol), tolUsed: null, relaxed: false, warnings: warnings.concat([{ code: 'no_connection' }]) };
  }

  // ★ 每个独立连接区域 = 一个 candidate gate。按**浇注系统内部的邻接**聚合。
  const groups = splitByAdjacency(cc.adj, ports);
  const insideSet = new Set(cls.inside);
  const crossingSet = new Set(cls.crossing);

  const connections = [];
  let dropped = 0, noDir = 0;
  const byCompCache = new Map();
  for (const g of groups) {
    if (g.length < cfg.minConnTris) { dropped++; continue; }

    const centroid = subsetCentroid(gatingMesh, g);
    if (!centroid) { dropped++; continue; }
    const componentIndex = cc.triToComp[g[0]];
    const comp = cc.components[componentIndex];
    if (!comp) { dropped++; continue; }

    // 面积 + 面积加权法向（法向指向产品**外侧**，即从浇注系统指向产品）
    let area = 0, nx = 0, ny = 0, nz = 0;
    for (const t of g) {
      const o = t * 9;
      const ax = gatingMesh.vertices[o], ay = gatingMesh.vertices[o + 1], az = gatingMesh.vertices[o + 2];
      const bx = gatingMesh.vertices[o + 3], by = gatingMesh.vertices[o + 4], bz = gatingMesh.vertices[o + 5];
      const cx = gatingMesh.vertices[o + 6], cy = gatingMesh.vertices[o + 7], cz = gatingMesh.vertices[o + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const crx = uy * vz - uz * vy, cry = uz * vx - ux * vz, crz = ux * vy - uy * vx;
      const a2 = Math.hypot(crx, cry, crz);       // = 2×面积
      if (!(a2 > 0)) continue;
      area += a2 / 2;
      nx += crx; ny += cry; nz += crz;            // 面积加权法向（未归一）
    }

    // 穿越 / 接触 各占多少（§17 诊断：这一口凭什么算连接，看这两个数最直接）
    let crossingCount = 0;
    for (const t of g) if (crossingSet.has(t)) crossingCount++;

    // 插入部分：从本口沿"内部三角形"向外扩张，量插进去多深（诊断用，不参与成口）
    let depthMm = null, insideCount = 0;
    if (insideSet.size) {
      const seen = new Set(g);
      const stack = [];
      const pushNbrs = (t) => {
        for (let i = cc.adj.start[t]; i < cc.adj.start[t + 1]; i++) {
          const o = cc.adj.nbr[i];
          if (insideSet.has(o) && !seen.has(o)) { seen.add(o); stack.push(o); }
        }
      };
      for (const t of g) pushNbrs(t);
      while (stack.length) {
        const t = stack.pop();
        insideCount++;
        const o = t * 9;
        for (let k = 0; k < 3; k++) {
          const dd = vd[t * 3 + k];
          if (depthMm == null || dd > depthMm) depthMm = dd;
        }
        pushNbrs(t);
      }
    }

    // ★ 起始方向（§六：从 Product 指向 Gating System 内部；§14：绝不用包围盒最长边/主轴）
    //   ① 指向本浇注系统分量质心 —— 一条减法，最稳、完全可解释
    //   ② 退化成 ① 时：从产品质心指向浇注系统（§六 的字面表述）
    //   ③ 再退化：−连接面法向（只对**面接触**的平口有效；穿越环的法向自相抵消，coh 会把它挡掉）
    //   ④ 都不行 → **不给方向、报 WARNING**（§十三），不硬编一个
    if (!byCompCache.has(componentIndex)) {
      byCompCache.set(componentIndex, subsetCentroid(gatingMesh, comp.tris));
    }
    const compC = byCompCache.get(componentIndex);
    let initialDir = null, dirSource = 'none';
    if (compC) {
      const bulk = sub(compC, centroid);
      if (len(bulk) >= gatingDiag * cfg.dirMinFrac) { initialDir = unit(bulk); dirSource = 'bulk'; }
    }
    if (!initialDir) {
      const prodC = [(pb.min[0] + pb.max[0]) / 2, (pb.min[1] + pb.max[1]) / 2, (pb.min[2] + pb.max[2]) / 2];
      const away = sub(compC || centroid, prodC);
      if (len(away) >= gatingDiag * cfg.dirMinFrac) { initialDir = unit(away); dirSource = 'away_from_product'; }
    }
    if (!initialDir) {
      const nrm = unit([nx, ny, nz]);
      const coh = len([nx, ny, nz]) / Math.max(area * 2, 1e-12);   // 法向一致程度 0~1
      if (nrm && coh >= 0.35) { initialDir = mul(nrm, -1); dirSource = 'normal'; }
    }
    if (!initialDir) { noDir++; warnings.push({ code: 'connection_no_direction', params: { id: 'C' + (connections.length + 1) } }); }

    let gap = Infinity;
    for (const t of g) for (let k = 0; k < 3; k++) if (vd[t * 3 + k] < gap) gap = vd[t * 3 + k];

    // ★ 这个口有多大：在口处垂直于**局部流向**切一刀实测 ——
    //   不是把连接面的三角面面积当截面（穿越情况下那是一圈环面，没有通流含义）。
    //
    //   ⚠ 必须先用截面形心把方向校正一次再切。initialDir 只是"从连接口指向浇注系统内部"的
    //     粗估（§六），对多内浇口系统可能偏离管子轴线几十度 —— 拿它去切就是**斜切**，
    //     面积系统性偏大。实测：一个 ⌀14 内浇口接在直浇道+横浇道下面，粗估方向偏轴约 28°，
    //     口处量出 174.7mm²（真值 153.9，+13.5%），而沿程追踪量到的是 151.3（正确）。
    //     同一个口给出两个对不上的数，是最容易被工程师一眼看穿的那种错。
    //   校正方式与 marchSegment 的起步校正**同一套**（多切一刀，看形心指哪）。
    let sectionAreaMm2 = null;
    if (initialDir) {
      const r0 = Math.sqrt(Math.max(area, 0) / Math.PI);
      const hBase = Math.min(Math.max(r0 * cfg.stepPerRadius, cfg.stepMinMm), cfg.stepMaxMm);
      // 找一个"切得成"的位置 —— 与 §七「一刀不成试相邻位置」同一套思路。
      // ⚠ 这里**不能**要求"整刀只有 1 个闭合环"：整个浇注系统是一个连通体，
      //   ⌀14 内浇口在 x=±30 并联时，水平切一刀必然同时切到两条 → 2 个环，
      //   于是正确的方向反而被判不合格（实测就是被这一条卡住的）。
      //   cutSection 自己会挑"离预测点最近的环"，并且对"两环一样近"的歧义有拒绝逻辑 ——
      //   用它的结论就够了，不要在它之上再加一道更粗的闸门。
      const cutAny = (dir) => {
        for (const f of cfg.probeFactors) {
          const q = add(centroid, mul(dir, hBase * f));
          const r = cutSection(gatingMesh, comp.tris, q, dir, q, 0, cfg);
          if (r.ok) return r;
        }
        return null;
      };
      let probe = cutAny(initialDir);
      if (probe) {
        // 粗估方向可能偏轴几十度，斜切会把面积系统性放大 → 用第一刀的截面形心反推一次
        const nd = unit(sub(probe.loop.centroid, centroid));
        if (nd && angleDeg(nd, initialDir) > cfg.realignDeg) {
          dirSource += '+realigned';             // 如实记下"方向是靠截面反推校正过的"
          const re = cutAny(nd);
          if (re) probe = re;
        }
      }
      if (probe) sectionAreaMm2 = round2(probe.loop.area);
    }

    connections.push({
      id: 'C' + (connections.length + 1),
      componentIndex,
      centroid,
      normal: unit([nx, ny, nz]),
      area: round2(area),                        // 连接区域自身的三角面面积（诊断）
      sectionAreaMm2,                            // ★ 口处实测有效截面积（结果里用它）
      seedArea: sectionAreaMm2 != null ? sectionAreaMm2 : round2(area),
      // 这一口属于 §6 的哪一种 —— 直接对应 91.txt 要求的三种情况（面接触 / 插入 / 不接）
      //   insertion：口后面挂着伸进产品内部的面 ⇒ Gating 插入 Product
      //   crossing ：没有内部面，但有三角形明确穿越边界（粗网格时才会单独出现）
      //   contact  ：只有顶点落在表面带内 ⇒ 面接触 / 近接
      kind: insideCount > 0 ? 'insertion' : (crossingCount > 0 ? 'crossing' : 'contact'),
      crossingTriangleCount: crossingCount,
      insideTriangleCount: insideCount,
      depthMm: depthMm == null ? null : round2(depthMm),
      triangleCount: g.length,
      tris: Int32Array.from(g),
      gapMm: round2(Number.isFinite(gap) ? gap : null),
      initialDir,
      dirSource,
    });
  }

  if (dropped) warnings.push({ code: 'small_connection_dropped', params: { n: dropped } });
  if (!connections.length) warnings.push({ code: 'no_connection' });
  return { connections, tol: round2(tol), tolUsed: round2(usedTol), relaxed, warnings, gatingDiag, noDir };
}

/* ============================================================
   三、取一刀截面：与流向垂直的平面 × 浇注系统本分量的三角形
   ============================================================ */

/* ⚠ 这里曾经试过一条"放宽"规则，实测被否决，记在这免得下次再走一遍：
 *   想法 —— 截面突然变大（内浇口汇入横浇道）时形心本来就会横移，于是判 OFF_AXIS 不合理；
 *   加一条"预测点落在环的平面包围盒内 且 环比上一刀大"就放行。
 *   实测（横浇道 + 2 个 ⌀12 内浇口，⌀12 横浇道）：
 *     放行 → 追踪冲进横浇道后迷失，长成 9 段 / 4 个分叉，其中两段量出
 *            **18.56 mm² 与 20.79 mm²**（⌀12 真值 113.1）—— 一个漂亮但错误的数字。
 *     不放行 → 2 个连接口各自干净地量出 ⌀12 内浇口（110.62，−2.2%），
 *            在交汇处如实报"流道到头"。
 *   结论：**垂直交汇处的转向是拓扑问题，不是阈值问题**。用一条宽松规则硬闯进去，
 *   换来的是"看起来把横浇道也量了"，代价是最小截面积变成假数。
 *   91.txt §22 说得很清楚：宁可 WARNING，也不要制造一个漂亮但错误的数字。
 *   真正的解法（沿交汇处横向展开 + 逐支路独立成段）属于另一个课题，本阶段不做（§23）。
 */

/**
 * 在 q 处、法向为 dir 的平面上切一刀，挑出属于本流道的那个闭合环。
 * 只切**本连通分量的三角形** —— 否则交汇高度上会把另一条流道也算进来（PHASE 89 §十一 的教训）。
 *
 * @param prevArea 上一刀量到的截面积（第一刀传 0）—— 用来判断"这一刀是不是跳得太离谱"
 */
function cutSection(mesh, tris, q, dir, predictFrom, prevArea, cfg) {
  const s = sliceArea(mesh.vertices, mesh.triCount, q, dir, 0, tris);
  const loops = s.loopInfo;
  if (!loops.length) return { ok: false, reason: SAMPLE_REASON.NO_LOOP, slice: s };

  // 挑离"预测位置"最近的环
  let bi = 0, bd = dist(loops[0].centroid, predictFrom);
  let sd = Infinity;
  for (let i = 1; i < loops.length; i++) {
    const dd = dist(loops[i].centroid, predictFrom);
    if (dd < bd) { sd = bd; bd = dd; bi = i; } else if (dd < sd) sd = dd;
  }
  const loop = loops[bi];
  const prevR = Math.sqrt(Math.max(prevArea, 0) / Math.PI);

  // §七：局部失败不判整条路径死刑，但也不能拿一个明显不是本流道的环凑数
  // （为什么**不**给"截面变大导致形心外移"开例外，见本函数上方那段被否决的实验记录）
  if (prevR > 0 && bd > prevR * cfg.maxJumpFrac) {
    return { ok: false, reason: SAMPLE_REASON.OFF_AXIS, slice: s, loop, jumpMm: bd };
  }
  // 两个环离得一样近 → 有歧义，如实标 invalid（不猜）
  if (loops.length >= 2 && sd <= bd * cfg.ambigRatio) {
    return { ok: false, reason: SAMPLE_REASON.AMBIGUOUS, slice: s, loop, loops };
  }
  return { ok: true, slice: s, loop, loops };
}

/** 沿 dir 推进时，板状截面能维持多长（用于交汇判据，见 detectJunction） */
function slabRunLength(mesh, tris, from, dir, h, slabArea, slabAspect, cfg, lookaheadMm) {
  let arc = 0;
  let p = from.slice();
  while (arc < lookaheadMm) {
    const step = Math.min(h, lookaheadMm - arc);
    const q = add(p, mul(dir, step));
    const s = sliceArea(mesh.vertices, mesh.triCount, q, dir, 0, tris);
    if (s.loopInfo.length !== 1) break;
    const lp = s.loopInfo[0];
    const ex = lp.extent;
    const aspect = Math.max(ex[0], ex[1]) / Math.max(Math.min(ex[0], ex[1]), 1e-9);
    if (aspect < slabAspect || lp.area < slabArea * 0.5) break;
    arc += step;
    p = add(p, mul(dir, step));
  }
  return arc;
}

/**
 * 交汇判据（90.txt §十 的第二条 + 92.txt §五/§九）。
 *
 * 为什么需要它：在垂直 T 型交汇处，沿原方向切**永远只有 1 个闭合环** ——
 * 切到的其实是横向通道的纵剖面（一块板），故 §十 字面的"1 个环 → 2 个环"永远不触发。
 *
 * 判据五条（全部是可复核的几何事实）：
 *   ① 只有一个闭合环（多环走 isFork 那条路，不在这里）
 *   ② 板状：截面在平面内被横向拉长（长宽比 ≥ junctionAspect）
 *   ③ 面积比上一刀涨了 ≥ junctionUpRatio 倍 —— **辅助证据**（§十三：不能单独作为依据）
 *   ④ ★ 空间连续性（92.txt §九）：**我们自己的预测点必须落在这一刀里面**。
 *      判据是 `|center2| × 2 ≤ extent`。为什么这条正好是 §九 要的：
 *      sliceArea 的平面坐标原点是**这一刀的预测点**，也就是我们自己轴线上的点。
 *      "预测点在截面内" ⇔ "是我们走进了它"；反过来，顺带切到旁边另一条互不相干的
 *      流道时，预测点在人家包围盒外面 → 直接否掉。**不需要引入任何新阈值。**
 *   ⑤ ★ 决定性的一条：沿原方向继续走，这种板状在**半个横向跨度内就消失**。
 *      真·交汇处：横通道在纵向只有那么厚，穿过去就没了；
 *      均匀件突然变宽（不是交汇）：板状会一直维持下去。
 *      实测：T 型夹具里板状撑了 15~19mm 就没（横向跨度 100mm → 判交汇）；
 *      而"⌀20 突然变 60×20 的扁流道"板状撑满整个前瞻窗 → 不判交汇。
 *
 * ⚠ 与 PHASE 90/91 的差别：那时这个判据**只在"这一刀切成功了"之后才跑**，
 *   而交汇处那一刀恰恰会因为形心横移被判 OFF_AXIS —— 判据根本轮不到执行。
 *   实测：C1 就这样死在交汇处前 10mm（"流道到头"），C2 却因为步长相位不同跨过了阈值
 *   冲进直浇道。PHASE 92 把判据提前到**切不动的那一刀**上（见 marchSegment）。
 *
 * @returns {{loop, majorDir, majorExtent, aspect, runMm, point}|null}
 *   point —— 交汇点。取**这一刀的预测点**（= 我们自己轴线上的点），
 *   不是环的形心 —— 实测汇合处的环形心在横通道**中段**，离我们的轴线 25mm。
 */
function junctionFromSlab(mesh, tris, q, dir, slice, loop, prevArea, h, cfg) {
  if (!slice || !slice.closed) return null;
  const ex = loop.extent;
  const wu = ex[0], wv = ex[1];
  // ② 板状
  const aspect = Math.max(wu, wv) / Math.max(Math.min(wu, wv), 1e-9);
  if (aspect < cfg.junctionAspect) return null;
  // ③ 面积跳升（辅助）
  if (!(prevArea > 0) || loop.area < prevArea * cfg.junctionUpRatio) return null;
  // ④ 空间连续性：预测点落在这一刀里面
  if (Math.abs(loop.center2[0]) * 2 > wu + 1e-9) return null;
  if (Math.abs(loop.center2[1]) * 2 > wv + 1e-9) return null;

  const majorV = wu >= wv ? 0 : 1;
  const majorExtent = Math.max(wu, wv);
  const majorDir = unit(slice.basis[majorV]);
  if (!majorDir) return null;

  // ⑤ 板状沿原方向很快消失
  const lookahead = Math.min(Math.max(majorExtent * 0.5, cfg.junctionLookaheadMinMm), cfg.junctionLookaheadMaxMm);
  const run = slabRunLength(mesh, tris, q, dir, h, loop.area, cfg.junctionAspect, cfg, lookahead);
  if (run >= lookahead) return null;                        // 板状一直维持 → 只是变宽，不是交汇

  return { loop, majorDir, majorExtent, aspect, runMm: round2(run), point: axisCrossing(q, dir, loop.centroid, majorDir) };
}

/**
 * 交汇点 = **我们这条通道的轴线** 与 **横穿那条通道的轴线** 的最近点。
 *
 * 为什么不是"环的形心"（PHASE 91 的做法）：环的形心在横通道的**中段**，
 * 实测离我们自己的轴线 25~45mm —— 拿它当交汇点，两条从左右两侧接近同一个直浇道的来路
 * 会算出**两个相距 22mm 的交汇点**，于是同一个物理交汇被记成两个节点，
 * 各自再往上生一条直浇道分支 → 网络里出现两条并行的重复边（§十七 Q）。
 *
 * 两条轴线最近点的公式是标准的（解一个 2×2）。两线接近平行时退化成"没有唯一点"，
 * 这时老实回落到预测点 q —— 它一定在我们自己的轴线上。
 */
function axisCrossing(q, dir, anchor, majorDir) {
  const w0 = sub(anchor, q);                       // 从我们的轴线点指向横通道轴线上的一点
  const b = dot(dir, majorDir);
  const denom = 1 - b * b;
  if (!(denom > 1e-6)) return q.slice();           // 近乎平行 → 没有唯一点
  const d = dot(dir, w0), e = dot(majorDir, w0);
  const s = (b * e - d) / denom;                   // 我们这条线上的参数
  if (!Number.isFinite(s)) return q.slice();
  return add(q, mul(dir, s));
}

/**
 * 交汇点 → 候选方向（92.txt §九）。
 *
 * 候选只有三类，都能一句话说清出处：
 *   ① 平面内**长轴的两个方向** —— 这不是经验规则：拿垂直于自身轴线的平面去切一根
 *      横穿的管子，得到的就是"沿那根管轴的矩形"，它的长轴方向**就是那根管子的轴向**。
 *   ② **原方向 D** —— 4 路交叉（+）/ 十字路口直行时它才是对的通道。是否保留由后面的
 *      探针决定（探针切不出干净截面就自动丢掉），不靠预先假设。
 * 只做两件筛选：不回头（§十）、去重。
 */
function branchCandidates(slice, majorDir, dir, cfg) {
  const out = [];
  const push = (d) => {
    const u = unit(d);
    if (!u) return;
    if (angleDeg(u, dir) > 180 - cfg.backDeg) return;            // ①不回头
    if (out.some((o) => angleDeg(o, u) < cfg.dupDirDeg)) return; // ②去重
    out.push(u);
  };
  push(majorDir);
  push(mul(majorDir, -1));
  push(dir);
  return out;
}

/**
 * 候选方向 → 可用的支路（92.txt §十）。
 *
 * 每条支路要能给出一个**干净的起步点**。起步点取截面自己的**形心**而不是探针位置 ——
 * 理由同 PHASE 90 的注释：偏轴起步会被起步校正拧向，那个斜切面会一路伸进旁边的流道，
 * 实测切出过 1782mm² 的假截面（真值 707）。
 *
 * @param rAnchor 来向通道的等效半径 —— 探针步长以它为基准。
 *   ⚠ 不能用交汇截面那块板的 rEq：那块板又长又薄（长宽比 5~8），rEq 会被横向跨度
 *   撑得很大，一步就探到通道外面去。实测：横浇道末端离内浇口只有 5mm 时支路整个丢掉。
 */
function probeBranches(mesh, tris, point, cands, rAnchor, cfg) {
  const arms = [];
  const base = Math.min(Math.max(Math.max(rAnchor, 0) * 0.5, cfg.stepMinMm), cfg.stepMaxMm);
  const step = Math.max(base * cfg.branchProbeStep, cfg.stepMinMm);
  const maxOff = Math.min(base * cfg.branchProbeMax, cfg.branchProbeMaxMm);
  for (const d of cands) {
    let start = null, sec = null;
    let off = 0;
    while (off < maxOff) {
      off = Math.min(off + step, maxOff);
      const s = sliceArea(mesh.vertices, mesh.triCount, add(point, mul(d, off)), d, 0, tris);
      // ★ 断了：这个方向上**一刀切不到任何东西** → 没有连续通道，后面的都不用看了（§九 空间连续性）。
      //   ⚠ 必须区分「真的一刀切不到」与「切到了但没有闭合环」：
      //   探针与某根管子的表面**相切**时会切出一条退化细条，与旁边的环连成不闭合的折线，
      //   于是 loopInfo 为空。实测：主夹具里横浇道顶端（y=55+8）正好与直浇道相切，
      //   一整条"沿直浇道往上"的支路就因为这个**退化站**被整根判死 —— 直浇道整个丢失。
      //   切到东西（loops>0）但没闭合环 ⇒ 换下一站，不算断。
      if (!s.loops) break;
      if (!s.loopInfo.length) continue;
      // 挑**离探针点最近**的那个环 —— 与 cutSection 同一套逻辑。
      //   不能要求"整刀只有 1 个环"：切面顺带切到旁边另一条并行流道是常态
      //   （实测：往 C2 的内浇口方向探，同一刀里必然也切到 87mm 外的 C1 内浇口），
      //   一刀 2 个环就把正确的支路判死，等于把"有干扰"当成"没有通道"。
      const li = s.loopInfo;
      let bi = 0, bd = Math.hypot(li[0].center2[0], li[0].center2[1]), sd = Infinity;
      for (let i = 1; i < li.length; i++) {
        const dd = Math.hypot(li[i].center2[0], li[i].center2[1]);
        if (dd < bd) { sd = bd; bd = dd; bi = i; } else if (dd < sd) sd = dd;
      }
      if (li.length >= 2 && sd <= bd * cfg.ambigRatio) continue;   // 两环一样近 → 有歧义，不猜
      const lp = li[bi];
      // 探针落在某根管子的**切点**上会切出一条细长条；探针还停在"我们穿过去的那块板"里
      // 也会切出板状。两者都不是支路截面 —— 让探针继续往远处试。
      const asp = Math.max(lp.extent[0], lp.extent[1]) / Math.max(Math.min(lp.extent[0], lp.extent[1]), 1e-9);
      if (asp > cfg.junctionAspect && lp.area > cfg.junctionAspect * 10) continue;
      // ★ 空间连续性（§九）：**探针点本身必须落在这一刀里面**（center2 的原点就是探针点）。
      //   没有这一条会出这种错：内浇口接到横浇道后沿 +Y 继续探，越过横浇道顶端之后，
      //   45mm 外的**直浇道**正好在这一站占据了空间 —— 一刀切出一个又大又圆的截面，
      //   看起来完美，其实是"跳到空间上较远的另一条通道"（§九 明令禁止）。
      //   加上这条：探针点在 (−45, 52.8, 0)，而那个环的形心在 (0, 52.8, 0)、直径才 30
      //   → 探针点根本不在环里 → 直接否掉。
      if (Math.abs(lp.center2[0]) * 2 > lp.extent[0] + 1e-9) continue;
      if (Math.abs(lp.center2[1]) * 2 > lp.extent[1] + 1e-9) continue;
      start = lp.centroid; sec = lp; break;
    }
    if (!start) continue;
    // 起步点跑偏（形心不在 d 方向上）→ 说明这一刀切的是别的东西，丢掉
    const nd = unit(sub(start, point));
    if (!nd || angleDeg(nd, d) > cfg.maxTurnDeg) continue;
    if (arms.some((a) => angleDeg(a.dir, d) < cfg.dupDirDeg)) continue;
    arms.push({ dir: d, start, loop: sec });
  }
  return arms;
}

/* ============================================================
   四、单段推进（90.txt §六/§七）
   ============================================================ */

/**
 * @param seedRadius 起始等效半径（决定头几步的步长）
 * @param seedArea   起始截面积 —— 同时充当"与相邻截面连续"（§16 第 4 条）的第一个基准。
 *   为什么要拿它当基准：子段（分叉/交汇处生出来的）是**新开一次 marchSegment**，
 *   自己还没有任何历史。没有基准的话它第一刀切到什么就认什么 ——
 *   实测交汇处第一刀切出 0.66mm² 的畸形碎片，直接变成整棵树"最小截面积"。
 *   而它出发处的截面大小是**已知的**（父段在分叉点上的那个环），拿来当基准天经地义。
 * @param ctx 网络遍历给回来的上下文：
 *   ctx.hitNode(point, r) → 撞上的已有节点（没有则 null）。
 *   92.txt §十 的 merge 就落在这里：一条边走回已经走过的几何时**停在那里并接上**，
 *   而不是继续往前走（实测：C2 的支路会一路走进 C1 的管口）。
 */
function marchSegment(mesh, tris, startPoint, startDir, cfg, seedRadius = 0, seedArea = 0, ctx = null) {
  const samples = [];
  const path = [];
  let P = startPoint.slice();
  let D = unit(startDir);
  let prevC = null;
  let lastArea = 0;
  let arc = 0, unstable = 0, missStreak = 0;
  // 最近几刀的面积（§16 第 4 条"与相邻截面变化连续"的基准），以及它的中位数。
  // 种子面积先放进去 —— 子段第一刀就已经有基准，不会"切到什么认什么"。
  const recentAreas = [];
  if (seedArea > 0) recentAreas.push(seedArea);
  let scaleArea = recentAreas.length ? median(recentAreas) : 0;
  let endReason = FLOW_REASON.MAX_STEPS;
  let junction = null;           // PHASE 92：交汇规格（点 / 长轴 / 支路）
  let reached = null;            // PHASE 92：走到已有节点上（§十 merge）
  let branchLoops = null;
  let branchAt = null, branchPoint = null;
  let validSeen = 0;
  const r0 = Math.max(rEq(seedRadius), 0);

  // 起步方向校正（§六：初始方向只保证"从产品指向浇注系统内部"，不保证是**局部**流向）。
  // 实测：某浇注系统的内浇口在 x=−45、而整个浇注系统的质心在中央，
  // 于是粗估方向偏离管子轴线 41°，头两刀成了斜切、面积虚高（258/264，真值 201）。
  // 拿第一刀的截面形心反推一次局部流向即可收敛 —— 只多切一刀，且仅在有种子半径时做。
  if (r0 > 0) {
    const h0 = Math.min(Math.max(r0 * cfg.stepPerRadius, cfg.stepMinMm), cfg.stepMaxMm);
    const warm = cutSection(mesh, tris, add(P, mul(D, h0)), D, add(P, mul(D, h0)), 0, cfg);
    if (warm.ok) {
      const nd = unit(sub(warm.loop.centroid, P));
      if (nd && angleDeg(nd, D) > cfg.realignDeg) D = nd;
    }
  }

  /** 由交汇规格 + 候选方向生成支路（§十）；生成不出支路就当作"不是交汇"，继续按原路走 */
  const makeJunction = (spec, kind, incoming) => {
    const cands = branchCandidates(null, spec.majorDir, incoming, cfg);
    const rA = rEq(lastArea);
    // ★ 交汇点回落到"**我们这条通道的轴线**与横穿通道轴线的交点"。
    //   为什么不能直接用检测到的那一刀的位置 q：交汇是**检测出来的**，而检测发生在
    //   切面刚与横通道相交的那一档 —— 位置取决于**步长**，不取决于几何。
    //   实测：横浇道穿过 ⌀30 直浇道时，从左边来的那段在 x=−11.4 判出交汇、
    //   从右边来的那段在 x=+11.4 判出 —— 同一个物理交汇被记成**两个节点**，
    //   于是直浇道被生成两遍，而且其中一个节点变成走不通的死胡同。
    //   支路起步点落在横通道的**轴线**上（findCleanStart 返回截面形心，见其注释），
    //   把它投影到我们的轴线上，就得到与步长无关的那个交点：两条来路都会算到同一点。
    const snap = (arms, from) => {
      if (!arms.length) return from;
      const nearest = arms.reduce((a, b) => (dist(a.start, from) <= dist(b.start, from) ? a : b));
      const s = dot(sub(nearest.start, from), incoming) / Math.max(dot(incoming, incoming), 1e-12);
      return Number.isFinite(s) ? add(from, mul(incoming, s)) : from;
    };
    // 探针锚在**交汇点**上（不是检测到那一刀的位置）：交汇点在横通道轴线上，
    // 从这里出发，正对支路的那一档探针点正好落在通道截面中心 —— 起步点才不会带偏。
    // 两步：先前探一次定出交汇点，再从交汇点探一次（起步点因此显著更正）。
    const arms1 = probeBranches(mesh, tris, spec.point, cands, rA, cfg);
    let point = snap(arms1, spec.point);
    let arms = arms1;
    if (arms1.length) {
      const arms2 = probeBranches(mesh, tris, point, cands, rA, cfg);
      if (arms2.length) arms = arms2;      // 起步点更准，但**交汇点不再二次回投**
    }
    if (!arms.length) return null;
    //   ⚠ 交汇点只 snap 一次。二次回投会把交汇点拽到"离我们最近的那条支路起步点"上 ——
    //     实测：内浇口正下方就是横浇道、正上方是直浇道时，第二次回投把交汇点抬到
    //     直浇道上 9mm 处，于是同一次交汇被记成**两个相距 9mm 的节点**，
    //     一个走不通（度为 1），整棵子树和直浇道断开。
    return {
      kind, point, majorExtent: spec.majorExtent, aspect: spec.aspect,
      runMm: spec.runMm, arms, probePoint: spec.point,
      slabAreaMm2: spec.loop ? round2(spec.loop.area) : null,
    };
  };

  for (let step = 0; step < cfg.maxSteps; step++) {
    const baseR = prevC ? Math.max(rEq(lastArea), cfg.stepMinMm) : Math.max(r0, cfg.stepMinMm);
    const h = Math.min(Math.max(baseR * cfg.stepPerRadius, cfg.stepMinMm), cfg.stepMaxMm);

    // §七：一刀不成，试相邻位置（同向、半程、1.6 倍）。
    // ★★ PHASE 92 的核心改动之一（92.txt §四/§五）：**每一档试探都先判一次交汇**。
    //   为什么必须逐档判、不能只看"最后那一刀"：
    //   交汇处的截面是横穿通道的纵剖面（一块又长又薄的板），形心在横通道中段 ——
    //   实测离我们自己的轴线 25~45mm，而 OFF_AXIS 只允许跳 prevR×2.5。
    //   于是**远的那一档被判"失败"、近的那一档却切到了干净的圆截面**，
    //   循环把成功的那一刀收下、把带交汇证据的那一刀**丢掉** —— 交汇判据永远看不到它。
    //   实测（T 型网络）：就是这样让方向先被斜切拧了 9°，然后一路冲进直浇道，量出 2127mm²（真值 707）。
    //   正确反应见 §四：Junction 是"停止单路径追踪"的节点 —— 在这里停下，生成支路。
    let hit = null, junctionHit = null, arrival = null;
    for (const f of cfg.probeFactors) {
      const q = add(P, mul(D, h * f));
      const r = cutSection(mesh, tris, q, D, q, prevC ? lastArea : 0, cfg);
      if (!hit) hit = { ...r, q, hUsed: h * f };
      // ★★ ① 到位检查**必须优先于新建交汇**。
      //   已经有一条路走到这里了，那就是**汇合**，不该再开一个新的交汇节点。
      //   踩过的坑：横浇道从直浇道往右走，撞上另一条内浇口的 T 口时，
      //   交汇判据先生效 → 建出一个**度为 1 的死胡同节点**，
      //   而"往下接回 C2"那条腿因为几何已被走过被丢掉 —— 网络在这里断了。
      //   判据用**预测点 q**（我们自己轴线上的位置），不用"最近环的形心" ——
      //   交汇那一刀本身就切不出干净的环，形心在横通道中段（实测偏 22mm），
      //   拿它去比"到没到某个节点"必然落空。
      if (ctx && ctx.hitNode) {
        const n = ctx.hitNode(q, r.ok ? rEq(r.loop.area) : rEq(lastArea));
        if (n) { arrival = { node: n, at: arc + h * f }; break; }
      }
      // ★ ② 交汇判据（板状 + 面积跳升 + 预测点落在这一刀里 + 板状沿原方向很快消失）
      if (validSeen >= 1 && r.slice && r.slice.closed && r.slice.loopInfo.length === 1) {
        const spec = junctionFromSlab(mesh, tris, q, D, r.slice, r.slice.loopInfo[0], lastArea, h, cfg);
        if (spec) {
          const j = makeJunction({ ...spec, basis: r.slice.basis }, 'junction', D);
          if (j) { junctionHit = { j, at: arc + h * f, point: q }; break; }
        }
      }
      if (r.ok) { hit = { ...r, q, hUsed: h * f }; break; }   // 切到干净截面且不像交汇 → 继续沿原路走
    }
    if (arrival) {
      reached = arrival.node; branchAt = arrival.at; endReason = FLOW_REASON.REACHED_NODE; break;
    }
    if (junctionHit) {
      junction = junctionHit.j; branchAt = junctionHit.at; branchPoint = junctionHit.j.point;
      endReason = FLOW_REASON.BRANCHED; break;
    }

    if (!hit || !hit.ok) {
      samples.push({
        index: samples.length, distance: round2(arc + h), area: null, centroid: null,
        direction: D.slice(), valid: false, reason: (hit && hit.reason) || SAMPLE_REASON.NO_LOOP,
        loops: hit && hit.slice ? hit.slice.loops : 0, extent: null, confidence: 'none',
      });
      missStreak++;
      if (missStreak > cfg.maxMissStreak) { endReason = FLOW_REASON.END_OF_DUCT; break; }
      P = add(P, mul(D, h * cfg.probeFactors[cfg.probeFactors.length - 1]));  // 跨大步再试
      continue;
    }
    missStreak = 0;

    const { loop, slice, q, hUsed } = hit;
    const C = loop.centroid;

    // ★ §16 第 4 条「与相邻截面变化连续」—— 与最近几刀的中位数比，塌下去的刀不是截面。
    //   为什么必须有这一条：交汇处附近斜刀会切出细长条 / 子集碎环，它们**是闭合环、
    //   形心也不远**，前面几道闸门全都放行，于是"最小截面积"里混进一个 0.66mm² 的假数
    //   （实测：横浇道 + 2 内浇口的系统没这条时量到 minA=0.66，真值 113）。
    //   §16 说得直白：面积接近 0 / 只有一个异常三角片 / 无法形成可靠截面 → 说"无法可靠计算"，
    //   不要返回一个看似精确的数字。
    if (scaleArea > 0 && loop.area < scaleArea * cfg.minAreaRatio) {
      samples.push({
        index: samples.length, distance: round2(arc + hUsed), area: null, centroid: null,
        direction: D.slice(), valid: false, reason: SAMPLE_REASON.TOO_SMALL,
        loops: slice.loops, extent: null, confidence: 'none',
      });
      missStreak++;
      if (missStreak > cfg.maxMissStreak) { endReason = FLOW_REASON.END_OF_DUCT; break; }
      P = add(P, mul(D, h * cfg.probeFactors[cfg.probeFactors.length - 1]));
      continue;
    }

    // ★★ PHASE 92 的核心改动之二：**交汇判据从"记录之后"提前到"记录之前"**。
    //   为什么要提前：交汇那一刀的截面（802mm²）根本不是本流道的截面，
    //   把它记成样本会直接污染这条边的 areaMax（实测旧代码 max=2127，真值上限 707）。
    //   所以要提前判、提前停：**这一刀不进样本序列**，只进交汇节点的诊断数据。
    //   用 Dprev（这一刀之前的方向）判"回头"，不能用已经更新过的 D。
    if (validSeen >= cfg.junctionMinSamples && slice.closed && slice.loopInfo.length === 1) {
      const spec = junctionFromSlab(mesh, tris, q, D, slice, loop, lastArea, h, cfg);
      if (spec) {
        const j = makeJunction({ ...spec, basis: slice.basis }, 'junction', D);
        if (j) { junction = j; branchAt = arc + hUsed; branchPoint = q; endReason = FLOW_REASON.BRANCHED; break; }
      }
    }

    // —— 方向更新：来自**相邻截面形心位移**（§十二 的「相邻截面中心变化」）——
    // 注：曾试过再加一道"位移必须与上刀等效半径相称"的守卫（设想是防交汇处形心横移把方向拧走），
    // 实测在全部夹具上**零影响** —— 因为超限的横移早被 cutSection 的 OFF_AXIS 挡掉了，
    // 剩下的靠 maxTurnDeg/maxUnstable 就够。重复的守卫只会增加理解成本，故不保留。
    let turn = 0;
    if (prevC) {
      const nd = unit(sub(C, prevC));
      if (nd) {
        turn = angleDeg(nd, D);
        if (turn > cfg.maxTurnDeg) { unstable++; } else { D = nd; unstable = 0; }
      }
    }
    if (unstable > cfg.maxUnstable) { endReason = FLOW_REASON.DIRECTION_UNSTABLE; break; }

    const dArc = prevC ? dist(C, prevC) : hUsed;
    arc += dArc;

    samples.push({
      index: samples.length, distance: round2(arc), area: round2(loop.area), centroid: C,
      direction: D.slice(), valid: true, reason: slice.closed ? SAMPLE_REASON.NONE : SAMPLE_REASON.OPEN,
      loops: slice.loops, extent: [round2(loop.extent[0]), round2(loop.extent[1])],
      confidence: slice.closed ? 'high' : 'low', turnDeg: round2(turn),
    });
    path.push(C);
    validSeen++;
    recentAreas.push(loop.area);
    if (recentAreas.length > cfg.scaleWindow) recentAreas.shift();
    scaleArea = median(recentAreas);

    // —— 分叉（§十 字面判据）：环数 1 → ≥2，且两环确实分得开 ——
    //   太近 = 同一条流道被网格噪声切成两半；太远 = 切面顺带切到了旁边另一条互不相干的流道。
    if (slice.closed && slice.loopInfo.length >= 2 && isFork(slice.loopInfo, cfg)) {
      branchLoops = slice.loopInfo; branchAt = arc; branchPoint = C; endReason = FLOW_REASON.BRANCHED; break;
    }

    lastArea = loop.area;
    prevC = C;
    P = C;
  }

  // 流道到头时，**末尾那一截切到的是端面（倒角 / 圆头 / 半球端盖），不是流道截面** ——
  // 实测：⌀20 直管最后一片报 267mm² 而沿程全是 312（真值 314）；
  // 那个 267 会让"最小测得截面积"整条结论失真。
  // ★ PHASE 92 把它从"最后一刀"推广到"**面积连续下降的收尾段**"：
  //   圆形端盖（胶囊/半球）会被连续几刀切出一串越来越小的环 ——
  //   实测 ⌀16 圆头端：199 → 143 → 78 → 13.6；只摘掉最后一刀的话"最小截面积"变成 78.3
  //   （真值 201，−61%），一个工程师一眼就能看穿的假数。
  //   而且"只摘最后一刀"能不能过关**取决于采样相位**（两个镜像斜臂就一个过一个不过）——
  //   判据必须对相位不敏感。正常通道不会一路单调变小地结束，所以"连续下降"就是端面的特征。
  //   全部标 terminal 也不打紧：headlineStats 在"能用的刀 < 2"时会整体回退，不把序列掏空。
  // 只把它们从 headline 统计里摘出去，序列里仍然保留并标 terminal:true（§十三：不掩盖，只如实标注）。
  if (endReason === FLOW_REASON.END_OF_DUCT) {
    const vi = [];
    for (let i = 0; i < samples.length; i++) if (samples[i].valid) vi.push(i);
    for (let k = vi.length - 1; k >= 0; k--) {
      samples[vi[k]].terminal = true;
      if (k === 0 || !(samples[vi[k]].area < samples[vi[k - 1]].area)) break;
    }
  }

  return { samples, path, arc, endReason, junction, reached, branchLoops, branchAt, branchPoint, lastArea };
}

/**
 * 多环到底是不是"本流道在这里分了岔"（§十）。
 *
 * 两环必须**既分得开、又挨得近**：
 *   太近（< (r1+r2)×0.6）→ 是同一条流道被网格噪声切成两半
 *   太远（> (r1+r2)×2.0）→ ★是切面顺带切到了旁边另一条互不相干的流道
 * 上界是实测补的：两条并排内浇口相距 90mm（各 ⌀16，阈值 32mm），
 * 追踪从其中一条转向竖直后切面把另一条也带了进来，曾被误判成分叉。
 */
function isFork(loops, cfg) {
  if (loops.length < 2 || loops.length > 4) return false;
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      const rSum = rEq(loops[i].area) + rEq(loops[j].area);
      const d = dist(loops[i].centroid, loops[j].centroid);
      if (d < rSum * cfg.loopSepMinFrac) return false;
      if (d > rSum * cfg.forkSepMaxFrac) return false;
    }
  }
  return true;
}

/* ============================================================
   五、整张网络（92.txt §三：Path → Network）
   ============================================================
   §三 要的 Graph { nodes, edges }：

     Node：kind ∈ { connection, junction, terminal }
     Edge：一段连续、方向一致的浇注通道；携带 samples / path / length / areaMin / areaMax

   ★ 数据结构上**没有** sprue / runner / ingate —— 它们只在最后贴标签（§十一）。
   ★ 遍历是 BFS：交汇点把边切开，每个候选方向各起一条新边（§十）。
   ★ 两张"防重复"的表（§十七 Q/R）：
       节点表       —— 同一个交汇点被两条来路各发现一次时合并成一个节点
       已走访点表   —— 一条支路的起步点落在**已经走过的几何**上时，根本不生成它
     （实测：没有第二张表时，网络里会出现 J2→J3 与 J3→J2 两条重复的边）
   ============================================================ */

export const NODE_KIND = {
  CONNECTION: 'connection',
  JUNCTION: 'junction',
  TERMINAL: 'terminal',
};

/**
 * 从每个连接区域出发向外反向追踪，建出**浇注系统网络**。
 * @returns {{nodes:Array, edges:Array, segments:Array, connections:Array, ...}}
 *   `edges` 与 `segments` 是同一个数组（PHASE 90/91 里叫 segment，92.txt §三 里叫 Edge）——
 *   两个名字都留着，免得把下游（UI / 测试 / 诊断）全部改一遍。
 */
export function traceFlow(gatingMesh, cc, connections, opts = {}) {
  const cfg = { ...FLOW_CONFIG, ...opts };
  const t0 = Date.now();
  const edges = [];
  const nodes = [];
  const warnings = [];
  let truncated = false;
  let spuriousBranches = 0, duplicateBranches = 0, selfLoops = 0;

  /* —— 节点表：按位置合并 —— */
  const mergeTol = (a, b) => Math.max(Math.min(a || 0, b || 0) * cfg.nodeMergeFrac, cfg.nodeMergeMinMm);
  const findNode = (pt, r, skip) => {
    let best = null, bd = Infinity;
    for (const n of nodes) {
      if (n === skip) continue;
      const d = dist(n.point, pt);
      if (d <= mergeTol(r, n.r) && d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const seq = { connection: 0, junction: 0, terminal: 0 };
  const addNode = (kind, point, r, extra = {}) => {
    const prev = findNode(point, r, null);
    if (prev) {
      // 位置重合 → 合并（§十 的 merge：两条来路汇到同一个节点）。
      // 连接口这一层不合并 kinds —— 一个连接口节点同时被两条边用到是正常的。
      if (extra.connectionId && !prev.connectionIds.includes(extra.connectionId)) prev.connectionIds.push(extra.connectionId);
      if (extra.jkind && !prev.jkind) prev.jkind = extra.jkind;
      return prev;
    }
    const n = {
      id: (kind === NODE_KIND.CONNECTION ? 'C' : kind === NODE_KIND.JUNCTION ? 'J' : 'T') + (++seq[kind]),
      kind, point: point.map(round2), r: round2(r), edgeIds: [], connectionIds: [],
      ...(extra.connectionId ? { connectionIds: [extra.connectionId] } : {}),
      ...(extra.jkind ? { jkind: extra.jkind } : {}),
    };
    nodes.push(n);
    return n;
  };

  /* —— 已走访点表（空间哈希；格边长必须 ≥ 任何合并容差，否则 27 邻域查不全）—— */
  const cell = Math.max(cfg.visitedCellMm, 1e-6);
  const vGrid = new Map();
  const vKey = (p) => Math.floor(p[0] / cell) + ',' + Math.floor(p[1] / cell) + ',' + Math.floor(p[2] / cell);
  // node = 这个点**属于哪条边的哪一端**（取更近的那端）。别的边踩到这里时就接到它上面。
  const addVisited = (p, r, node = null) => {
    const k = vKey(p);
    const e = { p, r, node };
    const b = vGrid.get(k);
    if (b) b.push(e); else vGrid.set(k, [e]);
  };
  const findVisited = (pt, r) => {
    const cx = Math.floor(pt[0] / cell), cy = Math.floor(pt[1] / cell), cz = Math.floor(pt[2] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const b = vGrid.get((cx + dx) + ',' + (cy + dy) + ',' + (cz + dz));
      if (!b) continue;
      for (const e of b) if (dist(e.p, pt) <= mergeTol(r, e.r)) return e;
    }
    return null;
  };
  /**
   * 这个位置是不是已经有节点 / 已经走过。
   * `skip` = 刚刚分出这条支路的那个交汇节点 —— 必须跳过它：
   * 支路起点天然就压在交汇点附近（实测直浇道支路起点离交汇点才 2.5mm），
   * 拿它当"已走过"会把**正上方那条真正的主通道**判死。
   */
  const covered = (pt, r, skip) => !!findNode(pt, r, skip) || !!findVisited(pt, r);

  /** 这个点算这条边的哪一端（别的边踩上来时接到那一端 —— 接最近的，可解释） */
  const pickEnd = (p, a, b) => (!b ? a : dist(p, b.point) < dist(p, a.point) ? b : a);

  const compTris = new Map();
  for (const c of connections) {
    const comp = cc.components[c.componentIndex];
    if (comp) compTris.set(c.id, comp.tris);
  }

  /* —— BFS —— */
  const queue = [];
  const byId = new Map();
  for (const conn of connections) {
    if (!conn.initialDir) {
      warnings.push({ code: 'connection_no_direction', params: { id: conn.id } });
      continue;
    }
    if (!compTris.has(conn.id)) continue;
    // 种子半径 = 口处**实测**截面积（穿越情况下连接区域是一圈环面，拿环面积当步长基准会偏小）
    const seedArea = conn.seedArea != null ? conn.seedArea : conn.area;
    const n = addNode(NODE_KIND.CONNECTION, conn.centroid, rEq(seedArea), { connectionId: conn.id });
    queue.push({
      tris: compTris.get(conn.id), start: conn.centroid.slice(), dir: conn.initialDir,
      seedArea, fromNode: n, connectionId: conn.id, parentId: null, depth: 0, entryKind: null,
    });
  }

  let guard = 0;
  while (queue.length) {
    if (edges.length >= cfg.maxSegments) { truncated = true; break; }
    if (guard++ > cfg.maxSegments * 6) { truncated = true; break; }   // 防跑飞（网络可能有环）
    const job = queue.shift();
    // ⚠ 必须跳过自己出发的那个节点 —— 出发位置就压在它上面，不跳过会一步都走不出去。
    //   但**走过的路再绕回原点**要能发现（§十六 R 无非法自环），所以过了 2 倍种子半径就恢复检查。
    const r0 = rEq(job.seedArea);
    //   · 撞上已有**节点** → 接上去（§十 的 merge）
    //   · 踩到已经走过的**几何** → 同样接上去。这一条挡的是"两条来路各自把同一段通道走一遍"：
    //     实测 J3 的两条支路起步点相差一个步长、spawn 时彼此都还没走，于是横浇道上出现两条重叠的边。
    //     容差与节点合并同一套（两侧半径较小者 × 0.6）—— 真实的并行流道相距 ≥ 2 倍半径，不会误判。
    //   只跳过**自己出发的那个节点**（出发位置就压在它上面），其余一律照查。
    //   （曾用"走出去两个种子半径之后才开始查"来回避自撞，实测反而把已经走过的整段横浇道放过去了。）
    const hitNode = (pt, r) => findNode(pt, r, job.fromNode) || (findVisited(pt, r) || {}).node || null;

    const m = marchSegment(gatingMesh, job.tris, job.start, job.dir, cfg, job.seedArea, job.seedArea, { hitNode });

    // 支路（不是根边）如果什么也没量到、而且也**没接上任何东西** → 那个方向其实没有通道
    //（探针切到的是别的东西）。反过来，**哪怕只量到一刀，只要它接上了一个交汇 / 已有节点，
    //  这一段就是真的**：实测两个交汇之间只隔 14mm 时，支路走一刀就撞上交汇了 ——
    //  那不是"没通道"，那正是"接上了"。
    const mValid = m.samples.filter((s) => s.valid).length;
    //   注意 `reached`（第一刀就撞上已走过的几何）不算数 —— 那种边一刀没量到、长度为 0，
    //   留着只会变成网络里一条空连接（实测出现过 E8: len=0, n=0 的垃圾边）。
    if (job.entryKind && mValid < cfg.minSegSamples && !(m.junction && mValid >= 1)) { spuriousBranches++; continue; }

    const seg = buildSegment(m, {
      connectionId: job.connectionId, parentId: job.parentId, depth: job.depth,
      entryKind: job.entryKind, branchPoint: m.branchPoint, branchAt: m.branchAt,
    });
    // ⚠ 边号必须**在生成支路之前**定下来 —— 支路要把 parentId 记成它（踩过：id 晚赋值 → 子段挂不上父段）
    seg.id = 'E' + (edges.length + 1);
    seg.startNode = job.fromNode.id;
    seg.startPoint = job.start.map(round2);
    // 支路从**交汇点**出发，但采样要等到切得出干净截面才开始 —— 中间那段（约一个步长）
    // 没有样本。3D 里把这段补上，免得图上出现"交汇点与流道之间断了一截"。
    // ⚠ 单独放在 leadIn 里，不动 path / samples 的对应关系（它们是一一对应的）。
    if (job.entryKind && m.path.length && dist(m.path[0], job.fromNode.point) > 0.1) {
      seg.leadIn = job.fromNode.point.slice();
    }

    /* —— 这条边到哪里结束 —— */
    let arms = null, branchKind = null;
    if (m.junction) {
      branchKind = m.junction.kind;                                   // 'junction'
      arms = m.junction.arms;
      seg.junctionAspect = round2(m.junction.aspect);
      seg.junctionSlabAreaMm2 = m.junction.slabAreaMm2;
      seg.junctionRunMm = m.junction.runMm;
    } else if (m.branchLoops) {
      branchKind = 'loops';                                           // §十 字面判据
      arms = [];
      for (const lp of m.branchLoops) {
        const d = unit(sub(lp.centroid, m.branchPoint));
        if (!d) continue;
        const start = findCleanStart(gatingMesh, job.tris, lp.centroid, d, rEq(lp.area), cfg) || lp.centroid;
        arms.push({ dir: d, start, loop: lp });
      }
    }

    if (arms && arms.length) {
      const jn = addNode(NODE_KIND.JUNCTION, m.branchPoint, rEq(m.lastArea), { jkind: branchKind });
      seg.endNode = jn.id;
      seg.endReason = FLOW_REASON.BRANCHED;
      seg.branchKind = branchKind;
      seg.branchAt = round2(m.branchAt);
      seg.branchPoint = m.branchPoint;
      // 支路起点/方向留成诊断数据（§十七）：交汇处判得对不对，看这几个数最直接
      seg.branchArms = arms.map((a) => ({
        start: a.start.map(round2), dir: a.dir.map(round2), area: round2(a.loop.area),
      }));
      if (job.depth < cfg.maxDepth) {
        for (const a of arms) {
          const ar = rEq(a.loop.area);
          // §十七 Q/R：这个方向**已经走过**了 → 不生成（否则会出现 J2→J3 / J3→J2 这种重复边）
          if (covered(a.start, ar, jn)) { duplicateBranches++; continue; }
          // ★ 还要**预订**这个起步点：同一交汇的两条来路会各自生出一条"往上走"的同名支路，
          //   而它们先后入队、此时谁都还没走，光靠"已走访点"挡不住（实测 sprue 上出现两条并行边）。
          //   预订用的半径取 1/4：同一交汇的两条不同方向支路起步点相隔 ≥ 一个步长（约 8~11mm），
          //   不会被误挡；而两条真正同向的支路起步点几乎重合，必然被挡掉。
          addVisited(a.start, ar * 0.25);
          queue.push({
            tris: job.tris, start: a.start.slice(), dir: a.dir, seedArea: a.loop.area,
            fromNode: jn, connectionId: job.connectionId, parentId: seg.id,
            depth: job.depth + 1, entryKind: branchKind,
          });
        }
      }
    } else if (m.reached) {
      seg.endNode = m.reached.id;
      seg.endReason = FLOW_REASON.REACHED_NODE;
    } else {
      const last = [...m.samples].reverse().find((s) => s.valid && s.centroid);
      const tn = addNode(NODE_KIND.TERMINAL, last ? last.centroid : job.start, rEq(m.lastArea));
      seg.endNode = tn.id;
    }

    if (seg.startNode === seg.endNode) { selfLoops++; continue; }      // §十六 R：不留自环

    edges.push(seg);
    byId.set(seg.id, seg);
    for (const nd of nodes) if (nd.id === seg.startNode || nd.id === seg.endNode) nd.edgeIds.push(seg.id);
    // 记入已走访点表：采样形心 + 两端节点（下一条边走到这里就会停下并接上）
    const endNd = nodes.find((n) => n.id === seg.endNode) || null;
    for (const s of m.samples) if (s.valid && s.centroid) addVisited(s.centroid, rEq(s.area), pickEnd(s.centroid, job.fromNode, endNd));
    addVisited(seg.path.length ? seg.path[seg.path.length - 1] : job.start, rEq(m.lastArea), endNd);
  }

  if (truncated) warnings.push({ code: 'segments_truncated', params: { n: cfg.maxSegments } });
  if (spuriousBranches) warnings.push({ code: 'spurious_branches', params: { n: spuriousBranches } });
  if (duplicateBranches) warnings.push({ code: 'duplicate_branches', params: { n: duplicateBranches } });
  if (selfLoops) warnings.push({ code: 'self_loops_dropped', params: { n: selfLoops } });

  // 父子编号回填（§十一：connection → segment → branch → segment）
  for (const s of edges) if (s.parentId && byId.has(s.parentId)) byId.get(s.parentId).childIds.push(s.id);

  const tree = {
    ok: edges.length > 0,
    reason: edges.length ? FLOW_REASON.OK : (connections.length ? FLOW_REASON.NO_DIRECTION : FLOW_REASON.NO_CONNECTION),
    connections, nodes, edges, segments: edges, warnings,
    roots: edges.filter((s) => !s.parentId).map((s) => s.id),
    ms: Date.now() - t0,
  };
  labelSegments(tree);
  tree.stats = treeStats(tree);
  return tree;
}

/**
 * 从某个点沿 d 找一个"切下去正好是单一闭合环"的起点（子段起点用），步长取本环等效半径。
 * 返回的是**该环的形心**而不是探针位置 —— 理由同 detectJunction 里的注释（偏轴起步会被扭向）。
 */
function findCleanStart(mesh, tris, from, d, r, cfg) {
  const h = Math.min(Math.max(r * 0.5, cfg.stepMinMm), cfg.stepMaxMm);
  for (const f of [1, 2, 3.5]) {
    const q = add(from, mul(d, f * h));
    const s = sliceArea(mesh.vertices, mesh.triCount, q, d, 0, tris);
    if (s.loopInfo.length === 1) return s.loopInfo[0].centroid;
  }
  return null;
}

/**
 * 从采样序列里挑出**可以进 headline 的刀**，再算最小 / 最大截面积。
 *
 * 有两类样本必须排除在 headline 之外 —— 它们都会少算面积，留着只会制造一个
 * "看起来精确、实则偏小"的假数字：
 *   ① `terminal` —— 流道到头那一刀切到的是端面倒角，不是流道截面（见 marchSegment 末尾）
 *   ② `confidence === 'low'` —— 截面**不闭合**：环没走完就断了，面积必然被少算
 *      （91.txt §16：截面开放 / 网格质量导致无法形成可靠截面时，不要返回一个看似精确的数字）
 * 两类都**只从 headline 摘出去**：序列里一律保留、并带上标志（不掩盖，只标注）。
 *
 * 导出是为了可测 —— §16 这条规则必须能用合成序列直接验证，而不是"跑个大模型看着差不多"。
 */
export function headlineStats(samples) {
  const valid = samples.filter((s) => s.valid);
  const clean = valid.filter((s) => !s.terminal && s.confidence !== 'low');
  const noTerm = valid.filter((s) => !s.terminal);
  const use = clean.length >= 2 ? clean : (noTerm.length ? noTerm : valid);
  let areaMin = null, areaMinAt = null, minPoint = null;
  let areaMax = null, areaMaxAt = null;
  for (const s of use) {
    if (areaMin == null || s.area < areaMin) { areaMin = s.area; areaMinAt = s.distance; minPoint = s.centroid; }
    if (areaMax == null || s.area > areaMax) { areaMax = s.area; areaMaxAt = s.distance; }
  }
  return {
    areaMin, areaMinAt, minPoint, areaMax, areaMaxAt,
    usedCount: use.length,
    excluded: valid.filter((s) => s.terminal || s.confidence === 'low').length,
  };
}

/** 把 marchSegment 的原始结果整理成 FlowSegment（§八：最小测得截面积 + 位置 + 序列 + 有效采样率） */
function buildSegment(m, meta) {
  const valid = m.samples.filter((s) => s.valid);
  const { areaMin, areaMinAt, minPoint, areaMax, areaMaxAt } = headlineStats(m.samples);
  const sampleCount = m.samples.length;
  const validCount = valid.length;

  const reason = validCount >= 3 ? FLOW_REASON.OK : FLOW_REASON.INSUFFICIENT_SAMPLES;
  return {
    connectionId: meta.connectionId,
    parentId: meta.parentId || null,
    childIds: [],
    // PHASE 92 §三：边的两端是**节点**。startNode / endNode 指向 tree.nodes 里的 id。
    startNode: null, endNode: null, startPoint: null,
    junctionAspect: null, junctionSlabAreaMm2: null, junctionRunMm: null,
    depth: meta.depth,
    // entryKind = 本段是**怎么被生出来的**（loops / junction / null）
    // branchKind = 本段**自己在哪里分出了岔** —— 两者是两回事，别混（踩过一次）
    entryKind: meta.entryKind || null,
    branchKind: null,
    entryPoint: meta.branchPoint || null,
    entryAt: meta.branchAt == null ? null : round2(meta.branchAt),
    branchPoint: null,
    branchAt: null,
    samples: m.samples,
    sampleCount, validCount, invalidCount: sampleCount - validCount,
    validRate: sampleCount ? round2(validCount / sampleCount) : 0,
    // §16：截面不闭合 = 面积被少算，这些刀不进 headline，但要能让用户看见有几刀
    lowConfidenceCount: valid.filter((s) => s.confidence === 'low').length,
    areaMin, areaMinAt, minPoint,
    areaMax, areaMaxAt,
    series: valid.map((s) => s.area),
    path: m.path,
    lengthMm: round2(m.arc),
    endReason: m.endReason,
    usable: validCount >= FLOW_CONFIG.minValidSamples,
    reason,
    jumps: [],
    label: null,
  };
}

/* ============================================================
   六、第四步：截面积突变（90.txt §九）
   ============================================================ */

/**
 * 对 area(distance) 做最朴素的变化检测：前后各取 jumpWindow 个有效样本的中位数，
 * 比值超过 jumpRatio（或低于其倒数）才算一次突变 —— 要求连续几个样本都站在同一侧，
 * 单个噪声点触发不了。没有机器学习，没有黑箱阈值。
 *
 * @returns {Array<{at:number, atMm:number, from:number, to:number, ratio:number, dir:string}>}
 */
export function detectAreaChanges(samples, opts = {}) {
  const cfg = { ...FLOW_CONFIG, ...opts };
  const v = samples.filter((s) => s.valid && s.area > 0);
  const W = cfg.jumpWindow;
  const out = [];
  for (let i = W; i < v.length - W; i++) {
    const beforeWin = v.slice(i - W, i).map((s) => s.area);
    const afterWin = v.slice(i, i + W + 1).map((s) => s.area);
    const before = median(beforeWin);
    const after = median(afterWin);
    if (!(before > 0) || !(after > 0)) continue;
    const ratio = after / before;
    const up = ratio >= cfg.jumpRatio;
    const down = ratio <= 1 / cfg.jumpRatio;
    if (!up && !down) continue;

    // ★ 光看两个小窗口的中位数比值会被**单个噪声点**骗过去：
    //   实测序列 [100,100,100,900,100,100,100,100]，尖峰把只有 2 个样本的前窗中位数
    //   从 100 拽到 500，于是在尖峰右侧比出 0.2，被误判成一次收缩。
    //   所以加一道"两个窗口必须真的分开"的检查：涨的时候后窗最小值要显著高于前窗最大值，
    //   跌的时候反过来。阈值取 √ratio —— 也就是要求分离幅度达到跳变本身的几何平均。
    //   §九 的"考虑连续几个 sample，避免单个噪声点触发"落在这里。
    const sep = Math.sqrt(Math.max(ratio, 1 / ratio));
    if (up) {
      if (Math.min(...afterWin) < Math.max(...beforeWin) * sep) continue;
    } else {
      if (Math.max(...afterWin) > Math.min(...beforeWin) / sep) continue;
    }

    const at = (v[i - 1].distance + v[i].distance) / 2;
    const prev = out[out.length - 1];
    if (prev && at - prev.at <= cfg.jumpMergeSamples * ((v[i].distance - v[i - 1].distance) || 1)) {
      // 相邻检测点并成一个突变，保留比值更大的那个
      if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(prev.ratio))) {
        prev.to = round2(after); prev.ratio = round2(ratio); prev.at = round2(at); prev.dir = up ? 'up' : 'down';
        prev.before = round2(before);
      }
      continue;
    }
    out.push({ at: round2(at), from: round2(before), to: round2(after), before: round2(before), ratio: round2(ratio), dir: up ? 'up' : 'down' });
  }
  return out;
}

/* ============================================================
   七、最后才做工程语义解释（90.txt §十二）
   ============================================================
   靠近 Product 的第一段 → 可能显示"内浇口区域"
   发生明显扩张后的较大通道 → 可能显示"横浇道区域"
   继续向上游的主通道 → 可能显示"直浇道区域"
   几何不支持就写"几何通道" —— 不强行命名（§十二末句）。
   ============================================================ */

export const FLOW_LABEL = {
  INGATE: 'ingate',      // 内浇口区域
  RUNNER: 'runner',      // 横浇道区域
  SPRUE: 'sprue',        // 直浇道区域
  CHANNEL: 'channel',    // 几何通道（不支持命名时的诚实答复）
};

export function labelSegments(tree) {
  const segs = tree.segments;
  if (!segs.length) return;
  const byId = new Map(segs.map((s) => [s.id, s]));

  // 每条路径各自算一遍"进入本段时有没有明显扩张"
  for (const s of segs) {
    s.jumps = detectAreaChanges(s.samples);
    // 突变点要能在 3D 里标出来 → 按弧长在路径上插值出一个 3D 点（§十五）
    for (const j of s.jumps) j.point = pointAtDistance(s, j.at);
    const parent = s.parentId ? byId.get(s.parentId) : null;
    s.entryAreaRatio = null;
    // 交汇处进来的不算扩张：交汇剖面上切到的是横通道的纵剖面（一块板），
    // 拿它当基准比出来的比值没有工艺含义。踩过一次，特此注明。
    if (parent && s.entryKind !== 'junction') {
      const a0 = s.series.length ? s.series[0] : null;
      const a1 = parent.series.length ? parent.series[parent.series.length - 1] : null;
      if (a0 > 0 && a1 > 0) s.entryAreaRatio = round2(a0 / a1);
    }
  }

  let longest = null;
  for (const s of segs) if (!longest || s.lengthMm > longest.lengthMm) longest = s;

  // ★ 只在几何真的支持时才命名（§十二末句）。三条判据都只用了可复核的几何事实：
  //   ① 挨着产品 ② 进来时截面明显扩张 ③ 上游末端的最长主通道
  //   其余一律写"几何通道"—— 宁可少一个标签，也不要一个错的工程结论。
  for (const s of segs) {
    if (s.depth === 0 && segs.length >= 2) { s.label = FLOW_LABEL.INGATE; continue; }
    if (s.entryAreaRatio != null && s.entryAreaRatio >= FLOW_CONFIG.jumpRatio) { s.label = FLOW_LABEL.RUNNER; continue; }
    if (s === longest && s.depth >= 2 && !s.childIds.length) { s.label = FLOW_LABEL.SPRUE; continue; }
    s.label = FLOW_LABEL.CHANNEL;
  }
}

/** 按弧长在有效样本路径上插值出 3D 点（突变位置要在 3D 里标出来） */
function pointAtDistance(seg, d) {
  const v = seg.samples.filter((s) => s.valid && s.centroid);
  if (!v.length) return null;
  if (d <= v[0].distance) return v[0].centroid.slice();
  for (let i = 1; i < v.length; i++) {
    if (d <= v[i].distance) {
      const a = v[i - 1], b = v[i];
      const span = b.distance - a.distance;
      const t = span > 1e-9 ? (d - a.distance) / span : 0;
      return [
        a.centroid[0] + (b.centroid[0] - a.centroid[0]) * t,
        a.centroid[1] + (b.centroid[1] - a.centroid[1]) * t,
        a.centroid[2] + (b.centroid[2] - a.centroid[2]) * t,
      ];
    }
  }
  return v[v.length - 1].centroid.slice();
}

/* ============================================================
   八、汇总（90.txt §十四 结果 UI / §十七 诊断数据）
   ============================================================ */

/** 结果区要显示的那几个数（§十四） */
export function flowSummary(tree) {
  const segs = tree.segments || [];
  const roots = segs.filter((s) => s.depth === 0);
  // ★ 分叉数按"几何上判出了分岔"数（branchKind 有值），
  //   不是按"活下来的子段 ≥ 2"数 —— 后者会让 UI 出现
  //   "这一段写着'在此分出支路'、总览却写'分叉 0'"的自相矛盾。
  const branchPoints = segs.filter((s) => s.branchKind);
  const trunk = segs.find((s) => s.label === FLOW_LABEL.SPRUE) || null;
  const nodes = tree.nodes || [];
  return {
    connectionCount: (tree.connections || []).length,
    startPaths: roots.length,
    branchCount: branchPoints.length,
    segmentCount: segs.length,
    // PHASE 92 §十四：网络口径。交汇数 = 图里的交汇节点数（§十：交汇是一个节点，不是一个"分叉点"）
    nodeCount: nodes.length,
    junctionCount: nodes.filter((n) => n.kind === NODE_KIND.JUNCTION).length,
    terminalCount: nodes.filter((n) => n.kind === NODE_KIND.TERMINAL).length,
    edgeCount: segs.length,
    hasTrunk: !!trunk,
    perConnection: (tree.connections || []).map((c) => {
      const own = segs.filter((s) => s.connectionId === c.id);
      const valid = own.reduce((n, s) => n + s.validCount, 0);
      const total = own.reduce((n, s) => n + s.sampleCount, 0);
      const mins = own.filter((s) => s.areaMin != null).map((s) => s.areaMin);
      return {
        id: c.id, area: c.area, triangleCount: c.triangleCount, gapMm: c.gapMm, dirSource: c.dirSource,
        // PHASE 91 §6：这个口凭什么算连接 —— 穿越面数 / 产品内部面数 / 插入深度，都是可复核的几何事实
        kind: c.kind || null,
        sectionAreaMm2: c.sectionAreaMm2 != null ? c.sectionAreaMm2 : null,
        crossingTriangleCount: c.crossingTriangleCount || 0,
        insideTriangleCount: c.insideTriangleCount || 0,
        depthMm: c.depthMm != null ? c.depthMm : null,
        segmentCount: own.length,
        // PHASE 92：这个口往外一共接出多少段（网络口径），以及有没有接上交汇
        edgeCount: own.length,
        junctionCount: own.filter((s) => s.branchKind).length,
        minArea: mins.length ? Math.min(...mins) : null,
        validCount: valid, sampleCount: total,
      };
    }),
    warnings: tree.warnings || [],
  };
}

/** §十七：开发模式诊断 —— "这个为什么算错了？"要能一眼看到程序看到了什么 */
export function flowDiagnostics(tree) {
  const segs = tree.segments || [];
  let sampleCount = 0, validSampleCount = 0;
  let areaMin = null, areaMax = null;
  const areaChangeLocations = [];
  let branchCount = 0;
  for (const s of segs) {
    sampleCount += s.sampleCount;
    validSampleCount += s.validCount;
    if (s.areaMin != null && (areaMin == null || s.areaMin < areaMin)) areaMin = s.areaMin;
    if (s.areaMax != null && (areaMax == null || s.areaMax > areaMax)) areaMax = s.areaMax;
    if (s.branchKind) branchCount++;
    for (const j of s.jumps) areaChangeLocations.push({ segmentId: s.id, at: j.at, from: j.from, to: j.to, dir: j.dir });
  }
  const nodes = tree.nodes || [];
  return {
    connectionCount: (tree.connections || []).length,
    flowPathCount: segs.filter((s) => s.depth === 0).length,
    branchCount,
    segmentCount: segs.length,
    // PHASE 92 §十四/§十七：网络口径的诊断
    nodeCount: nodes.length,
    junctionCount: nodes.filter((n) => n.kind === NODE_KIND.JUNCTION).length,
    terminalCount: nodes.filter((n) => n.kind === NODE_KIND.TERMINAL).length,
    sampleCount,
    validSampleCount,
    invalidSampleCount: sampleCount - validSampleCount,
    minimumAreaMm2: areaMin,
    maximumAreaMm2: areaMax,
    areaChangeLocations,
    nodes: nodes.map((n) => ({ id: n.id, kind: n.kind, point: n.point, r: n.r, jkind: n.jkind || null, degree: n.edgeIds.length })),
    segments: segs.map((s) => ({
      id: s.id, parentId: s.parentId, connectionId: s.connectionId, depth: s.depth,
      label: s.label, branchKind: s.branchKind, lengthMm: s.lengthMm,
      startNode: s.startNode, endNode: s.endNode,
      sampleCount: s.sampleCount, validCount: s.validCount,
      areaMin: s.areaMin, areaMinAt: s.areaMinAt, areaMax: s.areaMax,
      endReason: s.endReason, usable: s.usable,
    })),
  };
}

function treeStats(tree) {
  const segs = tree.segments || [];
  const d = flowDiagnostics(tree);
  return {
    connectionCount: d.connectionCount,
    segmentCount: d.segmentCount,
    branchCount: d.branchCount,
    nodeCount: d.nodeCount,
    junctionCount: d.junctionCount,
    terminalCount: d.terminalCount,
    sampleCount: d.sampleCount,
    validSampleCount: d.validSampleCount,
    invalidSampleCount: d.invalidSampleCount,
    areaChangeCount: d.areaChangeLocations.length,
  };
}
