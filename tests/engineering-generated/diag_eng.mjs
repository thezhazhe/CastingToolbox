// ============================================================
// 工程化测试集 · 粗场诊断（只读，不修改 V3 核心）
// 复刻 analyzeHotspotsV3 的粗场段：coarseSample → buildModulusField → findPeaks
// 打印 top5 峰（M/位置/prom/R）与 uniform 判据数值
// 用法: node tests/engineering-generated/diag_eng.mjs <modelName>
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { coarseSample, buildGridToPt } from '../../js/engine/v3/sampling.js';
import { buildModulusField } from '../../js/engine/v3/modulusField.js';
import { findPeaks } from '../../js/engine/v3/peakRegion.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) { console.log('用法: node diag_eng.mjs <modelName>'); process.exit(0); }

const mesh = parseSTL(readFileSync(join(HERE, 'models', name, 'model.stl')));
const geometry = buildMesh(mesh).geometry;
const o = { ...V3_DEFAULTS };

const coarse = coarseSample(mesh, geometry, o);
coarse.gridToPt = buildGridToPt(coarse.gs, coarse.vox.inside, coarse.insideIdx);
const field = buildModulusField(coarse.vox, coarse, o, 1.0);
const peaks = findPeaks(field.M, coarse, field, o);

console.log(`${name}: gs=${coarse.gs} vs=${coarse.vs.toFixed(2)} estMinWall=${coarse.estMinWall.toFixed(1)} pts=${coarse.pts.length} maxM=${field.maxM.toFixed(2)}`);
console.log('top5 粗场峰:');
peaks.slice(0, 5).forEach((p, i) => {
  console.log(`  #${i + 1} M=${p.M.toFixed(2)} pos=(${coarse.pts[p.pt].map(v => v.toFixed(0)).join(',')}) prom=${p.prominence?.toFixed(3)} R=${p.R?.toFixed(1)}`);
});
if (peaks.length >= 3) {
  console.log(`uniform 判据: top2/top1=${(peaks[1].M / peaks[0].M).toFixed(3)} (≥0.85)  top3/top1=${(peaks[2].M / peaks[0].M).toFixed(3)} (≥0.85)  → ${peaks[1].M / peaks[0].M >= o.uniformTop2Ratio && peaks[2].M / peaks[0].M >= o.uniformTop2Ratio ? 'UNIFORM → NO_HOTSPOT ✗' : '非 uniform → 细化'}`);
} else {
  console.log(`峰数 ${peaks.length} < 3 → uniform 判据不触发（走细化或 NO_CANDIDATE）`);
}
