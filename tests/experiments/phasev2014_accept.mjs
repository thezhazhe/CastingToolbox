// ============================================================
// PHASE V2.0-14（125.txt §二）· V2.0-13 实现验收（只读）
//
//   目的：不以"测试通过"代替对代码路径与最终返回值的核查。本脚本做四件事：
//     ① 用**独立镜像**重放 calcs/riser.js 的完整控制流（含 sizeAt），
//        并在**每个采样点**与真实 runRiser 逐位比对 ⇒ 镜像可信后，才用它观测内部状态。
//     ② 对每个返回值做**自洽性核验**：Mr_act/Vr/effV/modOk/volOk/yieldPct/d_neck/dModOnly
//        是否真的由最终 D/H 推出（而不是沿用中间候选）。
//     ③ 两条 limit→收敛边界用例的**逐字段证据**（修复前 = V2.0-12 CSV，修复后 = 当前生产）。
//     ④ 临界值扫描：D→0 极小 Mc、hd≠1、四形状、相邻 Mc 跳变、逻辑矛盾。
//
//   只读：不写任何仓库文件，不修改生产代码。所有结论均来自生产导出函数。
// ============================================================
import { readFileSync } from 'node:fs';
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';

const CSV = 'tests/engineering-generated/phasev2012_c1_sweep.csv';
const F = (k) => RISER_SHAPES[k];
const ok = (b) => b ? '✓' : '✗';
const hr = (t) => console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78));

/* ══════════════════════════════════════════════════════════════
   镜像：逐行照抄 calcs/riser.js 的 runRiser（含 sizeAt 与未收敛还原），
        额外记录 prevModOk/prevVolOk/iter/bumpCount 等内部量。
   —— 与生产的一致性由下面的 assertMirror 在每个采样点强制校验。
   ══════════════════════════════════════════════════════════════ */
function mirror(input) {
  const md = RISER_MATERIALS[input.mat] || RISER_MATERIALS.球铁;
  const rhoUsed = input.rho ?? md.rho;
  const sd = RISER_SHAPES[input.shape];
  const hd = parseFloat(input.hd_ratio) || 1.0;
  const eff = (parseFloat(input.eff) || RISER_EFF[sd.effKey]) / 100;
  const cw = parseFloat(input.cast_wt) || 0;
  const Mc = parseFloat(input.mc) || 0;
  if (Mc <= 0 || !sd) return null;

  const trace = { bumps: 0, bumpStillFails: 0, iters: 0, prevModOk: null, prevVolOk: null };
  const sizeAt = (Mr, hdR) => {
    const raw = sd.DfromM(Mr, hdR);
    let d = Math.round(raw);
    let h = Math.round(raw * hdR);
    if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
    if (input.shape === 'sphere') h = d;
    const okAt = (dd, hh) => (dd > 0 && hh > 0) && sd.M(dd, hh) >= Mr * 0.99;
    if (!okAt(d, h)) {
      trace.bumps++;
      const M0 = (d > 0 && h > 0) ? sd.M(d, h) : 0;
      d += 1;
      h = Math.round(d * hdR);
      if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
      if (input.shape === 'sphere') h = d;
      if (!okAt(d, h)) { trace.bumpStillFails++; trace.firstFail = { M0, M1: sd.M(d, h), Mr, d, h, hd, shape: input.shape }; }
    }
    return { D: d, H: h };
  };

  let f = 1.10, D = 0, H = 0, Mr_act = 0, Vr = 0, effV = 0, Mr_need = 0, final_f = 1.10;
  let prevModOk = null, prevVolOk = null, converged = false;
  for (let iter = 0; iter < 50; iter++) {
    trace.iters = iter + 1;
    Mr_need = Mc * f;
    ({ D, H } = sizeAt(Mr_need, hd));
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H);
    effV = Vr * eff;
    final_f = f;
    const modOk = Mr_act >= Mr_need * 0.99;
    let volOk = true;
    if (cw > 0) { const Vc = cw * 1000000 / rhoUsed; volOk = effV >= Vc * md.shrink; }
    if (modOk && volOk) { converged = true; break; }
    prevModOk = modOk; prevVolOk = volOk;
    f += 0.05;
  }
  trace.prevModOk = prevModOk; trace.prevVolOk = prevVolOk;

  if (!converged) {
    const raw = sd.DfromM(Mr_need, hd);
    H = Math.round(raw * hd);
    D = Math.round(raw);
    if (input.shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
    if (input.shape === 'sphere') H = D;
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H);
    effV = Vr * eff;
  }

  const bind = !converged ? 'limit'
    : prevModOk === null ? 'start'
      : (!prevModOk && !prevVolOk) ? 'both'
        : (!prevModOk ? 'modulus' : 'volume');
  const dModOnly = Math.round(sd.DfromM(Mc * 1.10, hd));
  const neck_k = md.neck_k, M_neck = Mc * neck_k, d_neck = Math.round(M_neck * 4);
  const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0;
  const needVol = Vc * md.shrink;
  const modOk = Mr_act >= Mr_need * 0.99;
  const volOk = cw > 0 ? effV >= needVol : true;
  const yieldPct = Vc > 0 ? Vc / (Vc + Vr) * 100 : null;
  return { D, H, Mr_act, Vr, effV, Mr_need, final_f, dModOnly, d_neck, neck_k, M_neck, Vc, needVol, modOk, volOk, yieldPct, bind, converged, Md: md, rhoUsed, trace };
}

/* 逐位比对镜像与生产。
   ★ 审计事实：`runRiser` 的返回对象里**没有 `converged` 字段**（见 riser.js:191-195）——
     它是一个**局部变量**，外部只能通过 `bind === 'limit'` 反推"是否收敛"。
     ⇒ 故此处用 `bind !== 'limit'` 作为收敛性的**唯一外部可见判据**来比对。 */
const PROD_FIELDS = ['D', 'H', 'Mr_act', 'Vr', 'effV', 'Mr_need', 'final_f', 'dModOnly', 'd_neck',
  'M_neck', 'Vc', 'needVol', 'modOk', 'volOk', 'yieldPct', 'bind'];
let mirrorChecked = 0, mirrorMismatch = 0;
const mirrorErrs = [];
function assertMirror(input) {
  const p = runRiser(input), m = mirror(input);
  mirrorChecked++;
  if ((p === null) !== (m === null)) { mirrorMismatch++; mirrorErrs.push(['null 不一致', input]); return null; }
  if (p === null) return p;
  for (const k of PROD_FIELDS) {
    const a = p[k], b = m[k];
    const same = (typeof a === 'number' && typeof b === 'number')
      ? (Number.isFinite(a) ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : a === b)
      : a === b;
    if (!same) { mirrorMismatch++; if (mirrorErrs.length < 5) mirrorErrs.push([`${k}: 生产=${a} 镜像=${b}`, input]); return p; }
  }
  // 收敛性暗含比对：生产未导出 converged ⇒ 用 bind 反推
  if ((m.converged) !== (p.bind !== 'limit')) { mirrorMismatch++; if (mirrorErrs.length < 5) mirrorErrs.push([`converged(bind 反推) 不一致: 镜像=${m.converged} 生产 bind=${p.bind}`, input]); }
  return p;
}
function dumpMirrorErrs() { for (const [msg, inp] of mirrorErrs) console.log('  ❌', msg, '@', JSON.stringify(inp)); }

/* ══════════════════════════════════════════════════════════════
   ① 自洽性核验：每个返回字段是否真的由最终 D/H 推出
   ══════════════════════════════════════════════════════════════ */
const inconsistent = [];
function checkSelfConsistent(input, r) {
  if (!r) return;
  const sd = RISER_SHAPES[input.shape] || RISER_SHAPES.cyl;
  const eff = r.eff ?? (RISER_EFF[sd.effKey] / 100);
  const bad = [];
  if (Math.abs(r.Mr_act - sd.M(r.D, r.H)) > 1e-12) bad.push(`Mr_act≠M(D,H) ${r.Mr_act} vs ${sd.M(r.D, r.H)}`);
  if (Math.abs(r.Vr - sd.V(r.D, r.H)) > 1e-9) bad.push(`Vr≠V(D,H)`);
  if (Math.abs(r.effV - r.Vr * r.eff) > 1e-9) bad.push(`effV≠Vr·eff`);
  if (r.modOk !== (r.Mr_act >= r.Mr_need * 0.99)) bad.push(`modOk 与 Mr_act/Mr_need 不符`);
  if (r.volOk !== (r.cw > 0 ? r.effV >= r.needVol : true)) bad.push(`volOk 与 effV/needVol 不符`);
  if (r.d_neck !== Math.round(r.M_neck * 4)) bad.push(`d_neck≠4·M_neck`);
  if (r.M_neck !== r.Mc * r.neck_k) bad.push(`M_neck≠Mc·neck_k`);
  const sdD = Math.round(sd.DfromM(r.Mc * 1.10, r.hd));
  if (r.dModOnly !== sdD) bad.push(`dModOnly≠round(DfromM(Mc×1.10))`);
  const yp = r.Vc > 0 ? r.Vc / (r.Vc + r.Vr) * 100 : null;
  if (yp === null ? r.yieldPct !== null : Math.abs(r.yieldPct - yp) > 1e-9) bad.push(`yieldPct 不符`);
  if ('converged' in r) bad.push(`返回对象意外含 converged 字段`);
  if (r.D <= 0 || r.H <= 0) bad.push(`D/H ≤ 0（${r.D}/${r.H}）`);
  if (bad.length) inconsistent.push({ input, D: r.D, H: r.H, bad });
}

/* ══════════════════════════════════════════════════════════════
   扫描网格
   ══════════════════════════════════════════════════════════════ */
const SHAPES = ['cyl', 'sphere_head', 'sphere', 'square'];
function grid({ mcLo = 0.5, mcHi = 12, mcStep = 0.01, cws = [0, 0.5, 20, 77.56], shapes = SHAPES, hds = [1.0] } = {}) {
  const out = [];
  for (const shape of shapes) for (const hd of hds) for (const cw of cws)
    for (let i = 0; ; i++) {
      const mc = +(mcLo + i * mcStep).toFixed(10);
      if (mc > mcHi + 1e-9) break;
      out.push({ mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd });
    }
  return out;
}

hr('【1】镜像可信性 + 自洽性核验（网格 = 4 形状 × hd{1.0} × cw{0,0.5,20,77.56} × Mc 0.5~12 步长 0.01）');
const G1 = grid();
let bumpTotal = 0, bumpStillFail = 0, firstFailSample = null;
for (const inp of G1) {
  const r = assertMirror(inp);
  checkSelfConsistent(inp, r);
  const m = mirror(inp);
  if (m) { bumpTotal += m.trace.bumps; if (m.trace.bumpStillFails) { bumpStillFail += m.trace.bumpStillFails; if (!firstFailSample) firstFailSample = { inp, d: m.trace.firstFail }; } }
}
console.log(`采样点                        : ${G1.length}`);
console.log(`镜像逐位比对                  : ${mirrorChecked} 点，不一致 ${mirrorMismatch} ${ok(mirrorMismatch === 0)}`);
console.log(`返回对象自洽性违规            : ${inconsistent.length} ${ok(inconsistent.length === 0)}`);
console.log(`sizeAt 升档触发总次数         : ${bumpTotal}`);
console.log(`★ 升档后**仍不满足** 0.99 判据 : ${bumpStillFail} ${ok(bumpStillFail === 0)}`);
console.log(`★ 返回对象**未导出** converged : ${ok(!('converged' in runRiser({ mat: '球铁', cast_wt: 0, mc_mode: 'direct', mc: 3, shape: 'cyl', hd_ratio: 1 })))}（外部只能由 bind==='limit' 反推）`);
if (firstFailSample) console.log('   首例：', JSON.stringify(firstFailSample));
if (inconsistent.length) for (const x of inconsistent.slice(0, 8)) console.log('   ❌', JSON.stringify(x));
dumpMirrorErrs();

/* ══════════════════════════════════════════════════════════════
   ② 两条 limit→收敛边界用例：逐字段证据
   ══════════════════════════════════════════════════════════════ */
hr('【2】两条 limit→收敛边界用例（修复前 = V2.0-12 CSV；修复后 = 当前生产）');
const lines = readFileSync(CSV, 'utf8').trim().split('\n');
const H0 = lines[0].split(','), ix = (k) => H0.indexOf(k);
const csvRows = lines.slice(1).map(l => { const c = l.split(',');
  return { mc: parseFloat(c[ix('mc')]), shape: c[ix('shape')], cw: parseFloat(c[ix('cw')]), raw: c, c };
});
const CASES = [
  { mc: 1.24, shape: 'cyl', cw: 0.5 },
  { mc: 1.10, shape: 'sphere_head', cw: 0.5 },
];
const BOUND_FIELDS = ['D', 'H', 'f', 'Mr_act', 'Mr_need', 'Vr', 'effV', 'modOk', 'volOk', 'bind', 'iter', 'converged'];
for (const cs of CASES) {
  const row = csvRows.find(r => Math.abs(r.mc - cs.mc) < 1e-9 && r.shape === cs.shape && Math.abs(r.cw - cs.cw) < 1e-9);
  const inp = { mat: '球铁', cast_wt: cs.cw, mc_mode: 'direct', mc: cs.mc, shape: cs.shape, hd_ratio: 1.0 };
  const pre = row ? { D: +row.c[ix('D')], H: +row.c[ix('H')], f: +row.c[ix('f')], Mr_act: +row.c[ix('Mr_act')], Mr_need: +row.c[ix('Mr_need')], Vr: +row.c[ix('Vr')], effV: +row.c[ix('effV')], modOk: row.c[ix('modOk')], volOk: row.c[ix('volOk')], bind: row.c[ix('bind')], iter: +row.c[ix('iter')], converged: row.c[ix('converged')] } : null;
  const post = assertMirror(inp);
  const postConv = mirror(inp).converged;   // 生产未导出 converged ⇒ 取镜像的同源值
  console.log(`\nmc=${cs.mc}  ${cs.shape}  cw=${cs.cw}   ${row ? '（CSV 行已定位）' : '⚠ 未在 CSV 中找到'}`);
  console.log('  字段        修复前           修复后           变化');
  for (const k of BOUND_FIELDS) {
    const a = pre ? pre[k] : '—', b = (k === 'converged') ? postConv : post[k];
    const ch = (typeof a === 'number' && typeof b === 'number') ? (Math.abs(a - b) < 1e-9 ? '=' : '★变') : (String(a) === String(b) ? '=' : '★变');
    console.log(`  ${k.padEnd(10)} ${String(a).padEnd(16)} ${String(b).padEnd(16)} ${ch}`);
  }
  const sd = RISER_SHAPES[cs.shape];
  console.log(`  → 独立复核 D=${post.D}: M(D,H)=${sd.M(post.D, post.H).toFixed(6)} ≥ 0.99·Mr_need=${(0.99 * post.Mr_need).toFixed(6)} ? ${ok(sd.M(post.D, post.H) >= 0.99 * post.Mr_need)}`);
  console.log(`  → D−1=${post.D - 1}: M=${sd.M(post.D - 1, Math.round((post.D - 1) * 1.0)).toFixed(6)} ${ok(sd.M(post.D - 1, post.D - 1) >= 0.99 * post.Mr_need) ? '（也满足 ⇒ 非最小）' : '（不满足 ⇒ D 为最小可行整数）'}`);
}

/* ══════════════════════════════════════════════════════════════
   ③ hd ≠ 1：升档是否仍然足够？（V2.0-13 遗留 U6）
   ══════════════════════════════════════════════════════════════ */
hr('【3】hd ≠ 1 扫描（V2.0-13 遗留 U6）：升档是否仍然足够 + 相邻单调性');
const HDS = [0.5, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0, 3.0];
let hdStillFail = 0, hdNonMono = 0, hdSlack = 0, hdFailEx = null;
for (const shape of SHAPES) {
  const cells = [];
  for (const hd of HDS) {
    const G = grid({ mcLo: 0.5, mcHi: 12, mcStep: 0.01, cws: [0], shapes: [shape], hds: [hd] });
    let bump = 0, stillFail = 0, nonMono = 0, prevD = null, worstM = 0, worst = null;
    for (const inp of G) {
      const r = assertMirror(inp); checkSelfConsistent(inp, r);
      const m = mirror(inp);
      bump += m.trace.bumps; stillFail += m.trace.bumpStillFails;
      if (prevD !== null && r.D < prevD) nonMono++;
      prevD = r.D;
      const slack = m.Mr_act - 0.99 * m.Mr_need;        // 收敛解须 ≥ 0（0.99 判据）
      if (m.converged && slack < -1e-9) { worstM++; worst = { inp, slack }; }
    }
    hdStillFail += stillFail; hdNonMono += nonMono; hdSlack += worstM;
    if (stillFail && !hdFailEx) hdFailEx = { shape, hd };
    cells.push(`${hd}:${bump}|${stillFail ? '★' + stillFail : '足'}`);
    if (nonMono || stillFail || worstM) console.log(`  ⚠ ${shape} hd=${hd}  非单调 ${nonMono} · 升档仍不足 ${stillFail} · 收敛解模数不达标 ${worstM} ${worst ? JSON.stringify(worst) : ''}`);
  }
  console.log(`  ${shape.padEnd(12)} hd:升档次数|是否足够 → ${cells.join('  ')}`);
}
console.log(`hd≠1 汇总：升档仍不足 ${hdStillFail} ${ok(hdStillFail === 0)} · 非单调 ${hdNonMono} ${ok(hdNonMono === 0)} · 收敛解违反 0.99 判据 ${hdSlack} ${ok(hdSlack === 0)}`);
console.log(`镜像总比对 ${mirrorChecked} 点，不一致 ${mirrorMismatch} ${ok(mirrorMismatch === 0)}`);
console.log(`自洽性累计违规 ${inconsistent.length} ${ok(inconsistent.length === 0)}`);

/* ══════════════════════════════════════════════════════════════
   ④ 临界值扫描：D→0 的极小 Mc 区（C′ 与修复前行为差异的未被 CSV 覆盖区）
   ══════════════════════════════════════════════════════════════ */
hr('【4】极小 Mc 临界区（D→0）：round(6·Mc·1.1)=0 附近');
console.log('  CSV 覆盖 Mc ≥ 1，此区**未被修复前基线覆盖** —— 用于识别 C′ 的边界行为');
console.log('  Mc      D   H   f     Mr_act    bind    modOk  volOk  说明');
for (const mc of [0.01, 0.02, 0.05, 0.08, 0.083, 0.0833, 0.084, 0.09, 0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.5, 0.8, 1.0]) {
  const inp = { mat: '球铁', cast_wt: 0, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 };
  const r = assertMirror(inp); checkSelfConsistent(inp, r);
  const note = (6 * mc * 1.10 < 0.5) ? 'raw<0.5 ⇒ 修复前 D=0（除零守卫）' : '';
  console.log(`  ${String(mc).padEnd(7)} ${String(r.D).padEnd(3)} ${String(r.H).padEnd(3)} ${r.final_f.toFixed(2)}  ${r.Mr_act.toFixed(6).padEnd(9)} ${r.bind.padEnd(7)} ${String(r.modOk).padEnd(6)} ${String(r.volOk).padEnd(6)} ${note}`);
}

/* ══════════════════════════════════════════════════════════════
   ⑤ 相邻 Mc 跳变 + 逻辑矛盾（全网格）
   ══════════════════════════════════════════════════════════════ */
hr('【5】相邻 Mc 跳变与逻辑矛盾（全网格，步长 0.01）');
const G5 = grid({ mcLo: 0.05, mcHi: 12, mcStep: 0.01 });
const byKey = new Map();
for (const inp of G5) {
  const r = assertMirror(inp); checkSelfConsistent(inp, r);
  const k = `${inp.shape}|${inp.hd_ratio}|${inp.cast_wt}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push({ mc: inp.mc, D: r.D, H: r.H, bind: r.bind, modOk: r.modOk, volOk: r.volOk, converged: r.bind !== 'limit' });
}
let nonMonoTotal = 0, contradiction = 0;
const contras = [];
for (const [k, seq] of byKey) {
  let nm = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i].D < seq[i - 1].D) nm++;
  if (nm) { nonMonoTotal += nm; console.log(`  ⚠ ${k}：D 递减 ${nm} 处`); }
  for (const s of seq) {
    // 逻辑矛盾三类
    if (s.bind === 'limit' && s.modOk && s.volOk) contras.push({ k, ...s, why: 'limit 却两条都过' });
    if (s.bind !== 'limit' && (!s.modOk || !s.volOk)) contras.push({ k, ...s, why: '收敛却有一条不过' });
    if (s.bind === 'modulus' || s.bind === 'both') contras.push({ k, ...s, why: `bind=${s.bind} 在 C′ 下应不可达` });
  }
}
for (const c of contras.slice(0, 10)) console.log('  ❌', JSON.stringify(c));
contradiction = contras.length;
console.log(`组合数 ${byKey.size} · 采样点 ${G5.length}`);
console.log(`相邻 D 递减（非单调）      : ${nonMonoTotal} ${ok(nonMonoTotal === 0)}`);
console.log(`逻辑矛盾（limit/收敛/bind）: ${contradiction} ${ok(contradiction === 0)}`);

/* ══════════════════════════════════════════════════════════════
   ⑥ D 是否为"最小可行整数"（量化 round() 的既有松弛，非 C′ 缺陷）
   ══════════════════════════════════════════════════════════════ */
hr('【6】收敛点的 D 是否为最小可行整数（模数约束）');
let minCnt = 0, slackCnt = 0, slackMax = 0, slackEx = null;
for (const inp of G1) {
  const r = runRiser(inp);
  if (!r || r.bind === 'limit') continue;
  const sd = RISER_SHAPES[inp.shape];
  const hd = inp.hd_ratio;
  const mAt = (d) => { let h = Math.round(d * hd); if (inp.shape === 'sphere_head' && h < d / 2) h = Math.round(d / 2); if (inp.shape === 'sphere') h = d; return (d > 0 && h > 0) ? sd.M(d, h) : 0; };
  const need = 0.99 * r.Mr_need;
  if (mAt(r.D) >= need && mAt(r.D - 1) >= need) {
    slackCnt++;
    let k = 1; while (mAt(r.D - k - 1) >= need) k++;
    if (k > slackMax) { slackMax = k; slackEx = { ...inp, D: r.D, k }; }
  } else minCnt++;
}
console.log(`收敛点中 D = 最小可行整数 : ${minCnt}`);
console.log(`收敛点中 D 可再小 1 档以上 : ${slackCnt}（最多可小 ${slackMax} 档）${slackEx ? ' 例：' + JSON.stringify(slackEx) : ''}`);
console.log('  ↑ 这是 round() 半步松弛的既有性质（修复前就存在），**不是 C′ 引入的**；');
console.log('    C′ 只保证"最终尺寸满足判据"，不负责压缩 round() 的松弛。');

hr('【汇总】');
console.log(`镜像逐位比对        : ${mirrorChecked} 点，不一致 ${mirrorMismatch}`);
console.log(`返回对象自洽性违规  : ${inconsistent.length}`);
console.log(`升档后仍不满足      : ${bumpStillFail}`);
console.log(`非单调              : ${nonMonoTotal}`);
console.log(`逻辑矛盾            : ${contradiction}`);
console.log(mirrorMismatch === 0 && inconsistent.length === 0 && bumpStillFail === 0 && nonMonoTotal === 0 && contradiction === 0
  ? '\n全部核验通过。' : '\n★ 存在未通过项，见上方明细。');
