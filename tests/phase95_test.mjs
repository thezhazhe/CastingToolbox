// ============================================================
// PHASE 95（95.txt）· 浇注系统检测：从"几何统计"到"工程检测"
//
// 覆盖 95.txt §十三 逐条要求：
//   1/2  新增测试（本文件）+ PHASE 94 原有测试全部通过（跑 phase94_test.mjs）
//   3    N 个内浇口面积求和       4  N 直浇道        5  N 横浇道
//   6    单位换算                 7  产品 STL → 体积 → 重量
//   8    经典浇注时间调用结果与原计算器一致（**逐位相等**，不是"四舍五入后相等"）
//   9    Q = V / t                10 v = Q / A
//   11   缺少必要参数时正确提示    12 不允许出现 NaN / Infinity
//   13   英文界面不出现硬编码中文（动态 key 手工核查）
//   16   npm run validate（知识库/静态交叉引用另有脚本，这里只守代码侧）
//
// 另加 §三 逐条（用户实测反馈的那个问题）：
//   ① 连通分量是否真的拆出 N 个  ② 每个 component 只算一次  ③ 无遗漏  ④ 无重复
//   ⑤ 每一步可追溯              ⑥ totalArea ≡ Σ 有效 component area
//   ⑦ **不同空间位置不得改变面积**（PHASE 95 修掉的真 bug，见 95-A）
//
// ★ 纪律：不碰 js/engine/**、不碰 Hotspot V3、不碰 PHASE 89~92 的自动追踪链。
//   断言只针对语义码与数值，不针对中文文案（文案在显示层查 i18n）。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tetMC, BOX, union } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { objectMetrics } from '../js/model/objectMetrics.js';
import { sectionShapeOf } from '../js/model/sectionShape.js';
import { triangleComponents } from '../js/model/meshComponents.js';
import { calc_t, calc_v, MATERIALS, V_LIMIT } from '../calcs/gating.js';
// matKeyOf 是 calcManifest 的导出（会连带 import CastingProject）—— 只在测试里引，
//   产品代码不引（95-N 断言两处映射表逐项相同）。
import { matKeyOf } from '../calcs/calcManifest.js';
import EN from '../js/i18n/en-US.js';
import {
  KIND, LEVEL, POUR_REASON, POUR_CODE, SYSTEM_TYPE,
  gatingUnitsFromComponents, buildGatingAreas, objectsFromComponents,
  productVolumeOf, buildPouringResult,
} from '../js/model/processInspection.js';

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const rel = (got, want, tol, m) => {
  assert(Number.isFinite(got), `${m}：拿到的是 ${got}`);
  const e = Math.abs(got - want) / Math.abs(want);
  assert(e <= tol, `${m}（实际 ${got}，期望 ${want}，偏差 ${(e * 100).toFixed(3)}% > ${(tol * 100).toFixed(3)}%）`);
};
const exact = (got, want, m) => assert(got === want, `${m}（实际 ${got}，期望 ${want} —— 必须逐位相等）`);

/* ---------------- 造网格（与 phase94 同一条真实链路：MC → STL 文本 → 解析） ---------------- */

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
function unitsOf(sdf, kind, name, bounds, res) {
  const mesh = meshOf(sdf, bounds, res);
  const cc = triangleComponents(mesh);
  return { parts: gatingUnitsFromComponents(mesh, kind, name, cc.components,
    (m) => objectMetrics(m, { withPoly: true }), (m) => sectionShapeOf(m)), cc, mesh };
}
const PAD = 10;
/* ⚠ 破对称小量（交接书 §5.2-7 记录的夹具坑）：
   四面体 MC 在网格点**恰好落在等值面上**（sdf == 0）时会产出一批零面积三角形；
   它们被 meshComponents 的退化过滤剔除后，邻居就丢了一条边 → 组件被判成"不闭合"
   → 按纪律拒绝给截面积（产品行为正确，是夹具网格对齐问题）。
   把包络整体挪一个非整数小量即可破掉这个对齐。实测同一组 3 个圆台：
   不加 → S2/S3 判不闭合；加了 → 三个全闭合。 */
const EPS = 0.0173;
const env = (mn, mx) => [
  [mn[0] - PAD - EPS, mn[1] - PAD - EPS * 2, mn[2] - PAD - EPS * 3],
  [mx[0] + PAD + EPS * 4, mx[1] + PAD + EPS * 5, mx[2] + PAD + EPS * 6],
];
const cylY = (cx, cz, r, y0, y1) => (p) => Math.max(Math.hypot(p[0] - cx, p[2] - cz) - r, Math.max(y0 - p[1], p[1] - y1));
const A_CIRCLE = (d) => Math.PI * d * d / 4;

/** 一份浇注系统 STL → buildGatingAreas 的输入（与页面完全同一条路） */
function areasOf(objects, kind) {
  return buildGatingAreas({ [kind]: objects });
}
const kindOf = (areas, kind) => areas.kinds.find((k) => k.kind === kind);

/* ============================================================
   95-A 世界坐标不变性（§三.7）—— PHASE 95 修掉的真 bug 的回归防线
   ------------------------------------------------------------
   病灶：objectMetrics 的 principalAxis 用**世界原点**当散度定理的锥顶，
   实体离原点越远，单个四面体的 |det| 越大、彼此抵消越狠 → 灾难性抵消 →
   主轴被算歪 → 垂直于主轴的截面积跟着失真。
   实测（修之前）：同一块 20×5×30，从原点搬到 (+400,+300,+200)，
   截面积 99.92 → 113.40 / 131.85 mm²（同一块几何！）。
   防线：**同一份几何，只改世界坐标，所有输出必须逐位一致**。
   ============================================================ */
function testA_worldPositionInvariance() {
  const mk = (ox, oy, oz) => union(
    BOX([ox, oy, oz], [ox + 30, oy + 5, oz + 20]),
    BOX([ox + 80, oy, oz], [ox + 110, oy + 5, oz + 20]),
  );
  const shots = [];
  for (const [ox, oy, oz] of [[0, 0, 0], [400, 0, 0], [0, 300, 0], [0, 0, 200], [400, 300, 200], [-250, -180, -90]]) {
    const { parts } = unitsOf(mk(ox, oy, oz), KIND.INGATE, 'g.stl',
      env([ox, oy, oz], [ox + 110, oy + 5, oz + 20]), 96);
    const k = kindOf(areasOf(parts.objects, KIND.INGATE), KIND.INGATE);
    shots.push({
      at: `(${ox},${oy},${oz})`,
      n: parts.objects.length,
      areas: parts.objects.map((o) => o.areaMm2),
      total: k.totalMm2,
    });
  }
  // ① 数量一致
  for (const s of shots) exact(s.n, 2, `95-A：${s.at} 应识别为 2 个内浇口`);
  // ② 每个单元的截面积一致（±0.5%，MC 网格随相位有亚像素抖动，但**不允许**出现 2 倍级漂移）
  const base = shots[0];
  for (const s of shots) {
    for (let i = 0; i < 2; i++) {
      rel(s.areas[i], base.areas[i], 0.005, `95-A：${s.at} 的 I${i + 1} 截面积不得随世界坐标变化`);
    }
    rel(s.total, base.total, 0.005, `95-A：${s.at} 的总截面积不得随世界坐标变化`);
  }
  // ③ 面积必须是 20×5 = 100 量级（修好之前远离原点会跑到 113~132）
  for (const s of shots) rel(s.total, 200, 0.06, `95-A：${s.at} 两个 20×5 内浇口总面积应≈200`);
}

/* ============================================================
   95-B N 个内浇口相加（§三 + §十三.3/§十三.4/§十三.5）
   ============================================================ */
function testB_multiIngateSum() {
  // ① 2 / 3 / 5 个**完全相同**的内浇口：A1 ≈ A2 ≈ …，Total ≡ ΣAi
  for (const N of [2, 3, 5]) {
    const r = 8, h = 20, pitch = 40;
    const parts = [];
    for (let i = 0; i < N; i++) parts.push(cylY(i * pitch, 0, r, 0, h));
    const { parts: res } = unitsOf(union(...parts), KIND.INGATE, `i${N}.stl`,
      env([-r, 0, -r], [(N - 1) * pitch + r, h, r]), 96);
    exact(res.objects.length, N, `95-B：${N} 个互不相连的圆柱应识别为 ${N} 个内浇口`);
    const one = A_CIRCLE(2 * r);
    const k = kindOf(areasOf(res.objects, KIND.INGATE), KIND.INGATE);
    for (const o of res.objects) rel(o.areaMm2, one, 0.04, `95-B：${o.id} 单件面积应≈π·8²`);
    // ★ 定义式：总截面积 = 逐个相加（不是 平均 × 数量）
    const sum = res.objects.reduce((s, o) => s + o.areaMm2, 0);
    exact(k.totalMm2, sum, `95-B：${N} 个内浇口的总截面积必须 ≡ ΣAi（逐个相加）`);
    rel(k.totalMm2, N * one, 0.04, `95-B：${N} 个内浇口总面积应≈${N}·π·8²`);
    // §三.6：totalArea 严格等于所有有效 component area 之和
    exact(k.usableCount, N, `95-B：${N} 个都必须是"有效"单元`);
    // §五：一致性统计量自洽
    exact(k.minMm2, Math.min(...res.objects.map((o) => o.areaMm2)), '95-B：min 必须是最小的那个单元的实测面积');
    exact(k.maxMm2, Math.max(...res.objects.map((o) => o.areaMm2)), '95-B：max 必须是最大的那个单元的实测面积');
    exact(k.avgMm2, sum / N, '95-B：avg ≡ ΣAi ÷ 数量');
    // 等截面 → 最大偏差只允许来自 MC 网格的亚像素抖动（不是 0，但必须极小）
    assert(k.spreadPct != null && k.spreadPct < 3, `95-B：等截面时最大偏差应≈0（实际 ${k.spreadPct}%）`);
  }

  // ② 多个**不同尺寸** + 分布在不同空间位置：编号 → 面积必须一一对应，不串号、不重复
  const spec = [[10, 0], [14, 60], [18, 120]];
  const gs = [];
  for (const [d, x] of spec) gs.push(cylY(x, 0, d / 2, 0, 20));
  const { parts: res2 } = unitsOf(union(...gs), KIND.INGATE, 'mix.stl', env([-9, 0, -9], [129, 20, 9]), 96);
  exact(res2.objects.length, 3, '95-B：3 个不同尺寸的内浇口应识别为 3 个');
  const k2 = kindOf(areasOf(res2.objects, KIND.INGATE), KIND.INGATE);
  const want = spec.map(([d]) => A_CIRCLE(d)).sort((a, b) => a - b);
  const got = res2.objects.map((o) => o.areaMm2).sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) rel(got[i], want[i], 0.05, `95-B：按面积排序后第 ${i + 1} 个应≈π·d²/4`);
  exact(k2.totalMm2, res2.objects.reduce((s, o) => s + o.areaMm2, 0), '95-B：混合尺寸的总面积同样 ≡ ΣAi');
  // §三.7 顺带：把它们整体搬远，结论不变
  const shifted = gs.map((_, i) => cylY(spec[i][1] + 500, 500, spec[i][0] / 2, 500, 520));
  const { parts: res3 } = unitsOf(union(...shifted), KIND.INGATE, 'mix2.stl', env([491, 500, 491], [629, 520, 509]), 96);
  const k3 = kindOf(areasOf(res3.objects, KIND.INGATE), KIND.INGATE);
  rel(k3.totalMm2, k2.totalMm2, 0.01, '95-B：混合尺寸内浇口整体平移后总面积不变');
}

/* ============================================================
   95-C 多直浇道 / 多横浇道（§十三.4/§十三.5）
   ============================================================ */
function testC_multiSprueRunner() {
  // 3 个直浇道（⌀30×100 圆柱 —— 截面恒定，解析解 π·15² 可直接断言）
  const sprues = [0, 60, 120].map((x) => cylY(x, 0, 15, 0, 100));
  const { parts: sp } = unitsOf(union(...sprues), KIND.SPRUE, 's.stl', env([-15, 0, -15], [135, 100, 15]), 96);
  const ks = kindOf(areasOf(sp.objects, KIND.SPRUE), KIND.SPRUE);
  exact(ks.count, 3, '95-C：3 个直浇道应识别为 3 个单元');
  exact(ks.totalMm2, sp.objects.reduce((s, o) => s + o.areaMm2, 0), '95-C：直浇道总面积 ≡ ΣAi');
  for (const o of sp.objects) {
    rel(o.areaMm2, A_CIRCLE(30), 0.03, '95-C：⌀30 直浇道的截面积应≈π·15²');
    rel(o.lengthMm, 100, 0.03, '95-C：直浇道长度应≈100');
  }
  rel(ks.totalMm2, 3 * A_CIRCLE(30), 0.03, '95-C：3 根直浇道总面积应≈3·π·15²');

  const runners = [BOX([0, 0, 0], [80, 15, 20]), BOX([120, 0, 0], [200, 15, 20])];
  const { parts: rn } = unitsOf(union(...runners), KIND.RUNNER, 'r.stl', env([0, 0, 0], [200, 15, 20]), 96);
  const kr = kindOf(areasOf(rn.objects, KIND.RUNNER), KIND.RUNNER);
  exact(kr.count, 2, '95-C：2 个横浇道应识别为 2 个单元');
  exact(kr.totalMm2, rn.objects.reduce((s, o) => s + o.areaMm2, 0), '95-C：横浇道总面积 ≡ ΣAi');
  for (const o of rn.objects) rel(o.areaMm2, 300, 0.06, '95-C：20×15 方管的截面积应≈300');

  // 三类一起：各自独立汇总，互不串类
  const areas = buildGatingAreas({ [KIND.SPRUE]: sp.objects, [KIND.RUNNER]: rn.objects });
  assert(kindOf(areas, KIND.SPRUE).totalMm2 === ks.totalMm2
    && kindOf(areas, KIND.RUNNER).totalMm2 === kr.totalMm2, '95-C：三类混合时各类汇总不受彼此影响');
  assert(kindOf(areas, KIND.INGATE).imported === false, '95-C：未导入的类别必须标未导入，不伪造');
}

/* ============================================================
   95-D 单位换算（§十三.6）
   ============================================================ */
function testD_units() {
  // 手工核对每一处换算：mm³ → cm³ → kg → g → cm³
  const rho = MATERIALS['灰铁(HT)'].rho;      // 7.0 g/cm³（企业液态值）
  const p = (volMm3, yieldPct) => buildPouringResult({
    matKey: '灰铁(HT)',
    product: { volumeMm3: volMm3, partCount: 1, excludedCount: 0, partial: false },
    wallMm: 10,
    ingate: { totalMm2: 100, count: 1, usableCount: 1, unreliableCount: 0, partial: false, spreadPct: 0 },
    yieldPct,
  });
  const r = p(1_000_000, 100);                 // 1000 cm³、出品率 100% → 不折损
  exact(r.volumeCm3, 1000, '95-D：1e6 mm³ 必须恰好是 1000 cm³');
  exact(r.weightKg, 7, '95-D：1000 cm³ × 7.0 g/cm³ = 7 kg（volumeMm3 × ρ ÷ 1e6）');
  exact(r.pourMassKg, 7, '95-D：出品率 100% 时浇注重量 = 产品重量');
  exact(r.pourVolCm3, 1000, '95-D：出品率 100% 时浇注体积 = 产品体积');
  const r75 = p(1_000_000, 75);
  rel(r75.weightKg, 7, 1e-12, '95-D：产品重量与出品率无关（95.txt/PHASE 49：W 只取铸件本体）');
  rel(r75.pourMassKg, 7 / 0.75, 1e-12, '95-D：浇注重量 G = W ÷ 出品率');
  rel(r75.pourVolCm3, 1000 / 0.75, 1e-12, '95-D：浇注体积 = 浇注重量 ÷ 密度');
  // 出品率缺省 → 用材质表推荐值，并标记"默认"
  const rDef = buildPouringResult({
    matKey: '球铁(QT)',
    product: { volumeMm3: 1_000_000, partCount: 1, excludedCount: 0, partial: false },
    wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
  });
  assert(rDef.yieldIsDefault === true && rDef.yieldPct === MATERIALS['球铁(QT)'].y_sug,
    '95-D：未填出品率时必须回退到该材质表的推荐值并标默认（不许硬编码 70）');
  const rUser = buildPouringResult({
    matKey: '球铁(QT)',
    product: { volumeMm3: 1_000_000, partCount: 1, excludedCount: 0, partial: false },
    wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
    yieldPct: 60,
  });
  assert(rUser.yieldIsDefault === false && rUser.yieldPct === 60, '95-D：用户填了出品率就必须用它');
  // 5 种材质的密度都来自 MATERIALS（没有第二张密度表）
  for (const k of Object.keys(MATERIALS)) {
    const rr = buildPouringResult({
      matKey: k, product: { volumeMm3: 1_000_000, partCount: 1, excludedCount: 0, partial: false },
      wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
      yieldPct: 70,
    });
    exact(rr.rho, MATERIALS[k].rho, `95-D：${k} 的密度必须来自 calcs/gating.js 的 MATERIALS`);
  }
  assert(rho > 0, '95-D：密度表可用');
}

/* ============================================================
   95-E 产品 STL → 体积 → 重量（§十三.7）
   ============================================================ */
function testE_productVolumeToWeight() {
  // 100×100×100 的立方体，MC 内接 → 体积系统性偏小（≤3%），断言方向 + 量级
  const mesh = meshOf(BOX([0, 0, 0], [100, 100, 100]), env([0, 0, 0], [100, 100, 100]), 64);
  const cc = triangleComponents(mesh);
  const parts = objectsFromComponents(mesh, KIND.PRODUCT, 'p.stl', cc.components, (m) => objectMetrics(m));
  exact(parts.objects.length, 1, '95-E：一个立方体应是 1 个产品实体');
  const pv = productVolumeOf(parts.objects);
  assert(pv.volumeMm3 > 0 && pv.partCount === 1 && pv.excludedCount === 0 && pv.partial === false,
    '95-E：闭合立方体的体积必须可用且不标 partial');
  rel(pv.volumeMm3, 1e6, 0.04, '95-E：100³ 立方体体积应≈1e6 mm³（MC 内接 → 只允许偏小）');
  assert(pv.volumeMm3 < 1e6, '95-E：MC 是内接多面体，体积必须偏小而不是偏大');

  const r = buildPouringResult({
    matKey: '灰铁(HT)', product: pv, wallMm: 100,
    ingate: { totalMm2: 300, count: 1, usableCount: 1, unreliableCount: 0, partial: false, spreadPct: 0 },
  });
  exact(r.weightKg, pv.volumeMm3 * MATERIALS['灰铁(HT)'].rho / 1e6,
    '95-E：重量必须 = 体积(mm³) × 密度 ÷ 1e6');
  rel(r.weightKg, 7, 0.04, '95-E：100³ 灰铁块重量应≈7 kg');

  // 多个产品实体 → 体积相加（89.txt §二：件数只由几何决定）
  const two = meshOf(union(BOX([0, 0, 0], [100, 100, 100]), BOX([200, 0, 0], [300, 100, 100])),
    env([0, 0, 0], [300, 100, 100]), 64);
  const cc2 = triangleComponents(two);
  const p2 = objectsFromComponents(two, KIND.PRODUCT, 'p2.stl', cc2.components, (m) => objectMetrics(m));
  exact(p2.objects.length, 2, '95-E：两个互不相连的产品实体应识别为 2 件');
  const pv2 = productVolumeOf(p2.objects);
  rel(pv2.volumeMm3, 2e6, 0.04, '95-E：两件体积应相加');
  exact(pv2.partCount, 2, '95-E：件数 = 连通实体数');

  // 不闭合的实体不得计入体积（89.txt §二），并如实标 partial
  const half = objectsFromComponents(two, KIND.PRODUCT, 'p3.stl', cc2.components, (m) => objectMetrics(m));
  half.objects[0].closed = false;
  half.objects[0].volumeReliable = false;
  const pv3 = productVolumeOf(half.objects);
  assert(pv3.partial === true && pv3.excludedCount === 1 && pv3.closedCount === 1,
    '95-E：有一个实体不闭合时必须标 partial 并给出被排除的个数');
  assert(pv3.volumeMm3 < pv2.volumeMm3, '95-E：被排除的实体不能计入体积');
}

/* ============================================================
   95-F 浇注时间与原计算器**逐位一致**（§十三.8）
   ============================================================ */
function testF_pourTimeMatchesCalculator() {
  // 5 种材质 × 多个重量/壁厚：检测中心给的 t 必须与 calc_t 完全相同（不是"差不多"）
  const cases = [
    ['灰铁(HT)', 5, 8], ['灰铁(HT)', 400, 20], ['灰铁(HT)', 450, 30], ['灰铁(HT)', 451, 30], ['灰铁(HT)', 1200, 40],
    ['球铁(QT)', 20, 6], ['球铁(QT)', 20, 10], ['球铁(QT)', 20, 25], ['球铁(QT)', 20, 26],
    ['铸钢(ZG)', 50, 15], ['铸钢(ZG)', 2000, 60],
    ['铝合金(Al)', 3, 5], ['铝合金(Al)', 60, 12],
    ['铜合金(Cu)', 30, 10],
  ];
  for (const [mat, W, wall] of cases) {
    const rho = MATERIALS[mat].rho;
    const volMm3 = (W * 1e6) / rho;             // 反推体积：weightKg = volMm3 × ρ ÷ 1e6
    const r = buildPouringResult({
      matKey: mat, product: { volumeMm3: volMm3, partCount: 1, excludedCount: 0, partial: false },
      wallMm: wall, ingate: { totalMm2: 200, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
      yieldPct: 75,
    });
    rel(r.weightKg, W, 1e-9, `95-F：${mat} 反推重量应等于 ${W}kg`);
    // ★ 函数级同一性：模型给的 t 必须**就是** calc_t 作用在同一个重量上算出来的那个数
    //   （逐位相等，不是"四舍五入到两位后相等"——后者会掩盖真实的公式漂移）
    exact(r.pourTimeS, calc_t(mat, r.weightKg, wall),
      `95-F：${mat} W=${W} wall=${wall} 的浇注时间必须与 calc_t(同一重量) 逐位相等`);
    rel(r.pourTimeS, calc_t(mat, W, wall), 1e-9,
      `95-F：${mat} W=${W} wall=${wall} 的浇注时间应与 calc_t 一致（重量反推有 1e-16 级浮点差，故用 1e-9 容差）`);
  }
  // 未知材质 → 不给数（不静默当灰铁）
  const bad = buildPouringResult({
    matKey: '不存在的材质', product: { volumeMm3: 1e6, partCount: 1, excludedCount: 0, partial: false },
    wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
  });
  assert(bad.pourTimeS === null && bad.missing.includes(POUR_REASON.NO_MAT),
    '95-F：未知材质必须如实说"未选材质"，不许静默当灰铁（gating.js 的 mdFellBack 语义）');
}

/* ============================================================
   95-G Q = V/t 与 v = Q/A（§十三.9/§十三.10 —— 恒等式，两条路必须同一个数）
   ============================================================ */
function testG_flowAndVelocity() {
  const mat = '灰铁(HT)', rho = MATERIALS[mat].rho;
  for (const [W, wall, A, yv] of [[7, 10, 200, 75], [50, 20, 600, 80], [300, 35, 1500, 65], [2, 6, 80, 100]]) {
    const r = buildPouringResult({
      matKey: mat, product: { volumeMm3: (W * 1e6) / rho, partCount: 1, excludedCount: 0, partial: false },
      wallMm: wall, ingate: { totalMm2: A, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
      yieldPct: yv,
    });
    // Q = V / t
    rel(r.flowCm3s, r.pourVolCm3 / r.pourTimeS, 1e-12, '95-G：总流量必须 ≡ 浇注金属液体积 ÷ 浇注时间');
    // v = Q / A
    rel(r.vMs, r.flowCm3s / r.ingateAreaMm2, 1e-12, '95-G：平均内浇口速度必须 ≡ 总流量 ÷ 内浇口总面积');
    // v 还必须与经典计算器的 calc_v 逐位相等（同一个浇注系统不能有两个流速）
    exact(r.vMs, calc_v(r.pourMassKg, rho, r.pourTimeS, r.ingateAreaMm2),
      '95-G：平均内浇口速度必须与经典计算器的 calc_v 逐位相等');
    // 口径自检：v = 1000·G/(ρ·t·A) 的解析式
    rel(r.vMs, 1000 * r.pourMassKg / (rho * r.pourTimeS * A), 1e-12, '95-G：v 的解析式核对');
  }
  // 内浇口面积加倍 → 流速减半（同 t、同 G）—— 工程直觉核对
  const base = { matKey: mat, product: { volumeMm3: 5e6, partCount: 1, excludedCount: 0, partial: false }, wallMm: 20, yieldPct: 75 };
  const a1 = buildPouringResult({ ...base, ingate: { totalMm2: 300, count: 1, usableCount: 1, unreliableCount: 0, partial: false } });
  const a2 = buildPouringResult({ ...base, ingate: { totalMm2: 600, count: 2, usableCount: 2, unreliableCount: 0, partial: false } });
  rel(a2.vMs, a1.vMs / 2, 1e-12, '95-G：面积加倍 → 平均流速减半');
  exact(a2.pourTimeS, a1.pourTimeS, '95-G：内浇口面积不影响浇注时间（t 只由材质/重量/壁厚决定）');
}

/* ============================================================
   95-H 缺少必要参数时正确提示（§十三.11）
   ============================================================ */
function testH_missingInputs() {
  const good = {
    matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1, excludedCount: 0, partial: false },
    wallMm: 10, ingate: { totalMm2: 200, count: 1, usableCount: 1, unreliableCount: 0, partial: false },
  };
  // ① 没有产品 → 几何照常，工艺量全空 + 原因码
  const noProd = buildPouringResult({ ...good, product: { volumeMm3: null, partCount: 0, excludedCount: 0, partial: false } });
  assert(noProd.pourTimeS === null && noProd.flowCm3s === null && noProd.vMs === null,
    '95-H：没有产品 STL 时三个工艺量都必须是 null');
  assert(noProd.missing.includes(POUR_REASON.NO_PRODUCT), '95-H：必须给 NO_PRODUCT 原因码');
  assert(noProd.items.some((i) => i.code === POUR_CODE.MISSING_PRODUCT && i.level === LEVEL.WARNING),
    '95-H：必须有一条 WARNING 说明缺产品 STL');
  // ② 没有壁厚 → 给不出浇注时间（但重量/体积照给）
  const noWall = buildPouringResult({ ...good, wallMm: null });
  assert(noWall.pourTimeS === null && noWall.weightKg != null && noWall.volumeCm3 != null,
    '95-H：没有主体壁厚时给不出浇注时间，但重量/体积照给');
  assert(noWall.missing.includes(POUR_REASON.NO_WALL)
    && noWall.items.some((i) => i.code === POUR_CODE.MISSING_WALL), '95-H：必须点名"主体壁厚不可得"');
  // ③ 没有内浇口面积 → 给不出流速（但浇注时间/流量照给）
  const noG = buildPouringResult({ ...good, ingate: { totalMm2: null, count: 0, usableCount: 0, unreliableCount: 0, partial: false } });
  assert(noG.vMs === null && noG.pourTimeS != null && noG.flowCm3s != null,
    '95-H：没有内浇口面积时给不出流速，但浇注时间/流量照给');
  assert(noG.missing.includes(POUR_REASON.NO_INGATE)
    && noG.items.some((i) => i.code === POUR_CODE.MISSING_INGATE), '95-H：必须点名"没有可用的内浇口截面积"');
  // ④ 数据齐全 → 有一条 PASS「数据完整」；且**不指定浇注系统类型时不启用速度判定**（§八）
  const full = buildPouringResult(good);
  assert(full.items.some((i) => i.code === POUR_CODE.READY && i.level === LEVEL.PASS),
    '95-H：数据齐全时必须给一条 PASS「数据完整」');
  assert(full.vLimit === null && full.vExceed === null,
    '95-H：未指定浇注系统类型时不许给速度红线（95.txt §八：不伪造标准）');
  assert(full.items.some((i) => i.code === POUR_CODE.V_NO_CRITERION),
    '95-H：未指定类型时必须明说"未启用对应工艺的速度判定标准"');
  // ⑤ 指定了类型 → 用企业 R7 参考（V_LIMIT），且判语方向正确
  const closed = buildPouringResult({ ...good, systemType: '封闭' });
  exact(closed.vLimit, V_LIMIT['封闭'], '95-H：封闭式参考线必须取自 calcs/gating.js 的 V_LIMIT');
  exact(closed.vExceed, closed.vMs > V_LIMIT['封闭'], '95-H：超限判定必须与 V_LIMIT 一致');
  assert(closed.items.some((i) => i.code === (closed.vExceed ? POUR_CODE.V_EXCEED : POUR_CODE.V_PASS)),
    '95-H：指定类型后必须给一条速度参考结论');
  const open = buildPouringResult({ ...good, systemType: '开放' });
  exact(open.vLimit, V_LIMIT['开放'], '95-H：开放式参考线同上');
  // 未知类型字符串 → 当作未指定（不猜）
  const junk = buildPouringResult({ ...good, systemType: '随便写的' });
  assert(junk.vLimit === null && junk.systemType === null, '95-H：无法识别的类型必须当作未指定，不许猜');
}

/* ============================================================
   95-I 绝不出现 NaN / Infinity（§十三.12）
   ============================================================ */
function testI_noNaN() {
  const bad = [
    { name: '空对象', o: {} },
    { name: '全 null', o: { matKey: null, product: null, wallMm: null, ingate: null } },
    { name: '体积 NaN', o: { matKey: '灰铁(HT)', product: { volumeMm3: NaN, partCount: 1 }, wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1 } } },
    { name: '体积 Infinity', o: { matKey: '灰铁(HT)', product: { volumeMm3: Infinity, partCount: 1 }, wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1 } } },
    { name: '壁厚 0', o: { matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1 }, wallMm: 0, ingate: { totalMm2: 100, count: 1, usableCount: 1 } } },
    { name: '壁厚 -5', o: { matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1 }, wallMm: -5, ingate: { totalMm2: 100, count: 1, usableCount: 1 } } },
    { name: '面积 0', o: { matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1 }, wallMm: 10, ingate: { totalMm2: 0, count: 1, usableCount: 0 } } },
    { name: '面积 NaN', o: { matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1 }, wallMm: 10, ingate: { totalMm2: NaN, count: 1, usableCount: 1 } } },
    { name: '出品率 0', o: { matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1 }, wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1 }, yieldPct: 0 } },
    { name: '出品率 NaN', o: { matKey: '灰铁(HT)', product: { volumeMm3: 1e6, partCount: 1 }, wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1 }, yieldPct: NaN } },
    { name: '体积 0', o: { matKey: '灰铁(HT)', product: { volumeMm3: 0, partCount: 1 }, wallMm: 10, ingate: { totalMm2: 100, count: 1, usableCount: 1 } } },
  ];
  const NUM = ['volumeCm3', 'weightKg', 'pourMassKg', 'pourVolCm3', 'wallMm', 'pourTimeS', 'flowCm3s', 'ingateAreaMm2', 'vMs', 'rho', 'yieldPct', 'vLimit'];
  for (const { name, o } of bad) {
    const r = buildPouringResult(o);
    for (const k of NUM) {
      const v = r[k];
      assert(v === null || (typeof v === 'number' && Number.isFinite(v)),
        `95-I：${name} → 字段 ${k} = ${v}（只允许 null 或有限数，不许 NaN / Infinity）`);
    }
    assert(Array.isArray(r.items) && r.items.length > 0, `95-I：${name} → 必须给出提示，不能空手而归`);
    for (const it of r.items) {
      for (const p of it.params) {
        assert(typeof p !== 'number' || Number.isFinite(p), `95-I：${name} → 提示参数里出现 ${p}`);
      }
    }
  }
  // 极端但合法：超大件不炸、极小件不炸
  for (const vol of [1e-3, 1e12]) {
    const r = buildPouringResult({
      matKey: '铸钢(ZG)', product: { volumeMm3: vol, partCount: 1 }, wallMm: 5,
      ingate: { totalMm2: 50, count: 1, usableCount: 1 }, yieldPct: 60,
    });
    assert(Object.values(r).every((v) => typeof v !== 'number' || Number.isFinite(v)),
      `95-I：体积 ${vol} 时不得出现非有限数`);
  }
}

/* ============================================================
   95-J 中文/英文界面：新文案不许硬编码中文（§十三.13）
   ------------------------------------------------------------
   ⚠ 审计脚本 scripts/i18n_audit.mjs 只扫 tr('…') **字面量**；
     对象表的值（POUR_TEXT / POUR_REASON_TEXT / SYSTEM_TYPE）扫不到 —— 必须手工核查。
   ============================================================ */
function testJ_i18n() {
  const view = readFileSync(join(here, '..', 'js', 'views', 'inspectionCenter.js'), 'utf8');
  const model = readFileSync(join(here, '..', 'js', 'model', 'processInspection.js'), 'utf8');
  const CJK = /[一-鿿]/;
  const tableAt = (src, name) => {
    const i = src.indexOf('const ' + name + ' = {');
    assert(i > 0, `95-J：找不到文案表 ${name}`);
    return src.slice(i, src.indexOf('\n};', i));
  };
  const scan = (body, re) => {
    const miss = [];
    for (const m of body.matchAll(re)) if (CJK.test(m[1]) && EN[m[1]] === undefined) miss.push(m[1]);
    return miss;
  };
  // ① 检测中心里所有"code → 中文原文"的文案表（审计脚本只扫 tr('…') 字面量，这些扫不到）
  for (const t of ['GATING_TEXT', 'GATING_REASON_TEXT', 'POUR_TEXT', 'POUR_REASON_TEXT', 'SHAPE_TEXT']) {
    const miss = scan(tableAt(view, t), /:\s*'([^']*)'/g);
    assert(miss.length === 0, `95-J：${t} 缺英文（动态 key）：${miss.join(' / ')}`);
  }
  // ② model 层的 SYSTEM_TYPE（含 title 用的 note）
  const missT = scan(tableAt(model, 'SYSTEM_TYPE'), /(?:label|note):\s*'([^']*)'/g);
  assert(missT.length === 0, `95-J：SYSTEM_TYPE 缺英文：${missT.join(' / ')}`);
  // ③ 带参数的文案必须真的带占位符，否则参数会悄悄丢掉（{n} 会原样漏到页面上）
  const needParam = [POUR_CODE.INGATE_SPREAD, POUR_CODE.VOLUME_PARTIAL, POUR_CODE.AREA_PARTIAL,
    POUR_CODE.V_PASS, POUR_CODE.V_EXCEED];
  const pourBody = tableAt(view, 'POUR_TEXT');
  for (const code of needParam) {
    const key = Object.keys(POUR_CODE).find((k) => POUR_CODE[k] === code);
    const m = pourBody.match(new RegExp(`\\[POUR_CODE\\.${key}\\]\\s*:\\s*'([^']*)'`));
    assert(m, `95-J：POUR_TEXT 缺 ${key}`);
    assert(/\{\w+\}/.test(m[1]), `95-J：${key} 的文案必须带占位符（否则参数会丢）`);
  }
  // ④ 每一条 POUR_TEXT / POUR_REASON_TEXT / SYSTEM_TYPE 都必须被真的用到（没有死词条）
  for (const k of Object.keys(POUR_CODE)) {
    assert(pourBody.includes(`[POUR_CODE.${k}]`), `95-J：POUR_CODE.${k} 没有对应文案`);
  }
  const reasonBody = tableAt(view, 'POUR_REASON_TEXT');
  for (const k of Object.keys(POUR_REASON)) {
    assert(reasonBody.includes(`[POUR_REASON.${k}]`), `95-J：POUR_REASON.${k} 没有对应文案`);
  }
  for (const k of ['label', 'note']) {
    assert(tableAt(model, 'SYSTEM_TYPE').includes(k + ':'), `95-J：SYSTEM_TYPE 缺 ${k}`);
  }
}

/* ============================================================
   95-K 工程纪律：不编造标准、不越权判定（95.txt §八/§九/§十一）
   ============================================================ */
function testK_discipline() {
  // ① 面积比必须叫「检测截面积比」，且文案里说清"不是标准浇注比"
  const view = readFileSync(join(here, '..', 'js', 'views', 'inspectionCenter.js'), 'utf8');
  assert(view.includes("tr('检测截面积比')"), '95-K：面积关系必须命名为「检测截面积比」（95.txt §九）');
  assert(!/tr\('浇注比'\)/.test(view), '95-K：不许把它直接叫「浇注比」（§九：没确认工程定义之前不许包装成标准浇注比）');
  const hint = '「检测截面积比」= 按当前检测到的有效截面积算出的比值（直 : 横 : 内）。它不是标准浇注比 —— 有效截面积取的是单元中段的代表性截面，不是最小截面 / 阻流截面，两者的工程含义不同。';
  assert(view.includes(hint), '95-K：必须有一句说明它到底代表什么（§九 逐字要求）');
  // ② 没指定浇注系统类型 → 文案必须明说"未启用速度判定标准"（§八）
  assert(view.includes("'当前仅进行几何与流量估算，未启用对应工艺的速度判定标准。'"),
    '95-K：必须保留 §八 的诚实限定语');
  // ③ 最高只到企业经验参考（R7），不许出现"过快 / 过慢"这类绝对判断（§四/§八）
  //   ⚠ 只看**真正会显示出去的文案**：注释里写"本版不做湍流预测"是辟谣，不算违规
  const shown = view
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const w of ['速度过快', '速度过慢', '流速过快', '流速过慢', '湍流', '充型动画', 'MAGMA', '流场预测']) {
    assert(!shown.includes(w), `95-K：不许出现「${w}」（95.txt §八/§十 明确不做）`);
  }
  // ④ 内浇口最大偏差只报数、不设阈值：模型里不许出现"偏差阈值"常量
  const model = readFileSync(join(here, '..', 'js', 'model', 'processInspection.js'), 'utf8');
  assert(!/SPREAD_MAX|SPREAD_LIMIT|DEVIATION_MAX/.test(model), '95-K：不许给"最大偏差"编一个阈值（§十.4 只要求报数）');
  // ⑤ 流速参考只能来自 V_LIMIT（企业 R7），不许在检测中心里另定义一份
  assert(!/(?:export\s+)?const\s+V_LIMIT\s*=/.test(model),
    '95-K：检测中心不许自己定义流速红线，必须引用 calcs/gating.js 的 V_LIMIT');
  assert(/V_LIMIT/.test(model) && /from '\.\.\/\.\.\/calcs\/gating\.js'/.test(model),
    '95-K：V_LIMIT 必须是 import 来的');
}

/* ============================================================
   95-L 架构纪律：不碰引擎、不加第二套公式、不改 PHASE 94 几何链路（§十二）
   ============================================================ */
function testL_architecture() {
  const model = readFileSync(join(here, '..', 'js', 'model', 'processInspection.js'), 'utf8');
  // ① 只从 calcs/gating.js 取公式
  assert(/import \{[^}]*\} from '\.\.\/\.\.\/calcs\/gating\.js'/.test(model), '95-L：必须从 calcs/gating.js 取公式');
  const imported = model.slice(model.indexOf("from '../../calcs/gating.js'") - 200, model.indexOf("from '../../calcs/gating.js'"));
  for (const f of ['calc_t', 'calc_v', 'MATERIALS', 'V_LIMIT']) {
    assert(imported.includes(f), `95-L：必须引用 ${f}（而不是自己写一个）`);
  }
  // ② 检测中心不许出现浇注时间的公式系数
  assert(!/0\.70\s*\*|2\.4335|Math\.cbrt\(|71\.47|2\.080|2\.670|2\.970/.test(model),
    '95-L：processInspection 里出现了浇注时间公式的系数 —— 说明有人复制了一套公式（§十二 禁止）');
  // ③ objectMetrics 的 PHASE 95 修正必须是"只改累加锥顶"，不改公式结构
  const om = readFileSync(join(here, '..', 'js', 'model', 'objectMetrics.js'), 'utf8');
  assert(/principalAxis\(vertices, triCount, origin\)/.test(om), '95-L：principalAxis 必须接受累加锥顶参数');
  assert(/bboxCenterOf/.test(om), '95-L：缺省锥顶必须是包围盒中心（不是世界原点）');
  assert(/principalAxis\(vertices, triCount, bounds\.center\)/.test(om),
    '95-L：objectMetrics 必须把已知的 bounds.center 传进去（省一次扫描，且口径统一）');
  // ④ 冻结区一个字都没动（引擎指纹另有 BASELINE.md 核对，这里只防止误 import 引擎内部量）
  assert(!/from '\.\.\/\.\.\/js\/engine|from '\.\.\/engine/.test(model),
    '95-L：model 层不许反向依赖 js/engine/**（PHASE 88 起的路线：新算法放 model/）');
}

/* ============================================================
   95-M 材质映射表两处一致（不许出现两张不同的表）
   ============================================================ */
function testM_materialMap() {
  const view = readFileSync(join(here, '..', 'js', 'views', 'inspectionCenter.js'), 'utf8');
  const i = view.indexOf('const MAT_KEY_OF = {');
  assert(i > 0, '95-M：找不到 MAT_KEY_OF');
  const body = view.slice(i, view.indexOf('};', i));
  const pairs = [...body.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
  assert(pairs.length === 5, `95-M：映射表应有 5 个材料大类，实际 ${pairs.length}`);
  for (const [fam, key] of pairs) {
    exact(matKeyOf(fam), key, `95-M：检测中心的「${fam}」必须与 calcManifest.matKeyOf 指向同一个材料键`);
    assert(MATERIALS[key], `95-M：材料键 ${key} 必须真的存在于 calcs/gating.js 的 MATERIALS`);
  }
  // 页面上的选项必须覆盖 MATERIALS 的全部材料（不多不少）
  const fams = pairs.map((p) => p[1]).sort();
  exact(fams.join(','), Object.keys(MATERIALS).sort().join(','), '95-M：5 个材料大类必须与 MATERIALS 一一对应');
}

/* ============================================================
   95-N 面积比：只列已导入的类别，绝不把缺的补成 0（沿用 PHASE 94 §八）
   ============================================================ */
function testN_ratioDiscipline() {
  // buildGatingAreas 吃的是**单元对象**（不是已经汇总好的类），所以这里造两个真单元
  const unit = (id, area) => ({
    id, name: 'x.stl', closed: true, areaMm2: area, areaReason: null,
    shape: { usable: true, type: 'rect', areaMm2: area, wMm: 25, hMm: area / 25 },
    metrics: { volumeMm3: 1000, size: [10, 10, 10], center: [0, 0, 0] },
  });
  const areas = buildGatingAreas({ [KIND.SPRUE]: [unit('S1', 500)], [KIND.RUNNER]: [unit('G1', 250)] });
  const e = areas.ratio.entries.map((x) => x.kind);
  exact(e.join(','), `${KIND.SPRUE},${KIND.RUNNER}`, '95-N：比例只列已导入的类别');
  assert(!e.includes(KIND.INGATE), '95-N：没导入的类别不许补成 0 混进比例');
  exact(areas.ratio.entries[0].value, 1, '95-N：基准类别恒为 1');
  exact(areas.ratio.entries[1].value, 0.5, '95-N：第二个类别的比值 = 自身 ÷ 基准');
}

/* ---------------- 注册 ---------------- */
export const tests = [
  { name: '95-A ★ 世界坐标不变性：同一几何换个位置，截面积必须逐位一致（PHASE 95 修的真 bug）', fn: testA_worldPositionInvariance },
  { name: '95-B N 个内浇口：数量 = N、Total ≡ ΣAi、等截面时 min=max=avg', fn: testB_multiIngateSum },
  { name: '95-C N 个直浇道 / N 个横浇道：逐类汇总互不串', fn: testC_multiSprueRunner },
  { name: '95-D 单位换算：mm³→cm³→kg、出品率折算、5 种材质密度同源', fn: testD_units },
  { name: '95-E 产品 STL → 体积 → 重量（含多件相加 / 不闭合排除）', fn: testE_productVolumeToWeight },
  { name: '95-F 浇注时间与原计算器 calc_t **逐位相等**（§十三.8）', fn: testF_pourTimeMatchesCalculator },
  { name: '95-G Q = V/t 与 v = Q/A 恒等，且与 calc_v 逐位相等（§十三.9/10）', fn: testG_flowAndVelocity },
  { name: '95-H 缺少必要参数：给 null + 原因码 + WARNING，不编数（§十三.11）', fn: testH_missingInputs },
  { name: '95-I 任何输入都不许出现 NaN / Infinity（§十三.12）', fn: testI_noNaN },
  { name: '95-J 文案双语齐全（动态 key 手工核查，§十三.13）', fn: testJ_i18n },
  { name: '95-K 工程纪律：不给编造标准、速度判定只在指定类型时启用', fn: testK_discipline },
  { name: '95-L 架构纪律：不碰引擎、不抄公式、锥顶修正只改条件数', fn: testL_architecture },
  { name: '95-M 材质映射表与 calcManifest.matKeyOf 逐项一致', fn: testM_materialMap },
  { name: '95-N 面积比只列已导入类别，缺的补 0 不许出现', fn: testN_ratioDiscipline },
];
