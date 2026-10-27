// ============================================================
// PHASE V2.0-04（102.txt §八~§十二）· Hotspot Local Volume 实验运行器
//
// 候选算法（§十七.2）：
//   Hotspot V3 → Region Centroid → Cube(L = K×Mc) → STL ∩ Cube
//              → Connected Component(含 hotspot) → Vc_local
//
// ★ 命名纪律（§十六）：本实验输出一律叫 **Hotspot Local Volume / 热结局部体积**，
//   严禁叫 Feeding Zone / 补缩区体积 / 实际补缩体积——本实验只能证明
//   "它是 Hotspot 附近一个几何局部体积的近似"。
//
// ★ 不修改任何生产代码。实验参数全部经 opts 传入或在本文件内定义。
//
// 用法：node tests/experiments/run_hotspot_local_volume.mjs [--quick]
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSTL, computeVolume, computeBounds } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';
import { prepareMesh, cubeIntersectVolume } from './hotspotLocalVolume.js';
import { BOX, subtract, union, tetMC } from '../helpers/stlGen.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT_DIR = join(HERE, 'out');

const KS = [2, 3, 4, 5, 6, 8, 10];
const QUICK = process.argv.includes('--quick');

/* ================= 旋转（严格 90°，坐标置换 → 浮点精确） ================= */
/** 绕 X 轴 90°：(x,y,z)→(x,−z,y)；绕 Y：(x,y,z)→(z,y,−x)；绕 Z：(x,y,z)→(−y,x,z) */
const ROT = {
  X: (x, y, z) => [x, -z, y],
  Y: (x, y, z) => [z, y, -x],
  Z: (x, y, z) => [-y, x, z],
};
function rotateMesh(mesh, axis) {
  if (!axis) return mesh;
  const f = ROT[axis];
  const src = mesh.vertices;
  const v = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const [a, b, c] = f(src[i], src[i + 1], src[i + 2]);
    v[i] = a; v[i + 1] = b; v[i + 2] = c;
  }
  return { vertices: v, triCount: mesh.triCount };
}

/* ================= 标准几何（§九）：用 stlGen 在内存里生成，不落盘 ================= */
const plate = (l, w, t) => BOX([-l / 2, -w / 2, -t / 2], [l / 2, w / 2, t / 2]);
const boxBoss = (ox, oy, topZ, bL, bW, bH) => BOX([ox - bL / 2, oy - bW / 2, topZ], [ox + bL / 2, oy + bW / 2, topZ + bH]);

/** §九 五类标准几何（全部极简解析体，无工业件） */
const STD = {
  // ① 均匀板（薄 / 中 / 厚）——§十四 薄壁 vs 厚块对照
  uniformPlate10: { sdf: plate(400, 400, 10), bounds: [[-205, -205, -10], [205, 205, 10]], res: 72, analytic: true },
  uniformPlate20: { sdf: plate(400, 400, 20), bounds: [[-205, -205, -15], [205, 205, 15]], res: 72, analytic: true },
  uniformPlate40: { sdf: plate(400, 400, 40), bounds: [[-205, -205, -25], [205, 205, 25]], res: 72, analytic: true },
  // ② 中央厚块：20mm 板 + 中央 100mm 厚块（恰好相接、不重叠 → 并集表面干净）
  centralBoss: {
    sdf: union(plate(200, 200, 20), boxBoss(0, 0, 10, 100, 100, 100)),
    bounds: [[-105, -105, -15], [105, 105, 115]], res: 72,
  },
  // ③ 长条厚块：200×60×60 单一长厚块
  longBar: {
    sdf: BOX([-100, -30, -30], [100, 30, 30]),
    bounds: [[-105, -35, -35], [105, 35, 35]], res: 64,
  },
  // ④ 厚薄过渡：左 20 厚薄板 + 右 60 厚块
  stepThickness: {
    sdf: subtract(BOX([-80, -30, -40], [80, 30, 40]), BOX([-80, 10, -40], [-40, 30, 40])),
    bounds: [[-85, -35, -45], [85, 35, 45]], res: 64,
  },
  // ⑤ 两个局部厚区：两块 60 厚块 + 10 厚薄桥
  twoThick: {
    sdf: subtract(BOX([-80, -30, -30], [80, 30, 30]), BOX([-20, 5, -30], [20, 30, 30]), BOX([-20, -30, -30], [20, -5, 30])),
    bounds: [[-85, -35, -35], [85, 35, 35]], res: 72,
  },
};

/** 解析受控件（均匀件无热结 → 用解析中心 + 解析局部模数；明确标注 source=analytic） */
const ANALYTIC_CASES = [
  { key: 'uniformPlate10', mc: 5.0, note: '大平板中心局部 V/A → t/2 = 10/2' },
  { key: 'uniformPlate20', mc: 10.0, note: '大平板中心局部 V/A → t/2 = 20/2' },
  { key: 'uniformPlate40', mc: 20.0, note: '大平板中心局部 V/A → t/2 = 40/2' },
];

/* ================= 真实件（§十） ================= */
const REAL = [
  ['HR4012', join(ROOT, 'tests', 'real-stl', 'HR4012塑料模具v4最早大板.stl')],
  ['ALR2510', join(ROOT, 'tests', 'real-stl', 'ALR2510塑料模具v1_1.stl')],
];
const REAL_3 = [...REAL, ['ALHR4510', join(ROOT, 'tests', 'real-stl', 'ALHR4510塑料模具v2-2.1.stl')]];
const ENG = [
  ['t02_thin10_boss60', join(ROOT, 'tests', 'engineering-generated', 'models', 't02_thin10_boss60', 'model.stl')],
  ['t01_boss100', join(ROOT, 'tests', 'engineering-generated', 'models', 't01_boss100', 'model.stl')],
];

/* ================= 工具 ================= */
const loadSTL = (p) => { const b = readFileSync(p); return parseSTL(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const f3 = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(d) : null);

/** hotspot 的 cube 中心来源：region centroid（isInside 通过）vs peak point（回退） */
function centerOf(h) {
  const m = /@\(([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(h.geometrySource || '');
  if (!m) return { center: h.position, source: 'unknown', peakPt: null };
  const peak = [+m[1], +m[2], +m[3]];
  const d = Math.hypot(h.position[0] - peak[0], h.position[1] - peak[1], h.position[2] - peak[2]);
  // representativePoint：centroid 通过 isInside 时 position=centroid（与 peak 不同）；
  // 否则回退 sample.pts[region.pts[0]] = peak point → 两者重合
  return { center: h.position, source: d < 1e-6 ? 'peak_fallback' : 'region_centroid', peakPt: peak };
}

/** hotspot → 对应细化区域的 stride（用于还原 V_region_old） */
function strideFor(h, debug) {
  const m = /@\(([-\d.]+),([-\d.]+),([-\d.]+)\)/.exec(h.geometrySource || '');
  if (!m) return null;
  const pk = [+m[1], +m[2], +m[3]];
  for (const rf of (debug?.refine || [])) {
    for (const p of (rf.peaks || [])) {
      if (Math.hypot(p.pt[0] - pk[0], p.pt[1] - pk[1], p.pt[2] - pk[2]) < 0.15) {
        return Math.max(1, Math.ceil(Math.cbrt(rf.gs ** 3 / V3_DEFAULTS.refineMaxPoints)));
      }
    }
  }
  return null;
}

/* ================= 单例分析 ================= */
function analyzeCase(label, mesh, rotation, cases, rows, warnLog) {
  const rm = rotateMesh(mesh, rotation);
  const geometry = buildMesh(rm).geometry;
  const t0 = Date.now();
  const v3 = analyzeHotspotsV3(rm, geometry);
  const v3Ms = Date.now() - t0;
  const wholeV = computeVolume(rm.vertices, rm.triCount);
  const bounds = computeBounds(rm.vertices, rm.triCount);

  const ctx = prepareMesh(rm);
  const hsOut = [];
  for (const h of v3.hotspots) {
    const { center, source } = centerOf(h);
    if (source !== 'region_centroid') {
      warnLog.push(`${label}/${rotation || 'orig'} H${h.hotspotId}: WARNING center 非 region centroid（${source}）——§六 要求记录并谨慎对待`);
    }
    const stride = strideFor(h, v3.debug);
    const rec = {
      case: label, rotation: rotation || 'orig', hotspotId: h.hotspotId,
      source: 'v3-hotspot', centerSource: source,
      mc: f3(h.peakModulus), centroid: center.map(v => f3(v, 2)),
      confidence: f3(h.confidence, 4), scaleStability: f3(h.scaleStability, 4),
      stride, v3Ms,
      vRegionFixed: f3(h.regionVolume, 3),
      vRegionOld: stride ? f3(h.regionVolume / stride ** 3, 3) : null,
      regionRatioFixed: f3(wholeV > 0 ? h.regionVolume / wholeV : 0, 5),
      vRegionRatioOld: stride && wholeV > 0 ? f3(h.regionVolume / stride ** 3 / wholeV, 5) : null,
      vWholeCasting: f3(wholeV, 1),
      modelVolumeCm3: f3(wholeV / 1000, 1),
      boundsSize: bounds.size.map(v => f3(v, 1)),
      hots: [],
    };
    for (const K of KS) {
      const side = K * h.peakModulus;
      const r = cubeIntersectVolume(ctx, center, side);
      rec.hots.push({
        K, cubeSide: f3(side, 3),
        vLocalSTL: f3(r.volume, 3),
        fillRatio: f3(r.fillRatio, 5),
        ratioLocalToWhole: f3(wholeV > 0 ? r.volume / wholeV : 0, 6),
        ratioLocalToRegionFixed: h.regionVolume > 0 ? f3(r.volume / h.regionVolume, 4) : null,
        ratioLocalToRegionOld: stride && h.regionVolume > 0 ? f3(r.volume / (h.regionVolume / stride ** 3), 4) : null,
        componentCount: r.componentCount, keptComponents: r.keptComponents,
        warnings: r.warnings,
      });
    }
    hsOut.push(rec);
    rows.push(rec);
  }
  return { label, rotation: rotation || 'orig', status: v3.status, reason: v3.reason, hotspots: hsOut, v3Ms, wholeV, modelVolumeCm3: f3(wholeV / 1000, 1), boundsSize: bounds.size.map(v => f3(v, 1)) };
}

/** 解析受控件：中心 + 解析 Mc（§九 均匀板：V3 按设计不报热结） */
function analyzeAnalytic(label, mesh, mcDef, rows) {
  const wholeV = computeVolume(mesh.vertices, mesh.triCount);
  const b = computeBounds(mesh.vertices, mesh.triCount);
  const center = b.center;
  const ctx = prepareMesh(mesh);
  const rec = {
    case: label, rotation: 'orig', hotspotId: 1,
    source: 'analytic', centerSource: 'bbox_center',
    mc: mcDef.mc, centroid: center.map(v => f3(v, 2)),
    confidence: null, scaleStability: null, stride: null,
    vRegionFixed: null, vRegionOld: null, regionRatioFixed: null, vRegionRatioOld: null,
    vWholeCasting: f3(wholeV, 1), modelVolumeCm3: f3(wholeV / 1000, 1),
    boundsSize: b.size.map(v => f3(v, 1)),
    analyticNote: mcDef.note,
    hots: [],
  };
  for (const K of KS) {
    const side = K * mcDef.mc;
    const r = cubeIntersectVolume(ctx, center, side);
    rec.hots.push({
      K, cubeSide: f3(side, 3), vLocalSTL: f3(r.volume, 3), fillRatio: f3(r.fillRatio, 5),
      ratioLocalToWhole: f3(wholeV > 0 ? r.volume / wholeV : 0, 6),
      ratioLocalToRegionFixed: null, ratioLocalToRegionOld: null,
      componentCount: r.componentCount, keptComponents: r.keptComponents, warnings: r.warnings,
      analyticPrediction: analyticFill(label, mcDef.mc, K, b.size),
    });
  }
  rows.push(rec);
  return { label, rotation: 'orig', status: 'ANALYTIC', reason: null, hotspots: [rec], wholeV, modelVolumeCm3: f3(wholeV / 1000, 1), boundsSize: b.size.map(v => f3(v, 1)) };
}

/** 均匀板解析预测：cube 完整穿过板厚 → V = t·L²（L≥t 时），fillRatio = t/L */
function analyticFill(label, mc, K, size) {
  const t = Math.min(size[0], size[1], size[2]);
  const L = K * mc;
  if (L < t) return null;                    // 盒子埋在板内 → V = L³
  const area = Math.min(L, size[0]) * Math.min(L, size[1]);
  return { V: +(t * area).toFixed(3), fillRatio: +(t * area / L ** 3).toFixed(5) };
}

/* ================= 主流程 ================= */
const rows = [];
const caseSummaries = [];
const warnLog = [];
const tAll = Date.now();
const say = (m) => process.stdout.write(m + '\n');

say(`══ Hotspot Local Volume 实验（PHASE V2.0-04）══  K = ${KS.join(',')}`);
say(`判据阈值（未修改）：regionVolumeMaxRatio=${V3_DEFAULTS.regionVolumeMaxRatio} refineMaxPoints=${V3_DEFAULTS.refineMaxPoints}`);

/* --- ① 标准几何（stlGen 内存生成） --- */
say('\n【§九 标准几何】');
const stdMeshes = {};
for (const key of Object.keys(STD)) {
  const g = STD[key];
  const t0 = Date.now();
  const verts = tetMC(g.sdf, g.bounds, g.res);
  const mesh = { vertices: verts, triCount: verts.length / 9 };
  stdMeshes[key] = mesh;
  say(`  生成 ${key}: ${mesh.triCount} 三角 (${Date.now() - t0}ms), 体积 ${f3(computeVolume(mesh.vertices, mesh.triCount) / 1000, 1)} cm³`);
}
for (const a of ANALYTIC_CASES) {
  const s = analyzeAnalytic(a.key, stdMeshes[a.key], a, rows);
  caseSummaries.push(s);
  const h = s.hotspots[0];
  say(`  [analytic] ${a.key}  Mc=${a.mc}  V_whole=${s.modelVolumeCm3}cm³  ` +
    KS.map(K => `${K}:${h.hots.find(x => x.K === K).vLocalSTL}`).join(' '));
}
for (const key of ['centralBoss', 'longBar', 'stepThickness', 'twoThick']) {
  const t0 = Date.now();
  const s = analyzeCase(key, stdMeshes[key], null, null, rows, warnLog);
  caseSummaries.push(s);
  say(`  ${key}: ${s.status} 热点 ${s.hotspots.length} 个 (V3 ${s.v3Ms}ms) ` +
    s.hotspots.map(h => `[H${h.hotspotId} Mc=${h.mc} ${h.centerSource} V3区=${h.vRegionFixed}mm³]`).join(' '));
}

/* --- ② 工程生成件（薄壁对照，§十四） --- */
say('\n【工程生成件】');
for (const [name, p] of ENG) {
  try {
    const mesh = loadSTL(p);
    const s = analyzeCase(name, mesh, null, null, rows, warnLog);
    caseSummaries.push(s);
    say(`  ${name}: ${s.status} 热点 ${s.hotspots.length} 个 (V3 ${s.v3Ms}ms) ` +
      s.hotspots.map(h => `[H${h.hotspotId} Mc=${h.mc} ${h.centerSource}]`).join(' '));
  } catch (e) { say(`  ${name}: 跳过（${e.message}）`); }
}

/* --- ③ 真实件（§十 + §八 旋转） --- */
say('\n【真实件】');
const realList = QUICK ? REAL : REAL_3;
for (const [name, p] of realList) {
  let mesh;
  try { mesh = loadSTL(p); } catch (e) { say(`  ${name}: 跳过（${e.message}）`); continue; }
  const s0 = analyzeCase(`REAL:${name}`, mesh, null, null, rows, warnLog);
  caseSummaries.push(s0);
  say(`  ${name} 原始: ${s0.status} 热点 ${s0.hotspots.length} 个 (V3 ${s0.v3Ms}ms)`);
  for (const h of s0.hotspots) {
    say(`     H${h.hotspotId} Mc=${h.mc} center=${h.centerSource} conf=${h.confidence} stride=${h.stride} V3区(新)=${h.vRegionFixed} V3区(旧)=${h.vRegionOld}  ` +
      h.hots.map(x => `${x.K}:${x.vLocalSTL}`).join(' '));
  }
  if (QUICK && name !== REAL[0][0]) continue;
  if (name === REAL[0][0] || name === REAL[1][0]) {
    for (const rot of ['X', 'Y', 'Z']) {
      const sr = analyzeCase(`REAL:${name}`, mesh, rot, null, rows, warnLog);
      caseSummaries.push(sr);
      say(`     ↻${rot}: ${sr.status} 热点 ${sr.hotspots.length} 个  ` +
        sr.hotspots.map(h => `[Mc=${h.mc} ${h.centerSource}]`).join(' '));
    }
  }
}

/* --- ④ §八 旋转敏感性：1 个简单标准件 --- */
say('\n【§八 旋转敏感性 · 标准件 longBar】');
for (const rot of ['X', 'Y', 'Z']) {
  const s = analyzeCase('longBar', stdMeshes.longBar, rot, null, rows, warnLog);
  caseSummaries.push(s);
  say(`  ↻${rot}: ${s.status} 热点 ${s.hotspots.length} 个 ` +
    s.hotspots.map(h => `[Mc=${h.mc} ${h.centerSource}]`).join(' '));
}

/* ================= 输出 ================= */
mkdirSync(OUT_DIR, { recursive: true });
const payload = {
  phase: 'V2.0-04',
  generatedFrom: 'tests/experiments/run_hotspot_local_volume.mjs',
  note: 'Hotspot Local Volume（热结局部体积）——不是 Feeding Zone / 补缩区体积',
  params: { Ks: KS, regionVolumeMaxRatio: V3_DEFAULTS.regionVolumeMaxRatio, refineMaxPoints: V3_DEFAULTS.refineMaxPoints },
  counts: { rows: rows.length, cases: caseSummaries.length },
  warnings: warnLog,
  cases: caseSummaries,
  rows,
};
writeFileSync(join(OUT_DIR, 'hotspot_local_volume.json'), JSON.stringify(payload, null, 1));

/* CSV（§十二：可机器读取） */
const HDR = ['case', 'rotation', 'source', 'hotspotId', 'centerSource', 'Mc', 'centroid', 'K', 'cubeSide',
  'V_local_STL', 'fillRatio', 'V_region_fixed', 'V_region_old', 'V_whole_casting',
  'ratio_local_to_whole', 'ratio_local_to_region_fixed', 'ratio_local_to_region_old',
  'confidence', 'scaleStability', 'componentCount', 'keptComponents', 'stride'];
const lines = [HDR.join(',')];
for (const r of rows) {
  for (const x of r.hots) {
    lines.push([
      r.case, r.rotation, r.source, r.hotspotId, r.centerSource, r.mc, `"${(r.centroid || []).join(' ')}"`, x.K, x.cubeSide,
      x.vLocalSTL, x.fillRatio, r.vRegionFixed ?? '', r.vRegionOld ?? '', r.vWholeCasting,
      x.ratioLocalToWhole, x.ratioLocalToRegionFixed ?? '', x.ratioLocalToRegionOld ?? '',
      r.confidence ?? '', r.scaleStability ?? '', x.componentCount, x.keptComponents, r.stride ?? '',
    ].join(','));
  }
}
writeFileSync(join(OUT_DIR, 'hotspot_local_volume.csv'), lines.join('\n'), 'utf8');

say(`\n══ 完成：${rows.length} 行 / ${caseSummaries.length} 个 case，用时 ${((Date.now() - tAll) / 1000).toFixed(1)}s`);
say(`输出：tests/experiments/out/hotspot_local_volume.{json,csv}`);
if (warnLog.length) { say(`\n⚠ 警告 ${warnLog.length} 条：`); warnLog.slice(0, 20).forEach(w => say('   ' + w)); }
