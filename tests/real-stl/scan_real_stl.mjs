// ============================================================
// PHASE 20 收尾（26.txt）—— 真实 STL 批量快筛（只读，零修改）
// 扫描 D:\LOCAD\STL文件\ 下全部 .stl，用当前工作区最新代码跑全链：
//   parseSTL → validateMesh → buildMesh → buildDistanceField → thicknessStats
// 输出触发「距离场无有效采样 / inside=0」的文件清单，供深度分流。
// 用法: node tests/real-stl/scan_real_stl.mjs [目录]
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';
import { scanInside } from '../../js/engine/distanceField.js';
import { distanceToSurface } from '../../js/engine/mesh3d.js';
import { thicknessStats } from '../../js/engine/stlDiagnostic.js';
import { validateMesh } from '../../js/engine/meshValidation.js';
import { computeBounds } from '../../js/engine/stl.js';
import { analyzeGeometry } from '../../js/engine/geometryAnalysis.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../../js/engine/v3/v3ViewAdapter.js';

/** PHASE 16/17/18 版 V2 距离场（等价重建：单级单相位，maxResolution=96——本脚本内实现，只读） */
function dfLegacy(mesh, geometry) {
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const globalMin = bounds.min;
  const mdim = Math.max(...bounds.size);
  const minDim = Math.min(...bounds.size);
  let gs = 48;
  if (minDim > 0 && minDim < (mdim / gs) * 6) gs = Math.min(96, Math.ceil(6 * mdim / minDim));
  const vs = mdim / gs;
  const grid = scanInside(geometry, bounds, gs, vs, globalMin);
  const pts = [], insideIdx = [];
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    if (!grid[(i * gs + j) * gs + k]) continue;
    pts.push([bounds.min[0] + (i + 0.5) * vs, bounds.min[1] + (j + 0.5) * vs, bounds.min[2] + (k + 0.5) * vs]);
    insideIdx.push(pts.length - 1);
  }
  const dists = distanceToSurface(geometry, pts);
  return { gs, vs, pts, insideIdx, dists };
}

const ROOT = resolve(process.argv[2] || 'D:\\LOCAD\\STL文件');
const stls = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/\.stl$/i.test(f)) stls.push(p);
  }
})(ROOT);

console.log(`找到 ${stls.length} 个 STL\n`);
const rows = [];
const t0 = Date.now();
for (let i = 0; i < stls.length; i++) {
  const p = stls[i];
  const fname = p.replace(ROOT + '\\', '');
  try {
    const buf = readFileSync(p);
    const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const mv = validateMesh(mesh);
    const { geometry } = buildMesh(mesh);
    const df = buildDistanceField(mesh, geometry, {});
    const ts = thicknessStats(df);
    const dfL = dfLegacy(mesh, geometry);            // PHASE 16/17/18 版（重建）
    const tsL = thicknessStats(dfL);
    const bounds = computeBounds(mesh.vertices, mesh.triCount);
    const g = analyzeGeometry(mesh, geometry);
    // V3 链（Design Center 生产路径）：采样 WARNING 状态
    let v3 = null;
    try {
      const h3 = analyzeHotspotsV3(mesh, geometry, {});
      v3 = toViewResult(h3, { wallMax: g.wallMax, wallMain: g.wallMain, wallAvg: g.wallAvg });
    } catch (e) { v3 = { sampling: { level: 'ERR', detail: e.message.slice(0, 40) } }; }
    const r = {
      fname, tri: mesh.triCount, closed: mv.closed, bE: mv.boundaryEdges,
      size: bounds.size.map(v => Math.round(v)).join('x'),
      mdim: Math.round(Math.max(...bounds.size)), minDim: Math.round(Math.min(...bounds.size)),
      gs: df.gs, vs: +df.vs.toFixed(2), inside: df.insideIdx.length,
      valid: ts.samples, status: ts.status,
      legacyInside: dfL.insideIdx.length, legacyStatus: tsL.status,
      wallMain: +g.wallMain.toFixed(1),
      v3: v3.sampling.level, v3detail: v3.sampling.detail || '',
      sec: +((Date.now() - t0) / 1000).toFixed(1),
    };
    rows.push(r);
    const flag = r.inside === 0 ? ' ★★ inside=0' : (ts.status.startsWith('INSUFF') ? ' ★' : '');
    const lflag = r.legacyInside === 0 ? ' [PHASE16/17/18版 inside=0 ★★]' : '';
    console.log(`[${i + 1}/${stls.length}] ${r.fname}: tri=${r.tri} closed=${r.closed} ${r.size}mm | df gs=${r.gs}³ vs=${r.vs} inside=${r.inside} ${r.status} | P16版 ${r.legacyInside} ${r.legacyStatus}${lflag} | V3采样=${r.v3}${r.v3detail ? ':' + r.v3detail : ''} | wallMain=${r.wallMain}${flag}`);
  } catch (e) {
    rows.push({ fname, tri: -1, closed: false, error: e.message.slice(0, 80) });
    console.log(`[${i + 1}/${stls.length}] ${fname}: ✗ 错误 ${e.message.slice(0, 100)}`);
  }
}

console.log(`\n===== 汇总 =====`);
const bad = rows.filter(r => r.inside === 0);
console.log(`inside=0（「距离场无有效采样」触发）: ${bad.length}/${rows.length}`);
for (const r of bad) console.log(`  ${r.fname}: tri=${r.tri} closed=${r.closed} mdim=${r.mdim} gs=${r.gs} vs=${r.vs}`);
const low = rows.filter(r => r.inside > 0 && r.status.startsWith('INSUFF'));
if (low.length) console.log(`INSUFFICIENT（有采样但不足）: ${low.length} 个`);
for (const r of low) console.log(`  ${r.fname}: inside=${r.inside} gs=${r.gs} vs=${r.vs} ${r.status}`);
console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
