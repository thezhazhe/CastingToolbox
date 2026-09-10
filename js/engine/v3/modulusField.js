// ============================================================
// V3 Local Thermal Modulus Field（13.txt §9 重构版）
// M(p) = V_local / A_local，单位 mm。
// 窗口 = 以采样点为中心的体素块（LOCAL_WINDOW_POLICY：R = k×char，固定规则，
// 无动态外扩/回退——13.txt §7 "优先采用简单、稳定、可解释的窗口"）。
// V = 块内 inside 体素 × vs³；A = 块内边界接触面 × vs²（windowVoxels 计数，O(块)）。
// 物理上界：M ≤ (2/3)×d（半球嵌入表面 Chvorinov 解析：V=(2/3)πd³, A=πd²
//   → M=(2/3)d）。切表面窗口（窗口触及模型表面但未覆盖对侧）的 A 低估
//   → M 虚高（cube 表面层实测 4~6×d）——上界压制，有物理依据（非补丁）。
// 尺度不变性：char∝尺度 → R∝尺度 → V~R³ A~R² → M~R（M(10×)≈10×M(1×)）✓
// 纯引擎模块，Node 可测。
// ============================================================
import { windowVoxels } from './windowV.js';
import { V3_DEFAULTS } from './configV3.js';

/**
 * 在采样点集上计算单尺度 M 场
 * @param {{inside:Uint8Array, boundary:Uint8Array, gs, vs, bounds}} vox  voxelize 结果
 * @param {{pts:number[][], char:(number|null)[]}} sample  coarseSample/refineSample 结果
 * @param {object} [opts]
 * @param {number} [k]         窗口系数（默认 1.0 = medium）
 * @param {number[]} [idxOnly] 只算指定索引（null = 全部）
 * @returns {{
 *   M:Float64Array, V:Float64Array, A:Float64Array, R:Float64Array,
 *   idx:number[], maxM:number, meanM:number, ms:number
 * }}
 */
export function buildModulusField(vox, sample, opts = {}, k = 1.0, idxOnly = null) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();
  const { pts, char } = sample;
  const mdim = Math.max(vox.bounds.max[0] - vox.bounds.min[0], vox.bounds.max[1] - vox.bounds.min[1], vox.bounds.max[2] - vox.bounds.min[2]);
  const capR = o.windowCapRatio * mdim;   // 窗口上限（防窗口≈全模型：块计数爆炸 + 局部性丧失）
  const n = pts.length;
  const idx = idxOnly ? [...idxOnly] : [...Array(n).keys()];

  const M = new Float64Array(idx.length);
  const V = new Float64Array(idx.length);
  const A = new Float64Array(idx.length);
  const R = new Float64Array(idx.length);

  for (let t = 0; t < idx.length; t++) {
    fieldPoint(vox, sample, idx[t], k, o, capR, t, M, V, A, R);
  }

  let maxM = 0, sum = 0;
  for (let t = 0; t < idx.length; t++) {
    if (M[t] > maxM) maxM = M[t];
    sum += M[t];
  }
  return { M, V, A, R, idx, maxM, meanM: idx.length ? sum / idx.length : 0, ms: Date.now() - t0 };
}

/** 单点 M 场计算（同步/分片共用；结果写入 t 位） */
function fieldPoint(vox, sample, i, k, o, capR, t, M, V, A, R) {
  const { pts, char } = sample;
  const c = char[i];
  let r = (c !== null && c > 0) ? k * c : k * o.charFloor;
  r = Math.max(o.charFloor, Math.min(r, capR));
  R[t] = r;
  const w = windowVoxels(vox, pts[i], r);
  V[t] = w.v;
  A[t] = w.a;
  let m = w.a > 1e-9 ? w.v / w.a : 0;
  // 物理上界：M ≤ modulusCeilRatio × d（d = 到表面距离，见 configV3 校准注）。
  //   PHASE 24 注（32.txt）：曾实验改为 t=d+d2/混合上限——t 上限把均匀件场压平产生
  //   边缘伪峰（plate 角点/cylinder 端面/tube 壁，实测），d 上限是 14.txt 均匀件校准的
  //   承重墙（放宽任何比例均破坏 NO_HOTSPOT）。d 上限对板/肋状厚结构的 M 压制由
  //   extractRegion 的原始 V/A 区域生长修复（peakRegion.js，区域用未封顶 V/A 提取）——
  //   峰值 M 保持封顶语义（均匀件不变），区域恢复物理结构核心（ALR2510 厚大结构）。
  const d = sample.dists ? sample.dists[i] : null;
  if (d !== null && d > 0) m = Math.min(m, o.modulusCeilRatio * d);
  M[t] = m;
}

/**
 * 分片版 M 场（PHASE 22 · UI 用）：与 buildModulusField 逐点同算式，仅每 256 点让出主线程。
 * @param {Function} [yieldFn]
 * @param {Function} [onProgress] 进度回调（0→1，可选）
 */
export async function buildModulusFieldSliced(vox, sample, opts = {}, k = 1.0, idxOnly = null, yieldFn = null, onProgress = null) {
  const o = { ...V3_DEFAULTS, ...opts };
  const t0 = Date.now();
  const mdim = Math.max(vox.bounds.max[0] - vox.bounds.min[0], vox.bounds.max[1] - vox.bounds.min[1], vox.bounds.max[2] - vox.bounds.min[2]);
  const capR = o.windowCapRatio * mdim;
  const n = sample.pts.length;
  const idx = idxOnly ? [...idxOnly] : [...Array(n).keys()];

  const M = new Float64Array(idx.length);
  const V = new Float64Array(idx.length);
  const A = new Float64Array(idx.length);
  const R = new Float64Array(idx.length);

  for (let t = 0; t < idx.length; t++) {
    fieldPoint(vox, sample, idx[t], k, o, capR, t, M, V, A, R);
    if (yieldFn && t % 256 === 255) await yieldFn();
    if (onProgress && t % 256 === 255) onProgress(t / Math.max(1, idx.length));
  }
  if (onProgress) onProgress(1);

  let maxM = 0, sum = 0;
  for (let t = 0; t < idx.length; t++) {
    if (M[t] > maxM) maxM = M[t];
    sum += M[t];
  }
  return { M, V, A, R, idx, maxM, meanM: idx.length ? sum / idx.length : 0, ms: Date.now() - t0 };
}
