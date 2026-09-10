// ============================================================
// PHASE 15-B：Scale Invariance（命令 15.txt 三）
// scale ∈ {0.1, 1, 10}：理论 M → kM（V→k³V, A→k²A）
// 覆盖：小尺寸厚件/大尺寸薄壁/boss/flange/多热结
// 检查：M 比例 / 数量 / 排序 / 位置按比例缩放
// 偏差分类（15.txt 三）：A 体素离散 / B Adaptive Sampling / C Local V/A / D 检测阈值
// 用法: node tests/engineering-generated/phase15/p15_scale.mjs
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSTL } from '../../../js/engine/stl.js';
import { scaleMesh } from '../../tools/hotspotGeometryGenerator.mjs';
import { HERE, DATA_DIR, runV3, matchPairs, posTol, rankCheck } from './p15_common.mjs';

const MODELS_DIR = join(HERE, '..', 'models');
// 覆盖 15.txt 三类：boss / flange / 多热结 / 薄壁 / 大件
const SELECT = ['t01_boss100', 't02_thin10_boss60', 't05_threeSizes', 't08_pipeFlange70',
  't14_taperSeries', 't16_extreme_10_100', 't18_multiSizeBoss', 't19_valveLike', 't20_combinedBox'];
const SCALES = [0.1, 10];

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = [];
  console.log('PHASE 15-B Scale Invariance\n');
  for (const name of SELECT) {
    const mesh = parseSTL(readFileSync(join(MODELS_DIR, name, 'model.stl')));
    const base = runV3(mesh);
    const row = { model: name, baseCount: base.v3.hotspots.length, baseMs: base.v3.hotspots.map(h => h.peakModulus), scales: {} };
    for (const s of SCALES) {
      const sm = scaleMesh(mesh, s);
      const r = runV3(sm);
      const vs = r.v3.debug.coarse?.vs ?? 0;
      const tol = posTol(vs);
      // 位置按比例缩放后比较
      const scaledBase = base.v3.hotspots.map(h => ({ ...h, position: h.position.map(v => v * s) }));
      const { pairs, extra, missing } = matchPairs(scaledBase.map(h => h.position), r.v3.hotspots.map(h => h.position), tol);
      // M 比例误差
      const ratios = pairs.map(p => r.v3.hotspots[p.moved].peakModulus / base.v3.hotspots[p.base].peakModulus);
      const ratioErr = ratios.map(x => Math.abs(x - s) / s);
      const maxRatioErr = ratioErr.length ? Math.max(...ratioErr) : null;
      const posErrs = pairs.map(p => {
        const a = scaledBase[p.base].position, b = r.v3.hotspots[p.moved].position;
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      });
      const maxPos = posErrs.length ? Math.max(...posErrs) : 0;
      const countDiff = r.v3.hotspots.length - base.v3.hotspots.length;
      const baseMs = pairs.map(p => base.v3.hotspots[p.base].peakModulus);
      const movedMs = pairs.map(p => r.v3.hotspots[p.moved].peakModulus);
      const rankOk = rankCheck(baseMs, movedMs);
      const countVerdict = countDiff === 0 ? 'PASS' : Math.abs(countDiff) === 1 ? 'WARNING' : 'FAIL';
      const ratioVerdict = maxRatioErr === null ? 'N/A' : maxRatioErr <= 0.15 ? 'PASS' : maxRatioErr <= 0.30 ? 'WARNING' : 'FAIL';
      const posVerdict = maxPos <= tol ? 'PASS' : maxPos <= 2 * tol ? 'WARNING' : 'FAIL';
      const rankVerdict = rankOk ? 'PASS' : 'WARNING';
      const overall = [countVerdict, ratioVerdict, posVerdict, rankVerdict].includes('FAIL') ? 'FAIL'
        : [countVerdict, ratioVerdict, posVerdict, rankVerdict].includes('WARNING') ? 'WARNING' : 'PASS';
      row.scales[s] = {
        s, countVerdict, ratioVerdict, posVerdict, rankVerdict, overall,
        countBase: base.v3.hotspots.length, countScaled: r.v3.hotspots.length,
        maxRatioErr: maxRatioErr === null ? null : +maxRatioErr.toFixed(4),
        ratios: ratios.map(x => +x.toFixed(3)), maxPos: +maxPos.toFixed(1),
        vs: +vs.toFixed(2), tol: +tol.toFixed(1),
        status: r.v3.status, ms: r.v3.engineMs,
        scaledMs: r.v3.hotspots.map(h => +h.peakModulus.toFixed(2)),
        // 偏差现场记录（供 15.txt 三 A/B/C/D 分类）：
        extra, missing,
      };
      console.log(`${name.padEnd(20)} s=${s}  H${row.scales[s].countBase}→${row.scales[s].countScaled}  M比=${row.scales[s].ratios.join('/')}  ${row.scales[s].overall}`);
    }
    rows.push(row);
  }
  writeFileSync(join(DATA_DIR, 'scale.json'), JSON.stringify(rows, null, 2));
  console.log(`\n→ ${join(DATA_DIR, 'scale.json')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
