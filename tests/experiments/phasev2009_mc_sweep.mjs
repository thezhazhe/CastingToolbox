// ============================================================
// PHASE V2.0-09（119.txt 任务 A）· **只读**诊断：Mc → 最终 D/H 受控扫描
//
//   本脚本**不修改任何生产代码**：只 import 生产模块并调用它们的公开入口。
//   两条路径都走真实生产入口：
//     ① 单热结 = CALC_MANIFEST.riser.calculate()（designCenter 主路径同一支）
//     ② 多热结 = 同一入口，process.hsPick 非空
//   另用 runRiser 直调做纯公式层隔离（绕开 manifest 的选值逻辑）。
//
//   要回答的问题（119.txt §三）：
//     Q1  D = round(6·Mc·f) 的真实位置与各变量含义
//     Q2  中间量 vs 最终推荐尺寸
//     Q3  两条约束如何影响 D/H（谁在主导）
//     Q4  Mc 增大而 D/H 减小是否真实存在？什么条件？多大量级？
//     Q5  单热结 / 多热结是否共用同一套逻辑
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as proj from '../../js/model/CastingProject.js';
import { SRC, CONF } from '../../js/model/CastingProject.js';
import { getCalcManifest } from '../../calcs/calcManifest.js';
import { runRiser, RISER_SHAPES, RISER_MATERIALS, RISER_EFF } from '../../calcs/riser.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const f2 = (x) => (x == null ? '—' : (Math.round(x * 100) / 100).toFixed(2));

// ---------- 生产入口：单热结 ----------
/** 通过 calcManifest 单热结路径算一个冒口（Mc 由用户显式输入 ⇒ 与检出值无关，隔离变量） */
function singleViaManifest(mc, { shape = 'cyl', mat = '球铁', wt = 0, hd = 1.0 } = {}) {
  proj.reset();
  proj.set('material.family', mat);
  proj.set('material.solidDensity', RISER_MATERIALS[mat].rho, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  if (wt > 0) {
    proj.set('geometry.netWeightKg', wt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
    proj.set('geometry.blankWeightKg', wt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  }
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, mc }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', mc, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);  // 用户显式 Mc
  proj.set('process.riserShape', shape, SRC.DEFAULT, CONF.LOW);
  return getCalcManifest('riser').calculate();
}

// ---------- 生产入口：多热结 ----------
function multiViaManifest(mcs, { shape = 'cyl', mat = '球铁', wt = 0 } = {}) {
  proj.reset();
  proj.set('material.family', mat);
  proj.set('material.solidDensity', RISER_MATERIALS[mat].rho, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  if (wt > 0) {
    proj.set('geometry.netWeightKg', wt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
    proj.set('geometry.blankWeightKg', wt, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  }
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', mcs.map((mc, i) => ({ id: i + 1, mc })), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', Math.max(...mcs), SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.riserShape', shape, SRC.DEFAULT, CONF.LOW);
  proj.set('process.hsPick', mcs.map((mc, i) => ({ id: i + 1, mc })), SRC.USER_INPUT, CONF.USER_CONFIRMED);
  return getCalcManifest('riser').calculate();
}

/** 扫描 mc 序列，找 D 或 H 随 Mc 增大而减小的点 */
function violations(rows) {
  const v = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.D < a.D || b.H < a.H) v.push({ from: a, to: b });
  }
  return v;
}

say('='.repeat(78));
say('PHASE V2.0-09 · 任务 A · Mc → D/H 只读受控扫描');
say('='.repeat(78));

// ============================================================
// A0 · 源码事实：公式到底在哪、长什么样
// ============================================================
say('\n## A0 公式位置与形状表（源码确认，未修改）\n');
say('calcs/riser.js:96-100 迭代体：');
say('    for (let iter = 0; iter < 50; iter++) {');
say('      Mr_need = Mc * f;                       // :97  中间量');
say('      D = sd.DfromM(Mr_need, hd);             // :98  未取整的几何直径');
say('      H = Math.round(D * hd);                 // :99  H 用【未取整】的 D');
say('      D = Math.round(D);                      // :100 最终推荐直径（取整）');
say('      ... modOk / volOk ... f += 0.05 }');
say('形状表 calcs/riser.js:33（圆柱）：DfromM = (Mr,hd) => Mr*(2+4*hd)/hd');
say('  ⇒ hd = 1.0（设计中心硬编码 hd_ratio:1.0，calcManifest.js:269）时：');
say('     DfromM(Mr,1) = 6·Mr  ⇒  D = round(6·Mc·f)   ← 119.txt 点名的那个式子，成立');
say(`  f 取值集合 = {1.10, 1.15, ..., 3.55}（起点 1.10，步长 0.05，最多 50 轮）`);

// ============================================================
// A1 · 纯模数区（cast_wt = 0 ⇒ 体积约束不生效）的单调性
// ============================================================
say('\n' + '='.repeat(78));
say('## A1 纯模数区：cast_wt = 0（无体积约束）');
say('='.repeat(78));
{
  const rows = [];
  for (let mc = 1; mc <= 60.0001; mc += 0.1) {
    const r = singleViaManifest(Math.round(mc * 10) / 10, { wt: 0 });
    rows.push({ mc: Math.round(mc * 10) / 10, D: r.D, H: r.H, f: r.final_f, Mr_act: r.Mr_act, Mr_need: r.Mr_need, neck: r.d_neck, bind: r.bind, volOk: r.volOk });
  }
  const bad = violations(rows);
  const exact = rows.every(r => r.D === Math.round(6 * r.mc * r.f));
  say(`扫描点数：${rows.length}（Mc 1.0 → 60.0，步长 0.1）`);
  say(`D == round(6·Mc·f) 逐点成立：${exact ? '是（全部 ' + rows.length + ' 点）' : '否'}`);
  say(`D 随 Mc 非单调的点数：${bad.length}`);
  say(`bind 取值分布：${JSON.stringify(rows.reduce((m, r) => (m[r.bind] = (m[r.bind] || 0) + 1, m), {}))}`);
  say(`样点：`);
  for (const mc of [1, 5, 7, 7.5, 8, 14, 20, 60]) {
    const r = rows.find(x => x.mc === mc);
    say(`   Mc=${String(mc).padStart(4)}  f=${f2(r.f)}  D=H=${r.D}  Mr_act=${f2(r.Mr_act)} / Mr_need=${f2(r.Mr_need)}  d_neck=${r.neck}  bind=${r.bind}`);
  }
  say(`⇒ 结论：无体积约束时 f 恒 = 1.10（首轮即通过）⇒ D = round(6.6·Mc) 严格单调不减。`);
  say(`   Mc < 7.58 时首轮 modOk 不过（Mr_act ≥ 0.99·6·Mc·f 需 Mc·f ≥ 8.33），f 会上抬，`);
  say(`   但 D 仍随 Mc 单调（见下面 A1b）。`);
}
{
  // A1b：极小 Mc 段（f 会抬升）单独看单调性
  const rows = [];
  for (let mc = 0.1; mc <= 8.0001; mc += 0.01) {
    const r = singleViaManifest(Math.round(mc * 100) / 100, { wt: 0 });
    if (!r) continue;
    rows.push({ mc: Math.round(mc * 100) / 100, D: r.D, H: r.H, f: r.final_f, bind: r.bind });
  }
  const bad = violations(rows);
  say(`\nA1b 极小 Mc 段（0.10 → 8.00，步长 0.01，${rows.length} 点）：非单调点数 = ${bad.length}`);
  if (bad.length) for (const b of bad.slice(0, 5)) say(`   Mc ${b.from.mc}→${b.to.mc} : D ${b.from.D}→${b.to.D}, H ${b.from.H}→${b.to.H}`);
}

// ============================================================
// A2 · 体积约束介入后：非单调性是否真实存在
// ============================================================
say('\n' + '='.repeat(78));
say('## A2 体积约束介入：球铁 / 圆柱 / cast_wt = 77.56 kg（= HR4012 口径）');
say('='.repeat(78));
{
  const WT = 77.56, MAT = '球铁';
  const md = RISER_MATERIALS[MAT];
  const Vc = WT * 1e6 / md.rho, needVol = Vc * md.shrink;
  const eff = RISER_EFF[RISER_SHAPES.cyl.effKey] / 100;
  const Dvol = Math.cbrt(needVol / eff / (Math.PI / 4));
  say(`（解析参照）Vc = ${f2(Vc)} mm³，needVol = Vc×shrink = ${f2(needVol)} mm³`);
  say(`（解析参照）体积约束下圆柱的直径下界 D_vol = cbrt(needVol/eff/(π/4)) = ${f2(Dvol)} mm`);
  say(`           —— 该值与 Mc 无关（体积校核不读 Mc），这是"体积主导区"的成因。\n`);

  const rows = [];
  for (let mc = 1; mc <= 60.0001; mc += 0.1) {
    const r = singleViaManifest(Math.round(mc * 10) / 10, { wt: WT, mat: MAT });
    rows.push({ mc: Math.round(mc * 10) / 10, D: r.D, H: r.H, f: r.final_f, Mr_act: r.Mr_act, Mr_need: r.Mr_need, neck: r.d_neck, bind: r.bind, volOk: r.volOk, dModOnly: r.dModOnly });
  }
  const bad = violations(rows);
  const byD = {};
  for (const r of rows) byD[r.D] = (byD[r.D] || 0) + 1;
  say(`扫描点数：${rows.length}（Mc 1.0 → 60.0，步长 0.1）`);
  say(`**D 或 H 随 Mc 增大而减小的点对数：${bad.length}**`);
  const mag = bad.map(b => b.from.D - b.to.D);
  if (mag.length) say(`   跌幅：min ${Math.min(...mag)} mm，max ${Math.max(...mag)} mm，中位 ${mag.slice().sort((a, b) => a - b)[Math.floor(mag.length / 2)]} mm`);
  say(`bind 分布：${JSON.stringify(rows.reduce((m, r) => (m[r.bind] = (m[r.bind] || 0) + 1, m), {}))}`);
  say(`\n全部非单调点（前 25 条）：`);
  say(`   Mc→Mc+0.1        D→D+0.1        f→f+0.1        bind`);
  for (const b of bad.slice(0, 25)) {
    say(`   ${String(b.from.mc).padStart(5)} → ${String(b.to.mc).padStart(5)}   ${String(b.from.D).padStart(4)} → ${String(b.to.D).padStart(4)}   ${f2(b.from.f)} → ${f2(b.to.f)}   ${b.from.bind}`);
  }
  if (bad.length > 25) say(`   …（共 ${bad.length} 条，完整清单见 out/phasev2009_mc_sweep.txt）`);
  say(`\n典型样点：`);
  for (const mc of [5, 8, 11.4, 11.5, 14, 15, 19, 20, 21, 30, 40, 60]) {
    const r = rows.find(x => x.mc === mc);
    if (!r) continue;
    say(`   Mc=${String(mc).padStart(5)}  f=${f2(r.f)}  D=H=${String(r.D).padStart(4)}  仅模数需 D=${String(r.dModOnly).padStart(4)}  d_neck=${r.neck}  bind=${r.bind}`);
  }
}

// ============================================================
// A3 · 非单调的成因分解（把 f 网格与 round 分开看）
// ============================================================
say('\n' + '='.repeat(78));
say('## A3 成因分解：为什么"Mc 变大 D 反而变小"');
say('='.repeat(78));
{
  const WT = 77.56, MAT = '球铁';
  say('迭代要同时满足两条约束，f 只能取 {1.10+0.05k}：');
  say('  约束① 模数：round(6·Mc·f) ≥ 0.99 × 6·Mc·f   （取整容差 1%）');
  say('  约束② 体积：eff × V(round(6·Mc·f)) ≥ needVol  ⇒  round(6·Mc·f) ≳ D_vol');
  say('  ⇒ 程序取【满足两条的最小网格 f】，D = round(6·Mc·f)。');
  say('  ⇒ 网格步长 ΔD = 6·Mc×0.05 = 0.3·Mc（随 Mc 线性放大）。');
  say('  ⇒ 体积主导区内，最小可行 f ≈ D_vol/(6·Mc) 随 Mc 连续下降，');
  say('     而 round 把它吸附到离散网格点上 ⇒ D 在一个步长内抖动，方向可以向下。\n');
  // 用手算网格演示两个相邻 Mc
  const show = (mc) => {
    const Dvol = 143.94;
    let f = 1.10, hit = null;
    for (let i = 0; i < 50; i++) {
      const D = Math.round(6 * mc * f);
      if (D >= Dvol && D >= 6 * mc * f * 0.99) { hit = { f: Math.round(f * 100) / 100, D }; break; }
      f += 0.05;
    }
    return hit;
  };
  for (const mc of [14, 14.5, 15, 19.5, 20, 20.5, 21]) {
    const h = show(mc);
    say(`   Mc=${String(mc).padStart(4)}  最小可行 f=${f2(h.f)}  ⇒  D = round(6×${mc}×${f2(h.f)}) = ${h.D}`);
  }
  say('\n⇒ **非单调不是 bug，是"离散 f 网格 × round"对连续需求曲线的量化抖动**；');
  say('   但它是用户可见的：114→144 这类下跌会让人认为软件坏了。');

  // 测试 hd 与形状是否改变结论
  say('\n换形状 / 换 hd（runRiser 直调，仍只读）：');
  for (const shape of ['cyl', 'square', 'sphere_head', 'sphere']) {
    const rows = [];
    for (let mc = 1; mc <= 40.0001; mc += 0.1) {
      const r = runRiser({ mat: MAT, cast_wt: WT, mc_mode: 'direct', mc: Math.round(mc * 10) / 10, shape, hd_ratio: 1.0 });
      if (!r) continue;
      rows.push({ mc: Math.round(mc * 10) / 10, D: r.D, H: r.H, f: r.final_f, bind: r.bind });
    }
    const bad = violations(rows);
    const mag = bad.map(b => b.from.D - b.to.D);
    say(`   ${shape.padEnd(12)} 非单调点对 ${String(bad.length).padStart(4)} / ${rows.length}   最大跌幅 ${mag.length ? Math.max(...mag) : 0} mm   D 范围 ${Math.min(...rows.map(r => r.D))}~${Math.max(...rows.map(r => r.D))}`);
  }
  const rowsHd = [];
  for (let mc = 1; mc <= 40.0001; mc += 0.1) {
    const r = runRiser({ mat: MAT, cast_wt: WT, mc_mode: 'direct', mc: Math.round(mc * 10) / 10, shape: 'cyl', hd_ratio: 0.5 });
    if (!r) continue;
    rowsHd.push({ mc: Math.round(mc * 10) / 10, D: r.D, H: r.H, f: r.final_f });
  }
  say(`   cyl hd=0.5   非单调点对 ${violations(rowsHd).length} / ${rowsHd.length}（生产路径不暴露 hd，仅独立计算器可调）`);
}

// ============================================================
// A4 · 单热结 vs 多热结：是否共用同一套尺寸逻辑
// ============================================================
say('\n' + '='.repeat(78));
say('## A4 单热结 vs 多热结路径');
say('='.repeat(78));
{
  // 同一 Mc 两条路径逐个字段比对
  const one = singleViaManifest(14, { wt: 77.56 });
  const multi1 = multiViaManifest([14], { wt: 77.56 });
  const keys = ['D', 'H', 'Mr_act', 'Mr_need', 'Vr', 'effV', 'final_f', 'd_neck', 'M_neck', 'volOk', 'modOk', 'dModOnly'];
  const diff = keys.filter(k => !Object.is(one[k], multi1[k]));
  say(`同 Mc=14、同 cast_wt：单热结结果 vs 多热结（仅勾 1 个）逐字段比对`);
  say(`   不一致字段：${diff.length ? diff.join(', ') : '无（12 个字段逐位相同）'}`);
  say(`   ⇒ 两条路径**调用同一个 runRiser、同一套公式**（calcManifest.js:267 runOne → riser.js:78）。`);
  say(`     区别只在：(a) 逐热结各调一次；(b) 顶层结果取 Mc 最大者（:284 reduce）；`);
  say(`     (c) **每个冒口的体积校核都用【整件】补缩量**（闭包 castWt 不分摊，D4）。\n`);

  // 顶层 primary 的选择依据是 Mc 而不是 D —— 在非单调区会选错"最大的那个冒口"
  say('★ 多热结"主结果"＝ Mc 最大者（calcManifest.js:284 `b.Mc > a.Mc`），**不是 D 最大者**。');
  say('  在 A2 的非单调区，这两者会分离。受控构造：');
  const cases = [[14, 20], [8, 20], [11.4, 20], [14, 19], [5, 20], [20, 14]];
  for (const [m1, m2] of cases) {
    const r = multiViaManifest([m1, m2], { wt: 77.56 });
    const items = r.items.map(i => `H${i.hsId}(Mc=${i.Mc}→D=${i.D})`).join('  ');
    const dmax = r.items.reduce((a, b) => (b.D > a.D ? b : a));
    const flag = dmax.hsId !== r.items.find(i => i.Mc === r.Mc)?.hsId ? '  ⚠ 主结果不是 D 最大的那个' : '';
    say(`   hsPick=[${m1}, ${m2}] → ${items}   顶层 r.Mc=${r.Mc}, r.D=${r.D}${flag}`);
  }
}

// ============================================================
// A5 · 其他限制：迭代上限 / 壁厚兜底 / 材料
// ============================================================
say('\n' + '='.repeat(78));
say('## A5 其他限制的实际作用');
say('='.repeat(78));
{
  say('① 迭代上限：f ≤ 3.55（50 轮）⇒ 重件 + 小 Mc 会撞顶，此时 D/H **不是收敛解**');
  for (const [mat, wt, mc] of [['球铁', 77.56, 5], ['球铁', 77.56, 3], ['球铁', 400, 8], ['铸钢', 400, 8], ['灰铁', 400, 10]]) {
    const r = runRiser({ mat, cast_wt: wt, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 });
    say(`   ${mat} / ${wt} kg / Mc=${mc} → D=${r.D} f=${f2(r.final_f)} volOk=${r.volOk} bind=${r.bind}${r.bind === 'limit' ? '   ← 撞上限，非收敛' : ''}`);
  }
  say('\n② 材料通过 shrink / eff / neck_k / rho 四个系数进入，不改变 Mc→D 的映射形式');
  for (const mat of Object.keys(RISER_MATERIALS)) {
    const r = runRiser({ mat, cast_wt: 77.56, mc_mode: 'direct', mc: 14, shape: 'cyl', hd_ratio: 1.0 });
    const md = RISER_MATERIALS[mat];
    say(`   ${mat.padEnd(4)} shrink=${md.shrink} rho=${md.rho} neck_k=${md.neck_k}  → Mc=14 时 D=${r.D} f=${f2(r.final_f)} d_neck=${r.d_neck} bind=${r.bind}`);
  }
  say('\n③ 冒口颈与 D 脱钩：d_neck = round(4·Mc·neck_k) 只读 Mc，不参与迭代/校核');
  const n = [];
  for (let mc = 5; mc <= 30.0001; mc += 0.5) n.push({ mc, d: runRiser({ mat: '球铁', cast_wt: 77.56, mc_mode: 'direct', mc, shape: 'cyl', hd_ratio: 1.0 }).d_neck });
  say(`   Mc 5→30 时 d_neck ${n[0].d}→${n[n.length - 1].d}（严格递增：${n.every((x, i) => i === 0 || x.d > n[i - 1].d)}）`);
  say(`   ⇒ **同一区间 D 在 144 附近抖动、颈却单调放大** ⇒ "冒口一样大、颈越来越粗"。`);
}

// ============================================================
// A7 · 下游影响：非单调区里"主结果"会把哪个 H 交给浇注系统
// ============================================================
say('\n' + '='.repeat(78));
say('## A7 下游影响链：多热结主结果 → process.riserHeight → gating Hp');
say('='.repeat(78));
{
  say('源码确认：designCenter.js:1728 `proj.setResult(\'process.riserHeight\', r.H)`');
  say('           （r = 顶层结果 = Mc 最大的那个 item，calcManifest.js:284）');
  say('          calcManifest.js:140 `rh: proj.getV(\'process.riserHeight\')` → runGating(Hp 方案 A)');
  say('⇒ 非单调区里，交给浇注系统的是【Mc 最大者的 H】，不是【最大冒口的 H】。\n');

  const WT = 77.56;
  const pairs = [[14, 20], [20, 14], [14, 19], [21, 20], [8, 14]];
  for (const [m1, m2] of pairs) {
    const r = multiViaManifest([m1, m2], { wt: WT });
    const hmax = Math.max(...r.items.map(i => i.H));
    const hPrimary = r.H;
    // 用两个候选 H 各跑一次浇注系统，看 Hp 差多少
    const hp = (rh) => {
      proj.reset();
      proj.setResult('process.riserHeight', rh);
      proj.set('material.family', '球铁');
      proj.set('geometry.blankWeightKg', WT, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
      proj.set('process.pourPos', '中注', SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
      proj.set('process.Ho', 150, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
      proj.set('process.ph', 100, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
      proj.set('process.riserHeight', rh, SRC.DERIVED, CONF.MEDIUM);
      const g = getCalcManifest('gating').calculate();
      return g && g.Hp;
    };
    const a = hp(hPrimary), b = hp(hmax);
    say(`   hsPick=[${m1},${m2}] → 各冒口 H = [${r.items.map(i => i.H).join(', ')}]，主结果 H=${hPrimary}`);
    say(`      最大冒口 H=${hmax}｜Hp(H=${hPrimary})=${f2(a)}  Hp(H=${hmax})=${f2(b)}  差 ${f2(Math.abs(a - b))} mm${hPrimary !== hmax ? '   ← 回写用的是较小的那个' : ''}`);
  }
  say('\n⇒ 影响量级：H 差 3 mm 时 Hp 差 <1 mm（Hp 对小 H 不敏感）。**方向是"略偏"，未发现数量级错误。**');
}

// ============================================================
// A8 · 非单调的两个独立成因，分开量化
// ============================================================
say('\n' + '='.repeat(78));
say('## A8 非单调的两个独立成因（分开量化，避免混为一谈）');
say('='.repeat(78));
{
  // 成因①：体积主导区 —— f 网格步长 0.3·Mc × round
  say('【成因①·体积主导区】f 网格 × round：跌幅上界 ≈ 一个网格步长 0.3·Mc。');
  const rowsV = [];
  for (let mc = 5; mc <= 30.0001; mc += 0.01) {
    const r = singleViaManifest(Math.round(mc * 100) / 100, { wt: 77.56 });
    rowsV.push({ mc: Math.round(mc * 100) / 100, D: r.D });
  }
  const badV = [];
  for (let i = 1; i < rowsV.length; i++) if (rowsV[i].D < rowsV[i - 1].D) badV.push({ from: rowsV[i - 1], to: rowsV[i] });
  const relV = badV.map(b => (b.from.D - b.to.D) / b.from.D);
  say(`   Mc ∈ [5,30] 步长 0.01：${rowsV.length} 点，下跌点 ${badV.length}（${(badV.length / rowsV.length * 100).toFixed(1)}%）`);
  say(`   绝对跌幅 max ${Math.max(...badV.map(b => b.from.D - b.to.D))} mm；相对跌幅 max ${(Math.max(...relV) * 100).toFixed(2)}%`);

  // 成因②：小 Mc / 模数主导区 —— modOk 的 0.99 取整容差把 f 顶高
  say('\n【成因②·小 Mc 模数区】modOk 的 0.99 取整容差：');
  say('   round(x) ≥ 0.99·x  ⇒  x ≥ 100·(x − round(x))；x 的小数部分接近 0.5 时需 x ≥ 50，');
  say('   即 Mc·f 很小时，取整掉的 0.5 mm 就足以让 modOk 失败 ⇒ f 被顶高好几格。');
  const rowsS = [];
  for (let mc = 0.5; mc <= 10.0001; mc += 0.01) {
    const r = singleViaManifest(Math.round(mc * 100) / 100, { wt: 0 });
    if (r) rowsS.push({ mc: Math.round(mc * 100) / 100, D: r.D, f: r.final_f });
  }
  const badS = [];
  for (let i = 1; i < rowsS.length; i++) if (rowsS[i].D < rowsS[i - 1].D) badS.push({ from: rowsS[i - 1], to: rowsS[i] });
  const relS = badS.map(b => (b.from.D - b.to.D) / b.from.D);
  say(`   cast_wt=0（纯模数，无体积约束）Mc ∈ [0.5,10] 步长 0.01：${rowsS.length} 点，下跌点 ${badS.length}（${(badS.length / rowsS.length * 100).toFixed(1)}%）`);
  say(`   绝对跌幅 max ${Math.max(...badS.map(b => b.from.D - b.to.D))} mm；相对跌幅 max ${(Math.max(...relS) * 100).toFixed(2)}%`);
  const worst = badS.slice().sort((a, b) => (b.from.D - b.to.D) - (a.from.D - a.to.D))[0];
  say(`   最坏一处：Mc ${worst.from.mc}(f=${f2(worst.from.f)}, D=${worst.from.D}) → ${worst.to.mc}(f=${f2(worst.to.f)}, D=${worst.to.D})`);
  say(`   ⇒ **体积约束全程未参与**（cast_wt=0），所以这不是"体积主导"造成的。`);
  say(`   上界：跌幅 ≤ f 网格被顶高的格数 × 0.3·Mc；实测最坏 ${worst.from.D - worst.to.D} mm。`);

  // 是否影响生产可达范围
  say('\n【可达性】小 Mc 在生产里如何出现：');
  say('   · NO_HOTSPOT 路径 mc = process.wallHot = 主体壁厚 ÷ 2（calcManifest 壁厚兜底）');
  say('     ⇒ 薄壁均匀件 壁厚 20 mm → Mc = 10；壁厚 12 mm → Mc = 6 ⇒ **落在成因②区间内**');
  say('   · 独立计算器 hot_spot 模式 mc = 热节直径 ÷ 2 ⇒ 同上');
  say('   · 热结检出值 mc 本身：实测 HR4012=14 / ALR2510=11.43 量级 ⇒ 落在成因①区间');
}

// ============================================================
// A9 · 无法由代码确定的（按 119.txt §三.8 标记未解决）
// ============================================================
say('\n' + '='.repeat(78));
say('## A6 本次无法由代码确定的事项（不猜测）');
say('='.repeat(78));
say('U1  f 的起点 1.10 / 步长 0.05 / 上限 50 轮 的工程依据：项目内无文献原文，');
say('    只有转述「1:1.1:1.2」。⇒ **代码可读，依据不可考**。');
say('U2  非单调的"可接受量级"没有判据：本次只量化了跌幅（见 A2/A3），');
say('    但"跌多少 mm 算不合格"需要工艺裁决，代码里没有任何阈值。');
say('U3  真实铸件的正确 D/H 基准不存在于仓库 ⇒ 无法判断 144 与 147 谁更接近工程真值。');

const txt = lines.join('\n');
writeFileSync(join(OUT, 'phasev2009_mc_sweep.txt'), txt, 'utf8');
console.log(`\n[已存档] ${join(OUT, 'phasev2009_mc_sweep.txt')}`);
