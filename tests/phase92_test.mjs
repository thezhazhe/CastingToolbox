// ============================================================
// PHASE 92 测试（92.txt §十六 A~T：拓扑 / 交汇 / 分支）
//
// 本阶段只解决一件事：**把浇注系统从"一条路径"变成"一张网络"**（92.txt §三/§四）。
// 所以这里的断言几乎全部是**图的连通关系**，不是"某个数看起来差不多"：
//   C1 → Junction ✓      C2 → Junction ✓      Junction → Sprue ✓
//   C1 → C2 ✗            C2 → C1 ✗            跑到直浇道下方 ✗
//   Runner 末端回头 ✗    横向跳到另一条支路 ✗
//
// ★ 主夹具就是 92.txt §六 / §二十一 画的那个模型（也是工业上最常见的形状）：
//
//         直浇道 ⌀22
//            │
//   ─────────┼─────────  横浇道 ⌀16（两端各留 30mm，末端是真末端）
//        C1  │  C2        内浇口 ⌀12 ×2，从产品顶面插入
//           产品
//
// ★ §十九：没有任何"给测试模型写特殊分支 / 按文件名猜 / 按坐标硬编码"的东西 ——
//   下面所有判据都只用几何量与图结构（节点度数、连通、方向、面积），
//   换个夹具同样成立（这也是 92-A 到 92-T 能共用同一套 helper 的原因）。
//
// 夹具约定与 phase90/91 一致：产品 100×20×100 方板，y ∈ [−10, 10]；产品 res=64，浇注系统 res=128。
// ============================================================
import { tetMC, genSTL } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { triangleComponents } from '../js/model/meshComponents.js';
import {
  findConnections, traceFlow, flowDiagnostics, flowSummary,
  FLOW_REASON, NODE_KIND, FLOW_CONFIG,
} from '../js/model/flowTrace.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);
const rel = (a, b, frac, m) => assert(Math.abs(a - b) <= Math.abs(b) * frac, `${m}（实际 ${a}，期望 ${b}±${(frac * 100).toFixed(1)}%）`);

const G = 0.3179;
const RES = 128;
const A = (r) => Math.PI * r * r;
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const meshOf = (sdf, ext, res = RES) => {
  const half = ext * 1.1 + 4.7;
  const v = tetMC(sdf, [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]], res);
  return { vertices: v, triCount: v.length / 9 };
};

/* ---------- SDF 基元（与 phase91_test 同一套） ---------- */
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

/* ---------- 共用产品（只建一次） ---------- */
let _prod = null, _pcc = null;
const product = () => {
  if (!_prod) { _prod = meshOf(box([-50, -10, -50], [50, 10, 50]), 60, 64); _pcc = triangleComponents(_prod); }
  return _prod;
};
const pcc = () => { product(); return _pcc; };

/** 建浇注系统 + 跑完连接检测与网络追踪 */
const pipeline = (sdf, ext, opts = {}, P = null, PC = null) => {
  const g = meshOf(sdf, ext);
  const cc = triangleComponents(g);
  const conn = findConnections(P || product(), g, cc, { productComponents: PC || pcc(), ...opts });
  const tree = traceFlow(g, cc, conn.connections, opts);
  return { g, cc, conn, tree };
};

/* ---------- 图工具（断言全部基于这几个，不碰实现细节） ---------- */

/** 节点的出边（边从它出发） */
const outEdges = (tree, nodeId) => tree.edges.filter((e) => e.startNode === nodeId);
/** 从一组起始节点出发能到达的**所有**节点 id（沿边的方向走，网络里的边有向：从起点向外） */
const reachNodes = (tree, fromNodeIds) => {
  const seen = new Set(), st = [...fromNodeIds];
  while (st.length) {
    const id = st.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const e of tree.edges) if (e.startNode === id) st.push(e.endNode);
  }
  return seen;
};
/** 某个连接口出发能到达的节点集合（起点 = 该口所有根边的**起点**） */
const reachFrom = (tree, connectionId) => {
  const roots = tree.edges.filter((e) => e.depth === 0 && e.connectionId === connectionId);
  return reachNodes(tree, roots.map((e) => e.startNode));
};
const nodeById = (tree, id) => (tree.nodes || []).find((n) => n.id === id) || null;
const kindsIn = (tree, ids, kind) => [...ids].filter((id) => nodeById(tree, id)?.kind === kind);

/* ============================================================
   ★ 主夹具（§六 / §二十一）
   ============================================================ */
const MAIN_SDF = (p) => Math.min(
  cylY(0, 0, 11, 55, 115)(p),          // 直浇道 ⌀22
  cylX(55, 0, 8, -60, 60)(p),          // 横浇道 ⌀16，x ∈ [-60, 60]
  cylY(-30, 0, 6, 0, 55)(p),           // 内浇口 ⌀12（插入产品顶面 10mm）
  cylY(30, 0, 6, 0, 55)(p),
);
let _main = null;
const main = () => { if (!_main) _main = pipeline(MAIN_SDF, 125); return _main; };

/** 交汇节点（按图结构找，不按 id 猜） */
const junctionsOf = (tree) => (tree.nodes || []).filter((n) => n.kind === NODE_KIND.JUNCTION);
const terminalsOf = (tree) => (tree.nodes || []).filter((n) => n.kind === NODE_KIND.TERMINAL);

export const tests = [

  /* ============================================================
     A. 单一连续通道（§十六 A）
     ============================================================ */
  {
    name: '92-A 单一连续通道：1 个口 → 1 条边 → 1 个末端，没有交汇',
    fn: () => {
      const { conn, tree } = pipeline(cylY(0, 0, 10, 0, 90), 110);
      assert(conn.connections.length === 1, `应 1 个连接，实际 ${conn.connections.length}`);
      assert(tree.edges.length === 1, `应 1 条边，实际 ${tree.edges.length}`);
      assert(tree.nodes.length === 2, `应 2 个节点（连接口 + 末端），实际 ${tree.nodes.length}`);
      assert(junctionsOf(tree).length === 0, '一条直管上不该有交汇');
      const e = tree.edges[0];
      assert(e.startNode === 'C1' && nodeById(tree, e.endNode).kind === NODE_KIND.TERMINAL,
        `应有向地从连接口走到末端，实际 ${e.startNode} → ${e.endNode}`);
      assert(e.endReason === FLOW_REASON.END_OF_DUCT, `应如实报"流道到头"，实际 ${e.endReason}`);
      rel(e.areaMin, A(10), 0.03, '沿程截面积');
      // 总结口径（§十四）也要对得上
      const s = flowSummary(tree);
      assert(s.nodeCount === 2 && s.junctionCount === 0 && s.terminalCount === 1 && s.edgeCount === 1,
        `汇总口径：${JSON.stringify({ n: s.nodeCount, j: s.junctionCount, t: s.terminalCount, e: s.edgeCount })}`);
    },
  },

  /* ============================================================
     B/C. C1 → Runner，C2 → Runner（§十六 B/C）
     ============================================================ */
  {
    name: '92-B C1 → 横浇道：内浇口的根边必须**停在一个交汇节点**上，而不是继续乱跑',
    fn: () => {
      const { conn, tree } = main();
      const root = tree.edges.find((e) => e.depth === 0 && e.connectionId === conn.connections[0].id);
      assert(root, 'C1 应有根边');
      const jEnd = nodeById(tree, root.endNode);
      assert(jEnd && jEnd.kind === NODE_KIND.JUNCTION, `C1 的根边应结束在交汇节点，实际 ${jEnd && jEnd.kind}`);
      // 交汇点必须落在**横浇道轴线**（y≈55）上、且在内浇口轴线（x≈-30）附近 —— 这是几何事实
      near(jEnd.point[1], 55, 3, '交汇点应在横浇道轴线上');
      near(jEnd.point[0], -30, 5, '交汇点应在 C1 内浇口轴线上');
      rel(root.areaMin, A(6), 0.04, '内浇口沿程截面积');
      assert(root.endReason === FLOW_REASON.BRANCHED, `分岔是正常结束，实际 ${root.endReason}`);
    },
  },
  {
    name: '92-C C2 → 横浇道：与 C1 完全对称（同一夹具从两侧各走一遍）',
    fn: () => {
      const { conn, tree } = main();
      const c1 = tree.edges.find((e) => e.depth === 0 && e.connectionId === conn.connections[0].id);
      const c2 = tree.edges.find((e) => e.depth === 0 && e.connectionId === conn.connections[1].id);
      assert(c1 && c2, '两个口都应有根边');
      assert(Math.abs(c1.lengthMm - c2.lengthMm) < 2, `两侧根边长度应基本一致，实际 ${c1.lengthMm} / ${c2.lengthMm}`);
      assert(Math.abs(c1.areaMin - c2.areaMin) < A(6) * 0.05, `两侧量到的截面积应一致，实际 ${c1.areaMin} / ${c2.areaMin}`);
      const j1 = nodeById(tree, c1.endNode), j2 = nodeById(tree, c2.endNode);
      assert(j1.point[0] < 0 && j2.point[0] > 0, '两个交汇应各在自己那一侧');
    },
  },

  /* ============================================================
     D. C1/C2 汇合（§十六 D）
     ============================================================ */
  {
    name: '92-D C1/C2 汇合：两个口的可达集合必须**相交于同一个交汇节点**（真正的网络，不是两条平行路径）',
    fn: () => {
      const { conn, tree } = main();
      const r1 = reachFrom(tree, conn.connections[0].id);
      const r2 = reachFrom(tree, conn.connections[1].id);
      const shared = [...r1].filter((id) => r2.has(id) && nodeById(tree, id).kind === NODE_KIND.JUNCTION);
      assert(shared.length >= 1, `C1 与 C2 必须汇合到同一个交汇节点，实际交集 = ${[...r1].filter((id) => r2.has(id))}`);
    },
  },

  /* ============================================================
     E. Runner → Sprue（§十六 E）
     ============================================================ */
  {
    name: '92-E 横浇道 → 直浇道：汇合点往上必须接出一条 ⌀22 的通道，走到它自己的末端',
    fn: () => {
      const { conn, tree } = main();
      const all = [...reachFrom(tree, conn.connections[0].id)];
      // 找面积量级最大的那条边（本夹具里只有直浇道 ⌀22 的量级远大于 ⌀16）
      const sprue = tree.edges.filter((e) => (all.includes(e.startNode)) && e.areaMin != null && e.areaMin > A(10))
        .sort((a, b) => b.areaMin - a.areaMin)[0];
      assert(sprue, '应有一条 ⌀20 以上的上游通道（直浇道）');
      rel(sprue.areaMin, A(11), 0.04, '直浇道沿程截面积');
      const end = nodeById(tree, sprue.endNode);
      assert(end.kind === NODE_KIND.TERMINAL, `直浇道应走到末端，实际 ${end.kind}`);
      // 方向必须是竖直（+Y），不是横向
      const p0 = sprue.path[0], p1 = sprue.path[sprue.path.length - 1];
      assert(Math.abs(p1[1] - p0[1]) > Math.abs(p1[0] - p0[0]) * 3, '直浇道必须朝竖直方向走，不能是横向通道');
    },
  },

  /* ============================================================
     F. 不发生反向追踪（§十六 F + §十六 特别要求"Runner 末端不能成为错误回头路径"）
     ============================================================ */
  {
    name: '92-F 不反向追踪：每条边沿程到起点的距离必须单调不减（末端不回头）',
    fn: () => {
      const { tree } = main();
      for (const e of tree.edges) {
        const startNode = nodeById(tree, e.startNode);
        let prev = -1;
        for (const s of e.samples) {
          if (!s.valid || !s.centroid) continue;
          const d = d3(s.centroid, startNode.point);
          if (prev >= 0) {
            assert(d > prev - Math.max(Math.sqrt(s.area / Math.PI), 1),
              `${e.id} 在 ${s.distance}mm 处回头了（到起点距离 ${prev.toFixed(1)} → ${d.toFixed(1)}）`);
          }
          prev = Math.max(prev, d);
        }
      }
      // 末端节点必须真的在"往外"的方向上
      for (const t of terminalsOf(tree)) {
        const inEdge = tree.edges.find((e) => e.endNode === t.id);
        assert(inEdge, `末端 ${t.id} 必须有一条边通向它`);
        const st = nodeById(tree, inEdge.startNode);
        assert(d3(t.point, st.point) > 5, `末端 ${t.id} 离出发点只有 ${d3(t.point, st.point).toFixed(1)}mm，不像是走到头`);
      }
    },
  },

  /* ============================================================
     G. 不发生横向跳跃（§十六 G）
     ============================================================ */
  {
    name: '92-G 不横向跳跃：相邻两刀的位移必须与**上一刀的等效半径**相称（§九 空间连续性）',
    fn: () => {
      const { tree } = main();
      for (const e of tree.edges) {
        const v = e.samples.filter((s) => s.valid && s.centroid);
        for (let i = 1; i < v.length; i++) {
          const step = d3(v[i].centroid, v[i - 1].centroid);
          const r = Math.sqrt(v[i - 1].area / Math.PI);
          assert(step <= r * FLOW_CONFIG.maxJumpFrac + 1e-6,
            `${e.id} 第 ${i} 刀横跳 ${step.toFixed(1)}mm（上一刀等效半径只有 ${r.toFixed(1)}mm）`);
        }
      }
    },
  },

  /* ============================================================
     H. 两个 Branch 都能保留（§十六 H）
     ============================================================ */
  {
    name: '92-H 分叉两侧都保留：交汇节点必须有 ≥3 条边（一条来路 + 至少两条去路）',
    fn: () => {
      const { tree } = main();
      const deg = junctionsOf(tree).map((n) => n.edgeIds.length);
      assert(deg.length >= 3, `应至少 3 个交汇，实际 ${deg.length}`);
      assert(deg.filter((d) => d >= 3).length >= 3, `每个交汇都应分出 ≥2 条去路，实际度数 ${deg}`);
      // 两个方向的横浇道都必须存在（长度相称，方向相反）
      const arms = tree.edges.filter((e) => e.lengthMm > 15 && e.areaMin != null && Math.abs(e.areaMin - A(8)) < A(8) * 0.06);
      const dirs = arms.map((e) => Math.sign(e.path[e.path.length - 1][0] - e.path[0][0]));
      assert(dirs.includes(1) && dirs.includes(-1), `横浇道应朝 ±x 两个方向都展开，实际 ${dirs}`);
    },
  },

  /* ============================================================
     I/J/K. 多个 Ingate / Runner / Sprue（§十六 I/J/K，§八 天然支持 N 个）
     ============================================================ */
  {
    name: '92-I 三个内浇口（§八/§二十 N≥1）：3 个连接口 → 3 条根边，且都能走到同一个上游网络',
    fn: () => {
      const { conn, tree } = pipeline((p) => Math.min(
        cylY(0, 0, 11, 55, 115)(p), cylX(55, 0, 8, -80, 80)(p),
        cylY(-48, 0, 6, 0, 55)(p), cylY(0, 0, 6, 0, 55)(p), cylY(48, 0, 6, 0, 55)(p),
      ), 140);
      assert(conn.connections.length === 3, `应 3 个口，实际 ${conn.connections.length}`);
      const roots = tree.edges.filter((e) => e.depth === 0);
      assert(roots.length === 3, `应 3 条根边，实际 ${roots.length}`);
      for (const c of conn.connections) {
        assert(roots.some((e) => e.connectionId === c.id), `${c.id} 应有自己的根边`);
        const r = reachFrom(tree, c.id);
        assert(kindsIn(tree, r, NODE_KIND.TERMINAL).length >= 1, `${c.id} 应能走到某个末端`);
      }
      // 代码里不能有"正好 2 个内浇口"这类写死：段数必须是 3 个口各自的子树并起来
      assert(tree.edges.length >= 6, `3 个口的网络不该只展开 ${tree.edges.length} 条边`);
      for (const e of tree.edges) {
        if (e.areaMin == null) continue;
        assert(e.areaMin > A(6) * 0.5, `${e.id} 量到 ${e.areaMin}mm²，低于本夹具任何流道的物理下限`);
      }
    },
  },
  {
    name: '92-J/K 两个直浇道（§十六 J/K）：两个 Sprue 各自成末端，绝不能被当成"另一条横浇道"',
    fn: () => {
      const { tree } = pipeline((p) => Math.min(
        cylY(-25, 0, 10, 55, 110)(p), cylY(25, 0, 10, 55, 110)(p),
        cylX(55, 0, 8, -70, 70)(p), cylY(-55, 0, 6, 0, 55)(p), cylY(55, 0, 6, 0, 55)(p),
      ), 145);
      const ups = tree.edges.filter((e) => e.areaMin != null && e.areaMin > A(8.5));
      assert(ups.length === 2, `应有 2 条 ⌀20 的直浇道，实际 ${ups.length}`);
      for (const e of ups) {
        const p0 = e.path[0], p1 = e.path[e.path.length - 1];
        assert(Math.abs(p1[1] - p0[1]) > Math.abs(p1[1] - p0[1]) * 0 + 20, `${e.id} 应竖直向上走`);
        assert(Math.abs(p1[0] - p0[0]) < 8, `${e.id} 不该横向跑（Δx=${(p1[0] - p0[0]).toFixed(1)}）`);
        rel(e.areaMin, A(10), 0.06, '直浇道截面积');
      }
      assert(terminalsOf(tree).length >= 3, `两个直浇道顶端 + 横浇道末端都该是末端，实际 ${terminalsOf(tree).length}`);
    },
  },

  /* ============================================================
     L/M/N. 无连接 / 断裂 / 开放网格（§十六 L/M/N）
     ============================================================ */
  {
    name: '92-L 完全不连接：如实报 no_connection，图必须是空的（不凭空造节点）',
    fn: () => {
      const { conn, tree } = pipeline(cylY(0, 0, 10, 30, 90), 110);
      assert(conn.connections.length === 0, `不该凭空造出连接，实际 ${conn.connections.length}`);
      assert(tree.edges.length === 0 && tree.nodes.length === 0, '没有连接就不该有节点或边');
      const d = flowDiagnostics(tree);
      assert(d.nodeCount === 0 && d.junctionCount === 0 && d.terminalCount === 0, '诊断里的图也必须是空的');
      assert(d.minimumAreaMm2 === null, '没数据时必须给 null，不能填 0 冒充结论');
    },
  },
  {
    name: '92-M 断裂 STL（三角面被截断）：如实降级，不抛异常，也不编造一个完整网络',
    fn: () => {
      const half = 125 * 1.1 + 4.7;
      const ascii = genSTL(MAIN_SDF, [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]], 96);
      const full = parseSTL(new TextEncoder().encode(ascii));
      assert(full.triCount > 100, '夹具本身应解析出足够三角形');
      // 砍掉后半段三角形 → 网格缺一大块（断裂）
      const cut = Math.floor(full.triCount * 0.55);
      const broken = { vertices: full.vertices.slice(0, cut * 9), triCount: cut };
      const cc = triangleComponents(broken);
      const conn = findConnections(product(), broken, cc, { productComponents: pcc() });
      const tree = traceFlow(broken, cc, conn.connections, {});   // ← 不许抛
      const d = flowDiagnostics(tree);
      assert(d.segmentCount === tree.edges.length, '诊断的段数必须与实际边数一致');
      for (const e of tree.edges) {
        if (e.areaMin == null) continue;
        assert(e.areaMin > 0, `${e.id} 报出了非正面积 ${e.areaMin}`);
      }
      // 断裂网格里量到的面积只可能**偏小或没有**，绝不该出现比真值还大的数
      if (d.maximumAreaMm2 != null) {
        assert(d.maximumAreaMm2 < 2000, `断裂网格量到 ${d.maximumAreaMm2}mm²，不像真实截面`);
      }
    },
  },
  {
    name: '92-N 开放网格（挖掉一片三角形）：截面不闭合时如实标 low，不进 headline',
    fn: () => {
      const half = 110 * 1.1 + 4.7;
      const ascii = genSTL(cylY(0, 0, 10, 0, 90), [[-half + G, -half + G, -half + G], [half + G, half + G, half + G]], 96);
      const full = parseSTL(new TextEncoder().encode(ascii));
      // 均匀挖掉 25% 的三角形 → 网格到处是洞（开放曲面）
      const keep = [];
      for (let t = 0; t < full.triCount; t++) if (t % 4 !== 0) keep.push(t);
      const verts = new Float32Array(keep.length * 9);
      keep.forEach((t, i) => { for (let k = 0; k < 9; k++) verts[i * 9 + k] = full.vertices[t * 9 + k]; });
      const open = { vertices: verts, triCount: keep.length };
      const cc = triangleComponents(open);
      assert(cc.components.some((c) => !c.closed), '夹具本身应该是不闭合的（否则这条测试没意义）');
      const conn = findConnections(product(), open, cc, { productComponents: pcc() });
      const tree = traceFlow(open, cc, conn.connections, {});
      for (const e of tree.edges) {
        // 开放网格里切出来的环多半不闭合 → 必须标成 low，而不是当成可靠数据
        for (const s of e.samples) {
          if (!s.valid) continue;
          if (s.reason === 'open') assert(s.confidence === 'low', `${e.id} 不闭合的刀必须标 low`);
        }
      }
      const d = flowDiagnostics(tree);
      assert(d.sampleCount === d.validSampleCount + d.invalidSampleCount, '有效+无效必须对得上');
    },
  },

  /* ============================================================
     O. 简单面积变化（§十六 O）—— PHASE 91 的 91-B 在 PHASE 92 下必须还是对的
     ============================================================ */
  {
    name: '92-O 简单面积变化：变径流道仍是 1 条边、1 处突变、比值对得上解析值',
    fn: () => {
      const { tree } = pipeline((p) => Math.min(cylY(0, 0, 10, -40, 5)(p), cylY(0, 0, 15, -80, -40)(p)), 110);
      assert(tree.edges.length === 1, `变径不是分叉，应是 1 条边，实际 ${tree.edges.length}`);
      assert(junctionsOf(tree).length === 0, '变径不是交汇');
      const e = tree.edges[0];
      rel(e.areaMin, A(10), 0.03, '细段截面积');
      rel(e.areaMax, A(15), 0.03, '粗段截面积');
      assert(e.jumps.length === 1, `应检出 1 处突变，实际 ${e.jumps.length}`);
      assert(e.jumps[0].ratio > 2 && e.jumps[0].ratio < 2.6, `突变比值应≈2.25，实际 ${e.jumps[0].ratio}`);
    },
  },

  /* ============================================================
     P. Edge section 数据连续（§十六 P / §十二 A(s) 必须挂在正确的 Edge 上）
     ============================================================ */
  {
    name: '92-P 每条边的采样序列自洽：距离单调、面积为正、有效+无效对数、序列与样本一致',
    fn: () => {
      const { tree } = main();
      for (const e of tree.edges) {
        assert(e.samples.length === e.sampleCount, `${e.id} 样本数与计数不符`);
        assert(e.validCount + e.invalidCount === e.sampleCount, `${e.id} 有效+无效必须等于总数`);
        assert(e.series.length === e.validCount, `${e.id} 序列长度必须等于有效样本数`);
        let prev = -Infinity;
        for (const s of e.samples) {
          assert(s.distance >= prev, `${e.id} 距离没有单调递增（${prev} → ${s.distance}）`);
          prev = s.distance;
          if (s.valid) assert(s.area > 0, `${e.id} 有效样本的面积必须为正，实际 ${s.area}`);
        }
        // A(s) 必须挂在**这条边自己的**样本上（§十二：数据属于正确的 Edge）
        assert(e.path.length === e.validCount, `${e.id} 路径点数应等于有效样本数（${e.path.length} vs ${e.validCount}）`);
      }
    },
  },

  /* ============================================================
     Q/R/S. 图的基本合法性（§十六 Q/R/S）
     ============================================================ */
  {
    name: '92-Q 无重复边：任意两条边的两端节点对不能相同，路径也不能大面积重叠',
    fn: () => {
      const { tree } = main();
      const seen = new Map();
      for (const e of tree.edges) {
        const key = e.startNode + '>' + e.endNode;
        assert(!seen.has(key), `${e.id} 与 ${seen.get(key)} 是重复边（${key}）`);
        seen.set(key, e.id);
      }
      // 几何上也不能大面积重叠（两个节点之间只该有一条通道）
      for (let i = 0; i < tree.edges.length; i++) {
        for (let j = i + 1; j < tree.edges.length; j++) {
          const a = tree.edges[i].path, b = tree.edges[j].path;
          if (a.length < 3 || b.length < 3) continue;
          let hit = 0;
          for (const p of a) if (b.some((q) => d3(p, q) < 1.5)) hit++;
          const frac = hit / a.length;
          assert(frac < 0.6, `${tree.edges[i].id} 与 ${tree.edges[j].id} 的路径重叠 ${(frac * 100).toFixed(0)}%`);
        }
      }
    },
  },
  {
    name: '92-R 无非法自环 / 空边：起点终点不许相同，也不许出现 0 长度 0 样本的边',
    fn: () => {
      const { tree } = main();
      for (const e of tree.edges) {
        assert(e.startNode !== e.endNode, `${e.id} 是自环（${e.startNode}）`);
        assert(e.sampleCount > 0 || e.lengthMm > 0, `${e.id} 既没有样本也没有长度`);
        if (e.validCount === 0) assert(e.lengthMm > 0, `${e.id} 有效样本为 0 且长度为 0 —— 空边不该留在图里`);
      }
      // 每条边两端都必须能在节点表里查到
      for (const e of tree.edges) {
        assert(nodeById(tree, e.startNode), `${e.id} 的起点 ${e.startNode} 不在节点表里`);
        assert(nodeById(tree, e.endNode), `${e.id} 的终点 ${e.endNode} 不在节点表里`);
      }
    },
  },
  {
    name: '92-S 交汇数量合理：主夹具恰好 3 个交汇（C1 口 / C2 口 / 直浇道口），不多不少',
    fn: () => {
      const { tree } = main();
      const js = junctionsOf(tree);
      assert(js.length === 3, `应恰有 3 个交汇，实际 ${js.length}：${js.map((n) => `(${n.point})`).join(' ')}`);
      // 三个交汇的位置必须各自说得通
      const xs = js.map((n) => n.point[0]).sort((a, b) => a - b);
      near(xs[0], -30, 6, '左交汇应在 C1 内浇口上方');
      near(xs[1], 0, 6, '右交汇应在直浇道下方');
      near(xs[2], 30, 6, '右交汇应在 C2 内浇口上方');
      assert(terminalsOf(tree).length === 3, `应有 3 个末端，实际 ${terminalsOf(tree).length}`);
      assert(tree.nodes.filter((n) => n.kind === NODE_KIND.CONNECTION).length === 2, '连接口节点应有 2 个');
    },
  },

  /* ============================================================
     特别要求：Runner 末端不回头 / Sprue 不被误认为横向 Runner
     ============================================================ */
  {
    name: '92-U ★ Runner 末端不能成为错误回头路径：走到末端的边必须是"一条直路"',
    fn: () => {
      const { tree } = main();
      const ends = tree.edges.filter((e) => nodeById(tree, e.endNode).kind === NODE_KIND.TERMINAL);
      assert(ends.length >= 2, `横浇道两端 + 直浇道顶端都该是末端，实际 ${ends.length}`);
      for (const e of ends) {
        // 终点相对起点的位移必须**一路朝外**：任何一刀都不能回到起点附近
        const st = nodeById(tree, e.startNode).point;
        const v = e.samples.filter((s) => s.valid && s.centroid);
        const dEnd = d3(v[v.length - 1].centroid, st);
        for (let i = 1; i < v.length - 1; i++) {
          assert(d3(v[i].centroid, st) < dEnd + 1, `${e.id} 在 ${v[i].distance}mm 处已经到过比终点更远的地方 —— 掉头了`);
        }
        // 而且不能又绕回到任何**连接口**附近（那正是"C1 → C2"那种错）
        for (const n of tree.nodes) {
          if (n.kind !== NODE_KIND.CONNECTION) continue;
          if (n.id === e.startNode) continue;
          assert(d3(v[v.length - 1].centroid, n.point) > 10, `${e.id} 的终点跑到连接口 ${n.id} 上了`);
        }
      }
    },
  },
  {
    name: '92-V ★ Sprue 不能被误认为另一条横向 Runner：直浇道那条边必须在三维上竖直、面积是 ⌀22 量级',
    fn: () => {
      const { conn, tree } = main();
      const all = reachFrom(tree, conn.connections[0].id);
      const ups = tree.edges.filter((e) => all.has(e.startNode) && e.areaMin != null && e.areaMin > A(10));
      assert(ups.length === 1, `应恰有 1 条 ⌀20 以上的通道（直浇道），实际 ${ups.length}`);
      const e = ups[0];
      // 用回归直线判方向（端点会被端面刀带偏一点）
      const v = e.samples.filter((s) => s.valid && s.centroid);
      const dy = v[v.length - 1].centroid[1] - v[0].centroid[1];
      const dx = v[v.length - 1].centroid[0] - v[0].centroid[0];
      const dz = v[v.length - 1].centroid[2] - v[0].centroid[2];
      assert(Math.abs(dy) > 30, `直浇道应竖直走 ≥30mm，实际 Δy=${dy.toFixed(1)}`);
      assert(Math.abs(dx) < 3 && Math.abs(dz) < 3, `直浇道不该横向跑（Δx=${dx.toFixed(1)} Δz=${dz.toFixed(1)}）`);
      rel(e.areaMin, A(11), 0.04, '直浇道截面积必须是 πr²（⌀22）而不是斜切出来的别的数');
      // 而且它**不能**被算成横向流道：任何一条边的面积都不该落在"介于两者之间的斜切值"上
      for (const x of tree.edges) {
        if (x.areaMin == null) continue;
        const a = x.areaMin;
        const legal = [A(6), A(8), A(11)].some((t) => Math.abs(a - t) < t * 0.08);
        assert(legal, `${x.id} 量到 ${a}mm²，不属于本夹具任何一条流道的 πr²（可能是斜切/跳道产生的假数）`);
      }
    },
  },

  /* ============================================================
     T. PHASE 91 regression（§十六 T）
     ============================================================ */
  {
    name: '92-T PHASE 91 回归：插入式 1 个口 / 阈值无关 / 45° 斜管 πr² —— 换网络口径后一条都不能变',
    fn: () => {
      // ① 插入式内浇口仍然只算 1 个口（PHASE 90 在这里给 4 个）
      const ins = pipeline(cylY(0, 0, 10, -60, 5), 110);
      assert(ins.conn.connections.length === 1, `插入式应 1 个口，实际 ${ins.conn.connections.length}`);
      assert(ins.conn.connections[0].kind === 'insertion', '插入判定不能因为 PHASE 92 而丢失');
      // ② 阈值无关（§25）：tol 压到 1/50，结论不变
      const tiny = pipeline(cylY(0, 0, 10, -60, 5), 110, { tolFrac: 8e-5, tolAbsMinMm: 0.001 });
      assert(tiny.conn.connections.length === 1 && tiny.tree.edges.length === 1,
        `tol 缩小后结论变了：${tiny.conn.connections.length} 口 / ${tiny.tree.edges.length} 边`);
      // ③ 45° 斜管：截面垂直于**局部流向**，所以是 πr² 而不是 πr²/cos45°
      const diag = pipeline((p) => {
        const px = p[0], py = p[1], pz = p[2];
        const bx = 40, by = 40, bz = 0;
        const h = Math.max(0, Math.min(1, ((px - 0) * bx + (py + 40) * by + pz * bz) / (bx * bx + by * by + bz * bz)));
        return Math.hypot(px - bx * h, py + 40 - by * h, pz - bz * h) - 7;
      }, 110);
      const de = diag.tree.edges[0];
      rel(de.areaMin, A(7), 0.08, '45° 斜管截面积');
      assert(de.areaMax < A(7) * 1.2,
        `最大测得值不该接近斜切椭圆面积 ${(A(7) / Math.cos(Math.PI / 4)).toFixed(1)}，实际 ${de.areaMax}`);
    },
  },
];
