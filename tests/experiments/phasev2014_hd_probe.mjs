// ============================================================
// PHASE V2.0-14 · 专项探针（只读）
//   ① 非单调到底是不是 C′ 引入的？—— 同一网格上跑 有升档(C′) / 无升档(修复前) 两套镜像对比
//   ② sphere_head + hd=0.5：**升档一档仍不足** 的机理（C′ 的不完备处）
//   ③ 极小 Mc：修复前 D=0 的退化区被 C′ 改成 D=1 的逐点对照
// ============================================================
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';

const hr = (t) => console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78));

// 镜像：bump=false 即"修复前"（V2.0-13 之前）的取整口径
function mirror(input, { bump = true } = {}) {
  const md = RISER_MATERIALS[input.mat] || RISER_MATERIALS.球铁;
  const rhoUsed = input.rho ?? md.rho;
  const sd = RISER_SHAPES[input.shape];
  const hd = parseFloat(input.hd_ratio) || 1.0;
  const eff = (parseFloat(input.eff) || RISER_EFF[sd.effKey]) / 100;
  const cw = parseFloat(input.cast_wt) || 0;
  const Mc = parseFloat(input.mc) || 0;
  if (Mc <= 0 || !sd) return null;
  const tr = { bumps: 0, bumpFail: [] };
  const sizeAt = (Mr, hdR) => {
    const raw = sd.DfromM(Mr, hdR);
    let d = Math.round(raw), h = Math.round(raw * hdR);
    if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
    if (input.shape === 'sphere') h = d;
    const okAt = (dd, hh) => (dd > 0 && hh > 0) && sd.M(dd, hh) >= Mr * 0.99;
    if (bump && !okAt(d, h)) {
      tr.bumps++;
      d += 1; h = Math.round(d * hdR);
      if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
      if (input.shape === 'sphere') h = d;
      if (!okAt(d, h)) tr.bumpFail.push({ Mr, hdR, dPrev: d - 1, hPrev: Math.round(raw * hdR), d, h, M: sd.M(d, h), need: Mr * 0.99, raw });
    }
    return { D: d, H: h };
  };
  let f = 1.10, D = 0, H = 0, Mr_act = 0, Vr = 0, effV = 0, Mr_need = 0, final_f = 1.10;
  let prevModOk = null, prevVolOk = null, converged = false;
  for (let iter = 0; iter < 50; iter++) {
    Mr_need = Mc * f;
    ({ D, H } = sizeAt(Mr_need, hd));
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H); effV = Vr * eff; final_f = f;
    const modOk = Mr_act >= Mr_need * 0.99;
    let volOk = true;
    if (cw > 0) volOk = effV >= (cw * 1000000 / rhoUsed) * md.shrink;
    if (modOk && volOk) { converged = true; break; }
    prevModOk = modOk; prevVolOk = volOk;
    f += 0.05;
  }
  if (!converged) {
    const raw = sd.DfromM(Mr_need, hd);
    H = Math.round(raw * hd); D = Math.round(raw);
    if (input.shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
    if (input.shape === 'sphere') H = D;
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H); effV = Vr * eff;
  }
  return { D, H, f: final_f, Mr_act, Mr_need, Vr, effV, converged, trace: tr,
    modOk: Mr_act >= Mr_need * 0.99, bind: !converged ? 'limit' : (prevModOk === null ? 'start' : (!prevModOk ? 'modulus' : 'volume')) };
}

/* 生产一致性自检（有升档镜像 vs runRiser） */
{
  let bad = 0, n = 0;
  const SH = ['cyl', 'sphere_head', 'sphere', 'square'];
  for (const shape of SH) for (const cw of [0, 0.5, 77.56]) for (const hd of [0.5, 1, 2])
    for (let i = 0; i <= 200; i++) {
      const mc = +(0.5 + i * 0.05).toFixed(6);
      const inp = { mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd };
      const p = runRiser(inp), m = mirror(inp, { bump: true }); n++;
      if (!p || p.D !== m.D || p.H !== m.H || Math.abs(p.final_f - m.f) > 1e-9 || p.bind !== m.bind) { bad++; if (bad < 4) console.log('  ❌', JSON.stringify(inp), p?.D, m.D); }
    }
  console.log(`镜像(有升档) vs 生产：${n} 点，不一致 ${bad}`);
}

/* ══ ① 非单调是 C′ 引入的，还是既有的？ ══ */
hr('【①】非单调：C′（有升档） vs 修复前（无升档），同一网格');
const SHAPES = ['cyl', 'sphere_head', 'sphere', 'square'];
console.log('  形状          hd   cw    修复前非单调  C′非单调   两版 D 是否相同的点数');
const rows = [];
for (const shape of SHAPES) for (const hd of [0.5, 1.0, 2.0]) for (const cw of [0, 0.5, 20, 77.56]) {
  let nmPre = 0, nmNow = 0, same = 0, tot = 0, prevPre = null, prevNow = null, maxDrop = 0, dropEx = null;
  for (let i = 0; ; i++) {
    const mc = +(0.5 + i * 0.01).toFixed(10);
    if (mc > 12 + 1e-9) break;
    const inp = { mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd };
    const pre = mirror(inp, { bump: false }), now = mirror(inp, { bump: true });
    tot++;
    if (pre.D === now.D) same++;
    if (prevPre !== null && pre.D < prevPre) nmPre++;
    if (prevNow !== null) { if (now.D < prevNow) { nmNow++; if (prevNow - now.D > maxDrop) { maxDrop = prevNow - now.D; dropEx = { mc, from: prevNow, to: now.D, f: now.f, bind: now.bind }; } } }
    prevPre = pre.D; prevNow = now.D;
  }
  const mark = (nmPre || nmNow) ? '★' : ' ';
  console.log(`  ${mark} ${shape.padEnd(12)} ${String(hd).padEnd(4)} ${String(cw).padEnd(6)} ${String(nmPre).padStart(10)}  ${String(nmNow).padStart(9)}   ${same}/${tot}${dropEx ? '   最大回退 ' + maxDrop + 'mm @mc=' + dropEx.mc + ' ' + dropEx.from + '→' + dropEx.to : ''}`);
  rows.push({ shape, hd, cw, nmPre, nmNow, same, tot });
}
const t = (k) => rows.reduce((a, r) => a + r[k], 0);
console.log(`\n  合计：修复前非单调 ${t('nmPre')} · C′ 非单调 ${t('nmNow')} · D 相同 ${t('same')}/${t('tot')}`);

/* ══ ② sphere_head hd=0.5 升档仍不足：机理 ══ */
hr('【②】sphere_head + hd=0.5 的"升档一档仍不足"（C′ 的不完备处）');
const fails = [];
for (let i = 0; ; i++) {
  const mc = +(0.5 + i * 0.01).toFixed(10); if (mc > 12 + 1e-9) break;
  const inp = { mat: '球铁', cast_wt: 0, mc_mode: 'direct', mc, shape: 'sphere_head', hd_ratio: 0.5 };
  const m = mirror(inp, { bump: true });
  if (m.trace.bumpFail.length) fails.push({ mc, ...m.trace.bumpFail[0], D: m.D, H: m.H, bind: m.bind });
}
console.log(`  升档仍不足的采样点数：${fails.length} / 1151`);
console.log('  前 5 例（每次都是"把 d 加 1、h=round((d+1)·0.5)" 之后 M 仍然 < 0.99·Mr_need）：');
for (const x of fails.slice(0, 5))
  console.log(`    mc=${x.mc}  Mr=${x.Mr.toFixed(4)}  raw=${x.raw.toFixed(3)}  (d,h) ${x.dPrev},${x.hPrev} → ${x.d},${x.h}   M=${x.M.toFixed(4)} < need=${x.need.toFixed(4)}   判据差 ${(x.need - x.M).toFixed(4)}`);
const shapes = new Set(fails.map(x => `${x.d},${x.h}`));
console.log(`  出现过的 (d,h) 组合：${[...shapes].slice(0, 12).join(' | ')}${shapes.size > 12 ? ' …' : ''}`);
console.log(`  这些点最终 bind = ${JSON.stringify(fails.reduce((a, x) => (a[x.bind] = (a[x.bind] || 0) + 1, a), {}))}`);
// 抽出 M(D,H) 在该带内的解析形态
console.log('\n  M(D,H) 在 H = (D+1)/2 附近的取值（球顶圆柱：Hc = H − r 很薄）：');
for (const d of [7, 9, 11, 21, 23, 31]) {
  const sd = RISER_SHAPES.sphere_head;
  const h = Math.round(d * 0.5);
  console.log(`    D=${d}  H=round(D*0.5)=${h}  Hc=H−r=${(h - d / 2).toFixed(2)}  M=${sd.M(d, h).toFixed(6)}  D/6=${(d / 6).toFixed(6)}`);
}
console.log('  ↑ hd=0.5 时 H≈r，Hc→0，M(D,H) 在 D/6 与柱体公式之间跳；round(D/2) 的奇偶性决定落在哪一侧。');

/* ══ ③ 极小 Mc：修复前 vs C′ ══ */
hr('【③】极小 Mc 退化区：修复前（无升档） vs C′（有升档）');
console.log('  Mc       修复前 D/H  bind   modOk         C′ D/H  bind   modOk');
for (const mc of [0.01, 0.02, 0.05, 0.08, 0.0833, 0.084, 0.1, 0.15, 0.18, 0.2, 0.25, 0.5]) {
  const inp = { mat: '球铁', cast_wt: 0, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 };
  const pre = mirror(inp, { bump: false }), now = mirror(inp, { bump: true });
  console.log(`  ${String(mc).padEnd(8)} ${(pre.D + '/' + pre.H).padEnd(9)} ${pre.bind.padEnd(6)} ${String(pre.modOk).padEnd(12)} ${(now.D + '/' + now.H).padEnd(6)} ${now.bind.padEnd(6)} ${now.modOk}`);
}
console.log('  ↑ Mc ≤ 0.0833 时 raw = 6.6·Mc < 0.55 ⇒ 修复前 round 到 0（除零守卫 → Mr_act=0 ⇒ 永不收敛 ⇒ limit）；');
console.log('     C′ 升档到 D=1 后 modOk 成立 ⇒ 收敛。CSV 基线从 Mc=1 起，**该区未被修复前基线覆盖**。');
