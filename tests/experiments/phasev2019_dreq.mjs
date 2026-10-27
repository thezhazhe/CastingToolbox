// ============================================================
// PHASE V2.0-19（130.txt §六）· `calcs/riserDreq.js` **只读**独立实验
//
//   ⚠ **本脚本不被 `tests/runner.mjs` 统计**（runner 只读 `tests/*_test.mjs`，**非递归**）。
//     它的数字**不得**与主 runner 的通过数相加（130.txt §6.5）。
//
//   它做四件专属测试做不了的事：
//     E1  大规模网格：每个样本**独立复刻几何 + 完整回扫**（不是抽查，是全查）
//     E2  连续式 vs 整数解的 gap 分布（暴露"连续解向上取整"这种做法错在哪）
//     E3  D_req 与 runRiser 实际推荐尺寸的关系（按 bind 分组）——★口径差异的量化
//     E4  极端输入的行为边界表（hd→0 / cw→大 / rho→小），如实记录而不是设阈值
//
//   运行：node tests/experiments/phasev2019_dreq.mjs        （退出码 0=全部自检通过）
// ============================================================
import { RISER_SHAPES, RISER_MATERIALS, RISER_EFF, runRiser } from '../../calcs/riser.js';
import { calculateRiserDreq } from '../../calcs/riserDreq.js';

const SHAPES = ['cyl', 'square', 'sphere', 'sphere_head'];
const MATS = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } };
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';

// ── 独立复刻的几何与判据（与 calcs/riser.js:191-198 / :214-215 同式）──────────────
const hOf = (D, shape, hd) => {
  let H = Math.round(D * hd);
  if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
  if (shape === 'sphere') H = D;
  return H;
};
const vOf = (D, shape, hd) => RISER_SHAPES[shape].V(D, hOf(D, shape, hd));
const okAt = (D, shape, hd, eff, need) => vOf(D, shape, hd) * eff >= need;

// ════════════════════════════════════════════════════════════════════════════
console.log('E1  网格验证：独立复刻 + 完整回扫（4 形状 × 8 hd × 10 cw × 5 材料 = 1600 样本）');
// ════════════════════════════════════════════════════════════════════════════
{
  const HDS = [0.05, 0.25, 0.3, 0.49, 0.5, 0.8, 1.0, 1.6];
  const CWS = [0.01, 0.1, 0.5, 1, 5, 20, 100, 500, 2000, 10000];
  let n = 0, bad = 0, scanned = 0, maxD = 0, skipped = 0;
  for (const shape of SHAPES) {
    for (const hd of HDS) {
      for (const cw of CWS) {
        for (const mat of MATS) {
          const r = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cw, mat });
          if (r.status !== 'ok') { skipped++; console.log(`     ⚠ 非 ok：${shape} hd=${hd} cw=${cw} mat=${mat} ⇒ ${r.status}`); continue; }
          n++;
          const eff = r.used.eff, need = r.search.needVol;
          if (!okAt(r.value, shape, hd, eff, need)) { bad++; console.log(`     ✗ 不满足：${shape} hd=${hd} cw=${cw} mat=${mat} D=${r.value}`); continue; }
          for (let d = 1; d < r.value; d++) { if (okAt(d, shape, hd, eff, need)) { bad++; console.log(`     ✗ 非最小：${shape} hd=${hd} cw=${cw} mat=${mat} D=${d}<${r.value} 也满足`); break; } scanned++; }
          maxD = Math.max(maxD, r.value);
        }
      }
    }
  }
  console.log(`     ${n} 个样本全部通过 ${scanned} 次更小直径回扫（失败 ${bad} · 跳过 ${skipped}）· 最大 D_req = ${maxD}mm`);
  ok(bad === 0 && n === 1600, `E1 网格：样本 ${n}/1600，失败 ${bad}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE2  连续式 vs 整数解：ceil(continuous) 是不是最小整数直径？');
// ════════════════════════════════════════════════════════════════════════════
{
  // 130.txt §4.1「不得仅凭连续公式计算结果后向上取整，就认定得到了正确的最小整数直径」
  let n = 0, same_ = 0, hi = 0, lo = 0, maxLo = 0;
  const gaps = [];
  for (const shape of SHAPES) {
    for (const hd of [0.5, 0.8, 1.0, 1.5, 2.0]) {
      for (const cw of [0.5, 2, 10, 50, 200, 900]) {
        const r = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cw });
        if (r.status !== 'ok' || r.continuous === null) continue;
        n++;
        const guess = Math.ceil(r.continuous);
        if (guess === r.value) same_++;
        else if (guess > r.value) { hi++; maxLo = Math.max(maxLo, guess - r.value); }
        else lo++;
        gaps.push(r.gap);
      }
    }
  }
  gaps.sort((a, b) => a - b);
  console.log(`     ${n} 个样本：ceil(连续解) == D_req 的 ${same_}（${pct(same_, n)}）· 偏大 ${hi} · 偏小 ${lo}`);
  console.log(`     gap = D_req − 连续解：min=${gaps[0].toFixed(3)} · 中位=${gaps[Math.floor(gaps.length / 2)].toFixed(3)} · max=${gaps[gaps.length - 1].toFixed(3)}`);
  console.log(`     ⇒ "连续解向上取整"**不是**可靠做法（${hi + lo} 个样本不一致，最大偏高 ${maxLo}mm）`);
  ok(hi + lo > 0, 'E2 应至少观察到若干"连续解取整 ≠ 整数扫描解"的样本（否则本实验没有信息量）');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE3  D_req 与 runRiser 实际推荐尺寸的关系（按 bind 分组）');
// ════════════════════════════════════════════════════════════════════════════
{
  const byBind = new Map();
  let cmpFail = 0, volNotOk = 0, checked = 0;
  for (const shape of SHAPES) {
    for (const hd of [0.5, 0.8, 1.0, 1.5]) {
      for (const cw of [0.5, 2, 10, 50, 200, 900]) {
        for (const mc of [0.5, 2, 5, 20]) {
          const rr = runRiser({ mat: '球铁', mc_mode: 'direct', mc, shape, hd_ratio: hd, cast_wt: cw, eff: undefined });
          const dr = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cw, mat: '球铁' });
          if (!rr || dr.status !== 'ok') continue;
          checked++;
          const rec = byBind.get(rr.bind) || { n: 0, dreqLE: 0, dreqGT: 0, maxGT: 0, sum: 0 };
          rec.n++;
          const diff = dr.value - rr.D;
          rec.sum += diff;
          if (diff <= 0) rec.dreqLE++; else { rec.dreqGT++; rec.maxGT = Math.max(rec.maxGT, diff); }
          byBind.set(rr.bind, rec);
          // ★ 口径差异的直接后果：runRiser 采纳的 D 在 **D_req 口径**（H=round(D·hd)）下是否也满足体积约束？
          if (rr.converged && cw > 0) {
            const need = (cw * 1000000 / rr.rhoUsed) * rr.md.shrink;
            if (!okAt(rr.D, shape, hd, rr.eff, need)) volNotOk++;
          }
        }
      }
    }
  }
  console.log(`     ${checked} 组 (形状×hd×cw×Mc) 对照：`);
  for (const b of ['start', 'modulus', 'volume', 'both', 'limit']) {
    const r = byBind.get(b);
    if (!r) continue;
    console.log(`       bind=${b.padEnd(8)} n=${String(r.n).padStart(4)} · D_req ≤ D_runRiser 的 ${String(r.dreqLE).padStart(4)}（${pct(r.dreqLE, r.n).padStart(6)}）· 平均差 ${(r.sum / r.n).toFixed(2)}mm · 最大正差 ${r.maxGT}mm`);
  }
  const vol = byBind.get('volume');
  if (vol) ok(vol.dreqLE === vol.n, `E3 体积主导（bind=volume）时 D_req 应恒 ≤ D_runRiser（反例 ${vol.dreqGT} 个）`);
  console.log(`     ★ 口径差异后果：runRiser 采纳的 D 在 D_req 口径下**不满足**体积约束的有 ${volNotOk} 个（${pct(volNotOk, checked)}）`);
  console.log('       ⇒ 两个口径（H=round(raw×hd) 与 H=round(D×hd)）实测相差 ΔH ∈ {−1,0,+1}，见 _probe19_geom.mjs P4');
  // 此处**不**断言 volNotOk === 0：它是两个口径本可以不一致的**事实**，要如实记录而不是抹掉
  void cmpFail;
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE4  极端输入的行为边界（如实记录；不设工程阈值）');
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = [];
  for (const hd of [1e-9, 1e-6, 1e-3, 0.1, 1, 10]) {
    const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 1, hd_ratio: hd });
    rows.push([`cyl hd=${hd}`, r.status, r.value, r.height, r.search?.method, r.continuous === null ? 'null' : r.continuous.toFixed(2),
      r.gap === null ? 'null' : r.gap.toFixed(0)]);
  }
  for (const cw of [1e-9, 1e-3, 1e9]) {
    const r = calculateRiserDreq({ shape: 'cyl', cast_wt: cw, hd_ratio: 1 });
    rows.push([`cyl cw=${cw}`, r.status, r.value, r.height, r.search?.method, r.continuous === null ? 'null' : r.continuous.toFixed(2),
      r.gap === null ? 'null' : r.gap.toFixed(0)]);
  }
  for (const rho of [1e-6, 1e-3, 22.6]) {
    const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 1, rho });
    rows.push([`cyl rho=${rho}`, r.status, r.value, r.height, r.search?.method, r.continuous === null ? 'null' : r.continuous.toFixed(2),
      r.gap === null ? 'null' : r.gap.toFixed(0)]);
  }
  for (const eff of [1e-9, 0.001, 99.9]) {
    const r = calculateRiserDreq({ shape: 'cyl', cast_wt: 1, eff });
    rows.push([`cyl eff=${eff}%`, r.status, r.value, r.height, r.search?.method, r.continuous === null ? 'null' : r.continuous.toFixed(2),
      r.gap === null ? 'null' : r.gap.toFixed(0)]);
  }
  console.log('     输入'.padEnd(24) + 'status'.padEnd(16) + 'D_req'.padEnd(14) + 'H'.padEnd(8) + '方式'.padEnd(8) + '连续解'.padEnd(14) + 'gap');
  for (const [a, s, v, h, m, c, g] of rows) {
    console.log('     ' + String(a).padEnd(24) + String(s).padEnd(16) + String(v).padEnd(14) + String(h).padEnd(8) + String(m || '—').padEnd(8) + String(c).padEnd(14) + String(g));
  }
  console.log('     ★ hd→0 时 D_req 爆炸（H 被取整到 1），这是**既有口径**的必然结果，不是本模块新增的行为；');
  console.log('       V2.0-18 已把"要不要设工程上界"列为**产品决策**（U-1），本阶段按 130.txt §八 不擅自设阈值。');
  for (const [, s, v] of rows) {
    ok(['ok', 'invalid_input', 'not_applicable', 'unsupported', 'no_solution'].includes(s), `未知状态 ${s}`);
    if (s !== 'ok') ok(v === null, `status=${s} 时 value 应为 null（得到 ${v}）`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE5  单调性：V(D) 对整数 D 不减（二分路径的**唯一**依赖）');
// ════════════════════════════════════════════════════════════════════════════
{
  let pts = 0, viol = 0;
  for (const shape of SHAPES) {
    for (const hd of [1e-7, 1e-4, 1e-3, 0.01, 0.1, 0.3, 0.49, 0.5, 0.51, 0.8, 1.0, 1.5, 3.0, 7.0]) {
      let prev = -1;
      for (let D = 1; D <= 3000; D++) {
        const v = vOf(D, shape, hd);
        if (!(v >= prev)) viol++;
        prev = v; pts++;
      }
    }
  }
  console.log(`     ${pts} 个 (形状,hd,D) 点，违反 ${viol} 次`);
  ok(viol === 0, `E5 单调性被违反 ${viol} 次`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE6  状态覆盖：五态各自可达、且互不混淆');
// ════════════════════════════════════════════════════════════════════════════
{
  const seen = new Map();
  const cases = [
    ['ok', { shape: 'cyl', cast_wt: 5 }],
    ['invalid_input', { shape: 'cyl', cast_wt: -1 }],
    ['not_applicable', { shape: 'cyl', cast_wt: 0 }],
    ['unsupported', { shape: 'cyl', cast_wt: 1e300, rho: 1e-300 }],
  ];
  for (const [want, inp] of cases) {
    const r = calculateRiserDreq(inp);
    seen.set(want, r.status);
    console.log(`     ${want.padEnd(16)} ← ${JSON.stringify(inp).slice(0, 52).padEnd(54)} 实际 ${r.status}`);
    ok(r.status === want, `${want} 用例实际得到 ${r.status}`);
    if (want !== 'ok') ok(r.value === null, `${want}：value 应为 null`);
  }
  console.log(`     no_solution：在本模块的有界搜索里**构造不出来**（上界已证明有解）；` +
    `该状态保留给浮点异常，见 riserDreq.js 的终检分支。`);
  ok(seen.size === 4, 'E6 四态应各自可达');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE7  独立复算：用 runRiser 的体积公式反推 D_req 所在区间（不调用本模块的搜索）');
// ════════════════════════════════════════════════════════════════════════════
{
  // 做法：对每个样本，用 runRiser 把 cw 调到恰好让体积约束在给定 D 上取等，检查边界两侧
  let checked = 0, bad = 0;
  for (const shape of SHAPES) {
    for (const hd of [0.5, 0.8, 1.0, 1.6]) {
      for (const cw of [1, 10, 100]) {
        const r = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cw });
        if (r.status !== 'ok') continue;
        const D = r.value, eff = r.used.eff, shrink = r.used.shrink, rho = r.used.rho;
        // 由 V(D)×eff ≥ cw×1e6/rho×shrink 与 V(D−1)×eff < cw×1e6/rho×shrink 解出 cw 的允许区间
        const vD = vOf(D, shape, hd), vDm = vOf(D - 1, shape, hd);
        const cwMax = vD * eff * rho / (1e6 * shrink);          // cw 再大就该用 D+1 了
        const cwMin = vDm * eff * rho / (1e6 * shrink);         // cw 小于此值时 D−1 就够
        checked++;
        // 用略小于 cwMax 的 cw 重算，应当仍得 D；用略大于 cwMin 的 cw 重算，应当得 D
        const a = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cwMax * 0.999999 });
        const b = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cwMin * 1.000001 });
        if (a.status === 'ok' && a.value !== D) { bad++; console.log(`     ✗ ${shape} hd=${hd} cw≈cwMax ⇒ D=${a.value} ≠ ${D}`); }
        if (b.status === 'ok' && b.value !== D) { bad++; console.log(`     ✗ ${shape} hd=${hd} cw≈cwMin ⇒ D=${b.value} ≠ ${D}`); }
      }
    }
  }
  console.log(`     ${checked} 组边界反推，不符 ${bad} 次`);
  ok(bad === 0, `E7 边界反推不符 ${bad} 次`);
}

console.log(`\n实验自检：${fail} 项失败`);
console.log('⚠ 本脚本不在 tests/runner.mjs 的统计范围内（runner 非递归，只读 tests/*_test.mjs）。');
process.exitCode = fail ? 1 : 0;
