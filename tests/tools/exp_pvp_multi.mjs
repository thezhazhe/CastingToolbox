// ============================================================
// Exp 06/07 · PVP 压力 + 多厚区（命令文件 7.txt 第九/十节）
//   06 PVP：两柱 30/30 + 连接带 v=5..29 → split/merge 边界 vs 理论 0.15
//     + 峰值组合 30/20, 30/25, 30/28, 30/40, 40/60
//   07 多厚区：n=1..10 凸台 → maxHotspots=5 截断 / 区域隔离 / 排序稳定
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { runAnalyze, makeRecord, appendRaw } from './validationCommon.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAW_DIR } from './validationConfig.mjs';

/* ---- 06 PVP 压力 ---- */
function pvpScan() {
  const combos = [];
  const vList = (tA, tB) => {
    const vMax = Math.min(tA, tB) - 2;   // 谷必须 < 两峰
    const vals = [5, 10, 12, 15, 18, 20, 22, 24, 26, 28, 29].filter(v => v < vMax);
    // 理论边界（depth=0.15 → v=0.85×min(tA,tB)）附近加密
    const b = Math.round(0.85 * Math.min(tA, tB));
    for (const dv of [-2, -1, 0, 1, 2]) if (!vals.includes(b + dv) && b + dv > 1 && b + dv < vMax) vals.push(b + dv);
    return vals.sort((a, b) => a - b);
  };
  for (const [tA, tB] of [[30, 30], [30, 20], [30, 25], [30, 28], [30, 40], [40, 60]]) {
    for (const v of vList(tA, tB)) combos.push({ tA, tB, v });
  }
  const out = [];
  for (const { tA, tB, v } of combos) {
    const { mesh, gt } = generate('pvpPair', { tA, tB, v });
    const r = runAnalyze(mesh);
    const rec = makeRecord(`pvp_${tA}_${tB}_v${v}`, { tA, tB, v }, gt, r);
    // 实际 split/merge：从 audit 提取 split/merged 判定
    const aud = rec.audit || [];
    const splitEv = aud.find(a => a.split);
    const mergeEv = aud.find(a => a.merged);
    const theoryDepth = gt.params.valleyDepthRatioTheory;
    out.push({
      ...rec, classification: null,
      tA, tB, v,
      theoryDepth: +theoryDepth.toFixed(3),
      expectSplit: gt.params.expectSplit,
      gotSplit: rec.detected.hotspots.length >= 2,
      actualDepth: +(splitEv?.valleyDepth ?? mergeEv?.valleyDepth ?? 0).toFixed(3),
    });
  }
  return out;
}

/* ---- 07 多厚区 ---- */
function multiScan() {
  const out = [];
  for (const n of [1, 2, 3, 5, 8, 10]) {
    const { mesh, gt } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n });
    const r = runAnalyze(mesh);
    const rec = makeRecord(`multi_n${n}`, { n }, gt, r);
    const expected = Math.min(n, 5);   // maxHotspots=5 截断
    out.push({
      ...rec, classification: null,
      n, expectedCount: expected,
      regs: r.debug.regions, peaks: r.debug.peaks, rejected: r.debug.rejected,
    });
  }
  return out;
}

const start = Date.now();
const P = pvpScan();
console.log(`pvp: ${P.length} 条`);
let mismatch = 0, mergedAll = 0, splitAll = 0;
for (const p of P) {
  const exp = p.expectSplit ? 'SPLIT' : 'MERGE';
  const got = p.gotSplit ? 'SPLIT' : 'MERGE';
  const ok = exp === got;
  if (!ok) mismatch++;
  if (got === 'SPLIT') splitAll++; else mergedAll++;
  console.log(`  ${p.tA}/${p.tB} v=${String(p.v).padEnd(3)} theory=${p.theoryDepth.toFixed(3)} actual=${p.actualDepth.toFixed(3)} → ${got}${ok ? '' : ' ✗'}（期望 ${exp}）`);
}
console.log(`  PVP 边界一致性: ${P.length - mismatch}/${P.length}（期望 ${P.filter(p=>p.expectSplit).length} split / ${P.filter(p=>!p.expectSplit).length} merge）`);
appendRaw('exp06_pvp', P, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

const M = multiScan();
console.log(`\nmulti: ${M.length} 条`);
for (const m of M) {
  const det = m.detected.hotspots.map(h => `H${h.id}@(${h.x},${h.y}) c=${h.confidence}`).join(' ');
  console.log(`  n=${m.n} 期望${m.expectedCount} 检出${m.detected.hotspots.length} status=${m.status} regs=${m.regs} peaks=${m.peaks} rej=${m.rejected}`);
  if (m.detected.hotspots.length) console.log(`    ${det}`);
}
appendRaw('exp07_multi', M, { elapsedSec: ((Date.now() - start) / 1000).toFixed(1) });

writeFileSync(join(RAW_DIR, 'exp06_pvp.csv'), [
  'model,tA,tB,v,theoryDepth,actualDepth,expectSplit,gotSplit,status,positionError,confidence',
  ...P.map(p => [p.model, p.tA, p.tB, p.v, p.theoryDepth, p.actualDepth, p.expectSplit, p.gotSplit, p.status, p.positionError ?? '', p.confidence ?? ''].join(',')),
].join('\n'));
writeFileSync(join(RAW_DIR, 'exp07_multi.csv'), [
  'model,n,expectedCount,detected,status,regs,peaks,rejected',
  ...M.map(m => [m.model, m.n, m.expectedCount, m.detected.hotspots.length, m.status, m.regs, m.peaks, m.rejected].join(',')),
].join('\n'));
console.log(`完成 ${((Date.now() - start) / 1000).toFixed(1)}s`);
