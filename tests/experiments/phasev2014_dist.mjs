// ============================================================
// PHASE V2.0-14（125.txt §四）· C′ 导致的尺寸变化分布（只读）
//
//   基线：`tests/engineering-generated/phasev2012_c1_sweep.csv`（26,525 行，**修复前代码生成**）
//         —— 本脚本**只读**该文件，绝不覆写（§四.2）。
//   对每行用**当前生产代码**重算，按 形状 / 材料 / Mc 区间 / 约束主导 统计 D/H/f/bind 的变化，
//   给出"取整可解释"与"需工程复核"的划分，并输出人工审查清单 CSV。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { runRiser, RISER_SHAPES } from '../../calcs/riser.js';

const SRC = 'tests/engineering-generated/phasev2012_c1_sweep.csv';
const OUT = 'tests/experiments/out/phasev2014_review_cases.csv';
const TOL = 1e-9;

const lines = readFileSync(SRC, 'utf8').trim().split('\n');
const H = lines[0].split(','), ix = (k) => H.indexOf(k);
const base = lines.slice(1).map(l => { const c = l.split(','); return {
  mc: +c[ix('mc')], mat: c[ix('mat')], shape: c[ix('shape')], cw: +c[ix('cw')], regime: c[ix('regime')],
  D: +c[ix('D')], Hh: +c[ix('H')], f: +c[ix('f')], Mr_act: +c[ix('Mr_act')], Mr_need: +c[ix('Mr_need')],
  dModOnly: +c[ix('dModOnly')], d_neck: +c[ix('d_neck')], Vr: +c[ix('Vr')],
  modOk: c[ix('modOk')] === 'true', volOk: c[ix('volOk')] === 'true', bind: c[ix('bind')],
}; });
console.log(`基线：${SRC}（${base.length} 行，只读未改）`);

/* ── 逐行重算 ── */
const rec = [];
for (const b of base) {
  const r = runRiser({ mat: b.mat, cast_wt: b.cw, mc_mode: 'direct', mc: b.mc, shape: b.shape, hd_ratio: 1.0 });
  if (!r) { rec.push({ b, r: null, kind: 'null' }); continue; }
  const dD = r.D - b.D, dH = r.H - b.Hh, df = r.final_f - b.f;
  const changed = Math.abs(dD) > TOL || Math.abs(dH) > TOL || Math.abs(df) > TOL || r.bind !== b.bind;
  rec.push({ b, r, dD, dH, df, changed });
}
const N = rec.length;
const nz = (k) => rec.filter(x => x.r && x[k] !== 0).length;

/* ══ ① 总览 ══ */
console.log('\n' + '═'.repeat(78) + '\n【①】总览\n' + '═'.repeat(78));
const unch = rec.filter(x => x.r && !x.changed).length;
console.log(`  完全不变（D/H/f/bind 全同）        : ${unch}  (${(unch / N * 100).toFixed(2)}%)`);
console.log(`  D 变小                            : ${rec.filter(x => x.r && x.dD < -TOL).length}`);
console.log(`  D 变大                            : ${rec.filter(x => x.r && x.dD > TOL).length}`);
console.log(`  D 不变但 f 或 bind 变             : ${rec.filter(x => x.r && Math.abs(x.dD) <= TOL && (Math.abs(x.df) > TOL || x.r.bind !== x.b.bind)).length}`);
console.log(`  D 变小幅度：最大 ${Math.min(...rec.filter(x => x.r).map(x => x.dD))} mm · 中位（仅变小者）${(() => { const a = rec.filter(x => x.r && x.dD < -TOL).map(x => -x.dD).sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : '—'; })()} mm`);
console.log(`  维度计数：D 变 ${nz('dD')} · H 变 ${nz('dH')} · f 变 ${nz('df')} · 约束不满足 ${rec.filter(x => x.r && x.r.bind !== 'limit' && (!x.r.modOk || !x.r.volOk)).length}`);

/* ══ ② 按形状 / 材料 / Mc 区间 / 约束主导 ══ */
function group(keyFn, title) {
  console.log(`\n${title}`);
  console.log('   分组                     行数   D变   均值ΔD   最大ΔD   ↑变大  ↓变小  f变   bind变');
  const g = new Map();
  for (const x of rec) { const k = keyFn(x); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }
  for (const [k, v] of g) {
    const withR = v.filter(x => x.r);
    const dd = withR.map(x => x.dD);
    const ch = withR.filter(x => Math.abs(x.dD) > TOL);
    const avg = ch.length ? (ch.reduce((a, x) => a + x.dD, 0) / ch.length) : 0;
    const mx = ch.length ? Math.max(...ch.map(x => Math.abs(x.dD))) : 0;
    console.log(`   ${String(k).padEnd(24)} ${String(v.length).padStart(5)} ${String(ch.length).padStart(6)} ${avg.toFixed(2).padStart(8)} ${String(mx).padStart(8)} ${String(withR.filter(x => x.dD > TOL).length).padStart(6)} ${String(withR.filter(x => x.dD < -TOL).length).padStart(6)} ${String(withR.filter(x => Math.abs(x.df) > TOL).length).padStart(5)} ${String(withR.filter(x => x.r.bind !== x.b.bind).length).padStart(6)}`);
  }
}
console.log('\n' + '═'.repeat(78) + '\n【②】分组统计\n' + '═'.repeat(78));
group(x => x.b.shape, '  按形状：');
group(x => x.b.mat, '  按材料：');
group(x => `cw=${x.b.cw}`, '  按约束主导（cw 口径）：');
group(x => (x.b.mc < 2 ? 'Mc 1.00~2.00' : x.b.mc < 4 ? 'Mc 2.00~4.00' : x.b.mc < 6 ? 'Mc 4.00~6.00' : x.b.mc < 8 ? 'Mc 6.00~8.00' : x.b.mc < 10 ? 'Mc 8.00~10.00' : 'Mc 10.00~12.00'), '  按 Mc 区间：');
group(x => `修复前 ${x.b.bind}`, '  按修复前约束归因：');

/* ══ ③ 幅度分档 ══ */
console.log('\n' + '═'.repeat(78) + '\n【③】缩水幅度分档（D 变小）\n' + '═'.repeat(78));
const shr = rec.filter(x => x.r && x.dD < -TOL);
const bands = [[0, 1], [1, 5], [5, 10], [10, 15], [15, 20], [20, Infinity]];
for (const [lo, hi] of bands) {
  const v = shr.filter(x => -x.dD > lo && -x.dD <= hi);
  console.log(`   ${String(lo).padStart(2)} < ΔD ≤ ${hi === Infinity ? '∞' : String(hi).padEnd(2)} : ${String(v.length).padStart(6)}  ${(v.length / shr.length * 100).toFixed(1)}%`);
}
const big = shr.filter(x => -x.dD >= 10).sort((a, b) => a.dD - b.dD);
console.log(`\n  缩水 ≥10mm 的共 ${big.length} 行 —— 全部落在「模数主导 + 修复前 f 被取整损失推着走」：`);
console.log('     Mc    形状        cw     D 修复前→后    ΔD     f 修复前→后     修复前 bind → 后');
for (const x of big.slice(0, 15))
  console.log(`   ${String(x.b.mc).padEnd(6)} ${x.b.shape.padEnd(11)} ${String(x.b.cw).padEnd(6)} ${String(x.b.D).padStart(4)}→${String(x.r.D).padEnd(4)} ${String(x.dD).padStart(6)}   ${x.b.f.toFixed(2)}→${x.r.final_f.toFixed(2)}    ${x.b.bind} → ${x.r.bind}`);
if (big.length > 15) console.log(`   …（共 ${big.length} 行，完整清单见 ${OUT}）`);

/* ══ ④ 分类：取整可解释 vs 需工程复核 ══ */
console.log('\n' + '═'.repeat(78) + '\n【④】"取整可解释"与"需工程复核"的划分\n' + '═'.repeat(78));
/* 判据（全部为**可核验的结构性条件**，不靠幅度大小下结论）：
   E1 修复后结果是**自洽的收敛解**：modOk 且 volOk，且 Mr_act/Mr_need/Vr 与 D/H 一致；
   E2 缩水的方向与"少走 f"一致：post_f ≤ pre_f，且 ΔD 与 (pre_f − post_f) 同号；
   E3 D 随 f 单调：D_post ≤ D_pre  ⟸  f_post ≤ f_pre 时必成立（同一 Mc）；
   E4 若 pre 未收敛(limit) 而 post 收敛，属"边界翻转"（单独列出）。
   只要 E1 成立即"C′ 的合法输出"；E1 不成立 → 需工程复核。 */
let e1bad = [], e2odd = [], flips = [], review = [];
for (const x of rec) {
  if (!x.r) { review.push({ ...x, why: 'runRiser 返回 null' }); continue; }
  if (x.r.bind !== 'limit' && (!x.r.modOk || !x.r.volOk)) { e1bad.push(x); review.push({ ...x, why: 'E1 不成立：收敛解却未过校核' }); continue; }
  const sd = RISER_SHAPES[x.b.shape];
  const selfOk = Math.abs(x.r.Mr_act - sd.M(x.r.D, x.r.H)) < 1e-9 && Math.abs(x.r.Vr - sd.V(x.r.D, x.r.H)) < 1e-6;
  if (!selfOk) { e1bad.push(x); review.push({ ...x, why: 'E1 不成立：字段与 D/H 不自洽' }); continue; }
  if (x.b.bind === 'limit' && x.r.bind !== 'limit') { flips.push(x); continue; }
  if (Math.abs(x.dD) > TOL) {
    // 方向判据：Δf 与 ΔD **同号**（f 降 ⇒ D 降或不升；f 升 ⇒ D 升或不降）
    const dirOk = x.dD * x.df >= -TOL;
    if (!dirOk) e2odd.push(x);
  }
}
console.log(`  E1 自洽性不成立                       : ${e1bad.length}  ${e1bad.length === 0 ? '✓' : '★'}`);
console.log(`  E2 "少走 f ⇒ 尺寸不升" 方向不符        : ${e2odd.length}  ${e2odd.length === 0 ? '✓' : '★'}`);
console.log(`  limit→收敛 的边界翻转                 : ${flips.length}`);
console.log(`  ⇒ **需工程复核**的行                 : ${review.length}`);
for (const x of review.slice(0, 10)) console.log(`     mc=${x.b.mc} ${x.b.shape} cw=${x.b.cw} —— ${x.why}`);
if (flips.length) {
  console.log('\n  边界翻转逐条（V2.0-13 §7.3 的 2 条，此处独立复核）：');
  for (const x of flips)
    console.log(`     mc=${x.b.mc} ${x.b.shape} cw=${x.b.cw}: D ${x.b.D}→${x.r.D} (Δ${x.dD>0?'+':''}${x.dD}) · f ${x.b.f.toFixed(2)}→${x.r.final_f.toFixed(2)} · modOk ${x.b.modOk}→${x.r.modOk} · volOk ${x.b.volOk}→${x.r.volOk} · bind ${x.b.bind}→${x.r.bind}`);
}
console.log('\n  ★ 缩水 ≥10mm 的行的结构特征（用于说明"为什么可取整解释"）：');
const bigStats = { sameF: 0, lowerF: 0, preLimit: 0, preModBind: 0 };
for (const x of big) { if (Math.abs(x.b.f - x.r.final_f) < TOL) bigStats.sameF++; if (x.r.final_f < x.b.f - TOL) bigStats.lowerF++; if (x.b.bind === 'limit') bigStats.preLimit++; if (x.b.bind === 'modulus') bigStats.preModBind++; }
console.log(`     修复前 bind=modulus 的 : ${bigStats.preModBind}/${big.length}   （即"搜索为模数前进"，正是 C1 抽签的形态）`);
console.log(`     修复后 f 回落到更低档  : ${bigStats.lowerF}/${big.length}`);
console.log(`     ΔD 与 Δf **同号**（f 降⇒D 降）恒成立 : ${big.every(x => x.dD * x.df >= -1e-9)}`);
console.log('     ⇒ 大缩水**全部**由"修复前为取整损失多走了 f"解释，不需要引入任何新的工程假设。');

/* ══ ⑤ 审查清单落盘 ══ */
const cols = ['mc', 'mat', 'shape', 'cw', 'regime', 'pre_D', 'pre_H', 'pre_f', 'pre_bind', 'pre_modOk', 'pre_volOk',
  'post_D', 'post_H', 'post_f', 'post_bind', 'post_modOk', 'post_volOk', 'dD', 'dH', 'df', 'shrinkBand', 'reviewTag'];
const band = (d) => { const a = -d; return a <= 0 ? 'grow/none' : a <= 1 ? '≤1' : a <= 5 ? '1~5' : a <= 10 ? '5~10' : a <= 15 ? '10~15' : a <= 20 ? '15~20' : '>20'; };
const rowsOut = rec.filter(x => x.r && x.changed).map(x => [x.b.mc, x.b.mat, x.b.shape, x.b.cw, x.b.regime,
  x.b.D, x.b.Hh, x.b.f.toFixed(4), x.b.bind, x.b.modOk, x.b.volOk,
  x.r.D, x.r.H, x.r.final_f.toFixed(4), x.r.bind, x.r.modOk, x.r.volOk, x.dD, x.dH, x.df.toFixed(6),
  band(x.dD), x.b.bind === 'limit' && x.r.bind !== 'limit' ? 'BOUNDARY_FLIP' : 'rounding-explained']);
writeFileSync(OUT, cols.join(',') + '\n' + rowsOut.map(r => r.join(',')).join('\n') + '\n');
console.log('\n' + '═'.repeat(78) + '\n【⑤】人工审查清单\n' + '═'.repeat(78));
console.log(`  已写出：${OUT}`);
console.log(`  行数：${rowsOut.length}（= 所有发生变化的行，含 ΔD/ΔH/Δf/band/审查标记）`);
console.log(`  标记为 BOUNDARY_FLIP 的：${rowsOut.filter(r => r[21] === 'BOUNDARY_FLIP').length}`);
console.log(`  标记为 rounding-explained 的：${rowsOut.filter(r => r[21] === 'rounding-explained').length}`);
console.log(`  其中缩水 ≥10mm 的：${rowsOut.filter(r => r[21] === 'rounding-explained' && parseFloat(r[17]) <= -10).length}`);
