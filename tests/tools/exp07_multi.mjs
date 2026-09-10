// ============================================================
// Exp 07 · 多厚区（命令 8.txt PHASE 1）：复现 n=5 细化异常 + 全链路追踪
// 用法: node tests/tools/exp07_multi.mjs [n]   默认 n=5
// 追踪: candidate detection → region BFS → merge → refinement bounds → refined peak
// ============================================================
import { generate } from './hotspotGeometryGenerator.mjs';
import { runAnalyze, makeRecord, appendRaw } from './validationCommon.mjs';
import { RAW_DIR } from './validationConfig.mjs';

function dumpFull(label, r) {
  console.log(`\n=== ${label} ===`);
  console.log(`status=${r.status} reason=${r.reason} H=${r.hotspots.length}`);
  console.log(`debug: gs=${r.debug.gs} vs=${r.debug.vs.toFixed(2)} candidates=${r.debug.candidates} regions=${r.debug.regions} peaks=${r.debug.peaks} rejected=${r.debug.rejected} inside=${r.debug.insidePoints}`);
  console.log('── audit 全链路（候选排序 → region → 细化 → PVP → 评估）──');
  for (const a of r.audit) {
    const bits = [`cand#${a.candidateId}`, `coarsePeak=${a.coarsePeak}`, `peak=${a.peak}`, `coarseRes=${a.coarseRes}`, `refineRes=${a.refineRes}`, `comp=${a.component}`];
    if (a.confidence !== undefined) bits.push(`conf=${a.confidence}`, `lt=${a.localThickness}`, `vol=${a.regionVolumeCm3}`);
    if (a.valley !== undefined && a.valleyDepth !== undefined) bits.push(`valley=${a.valley}`, `vd=${a.valleyDepth}`);
    if (a.split) bits.push('SPLIT:' + a.split.slice(0, 70));
    if (a.merged) bits.push('MERGE:' + a.merged.slice(0, 70));
    if (a.rejected) bits.push('REJECT:' + String(a.rejected).slice(0, 70));
    if (a.uniform) bits.push('UNIFORM:' + a.rejected);
    console.log('  ' + bits.join(' '));
  }
  for (const h of r.hotspots) {
    console.log(`  H${h.id} @(${h.x.toFixed(1)},${h.y.toFixed(1)},${h.z.toFixed(1)}) score=${h.score} conf=${h.confidence} prominence=${h.prominenceScore}`);
  }
}

const n = Number(process.argv[2] ?? 5);
const { mesh, gt } = generate('multipleBosses', { pl: [600, 500, 10], bs: [80, 80, 50], n });
const r = runAnalyze(mesh);
dumpFull(`multipleBosses n=${n}`, r);

const rec = makeRecord(`multi_n${n}`, { n }, gt, r);
appendRaw('exp07_multi', [{ ...rec, classification: null }]);
console.log(`\nGT 期望热结位置: ${gt.expectedHotspots.map(p => `(${p.x},${p.y},${p.z})`).join(' ')}`);
