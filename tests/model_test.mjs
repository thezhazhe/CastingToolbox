// ============================================================
// CastingProject 数据模型回归：参数元数据（value/source/confidence/editable）
// ============================================================
import * as proj from '../js/model/CastingProject.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: 'get/set 参数与元数据',
    fn: () => {
      proj.set('geometry.volumeCm3', 125.0, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const p = proj.get('geometry.volumeCm3');
      assert(p.v === 125.0, '值应可读');
      assert(p.src === 'STL_GEOMETRY_ANALYSIS', `来源应为 STL_GEOMETRY_ANALYSIS，实际 ${p.src}`);
      assert(p.conf === 'high', '置信度应为 high');
      assert(p.editable === true, '自动参数应可编辑（命令3 第12节）');
    },
  },
  {
    name: '用户修改自动值 → 标记 USER_OVERRIDE（命令3 第12节）',
    fn: () => {
      // 先置为自动来源
      proj.set('geometry.wallMax', 46.2, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 用户改值但不指定来源 → 应标记为 USER_OVERRIDE
      proj.set('geometry.wallMax', 50);
      const p = proj.get('geometry.wallMax');
      assert(p.v === 50, '用户值应生效');
      assert(p.src === 'USER_OVERRIDE', `应为 USER_OVERRIDE，实际 ${p.src}`);
      assert(p.conf === 'user_confirmed', '用户确认后置信度应为 user_confirmed');
    },
  },
  {
    name: '重量派生：体积×固态密度，且用户手动改后不再被自动覆盖（PHASE 28.3-A 双字段）',
    fn: () => {
      proj.set('geometry.volumeCm3', 100);       // 100 cm³
      proj.set('material.solidDensity', 7.0);     // 灰铁固态 7.0 g/cm³
      proj.refreshWeight();
      assert(Math.abs(proj.getV('geometry.netWeightKg') - 0.7) < 1e-9, `净重应为 0.7kg，实际 ${proj.getV('geometry.netWeightKg')}`);
      assert(Math.abs(proj.getV('geometry.blankWeightKg') - 0.7) < 1e-9, `毛坯默认应同步 0.7kg，实际 ${proj.getV('geometry.blankWeightKg')}`);
      // 用户手改毛坯
      proj.set('geometry.blankWeightKg', 1.2);
      proj.refreshWeight();                        // 再刷新不得覆盖用户值
      assert(proj.getV('geometry.blankWeightKg') === 1.2, '用户修改的毛坯重量不应被自动刷新覆盖（CastEyes Bug 防线）');
      assert(Math.abs(proj.getV('geometry.netWeightKg') - 0.7) < 1e-9, '净重仍为派生值 0.7kg（毛坯独立可改）');
    },
  },
  {
    name: '结果写回使用 CALC_RESULT 来源',
    fn: () => {
      proj.setResult('runner.result', { t: 12.3 });
      assert(proj.get('runner.result').src === 'CALC_RESULT', '结果来源应为 CALC_RESULT');
    },
  },
];
