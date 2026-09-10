// ============================================================
// PHASE 71.7（77.txt）· 设计中心显示层打磨（不改计算公式）
//   T1  热结多选 → 逐热结冒口（不勾选不计算；主结果 = Mc 最大者）
//   T2  内浇道推荐（厚 = 主体壁厚 ÷ 3 / 个数 2）+ 可改 + 长度联动
//   T3  Page1 只保留工艺性卡片 + 线收缩率/加工余量小卡片（STL 基础信息移入概览）
//   T4  Page2 多热结逐块展示（字段全部来自 runRiser）
//   T5  Page3 浇道总截面积齐全、示意图不再重复出现在结果页
//   T6  结果导航三页（出品率页从设计中心剔除）
//   T7  生产场景柔性联动（只补未设定项，绝不覆盖用户选择）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';
import { buildPage1Data, page1Html } from '../js/views/processPage1.js';
import { renderResultsCenter } from '../js/views/resultsCenter.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const calc = (id) => CALC_MANIFEST.find(c => c.id === id).calculate;

/** 基础桩：灰铁 + 有热结（H1 Mc18 / H2 Mc9）+ 净重 10kg */
function loadHotspotCase() {
  proj.reset();
  proj.set('material.family', '灰铁');
  proj.set('material.liquidDensity', 7.0, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.solidDensity', 7.0, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('material.yieldSug', 75, SRC.SCENARIO, CONF.MEDIUM);
  proj.set('geometry.geomStatus', 'VALID', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.netWeightKg', 10, SRC.DERIVED, CONF.HIGH);
  proj.set('geometry.blankWeightKg', 10, SRC.DERIVED, CONF.HIGH);
  proj.set('geometry.size', [120, 80, 60], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallUsed', 30, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('hotspots.items', [
    { id: 1, x: 0, y: 0, z: 0, mc: 18, regionVolumeCm3: 120 },
    { id: 2, x: 20, y: 10, z: 5, mc: 9, regionVolumeCm3: 40 },
  ], SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
  proj.set('process.mcHotspot', 18, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
}

export const tests = [
  {
    name: '71.7-T1 热结多选：逐热结冒口，不勾选不计算，主结果 = Mc 最大者（77.txt 二）',
    fn: () => {
      loadHotspotCase();
      // 未勾选 → 自动按主热结 H1（行为与 71.6 一致）
      const r0 = calc('riser')({});
      assert(r0.Mc === 18 && !r0.items, `未勾选 = 主热结自动（Mc=${r0.Mc}）`);
      // 只选 H2 → 只算 H2
      proj.set('process.hsPick', [{ id: 2, mc: 9 }], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const r1 = calc('riser')({});
      assert(r1.items && r1.items.length === 1 && r1.Mc === 9, `只选 H2 → Mc=9（实际 ${r1.Mc}）`);
      assert(r1.items[0].hsId === 2, '结果标注热结 id');
      // 多选（H1 用检出值、H2 用户改为 12）→ 两个冒口，主结果 = Mc 最大者
      proj.set('process.hsPick', [{ id: 1, mc: 18 }, { id: 2, mc: 12 }], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const r2 = calc('riser')({});
      assert(r2.items && r2.items.length === 2, `多选 → 2 个冒口（实际 ${r2.items?.length}）`);
      assert(r2.Mc === 18 && r2.D === r2.items[0].D, '主结果 = Mc 最大者（供 gating/yield 使用）');
      assert(r2.items[1].Mc === 12 && r2.items[1].hsMc === 9, '逐热结 Mc 独立（H2 检出 9 → 用户 12）');
      assert(r2.items[0].D > r2.items[1].D, 'Mc 大的冒口更大（公式不变）');
      assert(r2.level === 'WARNING_REVIEW', '含用户修改 → 需人工复核');
      assert(r2.note && r2.note.includes('2'), `结果说明标注多热结（${r2.note}）`);
      // 取消全部勾选 → 回到主热结自动
      proj.set('process.hsPick', [], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const r3 = calc('riser')({});
      assert(r3.Mc === 18 && !r3.items, '取消勾选 → 回主热结自动');
      // 勾选不存在/无效的热结 id 被忽略（不产生空冒口）
      proj.set('process.hsPick', [{ id: 99, mc: 15 }], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const r4 = calc('riser')({});
      assert(r4.Mc === 18 && !r4.items, '无效热结选择被忽略（不静默出错）');
    },
  },
  {
    name: '71.7-T2 内浇道：推荐厚度 = 主体壁厚÷3、个数 2，可改且长度/面积联动（77.txt 六）',
    fn: () => {
      loadHotspotCase();
      proj.set('process.pourPos', '顶注', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.Ho', 250, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.ph', 200, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('production.cavities', 1, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      // 未填写 → 按推荐：厚度 = round(30/3) = 10，个数 2
      const g0 = calc('gating')({});
      assert(g0.gt === 10 && g0.gc === 2, `推荐自动：厚 ${g0.gt} × ${g0.gc} 个`);
      // 用户改厚度 → 面积按新厚度重算（长度按面积取 5mm 档）
      proj.set('process.gateThk', 6, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g1 = calc('gating')({});
      assert(g1.gt === 6, `厚度采用用户值（${g1.gt}）`);
      assert(Math.abs(g1.Fg - 6 * g1.L_g * g1.gc) < 1e-6, '总截面积 = 厚 × 长 × 个数');
      assert(g1.Fg !== g0.Fg, `厚度变化 → 内浇道面积重算（${g0.Fg} → ${g1.Fg}）`);
      assert(g1.L_g % 5 === 0, `长度按 5mm 档给设计值（${g1.L_g}）`);
      // 更薄的厚度 → 长度明显变长（面积需求 → 长度联动）
      proj.set('process.gateThk', 3, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g2 = calc('gating')({});
      assert(g2.L_g > g0.L_g, `厚度减半 → 内浇道变长（${g0.L_g} → ${g2.L_g} mm）`);
      assert(Math.abs(g2.Fg - 3 * g2.L_g * g2.gc) < 1e-6, '面积恒等关系成立');
      // 用户改个数 → 面积随之变化
      proj.set('production.ingateN', 3, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g3 = calc('gating')({});
      assert(g3.gc === 3, '个数采用用户值');
      assert(g3.Fg > g2.Fg, '个数增加 → 内浇道总面积增加');
      assert(g3.Fg > 0 && g3.Fs_act > 0 && g3.Fr_act > 0 && g3.vt > 0, '直/横/内/排气 总截面积均有值');
    },
  },
  {
    name: '71.7-T3 Page1：只保留工艺性卡片 + 线收缩率/加工余量小卡片（77.txt 五/末）',
    fn: () => {
      const pack = {
        v: (p) => proj.getV(p), ps: (p) => proj.get(p),
        sampling: { warning: false, level: 'ok', minWall: 0, minWallReliable: false },
        bodyRef: 12, hasStl: true, manual: false, geomStatus: 'VALID',
        results: {
          shrinkage: { combined: 0.85, spread: 0, directional: false, modeLabel: '常用值' },
          machining: { min: 0.4, max: 0.7, mid: 0.55, grades: ['E', 'F', 'G'], methodLabel: '砂型 · 机器造型/壳型' },
        },
      };
      loadHotspotCase();
      const d = buildPage1Data(pack);
      assert(d.C.length === 2, `关联工艺卡片 2 张（实际 ${d.C.length}）`);
      assert(d.C[0].key === 'shrinkage' && d.C[0].value.includes('0.85'), '线收缩率卡片 = 综合比例');
      assert(!('spread' in d.C[0]) && d.C[0].lines.length === 1, '线收缩率只显示综合比例（不分方向明细）');
      assert(d.C[1].key === 'machining' && d.C[1].value.includes('0.55'), `加工余量卡片 = 推荐值（${d.C[1].value}）`);
      const html = page1Html(d);
      assert(html.includes('铸造工艺性'), '标题 = 铸造工艺性');
      assert(!html.includes('板块 A') && !html.includes('STL 基础信息'), 'STL 基础信息不再在本页（已入 ① 概览）');
      assert(html.includes('线收缩率') && html.includes('加工余量'), '两张小卡片渲染');
      assert(html.includes('最小壁厚') && html.includes('铸造圆角') && html.includes('拔模斜度'), '工艺性卡片保留');
    },
  },
  {
    name: '71.7-T4 / 78-T4 Page2：多热结分子页签展示（字段来自 runRiser，不重算）',
    fn: () => {
      loadHotspotCase();
      proj.set('process.hsPick', [{ id: 1, mc: 18 }, { id: 2, mc: 12 }], SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const r = calc('riser')({});
      const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(container, { riser: r }, { ctx: {}, active: 'riser' });
      const html = container.innerHTML;
      // PHASE 78（78.txt 五）：多热结由"纵向堆叠"改为"子页签"（点热结 1 / 热结 2 切换）
      assert(html.includes('data-hs-tab="0"') && html.includes('data-hs-tab="1"'), '热结子页签（分子页展示）');
      assert(html.includes('data-hs-pane="0"') && html.includes('data-hs-pane="1"'), '每个热结独立面板');
      assert(html.includes('用户输入') && html.includes('该热结检出 9'), 'H2 标注用户修改值与该热结检出值');
      assert(html.includes(String(r.items[0].D)) && html.includes(String(r.items[1].D)), '两块冒口尺寸各自渲染');
      assert(html.includes('冒口结果来自现有冒口计算器'), '结果出处标注保留');
      assert(html.includes('体积校核') && html.includes('冒口颈'), '校核字段齐全');
      // PHASE 78（78.txt 三）：冒口形状可选（4 种，默认圆柱形）
      assert(html.includes('id="dc_riserShape"') && html.includes('圆柱形') && html.includes('球顶圆柱') && html.includes('球形') && html.includes('正方柱'), '冒口形状下拉（4 种）');
    },
  },
  {
    name: '71.7-T5 Page3：浇道总截面积齐全；结果页不再重复示意图（77.txt 三/六）',
    fn: () => {
      loadHotspotCase();
      proj.set('process.pourPos', '中注', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.Ho', 250, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.ph', 200, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g = calc('gating')({});
      const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(container, { gating: g }, { ctx: {}, active: 'gating' });
      const html = container.innerHTML;
      assert(html.includes('总截面'), '直/横/内浇道总截面积');
      assert(html.includes('总排气面积'), '排气总面积（77.txt 六：这些才是重点）');
      assert(!/<svg/i.test(html), '结果页不含示意图（已移入参数区）');
      assert(html.includes('参数与执行条件'), '提示示意图位置');
    },
  },
  {
    name: '71.7-T6 结果导航三页：出品率页从设计中心剔除（77.txt 五）',
    fn: () => {
      const results = { gating: { G: 1, t: 1, A: 1, D_sp: 1, L_g: 1, L_r: 1, sugs: [] }, riser: { D: 1, H: 1, Mr_act: 1, Mr_need: 1, Vr: 1, effV: 1, cw: 0, d_neck: 1, eff: 1, modOk: true, volOk: true }, yield: { castWt: 1, pourWt: 2, range: [60, 70], basis: 'x', runnerWt: 1, riserWt: null } };
      const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(container, results, { ctx: {}, active: 'page1' });
      const html = container.innerHTML;
      assert(html.includes('data-nav="page1"') && html.includes('data-nav="riser"') && html.includes('data-nav="gating"'), '三页导航');
      assert(!html.includes('data-nav="yield"') && !html.includes('data-nav="shrinkage"') && !html.includes('data-nav="machining"'), '出品率/线收缩率/加工余量不再单独成页');
      assert(!html.includes('毛坯重量 0'), '结果页副标题（材料/毛坯重量/Mc 行）已删除（77.txt 末）');
    },
  },
  {
    name: '71.7-T7 生产场景柔性联动：只补未设定项（77.txt 末）',
    fn: () => {
      proj.reset();
      const written = proj.syncFromContext({ line: '水平线', method: '砂型', prod: '自动线' });
      assert(written.includes('production.line') && written.includes('production.method'), `写入场景值（${written.join(',')}）`);
      assert(proj.getV('production.line') === '水平线', '造型线跟随场景');
      assert(proj.getV('production.method') === '砂型 · 机器造型/壳型', `铸造方法按映射写入（${proj.getV('production.method')}）`);
      assert(proj.get('production.method').src === SRC.SCENARIO, '来源 = 生产场景');
      // 用户显式设定后不再被场景覆盖
      proj.set('production.line', '垂直线', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.syncFromContext({ line: '水平线', method: '金属型' });
      assert(proj.getV('production.line') === '垂直线', '用户选择不被场景覆盖');
      assert(proj.getV('production.method') === '金属型（重力/低压）', '未设定的项仍跟随场景');
    },
  },
];
