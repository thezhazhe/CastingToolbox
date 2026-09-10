// ============================================================
// PHASE 29：STL 工艺设计中心 V1 可靠性（41.txt 九 A-N）
// 阶段一：旋转/坏网格/状态基线（修改前锁定现状行为）
//   1. 旋转：有热结模型任意旋转仍检出（状态不跳变）；均匀件旋转不误报
//   2. 坏网格：开口/缠绕翻转 → validateMesh 报 OPEN_MESH + 体积偏小
//   3. （门禁修复后）LOW_CONFIDENCE/INSUFFICIENT_RESOLUTION 不静默
// ============================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, transformMesh, rotX, rotY, rotZ } from './tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { validateMesh } from '../js/engine/meshValidation.js';
import { computeVolume } from '../js/engine/stl.js';
import { HS_STATUS } from '../js/engine/hotspot.js';
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST, allOptionalInputs } from '../calcs/calcManifest.js';

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

/**
 * 硬编码开口立方体（0~100，删顶面 2 三角）——tetMC 生成网格三角数不定（细分数百），
 * 删 2 三角体积几乎不变；用显式 10 三角网格保证 OPEN_MESH + 体积可控（5/6）。
 * 顶点: 0(0,0,0) 1(100,0,0) 2(100,100,0) 3(0,100,0) 4(0,0,100) 5(100,0,100) 6(100,100,100) 7(0,100,100)
 * 面: 底(0,1,2)(0,2,3) 前(0,1,5)(0,5,4) 右(1,2,6)(1,6,5) 后(2,3,7)(2,7,6) 左(3,0,4)(3,4,7)（顶面 4,5,6,7 删除）
 */
function openCubeMesh() {
  const V = [
    [0, 0, 0], [100, 0, 0], [100, 100, 0], [0, 100, 0],
    [0, 0, 100], [100, 0, 100], [100, 100, 100], [0, 100, 100],
  ];
  const tris = [
    [0, 1, 2], [0, 2, 3],   // 底面
    [0, 1, 5], [0, 5, 4],   // 前
    [1, 2, 6], [1, 6, 5],   // 右
    [2, 3, 7], [2, 7, 6],   // 后
    [3, 0, 4], [3, 4, 7],   // 左
  ];
  const verts = new Float32Array(tris.length * 9);
  tris.forEach(([a, b, c], i) => {
    const o = i * 9;
    [a, b, c].forEach((vi, k) => { verts[o + k * 3] = V[vi][0]; verts[o + k * 3 + 1] = V[vi][1]; verts[o + k * 3 + 2] = V[vi][2]; });
  });
  return { vertices: verts, triCount: tris.length };
}

/** 翻转一个三角的缠绕（交换 v1/v2 → 法向反转） */
function flippedTriMesh() {
  const g = generate('uniformCube', { size: 100 });
  const mesh = g.mesh;
  const out = new Float32Array(mesh.vertices);
  // 翻转第 1 个三角：v1 <-> v2
  for (let k = 0; k < 3; k++) {
    const a = out[9 + k], b = out[9 + 3 + k];
    out[9 + k] = b; out[9 + 3 + k] = a;
  }
  return { vertices: out, triCount: mesh.triCount };
}

export const tests = [
  // ================= R3 旋转：有热结模型（41.txt 九-H） =================
  {
    name: '29-R3-1 bossOnPlate 旋转不变：0°/90°三轴/30°Z/45°任意轴均检出热结（状态 OK）',
    fn: () => {
      const mesh0 = generate('bossOnPlate').mesh;
      const base = run(mesh0);
      assert(base.status === HS_STATUS.OK && base.hotspots.length >= 1,
        `基准应检出热结（实际 ${base.status} ${base.hotspots.length}）`);
      const cases = [
        ['RX90', transformMesh(mesh0, rotX(Math.PI / 2))],
        ['RY90', transformMesh(mesh0, rotY(Math.PI / 2))],
        ['RZ90', transformMesh(mesh0, rotZ(Math.PI / 2))],
        ['RZ30', transformMesh(mesh0, rotZ(Math.PI / 6))],
        ['R45arb', transformMesh(mesh0, rotAxis([0.577, 0.577, 0.577], 45))],
      ];
      for (const [name, mesh] of cases) {
        const r = run(mesh);
        assert(r.status === HS_STATUS.OK && r.hotspots.length >= 1,
          `${name} 旋转后应仍检出热结（实际 ${r.status} ${r.hotspots.length} 个，reason=${r.reason}）`);
        // M 漂移允许 ≤35%：任意轴旋转的体素离散误差（斜壁 char 低估实测 ~32%，见 PHASE29_REPORT R3 记录）。
        //   检测层（状态/数量/位置）必须稳定；M 数值漂移是采样精度限制（非逻辑错误），
        //   作为已知限制记录——冒口尺寸 ∝ M，斜置件建议结合工艺经验复核。
        const baseM = base.hotspots[0].peakModulus;
        const m = r.hotspots[0].peakModulus;
        assert(Math.abs(m - baseM) / baseM <= 0.35,
          `${name} M 漂移 ${Math.abs(m - baseM) / baseM * 100}% 应 ≤35%（${baseM} → ${m}）`);
      }
    },
  },
  // ================= R3 旋转：均匀件（41.txt 九-E） =================
  {
    name: '29-R3-2 uniformCube 旋转不变：0°/RX90/RZ30/R45 均 NO_HOTSPOT（不误报）',
    fn: () => {
      const g = generate('uniformCube', { size: 100 });
      const cases = [
        ['base', g.mesh],
        ['RX90', transformMesh(g.mesh, rotX(Math.PI / 2))],
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
  // ================= R2 坏网格（41.txt 九-A/B/C） =================
  {
    name: '29-R2-1 开口立方体：validateMesh 报 OPEN_MESH（warning），体积偏小 ~16.7%',
    fn: () => {
      const fullV = 100 * 100 * 100;
      const open = openCubeMesh();
      const v = validateMesh(open);
      assert(v.issues.some(i => i.code === 'OPEN_MESH'), '应报 OPEN_MESH');
      assert(v.closed === false, 'closed 应为 false');
      const openV = computeVolume(open.vertices, open.triCount);
      // 缺顶面 + 硬编码三角符号差异：断言"显著偏小"（0.4~0.9 区间，机制=有符号积分缺锥体；
      //   实测 0.667——开口网格体积不可信的具体量级依赖方向，工程结论=开口必须警示）
      assert(openV / fullV > 0.4 && openV / fullV < 0.9,
        `开口体积应显著偏小（0.4~0.9，实际 ${(openV / fullV).toFixed(3)}）`);
      // OPEN_MESH 是 warning 不是 error：ok 保持 true（现状行为锁定——门禁修后由调用方决定）
      assert(v.ok === true, 'OPEN_MESH 应为 warning 级（ok=true）');
    },
  },
  {
    name: '29-R2-2 缠绕翻转：体积偏小 + PHASE 28.5 起 INCONSISTENT_WINDING 检出（42.txt 五：缠绕检测确定性实现）',
    fn: () => {
      const full = generate('uniformCube', { size: 100 });
      const fullV = computeVolume(full.mesh.vertices, full.mesh.triCount);
      const flipped = flippedTriMesh();
      const v = validateMesh(flipped);
      assert(!v.issues.some(i => i.code === 'OPEN_MESH'), '缠绕翻转不触发 OPEN_MESH（边界未变）');
      // PHASE 28.5 升级：有向边拓扑检测缠绕冲突（28.5 前 validateMesh 无感——静默漏报已补）
      assert(v.issues.some(i => i.code === 'INCONSISTENT_WINDING'), '缠绕不一致应被检出（28.5-T1c 同断言）');
      const fV = computeVolume(flipped.vertices, flipped.triCount);
      assert(fV < fullV, `缠绕错体积应偏小（实际 ${fV} vs ${fullV}）`);
    },
  },
  {
    name: '29-R2-3 INVALID 网格（空三角）→ V3 返回 INSUFFICIENT_RESOLUTION（不崩溃）',
    fn: () => {
      // validateMesh error 级立即返回，不触碰 geometry（null 安全）
      const r = analyzeHotspotsV3({ vertices: new Float32Array(0), triCount: 0 }, null);
      assert(r.status === HS_STATUS.INSUFFICIENT_RESOLUTION, `空网格应 INSUFFICIENT_RESOLUTION（实际 ${r.status}）`);
      assert(r.hotspots.length === 0, '无热结');
    },
  },
  // ================= G1 门禁（41.txt 五/六：P1-35 不静默） =================
  {
    name: '29-G1-1 分析失败 → riser blocked(analysis_failed)：绝不 wallHot 兜底、不静默 null',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.wallHot', 12, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      proj.set('hotspots.status', 'INSUFFICIENT_RESOLUTION', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.reason', 'no_inside_points', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r = manifestOf('riser').calculate();
      assert(r && r.blocked === true && r.reason === 'analysis_failed',
        `应 blocked(analysis_failed)（实际 ${JSON.stringify(r)?.slice(0, 100)}）`);
      assert(typeof r.note === 'string' && r.note.includes('人工输入'), '应提示人工输入入口');
      // chill 同门禁
      const c = manifestOf('chill').calculate();
      assert(c && c.blocked === true && c.reason === 'analysis_failed', `chill 应同样 blocked（实际 ${JSON.stringify(c)?.slice(0, 80)}）`);
    },
  },
  {
    name: '29-G1-2 LOW_CONFIDENCE → riser blocked(low_confidence)；NO_HOTSPOT(真均匀) → wallHot 兜底+note',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.wallHot', 12, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      // LOW_CONFIDENCE：有候选但 mcHotspot 未写（0）——修复前 riser 静默 null（P1-35）
      proj.set('hotspots.status', 'LOW_CONFIDENCE', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 20, confidence: 0.4 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r = manifestOf('riser').calculate();
      assert(r && r.blocked === true && r.reason === 'low_confidence',
        `LOW_CONFIDENCE 应 blocked（实际 ${JSON.stringify(r)?.slice(0, 100)}）——修复前此处静默 null`);
      // 用户显式 Mc（人工输入入口）→ 放行
      proj.set('process.mcHotspot', 15, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const r2 = manifestOf('riser').calculate();
      assert(r2 && !r2.blocked && Math.abs(r2.Mc - 15) < 1e-9,
        `用户显式 Mc 应放行（实际 ${JSON.stringify(r2)?.slice(0, 80)}）`);
      // NO_HOTSPOT（真均匀件）→ wallHot 兜底 + note 标注（合理兜底，非静默）
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.wallHot', 12, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      proj.set('hotspots.status', 'NO_HOTSPOT', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r3 = manifestOf('riser').calculate();
      assert(r3 && !r3.blocked && Math.abs(r3.Mc - 12) < 1e-9, 'NO_HOTSPOT 应 wallHot 兜底计算');
      assert(r3.note && r3.note.includes('主体壁厚'), `应标注估算来源 note（实际 ${r3.note}）`);
    },
  },
  // ================= G2 optionalInputs 生命周期（41.txt 三 P1-40） =================
  {
    name: '29-G2-1 allOptionalInputs：只收集 param 非 null 且缺失的；param=null 归独立计算器',
    fn: () => {
      proj.reset();
      // riser：shape/hd_ratio 是 scope=calculator → 不收集
      const opts = allOptionalInputs(['riser', 'gating', 'shakeout']);
      const inputs = opts.map(p => p.input);
      assert(!inputs.includes('shape') && !inputs.includes('hd_ratio'), 'riser shape/hd 应归独立计算器');
      assert(!inputs.includes('mode') && !inputs.includes('importance'), 'shakeout mode/importance 应归独立计算器');
      assert(inputs.includes('rh'), 'gating riserHeight（param 非 null）应收集（有回写值也应可调）');
      assert(inputs.includes('yr'), 'gating 出品率应收集（有默认 75 也应可调——optional 语义非"缺失才填"）');
      // riserHeight 已有回写值（CALC_RESULT）也应收集（用户可改 → USER_OVERRIDE 防覆盖）
      proj.set('process.riserHeight', 240, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
      const opts2 = allOptionalInputs(['gating']);
      assert(opts2.some(p => p.input === 'rh'), 'riserHeight 有回写值也应出现在高级区（可改）');
      // gating 死参数 qty 已删除
      const g = CALC_MANIFEST.find(c => c.id === 'gating');
      assert(!g.optionalInputs.some(p => p.input === 'qty'), 'qty 死参数应已删除');
    },
  },
  {
    name: '29-G2-2 machining method 接线：默认/键名/熔模/无标准均明确',
    fn: () => {
      proj.reset();
      proj.set('material.family', '灰铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.size', [300, 200, 100], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 默认（未设 method）→ 砂型 · 机器造型/壳型（E~G）
      const r1 = manifestOf('machining').calculate();
      assert(r1 && Array.isArray(r1.grades) && r1.grades.length, `默认应出等级（实际 ${JSON.stringify(r1)?.slice(0, 80)}）`);
      // 熔模 → 现行标准（GB/T 6414-2017 / GB/T 42124.3-2025 附录）建议 RMAG E → 正常出 E 级（57.txt 修正）
      proj.set('production.method', '熔模', proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      const r2 = manifestOf('machining').calculate();
      assert(r2 && !r2.unsupported && r2.grades.includes('E') && r2.methodLabel === '熔模铸造', `熔模应出 RMAG E（实际 ${JSON.stringify(r2)?.slice(0, 80)}）`);
      // 压力铸造 × 灰铁 → 无标准（'—'）→ 明确提示
      proj.set('production.method', '压力铸造', proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      const r3 = manifestOf('machining').calculate();
      assert(r3 && r3.unsupported === true, `压力×灰铁应无标准提示（实际 ${JSON.stringify(r3)?.slice(0, 80)}）`);
      // 压力铸造 × 铝合金 → B~D 正常
      proj.set('material.family', '铝合金', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      const r4 = manifestOf('machining').calculate();
      assert(r4 && !r4.unsupported && r4.grades.includes('B'), `铝×压力应 B~D（实际 ${JSON.stringify(r4)?.slice(0, 80)}）`);
    },
  },
];

/** manifest 计算器查找（测试本地别名） */
function manifestOf(id) { return CALC_MANIFEST.find(c => c.id === id); }
