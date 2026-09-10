// ============================================================
// PHASE 16-B 测试（18.txt 七：STL 生命周期 16-B-1 ~ 16-B-11）
// 验证 CastingProject.clearStlBoundData / stlSessionCheck 的清理语义：
//   替换 = STL 绑定数据全清 + USER_INPUT 保留 + 强绑定 USER_OVERRIDE 清
//   删除 = 无幽灵参数残留，可回手动模式
//   刷新 = stlSessionCheck 检测失效会话并清理（防幽灵 STL）
//   旧结果 = 不冒充新模型（runner/risers/yield 清空）
// designCenter 的 DOM 交互（按钮/视图）由字段契约保证，数据层在此全覆盖。
// ============================================================
import * as proj from '../js/model/CastingProject.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** 模拟 STL A 导入 + 计算完成后的完整项目状态 */
function simulateStlA() {
  proj.set('meta.stlSession', { fingerprint: 'A.stl|12345', fileName: 'A.stl', importedAt: 1 }, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.valid', true, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.triCount', 1000, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.size', [300, 200, 100], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.bounds', { min: [-150, -100, -50], max: [150, 100, 50] }, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.center', [0, 0, 0], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.volumeCm3', 1000, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.areaCm2', 600, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.wallMax', 20, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.wallAvg', 12, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('geometry.netWeightKg', 7.0, proj.SRC.DERIVED, proj.CONF.HIGH);     // refreshWeight 产物（PHASE 28.3-A 双字段）
  proj.set('geometry.blankWeightKg', 7.0, proj.SRC.DERIVED, proj.CONF.HIGH);
  proj.set('process.wallUsed', 12, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('process.mcHotspot', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);   // 有热结 → mcHotspot
  proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('hotspots.items', [{ id: 1, x: 0, y: 0, z: 50, mc: 10 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
  // 旧计算结果（18.txt 六：必须清）
  proj.set('runner.result', { G: 29.4 }, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
  proj.set('risers.items', [{ D: 50 }], proj.SRC.CALC_RESULT, proj.CONF.HIGH);
  proj.set('yield.result', { castWt: 7 }, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
  // 与 STL 无关的用户输入（必须保留）
  proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
  proj.set('production.cavities', 2, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
  proj.set('production.qty', 1000, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
  proj.set('process.pourPos', '顶注', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
}

export const tests = [
  {
    name: '16-B-1 导入语义：meta.stlSession 会话绑定可写读',
    fn: () => {
      proj.reset();
      proj.set('meta.stlSession', { fingerprint: 'A.stl|12345', fileName: 'A.stl', importedAt: 1 }, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const s = proj.get('meta.stlSession').v;
      assert(s?.fingerprint === 'A.stl|12345', '指纹应可读');
      assert(s.fileName === 'A.stl', '文件名应可读');
      assert(proj.get('meta.stlSession').src === 'STL_GEOMETRY_ANALYSIS', '会话绑定来源应为 STL');
    },
  },
  {
    name: '16-B-2 替换：STL A → STL B 后 A 的全部自动参数清空，USER_INPUT 保留',
    fn: () => {
      proj.reset();
      simulateStlA();
      const cleared = proj.clearStlBoundData();
      assert(cleared.includes('meta.stlSession'), '会话绑定应清理');
      assert(proj.getV('geometry.triCount') === 0, 'triCount 应清 0');
      assert(JSON.stringify(proj.getV('geometry.size')) === '[0,0,0]', 'size 应清 [0,0,0]');
      assert(proj.getV('geometry.volumeCm3') === 0, 'volumeCm3 应清 0');
      assert(proj.getV('geometry.netWeightKg') === 0, 'netWeightKg 应清 0（STL 体积派生）');
      assert(proj.getV('geometry.blankWeightKg') === 0, 'blankWeightKg 应清 0');
      assert(proj.getV('process.wallUsed') === 0, 'wallUsed 应清 0（强绑定 STL 几何）');
      assert(proj.getV('process.mcHotspot') === 0, 'mcHotspot 应清 0');
      assert(proj.getV('hotspots.items').length === 0, 'hotspots 应清空');
      assert(proj.getV('hotspots.status') === 'none', 'hotspots.status 回 none');
      // USER_INPUT 保留（18.txt 二：与 STL 无关的用户输入不因更换 STL 清空）
      assert(proj.getV('material.family') === '球铁', 'material.family 应保留');
      assert(proj.getV('production.cavities') === 2, 'production.cavities 应保留');
      assert(proj.getV('production.qty') === 1000, 'production.qty 应保留');
      assert(proj.getV('process.pourPos') === '顶注', 'process.pourPos 应保留');
      // 清理后体积/重量可重新写入（B 的新值，无 A 残留）
      proj.set('geometry.volumeCm3', 2000, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.refreshWeight();
      assert(proj.getV('geometry.volumeCm3') === 2000, 'B 体积可写入');
    },
  },
  {
    name: '16-B-3 替换：用户改过的 STL 自动参数（USER_OVERRIDE）不带到新 STL',
    fn: () => {
      proj.reset();
      simulateStlA();
      // 用户在 STL A 上修改自动值 → USER_OVERRIDE（18.txt 二：强绑定 STL 几何）
      proj.set('process.wallUsed', 15);
      proj.set('process.mcHotspot', 13);
      proj.set('geometry.blankWeightKg', 8.5);
      proj.set('geometry.volumeCm3', 1200);
      assert(proj.get('process.wallUsed').src === 'USER_OVERRIDE', '前置：wallUsed 应为 USER_OVERRIDE');
      proj.clearStlBoundData();
      assert(proj.getV('process.wallUsed') === 0, 'USER_OVERRIDE wallUsed 应清（强绑定）');
      assert(proj.getV('process.mcHotspot') === 0, 'USER_OVERRIDE mcHotspot 应清');
      assert(proj.getV('geometry.blankWeightKg') === 0, 'USER_OVERRIDE blankWeightKg 应清');
      assert(proj.getV('geometry.volumeCm3') === 0, 'USER_OVERRIDE volumeCm3 应清');
      // 用户未修改的自动参数同样清（B 重新生成）
      assert(proj.getV('geometry.wallMax') === 0, 'wallMax 应清');
    },
  },
  {
    name: '16-B-4/10 替换：旧计算结果不冒充新模型结果',
    fn: () => {
      proj.reset();
      simulateStlA();
      proj.clearStlBoundData();
      assert(proj.getV('runner.result') === null, 'runner.result 应清（旧浇注系统结果）');
      assert(proj.getV('risers.items').length === 0, 'risers.items 应清（旧冒口结果）');
      assert(proj.getV('yield.result') === null, 'yield.result 应清（旧出品率结果）');
    },
  },
  {
    name: '16-B-5/11 删除：无幽灵参数残留，可立即回到手动模式',
    fn: () => {
      proj.reset();
      simulateStlA();
      proj.clearStlBoundData();
      // 幽灵检查：所有 STL 来源参数应为空/默认
      assert(proj.getV('geometry.valid') === false, 'valid 应为 false');
      assert(proj.getV('geometry.triCount') === 0, 'triCount 为 0');
      assert(proj.getV('geometry.bounds') === null, 'bounds 为 null');
      assert(proj.getV('geometry.center') === null, 'center 为 null');
      assert(proj.getV('hotspots.items').length === 0, 'hotspots 空');
      assert(proj.get('meta.stlSession').v === null, '会话绑定为 null');
      // 手动模式可继续：用户可直接填写
      proj.set('geometry.volumeCm3', 500, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      assert(proj.getV('geometry.volumeCm3') === 500, '手动输入可用');
      assert(proj.get('geometry.volumeCm3').src === 'USER_INPUT', '手动输入来源正确');
    },
  },
  {
    name: '16-B-7 刷新：stlSessionCheck 检测失效会话并清理（防幽灵 STL）',
    fn: () => {
      proj.reset();
      simulateStlA();
      // 刷新后内存 mesh 丢失 → 校验应清理
      const r = proj.stlSessionCheck(false);
      assert(r.stale === true, '应检测到失效 STL 会话');
      assert(r.cleared === true, '应执行清理');
      assert(proj.getV('geometry.triCount') === 0, '刷新后 triCount 无幽灵');
      assert(proj.getV('hotspots.items').length === 0, '刷新后 hotspots 无幽灵');
      assert(proj.getV('material.family') === '球铁', '刷新后用户输入保留');
      // 再次校验（已清理）→ 不重复清理
      const r2 = proj.stlSessionCheck(false);
      assert(r2.stale === false && r2.cleared === false, '二次校验应为干净状态');
    },
  },
  {
    name: '16-B-7b 刷新：同页路由切换（mesh 在内存）→ 会话有效，不动',
    fn: () => {
      proj.reset();
      simulateStlA();
      const r = proj.stlSessionCheck(true);
      assert(r.stale === false && r.cleared === false, 'mesh 在内存时应保持会话');
      assert(proj.getV('geometry.triCount') === 1000, '数据不应被清');
    },
  },
  {
    name: '16-B-8 替换：手动模式 USER_INPUT（体积/壁厚/Mc）不受 STL 清理影响',
    fn: () => {
      proj.reset();
      // 手动模式：无 STL 会话，全部 USER_INPUT
      proj.set('geometry.volumeCm3', 800, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 5.6, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.wallUsed', 18, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.wallHot', 9, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.clearStlBoundData();
      assert(proj.getV('geometry.volumeCm3') === 800, '手动体积应保留');
      assert(proj.getV('geometry.blankWeightKg') === 5.6, '手动毛坯重量应保留');
      assert(proj.getV('process.wallUsed') === 18, '手动 wallUsed 应保留（与 STL 无关）');
      assert(proj.getV('process.wallHot') === 9, '手动 wallHot 应保留');
    },
  },
  {
    name: '16-B-9 污染专项：手动体积派生的重量不受 STL 清理影响',
    fn: () => {
      proj.reset();
      // 手动体积（USER_INPUT）+ refreshWeight 派生重量（DERIVED）
      proj.set('geometry.volumeCm3', 800, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('material.solidDensity', 7.0, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      proj.refreshWeight();
      assert(proj.get('geometry.netWeightKg').src === 'DERIVED', '前置：净重为 DERIVED');
      assert(proj.get('geometry.blankWeightKg').src === 'DERIVED', '前置：毛坯为 DERIVED');
      proj.clearStlBoundData();
      assert(proj.getV('geometry.netWeightKg') > 0, '手动体积派生的净重应保留（源 volume 是 USER_INPUT）');
      assert(proj.getV('geometry.blankWeightKg') > 0, '手动体积派生的毛坯应保留');
      assert(proj.getV('geometry.volumeCm3') === 800, '手动体积保留');
    },
  },
  {
    name: '16-B-9b 污染专项：STL 体积派生的重量随替换清除',
    fn: () => {
      proj.reset();
      proj.set('geometry.volumeCm3', 1000, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('material.solidDensity', 7.0, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      proj.refreshWeight();
      assert(proj.get('geometry.netWeightKg').src === 'DERIVED', '前置：净重为 DERIVED（源=STL 体积）');
      proj.clearStlBoundData();
      assert(proj.getV('geometry.netWeightKg') === 0, 'STL 体积派生的净重必须随替换清除');
      assert(proj.getV('geometry.blankWeightKg') === 0, 'STL 体积派生的毛坯必须随替换清除');
      assert(proj.getV('geometry.volumeCm3') === 0, 'STL 体积清除');
    },
  },
];
