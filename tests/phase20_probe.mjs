// ============================================================
// PHASE 20 只读诊断（25.txt）—— 距离场 0 内部采样点总审计
// 禁止修改任何引擎/UI/测试；本脚本只读，输出诊断数据。
//
// 版本来源说明（25.txt 二：git/history 无法直接回溯的诚实报告）：
//   - git 仅 1 个 commit（v0.16），且 js/engine/ 未被 git 追踪 → 无引擎基线
//   - js/engine/v3/legacy/ 是 12.txt 时代（V3 早期）快照，≠ PHASE 16 状态
//   - dist/ 打包不含 js/engine
//   - 文件时间戳证据：distanceField.js / stlDiagnostic.js / geometryAnalysis.js
//     仅 PHASE 19（Aug 23 15:20-15:38）修改过；sampling.js / configV3.js 仅
//     PHASE 18（Aug 23 13:43-44）；v3ViewAdapter.js 仅 PHASE 17（Aug 23 13:26）
//     → V2 距离场在 PHASE 16/17/18 三阶段从未被修改；
//     → PHASE 19 前 buildDistanceField = 等价重建（单级单相位，maxResolution=96）
//     → PHASE 18 前 V3 采样 = 等价重建（16³ 单级探测 + 主网格单次体素化）
//   - 重建仅在本脚本内实现（等价只读诊断路径），不触碰引擎文件
//
// 用法: node tests/phase20_probe.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { parseSTL, computeBounds, computeVolume } from '../js/engine/stl.js';
import { buildMesh, distanceToSurface } from '../js/engine/mesh3d.js';
import { scanInside, buildDistanceField, buildDistanceFieldSliced } from '../js/engine/distanceField.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { diagnoseSTL, thicknessStats } from '../js/engine/stlDiagnostic.js';
import { validateMesh } from '../js/engine/meshValidation.js';
import { voxelize } from '../js/engine/v3/windowV.js';
import { coarseSample } from '../js/engine/v3/sampling.js';
import { V3_DEFAULTS } from '../js/engine/v3/configV3.js';
import { tetMC, BOX, subtract } from './helpers/stlGen.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const pickRes = (mdim, minFeature) => Math.min(160, Math.max(72, Math.ceil(2 * mdim / minFeature)));

/* ================= 模型集（真实场景优先 + 工程文件 + 构造） ================= */
const MODELS = [];
function add(id, src, desc, build) { MODELS.push({ id, src, desc, build }); }

add('shell3000_w25', '构造', '3m 壳壁 25mm（PHASE 19 原触发）', () => {
  const L = 3000, W = 2000, H = 1200, w = 25;
  const sdf = subtract(BOX([-L/2,-W/2,-H/2],[L/2,W/2,H/2]), BOX([-(L/2-w),-(W/2-w),-(H/2-w)],[L/2-w,W/2-w,H/2-w]));
  const verts = tetMC(sdf, [[-L/2-5,-W/2-5,-H/2-5],[L/2+5,W/2+5,H/2+5]], pickRes(L, w));
  return { mesh: { vertices: verts, triCount: verts.length/9 }, triBig: true };
});
add('shell2000_w20', '构造', '2m 壳壁 20mm（大件常规壁厚）', () => {
  const L = 2000, W = 1200, H = 800, w = 20;
  const sdf = subtract(BOX([-L/2,-W/2,-H/2],[L/2,W/2,H/2]), BOX([-(L/2-w),-(W/2-w),-(H/2-w)],[L/2-w,W/2-w,H/2-w]));
  const verts = tetMC(sdf, [[-L/2-5,-W/2-5,-H/2-5],[L/2+5,W/2+5,H/2+5]], pickRes(L, w));
  return { mesh: { vertices: verts, triCount: verts.length/9 }, triBig: true };
});
add('shell1000_w20', '构造', '1m 壳壁 20mm（正常恢复）', () => {
  const L = 1000, W = 800, H = 600, w = 20;
  const sdf = subtract(BOX([-L/2,-W/2,-H/2],[L/2,W/2,H/2]), BOX([-(L/2-w),-(W/2-w),-(H/2-w)],[L/2-w,W/2-w,H/2-w]));
  const verts = tetMC(sdf, [[-L/2-5,-W/2-5,-H/2-5],[L/2+5,W/2+5,H/2+5]], pickRes(L, w));
  return { mesh: { vertices: verts, triCount: verts.length/9 } };
});
add('shell1000_w3', '构造', '1m 壳壁 3mm（< mdim/256=3.9 → 理论 0 点边界）', () => {
  const L = 1000, W = 800, H = 600, w = 3;
  const sdf = subtract(BOX([-L/2,-W/2,-H/2],[L/2,W/2,H/2]), BOX([-(L/2-w),-(W/2-w),-(H/2-w)],[L/2-w,W/2-w,H/2-w]));
  const verts = tetMC(sdf, [[-L/2-5,-W/2-5,-H/2-5],[L/2+5,W/2+5,H/2+5]], pickRes(L, w));
  return { mesh: { vertices: verts, triCount: verts.length/9 } };
});
add('shell1000_w20_shifted', '构造', '1m 壳壁 20mm + 平移 (12345,-6789,31415)（坐标系鲁棒）', () => {
  const L = 1000, W = 800, H = 600, w = 20;
  const sdf = subtract(BOX([-L/2,-W/2,-H/2],[L/2,W/2,H/2]), BOX([-(L/2-w),-(W/2-w),-(H/2-w)],[L/2-w,W/2-w,H/2-w]));
  const verts = tetMC(sdf, [[-L/2-5,-W/2-5,-H/2-5],[L/2+5,W/2+5,H/2+5]], pickRes(L, w));
  const tr = [12345, -6789, 31415];
  for (let i = 0; i < verts.length; i += 3) for (let a = 0; a < 3; a++) verts[i + a] += tr[a];
  return { mesh: { vertices: verts, triCount: verts.length/9 }, translate: tr };
});
add('cube200', '构造', '200mm 实体立方（阳性对照：中心必 inside）', () => {
  const verts = tetMC(BOX([-100,-100,-100],[100,100,100]), [[-103,-103,-103],[103,103,103]], 72);
  return { mesh: { vertices: verts, triCount: verts.length/9 } };
});
add('t19_valveLike', '工程文件', '阀体（真实结构，正常模型）', () => {
  const mesh = parseSTL(readFileSync(join(HERE, 'engineering-generated', 'models', 't19_valveLike', 'model.stl')));
  return { mesh };
});

/* ================= 重建：PHASE 19 前 V2 距离场（PHASE 16/17/18 共用版本） ================= */
// 依据：当前 distanceField.js 中 PHASE 19 注释 + PHASE 19 报告（maxResolution 96→256）
// 旧行为：单级单相位；minWallLayers 升分辨率上限 96；无多级循环、无双相位
function dfLegacy(mesh, geometry) {
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const globalMin = bounds.min;
  const mdim = Math.max(...bounds.size);
  const minDim = Math.min(...bounds.size);
  const o = { resolution: 48, maxResolution: 96, minWallLayers: 6 };
  let gs = o.resolution;
  if (minDim > 0 && minDim < (mdim / gs) * o.minWallLayers) gs = Math.min(o.maxResolution, Math.ceil(o.minWallLayers * mdim / minDim));
  const vs = mdim / gs;
  const grid = scanInside(geometry, bounds, gs, vs, globalMin);
  const pts = [], insideIdx = [];
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    if (!grid[(i * gs + j) * gs + k]) continue;
    pts.push([bounds.min[0] + (i + 0.5) * vs, bounds.min[1] + (j + 0.5) * vs, bounds.min[2] + (k + 0.5) * vs]);
    insideIdx.push(pts.length - 1);
  }
  const dists = distanceToSurface(geometry, pts);
  return { gs, vs, bounds, pts, insideIdx, dists, insideGrid: grid };
}

/* ================= 重建：PHASE 19 前 wallMain（直方图峰值法，无 p95 修正） ================= */
function wallMainLegacy(vs, vals, wallMax) {
  if (!vals.length || !wallMax) return 0;
  const nb = Math.max(12, Math.min(50, Math.round(wallMax / (vs * 0.8))));
  const rawBin = wallMax / nb;
  const hist = new Array(nb).fill(0);
  for (const d of vals) hist[Math.min(nb - 1, Math.floor(d / rawBin))]++;
  let peak = 0;
  for (let i = 1; i < nb; i++) if (hist[i] > hist[peak]) peak = i;
  const wl = hist[peak - 1] || 0, wc = hist[peak], wr = hist[peak + 1] || 0;
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const peakShare = wc / total;
  const neighborAvg = (wl + wr) / 2 / total;
  if (!(peak >= nb * 0.25 && peakShare > 0.2 && peakShare > neighborAvg * 1.3)) return wallMax * 2;
  const shift = wc > 0 ? (wr - wl) / (wl + wc + wr) : 0;
  return (peak + shift + 0.5) * rawBin * 2;
}

/* ================= 重建：PHASE 18 前 V3 采样（16³ 单级探测 + 主网格单次体素化） ================= */
function v3SamplingLegacy(mesh, geometry) {
  const o = V3_DEFAULTS;                 // PHASE 18 未动这些阈值
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const globalMin = bounds.min;
  const mdim = Math.max(...bounds.size);
  // Stage 1：单级 16³ 探测（PHASE 18 前无 probeResolutionSteps 循环）
  const pgs = 16, pvs = mdim / pgs;
  const inside = scanInside(geometry, bounds, pgs, pvs, globalMin);
  const pts = [];
  for (let i = 0; i < pgs; i++) for (let j = 0; j < pgs; j++) for (let k = 0; k < pgs; k++) {
    if (!inside[(i * pgs + j) * pgs + k]) continue;
    pts.push([bounds.min[0] + (i + 0.5) * pvs, bounds.min[1] + (j + 0.5) * pvs, bounds.min[2] + (k + 0.5) * pvs]);
  }
  const dists = pts.length ? distanceToSurface(geometry, pts) : [];
  const cs = dists.filter(d => d !== null && d > 0.001 && d * 2 >= o.charFilterMin).map(d => d * 2);
  cs.sort((a, b) => a - b);
  const estMinWall = cs.length >= 8 ? cs[Math.max(0, Math.floor(cs.length * 0.1))] : (mdim / o.coarseResolution);
  const est = Math.max(estMinWall, o.estWallFloor);
  const vs = Math.max(mdim / o.coarseMaxRes, Math.min(mdim / o.coarseMinRes, 0.5 * est));
  const gs = Math.round(mdim / vs);
  // 主网格单次体素化（PHASE 18 前无多级/相位循环）
  const vox = voxelize(geometry, bounds, gs, vs, globalMin);
  let nInside = 0;
  for (let i = 0; i < vox.inside.length; i++) if (vox.inside[i]) nInside++;
  return { gs, vs, nInside, probeN: pts.length, probeChars: cs.length, estMinWall: est };
}

/* ================= 独立判内外（8 方向射线投票，与 scanInside 独立实现） ================= */
const DIRS = [[1,0.3,0.2],[-1,-0.3,0.2],[0.2,1,0.3],[0.2,-1,-0.3],[0.3,0.2,1],[-0.3,0.2,-1],[1,0,0],[-1,0,0]];
function independentInside(geometry, p) {
  const raycaster = new THREE.Raycaster();
  const tmpMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  let odd = 0;
  for (const d of DIRS) {
    raycaster.set(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(d[0], d[1], d[2]));
    const hits = raycaster.intersectObject(tmpMesh, false);
    // 忽略起点表面命中（容差 0.01mm）
    let n = 0;
    for (const h of hits) if (h.distance > 0.01) n++;
    if (n % 2 === 1) odd++;
  }
  tmpMesh.material.dispose();
  return odd >= 5;   // 8 方向 ≥5 奇偶 = inside
}

/* ================= 拓扑审计：连通组件 / 有向体积 / 法向（小模型专用） ================= */
function components(mesh) {
  const { vertices, triCount } = mesh;
  const vKey = new Map();          // 坐标(0.001 容差) → 顶点索引
  const tris = [];                 // 每三角 [i0,i1,i2]
  let vi = 0;
  for (let t = 0; t < triCount; t++) {
    const idx = [];
    for (let k = 0; k < 3; k++) {
      const x = Math.round(vertices[t*9+k*3]*1000)/1000;
      const y = Math.round(vertices[t*9+k*3+1]*1000)/1000;
      const z = Math.round(vertices[t*9+k*3+2]*1000)/1000;
      const ck = `${x},${y},${z}`;
      if (!vKey.has(ck)) vKey.set(ck, vi++);
      idx.push(vKey.get(ck));
    }
    tris.push(idx);
  }
  const pts = new Array(vi);
  for (const [ck, i] of vKey) pts[i] = ck.split(',').map(Number);
  // 边 → 三角列表（共享边邻接）
  const edgeTris = new Map();
  const ekey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  for (let t = 0; t < tris.length; t++) {
    for (let k = 0; k < 3; k++) {
      const e = ekey(tris[t][k], tris[t][(k+1)%3]);
      if (!edgeTris.has(e)) edgeTris.set(e, []);
      edgeTris.get(e).push(t);
    }
  }
  // BFS 组件
  const comp = new Int32Array(tris.length).fill(-1);
  const out = [];
  for (let s = 0; s < tris.length; s++) {
    if (comp[s] >= 0) continue;
    const cid = out.length;
    const stack = [s]; comp[s] = cid;
    let nTri = 0, signedVol = 0;
    const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
    while (stack.length) {
      const t = stack.pop(); nTri++;
      const a = pts[tris[t][0]], b = pts[tris[t][1]], c = pts[tris[t][2]];
      // 有向体积（法向符号）：dot(a, cross(b,c))/6
      const cx = b[1]*c[2]-b[2]*c[1], cy = b[2]*c[0]-b[0]*c[2], cz = b[0]*c[1]-b[1]*c[0];
      signedVol += (a[0]*cx + a[1]*cy + a[2]*cz) / 6;
      for (const p of [a, b, c]) for (let q = 0; q < 3; q++) {
        if (p[q] < bmin[q]) bmin[q] = p[q];
        if (p[q] > bmax[q]) bmax[q] = p[q];
      }
      for (let k = 0; k < 3; k++) {
        const e = ekey(tris[t][k], tris[t][(k+1)%3]);
        for (const nt of edgeTris.get(e)) if (comp[nt] < 0) { comp[nt] = cid; stack.push(nt); }
      }
    }
    out.push({ id: cid, nTri, signedVol: +signedVol.toFixed(0), volSign: signedVol > 0 ? '+' : '-',
      bbox: [bmin.map(v => +v.toFixed(0)), bmax.map(v => +v.toFixed(0))] });
  }
  out.sort((x, y) => y.nTri - x.nTri);
  return { nComponents: out.length, components: out };
}

/* ================= 主流程 ================= */
const t0 = Date.now();
console.log('===== PHASE 20 只读诊断（25.txt）：距离场 0 内部采样点总审计 =====\n');

for (const m of MODELS) {
  console.log(`\n########## ${m.id} — ${m.desc} ##########`);
  const { mesh } = m.build();
  const { geometry } = buildMesh(mesh);
  const bounds = computeBounds(mesh.vertices, mesh.triCount);
  const mdim = Math.max(...bounds.size);
  const minDim = Math.min(...bounds.size);
  const mv = validateMesh(mesh);
  const vol = computeVolume(mesh.vertices, mesh.triCount);

  // ---- P1a 基本信息 ----
  console.log(`[mesh] tri=${mesh.triCount} closed=${mv.closed} boundaryEdges=${mv.boundaryEdges} degTris=${mv.degenerateTris}`);
  console.log(`[bounds] min=[${bounds.min.map(v => v.toFixed(0))}] max=[${bounds.max.map(v => v.toFixed(0))}] size=[${bounds.size.map(v => v.toFixed(0))}] minDim=${minDim.toFixed(0)} mdim=${mdim.toFixed(0)} 体积=${(vol / 1000).toFixed(0)}cm³`);

  // ---- P1b 版本行为对照（25.txt 二核心表）----
  const dfL = dfLegacy(mesh, geometry);                       // PHASE 16/17/18 V2 距离场
  const tsL = thicknessStats(dfL);
  const dfC = buildDistanceField(mesh, geometry, {});         // PHASE 19 V2 距离场
  const tsC = thicknessStats(dfC);
  // wallMain：旧逻辑重建 vs 当前 analyzeGeometry
  const gC = analyzeGeometry(mesh, geometry);
  const valsL = dfL.dists.filter(d => d !== null && d > 0.001);
  const valsC = dfC.dists.filter(d => d !== null && d > 0.001);
  const wmL = valsL.length ? wallMainLegacy(dfL.vs, valsL, Math.max(...valsL)) : 0;
  const gL = { wallMain: wmL, wallAvg: 0, wallMax: Math.max(...valsL, 0) * 2 };
  // V3 采样对照（PHASE 18 前重建 vs 当前 coarseSample）
  const v3L = v3SamplingLegacy(mesh, geometry);
  const v3C = coarseSample(mesh, geometry);

  console.log(`\n[版本行为对照] （V2 距离场：PHASE16/17/18 同版本未动，PHASE19 才改）`);
  console.log(`  PHASE16/17/18 V2df | gs=${dfL.gs}³ vs=${dfL.vs.toFixed(2)} 总采样=${dfL.gs ** 3} inside=${dfL.insideIdx.length} valid=${tsL.samples} ${tsL.status} | wallMain=${gL.wallMain.toFixed(1)} wallMax=${gL.wallMax.toFixed(1)}`);
  console.log(`  PHASE19      V2df | gs=${dfC.gs}³ vs=${dfC.vs.toFixed(2)} 总采样=${dfC.gs ** 3} inside=${dfC.insideIdx.length} valid=${tsC.samples} ${tsC.status} | wallMain=${gC.wallMain.toFixed(1)} wallMax=${gC.wallMax.toFixed(1)}`);
  console.log(`  PHASE18前    V3sampling | 探测16³ inside=${v3L.probeN} chars=${v3L.probeChars} estMinWall=${v3L.estMinWall.toFixed(1)} → gs=${v3L.gs}³ vs=${v3L.vs.toFixed(1)} 主网格inside=${v3L.nInside}`);
  console.log(`  PHASE18后    V3sampling | probeLv=${v3C.probeLevel} estMinWall=${v3C.estMinWall.toFixed(1)} → gs=${v3C.gs}³ vs=${v3C.vs.toFixed(1)} 主网格inside=${v3C.vox.inside.reduce((a, b) => a + b, 0)}`);
  const diag = diagnoseSTL(mesh, geometry, { status: 'OK', debug: {} });
  console.log(`  UI出口 diagnoseSTL.thickness = ${diag.thickness.status}（${diag.thickness.reason ? diag.thickness.reason.slice(0, 40) : ''}）`);

  // ---- P2 中心点诊断（25.txt 五）----
  const c = bounds.min.map((v, a) => v + bounds.size[a] / 2);
  const indC = independentInside(geometry, c);
  const dC = distanceToSurface(geometry, [c])[0];
  // 引擎网格法：dfC 网格中 center 所在体素
  const gi = [0, 1, 2].map(a => Math.min(dfC.gs - 1, Math.max(0, Math.floor((c[a] - dfC.bounds.min[a]) / dfC.vs))));
  const gridIn = dfC.insideGrid ? dfC.insideGrid[(gi[0] * dfC.gs + gi[1]) * dfC.gs + gi[2]] : null;
  console.log(`[中心点] center=[${c.map(v => v.toFixed(0))}] 独立判内外(8方向)=${indC ? 'INSIDE' : 'OUTSIDE'} 引擎网格法=${gridIn ? 'INSIDE' : 'OUTSIDE'} BVH最近距=${dC === null ? 'null' : dC.toFixed(2)}mm`);
  // 8 角点
  const corners = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let cc = 0; cc < 2; cc++) {
    corners.push([a ? bounds.max[0] : bounds.min[0], b ? bounds.max[1] : bounds.min[1], cc ? bounds.max[2] : bounds.min[2]]);
  }
  const corIn = corners.map(p => independentInside(geometry, p));
  console.log(`[8角点] 独立判定=${corIn.map(x => x ? 'in' : 'out').join('')}（实体件应全 out——角点正好在表面边界，判定容差内）`);

  // ---- P3 采样点抽样验证（25.txt 四B）：引擎 inside 点独立复验 + outside 点独立复验 ----
  if (dfC.insideIdx.length > 0) {
    const stepIn = Math.max(1, Math.floor(dfC.insideIdx.length / 50));
    let bad = 0, checked = 0;
    for (let i = 0; i < dfC.insideIdx.length; i += stepIn) {
      checked++;
      if (!independentInside(geometry, dfC.pts[dfC.insideIdx[i]])) bad++;
    }
    const outPts = [];
    for (let i = 0; i < dfC.pts.length && outPts.length < 50; i++) {
      if (!dfC.insideGrid[(Math.floor((dfC.pts[i][0] - dfC.bounds.min[0]) / dfC.vs) * dfC.gs + Math.floor((dfC.pts[i][1] - dfC.bounds.min[1]) / dfC.vs)) * dfC.gs + Math.floor((dfC.pts[i][2] - dfC.bounds.min[2]) / dfC.vs)]) outPts.push(dfC.pts[i]);
    }
    let badOut = 0;
    for (const p of outPts) if (independentInside(geometry, p)) badOut++;
    console.log(`[交叉验证] 引擎判inside抽${checked}点→独立判定不一致 ${bad}；引擎判outside抽${outPts.length}点→独立判定为inside ${badOut}`);
  } else {
    // 0 inside：把全部采样点交给独立判定（抽样），并检查独立判定是否找到 inside 点
    console.log(`[交叉验证] 引擎 inside=0！独立判定全采样网格点：`);
    let indInside = 0, total = 0, first = null;
    const gs = dfC.gs, vs = dfC.vs;
    for (let i = 0; i < gs; i += 2) for (let j = 0; j < gs; j += 2) for (let k = 0; k < gs; k += 2) {
      total++;
      const p = [dfC.bounds.min[0] + (i + 0.5) * vs, dfC.bounds.min[1] + (j + 0.5) * vs, dfC.bounds.min[2] + (k + 0.5) * vs];
      if (independentInside(geometry, p)) { indInside++; if (!first) first = p; }
    }
    console.log(`  独立判定（8方向投票）：${indInside}/${total} 网格点为 inside${first ? `（首点 [${first.map(v => v.toFixed(1))}]）` : ''} → ${indInside ? '引擎判定 bug（ROOT-B）' : '模型结构/网格问题（ROOT-D）或分辨率不足（ROOT-E）'}`);
  }

  // ---- P4 拓扑审计（小模型，25.txt 六）----
  if (mesh.triCount < 400000 && !m.triBig) {
    const comp = components(mesh);
    console.log(`[拓扑] 组件=${comp.nComponents}`);
    for (const cc of comp.components.slice(0, 5)) {
      console.log(`  组件#${cc.id}：tri=${cc.nTri} 有向体积=${cc.volSign}${Math.abs(cc.signedVol)}mm³（${cc.volSign === '+' ? '法向朝外正常' : '法向翻转！'}） bbox=[${cc.bbox[0]}]~[${cc.bbox[1]}]`);
    }
    if (comp.components.length > 1) console.log(`  ⚠ 多组件：外壳+内壳/空腔/悬浮件结构——inside 判定按奇偶计数，多组件嵌套仍正确，但组件间隙=outside`);
  }

  // ---- P5 路径一致性：同步 vs 分片（25.txt 七）----
  if (m.id === 'shell1000_w20') {
    const dfS = await buildDistanceFieldSliced(mesh, geometry, {});
    const same = dfS.gs === dfC.gs && dfS.insideIdx.length === dfC.insideIdx.length &&
      dfS.dists.length === dfC.dists.length &&
      dfS.dists.every((d, i) => (d === null) === (dfC.dists[i] === null) && (d === null || Math.abs(d - dfC.dists[i]) < 1e-9));
    console.log(`[路径一致性] 同步 gs=${dfC.gs} inside=${dfC.insideIdx.length} vs 分片 gs=${dfS.gs} inside=${dfS.insideIdx.length} → ${same ? '完全一致 ✓' : '不一致 ✗（ROOT-G 候选）'}`);
  }
  if (m.translate) console.log(`[平移] 模型平移至 [${m.translate}] 后各阶段全部基于真实坐标计算 → 一致则坐标系鲁棒 ✓`);
}

/* ================= P5 生命周期审计结论（代码级，25.txt 八/九） ================= */
console.log(`
===== 生命周期/缓存审计（代码级，designCenter.js 实读） =====
1. importFile()（designCenter.js:396-515）：每次导入 STL 全新流程——
   - 481 行 state.diag = diagnoseSTL(...) 当次计算，无缓存复用
   - 449 行 state.analysis = analyzeGeometrySliced(...) 当次计算
   - 408 行 proj.clearStlBoundData() 先清旧 STL 绑定数据
   - 409 行 sessionStorage.removeItem(STL_FP_KEY) 清会话指纹
   → STL A→B 或 删除→重导，不会保留旧 distanceField/diag（无残留路径）
2. deleteStl()（designCenter.js:333-347）：336 clearStlBoundData + 339-341 清
   state.mesh/geometry/analysis/hotspots/diag/results → 无幽灵数据
3. UI 显示（renderGeomInfo 747 行）读 state.diag——与 481 行同一次赋值
   → 「距离场无有效采样」文案 = 当前这次 diagnoseSTL 的真实输出，不是旧 state
4. sessionStorage 只存 STL 指纹（用于刷新后幽灵检测），不存 diag 数据
→ 结论：ROOT-H（UI 用错误/过期诊断）无证据——状态生命周期干净
`);

console.log(`\n===== 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s =====`);
