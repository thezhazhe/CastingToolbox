// ============================================================
// 内浇口进给方向 · 连接面识别（PHASE 97 · 97.txt §三~§十）
//
// 解决什么问题（97.txt §三）：
//   一个 20×5×12 的内浇口，**只看它自己**是无法判断"20×5 还是 20×12 才是有效进给截面"的
//   —— 两个都是真实的闭合截面。PHASE 96 只能退回"垂直于最长主轴"这个**约定**，
//   对短宽内浇口会切错方向（实测 20×5×12 → 60mm²，应为 100mm²）。
//   本模块用一条**不靠猜**的新信息：内浇口与产品/横浇道之间**真实存在的连接关系**。
//
// ★ 核心原则（97.txt §十四 末）：少加算法、优先真实几何关系、无法确定就说不确定。
//   所以本模块只做一件事：找出连接面 → 给出方向 → 其余照旧交给 PHASE 96 已验证的截面机制。
//
// ★ 连接区域的定义（97.txt §五，逐字要求，不许简化成"最近的一个三角形"）：
//     多个相邻三角形  +  距离相邻对象足够近  +  连成一片  ⇒  连接候选区域
//   实现：① 逐三角形质心到目标网格求距，≤ tol 的记为"近"；
//         ② 近三角形按**共享顶点**并查集聚成区域（直接复用 meshComponents.triangleComponents，
//            不新写一套焊接/邻接）；
//         ③ 取面积最大的那块 = 连接区域。
//
// ★ 只输出三个量（97.txt §六：第一版到此为止，不要 AI/曲率/网格重构/多轮搜索）：
//     connectionNormal / connectionArea / connectionCenter
//
// ★★ connectionArea ≠ effectiveArea（97.txt §九，重要）：
//   连接面识别的作用**只是确定进给方向**。面积仍然由"垂直于该方向的闭合截面"实测得到
//   （复用 PHASE 96 那套已验证的测量机制），绝不允许拿 connectionArea 直接当有效截面积。
//
// 纯函数：不碰 DOM / three.js，只依赖 meshDistance 与 meshComponents 两个既有通用工具。
// ============================================================
import { buildTriGrid, distanceToMesh, pointBoxDist } from './meshDistance.js';
import { meshSubset, triangleComponents, meshDiagonal } from './meshComponents.js';

/* ---------------- 阈值（集中在这里，改口径只改这一处） ---------------- */

/**
 * 「算贴上了」的距离阈值 = max(绝对值, 相对内浇口尺度)。
 *
 * 为什么要有绝对值下限：两个实体在 CAD 里**本来是贴死**的，但各自独立面片化之后，
 * 交界处的表面会差出**网格步长量级**的缝（MC 生成与 CAD 导出都一样）。
 * 步长大的粗网格（例如产品 250mm 包络 / 96 分辨率 → 步长 2.6mm）缝就能到 1~2mm，
 * 阈值取 1mm 会把**真实连接**判成没接上（浏览器实测踩到过：产品在 res=96/包络 251mm 下
 * 顶面落在 y ∈ ±1.3mm，内浇口底面在 y≈0，缝隙 1.3mm > 1.0mm → 判不出方向）。
 * 取 2mm：既盖得住粗网格的离散，又远小于任何真实的浇道间隙（那至少是一个浇口厚度的量级）。
 * 为什么还要有相对上限：大内浇口（几十上百 mm）配固定 2mm 太苛刻 ——
 * 铸件越大，导出公差与网格步长越大，用自身尺度的一个小比例更合理。
 *
 * ⚠ 这两个数是**工程约定**，不是标准值；phase97 的测试盯住它们的**后果**
 *   （判错方向 vs 判不出方向），改它们必须重跑 phase97 与 browser_inspection_test。
 */
export const CONN_TOL_ABS = 2.0;     // mm
export const CONN_TOL_REL = 0.02;    // × 内浇口包围盒对角线

/** 两端连接方向"基本反向"的判据：夹角 > 150°（即 dot < -cos30°）才算共线反向。 */
export const ANTI_PARALLEL_DEG = 30;

/** 方向是怎么定出来的（97.txt §八 的三级置信） */
export const DIR_CONF = {
  CONFIRMED: 'confirmed',   // 两端都找到且方向关系合理 → directionSource = connection
  INFERRED: 'inferred',     // 只找到一端，但几何关系足够明确 → directionSource = product-/runner-connection
  UNCERTAIN: 'uncertain',   // 没有可靠连接区域 → 完全退回 PHASE 96 主轴约定
};

/** directionSource 的值（给 UI 显示"方向是怎么来的"） */
export const DIR_SOURCE = {
  CONNECTION: 'connection',
  PRODUCT_CONNECTION: 'product-connection',
  RUNNER_CONNECTION: 'runner-connection',
  PRINCIPAL: 'principal',
};

/** 目标对象的角色（97.txt §五：优先 product，其次 runner / sprue / feeder / 冒口） */
export const DIR_ROLE = { PRODUCT: 'product', RUNNER: 'runner', SPRUE: 'sprue', RISER: 'riser' };

/** 距离阈值（对内浇口自身的尺度取相对量，避免大件小件共用一个绝对值） */
export function connectionTolerance(ingateMesh) {
  const diag = meshDiagonal(ingateMesh.vertices, ingateMesh.triCount);
  return Math.max(CONN_TOL_ABS, CONN_TOL_REL * diag);
}

/* ---------------- 基础几何 ---------------- */

/** 三角形的面积与**单位**法向（退化面返回 null） */
function triAreaNormal(v, t) {
  const o = t * 9;
  const ax = v[o], ay = v[o + 1], az = v[o + 2];
  const e1x = v[o + 3] - ax, e1y = v[o + 4] - ay, e1z = v[o + 5] - az;
  const e2x = v[o + 6] - ax, e2y = v[o + 7] - ay, e2z = v[o + 8] - az;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 1e-12)) return null;          // 零面积三角形：不参与（与 meshComponents 的退化口径一致）
  return { area: len / 2, n: [nx / len, ny / len, nz / len] };
}

/** 面积加权质心（三角形形心） */
function triCentroid(v, t) {
  const o = t * 9;
  return [
    (v[o] + v[o + 3] + v[o + 6]) / 3,
    (v[o + 1] + v[o + 4] + v[o + 7]) / 3,
    (v[o + 2] + v[o + 5] + v[o + 8]) / 3,
  ];
}

/* ---------------- 连接区域 ---------------- */

/**
 * 在 ingateMesh 上找出与 otherMesh **相连**的那片三角面区域（97.txt §五）。
 *
 * @param {{vertices:Float32Array, triCount:number}} ingateMesh 内浇口（单个组件）
 * @param {{grid:Map, cell:number, key:Function, always:Array, bb:object}} gridInfo otherMesh 的空间哈希
 * @param {{vertices:Float32Array, triCount:number}} otherMesh 目标网格（产品 / 横浇道 / …）
 * @param {number} tol 距离阈值（mm）
 * @returns {{normal:number[], area:number, center:number[], triCount:number,
 *            triIndices:number[]}|null}
 *   normal —— 连接区域的平均法向，方向已统一为"**从内浇口指向外部**"（见下）
 *   area   —— 该区域的**网格面积**（Σ 三角形面积，不是投影面积）
 *   null   —— 一个近三角形都没有（没接上）
 */
export function findConnectionRegion(ingateMesh, gridInfo, otherMesh, tol) {
  const v = ingateMesh.vertices;
  const near = [];
  for (let t = 0; t < ingateMesh.triCount; t++) {
    const c = triCentroid(v, t);
    // ★ 先用包围盒距离做**精确预筛**（PHASE 97 实测的性能要害）：
    //   pointBoxDist 是"点到网格真距离"的下界，超过 tol 的三角形**必然**不在连接区，
    //   直接跳过，结果与逐个精算完全一致（不是近似）。
    //   为什么必须有这一步：实测一个 20×12×5 的内浇口在 res=96 下就有 5.1 万个三角形，
    //   逐个精算要 31 秒（每次查询最坏要扫 ~3000 个空间格）；
    //   加了包围盒预筛之后只剩贴在产品附近的那一小撮要精算。
    if (pointBoxDist(c, gridInfo.bb) > tol) continue;
    if (distanceToMesh(gridInfo, otherMesh, c) <= tol) near.push(t);
  }
  if (!near.length) return null;

  // 近三角形按**共享顶点**聚成连成一片的区域 —— 复用既有的焊接 + 并查集
  const sub = meshSubset(ingateMesh, near);
  const cc = triangleComponents(sub);
  let best = null;
  for (const comp of cc.components) {
    if (comp.triCount < 1) continue;
    // comp.tris 是**子网格**里的下标 → 映射回原网格
    let area = 0;
    const cx = [0, 0, 0];
    const nAcc = [0, 0, 0];
    for (const st of comp.tris) {
      const t = near[st];
      const an = triAreaNormal(v, t);
      if (!an) continue;
      area += an.area;
      const c = triCentroid(v, t);
      for (let k = 0; k < 3; k++) { cx[k] += c[k] * an.area; nAcc[k] += an.n[k] * an.area; }
    }
    if (!(area > 0)) continue;
    if (!best || area > best.area) best = { area, cx: cx.map((s) => s / area), nAcc, tris: comp.tris.map((st) => near[st]) };
  }
  if (!best) return null;

  const nl = Math.hypot(...best.nAcc);
  if (!(nl > 1e-12)) return null;
  let n = best.nAcc.map((x) => x / nl);

  // ★ 方向统一：法向必须**从内浇口指向外部**。
  //   不依赖面片缠绕方向（CAD 导出与 MC 生成都可能不一致，meshComponents 也只把缠绕
  //   当成"提示"而不是判据）；用"区域中心相对内浇口质心"这个纯几何事实定方向。
  //   ⚠ 质心直接在原网格上算，**不要**为了取质心先 meshSubset 复制一份整网格
  //     （那是 O(9N) 的无谓拷贝，实测是这条链上最大的浪费之一）。
  const center = best.cx;
  const ic = centroidOf(ingateMesh);
  const outward = [center[0] - ic[0], center[1] - ic[1], center[2] - ic[2]];
  if (outward[0] * n[0] + outward[1] * n[1] + outward[2] * n[2] < 0) n = n.map((x) => -x);

  return { normal: n, area: best.area, center, triCount: best.tris.length, triIndices: best.tris };
}

/** 网格质心（面积加权；退化面不参与） */
function centroidOf(mesh) {
  const v = mesh.vertices;
  let a = 0; const c = [0, 0, 0];
  for (let t = 0; t < mesh.triCount; t++) {
    const an = triAreaNormal(v, t);
    if (!an) continue;
    const p = triCentroid(v, t);
    for (let k = 0; k < 3; k++) c[k] += p[k] * an.area;
    a += an.area;
  }
  return a > 0 ? c.map((x) => x / a) : [0, 0, 0];
}

/* ---------------- 主入口 ---------------- */

/**
 * 给一个内浇口单元定"进给方向"（97.txt §七/§八/§十）。
 *
 * @param {object} o
 *   ingateMesh  内浇口单个组件的网格
 *   targets     [{role, mesh, grid}] —— 目标网格及其预建空间哈希（同一次调用里共享，别重复建）
 *   ingateCenter 可选：内浇口包围盒中心（用于"两端要分开"的合理性检查）
 * @returns {{
 *   direction:number[]|null, confidence:string, source:string,
 *   normal:number[]|null, areaMm2:number|null, center:number[]|null,
 *   product:object|null, runner:object|null, reason:string|null
 * }}
 *   direction —— **进给方向**（金属从内浇口流向铸件的方向）；confidence=UNCERTAIN 时为 null
 *   normal    —— 连接面法向（= direction，产品端时两者相同；仅横浇道端时方向相反）
 *   areaMm2   —— **连接面的网格面积**（仅供 UI 参考；**不是**有效截面积，见 §九）
 */
export function resolveIngateDirection({ ingateMesh, targets = [] } = {}) {
  const none = { direction: null, confidence: DIR_CONF.UNCERTAIN, source: DIR_SOURCE.PRINCIPAL, normal: null, areaMm2: null, center: null, product: null, runner: null, reason: 'no_connection' };
  if (!ingateMesh || !ingateMesh.triCount) return none;
  const tol = connectionTolerance(ingateMesh);

  /** 在指定角色里找连接区域；返回 {role, region} 或 null（**哪个角色命中的要如实带出去**） */
  const pick = (role) => {
    const t = targets.find((x) => x && x.role === role && x.mesh && x.mesh.triCount > 0 && x.grid);
    if (!t) return null;
    const region = findConnectionRegion(ingateMesh, t.grid, t.mesh, tol);
    return region ? { role, region } : null;
  };
  // 上游端按 §五 的顺序找：横浇道 → 直浇道 → 冒口/帽口
  const pickUpstream = () => pick(DIR_ROLE.RUNNER) || pick(DIR_ROLE.SPRUE) || pick(DIR_ROLE.RISER);

  const p = pick(DIR_ROLE.PRODUCT);
  const u = pickUpstream();
  const product = p ? p.region : null;
  const runner = u ? u.region : null;
  const runnerRole = u ? u.role : null;

  // ---- 两端都找到：检查是否基本共线反向（97.txt §十）----
  if (product && runner) {
    const dot = product.normal[0] * runner.normal[0] + product.normal[1] * runner.normal[1] + product.normal[2] * runner.normal[2];
    const anti = dot <= -Math.cos((ANTI_PARALLEL_DEG * Math.PI) / 180);
    // 两个连接区域还得**确实分开**（贴在一起说明这一端被算了两次，不足以判方向）
    const sep = Math.hypot(product.center[0] - runner.center[0], product.center[1] - runner.center[1], product.center[2] - runner.center[2]);
    const diag = meshDiagonal(ingateMesh.vertices, ingateMesh.triCount);
    if (anti && sep > diag * 0.2) {
      return {
        direction: product.normal, confidence: DIR_CONF.CONFIRMED, source: DIR_SOURCE.CONNECTION,
        normal: product.normal, areaMm2: product.area, center: product.center,
        product, runner, runnerRole, reason: null,
      };
    }
    // 明显不一致 → **不要强行使用连接方向**（§十）
    return { ...none, product, runner, runnerRole, reason: anti ? 'ends_too_close' : 'ends_not_opposite' };
  }

  // ---- 只找到产品端：几何关系明确，允许继续（§八 INFERRED）----
  if (product) {
    return {
      direction: product.normal, confidence: DIR_CONF.INFERRED, source: DIR_SOURCE.PRODUCT_CONNECTION,
      normal: product.normal, areaMm2: product.area, center: product.center,
      product, runner: null, reason: null,
    };
  }

  // ---- 只找到浇注系统端：方向要**反过来**（外法向指向横浇道，而进给方向是朝铸件）----
  if (runner) {
    return {
      direction: runner.normal.map((x) => -x), confidence: DIR_CONF.INFERRED,
      source: DIR_SOURCE.RUNNER_CONNECTION,
      normal: runner.normal, areaMm2: runner.area, center: runner.center,
      product: null, runner, runnerRole, reason: null,
    };
  }

  return none;
}
