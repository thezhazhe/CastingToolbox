// ============================================================
// PHASE V2.0-16（127.txt §三 / §五）· **只读**核查脚本
//
//   A. 两个边界案例（mc=1.24 cyl / mc=1.10 sphere_head）的逐字段证据
//      —— 含"上一档为什么不过"的反事实复核，供正式裁决用。
//   B. `D_req`（体积所需直径）的公式核查
//      —— 解析式 / 与生产代码的一致性 / 各形状与 hd 的适用性 / 退化与极端输入。
//
//   ⚠ 本脚本**不修改任何生产代码**，也不改变任何数值口径：
//     所有生产量一律取自 `runRiser` 的真实返回值；解析式只用 `RISER_SHAPES` 的
//     公开 `M/V/DfromM` 复算，**不重写生产控制流**（V2.0-14 的镜像法本阶段不需要）。
//   ⚠ 基线来源：`tests/engineering-generated/phasev2012_c1_sweep.csv`
//     （修复前 = C′ 之前；sha256 0f8f940b287c1ce98ad6a15c4afc2df89e2d0a972a83c12aec29f8dba98b15cc）
//     本脚本只**读取**它，不写入。
//
//   用法: node tests/experiments/phasev2016_verify.mjs
//   输出: 控制台（可用 > tests/experiments/out/phasev2016_verify.log 留存）
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

/* ============================================================
 * A. 两个边界案例
 * ============================================================ */
const CASES = [
  { tag: 'A1', mc: 1.24, shape: 'cyl',         cw: 0.5, mat: '球铁', hd: 1.0, csvD: 26, csvH: 26, csvModOk: false, csvVolOk: false, csvBind: 'limit', csvConv: false },
  { tag: 'A2', mc: 1.10, shape: 'sphere_head', cw: 0.5, mat: '球铁', hd: 1.0, csvD: 23, csvH: 23, csvModOk: false, csvVolOk: false, csvBind: 'limit', csvConv: false },
];

/** 复算某个整数尺寸下的两条约束（只读：只用公开 V/M 与生产返回的 eff/needVol） */
function judge(sd, d, h, eff, needVol, Mr_need) {
  const Mr_act = (d > 0 && h > 0) ? sd.M(d, h) : 0;
  const Vr = sd.V(d, h);
  const effV = Vr * eff;
  const modOk = Mr_act >= Mr_need * 0.99;
  const volOk = needVol > 0 ? effV >= needVol : true;
  return { Mr_act, Vr, effV, modOk, volOk };
}

/** 生产 sizeAt 的 H 口径（与 riser.js:112-126 同规则，用于反事实复核） */
function hFor(shape, d, hd) {
  let h = Math.round(d * hd);
  if (shape === 'sphere_head') { const r = d / 2; if (h < r) h = Math.round(r); }
  if (shape === 'sphere') h = d;
  return h;
}

hr('A. 两个边界案例 —— 逐字段证据与反事实复核（127.txt §三）');

// 先从基线 CSV 读回"修复前"的真实行，避免把报告里的数字当成事实来源
const csvRows = new Map();
{
  const txt = readFileSync(CSV, 'utf8').split('\n');
  const head = txt[0].split(',');
  for (const line of txt.slice(1)) {
    if (!line) continue;
    const c = line.split(',');
    const key = `${(+c[0]).toFixed(2)}|${c[2]}|${(+c[3]).toFixed(2)}`;
    csvRows.set(key, Object.fromEntries(head.map((k, i) => [k, c[i]])));
  }
}
check('基线 CSV 可读', csvRows.size > 0, `${csvRows.size} 行`);

for (const c of CASES) {
  sub(`${c.tag}  mc=${c.mc}  ${c.shape}  cw=${c.cw}  mat=${c.mat}  hd=${c.hd}`);

  const r = runRiser({ mc_mode: 'direct', mc: c.mc, shape: c.shape, mat: c.mat, cast_wt: c.cw, hd_ratio: c.hd });
  const sd = RISER_SHAPES[c.shape];

  // —— 修复前（基线 CSV；本脚本只读）——
  const key = `${c.mc.toFixed(2)}|${c.shape}|${c.cw.toFixed(2)}`;
  const old = csvRows.get(key);
  check('基线 CSV 中可定位该案例', !!old, old ? `csv: D=${old.D} H=${old.H} f=${(+old.f).toFixed(2)} modOk=${old.modOk} volOk=${old.volOk} bind=${old.bind}` : '未找到');
  if (old) {
    console.log(`     修复前(CSV)  D=${old.D} H=${old.H}  f=${(+old.f).toFixed(2)}  Mr_act=${(+old.Mr_act).toFixed(6)}  Mr_need=${(+old.Mr_need).toFixed(6)}`);
    console.log(`                  Vr=${(+old.Vr).toFixed(4)}  effV=${(+old.effV).toFixed(4)}  modOk=${old.modOk} volOk=${old.volOk} bind=${old.bind} converged=${old.converged}`);
    check('  CSV 行与 127.txt 描述的输入条件一致', (+old.mc).toFixed(2) === c.mc.toFixed(2) && old.shape === c.shape && (+old.cw).toFixed(2) === c.cw.toFixed(2));
    check('  CSV 行确为"未收敛"', old.converged === 'false' && old.bind === 'limit', `converged=${old.converged} bind=${old.bind}`);
    check('  CSV 行确为"两条校核都不过"', old.modOk === 'false' && old.volOk === 'false');
  }

  // —— 修复后（当前生产）——
  console.log(`     修复后(生产) D=${r.D} H=${r.H}  f=${r.final_f.toFixed(2)}  Mr_act=${r.Mr_act.toFixed(6)}  Mr_need=${r.Mr_need.toFixed(6)}`);
  console.log(`                  Vr=${r.Vr.toFixed(4)}  effV=${r.effV.toFixed(4)}  modOk=${r.modOk} volOk=${r.volOk} bind=${r.bind} converged=${r.converged}`);
  check('★ 两条约束现在都通过', r.modOk === true && r.volOk === true);
  check('★ 状态为已收敛', r.converged === true);
  check('  归因不再是 limit', r.bind !== 'limit', `bind=${r.bind}`);
  check('  直径较修复前 +1mm', old ? r.D === +old.D + 1 : false, old ? `${old.D} → ${r.D}` : '');
  check('  高度较修复前 +1mm', old ? r.H === +old.H + 1 : false, old ? `${old.H} → ${r.H}` : '');
  check('  返回对象自洽：effV = Vr × eff', Math.abs(r.effV - r.Vr * r.eff) < 1e-9);
  check('  返回对象自洽：Vr = sd.V(D,H)', Math.abs(r.Vr - sd.V(r.D, r.H)) < 1e-9);
  check('  返回对象自洽：Mr_act = sd.M(D,H)', Math.abs(r.Mr_act - sd.M(r.D, r.H)) < 1e-12);
  check('  返回对象自洽：Mr_need = Mc × f', Math.abs(r.Mr_need - r.Mc * r.final_f) < 1e-12);

  // —— 反事实：D−1 到底为什么不过 ——
  const dPrev = r.D - 1, hPrev = hFor(c.shape, dPrev, r.hd);
  const prev = judge(sd, dPrev, hPrev, r.eff, r.needVol, r.Mr_need);
  console.log(`\n     反事实 D−1 = (${dPrev}, ${hPrev})：`);
  console.log(`       Mr_act=${prev.Mr_act.toFixed(6)}  阈值 0.99·Mr_need=${(0.99 * r.Mr_need).toFixed(6)}  ⇒ modOk=${prev.modOk}（差 ${((prev.Mr_act / (0.99 * r.Mr_need) - 1) * 100).toFixed(3)}%）`);
  console.log(`       effV  =${prev.effV.toFixed(4)}  阈值 needVol  =${r.needVol.toFixed(4)}  ⇒ volOk=${prev.volOk}（差 ${((prev.effV / r.needVol - 1) * 100).toFixed(3)}%）`);
  check('★ D−1 的模数校核**不过**（案例确实在边界上）', prev.modOk === false);
  check('★ D−1 的体积校核**不过**（案例确实在边界上）', prev.volOk === false);

  // —— 当前尺寸的裕度 ——
  const mMod = r.Mr_act / (0.99 * r.Mr_need) - 1, mVol = r.effV / r.needVol - 1;
  console.log(`\n     当前尺寸 (${r.D}, ${r.H}) 裕度：模数 +${(mMod * 100).toFixed(3)}%   体积 +${(mVol * 100).toFixed(3)}%`);

  // —— 最小可行整数：从 1 向上扫，找同时满足两条的最小 D ——
  let dmin = null;
  for (let d = 1; d <= r.D + 5; d++) {
    const h = hFor(c.shape, d, r.hd);
    const j = judge(sd, d, h, r.eff, r.needVol, r.Mr_need);
    if (j.modOk && j.volOk) { dmin = d; break; }
  }
  check('★ 当前 D 就是"同时满足两条的最小整数直径"', dmin === r.D, `最小可行=${dmin}，生产=${r.D}`);
  if (dmin === r.D && old && +old.D === r.D - 1) {
    console.log(`     ⇒ 修复前的 ${old.D} 才是"取整松弛"的那一档：它**不是**可行解，+1mm 是**必需**而非保守。`);
  }
}

/* ============================================================
 * B. D_req 公式核查
 * ============================================================ */
hr('B. D_req（体积所需直径）只读公式核查（127.txt §五）');

sub('B1 体积约束的完整公式与变量单位（源码逐项对照）');
{
  const r = runRiser({ mc_mode: 'direct', mc: 5, shape: 'cyl', mat: '球铁', cast_wt: 77.56, hd_ratio: 1.0 });
  const md = RISER_MATERIALS['球铁'];
  check('Vc = cw × 1e6 / rho  （cw: kg，rho: g/cm³ ⇒ Vc: mm³）',
    Math.abs(r.Vc - 77.56 * 1e6 / md.rho) < 1e-6, `Vc=${r.Vc.toFixed(3)} mm³`);
  check('needVol = Vc × shrink  （shrink 为体收缩率，无量纲）',
    Math.abs(r.needVol - r.Vc * md.shrink) < 1e-9, `needVol=${r.needVol.toFixed(3)} mm³`);
  check('eff 为**百分数/100**（cyl 默认 eff_open=14 ⇒ 0.14）',
    Math.abs(r.eff - RISER_EFF.eff_open / 100) < 1e-12, `eff=${r.eff}`);
  check('effV = Vr × eff  （冒口可提供的有效补缩体积，mm³）',
    Math.abs(r.effV - r.Vr * r.eff) < 1e-9);
  check('volOk ⟺ effV ≥ needVol（cw>0）；cw=0 时恒 true',
    r.volOk === (r.effV >= r.needVol), `effV=${r.effV.toFixed(1)} needVol=${r.needVol.toFixed(1)}`);
  const r0 = runRiser({ mc_mode: 'direct', mc: 5, shape: 'cyl', mat: '球铁', cast_wt: 0, hd_ratio: 1.0 });
  check('cw=0 ⇒ volOk 恒 true（体积约束**不存在**，D_req 无定义）', r0.volOk === true && r0.needVol === 0);
}

sub('B2 D_req 解析式的推导（逐步代数）');
{
  console.log(`
  目标：求使 effV ≥ needVol 成立的最小直径 D_req。
    effV = Vr(D,H) × eff        … 冒口体积 × 补缩效率
    H    = D × hd               … 高度系数定义（hd = H/D）
  ⇒ 冒口体积 Vr(D) 是 D 的三次齐次式：Vr = k(形状, hd) × D³
  ⇒ effV = eff × k × D³ ≥ needVol  ⟺  D ≥ ∛(needVol / (eff × k)) =: D_req
  ⇒ **D_req 与 Mc 无关**（只依赖 needVol、eff、形状与 hd）。`);
  const k = {
    cyl:         (hd) => Math.PI / 4 * hd,
    square:      (hd) => hd,
    sphere:      () => Math.PI / 6,
    sphere_head: (hd) => Math.PI * (3 * hd - 0.5) / 12,
  };
  console.log('\n  各形状的 k（Vr = k·D³）：\n     cyl         k = π·hd/4');
  console.log('     square      k = hd');
  console.log('     sphere      k = π/6                （H 恒 = D，与 hd 无关）');
  console.log('     sphere_head k = π(3·hd − 0.5)/12   （hd ≥ 0.5；hd < 0.5 退化为半球 k = π/12）');

  // 用公开 V() 反解 k，验证代数式
  const V = RISER_SHAPES;
  for (const [shape, kf] of Object.entries(k)) {
    let worst = 0, n = 0;
    for (const hd of [0.8, 1.0, 1.2, 1.5, 2.0]) {
      for (const D of [10, 23.5, 60, 144.7, 500]) {
        const H = hd * D;
        const got = V[shape].V(D, H) / (D ** 3);
        const exp = kf(hd);
        if (shape === 'sphere_head' && hd < 0.5) continue;
        if (shape === 'sphere') { const g = V.sphere.V(D, H) / D ** 3; worst = Math.max(worst, Math.abs(g - kf(hd)) / kf(hd)); n++; continue; }
        worst = Math.max(worst, Math.abs(got - exp) / exp); n++;
      }
    }
    check(`k(${shape}) 代数式与 sd.V 实测一致（${n} 点）`, worst < 1e-12, `最大相对偏差 ${worst.toExponential(2)}`);
  }

  // 143.91 的来历
  const Vc = 77.56 * 1e6 / 7.1, needVol = Vc * 0.03, eff = 0.14;
  const dreq = Math.cbrt(needVol / (eff * Math.PI / 4));
  console.log(`\n  夹具 143.91 的来历（cyl, hd=1, 球铁, cw=77.56kg）：
     Vc      = 77.56 × 1e6 / 7.1 = ${Vc.toFixed(3)} mm³
     needVol = Vc × 0.03         = ${needVol.toFixed(3)} mm³
     eff     = 14/100            = ${eff}
     k       = π×1/4             = ${(Math.PI / 4).toFixed(9)}
     D_req   = ∛(needVol/(eff·k)) = ${dreq.toFixed(4)} mm`);
  check('★ 复算 143.91mm', Math.abs(dreq - 143.91) < 0.01, `${dreq.toFixed(4)}`);

  // 与"生产返回值"交叉验证：把 D 设成 D_req 附近，看 volOk 翻转点
  const rLow = runRiser({ mc_mode: 'direct', mc: 5, shape: 'cyl', mat: '球铁', cast_wt: 77.56, hd_ratio: 1.0 });
  const effVat = (D) => V.cyl.V(D, D) * eff;
  let flip = null;
  for (let D = 140; D <= 150; D += 0.001) { if (effVat(D) >= needVol) { flip = D; break; } }
  check('★ effV≥needVol 的实测翻转点 = 解析 D_req（生产 eff/needVol 复算）',
    Math.abs(flip - dreq) < 0.002, `实测 ${flip.toFixed(4)} vs 解析 ${dreq.toFixed(4)}`);
  console.log(`     （生产在 Mc=5 时只能走到 D=${rLow.D}，f=${rLow.final_f.toFixed(2)}，converged=${rLow.converged}）`);
}

sub('B3 解析 D_req vs "含取整口径的最小可行整数"（各形状 × hd）');
{
  const rows = [];
  let worstGap = 0, worstAt = '';
  for (const shape of ['cyl', 'square', 'sphere', 'sphere_head']) {
    for (const hd of [0.8, 1.0, 1.2, 1.5]) {
      for (const cw of [0.5, 5, 77.56, 200]) {
        const r = runRiser({ mc_mode: 'direct', mc: 5, shape, mat: '球铁', cast_wt: cw, hd_ratio: hd });
        const sd = RISER_SHAPES[shape];
        const kf = { cyl: Math.PI / 4 * hd, square: hd, sphere: Math.PI / 6, sphere_head: Math.PI * (3 * hd - 0.5) / 12 }[shape];
        const dreq = Math.cbrt(r.needVol / (r.eff * kf));
        // 含取整口径的最小可行整数（H 按生产规则取整）
        let dmin = null;
        for (let d = 1; d <= 2000; d++) {
          const h = hFor(shape, d, hd);
          if (sd.V(d, h) * r.eff >= r.needVol) { dmin = d; break; }
        }
        const gap = dmin - dreq;
        if (gap > worstGap) { worstGap = gap; worstAt = `${shape} hd=${hd} cw=${cw}`; }
        rows.push({ shape, hd, cw, dreq, ceilD: Math.ceil(dreq), dmin, gap });
      }
    }
  }
  console.log('   shape        hd    cw       D_req(解析)  ceil    取整口径最小整数  差');
  for (const x of rows) {
    console.log(`   ${x.shape.padEnd(12)} ${String(x.hd).padEnd(5)} ${String(x.cw).padEnd(8)} ${x.dreq.toFixed(3).padStart(10)} ${String(x.ceilD).padStart(6)} ${String(x.dmin).padStart(14)} ${(x.dmin - x.ceilD).toString().padStart(4)}`);
  }
  const exact = rows.filter((x) => x.dmin === x.ceilD).length;
  const gaps = rows.map((x) => x.dmin - x.ceilD);
  const maxAbs = Math.max(...gaps.map(Math.abs));
  const hist = {};
  for (const g of gaps) hist[g] = (hist[g] || 0) + 1;
  check('取整口径最小整数与 ceil(D_req) 的偏差 ≤ 1mm（D_req 只作下界参考）', maxAbs <= 1,
    `${exact}/${rows.length} 完全相等；偏差分布 ${JSON.stringify(hist)}`);
  const negs = rows.filter((x) => x.dmin < x.ceilD);
  for (const x of negs) {
    const h = hFor(x.shape, x.dmin, x.hd);
    console.log(`     · ${x.shape} hd=${x.hd} cw=${x.cw}：D_req=${x.dreq.toFixed(3)} → ceil=${x.ceilD}，但取整口径下 D=${x.dmin} 就够`);
    console.log(`       原因：H=round(${x.dmin}×${x.hd})=${h} **向上取整**，实际体积大于 D·hd 的理想值 ⇒ 比 ceil(D_req) 少 1mm 也能过。`);
  }
  console.log(`\n     ⇒ D_req 是**连续解**；真实可用直径还要叠加 H 的取整（以及 sphere_head 的 H≥r 修正），`);
  console.log(`       取整方向**可上可下** ⇒ D_req 只能当作"下界参考"，不是"该用多大"的最终答案。`);
}

sub('B4 D_req 与现有 D、H、f 的关系（为什么"抬 f 上限"救不了）');
{
  console.log('  形状 cyl（hd=1）：DfromM(Mr) = 6·Mr ⇒ 模数路径给出 D ≈ 6·Mc·f');
  console.log('  体积路径要求 D ≥ D_req（与 Mc 无关）');
  console.log('  ⇒ 两条同时满足要求  6·Mc·f ≥ D_req  ⇒  **f_req = D_req / (6·Mc) ∝ 1/Mc**\n');
  const D_req = Math.cbrt((77.56e6 / 7.1 * 0.03) / (0.14 * Math.PI / 4));
  console.log('    Mc      f_req = D_req/(6·Mc)   需要的档数 N = (f_req−1.10)/0.05 + 1   生产上限 50 (f≤3.55)');
  for (const Mc of [0.5, 1, 2, 5, 10, 20, 30, 50]) {
    const fr = D_req / (6 * Mc);
    const N = Math.ceil((fr - 1.10) / 0.05) + 1;
    console.log(`   ${String(Mc).padEnd(7)} ${fr.toFixed(3).padStart(14)} ${String(N).padStart(26)}   ${fr <= 3.55 ? '可达' : '★不可达'}`);
  }
  const small = D_req / (6 * 0.5), big = D_req / (6 * 50);
  check('★ f_req 随 Mc 减小而发散（抬上限对小 Mc 永远不够）', small > big * 50, `Mc=0.5 ⇒ ${small.toFixed(1)}；Mc=50 ⇒ ${big.toFixed(3)}`);

  // D_req 与 Mc 无关：固定 cw/形状/hd，扫 Mc ⇒ needVol（因而 D_req）必须逐位不变
  const dOf = (rr) => Math.cbrt(rr.needVol / (rr.eff * Math.PI / 4));
  const base = runRiser({ mc_mode: 'direct', mc: 1, shape: 'cyl', cast_wt: 0.5, hd_ratio: 1 });
  let sameD = true, mcsDiffer = [];
  for (const Mc of [0.5, 1, 2, 5, 20, 99]) {
    const rr = runRiser({ mc_mode: 'direct', mc: Mc, shape: 'cyl', cast_wt: 0.5, hd_ratio: 1 });
    if (Math.abs(dOf(rr) - dOf(base)) > 1e-12) { sameD = false; mcsDiffer.push(Mc); }
  }
  check('★ D_req 与 Mc 无关（固定 cw/形状/hd 扫 Mc，D_req 逐位不变）', sameD,
    `D_req = ${dOf(base).toFixed(4)}mm；偏离的 Mc = ${mcsDiffer.length ? mcsDiffer.join(',') : '无'}`);
  const cwBig = runRiser({ mc_mode: 'direct', mc: 1, shape: 'cyl', cast_wt: 200, hd_ratio: 1 });
  check('反例：D_req **确实**随 cw 变化（200kg ⇒ 更大）', dOf(cwBig) > dOf(base) * 5,
    `0.5kg ⇒ ${dOf(base).toFixed(2)}mm；200kg ⇒ ${dOf(cwBig).toFixed(2)}mm`);
}

sub('B5 适用条件、退化与极端输入（127.txt §五.9）');
{
  // (1) cw = 0 ⇒ 体积约束不存在
  const z = runRiser({ mc_mode: 'direct', mc: 5, shape: 'cyl', cast_wt: 0, hd_ratio: 1 });
  check('cw=0 ⇒ needVol=0 ⇒ D_req=0，体积约束不参与（volOk 恒 true）', z.needVol === 0 && z.volOk === true);

  // (2) Mc ≤ 0 ⇒ 无结果
  check('Mc=0 ⇒ runRiser 返回 null（无 D_req 可言）', runRiser({ mc_mode: 'direct', mc: 0, shape: 'cyl', cast_wt: 5 }) === null);
  check('Mc<0 ⇒ null', runRiser({ mc_mode: 'direct', mc: -3, shape: 'cyl', cast_wt: 5 }) === null);

  // (3) 未知形状 ⇒ null（V2.0-15 才真正成立；此处只读复核）
  let threw = false, res = 'NONE';
  try { res = runRiser({ mc_mode: 'direct', mc: 5, shape: 'hexagon', cast_wt: 5 }); } catch (e) { threw = true; }
  check('★ 未知形状返回 null 而**不是抛异常**（V2.0-15 修复的契约）', !threw && res === null, threw ? '抛异常' : String(res));

  // (4) sphere_head 在 hd<0.5 的退化：H 被抬到 r ⇒ 实际 hd_effective = 0.5
  const sh = runRiser({ mc_mode: 'direct', mc: 5, shape: 'sphere_head', cast_wt: 5, hd_ratio: 0.2 });
  check('sphere_head hd=0.2 ⇒ H 被抬到 ≥r（实际 hd 变成 ~0.5）', sh && sh.H >= sh.D / 2 - 0.5, sh ? `D=${sh.D} H=${sh.H} 实际 hd=${(sh.H / sh.D).toFixed(3)}` : '');
  console.log(`     ⇒ 此时 k = π/12（半球），**不能**用 π(3·0.2−0.5)/12 = π/120 的解析式（会低估体积、虚高 D_req）。`);
  const kBad = Math.PI * (3 * 0.2 - 0.5) / 12, kGood = Math.PI / 12;
  check('★ hd<0.5 时解析式失效（k 变号/严重偏小）', kBad < kGood * 0.5, `k(0.2)=${kBad.toFixed(6)} vs 真实 k=${kGood.toFixed(6)}`);

  // (5) 取整口径：H=round(D·hd) 不是 D·hd
  const hd12 = runRiser({ mc_mode: 'direct', mc: 6, shape: 'cyl', cast_wt: 5, hd_ratio: 1.2 });
  check('H 按 round(D·hd) 取整（非精确 D·hd）', hd12.H === Math.round(hd12.D * 1.2), `D=${hd12.D} H=${hd12.H}（D×1.2=${(hd12.D * 1.2).toFixed(2)}）`);

  // (6) eff 显式覆盖
  const e35 = runRiser({ mc_mode: 'direct', mc: 5, shape: 'cyl', cast_wt: 77.56, hd_ratio: 1, eff: 35 });
  const dreq35 = Math.cbrt((77.56e6 / 7.1 * 0.03) / (0.35 * Math.PI / 4));
  check('eff 可显式覆盖（发热保温 35% ⇒ D_req 显著变小）', Math.abs(e35.eff - 0.35) < 1e-12,
    `D_req(14%)=143.91 → D_req(35%)=${dreq35.toFixed(2)}`);

  // (7) 极端：极大 cw ⇒ D_req 可能超出任何现实尺寸
  const huge = Math.cbrt((1e6 * 1e6 / 7.1 * 0.03) / (0.14 * Math.PI / 4));   // cw = 1000 t = 1e6 kg
  console.log(`     极端推算：cw=1000t 时 D_req = ${huge.toFixed(0)} mm（远超 f 上限可达范围，算法必然 limit）`);
  check('★ 极端 cw 下 D_req 无上界（数值本身不发散，但工程上不可实现）', huge > 1000);

  // (8) 数值精度：D_req 三次根对小 needVol 无精度问题
  let worstRel = 0;
  for (const nv of [1e-6, 1e-3, 1, 1e3, 1e6, 1e9]) {
    const d = Math.cbrt(nv / (0.14 * Math.PI / 4));
    worstRel = Math.max(worstRel, Math.abs(d ** 3 * 0.14 * Math.PI / 4 - nv) / nv);
  }
  check('三次根往返无显著精度损失（needVol 跨 15 个数量级）', worstRel < 1e-12, `最大相对误差 ${worstRel.toExponential(2)}`);
}

sub('B6 D_req "能说明什么 / 不能说明什么"');
{
  console.log(`
  能说明（可被代码与算式证实）：
    · 在"effV ≥ needVol 且 Vr = k·D³"这套模型内，体积约束**有唯一解**，且解与 Mc 无关。
    · 撞 f 上限时，当前 D 距"体积上够用的直径"差多少 ⇒ 用户能判断"加大冒口是否现实"。
    · f_req ∝ 1/Mc ⇒ 单纯抬高 f 上限不是正确方向（方向性结论）。

  不能说明（本阶段无法从代码回答）：
    · D_req 是否等于"真实能补缩的直径" —— 取决于 RISER_EFF（14/20/25/35%）这套
      经验补缩效率与真实冒口的对应关系，**代码里没有任何实测标定**。
    · 缩孔是否真的不会发生 —— 体积守恒只是必要条件，不含温度梯度、冒口位置、
      浇注温度、砂型/金属型、冷铁等真实因素。
    · needVol = Vc × shrink 用**体收缩率**近似"整件补缩量"是否成立 —— 实际补缩量
      与热节位置、凝固顺序有关，不是铸件总收缩量的线性函数。`);
  check('（以上为文字结论，无断言）', true);
}

console.log('\n' + '═'.repeat(78));
console.log(`PHASE V2.0-16 只读核查：${FAIL === 0 ? '全部断言通过 ✅' : FAIL + ' 项断言失败 ❌'}`);
console.log('═'.repeat(78));
process.exit(FAIL ? 1 : 0);
