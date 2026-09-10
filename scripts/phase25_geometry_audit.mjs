// ============================================================
// PHASE 25 几何数据可信度 + 方向不变性审计（33.txt）
// 只读审计：调用现有生产计算，不做任何修改。
// 内容：
//   1) 规则模型理论值验证（体积/表面积/bbox —— 精确几何量）
//   2) 真实 STL + 工程件旋转不变性测试：
//      原始 / 绕X 90° / 绕Y 90° / 绕Z 90° / 绕Z 30°（非90°刚体）
//   3) 输出对比表（bbox/体积/面积/壁厚三件套/sampling/热结）
// 用法: node scripts/phase25_geometry_audit.mjs
// ============================================================
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSTL, computeVolume, computeArea, computeBounds } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { generate } from '../tests/tools/hotspotGeometryGenerator.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const f1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(1) : null);
const f2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(2) : null);
const fmt = (v) => (typeof v === 'number' ? Math.round(v) : v);

/* ---- 旋转矩阵（右手系；刚体旋转 |det|=1） ---- */
// 绕 X +90°: y→−z, z→y
const RX90 = [1, 0, 0, 0, 0, -1, 0, 1, 0];
// 绕 Y +90°: z→x, x→−z
const RY90 = [0, 0, 1, 0, 1, 0, -1, 0, 0];
// 绕 Z +90°: x→−y, y→x
const RZ90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
const d30 = Math.PI / 6, c30 = Math.cos(d30), s30 = Math.sin(d30);
const RZ30 = [c30, -s30, 0, s30, c30, 0, 0, 0, 1];   // 绕 Z 30°（非 90°：bbox 外扩）
// 斜轴 45°（约 (1,1,1)/√3 轴，旋转 45°）——第二个非 90° 姿态
const ax = 1 / Math.sqrt(3), d45 = Math.PI / 4, c45 = Math.cos(d45), s45 = Math.sin(d45);
const R = (1 - c45);
const RO45 = [
  c45 + ax * ax * R, ax * ax * R - ax * s45, ax * ax * R + ax * s45,
  ax * ax * R + ax * s45, c45 + ax * ax * R, ax * ax * R - ax * s45,
  ax * ax * R - ax * s45, ax * ax * R + ax * s45, c45 + ax * ax * R,
];

const ORIENTATIONS = [
  ['orig', null],
  ['rx90', RX90], ['ry90', RY90], ['rz90', RZ90],
  ['rz30', RZ30], ['o45', RO45],
];

function rotateVerts(vertices, R) {
  if (!R) return vertices;
  const out = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  return out;
}
/** 逆旋转（正交阵转置）——热结位置比较用 */
const inverse = (R) => (R ? [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]] : null);

function loadReal(name) {
  const buf = readFileSync(path.join(ROOT, 'tests/real-stl', name));
  return parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** 单姿态全流水线：几何 + V3 热结 + 视图适配（生产链路，零修改） */
function runPipeline(mesh) {
  const { geometry } = buildMesh(mesh);
  const t0 = Date.now();
  const geo = analyzeGeometry(mesh, geometry, {});
  const v3 = analyzeHotspotsV3(mesh, geometry, {});
  const view = toViewResult(v3, { wallMax: geo.wallMax, wallMain: geo.wallMain, wallAvg: geo.wallAvg });
  const ms = Date.now() - t0;
  const c = v3.debug?.coarse || {};
  return {
    ms,
    triCount: mesh.triCount,
    bounds: computeBounds(mesh.vertices, mesh.triCount),
    volume: computeVolume(mesh.vertices, mesh.triCount),
    area: computeArea(mesh.vertices, mesh.triCount),
    wallMax: geo.wallMax, wallAvg: geo.wallAvg, wallMain: geo.wallMain,
    hist: geo.wallHist,
    res: geo.res,                       // 距离场 gs/vs
    v3res: { gs: c.gs, vs: c.vs, estMinWall: c.estMinWall, pts: c.pts, stride: c.stride },
    thin: c.thin || {},
    sampling: view.sampling,
    hotspots: (v3.hotspots || []).map(h => ({ M: h.peakModulus, conf: h.confidence, pos: h.position, vol: h.regionVolume })),
    status: v3.status,
    audit: (v3.audit || []).reduce((a, r) => { a[r.reason] = (a[r.reason] || 0) + 1; return a; }, {}),
  };
}

/* ================= 1. 规则模型理论验证 ================= */
const RULE_CASES = [
  ['uniformCube', { size: 100 }, 100 ** 3, 6 * 100 ** 2, [100, 100, 100]],
  ['uniformPlate', { l: 300, w: 200, t: 40 }, 300 * 200 * 40, 2 * (300 * 200 + 300 * 40 + 200 * 40), [300, 200, 40]],
  ['uniformCylinder', { r: 40, h: 120 }, Math.PI * 40 ** 2 * 120, 2 * Math.PI * 40 ** 2 + 2 * Math.PI * 40 * 120, [120, 80, 80]],
  ['uniformTube', { ro: 50, ri: 40, h: 100 }, Math.PI * (50 ** 2 - 40 ** 2) * 100, 2 * Math.PI * 50 * 100 + 2 * Math.PI * 40 * 100 + 2 * Math.PI * (50 ** 2 - 40 ** 2), [100, 100, 100]],
];

console.log('═══════════════════════════════════════════════════════');
console.log('PHASE 25 §A 规则模型理论值验证（精确几何量）');
console.log('═══════════════════════════════════════════════════════');
console.log('| 模型 | 理论体积 mm³ | 实测 | 理论面积 mm² | 实测 | bbox 理论 | 实测 |');
console.log('|---|---|---|---|---|---|---|');
for (const [kind, params, vTh, aTh, bTh] of RULE_CASES) {
  const { mesh } = generate(kind, params);
  const { geometry } = buildMesh(mesh);
  const geo = analyzeGeometry(mesh, geometry, {});
  const b = computeBounds(mesh.vertices, mesh.triCount);
  const v = computeVolume(mesh.vertices, mesh.triCount);
  const a = computeArea(mesh.vertices, mesh.triCount);
  const vErr = Math.abs(v - vTh) / vTh * 100, aErr = Math.abs(a - aTh) / aTh * 100;
  console.log(`| ${kind} | ${fmt(vTh)} | ${fmt(v)}（${f2(vErr)}%） | ${fmt(aTh)} | ${fmt(a)}（${f2(aErr)}%） | ${bTh.join('×')} | ${b.size.map(fmt).join('×')} |`);
}

/* ================= 2. 旋转不变性 ================= */
const CASES = [
  ['ALHR4510塑料模具v2-2.1.stl', 'real'],
  ['ALR2510塑料模具v1.stl', 'real'],
  ['ALR2510塑料模具v1_1.stl', 'real'],
  ['HR4012塑料模具v4最早大板.stl', 'real'],
  ['lShape', 'gen'],
  ['bossOnPlate', 'gen'],
];

console.log('\n═══════════════════════════════════════════════════════');
console.log('PHASE 25 §B 旋转不变性测试（体积/面积/壁厚/sampling/热结）');
console.log('═══════════════════════════════════════════════════════');

const results = {};   // name → orientation → result
for (const [name, kind] of CASES) {
  const base = kind === 'real' ? loadReal(name) : generate(name).mesh;
  results[name] = {};
  for (const [oname, R] of ORIENTATIONS) {
    const mesh = { ...base, vertices: rotateVerts(base.vertices, R) };
    results[name][oname] = runPipeline(mesh);
  }
}

/* ---- 汇总输出：每个模型一张表 ---- */
for (const [name] of CASES) {
  const r0 = results[name].orig;
  console.log(`\n───────────────────────────────────────────────`);
  console.log(`■ ${name}  (tri=${r0.triCount}, 原始耗时 ${r0.ms}ms)`);
  console.log(`───────────────────────────────────────────────`);
  console.log('| 姿态 | bbox尺寸(降序) | 体积 mm³ | 面积 mm² | wallMax | wallAvg | wallMain | 距离场 gs/vs | V3 gs/vs | estMinWall | 采样级 | 热结数 | 热结M列表 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [oname] of ORIENTATIONS) {
    const r = results[name][oname];
    const bs = [...r.bounds.size].sort((a, b) => b - a);
    const hs = r.hotspots.map(h => f1(h.M)).join(',');
    console.log(`| ${oname} | ${bs.map(fmt).join('×')} | ${fmt(r.volume)} | ${fmt(r.area)} | ${f1(r.wallMax)} | ${f1(r.wallAvg)} | ${f1(r.wallMain)} | ${r.res.gs}³/${f1(r.res.vs)} | ${r.v3res.gs}³/${f1(r.v3res.vs)} | ${f1(r.v3res.estMinWall)} | ${r.sampling.level} | ${r.hotspots.length} | ${hs || '—'} |`);
  }

  // 相对原始姿态的偏差表（壁厚 + 热结）
  console.log(`\n  偏差 vs 原始姿态（%）：`);
  console.log('  | 姿态 | wallMax Δ% | wallAvg Δ% | wallMain Δ% | 体积 Δ% | 面积 Δ% |');
  console.log('  |---|---|---|---|---|---|');
  for (const [oname] of ORIENTATIONS) {
    if (oname === 'orig') continue;
    const r = results[name][oname], o = r0;
    const pct = (a, b) => (b > 0 ? ((a - b) / b * 100).toFixed(1) : '—');
    console.log(`  | ${oname} | ${pct(r.wallMax, o.wallMax)} | ${pct(r.wallAvg, o.wallAvg)} | ${pct(r.wallMain, o.wallMain)} | ${pct(r.volume, o.volume)} | ${pct(r.area, o.area)} |`);
  }
}

/* ---- 热结位置一致性：旋转回原坐标比较 ---- */
console.log('\n═══════════════════════════════════════════════════════');
console.log('PHASE 25 §C 热结位置（旋转回原始坐标系后与原始姿态对比）');
console.log('═══════════════════════════════════════════════════════');
for (const [name] of CASES) {
  const r0 = results[name].orig;
  if (!r0.hotspots.length) { console.log(`\n■ ${name}: 原始姿态无热结`); continue; }
  console.log(`\n■ ${name}  原始: ${r0.hotspots.map(h => `M${f1(h.M)}@[${h.pos.map(fmt)}]`).join('  ')}`);
  for (const [oname, R] of ORIENTATIONS) {
    if (oname === 'orig' || !R) continue;
    const r = results[name][oname];
    if (!r.hotspots.length) { console.log(`  ${oname}: 无热结`); continue; }
    const inv = inverse(R);
    const back = r.hotspots.map(h => {
      const p = h.pos;
      return [inv[0] * p[0] + inv[1] * p[1] + inv[2] * p[2],
        inv[3] * p[0] + inv[4] * p[1] + inv[5] * p[2],
        inv[6] * p[0] + inv[7] * p[1] + inv[8] * p[2]];
    });
    // 与原始位置最近匹配（欧氏距离）
    const matched = back.map(b => {
      let best = Infinity, bi = -1;
      r0.hotspots.forEach((h, i) => {
        const d = Math.hypot(h.pos[0] - b[0], h.pos[1] - b[1], h.pos[2] - b[2]);
        if (d < best) { best = d; bi = i; }
      });
      return { bi, d: Math.round(best) };
    });
    console.log(`  ${oname}: ${r.hotspots.map((h, i) => `M${f1(h.M)}@[${back[i].map(fmt)}]${matched[i].bi >= 0 ? `(→原#${matched[i].bi + 1} Δ${matched[i].d}mm)` : '(无匹配)'}`).join('  ')}`);
  }
}

/* ---- ALR2510 wallMain=wallMax 退化机制诊断 ---- */
console.log('\n═══════════════════════════════════════════════════════');
console.log('PHASE 25 §D ALR2510 v1 wallMain=17.2=wallMax 直方图诊断');
console.log('═══════════════════════════════════════════════════════');
for (const oname of ['orig', 'rx90', 'rz30']) {
  const r = results['ALR2510塑料模具v1.stl'][oname];
  const nb = r.hist.length;
  let peak = 0;
  for (let i = 1; i < nb; i++) if (r.hist[i].n > r.hist[peak].n) peak = i;
  const total = r.hist.reduce((a, b) => a + b.n, 0) || 1;
  const wc = r.hist[peak].n, wl = peak > 0 ? r.hist[peak - 1].n : 0, wr = peak + 1 < nb ? r.hist[peak + 1].n : 0;
  const peakShare = wc / total, neighborAvg = (wl + wr) / 2 / total;
  const sharp = peak >= nb * 0.25 && peakShare > 0.2 && peakShare > neighborAvg * 1.3;
  const bins = r.hist.map((b, i) => `[${f1(b.h)}:${b.n}]`).slice(0, 12).join(' ');
  console.log(`\n${oname}: nb=${nb} peak桶=${peak}(${f1(r.hist[peak].h)}mm) peakShare=${f2(peakShare)} sharp判据=${sharp}`);
  console.log(`  hist: ${bins}`);
}

/* ---- 旋转敏感性量化汇总（4 真实 STL） ---- */
console.log('\n═══════════════════════════════════════════════════════');
console.log('PHASE 25 §E 旋转敏感性汇总（真实 STL × 6 姿态，max-min 波动）');
console.log('═══════════════════════════════════════════════════════');
for (const [name, kind] of CASES) {
  if (kind !== 'real') continue;
  const oris = ORIENTATIONS.map(([o]) => results[name][o]);
  const range = (k, fn) => {
    const vals = oris.map(r => fn(r[k])).filter(v => typeof v === 'number' && v > 0);
    if (!vals.length) return '—';
    const mn = Math.min(...vals), mx = Math.max(...vals);
    return `${f1(mn)}~${f1(mx)}（${f2((mx - mn) / mn * 100)}%）`;
  };
  const hsCounts = [...new Set(oris.map(r => r.hotspots.length))];
  console.log(`\n■ ${name}`);
  console.log(`  体积: ${range('volume', v => v)}  面积: ${range('area', v => v)}`);
  console.log(`  wallMax: ${range('wallMax', v => v)}  wallAvg: ${range('wallAvg', v => v)}  wallMain: ${range('wallMain', v => v)}`);
  console.log(`  热结数量集: {${hsCounts.join(', ')}}  热结M集: ${[...new Set(oris.flatMap(r => r.hotspots.map(h => f1(h.M))))].join(', ')}`);
  console.log(`  sampling级集: {${[...new Set(oris.map(r => r.sampling.level))].join(', ')}}  status集: {${[...new Set(oris.map(r => r.status))].join(', ')}}`);
}
