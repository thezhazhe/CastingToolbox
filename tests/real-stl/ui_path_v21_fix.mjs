// ============================================================
// PHASE 21 真实 STL UI 路径验证（29.txt 第 5/6 条）
// 用真实失败 STL「ALHR4510塑料模具v2-2.1.stl」按真实 UI importFile 完整顺序验证：
//   parseSTL → buildMesh(state.geometry) → view3d.load(mesh)
//   → analyzeGeometrySliced → analyzeHotspotsV3 → diagnoseSTL
// 修复前（legacy load，无隔离）vs 修复后（生产函数 detachPosition）对照：
//   修复前 inside=0 + INSUFFICIENT_NO_SAMPLE（复现 28.txt 日志）
//   修复后 inside>0 + 与 probe 路径一致 + 原错误消失
// 另对 D:\LOCAD\STL文件 全部真实 STL 跑修复后 UI 路径，检查正常/空腔/多组件回归。
// 用法: node tests/real-stl/ui_path_v21_fix.mjs [stl路径或目录]
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSTL, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { buildDistanceField } from '../../js/engine/distanceField.js';
import { analyzeGeometrySliced, analyzeGeometry } from '../../js/engine/geometryAnalysis.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../../js/engine/v3/v3ViewAdapter.js';
import { diagnoseSTL } from '../../js/engine/stlDiagnostic.js';
import { validateMesh } from '../../js/engine/meshValidation.js';
import { detachPosition } from '../../js/views/components/modelView3D.js';

const ARG = resolve(process.argv[2] || 'D:\\LOCAD\\STL文件');
const isDir = (() => { try { return statSync(ARG).isDirectory(); } catch { return false; } })();
const stls = [];
if (isDir) {
  (function walk(dir) { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) { walk(p); continue; } if (/\.stl$/i.test(p)) stls.push(p); } })(ARG);
} else stls.push(ARG);

/** ModelView3D.load 修复后（生产函数 detachPosition + 居中 translate） */
function uiLoad(mesh) {
  const { geometry, bounds } = buildMesh(mesh);
  detachPosition(geometry);
  const c = bounds.center;
  geometry.translate(-c[0], -c[1], -c[2]);
  return { geometry, bounds };
}
/** ModelView3D.load 修复前（无隔离——复现 ROOT CAUSE） */
function uiLoadLegacy(mesh) {
  const { geometry, bounds } = buildMesh(mesh);
  const c = bounds.center;
  geometry.translate(-c[0], -c[1], -c[2]);
  return { geometry, bounds };
}

/**
 * 完整 UI importFile 引擎侧顺序（designCenter.js:414/428/449/481/…）
 * @returns {df, sliced, status, reason, verticesChanged, gs, vs}
 */
async function uiFullPath(mesh, loadFn) {
  const before = Float32Array.from(mesh.vertices);
  const engineGeom = buildMesh(mesh).geometry;        // :414 state.geometry
  loadFn(mesh);                                        // :428 state.view3d.load
  const verticesChanged = !(mesh.vertices.length === before.length &&
    (() => { for (let i = 0; i < mesh.vertices.length; i++) if (mesh.vertices[i] !== before[i]) return false; return true; })());
  const ui = await analyzeGeometrySliced(mesh, engineGeom, {}, async () => {});   // :449
  const v3 = toViewResult(analyzeHotspotsV3(mesh, engineGeom, {}), {
    wallMax: ui.wallMax, wallMain: ui.wallMain, wallAvg: ui.wallAvg,
  });
  const diag = diagnoseSTL(mesh, engineGeom, v3);      // :481
  const df = buildDistanceField(mesh, engineGeom, {}); // 同路径复算
  return {
    df: df.insideIdx.length, sliced: ui.res.insidePoints,
    gs: df.gs, vs: df.vs,
    status: diag.thickness.status, reason: diag.thickness.reason,
    verticesChanged, hotspots: v3.hotspots?.length ?? 0,
  };
}

/** probe 路径（不经过 ModelView3D——PHASE 19/20 基准） */
function probePath(mesh) {
  const { geometry } = buildMesh(mesh);
  const df = buildDistanceField(mesh, geometry, {});
  const probe = analyzeGeometry(mesh, geometry);
  return { df: df.insideIdx.length, gs: df.gs, vs: df.vs, sliced: probe.res.insidePoints };
}

const failFile = stls.find(f => /ALHR4510/i.test(f)) || stls[0];
console.log(`\n══ PHASE 21 真实 STL UI 路径验证（${stls.length} 个文件）══\n`);

// ===== 1) 真实失败 STL：修复前 vs 修复后 vs probe =====
{
  const buf = readFileSync(failFile);
  const mesh0 = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const b = computeBounds(mesh0.vertices, mesh0.triCount);
  const mdim = Math.round(Math.max(...b.size));
  console.log(`目标 STL：${failFile.split(/[\\/]/).pop()}  tri=${mesh0.triCount}  bounds=[${b.min.map(v => v.toFixed(0))}]~[${b.max.map(v => v.toFixed(0))}]  mdim=${mdim}`);

  // 修复前（每次重新解析，避免污染串扰）
  const m1 = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const legacy = await uiFullPath(m1, uiLoadLegacy);
  console.log(`\n[修复前 UI 路径] inside(df)=${legacy.df}  sliced=${legacy.sliced}  status=${legacy.status}`);
  console.log(`  vertices 被显示层改写: ${legacy.verticesChanged}   reason=${legacy.reason || '(无)'}`);

  // 修复后
  const m2 = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const fixed = await uiFullPath(m2, uiLoad);
  console.log(`[修复后 UI 路径] inside(df)=${fixed.df}  sliced=${fixed.sliced}  status=${fixed.status}  hotspots=${fixed.hotspots}`);
  console.log(`  vertices 被显示层改写: ${fixed.verticesChanged}   reason=${fixed.reason || '(无)'}`);

  // probe 基准
  const m3 = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const probe = probePath(m3);
  console.log(`[probe 路径基准] inside(df)=${probe.df}  sliced=${probe.sliced}  (gs=${probe.gs} vs=${probe.vs.toFixed(2)})`);

  const ok = fixed.df > 0 && legacy.df === 0 && fixed.df === probe.df && fixed.status !== 'INSUFFICIENT_NO_SAMPLE';
  console.log(`\n判定：修复前 ${legacy.df} → 修复后 ${fixed.df}（probe ${probe.df}）→ ${ok ? '✅ PASS' : '❌ FAIL'}`);
  if (!ok) process.exitCode = 1;
}

// ===== 2) 全部真实 STL 修复后 UI 路径回归（正常/空腔/多组件） =====
console.log(`\n── 全部 ${stls.length} 个真实 STL：修复后 UI 路径 vs probe ──`);
console.log('文件 | UI:gs³/vs/inside | probe:gs³/vs/inside | status | 污染');
let diff = 0, zero = 0;
for (const p of stls) {
  try {
    const buf = readFileSync(p);
    const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const ui = await uiFullPath(mesh, uiLoad);
    const probe = probePath(mesh);
    const same = ui.df === probe.df && ui.gs === probe.gs;
    if (!same) diff++;
    if (ui.df === 0) zero++;
    console.log(`${p.split(/[\\/]/).pop().padEnd(30)} | UI:${ui.gs}³/${ui.vs.toFixed(2)}/${ui.df} | probe:${probe.gs}³/${probe.vs.toFixed(2)}/${probe.df} | ${ui.status}${ui.verticesChanged ? ' | ★污染' : ''}${same ? '' : ' ★不一致'}`);
  } catch (e) {
    console.log(`${p.split(/[\\/]/).pop()}: ✗ ${e.message.slice(0, 70)}`);
  }
}
console.log(`\n全部真实 STL：不一致 ${diff}/${stls.length}，inside=0 ${zero}/${stls.length}`);
if (diff || zero) process.exitCode = 1;
