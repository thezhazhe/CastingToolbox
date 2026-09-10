// ============================================================
// PHASE 21 回归（29.txt 第 7 条）：ModelView3D 加载/居中不能污染分析 Mesh
// ROOT CAUSE：buildMesh 的 position BufferAttribute 零拷贝引用 mesh.vertices，
// ModelView3D.load 的居中 translate 原地改写共享 buffer → 引擎 geometry 的
// position 与缓存 boundingBox/BVH 状态错配 → 射线 0 命中 → UI inside=0
// （真实 STL 实证：UI=0 vs probe=9572）。
// 修复：detachPosition（生产代码）将显示层 position 隔离为独立副本。
// 本测试直接调用生产函数 detachPosition，并模拟 UI importFile 完整顺序。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeBounds } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { buildDistanceField } from '../js/engine/distanceField.js';
import { analyzeGeometrySliced, analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { detachPosition } from '../js/views/components/modelView3D.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) => parseSTL(readFileSync(join(__dirname, 'golden', `${name}.stl`)));

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const close = (a, b, tol) => Math.abs(a - b) <= tol;

/** ModelView3D.load 修复后逻辑（生产函数 detachPosition + 居中 translate） */
function uiLoad(mesh) {
  const { geometry, bounds } = buildMesh(mesh);
  detachPosition(geometry);                       // ← PHASE 21 修复：显示层独占副本
  const c = bounds.center;
  geometry.translate(-c[0], -c[1], -c[2]);
  return { geometry, bounds };
}

/** ModelView3D.load 修复前逻辑（无 detach——复现 ROOT CAUSE，仅对照用） */
function uiLoadLegacy(mesh) {
  const { geometry, bounds } = buildMesh(mesh);
  const c = bounds.center;
  geometry.translate(-c[0], -c[1], -c[2]);
  return { geometry, bounds };
}

/**
 * 真实 UI importFile 的引擎侧顺序（designCenter.js:414/428/449/481）：
 * buildMesh(state.geometry) → view3d.load(mesh) → analyzeGeometrySliced → buildDistanceField
 * @returns {sliced, df, gs, vs, verticesChanged}
 */
function uiPath(mesh, loadFn) {
  const engineGeom = buildMesh(mesh).geometry;          // :414 state.geometry
  const before = Float32Array.from(mesh.vertices);      // 快照（load 后必须不变）
  loadFn(mesh);                                         // :428 state.view3d.load
  const verticesChanged = !sameVerts(mesh.vertices, before, mesh.triCount * 9);
  return { verticesChanged, engineGeom };
}

async function uiPathInside(mesh, loadFn) {
  const { verticesChanged, engineGeom } = uiPath(mesh, loadFn);
  const ui = await analyzeGeometrySliced(mesh, engineGeom, {}, async () => {});  // :449
  const df = buildDistanceField(mesh, engineGeom, {});  // :481 diagnoseSTL 同路径
  return { sliced: ui.res.insidePoints, df: df.insideIdx.length, gs: df.gs, vs: df.vs, verticesChanged };
}

/** probe 路径（不经过 ModelView3D，PHASE 19/20 同款） */
function probeInside(mesh) {
  const { geometry } = buildMesh(mesh);
  const df = buildDistanceField(mesh, geometry, {});
  const probe = analyzeGeometry(mesh, geometry);
  return { df: df.insideIdx.length, gs: df.gs, vs: df.vs, sliced: probe.res.insidePoints };
}

function sameVerts(a, b, n) { for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; }

export const tests = [
  {
    name: '修复后：居中 translate 不再改写 mesh.vertices（adjacentSplit，center=[40,0,0]）',
    fn: () => {
      const mesh = load('adjacentSplit');
      const before = Float32Array.from(mesh.vertices);
      uiLoad(mesh);
      assert(sameVerts(mesh.vertices, before, mesh.triCount * 9),
        'detachPosition 后 translate 不得改动 mesh.vertices');
    },
  },
  {
    name: '修复前对照：无 detach 时 translate 确实改写（证明测试有效）',
    fn: () => {
      const mesh = load('adjacentSplit');
      const before = Float32Array.from(mesh.vertices);
      uiLoadLegacy(mesh);   // 旧行为（无隔离），center=[40,0,0] 有真实位移
      assert(!sameVerts(mesh.vertices, before, mesh.triCount * 9),
        '对照前提失效：legacy 路径应改写 mesh.vertices（零拷贝引用未被破坏）');
    },
  },
  {
    name: 'UI 完整路径 vs probe 一致（adjacentSplit 非对称坐标，修复后）',
    fn: async () => {
      const mesh = load('adjacentSplit');
      const ui = await uiPathInside(mesh, uiLoad);
      const probe = probeInside(mesh);
      assert(!ui.verticesChanged, '显示层加载不得污染分析数据');
      assert(ui.df === probe.df, `UI 路径 inside=${ui.df} ≠ probe ${probe.df}`);
      assert(ui.sliced === probe.sliced, `UI 分片 inside=${ui.sliced} ≠ probe 分片 ${probe.sliced}`);
      assert(ui.df > 0, 'adjacentSplit 应有内部采样点');
    },
  },
  {
    name: '空腔模型 tube_wall10：UI 路径 vs probe 一致（修复后）',
    fn: async () => {
      const mesh = load('tube_wall10');
      const ui = await uiPathInside(mesh, uiLoad);
      const probe = probeInside(mesh);
      assert(!ui.verticesChanged, '显示层加载不得污染分析数据');
      assert(ui.df === probe.df, `UI 路径 inside=${ui.df} ≠ probe ${probe.df}`);
      assert(ui.df > 0, 'tube_wall10 应有内部采样点');
    },
  },
  {
    name: '多组件模型 twoThick：UI 路径 vs probe 一致（修复后）',
    fn: async () => {
      const mesh = load('twoThick');
      const ui = await uiPathInside(mesh, uiLoad);
      const probe = probeInside(mesh);
      assert(!ui.verticesChanged, '显示层加载不得污染分析数据');
      assert(ui.df === probe.df, `UI 路径 inside=${ui.df} ≠ probe ${probe.df}`);
      assert(ui.df > 0, 'twoThick 应有内部采样点');
    },
  },
  {
    name: 'PHASE 19 大件薄壁模型 largeThin：UI 路径 vs probe 一致（修复后）',
    fn: async () => {
      const mesh = load('largeThin');
      const ui = await uiPathInside(mesh, uiLoad);
      const probe = probeInside(mesh);
      assert(!ui.verticesChanged, '显示层加载不得污染分析数据');
      assert(ui.df === probe.df, `UI 路径 inside=${ui.df} ≠ probe ${probe.df}`);
      assert(ui.df > 0, 'largeThin 应有内部采样点');
    },
  },
  {
    name: 'legacy 污染复现：UI 路径 inside 与修复后不同（对照证据）',
    fn: async () => {
      const mesh = load('adjacentSplit');
      const legacy = await uiPathInside(mesh, uiLoadLegacy);
      const fixed = await uiPathInside(mesh, uiLoad);
      assert(legacy.verticesChanged, 'legacy 路径应污染 vertices');
      assert(legacy.df !== fixed.df, `对照失效：legacy(${legacy.df}) 与修复后(${fixed.df}) 应产生不同结果`);
      console.info(`      [对照] legacy inside=${legacy.df} → 修复后 ${fixed.df}（adjacentSplit）`);
    },
  },
];
