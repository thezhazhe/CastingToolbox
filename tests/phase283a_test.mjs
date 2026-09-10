// ============================================================
// PHASE 28.3-A canonical 参数语义测试
// 背景：density/weightKg/mcUsed/rh 语义混乱（PHASE 28 审计 P0-2/3/4、P1-10/16/17）
// 目标：
//   - 旧项目迁移：material.density → liquidDensity/solidDensity（同值）
//     geometry.weightKg → netWeightKg/blankWeightKg（同值）
//     process.mcUsed → mcHotspot/wallHot（同值）
//   - 消费者读取：riser 有热结用 mcHotspot、无热结用 wallHot；chill 独立 T_hot
//   - 数值不变性：迁移后各计算器结果与旧口径一致
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifest = (id) => CALC_MANIFEST.find(c => c.id === id);

/** 构造旧结构项目对象（PHASE 28.3-A 之前的字段） */
function oldProject() {
  const mk = (v, src = 'DEFAULT', conf = 'medium') => ({ v, src, conf, editable: true });
  return {
    material: { family: mk('灰铁'), grade: mk(''), density: mk(7.0, 'SCENARIO', 'medium') },
    geometry: {
      volumeCm3: mk(1000, 'STL_GEOMETRY_ANALYSIS', 'high'),
      weightKg: mk(7.0, 'DERIVED', 'high'),
    },
    process: { mcUsed: mk(10, 'STL_GEOMETRY_ANALYSIS', 'high') },
    production: {}, hotspots: {}, runner: {}, risers: {}, yield: {}, results: {},
  };
}

export const tests = [
  {
    name: '28.3-A-1 迁移：旧字段同值拆分（数值不变）',
    fn: () => {
      const p = proj.migrateProject(oldProject());
      // 密度拆分
      assert(p.material.liquidDensity.v === 7.0, 'liquidDensity 应 = 旧 density');
      assert(p.material.solidDensity.v === 7.0, 'solidDensity 应 = 旧 density');
      assert(p.material.liquidDensity.src === 'SCENARIO', '来源元数据保留');
      assert(p.material.density === undefined, '旧 material.density 应被移除');
      // 重量拆分
      assert(p.geometry.netWeightKg.v === 7.0 && p.geometry.netWeightKg.src === 'DERIVED', 'netWeightKg 应 = 旧 weightKg');
      assert(p.geometry.blankWeightKg.v === 7.0, 'blankWeightKg 应 = 旧 weightKg');
      assert(p.geometry.weightKg === undefined, '旧 geometry.weightKg 应被移除');
      // Mc 拆分
      assert(p.process.mcHotspot.v === 10 && p.process.wallHot.v === 10, 'mcHotspot/wallHot 应 = 旧 mcUsed');
      assert(p.process.mcUsed === undefined, '旧 process.mcUsed 应被移除');
      // 新字段由 defaultProject 提供（真实 load = defaultProject 合并后迁移）
      assert(proj.get('process.riserHeight') !== null, 'riserHeight 字段应由 defaultProject 提供');
      assert(proj.get('process.chillT') !== null, 'chillT 字段应由 defaultProject 提供');
    },
  },
  {
    name: '28.3-A-2 riser 消费：无热结用 wallHot，有热结用 mcHotspot',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      // 无热结：wallHot=12
      proj.set('process.wallHot', 12, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      proj.set('process.mcHotspot', 30, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r1 = manifest('riser').calculate();
      assert(r1 && Math.abs(r1.Mc - 12) < 1e-9, `无热结应取 wallHot=12（实际 ${r1?.Mc}）`);
      // 有热结：mcHotspot=30（PHASE 29 门禁要求完整状态——writeHotspotsToProject 写 status+items）
      proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 30 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r2 = manifest('riser').calculate();
      assert(r2 && Math.abs(r2.Mc - 30) < 1e-9, `有热结应取 mcHotspot=30（实际 ${r2?.Mc}）`);
    },
  },
  {
    name: '28.3-A-3 chill 独立 T_hot：默认 2×模数（数值不变），用户可独立覆盖',
    fn: () => {
      proj.reset();
      proj.set('material.family', '灰铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.wallHot', 10, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      proj.set('process.chillT', 0, proj.SRC.DEFAULT, proj.CONF.LOW);
      const c1 = manifest('chill').calculate();
      assert(c1 && Array.isArray(c1.thickness), `chillT 缺省应自动 = 2×wallHot=20 并算出厚度（实际 ${JSON.stringify(c1)}）`);
      // 用户显式 chillT=25 → 厚度按 25/20 放大（系数×T 线性；mid 有 0.1 四舍五入 → 容差 2%）
      proj.set('process.chillT', 25, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const c2 = manifest('chill').calculate();
      assert(c2 && Math.abs(c2.mid / c1.mid - 25 / 20) < 0.02, `显式 chillT=25 应线性生效（实际 mid=${c2?.mid} vs 默认 mid=${c1?.mid}）`);
      // chillT 不污染 riser：riser 仍读 wallHot=10
      const r = manifest('riser').calculate();
      assert(r && Math.abs(r.Mc - 10) < 1e-9, 'chillT 独立后 riser 仍读 wallHot');
    },
  },
  {
    name: '28.3-A-4 gating 读毛坯重 + riserHeight 接线（默认 0 → 顶注 Hp 不变）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '灰铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 46.8, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('production.cavities', 2, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.wallUsed', 37.5, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.pourPos', '顶注', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.Ho', 180, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.ph', 76, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('process.riserHeight', 0, proj.SRC.DEFAULT, proj.CONF.LOW);
      const g = manifest('gating').calculate();
      assert(g && g.pw === 46.8, `pw 应读 blankWeightKg（实际 ${g?.pw}）`);
      assert(g && g.rh === 0, 'riserHeight 默认 0');
    },
  },
];
