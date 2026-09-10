// ============================================================
// PHASE 15-C：Mesh Density Invariance（命令 15.txt 四）
// 同一 SDF 几何体，仅改变 tetMC 分辨率（三角面密度）：
//   res ∈ {60, 90, 120} vs 原始 res（model.stl）
// 比较：Volume / Area / M / hotspot count / position / ranking
// 判定目标：三角面数量变化不应改变几何意义——
//   不允许：热结突然消失 / 大量假热结 / M 大幅漂移 / 位置跳到完全不同区域
// 用法: node tests/engineering-generated/phase15/p15_density.mjs
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSTL } from '../../../js/engine/stl.js';
import { tetMC } from '../../helpers/stlGen.js';
import { MODELS } from '../gen_engineering.mjs';
import { HERE, DATA_DIR, runV3, matchPairs, posTol, rankCheck } from './p15_common.mjs';

const MODELS_DIR = join(HERE, '..', 'models');
// 覆盖：boss / 薄壁 / 多热结 / flange / 极端 / 阀体 / 综合
const SELECT = ['t01_boss100', 't02_thin10_boss60', 't05_threeSizes', 't08_pipeFlange70',
  't16_extreme_10_100', 't19_valveLike', 't20_combinedBox'];
const RESES = [60, 90, 120];
const pad2 = (b, e = 4) => [b[0].map(v => v - e), b[1].map(v => v + e)];

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  console.log('PHASE 15-C Mesh Density Invariance\n');
  for (const sel of SELECT) {
    const m = MODELS.find(x => x.id === sel);
    const { sdf, bounds, manifest } = m.build();
    // 基准：原始 model.stl（14.txt 的 res）
    const baseMesh = parseSTL(readFileSync(join(MODELS_DIR, sel, 'model.stl')));
    const base = runV3(baseMesh);
    const baseManifest = JSON.parse(readFileSync(join(MODELS_DIR, sel, 'manifest.json'), 'utf8'));
    const row = {
      model: sel, baseRes: baseManifest.mesh.res, baseTri: baseMesh.triCount,
      baseCount: base.v3.hotspots.length, baseMs: base.v3.hotspots.map(h => +h.peakModulus.toFixed(2)),
      baseVolume: +base.v3.metrics.volume.toFixed(1), baseArea: +base.v3.metrics.area.toFixed(1),
      densities: {},
    };
    for (const res of RESES) {
      const vertices = tetMC(sdf, pad2(bounds), res);
      const mesh = { vertices, triCount: vertices.length / 9 };
      const r = runV3(mesh);
      const vs = r.v3.debug.coarse?.vs ?? 0;
      const tol = posTol(vs);
      const { pairs, extra, missing } = matchPairs(
        base.v3.hotspots.map(h => h.position), r.v3.hotspots.map(h => h.position), tol);
      const mErr = pairs.map(p => Math.abs(r.v3.hotspots[p.moved].peakModulus - base.v3.hotspots[p.base].peakModulus) / base.v3.hotspots[p.base].peakModulus);
      const maxMErr = mErr.length ? Math.max(...mErr) : null;
      const posErrs = pairs.map(p => Math.hypot(
        r.v3.hotspots[p.moved].position[0] - base.v3.hotspots[p.base].position[0],
        r.v3.hotspots[p.moved].position[1] - base.v3.hotspots[p.base].position[1],
        r.v3.hotspots[p.moved].position[2] - base.v3.hotspots[p.base].position[2]));
      const maxPos = posErrs.length ? Math.max(...posErrs) : 0;
      const volErr = Math.abs(r.v3.metrics.volume - base.v3.metrics.volume) / base.v3.metrics.volume;
      const areaErr = Math.abs(r.v3.metrics.area - base.v3.metrics.area) / base.v3.metrics.area;
      const countDiff = r.v3.hotspots.length - base.v3.hotspots.length;
      const baseMs = pairs.map(p => base.v3.hotspots[p.base].peakModulus);
      const movedMs = pairs.map(p => r.v3.hotspots[p.moved].peakModulus);
      const rankOk = rankCheck(baseMs, movedMs);

      const countVerdict = countDiff === 0 ? 'PASS' : Math.abs(countDiff) === 1 ? 'WARNING' : 'FAIL';
      const mVer = maxMErr === null ? 'N/A' : maxMErr <= 0.10 ? 'PASS' : maxMErr <= 0.20 ? 'WARNING' : 'FAIL';
      const posVer = maxPos <= tol ? 'PASS' : maxPos <= 2 * tol ? 'WARNING' : 'FAIL';
      const volVer = volErr <= 0.03 ? 'PASS' : volErr <= 0.06 ? 'WARNING' : 'FAIL';
      const overall = [countVerdict, mVer, posVer, volVer].includes('FAIL') ? 'FAIL'
        : [countVerdict, mVer, posVer, volVer].includes('WARNING') ? 'WARNING' : 'PASS';

      row.densities[`res${res}`] = {
        res, triCount: mesh.triCount, countVerdict, mVer, posVer, volVer, overall,
        count: r.v3.hotspots.length, maxMErr: maxMErr === null ? null : +maxMErr.toFixed(4),
        maxPos: +maxPos.toFixed(1), volErr: +volErr.toFixed(4), areaErr: +areaErr.toFixed(4),
        volume: +r.v3.metrics.volume.toFixed(1), area: +r.v3.metrics.area.toFixed(1),
        ms: r.v3.hotspots.map(h => +h.peakModulus.toFixed(2)),
        pos: r.v3.hotspots.map(h => h.position.map(v => +v.toFixed(0))),
        status: r.v3.status, msEngine: r.v3.engineMs, extra: extra.length, missing: missing.length,
      };
      console.log(`${sel.padEnd(20)} res=${res} tri=${String(mesh.triCount).padStart(8)}  H${row.baseCount}→${row.densities[`res${res}`].count}  M${row.densities[`res${res}`].mVer}  V${row.densities[`res${res}`].volVer}  ${row.densities[`res${res}`].overall}`);
    }
    rows.push(row);
  }
  writeFileSync(join(DATA_DIR, 'density.json'), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${join(DATA_DIR, 'density.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
