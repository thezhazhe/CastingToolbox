// ============================================================
// PHASE V2.0-13（123.txt §五）· 修复前 vs 修复后 数值回归对比
//
//   基线来源：`tests/engineering-generated/phasev2012_c1_sweep.csv`
//     —— 该文件由 **PHASE V2.0-12 的修复前代码** 生成 ⇒ 它就是"修复前基线"，不是事后编的数。
//   对每一行用**当前生产代码**重算，逐字段比对 11 个字段，按四类归档：
//     1 按预期缩小 / 2 完全不变 / 3 其他变化 / 4 约束不满足
//   **第 3 类必须逐项调查，不得自动归为"预期变化"。**
//
//   只读：不写任何仓库文件，不修改生产代码。
// ============================================================
import { readFileSync } from 'node:fs';
import { runRiser, RISER_SHAPES, RISER_EFF, RISER_MATERIALS } from '../../calcs/riser.js';

const CSV = 'tests/engineering-generated/phasev2012_c1_sweep.csv';
const FIELDS = ['D', 'H', 'f', 'Mr_act', 'Mr_need', 'dModOnly', 'd_neck', 'Vr', 'modOk', 'volOk', 'bind'];
const TOL = 1e-6;

const lines = readFileSync(CSV, 'utf8').trim().split('\n');
const H = lines[0].split(','), ix = (k) => H.indexOf(k);
const rows = lines.slice(1).map(l => {
  const c = l.split(',');
  return {
    mc: parseFloat(c[ix('mc')]), mat: c[ix('mat')] || '球铁', shape: c[ix('shape')] || 'cyl',
    cw: parseFloat(c[ix('cw')]) || 0, regime: c[ix('regime')],
    base: {
      D: +c[ix('D')], H: +c[ix('H')], f: +c[ix('f')], Mr_act: +c[ix('Mr_act')], Mr_need: +c[ix('Mr_need')],
      dModOnly: +c[ix('dModOnly')], d_neck: +c[ix('d_neck')], Vr: +c[ix('Vr')],
      modOk: c[ix('modOk')] === 'true', volOk: c[ix('volOk')] === 'true', bind: c[ix('bind')],
    },
  };
});

const cat = { 1: [], 2: [], 3: [], 4: [] };
const cat3Detail = new Map();

for (const row of rows) {
  const r = runRiser({ mat: row.mat, cast_wt: row.cw, mc_mode: 'direct', mc: row.mc, shape: row.shape, hd_ratio: 1.0 });
  if (!r) { cat[4].push({ ...row, why: 'runRiser 返回 null' }); continue; }
  const now = {
    D: r.D, H: r.H, f: r.final_f, Mr_act: r.Mr_act, Mr_need: r.Mr_need, dModOnly: r.dModOnly,
    d_neck: r.d_neck, Vr: r.Vr, modOk: r.modOk, volOk: r.volOk, bind: r.bind,
  };
  const diffs = FIELDS.filter(k => typeof now[k] === 'number'
    ? Math.abs(now[k] - row.base[k]) > TOL * Math.max(1, Math.abs(row.base[k]))
    : now[k] !== row.base[k]);

  // 4 类优先：约束不满足（收敛解却不过模数校核 / D 与校核不一致）
  const sd = RISER_SHAPES[row.shape];
  const selfConsistent = (r.D > 0 && r.H > 0) && Math.abs(r.Mr_act - sd.M(r.D, r.H)) < 1e-12
    && Math.abs(r.Vr - sd.V(r.D, r.H)) < 1e-9;
  const convergedOk = r.bind === 'limit' || r.Mr_act >= r.Mr_need * 0.99;
  if (!selfConsistent || !convergedOk) {
    cat[4].push({ ...row, now, why: !selfConsistent ? 'D/H 与其校核字段不自洽' : '收敛解未通过模数校核' });
    continue;
  }
  if (!diffs.length) { cat[2].push(row); continue; }
  // 1 类：D 变小（只缩不涨），且 f/颈/体积口径未变，仅 D/H/Mr_act/Vr 随之变
  const shrinkOnly = now.D < row.base.D && now.D >= row.base.D - 2
    && !['f', 'Mr_need', 'dModOnly', 'd_neck', 'bind', 'modOk', 'volOk'].some(k => diffs.includes(k));
  if (shrinkOnly) { cat[1].push({ ...row, now, diffs }); continue; }
  const key = diffs.join('+');
  if (!cat3Detail.has(key)) cat3Detail.set(key, []);
  cat3Detail.get(key).push({ ...row, now, diffs });
  cat[3].push({ ...row, now, diffs });
}

/* ---------- 输出 ---------- */
const N = rows.length;
const pct = (n) => `${(n / N * 100).toFixed(2)}%`;
console.log(`\n基线样本：${N} 行（来自 phasev2012_c1_sweep.csv，修复前代码生成）\n`);
console.log('─'.repeat(78));
console.log(`  1 按预期缩小（D 变小，其余口径不变）      ${String(cat[1].length).padStart(7)}  ${pct(cat[1].length)}`);
console.log(`  2 完全不变（11 个字段逐位相同）           ${String(cat[2].length).padStart(7)}  ${pct(cat[2].length)}`);
console.log(`  3 其他变化（★ 必须逐项调查）              ${String(cat[3].length).padStart(7)}  ${pct(cat[3].length)}`);
console.log(`  4 测试失败或约束不满足                    ${String(cat[4].length).padStart(7)}  ${pct(cat[4].length)}`);
console.log('─'.repeat(78));

if (cat[1].length) {
  const dD = cat[1].map(x => x.base.D - x.now.D);
  console.log(`\n【1 类】D 变化量：最小 ${Math.min(...dD)}mm / 最大 ${Math.max(...dD)}mm / 平均 ${(dD.reduce((a, b) => a + b, 0) / dD.length).toFixed(2)}mm`);
  const byReg = {};
  for (const x of cat[1]) byReg[x.regime] = (byReg[x.regime] || 0) + 1;
  console.log(`        按 regime：${JSON.stringify(byReg)}`);
  console.log('        样例（前 4 条）：');
  for (const x of cat[1].slice(0, 4))
    console.log(`          mc=${x.mc} ${x.shape} cw=${x.cw}  D ${x.base.D}→${x.now.D}  f ${x.base.f}→${x.now.f}  bind ${x.base.bind}→${x.now.bind}`);
}

if (cat[3].length) {
  console.log(`\n【3 类 ★ 逐项调查】差异字段组合共 ${cat3Detail.size} 种：`);
  for (const [k, v] of [...cat3Detail.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const x = v[0];
    console.log(`\n  组合「${k}」共 ${v.length} 条。样例 mc=${x.mc} ${x.shape} cw=${x.cw} regime=${x.regime}`);
    for (const f of k.split('+')) console.log(`      ${f}: ${JSON.stringify(x.base[f])} → ${JSON.stringify(x.now[f])}`);
  }
}

if (cat[4].length) {
  console.log(`\n【4 类 ★】共 ${cat[4].length} 条：`);
  const byWhy = {};
  for (const x of cat[4]) byWhy[x.why] = (byWhy[x.why] || 0) + 1;
  console.log(`        ${JSON.stringify(byWhy)}`);
  for (const x of cat[4].slice(0, 5))
    console.log(`        mc=${x.mc} ${x.shape} cw=${x.cw} regime=${x.regime} D=${x.base.D} bind=${x.base.bind} —— ${x.why}`);
}

/* ---------- 重点验证 4 条（123.txt §五） ---------- */
console.log('\n' + '═'.repeat(78));
console.log('重点验证（123.txt §五）');
console.log('═'.repeat(78));
const byReg = (rg) => rows.filter(r => r.regime === rg);
const volRows = byReg('volume(cw=77.56)');
let volDiff = 0;
for (const row of volRows) {
  const r = runRiser({ mat: row.mat, cast_wt: row.cw, mc_mode: 'direct', mc: row.mc, shape: row.shape, hd_ratio: 1.0 });
  if (r.D !== row.base.D || r.bind !== row.base.bind) volDiff++;
}
console.log(`① 体积主导区（cw=77.56，${volRows.length} 行）与修复前不同的点数：${volDiff}`);

const main = byReg('modulus(C1主线)');
const nonMonoPre = (() => { let n = 0; for (let i = 1; i < main.length; i++) if (main[i].base.D < main[i - 1].base.D) n++; return n; })();
const nonMonoNow = (() => {
  let n = 0, prev = null;
  for (const row of main) { const r = runRiser({ mat: row.mat, cast_wt: row.cw, mc_mode: 'direct', mc: row.mc, shape: row.shape, hd_ratio: 1.0 });
    if (prev !== null && r.D < prev) n++; prev = r.D; }
  return n;
})();
console.log(`② 原始 C1 异常（主线 ${main.length} 行）非单调点：修复前 ${nonMonoPre} → 修复后 ${nonMonoNow}`);

let nulls = 0;
for (const row of rows) { const r = runRiser({ mat: row.mat, cast_wt: row.cw, mc_mode: 'direct', mc: row.mc, shape: row.shape, hd_ratio: 1.0 }); if (!r || r.D == null) nulls++; }
console.log(`③ 新的无解（D=null）：${nulls}`);

const limPre = rows.filter(r => r.base.bind === 'limit').length;
let limNow = 0, limChanged = 0;
for (const row of rows) {
  const r = runRiser({ mat: row.mat, cast_wt: row.cw, mc_mode: 'direct', mc: row.mc, shape: row.shape, hd_ratio: 1.0 });
  if (r.bind === 'limit') limNow++;
  if (row.base.bind === 'limit' && (r.D !== row.base.D || Math.abs(r.final_f - row.base.f) > 1e-9 || r.volOk !== row.base.volOk || r.bind !== 'limit')) limChanged++;
}
console.log(`④ bind='limit'：修复前 ${limPre} 个 → 修复后 ${limNow} 个；原 limit 点中返回值发生变化的：${limChanged}`);
