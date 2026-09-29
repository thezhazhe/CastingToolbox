// ============================================================
// 单对象几何度量（PHASE 88 · 88.txt §九/§十六/§十七/§十九/§二十）
//
// 职责：给定一份 STL 网格，算出「工艺检验中心」需要的**每一个对象的自身几何量**：
//   体积 / 表面积 / 模数 M=V/A / 包围盒 / 中心 / 主轴 / 主轴垂直截面积剖面
//
// 为什么单开一个模块：
//   · 只依赖 engine/stl.js 的纯函数（computeVolume / computeArea / computeBounds），
//     **不依赖 three.js、不依赖 DOM** → Node 可直接测（88.txt §二十九 测试要求）。
//   · 88.txt §三 冻结 js/engine/ 全部 7 个文件，故新算法放 model 层，引擎目录零改动。
//   · 88.txt §二十八：复用已有 stl.js，不复制一套新的体积/面积实现。
//
// 截面积的诚实边界（这一点必须写清楚，避免被当成"精确值"）：
//   截面积 = 垂直于**某条轴**的平面与网格求交得到的封闭区域面积。
//   "充型方向"对一个孤立的连接体（内浇口/横浇道）在几何上是**不可判定**的——
//   30×6×8 的内浇口与一段 30×6×8 的横浇道是同一个实体。
//   因此本模块：① 默认用体积加权主轴（对细长件 = 长轴，正确）；
//              ② 允许调用方显式指定 x/y/z（axisMode）；
//              ③ 把"用了哪条轴"作为结果的一部分返回，由 UI 如实展示，不隐藏假设。
// ============================================================
import { computeVolume, computeArea, computeBounds } from '../engine/stl.js';

/* ---------- 3×3 对称矩阵 Jacobi 特征分解（主轴用；小矩阵，直接精确解） ---------- */

/**
 * 对称 3×3 特征分解
 * @param {number[]} A 长度 9，行主序
 * @returns {{values:number[], vectors:number[][]}} values 降序；vectors[i] 为第 i 个特征向量
 */
export function jacobiEigen3(A) {
  const a = A.slice();
  let v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep++) {
    // 非对角元平方和 → 足够小即收敛
    const off = a[1] * a[1] + a[2] * a[2] + a[5] * a[5];
    if (off < 1e-24) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-30) continue;
      const app = a[p * 3 + p], aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      // A = Jᵀ A J
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p], akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k], aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p], vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j * 3 + j] - a[i * 3 + i]);   // 特征值降序
  return {
    values: idx.map(i => a[i * 3 + i]),
    vectors: idx.map(i => [v[0 * 3 + i], v[1 * 3 + i], v[2 * 3 + i]]),
  };
}

/**
 * 体积加权主轴（四面体 (0,a,b,c) 二阶矩）。
 * 比"包围盒最长边"更能处理斜置浇道；对轴对齐的等截面柱体两者一致。
 *
 * ★ PHASE 94 修正了一个**潜伏的真 bug**（PHASE 88 起就在，只在"实体不在原点"时暴露）：
 *   原实现取权重 `w = |det| / 6`，注释理由是"容忍网格缠绕方向不一致"。
 *   但散度定理那套四面体求矩的公式，**只有带符号体积才成立**：
 *     · 原点在实体内部（且实体相对原点是星形）时，所有四面体同号，|det| == |有符号| → 碰巧对；
 *     · 原点在实体**外面**时，四面体必然有正有负，|det| 把负的翻成正的 → 二阶矩被"距离原点的远近"污染。
 *   实测（20 个 ⌀12×20 内浇口排成一排，只改位置）：位于原点的那个主轴正确，
 *   其余的主轴被算成横切方向 → 截面积从 113mm² 变成 229mm²（差 2 倍）。
 *   一个浇注系统里的流道几乎不可能都以原点为中心，所以这是必须修的。
 *   |det| 对缠绕方向其实也帮不上忙：方向不一致的三角形无论用哪种权重都会各错 2|V|。
 *   改成有符号后，整体法向朝内（m0 < 0）的网格依然正确 —— 质心与协方差都是 μ1/μ0、M/μ0，符号自动抵消。
 *
 * ★ PHASE 95 修掉第二个问题：**累加原点必须贴近实体本身**（同一个 bug 的另一半）。
 *   散度定理这套四面体求矩，本质是"取一个固定锥顶，把所有三角形锥化成四面体再求和"。
 *   锥顶取世界原点时，单个四面体的 |det| 随"实体离原点的距离"立方级放大，
 *   而它们必须**互相抵消**才能还原出真正的体积与二阶矩 —— 离原点越远抵消越狠，
 *   舍入误差最终吞掉真正的二阶矩，主轴被算歪（→ 垂直于它的截面积跟着失真）。
 *   实测（同一块 20×5×30，只改世界坐标，Σ|w|/|m0| 就是"抵消倍数"）：
 *     原点附近        Σ|w|/|m0| = 1.0   → λ = 73.97 / 33.21 / 2.06   （对）
 *     x+400          Σ|w|/|m0| = 9.9   → λ = 249.56 / 33.16 / 2.07  （λ1 错 3.4 倍）
 *     +400/+300/+200 Σ|w|/|m0| = 54.2  → λ = 314.18 / 36.16 / 10.47 （全错）
 *   截面积的后果：99.92 → 113.40 → 131.85 mm²（同一块几何！）。
 *   锥顶换成包围盒中心后，上面三种位置给出**逐位相同**的结果（λ = 73.89 / 33.22 / 2.06）。
 *   这是纯数值条件数修正：公式一个字没动，对原点附近的实体只差 0.1%（73.97 → 73.89）。
 *
 * @param {number[]} [origin] 累加锥顶（默认取包围盒中心；调用方已有 bounds.center 时直接传入，
 *                            省掉一次 O(N) 扫描）。**不要**传世界原点。
 * @returns {{dir:number[], elongation:number}|null} elongation = λ1/λ2（越接近 1 越接近各向同性）
 */
export function principalAxis(vertices, triCount, origin) {
  const o = origin || bboxCenterOf(vertices, triCount);
  const M = new Float64Array(9);      // Σ v · ∫xxᵀdV
  const m1 = new Float64Array(3);
  const P = new Float64Array(9);      // 循环外分配（大网格 6 万面，避免逐面建数组）
  const s = new Float64Array(3);
  let m0 = 0;
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    // 顶点先减锥顶 → 后面全部在**局部坐标**里累加（见函数头 PHASE 95）
    const ax = vertices[i] - o[0], ay = vertices[i + 1] - o[1], az = vertices[i + 2] - o[2];
    const bx = vertices[i + 3] - o[0], by = vertices[i + 4] - o[1], bz = vertices[i + 5] - o[2];
    const cx = vertices[i + 6] - o[0], cy = vertices[i + 7] - o[1], cz = vertices[i + 8] - o[2];
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const w = det / 6;                // 有符号（见函数头说明），不再取绝对值
    if (w === 0) continue;
    P[0] = ax; P[1] = ay; P[2] = az;
    P[3] = bx; P[4] = by; P[5] = bz;
    P[6] = cx; P[7] = cy; P[8] = cz;
    // 四面体 (o, a, b, c) 的二阶矩：∫x_i x_j dV = (V/20)(Σ_k p_ki p_kj + (Σ_k p_ki)(Σ_l p_lj))
    for (let k = 0; k < 3; k++) s[k] = P[k] + P[3 + k] + P[6 + k];
    m0 += w;
    m1[0] += w * s[0] / 4; m1[1] += w * s[1] / 4; m1[2] += w * s[2] / 4;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        // Σ_k p_ki·p_kj：顶点 0 是原点（贡献 0），只累加 a / b / c 三个顶点
        const acc = P[r] * P[c] + P[3 + r] * P[3 + c] + P[6 + r] * P[6 + c];
        M[r * 3 + c] += w * (acc + s[r] * s[c]) / 20;
      }
    }
  }
  // ⚠ 判空用 |m0|：整体法向朝内的网格 m0 为负，但 μ1/μ0 与 M/μ0 依然给出正确的质心与协方差
  if (!(Math.abs(m0) > 0)) return null;
  // c 是**相对锥顶 o** 的质心 —— 协方差用它做平行轴修正，与绝对坐标无关（PHASE 95）
  const c = [m1[0] / m0, m1[1] / m0, m1[2] / m0];
  // 协方差 = E[xxᵀ] − ccᵀ
  const cov = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let q = 0; q < 3; q++) cov[r * 3 + q] = M[r * 3 + q] / m0 - c[r] * c[q];
  }
  const { values, vectors } = jacobiEigen3(cov);
  const l1 = Math.max(values[0], 0), l2 = Math.max(values[1], 1e-12);
  // values（降序的三个主二阶矩）也返回：PHASE 94 §六 判"平板件方向不可判定"要用到 λ3
  // dirs（PHASE 96 追加，纯 additive）：三条主轴单位向量，降序。
  //   用途只有一个 —— 方向不唯一时（平板件）还要沿**第二条主轴**再切一刀，
  //   把"另一条轴的截面"一并报给用户，让他自己判断方向差多少（96.txt §六/§二十一）。
  return {
    dir: vectors[0], dirs: vectors, elongation: l2 > 1e-12 ? l1 / l2 : Infinity,
    values: values.map((v) => Math.max(v, 0)),
  };
}

/** 顶点的包围盒中心（principalAxis 缺省锥顶；调用方已有 bounds.center 时应直接传，省一次扫描） */
function bboxCenterOf(vertices, triCount) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0, n = triCount * 9; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = vertices[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  }
  if (mn[0] === Infinity) return [0, 0, 0];
  return [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
}

/* ---------- 平面 × 网格 → 截面积 ---------- */

const AXIS_VEC = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** 平面上的一组正交基（给定单位法向） */
function orthoBasis(n) {
  const [nx, ny, nz] = n;
  // 取与 n 最不平行的坐标轴做叉积，数值稳定
  const a = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = a[1] * nz - a[2] * ny, uy = a[2] * nx - a[0] * nz, uz = a[0] * ny - a[1] * nx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  return [[ux, uy, uz], [vx, vy, vz]];
}

/**
 * 单个截面的面积（mm²）
 * 平面 = { p : (p − origin)·axis = offset }
 *
 * @param {ArrayLike<number>} [tris] 可选：只对**这些三角形**切片（局部区域，PHASE 89 §十一/§十二）。
 *   省略 = 对整份网格切片（PHASE 88 原行为，逐字节不变）。
 *   为什么要子集：横浇道与直浇道在交汇处轴向范围重叠，若对整份网格切片，
 *   交汇高度上的截面会把另一条流道也算进来 → 面积虚高。只切本段三角形才得到该流道自身的截面。
 *   代价是子集两端被"剪断"，那里的截面环不闭合 → 由 closed 标志如实拒绝，不猜。
 * @returns {{area:number, loops:number, closed:boolean, centroid:number[]|null,
 *            loopInfo:Array, basis:number[][]}}
 *   closed=false → 存在未闭合环（网格破口/自交/子集被剪断），面积不可信
 *
 * PHASE 90 新增（纯 additive，既有四个字段一个都没动）：
 *   loopInfo —— **仅闭合环**的逐环明细，每个 = {area, centroid:[x,y,z], center2:[u,v], extent:[wu,wv]}
 *     · 用途：PHASE 90 的分叉判据就是"本来 1 个闭合环 → 出现 ≥2 个空间独立的闭合环"（90.txt §十），
 *       以及"截面在平面内被拉长 → 到了交汇处"。这些都需要**逐环**的面积/形心/平面内尺寸，
 *       原先只返回合计面积与加权形心，拿不到。
 *     · ⚠ loopInfo 只含闭合环（有面积、形心可信）；loops 仍按 PHASE 88 语义计**含未闭合环**的总数。
 *       area>0 时二者一致；有破口时 loopInfo.length < loops，调用方应先看 closed。
 *   basis —— 该切面平面内的正交基 [U, V]（3D 单位向量）。
 *     调用方要靠它把"平面内的主伸展方向"还原成 3D 方向（分叉时决定往哪边拐）。
 *
 * PHASE 94 新增（同样是纯 additive，且**默认关闭**）：
 *   opts.withPoly —— 为真时 loopInfo 每一环额外带 `poly`：该环在切面 (U,V) 内的多边形顶点
 *     [[u,v],…]（首尾不重复）。用途只有一个：让 model/sectionShape.js 能**按真实截面形状**
 *     判断圆形 / 矩形 / 梯形 / 不规则（94.txt §五），而不是靠长宽比猜。
 *     默认关闭是因为 flowTrace 每追踪一条流道要切上千刀，多存一份点表纯属浪费。
 */
export function sliceArea(vertices, triCount, origin, axis, offset, tris, opts) {
  const withPoly = !!(opts && opts.withPoly);
  const [U, V] = orthoBasis(axis);
  const proj = (x, y, z) => {
    const dx = x - origin[0], dy = y - origin[1], dz = z - origin[2];
    return [dx * U[0] + dy * U[1] + dz * U[2], dx * V[0] + dy * V[1] + dz * V[2]];
  };
  const segs = [];
  const n = tris ? tris.length : triCount;
  const d = [0, 0, 0];
  const P = new Float64Array(9);
  for (let s = 0; s < n; s++) {
    const i = (tris ? tris[s] : s) * 9;
    for (let k = 0; k < 3; k++) {
      const x = vertices[i + k * 3], y = vertices[i + k * 3 + 1], z = vertices[i + k * 3 + 2];
      P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
      d[k] = (x - origin[0]) * axis[0] + (y - origin[1]) * axis[1] + (z - origin[2]) * axis[2] - offset;
    }
    if ((d[0] > 0 && d[1] > 0 && d[2] > 0) || (d[0] < 0 && d[1] < 0 && d[2] < 0)) continue;
    const pts = [];
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const da = d[a], db = d[b];
      if ((da > 0) === (db > 0)) continue;             // 同号（含 0 归入 ≤0 侧）→ 不过平面
      const s = da / (da - db);
      pts.push(proj(
        P[a * 3] + (P[b * 3] - P[a * 3]) * s,
        P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * s,
        P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * s,
      ));
    }
    if (pts.length === 2) segs.push([pts[0], pts[1]]);
    // pts.length === 3（平面过顶点）或 0（共面）→ 退化，跳过
  }
  if (!segs.length) return { area: 0, loops: 0, closed: true, centroid: null, loopInfo: [], basis: [U, V] };

  // 端点吸附容差：相对截面自身尺度取（避免大件/小件共用一个绝对值）
  let span = 0;
  for (const [p, q] of segs) span = Math.max(span, Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]));
  const tol = Math.max(span * 1e-4, 1e-9);

  // 端点索引（网格哈希 + 9 邻域 + 最近点）
  const cell = tol * 2;
  const grid = new Map();
  const nodes = [];
  const key = (cx, cy) => cx + ',' + cy;
  const findNode = (p) => {
    const cx = Math.round(p[0] / cell), cy = Math.round(p[1] / cell);
    let best = -1, bestD = tol * tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (const ni of bucket) {
          const q = nodes[ni];
          const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
          if (dd < bestD) { bestD = dd; best = ni; }
        }
      }
    }
    if (best >= 0) return best;
    const ni = nodes.length;
    nodes.push(p);
    const k = key(cx, cy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(ni);
    return ni;
  };

  const adj = [];                       // nodeIdx → [{seg, other}]
  const segList = [];
  for (const [p, q] of segs) {
    const ni = findNode(p), nj = findNode(q);
    if (ni === nj) continue;            // 退化为一点
    const si = segList.length;
    segList.push([ni, nj]);
    (adj[ni] || (adj[ni] = [])).push({ si, other: nj });
    (adj[nj] || (adj[nj] = [])).push({ si, other: ni });
  }

  const used = new Uint8Array(segList.length);
  let area = 0, loops = 0, closed = true;
  let cx = 0, cy = 0;                       // 面积加权形心（2D 投影坐标）
  const loopInfo = [];                      // PHASE 90：仅闭合环的逐环明细
  const to3d = (u, v) => [origin[0] + u * U[0] + v * V[0], origin[1] + u * U[1] + v * V[1], origin[2] + u * U[2] + v * V[2]];
  for (let s0 = 0; s0 < segList.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    loops++;
    const startNode = segList[s0][0];
    let cur = segList[s0][1];
    const poly = [nodes[startNode], nodes[cur]];
    let guard = 0;
    while (cur !== startNode && guard++ <= segList.length + 2) {
      const cand = (adj[cur] || []).find(e => !used[e.si]);
      if (!cand) break;
      used[cand.si] = 1;
      cur = cand.other;
      poly.push(nodes[cur]);
    }
    if (cur !== startNode) { closed = false; continue; }   // 未闭合 → 不计入面积
    if (poly.length < 4) continue;
    let a2 = 0, mx = 0, my = 0;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < poly.length - 1; k++) {
      const cr = poly[k][0] * poly[k + 1][1] - poly[k + 1][0] * poly[k][1];
      a2 += cr;
      mx += (poly[k][0] + poly[k + 1][0]) * cr;            // 多边形形心公式（带符号）
      my += (poly[k][1] + poly[k + 1][1]) * cr;
      // 平面内包围盒（PHASE 90：判断截面是不是被横向拉长成了交汇处的板状）
      const px = poly[k][0], py = poly[k][1];
      if (px < u0) u0 = px; if (px > u1) u1 = px;
      if (py < v0) v0 = py; if (py > v1) v1 = py;
    }
    const a = Math.abs(a2) / 2;
    area += a;
    if (a2 !== 0) {
      const lcx = mx / (3 * a2), lcy = my / (3 * a2);
      cx += lcx * a; cy += lcy * a;
      if (a > 0) {
        const info = {
          area: a,
          centroid: to3d(lcx, lcy),
          center2: [(u0 + u1) / 2, (v0 + v1) / 2],
          extent: [u1 - u0, v1 - v0],
        };
        // PHASE 94：按需附上多边形本身（poly[0] 与 poly[last] 是同一点，这里去掉重复的收尾点）
        if (withPoly) info.poly = poly.slice(0, -1).map((p) => [p[0], p[1]]);
        loopInfo.push(info);
      }
    }
  }
  if (area > 0) { cx /= area; cy /= area; }
  // 把 2D 形心还原到 3D（U/V 是平面内的正交基）——调用方用它判断"切面是否落在中轴上"
  const centroid = area > 0 ? to3d(cx, cy) : null;
  return { area, loops, closed, centroid, loopInfo, basis: [U, V] };
}

/**
 * 沿轴取一组截面 → 面积剖面
 * 采样带取中段（两端是与其他几何相接处，截面会畸变）——默认 20%~80%。
 * @param {object} [opts]
 *   samples / bandLo / bandHi 同前
 *   tris 可选：只对**这些三角形**切片（局部区域，PHASE 89）；省略 = 整份网格
 *   withPoly 可选（PHASE 94）：额外返回 `repLoops` = **产出 rep 那一刀**的 loopInfo。
 *     rep 是"中段若干刀的中位面积"，但中位那一刀**是哪一刀**原先没有出口，
 *     于是"截面形状"就只能另切一刀去猜 —— 而形状与面积必须来自同一个截面才对得上。
 * @returns {{rep:number|null, min:number|null, max:number|null, samples:number, usable:boolean,
 *            reason:string, repLoops:Array}}
 */
export function sectionProfile(vertices, triCount, origin, axis, opts = {}) {
  const samples = opts.samples || 21;
  const lo = opts.bandLo ?? 0.2, hi = opts.bandHi ?? 0.8;
  const tris = opts.tris || null;
  const withPoly = !!opts.withPoly;
  const loopsBySlice = [];
  let tmin = Infinity, tmax = -Infinity;
  const n = tris ? tris.length : triCount;
  for (let s = 0; s < n; s++) {
    const i = (tris ? tris[s] : s) * 9;
    for (let k = 0; k < 3; k++) {
      const d = (vertices[i + k * 3] - origin[0]) * axis[0]
        + (vertices[i + k * 3 + 1] - origin[1]) * axis[1]
        + (vertices[i + k * 3 + 2] - origin[2]) * axis[2];
      if (d < tmin) tmin = d;
      if (d > tmax) tmax = d;
    }
  }
  const L = tmax - tmin;
  // ⚠ repLoops 只在 withPoly 时才**存在这个键** —— 默认连字段都不建，
  //   这样调用方一眼能看出"我没要多边形，也就别指望有形状数据"（94-Q 直接断言这条）。
  const out = { rep: null, min: null, max: null, samples: 0, usable: false, reason: '' };
  if (withPoly) out.repLoops = [];
  if (!(L > 0)) { out.reason = 'degenerate'; return out; }
  const areas = [];
  let openSlices = 0, emptySlices = 0;
  for (let k = 0; k < samples; k++) {
    const f = lo + (hi - lo) * (k / (samples - 1));
    const r = sliceArea(vertices, triCount, origin, axis, tmin + L * f, tris, withPoly ? { withPoly: true } : undefined);
    if (!r.closed) openSlices++;
    if (!(r.area > 0)) emptySlices++;
    areas.push(r.area);
    if (withPoly) loopsBySlice.push(r.loopInfo);
  }
  out.samples = samples;
  const good = areas.filter(a => a > 0);
  if (good.length < samples * 0.8) { out.reason = 'empty_slices'; return out; }
  if (openSlices > samples * 0.1) { out.reason = 'open_loops'; return out; }
  const sorted = good.slice().sort((a, b) => a - b);
  out.rep = sorted[Math.floor(sorted.length / 2)];
  out.min = sorted[0];
  out.max = sorted[sorted.length - 1];
  out.usable = true;
  if (withPoly) {
    // rep 就是 areas 里的某一个值（对象引用同一批数字）→ 首个相等的下标即"中位那一刀"
    const k = areas.indexOf(out.rep);
    out.repLoops = k >= 0 ? (loopsBySlice[k] || []) : [];
  }
  return out;
}

/* ---------- 对外主函数 ---------- */

/**
 * 单个对象的全部几何度量
 * @param {{vertices:Float32Array, triCount:number}} mesh  stl.js 解析结果
 * @param {object} [opts]
 *   axisMode: 'principal'（默认）| 'x' | 'y' | 'z' —— 截面积所垂直的轴
 *   withPoly: 额外带上 section.repLoops（产出 rep 那一刀的环 + 多边形），
 *             供 model/sectionShape.js 判断截面形状（PHASE 94 §五）。默认关闭。
 *   altAxis:  额外算一份 sectionAlt = 沿**第二条主轴**的截面剖面（PHASE 96）。
 *             只在"方向不唯一"（平板件）需要给用户看对照值时开——默认关闭。
 * @returns {object} 见文件头注释
 */
export function objectMetrics(mesh, opts = {}) {
  const { vertices, triCount } = mesh;
  const bounds = computeBounds(vertices, triCount);
  const volumeMm3 = computeVolume(vertices, triCount);
  const areaMm2 = computeArea(vertices, triCount);
  const warnings = [];
  if (!(triCount > 0)) warnings.push('no_triangles');
  if (!(volumeMm3 > 0)) warnings.push('zero_volume');
  if (!(areaMm2 > 0)) warnings.push('zero_area');

  const modulusMm = areaMm2 > 0 ? volumeMm3 / areaMm2 : null;

  const axisMode = opts.axisMode || 'principal';
  let axisDir = null, elongation = null, axisValues = null, axisDirs = null;
  // PHASE 97：调用方**直接给一条方向**（内浇口进给方向由连接面确定，见 model/ingateConnection.js）。
  //   纯 additive：不传就完全走原来的主轴/坐标轴两条路，既有调用方行为一字不变。
  const givenDir = Array.isArray(opts.axisDir) && Math.hypot(...opts.axisDir) > 1e-9
    ? opts.axisDir.map((x) => x / Math.hypot(...opts.axisDir)) : null;
  if (givenDir) {
    axisDir = givenDir;
    // 主轴量仍然算出来（elongation / axisValues 是"方向可不可信"的既有判据，不能因为
    //   外部给了方向就少这一层信息；但它们**不参与**这一次的切面方向）
    const pa = principalAxis(vertices, triCount, bounds.center);
    if (pa) { elongation = pa.elongation; axisValues = pa.values; axisDirs = pa.dirs; }
  } else if (axisMode === 'principal') {
    // 锥顶直接用已经算好的 bounds.center（PHASE 95：不要用世界原点，见 principalAxis 函数头）
    const pa = principalAxis(vertices, triCount, bounds.center);
    if (pa) { axisDir = pa.dir; elongation = pa.elongation; axisValues = pa.values; axisDirs = pa.dirs; }
  } else {
    axisDir = AXIS_VEC[axisMode] ? AXIS_VEC[axisMode].slice() : null;
  }
  let axisSource = givenDir ? 'given' : (axisMode === 'principal' ? 'principal' : 'axis');
  // 主轴退化（各向同性/网格无效）→ 回落到包围盒最长边（至少给一个确定方向）
  if (!axisDir) {
    const s = bounds.size;
    const k = s[0] >= s[1] && s[0] >= s[2] ? 0 : (s[1] >= s[2] ? 1 : 2);
    axisDir = [0, 0, 0]; axisDir[k] = 1;
    axisSource = 'fallback';
    warnings.push('axis_fallback_bbox');
  }

  // 沿主轴的**轴向长度**（PHASE 94 §四：浇道单元的"长度/主要尺寸"就是它，不是包围盒对角线）
  let axisLengthMm = null;
  if (axisDir) {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < triCount; t++) {
      const o = t * 9;
      for (let k = 0; k < 3; k++) {
        const d = (vertices[o + k * 3] - bounds.center[0]) * axisDir[0]
          + (vertices[o + k * 3 + 1] - bounds.center[1]) * axisDir[1]
          + (vertices[o + k * 3 + 2] - bounds.center[2]) * axisDir[2];
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    if (hi > lo) axisLengthMm = hi - lo;
  }

  let section = null, sectionAlt = null;
  if (triCount > 0 && volumeMm3 > 0) {
    const prof = sectionProfile(vertices, triCount, bounds.center, axisDir, opts);
    // axisSource（PHASE 97 追加）：这一刀的方向是**谁**给的 ——
    //   'given'（调用方给了连接面方向）/ 'principal'（主轴约定）/ 'axis'（x/y/z）/ 'fallback'
    section = { ...prof, axisMode, axisDir, axisSource };
    if (!prof.usable && prof.reason) warnings.push('section_' + prof.reason);
    // 主轴各向同性 → 截面积含义弱（切哪个方向都差不多），如实标注
    if (section.usable && elongation != null && elongation < 1.15) {
      section.ambiguousAxis = true;
    }
    // PHASE 96（opt-in）：沿**第二条主轴**再切一刀，只给"方向不唯一"时做对照用。
    //   为什么按需：flowTrace 每条流道要切上千刀，多切一刀纯属浪费；
    //   而工艺检测中心一个浇注系统也就十几个单元，切开是毫秒级。
    //   为什么需要：方向不唯一时主轴那一刀是**约定**（取最长方向），
    //   用户有权知道换一条轴面积会差多少 —— 差多少要拿真实测量说话，不能凭比例估。
    if (opts.altAxis && axisDirs && axisDirs.length >= 2 && axisValues && axisValues[1] > 0) {
      const alt = sectionProfile(vertices, triCount, bounds.center, axisDirs[1], opts);
      sectionAlt = { ...alt, axisDir: axisDirs[1] };
    }
  }

  return {
    volumeMm3, areaMm2, modulusMm,
    size: bounds.size, min: bounds.min, max: bounds.max, center: bounds.center,
    diagonal: bounds.diagonal,
    triCount,
    axisDir, elongation,
    axisValues,            // PHASE 94：三个主二阶矩（降序）；判"平板件方向不可判定"要用 λ3
    axisLengthMm,          // PHASE 94：沿 axisDir 的轴向长度（"长度/主要尺寸"用的就是它）
    section,
    sectionAlt,            // PHASE 96：沿线 2 主轴的截面（仅 opts.altAxis 时非 null）
    warnings,
  };
}

/** 显示用：主轴方向的最接近坐标轴标签（'X' / 'Y' / 'Z'） */
export function axisLabel(dir) {
  if (!dir) return '—';
  const a = [Math.abs(dir[0]), Math.abs(dir[1]), Math.abs(dir[2])];
  const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : (a[1] >= a[2] ? 1 : 2);
  return ['X', 'Y', 'Z'][k];
}
