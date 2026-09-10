// ============================================================
// PHASE 15-D：Adaptive Sampling 验证（命令 15.txt 五）
// 验证粗探测→壁厚估计→自动 vs→夹取 [mdim/128, mdim/24] 是否真的解决
// V2 "bbox 大 → voxel 粗 → 薄壁消失"。
// 探针：500/1000mm 尺寸 × 10/20/30mm 壁厚 + 厚小件 + 大箱体壁厚 20 + 大件厚块
// 输出：bbox / char 厚度 / 选定 vs / stride / 壁厚 voxel 层数 / inside voxel 数 / M 误差
// 用法: node tests/engineering-generated/phase15/p15_sampling.mjs
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BOX, tetMC } from '../../helpers/stlGen.js';
import { pickRes } from '../../tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../../js/engine/mesh3d.js';
import { coarseSample } from '../../../js/engine/v3/sampling.js';
import { V3_DEFAULTS } from '../../../js/engine/v3/configV3.js';
import { runV3, DATA_DIR } from './p15_common.mjs';

const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];

/** 探针模型定义：name + sdf + bounds + 解析 V/A（纯几何，独立于 V3） */
const PROBES = [
  // 小尺寸厚件
  { name: 'cube100', sdf: BOX([-50, -50, -50], [50, 50, 50]), bounds: [[-50, -50, -50], [50, 50, 50]], analytic: { kind: 'cube', a: 100 } },
  // 500mm × 壁厚 10/20/30（板）
  ...(function () {
    const out = [];
    for (const S of [500, 1000]) for (const w of [10, 20, 30]) {
      out.push({
        name: `plate${S}_w${w}`,
        sdf: BOX([-S / 2, -S / 2, -w / 2], [S / 2, S / 2, w / 2]),
        bounds: [[-S / 2, -S / 2, -w / 2], [S / 2, S / 2, w / 2]],
        analytic: { kind: 'plate', S, w },
      });
    }
    return out;
  })(),
  // 大箱体薄壁壳
  { name: 'shell500_w20', sdf: (p) => Math.max(BOX([-250, -250, -250], [250, 250, 250])(p), -BOX([-230, -230, -230], [230, 230, 230])(p)), bounds: [[-250, -250, -250], [250, 250, 250]], analytic: { kind: 'shell', S: 500, w: 20 } },
  { name: 'shell1000_w20', sdf: (p) => Math.max(BOX([-500, -500, -500], [500, 500, 500])(p), -BOX([-480, -480, -480], [480, 480, 480])(p)), bounds: [[-500, -500, -500], [500, 500, 500]], analytic: { kind: 'shell', S: 1000, w: 20 } },
  // 1000mm 大箱体 + 局部厚块（V2 杀手场景：大 bbox 下 20mm 壁 + 局部厚区应检出）
  { name: 'shell1000_w20_boss200', sdf: (p) => Math.min(
      Math.max(BOX([-500, -500, -500], [500, 500, 500])(p), -BOX([-480, -480, -480], [480, 480, 480])(p)),
      BOX([-100, -100, 380], [100, 100, 580])(p)),
    bounds: [[-500, -500, -500], [500, 500, 580]], analytic: null },
];

const analyticM = (a) => {
  if (!a) return null;
  if (a.kind === 'cube') { const V = a.a ** 3, A = 6 * a.a ** 2; return { M: V / A, V, A }; }
  if (a.kind === 'plate') { const V = a.S * a.S * a.w, A = 2 * a.S * a.S + 4 * a.S * a.w; return { M: V / A, V, A }; }
  if (a.kind === 'shell') { const V = a.S ** 3 - (a.S - 2 * a.w) ** 3, A = 6 * a.S ** 2 + 6 * (a.S - 2 * a.w) ** 2; return { M: V / A, V, A }; }
};

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  console.log('PHASE 15-D Adaptive Sampling 验证\n');
  for (const pr of PROBES) {
    const [min, max] = pr.bounds;
    const mdim = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const minF = pr.analytic ? (pr.analytic.kind === 'cube' ? pr.analytic.a : pr.analytic.w) : 20;
    const res = pickRes(mdim, minF);
    const mesh = { vertices: tetMC(pr.sdf, pad2(pr.bounds), res), triCount: 0 };
    mesh.triCount = mesh.vertices.length / 9;
    const r = runV3(mesh);
    const c = r.v3.debug.coarse;
    // 实际 inside voxel 数与体素体积（粗场网格，验证体素化与解析 V 的偏差）
    const coarse = coarseSample(mesh, buildMesh(mesh).geometry, V3_DEFAULTS);
    const insideVoxels = coarse.vox.inside.reduce((a, b) => a + (b ? 1 : 0), 0);
    const voxelVolume = insideVoxels * coarse.vs ** 3;
    const aM = analyticM(pr.analytic);
    const row = {
      probe: pr.name, mdim, res, triCount: mesh.triCount,
      analytic: pr.analytic ? { ...pr.analytic, ...(aM ?? {}) } : null, analyticM: aM?.M ?? null,
      v3: {
        status: r.v3.status, hotspotCount: r.v3.hotspots.length,
        gs: c?.gs, vs: + (c?.vs ?? 0).toFixed(2), estMinWall: +(c?.estMinWall ?? 0).toFixed(1),
        stride: c?.stride, pts: c?.pts, peaks: c?.peaks, uniform: c?.uniform,
        scanMs: c?.scanMs, fieldMs: c?.fieldMs, engineMs: r.v3.engineMs,
        wallVoxelLayers: c?.vs ? +(c.estMinWall / c.vs).toFixed(1) : null,
        globalM: r.v3.metrics.area ? +(r.v3.metrics.volume / r.v3.metrics.area).toFixed(3) : null,
        globalV: +r.v3.metrics.volume.toFixed(0), globalA: +r.v3.metrics.area.toFixed(0),
      },
    };
    row.v3.insideVoxels = insideVoxels;
    row.v3.voxelVolume = +voxelVolume.toFixed(0);
    if (row.analyticM && row.v3.globalM) row.v3.mErrorPct = +((row.v3.globalM - row.analyticM) / row.analyticM * 100).toFixed(2);
    if (row.analytic && row.v3.globalV) row.v3.voxelVolumeErrPct = +((voxelVolume - row.analytic.V) / row.analytic.V * 100).toFixed(2);
    rows.push(row);
    console.log(
      `${row.probe.padEnd(24)} mdim=${mdim} 壁厚=${pr.analytic ? (pr.analytic.w ?? pr.analytic.a) : '20'}  ` +
      `vs=${row.v3.vs} estWall=${row.v3.estMinWall} 层=${row.v3.wallVoxelLayers}  ` +
      `pts=${row.v3.pts} stride=${row.v3.stride}  M误差=${row.v3.mErrorPct ?? '-'}%  ${row.v3.status} H${row.v3.hotspotCount}  ${row.v3.engineMs}ms`);
  }
  writeFileSync(join(DATA_DIR, 'sampling.json'), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${join(DATA_DIR, 'sampling.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
