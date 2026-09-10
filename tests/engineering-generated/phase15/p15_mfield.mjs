// ============================================================
// PHASE 15-E：M Field 数值验证（命令 15.txt 六）
// cube / cylinder / plate / tube：解析 V/A vs V3
//   ① global M（mesh 级 volume/area —— V3 metrics）
//   ② voxel 体积（inside voxels × vs³ vs 解析 V —— 体素化误差）
//   ③ local M（粗场 M 在结构中心的点值 vs 解析局部 M）
// 目标：确认误差来源是 voxel 离散化而非公式/实现错误
// 用法: node tests/engineering-generated/phase15/p15_mfield.mjs
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../../js/engine/mesh3d.js';
import { coarseSample, buildGridToPt } from '../../../js/engine/v3/sampling.js';
import { buildModulusField } from '../../../js/engine/v3/modulusField.js';
import { V3_DEFAULTS } from '../../../js/engine/v3/configV3.js';
import { runV3, DATA_DIR } from './p15_common.mjs';

const MODELS = [
  { kind: 'uniformCube', params: { size: 100 }, analytic: { V: 100 ** 3, A: 6 * 100 ** 2, local: 'global', localTarget: [0, 0, 0] } },
  { kind: 'uniformCylinder', params: { r: 40, h: 120 }, analytic: { V: Math.PI * 40 ** 2 * 120, A: 2 * Math.PI * 40 * 120 + 2 * Math.PI * 40 ** 2, local: 'global', localTarget: [0, 0, 0] } },
  { kind: 'uniformPlate', params: { l: 300, w: 200, t: 40 }, analytic: { V: 300 * 200 * 40, A: 2 * (300 * 200 + 300 * 40 + 200 * 40), local: 't/2=20', localTarget: [0, 0, 0] } },
  { kind: 'uniformTube', params: { ro: 50, ri: 40, h: 100 }, analytic: { V: Math.PI * (50 ** 2 - 40 ** 2) * 100, A: 2 * Math.PI * 50 * 100 + 2 * Math.PI * 40 * 100 + 2 * Math.PI * (50 ** 2 - 40 ** 2), local: 'w/2≈5（壁中点）', localTarget: [45, 0, 0] } },
];

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  console.log('PHASE 15-E M Field 数值验证\n');
  for (const md of MODELS) {
    const g = generate(md.kind, md.params);
    const mesh = g.mesh;
    const r = runV3(mesh);
    const geometry = buildMesh(mesh).geometry;
    const coarse = coarseSample(mesh, geometry, V3_DEFAULTS);
    coarse.gridToPt = buildGridToPt(coarse.gs, coarse.vox.inside, coarse.insideIdx);
    const field = buildModulusField(coarse.vox, coarse, V3_DEFAULTS, 1.0);
    // 结构中心附近的粗场点 M（局部 M）
    const tgt = md.analytic.localTarget;
    let bestI = 0, bd = Infinity;
    for (let i = 0; i < coarse.pts.length; i++) {
      const d = (coarse.pts[i][0] - tgt[0]) ** 2 + (coarse.pts[i][1] - tgt[1]) ** 2 + (coarse.pts[i][2] - tgt[2]) ** 2;
      if (d < bd) { bd = d; bestI = i; }
    }
    const localM = coarse.pts.length ? field.M[bestI] : null;
    const localPos = coarse.pts.length ? coarse.pts[bestI] : null;
    const globalM = r.v3.metrics.area ? r.v3.metrics.volume / r.v3.metrics.area : null;
    const insideVoxels = coarse.vox.inside.reduce((a, b) => a + (b ? 1 : 0), 0);
    const voxelV = insideVoxels * coarse.vs ** 3;
    const row = {
      model: md.kind, triCount: mesh.triCount, vs: +coarse.vs.toFixed(2), estMinWall: +coarse.estMinWall.toFixed(1),
      analytic: { V: +md.analytic.V.toFixed(1), A: +md.analytic.A.toFixed(1), M: +(md.analytic.V / md.analytic.A).toFixed(3) },
      v3: {
        globalV: +r.v3.metrics.volume.toFixed(1), globalA: +r.v3.metrics.area.toFixed(1), globalM: globalM === null ? null : +globalM.toFixed(3),
        globalMErrorPct: globalM ? +((globalM - md.analytic.V / md.analytic.A) / (md.analytic.V / md.analytic.A) * 100).toFixed(2) : null,
        voxelV: +voxelV.toFixed(1), voxelVErrorPct: +((voxelV - md.analytic.V) / md.analytic.V * 100).toFixed(2),
        insideVoxels, localM: localM === null ? null : +localM.toFixed(3), localPos: localPos ? localPos.map(v => +v.toFixed(1)) : null,
        localTarget: tgt, localNote: md.analytic.local,
      },
      status: r.v3.status, hotspotCount: r.v3.hotspots.length, engineMs: r.v3.engineMs,
    };
    rows.push(row);
    console.log(
      `${md.kind.padEnd(16)} V/A理论=${row.analytic.M.toFixed(2)}  V3global=${row.v3.globalM ?? '-'}（${row.v3.globalMErrorPct ?? '-'}%）  ` +
      `voxelV误差=${row.v3.voxelVErrorPct}%  localM=${row.v3.localM ?? '-'}（${row.v3.localNote}）  ${row.v3.engineMs}ms`);
  }
  writeFileSync(join(DATA_DIR, 'mfield.json'), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${join(DATA_DIR, 'mfield.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
