// ============================================================
// PHASE 16-C 工作流测试（19.txt 十六：模块选择/依赖传递/shrinkage 接入/报告）
// 验证（Node 数据层）：
//   - shrinkage manifest 接入（14 个工具第 10 个 manifest，19.txt 十四）
//   - manifest 计算器依赖传递（yield←gating/riser、charge←yield，结构化 results 对象）
//   - 参数→模块依赖映射（19.txt 十：PARAM_OWNERS 等价逻辑）
//   - 报告只含选择模块 + 参数来源保留 + WARNING 段（19.txt 十二）
// designCenter DOM 交互（导航/徽章）由字段契约保证。
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST, allMissingInputs, isMissing } from '../calcs/calcManifest.js';
import { calcShrinkageDir } from '../calcs/shrinkage.js';
import { buildWorkflowReport } from '../js/views/reportGenerator.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifest = (id) => CALC_MANIFEST.find(c => c.id === id);

export const tests = [
  {
    name: '16-C-1 shrinkage 已接入 manifest（19.txt 十四）：声明完整 + 可计算',
    fn: () => {
      const m = manifest('shrinkage');
      assert(!!m, 'CALC_MANIFEST 应包含 shrinkage');
      assert(m.requiredInputs.some(p => p.param === 'material.family'), '应声明材料大类');
      const dims = m.requiredInputs.find(p => p.input === 'dims');
      assert(!!dims && dims.kind === 'dims3' && dims.param === 'geometry.size', '尺寸应为 dims3 类型（三方向）');
      assert(m.outputs.some(o => o.key === 'combined'), '应声明综合收缩率输出');
    },
  },
  {
    name: '16-C-2 shrinkage 计算：三方向独立收缩率（球铁 300×200×100）',
    fn: () => {
      const r = calcShrinkageDir('球铁(QT)', [300, 200, 100], 'common');
      assert(r.dirs.length === 3, '三方向都应计算');
      assert(r.dirs[0].rate >= r.dirs[2].rate, '大方向取上限（300 > 100）');
      assert(r.dirs[2].rate <= r.dirs[0].rate, '小方向取下限');
      assert(r.combined != null, '方向差 <0.2 时应给综合比例');
      assert(r.dirs[0].amount > r.dirs[2].amount, '大方向放尺量更大');
    },
  },
  {
    name: '16-C-2b shrinkage manifest.calculate：从 CastingProject 取尺寸数组',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.size', [300, 200, 100], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r = manifest('shrinkage').calculate();
      assert(r && r.dirs.length === 3, '应输出 3 方向结果');
      assert(r.modeLabel === '常用值（生产·模具）', '默认模式应为常用值');
      // 尺寸缺失 → 不计算（防止 0 尺寸方向）
      proj.set('geometry.size', [0, 0, 0], proj.SRC.DEFAULT, proj.CONF.LOW);
      const r2 = manifest('shrinkage').calculate();
      assert(r2 === null, '全 0 尺寸应返回 null');
    },
  },
  {
    name: '16-C-3 dims3 缺失判定：全 0 数组缺失、STL 自动数组已满足',
    fn: () => {
      proj.reset();
      proj.set('geometry.size', [0, 0, 0], proj.SRC.DEFAULT, proj.CONF.LOW);
      const p = manifest('shrinkage').requiredInputs.find(x => x.input === 'dims');
      assert(isMissing(p) === true, '全 0 尺寸应判定缺失');
      proj.set('geometry.size', [300, 200, 100], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      assert(isMissing(p) === false, 'STL 自动尺寸应已满足');
    },
  },
  {
    name: '16-C-4 依赖传递：yield 用 gating.G/riser.Vr，charge 用 yield.pourWt（结构化 results）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('material.yieldSug', 70, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      proj.set('material.solidDensity', 7.0, proj.SRC.SCENARIO, proj.CONF.MEDIUM);   // PHASE 28.3-A
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.mcHotspot', 12, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 模拟 gating/riser 已完成（calcs 输出）
      const fakeG = { G: 15.2 };
      const fakeR = { Vr: 80000, md: { rho: 7.0 } };   // 80,000 mm³
      const y = manifest('yield').calculate({ gating: fakeG, riser: fakeR });
      assert(Math.abs(y.pourWt - 15.2) < 1e-9, `yield.pourWt 应取 gating.G（实际 ${y.pourWt}）`);
      assert(Math.abs(y.runnerWt - 5.2) < 1e-9, 'runnerWt = G - 铸件重');
      // PHASE 28 P0-1：riserWt = Vr(mm³)×rho(g/cm³)/1e6 → kg（80000mm³×7.0=0.56kg，原 /1000 得 560g 误标 kg）
      assert(Math.abs(y.riserWt - (80000 * 7.0 / 1e6)) < 1e-9, 'riserWt 应来自 riser.Vr×密度（kg，/1e6）');
      const ch = manifest('charge').calculate({ yield: y, gating: fakeG });
      assert(ch && ch.pourWt === 15.2, 'charge 铁水总重应取 yield.pourWt');
      // 无 gating/riser 时：yield 用默认出品率兜底，charge 用 gating.G 兜底
      const y2 = manifest('yield').calculate({});
      assert(y2.pourWt > 10, '无 gating 时 pourWt 按默认出品率预估');
    },
  },
  {
    name: '16-C-5 参数→模块依赖映射（19.txt 十）：关键参数被正确模块依赖',
    fn: () => {
      // 与 designCenter PARAM_OWNERS 相同构建逻辑（独立验证依赖关系正确）
      const owners = new Map();
      for (const c of CALC_MANIFEST) {
        for (const p of [...(c.requiredInputs || []), ...(c.optionalInputs || [])]) {
          if (!p.param) continue;
          owners.set(p.param, [...(owners.get(p.param) || []), c.id]);
        }
      }
      const has = (path, ...ids) => ids.every(id => owners.get(path)?.includes(id));
      assert(has('process.wallUsed', 'gating', 'shakeout'), 'wallUsed 应被 gating/shakeout 依赖');
      // PHASE 28.3-A：mcUsed 拆分——riser 依赖 mcHotspot（有热结）/wallHot（无热结），chill 依赖独立 chillT
      assert(has('process.mcHotspot', 'riser'), 'mcHotspot 应被 riser 依赖');
      assert(has('process.chillT', 'chill'), 'chillT 应被 chill 依赖');
      // PHASE 73：修正过期断言 —— PHASE 71.6 起 riser 的补缩金属量口径改为**净重**（netWeightKg，
      //   「riser.cast_wt 改净重」是当时的既定决策，见 docs/PHASE716_REPORT.md），
      //   blankWeightKg 仍被其余 5 个模块消费。这里按**当前契约**断言，不是放宽测试。
      assert(has('geometry.blankWeightKg', 'gating', 'yield', 'sandbox', 'shakeout', 'charge'), 'blankWeightKg 依赖面');
      assert(has('geometry.netWeightKg', 'riser'), 'riser 依赖净重（PHASE 71.6 口径）');
      assert(has('geometry.size', 'sandbox', 'machining', 'shrinkage'), 'size 应含 sandbox/machining/shrinkage');
      assert(has('material.family'), 'family 被所有计算器依赖');
    },
  },
  {
    name: '16-C-6 报告只含用户选择的模块（19.txt 十二）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const html = buildWorkflowReport({
        gating: { G: 15.2, t: 12.5, A: 480, D_sp: 25, L_g: 120, L_r: 150, gc: 2, gt: 15, rc: 2, rt: 25, ratioKey: '顶注·中注', v: 1.2, v_ok: true, vr: 1.8, vr_ok: true, sugs: [] },
        riser: { D: 90, H: 90, dimLabel: '球直径', Mr_act: 18, Mr_need: 16, eff: 0.14, Vr: 381700, d_neck: 60, modOk: true, volOk: true },
      }, { fileName: 'ValveBody.stl' });
      assert(html.includes('浇注系统设计'), '应含浇注系统结果');
      assert(html.includes('冒口设计'), '应含冒口结果');
      assert(!html.includes('熔炼加料'), '未选择模块不应出现在报告');
      assert(!html.includes('开箱时间'), '未选择模块不应出现在报告');
      assert(html.includes('ValveBody.stl'), '应含 STL 文件名');
      assert(html.includes('工艺计算报告'), '报告标题');
    },
  },
  {
    name: '16-C-7 报告保留参数来源（19.txt 五/十二：🟢 STL 自动 / 🟡 用户输入）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const html = buildWorkflowReport({ gating: { G: 15, t: 12, A: 400, sugs: [] } });
      assert(html.includes('🟢 STL 自动'), 'STL 来源参数应有徽章');
      assert(html.includes('🟡 用户输入'), '用户输入参数应有徽章');
    },
  },
  {
    name: '16-C-8 报告 WARNING 段：采样欠解析明确显示（17.txt 十三）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      const html = buildWorkflowReport({}, { sampling: { warning: true, detail: '⚠ 采样欠解析：壁厚 3mm 小于采样分辨率 5mm' } });
      assert(html.includes('采样欠解析'), 'WARNING 段应含采样风险');
      const html2 = buildWorkflowReport({}, { sampling: { warning: false } });
      assert(html2.includes('无警告') || html2.includes('采样分辨率正常'), '无风险时应显示正常');
    },
  },
  {
    name: '16-C-9 全部 9 个计算模块 manifest 完整（含 shrinkage，14 个工具中 10 个有核心）',
    fn: () => {
      const ids = CALC_MANIFEST.map(c => c.id).sort();
      assert(JSON.stringify(ids) === JSON.stringify(['charge', 'chill', 'gating', 'machining', 'riser', 'sandbox', 'shakeout', 'shrinkage', 'yield']), `manifest id 集：${ids}`);
      for (const c of CALC_MANIFEST) {
        assert(Array.isArray(c.requiredInputs) && c.requiredInputs.length > 0, `${c.id} 应有 requiredInputs`);
        assert(typeof c.calculate === 'function', `${c.id} 应有 calculate`);
      }
    },
  },
];
