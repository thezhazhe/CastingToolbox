// ============================================================
// PHASE V2.0-04（102.txt §五~§七）· Hotspot Local Volume 实验工具（独立模块）
//
// 唯一目的：给定 (cubeCenter, Mc, K)，计算边长 L = K×Mc 的立方体与 STL 实体
//   相交的**真实几何体积** Vc_local = Volume(STL ∩ Cube)。
//
// 体积算法（精确多面体求交，非体素、非 bbox、非区域点数）：
//
//   ∂(S∩C) = (落在盒内的原表面 S_C) ∪ (∂C 中位于实体内的部分)
//   散度定理 (1/3)∮x·n dA 分两块：
//     ① 面片项：(1/6)Σ det[a,b,c]  —— 逐裁剪三角形求和（沿第一列展开，勿改符号）
//     ② 盖项  ：在盒面 x_a=h 上 n 是常量 → (x·n)=σ·h 常数
//                → (1/3)·σ·h·Area( S ∩ {x_a=h} ∩ 该面矩形 )
//        ★ 截面 Area 由**闭合实体**与平面的交线链环得到（不涉及盒子棱边，
//          因此不存在"盒面整块埋在实体内部时无边界边"的漏算），
//          再按矩形四半平面裁剪；孔洞由**嵌套深度**定号（偶=外环，奇=孔）。
//
//   该式已验证于 tests/phasev2004_test.mjs 的 10 条解析解用例。
//   全局绕向翻转安全：面片与盖同时反号 → 取绝对值。
//
// 连通分量（§七.3）：STL∩Cube 后可能有多块；只保留"包含 hotspot 的实体"那一块。
//   做法：先对**原始网格**做连通壳划分 + 射线奇偶定位 hotspot 所在壳，
//   再沿 源三角索引 传播到裁剪面片 → 不需要任何额外几何构造即可做归属判定。
//
// ★ 本模块只做实验。riser.js / calcs/** / js/engine/** 零改动。
// ============================================================
import { computeBounds } from '../../js/engine/stl.js';

/* ---------- 基础工具 ---------- */

/** 稳健射线方向（分量比接近无理，避免与轴/面共面） */
const RAY_DIR = [0.2672612419124244, 0.5345224838248488, 0.8017837257372732];
/** 各轴的右手 2D 投影对：轴 x→(y,z)、y→(z,x)、z→(x,y) */
const UVAX = [[1, 2], [2, 0], [0, 1]];

/** 三角形与射线的 Möller–Trumbore（双面） */
function rayTri(o, d, a, b, c) {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = o[0] - a[0], ty = o[1] - a[1], tz = o[2] - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : null;
}

/* ---------- 源壳划分 ---------- */

/** 把原始网格按共享顶点划成连通壳，并提供"某点落在哪些壳内部"的查询 */
export function prepareMesh(mesh, opts = {}) {
  const { vertices, triCount } = mesh;
  const b = computeBounds(vertices, triCount);
  const weldTol = opts.weldTol ?? Math.max(1e-5, Math.max(...b.size) * 1e-7);
  const q3 = (x, y, z) => `${Math.round(x / weldTol)},${Math.round(y / weldTol)},${Math.round(z / weldTol)}`;

  const repOf = new Map();
  const parent = [];
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const vid = (x, y, z) => {
    const key = q3(x, y, z);
    let r = repOf.get(key);
    if (r === undefined) { r = parent.length; parent.push(r); repOf.set(key, r); }
    return r;
  };
  const triRep = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    const a = vid(vertices[i], vertices[i + 1], vertices[i + 2]);
    const bb = vid(vertices[i + 3], vertices[i + 4], vertices[i + 5]);
    const c = vid(vertices[i + 6], vertices[i + 7], vertices[i + 8]);
    const ra = find(a); parent[find(bb)] = ra; parent[find(c)] = ra;
    triRep[t] = a;
  }
  const shellId = new Map();
  const shellOf = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const r = find(triRep[t]);
    let s = shellId.get(r);
    if (s === undefined) { s = shellId.size; shellId.set(r, s); }
    shellOf[t] = s;
  }
  const shellCount = shellId.size;
  const shellTris = Array.from({ length: shellCount }, () => []);
  for (let t = 0; t < triCount; t++) shellTris[shellOf[t]].push(t);

  // 每三角包围盒（加速平面求交与盒裁剪）
  const tb = new Float64Array(triCount * 6);
  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = vertices[i + k * 3], y = vertices[i + k * 3 + 1], z = vertices[i + k * 3 + 2];
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
      if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    }
    tb.set([mnx, mny, mnz, mxx, mxy, mxz], t * 6);
  }

  const shellsOfPoint = (p) => {
    const out = [];
    for (let s = 0; s < shellCount; s++) {
      let hits = 0;
      for (const t of shellTris[s]) {
        const i = t * 9;
        const tt = rayTri(p, RAY_DIR,
          [vertices[i], vertices[i + 1], vertices[i + 2]],
          [vertices[i + 3], vertices[i + 4], vertices[i + 5]],
          [vertices[i + 6], vertices[i + 7], vertices[i + 8]]);
        if (tt !== null) hits++;
      }
      if (hits % 2 === 1) out.push(s);
    }
    return out;
  };

  return { mesh, vertices, triCount, shellOf, shellCount, shellTris, triBox: tb, bounds: b, weldTol, shellsOfPoint };
}

/* ---------- 平面截面面积 ---------- */

/**
 * 实体与平面 axis=h 的截面，裁剪到矩形 rect（另两轴的 [lo,hi]），返回净面积。
 * 交线由三角面与平面求交得到 → 链成闭环 → 矩形四半平面裁剪 → 嵌套深度定号。
 */
export function crossSectionArea(ctx, axis, h, rect, warn = () => {}, shellKeep = null, coplanarTol = 1e-9, faceSign = 1) {
  const { vertices, triCount, triBox, shellOf } = ctx;
  const [ua, va] = UVAX[axis];
  const segs = [];
  let coplanarArea = 0;
  for (let t = 0; t < triCount; t++) {
    if (shellKeep && !shellKeep[shellOf[t]]) continue;                 // 只统计保留壳的实体
    const o = t * 6;
    if (triBox[o + axis] > h || triBox[o + 3 + axis] < h) continue;   // bbox 剔除
    const i = t * 9;
    const P = [];
    for (let k = 0; k < 3; k++) P.push([vertices[i + k * 3], vertices[i + k * 3 + 1], vertices[i + k * 3 + 2]]);
    const d = [P[0][axis] - h, P[1][axis] - h, P[2][axis] - h];
    // 共面片：整个三角贴在盒面所在平面上。平面求交对它给不出交线（会被整片跳过），
    //   所以它的面积必须**直接补进盖项**——否则该盒面少算一块。
    //   仅当三角法向与盒面外法向同向时才算（反向=实体在另一侧，该处不在实体内）。
    if (Math.abs(d[0]) <= coplanarTol && Math.abs(d[1]) <= coplanarTol && Math.abs(d[2]) <= coplanarTol) {
      const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
      const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
      const nAx = e1[(axis + 1) % 3] * e2[(axis + 2) % 3] - e1[(axis + 2) % 3] * e2[(axis + 1) % 3];
      if (faceSign * nAx <= 0) continue;
      let poly = P.map(p => [p[ua], p[va]]);
      for (const [ai, lo, hi] of [[0, rect[0][0], rect[0][1]], [1, rect[1][0], rect[1][1]]]) {
        poly = clipLoopHalf(poly, ai, 1, hi);
        if (poly.length < 3) break;
        poly = clipLoopHalf(poly, ai, -1, -lo);
        if (poly.length < 3) break;
      }
      if (poly.length >= 3) coplanarArea += Math.abs(loopArea(poly));
      continue;
    }
    // 掠射三角面（至少一个顶点恰在平面上、其余全在同一侧）是**贴面三角形的邻面**：
    //   它会产出一条"落在平面内"的线段（自己的平面内边），描出的环与共面片的区域
    //   **完全重合** → 再加就双计（板件 z=−5 面曾 loop=100 + coplanar=100 = 200）。
    //   只有真正跨越平面（既有 d<0 又有 d>0 顶点）的三角形才给出横向交线。
    {
      let hasNeg = false, hasPos = false;
      for (const dd of d) { if (dd < 0) hasNeg = true; else if (dd > 0) hasPos = true; }
      if (!hasNeg || !hasPos) continue;
    }
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const A = P[k], B = P[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      if (da === 0 && db === 0) continue;                 // 共面边：忽略（相邻三角仍给出交点）
      if ((da <= 0 && db > 0) || (da > 0 && db <= 0)) {
        const s = da / (da - db);
        pts.push([
          A[0] + s * (B[0] - A[0]),
          A[1] + s * (B[1] - A[1]),
          A[2] + s * (B[2] - A[2]),
        ]);
      }
    }
    if (pts.length < 2) continue;
    segs.push([[pts[0][ua], pts[0][va]], [pts[1][ua], pts[1][va]]]);
  }
  if (!segs.length) return { area: coplanarArea, coplanar: coplanarArea > 0, loopArea: 0, coplanarArea, segs: segs.length, loops: 0, openChains: 0 };

  // 链环。容差必须**紧**：交线端点由共享边算出，两侧数学同值、位级可能差 1ulp，
  //   只需 1e-13 量级即可焊接；用 weldTol×4（真实件 ≈3e-4mm）会把密集网格里
  //   相邻的**不同**顶点量化到同一 key → 链环在 >2 度交点处走错 → 大量未闭合
  //   （实测 HR4012 全姿态、ALR2510 X/Y 均由此报错）。
  const tol = Math.max(1e-9, Math.max(...ctx.bounds.size) * 1e-9);
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const at = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push({ i, e });
    }
  });
  const used = new Array(segs.length).fill(false);
  const loops = [];
  let openChains = 0;
  for (let i0 = 0; i0 < segs.length; i0++) {
    if (used[i0]) continue;
    used[i0] = true;
    const loop = [segs[i0][0], segs[i0][1]];
    let guard = 0;
    let advanced = true;
    while (advanced && guard++ < segs.length * 2 + 8) {
      advanced = false;
      const tail = loop[loop.length - 1];
      for (const cand of (at.get(key(tail)) || [])) {
        if (used[cand.i]) continue;
        const s = segs[cand.i];
        const other = cand.e === 0 ? s[1] : s[0];
        loop.push(other);
        used[cand.i] = true;
        advanced = true;
        break;
      }
    }
    // 闭合性检查：首尾应重合
    if (loop.length < 4 || key(loop[0]) !== key(loop[loop.length - 1])) { openChains++; continue; }
    loop.pop();
    if (loop.length >= 3) loops.push(loop);
  }
  if (openChains) warn(`${openChains} 条截面交线未能闭合成环（面积可能偏差）`);
  if (!loops.length) return { area: coplanarArea, coplanar: coplanarArea > 0, loopArea: 0, coplanarArea, segs: segs.length, loops: 0, openChains: 0 };

  // 按矩形四半平面裁剪（逐环 Sutherland–Hodgman）
  const clipped = [];
  for (let l of loops) {
    l = clipLoopHalf(l, 0, 1, rect[0][1]);
    if (l.length < 3) continue;
    l = clipLoopHalf(l, 0, -1, -rect[0][0]);
    if (l.length < 3) continue;
    l = clipLoopHalf(l, 1, 1, rect[1][1]);
    if (l.length < 3) continue;
    l = clipLoopHalf(l, 1, -1, -rect[1][0]);
    if (l.length < 3) continue;
    clipped.push(dedupeLoop(l));
  }
  if (!clipped.length) return { area: coplanarArea, coplanar: coplanarArea > 0, loopArea: 0, coplanarArea, segs: segs.length, loops: 0, openChains: 0 };

  // 嵌套深度定号：偶数层为外环(+)，奇数层为孔(−)
  const areas = clipped.map(loopArea);
  let total = 0;
  for (let i = 0; i < clipped.length; i++) {
    let depth = 0;
    const probe = interiorPoint(clipped[i]);
    for (let j = 0; j < clipped.length; j++) {
      if (i === j) continue;
      if (pointInLoop(probe, clipped[j])) depth++;
    }
    total += (depth % 2 === 0 ? 1 : -1) * Math.abs(areas[i]);
  }
  return { area: total + coplanarArea, coplanar: coplanarArea > 0, loopArea: total, coplanarArea, segs: segs.length, loops: loops.length, openChains };
}

function clipLoopHalf(poly, ai, sign, bound) {
  const n = poly.length;
  const out = [];
  const inS = (v) => sign * v[ai] <= bound;
  for (let i = 0; i < n; i++) {
    const A = poly[i], B = poly[(i + 1) % n];
    const ia = inS(A), ib = inS(B);
    if (ia) out.push(A);
    if (ia !== ib) {
      const da = sign * A[ai] - bound, db = sign * B[ai] - bound;
      const den = da - db;
      const t = Math.abs(den) < 1e-18 ? 0 : da / den;
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
    }
  }
  return out;
}

function dedupeLoop(l) {
  const out = [];
  for (const v of l) {
    const p = out[out.length - 1];
    if (p && Math.abs(p[0] - v[0]) < 1e-9 && Math.abs(p[1] - v[1]) < 1e-9) continue;
    out.push(v);
  }
  while (out.length > 1) {
    const f = out[0], p = out[out.length - 1];
    if (Math.abs(f[0] - p[0]) < 1e-9 && Math.abs(f[1] - p[1]) < 1e-9) out.pop(); else break;
  }
  return out;
}

function loopArea(l) {
  let s = 0;
  for (let i = 0; i < l.length; i++) {
    const A = l[i], B = l[(i + 1) % l.length];
    s += A[0] * B[1] - B[0] * A[1];
  }
  return s / 2;
}

/** 环内一点（用相邻顶点中点 + 微小平移，避开退化） */
function interiorPoint(l) {
  const A = l[0], B = l[Math.floor(l.length / 2)];
  return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
}

function pointInLoop(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i][0], yi = loop[i][1], xj = loop[j][0], yj = loop[j][1];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- 盒裁剪（面片项） ---------- */

function clipPolyToBox(poly, box) {
  let p = poly;
  for (let a = 0; a < 3; a++) {
    p = clipHalf(p, a, 1, box.max[a]);
    if (!p.length) return p;
    p = clipHalf(p, a, -1, -box.min[a]);
    if (!p.length) return p;
  }
  return cleanup(p);
}

function clipHalf(poly, axis, sign, bound) {
  const n = poly.length;
  const out = [];
  const inS = (v) => sign * v[axis] <= bound;
  for (let i = 0; i < n; i++) {
    const A = poly[i], B = poly[(i + 1) % n];
    const ia = inS(A), ib = inS(B);
    if (ia) out.push(A);
    if (ia !== ib) {
      const da = sign * A[axis] - bound, db = sign * B[axis] - bound;
      const den = da - db;
      const t = Math.abs(den) < 1e-18 ? 0 : da / den;
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])]);
    }
  }
  return out;
}

/** 去重复点与共线点——保证扇形三角化后内部边严格成对（否则体积求和会重复计） */
function cleanup(poly) {
  const out = [];
  for (const v of poly) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - v[0]) < 1e-9 && Math.abs(last[1] - v[1]) < 1e-9 && Math.abs(last[2] - v[2]) < 1e-9) continue;
    out.push(v);
  }
  while (out.length > 1) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9 && Math.abs(f[2] - l[2]) < 1e-9) out.pop();
    else break;
  }
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const A = out[(i - 1 + out.length) % out.length], B = out[i], C = out[(i + 1) % out.length];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const e2 = [C[0] - B[0], C[1] - B[1], C[2] - B[2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
      const cross = Math.hypot(cx, cy, cz);
      const l1 = Math.hypot(e1[0], e1[1], e1[2]), l2 = Math.hypot(e2[0], e2[1], e2[2]);
      if (cross <= 1e-12 * Math.max(1, l1 * l2)) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

/* ---------- 主函数 ---------- */

/**
 * 计算 Volume(STL ∩ Cube)，只统计"包含 center 的实体"。
 * @param {object} ctx      prepareMesh() 的返回
 * @param {number[]} center cube 中心（= 热点位置）
 * @param {number} side     cube 完整边长 L（不是半边长）
 * @param {object} [opts]   { keepOnlyHotspotComponent=true }
 */
export function cubeIntersectVolume(ctx, center, side, opts = {}) {
  const { vertices, triCount, triBox } = ctx;
  const keepOnly = opts.keepOnlyHotspotComponent !== false;
  const warnings = [];
  const half = side / 2;
  const box = {
    min: [center[0] - half, center[1] - half, center[2] - half],
    max: [center[0] + half, center[1] + half, center[2] + half],
  };
  const warn = (m) => { if (warnings.length < 6) warnings.push(m); };

  // 1) hotspot 落在哪些源壳内部
  let shells = ctx.shellsOfPoint(center);
  const shellSet = new Set(shells);
  if (!shells.length) {
    // 与引擎 isInside 不一致（射线擦边/网格微缺陷）→ 不静默退化：退回"全部壳"并告警。
    // 静默排除全部壳会让 Vc_local 直接变 0（实测 longBar ↻Y）。
    warn('HOTSPOT_NOT_INSIDE_ANY_SHELL（center 未被判在任何源壳内）→ 已退回全部壳');
    shells = [...Array(ctx.shellCount).keys()];
    for (const s of shells) shellSet.add(s);
  }

  // 2) 盖项——先在**精确**盒面上算（顺便检出"盒面与实体表面共面"）
  //    共面时同一片表面会被 面片项 与 盖项 各计一次（双计）。检出后把**面片项**的
  //    裁剪盒沿该面内缩 ε，使共面片只归盖项。ε 仅在检出共面时施加 → 非退化情形保持精确。
  //    （实例：均匀板 Mc=t/2、K=2 → L 恰好 = 板厚，双计使结果偏大 7/6。）
  const shellKeep = keepOnly ? new Uint8Array(ctx.shellCount) : null;
  if (shellKeep) for (const s of shells) shellKeep[s] = 1;
  // 共面容差必须**大于 STL 的 float32 量化噪声**：坐标 1000mm 处 float32 ULP ≈ 6e-5，
  //   坐标 5mm 处 ≈ 5e-7。若容差取 maxDim×1e-9（板件 ≈4e-7）就会漏判本该共面的面，
  //   该面改走平面求交 → 生成垃圾环 → 与共面面积**双计**（实测 z=−5 面 loop=100 +
  //   coplanar=100 = 200）。取 maxDim×1e-6（板件 ≈4e-4）既高于量化噪声，
  //   又比最小可信特征（约 0.1mm）小两个数量级。
  const coplanarTol = Math.max(1e-7, Math.max(...ctx.bounds.size) * 1e-6);
  const eps = side * 1e-6;
  const boxSoup = { min: box.min.slice(), max: box.max.slice() };
  let cap = 0;
  let coplanarFaces = 0;
  for (let ax = 0; ax < 3; ax++) {
    const [ua, va] = UVAX[ax];
    const rect = [[box.min[ua], box.max[ua]], [box.min[va], box.max[va]]];
    for (const sg of [1, -1]) {
      const h = sg > 0 ? box.max[ax] : box.min[ax];
      const cs = crossSectionArea(ctx, ax, h, rect, warn, shellKeep, coplanarTol, sg);
      if (cs.coplanar) {
        coplanarFaces++;
        if (sg > 0) boxSoup.max[ax] -= eps; else boxSoup.min[ax] += eps;
      }
      cap += (1 / 3) * sg * (h - center[ax]) * cs.area;
    }
  }
  if (coplanarFaces) warn(`盒面与实体表面共面 ${coplanarFaces} 处 → 面片项裁剪盒内缩 ε=${eps.toExponential(1)}（避免双计）`);

  // 3) 裁剪：保留盒内三角面片（带源三角索引）——用 boxSoup（可能沿共面内缩）
  const tris = [];
  for (let t = 0; t < triCount; t++) {
    const o = t * 6;
    if (triBox[o] > boxSoup.max[0] || triBox[o + 3] < boxSoup.min[0]) continue;
    if (triBox[o + 1] > boxSoup.max[1] || triBox[o + 4] < boxSoup.min[1]) continue;
    if (triBox[o + 2] > boxSoup.max[2] || triBox[o + 5] < boxSoup.min[2]) continue;
    const i = t * 9;
    const P = [
      [vertices[i], vertices[i + 1], vertices[i + 2]],
      [vertices[i + 3], vertices[i + 4], vertices[i + 5]],
      [vertices[i + 6], vertices[i + 7], vertices[i + 8]],
    ];
    const poly = clipPolyToBox(P, boxSoup);
    for (let k = 1; k + 1 < poly.length; k++) tris.push([poly[0], poly[k], poly[k + 1], t]);
  }

  // 3) 连通分量（共享焊接顶点，并查集）
  const vtol = ctx.weldTol * 4;
  const qv = (v) => `${Math.round(v[0] / vtol)},${Math.round(v[1] / vtol)},${Math.round(v[2] / vtol)}`;
  const par = new Int32Array(tris.length);
  for (let i = 0; i < tris.length; i++) par[i] = i;
  const ufFind = (x) => (par[x] === x ? x : (par[x] = ufFind(par[x])));
  const firstAt = new Map();
  for (let i = 0; i < tris.length; i++) {
    for (let k = 0; k < 3; k++) {
      const kk = qv(tris[i][k]);
      const prev = firstAt.get(kk);
      if (prev === undefined) firstAt.set(kk, i);
      else { const ra = ufFind(prev), rb = ufFind(i); if (ra !== rb) par[ra] = rb; }
    }
  }
  const comp = new Int32Array(tris.length);
  const compId = new Map();
  for (let i = 0; i < tris.length; i++) {
    const r = ufFind(i);
    let c = compId.get(r);
    if (c === undefined) { c = compId.size; compId.set(r, c); }
    comp[i] = c;
  }
  const nComp = compId.size;

  // 4) 分量归属：其源三角所属源壳含 center → 保留
  const compKeep = new Array(nComp).fill(false);
  for (let i = 0; i < tris.length; i++) if (shellSet.has(ctx.shellOf[tris[i][3]])) compKeep[comp[i]] = true;
  const kept = keepOnly ? compKeep : new Array(nComp).fill(true);

  // 5) 面片项（平移到 cube 中心提升数值精度；闭曲面下平移不变）
  let soup = 0;
  for (let i = 0; i < tris.length; i++) {
    if (!kept[comp[i]]) continue;
    const [p, r, s] = tris[i];
    const ax = p[0] - center[0], ay = p[1] - center[1], az = p[2] - center[2];
    const bx = r[0] - center[0], by = r[1] - center[1], bz = r[2] - center[2];
    const cx = s[0] - center[0], cy = s[1] - center[1], cz = s[2] - center[2];
    // det[[a],[b],[c]] / 6 —— 沿第一列展开（与 js/engine/stl.js:100 同一式子，勿改符号）
    soup += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  soup /= 6;

  // 6) 组装。
  //    ★ 盖项（步骤 2）必须与面片项用**同一坐标系**：面片项已平移到 cube 中心 o 以提精度，
  //      而平移只对闭合曲面不变——面片项是开放面片，(1/3)∮(x−o)·n dA = soup_abs − (1/3)o·N。
  //      盖项同步用 (h−o_a) 后，两处的 (1/3)o·N 恰好抵消（N+N'=0，因 ∂(S∩C) 闭合）。
  //      盖项若误用绝对 h，多壳用例会差出 166.67 mm³（见 phasev2004 T9）。
  //    ★ 截面只取**保留壳**的实体——否则分离的第二块会污染结果（T9 曾差 833.33）。
  const volume = Math.abs(soup + cap);
  const cubeVolume = side ** 3;
  return {
    volume, cubeVolume,
    fillRatio: cubeVolume > 0 ? volume / cubeVolume : 0,
    soup, cap,
    componentCount: nComp,
    keptComponents: kept.filter(Boolean).length,
    clippedTriangles: tris.length,
    coplanarFaces,
    warnings,
  };
}
