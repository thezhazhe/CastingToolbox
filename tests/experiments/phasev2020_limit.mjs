// ============================================================
// PHASE V2.0-20（131.txt §三）· `bind='limit'` 尺寸缺口 **只读**独立调查
//
//   ⚠ **本脚本不被 `tests/runner.mjs` 统计**（runner 只读 `tests/*_test.mjs`，**非递归**）。
//     它的数字**不得**与主 runner 的通过数相加（131.txt §五）。
//
//   131.txt §三 明确要求：**不要直接沿用 V2.0-19 E3 的汇总结果，要独立复算**。
//   因此本脚本**不复用** `phasev2019_dreq.mjs` 的任何函数 —— 网格、差值、判定全部重写。
//   唯一的共同输入是"同一个参数网格"（那是我按 131.txt §三 的描述从 E3 源码里读出来的，
//   见 L0 的逐字记录），这一点在报告 §3 里要如实说明。
//
//   它回答 131.txt §七 的六个问题：
//     L0  独立复算三组均值（79 / 93 / 212，−58.4 / −1.29 / +119.2 mm）
//     L1  runRiser **自报** `volOk` 的分布 ← ★ 回答"多少比例不满足体积约束"的**权威口径**
//     L2  返回对象自洽性：D/H ↔ Mr_act/Vr/effV/modOk/volOk/Mr_need
//     L3  样本重复度与**有效独立样本量**
//     L4  H 取值口径对"缺口"的贡献分解
//     L5  代表性样本详表（最大/最小/中位/典型）
//     L6  limit 中是否存在"两条校核其实都过"的语义矛盾样本
//     L7  返回 D/H 是否等于循环最后一次尝试的尺寸（C′ 还原的后果）
//
//   运行：node tests/experiments/phasev2020_limit.mjs
// ============================================================
import { RISER_SHAPES, RISER_MATERIALS, RISER_EFF, runRiser } from '../../calcs/riser.js';
import { calculateRiserDreq } from '../../calcs/riserDreq.js';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ❌ ' + m); } };
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const n2 = (x) => Number(x).toFixed(2);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ════════════════════════════════════════════════════════════════════════════
// L0  独立复刻网格并复算三组统计
// ════════════════════════════════════════════════════════════════════════════
//   ★ 网格来源（逐字抄自 `phasev2019_dreq.mjs:94-97`，**这是 E3 的样本定义**）：
//       for shape of ['cyl','square','sphere','sphere_head']
//         for hd  of [0.5, 0.8, 1.0, 1.5]
//           for cw  of [0.5, 2, 10, 50, 200, 900]
//             for mc  of [0.5, 2, 5, 20]
//               runRiser({mat:'球铁', mc_mode:'direct', mc, shape, hd_ratio:hd, cast_wt:cw, eff:undefined})
//               calculateRiserDreq({shape, hd_ratio:hd, cast_wt:cw, mat:'球铁'})
//     ⇒ 4 × 4 × 6 × 4 = **384** 组。`diff = dr.value − rr.D`（**D_req 减 runRiser**）。
console.log('L0  独立复算：384 组网格 · diff = D_req − D_runRiser');
const SHAPES = ['cyl', 'square', 'sphere', 'sphere_head'];
const HDS = [0.5, 0.8, 1.0, 1.5];
const CWS = [0.5, 2, 10, 50, 200, 900];
const MCS = [0.5, 2, 5, 20];

// 独立复刻"由整数 D 得 H"的 D_req 口径（**不 import riserDreq 的内部函数**，只 import 主函数）
const hOf = (D, shape, hd) => {
  let H = Math.round(D * hd);
  if (shape === 'sphere_head') { const r = D / 2; if (H < r) H = Math.round(r); }
  if (shape === 'sphere') H = D;
  return H;
};
const vOf = (D, shape, hd) => RISER_SHAPES[shape].V(D, hOf(D, shape, hd));

const rows = [];
for (const shape of SHAPES) {
  for (const hd of HDS) {
    for (const cw of CWS) {
      for (const mc of MCS) {
        const rr = runRiser({ mat: '球铁', mc_mode: 'direct', mc, shape, hd_ratio: hd, cast_wt: cw, eff: undefined });
        const dr = calculateRiserDreq({ shape, hd_ratio: hd, cast_wt: cw, mat: '球铁' });
        if (!rr || dr.status !== 'ok') { rows.push({ shape, hd, cw, mc, rr, dr, skip: true }); continue; }
        rows.push({ shape, hd, cw, mc, rr, dr, skip: false, diff: dr.value - rr.D });
      }
    }
  }
}
const live = rows.filter(r => !r.skip);
console.log(`     采样 ${rows.length} 组 · 可用（rr 非 null 且 D_req=ok） ${live.length} 组 · 跳过 ${rows.length - live.length} 组`);

const byBind = new Map();
for (const r of live) {
  const e = byBind.get(r.rr.bind) || { n: 0, diffs: [], gt: 0, le: 0 };
  e.n++; e.diffs.push(r.diff); if (r.diff > 0) e.gt++; else e.le++;
  byBind.set(r.rr.bind, e);
}
for (const b of ['start', 'modulus', 'volume', 'both', 'limit']) {
  const e = byBind.get(b);
  if (!e) { console.log(`     bind=${b.padEnd(8)} —— **本网格中不出现**`); continue; }
  console.log(`     bind=${b.padEnd(8)} n=${String(e.n).padStart(4)} · 平均差 ${(mean(e.diffs) >= 0 ? '+' : '') + n2(mean(e.diffs))}mm`
    + ` · D_req > D_run 的 ${String(e.gt).padStart(3)}（${pct(e.gt, e.n).padStart(6)}）`
    + ` · min ${n2(Math.min(...e.diffs))} / 中位 ${n2(median(e.diffs))} / max ${n2(Math.max(...e.diffs))}`);
}
const lim = byBind.get('limit');
ok(live.length === 384, `可用样本应为 384，实际 ${live.length}`);
ok(!!lim && lim.n === 212, `limit 组应为 212，实际 ${lim ? lim.n : '—'}`);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL1  ★ runRiser **自报** volOk —— 回答"返回尺寸是否满足体积约束"的权威口径');
// ════════════════════════════════════════════════════════════════════════════
//   131.txt §三.A2 问的是"现有返回尺寸是否满足**当前体积约束**"。
//   最直接、最不依赖任何口径假设的判据就是 `runRiser` **自己**返回的 `volOk`
//   （它由 `riser.js:279` 用**它自己的** D/H/Vr/effV 算出）。
//   下面同时给出 D_req 口径（H=round(D·hd)）的判定，两者**分别统计、不混为一谈**。
{
  for (const b of ['start', 'modulus', 'volume', 'both', 'limit']) {
    const e = byBind.get(b); if (!e) continue;
    const sub = live.filter(r => r.rr.bind === b);
    const volOkT = sub.filter(r => r.rr.volOk === true).length;
    const modOkT = sub.filter(r => r.rr.modOk === true).length;
    const bothT = sub.filter(r => r.rr.volOk === true && r.rr.modOk === true).length;
    // D_req 口径：用 runRiser 返回的 D、但按 H=round(D·hd) 重算体积
    const dreqOk = sub.filter(r => vOf(r.rr.D, r.shape, r.hd) * r.rr.eff >= r.rr.needVol).length;
    console.log(`     bind=${b.padEnd(8)} n=${String(e.n).padStart(4)}`
      + ` · 自报 volOk=true ${String(volOkT).padStart(3)}（${pct(volOkT, e.n).padStart(6)}）`
      + ` · 自报 modOk=true ${String(modOkT).padStart(3)}`
      + ` · 两条都 true ${String(bothT).padStart(3)}`
      + ` · D_req口径满足 ${String(dreqOk).padStart(3)}`);
  }
  const sub = live.filter(r => r.rr.bind === 'limit');
  const volOkF = sub.filter(r => r.rr.volOk !== true).length;
  console.log(`     ★ limit 组：自报 volOk=**false** 的 ${volOkF} / ${sub.length} = ${pct(volOkF, sub.length)}`);
  console.log(`       ⇒ "212 组里有多少比例不满足体积约束" 的答案是 **${volOkF} 组（${pct(volOkF, sub.length)}）**，判据 = runRiser 自报 volOk。`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL2  返回对象自洽性（D/H ↔ Mr_act/Vr/effV/modOk/volOk/Mr_need）');
// ════════════════════════════════════════════════════════════════════════════
//   131.txt §三.A3：「返回值中的 Vr、effV、Mr_act 是否与最终 D、H 一致」。
//   不看代码注释，**逐个数值重算比对**。注意浮点用同一表达式、同一结合次序 ⇒ 应**逐位相等**。
{
  let n = 0, badMr = 0, badVr = 0, badEff = 0, badMod = 0, badVol = 0, badNeed = 0, badMrNeed = 0;
  for (const r of live) {
    const { rr, shape, hd } = r;
    const sd = RISER_SHAPES[shape];
    n++;
    if (!Object.is(rr.Mr_act, sd.M(rr.D, rr.H))) badMr++;
    if (!Object.is(rr.Vr, sd.V(rr.D, rr.H))) badVr++;
    if (!Object.is(rr.effV, rr.Vr * rr.eff)) badEff++;
    if (rr.modOk !== (rr.Mr_act >= rr.Mr_need * 0.99)) badMod++;
    const volExp = rr.cw > 0 ? rr.effV >= rr.needVol : true;
    if (rr.volOk !== volExp) badVol++;
    const needExp = (rr.cw > 0 ? rr.cw * 1000000 / rr.rhoUsed : 0) * rr.md.shrink;
    if (!Object.is(rr.needVol, needExp)) badNeed++;
    const mrNeedExp = rr.Mc * rr.final_f;
    if (rr.Mr_need !== mrNeedExp) badMrNeed++;
  }
  console.log(`     ${n} 组逐位重算：Mr_act≠M(D,H) ${badMr} · Vr≠V(D,H) ${badVr} · effV≠Vr×eff ${badEff}`
    + ` · modOk 不自洽 ${badMod} · volOk 不自洽 ${badVol} · needVol 不自洽 ${badNeed} · Mr_need≠Mc×final_f ${badMrNeed}`);
  ok(badMr + badVr + badEff + badMod + badVol + badNeed + badMrNeed === 0, 'L2 返回对象存在自洽性不一致');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL3  样本重复度与**有效独立样本量**');
// ════════════════════════════════════════════════════════════════════════════
//   131.txt §三.A1：「是否存在高度重复的样本」。
//   体积约束式里**没有 Mc** ⇒ `D_req` 只由 (shape, hd, cw, mat) 决定。
//   网格里 mc 有 4 档 ⇒ **同一个 D_req 被统计了 4 次**。
{
  const keyOf = (r) => `${r.shape}|${r.hd}|${r.cw}`;
  for (const b of ['start', 'volume', 'limit']) {
    const e = byBind.get(b); if (!e) continue;
    const sub = live.filter(r => r.rr.bind === b);
    const uniq = new Set(sub.map(keyOf));
    const uniqDiff = new Set(sub.map(r => n2(r.diff)));
    console.log(`     bind=${b.padEnd(8)} 行数 ${String(sub.length).padStart(4)} → 去重 (shape,hd,cw) 后 ${String(uniq.size).padStart(3)}`
      + ` · 去重后的 distinct diff 值 ${uniqDiff.size}`);
  }
  const limSub = live.filter(r => r.rr.bind === 'limit');
  const perCw = new Map();
  for (const r of limSub) perCw.set(r.cw, (perCw.get(r.cw) || 0) + 1);
  console.log(`     limit 组按 cw 分布：${[...perCw.entries()].map(([k, v]) => `${k}kg:${v}`).join(' · ')}`);
  const perHd = new Map();
  for (const r of limSub) perHd.set(r.hd, (perHd.get(r.hd) || 0) + 1);
  console.log(`     limit 组按 hd 分布：${[...perHd.entries()].map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  console.log(`     ★ 全部 ${live.length} 组都是**人工参数扫描**（`+`4 形状 × 4 hd × 6 cw × 4 Mc，材料固定球铁）——`
    + `**真实生产样本 0 组**，无 STL、无工艺卡、无浇注结果。`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL4  H 取值口径对"缺口"的贡献分解（limit 组）');
// ════════════════════════════════════════════════════════════════════════════
//   `runRiser` 未收敛时返回的 H 用**连续 raw** 算（`riser.js:230`），
//   `D_req` 用 **round(D·hd)**（`riserDreq.js:55`）。两者可差 1mm。
//   下面把"体积缺口的毫米数"与"换成 D_req 口径后是否仍不足"分开算。
{
  const sub = live.filter(r => r.rr.bind === 'limit');
  let dH0 = 0, dHp = 0, dHm = 0, stillShort = 0, wouldPass = 0;
  const dHs = [];
  for (const r of sub) {
    const Hd = hOf(r.rr.D, r.shape, r.hd);
    const d = Hd - r.rr.H;
    dHs.push(d);
    if (d === 0) dH0++; else if (d > 0) dHp++; else dHm++;
    const volAlt = RISER_SHAPES[r.shape].V(r.rr.D, Hd);
    if (volAlt * r.rr.eff >= r.rr.needVol) wouldPass++; else stillShort++;
  }
  console.log(`     返回 H vs round(D·hd)：相等 ${dH0} · H 更大 ${dHp} · H 更小 ${dHm}（ΔH 集合 {${[...new Set(dHs)].sort((a, b) => a - b).join(',')}}）`);
  console.log(`     换成 D_req 口径重算体积后：**仍不足** ${stillShort}（${pct(stillShort, sub.length)}）· 变为满足 ${wouldPass}（${pct(wouldPass, sub.length)}）`);
  console.log(`     ⇒ 缺口**不是** H 取整口径造成的（换口径后仍有 ${pct(stillShort, sub.length)} 不足）`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL5  代表性样本详表（bind=limit）');
// ════════════════════════════════════════════════════════════════════════════
{
  const sub = live.filter(r => r.rr.bind === 'limit').slice().sort((a, b) => a.diff - b.diff);
  const med = median(sub.map(r => r.diff));
  let medIdx = 0; for (let i = 0; i < sub.length; i++) if (Math.abs(sub[i].diff - med) < Math.abs(sub[medIdx].diff - med)) medIdx = i;
  const picks = [
    ['最小差', sub[0]],
    ['中位附近', sub[medIdx]],
    ['最大差', sub[sub.length - 1]],
  ];
  // 再加一个"自报 volOk=false 且 modOk=true"的典型样本（V2.0-14 说的 89% 那一类）
  const typ = sub.find(r => r.rr.volOk !== true && r.rr.modOk === true);
  if (typ) picks.push(['典型(仅体积不过)', typ]);
  const typ2 = sub.find(r => r.rr.volOk !== true && r.rr.modOk !== true);
  if (typ2) picks.push(['典型(两条都不过)', typ2]);

  for (const [tag, r] of picks) {
    const { rr, dr } = r;
    const gapVol = rr.needVol - rr.effV;                       // mm³，正 = 不足
    const cwEq = rr.effV * rr.rhoUsed / (1e6 * rr.md.shrink);  // 当前尺寸**等价**可补的铸件重量 kg
    console.log(`     ── ${tag} ──────────────────────────────────`);
    console.log(`       输入：shape=${r.shape} hd=${r.hd} cw=${r.cw}kg mc=${r.mc} mat=球铁(ρ=${rr.rhoUsed}, shrink=${rr.md.shrink}) eff=${(rr.eff * 100).toFixed(0)}%`);
    console.log(`       runRiser：D=${rr.D} H=${rr.H} f=${rr.final_f.toFixed(2)} bind=${rr.bind} converged=${rr.converged}`
      + ` modOk=${rr.modOk} volOk=${rr.volOk}`);
    console.log(`                 Vr=${rr.Vr.toFixed(2)}mm³ effV=${rr.effV.toFixed(2)}mm³ Vc=${rr.Vc.toFixed(2)}mm³ needVol=${rr.needVol.toFixed(2)}mm³ Mr_act=${rr.Mr_act.toFixed(4)} Mr_need=${rr.Mr_need.toFixed(4)}`);
    console.log(`       D_req  ：D=${dr.value} H=${dr.height}（按 H=round(D·hd)）Vr=${dr.search.Vr.toFixed(2)}mm³ effV=${dr.search.effV.toFixed(2)}mm³`);
    console.log(`       尺寸缺口 = D_req − D_run = ${r.diff >= 0 ? '+' : ''}${r.diff}mm`);
    console.log(`       体积缺口 = needVol − effV_run = ${gapVol.toFixed(2)}mm³（正=不足）；`
      + `当前 effV_run 等价可补 ${cwEq.toFixed(3)}kg，输入 ${rr.cw}kg`);
    console.log(`       现有 D 是否满足体积约束：**${rr.volOk === true ? '满足' : '不满足'}**（自报 volOk=${rr.volOk}）·`
      + ` D_req 是否满足：**${dr.search.ok ? '满足' : '不满足'}**`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL6  ★ limit 中是否存在"两条校核其实都过"的样本（若有 = 返回语义矛盾）');
// ════════════════════════════════════════════════════════════════════════════
//   未收敛 = 循环里 50 轮没同时满足。但**返回前有一次"还原到原取整口径"**（`riser.js:228-237`），
//   还原后的 D/H **与原口径下的 D/H 不同**（C′ 的升档被撤销、H 由连续 raw 重算）。
//   若还原后的尺寸恰好 modOk && volOk 同时成立 → 返回一个**实际已过两条校核**却标着"未收敛"的结果。
{
  const sub = live.filter(r => r.rr.bind === 'limit');
  const contra = sub.filter(r => r.rr.modOk === true && r.rr.volOk === true);
  console.log(`     limit ${sub.length} 组中，返回时 modOk && volOk **同时成立**的：**${contra.length}** 组（${pct(contra.length, sub.length)}）`);
  for (const r of contra.slice(0, 8)) {
    console.log(`       ⚠ shape=${r.shape} hd=${r.hd} cw=${r.cw} mc=${r.mc} → D=${r.rr.D} H=${r.rr.H} Mr_act=${r.rr.Mr_act.toFixed(4)} ≥ Mr_need×0.99=${(r.rr.Mr_need * 0.99).toFixed(4)}；effV=${r.rr.effV.toFixed(1)} ≥ needVol=${r.rr.needVol.toFixed(1)}`);
  }
  if (contra.length) {
    console.log(`     ⇒ **判据必须写清**：这 ${contra.length} 组的"未收敛"判定发生在**循环内的 sizeAt 尺寸**上，`);
    console.log(`       而返回的是**还原口径**的尺寸 —— 两者不同（见 L7）。这不是数值错误，是**状态与返回值脱节**。`);
  }
  // 反向：返回尺寸 modOk 也不过的
  const both = sub.filter(r => r.rr.modOk !== true && r.rr.volOk !== true).length;
  const modOnly = sub.filter(r => r.rr.modOk === true && r.rr.volOk !== true).length;
  const volOnly = sub.filter(r => r.rr.modOk !== true && r.rr.volOk === true).length;
  console.log(`     组合分布：modOk✓volOk✗ ${modOnly} · modOk✗volOk✗ ${both} · modOk✗volOk✓ ${volOnly} · 双双✓ ${contra.length}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL7  返回 D/H 是否等于循环**最后一次尝试**的尺寸（C′ 还原的后果）');
// ════════════════════════════════════════════════════════════════════════════
//   循环内用 `sizeAt`（含 C′ 升档）；`!converged` 时返回前**重算**为原口径（`riser.js:228-237`）。
//   独立复刻两个口径，比对差异与占比。
{
  const sizeAt = (Mr, shape, hdR) => {
    const sd = RISER_SHAPES[shape];
    const raw = sd.DfromM(Mr, hdR);
    let d = Math.round(raw), h = Math.round(raw * hdR);
    if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
    if (shape === 'sphere') h = d;
    const okAt = (dd, hh) => (dd > 0 && hh > 0) && sd.M(dd, hh) >= Mr * 0.99;
    if (!okAt(d, h)) {
      d += 1; h = Math.round(d * hdR);
      if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
      if (shape === 'sphere') h = d;
    }
    return { D: d, H: h };
  };
  const sub = live.filter(r => r.rr.bind === 'limit');
  let sameD = 0, diffD = 0, sameH = 0, diffH = 0;
  const dDs = [];
  for (const r of sub) {
    const last = sizeAt(r.rr.Mc * r.rr.final_f, r.shape, r.hd);
    if (last.D === r.rr.D) sameD++; else { diffD++; dDs.push(last.D - r.rr.D); }
    if (last.H === r.rr.H) sameH++; else diffH++;
  }
  console.log(`     返回 D == 循环最后一次 sizeAt 的 D：${sameD} / ${sub.length}（不同 ${diffD}，ΔD 集合 {${[...new Set(dDs)].sort((a, b) => a - b).join(',')}}）`);
  console.log(`     返回 H == 循环最后一次 sizeAt 的 H：${sameH} / ${sub.length}（不同 ${diffH}）`);
  console.log(`     ⇒ 131.txt §三.A3 问的"是否为最后一次尝试的尺寸"：**D 基本是，H 不一定**；`
    + `还原是 V2.0-13 有意为之（只在**收敛解**上启用 C′，未收敛路径保持原口径）。`);
  ok(sameD === sub.length || diffD > 0, 'L7 两种情形都应如实记录');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL8  对照：`start` 与 `volume` 两组也用自报 volOk 复核');
// ════════════════════════════════════════════════════════════════════════════
{
  for (const b of ['start', 'volume']) {
    const sub = live.filter(r => r.rr.bind === b);
    const bad = sub.filter(r => r.rr.volOk !== true).length;
    const conv = sub.filter(r => r.rr.converged === true).length;
    console.log(`     bind=${b.padEnd(8)} n=${sub.length} · converged=true ${conv} · 自报 volOk=**false** ${bad}`);
  }
  const allConv = live.filter(r => r.rr.converged === true).length;
  console.log(`     全网格 converged=true ${allConv} / ${live.length}；limit 组 converged=true 的应为 0：`
    + `${live.filter(r => r.rr.bind === 'limit' && r.rr.converged === true).length}`);
  // bind 与 converged 的**契约**关系（`riser.js:258`：`!converged ⇒ 'limit'`）
  const contractBad = live.filter(r => (r.rr.bind === 'limit') !== (r.rr.converged === false)).length;
  console.log(`     bind 与 converged 的契约（bind==='limit' ⟺ converged===false）违反 ${contractBad} 次`);
  ok(contractBad === 0, 'L8 bind/converged 契约被违反');
  // 131.txt §三.A3「达到搜索上限时」—— 上限到底是多少：f 起点 1.10、步长 0.05、最多 50 轮
  const fLim = live.filter(r => r.rr.bind === 'limit').map(r => r.rr.final_f);
  const fUniq = [...new Set(fLim)];
  console.log(`     limit 组的 final_f 取值集合 = {${fUniq.join(', ')}} —— **唯一值**，`
    + `即 f 起点 1.10 + 步长 0.05 × 49 轮累积的结果`);
  //   ⚠ 它不是**恰好** 3.55：0.05 累加 49 次的浮点结果是 3.5499999999999954。
  //     显示侧 `final_f.toFixed(2)` 印成 "3.55"（正确）；这里如实记录**精确值**。
  //     无实际影响（循环与还原用的是同一个变量），但"3.55 这个上限"在代码里其实是浮点累加值。
  console.log(`     ⚠ 精确值 ${fUniq[0]} ≠ 3.55（浮点累加误差 4.6e-15）；UI 显示 .toFixed(2) = "3.55"`);
  ok(fUniq.length === 1 && Math.abs(fUniq[0] - 3.55) < 1e-9,
    `limit 的 final_f 应恒为 3.55（±1e-9），实际 ${fUniq.join('/')}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL9  ★★ 47 组 modOk✗ 的来源：是**搜索**不够，还是**返回前的还原**？');
// ════════════════════════════════════════════════════════════════════════════
//   L7 显示：212 组里 **47** 组的返回 D 比循环最后一次 sizeAt 的 D **小 1mm**。
//   L6 显示：modOk✗volOk✗ 恰好也是 **47** 组。这两件事是同一个吗？
//   做法：对每一组，用**循环最后一次 sizeAt 的尺寸**重算 modOk，看它是否全过。
{
  const sizeAt = (Mr, shape, hdR) => {
    const sd = RISER_SHAPES[shape];
    const raw = sd.DfromM(Mr, hdR);
    let d = Math.round(raw), h = Math.round(raw * hdR);
    if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
    if (shape === 'sphere') h = d;
    const okAt = (dd, hh) => (dd > 0 && hh > 0) && sd.M(dd, hh) >= Mr * 0.99;
    if (!okAt(d, h)) {
      d += 1; h = Math.round(d * hdR);
      if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
      if (shape === 'sphere') h = d;
    }
    return { D: d, H: h };
  };
  const sub = live.filter(r => r.rr.bind === 'limit');
  let loopModOk = 0, retModOk = 0, flipped = 0;
  for (const r of sub) {
    const sd = RISER_SHAPES[r.shape];
    const last = sizeAt(r.rr.Mc * r.rr.final_f, r.shape, r.hd);
    const loopOk = sd.M(last.D, last.H) >= r.rr.Mr_need * 0.99;
    const retOk = r.rr.modOk === true;
    if (loopOk) loopModOk++;
    if (retOk) retModOk++;
    if (loopOk && !retOk) flipped++;
  }
  console.log(`     limit ${sub.length} 组 · 循环**最后一次尝试尺寸**上 modOk 通过 ${loopModOk} · 返回尺寸上 modOk 通过 ${retModOk} · 由✓翻✗ ${flipped}`);
  console.log(`     ⇒ ${flipped} 组"模数也不过"**不是搜索没走到**，而是**返回前把 C′ 升档撤销了**（riser.js:228-237，V2.0-13 有意为之）。`);
  ok(flipped === 47, `L9 期望 47 组由✓翻✗，实际 ${flipped}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL10 均值统计是否被 mc 复制放大（去重口径对照）');
// ════════════════════════════════════════════════════════════════════════════
{
  for (const b of ['start', 'volume', 'limit']) {
    const e = byBind.get(b); if (!e) continue;
    const sub = live.filter(r => r.rr.bind === b);
    const byTriple = new Map();
    for (const r of sub) {
      const k = `${r.shape}|${r.hd}|${r.cw}`;
      (byTriple.get(k) || byTriple.set(k, []).get(k)).push(r.diff);
    }
    const tripleMeans = [...byTriple.values()].map(mean);
    console.log(`     bind=${b.padEnd(8)} 行均值 ${(mean(e.diffs) >= 0 ? '+' : '') + n2(mean(e.diffs))}mm`
      + ` → **按 (shape,hd,cw) 去重后**的均值 ${(mean(tripleMeans) >= 0 ? '+' : '') + n2(mean(tripleMeans))}mm`
      + `（独立三元组 ${tripleMeans.length}）`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL11  真实铸件基准表 `data/riser-benchmark/cases.csv` 字段体检（131.txt §四）');
// ════════════════════════════════════════════════════════════════════════════
//   **只读**：不写 CSV、不改列、不录任何案例。只做"字段能不能撑起验证"的核对。
{
  const fs = await import('node:fs');
  const CSV = 'data/riser-benchmark/cases.csv';
  const README = 'data/riser-benchmark/README.md';
  const buf = fs.readFileSync(CSV);
  const txt = buf.toString('utf8').replace(/^﻿/, '');
  const lines = txt.trim().split(/\r?\n/);
  const cols = lines[0].split(',');
  const dataRows = lines.length - 1;
  console.log(`     ${CSV}：${cols.length} 列 · **数据行 ${dataRows}** · BOM ${buf[0] === 0xEF ? '有' : '无'}`);

  // README §2 里用反引号登记的字段名（` = `，避免与模板字符串冲突）
  const q = String.fromCharCode(96);
  const rd = fs.readFileSync(README, 'utf8');
  //   ⚠ 字段名含大小写混合（`Mc_mm` / `actual_D_mm` / `modOk`）⇒ 字符类必须含 `A-Z`
  //     （本探针第一版写成 `[a-z_]+`，把 8 个**已登记**的列报成"未登记" —— 探针自身的 bug，
  //      与 PHASE 98 §11 的教训同类：先验证探针，再相信结论。）
  const doc = new Set([...rd.matchAll(new RegExp(q + '([A-Za-z_][A-Za-z0-9_]*)' + q, 'g'))].map(m => m[1]));
  const unregistered = cols.filter(c => !doc.has(c));
  console.log(`     README 中登记过的字段名 ${doc.size} 个 · CSV 有而 README **未登记**的列：`
    + (unregistered.length ? unregistered.join(', ') : '（无）'));

  // 131.txt §四 要求的八类信息 → 字段映射
  const CATS = [
    ['输入参数', ['input_parameters', 'casting_mass_kg', 'Mc_mm', 'Mc_source', 'material']],
    ['算法预测', ['calculated_D_mm', 'calculated_H_mm', 'calculated_final_f', 'converged', 'modOk', 'volOk', 'bind', 'toolbox_version']],
    ['实际采用尺寸', ['actual_D_mm', 'actual_H_mm', 'actual_hd', 'riser_shape', 'riser_type']],
    ['实际工艺条件', ['process_notes', 'gating_or_feeding_notes']],
    ['铸件检测结果', ['inspection_method', 'inspection_result']],
    ['缺陷情况', ['shrinkage_evidence']],
    ['证据来源', ['source', 'evidence_level', 'date']],
    ['验证状态', ['validation_notes', 'missing_data', 'limitations', 'data_quality', 'comparison_notes']],
  ];
  const have = new Set(cols);
  let gaps = 0;
  for (const [cat, need] of CATS) {
    const miss = need.filter(f => !have.has(f));
    if (miss.length) gaps++;
    console.log(`     ${miss.length ? '✗' : '✓'} ${cat.padEnd(7)} ← ${need.length} 个字段${miss.length ? ' · 缺 ' + miss.join('/') : ''}`);
  }

  // ★ 可复现性核对：`input_parameters` 的键表（README §3）能不能覆盖 runRiser 的**全部**入参
  const readmeKeys = ['mc_mode', 'mc', 'shape', 'mat', 'cast_wt', 'hd_ratio', 'eff'];
  const riserInputs = ['mc_mode', 'mc', 'hot_d', 'wall_t', 'cast_v', 'cast_a', 'shape', 'mat', 'cast_wt', 'hd_ratio', 'eff', 'rho'];
  const notCovered = riserInputs.filter(k => !readmeKeys.includes(k));
  console.log(`     ★ \`input_parameters\` 键表覆盖 runRiser 入参：${readmeKeys.length} / ${riserInputs.length}`
    + ` · **未覆盖** ${notCovered.join(', ')}`);
  console.log(`       ① \`mc_mode\` 有 4 个分支，键表只登记了 \`direct\` 用的 \`mc\` ——`
    + ` \`hot_spot\`(hot_d) / \`wall\`(wall_t) / \`volume\`(cast_v,cast_a) 三个分支的输入键**一个都没有**；`);
  console.log(`       ② \`rho\`（固态密度）未登记，而 \`riser.js:167-169\` 明确支持用户显式覆盖`
    + `（设计中心在项目 solidDensity 为 USER_OVERRIDE 时会传入）。`);
  console.log(`       ⇒ 这 5 条输入路径下的案例，按现有键表**无法复现**计算结果 —— 而"可复现"是本表的立表前提。`);
  console.log(`       **建议（只加键、不改列）**：在 README §3 键表补登 hot_d / wall_t / cast_v / cast_a / rho。`);
  console.log(`     ★ 多热结：\`resultsCenter\` 支持逐热结多块结果（\`r.items\`），而本表是**一行一案例、单组 calculated_\***`
    + ` ⇒ 一个多热结件的多个冒口**无法如实录入**。**建议**：加 \`case_id\` 后缀（\`…-01a/-01b\`）并在 \`missing_data\` 说明，或新增 \`hotspot_id\` 列。`);
  console.log(`     ★ 缩孔**位置**（相对热节/冒口）现只能写进 \`shrinkage_evidence\` 自由文本 ——`
    + ` 而这恰是判断"模型偏乐观还是偏保守"的关键。**建议**：在 §5 规则里要求写明位置，不必加列。`);
  console.log(`     ★ 当前 **数据行 ${dataRows}** ⇒ 131.txt §四 要求的"真实生产样本"数为 **0**；本阶段**不录入**任何案例。`);
  ok(unregistered.length === 0, `README 未登记的列：${unregistered.join(', ')}`);
  ok(gaps === 0, `基准表字段覆盖缺 ${gaps} 类`);
  ok(dataRows === 0, `基准表应仍为 0 条记录（本阶段不录入），实际 ${dataRows}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nL12  ★ 要多大 f 才够？—— 给"不建议抬 f 上限"一个数量级（131.txt §三.A4 末段）');
// ════════════════════════════════════════════════════════════════════════════
//   搜索唯一的旋钮是 `Mr_need = Mc × f`（f ∈ [1.10, 3.55]）。体积约束要的那个尺寸
//   与 Mc **无关**。于是"要靠 f 够到体积解"所需的最小倍率是：
//       f_req = M(D_req, H(D_req)) / Mc
//   这是一个**纯代数换算**，不引入任何新系数。它把"抬上限"这个方向直接量化成倍数。
{
  const sub = live.filter(r => r.rr.bind === 'limit');
  const fr = [], ratios = [];
  for (const r of sub) {
    const sd = RISER_SHAPES[r.shape];
    const mr = sd.M(r.dr.value, r.dr.height);
    fr.push(mr / r.rr.Mc);
    const last = Math.round(sd.DfromM(r.rr.Mc * r.rr.final_f, r.hd));
    ratios.push(r.dr.value / Math.max(last, 1));
  }
  fr.sort((a, b) => a - b);
  const buckets = { '<2': 0, '2~5': 0, '5~20': 0, '20~100': 0, '≥100': 0 };
  for (const v of fr) {
    if (v < 2) buckets['<2']++; else if (v < 5) buckets['2~5']++;
    else if (v < 20) buckets['5~20']++; else if (v < 100) buckets['20~100']++; else buckets['≥100']++;
  }
  console.log(`     limit ${sub.length} 组的 f_req = M(D_req,H_req)/Mc：`
    + `最小 ${fr[0].toFixed(2)} · 中位 ${median(fr).toFixed(2)} · 最大 ${fr[fr.length - 1].toFixed(1)}`);
  console.log(`     分布：${Object.entries(buckets).map(([k, v]) => `f_req ${k}: ${v} 组`).join(' · ')}`);
  console.log(`     其中 f_req ≤ 3.55（**本可收敛**）的：${fr.filter(v => v <= 3.55).length} / ${sub.length}`
    + ` ⇒ 其余 ${fr.filter(v => v > 3.55).length} 组**无论 f 上限抬到多少都只在抬上限**`);
  console.log(`     D_req / 末次尝试 D：中位 ${median(ratios).toFixed(2)}× · 最大 ${Math.max(...ratios).toFixed(2)}×`);
  console.log(`     ⇒ 结论：缺口不是"差一点点"，而是**需求与搜索锚点（Mc）脱钩**。`);
  console.log(`       抬 f 上限对中位数 f_req=${median(fr).toFixed(1)} 的那一半毫无用处 —— 与 V2.0-13~16 的判断一致。`);
}

console.log(`\n实验自检：${fail} 项失败`);
console.log('⚠ 本脚本不在 tests/runner.mjs 的统计范围内（runner 非递归，只读 tests/*_test.mjs）。');
process.exitCode = fail ? 1 : 0;
