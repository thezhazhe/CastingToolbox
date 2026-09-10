// ============================================================
// PHASE 78（78.txt）· 显示层打磨 + 交互 Bug 修复（计算/公式零改动）
//   T1  旧持久化项目缺新字段 → proj.set 静默失败（"勾选不打勾"根因）· mergeDeep 修复
//   T2  浇注系统比例可选（'' = 自动推荐；选了就按所选分配）
//   T3  冒口形状可选（4 种，默认圆柱形）
//   T4  排气 = ⌀3mm 圆孔 × N 个（默认 3，可改；总面积随个数变化）
//   T5  Page1 做减法：只 4 张关键卡片 + notes 提示行
//   T6  Page3 内浇道/排气输入框（从参数区搬来）+ 参数区不再重复
//   T7  工具分类分组（每个计算器都有类别、类别顺序稳定）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF, mergeDeep, defaultProject } from '../js/model/CastingProject.js';
import { CALC_MANIFEST, ingateRec } from '../calcs/calcManifest.js';
import { RISER_SHAPES } from '../calcs/riser.js';
import { RATIO_PRESETS, recommendGatingRatio } from '../calcs/gating.js';
import { buildPage1Data, page1Html } from '../js/views/processPage1.js';
import { renderResultsCenter } from '../js/views/resultsCenter.js';
import { CALCULATORS, CALC_CATEGORIES, calculatorsByCategory } from '../calcs/registry.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const calc = (id) => CALC_MANIFEST.find(c => c.id === id).calculate;

/** 基础桩：灰铁 + 热结（H1 Mc18 / H2 Mc9）+ 净重 10kg + 完整浇注参数 */
function loadCase() {
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
  proj.set('process.pourPos', '顶注', SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.Ho', 250, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('process.ph', 200, SRC.USER_INPUT, CONF.USER_CONFIRMED);
  proj.set('production.cavities', 1, SRC.USER_INPUT, CONF.USER_CONFIRMED);
}

export const tests = [
  {
    name: '78-T1 旧持久化项目缺新字段 → set 静默失败（78.txt 四根因）：mergeDeep 补齐',
    fn: () => {
      const def = defaultProject();
      // 模拟"上一版本写进 localStorage 的项目"：process/production 存在，但缺 71.7/78 新增字段
      const saved = {
        material: { family: { v: '球铁', src: 'user_input', conf: 'user_confirmed', editable: true } },
        process: {
          mcHotspot: { v: 12, src: 'user_input', conf: 'user_confirmed', editable: true },
          pourPos: { v: '中注', src: 'user_input', conf: 'user_confirmed', editable: true },
        },
        production: { cavities: { v: 4, src: 'user_input', conf: 'user_confirmed', editable: true } },
      };
      const merged = mergeDeep(def, saved);
      // ① 旧值必须原样保留（不能被默认值覆盖）
      assert(merged.material.family.v === '球铁', '持久化材料保留');
      assert(merged.process.mcHotspot.v === 12, '持久化 Mc 保留');
      assert(merged.process.pourPos.v === '中注', '持久化浇注方向保留');
      assert(merged.production.cavities.v === 4, '持久化型腔数保留');
      // ② 升级新增的字段必须补回来（这是 bug 的关键：浅合并会丢）
      assert(merged.process.hsPick && Array.isArray(merged.process.hsPick.v), 'process.hsPick 被补齐（勾选链路可用）');
      assert(merged.process.gateThk && merged.process.ratioKey && merged.process.riserShape && merged.process.ventD, '78/79 新增字段补齐');
      assert(merged.production.ingateN, 'production.ingateN 补齐');
      // ③ 参数对象整体覆盖（不深挖 v/src）——保证参数语义完整
      assert(merged.process.mcHotspot.src === 'user_input' && merged.process.mcHotspot.conf === 'user_confirmed', '参数对象元数据完整');
      // ④ 数组整体覆盖，不与默认值合并
      const saved2 = { hotspots: { items: { v: [{ id: 7, mc: 5 }], src: 'stl_geometry_analysis', conf: 'high', editable: false } } };
      const m2 = mergeDeep(def, saved2);
      assert(m2.hotspots.items.v.length === 1 && m2.hotspots.items.v[0].id === 7, '数组整体覆盖');
      // ⑤ 首次运行（无存档 → null/undefined）必须回落到默认骨架——否则 project = null 全站静默失效
      assert(mergeDeep(def, null).process.hsPick, 'null 存档 → 用默认骨架');
      assert(mergeDeep(def, undefined).process.hsPick, 'undefined 存档 → 用默认骨架');
      assert(JSON.stringify(mergeDeep(def, null)) === JSON.stringify(mergeDeep(def, {})), 'null 与空对象等价');
      // ⑥ 真实链路：合并后的项目上 set 必须成功（旧实现返回 false）
      proj.reset();
      const hs = proj.get('process.hsPick');
      assert(hs, 'process.hsPick 字段存在（默认项目）');
      assert(proj.set('process.hsPick', [{ id: 1, mc: 14 }], SRC.USER_INPUT, CONF.USER_CONFIRMED) === true, 'set 成功');
      assert(JSON.stringify(proj.getV('process.hsPick')) === '[{"id":1,"mc":14}]', '值写入正确');
    },
  },
  {
    name: '78-T2 浇注系统比例可选（78.txt 二）：空 = 自动推荐；选定后按所选比例分配',
    fn: () => {
      loadCase();
      const gAuto = calc('gating')({});
      assert(gAuto.ratioKey === recommendGatingRatio('灰铁(HT)', 10), `未选 → 自动推荐（${gAuto.ratioKey}）`);
      // 用户选「开放式 宽大型」(1 : 2.5 : 2.5) → 直浇道为阻流、内浇道显著放大
      proj.set('process.ratioKey', '开放式 宽大型', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const gOpen = calc('gating')({});
      assert(gOpen.ratioKey === '开放式 宽大型', '所选比例生效');
      assert(gOpen.g_r > gAuto.g_r, `内浇口比例系数变大（${gAuto.g_r} → ${gOpen.g_r}）`);
      assert(gOpen.Fg !== gAuto.Fg, '几何随比例重算');
      assert(gOpen.rrv !== gAuto.rrv && gOpen.rgv !== gAuto.rgv, `实际面积比随比例变化（${gAuto.rrv}/${gAuto.rgv} → ${gOpen.rrv}/${gOpen.rgv}）`);
      // 选封闭式 → 内浇口参考面积系数变小（阻流回归内浇口方向）
      proj.set('process.ratioKey', '封闭式 常用型', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const gClosed = calc('gating')({});
      assert(gClosed.g_r === 0.85 && gClosed.r_r === 2.0, `封闭式 常用型 = 1 : 2 : 0.85（实际 ${gClosed.s_r} : ${gClosed.r_r} : ${gClosed.g_r}）`);
      assert(gClosed.g_r < gOpen.g_r, '封闭式内浇口系数小于开放式（比例按预设分配）');
      // 注：阻流位置由**实际几何面积**判定（P51），不由预设直接决定——此处不断言 chokePosition
      // 清空 → 回到自动
      proj.set('process.ratioKey', '', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      assert(calc('gating')({}).ratioKey === recommendGatingRatio('灰铁(HT)', 10), '清空回自动推荐');
      assert(Object.keys(RATIO_PRESETS).length >= 6, '预设齐全（6 档）');
    },
  },
  {
    name: '78-T3 冒口形状可选（78.txt 三）：4 种、默认圆柱形、切换即重算',
    fn: () => {
      loadCase();
      assert(Object.keys(RISER_SHAPES).length === 4, '4 种冒口形状');
      assert(proj.getV('process.riserShape') === 'cyl', '默认 = 圆柱形（78.txt 三·1）');
      const rCyl = calc('riser')({});
      assert(rCyl.shapeKey === 'cyl' && rCyl.sd.name === '圆柱形', `默认圆柱形（${rCyl.sd.name}）`);
      assert(Math.abs(rCyl.eff - 0.14) < 1e-9, `明顶圆柱补缩效率 14%（实际 ${rCyl.eff}）`);
      // 切球形 → 模数公式 M = D/6（与 hd=1 的圆柱同式，故 D 相同）、效率 20%（暗冒口）——两者差异在效率
      proj.set('process.riserShape', 'sphere', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const rSph = calc('riser')({});
      assert(rSph.shapeKey === 'sphere', `形状生效（${rSph.sd.name}）`);
      assert(Math.abs(rSph.Mr_act - rSph.D / 6) < 1e-6, '球形模数 M = D/6（公式未改）');
      assert(Math.abs(rSph.eff - 0.20) < 1e-9, `球形（暗）补缩效率 20%（实际 ${rSph.eff}）`);
      // 形状差异体现在**补缩效率与体积**（h/d=1 时四种形状的模数式等价 → 同 Mc 下直径相同，如实记录）
      assert(rSph.Vr !== rCyl.Vr, `球形体积与圆柱不同（${(rCyl.Vr / 1000).toFixed(0)} → ${(rSph.Vr / 1000).toFixed(0)} cm³）`);
      assert(rSph.D === rCyl.D, 'h/d=1 时各形状同模数 → 直径相同（模数公式等价，非 bug）');
      // 切球顶圆柱 → 效率 25%
      proj.set('process.riserShape', 'sphere_head', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const rSH = calc('riser')({});
      assert(Math.abs(rSH.eff - 0.25) < 1e-9, '球顶圆柱效率 25%');
      assert(rSH.sd.name === '球顶圆柱', '球顶圆柱标签');
      // 正方柱 = 方形边长 a（标签不同）
      proj.set('process.riserShape', 'square', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      assert(calc('riser')({}).dimLabel === '边长 a', '正方柱按边长标注');
      // 非法值 → 回退圆柱形（不静默出错）
      proj.set('process.riserShape', 'nope', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      assert(calc('riser')({}).shapeKey === 'cyl', '非法形状回退圆柱形');
      // 结果页下拉：4 个选项 + 当前选中
      proj.set('process.riserShape', 'sphere', SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const r = calc('riser')({});
      const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(container, { riser: r }, { ctx: {}, active: 'riser' });
      const html = container.innerHTML;
      assert(html.includes('id="dc_riserShape"'), '结果页有形状下拉');
      assert(['圆柱形', '球顶圆柱', '球形', '正方柱'].every(n => html.includes(n)), '4 种形状都在下拉里');
      assert(/<option value="sphere" selected/.test(html), '当前形状选中');
    },
  },
  {
    name: '78-T4 / 79-T4 排气（79.txt 四定稿）：用户定直径、系统按总排气面积算孔数',
    fn: () => {
      loadCase();
      assert(proj.getV('process.ventD') === 3, '直径默认 ⌀3');
      const g0 = calc('gating')({});
      const hole3 = Math.PI * 9 / 4;
      const need = g0.Fs_act * 1.5;
      assert(Math.abs(g0.ventNeed - need) < 1.5, `目标排气面积 = 1.5 × 直浇道（${g0.ventNeed} vs ${need.toFixed(1)}）`);
      assert(g0.ventN === Math.ceil(need / hole3), `孔数 = ⌈目标 ÷ 单孔⌉（${g0.ventN}）`);
      assert(g0.ventD === 3 && Math.abs(g0.vt - hole3 * g0.ventN) < 1e-6, '总排气面积 = 单孔 × 孔数');
      assert(g0.vr >= 1.5 && g0.vr_ok === true, `比值恒 ≥1.5（实际 ${g0.vr.toFixed(2)}）→ 不再报"排气不足"`);
      // 改直径 → 孔数自动重算（同一目标面积）
      proj.set('process.ventD', 1, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g1 = calc('gating')({});
      const hole1 = Math.PI * 1 / 4;
      assert(g1.ventD === 1 && g1.ventN === Math.ceil(g1.ventNeed / hole1), `⌀1 → 孔数自动变多（${g0.ventN} → ${g1.ventN}）`);
      assert(g1.ventN > g0.ventN && g1.vr >= 1.5 && g1.vr_ok, '小直径 → 孔数增加、比值仍达标');
      proj.set('process.ventD', 5, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g2 = calc('gating')({});
      assert(g2.ventN < g0.ventN, `大直径 → 孔数减少（${g0.ventN} → ${g2.ventN}）`);
      assert(g2.vr >= 1.5 && g2.vr_ok, '大直径同样达标');
      // 非法/空 → 回默认 ⌀3
      proj.set('process.ventD', 0, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      assert(calc('gating')({}).ventD === 3, '0/空 → 回默认 ⌀3');
    },
  },
  {
    name: '78-T5 Page1 做减法（78.txt 六）：只 4 张关键卡片 + notes 提示行',
    fn: () => {
      loadCase();
      const pack = {
        v: (p) => proj.getV(p), ps: (p) => proj.get(p),
        sampling: { warning: false, level: 'ok', minWall: 0, minWallReliable: false },
        bodyRef: 12, hasStl: true, manual: false, geomStatus: 'VALID', results: null,
      };
      const d = buildPage1Data(pack);
      const titles = d.B.map(b => b.title);
      assert(titles.length === 4, `只保留 4 张卡（实际 ${titles.length}：${titles.join('/')}）`);
      assert(titles.join('|') === '最小壁厚|铸造圆角|拔模斜度|最小铸出孔径', `卡片 = 用户指定的 4 项（${titles.join('/')}）`);
      assert(!titles.some(t => t.includes('厚薄') || t.includes('结构风险')), '厚薄过渡/结构风险卡已移除');
      // 多热结提示保留（转 notes）
      assert(d.notes.some(n => n.text.includes('多热结')), '多热结 V1 说明保留在提示行');
      const html = page1Html(d);
      assert(html.includes('dc-p1-notes'), '提示行渲染');
      assert(html.includes('最小铸出孔径') && html.includes('拔模斜度'), '4 张卡渲染');
    },
  },
  {
    name: '78-T6 Page3 内浇道/排气输入框（78.txt 七/八）+ 参数区不再重复',
    fn: () => {
      loadCase();
      const g = calc('gating')({});
      const container = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(container, { gating: g }, { ctx: {}, active: 'gating' });
      const html = container.innerHTML;
      assert(html.includes('id="dc_gtEdit"') && html.includes('id="dc_gcEdit"'), '内浇道厚度/个数输入框在结果页');
      // 79.txt 四：排气只让用户填**直径**，孔数是系统算出来的只读结果
      assert(html.includes('id="dc_ventD"'), '排气直径输入框在结果页');
      assert(!html.includes('id="dc_ventN"'), '排气孔数不再是输入框（由系统生成）');
      assert(html.includes(`${g.ventN}</b> 个 ⌀`), '展示自动生成的孔数');
      assert(/id="dc_gtEdit"[^>]*value="10"/.test(html), `厚度框预填当前生效值（推荐 ${ingateRec(30).gt}）`);
      assert(/id="dc_gcEdit"[^>]*value="2"/.test(html), '个数框预填当前生效值');
      // 内浇道长度/总截面随框内数值展示（联动基准）
      assert(html.includes(`单条长 <b>${g.L_g}</b> mm`) || html.includes(`单条长 <b>${g.L_g.toFixed(0)}</b> mm`), '展示当前内浇道长度');
      // 参数改动 → 回调（由设计中心重跑计算链）
      let called = 0;
      const c2 = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      const listeners = {};
      c2.querySelector = (sel) => (sel === '#dc_gtEdit' ? { value: '6', addEventListener: (e, fn) => { listeners.gt = fn; } } : null);
      renderResultsCenter(c2, { gating: g }, { ctx: {}, active: 'gating', onParamChange: () => { called++; } });
      assert(typeof listeners.gt === 'function', '结果页输入框绑定监听');
      listeners.gt();
      assert(proj.getV('process.gateThk') === 6 && called === 1, '改厚度 → 写项目 + 触发重算回调');
      // 参数区（设计中心）不再渲染内浇道输入：manifest 声明仍在（计算链唯一），但输入入口只有一个
      assert(CALC_MANIFEST.find(c => c.id === 'gating').optionalInputs.some(p => p.param === 'process.gateThk'), '内浇道参数仍在 manifest 声明中（计算链路不变）');
    },
  },
  {
    name: '78-T7 工具分类（78.txt 十一）：每个工具都有类别、类别非空且顺序稳定',
    fn: () => {
      const groups = calculatorsByCategory();
      assert(groups.length === CALC_CATEGORIES.length, `全部 ${CALC_CATEGORIES.length} 类都有工具`);
      const total = groups.reduce((s, g) => s + g.items.length, 0);
      assert(total === CALCULATORS.length, `分类覆盖全部 ${CALCULATORS.length} 个工具（实际 ${total}）`);
      assert(CALCULATORS.every(c => c.cat && CALC_CATEGORIES.some(k => k.key === c.cat)), '每个工具都有有效类别');
      assert(groups.map(g => g.key).join('|') === CALC_CATEGORIES.map(c => c.key).join('|'), '类别顺序 = 工艺设计推进顺序');
      // 抽查归类是否合理（按"解决的问题"分，不按实现分）
      const inCat = (key) => groups.find(g => g.key === key).items.map(i => i.id);
      assert(inCat('pouring').includes('gating') && inCat('pouring').includes('campbell_gating') && inCat('pouring').includes('vertical_gating'), '三种浇注系统在同一类');
      assert(inCat('feed').includes('riser') && inCat('feed').includes('chill'), '冒口/冷铁同类（补缩）');
      assert(inCat('dim').includes('shrinkage') && inCat('dim').includes('machining') && inCat('dim').includes('ct'), '收缩/余量/公差同类（尺寸链）');
      assert(inCat('method').includes('principles') && inCat('method').includes('defect_finder'), '原则/缺陷查找同类');
    },
  },
];
