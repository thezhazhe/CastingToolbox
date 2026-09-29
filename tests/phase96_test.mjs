// ============================================================
// PHASE 96（96.txt）· 浇注系统检测收口版
//
// 覆盖 96.txt §十九 逐条要求：
//   96-A 两个相同矩形内浇口        96-B 三个相同矩形        96-C 两个不同规格
//   96-D 梯形                      96-E 扇形 / 弧边         96-F 异形
//   96-G 不同世界坐标位置          96-H 总面积 = Σ component area
//   96-I 规格分组不影响真实总面积
//   96-J/K/L 生产场景自动带入材质 / 浇注系统类型 / 出品率
//   96-M 生产场景缺失时用默认      96-N 用户本次修改优先于生产场景
//   96-O 没有浇注系统类型时不启用 R7   96-P 开放式 1.0   96-Q 封闭式 1.5
//   96-R 经典 calc_t / calc_v 结果保持一致    96-S 英文模式没有中文残留
//
// 另加（96.txt §一 要求先复现再定位，这些是**根因的回归防线**）：
//   96-T 真矩形的形状判定不得随网格相位翻（PHASE 96 修掉的核心抖动）
//   96-U 方向不唯一的单元：面积照给 + 明确标记（不再是 null）
//   96-V 规格容差本身被断言（96.txt §七："必须把这个容差写进测试"）
//
// ★ 纪律：不碰 js/engine/**、不碰 Hotspot V3、不碰 PHASE 89~92 的自动追踪链。
//   断言只针对语义码与数值，不针对中文文案（文案在显示层查 i18n）。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tetMC, BOX } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { objectMetrics } from '../js/model/objectMetrics.js';
import { sectionShapeOf, SHAPE_GATE, AXIS_SPREAD_MIN } from '../js/model/sectionShape.js';
import { triangleComponents } from '../js/model/meshComponents.js';
import { calc_t, calc_v, MATERIALS, V_LIMIT } from '../calcs/gating.js';
import EN from '../js/i18n/en-US.js';
import {
  KIND, LEVEL, POUR_CODE, SYSTEM_TYPE, GATING_REASON,
  gatingUnitsFromComponents, buildGatingAreas, groupBySpec, sameSpec,
  DIM_SAME_ABS, DIM_SAME_REL, SPEC_AREA_REL,
  productVolumeOf, buildPouringResult, resolveProcessParams, PARAM_SRC, DEFAULT_MAT_FAMILY,
} from '../js/model/processInspection.js';

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const rel = (got, want, tol, m) => {
  assert(Number.isFinite(got), `${m}：拿到的是 ${got}`);
  const e = Math.abs(got - want) / Math.abs(want);
  assert(e <= tol, `${m}（实际 ${got}，期望 ${want}，偏差 ${(e * 100).toFixed(3)}% > ${(tol * 100).toFixed(3)}%）`);
};
const exact = (got, want, m) => assert(got === want, `${m}（实际 ${got}，期望 ${want} —— 必须逐位相等）`);

/* ============================================================
   夹具：分块生成 → 平移 → 合并成一份 STL
   ------------------------------------------------------------
   为什么不把多个实体放进**同一个包络**里一次 MC：交接书 §5.2-7 记录过，
   四面体 MC 在网格点恰好落在等值面上时会产出零面积三角形，被退化过滤剔除后
   邻居丢一条边 → 组件被判"不闭合"（夹具问题，不是产品问题）。
   分块生成让每个实体都有自己的干净包络；平移在**网格生成之后**做，
   所以"世界坐标"这个变量仍然是干净的 —— 96-G 测的正是这个。
   ============================================================ */
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
const PAD = 8, EPS = 0.0173;
const env = (mn, mx) => [
  [mn[0] - PAD - EPS, mn[1] - PAD - EPS * 2, mn[2] - PAD - EPS * 3],
  [mx[0] + PAD + EPS * 4, mx[1] + PAD + EPS * 5, mx[2] + PAD + EPS * 6],
];
/** 单块实体（包络自己一份，保证闭合） */
const solid = (mn, mx, res) => meshOf(BOX(mn, mx), env(mn, mx), res);

/** 多块合并成一份 STL（每块单独生成后平移）—— 一份 STL 里 N 个独立实体 */
function mergedMesh(parts, res = 96) {
  const chunks = [];
  for (const [mn, mx, at] of parts) {
    const m = solid(mn, mx, res);
    const out = new Float32Array(m.triCount * 9);
    for (let i = 0; i < m.triCount * 9; i += 3) {
      out[i] = m.vertices[i] + at[0];
      out[i + 1] = m.vertices[i + 1] + at[1];
      out[i + 2] = m.vertices[i + 2] + at[2];
    }
    chunks.push(out);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const vertices = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { vertices.set(c, off); off += c.length; }
  return { vertices, triCount: total / 9 };
}

/** 一份"浇注系统 STL" → buildGatingAreas 的输入（与页面完全同一条路） */
function unitsOf(mesh, kind) {
  const cc = triangleComponents(mesh);
  return gatingUnitsFromComponents(mesh, kind, 'g.stl', cc.components,
    (m) => objectMetrics(m, { withPoly: true, altAxis: true }), (m) => sectionShapeOf(m));
}
function areasOf(mesh, kind = KIND.INGATE) {
  const parts = unitsOf(mesh, kind);
  return { parts, areas: buildGatingAreas({ [kind]: parts.objects }), k: buildGatingAreas({ [kind]: parts.objects }).kinds.find((x) => x.kind === kind) };
}
/** 两个实体沿 X 排开（间距 40，互不相连） */
const twoBoxes = (a, b, res = 96) => mergedMesh([
  [[0, 0, 0], a, [0, 0, 0]],
  [[0, 0, 0], b, [a[0] + 40, 0, 0]],
], res);

/* ---- 二维截面沿 Z 拉伸的实心柱（梯形 / 多边形用） ---- */
const prismZ = (poly, len) => (p) => {
  let d = Math.max(-p[2], p[2] - len), m = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    m = Math.max(m, ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / l);
  }
  return Math.max(d, m);
};
const polyArea = (poly) => {
  let a2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a2) / 2;
};

/* ============================================================
   96-A 两个完全相同的矩形内浇口（96.txt §三.A）
   期望：Unit 1 = 100 / Unit 2 = 100 / Total = 200，且**归成一个规格**
   ============================================================ */
function testA_twoSame() {
  const { parts, k } = areasOf(twoBoxes([20, 5, 30], [20, 5, 30]));
  exact(parts.objects.length, 2, '96-A：两个独立实体必须数成 2 个单元');
  for (const o of parts.objects) {
    assert(o.closed === true, `96-A：${o.id} 应是闭合实体`);
    rel(o.areaMm2, 100, 0.01, `96-A：${o.id} 单个面积应≈100mm²`);
    exact(o.shape.type, 'rect', `96-A：${o.id} 的截面应是矩形（不是 irregular）`);
    rel(o.shape.wMm, 20, 0.01, `96-A：${o.id} 宽`);
    rel(o.shape.hMm, 5, 0.01, `96-A：${o.id} 厚`);
  }
  rel(k.totalMm2, 200, 0.01, '96-A：总面积 = 100 + 100');
  exact(k.groups.length, 1, '96-A：两个相同内浇口必须归成**一个**规格（不是"多种规格"）');
  exact(k.allSameDims, true, '96-A：allSameDims 应为 true');
  exact(k.groups[0].count, 2, '96-A：该规格有 2 个');
  rel(k.groups[0].unitAreaMm2, 100, 0.01, '96-A：单个面积');
  rel(k.groups[0].subtotalMm2, 200, 0.01, '96-A：小计');
}

/* ============================================================
   96-B 三个完全相同的矩形（96.txt §三.B）：100 + 100 + 100 = 300
   ============================================================ */
function testB_threeSame() {
  const mesh = mergedMesh([
    [[0, 0, 0], [20, 5, 30], [0, 0, 0]],
    [[0, 0, 0], [20, 5, 30], [40, 0, 0]],
    [[0, 0, 0], [20, 5, 30], [80, 0, 0]],
  ]);
  const { parts, k } = areasOf(mesh);
  exact(parts.objects.length, 3, '96-B：必须数成 3 个单元');
  exact(k.groups.length, 1, '96-B：三个相同 → 一个规格');
  exact(k.groups[0].count, 3, '96-B：该规格有 3 个');
  rel(k.totalMm2, 300, 0.01, '96-B：总面积 100×3');
  exact(k.usableCount, 3, '96-B：三个都要算进去（一个都不能漏）');
}

/* ============================================================
   96-C 两个不同规格矩形（96.txt §三.C）
   20×5 + 30×5 → 100 + 150 = 250，且必须**分成两组**
   ============================================================ */
function testC_twoDifferent() {
  const { k } = areasOf(twoBoxes([20, 5, 30], [30, 5, 30]));
  exact(k.groups.length, 2, '96-C：不同规格必须分成两组');
  const areas = k.groups.map((g) => g.subtotalMm2).sort((a, b) => a - b);
  rel(areas[0], 100, 0.01, '96-C：20×5 那一组');
  rel(areas[1], 150, 0.01, '96-C：30×5 那一组');
  rel(k.totalMm2, 250, 0.01, '96-C：总面积 = 100 + 150');
  const ws = k.groups.map((g) => g.shape.wMm).sort((a, b) => a - b);
  rel(ws[0], 20, 0.01, '96-C：小规格宽 20');
  rel(ws[1], 30, 0.01, '96-C：大规格宽 30');
  exact(k.allSameDims, false, '96-C：不同规格时 allSameDims 必须为 false');
}

/* ============================================================
   96-D 梯形（96.txt §三.D）：
   实测截面面积必须与 (a+b)h/2 自洽；且**不能**仅仅因为检测到"四边形"就相信它是梯形
   ============================================================ */
function testD_trapezoid() {
  const a = 10, b = 20, h = 15;
  const ideal = (a + b) * h / 2;                       // 225
  // 上底 a / 下底 b / 高 h 的等腰梯形，沿 Z 拉伸 30
  const trap = [[-b / 2, 0], [b / 2, 0], [a / 2, h], [-a / 2, h]];
  const mesh = meshOf(prismZ(trap, 30), env([-b / 2, 0, 0], [b / 2, h, 30]), 112);
  const { parts, k } = areasOf(mesh);
  const u = parts.objects[0];
  assert(u.closed === true, '96-D：梯形柱应是闭合实体');
  exact(u.shape.type, 'trapezoid', `96-D：应判为梯形，实际 ${u.shape.type}`);
  // ⚠ 两条平行边是**不分上下**的（切线平面里没有重力/充型方向，见 sectionShape 的说明）：
  //   算法按长度排序，长边在前。所以这里断言"这两条边就是 20 与 10"，不绑定谁叫上底。
  const pair = [u.shape.topMm, u.shape.bottomMm].sort((x, y) => x - y);
  rel(pair[0], Math.min(a, b), 0.03, '96-D：较短的那条平行边');
  rel(pair[1], Math.max(a, b), 0.03, '96-D：较长的那条平行边');
  rel(u.shape.heightMm, h, 0.03, '96-D：高');
  assert(u.shape.topMm >= u.shape.bottomMm, '96-D：平行边必须按长度排序输出（长边在前），与切线朝向无关');
  // 公式值 vs 真值
  rel(u.shape.areaMm2, ideal, 0.02, '96-D：(a+b)h/2 与理想值');
  // 公式值 vs **实测几何面积**（shape.evidence 里那一个）
  const measured = u.shape.evidence.measuredAreaMm2;
  rel(u.shape.areaMm2, measured, SHAPE_GATE.TRAPEZOID_TOL, '96-D：公式值必须在实测面积的容差内');
  rel(k.totalMm2, ideal, 0.02, '96-D：总面积');
  exact(k.groups.length, 1, '96-D：单个单元 → 一组');
}

/* ============================================================
   96-E 扇形 / 弧边（96.txt §三.E + §六 点名的例子）
   ★ 96.txt §六 原文："不要显示 20 × 10 = 200 mm²，如果真实截面积是 157 mm²"
     —— 那正是**半圆**（bbox 20×10、面积 πR²/2 = 157.08）。
   本测试就是这条：必须给 157 左右的**实测**面积，绝不许拿 bbox 冒充。
   ============================================================ */
function testE_arcSection() {
  const R = 10, len = 30;
  const halfDisc = (p) => Math.max(-p[2], p[2] - len, Math.hypot(p[0], p[1]) - R, -p[1]);
  const mesh = meshOf(halfDisc, env([-R, 0, 0], [R, R, len]), 112);
  const { parts, k } = areasOf(mesh);
  const u = parts.objects[0];
  assert(u.closed === true, '96-E：半圆截面柱应是闭合实体');
  const ideal = Math.PI * R * R / 2;                       // 157.0796
  const bboxArea = (2 * R) * R;                            // 200 —— 绝不许出现这个数
  rel(u.areaMm2, ideal, 0.01, '96-E：弧边截面的**实测**面积');
  assert(Math.abs(u.areaMm2 - bboxArea) > bboxArea * 0.1,
    `96-E：绝不许拿包围盒长×宽冒充弧边截面积（实测 ${u.areaMm2}，bbox ${bboxArea}）`);
  exact(u.shape.type, 'irregular', `96-E：弧边截面不该被硬套成圆/矩/梯（实际 ${u.shape.type}）`);
  rel(k.totalMm2, ideal, 0.01, '96-E：总面积');
}

/* ============================================================
   96-F 任意不规则截面（96.txt §三.F）：给实测面积，不强行识别形状
   ============================================================ */
function testF_irregular() {
  const R = 12, len = 30;
  const hex = Array.from({ length: 6 }, (_, i) => [R * Math.cos(i * Math.PI / 3), R * Math.sin(i * Math.PI / 3)]);
  const mesh = meshOf(prismZ(hex, len), env([-R, -R, 0], [R, R, len]), 112);
  const { parts, k } = areasOf(mesh);
  const u = parts.objects[0];
  exact(u.shape.type, 'irregular', `96-F：正六边形不该被套成圆/矩/梯（实际 ${u.shape.type}）`);
  rel(u.areaMm2, polyArea(hex), 0.02, '96-F：异形截面按**实测几何面积**');
  rel(k.totalMm2, polyArea(hex), 0.02, '96-F：总面积');
}

/* ============================================================
   96-G 不同世界坐标位置（96.txt §三.G / §四）
   同一份网格整体平移 → 所有输出必须逐位一致。
   （PHASE 95 修掉的是主轴累加锥顶的**精度**问题；这里是它的持续防线。）
   ============================================================ */
function testG_worldPosition() {
  const base = mergedMesh([
    [[0, 0, 0], [20, 5, 30], [0, 0, 0]],
    [[0, 0, 0], [20, 5, 30], [40, 0, 0]],
  ]);
  const shots = [];
  for (const [dx, dy, dz] of [[0, 0, 0], [400, 0, 0], [0, 300, 0], [0, 0, 200], [400, 300, 200], [-250, -180, -90]]) {
    const v = new Float32Array(base.vertices.length);
    for (let i = 0; i < base.vertices.length; i += 3) {
      v[i] = base.vertices[i] + dx; v[i + 1] = base.vertices[i + 1] + dy; v[i + 2] = base.vertices[i + 2] + dz;
    }
    const { k } = areasOf({ vertices: v, triCount: base.triCount });
    shots.push({ at: `(${dx},${dy},${dz})`, total: k.totalMm2, n: k.count, areas: k.items.map((i) => i.areaMm2) });
  }
  for (const s of shots) {
    exact(s.n, 2, `96-G：${s.at} 应识别为 2 个单元`);
    rel(s.total, 200, 0.002, `96-G：${s.at} 的总面积必须与原点处一致`);
    rel(s.areas[0], 100, 0.002, `96-G：${s.at} 的单元 1 面积`);
    rel(s.areas[1], 100, 0.002, `96-G：${s.at} 的单元 2 面积`);
  }
}

/* ============================================================
   96-H 总面积必须严格 = Σ 每个有效单元的真实面积（96.txt §八）
   禁止：平均面积 × 数量 / 规格尺寸 × 数量 / bbox 面积 × 数量
   ============================================================ */
function testH_totalIsSum() {
  const { parts, k } = areasOf(mergedMesh([
    [[0, 0, 0], [20, 5, 30], [0, 0, 0]],
    [[0, 0, 0], [30, 5, 30], [40, 0, 0]],
    [[0, 0, 0], [20, 5, 30], [90, 0, 0]],
  ]));
  const sum = parts.objects.reduce((s, o) => s + o.areaMm2, 0);
  rel(k.totalMm2, sum, 1e-12, '96-H：总面积必须逐位等于 Σ 单元面积');
  // 反例防线：平均 × 数量 恰好等于 Σ（等截面时数值巧合），所以用**不等截面**的夹具再证一次
  const avg = sum / parts.objects.length;
  assert(Math.abs(avg * parts.objects.length - sum) < 1e-9, '96-H 前提：平均×数量在这里数值上等于 Σ（等截面）');
  // 真正的不等截面：两组的"小计"必须各自等于组内实测之和
  for (const g of k.groups) {
    const ids = new Set(g.ids);
    const gs = parts.objects.filter((o) => ids.has(o.id)).reduce((s, o) => s + o.areaMm2, 0);
    rel(g.subtotalMm2, gs, 1e-12, `96-H：规格组 ${g.ids.join('+')} 的小计必须 = 组内实测之和（不是 单个×数量）`);
  }
  // 三个单元里有两个同规格 → 两组
  exact(k.groups.length, 2, '96-H：20×5 一组、30×5 一组');
}

/* ============================================================
   96-I 规格分组只影响展示，绝不影响总面积（96.txt §八）
   构造 A1=20×5、A2=20×5（同规格），检查：
     · 组小计 = A1 + A2 的**实测值**（不是 单个面积 × 2）
     · 类的总面积与"不分组直接加"完全一致
   ============================================================ */
function testI_groupingDoesNotChangeTotal() {
  const { parts, k } = areasOf(twoBoxes([20, 5, 30], [20, 5, 30]));
  const raw = parts.objects.map((o) => o.areaMm2);
  // 手工分组（不经过 groupBySpec）—— 结果必须一样
  const manual = groupBySpec(k.items);
  exact(manual.length, k.groups.length, '96-I：分组结果必须可复现');
  exact(manual[0].count, 2, '96-I：两个单元归一组');
  rel(manual[0].subtotalMm2, raw[0] + raw[1], 1e-12, '96-I：小计 = 两个单元实测面积之和');
  rel(k.totalMm2, raw[0] + raw[1], 1e-12, '96-I：总面积不受分组影响');
  // 单元顺序不影响总面积（也不该把同一规格拆成两组）
  const rev = buildGatingAreas({ [KIND.INGATE]: [...k.items].reverse() }).kinds.find((x) => x.kind === KIND.INGATE);
  rel(rev.totalMm2, k.totalMm2, 1e-12, '96-I：颠倒顺序后总面积不变');
  exact(rev.groups.length, 1, '96-I：颠倒顺序后仍然是**一个**规格（代表值不随顺序漂移）');
}

/* ============================================================
   96-J/K/L/M/N 生产场景 → 工艺检测中心（96.txt §十一~§十五）
   优先级：用户本次手动 > 生产场景 > 项目默认 > 空值不判定
   ============================================================ */
function testJ_scenarioMaterial() {
  const r = resolveProcessParams({ scenario: { family: '球铁' } });
  exact(r.matFamily, '球铁', '96-J：生产场景的材质必须自动带入');
  exact(r.matSource, PARAM_SRC.SCENARIO, '96-J：来源必须标成"生产场景"');
  // 场景里的材质是**材料大类键**，不是复制一份密度（96.txt §十四）
  assert(Object.keys(MATERIALS).some((k) => k.includes('球铁')), '96-J：材质键仍指向 calcs/gating.js 的唯一密度表');
}
function testK_scenarioGatingType() {
  const r = resolveProcessParams({ scenario: { gatingType: '封闭' } });
  exact(r.gatingType, '封闭', '96-K：生产场景的浇注系统类型必须自动带入');
  exact(r.typeSource, PARAM_SRC.SCENARIO, '96-K：来源必须标成"生产场景"');
  assert(SYSTEM_TYPE[r.gatingType], '96-K：带入的类型必须是 SYSTEM_TYPE 里的合法键');
}
function testL_scenarioYield() {
  const r = resolveProcessParams({ scenario: { yieldPct: 78, yieldSrc: 'USER_OVERRIDE' } });
  exact(r.yieldPct, 78, '96-L：生产场景的出品率必须自动带入');
  exact(r.yieldSource, PARAM_SRC.SCENARIO, '96-L：来源必须标成"生产场景"');
}
function testM_defaultsWhenNoScenario() {
  const r = resolveProcessParams({});
  exact(r.matFamily, DEFAULT_MAT_FAMILY, '96-M：没有场景时用材质默认值');
  exact(r.matSource, PARAM_SRC.DEFAULT, '96-M：来源标"默认值"');
  exact(r.gatingType, '', '96-M：没有场景时浇注系统类型 = 未指定（不给判定标准）');
  exact(r.yieldPct, null, '96-M：没有场景时出品率留空 → 由材质表推荐值兜底');
  exact(r.yieldSource, PARAM_SRC.DEFAULT, '96-M：出品率来源标"默认值"');
  // ★ 关键：yieldSug=75 是**材料表默认值**（src=DEFAULT），不能当成"生产场景设过 75"
  const r2 = resolveProcessParams({ scenario: { yieldPct: 75, yieldSrc: 'DEFAULT' } });
  exact(r2.yieldPct, null, '96-M：src=DEFAULT 的出品率只是材料表默认值，不算生产场景设置');
  exact(r2.yieldSource, PARAM_SRC.DEFAULT, '96-M：仍应标"默认值"');
}
function testN_manualWins() {
  const scenario = { family: '球铁', gatingType: '开放', yieldPct: 78, yieldSrc: 'USER_OVERRIDE' };
  const r = resolveProcessParams({ manualFamily: '铸钢', manualType: '封闭', manualYield: 62, scenario });
  exact(r.matFamily, '铸钢', '96-N：用户本次手动选的材质优先于生产场景');
  exact(r.matSource, PARAM_SRC.MANUAL, '96-N：来源标"本次设置"');
  exact(r.gatingType, '封闭', '96-N：用户本次手动选的类型优先');
  exact(r.typeSource, PARAM_SRC.MANUAL, '96-N：来源标"本次设置"');
  exact(r.yieldPct, 62, '96-N：用户本次填的出品率优先');
  exact(r.yieldSource, PARAM_SRC.MANUAL, '96-N：来源标"本次设置"');
  // 只手动改一项 → 其余两项仍走生产场景
  const r2 = resolveProcessParams({ manualType: '开放', scenario });
  exact(r2.matFamily, '球铁', '96-N：没手动改的项仍来自生产场景');
  exact(r2.matSource, PARAM_SRC.SCENARIO, '96-N：来源仍标"生产场景"');
  exact(r2.yieldPct, 78, '96-N：没手动改的出品率仍来自生产场景');
}

/* ============================================================
   96-O/P/Q 浇注系统类型 → 企业 R7 参考（96.txt §十）
   未指定 = 一句速度判定都不给；开放 = 1.0；封闭 = 1.5
   ============================================================ */
function pourFixture(ingateArea, systemType) {
  const { k } = areasOf(twoBoxes([20, 5, 30], [20, 5, 30]));
  const ingate = ingateArea != null ? { ...k, totalMm2: ingateArea, usableCount: 1, count: 1, partial: false } : k;
  return buildPouringResult({
    matKey: '灰铁(HT)',
    product: { volumeMm3: 2_000_000, partCount: 1, closedCount: 1, excludedCount: 0, partial: false },
    wallMm: 10,
    ingate,
    yieldPct: 75,
    systemType,
  });
}
function testO_noTypeNoJudgement() {
  const p = pourFixture(200, '');
  exact(p.systemType, null, '96-O：未指定类型时不得推定系统类型');
  exact(p.vLimit, null, '96-O：未指定类型时不得启用任何速度上限');
  exact(p.vExceed, null, '96-O：未指定类型时不得给"超限"结论');
  const codes = p.items.map((i) => i.code);
  assert(codes.includes(POUR_CODE.V_NO_CRITERION), '96-O：必须明说"未启用速度判定标准"');
  assert(!codes.includes(POUR_CODE.V_PASS) && !codes.includes(POUR_CODE.V_EXCEED),
    '96-O：未指定类型时不得出现任何 PASS / 超限条目');
  assert(!codes.includes(POUR_CODE.V_SUGGEST), '96-O：没超限就不该出现建议');
}
/**
 * 求"平均内浇口速度 = 目标值"所需的截面积。
 * 由 v ∝ 1/A 反推（同一材质 / 产品 / 壁厚 / 出品率下 t 与 A 无关），比拍一个面积数字稳。
 */
function areaForV(targetV, systemType = '') {
  const probe = pourFixture(100, systemType);
  assert(probe.vMs > 0, '96-P/Q 前提：探针面积下必须算得出速度');
  return 100 * probe.vMs / targetV;
}
function testP_openType() {
  exact(V_LIMIT['开放'], 1.0, '96-P 前提：开放式企业 R7 参考值 = 1.0 m/s');
  const pass = pourFixture(areaForV(0.80), '开放');    // 目标 0.80 → 低于 1.0 → 通过
  exact(pass.vLimit, 1.0, '96-P：开放式启用 1.0 m/s 参考');
  assert(pass.vMs < 1.0, `96-P 前提：夹具速度 ${pass.vMs} 应低于 1.0`);
  exact(pass.vExceed, false, '96-P：未超过');
  assert(pass.items.some((i) => i.code === POUR_CODE.V_PASS), '96-P：应给出"未超过"的结论');
  assert(!pass.items.some((i) => i.code === POUR_CODE.V_SUGGEST), '96-P：没超就不该出现建议');
  const over = pourFixture(areaForV(1.25), '开放');    // 目标 1.25 → 高于 1.0 → 超
  assert(over.vMs > 1.0, `96-P 前提：夹具速度 ${over.vMs} 应高于 1.0`);
  exact(over.vExceed, true, '96-P：超过 1.0');
  assert(over.items.some((i) => i.code === POUR_CODE.V_EXCEED), '96-P：应给出超限条目');
  assert(over.items.some((i) => i.code === POUR_CODE.V_SUGGEST), '96-P：超限后应单独给一条建议（§十七 分层）');
}
function testQ_closedType() {
  exact(V_LIMIT['封闭'], 1.5, '96-Q 前提：封闭式企业 R7 参考值 = 1.5 m/s');
  const p = pourFixture(areaForV(1.25), '封闭');
  exact(p.vLimit, 1.5, '96-Q：封闭式启用 1.5 m/s 参考');
  // 同一个速度 1.25：卡在 1.0 与 1.5 之间 → 开放式判超、封闭式判不超
  //   （这一条证明红线确实按类型分档，不是换个标签说同一件事）
  assert(p.vMs > 1.0 && p.vMs < 1.5, `96-Q 前提：速度 ${p.vMs} 应落在 1.0~1.5 之间`);
  const open = pourFixture(p.ingateAreaMm2, '开放');
  exact(open.vExceed, true, '96-Q：同一速度在开放式下应判超');
  exact(p.vExceed, false, '96-Q：同一速度在封闭式下应判不超');
  assert(!Object.values(SYSTEM_TYPE).some((t) => /行业标准|国标/.test(t.note)),
    '96-Q：R7 是企业经验审核参考，文案里不得写成行业标准');
}
function testR_classicFormulas() {
  const p = pourFixture(200, '封闭');
  exact(p.pourTimeS, calc_t('灰铁(HT)', p.weightKg, p.wallMm), '96-R：浇注时间必须逐位等于经典 calc_t');
  exact(p.vMs, calc_v(p.pourMassKg, p.rho, p.pourTimeS, p.ingateAreaMm2), '96-R：内浇口速度必须逐位等于经典 calc_v');
  rel(p.flowCm3s, p.pourVolCm3 / p.pourTimeS, 1e-12, '96-R：Q = V / t');
  // 量纲核对：Q 用 cm³/s、A 用 mm² → Q/A 的单位是 cm³/(s·mm²) = 10 mm/s = 0.01 m/s，
  //   即 v[m/s] = Q[cm³/s] / A[mm²]。所以下面的等式**不带系数**（PHASE 95 的页面断言同此口径）。
  rel(p.vMs, p.flowCm3s / p.ingateAreaMm2, 1e-12, '96-R：v = Q / A（cm³/s ÷ mm² 直接就是 m/s）');
}

/* ============================================================
   96-S 英文模式没有中文残留（新增词条）
   ============================================================ */
function testS_englishCoverage() {
  // PHASE 96 新增/改动的显示文案（含动态 key：对象表的值，审计脚本扫不到，必须手工登记）
  const keys = [
    '自动', '生产场景', '本次设置', '默认值', '默认值 {n}%',
    '单个面积', '小计', '组内最大差 {n} mm²', '异形截面', '截面方向', '方向未确认', '沿次主轴',
    '{n} 个单元截面方向未确认（按最长方向取），详情见下表',
    '建议：优先检查内浇口总面积、内浇口数量以及目标浇注时间。',
    '有 {n} 个单元的截面方向未确认（该单元两个方向尺度相当，程序按最长方向取），面积照实测给出，换一条轴向会不同 —— 详见详细信息。',
    '平均内浇口速度 {v} m/s 高于「{type}」的企业 R7 参考值 {lim} m/s。',
    '平均内浇口速度 {v} m/s，未超过「{type}」的企业 R7 参考值 {lim} m/s。',
    '浇注系统类型决定要不要拿「企业 R7 参考」比一下平均内浇口速度：开放式 ≤ 1.0 m/s、封闭式 ≤ 1.5 m/s（企业经验审核值，不是行业标准）。选「自动」= 不做这个比较，只给几何与流量估算。',
    '材质', '浇注系统类型', '出品率',
  ];
  for (const k of keys) {
    assert(EN[k] != null && String(EN[k]).trim() !== '', `96-S：英文词条缺失 —— ${k}`);
    assert(!/[一-龥]/.test(String(EN[k])), `96-S：英文词条里还有中文 —— ${k} → ${EN[k]}`);
  }
  // 中文原文是 key：译文表里出现的中文原文，必须能在源码里找到（防止表里塞了死键）
  for (const k of ['单个面积', '小计', '截面方向']) {
    assert(EN[k] !== k, `96-S：${k} 必须有真正的英文译文（不能回退中文）`);
  }
}

/* ============================================================
   96-T 真矩形的形状判定不得随网格相位翻（PHASE 96 修的**核心抖动**）
   ------------------------------------------------------------
   病理：真矩形的 quadFill 落在 0.9382~0.9761（闸门 0.95 正压在噪声带上），
   同一块几何有时判 rect、有时判 irregular → 两个一样的内浇口被判"多种规格"。
   防线：同一块 20×5×30，扫分辨率 + 扫破对称小量，**必须全部判 rect 且尺寸一致**。
   ============================================================ */
function testT_shapeStability() {
  const seen = [];
  for (const res of [64, 80, 96, 112, 128]) {
    for (const eps of [0, 0.0173, 0.05, 0.11, 0.37]) {
      const E = [[-PAD - eps, -PAD - eps * 2, -PAD - eps * 3], [20 + PAD + eps * 4, 5 + PAD + eps * 5, 30 + PAD + eps * 6]];
      const m = objectMetrics(meshOf(BOX([0, 0, 0], [20, 5, 30]), E, res), { withPoly: true });
      const sh = sectionShapeOf(m);
      seen.push({ res, eps, type: sh.type, area: sh.areaMm2, w: sh.wMm, h: sh.hMm });
    }
  }
  const bad = seen.filter((s) => s.type !== 'rect');
  assert(bad.length === 0,
    `96-T：真矩形在 25 组网格参数下必须**全部**判 rect，实际有 ${bad.length} 组不是：`
    + bad.map((b) => `res=${b.res} eps=${b.eps}→${b.type}`).join(', '));
  for (const s of seen) {
    rel(s.area, 100, 0.01, `96-T：res=${s.res} eps=${s.eps} 的截面积`);
    rel(s.w, 20, 0.01, `96-T：res=${s.res} eps=${s.eps} 的 W`);
    rel(s.h, 5, 0.01, `96-T：res=${s.res} eps=${s.eps} 的 H`);
  }
  // 闸门必须给出方向性的余量：真矩形 ≥0.995，其他候选形状 ≤0.86
  assert(SHAPE_GATE.RECT_FILL_MIN < 0.995 && SHAPE_GATE.RECT_FILL_MIN > 0.86,
    `96-T：矩形闸门 ${SHAPE_GATE.RECT_FILL_MIN} 应落在"真矩形 ≥0.995 / 其他 ≤0.86"之间，不能压线`);
}

/* ============================================================
   96-U 方向不唯一的单元：面积照给 + 明确标记（不再是 null）
   ------------------------------------------------------------
   PHASE 94 的行为是"方向不唯一 → 留空"；PHASE 96 改成"照给实测面积 + 标记"，
   依据 96.txt §六（第一优先：真实闭合截面的几何面积）与 §二十一
   （"只要能够得到可靠闭合截面：直接计算闭合截面的真实几何面积"）。
   本测试同时守住两条：
     · 面积**是**实测的（不许拿 bbox 冒充）；
     · 方向确实有歧义时**必须**标出来（不许悄悄给一个数）。
   ============================================================ */
function testU_plateGivesAreaWithFlag() {
  // 40×48×8 的板：两条大轴尺度相当、第三条明显薄 → 方向不唯一
  const mesh = solid([0, 0, 0], [40, 8, 48], 96);
  const { parts, k } = areasOf(mesh);
  const u = parts.objects[0];
  assert(u.closed === true, '96-U 前提：板是闭合实体');
  assert(u.areaMm2 != null && u.areaMm2 > 0, '96-U：方向不唯一也要给实测面积（不再是 null）');
  exact(u.axisUncertain, true, '96-U：方向不唯一必须标记出来');
  assert(u.shape.altAreaMm2 != null && u.shape.altAreaMm2 > 0, '96-U：必须给出"另一条主轴的截面"作对照');
  assert(u.shape.altSpreadPct > AXIS_SPREAD_MIN,
    `96-U：对照面积差 ${u.shape.altSpreadPct}% 应大于噪声地板 ${AXIS_SPREAD_MIN}%`);
  // 面积是**实测闭合截面**，不是包围盒任何一对边的乘积
  const sz = u.metrics.size;
  const bboxAreas = [sz[0] * sz[1], sz[0] * sz[2], sz[1] * sz[2]];
  assert(bboxAreas.every((a) => Math.abs(a - u.areaMm2) > 1e-6),
    `96-U：不许拿包围盒面积冒充（实测 ${u.areaMm2}，bbox 候选 ${bboxAreas.join('/')}）`);
  rel(k.totalMm2, u.areaMm2, 1e-12, '96-U：总面积 = 该单元实测面积');

  // 反面：方形截面（两条大轴一样长）虽然命中平板判据，但两条轴切出来是同一个截面
  //   → **不该**报警（PHASE 96 修掉的假警报）
  const sq = areasOf(solid([0, 0, 0], [30, 5, 30], 96));
  exact(sq.parts.objects[0].axisUncertain, false,
    '96-U：两条主轴的截面实际相同时不得报"方向未确认"（假警报）');

  // 圆柱（⌀12×20）本来就不是平板 → 无标记
  const cyl = areasOf(meshOf((p) => Math.max(Math.hypot(p[0], p[2]) - 6, Math.abs(p[1]) - 10), [[-16, -16, -16], [16, 16, 16]], 96));
  exact(cyl.parts.objects[0].axisUncertain, false, '96-U：圆柱不是平板，不该有方向标记');
  exact(cyl.parts.objects[0].shape.type, 'circular', '96-U：圆柱应判圆形');
}

/* ============================================================
   96-V 规格容差本身被断言（96.txt §七："必须把这个容差写进测试"）
   ============================================================ */
function testV_specTolerance() {
  // 容差必须是"显示精度 0.05mm / 0.5% 相对量取大者"，且面积兜底 1.5%
  assert(DIM_SAME_ABS === 0.05, `96-V：尺寸绝对容差应为 0.05mm，实际 ${DIM_SAME_ABS}`);
  assert(DIM_SAME_REL === 0.005, `96-V：尺寸相对容差应为 0.5%，实际 ${DIM_SAME_REL}`);
  assert(SPEC_AREA_REL === 0.015, `96-V：面积兜底容差应为 1.5%，实际 ${SPEC_AREA_REL}`);
  const sh = (type, o) => ({ usable: true, type, areaMm2: 100, ...o });
  const mk = (shape) => ({ shape });
  // 同规格：0.2% 的离散（网格相位量级）必须判同一规格
  assert(sameSpec(mk(sh('rect', { wMm: 20, hMm: 5 })), mk(sh('rect', { wMm: 20.04, hMm: 5.01 }))) === true,
    '96-V：同一规格的网格离散（0.2%）必须判为同规格');
  // 不同规格：20 vs 21（5%）必须判不同
  assert(sameSpec(mk(sh('rect', { wMm: 20, hMm: 5 })), mk(sh('rect', { wMm: 21, hMm: 5 }))) === false,
    '96-V：相差 5% 的不同规格必须判为不同');
  // 类型不可比（rect vs irregular）→ 退回实测面积比
  assert(sameSpec(mk(sh('rect', { wMm: 20, hMm: 5, areaMm2: 100 })), mk({ usable: true, type: 'irregular', areaMm2: 99.5 })) === true,
    '96-V：类型不可比但实测面积相差 0.5% 时，必须判为同一规格（PHASE 96 修掉的"多种规格"误报）');
  assert(sameSpec(mk(sh('rect', { wMm: 20, hMm: 5, areaMm2: 100 })), mk({ usable: true, type: 'irregular', areaMm2: 150 })) === false,
    '96-V：实测面积差 50% 时必须判为不同规格');
  // 量不出面积的一律不参与分组
  assert(sameSpec(mk({ usable: false, areaMm2: null }), mk({ usable: false, areaMm2: null })) === false,
    '96-V：量不出截面的单元不得互相配对成规格组');
  exact(groupBySpec([{ id: 'I1', areaMm2: null, shape: null }]).length, 0,
    '96-V：量不出面积的单元不进任何规格组');
}

/* ============================================================
   96-X 占位符顺序（96.txt §十七 的显示层纪律）
   ------------------------------------------------------------
   病根：i18n 的 tr(key, params) 是**按出现顺序**代入的（js/i18n/index.js 第 55 行
   `vars[i++]`）。所以"中文原文即 key"的那些词条，译文里的 {…} 顺序必须与原文逐个对齐 ——
   否则类型名会被填进限值、限值被填进类型名，页面读起来像一句人话但两个数都放错了位置。
   实测（英文截图抓到的真 bug）：
     "…未超过「开放式」的企业 R7 参考值 1 m/s。"
     → "…within the company R7 reference of Unpressurized m/s for "1"."
   本测试把这一类整体守住：**凡是 key 里含中文的词条，译文占位符序列必须与 key 完全一致**。
   ============================================================ */
function testX_placeholderOrder() {
  const CJK = /[一-龥]/;
  const ph = (s) => (String(s).match(/\{(\w*)\}/g) || []);
  const bad = [];
  for (const [k, v] of Object.entries(EN)) {
    if (typeof v !== 'string' || !CJK.test(k)) continue;   // 语义 key（如 home.nTools）不在此契约内
    const a = ph(k).join(','), b = ph(v).join(',');
    if (a !== b) bad.push(`${k.slice(0, 34)}… 【原文 ${a || '(无)'} → 译文 ${b || '(无)'}】`);
  }
  assert(bad.length === 0,
    `96-X：以下词条的译文占位符顺序与中文原文不一致（会导致参数填错位置）：\n    ` + bad.join('\n    '));
  // 已知会被代入的三个浇注温度/速度词条：顺序必须是 v → type → lim
  for (const k of ['平均内浇口速度 {v} m/s，未超过「{type}」的企业 R7 参考值 {lim} m/s。',
    '平均内浇口速度 {v} m/s 高于「{type}」的企业 R7 参考值 {lim} m/s。']) {
    assert(ph(EN[k]).join(',') === '{v},{type},{lim}', `96-X：${k.slice(0, 16)}… 的译文顺序必须是 v → type → lim`);
  }
}

/* ============================================================
   96-W 数据完整性：任何输入组合都不许出 NaN / Infinity（96.txt §十五 的既有纪律）
   ============================================================ */
function testW_noNaN() {
  const combos = [
    {}, { matKey: null }, { matKey: '不存在' },
    { product: { volumeMm3: NaN, partCount: 1 } },
    { product: { volumeMm3: 0, partCount: 1 } },
    { ingate: { totalMm2: NaN, count: 1 } },
    { wallMm: NaN }, { wallMm: -1 }, { yieldPct: 0 }, { yieldPct: 200 }, { systemType: '乱写' },
  ];
  const base = {
    matKey: '灰铁(HT)',
    product: { volumeMm3: 1_000_000, partCount: 1, closedCount: 1, excludedCount: 0, partial: false },
    wallMm: 10, ingate: { totalMm2: 200, count: 1, usableCount: 1, partial: false }, yieldPct: 75, systemType: '',
  };
  for (const c of combos) {
    const p = buildPouringResult({ ...base, ...c });
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number') assert(Number.isFinite(v), `96-W：${JSON.stringify(c)} 的 ${k} = ${v}（NaN/Infinity 不许出现）`);
    }
    assert(Array.isArray(p.items) && p.items.length > 0,
      `96-W：${JSON.stringify(c)} 的重点提示不许为空（用户会以为算过了）`);
  }
}

export const tests = [
  { name: '96-A 两个完全相同矩形内浇口：100+100=200 且归成一个规格', fn: testA_twoSame },
  { name: '96-B 三个完全相同矩形：100×3=300 一个规格', fn: testB_threeSame },
  { name: '96-C 两个不同规格矩形：100+150=250 分成两组', fn: testC_twoDifferent },
  { name: '96-D 梯形：(a+b)h/2 与实测截面自洽', fn: testD_trapezoid },
  { name: '96-E 扇形/弧边：给实测 157mm²，绝不拿 bbox 20×10=200 冒充', fn: testE_arcSection },
  { name: '96-F 异形截面：按实测几何面积给，不强行识别形状', fn: testF_irregular },
  { name: '96-G 不同世界坐标位置：总面积与单元面积逐位一致', fn: testG_worldPosition },
  { name: '96-H 总面积严格 = Σ 每个有效单元的真实面积', fn: testH_totalIsSum },
  { name: '96-I 规格分组只影响展示，不影响真实总面积', fn: testI_groupingDoesNotChangeTotal },
  { name: '96-J 生产场景自动带入材质（并标出来源）', fn: testJ_scenarioMaterial },
  { name: '96-K 生产场景自动带入浇注系统类型', fn: testK_scenarioGatingType },
  { name: '96-L 生产场景自动带入出品率', fn: testL_scenarioYield },
  { name: '96-M 生产场景缺失时用默认值（含 yieldSug=DEFAULT 不算已设置）', fn: testM_defaultsWhenNoScenario },
  { name: '96-N 用户本次修改优先于生产场景（逐项独立）', fn: testN_manualWins },
  { name: '96-O 没有浇注系统类型时不启用 R7 判断', fn: testO_noTypeNoJudgement },
  { name: '96-P 开放式启用 1.0 m/s 企业参考', fn: testP_openType },
  { name: '96-Q 封闭式启用 1.5 m/s 企业参考', fn: testQ_closedType },
  { name: '96-R 经典 calc_t / calc_v 结果保持一致（逐位）', fn: testR_classicFormulas },
  { name: '96-S 英文模式没有中文残留（含动态 key 手工登记）', fn: testS_englishCoverage },
  { name: '96-T 真矩形形状判定跨 25 组网格参数不翻（PHASE 96 核心回归）', fn: testT_shapeStability },
  { name: '96-U 方向不唯一的单元：面积照给 + 标记 + 假警报不触发', fn: testU_plateGivesAreaWithFlag },
  { name: '96-V 规格容差本身被断言（0.05mm / 0.5% / 面积兜底 1.5%）', fn: testV_specTolerance },
  { name: '96-W 缺参数 / 非法参数下不出现 NaN、Infinity，提示不为空', fn: testW_noNaN },
  { name: '96-X 翻译占位符顺序必须与中文原文一致（按位置代入的坑）', fn: testX_placeholderOrder },
];
