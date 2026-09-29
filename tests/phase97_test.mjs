// ============================================================
// PHASE 97（97.txt）· 内浇口连接方向修正 + 出品率问题修复
//
// 覆盖 97.txt §十四 的六组核心场景：
//   97-A 出品率：yieldSug = 78 → 78（来源 生产场景）；没有场景值 → **不该莫名得到 68**
//   97-B 普通内浇口：20×5×30，连接面 20×5 → 有效面积 ≈ 100（不是 60）
//   97-C 短宽内浇口：20×5×12，连接面 20×5 → 有效面积 ≈ 100  ★本阶段最重要的验证
//   97-D 多个相同内浇口：100 + 100 + 100 = 300
//   97-E 不同规格：100 + 150 = 250，分组不得改变总面积
//   97-F 无可靠连接信息 → 正确退回 PHASE 96 主轴 fallback，不得整片失败
// 另加：
//   97-G 两端连接（产品 + 横浇道）→ CONFIRMED；两端方向不一致 → UNCERTAIN（§十）
//   97-H connectionArea ≠ effectiveArea（§九 的纪律：面积必须是切出来的）
//   97-I 方向由连接面定时不再标"方向未确认"（与 PHASE 96 的标记互斥）
//   97-J 架构纪律：js/engine 零改动；totalArea = Σ 实测面积
//
// ★ 只跑本文件：node tests/runner.mjs phase97   （97.txt §十二 Level 1）
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tetMC, BOX } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { objectMetrics } from '../js/model/objectMetrics.js';
import { sectionShapeOf } from '../js/model/sectionShape.js';
import { triangleComponents, meshSubset, meshDiagonal } from '../js/model/meshComponents.js';
import { buildTriGrid } from '../js/model/meshDistance.js';
import {
  resolveIngateDirection, connectionTolerance, DIR_CONF, DIR_SOURCE, DIR_ROLE,
  CONN_TOL_ABS, CONN_TOL_REL, ANTI_PARALLEL_DEG,
} from '../js/model/ingateConnection.js';
import { MATERIALS } from '../calcs/gating.js';
import {
  KIND, gatingUnitsFromComponents, buildGatingAreas,
  resolveProcessParams, PARAM_SRC,
} from '../js/model/processInspection.js';

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const rel = (got, want, tol, m) => {
  assert(Number.isFinite(got), `${m}：拿到的是 ${got}`);
  const e = Math.abs(got - want) / Math.abs(want);
  assert(e <= tol, `${m}（实际 ${got}，期望 ${want}，偏差 ${(e * 100).toFixed(3)}% > ${(tol * 100).toFixed(3)}%）`);
};

/* ---------------- 夹具 ---------------- */

const PAD = 8, EPS = 0.0173;
/** 单块实体（包络自一份，保证闭合）；at = 整体平移 */
function solid(mn, mx, at = [0, 0, 0], res = 96) {
  const b = [[mn[0] - PAD - EPS, mn[1] - PAD - EPS * 2, mn[2] - PAD - EPS * 3],
    [mx[0] + PAD + EPS * 4, mx[1] + PAD + EPS * 5, mx[2] + PAD + EPS * 6]];
  const v = tetMC(BOX(mn, mx), b, res);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) { out[i] = v[i] + at[0]; out[i + 1] = v[i + 1] + at[1]; out[i + 2] = v[i + 2] + at[2]; }
  return { vertices: out, triCount: v.length / 9 };
}
/** 多块合并成一份 STL（每块单独生成后平移）—— 一份 STL 里 N 个独立实体 */
function merged(parts) {
  const chunks = parts.map(([mn, mx, at]) => solid(mn, mx, at));
  const total = chunks.reduce((s, c) => s + c.triCount * 9, 0);
  const vertices = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { vertices.set(c.vertices, off); off += c.triCount * 9; }
  return { vertices, triCount: total / 9 };
}
const gridCellOf = (m) => Math.max(meshDiagonal(m.vertices, m.triCount) / 64, 1e-3);
const gridOf = (m) => buildTriGrid(m, gridCellOf(m));

/**
 * 产品：100×100×40 块，**顶面 y = 0**（内浇口坐在它上面）。
 * ⚠ 网格与空间哈希都**只建一次**（97.txt §十二 要求 Level 1 局部测试快）：
 *   tetMC 在这个包络上跑一次是秒级的，十个用例各建一遍就让"局部测试"失去意义了。
 */
let _prod = null, _prodGrid = null;
const productMesh = () => (_prod || (_prod = solid([-50, -40, -50], [50, 0, 50], [0, 0, 0], 80)));
const productGrid = () => (_prodGrid || (_prodGrid = gridOf(productMesh())));

/**
 * 走页面同一条路：一份内浇口 STL → 单元（含连接面定向 + 截面测量）。
 * @param {Array} targets [{role, mesh}] —— 与页面一样，每个目标的网格哈希只建一次
 */
function unitsOf(ingateMesh, targets = []) {
  const tgt = targets.map((t) => ({
    role: t.role, mesh: t.mesh,
    // 与页面同一条缓存规则：同网格同格长只建一次
    grid: (t.mesh === _prod && _prodGrid) ? _prodGrid : gridOf(t.mesh),
  }));
  const cc = triangleComponents(ingateMesh);
  const dirs = cc.components.map((c) => (c.triCount > 0
    ? resolveIngateDirection({ ingateMesh: meshSubset(ingateMesh, c.tris), targets: tgt }) : null));
  const parts = gatingUnitsFromComponents(ingateMesh, KIND.INGATE, 'g.stl', cc.components,
    (m, i) => objectMetrics(m, { withPoly: true, altAxis: true, axisDir: dirs[i]?.direction || null }),
    (m, i) => sectionShapeOf(m, dirs[i] || null));
  const areas = buildGatingAreas({ [KIND.INGATE]: parts.objects });
  return { parts, dirs, k: areas.kinds.find((x) => x.kind === KIND.INGATE) };
}

/* ============================================================
   97-A 出品率（97.txt §二 / §十四.A）
   ------------------------------------------------------------
   要求：production scenario yieldSug = 78 → resolved yield = 78 → 来源 = 生产场景；
        并且：**没有生产场景值 → 不应该莫名得到 68**。
   ============================================================ */
function testA_yield() {
  const r = resolveProcessParams({ scenario: { yieldPct: 78, yieldSrc: 'USER_OVERRIDE' } });
  assert(r.yieldPct === 78, `97-A：生产场景 78 必须原样解析出来，实际 ${r.yieldPct}`);
  assert(r.yieldSource === PARAM_SRC.SCENARIO, `97-A：来源必须是"生产场景"，实际 ${r.yieldSource}`);

  // ★ 没有生产场景值 → 解析结果必须是 null（表示"场景没设过"），由材质表兜底
  const none = resolveProcessParams({});
  assert(none.yieldPct === null, `97-A：没有场景值时不得凭空得到一个数（实际 ${none.yieldPct}）`);
  assert(none.yieldSource === PARAM_SRC.DEFAULT, `97-A：来源应标"默认值"，实际 ${none.yieldSource}`);
  // 兜底值必须**只**来自材质表（calcs/gating.js 的 MATERIALS），且不等于 68
  for (const [k, md] of Object.entries(MATERIALS)) {
    assert(md.y_sug !== 68, `97-A：材质表里不该有 68（${k} = ${md.y_sug}）`);
  }
  assert(MATERIALS['球铁(QT)'].y_sug === 65, '97-A：球铁兜底出品率 = 材质表的 65');
  // src=DEFAULT 的 75 只是材料表默认值，不算"场景设过"（PHASE 96 §十五 的纪律）
  const def = resolveProcessParams({ scenario: { yieldPct: 75, yieldSrc: 'DEFAULT' } });
  assert(def.yieldPct === null && def.yieldSource === PARAM_SRC.DEFAULT,
    `97-A：src=DEFAULT 不算场景设置（实际 ${def.yieldPct} / ${def.yieldSource}）`);
  // 优先级没变（97.txt §二.6 明令不许改）
  const manual = resolveProcessParams({ manualYield: 62, scenario: { yieldPct: 78, yieldSrc: 'USER_OVERRIDE' } });
  assert(manual.yieldPct === 62 && manual.yieldSource === PARAM_SRC.MANUAL,
    '97-A：本次手动设置的优先级仍然高于生产场景');
}

/* ============================================================
   97-B 普通内浇口（97.txt §十四.B）
   ------------------------------------------------------------
   连接截面 20×5、充型路程 30。主轴本来就取对了（30 最长），
   但**方向仍必须由连接面给出**（不能"碰巧对了"就当方向没问题）。
   ============================================================ */
function testB_normalIngate() {
  const prod = productMesh();
  const ing = solid([0, 0, 0], [20, 30, 5]);           // x 0..20（宽）, y 0..30（路程）, z 0..5（厚）
  const { parts, dirs, k } = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  assert(parts.objects.length === 1, `97-B：应是 1 个单元，实际 ${parts.objects.length}`);
  const d = dirs[0];
  assert(d.direction != null, '97-B：贴在产品上必须能定出方向');
  // 连接面法向应指向 −Y（进入铸件）
  assert(d.direction[1] < -0.95, `97-B：进给方向应指向 −Y（实际 ${d.direction.map((x) => x.toFixed(3))}）`);
  const u = parts.objects[0];
  rel(u.areaMm2, 100, 0.03, '97-B：有效截面积（20×5）');
  assert(u.shape.type === 'rect', `97-B：截面应判为矩形，实际 ${u.shape.type}`);
  rel(u.shape.wMm, 20, 0.03, '97-B：截面宽');
  rel(u.shape.hMm, 5, 0.03, '97-B：截面厚');
  rel(k.totalMm2, 100, 0.03, '97-B：总截面积');
}

/* ============================================================
   97-C 短宽内浇口 ★本阶段最重要的验证（97.txt §十四.C）
   ------------------------------------------------------------
   连接截面 20×5、充型路程只有 12 —— 比"宽 20"还短。
   ★ PHASE 96 会取到最长主轴（宽 20）→ 切成 12×5 = 60；
     本阶段必须按**连接面方向**切成 20×5 = 100。
   ============================================================ */
function testC_shortWide() {
  const prod = productMesh();
  const ing = solid([0, 0, 0], [20, 12, 5]);           // 路程 12 < 宽 20
  // 先证明"退回主轴约定确实会算错"——否则这条测试证明不了任何东西
  const noConn = unitsOf(ing, []);
  assert(noConn.dirs[0].direction === null, '97-C 前提：不给连接目标时必须退回主轴');
  rel(noConn.parts.objects[0].areaMm2, 60, 0.03,
    '97-C 前提：主轴约定下这个内浇口确实会算成 60（这正是 PHASE 96 的典型误判）');

  // 再证明连接面方向能修好它
  const { parts, dirs, k } = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  const d = dirs[0];
  assert(d.direction != null && d.direction[1] < -0.95, '97-C：方向必须由产品连接面给出（−Y）');
  assert(d.confidence === DIR_CONF.INFERRED, `97-C：只找到产品端 → INFERRED，实际 ${d.confidence}`);
  assert(d.source === DIR_SOURCE.PRODUCT_CONNECTION, `97-C：来源应为 product-connection，实际 ${d.source}`);
  const u = parts.objects[0];
  rel(u.areaMm2, 100, 0.03, '★ 97-C：短宽内浇口的有效截面积必须是 100（不是 60）');
  rel(u.shape.wMm, 20, 0.03, '97-C：截面宽 20');
  rel(u.shape.hMm, 5, 0.03, '97-C：截面厚 5');
  rel(k.totalMm2, 100, 0.03, '97-C：总截面积 100');
  assert(u.axisUncertain !== true, '97-C：方向有几何依据时不该再标"方向未确认"');
}

/* ============================================================
   97-D 多个相同内浇口（97.txt §十四.D）：100 + 100 + 100 = 300
   ============================================================ */
function testD_threeSame() {
  const prod = productMesh();
  // ⚠ 三个内浇口都要落在产品投影内（x ∈ [-50,50]），否则就是"悬空"、本来就不该判连接
  const ing = merged([
    [[0, 0, 0], [20, 12, 5], [-45, 0, 0]],
    [[0, 0, 0], [20, 12, 5], [-10, 0, 0]],
    [[0, 0, 0], [20, 12, 5], [25, 0, 0]],
  ]);
  const { parts, k } = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  assert(parts.objects.length === 3, `97-D：应识别 3 个单元，实际 ${parts.objects.length}`);
  for (const o of parts.objects) rel(o.areaMm2, 100, 0.03, `97-D：${o.id} 单个面积`);
  rel(k.totalMm2, 300, 0.03, '★ 97-D：总面积必须是 100×3 = 300');
  assert(k.groups.length === 1 && k.groups[0].count === 3, '97-D：三个相同规格归成一组');
  assert(k.connCount === 3, `97-D：三个单元的方向都应由连接面确定，实际 ${k.connCount}`);
}

/* ============================================================
   97-E 不同规格（97.txt §十四.E）：100 + 150 = 250，分组不得改变总面积
   ============================================================ */
function testE_mixedSpec() {
  const prod = productMesh();
  const ing = merged([
    [[0, 0, 0], [20, 12, 5], [-45, 0, 0]],
    [[0, 0, 0], [30, 12, 5], [0, 0, 0]],
  ]);
  const { parts, k } = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  assert(parts.objects.length === 2, '97-E：应识别 2 个单元');
  const raw = parts.objects.map((o) => o.areaMm2).sort((a, b) => a - b);
  rel(raw[0], 100, 0.03, '97-E：20×5 那个');
  rel(raw[1], 150, 0.03, '97-E：30×5 那个');
  rel(k.totalMm2, 250, 0.03, '★ 97-E：总面积 = 100 + 150 = 250');
  assert(k.groups.length === 2, `97-E：不同规格应分成两组，实际 ${k.groups.length}`);
  // 分组不得改变总面积（Σ 实测，不是 规格面积 × 数量）
  rel(k.groups.reduce((s, g) => s + g.subtotalMm2, 0), k.totalMm2, 1e-12,
    '97-E：分组小计之和必须逐位等于总面积');
}

/* ============================================================
   97-F 无可靠连接信息（97.txt §十四.F）
   ------------------------------------------------------------
   必须正确 fallback 到 PHASE 96 的 principalAxis，
   **不能因为新算法加入后导致所有无法连接识别的 STL 都失败**。
   ============================================================ */
function testF_fallback() {
  const prod = productMesh();
  // ① 完全没有目标（页面里产品/上游都还没导入）
  const lonely = solid([0, 0, 0], [20, 12, 5]);
  const a = unitsOf(lonely, []);
  assert(a.dirs[0].confidence === DIR_CONF.UNCERTAIN && a.dirs[0].direction === null,
    '97-F：没有目标时必须 UNCERTAIN');
  assert(a.parts.objects[0].areaMm2 != null, '97-F：退回主轴也必须给出面积（不能整片失败）');
  rel(a.parts.objects[0].areaMm2, 60, 0.03, '97-F：退回后就是 PHASE 96 的主轴结果');

  // ② 有产品但离得很远（悬空 300mm）
  const far = solid([0, 0, 0], [20, 12, 5], [0, 0, 300]);
  const b = unitsOf(far, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  assert(b.dirs[0].direction === null, '97-F：离产品 300mm 不得算作连接');
  assert(b.dirs[0].confidence === DIR_CONF.UNCERTAIN, '97-F：应降级为 UNCERTAIN');
  rel(b.parts.objects[0].areaMm2, 60, 0.03, '97-F：退回主轴结果');

  // ③ 阈值是"内浇口自身尺度"的相对量，不是随手一个绝对值
  const tol = connectionTolerance(lonely);
  assert(tol >= CONN_TOL_ABS && tol >= CONN_TOL_REL * meshDiagonal(lonely.vertices, lonely.triCount) - 1e-9,
    `97-F：距离阈值公式不符（${tol}）`);
  assert(connectionTolerance(solid([0, 0, 0], [400, 20, 20])) > tol,
    '97-F：大内浇口的阈值必须大于小内浇口（相对量语义）');
}

/* ============================================================
   97-G 两端连接 → CONFIRMED；两端方向不一致 → UNCERTAIN（97.txt §八 / §十）
   ============================================================ */
function testG_bothEnds() {
  const prod = productMesh();                                   // 顶面 y = 0
  const runner = solid([-50, 12, -10], [50, 20, 10]);           // 底面 y = 12
  const ing = solid([0, 0, -2.5], [20, 12, 2.5]);               // y 0..12：下接产品、上接横浇道

  const both = unitsOf(ing, [
    { role: DIR_ROLE.PRODUCT, mesh: prod },
    { role: DIR_ROLE.RUNNER, mesh: runner },
  ]);
  const d = both.dirs[0];
  assert(d.confidence === DIR_CONF.CONFIRMED, `97-G：两端都接上应判 CONFIRMED，实际 ${d.confidence}`);
  assert(d.source === DIR_SOURCE.CONNECTION, `97-G：来源应为 connection，实际 ${d.source}`);
  assert(d.runnerRole === DIR_ROLE.RUNNER, `97-G：上游端应记成横浇道，实际 ${d.runnerRole}`);
  assert(d.direction[1] < -0.95, '97-G：进给方向仍是朝铸件的 −Y');
  rel(both.parts.objects[0].areaMm2, 100, 0.04, '97-G：有效截面仍是 20×5');

  // 只给产品端 → INFERRED（置信度必须真的降下来，不许一律 CONFIRMED）
  const one = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  assert(one.dirs[0].confidence === DIR_CONF.INFERRED, '97-G：只有一端 → INFERRED');

  // 两端方向**不一致** → 降级 UNCERTAIN，退回主轴（§十）
  //   把横浇道挪到内浇口**侧面**（法向沿 X），与产品端（−Y）明显不共线
  const sideRunner = solid([20, 2, -10], [32, 10, 10]);   // 贴在内浇口**侧面**（法向沿 +X）
  const bad = unitsOf(ing, [
    { role: DIR_ROLE.PRODUCT, mesh: prod },
    { role: DIR_ROLE.RUNNER, mesh: sideRunner },
  ]);
  assert(bad.dirs[0].direction === null,
    `97-G：两端方向明显不一致时必须降级 UNCERTAIN（实际 ${bad.dirs[0].direction}）`);
  assert(bad.dirs[0].confidence === DIR_CONF.UNCERTAIN, '97-G：降级后置信度是 UNCERTAIN');
  assert(/ends_/.test(bad.dirs[0].reason || ''), `97-G：原因码应说明是两端的问题，实际 ${bad.dirs[0].reason}`);
  assert(bad.parts.objects[0].areaMm2 != null, '97-G：降级后仍然要退回主轴给面积');
  assert(ANTI_PARALLEL_DEG === 30, '97-G：共线反向的判据是夹角 > 150°（30° 容差）');
}

/* ============================================================
   97-H connectionArea ≠ effectiveArea（97.txt §九 的纪律）
   ------------------------------------------------------------
   连接面识别的作用**只是确定方向**；面积必须由"垂直于该方向的闭合截面"实测得到。
   直接拿 connectionArea 当有效面积是明令禁止的。
   ============================================================ */
function testH_areaNotConnection() {
  const prod = productMesh();
  const ing = solid([0, 0, 0], [20, 12, 5]);
  const { parts, dirs } = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  const conn = dirs[0].areaMm2;
  const eff = parts.objects[0].areaMm2;
  assert(Number.isFinite(conn) && conn > 0, '97-H：连接面面积应量得出来');
  // 连接面是把"贴在产品上那一小片"的所有近邻三角面都算进去（含 1mm 带宽的侧面），
  // 所以它必然**不等于**有效截面 —— 这正是 §九 不许直接拿它当面积的原因。
  assert(Math.abs(conn - eff) > eff * 0.05,
    `97-H：连接面面积(${conn.toFixed(1)}) 与有效截面(${eff.toFixed(1)}) 本来就不同，`
    + '实现里若两者相等说明直接拿连接面当面积了（§九 禁止）');
  rel(eff, 100, 0.03, '97-H：有效截面仍是实测的 20×5');
}

/* ============================================================
   97-I 方向来源与 PHASE 96 的"方向未确认"互斥
   ============================================================ */
function testI_marksExclusive() {
  const prod = productMesh();
  // 20×5×25：PHASE 96 会判"平板 → 方向未确认"；有连接面之后不该再标
  const ing = solid([0, 0, 0], [20, 25, 5]);
  const noConn = unitsOf(ing, []);
  assert(noConn.parts.objects[0].axisUncertain === true,
    '97-I 前提：没有连接信息时，这个短粗件确实会被 PHASE 96 标成"方向未确认"');
  const withConn = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  const u = withConn.parts.objects[0];
  assert(u.axisUncertain === false, '97-I：方向由连接面给出后不得再标"方向未确认"');
  assert(u.shape.directionSource === DIR_SOURCE.PRODUCT_CONNECTION, '97-I：应记下来源');
  rel(u.areaMm2, 100, 0.03, '97-I：面积仍是 20×5');
  assert(withConn.k.connCount === 1 && withConn.k.uncertainCount === 0,
    '97-I：connCount 与 uncertainCount 必须互斥');
}

/* ============================================================
   97-J 架构纪律（97.txt §十一/§十五）
   ============================================================ */
function testJ_architecture() {
  const here2 = join(here, '..');
  // ① 不得改动 js/engine/**（指纹在 BASELINE.md 里，这里守"没有新增 import/改动"这一层）
  const src = readFileSync(join(here2, 'js', 'model', 'ingateConnection.js'), 'utf8');
  assert(!/from '\.\.\/engine\//.test(src), '97-J：新模块不得依赖 js/engine/**');
  // ② 复用既有工具，不重写一套（97.txt 开头"大道至简"）
  assert(/from '\.\/meshDistance\.js'/.test(src) && /from '\.\/meshComponents\.js'/.test(src),
    '97-J：连接面识别必须复用 meshDistance / meshComponents 两个既有工具');
  // ③ §六 明令不要的东西不许出现
  //   ⚠ 先**去掉注释**再查：源码里那句"不要 AI/曲率/网格重构"本身就是一条注释，
  //     不去注释会把"声明不做这件事"当成"做了这件事"（PHASE 95 在"湍流"上踩过同一个坑）。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/tensorflow|onnx|machine.?learn|曲率|CFD/i.test(code), '97-J：不得引入 §六 明令排除的东西');
  // ④ 总面积仍然是 Σ 实测（97.txt §十一.4）
  const prod = productMesh();
  const ing = merged([
    [[0, 0, 0], [20, 12, 5], [0, 0, 0]],
    [[0, 0, 0], [30, 12, 5], [40, 0, 0]],
  ]);
  const { parts, k } = unitsOf(ing, [{ role: DIR_ROLE.PRODUCT, mesh: prod }]);
  const sum = parts.objects.reduce((s, o) => s + o.areaMm2, 0);
  rel(k.totalMm2, sum, 1e-12, '97-J：总截面积必须逐位等于 Σ 每个单元实测面积');
  // ⑤ 分组逻辑仍是 PHASE 96 那套（sameSpec / groupBySpec 未被替换）
  assert(k.groups.length === 2 && k.groups.every((g) => g.subtotalMm2 > 0),
    '97-J：规格分组仍然生效');
}

export const tests = [
  { name: '97-A 出品率：场景 78 → 78（来源生产场景）；无场景值不得凭空得到 68', fn: testA_yield },
  { name: '97-B 普通内浇口 20×5×30：方向由连接面给，有效截面 ≈100', fn: testB_normalIngate },
  { name: '★ 97-C 短宽内浇口 20×5×12：主轴约定会算成 60，连接面方向修正为 100', fn: testC_shortWide },
  { name: '97-D 三个相同内浇口：100×3 = 300，归成一个规格', fn: testD_threeSame },
  { name: '97-E 不同规格：100 + 150 = 250，分组不改变总面积', fn: testE_mixedSpec },
  { name: '97-F 无可靠连接 → 正确退回 PHASE 96 主轴 fallback（不整片失败）', fn: testF_fallback },
  { name: '97-G 两端连接 → CONFIRMED；两端方向不一致 → 降级 UNCERTAIN', fn: testG_bothEnds },
  { name: '97-H connectionArea ≠ effectiveArea（§九：面积必须是切出来的）', fn: testH_areaNotConnection },
  { name: '97-I 方向来源与"方向未确认"互斥', fn: testI_marksExclusive },
  { name: '97-J 架构纪律：不碰 engine、复用既有工具、总面积 = Σ', fn: testJ_architecture },
];
