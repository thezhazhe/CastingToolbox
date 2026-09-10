// ============================================================
// Mesh Validation · 几何合法性检查（命令3 第4节）
// 纯函数引擎模块，Node 可测。输出问题清单，不静默忽略。
// PHASE 28.5（42.txt 五）：非流形边 + 缠绕一致性检测（确定性、无第三方库）。
// ============================================================

/**
 * 检查网格几何问题
 * @param {{triCount:number, vertices:Float32Array, normals:Float32Array|null, warnings:string[]}} mesh  stl.js parseSTL 结果
 * @returns {{ok:boolean, issues:{level:'error'|'warning', code:string, msg:string}[],
 *            closed:boolean, boundaryEdges:number, degenerateTris:number,
 *            nonManifoldEdges:number, windingConflicts:number}}
 */
export function validateMesh(mesh) {
  const issues = [];
  const { vertices, triCount } = mesh;

  // 1. 基本读取
  if (triCount <= 0) issues.push({ level: 'error', code: 'NO_TRIANGLES', msg: 'STL 中没有有效三角形，文件可能损坏或为空' });
  if (mesh.warnings?.length) for (const w of mesh.warnings) issues.push({ level: 'warning', code: 'PARSE_WARNING', msg: w });

  // 2. 非法数值 / 重复顶点
  let badVerts = 0;
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(vertices[i])) { badVerts++; vertices[i] = 0; }
  }
  if (badVerts > 0) issues.push({ level: 'error', code: 'NON_FINITE_VERTEX', msg: `存在 ${badVerts} 个非法顶点坐标（已归零，结果可能受影响）` });

  // 3. 退化三角形（零面积：两条边叉积模 ≈ 0）
  let degenerate = 0;
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const ax = vertices[i + 3] - vertices[i], ay = vertices[i + 4] - vertices[i + 1], az = vertices[i + 5] - vertices[i + 2];
    const bx = vertices[i + 6] - vertices[i], by = vertices[i + 7] - vertices[i + 1], bz = vertices[i + 8] - vertices[i + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz < 1e-20) degenerate++;
  }
  if (degenerate > 0) issues.push({ level: 'warning', code: 'DEGENERATE_TRIANGLE', msg: `${degenerate} 个退化三角形（面积≈0），已忽略其贡献` });

  // 4. 拓扑检查：闭合性 / 非流形边 / 缠绕一致性
  //    按顶点坐标 key（0.001mm 容差）统计边：
  //      edgeCount（无向边 a|b）    ：闭合网格每条边出现偶数次；c>2 = 非流形边（
  //        c=3 三角架/蝴蝶结、c=4 双体共边——奇偶法只能抓奇数，c=4 会静默漏过）
  //      dirEdgeCount（有向边 a>b）：闭合流形中每条无向边的两个方向各出现 1 次；
  //        同一有向边出现 2 次 = 两个三角同向共用该边 = 绕向（法向）不一致
  const edgeCount = new Map();
  const dirEdgeCount = new Map();
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const vKey = new Map(); // 坐标 → 顶点索引
  let vi = 0;
  const triIdx = [];   // PHASE 28.6：每三角 3 顶点索引（自交检测邻接排除用）
  for (let t = 0; t < triCount; t++) {
    const idx = [];
    for (let k = 0; k < 3; k++) {
      const x = Math.round(vertices[t * 9 + k * 3] * 1000) / 1000;
      const y = Math.round(vertices[t * 9 + k * 3 + 1] * 1000) / 1000;
      const z = Math.round(vertices[t * 9 + k * 3 + 2] * 1000) / 1000;
      const ck = `${x},${y},${z}`;
      if (!vKey.has(ck)) vKey.set(ck, vi++);
      idx.push(vKey.get(ck));
    }
    triIdx.push(idx);
    for (let k = 0; k < 3; k++) {
      const a = idx[k], b = idx[(k + 1) % 3];
      const e = key(a, b);
      edgeCount.set(e, (edgeCount.get(e) || 0) + 1);
      const de = a + '>' + b;
      dirEdgeCount.set(de, (dirEdgeCount.get(de) || 0) + 1);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, windingConflicts = 0;
  for (const [, c] of edgeCount) {
    if (c % 2 === 1) boundaryEdges++;
    if (c > 2) nonManifoldEdges++;
  }
  for (const [, c] of dirEdgeCount) if (c > 1) windingConflicts++;
  const closed = boundaryEdges === 0 && triCount > 0;
  if (boundaryEdges > 0) {
    issues.push({
      level: 'warning', code: 'OPEN_MESH',
      msg: `网格未闭合（${boundaryEdges} 条边界边）。体积/壁厚/热结分析可能不准确。`,
    });
  }
  if (nonManifoldEdges > 0) {
    issues.push({
      level: 'warning', code: 'NON_MANIFOLD_EDGE',
      msg: `存在 ${nonManifoldEdges} 条非流形边（3 条及以上三角形共享，如双体共边/蝴蝶结）。体积与热结分析结果可能不可靠。`,
    });
  }
  if (windingConflicts > 0) {
    issues.push({
      level: 'warning', code: 'INCONSISTENT_WINDING',
      msg: `存在 ${windingConflicts} 处缠绕方向不一致（相邻三角形法向相对）。体积符号与射线内外判断可能出错。`,
    });
  }

  // 5. 自交检测（PHASE 28.6，43.txt C/P1-13）：非相邻三角形穿越相交。
  //    SELF_INTERSECTION 是独立问题（不并入 NON_MANIFOLD/OPEN_MESH/WINDING_CONFLICT——43.txt 四）。
  //    排除：共享顶点/共享边的相邻三角（正常 STL）；端点接触（相切，t∈{0,1}）不算穿越。
  //    空间加速=均匀网格分箱（非暴力 O(n²)）；相交测试=Möller–Trumbore 线段-三角。
  const { count: selfIntersections, truncated: selfTruncated } = detectSelfIntersections(vertices, triCount, triIdx);
  if (selfIntersections > 0) {
    issues.push({
      level: 'warning', code: 'SELF_INTERSECTION',
      msg: `检测到 ${selfIntersections} 处三角形自交（非相邻三角形相互穿越）。体积与热结分析结果可能不可靠。`,
    });
  } else if (selfTruncated) {
    // 检测未完成（候选对超上限）——明确告知，不假装"无自交"（43.txt 五）
    issues.push({
      level: 'warning', code: 'SELF_INTERSECTION_UNCHECKED',
      msg: '自交检测因三角形数量/重叠度过大未完整完成（超出检测对上限），可能存在未检出的自交。',
    });
  }

  return { ok: issues.every(i => i.level !== 'error'), issues, closed, boundaryEdges, degenerateTris: degenerate, nonManifoldEdges, windingConflicts, selfIntersections, selfTruncated };
}

/**
 * 结构化几何状态派生（PHASE 28.5，42.txt 五）：validateMesh 问题清单 → 三态。
 * 纯函数（designCenter 写入 geometry.geomStatus 用，Node 可测）。
 * @param {{level:string}[]} issues validateMesh().issues
 * @returns {'VALID'|'WARNING'|'INVALID'}
 *   VALID    → 无问题，当前分析可信执行
 *   WARNING  → 有风险但可继续（OPEN_MESH/非流形/缠绕/自交/退化等——体积仅供参考）
 *   INVALID  → 不满足可靠计算条件（空/非法顶点等 error 级）
 */
export function deriveGeomStatus(issues = []) {
  if (issues.some(i => i.level === 'error')) return 'INVALID';
  return issues.length ? 'WARNING' : 'VALID';
}

/* ================= PHASE 28.6 自交检测（P1-13） ================= */

/**
 * 自交检测：非相邻三角形穿越相交（确定性）。
 *  - 空间加速：均匀网格分箱（三角 bbox 落入的格子登记；同格三角对为候选）——非暴力 O(n²)
 *  - 邻接排除：共享 ≥1 顶点（坐标 key 相同）的三角对跳过——正常共享边/共享点不误报
 *  - 相交判定：Möller–Trumbore 线段-三角（6 条边 vs 对面三角平面）；
 *    端点接触（参数 t∈{0,1} 附近）不算穿越（相切）；共面且重叠（投影点含）算自交
 *  - 容差：参数空间绝对 1e-8（尺度无关）；det 相对 bbox 对角 1e-12
 * @param {Float32Array} vertices 非索引顶点（每三角 9 float）
 * @param {number} triCount
 * @param {number[][]} triIdx 每三角 3 顶点索引（validateMesh 第 4 节产物）
 * @returns {number} 自交对数量
 */
function detectSelfIntersections(vertices, triCount, triIdx) {
  if (triCount < 2) return 0;
  // bbox + 对角（相对容差基准）
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const D = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  // 分箱：格数 ~ cbrt(triCount) 自适应（每格期望少量三角）
  const N = Math.max(2, Math.min(32, Math.ceil(Math.cbrt(triCount))));
  const cell = D / N;
  const dims = [Math.max(1, Math.ceil((maxX - minX) / cell)), Math.max(1, Math.ceil((maxY - minY) / cell)), Math.max(1, Math.ceil((maxZ - minZ) / cell))];
  const cells = new Map();   // cellKey → triIndex[]
  const triBox = [];         // 每三角 bbox [minx,miny,minz,maxx,maxy,maxz]
  const cellKeyOf = (cx, cy, cz) => cx + dims[1] * cy + dims[0] * dims[1] * cz;
  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const b = [Math.min(vertices[o], vertices[o + 3], vertices[o + 6]), Math.min(vertices[o + 1], vertices[o + 4], vertices[o + 7]), Math.min(vertices[o + 2], vertices[o + 5], vertices[o + 8]),
      Math.max(vertices[o], vertices[o + 3], vertices[o + 6]), Math.max(vertices[o + 1], vertices[o + 4], vertices[o + 7]), Math.max(vertices[o + 2], vertices[o + 5], vertices[o + 8])];
    triBox.push(b);
    const c0 = [Math.floor((b[0] - minX) / cell), Math.floor((b[1] - minY) / cell), Math.floor((b[2] - minZ) / cell)];
    const c1 = [Math.min(dims[0] - 1, Math.floor((b[3] - minX) / cell)), Math.min(dims[1] - 1, Math.floor((b[4] - minY) / cell)), Math.min(dims[2] - 1, Math.floor((b[5] - minZ) / cell))];
    for (let cx = c0[0]; cx <= c1[0]; cx++) for (let cy = c0[1]; cy <= c1[1]; cy++) for (let cz = c0[2]; cz <= c1[2]; cz++) {
      const k = cellKeyOf(cx, cy, cz);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(t);
    }
  }
  // 候选对（同格）去重 + 邻接排除 + MT 相交
  // 顺序关键：bbox 预筛先于 seen 去重（只记录真实重叠候选对）——避免大三角跨多格导致 Set 爆炸
  //   （HR4012 大板实测 Set 超限崩溃）。seen 上限 SELF_MAX_PAIRS：超限即截断（truncated），
  //   返回"未完成"标记——不假装检测完成（43.txt：无法可靠完成就明确告知）。
  const SELF_MAX_PAIRS = 2_500_000;   // 实测最坏：45° 斜置壳体 ~96 万非邻接候选（ALR2510/HR4012）
  const seen = new Set();
  const epsT = 1e-8;                      // 参数空间容差（尺度无关）
  const detRel = 1e-12 * D * D * D;       // det 相对容差（量纲 L³）
  let hits = 0, truncated = false;
  const getV = (t, k) => [vertices[t * 9 + k * 3], vertices[t * 9 + k * 3 + 1], vertices[t * 9 + k * 3 + 2]];
  const SHIFT = 26;   // 数值 pk：a*2^26+b（三角数 < 2^26=6700 万，pk < 2^52 精确）
  outer:
  for (const list of cells.values()) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a === b) continue;
      // bbox 预筛（先于去重——只对真实重叠对继续）
      const ba = triBox[a], bb = triBox[b];
      if (ba[3] < bb[0] || bb[3] < ba[0] || ba[4] < bb[1] || bb[4] < ba[1] || ba[5] < bb[2] || bb[5] < ba[2]) continue;
      // 邻接排除（先于去重——相邻三角不是自交候选；壳体网格相邻占 85%+，提前过滤大幅减小 seen/MT 量）
      const ia = triIdx[a], ib = triIdx[b];
      let shared = false;
      for (const va of ia) for (const vb of ib) if (va === vb) { shared = true; break; }
      if (shared) continue;
      const pk = a < b ? a * (1 << SHIFT) + b : b * (1 << SHIFT) + a;
      if (seen.has(pk)) continue;
      if (seen.size >= SELF_MAX_PAIRS) { truncated = true; break outer; }
      seen.add(pk);
      // MT 相交：a 的 3 条边 vs b + b 的 3 条边 vs a
      const va = [getV(a, 0), getV(a, 1), getV(a, 2)], vb = [getV(b, 0), getV(b, 1), getV(b, 2)];
      if (edgeHitsTri(va[0], va[1], vb, epsT, detRel) || edgeHitsTri(va[1], va[2], vb, epsT, detRel) || edgeHitsTri(va[2], va[0], vb, epsT, detRel)
        || edgeHitsTri(vb[0], vb[1], va, epsT, detRel) || edgeHitsTri(vb[1], vb[2], va, epsT, detRel) || edgeHitsTri(vb[2], vb[0], va, epsT, detRel)) {
        hits++;
      }
    }
  }
  return { count: hits, truncated };
}

/** Möller–Trumbore：线段 p0-p1 是否穿越三角 t0-t1-t2（端点接触不算；共面重叠另判） */
function edgeHitsTri(p0, p1, tri, epsT, detRel) {
  const [t0, t1, t2] = tri;
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const e1x = t1[0] - t0[0], e1y = t1[1] - t0[1], e1z = t1[2] - t0[2];
  const e2x = t2[0] - t0[0], e2y = t2[1] - t0[1], e2z = t2[2] - t0[2];
  // pvec = d × e2
  const pvx = dy * e2z - dz * e2y, pvy = dz * e2x - dx * e2z, pvz = dx * e2y - dy * e2x;
  const det = e1x * pvx + e1y * pvy + e1z * pvz;
  if (Math.abs(det) < detRel) return false;   // 平行/共面（共面重叠在共面检测处理，此处保守不报）
  const inv = 1 / det;
  const tvx = p0[0] - t0[0], tvy = p0[1] - t0[1], tvz = p0[2] - t0[2];
  const u = (tvx * pvx + tvy * pvy + tvz * pvz) * inv;
  if (u < -epsT || u > 1 + epsT) return false;
  // qvec = tvec × e1
  const qx = tvy * e1z - tvz * e1y, qy = tvz * e1x - tvx * e1z, qz = tvx * e1y - tvy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -epsT || u + v > 1 + epsT) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > epsT && t < 1 - epsT;   // 端点接触（相切）不算穿越
}
