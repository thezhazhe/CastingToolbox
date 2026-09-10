// ============================================================
// V2.3 扫描（命令 9.txt 第一部分）：三类问题现状
// ① 大厚圆柱/大厚环/明显局部厚区（厚区+薄区结构）能否识别
// ② 圆管/法兰/环形热结代表点是否落在厚区（不落薄壁）
// ③ 90° 旋转稳定性（rx/ry/rz）
// 用法: node tests/tools/scan_v23_models.mjs
// ============================================================
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspots, HS_STATUS } from '../../js/engine/hotspot.js';
import { generate } from './hotspotGeometryGenerator.mjs';
import { BOX, union, subtract, tetMC, analyticVolume } from '../helpers/stlGen.js';

const f = (v, d = 1) => typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)) : null;

/** 跑引擎（网格→热点），返回紧凑摘要 */
function run(mesh, label) {
  const t0 = Date.now();
  const geo = buildMesh(mesh).geometry;
  const hs = analyzeHotspots(mesh, geo);
  const ms = Date.now() - t0;
  const list = (hs.hotspots || []).map(h => {
    const p = h.peaks?.[0] || {};
    return `H${h.id}[pk(${f(p.x)},${f(p.y)},${f(p.z)}) rp(${f(h.x)},${f(h.y)},${f(h.z)}) mc=${f(h.mc,1)} c=${f(h.confidence,2)}]`;
  });
  console.log(`${label.padEnd(34)} ${String(hs.status).padEnd(18)} ${String(mesh.triCount).padStart(7)}tri ${ms}ms ${list.join(' ')}`);
  return { label, status: hs.status, hotspots: hs.hotspots || [], ms };
}

/** sdf → mesh（tetMC 直接给 Float32Array 顶点流，与 parseSTL 内存格式一致） */
function fromSdf(sdf, bounds, res = 64, label) {
  const verts = tetMC(sdf, bounds, res);
  return { mesh: { vertices: verts, triCount: verts.length / 9 }, label, bounds };
}

/* ================= ① 现有模型现状 ================= */
console.log('── ① 现有模型（generator，V2.2 引擎现状）──');
const K = ['uniformCube', 'uniformCylinder', 'uniformPlate', 'uniformTube', 'thinShell',
  'bossOnPlate', 'steppedThickness', 'lShape', 'tShape', 'flange', 'hollowThickRing',
  'pvpPair', 'threeBosses', 'ribBoss', 'thickCorner', 'thickEnd', 'gradualTaper', 'suddenTransition', 'multipleBosses'];
const base = [];
for (const k of K) {
  const { mesh, triCount, gt, mdim } = generate(k);
  base.push({ k, triCount, gt, mdim });
  run(mesh, `gen_${k}`);
}

/* ================= ① 厚区+薄区 常见结构（新模型） ================= */
console.log('\n── ① 厚区+薄区 常见结构（新模型）──');
const cases = [];
// A. 薄板 + 大厚圆柱（板 400×400×10，圆柱 ⌀100×H80 居中）
cases.push(fromSdf(union(
  BOX([-200, -200, -5], [200, 200, 5]),
  BOX([-50, -50, -5], [50, 50, 75]),
), [[-205, -205, -10], [205, 205, 80]], 80, 'A_plateThickCylinder'));
// B. 薄板 + 大厚环（板 400×400×10，环 ro=70/ri=40, H70）
cases.push(fromSdf(union(
  BOX([-200, -200, -5], [200, 200, 5]),
  subtract(BOX([-70, -70, -5], [70, 70, 65]), BOX([-40, -40, -5], [40, 40, 65])),
), [[-205, -205, -10], [205, 205, 70]], 80, 'B_plateThickRing'));
// C. 厚法兰 + 薄管（管壁 6，法兰环 40 厚 × ro=80/ri=50，高度 120）
cases.push(fromSdf(union(
  subtract(BOX([-25, -25, -40], [25, 25, 80]), BOX([-19, -19, -40], [19, 19, 80])),  // 薄方管壁 6
  subtract(BOX([-80, -80, -40], [80, 80, 0]), BOX([-50, -50, -40], [50, 50, 0])),   // 底部厚法兰环
), [[-85, -85, -45], [85, 85, 85]], 80, 'C_thickFlangeThinTube'));
// D. 大厚圆柱+薄围板（圆柱 ⌀120×H100，围板厚 8 距 20）
cases.push(fromSdf(union(
  BOX([-60, -60, -50], [60, 60, 50]),
  subtract(BOX([-80, -80, -50], [80, 80, 40]), BOX([-72, -72, -50], [72, 72, 40])),
), [[-85, -85, -55], [85, 85, 55]], 80, 'D_thickCylThinCollar'));
// E. 厚环+薄连接板（环 ro=90/ri=70 H60，薄板 8 厚连接，十字）
cases.push(fromSdf(union(
  subtract(BOX([-90, -90, -30], [90, 90, 30]), BOX([-70, -70, -30], [70, 70, 30])),
  BOX([-200, -16, -4], [200, 16, 4]),
  BOX([-16, -200, -4], [16, 200, 4]),
), [[-205, -205, -35], [205, 205, 35]], 80, 'E_thickRingThinWeb'));
// F. 大厚圆柱+薄底板（圆柱 ⌀160×H100，底薄板 12）
cases.push(fromSdf(union(
  BOX([-80, -80, -50], [80, 80, 50]),
  BOX([-180, -180, -56], [180, 180, -44]),
), [[-185, -185, -61], [185, 185, 55]], 80, 'F_thickCylThinBase'));
for (const c of cases) run(c.mesh, c.label);

/* ================= ② 圆管/法兰/环形代表点 ================= */
console.log('\n── ② 圆管/法兰/环形代表点位置（厚区核验）──');
for (const k of ['uniformTube', 'flange', 'hollowThickRing']) {
  const { mesh } = generate(k);
  const r = run(mesh, `chk_${k}`);
  if (r.hotspots.length) {
    for (const h of r.hotspots) {
      const p = h.peaks?.[0] || {};
      console.log(`  ${k} H${h.id}: peak=(${f(p.x)},${f(p.y)},${f(p.z)}) rep=(${f(h.x)},${f(h.y)},${f(h.z)}) 厚区核心预期见 GT`);
    }
  }
}

/* ================= ③ 90° 旋转 =================
   每个旋转从原始 mesh 独立生成（rotateMesh 复用原 mesh 会叠加）；
   逆变换旋转后热结坐标回原姿态再比（rigid 不变量验证） */
console.log('\n── ③ 90° 旋转（flange / hollowThickRing / bossOnPlate / lShape / D 新模型）──');
const { rotateMesh } = await import('./hotspotGeometryGenerator.mjs');
function invRot(ax, p) {
  // 90° 逆旋转（正向 rotX: (x,−z,y) / rotY: (z,y,−x) / rotZ: (−y,x,z)，求逆）
  if (ax === 'x') return [p[0], p[2], -p[1]];
  if (ax === 'y') return [-p[2], p[1], p[0]];
  return [p[1], -p[0], p[2]];
}
for (const k of ['flange', 'hollowThickRing', 'bossOnPlate', 'lShape']) {
  const { mesh } = generate(k);
  const r0 = run(mesh, `rot_${k}_orig`);
  for (const ax of ['x', 'y', 'z']) {
    const rot = rotateMesh({ vertices: new Float32Array(mesh.vertices), triCount: mesh.triCount }, ax, 90);
    const rr = run(rot, `rot_${k}_${ax}90`);
    const c0 = r0.hotspots.length, c1 = rr.hotspots.length;
    const mc0 = r0.hotspots[0]?.mc, mc1 = rr.hotspots[0]?.mc;
    const posSame = r0.hotspots[0] && rr.hotspots[0]
      ? (() => { const a = r0.hotspots[0], b = invRot(ax, [rr.hotspots[0].x, rr.hotspots[0].y, rr.hotspots[0].z]);
        return Math.hypot(a.x - b[0], a.y - b[1], a.z - b[2]); })() : null;
    console.log(`  ${k} ${ax}90: H ${c0}→${c1} mc ${f(mc0,1)}→${f(mc1,1)} 逆变换代表点位移 ${f(posSame, 1)}mm ${posSame !== null && posSame < 12 ? '✓' : '⚠️'}`);
  }
}

/* ================= 汇总 ================= */
console.log('\n── 体积对照（校验新模型 sdf 正确）──');
for (const c of cases) {
  const vol = analyticVolume(c.label.slice(2));
  console.log(`  ${c.label}: analytic=${vol}`);
}
console.log('\n扫描完成');
