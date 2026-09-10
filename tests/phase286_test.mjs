// ============================================================
// PHASE 28.6（43.txt）：工程参数定稿 + 真实 STL 验证 + 自交检测
//   A. P0-3 密度接线（USER_OVERRIDE 生效 / 默认行为不变 / fallback 不静默）
//   B. R1 真实 STL 斜置验证（ALR2510 热结件 + cube50 均匀件，0/15/30/45°）
//   C. P1-13 自交检测 7 场景（独立 code，不与 NON_MANIFOLD/OPEN_MESH 合并）
// ============================================================
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { validateMesh, deriveGeomStatus } from '../js/engine/meshValidation.js';
import { HS_STATUS } from '../js/engine/hotspot.js';
import { runGating, MATERIALS } from '../calcs/gating.js';
import { runRiser } from '../calcs/riser.js';
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifestOf = (id) => CALC_MANIFEST.find(c => c.id === id);

const loadSTL = (name) => {
  const buf = readFileSync(path.join(ROOT, 'tests/real-stl', name));
  return parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const runV3 = (mesh) => analyzeHotspotsV3(mesh, buildMesh(mesh).geometry, {});

/** 任意轴 Rodrigues 旋转（与 phase29 相同实现） */
function rotAxis(axis, deg) {
  const [ux, uy, uz] = axis, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const K = [
    [c + ux * ux * (1 - c), ux * uy * (1 - c) - uz * s, ux * uz * (1 - c) + uy * s],
    [uy * ux * (1 - c) + uz * s, c + uy * uy * (1 - c), uy * uz * (1 - c) - ux * s],
    [uz * ux * (1 - c) - uy * s, uz * uy * (1 - c) + ux * s, c + uz * uz * (1 - c)],
  ];
  return (x, y, z) => [
    K[0][0] * x + K[0][1] * y + K[0][2] * z,
    K[1][0] * x + K[1][1] * y + K[1][2] * z,
    K[2][0] * x + K[2][1] * y + K[2][2] * z,
  ];
}
const transform = (mesh, f) => {
  const out = new Float32Array(mesh.vertices);
  for (let t = 0; t < mesh.triCount; t++) for (let k = 0; k < 3; k++) {
    const o = t * 9 + k * 3, [x, y, z] = f(out[o], out[o + 1], out[o + 2]);
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
  }
  return { ...mesh, vertices: out };
};

const meshOf = (V, tris) => {
  const verts = new Float32Array(tris.length * 9);
  tris.forEach(([a, b, c], i) => {
    const o = i * 9;
    [a, b, c].forEach((vi, k) => { verts[o + k * 3] = V[vi][0]; verts[o + k * 3 + 1] = V[vi][1]; verts[o + k * 3 + 2] = V[vi][2]; });
  });
  return { vertices: verts, triCount: tris.length };
};

/* ---- 自交测试网格 ---- */
function closedCubeMesh() {   // 12 三角闭合立方体（28.5 VALID 基准件，含正常共享边/点）
  const V = [
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
    [0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100],
  ];
  return meshOf(V, [[0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [4, 5, 6], [4, 6, 7]]);
}
function crossTriMesh() {   // 大底三角(z=0) + 垂直三角(x=5) 明确穿越
  return meshOf(
    [[0, 0, 0], [10, 0, 0], [5, 10, 0], [5, 2, -5], [5, 8, -5], [5, 5, 5]],
    [[0, 1, 2], [3, 4, 5]]);
}
function openCubeMesh() {   // 开口立方体（28.5 构造）
  const V = [
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
    [0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100],
  ];
  return meshOf(V, [[0, 1, 2], [0, 2, 3], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]);
}
function nonManifoldMesh() {   // 双四面体焊接边（28.5 构造：非流形无自交）
  return meshOf(
    [[0, 0, 0], [100, 0, 0], [50, 100, 0], [50, 0, 100], [50, -100, 0], [50, 0, -100]],
    [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 2, 3], [0, 1, 4], [0, 4, 5], [0, 5, 1], [1, 4, 5]]);
}

export const tests = [
  // ================= A. P0-3 密度接线 =================
  {
    name: '28.6-A1 密度默认行为不变：无 USER_OVERRIDE → gating/riser 用内部表值',
    fn: () => {
      proj.reset();
      proj.set('material.family', '铸钢', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r = manifestOf('gating').calculate();
      assert(r && Math.abs(r.rho - MATERIALS['铸钢(ZG)'].rho) < 1e-9,
        `默认应沿用内部表 rho（实际 ${r?.rho} vs 表 ${MATERIALS['铸钢(ZG)'].rho}）`);
      proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 20, confidence: 0.9 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('process.mcHotspot', 20, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const rr = manifestOf('riser').calculate();
      assert(rr && Math.abs(rr.rhoUsed - 7.8) < 1e-9, `riser 默认应 7.8（铸钢固态，实际 ${rr?.rhoUsed}）`);
    },
  },
  {
    name: '28.6-A2 液态密度 USER_OVERRIDE → gating 生效（修复"改密度不生效"静默脱节）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '铸钢', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r0 = manifestOf('gating').calculate();
      proj.set('material.liquidDensity', 7.1, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const r1 = manifestOf('gating').calculate();
      assert(r1 && Math.abs(r1.rho - 7.1) < 1e-9, `USER_OVERRIDE 密度应生效（实际 ${r1?.rho}）`);
      assert(r1 && Math.abs(r1.A - r0.A) > 1e-6, `密度变化应传导到阻流面积 A（${r0.A} → ${r1.A}）`);
    },
  },
  {
    name: '28.6-A3 固态密度 USER_OVERRIDE → riser rhoUsed 生效',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.mcHotspot', 20, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 20, confidence: 0.9 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r0 = manifestOf('riser').calculate();
      // 28.7-A：球铁默认已批准为 7.1——覆盖值用 7.3 与默认区分（原 7.1 会与新默认相同而无法验证变化）
      proj.set('material.solidDensity', 7.3, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const r1 = manifestOf('riser').calculate();
      assert(r1 && Math.abs(r1.rhoUsed - 7.3) < 1e-9, `固态密度 USER_OVERRIDE 应生效（实际 ${r1?.rhoUsed}）`);
      assert(Math.abs(r1.rhoUsed - r0.rhoUsed) > 1e-9, 'rhoUsed 应随覆盖变化');
    },
  },
  {
    name: '28.6-A4 未知材料不再静默：gating/riser mdFellBack 标记（数值不变）',
    fn: () => {
      const g = runGating({ mat: '不存在材料', pw: 10 });
      assert(g.mdFellBack === true, 'gating 未知材料应标记 mdFellBack');
      assert(g.rho === 7.0, 'fallback 数值不变（灰铁 7.0，仅标记）');
      const r = runRiser({ mat: '不存在材料', mc_mode: 'direct', mc: 20, cast_wt: 10, shape: 'sphere_head', hd_ratio: 1.0 });
      assert(r && r.mdFellBack === true, 'riser 未知材料应标记 mdFellBack');
      assert(r.rhoUsed === 7.1, 'fallback 数值不变（球铁 7.1——28.7-A 定稿值，仅标记）');
      const g2 = runGating({ mat: '铸钢(ZG)', pw: 10 });
      assert(g2.mdFellBack === false, '已知材料不标记');
    },
  },
  // ================= B. R1 真实 STL 斜置验证 =================
  {
    name: '28.6-B1 ALR2510（真实热结件）0°/15°/30°/45°：热结不消失（5 个）、主 Mc 漂移 ≤20%、geomStatus VALID',
    fn: () => {
      const mesh0 = loadSTL('ALR2510塑料模具v1.stl');
      const base = runV3(mesh0);
      assert(base.status === HS_STATUS.OK && base.hotspots.length === 5, `基准应 5 热结（实际 ${base.status} ${base.hotspots.length}）`);
      const R = (deg) => rotAxis([0.577, 0.577, 0.577], deg);
      for (const deg of [15, 30, 45]) {
        const mesh = transform(mesh0, R(deg));
        const v = validateMesh(mesh);
        assert(deriveGeomStatus(v.issues) === 'VALID', `${deg}° 几何状态应 VALID`);
        const r = runV3(mesh);
        assert(r.status === HS_STATUS.OK && r.hotspots.length === 5,
          `${deg}° 旋转后应仍 5 热结（实际 ${r.status} ${r.hotspots.length} 个）`);
        const baseM = base.hotspots[0].peakModulus;
        const m = r.hotspots[0].peakModulus;
        assert(Math.abs(m - baseM) / baseM <= 0.20,
          `${deg}° 主 Mc 漂移 ${Math.abs(m - baseM) / baseM * 100}% 应 ≤20%（实测 ≤17%）`);
      }
    },
  },
  {
    name: '28.6-B2 cube50（真实均匀件）0°/15°/30°/45°：旋转不误报（NO_HOTSPOT）',
    fn: () => {
      const buf = readFileSync(path.join(ROOT, 'tests/golden/cube50.stl'));
      const cube = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      const R = (deg) => rotAxis([0.577, 0.577, 0.577], deg);
      for (const deg of [0, 15, 30, 45]) {
        const mesh = deg === 0 ? cube : transform(cube, R(deg));
        const r = runV3(mesh);
        assert(r.status === HS_STATUS.NO_HOTSPOT && r.hotspots.length === 0,
          `${deg}° 均匀件不应误报（实际 ${r.status} ${r.hotspots.length} 个）`);
      }
    },
  },
  // ================= C. P1-13 自交检测 =================
  {
    name: '28.6-C1 干净立方体（含正常共享边/点）：零自交、无 SELF 问题',
    fn: () => {
      const v = validateMesh(closedCubeMesh());
      assert(v.selfIntersections === 0, '干净立方体零自交');
      assert(!v.issues.some(i => i.code === 'SELF_INTERSECTION'), '不报 SELF_INTERSECTION');
    },
  },
  {
    name: '28.6-C2 交叉三角：SELF_INTERSECTION 独立检出（count=1，不并入其他问题）',
    fn: () => {
      const v = validateMesh(crossTriMesh());
      assert(v.issues.some(i => i.code === 'SELF_INTERSECTION'), '应报 SELF_INTERSECTION');
      assert(v.selfIntersections === 1, `自交计数应 1（实际 ${v.selfIntersections}）`);
      assert(v.issues.some(i => i.code === 'OPEN_MESH'), '开口问题独立共存（不合并）');
    },
  },
  {
    name: '28.6-C3 非流形（双四面体焊接）无自交：NON_MANIFOLD 报、SELF 不报（明确区分）',
    fn: () => {
      const v = validateMesh(nonManifoldMesh());
      assert(v.issues.some(i => i.code === 'NON_MANIFOLD_EDGE'), '应报 NON_MANIFOLD_EDGE');
      assert(v.selfIntersections === 0 && !v.issues.some(i => i.code === 'SELF_INTERSECTION'), '非流形不应误报自交');
    },
  },
  {
    name: '28.6-C4 开口立方体无自交：OPEN_MESH 报、SELF 不报（明确区分）',
    fn: () => {
      const v = validateMesh(openCubeMesh());
      assert(v.issues.some(i => i.code === 'OPEN_MESH'), '应报 OPEN_MESH');
      assert(v.selfIntersections === 0, '开口不应误报自交');
    },
  },
  {
    name: '28.6-C5 极小数值误差（间隔 1e-7 近平行三角）：不误报自交',
    fn: () => {
      const v = validateMesh(meshOf(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0.5, 0.5, 1e-7], [1.5, 0.5, 1e-7], [0.5, 1.5, 1e-7]],
        [[0, 1, 2], [3, 4, 5]]));
      assert(v.selfIntersections === 0, '近平行 1e-7 不应误报');
    },
  },
  {
    name: '28.6-C6 真实 STL 全链：ALR2510 零自交零截断（干净模型）',
    fn: () => {
      const v = validateMesh(loadSTL('ALR2510塑料模具v1.stl'));
      assert(v.selfIntersections === 0, '干净真实 STL 零自交');
      assert(v.selfTruncated === false, '不应截断');
    },
  },
  {
    name: '28.6-C7 大模型（HR4012 85812 tri）：不崩溃、结果明确（截断时如实标记）',
    fn: () => {
      const v = validateMesh(loadSTL('HR4012塑料模具v4最早大板.stl'));
      assert(v.selfIntersections === 0, 'HR4012 零自交');
      assert(typeof v.selfTruncated === 'boolean', '截断标记应为布尔（检测完成与否如实报告）');
      assert(!v.issues.some(i => i.code === 'SELF_INTERSECTION_UNCHECKED'), '实测未截断（<1M 候选对）');
    },
  },
  // ================= 状态语义 =================
  {
    name: '28.6-S1 自交 → deriveGeomStatus WARNING（五态语义保持：不因自交升 INVALID）',
    fn: () => {
      const v = validateMesh(crossTriMesh());
      assert(deriveGeomStatus(v.issues) === 'WARNING', '自交（warning 级）应派生 WARNING');
    },
  },
];
