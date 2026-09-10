// ============================================================
// PHASE 19 只读诊断（24.txt 三：对"实际失败 STL"做全链路追踪）
// 目标：确认「距离场无有效采样：壁厚可能小于网格采样极限」（INSUFFICIENT_NO_SAMPLE）
//       的真实触发链——这是 designCenter → diagnoseSTL → buildDistanceField(V2 48³/96³)
//       独立链路，与 PHASE 17/18 修的 V3 sampling.js 链不同。
// 用法: node tests/phase19_probe.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { buildDistanceField, DISTANCE_DEFAULTS } from '../js/engine/distanceField.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';
import { diagnoseSTL, thicknessStats } from '../js/engine/stlDiagnostic.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { tetMC, BOX, subtract } from './helpers/stlGen.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HS_STATUS = { OK: 'OK', NO_HOTSPOT: 'NO_HOTSPOT', LOW_CONFIDENCE: 'LOW_CONFIDENCE', INSUFFICIENT_RESOLUTION: 'INSUFFICIENT_RESOLUTION' };

const shell = (L, W, H, w) => ({
  sdf: subtract(
    BOX([-L / 2, -W / 2, -H / 2], [L / 2, W / 2, H / 2]),
    BOX([-(L / 2 - w), -(W / 2 - w), -(H / 2 - w)], [L / 2 - w, W / 2 - w, H / 2 - w]),
  ),
  bounds: [[-L / 2 - 5, -W / 2 - 5, -H / 2 - 5], [L / 2 + 5, W / 2 + 5, H / 2 + 5]],
});
const pickRes = (mdim, minFeature) => Math.min(160, Math.max(72, Math.ceil(2 * mdim / minFeature)));

/** 真实铸件最接近的工程文件 + 构造大件薄壁（24.txt 三/九：真实场景优先） */
const MODELS = [
  { id: 't19_valveLike', src: '工程文件', desc: '阀体（真实结构）' },
  { id: 't20_combinedBox', src: '工程文件', desc: '组合箱体' },
  { id: 't08_pipeFlange70', src: '工程文件', desc: '管法兰' },
  { id: 't09_boxInner80', src: '工程文件', desc: '内腔箱体' },
  { id: 't16_extreme_10_100', src: '工程文件', desc: '10mm 薄板 + 100mm 厚块' },
  { id: 't02_thin10_boss60', src: '工程文件', desc: '10mm 板 + 60mm boss' },
  { id: 'shell2000_w15', src: '构造', desc: '2m 壳壁 15mm（大尺寸+常规壁厚）', build: () => ({ ...shell(2000, 1200, 800, 15), res: pickRes(2000, 15) }) },
  { id: 'shell2000_w20', src: '构造', desc: '2m 壳壁 20mm', build: () => ({ ...shell(2000, 1200, 800, 20), res: pickRes(2000, 20) }) },
  { id: 'shell3000_w25', src: '构造', desc: '3m 壳壁 25mm', build: () => ({ ...shell(3000, 2000, 1200, 25), res: pickRes(3000, 25) }) },
  { id: 'shell1000_w10', src: '构造', desc: '1m 壳壁 10mm', build: () => ({ ...shell(1000, 800, 600, 10), res: pickRes(1000, 10) }) },
];

async function main() {
  const rows = [];
  for (const m of MODELS) {
    let mesh;
    if (m.src === '工程文件') {
      mesh = parseSTL(readFileSync(join(HERE, 'engineering-generated', 'models', m.id, 'model.stl')));
    } else {
      const { sdf, bounds, res } = m.build();
      const verts = tetMC(sdf, bounds, res);
      mesh = { vertices: verts, triCount: verts.length / 9 };
    }
    const { geometry } = buildMesh(mesh);
    const bounds = { min: [0, 1, 2].map(a => mesh.vertices[a]), max: [0, 1, 2].map(a => mesh.vertices[mesh.triCount * 9 + a]) };
    void bounds;

    // ① V2 距离场（diagnoseSTL 同路径，buildDistanceField 默认参数）
    const df = buildDistanceField(mesh, geometry, {});
    const ts = thicknessStats(df);
    // ② V2 geometry 分析（wallMain/wallMax——PHASE 17 bodyWallOf 的数据源）
    const g = analyzeGeometry(mesh, geometry);
    // ③ V3 热结分析（PHASE 18 修复后的链）
    const v3 = analyzeHotspotsV3(mesh, geometry, {});
    // ④ diagnoseSTL 完整出口（UI 实际显示）
    const diag = diagnoseSTL(mesh, geometry, v3);

    rows.push({
      id: m.id, src: m.src,
      triCount: mesh.triCount,
      mdim: Math.round(Math.max(...g.size)),
      // V2 距离场
      df_gs: df.gs, df_vs: +df.vs.toFixed(1),
      df_inside: df.insideIdx.length,
      df_valid: ts.samples, df_status: ts.status,
      // V2 geometry
      wallMain: +g.wallMain.toFixed(1), wallAvg: +g.wallAvg.toFixed(1), wallMax: +g.wallMax.toFixed(1),
      // V3
      v3_status: v3.status, v3_pts: v3.debug?.coarse?.pts ?? null,
      // UI 实际出口
      diag_status: diag.distanceField.status, diag_thick: diag.thickness?.status,
    });
    const r = rows.at(-1);
    const flag = r.df_valid === 0 ? ' ★「距离场无有效采样」' : '';
    console.log(`[${rows.length}/${MODELS.length}] ${r.id}: V2df gs=${r.df_gs} vs=${r.df_vs} inside=${r.df_inside} valid=${r.df_valid} ${r.df_status} | wallMain=${r.wallMain} wallMax=${r.wallMax} | V3 ${r.v3_status} pts=${r.v3_pts}${flag}`);
  }

  console.log('\n===== 触发链表（V2 距离场 = UI 提示来源）=====');
  console.log('id | tri | mdim | df_gs | df_vs | df_inside | df_valid | df_status | wallMain | wallAvg | wallMax | v3_status | v3_pts');
  for (const r of rows) {
    console.log([r.id, r.triCount, r.mdim, r.df_gs, r.df_vs, r.df_inside, r.df_valid, r.df_status, r.wallMain, r.wallAvg, r.wallMax, r.v3_status, r.v3_pts].join(' | '));
  }
  const bad = rows.filter(r => r.df_valid === 0);
  console.log(`\n★ 「距离场无有效采样」: ${bad.length}/${rows.length} → ${bad.map(r => r.id).join(', ')}`);
  const dfLow = rows.filter(r => r.df_valid > 0 && r.df_valid < 10);
  if (dfLow.length) console.log(`⚠ 有效采样极少(<10): ${dfLow.map(r => `${r.id}(${r.df_valid})`).join(', ')}`);
  console.log(`DISTANCE_DEFAULTS: resolution=${DISTANCE_DEFAULTS.resolution} maxResolution=${DISTANCE_DEFAULTS.maxResolution} minWallLayers=${DISTANCE_DEFAULTS.minWallLayers}`);
}
main().catch(e => { console.error(e); process.exit(1); });
