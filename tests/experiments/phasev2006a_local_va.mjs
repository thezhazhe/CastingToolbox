// ============================================================
// PHASE V2.0-06A · 在引擎自己报告的**热点位置上**测局部窗口模数（**只读**）
//
// 与上一支（phasev2006a_models20）的区别 —— 这一点是本次判读的关键：
//   · 上一支：把 ceiling **关掉**，取**全场 argmax** → 落在近表面伪影（窗口被表面切掉
//     → V/A≈2d 虚高）→ 那是"关掉 ceiling 会发生什么"，**不是**"热点真模数是多少"。
//   · 本支：**不动引擎**，在引擎报告的热点位置上（代表点），独立测
//          d = distanceToSurface，然后 windowVoxels(vox, pos, R = 2d) → V/A。
//     ——这是"同一个物理位置上，另一个模数估计量"，可与报告 Mc 直接对照（112.txt §三）。
//
// ⚠ 口径声明：窗口中心 = 引擎报告的**代表点（region 质心）**，不是峰点（PHASE 83/86 已知两者
//   可差数十 mm）。故本表是**量级判读**，不是逐点恒等式。
// ============================================================
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSTL } from '../../js/engine/stl.js';
import { buildMesh, distanceToSurface } from '../../js/engine/mesh3d.js';
import { analyzeHotspotsV3 } from '../../js/engine/v3/hotspotV3.js';
import { voxelize, windowVoxels } from '../../js/engine/v3/windowV.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MODELS = ['t01_boss100', 't02_thin10_boss60', 't03_twoDiff_60_100', 't04_twoSame_60_60', 't05_threeSizes',
  't06_taperStairs', 't07_eccentric80', 't08_pipeFlange70', 't09_boxInner80', 't10_multiDirBoss',
  't11_edgeThick80', 't12_closePair', 't13_farPair', 't14_taperSeries', 't15_weakRamp',
  't16_extreme_10_100', 't17_weak_30_60', 't18_multiSizeBoss', 't19_valveLike', 't20_combinedBox'];

const r3 = (v) => (v == null ? null : +v.toFixed(3));
const rows = [];

console.log('模型'.padEnd(20), 'Mc报告'.padStart(9), 'd(代表点)'.padStart(10), '(1/3)d'.padStart(9),
  '窗口V/A'.padStart(10), 'V/A÷Mc'.padStart(9), '(1/3)d÷Mc'.padStart(11));

for (const name of MODELS) {
  const p = join(ROOT, 'tests', 'engineering-generated', 'models', name, 'model.stl');
  if (!existsSync(p)) continue;
  const buf = readFileSync(p);
  const mesh = parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { geometry, bounds } = buildMesh(mesh);
  const r = analyzeHotspotsV3(mesh, geometry, {});
  const hs = r.hotspots[0];
  if (!hs) { console.log(`${name.padEnd(20)}  （无热点）`); continue; }

  const pos = hs.position;
  const d = distanceToSurface(geometry, [pos], 1e5)[0];
  const md = Math.max(...bounds.size);
  const vs = md / 128;
  const gs = Math.max(16, Math.ceil(md / vs) + 2);
  const vox = voxelize(geometry, { min: bounds.min, max: bounds.max }, gs, vs, bounds.min);
  const w = windowVoxels(vox, pos, Math.min(2 * d, 0.5 * md));
  const VA = w.a > 1e-9 ? w.v / w.a : null;

  const row = {
    model: name, mc: r3(hs.peakModulus), d: r3(d), ceil: r3(d / 3),
    windowVA: r3(VA), vs: r3(vs),
    ratio_va_mc: (VA && hs.peakModulus > 0) ? r3(VA / hs.peakModulus) : null,
    ratio_ceil_mc: r3((d / 3) / hs.peakModulus),
  };
  rows.push(row);
  console.log(name.padEnd(20), String(row.mc).padStart(9), String(row.d).padStart(10),
    String(row.ceil).padStart(9), String(row.windowVA).padStart(10),
    String(row.ratio_va_mc ?? '—').padStart(9), String(row.ratio_ceil_mc).padStart(11));
}

const rs = rows.filter(r => r.ratio_va_mc != null).map(r => r.ratio_va_mc).sort((a, b) => a - b);
const q = (f) => rs.length ? rs[Math.min(rs.length - 1, Math.floor(rs.length * f))] : null;
console.log(`\nn=${rs.length}   窗口V/A ÷ 报告Mc：min=${q(0)} p50=${q(0.5)} max=${q(rs.length - 1)}`);
console.log(`（该比值 > 1 ⇒ 报告 Mc 低于同一位置上的局部模数估计）`);

const OUT = join(ROOT, 'tests', 'experiments', 'out');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'phasev2006a_local_va.json'), JSON.stringify({ rows }, null, 2));
console.log(`→ ${join(OUT, 'phasev2006a_local_va.json')}`);
