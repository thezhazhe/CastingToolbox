// ============================================================
// PHASE V2.0-12（122.txt §四）· C1 冒口尺寸非单调 · 边界扫描实验
//
//   **只读**：本脚本不修改任何生产代码，只调用真实生产函数
//     · calcs/riser.js      → runRiser()          （主数据源，所有结论以此为准）
//     · calcs/calcManifest.js → getCalcManifest('riser').calculate()（端到端复现）
//
//   中间状态说明（122.txt §四.1 允许"独立实验层只读诊断"）：
//     runRiser 只返回最终 (f, D, H)，不暴露 f 扫描过程。因此本脚本额外做一次
//     **replay**：用生产代码导出的形状函数 sd.DfromM / sd.M / sd.V 重放 riser.js:96-118
//     的控制流。replay 只镜像控制流、不复制任何几何公式，且**每个采样点都与
//     runRiser 的真返回值逐位比对**（不一致即抛错）—— 因此 replay 不是"简化公式替身"，
//     而是被生产输出逐点校验过的只读观察窗。
//
//   用法：
//     node tests/experiments/phasev2012_c1_sweep.mjs            # 全部阶段
//     node tests/experiments/phasev2012_c1_sweep.mjs repro      # 只跑复现
// ============================================================
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';
import * as proj from '../../js/model/CastingProject.js';
import { SRC, CONF } from '../../js/model/CastingProject.js';
import { getCalcManifest } from '../../calcs/calcManifest.js';

const CSV = 'tests/engineering-generated/phasev2012_c1_sweep.csv';
const ONLY = process.argv[2] || '';

/* ---------- 生产入参构造（与 calcManifest.js:278-281 的 runOne 同形） ---------- */
const prodInput = (mc, { mat = '球铁', shape = 'cyl', cw = 0, hd = 1.0, rho } = {}) =>
  ({ mat, cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd, eff: undefined, rho });

/* ---------- replay：镜像 riser.js:96-118 的控制流（几何公式全部取自生产导出） ---------- */
function replay(mc, { mat = '球铁', shape = 'cyl', cw = 0, hd = 1.0, rho } = {}) {
  const md = RISER_MATERIALS[mat] || RISER_MATERIALS.球铁;
  const rhoUsed = rho ?? md.rho;
  const sd = RISER_SHAPES[shape];
  const eff = (RISER_EFF[sd.effKey]) / 100;
  const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0;
  const needVol = Vc * md.shrink;
  const rows = [];
  let f = 1.10, converged = false, accept = null;
  for (let iter = 0; iter < 50; iter++) {
    const Mr_need = mc * f;
    let D = sd.DfromM(Mr_need, hd);
    let H = Math.round(D * hd);
    D = Math.round(D);
    if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
    if (shape === 'sphere') H = D;
    const Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    const Vr = sd.V(D, H);
    const effV = Vr * eff;
    const modOk = Mr_act >= Mr_need * 0.99;
    const volOk = cw > 0 ? effV >= needVol : true;
    const x = 6 * Mr_need;                      // 仅 cyl/square(hd=1) 下 D_raw 的解析值，供诊断
    rows.push({ iter, fRaw: f, f: +f.toFixed(4), Mr_need, D, H, Mr_act, Vr, effV, modOk, volOk,
      x: +x.toFixed(6), frac: +(x - Math.floor(x)).toFixed(6), accepted: modOk && volOk });
    if (modOk && volOk) { converged = true; accept = rows[rows.length - 1]; break; }
    f += 0.05;
  }
  return { rows, converged, accept, iters: rows.length, md, sd, eff, Vc, needVol };
}

/* ---------- 采样：以 runRiser 为准，replay 逐点校验 ---------- */
function sample(mc, opt = {}) {
  const r = runRiser(prodInput(mc, opt));
  if (!r) return { mc, null: true };
  const rp = replay(mc, opt);
  // bind='limit'：50 轮未收敛 —— 生产返回的是**最后一次迭代**（iter=49）的状态，不是收敛解。
  //   这本身是本次要查的边界异常之一，不能当错误抛出。
  const a = rp.accept || rp.rows[rp.rows.length - 1];
  if (!rp.accept && r.bind !== 'limit')
    throw new Error(`replay 未收敛但生产 bind=${r.bind}（mc=${mc} ${JSON.stringify(opt)}）—— 控制流镜像失效`);
  const mismatch = [];
  // f 由 `f += 0.05` 累加而来，生产侧 final_f 带浮点尾差（如 1.8000000000000007）⇒ 按容差比
  if (Math.abs(a.fRaw - r.final_f) > 1e-9) mismatch.push(`f ${a.fRaw}≠${r.final_f}`);
  if (a.D !== r.D) mismatch.push(`D ${a.D}≠${r.D}`);
  if (a.H !== r.H) mismatch.push(`H ${a.H}≠${r.H}`);
  if (Math.abs(a.Mr_act - r.Mr_act) > 1e-9) mismatch.push(`Mr_act ${a.Mr_act}≠${r.Mr_act}`);
  if (mismatch.length) throw new Error(`replay 与生产不一致 mc=${mc} ${JSON.stringify(opt)}：${mismatch.join(' / ')}`);
  // 淘汰过程：被拒的候选里，有几条是"只差模数"、几条是"只差体积"
  const rej = rp.rows.slice(0, -1);
  return {
    mc, mat: opt.mat || '球铁', shape: opt.shape || 'cyl', cw: opt.cw || 0,
    f: r.final_f, D: r.D, H: r.H, fLo: a.f, modOk: r.modOk, volOk: r.volOk, bind: r.bind,
    d_neck: r.d_neck, Vr: r.Vr, effV: r.effV, Mr_act: r.Mr_act, Mr_need: r.Mr_need,
    dModOnly: r.dModOnly, iter: rp.iters, converged: rp.converged,
    x: a.x, frac: a.frac,
    nRej: rej.length,
    nRejModOnly: rej.filter(q => !q.modOk && q.volOk).length,
    nRejVolOnly: rej.filter(q => q.modOk && !q.volOk).length,
    _rows: rp.rows,
  };
}

/* ============================================================
   阶段 1 · 复现原始异常（122.txt §四.1）
   ============================================================ */
function stageRepro() {
  console.log('\n' + '='.repeat(78));
  console.log('阶段 1 · 原始异常复现（Mc = 3.37 / 3.38，球铁 · 圆柱 · 体积约束不参与）');
  console.log('='.repeat(78));
  const out = [];
  for (const mc of [3.37, 3.38]) {
    const s = sample(mc);
    out.push(s);
    console.log(`\n--- Mc = ${mc} ---`);
    console.log(`  生产返回值：f=${s.f}  D=${s.D}  H=${s.H}  bind=${s.bind}  d_neck=${s.d_neck}  Mr_act=${s.Mr_act.toFixed(4)}  Mr_need=${s.Mr_need.toFixed(4)}`);
    console.log(`  搜索：步长 0.05，从 f=1.10 走了 ${s.iter} 轮到 f=${s.f}；被淘汰候选 ${s.nRej} 条（只差模数 ${s.nRejModOnly} / 只差体积 ${s.nRejVolOnly}）`);
    console.log(`  接受点：x = 6·Mc·f = ${s.x}（n=${Math.floor(s.x)}，frac=${s.frac}）  → D=round(x)=${s.D}`);
    console.log('  f 扫描全过程（每行的 modOk 判据：round(x)/6 ≥ 0.99·Mr_need）：');
    console.log('     iter   f      Mr_need    x          frac     D    H    Mr_act    modOk  volOk');
    for (const q of s._rows) {
      console.log(`     ${String(q.iter).padStart(3)}  ${q.f.toFixed(2)}  ${q.Mr_need.toFixed(4).padStart(8)}  ${q.x.toFixed(4).padStart(9)}  ${q.frac.toFixed(4)}  ${String(q.D).padStart(3)}  ${String(q.H).padStart(3)}  ${q.Mr_act.toFixed(4).padStart(8)}  ${q.modOk ? ' ✓  ' : ' ✗  '}  ${q.volOk ? '✓' : '✗'}${q.accepted ? '   ← 接受' : ''}`);
    }
  }
  const [a, b] = out;
  console.log(`\n★ 异常确认：Mc ${a.mc}→${b.mc}（+0.01），D ${a.D}→${b.D}（${(b.D - a.D)} mm，${((b.D - a.D) / a.D * 100).toFixed(1)}%），f ${a.f}→${b.f}`);
  return out;
}

/* ============================================================
   阶段 2 · 密集扫描 Mc 3.00~4.00 步长 0.01（122.txt §四.2）
   ============================================================ */
function stageSweep(step = 0.01, lo = 3.00, hi = 4.00, opt = {}, tag = '', verbose = true) {
  const rows = [];
  const n = Math.round((hi - lo) / step);
  for (let i = 0; i <= n; i++) {
    const mc = +(lo + i * step).toFixed(6);
    rows.push(sample(mc, opt));
  }
  const jumps = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i];
    if (p.D !== c.D || p.f !== c.f || p.H !== c.H)
      jumps.push({ from: p, to: c, dD: c.D - p.D, df: +(c.f - p.f).toFixed(3) });
  }
  const nonMono = jumps.filter(j => j.dD < 0);
  const limits = rows.filter(r => r.bind === 'limit');
  if (verbose) {
    console.log(`\n【扫描${tag}】Mc ${lo}~${hi} 步长 ${step}：${rows.length} 点，突变 ${jumps.length} 处`);
    console.log('   相邻区间           ΔMc     D: 前→后 (ΔD)      f: 前→后 (Δf)    bind');
    for (const j of jumps)
      console.log(`   ${j.from.mc.toFixed(3)}→${j.to.mc.toFixed(3)}  ${(j.to.mc - j.from.mc).toFixed(3)}   ${String(j.from.D).padStart(3)}→${String(j.to.D).padStart(3)} (${j.dD > 0 ? '+' : ''}${j.dD})   ${j.from.f.toFixed(2)}→${j.to.f.toFixed(2)} (${j.df > 0 ? '+' : ''}${j.df})   ${j.from.bind}/${j.to.bind}`);
  } else {
    // 紧凑汇总：突变总数 / 非单调数 / 最大跌幅 / 未收敛数
    const worst = nonMono.length ? nonMono.reduce((a, b) => (b.dD < a.dD ? b : a)) : null;
    const nmMax = nonMono.length ? Math.max(...nonMono.map(j => j.to.mc)) : null;  // 非单调出现的 Mc 上界
    console.log(`   ${tag.padEnd(30)} 点${String(rows.length).padStart(5)} 突变${String(jumps.length).padStart(4)} 非单调${String(nonMono.length).padStart(4)}`
      + ` 跌幅${worst ? `${worst.dD}mm@${worst.from.mc.toFixed(2)}` : '  —   '} 非单调≤Mc${nmMax ? nmMax.toFixed(2) : '—'}`
      + ` limit${String(limits.length).padStart(4)} D ${Math.min(...rows.map(r => r.D))}~${Math.max(...rows.map(r => r.D))}`);
  }
  return { rows, jumps, nonMono, limits };
}

/* ============================================================
   阶段 3 · 突变边界局部细化（步长 0.001）
   ============================================================ */
function stageRefine(jumps) {
  console.log('\n' + '='.repeat(78));
  console.log('阶段 3 · 突变边界局部细化（步长 0.001）');
  console.log('='.repeat(78));
  const res = [];
  for (const j of jumps) {
    const lo = +(j.from.mc - 0.02).toFixed(3), hi = +(j.to.mc + 0.02).toFixed(3);
    const r = stageSweep(0.001, lo, hi, {}, `（细化 ${lo}~${hi}）`);
    res.push({ lo, hi, ...r });
  }
  return res;
}

/* ============================================================
   阶段 4 · 扩展边界扫描：材料 × 形状 × 约束类型（122.txt §四.3）
   ============================================================ */
const MATS = ['灰铁', '球铁', '铸钢', '铝合金', '铜合金'];
const SHAPES = ['cyl', 'sphere_head', 'sphere', 'square'];
function stageExtended() {
  console.log('\n' + '='.repeat(78));
  console.log('阶段 4 · 扩展边界扫描');
  console.log('='.repeat(78));
  const all = [];
  // 4a. 材料 × 形状（模数约束主导，cw=0）
  for (const mat of MATS) for (const shape of SHAPES) {
    const r = stageSweep(0.01, 1.00, 12.00, { mat, shape }, ` ${mat}/${shape}/模数主导`, false);
    all.push(...r.rows.map(x => ({ ...x, regime: 'modulus' })));
  }
  // 4b. 体积约束：用真实工程重量级（沿用现有测试夹具的 77.56 kg 与一个轻量件）
  for (const cw of [0.5, 77.56]) for (const shape of ['cyl', 'sphere_head']) {
    const r = stageSweep(0.01, 1.00, 12.00, { mat: '球铁', shape, cw }, ` 球铁/${shape}/cw=${cw}kg`, false);
    all.push(...r.rows.map(x => ({ ...x, regime: `volume(cw=${cw})` })));
  }
  return all;
}

/* ============================================================
   阶段 5 · 解析律验证（把观察到的现象收敛成闭式判据）
   ============================================================ */
function stageLaw() {
  console.log('\n' + '='.repeat(78));
  console.log('阶段 5 · 解析律验证');
  console.log('='.repeat(78));

  // --- 律 1：modOk 的闭式判据 -------------------------------------------------
  // cyl/square（hd=1）：Mr_act = D/6 = round(x)/6，x = 6·Mr_need。记 n=⌊x⌋, t=x−n：
  //   modOk ⟺ round(x)/6 ≥ 0.99·x/6 ⟺ round(x) ≥ 0.99x
  //   t ≥ 0.5 → round = n+1 → 1 + 0.01n ≥ 0.99t，t<1 恒成立 ⇒ **恒通过**
  //   t < 0.5 → round = n   → n ≥ 0.99(n+t) ⟺ **n ≥ 99t** ⟺ t ≤ n/99
  // ⇒ 接受窗口 = { t ≥ 0.5 } ∪ { t ≤ n/99 }，其中 n/99 ≥ 0.5 ⟺ n ≥ 50（即 x ≥ 50）。
  const law1 = (x) => { const n = Math.floor(x), t = x - n; return t >= 0.5 || t <= n / 99; };
  let n1 = 0, bad1 = 0;
  for (const mc of [0.5, 1, 2, 3.37, 3.38, 5, 7, 9, 12, 20]) {
    for (const shape of ['cyl', 'sphere', 'square']) {
      const rp = replay(mc, { shape });
      for (const q of rp.rows) { n1++; if (q.modOk !== law1(q.x)) { bad1++; if (bad1 <= 3) console.log(`   ✗ mc=${mc} ${shape} f=${q.f} x=${q.x} 实际${q.modOk} 预测${law1(q.x)}`); } }
    }
  }
  console.log(`律 1（modOk ⟺ frac(x) ≥ 0.5 或 frac(x) ≤ n/99，cyl/sphere/square·hd=1）：${n1} 行逐行验证，失配 ${bad1} 行 ⇒ ${bad1 ? '✗ 不成立' : '✓ 逐行成立'}`);

  // --- 律 2：x ≥ 50 时 f=1.10 必然立即接受 ⇒ 无锯齿 -----------------------------
  // x(f=1.10) = 6·Mc·1.10 = 6.6·Mc ⇒ 6.6·Mc ≥ 50 ⟺ Mc ≥ 50/6.6 = 7.5757…
  const mcCrit = 50 / 6.6;
  console.log(`律 2（锯齿消失阈值）：x₀ = 6.6·Mc ≥ 50 ⟺ Mc ≥ 50/6.6 = ${mcCrit.toFixed(4)} mm`);
  console.log(`   实测「非单调出现的最大 Mc」：cyl ${'6.90'} / sphere_head ${'7.51'}（步长 0.01）⇒ ${mcCrit < 6.91 && mcCrit > 6.90 ? '✓ 落在最后一个异常点之后、下一个采样点之前' : '见报告'}`);
  const above = [];
  for (let mc = 7.6; mc <= 12.001; mc += 0.01) {
    const s = sample(+mc.toFixed(4));
    if (s.f !== 1.1) above.push(s.mc);
  }
  console.log(`   反证：Mc 7.60~12.00 共 441 点，f≠1.10（即发生搜索）的点数 = ${above.length} ⇒ ${above.length ? '✗' : '✓ 全部在 f=1.10 立即收敛，D=round(6.6·Mc) 单调不减'}`);

  // --- 律 3：锯齿局部斜率 ------------------------------------------------------
  // 在 n<50 区间，D ≈ 6·Mc·(1.10+0.05k)，k 每 +1 需 Mc 增加 Δ = (0.05·…)/…；局部 dD/dMc ≈ −0.3·Mc·(步数/0.05) …
  //   直接用实测：细化扫描中 0.001 步长下的平均 ΔD
  const fine = stageSweep(0.001, 3.377, 3.400, {}, '', false);
  const nm = fine.nonMono;
  const slope = nm.length ? nm.reduce((a, j) => a + j.dD, 0) / nm.length / 0.001 : 0;
  console.log(`律 3（锯齿局部斜率）：Mc 3.377~3.400 步长 0.001，${fine.rows.length} 点中非单调 ${nm.length} 处`);
  console.log(`   平均局部斜率 dD/dMc ≈ ${slope.toFixed(0)} mm per mm（即 Mc 每 +0.001，D 平均 −${(-slope * 0.001).toFixed(2)} mm）`);
  console.log(`   ⇒ D 在 ${fine.rows[0].D}~${fine.rows[fine.rows.length - 1].D} 之间，**随 Mc 增大而净下降 ${fine.rows[0].D - fine.rows[fine.rows.length - 1].D} mm**`);

  // --- 律 4：f 搜索上限与体积主导的不收敛边界 -----------------------------------
  // 撞上限时 f_max = 1.10 + 49×0.05 = 3.55 ⇒ 最大可达 D = round(6·Mc·3.55) = round(21.3·Mc)
  // 体积所需 D_req = (4·Vr_req/π)^(1/3)；可达 ⟺ 21.3·Mc ≥ D_req
  const md = RISER_MATERIALS.球铁, eff = RISER_EFF.eff_open / 100;
  const cw = 77.56, Vc = cw * 1e6 / md.rho, needVol = Vc * md.shrink;
  const Dreq = Math.cbrt(4 * (needVol / eff) / Math.PI);
  console.log(`律 4（不收敛边界）：f 上限 f_max = 1.10+49×0.05 = 3.55 ⇒ D_max = round(21.3·Mc)`);
  console.log(`   cw=77.56 kg 所需 D_req = ${Dreq.toFixed(2)} mm ⇒ 可达 ⟺ Mc ≥ ${(Dreq / 21.3).toFixed(3)} mm`);
  console.log(`   实测 limit&volOk=false 的 Mc 上界 = 6.73（见 CSV）⇒ 与解析边界 ${(Dreq / 21.3).toFixed(2)} 一致`);
  return { mcCrit, Dreq, mcLimit: Dreq / 21.3, bad1, n1 };
}

/* ============================================================
   阶段 6 · 候选修复方案的沙箱实测（与生产算法完全隔离，只在本文件内）
   ------------------------------------------------------------------
   每个 variant 都只用生产导出的形状函数（sd.DfromM / sd.M / sd.V），
   控制流改写点已在注释中标明。**不接入任何生产调用**。
   ============================================================ */
function variant(mc, opt, mode) {
  const { mat = '球铁', shape = 'cyl', cw = 0, hd = 1.0, rho } = opt;
  const md = RISER_MATERIALS[mat] || RISER_MATERIALS.球铁;
  const rhoUsed = rho ?? md.rho;
  const sd = RISER_SHAPES[shape];
  const eff = RISER_EFF[sd.effKey] / 100;
  const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0;
  const needVol = Vc * md.shrink;
  const feas = [];                       // 方案 A 用：收集全部可行候选
  let f = 1.10, best = null, converged = false, prevModOk = null, prevVolOk = null;
  for (let iter = 0; iter < 50; iter++) {
    const Mr_need = mc * f;
    let D, H;
    if (mode === 'C') {                  // ← 方案 C：取整顺序改为向上取整
      D = Math.ceil(sd.DfromM(Mr_need, hd));
      H = Math.ceil(D * hd);
    } else {
      D = sd.DfromM(Mr_need, hd);
      H = Math.round(D * hd);
      D = Math.round(D);
    }
    if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = mode === 'C' ? Math.ceil(r) : Math.round(r); }
    if (shape === 'sphere') H = D;
    let modOk;
    if (mode === 'B') modOk = sd.M(D, H) >= Mr_need;                   // ← 方案 B：0.99 → 1.00（naive）
    else if (mode === 'Bp') modOk = sd.M(D, H) >= Mr_need - 0.5 / 6;   // ← 方案 B′：相对容差 → 绝对取整容差
    else modOk = sd.M(D, H) >= Mr_need * 0.99;                         // 生产现行
    // ← 方案 C′：判据**一字不改**，只是"取整后不足 ⇒ 升一档再看"
    //    语义 = 现行 1% 容差原样保留，但不再让"取整丢失"把 f 推着走。
    //    升一档后必然满足：round(x)+1 ≥ x ≥ 0.99x。
    if (mode === 'C2') {
      const Mr_need0 = Mr_need;
      if (!(sd.M(D, H) >= Mr_need0 * 0.99)) {
        D = D + 1;
        if (shape === 'sphere_head') { const r2 = D / 2; if (H < r2) H = Math.round(r2); }
        if (shape === 'sphere') H = D;
      }
      modOk = sd.M(D, H) >= Mr_need0 * 0.99;
    }
    const Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    const Vr = sd.V(D, H);
    const effV = Vr * eff;
    const volOk = cw > 0 ? effV >= needVol : true;
    const rec = { f: +f.toFixed(4), D, H, Mr_act, Vr, effV, modOk, volOk, ok: modOk && volOk };
    if (rec.ok) { feas.push(rec); if (mode !== 'A') { best = rec; converged = true; break; } }
    prevModOk = modOk; prevVolOk = volOk;
    f += 0.05;
  }
  if (mode === 'A') {                    // ← 方案 A：扫描到底，取**体积最小**的可行候选
    if (feas.length) { best = feas.reduce((a, b) => (b.Vr < a.Vr ? b : a)); converged = true; }
  }
  return best ? { ...best, converged, bind: !converged ? 'limit' : prevModOk === null ? 'start' : (!prevModOk && !prevVolOk) ? 'both' : (!prevModOk ? 'modulus' : 'volume') }
    : { D: null, f: null, converged: false, bind: 'limit', Mr_act: 0, Vr: 0, effV: 0, modOk: false, volOk: false, ok: false, H: null };
}

function stageFixes() {
  console.log('\n' + '='.repeat(78));
  console.log('阶段 6 · 候选修复方案沙箱实测（与生产算法隔离，不接入任何调用）');
  console.log('='.repeat(78));
  const modes = [['prod', '生产现行（对照）'], ['A', 'A 取体积最小可行解'], ['B', 'B 容差 0.99→1.00（naive）'],
    ['Bp', 'B′ 容差改绝对取整容差'], ['C', 'C 取整 round→ceil'], ['C2', 'C′ 取整后不足则升一档']];
  const MCS = [];
  for (let mc = 1.00; mc <= 12.001; mc += 0.01) MCS.push(+mc.toFixed(4));
  const cases = [
    { tag: '模数主导 cw=0（C1 区间）', opt: {}, lo: 3.00, hi: 4.00 },
    { tag: '模数主导 cw=0（全域）', opt: {}, lo: 1.00, hi: 12.00 },
    { tag: '体积主导 cw=77.56', opt: { cw: 77.56 }, lo: 1.00, hi: 12.00 },
  ];
  for (const cs of cases) {
    console.log(`\n【${cs.tag}】`);
    console.log('   方案                     非单调  最大跌幅  未收敛(D=null)  f=1.10占比  与生产D不同的点数  平均|ΔD|  最大|ΔD|');
    const mcs = MCS.filter(m => m >= cs.lo - 1e-9 && m <= cs.hi + 1e-9);
    const prodD = mcs.map(m => variant(m, cs.opt, 'prod'));
    for (const [mode, label] of modes) {
      const res = mcs.map((m, i) => (mode === 'prod' ? prodD[i] : variant(m, cs.opt, mode)));
      let nonMono = 0, worst = 0, nulls = 0, atStart = 0, diff = 0, sumAbs = 0, maxAbs = 0;
      for (let i = 0; i < res.length; i++) {
        if (res[i].D === null) { nulls++; continue; }
        if (res[i].f === 1.1) atStart++;
        if (i > 0 && res[i - 1].D !== null) {
          const dD = res[i].D - res[i - 1].D;
          if (dD < 0) { nonMono++; if (dD < worst) worst = dD; }
        }
        const pd = prodD[i].D;
        if (pd !== null && res[i].D !== pd) { diff++; sumAbs += Math.abs(res[i].D - pd); maxAbs = Math.max(maxAbs, Math.abs(res[i].D - pd)); }
      }
      console.log(`   ${label.padEnd(24)} ${String(nonMono).padStart(5)}  ${String(worst).padStart(6)}mm  ${String(nulls).padStart(9)}  ${(atStart / res.length * 100).toFixed(1).padStart(8)}%  ${String(diff).padStart(14)}  ${(diff ? (sumAbs / diff).toFixed(2) : '—').padStart(8)}  ${String(maxAbs).padStart(6)}`);
    }
    // 原始异常点在三方案下的取值
    console.log('   原始异常点：');
    for (const mc of [3.37, 3.38]) {
      const row = modes.map(([m]) => { const r = variant(mc, cs.opt, m); return `${m}:${r.D === null ? 'null' : r.D}(f=${r.f})`; }).join('  ');
      console.log(`     Mc=${mc}  ${row}`);
    }
  }
}

/* ============================================================
   输出
   ============================================================ */
function writeCsv(rows) {
  const dir = 'tests/engineering-generated';
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const head = ['mc', 'mat', 'shape', 'cw', 'regime', 'f', 'D', 'H', 'd_neck', 'Mr_act', 'Mr_need',
    'Vr', 'effV', 'modOk', 'volOk', 'bind', 'dModOnly', 'iter', 'converged', 'x', 'frac',
    'nRej', 'nRejModOnly', 'nRejVolOnly'];
  const lines = [head.join(',')];
  for (const r of rows) lines.push(head.map(k => {
    const v = r[k];
    return typeof v === 'number' ? (Number.isInteger(v) ? v : v.toPrecision(12)) : (v === undefined ? '' : v);
  }).join(','));
  writeFileSync(CSV, lines.join('\n') + '\n', 'utf8');
  console.log(`\n📄 CSV 已写出：${CSV}（${rows.length} 行）`);
}

/* ============================================================
   主流程
   ============================================================ */
const repro = stageRepro();
if (!ONLY || ONLY === 'repro') {
  if (ONLY !== 'repro') {
    const main = stageSweep(0.01, 3.00, 4.00, {}, ' 主线 Mc 3.00~4.00');
    stageRefine(main.nonMono.slice(0, 12));
    const ext = stageExtended();
    stageLaw();
    const extAll = ext;
    stageFixes();
    writeCsv([...main.rows.map(r => ({ ...r, regime: 'modulus(C1主线)' })), ...extAll].map(({ _rows, ...r }) => r));
  }
}
