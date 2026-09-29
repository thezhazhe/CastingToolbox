// ============================================================
// PHASE 94（94.txt，代号 PHASE 93-B）· 浇注系统检测「手动语义版」
//
// 覆盖 94.txt §十四 要求的 A~G：
//   A 圆柱（已知直径 → 面积）      B 方管（已知宽高 → 面积）
//   C 梯形（已知上下底/高 → 面积） D 多个独立圆柱（数量 = N，总面积 = ΣAi）
//   E 多个不同尺寸内浇口           F 三类各自多件（3 直 / 5 横 / 10 内）
//   G 复杂不规则 —— 算不出来必须 WARNING / null，**禁止假精度**
// 另加 94-H~T：一个 STL → N 个组件 / 缺类别不伪造比例 / 占比 = 100% /
//   部分测不出要标 partial / 扇形·喇叭口·弯曲横浇道的诚实边界 /
//   不出 PASS（§九）/ 阈值与措辞的源码级纪律 / 几何底座一行未改。
//
// ★ 纪律（94.txt §十八/§二十四）：
//   · 不碰 js/engine/**、不碰 Hotspot V3、不碰 PHASE 89~92 的自动追踪链。
//   · **不许用 bbox 冒充有效截面积** —— 所以本文件里每个"期望面积"都写成解析解，
//     而不是"程序算出来多少就断言多少"。
//   · 断言只针对**语义码与数值**，不针对中文文案（文案在显示层查 i18n）。
//   · 移动端布局不在这里 —— Node 没有排版引擎，实测在 scripts/browser_inspection_test.mjs。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tetMC, BOX, union } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { objectMetrics } from '../js/model/objectMetrics.js';
import { sectionShapeOf, classifySection, SECTION_TYPE, SHAPE_GATE } from '../js/model/sectionShape.js';
import { triangleComponents, meshSubset } from '../js/model/meshComponents.js';
import {
  KIND, LEVEL, GATING_REASON, GATING_CODE,
  gatingUnitsFromComponents, buildGatingAreas, summarizeGatingAreas,
} from '../js/model/processInspection.js';

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);
const rel = (got, want, tol, m) => {
  assert(Number.isFinite(got), `${m}：拿到的是 ${got}`);
  const e = Math.abs(got - want) / Math.abs(want);
  assert(e <= tol, `${m}（实际 ${got}，期望 ${want}，偏差 ${(e * 100).toFixed(2)}% > ${(tol * 100).toFixed(2)}%）`);
};

/* ---------------- 造网格（真实 MC → STL 文本 → 解析，测的是真实链路） ---------------- */

function meshOf(sdf, bounds, res) {
  const verts = tetMC(sdf, bounds, res);
  const lines = ['solid t'];
  for (let t = 0; t < verts.length / 9; t++) {
    lines.push('  facet normal 0 0 0', '    outer loop');
    for (let k = 0; k < 3; k++) lines.push(`      vertex ${verts[t * 9 + k * 3]} ${verts[t * 9 + k * 3 + 1]} ${verts[t * 9 + k * 3 + 2]}`);
    lines.push('    endloop', '  endfacet');
  }
  lines.push('endsolid t');
  return parseSTL(new TextEncoder().encode(lines.join('\n')));
}

/** 一份浇注系统 STL → 该类别下的单元（与页面**完全同一条路**：连通分量 + objectMetrics + 形状识别） */
function unitsOf(sdf, kind, name, bounds, res) {
  const mesh = meshOf(sdf, bounds, res);
  const cc = triangleComponents(mesh);
  return gatingUnitsFromComponents(mesh, kind, name, cc.components,
    (m) => objectMetrics(m, { withPoly: true }), (m) => sectionShapeOf(m));
}

/* ---------------- 基本体（解析解已知；外部为正） ---------------- */

const cylY = (cx, cz, r, y0, y1) => (p) => Math.max(Math.hypot(p[0] - cx, p[2] - cz) - r, Math.max(y0 - p[1], p[1] - y1));
const cylX = (cy, cz, r, x0, x1) => (p) => Math.max(Math.hypot(p[1] - cy, p[2] - cz) - r, Math.max(x0 - p[0], p[0] - x1));
/** 圆台（沿 Y，半径 r0 → r1）：直浇道的典型形状 */
const frustumY = (cx, cz, r0, r1, y0, y1) => (p) => Math.max(
  Math.hypot(p[0] - cx, p[2] - cz) - (r0 + (r1 - r0) * (p[1] - y0) / (y1 - y0)),
  Math.max(y0 - p[1], p[1] - y1),
);
/** 梯形棱柱（沿 X）：y ∈ [y0,y1] 上半宽 half0 → half1 */
const trapX = (y0, y1, half0, half1, x0, x1) => (p) => Math.max(
  Math.max(x0 - p[0], p[0] - x1),
  Math.max(y0 - p[1], p[1] - y1),
  Math.abs(p[2]) - (half0 + (half1 - half0) * (p[1] - y0) / (y1 - y0)),
);
/** 扇形内浇口：一片从原点张开的三角板（x ∈ [0,len]，|z| ≤ x·tanθ，y 有厚度） */
const fanGate = (len, tanHalf, y0, y1) => (p) => Math.max(
  Math.max(y0 - p[1], p[1] - y1), -p[0], p[0] - len, Math.abs(p[2]) - p[0] * tanHalf,
);
/** 沿 xz 平面上一段圆弧的管（弯曲横浇道）；R = 曲率半径，sweepDeg = 包角 */
function tubeArc(cx, cz, R, a0deg, a1deg, r, y0, y1) {
  const N = 64, segs = [];
  const a0 = a0deg * Math.PI / 180, a1 = a1deg * Math.PI / 180;
  for (let i = 0; i < N; i++) {
    const t0 = a0 + (a1 - a0) * i / N, t1 = a0 + (a1 - a0) * (i + 1) / N;
    segs.push([[cx + R * Math.cos(t0), cz + R * Math.sin(t0)], [cx + R * Math.cos(t1), cz + R * Math.sin(t1)]]);
  }
  return (p) => {
    if (p[1] < y0 || p[1] > y1) return Math.max(y0 - p[1], p[1] - y1);
    let best = Infinity;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L2 = dx * dx + dz * dz;
      let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[2] - a[1]) * dz) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p[0] - (a[0] + dx * t), p[2] - (a[1] + dz * t));
      if (d < best) best = d;
    }
    return best - r;
  };
}
/** 喇叭形内浇口：细颈 + 外扩口（两段有 2mm 重叠，避免恰好相切产生退化面） */
const trumpetGate = (cx, cz, rNeck, rMouth, y0, yMid, y1) => union(
  cylY(cx, cz, rNeck, y0, yMid + 2),
  frustumY(cx, cz, rNeck, rMouth, yMid, y1),
);

/** 解析面积 */
const A_CIRCLE = (d) => Math.PI * d * d / 4;

/* ---------------- 常用包络 ----------------
   ⚠ PAD 不是随手给的 6：四面体 MC 在网格点**恰好落在等值面上**（sdf == 0）时，
   会把该点判成"外部"，于是产出一批零面积三角形；这些三角形被 meshComponents 的
   退化过滤剔除后，它们的邻居就丢了一条边 → 组件被判成"不闭合"。
   实测同一组 3 个圆台：pad=6/res=96 → closed=true,true,**false**；pad=10/res=96 → 三个全闭合、退化面 0。
   这是**测试夹具的网格对齐问题**，不是产品逻辑问题（产品遇到不闭合本来就该拒绝给面积）。 */
const PAD = 10;
const env = (min, max) => [[min[0] - PAD, min[1] - PAD, min[2] - PAD], [max[0] + PAD, max[1] + PAD, max[2] + PAD]];

/* ============================================================
   A. 圆形截面
   ============================================================ */
function testA() {
  const r = 12, h = 60;
  const res = unitsOf(cylY(0, 0, r, -h / 2, h / 2), KIND.SPRUE, 'sprue.stl', env([-r, -h / 2, -r], [r, h / 2, r]), 96);
  assert(res.objects.length === 1, `A：一个圆柱应识别为 1 个单元，实际 ${res.objects.length}`);
  const u = res.objects[0];
  assert(u.shape?.type === SECTION_TYPE.CIRCULAR, `A：应判为圆形，实际 ${u.shape?.type}（circ=${u.shape?.circularity?.toFixed(3)}）`);
  rel(u.shape.dMm, 2 * r, 0.02, 'A：直径应≈⌀24');
  // 面积口径：圆形按 πD²/4，D 由实测面积反推 → 必须与实测截面面积一致
  rel(u.areaMm2, A_CIRCLE(2 * r), 0.03, 'A：截面积应≈π·12²');
  rel(u.areaMm2, u.shape.areaMm2, 1e-9, 'A：汇总用的面积必须就是形状识别给出的那个面积（不许两套口径）');
  rel(u.lengthMm, h, 0.03, 'A：轴向长度应≈60');
  assert(u.closed === true && u.areaReason === null, 'A：闭合圆柱的截面积必须可用');
}

/* ============================================================
   B. 方形 / 矩形截面
   ============================================================ */
function testB() {
  const W = 20, H = 15, L = 80;
  const res = unitsOf(BOX([-L / 2, -H / 2, -W / 2], [L / 2, H / 2, W / 2]), KIND.RUNNER, 'runner.stl',
    env([-L / 2, -H / 2, -W / 2], [L / 2, H / 2, W / 2]), 80);
  assert(res.objects.length === 1, `B：应识别为 1 个单元，实际 ${res.objects.length}`);
  const u = res.objects[0];
  assert(u.shape?.type === SECTION_TYPE.RECT, `B：应判为矩形，实际 ${u.shape?.type}（fill=${u.shape?.rectFill?.toFixed(3)}）`);
  const wh = [u.shape.wMm, u.shape.hMm].sort((a, b) => b - a);
  rel(wh[0], 20, 0.03, 'B：长边应≈20');
  rel(wh[1], 15, 0.03, 'B：短边应≈15');
  // 94.txt §五B 的定义式：A = W × H
  rel(u.areaMm2, 20 * 15, 0.03, 'B：截面积应≈W×H = 300');
  rel(u.lengthMm, L, 0.03, 'B：轴向长度应≈80');
}

/* ============================================================
   C. 梯形截面
   ============================================================ */
function testC() {
  const a = 10, b = 20, h = 15, L = 80;    // 上底 10 / 下底 20 / 高 15
  const res = unitsOf(trapX(0, h, b / 2, a / 2, -L / 2, L / 2), KIND.RUNNER, 'trap.stl',
    env([-L / 2, 0, -b / 2], [L / 2, h, b / 2]), 72);
  assert(res.objects.length === 1, `C：应识别为 1 个单元，实际 ${res.objects.length}`);
  const u = res.objects[0];
  assert(u.shape?.type === SECTION_TYPE.TRAPEZOID, `C：应判为梯形，实际 ${u.shape?.type}（quadFill=${u.shape?.evidence?.quadFill?.toFixed(3)}）`);
  const ab = [u.shape.topMm, u.shape.bottomMm].sort((x, y) => y - x);
  rel(ab[0], 20, 0.04, 'C：下底应≈20');
  rel(ab[1], 10, 0.06, 'C：上底应≈10');
  rel(u.shape.heightMm, 15, 0.04, 'C：高应≈15');
  // 94.txt §五C 的定义式：A = (a+b)h/2
  rel(u.areaMm2, (a + b) * h / 2, 0.04, 'C：截面积应≈(a+b)h/2 = 225');
}

/* ============================================================
   D. 多个独立圆柱（数量 = N，总面积 = ΣAi）
   ============================================================ */
function testD() {
  const N = 4, r = 10, h = 40, pitch = 40;
  const parts = [];
  for (let i = 0; i < N; i++) parts.push(cylY(i * pitch, 0, r, -h / 2, h / 2));
  const res = unitsOf(union(...parts), KIND.SPRUE, 'multi_sprue.stl',
    env([-r, -h / 2, -r], [(N - 1) * pitch + r, h / 2, r]), 96);
  assert(res.objects.length === N, `D：${N} 个互不相连的圆柱应识别为 ${N} 个单元，实际 ${res.objects.length}`);
  const per = A_CIRCLE(2 * r);
  for (const u of res.objects) rel(u.areaMm2, per, 0.04, `D：${u.id} 单件面积应≈π·10²`);
  const total = res.objects.reduce((s, u) => s + u.areaMm2, 0);
  rel(total, N * per, 0.04, `D：总截面积应≈${N}·π·10²`);
  // 编号必须是 S1..SN（94.txt §十 的"逐个列出"靠它）
  assert(res.objects.map((o) => o.id).join(',') === Array.from({ length: N }, (_, i) => 'S' + (i + 1)).join(','),
    `D：编号应为 S1..S${N}，实际 ${res.objects.map((o) => o.id).join(',')}`);
}

/* ============================================================
   E. 多个**不同尺寸**内浇口
   ============================================================ */
function testE() {
  const sizes = [8, 12, 16, 10];       // 直径
  const h = 25, pitch = 40;
  const parts = sizes.map((d, i) => cylY(i * pitch, 0, d / 2, -h / 2, h / 2));
  const res = unitsOf(union(...parts), KIND.INGATE, 'ingates.stl',
    env([-8, -h / 2, -8], [(sizes.length - 1) * pitch + 8, h / 2, 8]), 112);
  assert(res.objects.length === sizes.length, `E：应识别 ${sizes.length} 个单元，实际 ${res.objects.length}`);
  // 按 X 坐标排序后与输入尺寸一一对应（连通分量按扫描顺序产出，不保证顺序 → 用几何位置配对）
  const byX = res.objects.slice().sort((p, q) => p.metrics.center[0] - q.metrics.center[0]);
  sizes.forEach((d, i) => {
    rel(byX[i].areaMm2, A_CIRCLE(d), 0.05, `E：⌀${d} 的截面积`);
    rel(byX[i].shape?.dMm ?? NaN, d, 0.05, `E：⌀${d} 的等效直径`);
  });
  const want = sizes.reduce((s, d) => s + A_CIRCLE(d), 0);
  rel(byX.reduce((s, u) => s + u.areaMm2, 0), want, 0.05, 'E：总截面积 = ΣAi');
}

/* ============================================================
   F. 三类各自多件：3 直浇道 + 5 横浇道 + 10 内浇口
   ============================================================ */
function buildThreeKinds() {
  // 直浇道：⌀20 圆台 ×3
  const sR = 10, sH = 90, sPitch = 60;
  const sprues = unitsOf(
    union(...[0, 1, 2].map((i) => frustumY(i * sPitch, 0, sR, sR * 0.8, 0, sH))),
    KIND.SPRUE, 'sprue.stl', env([-sR, 0, -sR], [2 * sPitch + sR, sH, sR]), 96);

  // 横浇道：20×15 方管 ×5
  const rL = 70, rPitch = 30;
  const runners = unitsOf(
    union(...[0, 1, 2, 3, 4].map((i) => BOX([-rL / 2, i * rPitch - 7.5, -10], [rL / 2, i * rPitch + 7.5, 10]))),
    KIND.RUNNER, 'runner.stl', env([-rL / 2, -7.5, -10], [rL / 2, 4 * rPitch + 7.5, 10]), 96);

  // 内浇口：⌀14 圆柱 ×10（5 × 2 排布）
  const iPitch = 22, iR = 7, iH = 25;
  const pos = [];
  for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 5; ix++) pos.push([ix * iPitch, iy * iPitch]);
  const ingates = unitsOf(
    union(...pos.map(([x, z]) => cylY(x, z, iR, -iH / 2, iH / 2))),
    KIND.INGATE, 'ingate.stl', env([-iR, -iH / 2, -iR], [4 * iPitch + iR, iH / 2, iPitch + iR]), 128);

  return { sprues, runners, ingates };
}

let CACHE_F = null;
const threeKinds = () => (CACHE_F || (CACHE_F = buildThreeKinds()));

function testF() {
  const { sprues, runners, ingates } = threeKinds();
  assert(sprues.objects.length === 3, `F：直浇道应有 3 个单元，实际 ${sprues.objects.length}`);
  assert(runners.objects.length === 5, `F：横浇道应有 5 个单元，实际 ${runners.objects.length}`);
  assert(ingates.objects.length === 10, `F：内浇口应有 10 个单元，实际 ${ingates.objects.length}`);

  // 直浇道是圆台（沿轴向有锥度）→ 中段代表截面应落在两端半径之间
  const aSprueMin = A_CIRCLE(2 * 8), aSprueMax = A_CIRCLE(2 * 10);
  for (const u of sprues.objects) {
    assert(u.areaMm2 > aSprueMin * 0.9 && u.areaMm2 < aSprueMax * 1.1,
      `F：圆台单件截面积应落在 ⌀16~⌀20 之间，实际 ${u.areaMm2.toFixed(1)}`);
  }
  for (const u of runners.objects) rel(u.areaMm2, 300, 0.05, 'F：方管单件截面积应≈300');
  for (const u of ingates.objects) rel(u.areaMm2, A_CIRCLE(14), 0.06, 'F：内浇口单件截面积应≈π·7²');

  const a = buildGatingAreas({ [KIND.SPRUE]: sprues.objects, [KIND.RUNNER]: runners.objects, [KIND.INGATE]: ingates.objects });
  rel(a.kinds[0].totalMm2, 3 * 300 * 0.81, 0.15, 'F：直浇道总截面积（圆台，量级核对）');
  rel(a.kinds[1].totalMm2, 5 * 300, 0.05, 'F：横浇道总截面积 = 5 × 300');
  rel(a.kinds[2].totalMm2, 10 * A_CIRCLE(14), 0.06, 'F：内浇口总截面积 = 10 × π·7²');
  rel(a.totalMm2, a.kinds[0].totalMm2 + a.kinds[1].totalMm2 + a.kinds[2].totalMm2, 1e-9,
    'F：总截面积 = 三类之和');
  assert(a.presentKinds.length === 3 && !a.totalPartial, 'F：三类都导入且都量得出 → 不应标 partial');
}

/* ============================================================
   G. 复杂 / 不规则形状：算不出来必须 WARNING / null，禁止假精度
   ============================================================ */

function testG_multiloop() {
  // 方环（口字件）：100×100 外框、壁厚 20、高 60。
  // 三个方向尺度 100/100/60 → 不是平板（λ3/λ2≈0.36），于是会走到"切一刀"这一步；
  // 而主轴在 x 与 z 之间本来就分不出来，不论选哪个，中段一刀都会同时切到两条边 → 2 个独立闭合环。
  const ring = (p) => Math.max(
    Math.max(Math.abs(p[0]) - 50, Math.abs(p[1]) - 30, Math.abs(p[2]) - 50),
    -Math.max(Math.abs(p[0]) - 30, Math.abs(p[1]) - 31, Math.abs(p[2]) - 30),
  );
  const res = unitsOf(ring, KIND.RUNNER, 'ring.stl', env([-50, -30, -50], [50, 30, 50]), 80);
  assert(res.objects.length === 1, `G：方环是 1 个连通实体，实际 ${res.objects.length}`);
  const u = res.objects[0];
  assert(u.closed === true, 'G 前提：方环是闭合实体');
  // 只有两种结果是诚实的：量得出唯一的截面，或者明确说"没有唯一截面"并留空
  if (u.areaMm2 == null) {
    assert(u.areaReason === GATING_REASON.MULTI_LOOP || u.areaReason === GATING_REASON.SECTION_UNUSABLE
      || u.areaReason === GATING_REASON.AMBIGUOUS_AXIS,
      `G：量不出时必须给出明确原因，实际 ${u.areaReason}`);
    assert(u.shape?.usable === false, 'G：截面积不可用时形状也必须标不可用');
  } else {
    // 万一将来实现改成"只取最大那一环"，那也必须是个有限正数，且不能大于半个体量
    assert(u.areaMm2 > 0 && Number.isFinite(u.areaMm2), 'G：给了面积就必须是有限正数');
  }
}

/** 确定性地删掉每第 every 个面 → 制造真实破口（与 93 的 dropFaces 同一手法，无随机） */
function dropFaces(mesh, every) {
  const keep = [];
  for (let t = 0; t < mesh.triCount; t++) if (t % every !== 0) keep.push(t);
  const out = new Float32Array(keep.length * 9);
  keep.forEach((t, i) => { for (let k = 0; k < 9; k++) out[i * 9 + k] = mesh.vertices[t * 9 + k]; });
  return { vertices: out, triCount: keep.length };
}

function testG_unclosed() {
  const box = BOX([-30, -10, -10], [30, 10, 10]);
  const bounds = env([-30, -10, -10], [30, 10, 10]);
  // 前提：完整的盒子闭合、面积可用
  const whole = unitsOf(box, KIND.RUNNER, 'whole.stl', bounds, 48);
  assert(whole.objects.length === 1 && whole.objects[0].closed === true, 'G 前提：完整盒子应闭合');
  assert(whole.objects[0].areaMm2 > 0, 'G 前提：完整盒子的面积应可用');

  // 真破口：删掉每第 7 个面
  const broken = dropFaces(meshOf(box, bounds, 48), 7);
  const cc = triangleComponents(broken);
  const parts = gatingUnitsFromComponents(broken, KIND.RUNNER, 'broken.stl', cc.components,
    (m) => objectMetrics(m, { withPoly: true }), (m) => sectionShapeOf(m));
  assert(parts.objects.length >= 1, 'G：破口网格也应能拆出组件');
  const u = parts.objects[0];
  assert(u.closed === false, `G：删掉 1/7 的面之后必须判为不闭合（boundaryEdges=${u.boundaryEdges}）`);
  assert(u.areaMm2 === null, 'G：不闭合就**绝不能**给截面积（可能是缺了一块却仍闭合的假轮廓）');
  assert(u.areaReason === GATING_REASON.NOT_CLOSED, `G：原因码应为 not_closed，实际 ${u.areaReason}`);
  assert(u.volumeReliable === false, 'G：不闭合的体积同样不可信');
}

/**
 * 扇形内浇口（94.txt §十三.5 点名要验的形状）。
 *
 * ★ 实测结论（PHASE 94 建立的诚实边界）：一片 40 长 × 48 宽 × 8 厚的扇形板，
 *   主轴取的是平面内最长的方向（宽 48），垂直于它切出来的是"长 × 厚"；
 *   而真正的有效流通截面是"宽 × 厚"（垂直于充型方向）。要算对必须先知道充型方向
 *   —— 那是 94.txt §一 明确停掉的自动识别。
 *   PHASE 94 当时的处理是**如实拒绝**（留空 + ambiguous_axis）。
 *
 * ★★ PHASE 96 改了**后果**，没改判据（96.txt §六 / §二十一）：
 *   96.txt §六 把优先级定死为「第一优先：真实闭合截面的几何面积」；§二十一 又写明
 *   "对于一个扇形/弧边内浇口：**只要能够得到可靠闭合截面：直接计算闭合截面的真实几何面积**"。
 *   留空会让这个单元整个掉出总面积 —— 那正是用户实测到的"总面积偏小"（96.txt §二.3）。
 *   所以现在的契约是：**照给主轴那一刀的实测面积**（它确实是一个真实闭合截面），
 *   同时必须把 `axisUncertain` 标出来，并把另一条主轴的截面面积一并给出。
 *
 * ⚠ 这条断言是**改过**的历史断言：从"必须留空"改成"必须给实测值 + 必须标记"。
 *   不是放宽 —— 原来只要求"别撒谎"，现在还额外要求"把不确定性说出来"，
 *   而且明确禁止拿包围盒 / 长×宽 冒充（下面第 3、4 条）。
 */
function testG_noFakePrecision() {
  const res = unitsOf(fanGate(40, 0.6, 0, 8), KIND.INGATE, 'fan.stl', env([0, 0, -30], [40, 8, 30]), 80);
  assert(res.objects.length === 1, `G：扇形应是 1 个单元，实际 ${res.objects.length}`);
  const u = res.objects[0];
  assert(u.closed === true, 'G 前提：扇形板本身是闭合实体');
  // ① 方向不唯一必须标出来（不许悄悄给一个数）
  assert(u.axisUncertain === true, 'G：平板件的截面方向不唯一 —— 必须标记 axisUncertain');
  // ② 但面积要按 96.txt §二十一 给出来，且必须是**实测闭合截面**
  assert(u.areaMm2 != null && u.areaMm2 > 0, `G：能切出闭合截面就要给实测面积（实际 ${u.areaMm2}）`);
  assert(Number.isFinite(u.shape?.evidence?.measuredAreaMm2) && u.shape.evidence.measuredAreaMm2 > 0,
    'G：必须能追溯到"这一刀实测出来多少"（evidence.measuredAreaMm2）');
  assert(Math.abs(u.areaMm2 - u.shape.evidence.measuredAreaMm2) / u.shape.evidence.measuredAreaMm2 < 0.02,
    'G：报出来的面积必须与实测闭合截面一致（公式只能是实测值的另一种写法，不能另起炉灶）');
  // ③ 绝不能拿包围盒冒充（94.txt §十八）
  const sz = u.metrics.size;
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    assert(Math.abs(sz[i] * sz[j] - u.areaMm2) > 1e-6,
      `G：不许拿包围盒投影面积冒充有效截面积（bbox ${sz[i]}×${sz[j]} = ${sz[i] * sz[j]}，实测 ${u.areaMm2}）`);
  }
  // ④ 单元本身没有被"拒绝"：三维尺寸、体积、长度照给
  assert(u.lengthMm > 0 && u.metrics.volumeMm3 > 0, 'G：拒绝的从来不是整个单元');
  // ⑤ 方向确实有歧义 → "另一条主轴的截面"必须拿得出来，而且差得**看得见**
  //    （页面上的工位开了 altAxis；这里就地为这一个单元开，不动共用夹具）
  const mesh2 = meshOf(fanGate(40, 0.6, 0, 8), env([0, 0, -30], [40, 8, 30]), 80);
  const m2 = objectMetrics(mesh2, { withPoly: true, altAxis: true });
  const sh2 = sectionShapeOf(m2);
  assert(sh2.axisUncertain === true, 'G：方向不唯一的判定必须可复现');
  assert(Number.isFinite(sh2.altAreaMm2) && sh2.altAreaMm2 > 0,
    'G：必须给出另一条主轴的截面面积作对照（否则用户没法判断方向差多少）');
  assert(sh2.altSpreadPct > 5,
    `G：这个扇形两条主轴差 ${sh2.altSpreadPct}% —— 正是"方向有歧义"的实证，不该被判成无差别`);
}

/** 不规则但**量得出来**的那一类：圆角矩形/异形必须给实测面积，而不是套公式 */
function testG_irregularMeasured() {
  // 六边形棱柱：不是圆（八边形/六边形径向不匀），不是矩形（角多），但截面唯一 → 必须给出实测面积
  const R = 12, L = 60;
  const hex = (p) => {
    let d = -Infinity;
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      d = Math.max(d, p[0] * Math.cos(a) + p[2] * Math.sin(a) - R * Math.cos(Math.PI / 6));
    }
    return Math.max(d, Math.abs(p[1]) - L / 2);
  };
  const res = unitsOf(hex, KIND.RUNNER, 'hex.stl', env([-R, -L / 2, -R], [R, L / 2, R]), 80);
  const u = res.objects[0];
  assert(u.shape?.type === SECTION_TYPE.IRREGULAR, `G：六边形应判为不规则，实际 ${u.shape?.type}`);
  const analytic = (3 * Math.sqrt(3) / 2) * R * R;     // 正六边形面积
  rel(u.areaMm2, analytic, 0.04, 'G：不规则截面的面积必须取实测几何面积');
}

/* ============================================================
   H. 一个 STL → N 个组件必须可靠（94.txt §十三 最关注的一条）
   ============================================================ */
function testH_manyInOneFile() {
  // 一个文件里塞 20 个互不相连的小圆柱 —— 必须数出 20
  const N = 20, r = 6, h = 20, pitch = 18;
  const pos = [];
  for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 5; ix++) pos.push([ix * pitch, iy * pitch]);
  const res = unitsOf(union(...pos.map(([x, z]) => cylY(x, z, r, -h / 2, h / 2))), KIND.INGATE, 'many.stl',
    env([-r, -h / 2, -r], [4 * pitch + r, h / 2, 3 * pitch + r]), 144);
  assert(res.objects.length === N, `H：一个 STL 里 ${N} 个独立实体必须数出 ${N}，实际 ${res.objects.length}`);
  const total = res.objects.reduce((s, u) => s + (u.areaMm2 || 0), 0);
  rel(total, N * A_CIRCLE(2 * r), 0.08, 'H：总截面积 = ΣAi');
  assert(res.objects.every((u) => u.id && u.closed), 'H：每个单元都要有自己的编号且闭合');
}

/* ============================================================
   I / J / K. 缺类别不伪造 / 占比 = 100% / 部分测不出要标 partial
   ============================================================ */
function testI_partialCategories() {
  const { runners, ingates } = threeKinds();
  // 只导入横浇道 + 内浇口（94.txt §八 的例子）
  const a = buildGatingAreas({ [KIND.RUNNER]: runners.objects, [KIND.INGATE]: ingates.objects });
  assert(a.presentKinds.join(',') === 'runner,ingate', `I：只应有两个类别，实际 ${a.presentKinds.join(',')}`);
  assert(a.kinds.find((k) => k.kind === KIND.SPRUE).imported === false, 'I：直浇道必须标"未导入"');
  assert(a.kinds.find((k) => k.kind === KIND.SPRUE).totalMm2 === null, 'I：未导入的类别不许有数值（尤其不许当 0）');
  // 比例必须以**第一个已导入**的类别为基准 → 横 : 内
  assert(a.ratio && a.ratio.base === KIND.RUNNER, `I：比例基准应是横浇道，实际 ${a.ratio?.base}`);
  assert(a.ratio.entries.length === 2, `I：比例只列两个类别，实际 ${a.ratio.entries.length}`);
  rel(a.ratio.entries[1].value, a.kinds[1].totalMm2 === null ? NaN : (a.kinds[2].totalMm2 / a.kinds[1].totalMm2), 1e-9, 'I：内/横 比值');
}

function testJ_shareSumsTo100() {
  const { sprues, runners, ingates } = threeKinds();
  const a = buildGatingAreas({ [KIND.SPRUE]: sprues.objects, [KIND.RUNNER]: runners.objects, [KIND.INGATE]: ingates.objects });
  assert(a.share && a.share.length === 3, 'J：三个类别都导入时占比应有三项');
  near(a.share.reduce((s, x) => s + x.pct, 0), 100, 1e-9, 'J：占比之和必须 = 100%（94.txt §八）');
  // 只导入两类时同样 = 100%
  const b = buildGatingAreas({ [KIND.RUNNER]: runners.objects, [KIND.INGATE]: ingates.objects });
  near(b.share.reduce((s, x) => s + x.pct, 0), 100, 1e-9, 'J：两类时占比之和也必须 = 100%');
}

function testK_partialTotal() {
  const { runners } = threeKinds();
  const good = runners.objects.map((o) => ({ ...o }));
  // 把其中一个单元的截面积打成 null（模拟"这个单元量不出来"）
  const bad = good.map((o, i) => (i === 0 ? { ...o, areaMm2: null, areaReason: GATING_REASON.MULTI_LOOP } : { ...o }));
  const a = buildGatingAreas({ [KIND.RUNNER]: bad });
  const k = a.kinds[1];
  assert(k.count === 5 && k.usableCount === 4, `K：5 个单元里 4 个可量，实际 ${k.count}/${k.usableCount}`);
  assert(k.partial === true, 'K：有单元没算进去 → 必须标 partial（不能让部分和看起来像总和）');
  rel(k.totalMm2, good.slice(1).reduce((s, o) => s + o.areaMm2, 0), 1e-9, 'K：totalMm2 = 已测得部分之和');
  assert(a.totalPartial === true, 'K：整体也要能看出来"这个总和不是全部"');
  const s = summarizeGatingAreas({ areas: a });
  assert(s.items.some((i) => i.code === GATING_CODE.PARTIAL_TOTAL && i.level === LEVEL.WARNING),
    'K：partial 必须在汇总里出一条 WARNING');
}

/* ============================================================
   L. 异形但量得出来：喇叭口 / 弯曲横浇道（§十三.6/§十三.8）
   ============================================================ */
function testL_trumpet() {
  const res = unitsOf(trumpetGate(0, 0, 6, 14, 0, 20, 45), KIND.INGATE, 'trumpet.stl',
    env([-14, 0, -14], [14, 45, 14]), 88);
  assert(res.objects.length === 1, `L：喇叭口应是 1 个单元，实际 ${res.objects.length}`);
  const u = res.objects[0];
  // 喇叭口沿轴向直径 12→28 连续变化：要么给一个落在两端之间的代表值，要么如实说没有唯一截面
  if (u.areaMm2 != null) {
    assert(u.areaMm2 > A_CIRCLE(12) * 0.85 && u.areaMm2 < A_CIRCLE(28) * 1.15,
      `L：喇叭口的代表截面积必须落在 ⌀12~⌀28 之间，实际 ${u.areaMm2.toFixed(1)}`);
    assert(u.shape?.type === SECTION_TYPE.CIRCULAR, `L：喇叭口的截面仍是圆，实际 ${u.shape?.type}`);
  } else {
    assert(u.areaReason, 'L：不给面积就必须给原因');
  }
}

function testL_curvedRunner() {
  // 曲率半径 120、包角 60°、管径 ⌀24 —— 温和弯曲，主轴≈弦
  const res = unitsOf(tubeArc(0, 0, 120, 60, 120, 12, -12, 12), KIND.RUNNER, 'curved.stl',
    env([-60, -12, -12], [120, 12, 120]), 96);
  assert(res.objects.length === 1, `L：弯曲横浇道应是 1 个单元，实际 ${res.objects.length}`);
  const u = res.objects[0];
  // 诚实边界：允许"量不出并给原因"，但**不许**给一个明显错的数
  if (u.areaMm2 != null) {
    rel(u.areaMm2, A_CIRCLE(24), 0.20, 'L：弯曲横浇道的代表截面积应仍接近 π·12²（主轴弦切时会有偏大/偏小）');
  } else {
    assert(u.areaReason, 'L：量不出就必须给原因，不许留白');
  }
}

/* ============================================================
   M. 汇总永远不出 PASS（94.txt §九：本阶段不输出 PASS / FAIL）
   ============================================================ */
function testM_neverPass() {
  const { sprues, runners, ingates } = threeKinds();
  const cases = [
    {},                                                          // 什么都没导入
    { [KIND.SPRUE]: sprues.objects },                            // 只导入一类
    { [KIND.SPRUE]: sprues.objects, [KIND.RUNNER]: runners.objects, [KIND.INGATE]: ingates.objects }, // 全导入且全量得出
    { [KIND.RUNNER]: [{ id: 'G1', name: 'x', closed: true, areaMm2: null, areaReason: GATING_REASON.MULTI_LOOP, metrics: {} }] },
  ];
  for (const [i, byKind] of cases.entries()) {
    const s = summarizeGatingAreas({ areas: buildGatingAreas(byKind) });
    assert(s.items.every((x) => x.level !== LEVEL.PASS), `M：第 ${i} 种输入出现了 PASS —— §九 明确禁止`);
    assert(s.level !== LEVEL.PASS, `M：第 ${i} 种输入的总体级别不许是 PASS`);
    assert(s.items.every((x) => x.level === LEVEL.INFO || x.level === LEVEL.WARNING), `M：第 ${i} 种输入出现了非 INFO/WARNING 级别`);
  }
  // 全导入且一切正常时，连一条 WARNING 都不该有 —— 但仍然是 INFO，不是 PASS
  const ok = summarizeGatingAreas({ areas: buildGatingAreas({ [KIND.SPRUE]: sprues.objects, [KIND.RUNNER]: runners.objects, [KIND.INGATE]: ingates.objects }) });
  assert(ok.warns === 0, `M：全部量得出时不应有 WARNING，实际 ${ok.warns}`);
  assert(ok.level === LEVEL.INFO, `M：warns=0 也只能是 INFO，实际 ${ok.level}`);
}

/* ============================================================
   N. 空输入 / 无实体：不报错，如实说
   ============================================================ */
function testN_emptyAndNoSolid() {
  const empty = summarizeGatingAreas({ areas: buildGatingAreas({}) });
  assert(empty.items.length === 1 && empty.items[0].code === GATING_CODE.NO_INPUT && empty.items[0].level === LEVEL.INFO,
    'N：没导入任何东西 → 一条 INFO 的 NO_INPUT，不是错误');
  const a = buildGatingAreas({ [KIND.SPRUE]: [] });
  assert(a.kinds[0].imported === false && a.present.length === 0, 'N：空数组等于没导入');
  assert(a.totalMm2 === null && a.ratio === null && a.share === null, 'N：没有任何数据时不许编出总截面积/比例/占比');
}

/* ============================================================
   O. 阈值纪律（源码级）：口径集中，不许散落的魔法数
   ============================================================ */
function testO_thresholds() {
  const src = readFileSync(join(here, '..', 'js', 'model', 'sectionShape.js'), 'utf8');
  assert(/export const SHAPE_GATE = \{/.test(src), 'O：形状判定的全部阈值必须集中在 SHAPE_GATE 一处');
  for (const k of ['CIRCULARITY_MIN', 'RADIAL_SPREAD_MAX', 'RECT_FILL_MIN', 'QUAD_FILL_MIN', 'TRAPEZOID_TOL', 'PARALLEL_DEG']) {
    assert(new RegExp(`\\b${k}\\b`).test(src), `O：SHAPE_GATE 缺少 ${k}`);
  }
  const gate = SHAPE_GATE;
  assert(gate.QUAD_FILL_MIN > 2 / Math.PI + 0.2 && gate.QUAD_FILL_MIN < 1,
    `O：四边形解释率闸门应把"正圆"（2/π≈0.637）挡在外面，实际 ${gate.QUAD_FILL_MIN}`);
  assert(gate.RECT_FILL_MIN > Math.PI / 4, 'O：矩形填充率闸门必须高于正圆的 0.785');
  // 不允许在判定函数里出现硬编码的面积/尺寸阈值
  const body = src.slice(src.indexOf('export function classifySection'));
  const hard = body.match(/(?<![\w.])\d+(\.\d+)?\s*[<>]=?\s*(?![\w.]*\()/g) || [];
  assert(hard.length === 0, `O：classifySection 里出现了硬编码比较阈值：${hard.join(' ')}`);
}

/* ============================================================
   P. 措辞纪律（源码级）：不做工程判断（94.txt §九 → PHASE 95 按 95.txt §十 收窄，见下方注释）
   ============================================================ */
function testP_wording() {
  const raw = readFileSync(join(here, '..', 'js', 'views', 'inspectionCenter.js'), 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // ⚠ 只扫**浇注系统模块 B** 那一段：冒口检测那侧说"模数比不足，建议加大冒口"
  //   是 PHASE 93 §十 允许的（它本来就有一个明确的判据），不属于 94.txt §九 的禁令范围。
  //   区间取 [模块 B 起始, PHASE 93 §十四 的历史代码分界)，正好是这一整块
  const src = strip(raw.slice(
    raw.indexOf('模块 B：浇注系统检测（PHASE 94 · 94.txt'),
    raw.indexOf('PHASE 93 §十四：以下整段'),
  ));
  assert(src.length > 500, 'P：浇注系统模块代码块没找到');
  assert(!/riserVerdict/.test(src), 'P：区间取错了 —— 冒口检测的判语不该落进来');
  /* ⚠ PHASE 95 收窄了这一条（**收窄，不是放宽**，理由必须写清楚）：
     95.txt §六/§八/§十 明确要求本模块**要**给出「浇注时间 / 总流量 / 平均内浇口速度」，
     94.txt §九 的"不算这三个"被新命令取代。于是禁止清单换成 95.txt §十 **逐字列出**的
     "暂时不要增加"：湍流预测 / 充型动画 / 压力计算 / 每个内浇口真实流量分配 / MAGMA 级流场预测。
     另加"充型时间"——本版没有这个输出（§十 的工艺计算只有浇注时间），出现它只能是措辞混淆。
     ★ 防编造纪律一条都没放松：下面的 judge（判定词）原样保留，文件末尾还补了三条**加强**断言
       （新能力必须真的在 / 浇注时间必须来自 calcs/gating.js 的 calc_t / 不许抄公式系数）。 */
  const banned = /(充型时间|充型动画|雷诺数|湍流|压力损失|每个内浇口真实流量|流场预测)/;
  // 不做工程判断：判语里不许出现这些词
  const judge = /(比例合理|比例正确|设计正确|内浇口太小|内浇口偏小|应该加大|应该减小|建议加大|建议减小)/;
  // 否定句白名单：`本页只做几何测量…不判断比例是否合理` 这类是**辟谣文案**，要留着
  const negated = /(不判断|不做|不计算|不等同|不代表|不是|禁止|无法)/;

  const lines = src.split('\n').filter((l) => l.includes('tr('));
  for (const l of lines) {
    // 逐句判：一句里只要出现了否定限定，这一句就不算"做了判断"
    for (const sentence of l.split(/[。；]/)) {
      if (negated.test(sentence)) continue;
      assert(!judge.test(sentence), `P：浇注系统文案里出现了工程判断：${sentence.trim()}`);
      assert(!banned.test(sentence), `P：浇注系统文案里出现了本阶段推迟的物理量：${sentence.trim()}`);
    }
  }

  /* ---- PHASE 95 补偿性加强（收窄了 banned 就必须在别处收紧） ---- */
  // ① 95.txt §四/§十 的新能力必须在主界面上真实存在，将来重构不许悄悄弄丢
  for (const k of ['浇注时间', '总流量', '平均内浇口速度', '内浇口总面积']) {
    assert(src.includes(`tr('${k}')`), `P95：主界面必须给出「${k}」（95.txt §四/§十）`);
  }
  // ② 浇注时间与流速**只许调用**经典计算器，不许在检测中心里出现第二套公式
  const model = readFileSync(join(here, '..', 'js', 'model', 'processInspection.js'), 'utf8');
  assert(/from '\.\.\/\.\.\/calcs\/gating\.js'/.test(model), 'P95：processInspection 必须从 calcs/gating.js 取公式');
  assert(/calc_t\(/.test(model) && /calc_v\(/.test(model),
    'P95：浇注时间 → calc_t、平均内浇口速度 → calc_v，两处都必须直接调用（95.txt §六/§十二）');
  // ③ 公式系数一个都不许抄进来（抄了就说明有人复制了第二套）
  assert(!/0\.70\s*\*|2\.4335|Math\.cbrt\(|71\.47/.test(model),
    'P95：processInspection 里不许出现浇注时间/奥赞的公式系数 —— 只许调用，不许复制');
}

/* ============================================================
   Q. 几何底座：PHASE 90/93 的语义一行未改，PHASE 94 全是追加
   ============================================================ */
function testQ_baseUntouched() {
  const mesh = meshOf(BOX([-20, -20, -20], [20, 20, 20]), env([-20, -20, -20], [20, 20, 20]), 40);
  // 不带 withPoly：不得出现 repLoops / loopInfo[].poly（默认关闭，付了性能才有数据）
  const m0 = objectMetrics(mesh);
  assert(m0.section.repLoops === undefined, 'Q：默认不该产出 repLoops（PHASE 94 是 opt-in）');
  assert(m0.section.rep > 0 && m0.section.usable === true, 'Q：PHASE 88 的 section 语义必须原样');
  // 带 withPoly：追加 repLoops，且 rep 必须一字不变
  const m1 = objectMetrics(mesh, { withPoly: true });
  assert(m1.section.rep === m0.section.rep, 'Q：开 withPoly 不许改变 rep（纯追加）');
  assert(Array.isArray(m1.section.repLoops) && m1.section.repLoops.length >= 1, 'Q：withPoly 应产出中位那一刀的环');
  const L = m1.section.repLoops[0];
  assert(Array.isArray(L.poly) && L.poly.length >= 3, 'Q：loopInfo 每一环应带多边形');
  assert(L.poly[0][0] !== L.poly[L.poly.length - 1][0] || L.poly[0][1] !== L.poly[L.poly.length - 1][1],
    'Q：poly 首尾不该是同一个点（收尾重复点要去掉）');
  // 面积一致性：poly 的面积就是这一环的 area
  let a2 = 0;
  for (let i = 0; i < L.poly.length; i++) {
    const p = L.poly[i], q = L.poly[(i + 1) % L.poly.length];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  rel(Math.abs(a2) / 2, L.area, 1e-9, 'Q：poly 的面积必须等于该环的 area');
  // axisLengthMm 是追加字段，不影响既有字段
  assert(Number.isFinite(m1.axisLengthMm) && Math.abs(m1.axisLengthMm - 40) < 1, 'Q：axisLengthMm 应≈40');
  assert(m1.volumeMm3 === m0.volumeMm3 && m1.areaMm2 === m0.areaMm2 && m1.modulusMm === m0.modulusMm,
    'Q：withPoly 不许动体积/面积/模数');
}

/* ============================================================
   R. classifySection 的退化输入：一律 usable:false + 原因，绝不抛异常
   ============================================================ */
function testR_degenerateInputs() {
  for (const [input, label] of [[undefined, 'undefined'], [null, 'null'], [[], '空数组'], [[{}], '空环'], [[{ area: 0 }], '零面积环']]) {
    const r = classifySection(input);
    assert(r.usable === false && r.areaMm2 === null && r.type === null, `R：${label} → 必须 usable:false / 面积 null`);
    assert(typeof r.reason === 'string' && r.reason.length > 0, `R：${label} → 必须给原因码`);
  }
  // 两个独立环 → 没有唯一截面
  const poly = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const two = classifySection([{ area: 100, poly }, { area: 100, poly }]);
  assert(two.usable === false && two.reason === 'multi_loop', `R：双环应判 multi_loop，实际 ${two.reason}`);
  // 单个正方形 → 矩形
  const rect = classifySection([{ area: 100, poly }]);
  assert(rect.usable && rect.type === SECTION_TYPE.RECT && Math.abs(rect.areaMm2 - 100) < 1e-9, 'R：正方形应判矩形且面积为 100');
  assert(rect.wMm === 10 && rect.hMm === 10, `R：正方形 W/H 都应是 10，实际 ${rect.wMm}/${rect.hMm}`);
}

/* ============================================================
   S. 主流程不再依赖 PHASE 89~92 的自动追踪（94.txt §十六/§十八）
   ============================================================ */
function testS_noAutoTrace() {
  const src = readFileSync(join(here, '..', 'js', 'views', 'inspectionCenter.js'), 'utf8');
  // ⚠ 只看**主流程**（render 到 PHASE 93 §十四 的历史代码分界）：
  //   分界以下那一段是 PHASE 89~92 的历史实现，94.txt §十六 要求**留着**，不算违规。
  const body = src
    .slice(src.indexOf('export function render('), src.indexOf('PHASE 93 §十四：以下整段'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert(body.length > 1000, 'S：主流程代码块没找到');
  // 自动追踪的入口不许出现在主流程里被调用
  assert(!/findConnections\s*\(/.test(body), 'S：主流程不许再调用 findConnections（PHASE 92 的自动连接检测）');
  assert(!/traceFlow\s*\(/.test(body), 'S：主流程不许再调用 traceFlow');
  assert(!/refreshFlow\s*\(/.test(body), 'S：主流程不许再调用 refreshFlow');
  assert(!/setFlowOverlay\s*\(/.test(body), 'S：主流程不许再画流道叠加层');
  // 但历史代码必须**在**（§十六：不要删除）
  assert(/async function loadGating\(/.test(src), 'S：PHASE 89 的 loadGating 必须保留');
  assert(/function traceFlow\(/.test(src) || /traceFlow\(/.test(src), 'S：flowTrace 的调用代码必须保留');
  // 三个语义槽必须在，而且**每个只能 1 个文件**（§二）
  assert(/const IMPORT_SLOTS = \[KIND\.PRODUCT, KIND\.RISER, KIND\.SPRUE, KIND\.RUNNER, KIND\.INGATE\]/.test(body),
    'S：导入槽必须是 产品/冒口/直浇道/横浇道/内浇口 五个');
  const gslot = body.slice(body.indexOf('function gatingSlot'), body.indexOf('function switchTab'));
  assert(gslot.length > 0 && !/multiple/.test(gslot), 'S：浇注系统的每个类别只能导入 1 个 STL，不许 multiple');
}

/* ============================================================
   T. 单元字段完备性（94.txt §四：编号/数量/是否封闭/包围盒/长度/截面积/截面类型/体积）
   ============================================================ */
function testT_unitFields() {
  const { runners } = threeKinds();
  for (const u of runners.objects) {
    assert(typeof u.id === 'string' && u.id, 'T：单元必须有编号');
    assert(typeof u.closed === 'boolean', 'T：单元必须说明是否封闭');
    assert(Array.isArray(u.bounds?.size) && u.bounds.size.length === 3, 'T：单元必须有包围盒');
    assert(Number.isFinite(u.lengthMm) && u.lengthMm > 0, 'T：单元必须有轴向长度');
    assert(u.shape && typeof u.shape === 'object', 'T：单元必须有截面描述');
    assert(Number.isFinite(u.metrics.volumeMm3) && u.metrics.volumeMm3 > 0, 'T：闭合单元必须有体积');
    assert(u.volumeReliable !== false, 'T：闭合单元的体积可信');
  }
  // 编号前缀：直 S / 横 G / 内 I（与 KIND_META 一致，且不与冒口 R 冲突）
  const { sprues, ingates } = threeKinds();
  assert(sprues.objects.every((u) => /^S\d+$/.test(u.id)), 'T：直浇道编号应为 S1/S2…');
  assert(runners.objects.every((u) => /^G\d+$/.test(u.id)), 'T：横浇道编号应为 G1/G2…');
  assert(ingates.objects.every((u) => /^I\d+$/.test(u.id)), 'T：内浇口编号应为 I1/I2…');
}

/* ============================================================ */

export const tests = [
  { name: '94-A 圆形截面：⌀24 圆柱 → 判为圆形，直径与 πD²/4 面积', fn: testA },
  { name: '94-B 矩形截面：20×15 方管 → 判为矩形，A = W×H', fn: testB },
  { name: '94-C 梯形截面：上10/下20/高15 → 判为梯形，A = (a+b)h/2', fn: testC },
  { name: '94-D 多个独立圆柱：数量 = N，总面积 = ΣAi，编号 S1..SN', fn: testD },
  { name: '94-E 多个不同尺寸内浇口：数量 / 单件面积 / 总面积', fn: testE },
  { name: '94-F 三类各自多件：3 直 + 5 横 + 10 内，三类数量与总截面积', fn: testF },
  { name: '94-G1 复杂形状（U 形）：要么量得出唯一截面，要么明确说没有', fn: testG_multiloop },
  { name: '94-G2 不闭合实体：截面积一律不给（不许拿缺块的假轮廓充数）', fn: testG_unclosed },
  // ⚠ PHASE 96 改了这条的**行为**（理由见函数头注释）：从"留空"改成
  //   "给实测面积 + 必须标 axisUncertain + 不许等于任意一对 bbox 边的乘积"。
  { name: '94-G3 扇形内浇口：给实测面积 + 标出方向未确认，绝不假精度（PHASE 96 改）', fn: testG_noFakePrecision },
  { name: '94-G4 不规则但量得出（六边形）：面积取实测几何面积', fn: testG_irregularMeasured },
  { name: '94-H 一个 STL → 20 个独立组件必须数得准（94.txt §十三 最关注）', fn: testH_manyInOneFile },
  { name: '94-I 只导入部分类别：缺的标"未导入"，比例按实际存在的类别算', fn: testI_partialCategories },
  { name: '94-J 占比之和 = 100%（全导入 / 部分导入都要）', fn: testJ_shareSumsTo100 },
  { name: '94-K 有单元量不出：总和标 partial，不许看起来像全部之和', fn: testK_partialTotal },
  { name: '94-L1 喇叭形内浇口：代表截面必须落在两端直径之间', fn: testL_trumpet },
  { name: '94-L2 弯曲横浇道：量得出就给接近真值的数，量不出就给原因', fn: testL_curvedRunner },
  { name: '94-M 汇总永远不出 PASS / FAIL（94.txt §九）', fn: testM_neverPass },
  { name: '94-N 空输入 / 无实体：如实说明，不报错、不编数', fn: testN_emptyAndNoSolid },
  { name: '94-O 阈值纪律：判定阈值集中在 SHAPE_GATE，判定函数里无硬编码', fn: testO_thresholds },
  { name: '94-P 措辞纪律：浇注系统仍不做工程判断（PHASE 95 起允许给浇注时间/流量/流速）', fn: testP_wording },
  { name: '94-Q 几何底座：PHASE 88/90 语义一行未改，PHASE 94 全是追加', fn: testQ_baseUntouched },
  { name: '94-R 退化输入不抛异常，一律 usable:false + 原因码', fn: testR_degenerateInputs },
  { name: '94-S 主流程不依赖 PHASE 89~92 自动追踪，三个语义槽各限 1 个文件', fn: testS_noAutoTrace },
  { name: '94-T 单元字段完备（§四：编号/封闭/包围盒/长度/截面/体积）', fn: testT_unitFields },
];
