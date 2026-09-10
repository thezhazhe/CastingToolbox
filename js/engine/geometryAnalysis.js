// ============================================================
// Geometry Analysis · 几何自动提取（命令3 第5节）
// 从 STL 自动获得：尺寸 / 体积 / 表面积 / 壁厚统计（最大/平均/主体）。
// 距离场复用 distanceField.js；纯引擎模块，Node 可测。
// ============================================================
import { computeVolume, computeArea, computeBounds } from './stl.js';
import { distanceToSurface } from './mesh3d.js';
import { buildDistanceField, buildDistanceFieldSliced } from './distanceField.js';

/**
 * 全量几何分析
 * @param {{triCount:number, vertices:Float32Array}} mesh
 * @param {THREE.BufferGeometry} geometry  buildMesh 结果（已含 BVH）
 * @param {object} [opts]
 * @returns {{
 *   volume:mm³, area:mm², bounds, size, center, triCount,
 *   wallMax, wallAvg, wallMain:mm, wallHist:[{h, n}],
 *   res:{gs, vs, insidePoints, totalPoints, elapsedMs}
 * }}
 */
export function analyzeGeometry(mesh, geometry, opts = {}) {
  const t0 = Date.now();
  const df = buildDistanceField(mesh, geometry, opts);
  return fromDistanceField(mesh, geometry, df, t0);
}

/**
 * 分片版（UI 用）：距离场构建期间让出主线程，界面保持可交互；结果与同步版一致。
 * @param {(fn?:()=>void)=>Promise} [yieldFn] 每片计算后调用，默认空
 * @param {(phase:'scan'|'dist', frac:number)=>void} [onProgress] PHASE 22 真实进度
 */
export async function analyzeGeometrySliced(mesh, geometry, opts = {}, yieldFn, onProgress) {
  const t0 = Date.now();
  const df = await buildDistanceFieldSliced(mesh, geometry, opts, yieldFn, onProgress);
  return fromDistanceField(mesh, geometry, df, t0);
}

/** 从距离场计算壁厚统计（analyzeGeometry / analyzeGeometrySliced 共用） */
function fromDistanceField(mesh, geometry, df, t0) {
  const { gs, vs, pts, insideIdx, dists } = df;
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const volume = computeVolume(mesh.vertices, mesh.triCount);
  const area = computeArea(mesh.vertices, mesh.triCount);

  // 内部点到表面距离（半壁厚语义）
  const vals = dists.filter(d => d !== null && d > 0.001);
  let wallMax = 0, wallSum = 0, argmax = -1;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > wallMax) { wallMax = vals[i]; argmax = i; }
    wallSum += vals[i];
  }
  const wallAvg = vals.length ? wallSum / vals.length : 0;

  // 亚体素精化最大半距：体素网格点到不了几何中心，在最大距离体素邻域细分采样
  let refinedMax = wallMax;
  if (argmax >= 0) {
    const c = pts[insideIdx[argmax]];
    const sub = [];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let d = -2; d <= 2; d++) {
      sub.push([c[0] + a * vs / 4, c[1] + b * vs / 4, c[2] + d * vs / 4]);
    }
    const subD = distanceToSurface(geometry, sub);
    for (const d of subD) if (d !== null && d > refinedMax) refinedMax = d;
  }

  // 主体壁厚：峰值检测（峰值中段且显著 → 峰值；否则回退最大壁厚）
  let wallMain = refinedMax * 2, hist = [], rawBin = 0;
  if (vals.length > 0 && wallMax > 0) {
    const nb = Math.max(12, Math.min(50, Math.round(wallMax / (vs * 0.8))));
    rawBin = wallMax / nb;
    hist = new Array(nb).fill(0);
    for (const d of vals) hist[Math.min(nb - 1, Math.floor(d / rawBin))]++;
    let peak = 0;
    for (let i = 1; i < nb; i++) if (hist[i] > hist[peak]) peak = i;
    const wl = hist[peak - 1] || 0, wc = hist[peak], wr = hist[peak + 1] || 0;
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    const peakShare = wc / total;
    const neighborAvg = (wl + wr) / 2 / total;
    // 峰值需位于中段（≥25% 位置）：厚块/均匀件的假峰总在最低桶
    const sharp = peak >= nb * 0.25 && peakShare > 0.2 && peakShare > neighborAvg * 1.3;
    if (sharp) {
      const shift = wc > 0 ? (wr - wl) / (wl + wc + wr) : 0;
      wallMain = (peak + shift + 0.5) * rawBin * 2;
      // PHASE 19（24.txt）修正：直方图主峰受网格相位压制——壳体/板件的内部点集中在
      //   三壁交集角块，char 主峰 ≈ 网格采样深度而非壁厚（vs≈壁厚/2 时低估一半，
      //   实测 1m 壳 20mm 在 96³ 下 wallMain 20→10.1，P17-T1/T6 回归源）。
      //   与分布 p95×2 取大：多相位合并保证 p95 采样点含近壁中心点，均匀薄壁的
      //   p95×2 更接近真实壁厚（17.1 vs 20）；厚块模型主峰仍占优（t16 板10+块100：
      //   99.8 > p95×2=47.9）；欠采样件 p95 高估（~85%）不足以越过 2 层判据。
      if (vals.length >= 8) {
        const sorted = [...vals].sort((a, b) => a - b);
        const p95w = sorted[Math.floor(sorted.length * 0.95)] * 2;
        if (p95w > wallMain) wallMain = p95w;
      }
    }
  }

  return {
    volume, area, bounds, triCount: mesh.triCount,
    size: bounds.size, center: bounds.center,
    wallMax: refinedMax * 2,   // 半距 ×2 = 最大壁厚（亚体素精化）
    wallAvg: wallAvg * 2,
    wallMain,
    wallHist: hist.map((n, i) => ({ h: (i + 0.5) * rawBin * 2, n })),
    res: { gs, vs, insidePoints: insideIdx.length, totalPoints: pts.length, elapsedMs: Date.now() - t0 },
  };
}
