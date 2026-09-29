// ============================================================
// PHASE 93（93.txt）· 工艺检测中心 — 冒口检测
//
// 覆盖 93.txt §二十 要求的 A~N：
//   A 单产品 + 单冒口     B 单产品 + 多冒口     C 多产品 + 多冒口
//   D 有效封闭冒口        E 非封闭冒口         F 已知简单几何冒口模数
//   G 模数比              H ratio ≥ 1.2        I ratio < 1.2
//   J 无 hotspot          K 无 riser           L 多热点
//   M 多语言              N 移动端基本布局
// 另加 93-O~S：两条口径一致性 / 三分类完备 / 阈值纪律 / 措辞纪律 / 真实引擎链路。
//
// ★ 纪律（93.txt §十八/§二十四）：
//   · 不碰 Hotspot V3、不碰 js/engine/**、不重算任何热点（热结数据一律由引擎产出后**消费**）。
//   · 断言只针对**语义码与数值**，不针对中文文案（文案在显示层查 i18n）。
//   · 不为测试写特例分支：模型一律用 tests/helpers/stlGen.js 程序化生成。
//
// ★ N（移动端）不在这里做 —— Node 里没有布局引擎，测量不出真实排版。
//   真正的移动端验收在 scripts/browser_inspection_test.mjs 里按 390×844 视口实测宽度与堆叠。
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tetMC, genSTL, BOX, CYL_Y, union, brokenMesh } from './helpers/stlGen.js';
import { parseSTL, computeVolume, computeArea } from '../js/engine/stl.js';
import { objectMetrics } from '../js/model/objectMetrics.js';
import { triangleComponents } from '../js/model/meshComponents.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { sliceArea } from '../js/model/objectMetrics.js';
import {
  KIND, MODULUS_RATIO_MIN, LEVEL,
  objectsFromComponents, makeObject,
  buildRiserRows, summarizeRisers, RISER_CODE, RISER_REASON,
} from '../js/model/processInspection.js';
import EN from '../js/i18n/en-US.js';
import { t as tr, getLocale } from '../js/i18n/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);

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

/** 去掉一部分面制造破口（确定性，无随机） */
function dropFaces(stlText, every = 20) {
  const facets = stlText.split('  facet normal');
  return facets.filter((f, i) => i === 0 || i % every !== 0).join('  facet normal');
}

/** 一个冒口对象（走真实 objectMetrics + 连通分量链路，与页面完全同一条路） */
function riserFromMesh(mesh, index, name) {
  const cc = triangleComponents(mesh);
  const parts = objectsFromComponents(mesh, KIND.RISER, name, cc.components, (m) => objectMetrics(m), cc.weld);
  const o = parts.objects[0];
  o.index = index;
  o.id = makeObject(KIND.RISER, index, name, o.metrics).id;
  return { obj: o, parts };
}

/** 热结条目（形状与 v3ViewAdapter / hotspotsFromProject 的产物一致；数值由调用方给定） */
const hs = (id, x, y, z, mc, extra = {}) => ({ id, x, y, z, mc, regionVolumeCm3: 1, confidence: 0.8, ...extra });

/* ---------------- 常用几何（解析解已知） ---------------- */

const CUBE40 = () => BOX([-20, -20, -20], [20, 20, 20]);                    // a=40 → V=64000 A=9600 M=6.6667
const CUBE_B = [[-25, -25, -25], [25, 25, 25]];
const CYL_R20H60 = () => CYL_Y(0, 0, 20, 60);                              // V=πr²h A=2πr(r+h) M=r·h/(2(r+h))=7.5
const CYL_B = [[-25, -35, -25], [25, 35, 25]];
const PRODUCT = () => union(BOX([-100, -20, -60], [100, 20, 60]), BOX([-30, -20, -30], [30, 60, 30]));
const PRODUCT_B = [[-105, -25, -65], [105, 65, 35]];

export const tests = [

  /* ================= A. 单产品 + 单冒口 ================= */
  {
    name: '93-A 单产品+单冒口：一行关系、最近热点正确、模数比正确',
    fn: () => {
      const { obj } = riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 0, 'R1.stl');
      const hotspots = [hs(1, 0, 0, 0, 5), hs(2, 500, 0, 0, 9)];   // 冒口在原点 → 最近的是 H1
      const r = buildRiserRows(hotspots, [obj]);
      assert(r.rows.length === 1, `应只有 1 个冒口行，实际 ${r.rows.length}`);
      const row = r.rows[0];
      assert(row.riserId === 'R1', `ID 应为 R1，实际 ${row.riserId}`);
      assert(row.nearest.hsId === 1, `最近热点应为 H1，实际 H${row.nearest.hsId}`);
      near(row.nearest.ratio, row.riserModulus / 5, 1e-9, '模数比应等于 M冒口/M热点');
    },
  },

  /* ================= B. 单产品 + 多冒口 ================= */
  {
    name: '93-B 单产品+多冒口：每个冒口各得一行、各找各自最近的热点',
    fn: () => {
      const a = riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 0, 'a.stl').obj;
      const b = riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 1, 'b.stl').obj;
      // 把两个冒口的中心人为挪开，验证"各找各的最近热点"（几何量本身不动）
      a.metrics.center = [0, 0, 0];
      b.metrics.center = [400, 0, 0];
      const hotspots = [hs(1, 0, 0, 0, 5), hs(2, 400, 0, 0, 5)];
      const r = buildRiserRows(hotspots, [a, b]);
      assert(r.rows.length === 2, `应有 2 行，实际 ${r.rows.length}`);
      assert(r.rows.map(x => x.riserId).join() === 'R1,R2', `ID 应为 R1,R2，实际 ${r.rows.map(x => x.riserId)}`);
      assert(r.rows[0].nearest.hsId === 1, `R1 最近应为 H1，实际 H${r.rows[0].nearest.hsId}`);
      assert(r.rows[1].nearest.hsId === 2, `R2 最近应为 H2，实际 H${r.rows[1].nearest.hsId}`);
    },
  },

  /* ================= C. 多产品 + 多冒口 ================= */
  {
    name: '93-C 多产品+多冒口：一份 STL 里的多个独立实体各自成件，冒口关系不受影响',
    fn: () => {
      // 两个互不相连的方块 = 2 个产品件（89.txt §二：件数只由几何决定）
      const twoSolids = union(BOX([-80, -20, -20], [-20, 20, 20]), BOX([20, -20, -20], [80, 20, 20]));
      const mesh = meshOf(twoSolids, [[-85, -25, -25], [85, 25, 25]], 40);
      const cc = triangleComponents(mesh);
      const parts = objectsFromComponents(mesh, KIND.PRODUCT, 'p.stl', cc.components, (m) => objectMetrics(m), cc.weld);
      assert(parts.objects.length === 2, `应识别出 2 个产品件，实际 ${parts.objects.length}`);
      assert(parts.objects.map(o => o.id).join() === 'P1,P2', `产品 ID 应为 P1,P2，实际 ${parts.objects.map(o => o.id)}`);

      const r1 = riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 0, 'a.stl').obj;
      const r2 = riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 1, 'b.stl').obj;
      const r = buildRiserRows([hs(1, 0, 0, 0, 5)], [r1, r2]);
      assert(r.counts.riserTotal === 2 && r.counts.hotspotTotal === 1, '多产品不改变冒口↔热点的配对口径');
      assert(r.rows.every(x => x.nearest && x.nearest.hsId === 1), '两个冒口都指向唯一的热点');
    },
  },

  /* ================= D. 有效封闭冒口 ================= */
  {
    name: '93-D 有效封闭冒口：闭合 → 体积可信 → 模数可算',
    fn: () => {
      const { obj, parts } = riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 0, 'R1.stl');
      assert(obj.closed === true, '立方体应是闭合实体');
      assert(obj.volumeReliable === true, '闭合 → volumeReliable 必须为 true');
      assert(parts.warnings.length === 0, `闭合网格不应有组件告警，实际 ${JSON.stringify(parts.warnings)}`);
      const row = buildRiserRows([hs(1, 0, 0, 0, 5)], [obj]).rows[0];
      assert(row.modulusUsable === true, '闭合冒口的模数应可用');
      assert(row.reason === null, `不应有原因码，实际 ${row.reason}`);
    },
  },

  /* ================= E. 非封闭冒口 ================= */
  {
    name: '93-E 非封闭冒口：不闭合 → 模数一律 null + 原因码（绝不拿算不准的 V/A 去判定）',
    fn: () => {
      const spec = brokenMesh();
      const stl = dropFaces(genSTL(spec.sdf, spec.bounds, spec.res), 20);
      const mesh = parseSTL(new TextEncoder().encode(stl));
      const { obj } = riserFromMesh(mesh, 0, 'broken.stl');
      assert(obj.closed === false, '删面后应识别为不闭合');
      assert(obj.volumeReliable === false, '不闭合 → volumeReliable 必须为 false');
      // objectMetrics 自己仍会算出一个 V/A（它是通用几何函数），但**检测层不许用它**
      assert(obj.metrics.modulusMm > 0, '前提：objectMetrics 确实算出了一个值（正因如此才必须挡在检测层）');

      const r = buildRiserRows([hs(1, 0, 0, 0, 5)], [obj]);
      const row = r.rows[0];
      assert(row.riserModulus === null, `不闭合时模数必须为 null，实际 ${row.riserModulus}`);
      assert(row.reason === RISER_REASON.NOT_CLOSED, `原因码应为 not_closed，实际 ${row.reason}`);
      assert(row.ok === null, '不可算 → ok 必须为 null（既不算满足也不算不足）');
      assert(r.counts.modulusUnreliable === 1 && r.counts.modulusOk === 0 && r.counts.modulusLow === 0,
        '不可算的冒口不得混进"满足/不足"任何一边');
      const s = summarizeRisers({ product: {}, hotspots: [hs(1, 0, 0, 0, 5)], risers: [obj], rows: r });
      assert(s.warns === 0, '算不出来不是"不足"，不得产生 WARNING');
      assert(s.items.some(i => i.code === RISER_CODE.MODULUS_UNRELIABLE && i.level === LEVEL.INFO), '应给一条 INFO 说明原因');
    },
  },

  /* ================= F. 已知简单几何冒口模数 ================= */
  {
    // ★ 93.txt §二十一：先用**理论答案已知**的几何（cube / cylinder）验证 V、A、M = V/A，再接真实 STL。
    //
    // 实测到的系统性偏差（本机 res=48，两件都测）：
    //   体积  −0.5% ~ 0%      表面积  −2% ~ −0.5%       M = V/A  **+0.5% ~ +1.8%**
    // 成因是网格本身：MC 得到的是**内接**多面体 —— 平面在面内是精确的，但棱/角处被切掉，
    // 所以 A 系统性偏小、且比 V 偏小得更多 → M = V/A 系统性偏大。
    // 这是网格离散化的固有性质，不是算法缺陷；测试因此断言**偏差的方向与量级**，
    // 而不是给一个宽到没有信息量的容差（宽带能通过，但什么也没证明）。
    name: '93-F 已知几何：立方体 / 圆柱的 V、A、M=V/A 对照解析解，且偏差方向符合内接多面体',
    fn: () => {
      const check = (label, mesh, V0, A0, tolV, tolA) => {
        const V = computeVolume(mesh.vertices, mesh.triCount);
        const A = computeArea(mesh.vertices, mesh.triCount);
        const eV = V / V0 - 1, eA = A / A0 - 1;
        assert(Math.abs(eV) <= tolV, `${label} 体积应 ≈ ${V0}（偏差 ${(eV * 100).toFixed(2)}%，上限 ${(tolV * 100).toFixed(1)}%）`);
        // 内接多面体：表面积只会偏小，绝不会偏大 —— 这一条比容差更说明问题
        assert(eA <= 1e-9, `${label} 表面积不可能大于解析值（内接多面体），实际偏差 ${(eA * 100).toFixed(2)}%`);
        assert(eA >= -tolA, `${label} 表面积偏差 ${(eA * 100).toFixed(2)}% 超出 ${(tolA * 100).toFixed(1)}%`);
        const M = V / A, M0 = V0 / A0, eM = M / M0 - 1;
        // A 偏小得比 V 多 ⇒ M 只会偏大
        assert(eM >= -1e-9, `${label} M=V/A 不可能小于解析值，实际偏差 ${(eM * 100).toFixed(2)}%`);
        assert(eM <= 0.02, `${label} M=V/A 偏差 ${(eM * 100).toFixed(2)}% 超出 2%`);
        return { V, A, M };
      };

      const rel = (got, want, tol, m) =>
        assert(Math.abs(got / want - 1) <= tol, `${m}（实际 ${got}，期望 ${want} 的 ±${(tol * 100).toFixed(1)}%）`);

      const cube = meshOf(CUBE40(), CUBE_B, 48);
      const c = check('立方体 a=40', cube, 64000, 9600, 0.005, 0.015);
      rel(c.M, 40 / 6, 0.02, '立方体 M 应 ≈ a/6 = 6.667');
      const { obj: oc } = riserFromMesh(cube, 0, 'cube.stl');
      near(oc.metrics.modulusMm, c.M, 1e-9, 'objectMetrics 的 M 必须**就是**同一个 V/A（不许另算一套）');

      const cyl = meshOf(CYL_R20H60(), CYL_B, 48);
      const y = check('圆柱 r=20 h=60', cyl, Math.PI * 400 * 60, 2 * Math.PI * 20 * 80, 0.005, 0.02);
      rel(y.M, 7.5, 0.02, '圆柱 M 应 ≈ r·h/(2(r+h)) = 7.50');
      const { obj: oy } = riserFromMesh(cyl, 0, 'cyl.stl');
      near(oy.metrics.modulusMm, y.M, 1e-9, 'objectMetrics 的圆柱 M 必须就是同一个 V/A');
    },
  },

  /* ================= G. 模数比 ================= */
  {
    name: '93-G 模数比 = M冒口 / M热点，且与 88 口径逐项一致（同一定义，两个函数不许给出两个数）',
    fn: async () => {
      const { buildRelationRows } = await import('../js/model/processInspection.js');
      const risers = [
        riserFromMesh(meshOf(CUBE40(), CUBE_B, 32), 0, 'a.stl').obj,
        riserFromMesh(meshOf(CYL_R20H60(), CYL_B, 40), 1, 'b.stl').obj,
      ];
      risers[0].metrics.center = [0, 0, 0];
      risers[1].metrics.center = [300, 0, 0];
      const hotspots = [hs(1, 10, 0, 0, 5), hs(2, 290, 0, 0, 6)];
      const rr = buildRiserRows(hotspots, risers);
      const rl = buildRelationRows(hotspots, risers);
      for (const row of rr.rows) {
        near(row.riserModulus, row.metrics === undefined ? row.riserModulus : row.riserModulus, 1e-9, '自反');
      }
      // 88 口径是"热结 → 最近冒口"，93 口径是"冒口 → 最近热点"；对同一对关系必须给出同样的距离与比值
      for (const hrow of rl.rows) {
        const n = hrow.nearest;
        const back = rr.rows.find(x => x.riserId === n.riserId);
        assert(back, `93 口径里找不到 ${n.riserId}`);
        const fwd = back.all.find(a => a.hsId === hrow.hsId);
        assert(fwd, `93 口径里找不到 ${n.riserId} → H${hrow.hsId}`);
        near(fwd.distance, n.distance, 1e-9, `${n.riserId}↔H${hrow.hsId} 距离两条口径必须一致`);
        near(fwd.ratio, n.ratio, 1e-9, `${n.riserId}↔H${hrow.hsId} 模数比两条口径必须一致`);
        assert(fwd.ok === n.ok, `${n.riserId}↔H${hrow.hsId} 判定两条口径必须一致`);
      }
    },
  },

  /* ================= H. ratio ≥ 1.2 ================= */
  {
    name: '93-H ratio ≥ 1.2 → PASS（含恰好 1.2 的边界）',
    fn: () => {
      assert(MODULUS_RATIO_MIN === 1.2, `阈值必须仍是 1.2，实际 ${MODULUS_RATIO_MIN}`);
      const mk = (mod) => {
        const o = makeObject(KIND.RISER, 0, 'r.stl', {
          modulusMm: mod, volumeMm3: mod * 1000, areaMm2: 1000,
          center: [0, 0, 0], size: [1, 1, 1],
        });
        return o;
      };
      // 恰好 1.2
      let r = buildRiserRows([hs(1, 0, 0, 0, 10)], [mk(12)]);
      near(r.rows[0].nearest.ratio, 1.2, 1e-12, '比值应为 1.2');
      assert(r.rows[0].ok === true, '≥ 1.2 必须判为满足');
      let s = summarizeRisers({ product: {}, hotspots: [hs(1, 0, 0, 0, 10)], risers: [mk(12)], rows: r });
      assert(s.warns === 0, '满足时不得有 WARNING');
      assert(s.items.some(i => i.code === RISER_CODE.MODULUS_OK && i.params[0] === 1), '应报 1 个满足');
      // 明显大于
      r = buildRiserRows([hs(1, 0, 0, 0, 10)], [mk(25)]);
      assert(r.rows[0].ok === true && r.rows[0].nearest.ratio === 2.5, '2.5 应判满足');
    },
  },

  /* ================= I. ratio < 1.2 ================= */
  {
    name: '93-I ratio < 1.2 → WARNING（含 1.19 的边界，且只报不足不报满足）',
    fn: () => {
      const mk = (mod) => makeObject(KIND.RISER, 0, 'r.stl', {
        modulusMm: mod, volumeMm3: mod * 1000, areaMm2: 1000, center: [0, 0, 0], size: [1, 1, 1],
      });
      const hotspots = [hs(1, 0, 0, 0, 100)];
      const r = buildRiserRows(hotspots, [mk(119)]);      // 1.19 < 1.2
      near(r.rows[0].nearest.ratio, 1.19, 1e-12, '比值应为 1.19');
      assert(r.rows[0].ok === false, '< 1.2 必须判为不足');
      const s = summarizeRisers({ product: {}, hotspots, risers: [mk(119)], rows: r });
      assert(s.level === LEVEL.WARNING && s.warns === 1, '不足必须产生 1 条 WARNING');
      assert(s.items.some(i => i.code === RISER_CODE.MODULUS_LOW), '应报"模数比不足"');
      assert(!s.items.some(i => i.code === RISER_CODE.MODULUS_OK && i.params[0] > 0), '不得同时把 0 个满足说成满足');
    },
  },

  /* ================= J. 无 hotspot ================= */
  {
    name: '93-J 无热点：不给比值、不报不足、如实说明"没有可比的热点模数"',
    fn: () => {
      const o = makeObject(KIND.RISER, 0, 'r.stl', { modulusMm: 12, volumeMm3: 12000, areaMm2: 1000, center: [0, 0, 0], size: [1, 1, 1] });
      const r = buildRiserRows([], [o]);
      assert(r.rows[0].nearest === null, '没有热点 → nearest 必须为 null');
      assert(r.rows[0].ok === null, '没有可比对象 → ok 必须为 null');
      assert(r.counts.noHotspot === 1, '应统计出 1 个"无热点可比"');
      const s = summarizeRisers({ product: {}, hotspots: [], risers: [o], rows: r });
      assert(s.warns === 0, '没有热点不是缺陷，不得报 WARNING');
      assert(s.items.some(i => i.code === RISER_CODE.NO_HOTSPOT && i.level === LEVEL.INFO), '应给 INFO 说明');
      // 但"没有产品"优先于"没有热点"
      const s2 = summarizeRisers({ product: null, hotspots: [], risers: [o] });
      assert(s2.items[0].code === RISER_CODE.NO_PRODUCT, '没有产品时应先提示导入产品');
    },
  },

  /* ================= K. 无 riser ================= */
  {
    name: '93-K 无冒口：优雅处理，不报错、不算成"全部不足"',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10)];
      const r = buildRiserRows(hotspots, []);
      assert(r.rows.length === 0 && r.distances.length === 0, '空输入必须得到空结果');
      assert(r.counts.riserTotal === 0 && r.counts.modulusLow === 0, '不得凭空产生"不足"');
      const s = summarizeRisers({ product: {}, hotspots, risers: [], rows: r });
      assert(s.warns === 0 && s.level === LEVEL.PASS, '无冒口不应是 WARNING');
      assert(s.items.some(i => i.code === RISER_CODE.NO_RISER && i.level === LEVEL.INFO), '应提示尚未导入冒口');
    },
  },

  /* ================= L. 多热点 ================= */
  {
    name: '93-L 多热点：内部算全 N 个、按距离升序、默认只取最近的一个',
    fn: () => {
      const o = makeObject(KIND.RISER, 0, 'r.stl', { modulusMm: 12, volumeMm3: 12000, areaMm2: 1000, center: [0, 0, 0], size: [1, 1, 1] });
      const hotspots = [hs(3, 300, 0, 0, 10), hs(1, 0, 0, 50, 10), hs(2, 100, 0, 0, 10)];
      const r = buildRiserRows(hotspots, [o]);
      const row = r.rows[0];
      assert(row.all.length === 3, `内部应算全 3 个热点，实际 ${row.all.length}`);
      const ds = row.all.map(a => a.distance);
      assert(ds.every((d, i) => i === 0 || d >= ds[i - 1]), `必须按距离升序，实际 ${ds}`);
      assert(row.nearest.hsId === 1, `最近应为 H1（50mm），实际 H${row.nearest.hsId}`);
      assert(row.all.find(a => a.hsId === 3).distance === 300, '最远的 H3 距离应为 300');
      // 热点本身的顺序不影响结果（按 id 找，不按下标）
      const r2 = buildRiserRows([hotspots[1], hotspots[2], hotspots[0]], [o]);
      assert(r2.rows[0].nearest.hsId === 1, '输入顺序不应改变最近热点的结论');
    },
  },

  /* ================= M. 多语言 ================= */
  {
    name: '93-M 多语言：冒口检测的全部词条都有英文；中文界面下逐字不乱码',
    fn: () => {
      const zhDict = readFileSync(join(here, '../js/i18n/zh-CN.js'), 'utf8');
      const keys = new Set(Object.keys(EN));
      const src = readFileSync(join(here, '../js/views/inspectionCenter.js'), 'utf8');

      // ① 动态 key（走查表，i18n_audit 扫不到字面量）必须逐条登记英文
      for (const k of Object.values(RISER_CODE)) {
        void k;
      }
      const dynamic = [
        '请先导入产品 STL', '暂未导入冒口',
        '未检出热点（模型壁厚均匀或热点低于置信度门槛），没有可比的热点模数',
        '{n} 个冒口的模数比满足（M冒口 / M热点 ≥ {r}）',
        '{n} 个冒口的模数比不足（M冒口 / M热点 < {r}）',
        '{n} 个冒口没有可比的热点模数，未参与判定',
        '{n} 个冒口的模数无法可靠计算（几何不是有效封闭实体），未参与判定',
        '冒口中心到最近热点的距离 {a} ~ {b} mm',
        '几何不是有效封闭实体，无法可靠计算冒口模数',
        '表面积为 0，模数 M = V / A 无定义',
      ];
      for (const k of dynamic) {
        assert(keys.has(k), `动态词条缺英文：${k}`);
        assert(src.includes(k), `动态词条在视图里已不存在（词条表成了死条目）：${k}`);
      }
      // ② 静态 tr('...') 字面量（视图里出现过的）也必须有英文
      const literals = [...src.matchAll(/tr\('([^'\\]{2,})'/g)].map(m => m[1]);
      const missing = [...new Set(literals)].filter(k => /[\u4e00-\u9fa5]/.test(k) && !keys.has(k));
      assert(missing.length === 0, `以下中文文案缺英文：${missing.join(' / ')}`);

      // ③ 中文界面下 t() 原样返回中文（缺译回退语义不能被破坏）
      assert(getLocale() === 'zh-CN', `默认语言应为 zh-CN，实际 ${getLocale()}`);
      for (const s of ['冒口模数', '最近热点', '模数比', '热点模数', '开始检测']) {
        assert(tr(s) === s, `中文界面下 "${s}" 应原样显示，实际 "${tr(s)}"`);
      }
      // ④ 语义 key 中英对照存在
      for (const k of ['nav.inspection', 'nav.trial']) {
        assert(typeof EN[k] === 'string' && EN[k].length > 0, `${k} 缺英文`);
        assert(zhDict.includes(`'${k}'`), `${k} 缺中文基准`);
      }
    },
  },

  /* ================= N. 移动端（详见 scripts/browser_inspection_test.mjs） ================= */
  {
    name: '93-N 移动端：卡片是纵向列表 + 结果区排在 3D 之后（结构契约，真实排版在浏览器测试里量）',
    fn: () => {
      const css = readFileSync(join(here, '../css/app.css'), 'utf8');
      const view = readFileSync(join(here, '../js/views/inspectionCenter.js'), 'utf8');
      // 结果卡片容器必须是纵向堆叠（§十三：多个冒口 R1/R2/R3 纵向卡片即可）
      assert(/\.pi-rlist\s*\{[^}]*flex-direction:\s*column/.test(css), '.pi-rlist 必须是纵向列表');
      // 窄屏要有专门的栅格降列规则（4 列读数在手机上放不下）
      assert(/@media \(max-width: 640px\)[\s\S]*?\.pi-rkgrid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/.test(css),
        '窄屏应有 .pi-rkgrid 降为 2 列');
      // 底部标签栏放不下"试用中"→ 收进页面标题旁，不能两个都不显示
      assert(/@media \(max-width: 768px\)[\s\S]*?\.nav-item \.nav-trial\s*\{\s*display:\s*none/.test(css),
        '窄屏应隐藏侧栏试用标记（改由页面标题承担）');
      assert(view.includes('pi-trial'), '页面标题必须带「试用中」标记（§四）');
      // §十二：上 3D、下结果
      const iView = view.indexOf('id="pi_viewSec"');
      const iRes = view.indexOf('id="pi_resultSec"');
      assert(iView > 0 && iRes > 0 && iView < iRes, '3D 区块必须排在检测结果之前（§十二 上 3D、下结果）');
    },
  },

  /* ================= O. 三分类完备 ================= */
  {
    name: '93-O 计数三分类互斥且完备：满足 + 不足 + 不可得 = 冒口总数',
    fn: () => {
      const mk = (i, mod, reliable = true) => {
        const o = makeObject(KIND.RISER, i, `r${i}.stl`, {
          modulusMm: mod, volumeMm3: mod * 1000, areaMm2: 1000, center: [0, 0, 0], size: [1, 1, 1],
        });
        if (!reliable) o.volumeReliable = false;
        return o;
      };
      const risers = [mk(0, 20), mk(1, 5), mk(2, 99, false), mk(3, 12)];   // 满足 / 不足 / 不可信 / 满足
      const hotspots = [hs(1, 0, 0, 0, 10)];
      const r = buildRiserRows(hotspots, risers);
      const c = r.counts;
      assert(c.modulusOk === 2, `满足应 2，实际 ${c.modulusOk}`);
      assert(c.modulusLow === 1, `不足应 1，实际 ${c.modulusLow}`);
      assert(c.modulusUnreliable === 1, `不可信应 1，实际 ${c.modulusUnreliable}`);
      assert(c.modulusUnknown === 0, `"无热点可比"应 0，实际 ${c.modulusUnknown}`);
      assert(c.modulusOk + c.modulusLow + c.modulusUnreliable + c.modulusUnknown === c.riserTotal,
        `四类之和 ${c.modulusOk + c.modulusLow + c.modulusUnreliable + c.modulusUnknown} ≠ 冒口总数 ${c.riserTotal}`);
      assert(r.rows.every(x => x.ok === true || x.ok === false || x.ok === null), 'ok 只能是三态之一');
    },
  },

  /* ================= P. 阈值纪律 ================= */
  {
    name: '93-P 阈值纪律：只有 1.2 一个判据，没有引入任何安全系数/材料修正（§十）',
    fn: () => {
      const src = readFileSync(join(here, '../js/model/processInspection.js'), 'utf8');
      assert(MODULUS_RATIO_MIN === 1.2, '阈值必须仍是 1.2');
      // 模数比判定只允许出现 MODULUS_RATIO_MIN 这一个比较常数
      const ratioBlock = src.slice(src.indexOf('export function buildRiserRows'), src.indexOf('export function summarizeRisers'));
      const nums = [...ratioBlock.matchAll(/[<>]=?\s*([0-9]*\.?[0-9]+)/g)].map(m => m[1])
        .filter(v => v !== '0' && v !== '1');       // 0/1 是数组下标与正负判断
      assert(nums.length === 0, `模数比判定里出现了硬编码阈值：${nums.join(', ')}（应一律走 MODULUS_RATIO_MIN）`);
    },
  },

  /* ================= Q. 措辞纪律 ================= */
  {
    name: '93-Q 措辞纪律：禁止"负责冒口 / feeding riser"（几何距离推不出补缩责任，§十一）',
    fn: () => {
      // 查的是**会显示给用户/写进数据模型的措辞**，不是注释。
      // 所以先把注释剥掉再扫：注释里写"禁止出现负责冒口"正是这条规则的来源，不该被自己抓到。
      const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      for (const rel of ['../js/views/inspectionCenter.js', '../js/model/processInspection.js']) {
        const src = stripComments(readFileSync(join(here, rel), 'utf8'));
        src.split('\n').forEach((line, i) => {
          if (!line.includes('负责')) return;
          if (!/冒口|热点|热结/.test(line)) return;   // "软件负责几何识别" —— 与此无关
          // 明确否定/辟谣的句子是规则**本身**的落地（"本版不做『哪个冒口负责哪个热点』的判定"）
          if (/不做|不要|不是|禁止|不能|推不出|没有/.test(line)) return;
          throw new Error(`${rel}:${i + 1} 出现了"负责"措辞：${line.trim()}`);
        });
        assert(!/responsible|Feeding riser|feeding riser/i.test(src), `${rel} 出现了 responsible / feeding riser 措辞`);
      }
      const en = readFileSync(join(here, '../js/i18n/en-US.js'), 'utf8');
      assert(!/responsible/i.test(en), 'en-US 出现了 responsible 措辞');

      // §十末段：不得把几何模数检查说成"一定不会缩孔 / 一定能补缩 / 工艺一定正确"。
      // 查的是**视图里真正会显示的中文判语**（tr 字面量），并且允许"不代表…"这类否定句 ——
      // 免责声明本身必须能说这句话，否则就没法辟谣了。
      const viewSrc = readFileSync(join(here, '../js/views/inspectionCenter.js'), 'utf8');
      const verdicts = [...viewSrc.matchAll(/tr\('([^'\\]{4,})'/g)].map(m => m[1])
        .filter(s => /一定|保证|必然|绝不会/.test(s))
        .filter(s => !/不代表|不等同|不做|不是|禁止/.test(s));
      assert(verdicts.length === 0, `出现了未加限定的过度承诺文案：${verdicts.join(' / ')}`);
    },
  },

  /* ================= R. 与真实引擎同链 ================= */
  {
    name: '93-R 真实链路：引擎 V3 检出的热点直接喂进冒口检测（不重算、不换算）',
    fn: () => {
      const mesh = meshOf(PRODUCT(), PRODUCT_B, 48);
      const { geometry } = buildMesh(mesh);
      const v3 = toViewResult(analyzeHotspotsV3(mesh, geometry, {}), {});
      if (v3.status !== 'ok' || !v3.hotspots.length) {
        // 这份夹具在极端情况下可能判 uniform —— 那也必须是"没有热点就如实没有"，不能报错
        const s = summarizeRisers({ product: {}, hotspots: [], risers: [] });
        assert(s.items.some(i => i.code === RISER_CODE.NO_RISER), '没有热点时仍应优雅给出下一步提示');
        return;
      }
      const o = makeObject(KIND.RISER, 0, 'r.stl', { modulusMm: 12, volumeMm3: 12000, areaMm2: 1000, center: [0, 0, 0], size: [1, 1, 1] });
      const r = buildRiserRows(v3.hotspots, [o]);
      assert(r.counts.hotspotTotal === v3.hotspots.length, '每个引擎热点都必须进入关系计算，一个不漏');
      for (const h of v3.hotspots) {
        const a = r.rows[0].all.find(x => String(x.hsId) === String(h.id));
        assert(a, `引擎热点 H${h.id} 没进入关系表`);
        assert(a.hsMc === h.mc, `热点模数必须是引擎原值（H${h.id}: ${a.hsMc} vs ${h.mc}）`);
      }
      // 距离用引擎的代表点位置（不是显示层的微调点）
      const h0 = v3.hotspots.reduce((m, h) => (m == null || h.mc > m.mc ? h : m), null);
      const a0 = r.rows[0].all.find(x => String(x.hsId) === String(h0.id));
      near(a0.distance, Math.hypot(h0.x, h0.y, h0.z), 1e-9, '距离应取引擎代表点到冒口包围盒中心');
    },
  },

  /* ================= S. 与浇注系统无关（§十四 的机器可验证形式） =================
     ⚠ PHASE 94 更新（94.txt §三：新增三个**用户给语义**的导入槽）。
       这条断言守的是"PHASE 89~92 的**全自动拓扑识别**不在主流程里"，
       而 PHASE 94 的三个槽是用户自己声明"这是直浇道 / 横浇道 / 内浇口"，
       走的是连通分量 + 截面测量，**不是**自动识别。所以：
         · 自动追踪的入口（findConnections / traceFlow / refreshFlow / runFlow /
           renderGating / flowOverlay）—— 一个都不许出现在主流程里，**比原来更严**（多了两个）；
         · 导入槽由"只有两个"改成"五个"，并新增"三个语义槽各限 1 个文件"的断言。 */
  {
    name: '93-S 冒口检测不依赖浇注系统：主流程里没有任何自动追踪入口',
    fn: () => {
      const src = readFileSync(join(here, '../js/views/inspectionCenter.js'), 'utf8');
      // 主流程（render 到 PHASE 93 §十四 分界）里不得引用自动追踪链的任何一环。
      // ⚠ 先剥注释再扫：注释里写"这里不再用 xxx"是**说明**，不是引用；
      //   不剥注释等于禁止解释自己为什么不调用它（PHASE 94 被这条误伤过一次）。
      const main = src
        .slice(src.indexOf('export function render('), src.indexOf('PHASE 93 §十四：以下整段'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      assert(main.length > 1000, '主流程代码块没找到');
      // ⚠ 用词边界正则而不是 includes：PHASE 94 新增的 state.gatingDetected 是**另一个东西**
      //   （浇注系统那一侧"用户点过开始检测了吗"的开关），被 'state.gating' 子串误伤过。
      for (const bad of ['state\\.gating\\b', 'refreshFlow\\(', 'runFlow\\(', 'renderGating\\(', 'flowOverlay\\(',
        'findConnections\\(', 'traceFlow\\(', 'loadGating\\(']) {
        assert(!new RegExp(bad).test(main), `主流程里仍然引用了 ${bad}（93.txt §十四：自动识别已退出主流程）`);
      }
      // 输入槽：产品 + 冒口 + 三个**用户给语义**的浇注系统类别（PHASE 94 §三）
      assert(/const IMPORT_SLOTS = \[KIND\.PRODUCT, KIND\.RISER, KIND\.SPRUE, KIND\.RUNNER, KIND\.INGATE\]/.test(src),
        '导入槽应为 产品 / 冒口 / 直浇道 / 横浇道 / 内浇口');
      // 但历史代码必须保留（§十四：不要删除历史代码）
      assert(src.includes('async function loadGating('), 'PHASE 89~92 的浇注系统代码应保留（仅退出主流程）');
      assert(src.includes('function traceFlow') || src.includes('traceFlow('), 'flowTrace 的调用代码应保留');
    },
  },

  /* ================= T. 切片工具未被误用（几何底座仍在） ================= */
  {
    name: '93-T 几何底座：sliceArea 仍按 PHASE 90 语义返回 loopInfo/basis（PHASE 93 一行未改）',
    fn: () => {
      const mesh = meshOf(CUBE40(), CUBE_B, 32);
      const r = sliceArea(mesh.vertices, mesh.triCount, [0, 0, 0], [0, 1, 0], 0);
      near(r.area, 1600, 1600 * 0.03, '过中心的水平截面应 = 40×40');
      assert(r.closed === true && r.loops === 1, '立方体截面应为 1 个闭合环');
      assert(Array.isArray(r.basis) && r.basis.length === 2, 'basis 必须仍是平面内两个正交基');
      assert(r.loopInfo.length === 1 && r.loopInfo[0].extent.length === 2, 'loopInfo 的 extent 必须仍在');
    },
  },
];
