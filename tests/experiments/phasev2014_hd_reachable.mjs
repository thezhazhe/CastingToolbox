// ============================================================
// PHASE V2.0-14 · UI 可达的 hd 集合下，C′ 的效果与残留问题（只读）
//
//   可达性依据（源码）：
//     js/views/riserView.js:92-97  `#r_hd` select = {0.8, 1.0, 1.2, 1.5}
//     js/views/wizard.js:346-350   `#wz_hd` select = {0.8, 1.0, 1.2, 1.5}
//     calcs/calcManifest.js:186    hd_ratio 声明为 scope:'calculator'
//     calcs/calcManifest.js:660    原文：「param=null 的 optional（scope:'calculator'）
//                                   是独立计算器私有 UI 参数——独立视图是唯一入口」
//     js/views/... runOne()         设计中心硬编码 hd_ratio: 1.0（calcManifest.js:280）
//   ⇒ **hd=0.5 当前无任何 UI 入口**；本脚本只扫 UI 可达集合，另附 hd=0.5 作为鲁棒性边界。
// ============================================================
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';

const hr = (t) => console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78));

function mirror(input, { bump = true } = {}) {
  const md = RISER_MATERIALS[input.mat] || RISER_MATERIALS.球铁;
  const rhoUsed = input.rho ?? md.rho;
  const sd = RISER_SHAPES[input.shape];
  const hd = parseFloat(input.hd_ratio) || 1.0;
  const eff = (parseFloat(input.eff) || RISER_EFF[sd.effKey]) / 100;
  const cw = parseFloat(input.cast_wt) || 0;
  const Mc = parseFloat(input.mc) || 0;
  if (Mc <= 0 || !sd) return null;
  const tr = { bumps: 0, bumpFail: 0, failEx: null };
  const sizeAt = (Mr, hdR) => {
    const raw = sd.DfromM(Mr, hdR);
    let d = Math.round(raw), h = Math.round(raw * hdR);
    if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
    if (input.shape === 'sphere') h = d;
    const okAt = (dd, hh) => (dd > 0 && hh > 0) && sd.M(dd, hh) >= Mr * 0.99;
    if (bump && !okAt(d, h)) {
      tr.bumps++; const M0 = (d > 0 && h > 0) ? sd.M(d, h) : 0;
      d += 1; h = Math.round(d * hdR);
      if (input.shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
      if (input.shape === 'sphere') h = d;
      if (!okAt(d, h)) { tr.bumpFail++; if (!tr.failEx) tr.failEx = { Mr, d, h, M0, M1: sd.M(d, h) }; }
    }
    return { D: d, H: h };
  };
  let f = 1.10, D = 0, H = 0, Mr_act = 0, Vr = 0, effV = 0, Mr_need = 0, final_f = 1.10;
  let prevModOk = null, prevVolOk = null, converged = false;
  for (let iter = 0; iter < 50; iter++) {
    Mr_need = Mc * f; ({ D, H } = sizeAt(Mr_need, hd));
    Mr_act = (D > 0 && H > 0) ? sd.M(D, H) : 0;
    Vr = sd.V(D, H); effV = Vr * eff; final_f = f;
    const modOk = Mr_act >= Mr_need * 0.99;
    let volOk = true; if (cw > 0) volOk = effV >= (cw * 1000000 / rhoUsed) * md.shrink;
    if (modOk && volOk) { converged = true; break; }
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
  return { D, H, f: final_f, Mr_act, Mr_need, bind, converged, trace: tr };
}

/* 生产一致性自检（含 bind 四分支 + 收敛性反推） */
{
  let bad = 0, n = 0, ex = null;
  for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
    for (const cw of [0, 0.5, 77.56]) for (const hd of [0.5, 0.8, 1, 1.2, 1.5])
      for (let i = 0; i <= 300; i++) {
        const mc = +(0.5 + i * 0.05).toFixed(6);
        const inp = { mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd };
        const p = runRiser(inp), m = mirror(inp); n++;
        if (!p || p.D !== m.D || p.H !== m.H || Math.abs(p.final_f - m.f) > 1e-9 || p.bind !== m.bind) {
          bad++; if (!ex) ex = { inp, pD: p?.D, mD: m.D, pB: p?.bind, mB: m.bind };
        }
      }
  console.log(`镜像(4 分支 bind) vs 生产：${n} 点，不一致 ${bad}${ex ? '  首例 ' + JSON.stringify(ex) : ''}`);
}

hr('【①】UI 可达 hd（0.8 / 1.0 / 1.2 / 1.5）× 4 形状 × cw{0, 0.5, 20, 77.56}：C′ vs 修复前');
console.log('  形状          hd  cw     修复前非单调  C′非单调  D有变的点数  升档仍不足  C′后 bind 分布');
const summary = [];
for (const shape of ['cyl', 'sphere_head', 'sphere', 'square'])
  for (const hd of [0.8, 1.0, 1.2, 1.5])
    for (const cw of [0, 0.5, 20, 77.56]) {
      let nmPre = 0, nmNow = 0, changed = 0, bf = 0, prevPre = null, prevNow = null;
      const bc = {};
      for (let i = 0; ; i++) {
        const mc = +(0.5 + i * 0.01).toFixed(10); if (mc > 12 + 1e-9) break;
        const inp = { mat: '球铁', cast_wt: cw, mc_mode: 'direct', mc, shape, hd_ratio: hd };
        const pre = mirror(inp, { bump: false }), now = mirror(inp, { bump: true });
        if (pre.D !== now.D) changed++;
        if (prevPre !== null && pre.D < prevPre) nmPre++;
        if (prevNow !== null && now.D < prevNow) nmNow++;
        prevPre = pre.D; prevNow = now.D;
        bf += now.trace.bumpFail;
        bc[now.bind] = (bc[now.bind] || 0) + 1;
      }
      const flag = (nmNow > 0 || bf > 0) ? '★' : ' ';
      console.log(`  ${flag} ${shape.padEnd(12)} ${String(hd).padEnd(4)} ${String(cw).padEnd(6)} ${String(nmPre).padStart(11)}  ${String(nmNow).padStart(8)}  ${String(changed).padStart(10)}  ${String(bf).padStart(9)}  ${JSON.stringify(bc)}`);
      summary.push({ shape, hd, cw, nmPre, nmNow, changed, bf });
    }
const S = (k) => summary.reduce((a, x) => a + x[k], 0);
console.log(`\n  合计：修复前非单调 ${S('nmPre')} → C′ ${S('nmNow')}    D 有变 ${S('changed')}    升档仍不足 ${S('bf')}`);
const worst = summary.filter(x => x.nmNow > 0).sort((a, b) => b.nmNow - a.nmNow).slice(0, 6);
console.log('  残留非单调最集中的组合：');
for (const w of worst) console.log(`    ${w.shape} hd=${w.hd} cw=${w.cw}：${w.nmNow} 处（修复前 ${w.nmPre} 处）`);

hr('【②】残留非单调是不是 C′ 造成的？逐例对照（取 cw=0 与 cw=20 各一例）');
for (const probe of [{ shape: 'cyl', hd: 0.8, cw: 0 }, { shape: 'cyl', hd: 1.0, cw: 20 }, { shape: 'sphere_head', hd: 0.8, cw: 0 }]) {
  console.log(`\n  ── ${probe.shape} hd=${probe.hd} cw=${probe.cw} ──`);
  let prevNow = null, prevPre = null, shown = 0;
  for (let i = 0; ; i++) {
    const mc = +(0.5 + i * 0.01).toFixed(10); if (mc > 12 + 1e-9) break;
    const inp = { mat: '球铁', cast_wt: probe.cw, mc_mode: 'direct', mc, shape: probe.shape, hd_ratio: probe.hd };
    const now = mirror(inp, { bump: true }), pre = mirror(inp, { bump: false });
    const dropNow = prevNow !== null && now.D < prevNow;
    if (dropNow && shown < 3) {
      shown++;
      console.log(`    mc=${mc}  C′: D ${prevNow}→${now.D} (f=${now.f} bind=${now.bind})   |  修复前同点 D=${pre.D} bind=${pre.bind}  ⇒ ${pre.D === now.D ? '两版同值（**非 C′ 引入**）' : '两版不同'}`);
    }
    prevNow = now.D; prevPre = pre.D;
  }
}

hr('【③】球顶圆柱 + hd=0.5 的升档反效果（鲁棒性边界，当前无 UI 入口）');
const sd = RISER_SHAPES.sphere_head;
console.log('  D     H=round(0.5D)  Hc=H−r    M(D,H)      ');
for (const d of [4, 5, 6, 7, 8, 9, 20, 21, 22, 23]) {
  const h = Math.round(d * 0.5);
  console.log(`  ${String(d).padEnd(5)} ${String(h).padEnd(13)} ${(h - d / 2).toFixed(2).padEnd(9)} ${sd.M(d, h).toFixed(6)}`);
}
console.log('  ↑ 偶数 D ⇒ Hc=0 ⇒ M=D/6（半球捷径）；奇数 D ⇒ Hc=0.5 ⇒ 薄柱体公式（更小）。');
console.log('    故 (4,2)→(5,3) 的"升一档"使 M 由 0.6667 **降到** 0.6373 ⇒ 升档方向反而有害。');
console.log('    影响：sphere_head + hd=0.5 时 82/1151 点的升档不足，且这些点重新出现 bind=modulus。');
