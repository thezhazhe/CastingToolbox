// ============================================================
// PHASE V2.0-06A · 20 个工程模型：报告 Mc vs 未封顶窗口 V/A（**只读**）
//
// 112.txt §三「最小验证范围」：复用已有夹具，不重复昂贵的全量网格实验。
//   · 几何来源：tests/engineering-generated/models/*/model.stl（PHASE 84 既有夹具）
//   · 两次运行：生产参数 / modulusCeilRatio=1e9（实验旋钮，关掉 ceiling）
//   · 比对：主热点 Mc、位置是否漂移、热点数是否变化
//
// 判读纪律（112.txt §十五 同类要求）：
//   Mc 数值稳定 与 热点空间定位 是两件事 —— 本表**分开列**，不合并成一句结论。
// ============================================================
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MODELS = ['t01_boss100', 't02_thin10_boss60', 't03_twoDiff_60_100', 't04_twoSame_60_60', 't05_threeSizes',
  't06_taperStairs', 't07_eccentric80', 't08_pipeFlange70', 't09_boxInner80', 't10_multiDirBoss',
  't11_edgeThick80', 't12_closePair', 't13_farPair', 't14_taperSeries', 't15_weakRamp',
  't16_extreme_10_100', 't17_weak_30_60', 't18_multiSizeBoss', 't19_valveLike', 't20_combinedBox'];

const r2 = (v) => (v == null ? null : +v.toFixed(2));
const r3 = (v) => (v == null ? null : +v.toFixed(3));
const dist = (a, b) => (a && b ? +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(1) : null);

const rows = [];
console.log('模型'.padEnd(20), 'prod:Mc(H1)'.padStart(12), 'noCeil:Mc(H1)'.padStart(13),
  '比值'.padStart(7), '位置漂移mm'.padStart(11), '热点数'.padStart(9), '状态'.padStart(14));

for (const name of MODELS) {
  const p = join(ROOT, 'tests', 'engineering-generated', 'models', name, 'model.stl');
  if (!existsSync(p)) { console.log(`  ${name} 缺夹具 → skip`); continue; }
  const buf = readFileSync(p);
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const geometry = buildMesh(mesh).geometry;

  const a = analyzeHotspotsV3(mesh, geometry, {});
  const b = analyzeHotspotsV3(mesh, geometry, { modulusCeilRatio: 1e9 });

  const ha = a.hotspots[0] || null, hb = b.hotspots[0] || null;
  const mcA = ha ? ha.peakModulus : null, mcB = hb ? hb.peakModulus : null;
  const row = {
    model: name,
    prod: { status: a.status, n: a.hotspots.length, mc: r3(mcA), pos: ha ? ha.position.map(r2) : null },
    noCeil: { status: b.status, n: b.hotspots.length, mc: r3(mcB), pos: hb ? hb.position.map(r2) : null },
    ratio: (mcA > 0 && mcB != null) ? +((mcA / mcB)).toFixed(3) : null,
    driftMm: dist(ha && ha.position, hb && hb.position),
    statusChanged: a.status !== b.status,
  };
  rows.push(row);
  console.log(name.padEnd(20), String(row.prod.mc ?? '—').padStart(12), String(row.noCeil.mc ?? '—').padStart(13),
    String(row.ratio ?? '—').padStart(7), String(row.driftMm ?? '—').padStart(11),
    `${row.prod.n}→${row.noCeil.n}`.padStart(9),
    (row.prod.status === row.noCeil.status ? row.prod.status : `${row.prod.status}→${row.noCeil.status}`).padStart(14));
}

const valid = rows.filter(r => r.ratio != null);
const ratios = valid.map(r => r.ratio).sort((a, b) => a - b);
const drift = rows.filter(r => r.driftMm != null).map(r => r.driftMm).sort((a, b) => a - b);
const q = (arr, f) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : null;

console.log(`\n有比值的模型 ${valid.length}/${rows.length}`);
console.log(`  Mc(封顶)/Mc(未封顶) 比值：min=${q(ratios, 0)} p50=${q(ratios, 0.5)} max=${q(ratios, ratios.length - 1)}`);
console.log(`  即封顶把 Mc 压到了未封顶值的 ${(100 * q(ratios, 0.5)).toFixed(1)}%（中位）`);
console.log(`  峰位置漂移 mm：min=${q(drift, 0)} p50=${q(drift, 0.5)} max=${q(drift, drift.length - 1)}`);
console.log(`  状态改变：${rows.filter(r => r.statusChanged).map(r => r.model).join(', ') || '无'}`);
console.log(`  热点数变化：${rows.filter(r => r.prod.n !== r.noCeil.n).map(r => `${r.model}(${r.prod.n}→${r.noCeil.n})`).join(', ') || '无'}`);

const OUT = join(ROOT, 'tests', 'experiments', 'out');
mkdirSync(OUT, { recursive: true });
const f = join(OUT, 'phasev2006a_models20.json');
writeFileSync(f, JSON.stringify({ rows }, null, 2));
console.log(`\n→ ${f}`);
