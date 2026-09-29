// ============================================================
// 网格连通分量拆分（PHASE 89 · 89.txt §二/§三/§四）
//
// 职责：把一份 STL 三角汤拆成若干**独立的连通实体**，并判断每个实体是否闭合。
//
// 为什么必须新写（89.txt §一 要求先查证，这里是查证结论）：
//   全库原先**没有任何三角形层面的连通性分析**。engine/hotspot.js 里的
//   connectedComponents 是**体素网格**上的 6 邻域 BFS，跟网格拓扑是两回事。
//   parseSTL 产出的是**非索引三角汤**（每三角 9 个 float，顶点重复存储），
//   也没有邻接表 —— 所以邻接必须先做**顶点焊接**。
//
// 为什么按"共享边"而不是"共享顶点"判连通：
//   两个实体只在一点相触（点接触）是常见几何（如浇道末端与铸件相切）。
//   按共享顶点会把它俩并成一个实体；按共享整条边则正确保持独立。
//
// 冻结（89.txt §十九）：本模块属 js/model/，js/engine/ 零改动。
// 纯函数、不依赖 three.js / DOM → Node 可直接测（89.txt §十八 数值测试）。
// ============================================================

/**
 * 顶点焊接：把非索引三角汤里的重复顶点合并成唯一节点。
 *
 * 实现：空间哈希（cell = 容差），先查本格，再查 27 邻域。
 *   · 位精确重复的顶点（STL 导出的常态）在**第一次探测**就命中 → 快路径
 *   · 容差边界附近的顶点由 27 邻域兜住 → 正确性不依赖"是否恰好同格"
 *
 * @param {Float32Array} vertices 每三角 9 个 float
 * @param {number} triCount
 * @param {number} tol 焊接容差（mm），应远小于任何真实特征尺寸
 * @returns {{vid:Int32Array, nodes:Float64Array, nodeCount:number, tol:number}}
 */
export function weldVertices(vertices, triCount, tol) {
  const cells = new Map();          // 量化格 "cx,cy,cz" → 节点号数组
  const nodeX = [], nodeY = [], nodeZ = [];
  const vid = new Int32Array(triCount * 3);
  const cell = Math.max(tol, 1e-12);
  const q = (v) => Math.round(v / cell);

  /** 在 (cx,cy,cz) 格内找与 (x,y,z) 距离 ≤ tol 的节点；找不到返回 -1 */
  const probe = (cx, cy, cz, x, y, z) => {
    const bucket = cells.get(cx + ',' + cy + ',' + cz);
    if (!bucket) return -1;
    let best = -1, bestD = tol * tol;
    for (let i = 0; i < bucket.length; i++) {
      const n = bucket[i];
      const dx = nodeX[n] - x, dy = nodeY[n] - y, dz = nodeZ[n] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d <= bestD) { bestD = d; best = n; }
    }
    return best;
  };

  let ci = 0;
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const x = vertices[ci], y = vertices[ci + 1], z = vertices[ci + 2];
      ci += 3;
      const cx = q(x), cy = q(y), cz = q(z);
      let node = probe(cx, cy, cz, x, y, z);         // 快路径：本格命中（位精确重复）
      if (node < 0) {
        for (let dx = -1; dx <= 1 && node < 0; dx++) {       // 慢路径：27 邻域
          for (let dy = -1; dy <= 1 && node < 0; dy++) {
            for (let dz = -1; dz <= 1 && node < 0; dz++) {
              if (dx === 0 && dy === 0 && dz === 0) continue;
              node = probe(cx + dx, cy + dy, cz + dz, x, y, z);
            }
          }
        }
      }
      if (node < 0) {
        node = nodeX.length;
        nodeX.push(x); nodeY.push(y); nodeZ.push(z);
        const key = cx + ',' + cy + ',' + cz;
        const b = cells.get(key);
        if (b) b.push(node); else cells.set(key, [node]);
      }
      vid[t * 3 + k] = node;
    }
  }

  const nodes = new Float64Array(nodeX.length * 3);
  for (let i = 0; i < nodeX.length; i++) {
    nodes[i * 3] = nodeX[i]; nodes[i * 3 + 1] = nodeY[i]; nodes[i * 3 + 2] = nodeZ[i];
  }
  return { vid, nodes, nodeCount: nodeX.length, tol };
}

/** 网格包围盒对角线（焊接容差的相对尺度基准） */
export function meshDiagonal(vertices, triCount) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0, n = triCount * 9; i < n; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
  }
  return Math.hypot(mxx - mnx, mxy - mny, mxz - mnz);
}

/** 焊接容差：相对件尺寸，避免大件/小件共用一个绝对值 */
export const weldTolerance = (diagonal) => Math.max(diagonal * 1e-6, 1e-9);

/**
 * 三角形连通分量（按**共享边**并查集）。
 *
 * 实现要点：只遍历一遍三角形，把所有"共享同一条焊接边"的三角形记在一张表里。
 *   这张表**同时**承担三件事：
 *     ① 并查集合并（连通分量）
 *     ② 三角形对偶图邻接（测地追踪要用）
 *     ③ 边的多重数 → 边界边 / 非流形边 / 缠绕方向不一致
 *   避免了对同一条边反复扫描。
 *
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {{tol?:number}} [opts]
 * @returns {{weld, triToComp, components, adj, diagonal}}
 *   components[i] = { index, tris:Int32Array, triCount, closed, boundaryEdges,
 *                     badWindingEdges, nonManifoldEdges, volumeMm3, areaMm2, bounds }
 *   adj = 三角形对偶图 CSR（{start, nbr}）
 */
export function triangleComponents(mesh, opts = {}) {
  const { vertices, triCount } = mesh;
  const diagonal = meshDiagonal(vertices, triCount);
  const tol = opts.tol ?? weldTolerance(diagonal);
  const weld = weldVertices(vertices, triCount, tol);
  const { vid, nodeCount } = weld;

  if (triCount === 0) {
    return {
      weld, triToComp: new Int32Array(0), components: [],
      adj: { start: new Int32Array(1), nbr: new Int32Array(0) }, diagonal,
    };
  }

  /* ---- 零面积三角形剔除（必须在连通分析**之前**） ----
     为什么必须剔除：零面积三角形不携带任何几何（体积、面积都是 0），
     但它会在边图上凭空造出连接或成为孤立碎片。实测：某 STL 的 44784 个三角形里
     有 14144 个面积恰为 0（等值面正好穿过网格点时的退化产物），
     不剔除会把 2 个实体拆成 **6722** 个分量 —— 一个看似精确、实则毫无意义的数字。
     判据取 (焊接容差)²：小于此的三角形低于网格分辨率，只有真正的退化面会被剔除，
     正常细长面（面积远大于此）一律保留。 */
  const areaEps = tol * tol;
  const degenerate = new Uint8Array(triCount);
  let degenerateTris = 0;
  for (let t = 0; t < triCount; t++) {
    const a = vid[t * 3], b = vid[t * 3 + 1], c = vid[t * 3 + 2];
    let zero = (a === b && b === c);                 // 三角点焊成一点
    if (!zero) {
      const o = t * 9;
      const ux = vertices[o + 3] - vertices[o], uy = vertices[o + 4] - vertices[o + 1], uz = vertices[o + 5] - vertices[o + 2];
      const vx = vertices[o + 6] - vertices[o], vy = vertices[o + 7] - vertices[o + 1], vz = vertices[o + 8] - vertices[o + 2];
      zero = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 <= areaEps;
    }
    if (zero) { degenerate[t] = 1; degenerateTris++; }
  }

  /* ---- 并查集 ---- */
  const parent = new Int32Array(triCount);
  for (let i = 0; i < triCount; i++) parent[i] = i;
  const find = (x) => { let r = x; while (parent[r] !== r) r = parent[r]; while (parent[x] !== r) { const n = parent[x]; parent[x] = r; x = n; } return r; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  /* ---- 单遍扫边：键 = min*K+max（数字键比字符串快得多；K=nodeCount+1，K² 远小于 2^53） ---- */
  const K = nodeCount + 1;
  const edgeTris = new Map();        // 无向边键 → 拥有它的三角形号数组
  for (let t = 0; t < triCount; t++) {
    if (degenerate[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = vid[t * 3 + k], b = vid[t * 3 + ((k + 1) % 3)];
      if (a === b) continue;                       // 退化边（焊接后塌成一点）
      const key = a < b ? a * K + b : b * K + a;
      const list = edgeTris.get(key);
      if (!list) { edgeTris.set(key, [t]); continue; }
      /* ⚠ 同一个三角形可能**两次**落到同一条边上：顶点焊接把它的两个角点并成了同一个节点时，
         另外两条边 (a,b) 与 (b,a) 归一化后是同一个 key。若不去重，这条边的"两个三角形"
         会是同一个 t —— 缠绕方向检查于是拿它和自己比，必然判成"方向不一致"。
         实测：一个普通立方体因此报出 750 条假的方向不一致边，component.closed 全变 false，
         体积被整体丢弃。按扫描顺序去重即可（重复项必然相邻）。 */
      if (list[list.length - 1] === t) continue;
      list.push(t);
    }
  }

  /* ---- 边表 → 连通分量 + 邻接 + 缺陷计数 ---- */
  const MAX_NBR = 6;                 // 非流形边上可能挂很多三角形，邻居数封顶防爆炸
  const nbrOf = new Array(triCount); // 三角形 → 邻居号数组（延迟建）
  const boundaryOf = new Int32Array(triCount);    // 该三角形的边界边数
  const badWindOf = new Int32Array(triCount);
  const nonManifOf = new Int32Array(triCount);

  for (const [key, list] of edgeTris) {
    const n = list.length;
    if (n >= 2) for (let i = 1; i < n; i++) union(list[0], list[i]);
    if (n === 1) { boundaryOf[list[0]]++; continue; }
    if (n > 2) for (const t of list) nonManifOf[t] += n - 2;
    // 缠绕方向：同一条边被两个三角形以**相同**方向走过 → 法向不一致
    if (n === 2) {
      const a = Math.floor(key / K), b = key - a * K;
      const fwd = (t) => {
        for (let k = 0; k < 3; k++) if (vid[t * 3 + k] === a && vid[t * 3 + ((k + 1) % 3)] === b) return true;
        return false;
      };
      if (fwd(list[0]) === fwd(list[1])) { badWindOf[list[0]]++; badWindOf[list[1]]++; }
    }
    // 邻接（邻居上限，取前 MAX_NBR 个）
    for (let i = 0; i < n; i++) {
      const t = list[i];
      let nb = nbrOf[t];
      if (!nb) { nb = []; nbrOf[t] = nb; }
      let added = 0;
      for (let j = 0; j < n && added < MAX_NBR; j++) {
        const o = list[j];
        if (o === t) continue;
        if (nb.length >= MAX_NBR) break;
        nb.push(o); added++;
      }
    }
  }

  /* ---- 归组（零面积三角形不进任何分量，triToComp 记 -1） ---- */
  const triToComp = new Int32Array(triCount).fill(-1);
  const rootToComp = new Map();
  const compTris = [];
  for (let t = 0; t < triCount; t++) {
    if (degenerate[t]) continue;
    const r = find(t);
    let ci = rootToComp.get(r);
    if (ci === undefined) { ci = compTris.length; rootToComp.set(r, ci); compTris.push([]); }
    compTris[ci].push(t);
  }

  const components = compTris.map((tris, ci) => {
    const arr = Int32Array.from(tris);
    let vol = 0, area = 0;
    let boundaryEdges = 0, badWindingEdges = 0, nonManifoldEdges = 0;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const t of arr) {
      triToComp[t] = ci;
      boundaryEdges += boundaryOf[t];
      badWindingEdges += badWindOf[t];
      nonManifoldEdges += nonManifOf[t];
      const i = t * 9;
      const x0 = vertices[i], y0 = vertices[i + 1], z0 = vertices[i + 2];
      const x1 = vertices[i + 3], y1 = vertices[i + 4], z1 = vertices[i + 5];
      const x2 = vertices[i + 6], y2 = vertices[i + 7], z2 = vertices[i + 8];
      vol += x0 * (y1 * z2 - y2 * z1) + x1 * (y2 * z0 - y0 * z2) + x2 * (y0 * z1 - y1 * z0);
      const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
      const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
      const cxx = ay * bz - az * by, cyy = az * bx - ax * bz, czz = ax * by - ay * bx;
      area += Math.sqrt(cxx * cxx + cyy * cyy + czz * czz) / 2;
      if (x0 < mn[0]) mn[0] = x0; if (x0 > mx[0]) mx[0] = x0;
      if (y0 < mn[1]) mn[1] = y0; if (y0 > mx[1]) mx[1] = y0;
      if (z0 < mn[2]) mn[2] = z0; if (z0 > mx[2]) mx[2] = z0;
      if (x1 < mn[0]) mn[0] = x1; if (x1 > mx[0]) mx[0] = x1;
      if (y1 < mn[1]) mn[1] = y1; if (y1 > mx[1]) mx[1] = y1;
      if (z1 < mn[2]) mn[2] = z1; if (z1 > mx[2]) mx[2] = z1;
      if (x2 < mn[0]) mn[0] = x2; if (x2 > mx[0]) mx[0] = x2;
      if (y2 < mn[1]) mn[1] = y2; if (y2 > mx[1]) mx[1] = y2;
      if (z2 < mn[2]) mn[2] = z2; if (z2 > mx[2]) mx[2] = z2;
    }
    const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    return {
      index: ci,
      tris: arr,
      triCount: arr.length,
      /* 89.txt §二「组件不是 closed mesh 就不得假装得到可靠体积」——
         "closed" 的工程含义是**水密**（没有洞），也就是 boundaryEdges === 0。
         缠绕方向不一致（badWindingEdges）是另一回事：它不让形状失去定义，
         只让**有符号体积**产生小偏差，而且这个偏差**可能把误差抵消掉**，
         所以它是一条质量提示，不是"体积不可信"的判决。
         实测：一个 100³ 立方体有 750 条方向不一致边（占 16.8 万条的 0.45%），
         体积仍然是 998.96（真值 1000，差 0.1%）。
         若把两者混为一谈，会把大量正常网格判成"不可靠"并整块丢掉体积。 */
      closed: boundaryEdges === 0,
      windingConsistent: badWindingEdges === 0,
      boundaryEdges,
      badWindingEdges,
      nonManifoldEdges,
      volumeMm3: Math.abs(vol) / 6,
      signedVolumeMm3: vol / 6,
      areaMm2: area,
      bounds: {
        min: mn, max: mx, size,
        center: [mn[0] + size[0] / 2, mn[1] + size[1] / 2, mn[2] + size[2] / 2],
        diagonal: Math.hypot(size[0], size[1], size[2]),
      },
    };
  });

  /* ---- CSR 邻接表 ---- */
  const start = new Int32Array(triCount + 1);
  let total = 0;
  for (let t = 0; t < triCount; t++) { start[t + 1] = start[t] + (nbrOf[t] ? nbrOf[t].length : 0); total = start[t + 1]; }
  const nbr = new Int32Array(total);
  for (let t = 0; t < triCount; t++) {
    const l = nbrOf[t];
    if (!l) continue;
    for (let i = 0; i < l.length; i++) nbr[start[t] + i] = l[i];
  }

  return { weld, triToComp, components, adj: { start, nbr }, diagonal, degenerateTris, tol };
}

/**
 * 抽取三角形子集为新 mesh（供 objectMetrics 在局部区域上算截面）。
 * @param {{vertices:Float32Array, triCount:number}} mesh
 * @param {ArrayLike<number>} tris 三角形号列表
 * @returns {{vertices:Float32Array, triCount:number}}
 */
export function meshSubset(mesh, tris) {
  const n = tris.length;
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const t = tris[i];
    for (let k = 0; k < 9; k++) out[i * 9 + k] = mesh.vertices[t * 9 + k];
  }
  return { vertices: out, triCount: n };
}

/** 三角形子集的重心（面积加权；退化面权重为 0） */
export function subsetCentroid(mesh, tris) {
  let sx = 0, sy = 0, sz = 0, sw = 0;
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    const ax = mesh.vertices[o], ay = mesh.vertices[o + 1], az = mesh.vertices[o + 2];
    const bx = mesh.vertices[o + 3], by = mesh.vertices[o + 4], bz = mesh.vertices[o + 5];
    const cx = mesh.vertices[o + 6], cy = mesh.vertices[o + 7], cz = mesh.vertices[o + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const w = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    if (!(w > 0)) continue;
    sx += w * (ax + bx + cx) / 3; sy += w * (ay + by + cy) / 3; sz += w * (az + bz + cz) / 3;
    sw += w;
  }
  return sw > 0 ? [sx / sw, sy / sw, sz / sw] : null;
}

/**
 * 三角形质心表（x,y,z 交错，长度 triCount*3）。
 * 原先定义在 gatingTrace.js，PHASE 90 的连接检测也要用 —— 纯几何工具，移到本模块。
 */
export function triangleCentroids(mesh) {
  const out = new Float64Array(mesh.triCount * 3);
  for (let t = 0; t < mesh.triCount; t++) {
    const o = t * 9;
    out[t * 3] = (mesh.vertices[o] + mesh.vertices[o + 3] + mesh.vertices[o + 6]) / 3;
    out[t * 3 + 1] = (mesh.vertices[o + 1] + mesh.vertices[o + 4] + mesh.vertices[o + 7]) / 3;
    out[t * 3 + 2] = (mesh.vertices[o + 2] + mesh.vertices[o + 5] + mesh.vertices[o + 8]) / 3;
  }
  return out;
}

/**
 * 把一组三角形按**邻接**（对偶图）切成连通块。
 *
 * 原先私有在 gatingTrace.js 里，PHASE 90 的连接区域聚合也要用它 —— 属纯拓扑工具，
 * 移到本模块统一提供（实现逐字未变，gatingTrace 改为 import）。
 *
 * @param {{start:Int32Array, nbr:Int32Array}} adj triangleComponents 产出的 CSR 对偶图
 * @param {ArrayLike<number>} tris 要切分的三角形号列表
 * @returns {number[][]} 连通块数组（元素为三角形号）
 */
export function splitByAdjacency(adj, tris) {
  const set = new Set(tris);
  const seen = new Set();
  const groups = [];
  for (const s of tris) {
    if (seen.has(s)) continue;
    const g = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const t = stack.pop();
      g.push(t);
      for (let i = adj.start[t]; i < adj.start[t + 1]; i++) {
        const o = adj.nbr[i];
        if (set.has(o) && !seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    groups.push(g);
  }
  return groups;
}

/** 三角形子集的包围盒 */
export function subsetBounds(mesh, tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    for (let k = 0; k < 3; k++) {
      const x = mesh.vertices[o + k * 3], y = mesh.vertices[o + k * 3 + 1], z = mesh.vertices[o + k * 3 + 2];
      if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
      if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
      if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
    }
  }
  if (mn[0] === Infinity) return null;
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  return {
    min: mn, max: mx, size,
    center: [mn[0] + size[0] / 2, mn[1] + size[1] / 2, mn[2] + size[2] / 2],
    diagonal: Math.hypot(size[0], size[1], size[2]),
  };
}
