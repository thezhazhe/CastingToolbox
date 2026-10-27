// S3.1 只读审计探针：走真实生产入口，输出证据表（不改任何项目文件）
import { runRiser, RISER_SHAPES, RISER_EFF, MODULUS_TARGET_RATIO } from '../calcs/riser.js';
import { runGating } from '../calcs/gating.js';
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { buildYieldLedger } from '../js/views/yieldLedger.js';

const shapes = ['cyl', 'sphere_head', 'sphere', 'square'];
const MAT = '球铁';
const CW = 77.56;
const MC = 11.43;

const n = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number((v * 100).toFixed(1)) : v);

console.log('=== A. 四形状（runRiser 直接入口；球铁 / cw=77.56 / Mc=11.43 / hd=1）===');
const rowsA = shapes.map(shape => {
  const r = runRiser({ mat: MAT, cast_wt: CW, mc_mode: 'direct', mc: MC, shape, hd_ratio: 1.0 });
  return {
    shape, name: r.sd.name, D: r.D, H: r.H, hd: n(r.H / r.D), Mr_target: n(r.Mr_target, 3), Mr_act: n(r.Mr_act, 3),
    ratio: n(r.Mr_act / r.Mc, 4), Vr_cm3: n(r.Vr / 1000, 1), eff_pct: pct(r.eff), effV_cm3: n(r.effV / 1000, 1),
    needVol_cm3: n(r.needVol / 1000, 1), volOk: r.volOk, modOk: r.modOk, bind: r.bind, label: r.sd.label(r.D, r.H),
  };
});
console.table(rowsA);

console.log('\n=== B. 目标模数/体积约束对尺寸的影响（同 Mc，改变铸件重量）===');
const rowsB = [];
for (const shape of shapes) {
  const light = runRiser({ mat: MAT, cast_wt: 0.001, mc_mode: 'direct', mc: MC, shape, hd_ratio: 1.0 });
  const heavy = runRiser({ mat: MAT, cast_wt: 20000, mc_mode: 'direct', mc: MC, shape, hd_ratio: 1.0 });
  rowsB.push({ shape, D_light: light.D, D_heavy: heavy.D, H_light: light.H, H_heavy: heavy.H,
    Vr_same: light.Vr === heavy.Vr, volOk_light: light.volOk, volOk_heavy: heavy.volOk,
    Mr_target_same: light.Mr_target === heavy.Mr_target });
}
console.table(rowsB);

console.log('\n=== C. 最终尺寸 vs 仅按模数连续解（D 是否被额外放大）===');
const rowsC = shapes.map(shape => {
  const r = runRiser({ mat: MAT, cast_wt: CW, mc_mode: 'direct', mc: MC, shape, hd_ratio: 1.0 });
  return { shape, Mr_target: n(r.Mr_target, 3), dModOnly: r.dModOnly, D_final: r.D, plus_mm: r.D - r.dModOnly,
    modOk: r.modOk, volOk: r.volOk };
});
console.table(rowsC);

console.log('\n=== D. 设计中心真实调用链（CALC_MANIFEST.riser.calculate）===');
function seedRiser(shape) {
  proj.reset();
  proj.set('material.family', MAT);
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', CW, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', CW, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, mc: MC }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', MC, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('process.riserShape', shape, SRC.USER_INPUT, CONF.USER_CONFIRMED);
}
const rowsD = shapes.map(shape => {
  seedRiser(shape);
  const r = getCalcManifest('riser').calculate({});
  return { shape, shapeKey: r.shapeKey, D: r.D, H: r.H, hd: n(r.hd), Mr_target: n(r.Mr_target, 3),
    Vr_cm3: n(r.Vr / 1000, 1), eff_pct: pct(r.eff), volOk: r.volOk, level: r.level };
});
console.table(rowsD);

console.log('\n=== E. 一模 1/2/4 件：设计中心 gating → riser → yield 真实数据流 ===');
function seedAll(cav) {
  proj.reset();
  proj.set('material.family', MAT);
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.liquidDensity', 6.9, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.yieldSug', 65, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 20, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 20, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('process.wallUsed', 10, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.cavities', cav, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.line', '水平线', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.pourPos', '顶注', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.Ho', 150, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.ph', 100, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.riserHeight', 80, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.riserShape', 'cyl', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, mc: 8 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', 8, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
}
const rowsE = [];
for (const cav of [1, 2, 4]) {
  seedAll(cav);
  const g = getCalcManifest('gating').calculate({});
  const r = getCalcManifest('riser').calculate({});
  const results = { gating: g, riser: r };
  const y = getCalcManifest('yield').calculate(results);
  const ledger = buildYieldLedger({ cav: g.cav, blankWt: g.pw, pourWt: g.G, riserWt: y.riserWt, designYield: g.yv });
  rowsE.push({
    cav, castingMass_kg: n(g.castingMass, 2), G_kg: n(g.G, 2), gating_ya_pct: n(g.ya, 2), design_yv_pct: g.yv,
    yield_castWt_kg: n(y.castWt, 2), yield_pourWt_kg: n(y.pourWt, 2), yield_runnerWt_kg: n(y.runnerWt, 2),
    yield_riserWt_kg: n(y.riserWt, 3), ledger_blankTotal: n(ledger.blankTotal, 2), ledger_delta: n(ledger.delta, 2),
    ledger_riserTotal: n(ledger.riserTotal, 3), ledger_gatingEst: n(ledger.gatingEst, 3),
    old_page_yield_pct: n(y.castWt / y.pourWt * 100, 2),
  });
}
console.table(rowsE);

console.log('\n=== F. RH 对 Hp / 阻流面积 / 直浇道直径的真实影响（runGating）===');
const rowsF = [];
for (const pos of ['顶注', '中注', '底注']) {
  for (const rh of [0, 50, 100, 200, 400]) {
    const g = runGating({
      mat: '球铁(QT)', pw: 20, cav: 1, yr: 65, wall: 10, pos, Ho: 150, ph: 100, rh,
      ratioKey: '开放式 标准型', gc: 2, gt: 3, rc: 2, rt: 25,
    });
    rowsF.push({ pos, rh, Cmm: n(g.Cmm, 1), Hp: n(g.Hp, 1), A: n(g.A, 1), D_sp: g.D_sp, t: n(g.t, 3) });
  }
}
console.table(rowsF);

console.log('\n=== G. 独立计算器 H/D 选项对各形状的实际作用（Mc=11.43 / cw=77.56）===');
const rowsG = [];
for (const shape of shapes) {
  for (const hd of [0.8, 1.0, 1.2, 1.5]) {
    const r = runRiser({ mat: MAT, cast_wt: CW, mc_mode: 'direct', mc: MC, shape, hd_ratio: hd });
    rowsG.push({ shape, hd_in: hd, D: r.D, H: r.H, H_over_D: n(r.H / r.D, 3), Vr_cm3: n(r.Vr / 1000, 1), effect: RISER_EFF[r.sd.effKey] + '%' });
  }
}
console.table(rowsG);

console.log('\n=== H. 形状几何定义自检（D/H 与 Vr/eff 的对应）===');
const rowsH = shapes.map(shape => {
  const r = runRiser({ mat: MAT, cast_wt: CW, mc_mode: 'direct', mc: MC, shape, hd_ratio: 1.0 });
  return { shape, formula: r.sd.formula, label: r.sd.label(r.D, r.H), Vr_cm3: n(r.Vr / 1000, 1), eff: r.sd.effKey + '=' + RISER_EFF[r.sd.effKey] + '%',
    M_check: n(r.sd.M(r.D, r.H), 4), Mr_act: n(r.Mr_act, 4), same: Math.abs(r.sd.M(r.D, r.H) - r.Mr_act) < 1e-12 };
});
console.table(rowsH);

console.log('\n=== I. 常量核对 ===');
console.log({ MODULUS_TARGET_RATIO, shapes, note: '设计中心 calcManifest 固定 hd_ratio=1.0' });
