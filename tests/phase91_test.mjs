// ============================================================
// PHASE 91 测试（91.txt §24：先建最小人工测试几何，再谈复杂工业 STL）
//
// 本阶段只有两个目标（91.txt §1）：
//   A. 工艺检验中心作为独立模块重构（UI 部分见 scripts/browser_inspection_test.mjs）
//   B. **对完整 Gating System STL，沿每一条实际流道路径，得到局部有效横截面积 A(s)**
// 本文件测的就是 B —— 而且测的是**几何真值**，不是"代码跑没跑起来"：
//   圆的 πr²、方管的 a²、45° 斜管的 πr²（不是 πr²/cos45）。
//
// ★ 本阶段的核心问题是 §6：**Gating 插入 / 嵌入 Product 时连接检测失效**。
//   PHASE 90 用"三角形质心到产品外表面距离"，实测把 ⌀20 插入式内浇口
//   拆成 4 个连接口、形心偏 6.9mm、方向偏轴 31°；贯穿件拆成 15 个。
//   所以 91-G / G2 / G3 / H 四条是**回归锁**，不许再退回去。
//
// ★ §25 特别要求：不要为了通过测试而放宽 tolerance。
//   91-H 就是为这条写的 —— 把 tol 缩小 50 倍，结论必须完全不变。
//   因为判连接的主证据是**顶点在产品内/外**与**三角形穿越产品边界**，与阈值无关。
//
// 夹具约定与 phase90_test 一致（那三条坑不再重复解释，见该文件头）：
//   产品统一是 100×20×100 的方板，y ∈ [−10, 10]，上表面 y=10、下表面 y=−10。
//   产品用 res=64（平面是精确的，与产品网格分辨率无关），浇注系统用 res=128。
// ============================================================
import { tetMC, genSTL } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { triangleComponents } from '../js/model/meshComponents.js';
import {
  findConnections, traceFlow, flowDiagnostics, flowSummary, headlineStats,
  FLOW_REASON, SAMPLE_REASON, FLOW_CONFIG,
} from '../js/model/flowTrace.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);
const rel = (a, b, frac, m) => assert(Math.abs(a - b) <= Math.abs(b) * frac, `${m}（实际 ${a}，期望 ${b}±${(frac * 100).toFixed(1)}%）`);

const G = 0.3179;
const RES = 128;

const meshOf = (sdf, ext = 100, res = RES) => {
  const half = ext * 1.1 + 4.7;
  const v = tetMC(sdf, [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]], res);
  return { vertices: v, triCount: v.length / 9 };
};

/* ---------- SDF 基元 ---------- */
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
/** 胶囊（任意两点之间的圆柱 + 两端半球）—— 造斜流道用 */
const caps = (a, b, r) => ([x, y, z]) => {
  const px = x - a[0], py = y - a[1], pz = z - a[2];
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(px - bx * h, py - by * h, pz - bz * h) - r;
};
const A = (r) => Math.PI * r * r;

/* ---------- 共用产品（只建一次） ---------- */
let _prod = null, _pcc = null;
const product = () => {
  if (!_prod) {
    _prod = meshOf(box([-50, -10, -50], [50, 10, 50]), 60, 64);
    _pcc = triangleComponents(_prod);
  }
  return _prod;
};
const pcc = () => { product(); return _pcc; };

/** 建浇注系统 + 跑完连接检测与追踪 */
const pipeline = (sdf, ext, opts = {}, P = null, PC = null) => {
  const g = meshOf(sdf, ext);
  const cc = triangleComponents(g);
  const conn = findConnections(P || product(), g, cc, { productComponents: PC || pcc(), ...opts });
  const tree = traceFlow(g, cc, conn.connections, opts);
  return { g, cc, conn, tree };
};
/** 只跑连接检测（大多数 §6 的断言只关心这一层） */
const conns = (sdf, ext, opts = {}, P = null, PC = null) => {
  const g = meshOf(sdf, ext);
  const cc = triangleComponents(g);
  const conn = findConnections(P || product(), g, cc, { productComponents: PC || pcc(), ...opts });
  return { g, cc, conn, tree: traceFlow(g, cc, conn.connections, opts) };
};

/** 产品下表面 y=−10、上表面 y=+10。多数夹具从下方接入（y1 = PROD_BOTTOM 就是面接触）。 */
const PROD_BOTTOM = -10;
const PROD_TOP = 10;

export const tests = [
  /* ============================================================
     A. 单直流道（§24 Test A）
     ============================================================ */
  {
    name: '91-A 单直流道（面接触）：1 个连接 / 1 条流道 / A(s) 稳定且对得上 πr²',
    fn: () => {
      const { conn, tree } = pipeline(cylY(0, 0, 10, -60, PROD_BOTTOM), 110);
      assert(conn.connections.length === 1, `应 1 个连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 1, `应 1 条流道，实际 ${tree.segments.length}`);
      const s = tree.segments[0];
      assert(s.usable && s.validCount >= 6, `应可用且有足够样本，实际 ${s.validCount}`);
      rel(s.areaMin, A(10), 0.03, '最小测得截面积');
      rel(s.areaMax, A(10), 0.03, '最大测得截面积');
      const spread = (s.areaMax - s.areaMin) / A(10);
      assert(spread < 0.05, `直流道 A(s) 应基本稳定，实测波动 ${(spread * 100).toFixed(1)}%`);
    },
  },
  {
    name: '91-A2 单直流道（插入产品）：仍然只有 1 个连接口，起始方向不偏轴',
    fn: () => {
      // ⌀20 从 y=−60 一直插到 y=+5，插进 20mm 厚平板 15mm
      const { conn, tree } = pipeline(cylY(0, 0, 10, -60, 5), 110);
      // ★ PHASE 90 在这里给的是 4 个口
      assert(conn.connections.length === 1, `插入式内浇口只应算 1 个连接口，实际 ${conn.connections.length}`);
      const c = conn.connections[0];
      assert(c.kind === 'insertion', `应判为"插入"，实际 ${c.kind}`);
      assert(c.insideTriangleCount > 0, '插入件应有三角形落在产品内部');
      // 形心必须落在管子轴线上（PHASE 90 偏到 x=−6.9）
      assert(Math.hypot(c.centroid[0], c.centroid[2]) < 1.5,
        `连接口形心应贴轴线，实际偏 ${Math.hypot(c.centroid[0], c.centroid[2]).toFixed(2)}mm`);
      // 方向必须沿管子轴向（PHASE 90 偏轴 31°）
      const axis = [0, -1, 0];
      const cos = -(c.initialDir[1]);
      const deg = Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
      assert(deg < 5, `起始方向应沿轴线，实际偏 ${deg.toFixed(1)}°`);
      assert(tree.segments.length === 1, `应 1 条流道，实际 ${tree.segments.length}`);
      rel(tree.segments[0].areaMin, A(10), 0.03, '插入件的截面积');
    },
  },
  {
    name: '91-A3 连接口截面是**实测**的，不是拿连接面三角面积冒充',
    fn: () => {
      // 插入情况下连接区域是一圈**环面**（面积 ≈ 2πr×带宽），远小于通流截面 πr²。
      // 若把环面积当"口的大小"报出去，用户看到的就是一个没有工艺含义的数。
      const { conn } = conns(cylY(0, 0, 10, -60, 5), 110);
      const c = conn.connections[0];
      assert(c.area > 0, 'patch 面积应如实记录（诊断用）');
      assert(c.sectionAreaMm2 != null, '应给出实测的通流截面积');
      rel(c.sectionAreaMm2, A(10), 0.03, '口处实测截面积');
      assert(Math.abs(c.sectionAreaMm2 - c.area) > c.area * 0.3,
        '这里是环面，patch 面积与通流截面积必须明显不同 —— 相同说明用的是同一个数（没真的去切）');
    },
  },

  /* ============================================================
     B. 不同尺寸流道（§24 Test B）
     ============================================================ */
  {
    name: '91-B 变径流道（细段插入产品）：A(s) 如实反映面积变化',
    fn: () => {
      const { tree } = pipeline((p) => Math.min(cylY(0, 0, 10, -40, 5)(p), cylY(0, 0, 15, -80, -40)(p)), 110);
      assert(tree.segments.length === 1, `变径不是分叉，应是 1 条流道，实际 ${tree.segments.length}`);
      const s = tree.segments[0];
      rel(s.areaMin, A(10), 0.03, '细段截面积');
      rel(s.areaMax, A(15), 0.03, '粗段截面积');
      assert(s.jumps.length === 1, `应检出 1 处截面积突变，实际 ${s.jumps.length}`);
      assert(s.jumps[0].dir === 'up', `应是扩张，实际 ${s.jumps[0].dir}`);
      assert(s.jumps[0].ratio > 2 && s.jumps[0].ratio < 2.6, `突变比值应≈2.25，实际 ${s.jumps[0].ratio}`);
    },
  },

  /* ============================================================
     C. 多个内浇口（§24 Test C / §20 N≥1，不写死单个）
     ============================================================ */
  {
    name: '91-C 多个内浇口：N 个连接口各自独立，不写死单个 ingate',
    fn: () => {
      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(-30, 0, 10, -50, 0)(p), cylY(30, 0, 10, -50, 0)(p)), 110);
      assert(conn.connections.length === 2, `应识别 2 个产品连接，实际 ${conn.connections.length}`);
      assert(tree.segments.length === 2, `应 2 条流道，实际 ${tree.segments.length}`);
      const [a, b] = tree.segments;
      assert(a.connectionId !== b.connectionId, '两条流道应挂在不同的连接上');
      for (const s of tree.segments) {
        rel(s.areaMin, A(10), 0.03, '支管截面积');
        const cx = s.path.reduce((n, q) => n + q[0], 0) / s.path.length;
        assert(Math.abs(Math.abs(cx) - 30) < 3, `流道应停在自己那根管子的轴线上（|x|≈30），实际 ${cx.toFixed(1)}`);
      }
      // 互不串味
      assert(a.path[0][0] * b.path[0][0] < 0, '两条流道不该串到同一侧');
    },
  },

  /* ============================================================
     D. 一个横浇道 + 多个内浇口（§24 Test D）
     ============================================================ */
  {
    name: '91-D 一个横浇道 + 多个内浇口：多个连接口 + 主路径 + 分叉',
    fn: () => {
      // 竖直主通道 ⌀20 → 在 y=−30 分成两条 45° 斜臂（各 ⌀14）→ 两臂都插进产品
      const { conn, tree } = pipeline((p) => Math.min(
        cylY(0, 0, 10, -80, -30)(p),
        caps([0, -30, 0], [-35, -2, 0], 7)(p),
        caps([0, -30, 0], [35, -2, 0], 7)(p),
      ), 110);
      assert(conn.connections.length === 2, `两个内浇口应各算一个连接口，实际 ${conn.connections.length}`);
      const d = flowDiagnostics(tree);
      assert(d.branchCount >= 1, `交汇处应报出分叉，实际 ${d.branchCount}`);
      assert(d.flowPathCount === 2, `应有 2 条起始通道，实际 ${d.flowPathCount}`);
      assert(tree.segments.length >= 3, `主路径 + 支路应至少 3 段，实际 ${tree.segments.length}`);

      // ★ 所有量到的截面积都必须落在**物理可能**的范围内（⌀14~⌀20 → 153.9~314.2mm²）。
      //   这条是 §16 的落地：宁可少给一个数，也不要一个漂亮但错误的小数字。
      const floor = A(7) * 0.6;      // 斜臂 ⌀14 的下限
      for (const s of tree.segments) {
        if (s.areaMin == null) continue;
        assert(s.areaMin >= floor, `${s.id} 量到 ${s.areaMin} mm²，低于本夹具任何流道的物理下限 ${floor.toFixed(1)}`);
      }
      // PHASE 92：主干不再靠 `areaMax < A(11)` 猜 —— 那个判据会被斜臂误命中
      //   （斜臂最后一刀落在交汇融合区，量到 323 ≈ 主干直径，于是 areaMax 也 < A(11)）。
      //   改成按**拓扑位置**认主干：交汇之后、以"流道到头"结束的那一条上游通道。
      const upstream = tree.segments.filter((s) => s.depth >= 1 && s.endReason === FLOW_REASON.END_OF_DUCT);
      assert(upstream.length === 1, `交汇之后应接出 1 条上游主干，实际 ${upstream.length}`);
      rel(upstream[0].areaMin, A(10), 0.06, '主干截面积');
    },
  },

  /* ============================================================
     E. 多个直浇道（§24 Test E / §21 N≥1）
     ============================================================ */
  {
    name: '91-E 多个直浇道：两套互不相连的系统各自成为独立路径',
    fn: () => {
      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(-40, 0, 8, -60, 0)(p), cylY(40, 0, 8, -60, 0)(p)), 110);
      assert(conn.connections.length === 2, `应 2 个连接口，实际 ${conn.connections.length}`);
      const idx = conn.connections.map((c) => c.componentIndex);
      assert(idx[0] !== idx[1], '两口应落在**不同的**浇注系统连通分量上（两套独立系统）');
      assert(tree.segments.length === 2 && tree.segments.every((s) => s.depth === 0), '应是 2 条各自独立的根段');
      for (const s of tree.segments) rel(s.areaMin, A(8), 0.03, '各自量到的截面积');
    },
  },

  /* ============================================================
     F. 完全不连接（§24 Test F）—— 绝不能误判
     ============================================================ */
  {
    name: '91-F 完全不连接：如实报，绝不凭空造一个连接口',
    fn: () => {
      const { conn, tree } = conns(cylY(0, 0, 10, 20, 90), 110);   // 悬在产品上方 30mm
      assert(conn.connections.length === 0, `不该凭空造出连接，实际 ${conn.connections.length}`);
      assert(conn.warnings.some((w) => w.code === 'no_connection'), '应给出 no_connection');
      assert(conn.tol > 0 && conn.tol <= FLOW_CONFIG.tolMaxMm, 'tol 应如实报出且不超过上限');
      const t2 = traceFlow({ vertices: new Float32Array(0), triCount: 0 }, null, [], {});
      assert(t2.segments.length === 0, '没有连接就没有流道');

      // 离得很近但确实没碰上（间隙 2mm >> tol≈0.57）→ 仍然不算连接
      const g2 = conns(cylY(0, 0, 10, 12, 100), 110);
      assert(g2.conn.connections.length === 0, '2mm 间隙不该算连接');
      assert(!g2.conn.relaxed, '没放宽就不该说放宽了');
    },
  },

  /* ============================================================
     G. 内浇口插入产品（§24 Test G）—— **PHASE 90 暴露的核心问题**
     ============================================================ */
  {
    name: '91-G 内浇口插入产品：**1 个**连接口（PHASE 90 在这里给出 4 个）',
    fn: () => {
      const { conn } = conns(cylY(0, 0, 10, -60, 5), 110);
      assert(conn.connections.length === 1,
        `插入式内浇口只应算 1 个连接口，实际 ${conn.connections.length}（PHASE 90 的质心判据在这里给 4 个）`);
      const c = conn.connections[0];
      assert(c.kind === 'insertion', `应判为"插入"，实际 ${c.kind}`);
      rel(c.sectionAreaMm2, A(10), 0.03, '口处实测截面积');
      // §25：必须能解释"为什么它在几何上属于连接" —— 两个正面证据都要在
      assert(c.insideTriangleCount > 0, '证据①：有三角形落在产品**内部**（插入的直接证据）');
      assert(c.depthMm != null && c.depthMm > 1, `证据②：插入部分伸入产品内部 ${c.depthMm} mm`);
      assert(c.gapMm != null && c.gapMm <= conn.tolUsed + 1e-6, '证据③：连接面确实贴着产品表面');
    },
  },
  {
    name: '91-G2 插入 19mm（几乎贯穿 20mm 板）：仍然只有 1 个口',
    fn: () => {
      // 端面只差 1mm 就捅穿。PHASE 90 的质心判据在这里同样会碎成多片。
      const { conn, tree } = pipeline(cylY(0, 0, 10, -60, 9), 110);
      assert(conn.connections.length === 1, `实际 ${conn.connections.length} 个口`);
      const c = conn.connections[0];
      assert(c.kind === 'insertion', `实际 ${c.kind}`);
      assert(c.depthMm > 1, `应量出插入深度，实际 ${c.depthMm}`);
      rel(c.sectionAreaMm2, A(10), 0.03, '口处实测截面积');
      assert(tree.segments.length === 1, `应 1 条流道，实际 ${tree.segments.length}`);
      rel(tree.segments[0].areaMin, A(10), 0.03, '插入件的截面积');
    },
  },
  {
    name: '91-G3 贯穿件（捅穿整块板）：几何上确实是**两个**口',
    fn: () => {
      // ⌀20 从 y=−60 一直捅到 y=+40，穿过整块板 → 下表面一个口、上表面一个口。
      // PHASE 90 在这里给出 **15** 个口。正确答案是 2 —— 不是 1，也不是 15。
      const { conn, tree } = conns(cylY(0, 0, 10, -60, 40), 110);
      assert(conn.connections.length === 2, `贯穿件应有入口/出口 2 个口，实际 ${conn.connections.length}`);
      const ys = conn.connections.map((c) => c.centroid[1]).sort((a, b) => a - b);
      near(ys[0], PROD_BOTTOM, 1.5, '入口应在下表面');
      near(ys[1], 10, 1.5, '出口应在上表面');
      for (const c of conn.connections) {
        assert(c.kind === 'insertion', `实际 ${c.kind}`);
        rel(c.sectionAreaMm2, A(10), 0.03, '口处实测截面积');
      }
    },
  },
  {
    name: '91-H ★阈值无关（§25）：tol 缩小 50 倍，结论必须完全不变',
    fn: () => {
      // §25 禁止的正是"识别不到 → tolerance ×10 → 再 ×10 → 终于识别到了"。
      // 这里反过来做：把 tol 压到 1/50，如果判连接靠的是**内外几何**而不是距离阈值，
      // 结论就不该有任何变化。变了就说明判据还是距离。
      const base = conns(cylY(0, 0, 10, -60, 5), 110).conn;
      const tiny = conns(cylY(0, 0, 10, -60, 5), 110, { tolFrac: 8e-5, tolAbsMinMm: 0.001 }).conn;
      assert(tiny.tol < base.tol / 20, `这组参数应把 tol 压小很多，实际 ${base.tol} → ${tiny.tol}`);
      assert(tiny.connections.length === base.connections.length,
        `tol 变了结论就变 = 判据还是距离：${base.connections.length} → ${tiny.connections.length}`);
      assert(tiny.connections.length === 1, '缩小 tol 后仍应是 1 个口');
      rel(tiny.connections[0].sectionAreaMm2, base.connections[0].sectionAreaMm2, 0.02, '口处截面积不该随阈值变');
      assert(tiny.connections[0].kind === 'insertion', '判为"插入"的依据是内外几何，与阈值无关');
    },
  },
  {
    name: '91-I 三种情况可区分（§6）：面接触 / 插入 / 不连接',
    fn: () => {
      const contact = conns(cylY(0, 0, 10, -60, PROD_BOTTOM), 110).conn;
      assert(contact.connections.length === 1 && contact.connections[0].kind === 'contact',
        `端面贴在产品底面上应判为接触，实际 ${contact.connections.map((c) => c.kind)}`);
      assert(contact.connections[0].insideTriangleCount === 0, '面接触不该有内部三角形');

      const ins = conns(cylY(0, 0, 10, -60, 5), 110).conn;
      assert(ins.connections[0].kind === 'insertion', `实际 ${ins.connections[0].kind}`);

      const none = conns(cylY(0, 0, 10, 20, 90), 110).conn;
      assert(none.connections.length === 0, '悬空件不该有连接口');
    },
  },

  /* ============================================================
     截面有效性（§16）
     ============================================================ */
  {
    name: '91-J 截面有效性（§16 第 4 条）：不闭合 / 端面刀不进 headline，序列里保留',
    fn: () => {
      const mk = (o) => Object.assign({ index: 0, distance: 0, area: 300, valid: true, confidence: 'high' }, o);
      // 干净序列：headline 就是它们
      const clean = [mk({ distance: 0, area: 300 }), mk({ distance: 5, area: 305 }), mk({ distance: 10, area: 298 })];
      const hc = headlineStats(clean);
      assert(hc.usedCount === 3 && hc.excluded === 0, '干净序列不该排除任何刀');
      assert(hc.areaMin === 298 && hc.areaMax === 305, `实际 ${hc.areaMin}..${hc.areaMax}`);

      // 端面那一刀：切到的是倒角，不是流道截面 → 只标注、不进 headline
      const withTerm = clean.concat([mk({ distance: 15, area: 90, terminal: true })]);
      const ht = headlineStats(withTerm);
      assert(ht.areaMin === 298, `端面刀（90）不该成为"最小截面积"，实际 ${ht.areaMin}`);
      assert(ht.excluded === 1, '端面刀应被计入"已排除"');
      assert(withTerm[3].area === 90, '端面刀的面积必须仍留在序列里（不掩盖，只标注）');

      // 截面不闭合：环没走完就断了，面积必然被少算 → 同样不进 headline（§16）
      const withOpen = clean.concat([mk({ distance: 20, area: 40, confidence: 'low', reason: SAMPLE_REASON.OPEN })]);
      const ho = headlineStats(withOpen);
      assert(ho.areaMin === 298, `不闭合的刀（40）不该成为"最小截面积"，实际 ${ho.areaMin}`);
      assert(ho.excluded >= 1, '不闭合的刀应被计入"已排除"');

      // 但如果**全部**都是低置信度，就不能把序列掏空 —— 有多少给多少，并标"可靠度低"
      const allLow = clean.map((s) => Object.assign({}, s, { confidence: 'low' }));
      const ha = headlineStats(allLow);
      assert(ha.areaMin === 298 && ha.usedCount === 3, '全是低置信度时仍要如实给出数（只是标低置信度）');
    },
  },
  {
    name: '91-K 局部流动方向（§14）：45° 斜管的截面是 πr²，不是 πr²/cos45°',
    fn: () => {
      // 斜置流道是"最长方向 ≠ 流动方向"的试金石：
      // 若截面垂直于某个**固定坐标轴**，45° 管会被切成椭圆 → πr²/cos45° ≈ 1.41πr²。
      const { conn, tree } = pipeline((p) => caps([0, -40, 0], [40, 0, 0], 7)(p), 110);
      assert(conn.connections.length === 1, `应 1 个口，实际 ${conn.connections.length}`);
      const s = tree.segments[0];
      rel(s.areaMin, A(7), 0.06, '45° 斜管截面积');
      assert(s.areaMax < A(7) * 1.15,
        `最大测得值不该接近斜切椭圆面积（${(A(7) / Math.cos(Math.PI / 4)).toFixed(1)}），实际 ${s.areaMax}`);
      // 方向确实沿管轴（−45°）
      const c = conn.connections[0];
      near(c.initialDir[0], -Math.SQRT1_2, 0.12, '起始方向应沿管轴 x 分量');
      near(c.initialDir[1], -Math.SQRT1_2, 0.12, '起始方向应沿管轴 y 分量');
      assert(conn.connections[0].kind === 'insertion', '斜管末端埋在产品内 → 插入');
    },
  },

  /* ============================================================
     多产品件（§17）
     ============================================================ */
  {
    name: '91-L 多个产品件：两个分离实体的连接都能找到（§17 不假设只有一个产品）',
    fn: () => {
      const two = meshOf((p) => Math.min(
        box([-50, -10, -30], [-10, 10, 30])(p),
        box([10, -10, -30], [50, 10, 30])(p),
      ), 60, 64);
      const tcc = triangleComponents(two);
      assert(tcc.components.length === 2, `夹具应是 2 个分离实体，实际 ${tcc.components.length}`);

      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(-30, 0, 8, -40, 0)(p), cylY(30, 0, 8, -40, 0)(p)), 110, {}, two, tcc);
      assert(conn.connections.length === 2, `两个产品件应各有一个连接口，实际 ${conn.connections.length}`);
      for (const c of conn.connections) rel(c.sectionAreaMm2, A(8), 0.04, '口处实测截面积');
      assert(tree.segments.length === 2, `应有 2 条流道，实际 ${tree.segments.length}`);
    },
  },

  /* ============================================================
     异常输入 / 真实链路
     ============================================================ */
  {
    name: '91-M 空输入 / 异常输入：如实报，不抛异常',
    fn: () => {
      const g = meshOf(cylY(0, 0, 10, -60, 0), 110);
      const cc = triangleComponents(g);
      const noProd = findConnections(null, g, cc, {});
      assert(noProd.connections.length === 0 && noProd.warnings.some((w) => w.code === 'no_product'), '没有产品要如实报');
      const noGating = findConnections(product(), null, null, {});
      assert(noGating.connections.length === 0 && noGating.warnings.some((w) => w.code === 'no_gating'), '没有浇注系统要如实报');
      const empty = { vertices: new Float32Array(0), triCount: 0 };
      const r = findConnections(product(), empty, triangleComponents(empty), {});
      assert(r.connections.length === 0, '空网格不该造出连接');
      const t = traceFlow(g, cc, [], {});
      assert(t.segments.length === 0 && t.ok === false && t.reason === FLOW_REASON.NO_CONNECTION, '没有连接就没有流道');
      const d = flowDiagnostics(t);
      assert(d.minimumAreaMm2 === null && d.maximumAreaMm2 === null, '没数据时必须给 null，不能填 0 冒充结论');
    },
  },
  {
    name: '91-N 走真实解析链路：ASCII STL 文本 → parseSTL → 连接检测 → 追踪',
    fn: () => {
      const half = 110 * 1.1 + 4.7;
      const b = [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]];
      const ascii = genSTL(cylY(0, 0, 10, -60, 5), b, 128);   // 插入式
      const parsed = parseSTL(new TextEncoder().encode(ascii));
      assert(parsed.triCount > 0, '应解析出三角形');
      const cc = triangleComponents(parsed);
      const conn = findConnections(product(), parsed, cc, { productComponents: pcc() });
      assert(conn.connections.length === 1, `走完整解析链路后仍应是 1 个口，实际 ${conn.connections.length}`);
      assert(conn.connections[0].kind === 'insertion', '插入判定不该因为走了 STL 文本而丢失');
      const tree = traceFlow(parsed, cc, conn.connections, {});
      assert(tree.segments.length === 1, '应是 1 条流道');
      rel(tree.segments[0].areaMin, A(10), 0.03, '走完整解析链路后的截面积');
    },
  },
  {
    name: '91-P 口处截面积必须与沿程实测一致（拿粗估方向去切就是斜切，面积会系统性放大）',
    fn: () => {
      // 起始方向只是"从连接口指向浇注系统内部"的粗估（§6），多内浇口系统里可能偏轴几十度。
      // 拿它去切就是**斜切**，面积必然放大 —— 实测这个夹具偏轴 27.2°，斜切会放大 12.4%，
      // 于是"口处截面积"与同一条流道沿程量到的数对不上。**同一个口给出两个矛盾的数**，
      // 是最容易被工程师一眼看穿的那种错。所以切之前必须先用截面形心把方向校正一次。
      const { conn, tree } = pipeline((p) => Math.min(
        cylY(0, 0, 11, 55, 120)(p),          // 直浇道 ⌀22
        cylX(55, 0, 8, -35, 35)(p),          // 横浇道 ⌀16
        cylY(-25, 0, 6, 0, 55)(p),           // 两条并联内浇口 ⌀12，从产品顶面插入 10mm
        cylY(25, 0, 6, 0, 55)(p),
      ), 120);
      assert(conn.connections.length === 2, `应 2 个口，实际 ${conn.connections.length}`);
      // PHASE 92：这里不再断言"整棵树恰好 2 段" —— 这份夹具是**完整浇注系统**
      //   （2 内浇口 + 横浇道 + 直浇道），追踪出来本来就是一张网络，
      //   "2 段"是 PHASE 91 单路径口径下的产物。断言的**实质不变、而且更严**：
      //   ① 两个口必须各自起一条**根边**；② 根边的沿程最小值必须与口处实测一致；
      //   ③ 网络必须真的把两个口连到同一条上游主干上（PHASE 92 才做得到）。
      const roots = tree.segments.filter((s) => s.depth === 0);
      assert(roots.length === 2, `应从 2 个口各起一条根边，实际 ${roots.length}`);
      for (const c of conn.connections) {
        assert(/realigned/.test(c.dirSource),
          `${c.id} 的粗估方向在这个夹具里必定偏轴，应触发方向校正，实际 dirSource=${c.dirSource}`);
        const seg = roots.find((s) => s.connectionId === c.id);
        assert(seg, `${c.id} 应有自己的根边`);
        rel(c.sectionAreaMm2, seg.areaMin, 0.05, `${c.id} 口处截面积应与同一条流道沿程实测一致`);
        rel(c.sectionAreaMm2, A(6), 0.04, `${c.id} 口处截面积对解析值 πr²`);
      }
      const dn = flowDiagnostics(tree);
      assert(dn.junctionCount >= 1 && dn.terminalCount >= 1, `网络应有交汇与末端，实际 J=${dn.junctionCount} T=${dn.terminalCount}`);
      // 两个口必须都能走到网络的上游尽头（直浇道顶端）—— C1/C2 到直浇道连通
      const reach = (connId) => {
        const seen = new Set(); const st = roots.filter((s) => s.connectionId === connId).map((s) => s.endNode);
        let hasTerminal = false;
        while (st.length) {
          const nid = st.pop();
          if (!nid || seen.has(nid)) continue;
          seen.add(nid);
          const nd = (tree.nodes || []).find((n) => n.id === nid);
          if (nd && nd.kind === 'terminal') hasTerminal = true;
          for (const e of tree.segments) if (e.startNode === nid) st.push(e.endNode);
        }
        return hasTerminal;
      };
      for (const c of conn.connections) assert(reach(c.id), `${c.id} 应能沿网络走到一个末端（上游尽头）`);
    },
  },
  {
    name: '91-O 汇总与诊断：多口多段时逐口/逐段数据齐全，且都不含物理上不可能的数值',
    fn: () => {
      const { conn, tree } = pipeline(
        (p) => Math.min(cylY(-30, 0, 10, -50, 0)(p), cylY(30, 0, 10, -50, 0)(p)), 110);
      const sum = flowSummary(tree);
      const d = flowDiagnostics(tree);
      assert(sum.connectionCount === 2 && sum.perConnection.length === 2, '逐连接汇总应齐全');
      for (const pc of sum.perConnection) {
        assert(pc.kind === 'insertion', `实际 ${pc.kind}`);
        assert(pc.sectionAreaMm2 != null, '每个口都要给出实测截面积');
        assert(pc.insideTriangleCount > 0, '每个口都要有插入证据');
        assert(pc.minArea != null && pc.minArea > 0, '每个口都要有量到的数');
      }
      for (const s of d.segments) {
        if (s.areaMin == null) continue;
        assert(s.areaMin > A(10) * 0.6, `${s.id} 的 areaMin=${s.areaMin} 低于本夹具物理下限`);
      }
      assert(d.sampleCount === d.validSampleCount + d.invalidSampleCount, '有效+无效必须对得上');
    },
  },
];
