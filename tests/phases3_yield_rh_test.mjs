// ============================================================
// R6-S3（153.txt §四 / §七）：整模出品率口径核对 + RH 用户指定
//   · buildYieldLedger：1 / 2 / 4 腔的整模账目（纯显示派生，不改冻结核心）
//   · 现有核心输出：castingMass / G 随型腔数缩放，riserWt 仍是**单套**（供 UI 列账）
//   · process.riserHeight：CALC_RESULT 首次被用户覆盖时固化 orig；USER_OVERRIDE/USER_INPUT
//     换 STL 保留，CALC_RESULT 清除；restoreAutoValue 可还原
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';
import { buildYieldLedger } from '../js/views/yieldLedger.js';
import { buildWorkflowReport } from '../js/views/reportGenerator.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifest = (id) => CALC_MANIFEST.find(c => c.id === id);

function seed(cav) {
  proj.reset();
  const S = proj.SRC, C = proj.CONF;
  proj.set('material.family', '球铁', S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('material.yieldSug', 65, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('material.solidDensity', 7.1, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('geometry.netWeightKg', 18, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 20, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('production.cavities', cav, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('process.wallUsed', 20, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('process.wallHot', 10, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('hotspots.status', 'NO_HOTSPOT', S.CALC_RESULT, C.HIGH);
  proj.set('process.pourPos', '顶注', S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('process.Ho', 150, S.USER_INPUT, C.USER_CONFIRMED);
  proj.set('process.ph', 100, S.USER_INPUT, C.USER_CONFIRMED);
}

export const tests = [
  {
    name: 'S3-Y1 1 / 2 / 4 腔：castingMass 与 G 正确按型腔数缩放',
    fn: () => {
      const out = [];
      for (const cav of [1, 2, 4]) {
        seed(cav);
        const r = manifest('riser').calculate({});
        proj.setResult('process.riserHeight', r.H);
        const g = manifest('gating').calculate({ riser: r });
        const y = manifest('yield').calculate({ gating: g, riser: r });
        out.push({ cav, g, y });
        assert(Math.abs(g.castingMass - 20 * cav) < 1e-9, `cav=${cav}: castingMass 应为 ${20 * cav}`);
        assert(Math.abs(g.G - (20 * cav) / 0.65) < 1e-6, `cav=${cav}: G 应为整模铸件重 ÷ 65%`);
        assert(Math.abs(g.ya - 65) < 1e-9, `cav=${cav}: gating.ya 当前核心恒等于预估出品率（不是实重统计）`);
        assert(Math.abs(y.castWt - 20) < 1e-9, `cav=${cav}: yield.castWt 当前核心是**单件**毛坯重`);
      }
      // riser 尺寸只与单件 Mc/净重相关 ⇒ 各腔数相同；riserWt 是单套冒口重
      assert(out.every(o => Math.abs(o.y.riserWt - out[0].y.riserWt) < 1e-9), 'riserWt 当前核心是单套口径（未乘型腔数）');
    },
  },
  {
    name: 'S3-Y2 整模账目：ledger 随型腔数缩放，且不伪造“最终出品率”',
    fn: () => {
      for (const cav of [1, 2, 4]) {
        seed(cav);
        const r = manifest('riser').calculate({});
        const g = manifest('gating').calculate({ riser: r });
        const y = manifest('yield').calculate({ gating: g, riser: r });
        const L = buildYieldLedger({ cav: g.cav, blankWt: g.pw, pourWt: g.G, riserWt: y.riserWt, designYield: g.yv });
        assert(Math.abs(L.blankTotal - 20 * cav) < 1e-9, `cav=${cav}: 整模铸件重`);
        assert(Math.abs(L.delta - (g.G - 20 * cav)) < 1e-9, `cav=${cav}: 差值 = G − 整模铸件重`);
        assert(Math.abs(L.riserTotal - y.riserWt * cav) < 1e-9, `cav=${cav}: 整模冒口重 = 单套 × 型腔数`);
        assert(Math.abs(L.gatingEst - (L.delta - L.riserTotal)) < 1e-9, `cav=${cav}: 浇道重 = 差值 − 整模冒口`);
        assert(Math.abs(L.productShare - 65) < 1e-9, `cav=${cav}: 铸件占 G 恒等于设计预估出品率`);
        assert(L.finalYield === null && L.finalYieldReason === 'missing_independent_gating_weight',
          `cav=${cav}: 现有核心不能独立给出最终实重出品率`);
      }
    },
  },
  {
    name: 'S3-Y3 导出报告：整模口径正确，不再出现“单件 ÷ 整模 G”或工具推算的实际出品率',
    fn: () => {
      seed(4);
      const r = manifest('riser').calculate({});
      proj.setResult('process.riserHeight', r.H);
      const g = manifest('gating').calculate({ riser: r });
      const y = manifest('yield').calculate({ gating: g, riser: r });
      const html = buildWorkflowReport({ riser: r, gating: g, yield: y });
      assert(html.includes('整模铸件毛坯重'), '报告应有整模铸件毛坯重');
      assert(html.includes('设计预估出品率'), '报告应标出设计预估出品率');
      assert(!html.includes('最终实重出品率') && !html.includes('暂不能给出'), '报告不得再展示工具推算的实际出品率');
      assert(html.includes('当前为工艺预估值'), '报告应说明当前为工艺预估值并指向人工回算');
      assert(!html.includes('16.25'), '4 腔时不得再出现旧的单件÷整模 G 值 16.25%');
      assert(html.includes('4 腔'), '报告应标出型腔数');
    },
  },
  {
    name: 'S3-R1 RH：CALC_RESULT 首次被用户覆盖时固化 orig，可恢复自动值',
    fn: () => {
      proj.reset();
      proj.set('process.riserHeight', 180, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
      proj.set('process.riserHeight', 222);
      const p = proj.get('process.riserHeight');
      assert(p.v === 222 && p.src === proj.SRC.USER_OVERRIDE, '用户改 RH → USER_OVERRIDE');
      assert(p.orig && p.orig.v === 180 && p.orig.src === proj.SRC.CALC_RESULT, '自动原值（CALC_RESULT 180）应被固化');
      assert(proj.restoreAutoValue('process.riserHeight') === true, '恢复应成功');
      const q = proj.get('process.riserHeight');
      assert(q.v === 180 && q.src === proj.SRC.CALC_RESULT, '恢复后 v+src 一并还原');
    },
  },
  {
    name: 'S3-R2 RH：换 STL 保留用户指定，清除自动值；保留后 orig 失效（不会恢复旧模型高度）',
    fn: () => {
      // 自动值 → 清
      proj.reset();
      proj.set('process.riserHeight', 240, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
      let cleared = proj.clearStlBoundData();
      assert(cleared.includes('process.riserHeight') && proj.getV('process.riserHeight') === 0, 'CALC_RESULT 应清');
      // USER_OVERRIDE → 保留，orig 失效
      proj.reset();
      proj.set('process.riserHeight', 180, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
      proj.set('process.riserHeight', 222);
      cleared = proj.clearStlBoundData();
      const p = proj.get('process.riserHeight');
      assert(!cleared.includes('process.riserHeight'), 'USER_OVERRIDE 的 RH 不应被换 STL 静默清掉');
      assert(p.v === 222 && p.src === proj.SRC.USER_OVERRIDE, '用户值应保留');
      assert(!p.orig, '换模型后 orig 必须失效（否则会恢复成旧模型的自动高度）');
      // USER_INPUT → 保留（历史手动预估）
      proj.reset();
      proj.set('process.riserHeight', 200, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      cleared = proj.clearStlBoundData();
      assert(!cleared.includes('process.riserHeight') && proj.getV('process.riserHeight') === 200, 'USER_INPUT 的 RH 应保留');
    },
  },
];
