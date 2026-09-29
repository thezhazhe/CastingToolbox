// ============================================================
// PHASE 90 测试（90.txt §十八：**几何真值测试**，不是"代码跑没跑起来"）
//
// 每个用例都给**解析值**：圆的 πr²、方的 a²、椭圆的 πab、阶梯管的两个面积。
// 容差按实测定的：圆形截面 ~1%，方形/椭圆形 <1%。
//
// ★ 三条踩过的夹具坑（写在这里，免得下次再踩）：
//   ① **包围盒必须是立方的**。tetMC 三轴共用一个 res，包围盒不方 → 三轴步长不等，
//      产出的网格带几百个破口和方向不一致面。
//   ② **SDF 平面不要正好落在网格点上**（否则等值面恰好穿过格点，MC 会吐出成千上万个
//      零面积三角形）。下面的 G 常量就是干这个的。
//   ③ 不要写成 meshOf(sdf, ...bounds)：tetMC 的签名是 (sdf, bounds, res)，
//      展开数组会把 bounds/res 传错位，结果拿到一个**空网格**。
//
// ★ 产品夹具统一是 100×20×100 的方板，上表面 y=10 —— 平面是精确的，与产品网格分辨率无关，
//   所以产品用 res=64 就够了（135k 面 → 11k 面，测试快 4 倍，连接判定结果不变）。
// ============================================================
import { tetMC, genSTL } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { triangleComponents, meshSubset } from '../js/model/meshComponents.js';
import {
  findConnections, traceFlow, detectAreaChanges, flowDiagnostics, flowSummary,
  FLOW_LABEL, FLOW_REASON, SAMPLE_REASON, FLOW_CONFIG,
} from '../js/model/flowTrace.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);
const rel = (a, b, frac, m) => assert(Math.abs(a - b) <= Math.abs(b) * frac, `${m}（实际 ${a}，期望 ${b}±${(frac * 100).toFixed(1)}%）`);

const G = 0.3179;                       // 躲开网格点的相位偏移（坑②）
const RES = 128;

/** 隐式曲面 → 非索引三角汤；立方体包围盒（坑①），带相位偏移（坑②） */
const meshOf = (sdf, ext = 100, res = RES) => {
  const half = ext * 1.1 + 4.7;
  const v = tetMC(sdf, [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]], res);
  return { vertices: v, triCount: v.length / 9 };
};

/* ---------- SDF 基元（stlGen 的 CYL_Y 只能建以 y=0 为中心的柱，这里需要任意 y0..y1） ---------- */
const box = (mn, mx) => ([x, y, z]) => {
  const dx = Math.max(mn[0] - x, x - mx[0]), dy = Math.max(mn[1] - y, y - mx[1]), dz = Math.max(mn[2] - z, z - mx[2]);
  return Math.min(Math.max(dx, dy, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
};
const cylY = (cx, cz, r, y0, y1) => ([x, y, z]) => {
  const dxy = Math.hypot(x - cx, z - cz) - r;
  const dy = Math.max(y0 - y, y - y1);
  return Math.min(Math.max(dxy, dy), 0) + Math.hypot(Math.max(dxy, 0), Math.max(dy, 0));
};
const cylX = (cy, cz, r, x0, x1) => ([x, y, z]) => {
  const dyz = Math.hypot(y - cy, z - cz) - r;
  const dx = Math.max(x0 - x, x - x1);
  return Math.min(Math.max(dyz, dx), 0) + Math.hypot(Math.max(dyz, 0), Math.max(dx, 0));
};
const boxDuct = (cx, cz, hx, hz, y0, y1) => ([x, y, z]) => {
  const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
  const dxy = Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
  const dy = Math.max(y0 - y, y - y1);
  return Math.min(Math.max(dxy, dy), 0) + Math.hypot(Math.max(dxy, 0), Math.max(dy, 0));
};
/** 胶囊（任意两点之间的圆柱 + 两端半球）—— 造斜流道用 */
const caps = (a, b, r) => ([x, y, z]) => {
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - r;
};
const ellipY = (cx, cz, a, b, y0, y1) => ([x, y, z]) => {
  const k = Math.min(a, b);
  const dxy = (Math.hypot((x - cx) / a, (z - cz) / b) - 1) * k;
  const dy = Math.max(y0 - y, y - y1);
  return Math.min(Math.max(dxy, dy), 0) + Math.hypot(Math.max(dxy, 0), Math.max(dy, 0));
};
const A = (r) => Math.PI * r * r;

/* ---------- 共用产品（只建一次，别在每个用例里重建） ---------- */
const PROD_EXT = 60, PROD_RES = 64;
let _prod = null, _prodCc = null;
const product = () => {
  if (!_prod) { _prod = meshOf(box([-50, -10, -50], [50, 10, 50]), PROD_EXT, PROD_RES); _prodCc = triangleComponents(_prod); }
  return _prod;
};

/** 建浇注系统 + 跑完连接检测与追踪，返回全套中间量（多数用例都用这一套） */
const pipeline = (sdf, ext, opts = {}) => {
  const g = meshOf(sdf, ext);
  const cc = triangleComponents(g);
  const conn = findConnections(product(), g, cc, opts);
  const tree = traceFlow(g, cc, conn.connections, opts);
  return { g, cc, conn, tree };
};

/**
 * 一个典型用例的实际数值（写在注释里当备忘）：
 *   ⌀20 直管   → 最小 311.8（解析 314.16，−0.75%）
 *   40×40 方管 → 1598.6（解析 1600，−0.09%）
 *   2a=40/2b=20 椭圆 → 625.6（解析 628.3，−0.43%）
 */
const CYL20 = A(10);

export const tests = [
  /* ============ Case A：单直管（§十八 A） ============ */
  {
    name: '90-A 单直管：1 个连接 / 1 条流道 / 无分叉 / 截面积稳定',
    fn: () => {
      const { conn, tree } = pipeline(cylY(0, 0, 10, 10, 100), 110);
      assert(conn.connections.length === 1, `应识别 1 个产品连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 1, `应是 1 条流道（无分叉），实际 ${tree.segments.length}`);
      const s = tree.segments[0];
      assert(s.depth === 0 && s.parentId === null, '根段应无父段');
      assert(s.branchKind === null, '单直管不应报出分叉');
      assert(s.usable, '应可用');
      assert(s.validCount >= 8, `有效样本应足够多，实际 ${s.validCount}`);

      // 用 headline 统计（已排除端面那一刀）判稳定性；序列里仍保留端面值，见 90-K
      const spread = (s.areaMax - s.areaMin) / CYL20;
      assert(spread < 0.05, `截面积应基本稳定，实测波动 ${(spread * 100).toFixed(1)}%`);
    },
  },
  {
    name: '90-A2 单直管的截面积对得上解析值 πr²（不是"量出来差不多"）',
    fn: () => {
      const { tree } = pipeline(cylY(0, 0, 10, 10, 100), 110);
      const s = tree.segments[0];
      rel(s.areaMin, CYL20, 0.02, '最小测得截面积');
      rel(s.areaMax, CYL20, 0.02, '最大测得截面积');
      assert(s.areaMinAt > 0 && s.areaMinAt < s.lengthMm + 1, `最小位置应在流道范围内，实际 ${s.areaMinAt} / 段长 ${s.lengthMm}`);
      assert(Array.isArray(s.minPoint) && s.minPoint.length === 3, '最小位置要能给 3D 坐标');
    },
  },

  /* ============ Case B：大小两段管（§十八 B） ============ */
  {
    name: '90-B 大小两段管：1 个连接 / 截面积出现明显变化且位置对得上',
    fn: () => {
      const { conn, tree } = pipeline((p) => Math.min(cylY(0, 0, 10, 10, 50)(p), cylY(0, 0, 15, 50, 90)(p)), 110);
      assert(conn.connections.length === 1, `应 1 个连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 1, `变径不是分叉，应是 1 条流道，实际 ${tree.segments.length}`);
      const s = tree.segments[0];

      rel(s.areaMin, A(10), 0.03, '细段截面积');
      rel(s.areaMax, A(15), 0.03, '粗段截面积');

      // 突变：细 314 → 粗 707，比值 ≈ 2.25
      assert(s.jumps.length === 1, `应检出 1 处截面积突变，实际 ${s.jumps.length}`);
      const j = s.jumps[0];
      assert(j.dir === 'up', `应是扩张，实际 ${j.dir}`);
      assert(j.ratio > 2 && j.ratio < 2.6, `突变比值应≈2.25，实际 ${j.ratio}`);
      // 变径面在 y=50；路径从连接形心（y≈10）出发 → 突变位置应落在 40mm 附近（步长 ~7mm，容差放宽到 ±10）
      near(j.at, 40, 10, '突变位置应落在变径面附近');
    },
  },
  {
    name: '90-B2 突变检测：对合成序列直接测，连续几个点才算数、单点噪声不算',
    fn: () => {
      const mk = (areas) => areas.map((a, i) => ({ index: i, distance: i, area: a, valid: true }));
      const j1 = detectAreaChanges(mk([100, 100, 100, 100, 300, 300, 300, 300]));
      assert(j1.length === 1, `应检出 1 处突变，实际 ${j1.length}`);
      assert(j1[0].dir === 'up', '应为扩张');
      const j2 = detectAreaChanges(mk([100, 100, 100, 100, 100, 100, 100, 100]));
      assert(j2.length === 0, '平稳序列不应报突变');
      const j3 = detectAreaChanges(mk([100, 100, 100, 900, 100, 100, 100, 100]));
      assert(j3.length === 0, '单个噪声点不应触发突变（这正是"连续几个点"的意义）');
      const j4 = detectAreaChanges(mk([900, 900, 900, 900, 100, 100, 100, 100]));
      assert(j4.length === 1 && j4[0].dir === 'down', '收缩也应检出');
    },
  },

  /* ============ Case C：T 型流道（§十八 C） ============ */
  {
    name: '90-C T 型流道：1 个连接 / 1 个分叉 / 2 条支路',
    fn: () => {
      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(0, 0, 10, 10, 45)(p), cylX(45, 0, 10, -50, 50)(p)), 110);
      assert(conn.connections.length === 1, `应 1 个连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 3, `应是主干 + 2 条支路 = 3 段，实际 ${tree.segments.length}`);
      const root = tree.segments.find((s) => s.depth === 0);
      assert(root.childIds.length === 2, `主干应有 2 个子段，实际 ${root.childIds.length}`);
      assert(root.branchKind === 'junction', `应记为交汇处分叉，实际 ${root.branchKind}`);
      assert(root.endReason === FLOW_REASON.BRANCHED, `分叉是正常结束，不该记成失败，实际 ${root.endReason}`);

      const kids = tree.segments.filter((s) => s.depth === 1);
      assert(kids.length === 2, '应有 2 条支路');
      const diag = flowDiagnostics(tree);
      assert(diag.branchCount === 1, `诊断里的分叉数应为 1，实际 ${diag.branchCount}`);
      assert(diag.flowPathCount === 1, `起始通道应为 1，实际 ${diag.flowPathCount}`);
      assert(diag.connectionCount === 1, '连接数应为 1');
    },
  },
  {
    name: '90-C2 T 型支路的走向是横向 ±，不是继续沿原方向（否则只是"穿过去了"）',
    fn: () => {
      const { tree } = pipeline(
        (p) => Math.min(cylY(0, 0, 10, 10, 45)(p), cylX(45, 0, 10, -50, 50)(p)), 110);
      const kids = tree.segments.filter((s) => s.depth === 1);
      const ends = kids.map((s) => s.path[s.path.length - 1]);
      // 竖管沿 +Y，横杆沿 ±X：支路终点应在 x 方向拉开，而不是继续往 +y 跑
      const xs = ends.map((e) => e[0]).sort((a, b) => a - b);
      assert(xs[0] < -30 && xs[1] > 30, `两条支路应向 ±x 分开，实际终点 x = ${xs.map((v) => v.toFixed(1))}`);
      for (const e of ends) assert(Math.abs(e[1] - 45) < 8, `支路应停在横杆轴线上（y≈45），实际 y=${e[1].toFixed(1)}`);
      // 支路面积应回到 ⌀20（与主干同径）
      for (const s of kids) rel(s.areaMin, CYL20, 0.04, '支路截面积');
      // 两条支路各自独立：路径不重合
      const d = Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1], ends[0][2] - ends[1][2]);
      assert(d > 60, `两条支路应朝相反方向走，终点间距实际只有 ${d.toFixed(1)}mm`);
    },
  },

  {
    name: '90-C3 Y 型分叉（§十 判据①：闭合环 1 → 2）：主干 + 两条斜臂',
    fn: () => {
      // 竖管 ⌀20 从产品起，y=45 处分成两条 45° 斜臂（各 ⌀16）
      const { conn, tree } = pipeline((p) => Math.min(
        cylY(0, 0, 10, 10, 45)(p),
        caps([0, 45, 0], [45, 90, 0], 8)(p),
        caps([0, 45, 0], [-45, 90, 0], 8)(p),
      ), 105);
      assert(conn.connections.length === 1, `应 1 个连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 3, `应主干 + 2 条斜臂 = 3 段，实际 ${tree.segments.length}`);
      const root = tree.segments.find((s) => s.depth === 0);
      assert(root.childIds.length === 2, `主干应有 2 个子段，实际 ${root.childIds.length}`);
      rel(root.areaMin, A(10), 0.03, '主干截面积');

      const arms = tree.segments.filter((s) => s.depth === 1);
      for (const s of arms) {
        // 斜臂的截面实测值：沿程 ~199（解析 201）；末端圆头那几刀会偏小，故看序列中位而不是最小值
        const mid = s.series.slice(1, Math.max(2, s.series.length - 2)).sort((a, b) => a - b);
        rel(mid[mid.length >> 1], A(8), 0.06, '斜臂沿程截面积');
        assert(s.areaMin >= A(8) * 0.75, `最小测得值不该被端面拉得太低，实际 ${s.areaMin}`);
      }
      // 两条斜臂朝相反方向走
      const ends = arms.map((s) => s.path[s.path.length - 1]);
      assert(ends[0][0] * ends[1][0] < 0, `两条斜臂应朝 ±x 分开，实际 ${ends.map((e) => e[0].toFixed(1))}`);
      assert(flowDiagnostics(tree).branchCount === 1, '诊断里的分叉数应为 1');
    },
  },

  {
    name: '90-C4 并排两条互不相干的流道：切面顺带切到另一条**不得**误判成分叉（实测踩过的坑）',
    fn: () => {
      // 两根 ⌀16 竖管相距 90mm，中间没有任何连接。
      // 追踪其中一根时，切面会同时切到另一根 → 出现 2 个闭合环。
      // 早先的判据只看"环数 1 → 2"，于是把它误判成了分叉
      // （`isFork` 的上界就是这么加上去的：(8+8)×2 = 32mm << 90mm）。
      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(-45, 0, 8, 10, 90)(p), cylY(45, 0, 8, 10, 90)(p)), 105);
      assert(conn.connections.length === 2, `应 2 个连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 2, `应 2 条互不相干的流道，实际 ${tree.segments.length}`);
      const d = flowDiagnostics(tree);
      assert(d.branchCount === 0, `并排两条流道之间没有分叉，实际报了 ${d.branchCount} 个`);
      for (const s of tree.segments) {
        assert(s.childIds.length === 0, `${s.id} 不该有子段`);
        assert(s.branchKind === null, `${s.id} 不该报分叉`);
        rel(s.areaMin, A(8), 0.03, '各自量到的截面积');
      }
    },
  },

  /* ============ Case D：多个产品连接（§十八 D） ============ */
  {
    name: '90-D 多个产品连接：N 个连接各自独立追踪，互不串味',
    fn: () => {
      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(-30, 0, 8, 10, 80)(p), cylY(30, 0, 8, 10, 80)(p)), 110);
      assert(conn.connections.length === 2, `应识别 2 个产品连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 2, `应 2 条流道，实际 ${tree.segments.length}`);
      const [a, b] = tree.segments;
      assert(a.connectionId !== b.connectionId, '两条流道应挂在不同的连接上');

      // 各自量到的截面应对应自己那根管子（都在 x=−30 / +30 附近）
      for (const s of tree.segments) {
        rel(s.areaMin, A(8), 0.03, '支管截面积');
        const cx = s.path.reduce((n, p) => n + p[0], 0) / s.path.length;
        assert(Math.abs(Math.abs(cx) - 30) < 3, `流道应停在自己那根管子的轴线上（|x|≈30），实际 ${cx.toFixed(1)}`);
      }
      // 互不串味：两条路径分别在 x<0 和 x>0 两侧
      const xa = a.path[0][0], xb = b.path[0][0];
      assert(xa * xb < 0 && Math.abs(xa - xb) > 50, `两条流道不应互相串（起点 x = ${xa.toFixed(1)}, ${xb.toFixed(1)}）`);
    },
  },

  /* ============ Case E：不同截面（§十八 E） ============ */
  {
    name: '90-E1 矩形截面：面积 = 长×宽（证明算法不假设圆形）',
    fn: () => {
      const { tree } = pipeline(boxDuct(0, 0, 20, 20, 10, 90), 110);
      const s = tree.segments[0];
      rel(s.areaMin, 40 * 40, 0.02, '方形截面面积');
      rel(s.areaMax, 40 * 40, 0.02, '方形截面最大面积');
    },
  },
  {
    name: '90-E2 椭圆截面：面积 = πab',
    fn: () => {
      const { tree } = pipeline(ellipY(0, 0, 20, 10, 10, 90), 110);
      const s = tree.segments[0];
      rel(s.areaMin, Math.PI * 20 * 10, 0.03, '椭圆截面面积');
    },
  },
  {
    name: '90-E3 圆 / 矩 / 椭三种截面走同一套代码，结果都对（无形状分支）',
    fn: () => {
      const cases = [
        { sdf: cylY(0, 0, 10, 10, 90), want: A(10), tag: '圆 ⌀20' },
        { sdf: boxDuct(0, 0, 15, 25, 10, 90), want: 30 * 50, tag: '矩 30×50' },
        { sdf: ellipY(0, 0, 15, 9, 10, 90), want: Math.PI * 15 * 9, tag: '椭 30×18' },
      ];
      const got = [];
      for (const c of cases) {
        const { tree } = pipeline(c.sdf, 110);
        assert(tree.segments.length === 1, `${c.tag} 应量出 1 条流道`);
        const a = tree.segments[0].areaMin;
        rel(a, c.want, 0.03, `${c.tag} 截面积`);
        got.push(a);
      }
      assert(got.length === 3, '三种截面都应量出来');
    },
  },

  /* ============ 边界 ============ */
  {
    name: '90-F 无连接：浇注系统悬空不与产品接触 → 如实报 no_connection，不硬编一个口',
    fn: () => {
      const { conn, tree } = pipeline(cylY(0, 0, 10, 30, 100), 110);   // 整根悬在产品上方 20mm
      assert(conn.connections.length === 0, `不该凭空造出连接，实际 ${conn.connections.length}`);
      assert(conn.warnings.some((w) => w.code === 'no_connection'), '应给出 no_connection');
      assert(tree.segments.length === 0, '没有连接就没有流道');
      assert(tree.reason === FLOW_REASON.NO_CONNECTION, `reason 应为 no_connection，实际 ${tree.reason}`);
      assert(conn.tol > 0 && conn.tol <= FLOW_CONFIG.tolMaxMm, 'tol 应被如实报出且不超过上限');
    },
  },
  {
    name: '90-G 近接判据：间隙大于 tol 不算连接；放宽后算，但必须**如实报出放宽过**',
    fn: () => {
      // 间隙 2mm，tol≈0.57、放宽后≈1.14 → 都够不着
      const far = pipeline(cylY(0, 0, 10, 12, 100), 110);
      assert(far.conn.connections.length === 0, '2mm 间隙不该算连接');
      assert(!far.conn.relaxed, '没放宽就不该说放宽了');

      // 间隙 0.8mm：主判据 0.57 够不着，放宽到 1.14 够得着 → 必须报 relaxed
      const nearGap = pipeline(cylY(0, 0, 10, 10.8, 100), 110);
      assert(nearGap.conn.connections.length === 1, `0.8mm 间隙应放宽后判为连接，实际 ${nearGap.conn.connections.length}`);
      assert(nearGap.conn.relaxed === true, '放宽过就必须报出来（§四：不许偷偷用过大 tolerance）');
      assert(nearGap.conn.tolUsed > nearGap.conn.tol, 'tolUsed 应反映实际用的放宽值');
      assert(nearGap.conn.warnings.some((w) => w.code === 'tol_relaxed'), 'warnings 里要有 tol_relaxed');
    },
  },
  {
    name: '90-H 非闭合 mesh：分量如实标记不闭合，不假装体积可信',
    fn: () => {
      const g = meshOf(cylY(0, 0, 10, 10, 100), 110);
      // 抠掉一批面，制造破口（真实导出器会偶发）
      const keep = [];
      for (let t = 0; t < g.triCount; t += 13) keep.push(t);
      const broken = meshSubset(g, keep);
      const cc = triangleComponents(broken);
      const openCount = cc.components.filter((c) => !c.closed).length;
      assert(openCount > 0, '抠掉面之后应当有分量被判为不闭合');
      // 不闭合的分量不该给出"体积可信"的结论
      for (const c of cc.components) {
        if (!c.closed) assert(c.boundaryEdges > 0, '不闭合就必须有边界边，不能自相矛盾');
      }
    },
  },
  {
    name: '90-I 有效采样率：允许少量 invalid，但不该整段报废（§七/§八）',
    fn: () => {
      const { tree } = pipeline(cylY(0, 0, 10, 10, 100), 110);
      const s = tree.segments[0];
      assert(s.sampleCount === s.validCount + s.invalidCount, '有效+无效必须等于总数');
      assert(s.validRate >= 0.6, `有效采样率不该太低，实际 ${s.validRate}`);
      // 无效样本必须带上原因，不能是空字符串（否则用户不知道为什么少了一刀）
      const bad = s.samples.filter((x) => !x.valid);
      for (const b of bad) assert(b.reason && b.reason !== SAMPLE_REASON.NONE, `无效样本必须有原因，实际 "${b.reason}"`);
      for (const b of bad) assert(b.area === null, '无效样本的截面积必须是 null，不能填数');
    },
  },
  {
    name: '90-J 有效数据不足 → 说"截面积不足以计算"，但仍然把量到的数如实给出',
    fn: () => {
      const { tree } = pipeline(cylY(0, 0, 10, 10, 100), 110, { maxSteps: 1 });
      const s = tree.segments[0];
      assert(s.validCount < FLOW_CONFIG.minValidSamples, `样本应不足，实际 ${s.validCount}`);
      assert(s.usable === false, '样本不足时 usable 必须是 false');
      assert(s.reason === FLOW_REASON.INSUFFICIENT_SAMPLES, `reason 应为 insufficient_samples，实际 ${s.reason}`);
      assert(s.endReason === FLOW_REASON.MAX_STEPS, '应如实说明是步数用尽');
      // §八：不轻易说"无法可靠计算"，量到的数照样给
      if (s.areaMin != null) assert(s.areaMin > 0, '量到的面积应如实保留');
    },
  },
  {
    name: '90-K 端面伪影：流道到头时最后一刀不计入最小/最大值，但序列里保留并标注',
    fn: () => {
      const { tree } = pipeline(cylY(0, 0, 10, 10, 100), 110);
      const s = tree.segments[0];
      rel(s.areaMin, CYL20, 0.02, '最小面积不该被端面倒角拉低');
      // PHASE 92 把这条规则从"**只标最后一刀**"推广到"**面积连续下降的收尾段**"：
      //   圆头 / 半球端盖会被连续几刀切出越来越小的环，只摘最后一刀是不够的
      //   —— 实测一个 ⌀16 的圆头端给出 199 → 143 → 78 → 13.6，只摘 13.6 的话
      //   "最小截面积"变成 78.3（真值 201），而且过不过关还取决于采样相位。
      // 断言的实质**变强了**：不再是"恰好一个"，而是"必须构成末尾连续的一段"。
      const term = s.samples.filter((x) => x.terminal);
      assert(term.length >= 1, '端面样本应被标注');
      const valid = s.samples.filter((x) => x.valid);
      assert(valid[valid.length - 1].terminal === true, '最后一刀有效样本必须被标为端面');
      const firstTerm = s.samples.findIndex((x) => x.terminal);
      assert(s.samples.slice(firstTerm).every((x) => x.terminal || !x.valid),
        '被标为端面的样本必须构成**末尾连续的一段**（中间不能夹着正常样本）');
      assert(term.every((x) => x.valid && x.area != null), '端面刀仍然如实记着数（不掩盖）');
      for (const t of term) assert(s.series.includes(t.area), '端面刀必须仍在序列里，只是不进 headline');
    },
  },
  {
    name: '90-L 诊断数据齐全（§十七：能直接看出"程序到底看到了什么"）',
    fn: () => {
      const { tree, conn } = pipeline(
        (p) => Math.min(cylY(0, 0, 10, 10, 45)(p), cylX(45, 0, 10, -50, 50)(p)), 110);
      const d = flowDiagnostics(tree);
      for (const k of ['connectionCount', 'flowPathCount', 'branchCount', 'segmentCount',
        'sampleCount', 'validSampleCount', 'invalidSampleCount', 'minimumAreaMm2', 'maximumAreaMm2']) {
        assert(d[k] != null, `诊断缺少 ${k}`);
      }
      assert(Array.isArray(d.areaChangeLocations), '诊断要给出面积突变位置列表');
      assert(d.sampleCount === d.validSampleCount + d.invalidSampleCount, '有效+无效必须对得上');
      assert(d.minimumAreaMm2 <= d.maximumAreaMm2, '最小不该大于最大');
      assert(d.segments.length === d.segmentCount, '逐段诊断应齐全');

      // §十七 还要求报出 Product↔Gating tolerance
      assert(conn.tol > 0, '必须报出 tolerance');
      assert(conn.tol <= FLOW_CONFIG.tolMaxMm, 'tolerance 有上限');

      const sum = flowSummary(tree);
      assert(sum.connectionCount === 1 && sum.startPaths === 1 && sum.branchCount === 1,
        `汇总应为 1 连接 / 1 起始通道 / 1 分叉，实际 ${sum.connectionCount}/${sum.startPaths}/${sum.branchCount}`);
      assert(sum.perConnection.length === 1 && sum.perConnection[0].sampleCount > 0, '逐连接汇总要有数据');
    },
  },
  {
    name: '90-M 工程语义只做辅助解释：几何不支持时写"几何通道"，不强行命名（§十二）',
    fn: () => {
      // 单直管 → 没有可对照的上游结构 → 一律"几何通道"
      const one = pipeline(cylY(0, 0, 10, 10, 100), 110).tree;
      assert(one.segments.every((s) => s.label === FLOW_LABEL.CHANNEL),
        `单直管不该硬贴内浇口/横浇道标签，实际 ${one.segments.map((s) => s.label)}`);

      // T 型 → 有结构：挨着产品的干段 = 内浇口区域，其余不硬命名
      const t = pipeline((p) => Math.min(cylY(0, 0, 10, 10, 45)(p), cylX(45, 0, 10, -50, 50)(p)), 110).tree;
      const root = t.segments.find((s) => s.depth === 0);
      assert(root.label === FLOW_LABEL.INGATE, `挨着产品的那一段应标"内浇口区域"，实际 ${root.label}`);
      for (const s of t.segments) {
        assert(Object.values(FLOW_LABEL).includes(s.label), `标签必须是已知值，实际 ${s.label}`);
      }
    },
  },
  {
    name: '90-N 空输入 / 异常输入：如实报，不抛异常',
    fn: () => {
      const g = meshOf(cylY(0, 0, 10, 10, 60), 80);
      const cc = triangleComponents(g);

      const noProd = findConnections(null, g, cc, {});
      assert(noProd.connections.length === 0 && noProd.warnings.some((w) => w.code === 'no_product'), '没有产品要如实报');

      const noGating = findConnections(product(), null, null, {});
      assert(noGating.connections.length === 0 && noGating.warnings.some((w) => w.code === 'no_gating'), '没有浇注系统要如实报');

      const empty = { vertices: new Float32Array(0), triCount: 0 };
      const emptyCc = triangleComponents(empty);
      const r = findConnections(product(), empty, emptyCc, {});
      assert(r.connections.length === 0, '空网格不该造出连接');

      const t = traceFlow(g, cc, [], {});
      assert(t.segments.length === 0 && t.ok === false, '没有连接就没有流道');
      assert(t.reason === FLOW_REASON.NO_CONNECTION, `实际 ${t.reason}`);

      const d = flowDiagnostics(traceFlow(g, cc, [], {}));
      assert(d.connectionCount === 0 && d.sampleCount === 0, '空树的诊断不该有数据');
      assert(d.minimumAreaMm2 === null && d.maximumAreaMm2 === null, '没数据时必须给 null，不能填 0 冒充结论');
    },
  },
  {
    name: '90-O 走真实解析链路：ASCII STL 文本 → parseSTL → 连接检测 → 追踪',
    fn: () => {
      const half = 110 * 1.1 + 4.7;
      const b = [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]];
      const ascii = genSTL(cylY(0, 0, 10, 10, 100), b, 128);
      // parseSTL 吃的是字节（Uint8Array / ArrayBuffer），不是字符串
      const parsed = parseSTL(new TextEncoder().encode(ascii));
      assert(parsed.triCount > 0, '应解析出三角形');
      const cc = triangleComponents(parsed);
      assert(cc.components.length === 1, `应是 1 个连通实体，实际 ${cc.components.length}`);

      const conn = findConnections(product(), parsed, cc, {});
      assert(conn.connections.length === 1, `应识别 1 个连接，实际 ${conn.connections.length}`);
      const tree = traceFlow(parsed, cc, conn.connections, {});
      assert(tree.segments.length === 1, '应是 1 条流道');
      rel(tree.segments[0].areaMin, CYL20, 0.03, '走完整解析链路后的截面积');
    },
  },
];
