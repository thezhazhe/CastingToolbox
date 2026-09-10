// ============================================================
// PHASE 28.5：STL 可靠性闸门（42.txt）
// 四类核心回归：
//   TEST 1 坏网格：OPEN_MESH/非流形/缠绕 → 识别 + 不静默 + 结构化状态
//   TEST 2 LOW_CONFIDENCE：project → riser 全链透传（禁 mcHotspot=0 → 自动冒口）
//   TEST 3 热结旋转：0°/15°/30°/45° 主要热结不消失
//   TEST 4 失败安全：analysis failed → 不产生正常自动冒口建议
// 附加：deriveGeomStatus / reliabilityLevel / geomStatus 生命周期
// ============================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, transformMesh, rotZ } from './tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { validateMesh, deriveGeomStatus } from '../js/engine/meshValidation.js';
import { HS_STATUS } from '../js/engine/hotspot.js';
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST, reliabilityLevel } from '../calcs/calcManifest.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** 运行 V3：mesh → BVH geometry → analyze */
const run = (mesh, opts = {}) => {
  const geometry = buildMesh(mesh).geometry;
  return analyzeHotspotsV3(mesh, geometry, opts);
};

/** 绕任意轴（单位向量）旋转 deg 的 Rodrigues 变换 */
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

/** 由顶点表+三角索引表构造非索引 mesh（与 phase29 openCubeMesh 同模式） */
function meshOf(V, tris) {
  const verts = new Float32Array(tris.length * 9);
  tris.forEach(([a, b, c], i) => {
    const o = i * 9;
    [a, b, c].forEach((vi, k) => { verts[o + k * 3] = V[vi][0]; verts[o + k * 3 + 1] = V[vi][1]; verts[o + k * 3 + 2] = V[vi][2]; });
  });
  return { vertices: verts, triCount: tris.length };
}

/**
 * 开口立方体（0~100，删顶面）——与 phase29_test 相同构造：OPEN_MESH + 体积偏小
 */
function openCubeMesh() {
  const V = [
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
    [0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100],
  ];
  const tris = [
    [0, 1, 2], [0, 2, 3], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return meshOf(V, tris);
}

/**
 * 非流形（c=4 双四面体焊接边）：两个四面体共享一条边 (a,b)——奇偶法（c%2===1）漏报的盲区
 * （c=4 偶数 → boundaryEdges=0 → 修复前静默通过）。其余边在各自四面体内闭合（c=2）。
 * 顶点: a(0,0,0) b(100,0,0)；四面体1 c1/d1，四面体2 c2/d2
 */
function nonManifoldMesh() {
  const V = [
    [0, 0, 0], [100, 0, 0],
    [50, 100, 0], [50, 0, 100],   // 四面体1
    [50, -100, 0], [50, 0, -100], // 四面体2
  ];
  const tris = [
    [0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 2, 3],
    [0, 1, 4], [0, 4, 5], [0, 5, 1], [1, 4, 5],
  ];
  return meshOf(V, tris);
}

/**
 * 闭合干净立方体（12 三角，顶面补齐 openCubeMesh）——VALID 基准件。
 * 有向边两两配对（绕向一致），无退化/无非流形/无缠绕冲突。
 */
function closedCubeMesh() {
  const V = [
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
    [0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100],
  ];
  // 底面绕向反向（(0,2,1)/(0,3,2)）——否则与侧面共享边同向（29-R2-1 开口构造遗留瑕疵，
  //   旧 validateMesh 不查缠绕所以从未暴露；本构造作为 VALID 基准必须绕向一致）
  const tris = [
    [0, 2, 1], [0, 3, 2], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [4, 5, 6], [4, 6, 7],
  ];
  return meshOf(V, tris);
}

/** 翻转一个三角的缠绕（交换 v1/v2）——相邻三角同向共享边 → 缠绕不一致 */
function flippedTriMesh() {
  const g = generate('uniformCube', { size: 100 });
  const out = new Float32Array(g.mesh.vertices);
  for (let k = 0; k < 3; k++) {
    const a = out[9 + k], b = out[9 + 3 + k];
    out[9 + k] = b; out[9 + 3 + k] = a;
  }
  return { vertices: out, triCount: g.mesh.triCount };
}

/** manifest 计算器查找（测试本地别名） */
const manifestOf = (id) => CALC_MANIFEST.find(c => c.id === id);

/** riser 计算前置：材料+毛坯重+wallHot（门禁相关字段独立设置） */
function riserSetup() {
  proj.reset();
  proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('process.wallHot', 12, proj.SRC.DERIVED, proj.CONF.MEDIUM);
}

export const tests = [
  // ================= TEST 1：坏网格（42.txt 九 TEST 1） =================
  {
    name: '28.5-T1a 开口立方体：OPEN_MESH 识别 + deriveGeomStatus=WARNING（可继续但标注，不静默）',
    fn: () => {
      const open = openCubeMesh();
      const v = validateMesh(open);
      assert(v.issues.some(i => i.code === 'OPEN_MESH'), '应报 OPEN_MESH');
      assert(v.closed === false, 'closed 应为 false');
      assert(deriveGeomStatus(v.issues) === 'WARNING', 'OPEN_MESH 应派生 WARNING（非 INVALID——可继续但体积仅供参考）');
      // 结构化状态写 project 后可查（42.txt 五：不把错误体积当正常体积——WARNING 语义=标注不可全信）
      proj.reset();
      proj.set('geometry.geomStatus', deriveGeomStatus(v.issues), proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      assert(proj.getV('geometry.geomStatus') === 'WARNING', 'geomStatus 应可写入 project');
    },
  },
  {
    name: '28.5-T1b 非流形 c=4（双四面体焊接边）：NON_MANIFOLD_EDGE 检出——补奇偶法盲区（边界 0 也报）',
    fn: () => {
      const m = nonManifoldMesh();
      const v = validateMesh(m);
      // 两个四面体共享边 (a,b)：无向计数 c=4（偶数）→ boundaryEdges=0——修复前奇偶法静默通过
      assert(v.boundaryEdges === 0, 'c=4 无边界的奇偶判据（修复前盲区）');
      assert(v.issues.some(i => i.code === 'NON_MANIFOLD_EDGE'), '应报 NON_MANIFOLD_EDGE（非流形边）');
      assert(v.nonManifoldEdges === 1, '非流形边计数应为 1');
      assert(deriveGeomStatus(v.issues) === 'WARNING', '非流形应派生 WARNING');
    },
  },
  {
    name: '28.5-T1c 缠绕翻转：INCONSISTENT_WINDING 检出（修复前 validateMesh 无感）',
    fn: () => {
      const flipped = flippedTriMesh();
      const v = validateMesh(flipped);
      assert(v.issues.some(i => i.code === 'INCONSISTENT_WINDING'), '应报 INCONSISTENT_WINDING（缠绕不一致）');
      assert(v.windingConflicts >= 1, '冲突计数应 ≥1');
      assert(deriveGeomStatus(v.issues) === 'WARNING', '缠绕不一致应派生 WARNING');
    },
  },
  {
    name: '28.5-T1d 空网格 → deriveGeomStatus=INVALID；自建干净立方体 → VALID',
    fn: () => {
      assert(deriveGeomStatus([{ level: 'error', code: 'NO_TRIANGLES', msg: '' }]) === 'INVALID', 'error 级应派生 INVALID');
      assert(deriveGeomStatus([]) === 'VALID', '无问题应派生 VALID');
      // 自建 12 三角闭合立方体（tetMC 生成器网格本身带退化面——生成器特性，不用作 VALID 基准）
      const cube = closedCubeMesh();
      const v = validateMesh(cube);
      assert(v.issues.length === 0, `干净立方体应零问题（实际 ${v.issues.map(i => i.code).join(',')}）`);
      assert(deriveGeomStatus(v.issues) === 'VALID', '正常封闭网格应 VALID');
    },
  },
  {
    name: '28.5-T1e 几何 WARNING 不阻止计算但标注：riser 正常 + level=WARNING_REVIEW（42.txt 十）',
    fn: () => {
      riserSetup();
      proj.set('geometry.geomStatus', 'WARNING', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 20, confidence: 0.9 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('process.mcHotspot', 20, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r = manifestOf('riser').calculate();
      assert(r && !r.blocked, '几何 WARNING 不阻止计算（warning 级）');
      assert(r.level === 'WARNING_REVIEW', `几何 WARNING + 有热结应 WARNING_REVIEW（实际 ${r.level}）`);
    },
  },
  // ================= TEST 2：LOW_CONFIDENCE 全链透传（42.txt 九 TEST 2） =================
  {
    name: '28.5-T2 LOW_CONFIDENCE：status→project→riser 完整保留，blocked+BLOCK_AUTO_RECOMMEND；禁 mcHotspot=0→自动冒口',
    fn: () => {
      riserSetup();
      proj.set('hotspots.status', 'LOW_CONFIDENCE', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.reason', 'all_low_confidence', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 20, confidence: 0.4 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      // 全链：project 状态读回完整（42.txt 七：每一步都不能把 LOW_CONFIDENCE 吞掉）
      assert(proj.getV('hotspots.status') === 'LOW_CONFIDENCE', 'project 状态应保留');
      assert(proj.getV('hotspots.items')[0].confidence === 0.4, '候选 confidence 应透传');
      const r = manifestOf('riser').calculate();
      assert(r && r.blocked === true && r.reason === 'low_confidence', `应 blocked(low_confidence)（实际 ${JSON.stringify(r)?.slice(0, 90)}）`);
      assert(r.level === 'BLOCK_AUTO_RECOMMEND', `level 应 BLOCK_AUTO_RECOMMEND（实际 ${r.level}）`);
      // 禁止路径：LOW_CONFIDENCE → mcHotspot=0 → 正常自动冒口（r 必须无正常结果字段）
      assert(r.Mc === undefined && r.Vr === undefined, 'blocked 不得携带正常冒口结果字段');
      // 人工放行入口：用户显式 Mc → 正常计算 + WARNING_REVIEW
      proj.set('process.mcHotspot', 15, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const r2 = manifestOf('riser').calculate();
      assert(r2 && !r2.blocked && Math.abs(r2.Mc - 15) < 1e-9, '用户显式 Mc 应放行');
      assert(r2.level === 'WARNING_REVIEW', `人工放行应 WARNING_REVIEW（实际 ${r2.level}）`);
    },
  },
  // ================= TEST 3：热结旋转 0°/15°/30°/45°（42.txt 九 TEST 3） =================
  {
    name: '28.5-T3a bossOnPlate 旋转 0°/15°Z/30°Z/45°任意轴：主要热结不消失（状态 OK、M 漂移≤35%）',
    fn: () => {
      const mesh0 = generate('bossOnPlate').mesh;
      const base = run(mesh0);
      assert(base.status === HS_STATUS.OK && base.hotspots.length >= 1, `基准应检出热结（实际 ${base.status}）`);
      const cases = [
        ['RZ15', transformMesh(mesh0, rotZ(Math.PI / 12))],
        ['RZ30', transformMesh(mesh0, rotZ(Math.PI / 6))],
        ['R45arb', transformMesh(mesh0, rotAxis([0.577, 0.577, 0.577], 45))],
      ];
      for (const [name, mesh] of cases) {
        const r = run(mesh);
        assert(r.status === HS_STATUS.OK && r.hotspots.length >= 1,
          `${name} 旋转后应仍检出热结（实际 ${r.status} ${r.hotspots.length} 个）`);
        const baseM = base.hotspots[0].peakModulus;
        const m = r.hotspots[0].peakModulus;
        assert(Math.abs(m - baseM) / baseM <= 0.35,
          `${name} M 漂移 ${Math.abs(m - baseM) / baseM * 100}% 应 ≤35%（体素离散已知限制）`);
      }
    },
  },
  {
    name: '28.5-T3b uniformCube 旋转 0°/15°/30°/45°：均匀件不误报（NO_HOTSPOT）',
    fn: () => {
      const g = generate('uniformCube', { size: 100 });
      const cases = [
        ['base', g.mesh],
        ['RZ15', transformMesh(g.mesh, rotZ(Math.PI / 12))],
        ['RZ30', transformMesh(g.mesh, rotZ(Math.PI / 6))],
        ['R45arb', transformMesh(g.mesh, rotAxis([0.577, 0.577, 0.577], 45))],
      ];
      for (const [name, mesh] of cases) {
        const r = run(mesh);
        assert(r.status === HS_STATUS.NO_HOTSPOT && r.hotspots.length === 0,
          `${name} 均匀件不应误报热结（实际 ${r.status} ${r.hotspots.length} 个）`);
      }
    },
  },
  // ================= TEST 4：真实失败安全（42.txt 九 TEST 4） =================
  {
    name: '28.5-T4 分析失败（INSUFFICIENT_RESOLUTION）：riser/chill 均 blocked——不产生正常自动冒口建议',
    fn: () => {
      riserSetup();
      proj.set('geometry.geomStatus', 'VALID', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('hotspots.status', 'INSUFFICIENT_RESOLUTION', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.reason', 'no_inside_points', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r = manifestOf('riser').calculate();
      assert(r && r.blocked === true && r.reason === 'analysis_failed', `riser 应 blocked(analysis_failed)（实际 ${JSON.stringify(r)?.slice(0, 90)}）`);
      assert(r.level === 'BLOCK_AUTO_RECOMMEND', 'level 应 BLOCK_AUTO_RECOMMEND');
      assert(r.Mc === undefined && r.Vr === undefined && r.D === undefined, 'blocked 不得携带任何正常冒口字段');
      assert(r.note.includes('人工输入'), '应提示人工输入入口');
      const c = manifestOf('chill').calculate();
      assert(c && c.blocked === true && c.level === 'BLOCK_AUTO_RECOMMEND', 'chill 应同样 blocked');
    },
  },
  // ================= 可靠性等级纯函数（42.txt 十） =================
  {
    name: '28.5-L1 reliabilityLevel 映射：INVALID/失败/低置信 → BLOCK；ok+VALID → SAFE；均匀/手动/几何警告 → WARNING_REVIEW',
    fn: () => {
      assert(reliabilityLevel({ geomStatus: 'INVALID', hsStatus: 'ok' }) === 'BLOCK_AUTO_RECOMMEND', '几何 INVALID 应 BLOCK');
      assert(reliabilityLevel({ geomStatus: 'VALID', hsStatus: 'INSUFFICIENT_RESOLUTION' }) === 'BLOCK_AUTO_RECOMMEND', '分析失败应 BLOCK');
      assert(reliabilityLevel({ geomStatus: 'VALID', hsStatus: 'LOW_CONFIDENCE' }) === 'BLOCK_AUTO_RECOMMEND', '低置信应 BLOCK');
      assert(reliabilityLevel({ geomStatus: 'VALID', hsStatus: 'ok' }) === 'SAFE_TO_RECOMMEND', 'VALID+ok 应 SAFE');
      assert(reliabilityLevel({ geomStatus: 'WARNING', hsStatus: 'ok' }) === 'WARNING_REVIEW', '几何警告+ok 应 WARNING_REVIEW');
      assert(reliabilityLevel({ geomStatus: 'VALID', hsStatus: 'NO_HOTSPOT' }) === 'WARNING_REVIEW', '均匀件 wallHot 估算应 WARNING_REVIEW');
      assert(reliabilityLevel({ geomStatus: 'VALID', hsStatus: 'none' }) === 'WARNING_REVIEW', '手动模式应 WARNING_REVIEW');
    },
  },
  // ================= geomStatus 生命周期（42.txt 五：字段消费者一致） =================
  {
    name: '28.5-G1 geomStatus 生命周期：clearStlBoundData 清回 VALID（与其他 STL 绑定字段一致）',
    fn: () => {
      riserSetup();
      proj.set('geometry.geomStatus', 'WARNING', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const cleared = proj.clearStlBoundData();
      assert(cleared.includes('geometry.geomStatus'), '替换 STL 时应清理 geomStatus');
      assert(proj.getV('geometry.geomStatus') === 'VALID', '清理后应回默认 VALID');
    },
  },
];
