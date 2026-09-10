// V3 分阶段计时诊断：定位粗场/细化/多尺度各阶段耗时
// 用法: node tests/hotspot_v3/timing.mjs <kind>
import { generate } from '../tools/hotspotGeometryGenerator.mjs';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { coarseSample, refineSample } from '../../js/engine/v3/sampling.js';
import { buildModulusField } from '../../js/engine/v3/modulusField.js';
import { V3_DEFAULTS } from '../../js/engine/v3/configV3.js';

const kind = process.argv[2] || 'uniformCube';
const stride = Number(process.argv[3] || 2);
const { mesh, mdim } = generate(kind);
console.log(`[${kind}] tri=${mesh.triCount} mdim=${mdim.toFixed(0)}`);
const geometry = buildMesh(mesh).geometry;

let t = Date.now();
const coarse = coarseSample(mesh, geometry, V3_DEFAULTS, stride);
console.log(`coarseSample: ${Date.now() - t}ms gs=${coarse.gs} vs=${coarse.vs.toFixed(1)} inside=${coarse.insideIdx.length} (scan ${coarse.scanMs}ms)`);

t = Date.now();
const cf = buildModulusField(geometry, coarse, V3_DEFAULTS, 1.0);
console.log(`coarseField: ${Date.now() - t}ms pts=${cf.idx.length} maxM=${cf.maxM.toFixed(2)} meanM=${cf.meanM.toFixed(2)} (windowMs=${cf.perMs.toFixed(0)})`);

// 单点窗口计时细分（V/A）
const { windowScan, volumeFromScan } = await import('../../js/engine/v3/windowV.js');
const { areaFromScan } = await import('../../js/engine/v3/windowA.js');
t = Date.now();
const nWin = Math.min(300, coarse.insideIdx.length);
let sumWin = 0, sumA = 0, sumV = 0, aSum = 0, vSum = 0;
for (let i = 0; i < nWin; i++) {
  const pi = coarse.pts[i];
  const ri = Math.max(V3_DEFAULTS.charFloor, Math.min(1.0 * (coarse.char[i] ?? V3_DEFAULTS.charFloor), V3_DEFAULTS.windowSizeCapRatio * mdim));
  const t1 = Date.now();
  const win = windowScan(geometry, pi, ri, coarse.globalMin, V3_DEFAULTS.windowMicroGrid, 'cube');
  const tv = volumeFromScan(win);
  const ta = areaFromScan(geometry, win);
  sumWin += Date.now() - t1;
  sumA += ta.area; sumV += tv.v;
  if (ta.area > 0) { aSum += ta.area / tv.v; }
  if (tv.v > 0) vSum++;
}
console.log(`单窗口均值 (n=${nWin}): scan+VA=${(sumWin / nWin).toFixed(2)}ms  M 均值(A>0)=${(aSum / nWin).toFixed(2)}  A>0 占比=${(vSum / nWin * 100).toFixed(0)}%`);
