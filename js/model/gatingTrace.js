// ============================================================
// 浇注系统追踪与识别（PHASE 89 · 89.txt §四~§十三）
//
// 输入：一整份浇注系统 STL + 用户在 3D 上点选的**入口锚点**（一个或多个三角形）。
// 输出：直浇道 / 横浇道 / 内浇口 的候选分段 + 各自的**有效最小截面积**。
//
// ★★ 本模块的第一原则（89.txt §十三）：
//      几何能确定的，程序确定；几何不能确定的，明确告诉用户。
//      宁可 WARNING，也不要制造一个漂亮但错误的数字。
//    因此每个结果都带 usable / reason，**算不出就是算不出，绝不填一个像样的数**。
//
// ★ 识别优先级（89.txt §七，只用最小可解释的方法，不用 AI、不用黑箱分类器）：
//      ① 拓扑连续性  ② 流道主方向  ③ 分叉/汇合关系  ④ 局部方向明显变化
//      ⑤ 截面面积变化 ⑥ 截面形状变化 ⑦ 尺寸连续性
//    本实现用到 ①②③（并给出 ④⑥ 的诚实降级）。
//
// ★ 明确不做（89.txt §四）：
//      绝不"仅凭尺寸、形状或经验规则"偷偷把一个几何区域标成某种工艺语义。
//      没有"圆形一定是直浇道""矩形一定是横浇道"这类硬编码。
//
// 算法骨架（每一步都可解释、可单独测试）：
//   1. 拆连通分量            → meshComponents.js（纯拓扑）
//   2. 从入口三角形做**测地距离场**（三角形对偶图上的 Dijkstra，权重 = 质心距）
//   3. 沿测地半径推进，看**波前壳层的连通分量数**：1 → 仍在主干；≥2 → 分叉了
//        —— 这是纯拓扑信号，用不到任何截面/尺寸假设
//   4. 主干 = 分叉半径以内的三角形 → 候选直浇道
//      分叉半径以外按连通性分组 → 候选横浇道
//   5. 每段切成 K 个"窗口"，取窗口重心的**最长连续共线段**，弦方向 = 该段主方向
//        （§十二 的「相邻截面中心变化」；方向不稳就拒绝，不硬算 —— 见 stableRun 注释）
//   6. 沿该段主方向取一组截面，只接受「闭合 + 单环 + 形心落在中轴上 + 非局部突变」的截面，
//      取其中最小者 = 有效最小截面积（§十一：**沿流道主方向**的最小有效截面，
//      不是"任意方向的最小几何截面"，因此不会有斜切造成的虚假小面积）
//   7. 内浇口 = 流道末端与产品表面空间相接的位置（§十：优先用 Gating↔Product 连接关系）
//
// 每一步都记下了"为什么这么做"以及实测反例，改这个文件之前请先读那几段注释 ——
// 五处关键判断都是被实测数据推翻过一次之后才定下来的。
//
// 冻结（89.txt §十九）：属 js/model/，js/engine/ 零改动。纯函数，不依赖 three.js / DOM。
// ============================================================
import { triangleComponents, subsetBounds, subsetCentroid, splitByAdjacency, triangleCentroids } from './meshComponents.js';
export { triangleCentroids };
import { sliceArea } from './objectMetrics.js';
// PHASE 90 §十六：网格距离是**通用几何工具**，已抽到独立模块供两条链路共用。
// 这里继续 re-export，保持本文件对外的 API 不变（旧调用方与旧测试无需改动）。
import { buildTriGrid, pointTriDist, distanceToMesh } from './meshDistance.js';
export { buildTriGrid, pointTriDist, distanceToMesh };

/* ============================================================
   一、小工具
   ============================================================ */

/** 最小二叉堆（Dijkstra 用）；存 (key, value) 对，key = 距离 */
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    if (k.length) {
      k[0] = lastK; v[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return [topK, topV];
  }
}

/* triangleCentroids 已移至 meshComponents.js（纯几何工具），顶部 import 并 re-export。 */

/**
 * 测地距离场：从种子三角形出发，沿三角形对偶图做 Dijkstra。
 * 边权 = 两三角形质心距 —— 这是"沿表面走"的距离，对追踪流道足够。
 * @param {{vertices,triCount}} mesh
 * @param {{start:Int32Array,nbr:Int32Array}} adj
 * @param {Float64Array} cen 质心表
 * @param {Set<number>|null} allowed 只在这些三角形内扩散（null = 全网格）
 * @param {number} seed 种子三角形号
 * @returns {Float64Array} 每个三角形的测地距离；不可达 = Infinity
 */
export function geodesicField(mesh, adj, cen, allowed, seed) {
  const { start, nbr } = adj;
  const dist = new Float64Array(mesh.triCount).fill(Infinity);
  if (allowed && !allowed.has(seed)) return dist;
  dist[seed] = 0;
  const heap = new MinHeap();
  heap.push(0, seed);
  const w = (a, b) => Math.hypot(
    cen[a * 3] - cen[b * 3], cen[a * 3 + 1] - cen[b * 3 + 1], cen[a * 3 + 2] - cen[b * 3 + 2],
  );
  while (heap.size) {
    const [d, t] = heap.pop();
    if (d > dist[t]) continue;                       // 过期条目
    for (let i = start[t]; i < start[t + 1]; i++) {
      const o = nbr[i];
      if (allowed && !allowed.has(o)) continue;
      const nd = d + w(t, o);
      if (nd < dist[o]) { dist[o] = nd; heap.push(nd, o); }
    }
  }
  return dist;
}

/** 一组三角形内，测地距离落在 [lo, hi] 的那些 */
function trisInBand(tris, dist, lo, hi) {
  const out = [];
  for (let i = 0; i < tris.length; i++) {
    const d = dist[tris[i]];
    if (d >= lo && d <= hi) out.push(tris[i]);
  }
  return out;
}

/**
 * 某一层壳（在 allowed 集合内、且其成员都在 band 里）的连通分量数。
 * 纯拓扑计数，与形状/尺寸无关。
 */
function shellComponents(adj, inBand, bandTris) {
  const seen = new Set();
  let comps = 0;
  for (const s of bandTris) {
    if (seen.has(s)) continue;
    comps++;
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const t = stack.pop();
      for (let i = adj.start[t]; i < adj.start[t + 1]; i++) {
        const o = adj.nbr[i];
        if (inBand.has(o) && !seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
  }
  return comps;
}

/**
 * 在一组三角形里找**第一个分叉**的位置（§七③「分叉/汇合关系」）。
 *
 * 判据是纯拓扑的：沿测地半径推进，看**波前壳层的连通分量数**。
 *   1 → 波前还是一整圈，仍在同一根流道里
 *   ≥2 → 波前裂成了几股，从这里开始分叉
 * 完全不涉及截面面积、形状、尺寸 —— 所以不依赖任何"圆形=直浇道"之类的语义假设。
 *
 * 规模闸门：两侧都要有实质体量（第二大的壳 ≥ 本层 20%）才算真分叉，
 *   否则离散化噪声里冒出来的一两个面片也会被当成"分叉"。
 *
 * @returns {number|null} 分叉处的测地半径；没找到返回 null
 */
function findFork(cc, dist, tris, opts) {
  let dMin = Infinity, dMax = -Infinity;
  for (const t of tris) {
    const d = dist[t];
    if (Number.isFinite(d)) { if (d < dMin) dMin = d; if (d > dMax) dMax = d; }
  }
  if (!(dMax > dMin)) return null;
  const steps = opts.forkSteps || 40;
  const step = (dMax - dMin) / steps;
  const forkRatio = opts.forkRatio ?? 0.2;
  for (let s = 2; s <= steps; s++) {
    const lo = dMin + (s - 1) * step, hi = dMin + s * step;
    const band = trisInBand(tris, dist, lo, hi);
    if (band.length < 12) continue;                     // 太薄的一层不做判断
    if (shellComponents(cc.adj, new Set(band), band) < 2) continue;
    const sizes = splitByAdjacency(cc.adj, band).map(g => g.length).sort((a, b) => b - a);
    const total = sizes.reduce((a, b) => a + b, 0);
    if (sizes.length >= 2 && sizes[1] >= forkRatio * total) return hi;
  }
  return null;
}

/* splitByAdjacency 已移至 meshComponents.js（纯拓扑工具，两条链路共用），顶部 import。 */

/**
 * 稳定流向段（§七④「局部方向明显变化」、§十二「必须验证其稳定性」的落地）。
 *
 * 为什么必须有这一步：一段流道里并非处处都是"流道"。分叉后的起始段是**肘部**
 * （直浇道筒壁 + 交汇曲线 + 横浇道起始混在一起），末端可能顶着一个**圆角封盖**，
 * 入口端还摊着用户点击的那张**端面**。垂直于"主方向"去切这些地方，
 * 得到的都是残缺的环 —— 拿它求最小面积只会得到一个又小又假的数。
 *
 * 做法：按测地距离排序 → 切 K 个窗口 → 窗口重心序列中取**最长连续共线段**，
 * 弦方向即主方向，该段即"稳定流向段"。
 *
 * ⚠ 走过的两条弯路（都实测证伪过，别再走回去）：
 *   ① 用"每个窗口自己求 PCA 主轴"：一小段管壁的表面点是个**环**，
 *      环的轴向方差 ≈ h²/12、径向方差 ≈ r²/2；只要 h < r·√6，PCA 给出的"主轴"
 *      就是**径向**，而且各窗口的径向乱指 → 永远判成"方向不稳"。
 *   ② 用"相邻窗口流向的夹角"串成最长一致串：坏窗口会**一致地歪**
 *      （入口端 W0/W1 一起朝同一个歪方向漂），夹角判据根本挑不出来；
 *      而且当时那句比较写的是 winDir[i] 与 winDir[i+1]，i 到 K-2 时越界，
 *      导致**每个分段的最后一窗被静默丢掉**（锥形直浇道细端正好在那一窗）。
 *   共线判据一次覆盖两端，且不含任何"第几窗之后才算数"的经验常数。
 *
 * @returns {{ok:boolean, tris:number[], reason:string, windows:number, dir:number[]|null, ductness:number}}
 */
export function stableRun(mesh, tris, dist, opts = {}) {
  const K = opts.windows || 8;

  const minWin = opts.minWindowTris || 8;
  if (!tris || tris.length < minWin * 2) return { ok: false, tris: Array.from(tris || []), reason: 'too_short', windows: 0 };

  // 按测地距离排序（同一段内 φ 单调 → 窗口 = 流道的一段）
  const tagged = Array.from(tris).map(t => [dist ? (dist[t] ?? 0) : 0, t]).sort((a, b) => a[0] - b[0]);
  const dMin = tagged[0][0], dMax = tagged[tagged.length - 1][0];
  if (!(dMax > dMin)) return { ok: false, tris: Array.from(tris), reason: 'degenerate', windows: 0 };

  const winTris = Array.from({ length: K }, () => []);
  for (const [d, t] of tagged) {
    let w = Math.floor(((d - dMin) / (dMax - dMin)) * K);
    if (w >= K) w = K - 1;
    winTris[w].push(t);
  }
  const winC = winTris.map(g => (g.length >= minWin ? subsetCentroid(mesh, g) : null));

  /* ---- 找最长的**连续共线**窗口串，弦方向即主方向 ----
     一条直管道的各"横截面中心"必然共线。反过来说：凡是重心明显偏离这条弦的窗口，
     它就不是这张管道上的一个横截面 —— 无论它偏在入口端还是末端。

     实测两种污染方向正好相反，所以任何"取某一端"或"比较相邻夹角"的写法都按不住：
       · ⌀30 直浇道（入口点在端面上）：W0 重心偏轴 13mm、W1 偏 7mm，W2/W3 只偏 1mm
         —— 污染在**入口**端。而且 W0/W1 彼此还"一致地歪"，夹角判据挑不出来。
       · ⌀24 横浇道（末端有圆角封盖）：W0..W5 几乎完美共线，W6 偏 5.3mm、W7 偏 7.9mm
         —— 污染在**末端**。
     共线判据一次覆盖两端，也不需要任何"第几窗之后才算数"的经验常数。

     容差取弦长的 12%：足够宽到容忍离散化噪声（干净段的偏差在 0.2% 量级），
     又足够窄到挡住上面那两种污染（偏差 13%~32%）。 */
  /* 分叉之后的那一段，起点就是交汇处 —— 第一个窗口按定义是**肘部**，
     它的重心既不在这条流道的中轴上、也不在父级的中轴上，拿它定方向必然歪。
     这是结构性的（"从交汇处长出来的段，头一截一定是肘部"），不是长度经验值，
     所以可以放心地整窗排除，而不必去猜"排除多少毫米"。 */
  const a0 = (opts.skipFirstWindow && K > 3) ? 1 : 0;
  const cand = [];
  for (let a = a0; a < K; a++) {
    if (!winC[a]) continue;
    for (let b = a + 1; b < K; b++) {
      if (!winC[b]) break;
      const P = winC[a], Q = winC[b];
      const L = Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]);
      if (!(L > 0)) continue;
      const d = [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L, (Q[2] - P[2]) / L];
      const tol = L * 0.12;
      let maxDev = 0;
      for (let i = a + 1; i < b; i++) {
        const vx = winC[i][0] - P[0], vy = winC[i][1] - P[1], vz = winC[i][2] - P[2];
        const t = vx * d[0] + vy * d[1] + vz * d[2];
        const dev = Math.hypot(vx - t * d[0], vy - t * d[1], vz - t * d[2]);
        if (dev > maxDev) maxDev = dev;
      }
      if (maxDev <= tol) cand.push({ lo: a, hi: b, n: b - a + 1, L });
    }
  }
  if (!cand.length) return { ok: false, tris: Array.from(tris), reason: 'no_stable_window', windows: 0 };
  // 窗口数最多者优先；并列取弦最长者
  cand.sort((x, y) => (y.n - x.n) || (y.L - x.L));
  const bestLo = cand[0].lo, bestHi = cand[0].hi;
  const P = winC[bestLo], Q = winC[bestHi];
  const dL = Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]);
  const dir = [(Q[0] - P[0]) / dL, (Q[1] - P[1]) / dL, (Q[2] - P[2]) / dL];

  const core = [];
  for (let i = bestLo; i <= bestHi; i++) core.push(...winTris[i]);
  // 稳定段太短 → 不足以代表这条流道（§十二：不硬算）
  if (core.length < Math.max(minWin * 2, tris.length * 0.2)) {
    return { ok: false, tris: core, reason: 'stable_run_too_short', windows: bestHi - bestLo + 1 };
  }

  /* 像不像"一条流道"：轴向跨度必须明显大于横向半径。
     否则说明这段是个团块（球状热节式的几何），谈不上"主流方向" → §十二 不硬算。 */
  const ductness = dir ? ductnessOf(mesh, core, dir) : 0;

  return {
    ok: true, tris: core, reason: '', windows: bestHi - bestLo + 1,
    dir, ductness, links: bestHi - bestLo,
  };
}

/**
 * 段沿 dir 的轴向跨度 ÷ 横向最大半径 —— 判"是流道还是团块"。
 * @returns {number} ≥1 像流道；越小越像团块
 */
function ductnessOf(mesh, tris, dir) {
  const c = subsetCentroid(mesh, tris);
  if (!c) return 0;
  let tMin = Infinity, tMax = -Infinity, rMax = 0;
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    for (let k = 0; k < 3; k++) {
      const dx = mesh.vertices[o + k * 3] - c[0];
      const dy = mesh.vertices[o + k * 3 + 1] - c[1];
      const dz = mesh.vertices[o + k * 3 + 2] - c[2];
      const t = dx * dir[0] + dy * dir[1] + dz * dir[2];
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      const rx = dx - t * dir[0], ry = dy - t * dir[1], rz = dz - t * dir[2];
      const r = Math.hypot(rx, ry, rz);
      if (r > rMax) rMax = r;
    }
  }
  return rMax > 0 ? (tMax - tMin) / rMax : 0;
}

/* ============================================================
   三、有效最小截面积（§十一 的严格定义）
   ============================================================ */

/**
 * 沿**该段流道自己的主方向**，在中段取一组横截面，
 * 只接受「闭合 + 单环 + 面积 > 0」的截面，取其中最小者。
 *
 * 三条纪律（都直接对应 89.txt 的原文）：
 *   · §十一：不做"任意方向的最小几何截面"——方向由本段主方向决定，不是自由搜索，
 *            所以不会出现斜切造成的虚假小面积
 *   · §十一：不做"整个网格的绝对最小面积"——只在**本段三角形**上切（tris），
 *            否则交汇高度上的截面会把相邻流道也算进来
 *   · §十三：不可靠就报不可靠。闭合/单环/样本数任一不达标 → usable=false + reason
 *
 * @param {{vertices,triCount}} mesh 整份网格（切片需要原始坐标）
 * @param {ArrayLike<number>} tris 本段的三角形
 * @param {number[]} axis 本段主方向（单位向量）
 * @param {object} [opts] samples / bandLo / bandHi
 * @returns {{usable:boolean, min:number|null, rep:number|null, max:number|null,
 *            samples:number, valid:number, reason:string}}
 */
export function effectiveMinSection(mesh, tris, axis, opts = {}) {
  const out = { usable: false, min: null, rep: null, max: null, samples: 0, valid: 0, reason: '' };
  if (!axis || !tris || tris.length < 4) { out.reason = 'too_few_triangles'; return out; }
  const samples = opts.samples || 21;
  /* 采样带几乎铺满整段（只留 2% 边距避开与端面恰好相切的退化位置）。
     第一版收到 5%~95%，理由是"两端是相接处会畸变"——那是**预先替算法做了假设**。
     实际该由证据说话：相接处切出来的环本来就不闭合，closed/loops/连续段三道闸门会自己把它挡掉；
     而锥形流道的真实最小截面恰恰落在最靠近端部的地方，预先截掉就等于系统性高估。 */
  const lo = opts.bandLo ?? 0.02, hi = opts.bandHi ?? 0.98;

  const origin = subsetCentroid(mesh, tris);
  if (!origin) { out.reason = 'degenerate'; return out; }

  // 沿轴的范围
  let tmin = Infinity, tmax = -Infinity;
  for (let i = 0; i < tris.length; i++) {
    const o = tris[i] * 9;
    for (let k = 0; k < 3; k++) {
      const d = (mesh.vertices[o + k * 3] - origin[0]) * axis[0]
        + (mesh.vertices[o + k * 3 + 1] - origin[1]) * axis[1]
        + (mesh.vertices[o + k * 3 + 2] - origin[2]) * axis[2];
      if (d < tmin) tmin = d;
      if (d > tmax) tmax = d;
    }
  }
  const L = tmax - tmin;
  if (!(L > 0)) { out.reason = 'degenerate'; return out; }

  const band = [];
  let openSlices = 0, multiLoop = 0, empty = 0, offAxis = 0;
  for (let k = 0; k < samples; k++) {
    const f = lo + (hi - lo) * (k / (samples - 1));
    const r = sliceArea(mesh.vertices, mesh.triCount, origin, axis, tmin + L * f, tris);
    out.samples++;
    if (!r.closed) { openSlices++; band.push(null); continue; }   // 子集被剪断 / 网格破口 → 不可信
    if (r.loops !== 1) { multiLoop++; band.push(null); continue; } // 切到多条流道 → 不是"该流道自己的截面"
    if (!(r.area > 0)) { empty++; band.push(null); continue; }
    /* 第四道闸门：切面形心必须落在**这条流道自己的中轴**上。
       一条流道自己的横截面，形心天然在中轴上（偏移 ≈ 0）。
       形心明显偏离 → 切面是残缺的环（端部圆角、交汇处的月牙），面积会偏小得离谱
       （实测：⌀24 横浇道在端部圆角处被算成 104 mm²，而真值是 452）。
       阈值取 0.35×等效半径：完整圆环偏移 0；半环约 0.42r（会被挡掉）；斜切月牙远超此值。 */
    const rEq = Math.sqrt(r.area / Math.PI);
    const c = r.centroid;
    let perp = 0;
    if (c) {
      const dx = c[0] - origin[0], dy = c[1] - origin[1], dz = c[2] - origin[2];
      const t = dx * axis[0] + dy * axis[1] + dz * axis[2];
      perp = Math.hypot(dx - t * axis[0], dy - t * axis[1], dz - t * axis[2]);
    }
    if (perp > 0.35 * rEq) { offAxis++; band.push(null); continue; }
    band.push(r.area);
  }
  out.valid = band.filter(a => a !== null).length;
  out.offAxisSlices = offAxis;

  /* 只认**连续**可测的一段。
     为什么不用"有效样本总数 / 总样本数"：零散的有效点可能各自来自不同的局部，
     把它们的最小值凑在一起没有物理意义。
     连续一段则对应流道上真实存在的一段稳定管段 —— 在这段上取最小截面才站得住脚。
     这也天然处理了"肘部"：它落在段首或段尾，连续段自动把两头的不稳定部分排除。 */
  let lo2 = -1, hi2 = -1, curLo = -1;
  for (let k = 0; k <= band.length; k++) {
    const okHere = k < band.length && band[k] !== null;
    if (okHere && curLo < 0) curLo = k;
    if (!okHere && curLo >= 0) {
      if (k - 1 - curLo > hi2 - lo2) { lo2 = curLo; hi2 = k - 1; }
      curLo = -1;
    }
  }
  const runLen = lo2 < 0 ? 0 : hi2 - lo2 + 1;
  out.runFrom = lo2 < 0 ? null : lo2;
  out.runTo = hi2 < 0 ? null : hi2;
  out.runLen = runLen;
  // 门槛：连续段至少 3 个样本（低于此不足以证明"有一段稳定管段"）
  if (runLen < 3) {
    out.reason = openSlices >= multiLoop && openSlices >= empty ? 'open_sections'
      : multiLoop >= empty ? 'multi_loop_sections' : 'empty_sections';
    return out;
  }

  /* ---- 剔除局部突变点 ----
     流道截面沿程是**连续变化**的（直管恒定、锥管渐变）。
     某个采样点突然比左右邻点小一大截，那不是流道特征，而是离散化产物：
     端部圆角、交汇处月牙等等。
     实测：⌀24 横浇道在离封盖 1.3mm 处切出 178 mm²，而它在 0.3mm 外的一整串采样都是 453.7
     （网格格距 2.3mm，那一刀正好落在被 MC 倒圆的端角上）。
     判据：与左右各两个邻点的**中位数**相差超过 35% 即视为突变。
     为什么用中位数而不是"上一刀"：锥管的面积本来就在渐变（相邻差 ~4%），
     拿邻点中位数比才不会把正常的锥度误判成突变。 */
  let vals = [];
  for (let k = lo2; k <= hi2; k++) vals.push(band[k]);
  out.outlierSlices = 0;
  for (let pass = 0; pass < 2; pass++) {
    const keep = [];
    for (let j = 0; j < vals.length; j++) {
      const nb = [];
      for (let m = Math.max(0, j - 2); m <= Math.min(vals.length - 1, j + 2); m++) if (m !== j) nb.push(vals[m]);
      if (nb.length < 2) { keep.push(vals[j]); continue; }
      nb.sort((a, b) => a - b);
      const med = nb[Math.floor(nb.length / 2)];
      if (Math.abs(vals[j] - med) > 0.35 * med) { out.outlierSlices++; continue; }
      keep.push(vals[j]);
    }
    if (keep.length === vals.length) break;
    vals = keep;
  }
  if (vals.length < 3) {
    out.reason = 'unstable_sections';
    return out;
  }
  const sorted = vals.slice().sort((a, b) => a - b);
  out.min = sorted[0];
  out.max = sorted[sorted.length - 1];
  out.rep = sorted[Math.floor(sorted.length / 2)];
  out.usable = true;
  return out;
}

/* ============================================================
   四、内浇口：流道末端 ↔ 产品 的空间相接处（§十）
   ============================================================ */

/* 距离工具（buildTriGrid / pointTriDist / pointBoxDist / distanceToMesh）
   已于 PHASE 90 抽到 ./meshDistance.js —— 它是通用几何工具，两条链路共用。
   本文件顶部已 import 并 re-export，语义与实现**逐字未变**。 */

/* ============================================================
   五、主入口：从入口锚点追踪整套浇注系统
   ============================================================ */

export const TRACE_REASON = {
  NO_ENTRY: 'no_entry',
  ENTRY_NOT_ON_MESH: 'entry_not_on_mesh',
  EMPTY_COMPONENT: 'empty_component',
  NO_FORK: 'no_fork_found',
  LOST: 'trace_lost',
};

/**
 * @param {{vertices:Float32Array, triCount:number}} mesh 浇注系统 STL
 * @param {number[]} entryTris 入口锚点的三角形号（用户点击）
 * @param {object} [opts]
 *   maxSegments   分段上限（防复杂件爆炸），默认 60
 *   forkRatio     壳层分量数 ≥ 2 且两侧规模都 ≥ forkRatio × 本层规模 → 判定真分叉，默认 0.2
 *   samples       每段截面采样数，默认 21
 *   product       产品 mesh（可选）；给了才做内浇口识别（§十）
 *   productTouchTol 与产品"相接"的判定距离（mm）；不给则按两者尺寸自动取
 * @returns {object} 见文件头
 */
export function traceGating(mesh, entryTris, opts = {}) {
  const warnings = [];
  const result = {
    ok: false, reason: null,
    components: [], segments: [], sprues: [], runners: [], ingates: [],
    componentCount: 0, totalVolumeMm3: 0, totalAreaMm2: 0,
    traceable: false, warnings,
  };
  if (!mesh || !(mesh.triCount > 0)) { result.reason = TRACE_REASON.EMPTY_COMPONENT; return result; }

  /* --- 1. 连通分量 --- */
  const cc = triangleComponents(mesh);
  result.componentCount = cc.components.length;
  result.totalVolumeMm3 = cc.components.reduce((s, c) => s + c.volumeMm3, 0);
  result.totalAreaMm2 = cc.components.reduce((s, c) => s + c.areaMm2, 0);
  result.tol = cc.tol;
  result.degenerateTris = cc.degenerateTris;
  result.components = cc.components.map(c => ({
    index: c.index, triCount: c.triCount, closed: c.closed,
    boundaryEdges: c.boundaryEdges, nonManifoldEdges: c.nonManifoldEdges,
    volumeMm3: c.volumeMm3, areaMm2: c.areaMm2,
    volumeReliable: c.closed,
    bounds: c.bounds,
  }));
  for (const c of cc.components) {
    if (!c.closed) warnings.push({ code: 'component_open', params: [c.boundaryEdges] });
  }

  if (!entryTris || !entryTris.length) {
    // 89.txt §五：没有入口 → 只给纯几何信息，**不执行需要入口方向的识别**
    result.reason = TRACE_REASON.NO_ENTRY;
    return result;
  }

  const cen = triangleCentroids(mesh);

  /* --- 2. 逐个入口追踪 --- */
  const usedComp = new Set();
  entryTris.forEach((rawSeed, ei) => {
    if (!(rawSeed >= 0 && rawSeed < mesh.triCount)) {
      warnings.push({ code: 'entry_out_of_range', params: [ei + 1] });
      return;
    }
    // 落点可能恰好命中一个零面积三角形（网格退化面，不承载任何几何）。
    //   3D 射线通常打不中零面积面，但"入口可以来自任意来源"（测试、导入、程序调用），
    //   所以这里主动挪到最近的**有效**三角形上，而不是直接放弃这个入口。
    let seedTri = rawSeed;
    let ci = cc.triToComp[seedTri];
    if (ci < 0) {
      const snapped = nearestSolidTriangle(mesh, cc, cen, seedTri);
      if (snapped < 0) { warnings.push({ code: 'entry_on_degenerate', params: [ei + 1] }); return; }
      seedTri = snapped;
      ci = cc.triToComp[seedTri];
      warnings.push({ code: 'entry_snapped', params: [ei + 1] });
    }
    const comp = cc.components[ci];
    usedComp.add(ci);
    const allowed = new Set(Array.from(comp.tris));       // 只在入口所属实体内追踪
    const dist = geodesicField(mesh, cc.adj, cen, allowed, seedTri);

    /* 2a. **递归**分段（§九：允许一条 / 多条 / **多级**横浇道）
       每一段都问同一个问题："你内部还有没有分叉？"
         · 有 → 分叉前的那截是本段主干，分叉后的每一支各自继续问
         · 没有 → 本段就是一个末端段
       为什么不只分一级（第一版就是这么写的）：一枚内浇口常常是从横浇道上**再分一次**下来的。
       只分一级的话，内浇口会被整条吞进它父级的"横浇道"里，父级的重心轨迹
       先沿横浇道走、再拐进内浇口往下去 —— 于是本该是水平的横浇道被判成竖直，
       截面也全废（实测：⌀24 横浇道报成 111 mm²）。 */
    let maxD = 0;
    for (const t of comp.tris) if (dist[t] > maxD && Number.isFinite(dist[t])) maxD = dist[t];
    if (!(maxD > 0)) { warnings.push({ code: 'trace_degenerate', params: [ei + 1] }); return; }

    const maxDepth = opts.maxDepth ?? 4;
    const maxSegments = opts.maxSegments ?? 60;
    const minSegTris = opts.minSegmentTris ?? 8;
    const segs = [];                                   // { tris, parentIdx, depth, forkRadiusMm }
    let truncated = 0;
    const splitRec = (tris, parentIdx, depth) => {
      if (segs.length >= maxSegments) { truncated++; return -1; }
      const forkD = findFork(cc, dist, tris, opts);
      const idx = segs.length;
      if (forkD == null || depth >= maxDepth) {
        segs.push({ tris, parentIdx, depth, forkRadiusMm: null });
        return idx;
      }
      segs.push({ tris: tris.filter(t => dist[t] <= forkD), parentIdx, depth, forkRadiusMm: forkD });
      const rest = tris.filter(t => dist[t] > forkD);
      // 子段必须相对父段有实质体量：绝对阈值挡不住"把一个几百面的碎片当一条流道"。
      //   分叉判据偶尔会被离散化噪声触发，这里用比例兜底（10% 父段 + 绝对下限）。
      const minChild = Math.max(minSegTris, Math.ceil(tris.length * 0.1));
      const groups = splitByAdjacency(cc.adj, rest)
        .filter(g => g.length >= minChild)
        .sort((a, b) => b.length - a.length);
      for (const g of groups) splitRec(g, idx, depth + 1);
      return idx;
    };
    splitRec(Array.from(comp.tris), -1, 0);
    if (truncated) warnings.push({ code: 'segments_truncated', params: [truncated] });

    /* 2b. 逐段求主方向与有效最小截面 */
    for (const s of segs) {
      // 逐点求极值，不用 Math.min(...arr)：段内三角形可达几十万个，展开成实参会爆栈
      let gLo = Infinity, gHi = -Infinity;
      for (const t of s.tris) {
        const d = dist[t];
        if (!Number.isFinite(d)) continue;
        if (d < gLo) gLo = d;
        if (d > gHi) gHi = d;
      }
      const built = makeSegment(mesh, s.tris, dist, {
        entryIndex: ei + 1,
        entryTri: seedTri,
        depth: s.depth,
        parentIdx: s.parentIdx,
        forkRadiusMm: s.forkRadiusMm,
        forkDetected: s.forkRadiusMm != null,
        geodesicStartMm: Number.isFinite(gLo) ? gLo : null,
        geodesicEndMm: Number.isFinite(gHi) ? gHi : null,
        samples: opts.samples,
      });
      built.entryField = dist;
      result.segments.push(built);
    }
  });

  /* --- 3. 分类（§十：内浇口由 **Gating↔Product 的连接关系** 决定，不靠"比较薄"这类形状猜测） --- */
  const traced = result.segments.some(s => s.depth === 0);
  result.traceable = traced;
  if (usedComp.size > 1) warnings.push({ code: 'entries_in_different_bodies', params: [usedComp.size] });

  const hasProduct = !!(opts.product && opts.product.triCount > 0);
  let grid = null, touchTol = 0;
  if (traced && hasProduct) {
    const prod = opts.product;
    const diag = Math.max(cc.diagonal || 0, prodDiag(prod));
    grid = buildTriGrid(prod, Math.max(diag / 64, 1e-6));
    touchTol = opts.productTouchTol ?? diag * 0.002;      // 0.2% 件尺寸
    result.productTouchTolMm = touchTol;
  }
  const hasChild = new Set(result.segments.map(s => s.parentIdx).filter(i => i >= 0));

  for (let i = 0; i < result.segments.length; i++) {
    const seg = result.segments[i];
    seg.isLeaf = !hasChild.has(i);
    /* ★ 末端段一律测到产品的距离 —— **包括 depth 0**。
       为什么包含 depth 0：浇注系统不一定分叉。一根直浇道直接插到铸件上（直浇道浇口）
       也是一套完整浇注系统。原先这里写了 `|| seg.depth === 0` 的跳过条件，
       结果"不分叉"的浇注系统永远不会被测到产品的距离 —— 既认不出直浇道浇口，
       也报不出"没接上"的实测距离（实测：相距 200mm 的悬空浇注系统报出 null）。 */
    if (!hasProduct || !seg.isLeaf) continue;
    // 只在**末端段**上找"离产品最近"的位置（抽样上限，避免大件逐面查询）
    const core = seg.coreTris && seg.coreTris.length ? seg.coreTris : seg.tris;
    const stride = Math.max(1, Math.ceil(core.length / 3000));
    let best = Infinity;
    for (let k = 0; k < core.length; k += stride) {
      const t = core[k];
      const d = distanceToMesh(grid, opts.product, [cen[t * 3], cen[t * 3 + 1], cen[t * 3 + 2]]);
      if (d < best) best = d;
    }
    seg.distanceToProductMm = Number.isFinite(best) ? best : null;
    const touch = Number.isFinite(best) && best <= touchTol;
    // §十：**这就是内浇口** —— 流道最终与产品相接的那一段。相接 = 距离小于件尺寸的 0.2%。
    //   depth 0 的段（= 主干/直浇道）即使相接也仍算直浇道，只是额外标注"直浇道浇口"，
    //   否则一条不分叉的直浇道浇口会被同时算成"直浇道"和"内浇口"，数量对不上。
    seg.isIngate = touch && seg.depth > 0;
    seg.touchesProduct = touch;
  }
  if (result.segments.some(s => s.depth === 0 && s.touchesProduct)) {
    warnings.push({ code: 'sprue_touches_product', params: [] });
  }
  if (traced && !hasProduct) warnings.push({ code: 'no_product_for_ingate', params: [] });
  if (traced && hasProduct && !result.segments.some(s => s.isIngate)) {
    // §十/§十八.17：找不到任何相接位置 → 如实报警，不假装有内浇口
    const nearest = Math.min(...result.segments.filter(s => s.isLeaf && s.distanceToProductMm != null)
      .map(s => s.distanceToProductMm), Infinity);
    warnings.push({
      code: 'no_gating_product_connection',
      params: [Number.isFinite(nearest) ? Math.round(nearest * 100) / 100 : null, Math.round(touchTol * 100) / 100],
    });
  }
  if (traced && !result.segments.some(s => s.depth === 0 && s.forkDetected)) {
    warnings.push({ code: 'no_fork_found', params: [] });
  }

  /* 编号与父子关系（分类定型后再编号，保证 S/G/I 各自连续） */
  const idOf = new Map();
  for (let i = 0; i < result.segments.length; i++) {
    const s = result.segments[i];
    const kind = s.depth === 0 ? 'S' : (s.isIngate ? 'I' : 'G');
    const n = (kind === 'S' ? result.sprues : kind === 'I' ? result.ingates : result.runners).length + 1;
    s.id = kind + n;
    idOf.set(i, s.id);
    (kind === 'S' ? result.sprues : kind === 'I' ? result.ingates : result.runners).push(s);
  }
  for (const s of result.segments) {
    s.parentId = s.parentIdx >= 0 ? (idOf.get(s.parentIdx) || null) : null;
    delete s.parentIdx;
  }

  result.ok = traced;
  if (!traced && !result.reason) result.reason = TRACE_REASON.LOST;
  result.ingateTotalMm2 = result.ingates.reduce((s, g) => s + (g.section?.usable ? g.section.min : 0), 0);
  result.ingateAreaUsable = result.ingates.length > 0 && result.ingates.every(g => g.section?.usable);
  return result;
}

/**
 * 从零面积三角形挪到最近的**有效**三角形（按质心距）。
 * @returns {number} 有效三角形号；全网格都是退化面时返回 -1
 */
function nearestSolidTriangle(mesh, cc, cen, tri) {
  const x = cen[tri * 3], y = cen[tri * 3 + 1], z = cen[tri * 3 + 2];
  let best = -1, bestD = Infinity;
  for (let t = 0; t < mesh.triCount; t++) {
    if (cc.triToComp[t] < 0) continue;
    const d = (cen[t * 3] - x) ** 2 + (cen[t * 3 + 1] - y) ** 2 + (cen[t * 3 + 2] - z) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** 网格包围盒对角线（产品尺寸，用于自动取"相接"判定距离） */
function prodDiag(mesh) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0, n = mesh.triCount * 9; i < n; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = mesh.vertices[i + a];
      if (v < mn[a]) mn[a] = v;
      if (v > mx[a]) mx[a] = v;
    }
  }
  return Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
}

/**
 * 离给定点最近的三角形号。
 * 用途：① 测试里用"点"代替 3D 点击构造入口锚点；
 *      ② 调用方若只有一个坐标（而不是拾取结果），也能定位入口。
 * @returns {number} 三角形号；网格为空返回 -1
 */
export function nearestTriangleToPoint(mesh, p) {
  let best = -1, bestD = Infinity;
  for (let t = 0; t < mesh.triCount; t++) {
    const o = t * 9;
    const cx = (mesh.vertices[o] + mesh.vertices[o + 3] + mesh.vertices[o + 6]) / 3;
    const cy = (mesh.vertices[o + 1] + mesh.vertices[o + 4] + mesh.vertices[o + 7]) / 3;
    const cz = (mesh.vertices[o + 2] + mesh.vertices[o + 5] + mesh.vertices[o + 8]) / 3;
    const d = (cx - p[0]) ** 2 + (cy - p[1]) ** 2 + (cz - p[2]) ** 2;
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/**
 * 组装一段流道：稳定流向段 → 主方向 → 有效最小截面积。
 *
 * 三段式闸门（任一不通过就不给数，只给原因）：
 *   ① 能不能切出一段方向稳定的流道（stableRun）
 *   ② 主方向本身是否明确（ductAxis 的各向同性判据）
 *   ③ 截面是否可测（effectiveMinSection 的 闭合/单环/样本数）
 */
function makeSegment(mesh, tris, dist, meta) {
  // depth > 0 的段起点必在交汇处 → 首窗是肘部，不参与定方向
  const core = stableRun(mesh, tris, dist, { ...meta, skipFirstWindow: (meta.depth || 0) > 0 });
  const useTris = core.ok ? core.tris : Array.from(tris);
  const bounds = subsetBounds(mesh, tris);
  const seg = {
    ...meta,
    tris: Int32Array.from(tris),
    triCount: tris.length,
    coreTris: Int32Array.from(useTris),
    coreTriCount: useTris.length,
    coreStable: core.ok,
    coreWindows: core.windows,
    axis: core.dir || null,
    axisDuctness: core.ok ? Number(core.ductness.toFixed(2)) : null,
    centroid: subsetCentroid(mesh, tris),
    bounds,
    warnings: [],
    section: null,
  };
  seg.axisConfident = false;

  // 闸门①：切不出一段方向稳定的流道（肘部 / 多级分叉 / 碎片）→ §十二：不硬算
  if (!core.ok && core.reason !== 'too_short') {
    seg.section = unmeasurable(core.reason);
    seg.warnings.push(core.reason);
    return seg;
  }
  /* 闸门②：这段是团块而不是流道 → 谈不上"主流方向" → §十二：不硬算。
     阈值 2.0 的来历（都是实测算出来的"轴向跨度 / 横向最大半径"）：
       立方体/团块 60³ → 1.41；⌀24×39 短管 → 3.25；T 形肘部段 → 1.4~1.5；
       ⌀30×120 直浇道 → 8；⌀40×200 → 10。
     取 2.0 把"团块"和"带大段肘部、说不清算不算一条流道"的都挡在外面 ——
     宁可不给数，也不给一个"看着很确定"的轴。 */
  if (!seg.axis || !(core.ductness >= 2.0)) {
    seg.section = unmeasurable('not_a_duct');
    seg.warnings.push('not_a_duct');
    return seg;
  }
  // 闸门③：截面本身可不可测（闭合 + 单环 + 形心在中轴上 + 非局部突变）
  seg.section = effectiveMinSection(mesh, useTris, seg.axis, { samples: meta.samples });

  /* 闸门④：**用截面反过来验证方向**。
     这个方向对不对，有一个不依赖任何额外假设的判据：
     垂直于它切出来的截面，应当是**一条流道自己的闭合单环**。
     切出来是碎环 → 要么方向不对，要么这一段根本不是一条流道。
     两种情况都不该把方向当结论报出去（否则 UI 上会出现一个"看着很确定、其实没验证过"的轴向）。
     所以 axisConfident 直接绑在截面是否可测上 —— 方向由证据背书，不由算法自说自话。 */
  seg.axisConfident = seg.section.usable;
  if (!seg.section.usable) seg.warnings.push(seg.section.reason || 'section_unusable');
  return seg;
}

const unmeasurable = (reason) =>
  ({ usable: false, min: null, rep: null, max: null, samples: 0, valid: 0, reason });
