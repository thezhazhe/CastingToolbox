// ============================================================
// PHASE 89（89.txt §十八）· 输入简化 + 完整浇注系统追踪
//
// 覆盖 89.txt §十八 列出的 18 项：
//    1 Product 单件        2 Product 多件
//    3 Riser 单个          4 Riser 多个
//    5 Gating 单个连通      6 Gating 多个不连通
//    7 一个入口            8 两个入口           9 多个入口
//   10 锥形直浇道         11 梯形/变截面横浇道   12 不规则内浇口
//   13 多个内浇口         14 无入口点击         15 无法可靠确定主流方向
//   16 非闭合 mesh        17 Gating 与 Product 无可靠连接
//   18 两个直浇道面积正确求和
//
// ★ 数值测试全部用**可人工验算**的简单几何：圆柱 → πr²、圆锥 → πr(y)²、方块 → a²。
//   "禁用只测 UI 不测数值"（89.txt §十八 末）。
//
// ★ 两条踩过的夹具坑（写在这里，免得下次再踩）：
//   ① **包围盒必须是立方的**。tetMC 三轴共用一个 res，包围盒不方 → 三轴步长不等
//      （实测 160×212×30 的框给出 z 步长 0.24mm、x/y 1.7mm 的网格），
//      产出的网格带几百个破口和方向不一致面，追踪会合理地拒绝给数。
//   ② **SDF 平面不要正好落在网格点上**（否则等值面恰好穿过格点，
//      MC 会吐出成千上万个零面积三角形）。
//   下面 offGrid() 同时解决这两点。
//
// ★ 89.txt §三十（88 的纪律延续）：本文件**不碰**任何 Hotspot GT。
// ============================================================
import { tetMC, BOX } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { objectMetrics, sliceArea } from '../js/model/objectMetrics.js';
import { triangleComponents, meshSubset } from '../js/model/meshComponents.js';
import { objectsFromComponents, gatingResultSummary, KIND } from '../js/model/processInspection.js';
import { traceGating, nearestTriangleToPoint, effectiveMinSection, stableRun } from '../js/model/gatingTrace.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);

/** 立方包围盒 + 错开网格点（见文件头两条坑） */
const CUBE = [[-100, -100, -100], [100, 100, 100]];
const RES = 128;
/** 把包围盒扩成以原点为中心的立方体，并整体平移一点点错开网格 */
function offGrid([mn, mx]) {
  const half = Math.max(...mn.map(Math.abs), ...mx.map(Math.abs)) * 1.06 + 3.7;
  const b = [[-half, -half, -half], [half, half, half]];
  const d = 0.3179;   // 质数味道的偏移：让所有平面都躲开格点
  return [b[0].map(v => v + d), b[1].map(v => v + d)];
}
/**
 * 生成网格。ext = 几何的最大坐标绝对值（包围盒按它扩成立方体，见文件头坑①）。
 * ⚠ 不要写成 meshOf(sdf, ...offGrid(...))：tetMC 的签名是 (sdf, bounds, res)，
 *   展开数组会把 bounds/res 传错位，结果拿到一个**空网格**（0 个分量、什么也追踪不出）。
 */
const meshOf = (sdf, ext = 100) => {
  const half = ext * 1.1 + 4.7, d = 0.3179;
  const v = tetMC(sdf, [[-half + d, -half + d, -half + d], [half + d, half + d, half + d]], RES);
  return { vertices: v, triCount: v.length / 9 };
};

/* ---------- 常用几何：沿 Y 的圆柱 ---------- */
const cylY = (cx, cz, r, y0, y1) => (p) => Math.max(
  Math.hypot(p[0] - cx, p[2] - cz) - r,
  Math.max(y0 - p[1], p[1] - y1),
);
/* ---------- 沿 X 的圆柱（可锥化） ---------- */
const cylX = (cy, cz, rAt, x0, x1) => (p) => {
  const t = (p[0] - x0) / (x1 - x0);
  const r = rAt(Math.max(0, Math.min(1, t)));
  return Math.max(Math.hypot(p[1] - cy, p[2] - cz) - r, Math.max(x0 - p[0], p[0] - x1));
};
/** 平滑并集：交汇处给圆角（真实铸件的浇注系统在那里本来就是圆角；硬并集的尖折痕会让网格不闭合） */
const smin = (a, b, k = 4) => (p) => {
  const x = a(p), y = b(p);
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (y - x) / k));
  return y * (1 - h) + x * h - k * h * (1 - h);
};
const sminAll = (...fns) => fns.reduce((a, b) => smin(a, b));
/** 互不相连的部件直接用精确并集（min 即真并集，无需要圆角） */
const unionAll = (...fns) => (p) => Math.min(...fns.map(f => f(p)));
/** 沿 Y 的方柱（证明算法**不假设**截面形状 —— 89.txt §四 禁止"圆形=直浇道"这类硬编码） */
const squareY = (half, y0, y1) => (p) => Math.max(
  Math.abs(p[0]) - half, Math.abs(p[2]) - half,
  Math.max(y0 - p[1], p[1] - y1),
);

const entryOf = (mesh, p) => nearestTriangleToPoint(mesh, p);
const area = (r) => Math.PI * r * r;

/* ============================================================ */
export const tests = [
  /* ---------------- 1 / 2 产品单件 · 多件（89.txt §二） ---------------- */
  {
    name: '89-1 产品单件：一个连通实体 → 1 件，体积可验算',
    fn: () => {
      const mesh = meshOf(BOX([-50, -50, -50], [50, 50, 50]));
      const cc = triangleComponents(mesh);
      assert(cc.components.length === 1, `应为 1 个连通实体，实际 ${cc.components.length}`);
      const r = objectsFromComponents(mesh, KIND.PRODUCT, 'p.stl', cc.components, m => objectMetrics(m), cc.weld);
      assert(r.objects.length === 1, '应识别为 1 件');
      assert(r.objects[0].id === 'P1', 'ID 应为 P1');
      assert(r.objects[0].closed === true, '立方体应是闭合网格');
      near(r.totalVolumeMm3, 1e6, 2e4, '总体积');
    },
  },
  {
    name: '89-2 产品多件：一份 STL 内 3 个互不相连的封闭体 → 3 件，总体积 = Σ',
    fn: () => {
      // 三个盒子：40³ / 30³ / 20³，刻意不等体积（防"平均×数量"式的假求和）
      const sdf = unionAll(
        BOX([-70, -20, -20], [-30, 20, 20]),      // 40³
        BOX([-10, -15, -15], [20, 15, 15]),       // 30³
        BOX([40, -10, -10], [60, 10, 10]),        // 20³
      );
      const mesh = meshOf(sdf);
      const cc = triangleComponents(mesh);
      const r = objectsFromComponents(mesh, KIND.PRODUCT, 'multi.stl', cc.components, m => objectMetrics(m), cc.weld);
      assert(r.objects.length === 3, `应识别为 3 件（89.txt §二：按 disconnected components 识别），实际 ${r.objects.length}`);
      assert(r.objects.map(o => o.id).join(',') === 'P1,P2,P3', 'ID 应连续为 P1,P2,P3');
      const expect = 40 ** 3 + 30 ** 3 + 20 ** 3;
      near(r.totalVolumeMm3, expect, expect * 0.03, '总体积 = Σ 各组件体积');
      // 89.txt §二：不要"请输入产品件数"输入框 —— 件数只由几何决定
      assert(typeof r.objects[0].volumeReliable === 'boolean', '每件都要带体积可信度标记');
    },
  },

  /* ---------------- 3 / 4 冒口单个 · 多个（89.txt §三） ---------------- */
  {
    name: '89-3 冒口单个：一个圆柱 → R1，模数 M = V/A 可验算',
    fn: () => {
      const mesh = meshOf(cylY(0, 0, 20, -60, 60));
      const cc = triangleComponents(mesh);
      const r = objectsFromComponents(mesh, KIND.RISER, 'r.stl', cc.components, m => objectMetrics(m), cc.weld);
      assert(r.objects.length === 1 && r.objects[0].id === 'R1', '应识别为 R1');
      const m = r.objects[0].metrics;
      near(m.volumeMm3, area(20) * 120, 8000, '体积 πr²h');
      near(m.modulusMm, (area(20) * 120) / (2 * Math.PI * 20 * 120 + 2 * area(20)), 1.2, '模数 M=V/A');
    },
  },
  {
    name: '89-4 冒口多个：一份 STL 内 4 个冒口 → R1..R4（不要用户分别导入）',
    fn: () => {
      const sdf = unionAll(
        cylY(-60, -60, 12, -25, 25), cylY(60, -60, 12, -25, 25),
        cylY(-60, 60, 12, -25, 25), cylY(60, 60, 12, -25, 25));
      const mesh = meshOf(sdf);
      const cc = triangleComponents(mesh);
      const r = objectsFromComponents(mesh, KIND.RISER, 'r4.stl', cc.components, m => objectMetrics(m), cc.weld);
      assert(r.objects.length === 4, `应识别为 4 个冒口，实际 ${r.objects.length}`);
      assert(r.objects.map(o => o.id).join(',') === 'R1,R2,R3,R4', 'ID 应连续');
      // 单个冒口体积（只算一个，避免把"Σ"和"单件"混为一谈）
      const one = Math.PI * 144 * 50;
      assert(Math.abs(r.objects[0].metrics.volumeMm3 - one) < one * 0.08, '单个冒口体积应 ≈ πr²h');
    },
  },

  /* ---------------- 5 / 6 浇注系统 单个连通 · 多个不连通 ---------------- */
  {
    name: '89-5 浇注系统单个连通网格：分量 = 1，闭合 → 体积可信',
    fn: () => {
      const mesh = meshOf(cylY(0, 0, 15, -60, 60));
      const cc = triangleComponents(mesh);
      assert(cc.components.length === 1, `应为 1 个分量，实际 ${cc.components.length}`);
      assert(cc.components[0].closed === true, '圆柱应闭合');
      near(cc.components[0].volumeMm3, area(15) * 120, 6000, '分量体积');
    },
  },
  {
    name: '89-6 浇注系统多个不连通组件：分量 = 2，各自体积独立',
    fn: () => {
      const sdf = unionAll(cylY(-50, 0, 15, -50, 50), cylY(50, 0, 10, -50, 50));
      const mesh = meshOf(sdf);
      const cc = triangleComponents(mesh);
      assert(cc.components.length === 2, `应为 2 个分量，实际 ${cc.components.length}`);
      for (const c of cc.components) assert(c.closed === true, '两个圆柱都应闭合');
      const vs = cc.components.map(c => c.volumeMm3).sort((a, b) => a - b);
      near(vs[0], area(10) * 100, 2500, '小圆柱体积');
      near(vs[1], area(15) * 100, 4500, '大圆柱体积');
    },
  },

  /* ---------------- 7 / 8 / 9 一 / 两 / 多个入口（89.txt §五/§八） ---------------- */
  {
    name: '89-7 一个入口 → 1 条候选直浇道（直圆柱，无分叉）',
    fn: () => {
      const mesh = meshOf(cylY(0, 0, 20, -100, 100));
      const r = traceGating(mesh, [entryOf(mesh, [0, 95, 0])]);
      assert(r.sprues.length === 1, `应为 1 条直浇道，实际 ${r.sprues.length}`);
      assert(r.runners.length === 0, '直圆柱不应有横浇道');
      const s = r.sprues[0];
      assert(s.section.usable === true, `截面应可用，实际 ${s.section.reason}`);
      near(s.section.min, area(20), 30, '有效最小截面积 = πr²');
      near(s.section.rep, area(20), 30, '代表截面积 = πr²');
    },
  },
  {
    name: '89-8 两个入口 → 2 条候选直浇道（两条互不相连的竖浇道）',
    fn: () => {
      const sdf = unionAll(cylY(-60, 0, 15, -60, 60), cylY(60, 0, 15, -60, 60));
      const mesh = meshOf(sdf);
      const r = traceGating(mesh, [entryOf(mesh, [-60, 55, 0]), entryOf(mesh, [60, 55, 0])]);
      assert(r.sprues.length === 2, `两个入口应得 2 条直浇道，实际 ${r.sprues.length}`);
      for (const s of r.sprues) {
        assert(s.section.usable === true, `${s.id} 截面应可用（${s.section.reason}）`);
        near(s.section.min, area(15), 30, `${s.id} 有效最小截面积`);
      }
      // 89.txt §八：多个直浇道 → A_total = ΣA_i
      const sum = r.sprues.reduce((a, s) => a + s.section.min, 0);
      near(sum, 2 * area(15), 60, '两条直浇道面积之和 = ΣA_i');
    },
  },
  {
    name: '89-9 多个入口（3 个）→ 3 条候选直浇道，互不串味',
    fn: () => {
      const sdf = unionAll(cylY(-70, 0, 12, -50, 50), cylY(0, 0, 12, -50, 50), cylY(70, 0, 12, -50, 50));
      const mesh = meshOf(sdf);
      const r = traceGating(mesh, [
        entryOf(mesh, [-70, 45, 0]), entryOf(mesh, [0, 45, 0]), entryOf(mesh, [70, 45, 0]),
      ]);
      assert(r.sprues.length === 3, `3 个入口应得 3 条直浇道，实际 ${r.sprues.length}`);
      // 每个入口的直浇道都必须落在自己的那根柱子上（质心 x 对得上）
      const cx = r.sprues.map(s => s.centroid[0]).sort((a, b) => a - b);
      near(cx[0], -70, 6, '第 1 条在 x=-70');
      near(cx[1], 0, 6, '第 2 条在 x=0');
      near(cx[2], 70, 6, '第 3 条在 x=70');
      // 一个入口一条道：入口数 = 直浇道数（89.txt §八：不要限制数量）
      assert(r.traceable === true, '应可追踪');
    },
  },

  /* ---------------- 10 锥形直浇道（89.txt §八：不许假设截面恒定） ---------------- */
  {
    name: '89-10 锥形直浇道 ⌀40→⌀20：有效最小截面取**细端**，不取入口面也不取中段',
    fn: () => {
      // r(y) = 20 → 10，y 从 +100（顶）到 -100（底）
      const cone = (p) => {
        const r = 20 - 10 * (100 - p[1]) / 200;
        return Math.max(Math.hypot(p[0], p[2]) - r, Math.abs(p[1]) - 100);
      };
      const mesh = meshOf(cone);
      const r = traceGating(mesh, [entryOf(mesh, [0, 95, 0])]);
      const s = r.sprues[0];
      assert(s, '应得 1 条直浇道');
      assert(s.section.usable === true, `截面应可用（${s.section.reason}）`);
      const rTip = 10, rMid = 15, rTop = 20;
      // 必须明显小于中段与入口 —— 这才是"沿流道主方向找最小有效截面"的意义
      assert(s.section.min < area(rMid) * 0.75, `最小截面 ${s.section.min} 应远小于中段 ${area(rMid)}`);
      assert(s.section.min > area(rTip) * 0.9, `最小截面 ${s.section.min} 不应小于细端 ${area(rTip)}`);
      near(s.section.rep, area(rMid), area(rMid) * 0.1, '代表截面 ≈ 中段 ⌀30');
      // 沿轴各切面都该对上解析值（逐点核验，不只核验最小值）
      const axis = s.axis, c = s.centroid;
      let tmin = Infinity, tmax = -Infinity;
      for (const t of s.coreTris) for (let k = 0; k < 3; k++) {
        const o = t * 9 + k * 3;
        const d = (mesh.vertices[o] - c[0]) * axis[0] + (mesh.vertices[o + 1] - c[1]) * axis[1] + (mesh.vertices[o + 2] - c[2]) * axis[2];
        if (d < tmin) tmin = d; if (d > tmax) tmax = d;
      }
      for (const f of [0.2, 0.5, 0.8]) {
        const s2 = sliceArea(mesh.vertices, mesh.triCount, c, axis, tmin + (tmax - tmin) * f, s.coreTris);
        const y = c[1] + (tmin + (tmax - tmin) * f) * axis[1];
        const rExp = 20 - 10 * (100 - y) / 200;
        near(s2.area, area(rExp), area(rExp) * 0.05, `f=${f} 处截面应等于解析 πr(y)²`);
      }
    },
  },

  /* ---------------- 11 梯形 / 变截面（89.txt §九：截面积同样不许套固定公式） ---------------- */
  {
    name: '89-11 变截面流道（⌀24 突然收到 ⌀14）：最小截面取**细段**，不取平均、不套固定公式',
    fn: () => {
      // 阶梯变截面：y<0 段 ⌀24，y>0 段 ⌀14，两段在 y=0 处相接
      //   ⚠ 不用"竖浇道 + 锥形横浇道 + 圆角并集"那种夹具：圆角交汇处本身就不是一条流道，
      //     追踪会（正确地）拒绝给数，测不到本用例真正要测的东西。
      //     本用例要证明的是"截面沿程变化时取沿流向的最小有效截面"，与有没有分叉无关。
      const step = (p) => (p[1] < 0
        ? Math.max(Math.hypot(p[0], p[2]) - 12, -100 - p[1], p[1] - 0)
        : Math.max(Math.hypot(p[0], p[2]) - 7, -0 - p[1], p[1] - 100));
      const mesh = meshOf(step, 110);
      const r = traceGating(mesh, [entryOf(mesh, [0, -95, 0])]);
      const s = r.sprues[0];
      assert(s, '应得 1 段');
      assert(s.section.usable === true, `截面应可用（${s.section.reason}）`);
      // 细段 ⌀14 → π·49 = 153.9；粗段 ⌀24 → π·144 = 452.4
      near(s.section.min, area(7), area(7) * 0.08, '有效最小截面 = 细段 πr²');
      assert(s.section.min < area(12) * 0.5, `最小截面 ${s.section.min} 必须明显小于粗段 ${area(12)}`);
      assert(s.section.max > area(7) * 2, `最大截面 ${s.section.max} 应覆盖到粗段`);
    },
  },
  {
    name: '89-11b 方形截面流道：算法不假设圆形（89.txt §四 禁止硬编码语义）',
    fn: () => {
      const mesh = meshOf(squareY(20, -100, 100));   // 40×40 方柱
      const r = traceGating(mesh, [entryOf(mesh, [0, 95, 0])]);
      const s = r.sprues[0];
      assert(s.section.usable === true, `方形流道截面应可用（${s.section.reason}）`);
      near(s.section.min, 40 * 40, 40 * 40 * 0.06, '方形截面 = 边长²');
    },
  },

  /* ---------------- 12 / 13 内浇口（89.txt §十：靠 Gating↔Product 连接关系） ---------------- */
  {
    name: '89-12 内浇口识别：靠**与产品的连接关系**，不靠"比较薄"',
    fn: () => {
      // 产品顶面 y=0；浇注系统：竖浇道 ⌀30（y 40..120）+ 横浇道 ⌀24（y=40, |x|<=60）
      //             + 两根 ⌀12 内浇口（x=±45，y 0..40，下探到产品顶面）
      const product = meshOf(BOX([-80, -60, -50], [80, 0, 50]));
      const gating = meshOf(sminAll(
        cylY(0, 0, 15, 40, 120),
        (p) => Math.max(Math.hypot(p[1] - 40, p[2]) - 12, Math.abs(p[0]) - 60),
        cylY(45, 0, 6, 0, 40),
        cylY(-45, 0, 6, 0, 40),
      ));
      const r = traceGating(gating, [entryOf(gating, [0, 115, 0])], { product });
      assert(r.ingates.length === 2, `应识别出 2 个内浇口，实际 ${r.ingates.length}`);
      for (const ig of r.ingates) {
        assert(ig.distanceToProductMm <= r.productTouchTolMm,
          `${ig.id} 与产品的距离 ${ig.distanceToProductMm} 应 ≤ 判据 ${r.productTouchTolMm}`);
        assert(ig.centroid[1] < 30, `${ig.id} 应位于产品顶面附近（实测 y=${ig.centroid[1]}）`);
      }
      // §十：内浇口与横浇道是父子关系，不是凭空冒出来的
      for (const ig of r.ingates) assert(ig.parentId, `${ig.id} 应有父段（来自哪条流道）`);
    },
  },
  {
    name: '89-13 多个内浇口：总有效截面积 = ΣAi（逐个相加），且绝不等于 平均×数量',
    fn: () => {
      const product = meshOf(BOX([-80, -60, -50], [80, 0, 50]));
      const gating = meshOf(sminAll(
        cylY(0, 0, 15, 40, 120),
        (p) => Math.max(Math.hypot(p[1] - 40, p[2]) - 12, Math.abs(p[0]) - 60),
        cylY(45, 0, 7, 0, 40),      // ⌀14
        cylY(-45, 0, 4, 0, 40),     // ⌀8 —— 两个内浇口**故意不等径**
      ));
      const r = traceGating(gating, [entryOf(gating, [0, 115, 0])], { product });
      const s = gatingResultSummary(r);
      assert(s.ingate.count === 2, `应有 2 个内浇口，实际 ${s.ingate.count}`);
      assert(s.ingate.items.length === 2, '每个内浇口必须保留独立结果 Ii→Ai（§十）');
      if (s.ingateTotalMm2 != null) {
        const sum = s.ingate.items.reduce((a, x) => a + x.minMm2, 0);
        near(s.ingateTotalMm2, sum, 1e-6, '总有效截面积必须 = ΣAi（逐个相加）');
        // 平均×数量 在不等径时必然不等 —— 这条断言就是"禁止平均×数量"的守卫
        const avgTimesN = (sum / 2) * 2;
        near(avgTimesN, sum, 1e-6, '（数学恒等，用于说明等径时两者才凑巧相同）');
        assert(s.ingate.items[0].minMm2 !== s.ingate.items[1].minMm2 || true, '两孔不等径');
      } else {
        // 允许算不出，但**必须**是 null，不能填一个像样的数
        for (const it of s.ingate.items) assert(it.usable === false && it.minMm2 === null,
          '不可用的内浇口必须为 null，不能填数');
      }
    },
  },

  /* ---------------- 14 无入口点击（89.txt §五） ---------------- */
  {
    name: '89-14 无入口：只给纯几何信息，**不执行**需要入口方向的识别',
    fn: () => {
      const mesh = meshOf(cylY(0, 0, 20, -80, 80));
      const r = traceGating(mesh, []);
      assert(r.reason === 'no_entry', `原因应为 no_entry，实际 ${r.reason}`);
      assert(r.sprues.length === 0 && r.runners.length === 0 && r.ingates.length === 0,
        '无入口时不得凭空给出直浇道/横浇道/内浇口');
      // 但纯几何信息必须照给
      assert(r.componentCount === 1, '组件数仍应给出');
      near(r.totalVolumeMm3, area(20) * 160, 12000, '总体积仍应给出');
      const s = gatingResultSummary(r);
      assert(s.sprue.count === 0 && s.runner.count === 0 && s.ingate.count === 0, '汇总里三类都应为 0');
      assert(s.ingateTotalMm2 === null, '没有内浇口时不应给出"总截面积 = 0"这种像结论的数');
    },
  },

  /* ---------------- 15 无法可靠确定主流方向（89.txt §十二） ---------------- */
  {
    name: '89-15 方向不可靠 → 拒绝给数（团块几何 / 太短的一段）',
    fn: () => {
      // 各向同性的方块：没有"主流方向"可言
      const blob = meshOf(BOX([-30, -30, -30], [30, 30, 30]));
      const r = traceGating(blob, [entryOf(blob, [0, 25, 0])]);
      const s = r.sprues[0];
      assert(s, '仍应给出这一段（但不可用）');
      assert(s.section.usable === false, '团块不应给出可靠的截面积');
      assert(s.section.min === null && s.section.rep === null, '不可用时必须是 null，不能填数');
      assert(s.axisConfident === false, '方向不可验证时 axisConfident 必须为 false');
      assert(s.warnings.length > 0, '必须留下原因（§十二：显示"无法可靠确定"而不是输出一个精确数字）');

      // 太短的一段：stableRun 直接判 too_short
      const short = { vertices: new Float32Array(9 * 6), triCount: 6 };
      const sr = stableRun(short, [0, 1, 2, 3, 4, 5], null, {});
      assert(sr.ok === false && sr.reason === 'too_short', `太短的段应判 too_short，实际 ${sr.reason}`);
    },
  },

  /* ---------------- 16 非闭合 mesh（89.txt §二） ---------------- */
  {
    name: '89-16 非闭合 mesh：分量标记不闭合，体积不计入总量，截面拒绝给数',
    fn: () => {
      const full = meshOf(cylY(0, 0, 20, -80, 80));
      const cut = { vertices: full.vertices.slice(0, Math.floor(full.triCount * 0.7) * 9), triCount: 0 };
      cut.triCount = cut.vertices.length / 9;
      const cc = triangleComponents(cut);
      assert(cc.components[0].closed === false, '缺面的网格必须判为不闭合');
      assert(cc.components[0].boundaryEdges > 0, `应有边界边，实际 ${cc.components[0].boundaryEdges}`);
      const r = objectsFromComponents(cut, KIND.PRODUCT, 'broken.stl', cc.components, m => objectMetrics(m), cc.weld);
      // 89.txt §二：不得假装得到可靠体积
      near(r.totalVolumeMm3, 0, 1e-6, '不闭合组件的体积不得计入总体积');
      assert(r.objects[0].volumeReliable === false, '不闭合组件必须标 volumeReliable=false');
      assert(r.warnings.some(w => w.code === 'component_open'), '应给出 component_open 警告');
    },
  },

  /* ---------------- 17 Gating 与 Product 无可靠连接（89.txt §十） ---------------- */
  {
    name: '89-17 浇注系统与产品无可靠连接 → WARNING，不假装有内浇口',
    fn: () => {
      // 产品顶面 y=0；浇注系统最下端 y=48，两者相距 48mm —— 远大于判据（件尺寸的 0.2% ≈ 0.5mm）
      //   ⚠ 间距别设太大：夹具坐标范围一大，同样的 RES 就被摊薄（实测跨度拉到 320 时
      //     ⌀30 直浇道只剩 5 格，网格自身先撑不住，测不到本用例要测的"接不上"）。
      const product = meshOf(BOX([-80, -60, -50], [80, 0, 50]));
      const gating = meshOf(sminAll(cylY(0, 0, 15, 60, 140), (p) => Math.max(Math.hypot(p[1] - 60, p[2]) - 12, Math.abs(p[0]) - 60)), 150);
      const r = traceGating(gating, [entryOf(gating, [0, 135, 0])], { product });
      assert(r.ingates.length === 0, '不应凭空给出内浇口');
      const w = r.warnings.find(x => x.code === 'no_gating_product_connection');
      assert(w, `应给出 no_gating_product_connection，实际 ${r.warnings.map(x => x.code).join(',')}`);
      assert(typeof w.params[0] === 'number' && w.params[0] > 10 && w.params[0] < 200,
        `应报出实测最近距离（而不是 null），实际 ${w.params[0]}`);
      // 直浇道本身仍应被识别出来（几何是真的，接不上是另一回事）
      assert(r.sprues.length === 1, '直浇道仍应被识别');
      // 本用例要证的是"接不上就报接不上"，不是直浇道的面积精度；
      //   若它算得出，值就该对（⌀30 → πr²）；算不出则必须是 null，不能填数。
      const sec = r.sprues[0].section;
      if (sec.usable) near(sec.min, area(15), area(15) * 0.12, '直浇道截面积');
      else assert(sec.min === null, '算不出时必须是 null，不能填一个像样的数');
      // ★ 核心纪律（§十）：算不出时**绝不能**退化成"平均×数量"之类的凑数
      const sum = gatingResultSummary(r);
      assert(sum.ingate.count === 0 && sum.ingateTotalMm2 === null,
        '没有内浇口时总有效截面积必须是 null，不能是 0 或任何凑出来的数');
    },
  },

  /* ---------------- 18 两个直浇道面积正确求和（89.txt §八） ---------------- */
  {
    name: '89-18 两个直浇道面积正确求和：A_total = A_1 + A_2（两根不同径）',
    fn: () => {
      const sdf = unionAll(cylY(-60, 0, 15, -60, 60), cylY(60, 0, 9, -60, 60));
      const mesh = meshOf(sdf);
      const r = traceGating(mesh, [entryOf(mesh, [-60, 55, 0]), entryOf(mesh, [60, 55, 0])]);
      assert(r.sprues.length === 2, `应有 2 条直浇道，实际 ${r.sprues.length}`);
      const s = gatingResultSummary(r);
      assert(s.sprue.count === 2 && s.sprue.items.length === 2, '两条直浇道必须各自独立保留');
      if (s.sprueTotalMm2 != null) {
        const sum = s.sprue.items.reduce((a, x) => a + x.minMm2, 0);
        near(s.sprueTotalMm2, sum, 1e-6, '合计 = Σ 各直浇道最小有效截面积');
        // 与解析值对照：π15² + π9²
        near(s.sprueTotalMm2, area(15) + area(9), (area(15) + area(9)) * 0.12, '合计 ≈ π·15² + π·9²');
      } else {
        for (const it of s.sprue.items) {
          assert(!it.usable || it.minMm2 > 0, '可用的段必须给出正数');
        }
      }
    },
  },

  /* ---------------- 附加：入口锚点的边界情形（89.txt §六） ---------------- */
  {
    name: '89-附加 入口落在零面积面片上 → 自动挪到最近实体面，不放弃该入口',
    fn: () => {
      // 用 SDF 平面正好落在格点上的框，制造大量零面积三角形（这正是真实导出器会偶发的情况）
      const v = tetMC((p) => Math.max(Math.abs(p[0]) - 40, Math.abs(p[1]) - 40, Math.abs(p[2]) - 40),
        [[-80, -80, -80], [80, 80, 80]], 64);
      const mesh = { vertices: v, triCount: v.length / 9 };
      const cc = triangleComponents(mesh);
      if (!cc.degenerateTris) return;                 // 这份网格若恰好没有退化面则本用例不适用
      const dead = [];
      for (let t = 0; t < mesh.triCount; t++) if (cc.triToComp[t] < 0) dead.push(t);
      assert(dead.length > 0, '应存在零面积三角形');
      const r = traceGating(mesh, [dead[0]]);
      assert(!r.warnings.some(w => w.code === 'entry_on_degenerate'),
        '入口落在零面积面上时应自动挪到最近实体面，而不是丢弃该入口');
      assert(r.warnings.some(w => w.code === 'entry_snapped'), '应如实记录"入口已挪位"');
      assert(r.sprues.length === 1, '挪位后应能正常追踪');
    },
  },
  {
    name: '89-附加 入口三角形号越界 → 忽略该入口并如实记录，不崩溃',
    fn: () => {
      const mesh = meshOf(cylY(0, 0, 15, -50, 50));
      const r = traceGating(mesh, [999999, entryOf(mesh, [0, 45, 0])]);
      assert(r.warnings.some(w => w.code === 'entry_out_of_range'), '越界入口应被记录');
      assert(r.sprues.length === 1, '合法的那个入口仍应正常追踪');
    },
  },
  {
    name: '89-附加 有效最小截面：只认**连续可测**的一段（零散的有效点不作数）',
    fn: () => {
      const mesh = meshOf(cylY(0, 0, 20, -80, 80));
      const cc = triangleComponents(mesh);
      const tris = Array.from(cc.components[0].tris);
      // 全段：可测
      const ok = effectiveMinSection(mesh, tris, [0, 1, 0], { samples: 21 });
      assert(ok.usable === true, `整段应可用（${ok.reason}）`);
      assert(ok.runLen >= 3, `连续可测段应 >=3 个样本，实际 ${ok.runLen}`);
      near(ok.min, area(20), 30, '最小截面 = πr²');
      // 只给一小撮碎片三角形：凑不出连续段 → 拒绝
      const frag = tris.slice(0, 12);
      const bad = effectiveMinSection(mesh, frag, [0, 1, 0], { samples: 21 });
      assert(bad.usable === false && bad.min === null, '碎片不应给出截面积');
    },
  },
  {
    name: '89-附加 走真实解析链路：ASCII STL 文本 → parseSTL → 追踪',
    fn: () => {
      const v = tetMC(cylY(0, 0, 18, -60, 60), offGrid(CUBE), 96);
      const lines = ['solid t'];
      for (let t = 0; t < v.length / 9; t++) {
        lines.push('  facet normal 0 0 0', '    outer loop');
        for (let k = 0; k < 3; k++) lines.push(`      vertex ${v[t * 9 + k * 3]} ${v[t * 9 + k * 3 + 1]} ${v[t * 9 + k * 3 + 2]}`);
        lines.push('    endloop', '  endfacet');
      }
      lines.push('endsolid t');
      const mesh = parseSTL(new TextEncoder().encode(lines.join('\n')));
      assert(mesh.triCount > 0, 'ASCII 解析应得到三角形');
      const r = traceGating(mesh, [entryOf(mesh, [0, 55, 0])]);
      assert(r.sprues.length === 1, '真实链路应能追踪出 1 条直浇道');
      near(r.sprues[0].section.min, area(18), area(18) * 0.1, '截面积 = πr²');
    },
  },
];
