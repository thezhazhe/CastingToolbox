// ============================================================
// PHASE V2.0-05H · 改前/改后 热点指纹对比器（111.txt §五）
//
// 目的：在**同一份脚本、同一份夹具**下，改动前后各跑一次，逐位比对
//   status / 热点数 / Mc / 位置 / normalizedModulus / confidence / regionVolume。
//
// 覆盖：
//   ① 20 个工程模型 × 生产档 opts={}     —— 原有行为是否变化（§五 必须回答）
//   ② thickEnd / pvpPair × L1..L4 实验档  —— 05G 的 12 档连续性（洞所在处）
//   ③ HR4012 × 生产档                     —— 真实件
//
// 用法：node tests/experiments/phasev2005h_fingerprint.mjs <输出名，如 before|after>
// ============================================================
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { generate } from '../tools/hotspotGeometryGenerator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = join(ROOT, 'tests', 'experiments', 'out');
const tag = (process.argv[2] || 'run').trim();

const MODELS = ['t01_boss100', 't02_thin10_boss60', 't03_twoDiff_60_100', 't04_twoSame_60_60', 't05_threeSizes',
  't06_taperStairs', 't07_eccentric80', 't08_pipeFlange70', 't09_boxInner80', 't10_multiDirBoss',
  't11_edgeThick80', 't12_closePair', 't13_farPair', 't14_taperSeries', 't15_weakRamp',
  't16_extreme_10_100', 't17_weak_30_60', 't18_multiSizeBoss', 't19_valveLike', 't20_combinedBox'];

const LEVELS = [
  { name: 'prod', opts: {} },
  { name: 'L1', opts: { experimentalGs: 64, refineMaxPoints: 8000 } },
  { name: 'L2', opts: { experimentalGs: 96, refineMaxPoints: 32000 } },
  { name: 'L3', opts: { experimentalGs: 128, refineMaxPoints: 128000 } },
  { name: 'L4', opts: { experimentalGs: 192, refineMaxPoints: 600000 } },
];
const FAST = ['L1', 'L2', 'L3', 'L4'];   // 生成器模型跑全档；HR4012 只跑 prod（L4 单档 256s）

const round = (v, n) => (v == null ? null : +v.toFixed(n));

function fp(mesh, geometry, opts, levelName) {
  const r = analyzeHotspotsV3(mesh, geometry, opts);
  return {
    level: levelName, status: r.status, reason: r.reason ?? null,
    hotspotCount: r.hotspots.length,
    hotspots: r.hotspots.map(h => ({
      mc: round(h.peakModulus, 6),
      pos: h.position.map(v => round(v, 3)),
      normM: round(h.normalizedModulus, 6),
      conf: round(h.confidence, 4),
      vol: Math.round(h.regionVolume),
    })),
    // 调试层：粗场 maxM（洞点污染最直接的观测量）
    coarseMaxM: round(r.debug?.coarse?.maxM, 6),
    refineMaxM: (r.debug?.refine || []).filter(e => !e.skipped).map(e => round(e.maxM, 6)),
  };
}

const out = { tag, models: {}, synthetic: {}, missing: [] };

/* ---- ① 20 个工程模型 × 生产档 ---- */
for (const name of MODELS) {
  const p = join(ROOT, 'tests', 'engineering-generated', 'models', name, 'model.stl');
  if (!existsSync(p)) { out.missing.push(name); continue; }
  const buf = readFileSync(p);
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const geometry = buildMesh(mesh).geometry;
  out.models[name] = { prod: fp(mesh, geometry, {}, 'prod') };
  console.log(`  ${name.padEnd(20)} prod: ${out.models[name].prod.status} hot=${out.models[name].prod.hotspotCount} Mc=${out.models[name].prod.hotspots.map(h => h.mc).join(',') || '—'}`);
}

/* ---- ② 生成器模型 × 全档 ---- */
for (const kind of ['thickEnd', 'pvpPair']) {
  const params = kind === 'pvpPair' ? { tA: 30, tB: 30, v: 15 } : undefined;
  const { mesh } = generate(kind, params);
  const geometry = buildMesh(mesh).geometry;
  out.synthetic[kind] = {};
  for (const L of LEVELS) {
    out.synthetic[kind][L.name] = fp(mesh, geometry, L.opts, L.name);
    const f = out.synthetic[kind][L.name];
    console.log(`  ${(kind + '/' + L.name).padEnd(20)} ${f.status} hot=${f.hotspotCount} Mc=${f.hotspots.map(h => h.mc).join(',') || '—'} coarseMaxM=${f.coarseMaxM} refineMaxMmax=${f.refineMaxM.length ? Math.max(...f.refineMaxM) : '—'}`);
  }
}

/* ---- ③ HR4012 × 生产档 ---- */
{
  const p = join(ROOT, 'tests', 'real-stl', 'HR4012塑料模具v4最早大板.stl');
  if (existsSync(p)) {
    const buf = readFileSync(p);
    const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const geometry = buildMesh(mesh).geometry;
    out.synthetic.HR4012 = { prod: fp(mesh, geometry, {}, 'prod') };
    const f = out.synthetic.HR4012.prod;
    console.log(`  HR4012/prod          ${f.status} hot=${f.hotspotCount} Mc=${f.hotspots.map(h => h.mc).join(',')}`);
  } else out.missing.push('HR4012');
}

mkdirSync(OUT, { recursive: true });
const file = join(OUT, `phasev2005h_fingerprint_${tag}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n→ ${file}${out.missing.length ? `  （缺夹具：${out.missing.join(', ')}）` : ''}`);
