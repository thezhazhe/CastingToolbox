// ============================================================
// PHASE 23 分辨率对照实验（31.txt 三/四）
// 对选定真实 STL 分别强制 192³ / 256³ / 384³ 主网格（experimentalGs override +
// maxSampleGs 同步放开，生产逻辑零改动），记录全量数据并追踪"局部特征过薄"区域。
// 用法: node scripts/p23_resolution_experiment.mjs
// ============================================================
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../js/engine/stl.js';
import { buildMesh } from '../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../js/engine/v3/hotspotV3.js';
import { coarseSample } from '../js/engine/v3/sampling.js';
import { toViewResult } from '../js/engine/v3/v3ViewAdapter.js';
import { analyzeGeometry } from '../js/engine/geometryAnalysis.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAD = 'D:/LOCAD/STL文件';

const MODELS = [
  { name: 'ALHR4510 v2-2.1（生产 ok）', file: `${LOCAD}/ALHR4510V2/ALHR4510塑料模具v2-2.1.stl` },
  { name: 'ALHR4530 整个（local_thin）', file: `${LOCAD}/ALHR4530v1/ALHR4530塑料模具整个.stl` },
  { name: 'HR4012 大板（local_thin, body=48）', file: `${LOCAD}/HR4012塑料模具v4最早大板.stl` },
  { name: 'ALHR4520A v1（local_thin, body=10）', file: `${LOCAD}/ALHR4520Av1/ALHR4520A塑料模具v1.stl` },
  { name: 'ALR2510 v1（resolution, 真薄壁）', file: `${LOCAD}/ALR2510塑料模具v1.stl` },
  { name: 'ALHR4530 v1（生产 ok）', file: `${LOCAD}/ALHR4530v1/ALHR4530塑料模具v1.stl` },
];
const RESOLUTIONS = [192, 256, 384];
const rEq = (v) => (v > 0 ? Math.cbrt(3 * v / (4 * Math.PI)) : 0);

for (const m of MODELS) {
  const buf = readFileSync(m.file);
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { geometry, bounds } = buildMesh(mesh);
  const mdim = Math.max(...bounds.size);
  const geo = analyzeGeometry(mesh, geometry, {});
  console.log(`\n${'═'.repeat(104)}\n${m.name}\n${m.file.split(/[\/]/).pop()} | tri=${mesh.triCount} | bbox=${bounds.size.map(v => Math.round(v)).join('×')} | wallMain=${geo.wallMain.toFixed(1)} wallAvg=${geo.wallAvg.toFixed(1)} wallMax=${geo.wallMax.toFixed(1)}`);
  console.log('─'.repeat(104));
  const header = 'res'.padEnd(5) + 'vs'.padEnd(8) + '总耗时'.padEnd(9) + 'scan'.padEnd(7) + 'field'.padEnd(7)
    + '内部点'.padEnd(8) + 'estMW'.padEnd(7) + 'charP10'.padEnd(8) + 'charP50'.padEnd(8)
    + 'p10点(x,y,z)'.padEnd(30) + 'warn'.padEnd(22) + 'H'.padEnd(3) + '主热结 [pos] Vcm3 rEq';
  console.log(header);
  const hotspotsByRes = {};
  for (const gs of RESOLUTIONS) {
    const opts = { experimentalGs: gs, maxSampleGs: gs, probeResolutionSteps: [Math.min(gs, 128)] };
    const coarse = coarseSample(mesh, geometry, opts);
    const t0 = Date.now();
    const v3 = analyzeHotspotsV3(mesh, geometry, opts);
    const ms = Date.now() - t0;
    const c = v3.debug?.coarse || {};
    const view = toViewResult(v3, { wallMax: geo.wallMax, wallMain: geo.wallMain, wallAvg: geo.wallAvg });
    const s = view.sampling;
    // char 统计（主网格真实采样数据）
    const chars = coarse.char.filter(x => x !== null && x >= 2).sort((a, b) => a - b);
    const p10v = chars.length ? chars[Math.floor(chars.length * 0.1)] : 0;
    const p50v = chars.length ? chars[Math.floor(chars.length * 0.5)] : 0;
    // p10 点位置（最小 char 分位样本）——追踪"薄"是否在同一物理位置
    const p10Pt = (() => {
      if (!chars.length) return '-';
      const t10 = p10v;
      let best = null, bestD = Infinity;
      for (let i = 0; i < coarse.char.length; i++) {
        const ch = coarse.char[i];
        if (ch === null || ch < 2) continue;
        const d = Math.abs(ch - t10);
        if (d < bestD) { bestD = d; best = coarse.pts[i]; }
      }
      return best ? `(${best.map(x => x.toFixed(0)).join(',')})` : '-';
    })();
    const H = v3.hotspots;
    hotspotsByRes[gs] = H.map(h => ({ pos: h.position, vol: h.regionVolume, M: h.peakModulus }));
    const warnTxt = !s.warning ? 'ok'
      : s.level === 'local_thin' ? `local_thin estLayers=${(s.layers ?? '-')}`
      : s.level === 'resolution' ? `resolution bodyL=${s.layers !== null ? s.layers.toFixed(1) : '-'}`
      : s.level;
    const main = H.slice(0, 3).map(h => `[${h.position.map(x => x.toFixed(0)).join(',')}] ${(h.regionVolume / 1000).toFixed(1)} ${rEq(h.regionVolume).toFixed(1)}`).join(' ');
    console.log(String(gs).padEnd(5) + String(c.vs.toFixed(2)).padEnd(8)
      + String(ms + 'ms').padEnd(9) + String(c.scanMs + 'ms').padEnd(7) + String(c.fieldMs + 'ms').padEnd(7)
      + String(coarse.pts.length).padEnd(8) + String(c.estMinWall.toFixed(1)).padEnd(7)
      + String(p10v.toFixed(1)).padEnd(8) + String(p50v.toFixed(1)).padEnd(8)
      + p10Pt.padEnd(30) + warnTxt.padEnd(22) + String(H.length).padEnd(3) + main);
  }
  // 位置稳定性：各分辨率热结 vs 256 基准的最大位移
  const base = hotspotsByRes[256];
  if (base?.length) {
    for (const gs of [192, 384]) {
      const arr = hotspotsByRes[gs] || [];
      if (!arr.length) continue;
      const moves = arr.map(h => Math.min(...base.map(b => Math.hypot(h.pos[0] - b.pos[0], h.pos[1] - b.pos[1], h.pos[2] - b.pos[2]))));
      console.log(`  位置稳定性(${gs} vs 256): 热结 ${arr.length} 个, 最近距离 [${moves.map(v => v.toFixed(1)).join(', ')}]mm`);
    }
  }
}
console.log(`\n${'═'.repeat(104)}`);
