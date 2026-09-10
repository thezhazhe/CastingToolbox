// ============================================================
// PHASE 20 现场取证（27.txt）—— 完整复刻 UI importFile 执行路径
// designCenter.js importFile 的实际调用序列：
//   parseSTL → validateMesh → buildMesh → analyzeGeometrySliced（分片版）
//   → analyzeHotspotsV3 → toViewResult → diagnoseSTL（同步 buildDistanceField）
// 与 phase19_probe 路径（同步 analyzeGeometry）逐字段对照。
// 只读诊断：不修改任何引擎/UI 代码。
// 用法: node tests/real-stl/ui_path_probe.mjs [目录]
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSTL, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeGeometrySliced, analyzeGeometry } from '../../js/engine/geometryAnalysis.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../../js/engine/v3/v3ViewAdapter.js';
import { diagnoseSTL } from '../../js/engine/stlDiagnostic.js';
import { validateMesh } from '../../js/engine/meshValidation.js';

const ROOT = resolve(process.argv[2] || 'D:\\LOCAD\\STL文件');
const stls = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/\.stl$/i.test(p)) stls.push(p);
  }
})(ROOT);

console.log(`UI 路径取证：${stls.length} 个真实 STL（分片版 = UI 实际调用；同步版 = probe 调用）\n`);
console.log('文件 | tri | bounds.min | bounds.max | mdim | UI分片gs/vs/inside | probe同步gs/vs/inside | wallMain | diag.status');
let diff = 0;
for (let i = 0; i < stls.length; i++) {
  const p = stls[i];
  const fname = p.replace(ROOT + '\\', '');
  try {
    const buf = readFileSync(p);
    const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const mv = validateMesh(mesh);
    const { geometry } = buildMesh(mesh);
    const bounds = computeBounds(mesh.vertices, mesh.triCount);
    const mdim = Math.round(Math.max(...bounds.size));

    // ---- UI 路径（分片版，designCenter.js:449 同款）----
    const ui = await analyzeGeometrySliced(mesh, geometry, {}, async () => {});
    const v3 = toViewResult(analyzeHotspotsV3(mesh, geometry, {}), {
      wallMax: ui.wallMax, wallMain: ui.wallMain, wallAvg: ui.wallAvg,
    });
    const diag = diagnoseSTL(mesh, geometry, v3);   // designCenter.js:481 同款

    // ---- probe 路径（同步版，phase19_probe 同款）----
    const probe = analyzeGeometry(mesh, geometry);

    const same = ui.res.gs === probe.res.gs && ui.res.insidePoints === probe.res.insidePoints;
    if (!same) diff++;
    console.log(`${fname} | tri=${mesh.triCount} | [${bounds.min.map(v => v.toFixed(0))}] | [${bounds.max.map(v => v.toFixed(0))}] | ${mdim} | UI:${ui.res.gs}³/${ui.res.vs.toFixed(2)}/${ui.res.insidePoints} | probe:${probe.res.gs}³/${probe.res.vs.toFixed(2)}/${probe.res.insidePoints}${same ? '' : ' ★★不一致'} | wallMain=${ui.wallMain.toFixed(1)} | ${diag.thickness.status}${diag.distanceField.insidePoints === 0 ? ' ★★inside=0' : ''}`);
  } catch (e) {
    console.log(`${fname}: ✗ ${e.message.slice(0, 80)}`);
  }
}
console.log(`\nUI(分片) vs probe(同步) 不一致数: ${diff}/${stls.length}`);
console.log('mesh position/rotation/scale: 架构事实——引擎全程处理原始 Float32Array vertices，无 THREE.Mesh 对象，零 transform（buildMesh 直接 setAttribute）。UI 仅 ModelView3D 显示层做居中平移，不影响引擎数据。');
