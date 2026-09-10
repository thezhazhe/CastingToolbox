// ============================================================
// PHASE 16 FINAL 验收测试（20.txt 十二：整体链路回归 + 少量 workflow 测试）
// 聚焦：charge 计算依赖提示（20.txt 八 A 级修复）、依赖缺失不静默失败、
//       yield 无 gating 时合理兜底（不伪造 gating 结果）、报告健壮性
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';
import { buildWorkflowReport } from '../js/views/reportGenerator.js';
import { VERSION_LABEL } from '../js/version.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifest = (id) => CALC_MANIFEST.find(c => c.id === id);

export const tests = [
  {
    name: 'FINAL-1 charge 声明计算依赖（20.txt 八：dependsOn gating/yield）',
    fn: () => {
      const c = manifest('charge');
      assert(Array.isArray(c.dependsOn) && c.dependsOn.includes('gating') && c.dependsOn.includes('yield'),
        `charge.dependsOn 应为 [gating, yield]，实际 ${JSON.stringify(c.dependsOn)}`);
    },
  },
  {
    name: 'FINAL-2 依赖缺失：charge 无前置结果时返回 null（静默失败由 UI 提示覆盖）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 参数齐全（weightKg 已满足）但无 gating/yield 结果
      const r = manifest('charge').calculate({});
      assert(r === null, '无前置结果时 charge 必须返回 null（不产生假结果）');
    },
  },
  {
    name: 'FINAL-3 依赖满足：gating.G fallback 可用（charge 取浇注重量）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '灰铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r = manifest('charge').calculate({ gating: { G: 15.2 } });
      assert(r && r.pourWt === 15.2, 'gating.G fallback 应生效');
    },
  },
  {
    name: 'FINAL-4 yield 无 gating：默认出品率预估（不伪造 gating 结果）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('material.yieldSug', 70, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const y = manifest('yield').calculate({});
      assert(y.runnerWt == null || y.runnerWt >= 0, '无 gating 时 runnerWt 不造假');
      assert(y.pourWt > 10, '预估浇注重量按默认出品率');
      assert(!('G' in y), 'yield 结果不得包含伪造 gating 字段');
    },
  },
  {
    name: 'FINAL-5 报告健壮性：不完整结果不出现 undefined/NaN/空白字段',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 构造字段残缺的结果（模拟真实模块输出缺字段）
      const html = buildWorkflowReport({
        gating: { G: 15.2, t: 12.5, A: 480 },   // 缺 D_sp/L_g/L_r/gc/gt/rc/rt/v/vr
        riser: { D: 90 },                        // 缺 H/Mr_act/Mr_need/eff/Vr/d_neck
      });
      assert(!html.includes('undefined'), '报告不得出现 undefined');
      assert(!html.includes('NaN'), '报告不得出现 NaN');
      assert(html.includes('—'), '缺失字段应显示占位符 —');
    },
  },
  {
    name: 'FINAL-6 报告只含已执行模块，版本/日期/STL 信息完整（20.txt 十）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('meta.stlSession', { fingerprint: 'B.stl|999', fileName: 'B.stl', importedAt: 1 }, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const html = buildWorkflowReport({ gating: { G: 15, t: 12, A: 400, sugs: [] } });
      assert(html.includes('B.stl'), '报告含 STL 文件名');
      // PHASE 73：版本号统一到 js/version.js（原先这里写死 v0.3.0，与应用显示不一致）——
      //   断言改为引用版本常量，今后改版本号不会再让这条测试变红。
      assert(html.includes(`Casting Toolbox ${VERSION_LABEL}`), '报告含版本信息');
      assert(html.includes('Hotspot Engine V3'), '报告含算法版本');
      assert(!html.includes('熔炼加料') && !html.includes('开箱时间'), '未执行模块不出现');
      assert(/生成时间：\d{4}/.test(html), '报告含日期');
    },
  },
  {
    name: 'FINAL-7 依赖链完整：9 模块 manifest 均有明确输入声明（无静默依赖）',
    fn: () => {
      for (const c of CALC_MANIFEST) {
        assert(c.requiredInputs.length > 0, `${c.id} 缺 requiredInputs`);
        for (const p of c.requiredInputs) {
          assert(p.param || p.input, `${c.id}.${p.input} 缺 param/input 声明`);
        }
      }
    },
  },
];
