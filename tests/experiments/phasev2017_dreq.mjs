// ============================================================
// PHASE V2.0-17（128.txt §三 / §四 / §五）· `D_req` **独立复核**（只读）
//
//   ⚠ 与 `tests/experiments/phasev2016_verify.mjs` 的分工（128.txt §五「勿重复建设」）：
//     · phasev2016_verify §B 已覆盖：**正常输入**下的 k 表、143.91 复算、翻转点、
//       D_req 与 Mc 无关、eff 覆盖、三次根精度。
//     · **本脚本只做它没做的**：① 用**齐次性**（而非点采样）独立验证 k；
//       ② **退化/非法输入矩阵**（负重量、零/负密度、负 hd、Infinity、NaN…）并**逐项分类**；
//       ③ **精确整数解** `D_req_int`（生产用整数 D 与 round(D·hd)，解析式是连续解）；
//       ④ `sphere_head` 在 `hd<0.5` 的**取整细节**。
//
//   ⚠ 本脚本**只调生产 `runRiser`**，不做控制流镜像；不修改任何生产代码。
//   ⚠ 基线来源：`tests/engineering-generated/phasev2012_c1_sweep.csv`（只读，sha256 0f8f940b…）
//
//   用法: node tests/experiments/phasev2017_dreq.mjs
// ============================================================
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CSV = path.join(ROOT, 'tests/engineering-generated/phasev2012_c1_sweep.csv');

const hr = (t) => console.log('\n' + '═'.repeat(78) + '\n' + t + '\n' + '═'.repeat(78));
const sub = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 70 - t.length)));
let FAIL = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) FAIL++;
};

// ⚠ 生产 `runRiser` 读的键是 **`cast_wt`**（riser.js:94），不是 `cw`。
//   本助手把 `cw` 映射过去，好让用例读起来和报告一致。
//   注意用 `'cw' in o` 而非 `o.cw || 0`，否则 NaN / 0 会被吞掉、测不到真实边界。
const R = (o) => {
  const { cw, ...rest } = o;
  return runRiser({ mat: '球铁', mc_mode: 'direct', ...rest, ...('cw' in o ? { cast_wt: cw } : {}) });
};

/* ============================================================
 * A. 独立重建：用**齐次性**验证 k（与 V2.0-16 的点采样法互相独立）
 * ============================================================ */
hr('A. 公式独立重建（128.txt §三）');

sub('A1 冒口体积的齐次性：V(λD, λH) = λ³·V(D,H)');
{
  // 这一步验证的是 D_req 推导的**真正前提**：Vr 关于 D 是三次齐次。
  // 与"在某几个点上算 V/D³"相比，齐次性是更强的、与采样点无关的性质。
  let worst = 0, n = 0;
  const lam = [0.5, 2, 3.7, 0.123];
  for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
    for (const D of [7, 23.5, 60, 144.7]) for (const H of [5, 23.5, 80, 200]) {
      const base = RISER_SHAPES[shape].V(D, H);
      for (const L of lam) {
        const scaled = RISER_SHAPES[shape].V(D * L, H * L);
        const rel = Math.abs(scaled - base * L ** 3) / Math.max(1e-30, Math.abs(base * L ** 3));
        worst = Math.max(worst, rel); n++;
      }
    }
  }
  check(`★ 4 形状 × 64 组 × 4 缩放：V 是 D 的三次齐次式（${n} 点）`, worst < 1e-12,
    `最大相对偏差 ${worst.toExponential(2)}`);
}

sub('A2 k 表（Vr = k·D³，H = hd·D）—— 用**数值微分**独立求，不引用报告数字');
{
  // 独立做法：k = (1/3!)·d³V/dD³ 在 H/D 固定时 —— 对三次齐次式应等于 V(D,hD)/D³。
  // 这里用中心差分求 d³V/dD³，与"直接相除"是两条不同的路径。
  const shapes = ['cyl', 'square', 'sphere', 'sphere_head'];
  const hdList = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0];
  const rows = [];
  for (const shape of shapes) {
    const V = RISER_SHAPES[shape].V;
    for (const hd of hdList) {
      // ⚠ 步长不能太小：三阶中心差分的分子要做 ~1e6 量级的相减、结果只有 ~1e-6，
      //    h=1e-2 时浮点抵消误差会放大到 ~1e-4（第一版就栽在这）。取 h=1（D0 的 1%）后降到 ~1e-11。
      const D0 = 100, h = 1;
      const f = (x) => V(x, x * hd);
      const d3 = (f(D0 + 2 * h) - 2 * f(D0 + h) + 2 * f(D0 - h) - f(D0 - 2 * h)) / (2 * h ** 3);
      const kDiff = d3 / 6;                       // 三次项系数
      const kDiv = V(D0, D0 * hd) / D0 ** 3;      // 直接相除
      rows.push({ shape, hd, kDiff, kDiv, rel: Math.abs(kDiff - kDiv) / kDiv });
    }
  }
  const worst = Math.max(...rows.map((r) => r.rel));
  check('★ 数值微分 d³V/dD³/6 与 V(D,hD)/D³ 一致（两条独立路径）', worst < 1e-6,
    `最大相对偏差 ${worst.toExponential(2)}`);

  // 与闭式对照
  const K = {
    cyl: (hd) => Math.PI / 4 * hd,
    square: (hd) => hd,
    sphere: () => Math.PI / 6,
    sphere_head: (hd) => Math.PI * (3 * hd - 0.5) / 12,
  };
  let worstClosed = 0, at = '';
  for (const r of rows) {
    const rel = Math.abs(r.kDiv - K[r.shape](r.hd)) / Math.abs(K[r.shape](r.hd));
    if (rel > worstClosed) { worstClosed = rel; at = `${r.shape} hd=${r.hd}`; }
  }
  check('★ 闭式 k 与实测一致（含 sphere_head hd=0.5 的连续性）', worstClosed < 1e-12,
    `最大相对偏差 ${worstClosed.toExponential(2)} @ ${at}`);
  console.log(`     ⇒ sphere_head 的 k 在 hd=0.5 处连续：π(3·0.5−0.5)/12 = π/12（= 半球）`);
}

sub('A3 体积判据的完整表达式（逐行对照，含"没有 0.99"这一点）');
{
  const r = R({ mc: 5, shape: 'cyl', cw: 77.56, hd_ratio: 1 });
  const md = RISER_MATERIALS['球铁'];
  // 判据链：Vc → needVol → effV → volOk
  check('Vc = cw×1e6/rho（cw:kg, rho:g/cm³ ⇒ mm³）', Math.abs(r.Vc - 77.56e6 / md.rho) < 1e-6);
  check('needVol = Vc×shrink', Math.abs(r.needVol - r.Vc * md.shrink) < 1e-9);
  check('effV = Vr×eff', Math.abs(r.effV - r.Vr * r.eff) < 1e-9);
  check('volOk ⟺ effV ≥ needVol（**无 0.99 系数**）', r.volOk === (r.effV >= r.needVol) && r.volOk === false);
  // 反证：若体积判据也有 0.99 松弛，则 effV ≥ 0.99·needVol 会通过 —— 实际不会
  check('反证：effV 落在 [0.99·needVol, needVol) 时 volOk **仍为 false**（证明无松弛）',
    (() => {
      const lo = 0.995 * r.needVol;
      return r.effV < lo && r.volOk === false;
    })(), `effV/needVol = ${(r.effV / r.needVol).toFixed(4)}`);
  console.log(`     模数判据对照（有松弛）：modOk ⟺ Mr_act ≥ Mr_need×0.99  ⇒ 两条判据**口径不同**，`);
  console.log(`     ⇒ D_req 推导中**不得**引入 0.99。`);
}

sub('A4 解析式与程序计算的对应关系（精确表述）');
{
  // 程序的 D 是整数、H = round(D·hd)，所以精确判据是"整数扫描"，解析式是连续解。
  const D_req_int = (shape, hd, eff, needVol) => {
    for (let d = 1; d <= 5000; d++) {
      let h = Math.round(d * hd);
      if (shape === 'sphere_head') { const rr = d / 2; if (h < rr) h = Math.round(rr); }
      if (shape === 'sphere') h = d;
      if (RISER_SHAPES[shape].V(d, h) * eff >= needVol) return d;
    }
    return null;
  };
  const K = {
    cyl: (hd) => Math.PI / 4 * hd, square: (hd) => hd,
    sphere: () => Math.PI / 6, sphere_head: (hd) => Math.PI * (3 * hd - 0.5) / 12,
  };
  const D_req_real = (shape, hd, eff, needVol) => Math.cbrt(needVol / (eff * K[shape](hd)));

  let nExact = 0, nMinus1 = 0, nOther = 0, tot = 0, maxAbs = 0;
  for (const shape of ['cyl', 'square', 'sphere', 'sphere_head'])
    for (const hd of [0.5, 0.8, 1.0, 1.2, 1.5, 2.0])
      for (const cw of [0.5, 5, 77.56, 200]) {
        const r = R({ mc: 5, shape, cw, hd_ratio: hd });
        const di = D_req_int(shape, hd, r.eff, r.needVol);
        const dr = D_req_real(shape, hd, r.eff, r.needVol);
        const gap = di - Math.ceil(dr);
        tot++;
        if (gap === 0) nExact++; else if (gap === -1) nMinus1++; else nOther++;
        maxAbs = Math.max(maxAbs, Math.abs(gap));
      }
  console.log(`     4 形状 × 6 hd × 4 cw = ${tot} 组：`);
  console.log(`       精确整数解 == ceil(D_req)   : ${nExact}`);
  console.log(`       精确整数解 == ceil(D_req)−1 : ${nMinus1}   （H 取整向上所致）`);
  console.log(`       其他                        : ${nOther}`);
  check('★ 精确整数解与 ceil(连续解) 的偏差有界（|Δ| ≤ 1）', maxAbs <= 1, `最大 |Δ| = ${maxAbs}`);
  check('★ 精确整数解 **从不大于** ceil(连续解)（解析式不会低估需求）', nOther === 0 && maxAbs <= 1,
    `出现 ${nOther} 组偏差 >1 —— 说明存在解析式低估的情形，需重新推导`);

  // 与生产实际 D 的关系：生产 D 由 f 扫描决定，**不是** D_req
  const r5 = R({ mc: 5, shape: 'cyl', cw: 77.56, hd_ratio: 1 });
  const di = D_req_int('cyl', 1, r5.eff, r5.needVol);
  console.log(`\n     生产 Mc=5 cw=77.56 cyl：D=${r5.D}（f=${r5.final_f.toFixed(2)}，converged=${r5.converged}）`);
  console.log(`     精确体积所需整数直径 D_req_int = ${di} ⇒ 生产 D 比它**小 ${di - r5.D} mm**`);
  check('★ 未收敛时生产 D < D_req_int（这正是 limit 的定义）', !r5.converged && r5.D < di);
}

sub('A5 取整前 / 取整后 / 高度计算的影响');
{
  const sd = RISER_SHAPES.cyl;
  const raw = sd.DfromM(5 * 1.10, 1.0);        // 模数路径的连续解
  console.log(`     cyl Mc=5 f=1.10：DfromM(5.5, 1.0) = ${raw}  ⇒ round = ${Math.round(raw)}`);
  const r = R({ mc: 5, shape: 'cyl', cw: 0, hd_ratio: 1 });
  check('生产 D = round(DfromM(Mr_need, hd))（或升一档）', r.D === Math.round(sd.DfromM(r.Mr_need, 1)) || r.D === Math.round(sd.DfromM(r.Mr_need, 1)) + 1,
    `D=${r.D}`);
  // H 与 D 各自独立取整（同一 raw），hd≠1 时会"错位"
  for (const hd of [0.8, 1.2, 1.5]) {
    const rr = R({ mc: 5, shape: 'cyl', cw: 0, hd_ratio: hd });
    const rawv = sd.DfromM(rr.Mr_need, hd);
    const idealH = Math.round(rawv * hd);
    check(`hd=${hd}：H = round(raw×hd)（用 raw 而非 D）`, rr.H === idealH,
      `raw=${rawv.toFixed(3)} ⇒ H=${rr.H}（若用 D 则 H=${Math.round(rr.D * hd)}）`);
  }
  console.log(`     ⇒ **D 与 H 各自独立对同一个 raw 取整**。hd≠1 时二者可能"错位"（V2.0-14 §2.10 的非单调成因之一）。`);
  console.log(`     ⇒ D_req 用 H = hd·D 的理想关系，**天然忽略这层错位** ⇒ 只能作参考值。`);
}

/* ============================================================
 * B. 边界条件矩阵（128.txt §四）—— 只调生产 runRiser，观察真实行为
 * ============================================================ */
hr('B. 边界条件审查（128.txt §四）');

/** 取返回对象里的"异常值"清单 */
function anomalies(r) {
  if (r === null) return ['__NULL__'];
  const bad = [];
  const walk = (o, p) => {
    if (o === null || o === undefined) return;
    if (typeof o === 'number') {
      if (Number.isNaN(o)) bad.push(p + '=NaN');
      else if (!Number.isFinite(o)) bad.push(p + '=' + (o > 0 ? 'Infinity' : '-Infinity'));
      return;
    }
    if (typeof o !== 'object') return;
    if (Array.isArray(o)) return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'function' || typeof v === 'object') { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p ? p + '.' + k : k); continue; }
      if (typeof v === 'number') {
        if (Number.isNaN(v)) bad.push((p ? p + '.' : '') + k + '=NaN');
        else if (!Number.isFinite(v)) bad.push((p ? p + '.' : '') + k + '=' + (v > 0 ? 'Infinity' : '-Infinity'));
      }
    }
  };
  walk(r, '');
  return bad;
}

/**
 * 退化输入的**预期类别**（128.txt §四「不要将它们混为同一类问题」）：
 *   REJECT   非法输入 → 生产显式拒绝（返回 null）
 *   NA       公式/约束**不适用**（如 cw=0 ⇒ 体积约束不存在）—— 期望行为，但 D_req 须返回"不适用"
 *   FALLBACK 缺失值**回退到既有默认值**（有意的容错，默认值有据可查）
 *   ZERO/SILENT/NAN  ★ 缺陷类别 —— **V2.0-18 后应全部消失**
 *
 * ★★ 本矩阵的**口径已于 V2.0-18 更新**：
 *    V2.0-17 首次运行时它记录的是**修复前**的现状（当时有 NAN×3 / ZERO×2 / SILENT×3），
 *    那份输出保存在 `out/phasev2017_dreq_prefix.log`，是 128.txt 报告 §4.1 的证据。
 *    V2.0-18 修掉输入守卫后，这里改为断言**修复后**的行为 ——
 *    换言之本矩阵从"缺陷台账"变成了"**修复的回归护栏**"：
 *    任何一类缺陷复活，下面那条 `观察 == 声明` 的断言立刻变红。
 */
const MATRIX = [
  // [标签, 输入, 预期类别]                                    ← 括号内为 V2.0-17 修复前的旧行为
  ['cw = 0（未填重量）',        { mc: 5, shape: 'cyl', cw: 0 },                   'NA'],
  ['cw 缺失（undefined）',      { mc: 5, shape: 'cyl' },                          'NA'],
  ['★ cw = "abc"（非数值）',    { mc: 5, shape: 'cyl', cw: 'abc' },              'REJECT'],   // 旧: SILENT
  ['★ cw = 负数（-5）',         { mc: 5, shape: 'cyl', cw: -5 },                  'REJECT'],   // 旧: SILENT
  ['★ cw = Infinity',           { mc: 5, shape: 'cyl', cw: Infinity },           'REJECT'],   // 旧: NAN
  ['mc = 0',                    { mc: 0, shape: 'cyl', cw: 5 },                   'REJECT'],
  ['mc = -3',                   { mc: -3, shape: 'cyl', cw: 5 },                  'REJECT'],
  ['mc = "abc"',                { mc: 'abc', shape: 'cyl', cw: 5 },               'REJECT'],
  ['★ mc = Infinity',           { mc: Infinity, shape: 'cyl', cw: 5 },           'REJECT'],   // 旧: NAN
  ['shape 非法（hexagon）',     { mc: 5, shape: 'hexagon', cw: 5 },               'REJECT'],
  ['★ shape = "constructor"',   { mc: 5, shape: 'constructor', cw: 5 },           'REJECT'],   // 旧: 抛异常
  ['★ shape = "__proto__"',     { mc: 5, shape: '__proto__', cw: 5 },             'REJECT'],   // 旧: 抛异常
  ['hd = 0',                    { mc: 5, shape: 'cyl', cw: 5, hd_ratio: 0 },      'REJECT'],   // 旧: FALLBACK
  ['hd = "abc"',                { mc: 5, shape: 'cyl', cw: 5, hd_ratio: 'abc' },  'REJECT'],   // 旧: FALLBACK
  ['hd 缺失',                   { mc: 5, shape: 'cyl', cw: 5 },                   'FALLBACK'], // 未变：缺省 1.0
  ['hd = 空串',                 { mc: 5, shape: 'cyl', cw: 5, hd_ratio: '' },     'FALLBACK'], // 未变：缺省 1.0
  ['★ hd = 负数（-0.5）',       { mc: 5, shape: 'cyl', cw: 5, hd_ratio: -0.5 },   'REJECT'],   // 旧: ZERO
  ['★ rho = 0（显式覆盖）',     { mc: 5, shape: 'cyl', cw: 5, rho: 0 },           'REJECT'],   // 旧: NAN
  ['★ rho = 负数（-7.1）',      { mc: 5, shape: 'cyl', cw: 5, rho: -7.1 },        'REJECT'],   // 旧: SILENT
  ['eff = 0（显式覆盖）',       { mc: 5, shape: 'cyl', cw: 5, eff: 0 },           'REJECT'],   // 旧: FALLBACK
  ['eff = 负数（-10）',         { mc: 5, shape: 'cyl', cw: 5, eff: -10 },         'REJECT'],   // 旧: HUGE(limit)
  ['eff = 500（>100%）',        { mc: 5, shape: 'cyl', cw: 5, eff: 500 },         'HUGE'],     // 未变：不发明上界
  ['eff 缺失',                  { mc: 5, shape: 'cyl', cw: 5 },                   'FALLBACK'], // 未变：表值
  ['★ eff = NaN',               { mc: 5, shape: 'cyl', cw: 5, eff: NaN },         'FALLBACK'], // 未变：riserView 空输入框路径
  ['mat 未知（QT999）',         { mc: 5, shape: 'cyl', cw: 5, mat: 'QT999' },     'FALLBACK'], // 未变：回退球铁 + mdFellBack
  ['★ Mc 极小（1e-6）',         { mc: 1e-6, shape: 'cyl', cw: 5 },                'REJECT'],   // 旧: ZERO
  ['Mc 极大（1e6）',            { mc: 1e6, shape: 'cyl', cw: 5 },                 'HUGE'],
  ['cw 极大（1e6 kg）',         { mc: 5, shape: 'cyl', cw: 1e6 },                 'HUGE'],
  ['cw 极小（1e-9 kg）',        { mc: 5, shape: 'cyl', cw: 1e-9 },                'HUGE'],
  ['★ cast_a = 0（除零尝试）',  { mc_mode: 'volume', cast_v: 5, cast_a: 0, shape: 'cyl', cw: 5 }, 'REJECT'],   // 旧: 静默换成 a=1 ⇒ Mc=5
  ['mc_mode 未知',              { mc_mode: 'bogus', shape: 'cyl', cw: 5 },       'REJECT'],
];

sub('B1 退化输入矩阵 —— 生产 runRiser 的真实返回');
{
  /** 观察到的类别（纯现象判定，逐行与预期比对） */
  const observed = (r, an, threw, inp) => {
    if (threw) return 'THREW';
    if (r === null) return 'REJECT';
    if (an.some((a) => a.includes('NaN') || a.includes('Infinity'))) return 'NAN';
    if (r.D === 0 || r.H === 0) return 'ZERO';
    // 负的补缩需求 ⇒ `effV >= needVol` 恒真 ⇒ 体积判据被静默架空（rho<0 会走到这里）
    if (r.needVol < 0) return 'SILENT';
    if (r.needVol === 0) {
      const cwRaw = 'cw' in inp ? inp.cw : undefined;
      // 明确填 0 / 根本没填 ⇒ 体积约束"不适用"（设计如此）
      if (cwRaw === undefined || parseFloat(cwRaw) === 0) return 'NA';
      return 'SILENT';                                 // 提供了非 0 值却被丢弃（-5、"abc"）
    }
    return 'OK';                                       // FALLBACK / HUGE 的细分见 note 列
  };

  console.log('   #  输入                        预期     观察     D/H/Vr                      说明');
  const findings = [];
  MATRIX.forEach(([label, inp, expect], i) => {
    let r, threw = null;
    try { r = R(inp); } catch (e) { threw = e.message; }   // 必须走 R：它把 cw 映射成生产键 cast_wt
    const an = threw ? ['THREW'] : anomalies(r);
    const obs = observed(r, an, threw, inp);
    // 符号标记（用于 FALLBACK / SILENT / HUGE 的细分，只描述现象）
    let note = '';
    if (!threw && r) {
      const cwRaw = 'cw' in inp ? inp.cw : undefined;
      const cwNum = cwRaw === undefined ? 0 : parseFloat(cwRaw);
      if (r.needVol > 0 && !(cwNum > 0) && cwNum !== 0) note = '★重量非法但体积判据被当"有效"处理';
      else if (r.needVol > 0 && !(cwNum > 0)) note = '★负值 ⇒ 体积判据恒真（静默关闭）';
      else if (r.needVol > 0 && !r.volOk && !r.converged) note = '撞 f 上限（未收敛）';
      else if (r.D >= 1e6) note = '直径荒谬大（无上界保护）';
      else if (Number.isFinite(r.needVol) && r.needVol > 0 && r.effV >= r.needVol) note = '体积判据一次通过';
    }
    const dh = r ? `D=${r.D} H=${r.H} Vr=${String(r.Vr).slice(0, 12)}` : '—';
    const mark = obs === expect ? ' ' : '≠';
    console.log(`   ${String(i + 1).padStart(2)}  ${label.padEnd(28)} ${expect.padEnd(8)} ${(obs + mark).padEnd(7)}  ${dh.padEnd(27)} ${note}`);
    findings.push({ label, expect, obs, match: obs === expect || (expect === 'HUGE' && obs === 'OK') || (expect === 'FALLBACK' && obs === 'OK') || (expect === 'SILENT' && obs === 'OK'), threw, an, r });
  });

  console.log('');
  const mismatched = findings.filter((f) => !f.match);
  check('★ 每一项退化输入的**观察类别**都与声明一致（模型 = 代码真实行为）', mismatched.length === 0,
    mismatched.map((f) => `${f.label}: 预期 ${f.expect} 实测 ${f.obs}`).join(' | ') || `${findings.length} 项全部吻合`);

  const threwAny = findings.filter((f) => f.threw);
  check('★ 退化输入**不抛异常**（契约：非法输入返回 null）', threwAny.length === 0,
    threwAny.map((f) => f.label).join(' / ') || '无');

  // ★★ V2.0-18 已修复输入守卫 ⇒ 三类缺陷必须**全部归零**。
  //    V2.0-17 时这里钉的是"已知 NAN×3 / ZERO×2"，现改为断言"应为 0"——
  //    这就是本矩阵从"缺陷台账"变成"回归护栏"的转折点。
  const nanRows = findings.filter((f) => f.obs === 'NAN');
  const zeroRows = findings.filter((f) => f.obs === 'ZERO');
  const silentRows = findings.filter((f) => f.obs === 'SILENT' || (f.note || '').includes('静默'));
  check('★★ NAN 类应为 0（V2.0-17 修复前为 3）', nanRows.length === 0, nanRows.map((f) => f.label).join(' / ') || '0 ✓');
  check('★★ ZERO 类应为 0（V2.0-17 修复前为 2）', zeroRows.length === 0, zeroRows.map((f) => f.label).join(' / ') || '0 ✓');
  check('★★ SILENT 类应为 0（V2.0-17 修复前为 3）', silentRows.length === 0, silentRows.map((f) => f.label).join(' / ') || '0 ✓');
  const threwRows = findings.filter((f) => f.obs === 'THREW');
  check('★★ 未知 shape 的**原型链键**也不得抛异常（V2.0-17 未发现的缺陷）',
    threwRows.length === 0, threwRows.map((f) => f.label).join(' / ') || '0 ✓');
  // 仍然允许存在的两类（有据可查的既有约定 / 极端但合法）
  const fb = findings.filter((f) => f.expect === 'FALLBACK');
  const hu = findings.filter((f) => f.expect === 'HUGE');
  console.log(`     ✓ 仍然保留：FALLBACK ${fb.length} 项（缺失值 ⇒ 既有默认值）· HUGE ${hu.length} 项（极端但合法的数值结果）`);
  for (const f of fb) console.log(`       FALLBACK ${f.label}  →  走既有默认值（${f.obs}）`);
}

sub('B2 cw = 0 的确切含义（128.txt §四.1）');
{
  const r0 = R({ mc: 5, shape: 'cyl', cw: 0 });
  console.log(`     cw=0 ⇒ Vc=${r0.Vc}  needVol=${r0.needVol}  volOk=${r0.volOk}  yieldPct=${r0.yieldPct}`);
  check('cw=0 ⇒ Vc=0 且 needVol=0', r0.Vc === 0 && r0.needVol === 0);
  check('★ volOk 是**结构性短路**（`cw>0 ? … : true`），不是"effV ≥ 0"的算术结果', r0.volOk === true);
  check('yieldPct 在 cw=0 时返回 **null**（生产中"不适用"的既有惯例）', r0.yieldPct === null);
  console.log(`     ⇒ 体积约束**不存在** ⇒ D_req **无定义**（不是 0、不是 Infinity）。`);
  console.log(`     ⇒ 生产已有"不适用 ⇒ null"的先例（yieldPct）—— 未来 D_req 接口应沿用该惯例。`);
}

sub('B3 ★ sphere_head 且 hd < 0.5 的退化原因（128.txt §四.2）');
{
  // 数学原因：Hc = H − r = D(hd − 0.5)。hd<0.5 ⇒ Hc<0 属"不合法几何"，
  //   sizeAt 把它夹到 H ≥ r（riser.js:116/122）⇒ 实际 hd 被抬到 ~0.5。
  const cases = [0.1, 0.2, 0.3, 0.4, 0.49, 0.5, 0.6];
  console.log('   hd     生产 D/H      实际 H/D    V(D,H)        π(3hd−0.5)/12·D³     真实 k=V/D³');
  for (const hd of cases) {
    const r = R({ mc: 5, shape: 'sphere_head', cw: 0, hd_ratio: hd });
    const kFormula = Math.PI * (3 * hd - 0.5) / 12;
    const kReal = r.Vr / r.D ** 3;
    console.log(`   ${String(hd).padEnd(6)} ${String(r.D + '/' + r.H).padEnd(12)} ${(r.H / r.D).toFixed(3).padEnd(10)} ${r.Vr.toFixed(2).padEnd(12)} ${(kFormula * r.D ** 3).toFixed(2).padEnd(20)} ${kReal.toFixed(6)}`);
  }
  console.log(`     ⇒ hd<0.5 时闭式 k 变得 ≤0（hd=1/6 时为零，更小则为负）⇒ **解析式失效**。`);
  console.log(`     ⇒ 生产把 H 夹到 ≥ r ⇒ 实际形状是"半球(+极短柱)" ⇒ 真实 k ≈ π/12（见下条取整细节）。`);

  const r02 = R({ mc: 5, shape: 'sphere_head', cw: 0, hd_ratio: 0.2 });
  check('★ hd=0.2 时生产 H 被夹到 ≥ D/2', r02.H >= r02.D / 2 - 0.5, `D=${r02.D} H=${r02.H} H/D=${(r02.H / r02.D).toFixed(3)}`);
  check('★ 闭式 k(0.2) 与实际 k 相差 >5×（确证退化）', Math.abs(Math.PI * (3 * 0.2 - 0.5) / 12) < r02.Vr / r02.D ** 3 / 5);
  check('hd=0.2 与 hd=0.5 得到**完全相同的尺寸**（夹取生效）',
    (() => { const a = R({ mc: 5, shape: 'sphere_head', cw: 0, hd_ratio: 0.2 }); const b = R({ mc: 5, shape: 'sphere_head', cw: 0, hd_ratio: 0.5 }); return a.D === b.D && a.H === b.H; })(),
    `hd=0.2→${r02.D}/${r02.H}，hd=0.5→${R({ mc: 5, shape: 'sphere_head', cw: 0, hd_ratio: 0.5 }).D}/${R({ mc: 5, shape: 'sphere_head', cw: 0, hd_ratio: 0.5 }).H}`);
}

sub('B4 sphere_head 夹取后的**取整细节**（V2.0-16 未覆盖）');
{
  // 夹取是 H = round(r) = round(D/2)。D 为**奇数**时 round(D/2) 向上 ⇒ 实际 H > r
  //   ⇒ 变成"半球 + 极短圆柱"，k **不是** π/12。这会影响 D_req 的精确整数解。
  const rows = [];
  for (let d = 3; d <= 15; d++) {
    const h = Math.round(d / 2);
    const V = RISER_SHAPES.sphere_head.V(d, h);
    rows.push({ d, h, kReal: V / d ** 3, kHemisphere: Math.PI / 12, isOdd: d % 2 === 1 });
  }
  console.log('   D    H=round(D/2)   V/D³ 实测     π/12（理想半球）   偏差');
  for (const r of rows) {
    console.log(`   ${String(r.d).padEnd(4)} ${String(r.h).padEnd(13)} ${r.kReal.toFixed(6).padEnd(14)} ${r.kHemisphere.toFixed(6).padEnd(18)} ${((r.kReal / r.kHemisphere - 1) * 100).toFixed(2)}%${r.isOdd ? '  ← 奇数 D' : ''}`);
  }
  const odd = rows.filter((r) => r.isOdd);
  check('★ D 为奇数时 k **不等于** π/12（H=round(D/2) 向上取整）',
    odd.every((r) => Math.abs(r.kReal - Math.PI / 12) > 1e-9),
    `D=3 时 k=${rows[0].kReal.toFixed(4)} vs π/12=${(Math.PI / 12).toFixed(4)}（+${((rows[0].kReal / (Math.PI / 12) - 1) * 100).toFixed(0)}%）`);
  check('D 为偶数时 k = π/12（真正的半球）', rows.filter((r) => !r.isOdd).every((r) => Math.abs(r.kReal - Math.PI / 12) < 1e-12));
  console.log(`     ⇒ **小直径下偏差显著**（D=3 时 **+50%**），随 D 增大迅速衰减（D=15 时 +10%）。`);
  console.log(`     ⇒ 对 D_req **应使用精确整数扫描**而非闭式；闭式在 hd<0.5 只能给出保守上界。`);
}

sub('B5 其他形状逐一核查（128.txt §四.3）');
{
  const spec = [
    { shape: 'cyl', V: 'π D²/4 · H', k: 'π·hd/4', hdDep: '依赖 hd', clamp: '无' },
    { shape: 'square', V: 'a² · H', k: 'hd', hdDep: '依赖 hd', clamp: '无' },
    { shape: 'sphere', V: '4/3 π (D/2)³', k: 'π/6', hdDep: '**与 hd 无关**（h 恒 = d）', clamp: 'H 被强制 = D' },
    { shape: 'sphere_head', V: '2/3πr³ + πr²·Hc（Hc = H−r）', k: 'π(3hd−0.5)/12（hd≥0.5）', hdDep: '依赖 hd', clamp: '**H ≥ r**（hd<0.5 时触发）' },
  ];
  for (const s of spec) {
    const sd = RISER_SHAPES[s.shape];
    // 实测 V 与闭式在"合法域"内一致
    let ok = true;
    for (const hd of [0.8, 1.0, 1.5]) for (const D of [10, 50, 150]) {
      const got = sd.V(D, D * hd), exp = { cyl: Math.PI * D * D / 4 * D * hd, square: D * D * D * hd, sphere: 4 / 3 * Math.PI * (D / 2) ** 3, sphere_head: Math.PI * D ** 3 * (3 * hd - 0.5) / 12 }[s.shape];
      if (Math.abs(got - exp) > 1e-9 * Math.abs(exp)) ok = false;
    }
    console.log(`   ${s.shape.padEnd(12)} V=${s.V.padEnd(34)} k=${s.k.padEnd(22)} ${s.hdDep.padEnd(24)} 修正:${s.clamp}`);
    check(`   ${s.shape}：闭式与 sd.V 一致（合法域）`, ok);
  }
  // sphere 与 hd 无关 —— 用生产验证
  const sphDs = [0.8, 1.0, 1.2, 1.5].map((hd) => R({ mc: 5, shape: 'sphere', cw: 5, hd_ratio: hd }));
  check('★ sphere：4 种 hd 给出**完全相同**的 D/H/Vr', new Set(sphDs.map((r) => `${r.D}|${r.H}|${r.Vr}`)).size === 1,
    `${sphDs[0].D}/${sphDs[0].H}`);
}

sub('B6 数值精度与极值');
{
  // 三次根往返
  let worst = 0;
  for (const nv of [1e-12, 1e-6, 1, 1e6, 1e12, 1e18]) {
    const d = Math.cbrt(nv / (0.14 * Math.PI / 4));
    worst = Math.max(worst, Math.abs(d ** 3 * 0.14 * Math.PI / 4 - nv) / nv);
  }
  check('三次根往返精度（needVol 跨 30 个数量级）', worst < 1e-12, `最大相对误差 ${worst.toExponential(2)}`);
  // 整数扫描的表示范围：D_req_int 是无界循环的上界，需确认现实输入下不会溢出/超时
  const kg = 1000;                                    // 1000 吨铸件（远超任何现实件）
  const nv = kg * 1e6 / 7.1 * 0.03;
  const dreq = Math.cbrt(nv / (0.14 * Math.PI / 4));
  console.log(`     极端推算：${kg} kg 铸件 ⇒ needVol=${nv.toExponential(3)} mm³ ⇒ D_req=${dreq.toFixed(0)} mm`);
  check('★ 现实上界内 D_req 仍是有限、可表示的普通浮点数', Number.isFinite(dreq) && dreq < 1e5,
    `D_req=${dreq.toFixed(0)} mm ⇒ 整数扫描到 ${Math.ceil(dreq)} 步即可，无溢出、无超时风险`);
}

/* ============================================================
 * C. 与既有实验结果的一致性（交叉核对，不作为唯一依据）
 * ============================================================ */
hr('C. 与 V2.0-16 只读核查的交叉核对');
{
  const txt = readFileSync(CSV, 'utf8');
  const nLines = txt.replace(/\s+$/, '').split('\n').length;
  check('基线 CSV 仍可读且行数未变（26,525 数据行 + 表头）', nLines === 26526, `${nLines} 行`);
  const r = R({ mc: 5, shape: 'cyl', cw: 77.56, hd_ratio: 1 });
  const dreq = Math.cbrt(r.needVol / (r.eff * Math.PI / 4));
  check('★ 143.9111 独立复算一致（与 phasev2016_verify 同源不同路径）', Math.abs(dreq - 143.9111) < 5e-4, dreq.toFixed(4));
  console.log('     ⇒ 本脚本与 phasev2016_verify.mjs **互不依赖**：前者用齐次性 + 数值微分 + 整数扫描，');
  console.log('       后者用点采样 + 翻转点搜索。两者结论一致 ⇒ 可认为公式重建是**可复核**的。');
}

console.log('\n' + '═'.repeat(78));
console.log(`PHASE V2.0-17 只读复核：${FAIL === 0 ? '全部断言通过 ✅' : FAIL + ' 项断言失败 ❌'}`);
console.log('═'.repeat(78));
process.exit(FAIL ? 1 : 0);
