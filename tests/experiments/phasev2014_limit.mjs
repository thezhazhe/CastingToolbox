// ============================================================
// PHASE V2.0-14（125.txt §三）· `bind='limit'` 未收敛问题完整调查（只读）
//
//   ① limit 案例的根因分类（体积不过 / 模数不过 / 两者都不过 / 退化输入）
//   ② 不同搜索上限的实验对照（f 上限 3.55 → 更大）——**只在本脚本的镜像里改参数，
//      生产代码一字节不动**
//   ③ 判断"单纯抬高上限"是否可行：收敛率、约束满足、尺寸、异常结果
//   ④ 未收敛结果的向下游传递方式
//   ⑤ 明确区分"算法声明的约束未满足"与"真实铸件必然失败"
// ============================================================
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';

const hr = (t) => console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78));

/* ── 参数化镜像：唯一可变量 = 迭代上限 N（生产 = 50，即 f ≤ 3.55） ── */
function run(input, N = 50) {
  const md = RISER_MATERIALS[input.mat] || RISER_MATERIALS.球铁;
  const rhoUsed = input.rho ?? md.rho;
  const sd = RISER_SHAPES[input.shape];
  const hd = parseFloat(input.hd_ratio) || 1.0;
  const eff = (parseFloat(input.eff) || RISER_EFF[sd.effKey]) / 100;
  const cw = parseFloat(input.cast_wt) || 0;
  const Mc = parseFloat(input.mc) || 0;
  if (Mc <= 0 || !sd) return null;
  const trace = { nIterRejected: 0, rejModOnly: 0, rejVolOnly: 0, rejBoth: 0, rejDegenerate: 0 };
  const sizeAt = (Mr, hdR) => {
    const raw = sd.DfromM(Mr, hdR);
    let d = Math.round(raw), h = Math.round(raw * hdR);
    if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
    if (input.shape === 'sphere') h = d;
    const okAt = (dd, hh) => (dd > 0 && hh > 0) && sd.M(dd, hh) >= Mr * 0.99;
    if (!okAt(d, h)) { d += 1; h = Math.round(d * hdR);
      if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
      if (input.shape === 'sphere') h = d; }
    return { D: d, H: h };
  };
  let f = 1.10, D = 0, H = 0, Mr_act = 0, Vr = 0, effV = 0, Mr_need = 0, final_f = 1.10;
  let prevModOk = null, prevVolOk = null, converged = false;
  for (let iter = 0; iter < N; iter++) {
    Mr_need = Mc * f; ({ D, H } = sizeAt(Mr_need, hd));
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H); effV = Vr * eff; final_f = f;
    const modOk = Mr_act >= Mr_need * 0.99;
    let volOk = true; if (cw > 0) volOk = effV >= (cw * 1000000 / rhoUsed) * md.shrink;
    if (modOk && volOk) { converged = true; break; }
    trace.nIterRejected++;
    if (D <= 0 || H <= 0) trace.rejDegenerate++;
    else if (!modOk && !volOk) trace.rejBoth++;
    else if (!modOk) trace.rejModOnly++;
    else trace.rejVolOnly++;
    prevModOk = modOk; prevVolOk = volOk; f += 0.05;
  }
  if (!converged) {
    const raw = sd.DfromM(Mr_need, hd);
    H = Math.round(raw * hd); D = Math.round(raw);
    if (input.shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
    if (input.shape === 'sphere') H = D;
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0; Vr = sd.V(D, H); effV = Vr * eff;
  }
  const bind = !converged ? 'limit' : prevModOk === null ? 'start'
    : (!prevModOk && !prevVolOk) ? 'both' : (!prevModOk ? 'modulus' : 'volume');
  const Vc = cw > 0 ? cw * 1000000 / rhoUsed : 0, needVol = Vc * md.shrink;
  return { D, H, f: final_f, Mr_act, Mr_need, Vr, effV, Vc, needVol, converged, bind, trace,
    modOk: Mr_act >= Mr_need * 0.99, volOk: cw > 0 ? effV >= needVol : true };
}

/* 自检：N=50 时必须与生产逐位一致 */
{
  let bad = 0, n = 0;
  for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
    for (const cw of [0, 0.5, 20, 77.56]) for (const hd of [0.8, 1, 1.5])
      for (let i = 0; i <= 300; i++) {
        const mc = +(0.1 + i * 0.05).toFixed(6);
        const inp = { mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd };
        const p = runRiser(inp), m = run(inp, 50); n++;
        if (!p || p.D !== m.D || p.H !== m.H || Math.abs(p.final_f - m.f) > 1e-9 || p.bind !== m.bind
          || p.modOk !== m.modOk || p.volOk !== m.volOk) { bad++; if (bad < 4) console.log('  ❌', JSON.stringify(inp)); }
      }
  console.log(`镜像(N=50) vs 生产：${n} 点，不一致 ${bad} —— N=50 即生产口径`);
}
const F_MAX = (N) => 1.10 + 0.05 * (N - 1);

/* ══ ① limit 根因分类 ══ */
hr('【①】limit 案例的根因分类（N=50，生产口径）');
const GRID = [];
for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
  for (const hd of [0.8, 1.0, 1.2, 1.5])
    for (const cw of [0, 0.1, 0.5, 2, 20, 77.56, 200])
      for (let i = 0; ; i++) {
        const mc = +(0.1 + i * 0.05).toFixed(6); if (mc > 12 + 1e-9) break;
        GRID.push({ mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd });
      }
const cls = { volOnly: 0, modOnly: 0, both: 0, degenerate: 0, converged: 0, noIter: 0 };
const clsEx = {};
let limitN = 0;
for (const inp of GRID) {
  const r = run(inp, 50);
  if (r.converged) { cls.converged++; continue; }
  limitN++;
  const t = r.trace;
  if (t.rejVolOnly > 0 && t.rejModOnly === 0 && t.rejBoth === 0) { cls.volOnly++; clsEx.volOnly ??= { inp, r }; }
  else if (t.rejModOnly > 0 && t.rejVolOnly === 0 && t.rejBoth === 0) { cls.modOnly++; clsEx.modOnly ??= { inp, r }; }
  else if (t.rejBoth > 0) { cls.both++; clsEx.both ??= { inp, r }; }
  else if (t.rejDegenerate > 0) { cls.degenerate++; clsEx.degenerate ??= { inp, r }; }
  else { cls.noIter++; }
}
console.log(`  网格 ${GRID.length} 点 · 收敛 ${cls.converged} · limit ${limitN}\n`);
console.log(`  根因分类（按 50 轮里**被拒的原因组合**）：`);
console.log(`    a) 仅体积不过（模数在每轮都过）           ${String(cls.volOnly).padStart(6)}   ${(cls.volOnly / limitN * 100).toFixed(1)}%`);
console.log(`    b) 仅模数不过                             ${String(cls.modOnly).padStart(6)}   ${(cls.modOnly / limitN * 100).toFixed(1)}%`);
console.log(`    c) 两项都不过                             ${String(cls.both).padStart(6)}   ${(cls.both / limitN * 100).toFixed(1)}%`);
console.log(`    d) D/H 退化（≤0）                          ${String(cls.degenerate).padStart(6)}   ${(cls.degenerate / limitN * 100).toFixed(1)}%`);
console.log(`    e) 其他                                   ${String(cls.noIter).padStart(6)}`);
for (const k of ['volOnly', 'modOnly', 'both', 'degenerate']) if (clsEx[k])
  console.log(`    ${k} 例：mc=${clsEx[k].inp.mc} ${clsEx[k].inp.shape} hd=${clsEx[k].inp.hd_ratio} cw=${clsEx[k].inp.cast_wt} → D=${clsEx[k].r.D} f=${clsEx[k].r.f.toFixed(2)} modOk=${clsEx[k].r.modOk} volOk=${clsEx[k].r.volOk}`);

/* 体积缺口：还差多少 */
console.log('\n  体积不过一类的**缺口倍数** effV/needVol（越接近 1 说明只差一点）：');
const gaps = [];
for (const inp of GRID) {
  const r = run(inp, 50);
  if (!r.converged && r.needVol > 0 && r.trace.rejVolOnly === r.trace.nIterRejected) gaps.push(r.effV / r.needVol);
}
if (gaps.length) {
  gaps.sort((a, b) => a - b);
  const q = (p) => gaps[Math.floor((gaps.length - 1) * p)].toFixed(3);
  console.log(`    样本 ${gaps.length}：min ${q(0)} · p25 ${q(.25)} · 中位 ${q(.5)} · p75 ${q(.75)} · max ${q(1)}`);
  console.log(`    → 中位仅 ${q(.5)} ⇒ 多数 limit 点**不是差一点**，而是数量级不足 ⇒ 抬高 f 上限要抬很多。`);
}

/* ══ ② 不同搜索上限的实验对照 ══ */
hr('【②】不同 f 上限的实验对照（只改本脚本镜像的 N，生产代码未动）');
const CAPS = [50, 100, 200, 400, 800, 2000];
console.log('  N     f_max   cw=0.5 收敛   cw=20 收敛   cw=77.56 收敛   cw=200 收敛   D(cw=77.56,Mc=5)  最大 D');
const rows = [];
for (const N of CAPS) {
  const r = {};
  let maxD = 0, maxDAt = null, dAtMc5 = null;
  for (const cw of [0.5, 20, 77.56, 200]) {
    let conv = 0, tot = 0;
    for (let i = 0; ; i++) {
      const mc = +(0.5 + i * 0.25).toFixed(6); if (mc > 12 + 1e-9) break;
      const inp = { mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 };
      const x = run(inp, N); tot++; if (x.converged) conv++;
      if (x.D > maxD) { maxD = x.D; maxDAt = { cw, mc, N }; }
      if (cw === 77.56 && Math.abs(mc - 5) < 1e-9) dAtMc5 = x.D;
    }
    r[cw] = `${conv}/${tot}`;
  }
  console.log(`  ${String(N).padEnd(5)} ${F_MAX(N).toFixed(2).padEnd(7)} ${r[0.5].padEnd(13)} ${r[20].padEnd(13)} ${r[77.56].padEnd(16)} ${r[200].padEnd(13)} ${String(dAtMc5).padEnd(18)} ${maxD}`);
  rows.push({ N, ...r, maxD, maxDAt, dAtMc5 });
}
console.log(`  最大 D 出现在 ${JSON.stringify(rows[rows.length - 1].maxDAt)}`);

/* ══ ③ 抬高上限后的尺寸与体积 ══ */
hr('【③】抬高上限"能收敛"，但收敛到的尺寸是否合理？');
console.log('  cyl hd=1.0 cw=77.56（真实夹具重量）：生产 N=50 vs N=800');
console.log('  Mc    N=50: D/H bind volOk     |  N=800: D/H f      volOk   Mr_act   f_used=Mr_act/Mc');
for (const mc of [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
  const inp = { mat: '球铁', cast_wt: 77.56, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 };
  const a = run(inp, 50), b = run(inp, 800);
  console.log(`  ${String(mc).padEnd(5)} ${(a.D + '/' + a.H).padEnd(9)} ${a.bind.padEnd(6)} ${String(a.volOk).padEnd(8)} | ${(b.D + '/' + b.H).padEnd(9)} ${b.f.toFixed(2).padEnd(6)} ${String(b.volOk).padEnd(7)} ${b.Mr_act.toFixed(1).padEnd(8)} ${(b.Mr_act / mc).toFixed(1)}×`);
}
console.log('  ↑ 收敛解靠"把冒口撑到体积足够"：D 饱和在**体积所需 144mm**（与 Mc 无关），');
console.log('    代价是 f_used = Mr_act/Mc 高达 24×（Mc=1）—— 冒口按模数看远超热节需求。');

/* ══ ④ f 上限的理论关系 ══ */
hr('【④】解析：满足体积约束所需的 f 与 Mc 成反比（故抬高上限对小 Mc 几乎无效）');
const sd = RISER_SHAPES.cyl;
const Vc = 77.56 * 1e6 / 7.1, needVol = Vc * 0.03, eff = RISER_EFF.eff_open / 100;
const Dreq = Math.cbrt(needVol / eff / (Math.PI / 4));   // hd=1 ⇒ Vr = πD²/4·H = πD³/4
console.log(`  夹具：cw=77.56kg 球铁 cyl hd=1 ⇒ Vc=${Vc.toFixed(0)} mm³ · 需补缩 ${needVol.toFixed(0)} mm³ · 效率 ${(eff * 100).toFixed(0)}%`);
console.log(`  ⇒ 体积所需 D_req = ${Dreq.toFixed(2)} mm（与 Mc 无关）`);
console.log(`  ⇒ 若冒口完全由模数决定 D ≈ 6·Mc·f，则 f_req = D_req/(6·Mc)：`);
for (const mc of [0.5, 1, 2, 3, 5, 8, 12, 20, 30]) {
  const freq = Dreq / (6 * mc);
  const Nreq = freq <= 1.10 ? 1 : Math.ceil((freq - 1.10) / 0.05) + 1;
  console.log(`     Mc=${String(mc).padEnd(4)} f_req=${freq.toFixed(2).padEnd(7)} ⇒ 需要 N ≥ ${String(Nreq).padEnd(5)} ${Nreq <= 50 ? '（现行 50 足够）' : '★ 现行 50 不够'}`);
}
console.log('  ↑ f_req ∝ 1/Mc ⇒ 抬高上限对小 Mc **永远不够**（Mc→0 时发散）。');
console.log('    这不是"上限设小了"，而是"体积约束根本没有解"在搜索空间里换了个说法。');

/* ══ ⑤ limit 结果的字段状态 ══ */
hr('【⑤】limit 返回对象的字段状态（供下游判断）');
const stat = { modOkT_volOkF: 0, modOkF_volOkF: 0, modOkT_volOkT: 0, modOkF_volOkT: 0 };
for (const inp of GRID) {
  const r = run(inp, 50); if (r.converged) continue;
  const k = `modOk${r.modOk ? 'T' : 'F'}_volOk${r.volOk ? 'T' : 'F'}`;
  stat[k] = (stat[k] || 0) + 1;
}
console.log(`  ${JSON.stringify(stat)}`);
console.log('  ↑ limit 点上 **modOk 往往为 true**（模数在每一轮都过）⇒ "实际冒口模数 Mr_act ≥ 所需" 在结果卡上是**绿勾**，');
console.log('    而体积校核是红叉。只看模数一行的用户会以为没问题。');

/* ══ ⑥ 真实重量下的 limit 占比（V2.0-12 的 48.5% 复核） ══ */
hr('【⑥】真实夹具重量下 limit 占比复核');
for (const cw of [0, 0.5, 2, 20, 77.56, 200]) {
  let lim = 0, tot = 0;
  for (let i = 0; ; i++) {
    const mc = +(0.1 + i * 0.01).toFixed(10); if (mc > 12 + 1e-9) break;
    const r = run({ mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 }, 50);
    tot++; if (!r.converged) lim++;
  }
  console.log(`  cw=${String(cw).padEnd(7)} kg：limit ${String(lim).padStart(5)}/${tot}  = ${(lim / tot * 100).toFixed(1)}%`);
}
console.log('  （cyl/hd=1/Mc 0.1~12 步长 0.01 ⇒ 1191 点）');
