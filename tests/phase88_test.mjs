// ============================================================
// PHASE 88（88.txt）· 工艺检验中心
//   Case A  1 Product · 2 Hotspots · 2 Risers —— 数量 / 2×2 距离 / 最近冒口 / 模数比
//   Case B  1 Product · 5 Hotspots · 1 Riser  —— 一个冒口可同时是多个热结的最近冒口
//   Case C  1 Product · 1 Hotspot  · 5 Risers —— 最近冒口选择正确
//   Case D  1 Product · 3 Hotspots · 4 Risers —— 完整 3×4 关系无遗漏
//   Case E  24 Ingates                        —— count / ΣAi / min / max / avg
//   Case F  0 Risers · 0 Ingates              —— 优雅显示，不报错
//   另有：单对象几何度量（体积/面积/M/截面积）与 88.txt §十/§二十 的判据纪律
//
// ★ 88.txt §三十：本文件**不碰**任何 Hotspot GT（engineering-generated / legacy / expected.json）。
//   新功能测试与 Hotspot 回归测试完全分开。
// ★ 断言只针对**语义码与数值**，不针对中文文案（文案在显示层查 i18n）。
// ============================================================
import { tetMC, BOX, union } from './helpers/stlGen.js';
import { parseSTL } from '../js/engine/stl.js';
import { objectMetrics } from '../js/model/objectMetrics.js';
import {
  KIND, MODULUS_RATIO_MIN, LEVEL, SUMMARY_CODE,
  makeObject, buildRelationRows, gatingSummary, summarize,
} from '../js/model/processInspection.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, tol, m) => assert(Math.abs(a - b) <= tol, `${m}（实际 ${a}，期望 ${b}±${tol}）`);

/** 造一个真实 STL 网格（MC）→ 走 stl.js 解析，确保测的是真实链路 */
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

/** 合成冒口对象（不必每次跑 MC；几何数值由 Case A/几何测试单独覆盖） */
const riser = (i, center, modulus) =>
  makeObject(KIND.RISER, i, `R${i + 1}.stl`, { center, modulusMm: modulus, volumeMm3: modulus * 1000, areaMm2: 1000, size: [10, 10, 10], section: { usable: true, rep: 100, min: 100, max: 100 } });

const hs = (id, x, y, z, mc) => ({ id, x, y, z, mc });

export const tests = [
  /* ---------------- Case A ---------------- */
  {
    name: '88-A 1产品·2热结·2冒口：数量 / 2×2 距离 / 最近冒口 / 模数比',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10), hs(2, 100, 0, 0, 20)];
      const risers = [riser(0, [30, 0, 0], 12), riser(1, [130, 0, 0], 30)];

      const rel = buildRelationRows(hotspots, risers);
      assert(rel.counts.hsTotal === 2, `热结数应为 2，实际 ${rel.counts.hsTotal}`);
      assert(rel.counts.riserTotal === 2, `冒口数应为 2，实际 ${rel.counts.riserTotal}`);

      // 2×2 关系：内部必须算全（88.txt §十一）
      const allPairs = rel.rows.flatMap(r => r.all);
      assert(allPairs.length === 4, `内部应有 2×2=4 条关系，实际 ${allPairs.length}`);

      // 距离（中心距）
      near(rel.rows[0].all.find(a => a.riserId === 'R1').distance, 30, 1e-9, 'H1→R1 距离');
      near(rel.rows[0].all.find(a => a.riserId === 'R2').distance, 130, 1e-9, 'H1→R2 距离');
      near(rel.rows[1].all.find(a => a.riserId === 'R1').distance, 70, 1e-9, 'H2→R1 距离');
      near(rel.rows[1].all.find(a => a.riserId === 'R2').distance, 30, 1e-9, 'H2→R2 距离');

      // 最近冒口
      assert(rel.rows[0].nearest.riserId === 'R1', `H1 最近冒口应为 R1，实际 ${rel.rows[0].nearest.riserId}`);
      assert(rel.rows[1].nearest.riserId === 'R2', `H2 最近冒口应为 R2，实际 ${rel.rows[1].nearest.riserId}`);
      // all 按距离升序
      assert(rel.rows[0].all[0].distance <= rel.rows[0].all[1].distance, 'all 应按距离升序');

      // 模数比：R1/H1 = 12/10 = 1.2（恰好达标）；R2/H2 = 30/20 = 1.5
      near(rel.rows[0].nearest.ratio, 1.2, 1e-9, 'H1 M 比');
      near(rel.rows[1].nearest.ratio, 1.5, 1e-9, 'H2 M 比');
      assert(rel.rows[0].nearest.ok === true, 'M 比 1.2 应判为满足（判据是 ≥ 1.2）');
      assert(rel.rows[1].nearest.ok === true, 'M 比 1.5 应判为满足');
      assert(rel.counts.modulusOk === 2 && rel.counts.modulusLow === 0, '2 个热结模数均应满足');

      const s = summarize({ hotspots, risers, relations: rel, product: {} });
      assert(s.warns === 0, '不应有 WARNING');
      assert(s.items.some(i => i.code === SUMMARY_CODE.DISTANCE_RANGE), '应给出距离区间');
      const dr = s.items.find(i => i.code === SUMMARY_CODE.DISTANCE_RANGE);
      near(dr.params[0], 30, 1e-9, '最近距离最小值'); near(dr.params[1], 30, 1e-9, '最近距离最大值');
    },
  },

  /* ---------------- Case B ---------------- */
  {
    name: '88-B 1产品·5热结·1冒口：一个冒口可同时作为多个热结的最近冒口',
    fn: () => {
      const hotspots = [0, 1, 2, 3, 4].map(i => hs(i + 1, i * 50, 0, 0, 10));
      const risers = [riser(0, [100, 0, 0], 20)];
      const rel = buildRelationRows(hotspots, risers);

      assert(rel.counts.hsTotal === 5 && rel.counts.riserTotal === 1, '数量应为 5 热结 / 1 冒口');
      assert(rel.rows.every(r => r.nearest && r.nearest.riserId === 'R1'), '5 个热结的最近冒口都应是 R1');
      assert(rel.counts.covered === 5, `应 5 个热结都有最近冒口，实际 ${rel.counts.covered}`);
      assert(rel.counts.modulusOk === 5, 'M 比 2.0，5 个都应满足');
      // 距离各自不同
      const ds = rel.rows.map(r => r.nearest.distance);
      near(ds[0], 100, 1e-9, 'H1 距离'); near(ds[4], 100, 1e-9, 'H5 距离');
      assert(Math.abs(ds[0] - ds[2]) > 1, '不同热结到同一冒口的距离应不同');
    },
  },

  /* ---------------- Case C ---------------- */
  {
    name: '88-C 1产品·1热结·5冒口：最近冒口选择正确',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10)];
      const centers = [[500, 0, 0], [-500, 0, 0], [0, 500, 0], [3, 4, 0], [0, 0, -900]];
      const risers = centers.map((c, i) => riser(i, c, 15));
      const rel = buildRelationRows(hotspots, risers);
      assert(rel.rows[0].nearest.riserId === 'R4', `最近应为 R4（距离 5），实际 ${rel.rows[0].nearest.riserId}`);
      near(rel.rows[0].nearest.distance, 5, 1e-9, 'R4 距离应为 5');
      assert(rel.rows[0].all.length === 5, `应保留全部 5 个冒口距离，实际 ${rel.rows[0].all.length}`);
      // 升序完整
      for (let i = 1; i < 5; i++) assert(rel.rows[0].all[i - 1].distance <= rel.rows[0].all[i].distance, 'all 升序');
    },
  },

  /* ---------------- Case D ---------------- */
  {
    name: '88-D 1产品·3热结·4冒口：完整 3×4 关系无遗漏',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10), hs(2, 200, 0, 0, 10), hs(3, 400, 0, 0, 10)];
      const risers = [0, 1, 2, 3].map(i => riser(i, [i * 150, 100, 0], 15));
      const rel = buildRelationRows(hotspots, risers);
      assert(rel.rows.length === 3, '3 个热结');
      for (const r of rel.rows) {
        assert(r.all.length === 4, `每个热结应有 4 条冒口关系，实际 ${r.all.length}`);
        const ids = r.all.map(a => a.riserId).sort().join(',');
        assert(ids === 'R1,R2,R3,R4', `关系应覆盖 R1~R4，实际 ${ids}`);
        assert(r.nearest.distance === Math.min(...r.all.map(a => a.distance)), '最近冒口 = 距离最小者');
      }
    },
  },

  /* ---------------- Case E ---------------- */
  {
    name: '88-E 24 个内浇口：count / ΣAi（逐个求和）/ min / max / avg',
    fn: () => {
      const N = 24;
      const areas = Array.from({ length: N }, (_, i) => 72 + i);   // 72…95，故意不等
      const ingates = areas.map((a, i) => makeObject(KIND.INGATE, i, `I${i + 1}.stl`, {
        volumeMm3: 1000, areaMm2: 500, modulusMm: 2,
        size: [20, 8, 6], center: [0, 0, 0],
        section: { usable: true, rep: a, min: a, max: a },
      }));
      const g = gatingSummary({ ingates });
      const sum = areas.reduce((s, a) => s + a, 0);   // 测试里独立算一遍

      assert(g.ingate.count === 24, `数量应为 24，实际 ${g.ingate.count}`);
      assert(g.ingateArea.usable === true, '24 个都算得出，应可用');
      near(g.ingateArea.totalMm2, sum, 1e-9, '总截面积 = ΣAi');
      near(g.ingateArea.minMm2, 72, 1e-9, '最小');
      near(g.ingateArea.maxMm2, 95, 1e-9, '最大');
      near(g.ingateArea.avgMm2, sum / 24, 1e-9, '平均 = ΣAi / 24');
      // 88.txt §二十：总截面积是**逐个相加**，不是"平均 × 数量"的近似
      assert(g.ingateArea.perIngate.length === 24, '每个内浇口必须保留独立结果 Ii→Ai');
      assert(g.ingateArea.perIngate[0].id === 'I1' && g.ingateArea.perIngate[23].id === 'I24', 'ID 应为 I1…I24');
      near(g.ingateArea.perIngate[7].area, 79, 1e-9, 'I8 的面积');
    },
  },

  /* ---------------- Case E2：不可靠时不给数（不猜） ---------------- */
  {
    name: '88-E2 部分内浇口截面积不可靠 → 不给总截面积（不猜测）',
    fn: () => {
      const mk = (i, usable, a) => makeObject(KIND.INGATE, i, `I${i + 1}.stl`, {
        volumeMm3: 1000, areaMm2: 500, modulusMm: 2, size: [10, 10, 10], center: [0, 0, 0],
        section: usable ? { usable: true, rep: a, min: a, max: a } : { usable: false, rep: null, min: null, max: null, reason: 'open_loops' },
      });
      const g = gatingSummary({ ingates: [mk(0, true, 80), mk(1, false, null), mk(2, true, 100)] });
      assert(g.ingate.count === 3, '数量仍应如实为 3');
      assert(g.ingateArea.usable === false, '有一个算不出 → 汇总不可用');
      assert(g.ingateArea.perIngate[1].area === null, '不可用的那个必须是 null，不能填 0');
      assert(g.ingateArea.countUsed === 2, `可用的应为 2，实际 ${g.ingateArea.countUsed}`);
    },
  },

  /* ---------------- Case F ---------------- */
  {
    name: '88-F 0 冒口 · 0 内浇口：优雅处理，不报错、不算成"全部不足"',
    fn: () => {
      const hotspots = [hs(1, 0, 0, 0, 10), hs(2, 10, 0, 0, 12)];
      const rel = buildRelationRows(hotspots, []);
      assert(rel.counts.riserTotal === 0 && rel.counts.covered === 0, '无冒口时不应有"已覆盖"');
      assert(rel.rows.every(r => r.nearest === null), '无冒口时 nearest 应为 null');
      assert(rel.counts.modulusLow === 0, '★ 无冒口**不得**被算成"模数不足"');

      const s = summarize({ hotspots, risers: [], relations: rel, product: {} });
      assert(s.warns === 0, '无冒口是 INFO，不是 WARNING');
      assert(s.items.some(i => i.code === SUMMARY_CODE.NO_RISER), '应给出 no_riser 语义码');

      const g = gatingSummary({});
      assert(g.ingate.count === 0 && g.ingateArea.totalMm2 === 0, '无内浇口时总截面积为 0');
      assert(g.ingateArea.usable === false, '无内浇口时不应声称"汇总可用"');
      assert(g.ingateArea.avgMm2 === null && g.ingateArea.minMm2 === null, '无内浇口时不给出平均/最小');

      // 无产品
      const s2 = summarize({ hotspots: [], risers: [], product: null });
      assert(s2.items.some(i => i.code === SUMMARY_CODE.NO_PRODUCT), '无产品 → no_product');
      // 有产品无热结
      const s3 = summarize({ hotspots: [], risers: [], product: {} });
      assert(s3.items.some(i => i.code === SUMMARY_CODE.NO_HOTSPOT), '有产品无热结 → no_hotspot');
    },
  },

  /* ---------------- 判定纪律（88.txt §十 / §十三 / §二十六） ---------------- */
  {
    name: '88-判据 模数比阈值 1.2 的边界 + 距离不参与 PASS/FAIL',
    fn: () => {
      assert(MODULUS_RATIO_MIN === 1.2, '经验判据常数应为 1.2（88.txt §十）');
      const mk = (mc, rm) => {
        const hotspots = [hs(1, 0, 0, 0, mc)];
        const risers = [riser(0, [10, 0, 0], rm)];
        return buildRelationRows(hotspots, risers).rows[0].nearest;
      };
      assert(mk(10, 12).ok === true, '恰好 1.20 → 满足（≥ 1.2）');
      assert(mk(10, 11.99).ok === false, '1.199 → 不足');
      assert(mk(10, 12.01).ok === true, '1.201 → 满足');
      // 冒口模数不可得 → ok 为 null（既不算满足也不算不足）
      const hotspots = [hs(1, 0, 0, 0, 10)];
      const risers = [makeObject(KIND.RISER, 0, 'R1.stl', { center: [0, 0, 0], modulusMm: null })];
      const n = buildRelationRows(hotspots, risers).rows[0].nearest;
      assert(n.ok === null, '冒口模数为 null 时 ok 应为 null');
      const s = summarize({ hotspots, risers, relations: buildRelationRows(hotspots, risers), product: {} });
      assert(s.warns === 0, '模数不可得是 INFO，不应报 WARNING');
      assert(s.items.some(i => i.code === SUMMARY_CODE.MODULUS_UNKNOWN), '应给出 modulus_unknown');
      // 距离远近不影响 warning 数（88.txt §十三：不设距离红线）
      const far = buildRelationRows([hs(1, 0, 0, 0, 10)], [riser(0, [99999, 0, 0], 50)]);
      const sf = summarize({ hotspots: [hs(1, 0, 0, 0, 10)], risers: [riser(0, [99999, 0, 0], 50)], relations: far, product: {} });
      assert(sf.warns === 0, '★ 距离再远也不得产生 WARNING（本版无距离红线）');
    },
  },

  /* ---------------- 单对象几何度量（真实 STL 链路） ---------------- */
  {
    name: '88-几何 立方体 100³：V / A / M=V/A / 截面积',
    fn: () => {
      const mesh = meshOf(BOX([-50, -50, -50], [50, 50, 50]), [[-55, -55, -55], [55, 55, 55]], 48);
      const m = objectMetrics(mesh);
      near(m.volumeMm3, 1e6, 2e4, '体积');
      near(m.areaMm2, 6e4, 1800, '表面积');
      near(m.modulusMm, 1e6 / 6e4, 0.85, '模数 M = V/A');
      assert(m.section?.usable === true, '立方体截面积应可用');
      near(m.section.rep, 1e4, 500, '中段截面积 ≈ 100×100');
    },
  },
  {
    name: '88-几何 圆柱 ⌀40×200：主轴 = 长轴，截面积 = πr²',
    fn: () => {
      const v = tetMC((p) => Math.max(Math.hypot(p[0], p[2]) - 20, Math.abs(p[1]) - 100),
        [[-30, -105, -30], [30, 105, 30]], 64);
      const mesh = { vertices: v, triCount: v.length / 9 };
      const m = objectMetrics(mesh);
      assert(Math.abs(m.axisDir[1]) > 0.99, `主轴应为 Y（长轴），实际 ${m.axisDir.map(x => x.toFixed(2))}`);
      near(m.section.rep, Math.PI * 400, 63, '截面积 ≈ π·20²');
      near(m.modulusMm, (Math.PI * 400 * 200) / (2 * Math.PI * 20 * 200 + 2 * Math.PI * 400), 0.6, '圆柱模数 M=V/A');
    },
  },
  {
    name: '88-几何 破网格（未闭合环）→ 截面积拒绝给数',
    fn: () => {
      const v = tetMC(BOX([-30, -30, -30], [30, 30, 30]), [[-35, -35, -35], [35, 35, 35]], 40);
      const n = (v.length / 9) | 0;
      const cut = v.slice(0, Math.floor(n * 0.6) * 9);
      const m = objectMetrics({ vertices: cut, triCount: (cut.length / 9) | 0 });
      assert(m.section?.usable === false, '破网格不得声称截面积可用');
      assert(m.section.rep === null, '破网格不得给出截面积数值');
      assert(m.warnings.some(w => w.startsWith('section_')), `应记录 section_* 警告，实际 ${m.warnings}`);
    },
  },
  {
    name: '88-几何 截面积基准轴可切换（扁宽件的"充型方向不可判定"）',
    fn: () => {
      // 30(X) × 8(Y) × 6(Z)：充型沿 Y 时真实浇口截面 = 30×6 = 180
      const v = tetMC(BOX([-15, -4, -3], [15, 4, 3]), [[-20, -9, -8], [20, 9, 8]], 72);
      const mesh = { vertices: v, triCount: v.length / 9 };
      const p = objectMetrics(mesh);                                    // 主轴 ≈ X（最长边）
      const my = objectMetrics(mesh, { axisMode: 'y' });
      const mz = objectMetrics(mesh, { axisMode: 'z' });
      near(p.section.rep, 48, 5, '主轴(X) 截面 = 8×6');
      near(my.section.rep, 180, 18, 'Y 基准截面 = 30×6（真实浇口方向）');
      near(mz.section.rep, 240, 24, 'Z 基准截面 = 30×8');
    },
  },
  {
    name: '88-几何 多实例：两个独立实体的体积/表面积求和（不重不漏）',
    fn: () => {
      const mesh = meshOf(union(BOX([-60, -10, -10], [-20, 10, 10]), BOX([20, -10, -10], [60, 10, 10])),
        [[-65, -15, -15], [65, 15, 15]], 64);
      const m = objectMetrics(mesh);
      near(m.volumeMm3, 2 * (40 * 20 * 20), 1000, '两体体积之和 = 2×16000');
    },
  },

  /* ---------------- 多实例对象模型（88.txt §六） ---------------- */
  {
    name: '88-多实例 ID 命名：R1…Rn / S1…Sn / G1…Gn / I1…In 连续且与类别解耦',
    fn: () => {
      const mk = (kind, n) => Array.from({ length: n }, (_, i) => makeObject(kind, i, `f${i}.stl`, {}).id);
      assert(mk(KIND.RISER, 3).join(',') === 'R1,R2,R3', '冒口 R1…Rn');
      assert(mk(KIND.SPRUE, 2).join(',') === 'S1,S2', '直浇道 S1…Sn');
      assert(mk(KIND.RUNNER, 4).join(',') === 'G1,G2,G3,G4', '横浇道 G1…Gn');
      assert(mk(KIND.INGATE, 24)[23] === 'I24', '内浇口 I1…I24');
      assert(makeObject(KIND.PRODUCT, 0, 'p.stl', {}).id === 'P1', '产品 P1');
      // 多实例：同类 N 个对象各自独立，互不覆盖
      const list = Array.from({ length: 24 }, (_, i) => makeObject(KIND.INGATE, i, `I${i + 1}.stl`, { volumeMm3: i }));
      assert(list.length === 24 && list[23].metrics.volumeMm3 === 23, 'N 个对象必须各自独立');
    },
  },
];
