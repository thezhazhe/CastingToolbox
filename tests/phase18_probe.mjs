// ============================================================
// PHASE 18 只读诊断（23.txt 一：NO_INSIDE_POINTS 完整触发链定位）
// 目标：复现"正常 STL 经常 NO_INSIDE_POINTS"，定位真正阻塞内部点产生的位置：
//   STL → bounds → 16³探测 → estMinWall(vs) → 主网格 voxelize → inside pts → NO_INSIDE_POINTS
// 重点验证假设：
//   H1: 16³ 探测失败(probeInside=0) → fallback estMinWall=mdim/40 → vs=mdim/80
//       → 主网格格距 ≥ 壁厚 → 壁内无落点 → 0 内部点 → NO_INSIDE_POINTS
//   H2: 壁厚 ∈ (mdim/80, mdim/40) 区间相位敏感
// 用法: node tests/phase18_probe.mjs
// ============================================================
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { scanInside } from '../js/engine/distanceField.js';
import { distanceToSurface } from '../js/engine/mesh3d.js';
import { adaptiveVs, coarseSample } from '../js/engine/v3/sampling.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { V3_DEFAULTS } from '../js/engine/v3/configV3.js';
import { tetMC, BOX, subtract, union } from './helpers/stlGen.js';

const HS_STATUS = { OK: 'OK', NO_HOTSPOT: 'NO_HOTSPOT', LOW_CONFIDENCE: 'LOW_CONFIDENCE', INSUFFICIENT_RESOLUTION: 'INSUFFICIENT_RESOLUTION' };
const o = { ...V3_DEFAULTS };

/* ================= 构造模型 ================= */
const shell = (L, W, H, w) => ({
  sdf: subtract(
    BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]),
    BOX([-(L / 2 - w), -(W / 2 - w), -(H / 2 - w)], [L / 2 - w, W / 2 - w, H / 2 - w]),
  ),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -H / 2 - 5], [L / 2 + 5, W / 2 + 5, H / 2 + 5]],
});
const plate = (L, W, t) => ({
  sdf: BOX([-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -t / 2 - 5], [L / 2 + 5, W / 2 + 5, t / 2 + 5]],
});
/** 壳 + 顶部凸台（真实铸件常见：壳体壁 + 局部厚区） */
const shellWithBoss = (L, W, H, w, boss) => ({
  sdf: union(
    subtract(
      BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]),
      BOX([-(L / 2 - w), -(W / 2 - w), -(H / 2 - w)], [L / 2 - w, W / 2 - w, H / 2 - w]),
    ),
    BOX([-boss / 2, -boss / 2, H / 2 - w], [boss / 2, boss / 2, H / 2 - w + boss]),
  ),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -H / 2 - 5], [L / 2 + 5, W / 2 + 5, H / 2 - w + boss + 5]],
});
/** 非均匀壁厚：板 + 局部加厚区（台阶） */
const steppedPlate = (L, W, t, stepW, stepH) => ({
  sdf: union(
    BOX([-L / 2, -W / 2, -t / 2], [L / 2, W / 2, t / 2]),
    BOX([-stepW / 2, -stepW / 2, t / 2], [stepW / 2, stepW / 2, t / 2 + stepH]),
  ),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -t / 2 - 5], [L / 2 + 5, W / 2 + 5, t / 2 + stepH + 5]],
});
/** 空腔结构：外板厚 + 内腔（腔体四周留壁）——箱体开盖 */
const cavityBox = (L, W, H, w) => ({
  sdf: (p) => {
    const outer = BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2])(p);
    const inner = BOX([-(L / 2 - w), -(W / 2 - w), -H / 2 - 1], [L / 2 - w, W / 2 - w, H / 2 - w])(p);
    return Math.max(outer, -inner);   // 底部开口（开盖箱体）
  },
  bounds: [[-L / 2 - 5, -W / 2 - 5, -H / 2 - 5], [L / 2 + 5, W / 2 + 5, H / 2 + 5]],
});

const pickRes = (mdim, minFeature) => Math.min(160, Math.max(72, Math.ceil(2 * mdim / minFeature)));

/* ================= 模型清单 ================= */
const MODELS = [];
// H1/H2 边界矩阵：尺寸 × 壁厚（mdim/80 与 mdim/16 边界）
for (const [L, W, H] of [[1000, 800, 600], [2000, 1200, 800], [500, 400, 300]]) {
  for (const w of [5, 8, 10, 15, 20, 30]) {
    MODELS.push({ id: `shell${L}_w${w}`, src: '壳', desc: `${L}mm 壳壁 ${w}mm`, build: () => ({ ...shell(L, W, H, w), res: pickRes(L, w) }) });
  }
}
// 结构类
MODELS.push({ id: 'shell1000_w10_boss80', src: '壳+凸台', desc: '1m 壳壁 10mm + 80 boss', build: () => ({ ...shellWithBoss(1000, 800, 600, 10, 80), res: pickRes(1000, 10) }) });
MODELS.push({ id: 'plate1000_w8', src: '板', desc: '1m 板 8mm', build: () => ({ ...plate(1000, 1000, 8), res: pickRes(1000, 8) }) });
MODELS.push({ id: 'plate2000_w15', src: '板', desc: '2m 板 15mm', build: () => ({ ...plate(2000, 1500, 15), res: pickRes(2000, 15) }) });
MODELS.push({ id: 'cavity1000_w10', src: '空腔', desc: '1m 开盖箱壁 10mm', build: () => ({ ...cavityBox(1000, 800, 400, 10), res: pickRes(1000, 10) }) });
MODELS.push({ id: 'stepped1000_w10_40', src: '非均匀', desc: '1m 板 10mm + 中部 40mm 厚区', build: () => ({ ...steppedPlate(1000, 800, 10, 400, 30), res: pickRes(1000, 10) }) });

/** 16³ 探测（复刻 adaptiveVs Stage 1-2） */
function probeAt(geometry, bounds, globalMin, mdim, gs) {
  const pvs = mdim / gs;
  const probe = scanInside(geometry, bounds, gs, pvs, globalMin);
  const pts = [];
  for (let i = 0; i < gs; i++) for (let j = 0; j < gs; j++) for (let k = 0; k < gs; k++) {
    if (!probe[(i * gs + j) * gs + k]) continue;
    pts.push([bounds.min[0] + (i + 0.5) * pvs, bounds.min[1] + (j + 0.5) * pvs, bounds.min[2] + (k + 0.5) * pvs]);
  }
  const dists = pts.length ? distanceToSurface(geometry, pts) : [];
  const chars = dists.filter(d => d !== null && d > 0.001 && d * 2 >= o.charFilterMin).map(d => d * 2).sort((a, b) => a - b);
  return { nPts: pts.length, nChars: chars.length, p10: chars.length >= 8 ? chars[Math.floor(chars.length * 0.1)] : null };
}

/** 主网格相位敏感测试：同 vs 偏移 0 / 半格，看内部点数量 */
function mainGridPts(geometry, bounds, globalMin, gs, vs, offsetFrac) {
  const off = vs * offsetFrac;
  const probe = scanInside(geometry, bounds, gs, vs, globalMin); // scanAxis 内部不支持偏移——这里用整体坐标偏移近似
  void probe; void off;
  return 0; // 占位（scanAxis 偏移需改 scanInside 支持，见实施阶段）
}

async function main() {
  const rows = [];
  const tStart = Date.now();
  for (const m of MODELS) {
    const { sdf, bounds, res } = m.build();
    const verts = tetMC(sdf, bounds, res);
    const mesh = { vertices: verts, triCount: verts.length / 9 };
    const { geometry } = buildMesh(mesh);
    const g = analyzeGeometry(mesh, geometry);
    const bb = { min: g.bounds.min, max: g.bounds.max, size: g.size };
    const mdim = Math.max(...g.size);
    const globalMin = bb.min;

    // 触发链分段
    const p16 = probeAt(geometry, bb, globalMin, mdim, 16);
    const av = adaptiveVs(geometry, bb, globalMin, o);
    const fallback = Math.abs(av.estMinWall - mdim / o.coarseResolution) < mdim * 0.01;
    const coarse = coarseSample(mesh, geometry, o);
    const v3 = analyzeHotspotsV3(mesh, geometry, {});

    rows.push({
      id: m.id, src: m.src, desc: m.desc,
      mdim: Math.round(mdim),
      probe16: p16.nPts, nChars16: p16.nChars, p10_16: p16.p10 ? +p16.p10.toFixed(1) : null,
      fallback, estMinWall: +av.estMinWall.toFixed(1), vs: +av.vs.toFixed(1), gs: coarse.gs,
      vsFloor: +(mdim / o.coarseMaxRes).toFixed(1),
      insidePts: coarse.pts.length, status: v3.status, reason: v3.reason || null,
    });
    const r = rows.at(-1);
    console.log(`[${rows.length}/${MODELS.length}] ${r.id}: 16³探=${r.probe16} pts | estMinWall=${r.estMinWall} vs=${r.vs} (floor=${r.vsFloor}) | 主网格 pts=${r.insidePts} | ${r.status}${r.reason ? ':' + r.reason : ''}${r.insidePts === 0 ? '  ★ NO_INSIDE_POINTS' : ''}`);
  }
  console.log(`\n耗时 ${((Date.now() - tStart) / 1000).toFixed(1)}s\n`);

  console.log('===== 触发链表 =====');
  console.log('id | src | mdim | probe16 | nChars16 | p10_16 | fallback | estMinWall | vs | floor(mdim/128) | gs | insidePts | status');
  for (const r of rows) {
    console.log([r.id, r.src, r.mdim, r.probe16, r.nChars16, r.p10_16 ?? '-', r.fallback, r.estMinWall, r.vs, r.vsFloor, r.gs, r.insidePts, r.status].join(' | '));
  }

  // 边界统计
  const bad = rows.filter(r => r.insidePts === 0);
  console.log(`\n★ NO_INSIDE_POINTS: ${bad.length}/${rows.length} → ${bad.map(r => r.id).join(', ')}`);
  for (const r of bad) console.log(`  ${r.id}: 16³探=${r.probe16}pts fallback=${r.fallback} vs=${r.vs}（mdim/80=${(r.mdim / 80).toFixed(1)}）`);
  const nearBad = rows.filter(r => r.insidePts > 0 && r.insidePts < 100);
  if (nearBad.length) console.log(`⚠ 内部点极少(<100): ${nearBad.map(r => `${r.id}(${r.insidePts})`).join(', ')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
