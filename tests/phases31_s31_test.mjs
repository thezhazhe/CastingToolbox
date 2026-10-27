// ============================================================
// R6-S3.1（154.txt）· 计算可信度 / RH / 展示口径 / 报告一致性
//   证据一律走真实生产入口：runRiser / runGating / CALC_MANIFEST / buildWorkflowReport。
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { runRiser, RISER_SHAPES, MODULUS_TARGET_RATIO } from '../calcs/riser.js';
import { runGating } from '../calcs/gating.js';
import { getCalcManifest } from '../calcs/calcManifest.js';
import { buildYieldLedger } from '../js/views/yieldLedger.js';
import { buildWorkflowReport } from '../js/views/reportGenerator.js';
import { riserItemFacts, gatingFacts, rhInfo, gatingValidity, collectRisks } from '../js/views/resultFacts.js';

const assert = (c, m) => { if (!c) throw new Error(m); };
const same = (a, b, m) => { if (a !== b) throw new Error(`${m}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); };
const near = (a, b, t, m) => { if (!(Math.abs(a - b) <= t)) throw new Error(`${m}（期望 ${b}±${t}，实际 ${a}）`); };
const fmt = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? parseFloat(v.toFixed(d)).toString() : '—');
const SHAPES = ['cyl', 'sphere_head', 'sphere', 'square'];

function seedAll(cav = 1, o = {}) {
  proj.reset();
  proj.set('material.family', '球铁');
  proj.set('material.solidDensity', 7.1, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.liquidDensity', 6.9, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.yieldSug', 65, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 20, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 20, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
  proj.set('process.wallUsed', 10, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.cavities', cav, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.line', '水平线', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.method', '砂型 · 机器造型/壳型', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.pourPos', o.pos || '顶注', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.Ho', 150, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.ph', 100, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  if (o.rh != null) proj.set('process.riserHeight', o.rh, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.riserShape', o.shape || 'cyl', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, mc: o.mc || 8 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.mcHotspot', o.mc || 8, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
}
function calcAll() {
  const g = getCalcManifest('gating').calculate({});
  const r = getCalcManifest('riser').calculate({});
  const y = getCalcManifest('yield').calculate({ gating: g, riser: r });
  return { g, r, y, results: { gating: g, riser: r, yield: y } };
}

export const tests = [
  {
    name: 'S3.1-A1 四形状：D/H 相同是 hd=1 几何必然；Vr/效率不同；Mr_target=1.2Mc',
    fn: () => {
      const rows = SHAPES.map(shape => runRiser({
        mat: '球铁', cast_wt: 77.56, mc_mode: 'direct', mc: 11.43, shape, hd_ratio: 1.0,
      }));
      same(MODULUS_TARGET_RATIO, 1.2, '目标模数比常量');
      for (const r of rows) {
        near(r.Mr_target, 11.43 * 1.2, 1e-12, `${r.shapeKey} 的 Mr_target`);
        same(r.D, 83, `${r.shapeKey} 的 D`);
        same(r.H, 83, `${r.shapeKey} 的 H`);
        assert(r.modOk === true, `${r.shapeKey} 的尺寸必须达到目标模数`);
        assert(RISER_SHAPES[r.shapeKey], '形状键必须存在');
      }
      assert(rows[0].Vr !== rows[1].Vr && rows[1].Vr !== rows[2].Vr && rows[2].Vr !== rows[3].Vr,
        '四形状 Vr 必须不同（形状确实参与几何）');
      same(rows[0].eff, 0.14, 'cyl 效率 14%');
      same(rows[1].eff, 0.25, 'sphere_head 效率 25%');
      same(rows[2].eff, 0.20, 'sphere 效率 20%');
      same(rows[3].eff, 0.14, 'square 效率 14%');
    },
  },
  {
    name: 'S3.1-A2 体积/整件净重不再决定尺寸；旧体积参考可不足',
    fn: () => {
      const light = runRiser({ mat: '球铁', cast_wt: 0.001, mc_mode: 'direct', mc: 11.43, shape: 'cyl', hd_ratio: 1.0 });
      const heavy = runRiser({ mat: '球铁', cast_wt: 20000, mc_mode: 'direct', mc: 11.43, shape: 'cyl', hd_ratio: 1.0 });
      same(light.D, heavy.D, '尺寸不得随铸件重量改变');
      same(light.H, heavy.H, 'H 不得随铸件重量改变');
      same(light.Vr, heavy.Vr, 'Vr 不得随铸件重量改变');
      same(light.volOk, true, '轻件旧体积参考通过');
      same(heavy.volOk, false, '重件旧体积参考不足（这是诊断值，不参与定尺寸）');
      assert(heavy.bind === 'modulus', '尺寸归因必须是 modulus');
    },
  },
  {
    name: 'S3.1-A3 球形只有一个尺寸自由度；结果事实不再把 H 当第二尺寸',
    fn: () => {
      const seed = (shape) => {
        proj.reset();
        proj.set('material.family', '球铁');
        proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
        proj.set('geometry.netWeightKg', 77.56, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
        proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
        proj.set('hotspots.items', [{ id: 1, mc: 11.43 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
        proj.set('process.mcHotspot', 11.43, SRC.USER_OVERRIDE, CONF.USER_CONFIRMED);
        proj.set('process.riserShape', shape, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        return getCalcManifest('riser').calculate({});
      };
      const sphere = riserItemFacts(seed('sphere'));
      same(sphere.dimensions.length, 1, '球形只输出一个尺寸字段');
      same(sphere.dimensions[0].key, 'D', '球形尺寸字段 = 球径');
      assert(sphere.D === sphere.H, '球形 H ≡ D（引擎几何约束）');
      const cyl = riserItemFacts(seed('cyl'));
      same(cyl.dimensions.length, 2, '圆柱输出 D/H 两个尺寸字段');
      const head = riserItemFacts(seed('sphere_head'));
      same(head.dimensions.length, 3, '球顶圆柱额外输出球顶半径 R');
    },
  },
  {
    name: 'S3.1-A4 设计中心真实入口：形状确实传入 runRiser；不再自动回写 RH',
    fn: () => {
      seedAll(1, { shape: 'sphere' });
      const r = getCalcManifest('riser').calculate({});
      same(r.shapeKey, 'sphere', 'manifest 必须把 process.riserShape 传给 runRiser');
      const dc = (awaitRead('js/views/designCenter.js')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
      assert(!/proj\.setResult\('process\.riserHeight', r\.H\)/.test(dc), 'designCenter 仍会自动回写 RH');
    },
  },
  {
    name: 'S3.1-B1 一模 1/2/4 件：设计中心 G/ya/castWt/runnerWt/riserWt 的真实口径',
    fn: () => {
      const rows = [1, 2, 4].map(cav => {
        seedAll(cav);
        const { g, y } = calcAll();
        const ledger = buildYieldLedger({ cav: g.cav, blankWt: g.pw, pourWt: g.G, riserWt: y.riserWt, designYield: g.yv });
        return { cav, g, y, ledger };
      });
      for (const { cav, g, y, ledger } of rows) {
        near(g.castingMass, 20 * cav, 1e-12, `cav=${cav} 的 W_c = 单件 × 型腔数`);
        near(g.ya, 65, 1e-12, `cav=${cav} 的设计出品率恒等于输入值`);
        near(y.castWt, 20, 1e-12, `cav=${cav} 的 yield.castWt 仍是单件`);
        near(y.pourWt, g.G, 1e-12, `cav=${cav} 的 yield.pourWt = G`);
        near(y.runnerWt, g.G - 20, 1e-12, `cav=${cav} 的 runnerWt 仍是 G − 单件（已知核心缺陷）`);
        near(ledger.blankTotal, 20 * cav, 1e-12, `cav=${cav} 的整模铸件重`);
        near(ledger.riserTotal, y.riserWt * cav, 1e-12, `cav=${cav} 的整模冒口重`);
        near(ledger.gatingEst, ledger.delta - ledger.riserTotal, 1e-12, `cav=${cav} 的浇道反推`);
        same(ledger.finalYield, null, '最终实重出品率不能由现有核心给出');
      }
      near(rows[0].y.castWt / rows[0].y.pourWt * 100, 65, 1e-9, '旧口径 1 腔 65%');
      near(rows[1].y.castWt / rows[1].y.pourWt * 100, 32.5, 1e-9, '旧口径 2 腔 32.5%');
      near(rows[2].y.castWt / rows[2].y.pourWt * 100, 16.25, 1e-9, '旧口径 4 腔 16.25%');
    },
  },
  {
    name: 'S3.1-B2 gatingFacts：三段数量/尺寸/面积与 runGating 输出逐项一致',
    fn: () => {
      seedAll(2);
      const { g, results } = calcAll();
      const f = gatingFacts(g, results);
      same(f.areas[0].diameter, g.D_sp, '直浇道直径');
      same(f.areas[0].area, g.Fs_act, '直浇道面积');
      same(f.areas[1].count, g.rc, '横浇道条数');
      same(f.areas[1].length, g.L_r, '横浇道长度');
      same(f.areas[1].area, g.Fr_act, '横浇道面积');
      same(f.areas[2].count, g.gc, '内浇道个数');
      same(f.areas[2].length, g.L_g, '内浇道长度');
      same(f.areas[2].area, g.Fg, '内浇道面积');
      same(f.vent.count, g.ventN, '排气孔数');
      same(f.vent.ratio, g.vr, '排气面积比');
      same(f.ledger.cav, 2, '整模账目型腔数');
      assert(f.validity.ok, '正常 RH 组合的浇注结果应有效');
    },
  },
  {
    name: 'S3.1-B3 RH：旧 CALC_RESULT 迁移清除；用户 RH 换 STL 保留；唯一来源',
    fn: () => {
      const base = proj.defaultProject();
      base.process.riserHeight = { v: 88, src: SRC.CALC_RESULT, conf: CONF.HIGH, editable: true };
      const migrated = proj.migrateProject(base);
      same(migrated.process.riserHeight.v, 0, '旧自动 H 必须被清除');
      same(migrated.process.riserHeight.src, SRC.DEFAULT, '旧自动 H 来源改为 DEFAULT');

      const base2 = proj.defaultProject();
      base2.process.riserHeight = { v: 88, src: SRC.USER_INPUT, conf: CONF.USER_CONFIRMED, editable: true };
      const migrated2 = proj.migrateProject(base2);
      same(migrated2.process.riserHeight.v, 88, '用户 RH 必须保留');
      same(migrated2.process.riserHeight.src, SRC.USER_INPUT, '用户 RH 来源必须保留');

      seedAll(1, { rh: 222 });
      const cleared = proj.clearStlBoundData();
      const after = proj.get('process.riserHeight');
      same(after.v, 222, '换 STL 后用户 RH 值保留');
      same(after.src, SRC.USER_INPUT, '换 STL 后用户 RH 来源保留');
      assert(cleared.length > 0, '测试有效性：clearStlBoundData 确实清理了 STL 绑定数据');
    },
  },
  {
    name: 'S3.1-B4 RH 对 Hp/阻流面积真实有影响；底注不随 RH 变；Hp≤0 被判无效',
    fn: () => {
      const run = (pos, rh) => runGating({
        mat: '球铁(QT)', pw: 20, cav: 1, yr: 65, wall: 10, pos, Ho: 150, ph: 100, rh,
        ratioKey: '开放式 标准型', gc: 2, gt: 3, rc: 2, rt: 25,
      });
      const top0 = run('顶注', 0), top200 = run('顶注', 200);
      assert(top0.Hp > top200.Hp, '顶注 Hp 必须随 RH 增大而下降');
      assert(top200.A > top0.A, '顶注阻流面积必须随 RH 增大而增大');
      const mid0 = run('中注', 0), mid200 = run('中注', 200);
      assert(mid0.Hp > mid200.Hp, '中注 Hp 必须随 RH 增大而下降');
      assert(mid200.A > mid0.A, '中注阻流面积必须随 RH 增大而增大');
      const bot0 = run('底注', 0), bot200 = run('底注', 200);
      near(bot0.Hp, bot200.Hp, 1e-12, '底注 Hp 现有公式不随 RH 变化');
      near(bot0.A, bot200.A, 1e-12, '底注 A 现有公式不随 RH 变化');
      const bad = run('中注', 400);
      assert(bad.Hp <= 0, '中注 RH=400 应触发 Hp≤0');
      const v = gatingValidity(bad);
      same(v.ok, false, 'Hp≤0 必须判为无效');
      same(v.level, 'P0', 'Hp≤0 是 P0');
      const risks = collectRisks({ gating: bad }, {});
      assert(risks.some(x => x.code === 'gating_hp_invalid' && x.level === 'P0'), '风险列表必须含 Hp≤0 的 P0');
    },
  },
  {
    name: 'S5-01/02/04 主界面风险：旧体积/自动 Mc/最终出品率不再进入 P1；RH 未指定仍提示',
    fn: () => {
      seedAll(1);
      const { results } = calcAll();
      const risks = collectRisks(results, {});
      const codes = risks.map(x => x.code);
      assert(!codes.includes('riser_volume_reference_short'), '旧体积参考不足不得再作为风险提示');
      assert(!codes.includes('final_yield_unavailable'), '工具推算的实际出品率不再展示，也不得作为风险提示');
      assert(!codes.includes('riser_mc_auto_review'), 'Mc 估计值说明改为冒口结果底部普通文字，不进入风险条');
      assert(codes.includes('rh_not_user_specified'), 'RH 未指定仍需提示');
      same(new Set(codes).size, codes.length, '风险 code 不得重复');
      seedAll(1, { rh: 222 });
      const r2 = collectRisks(calcAll().results, {});
      assert(!r2.some(x => x.code === 'rh_not_user_specified'), '用户指定 RH 后不得再提示未指定');
    },
  },
  {
    name: 'S3.1-C1 报告与结果页同源：状态、RH、三段、整模账目、风险、实际出品率回算说明',
    fn: () => {
      seedAll(2);
      const { g, r, results } = calcAll();
      const status = { k: 'ok', cls: '', text: '✓ 当前结果有效' };
      const html = buildWorkflowReport(results, { status, fileName: 's31.stl' });
      assert(!html.includes('undefined') && !html.includes('NaN'), '报告不得出现 undefined/NaN');
      for (const key of ['0. 结果有效性', '✓ 当前结果有效', '3.5 铸件结构性检查',
        'RH（冒口顶面高出铸件顶面）', '直浇道 S', '横浇道 R', '内浇道 G',
        '整模重量口径与出品率', '当前为工艺预估值',
        '单件 × 型腔数 ÷ 预估出品率', '待复核 / 风险']) {
        assert(html.includes(key), `报告缺少：${key}`);
      }
      assert(!html.includes('最终实重出品率'), '报告不得再展示工具推算的实际出品率');
      assert(!html.includes('暂不能给出'), '报告不应保留“最终实重出品率暂不能给出”的占位展示');
      const f = gatingFacts(g, results);
      assert(html.includes(`⌀${fmt(f.areas[0].diameter, 0)} mm`), '报告直浇道直径与 gatingFacts 不一致');
      assert(html.includes(fmt(f.ledger.pourWt, 2) + ' kg'), '报告整模浇注重量与 gatingFacts 不一致');
      assert(html.includes(fmt(r.Vr / 1000, 1) + ' cm³'), '报告冒口体积与结果对象不一致');
      assert(!html.includes('32.5'), '报告不得再输出 2 腔 32.5% 的错误出品率');
      const stale = buildWorkflowReport(results, { status: { k: 'stale', cls: 'warn', text: '⚠️ 参数已修改，以下结果待重新分析' } });
      assert(stale.includes('待重新分析') && stale.includes('本报告只代表上一次成功结果'), '过期状态必须在报告顶部说明');
    },
  },
  {
    name: 'S3.1-C2 生成报告不得改动结果对象（数值逐位不变）',
    fn: () => {
      seedAll(1);
      const { results } = calcAll();
      const before = JSON.stringify(results);
      buildWorkflowReport(results, { status: { k: 'ok', text: '✓' } });
      same(JSON.stringify(results), before, '报告生成不得修改 results');
    },
  },
  {
    name: 'S3.1-D1 H/D 独立计算器：球形四档 H/D 无效；其余三形状确实改变 D/H/Vr',
    fn: () => {
      const HDS = [0.8, 1.0, 1.2, 1.5];
      const sphere = HDS.map(hd => runRiser({ mat: '球铁', cast_wt: 77.56, mc_mode: 'direct', mc: 11.43, shape: 'sphere', hd_ratio: hd }));
      for (const r of sphere) { same(r.D, 83, '球形 D 不随 H/D 变'); same(r.H, 83, '球形 H 不随 H/D 变'); }
      for (const shape of ['cyl', 'sphere_head', 'square']) {
        const rs = HDS.map(hd => runRiser({ mat: '球铁', cast_wt: 77.56, mc_mode: 'direct', mc: 11.43, shape, hd_ratio: hd }));
        assert(new Set(rs.map(r => r.D)).size > 1, `${shape} 的 D 应随 H/D 改变`);
        assert(new Set(rs.map(r => r.Vr)).size > 1, `${shape} 的 Vr 应随 H/D 改变`);
        assert(rs.every(r => r.modOk), `${shape} 所有 H/D 都应达到目标模数`);
      }
    },
  },
];

/** 读取源码（同步；Node 环境下直接 readFileSync） */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
function awaitRead(p) { return readFileSync(join(HERE, '..', p), 'utf8'); }
