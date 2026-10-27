// PHASE V2.0-19 探针（只读）：在写 calcs/riserDreq.js 之前，先把"整数直径 → 尺寸 → 体积"
//   这条链的**数学性质**在**实际代码**上实测确认，而不是纸面推导。
// 验证四件事：
//   P1  V(D) 对整数 D **单调不减**（4 形状 × 15 个 hd × D=1..2000）
//   P2  连续式系数 k 与实际几何一致（忽略 H 取整）
//   P3  搜索上界 D_hi 充分：V(D_hi) >= A（网格 + 极端值）
//   P4  HOf(D) 复刻了 sizeAt 的真实舍入规则（用 runRiser 的实际输出反验）
// 运行：node tests/experiments/_probe19_geom.mjs      （不被 tests/runner.mjs 统计）
import { RISER_SHAPES, RISER_MATERIALS, RISER_EFF, runRiser } from '../../calcs/riser.js';

// ── 从 calcs/riser.js:187-201 (sizeAt) 与 228-237 (还原分支) 逐字提取的几何规则 ──
//    ⚠ 只取**纯几何**部分：H 随 D 的取整 + 两种特殊形状修正。不含任何模数内容。
function HOf(D, shape, hd) {
  let H = Math.round(D * hd);
  if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
  if (shape === 'sphere') H = D;
  return H;
}
const VOf = (D, shape, hd) => RISER_SHAPES[shape].V(D, HOf(D, shape, hd));

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } };

// ── P1: 单调性 ────────────────────────────────────────────────────────────────
console.log('P1  V(D) 对整数 D 单调不减');
const HDS = [1e-6, 1e-3, 0.01, 0.1, 0.3, 0.49, 0.5, 0.51, 0.6, 0.8, 1.0, 1.5, 2.0, 3.0, 10];
let monoChecked = 0, monoViol = 0;
for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
  for (const hd of HDS) {
    let prev = -1;
    for (let D = 1; D <= 2000; D++) {
      const v = VOf(D, shape, hd);
      if (!(v >= prev)) { monoViol++; if (monoViol <= 5) console.log(`     违反: ${shape} hd=${hd} D=${D} V=${v} < prev=${prev}`); }
      prev = v; monoChecked++;
    }
  }
}
ok(monoViol === 0, `单调性被违反 ${monoViol} 次`);
console.log(`    ${monoChecked} 个 (shape,hd,D) 点，违反 ${monoViol} 次`);

// ── P2: 连续式系数 k ──────────────────────────────────────────────────────────
//   k 的定义：V(D) ≈ k·D³（忽略 H 的整数取整，即 H = D·hd 精确）
console.log('\nP2  连续式 V(D) ≈ k·D³ 的系数');
const kOf = (shape, hd) => ({
  cyl: Math.PI * hd / 4,
  square: hd,
  sphere: Math.PI / 6,
  sphere_head: Math.PI * (3 * hd - 0.5) / 12,   // 仅 hd >= 0.5 时定义域成立
}[shape]);
for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
  for (const hd of [0.5, 0.8, 1.0, 1.5, 2.0]) {
    if (shape === 'sphere_head' && hd < 0.5) continue;
    const k = kOf(shape, hd);
    // 大 D 下 V/D³ 应收敛到 k；实测相对偏差
    const D = 100000;
    const rel = Math.abs(VOf(D, shape, hd) / (k * D * D * D) - 1);
    ok(rel < 1e-5, `k 不符: ${shape} hd=${hd} rel=${rel}`);
  }
}
console.log('    cyl/square/sphere/sphere_head 的 k 在大 D 下相对偏差 < 1e-5');

// sphere_head 在 hd<0.5 时连续式**不成立**（实测确认，作为"continuous=null"的依据）
//   ⚠ 失效方式不是"变负"——hd ∈ (1/6, 0.5) 时朴素系数仍为正，但**数值错**：
//     实测 V/D³ 恒为 π/12（半球体积），朴素式却给出 π(3hd-0.5)/12。
for (const hd of [1e-6, 0.1, 0.3, 0.4, 0.49]) {
  const D = 100000;
  const kNaive = Math.PI * (3 * hd - 0.5) / 12;
  const actual = VOf(D, 'sphere_head', hd) / (D * D * D);
  const rel = Math.abs(actual - kNaive) / actual;
  console.log(`    sphere_head hd=${hd}: 朴素 k=${kNaive.toFixed(6)} · 实测 V/D³=${actual.toFixed(6)}（π/12=${(Math.PI / 12).toFixed(6)}）· 相对误差 ${(rel * 100).toFixed(1)}%`);
  ok(rel > 0.01, `sphere_head hd=${hd}<0.5 的连续系数应失效`);
}
{
  // 另一侧：hd >= 0.5 时连续式**成立**（这正是"可以提供 continuous"的依据）
  const hd = 0.5, D = 100000;
  const kNaive = Math.PI * (3 * hd - 0.5) / 12, actual = VOf(D, 'sphere_head', hd) / (D * D * D);
  console.log(`    sphere_head hd=0.5（边界）: 朴素 k=${kNaive.toFixed(6)} · 实测=${actual.toFixed(6)} · 相对误差 ${(Math.abs(actual - kNaive) / actual * 100).toFixed(4)}%`);
  ok(Math.abs(actual - kNaive) / actual < 1e-4, 'hd=0.5 时连续式应成立');
}

// ── P3: 上界 D_hi 充分性 ──────────────────────────────────────────────────────
console.log('\nP3  搜索上界 D_hi 的充分性  V(D_hi) >= A');
function dHi(shape, hd, A) {
  if (shape === 'sphere') return Math.ceil(Math.cbrt(6 * A / Math.PI));
  if (shape === 'sphere_head') return Math.ceil(Math.cbrt(12 * A / Math.PI));
  if (shape === 'square') return Math.max(Math.ceil(0.5 / hd), Math.ceil(Math.sqrt(A)));
  return Math.max(Math.ceil(0.5 / hd), Math.ceil(Math.sqrt(4 * A / Math.PI)));  // cyl
}
let ubChecked = 0, ubFail = 0;
const AS = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e12, 1e15];
const HDS3 = [1e-6, 1e-3, 0.01, 0.1, 0.25, 0.49, 0.5, 0.51, 0.8, 1.0, 1.5, 2.0, 5.0, 20];
for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
  for (const hd of HDS3) {
    for (const A of AS) {
      const hi = dHi(shape, hd, A);
      if (!Number.isFinite(hi) || hi > 1e17) { ubChecked++; continue; }   // 交给模块的边界处理
      const v = VOf(hi, shape, hd);
      ubChecked++;
      if (!(v >= A)) { ubFail++; if (ubFail <= 8) console.log(`     上界不足: ${shape} hd=${hd} A=${A} hi=${hi} V=${v}`); }
    }
  }
}
ok(ubFail === 0, `上界不足 ${ubFail} 次`);
console.log(`    ${ubChecked} 个组合，上界不足 ${ubFail} 次`);
// hd=1e-6 时 cyl 的上界形态（说明二分为什么必要：上界本身可能极大）
console.log(`    例: cyl hd=1e-6 A=1e6 ⇒ D_hi=${dHi('cyl', 1e-6, 1e6)}（二分 ~${Math.ceil(Math.log2(dHi('cyl', 1e-6, 1e6)))} 步）`);

// ── P4: runRiser 实际用的 H 与"由整数 D 算的 H"差多少 ────────────────────────
//   ⚠ ★探针首轮的重大发现★：runRiser 收敛解的 H **不是** round(D·hd)。
//     calcs/riser.js:189-190 是 `d = round(raw); h = round(raw*hdR)` —— **H 由连续 raw 算，
//     不是由取整后的 d 算**；只有 V2.0-13 的**升档**分支（:196）才写 `h = round(d*hdR)`。
//     所以"给定整数 D 时的 H"在现有代码里有**两个口径**，探针必须把它们分开统计。
console.log('\nP4  runRiser 实际 H  vs  HOf(D)=round(D·hd)');
const delta = new Map(); let p4n = 0, p4limit = 0;
for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
  for (const hd of [0.3, 0.5, 0.8, 1.0, 1.5, 2.0]) {
    for (const [cw, mc] of [[0.5, 3], [5, 5], [20, 8], [200, 20], [0, 5]]) {
      const r = runRiser({ mat: '球铁', mc_mode: 'direct', mc, shape, hd_ratio: hd, cast_wt: cw, eff: undefined });
      if (!r) continue;
      if (!r.converged) { p4limit++; continue; }
      p4n++;
      const d = r.H - HOf(r.D, shape, hd);
      delta.set(d, (delta.get(d) || 0) + 1);
      if (Math.abs(d) > 1 && delta.get(d) === 1) console.log(`     ⚠ |ΔH|>1: ${shape} hd=${hd} cw=${cw} mc=${mc} ⌀${r.D} H=${r.H} HOf=${HOf(r.D, shape, hd)}`);
    }
  }
}
console.log(`    收敛样本 ${p4n} 个（另 ${p4limit} 个 limit）：ΔH 分布 = ${[...delta.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k >= 0 ? '+' : ''}${k}:${v}`).join(' ')}`);
ok([...delta.keys()].every(k => Math.abs(k) <= 1), 'ΔH 必须落在 {-1,0,+1}');

// ★ 口径差异的**后果**量化：用 HOf 口径判定的 D，在 runRiser 实际的那组 (D,H) 下是否也满足体积约束？
//   若 ΔH = -1（runRiser 的 H 比 HOf 小 1），则该 D 的实际体积更小 ⇒ 可能不满足 ⇒ 必须如实报告。
{
  let worse = 0, same = 0, better = 0, checked = 0;
  for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
    for (const hd of [0.5, 0.8, 1.0, 1.5]) {
      for (const cw of [5, 20, 200]) {
        const r = runRiser({ mat: '球铁', mc_mode: 'direct', mc: 5, shape, hd_ratio: hd, cast_wt: cw, eff: undefined });
        if (!r || !r.converged) continue;
        checked++;
        const vHof = VOf(r.D, shape, hd), vAct = r.Vr;
        if (vAct < vHof - 1e-9) worse++; else if (vAct > vHof + 1e-9) better++; else same++;
      }
    }
  }
  console.log(`    D 相同时：实际 Vr 比 HOf 口径**小**的 ${worse} 个 / 相等 ${same} / 更大 ${better}`);
}

console.log(`\n探针结果：${fail} 项失败`);
process.exitCode = fail ? 1 : 0;
