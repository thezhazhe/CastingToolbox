// ============================================================
// PHASE 28.7-A（44.txt）：密度参数最终定稿验收
//   批准：solidDensity 球铁 6.9→7.1、铝 2.6→2.7（灰铁/铸钢/铜保持）
//         liquidDensity 全部保持 PHASE 28.6 原值（企业工艺参数）
//   验证：五材料两表 / STL→volume→weightKg 链 / gating 用液态 / riser 用固态 /
//         USER_OVERRIDE / mdFellBack / 单位体系
// ============================================================
import { RISER_MATERIALS, runRiser } from '../calcs/riser.js';
import { MATERIALS as GATING_MATS, runGating } from '../calcs/gating.js';
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifestOf = (id) => CALC_MANIFEST.find(c => c.id === id);

/** 期望表（44.txt 批准值） */
const SOLID = { 灰铁: 7.0, 球铁: 7.1, 铸钢: 7.8, 铝合金: 2.7, 铜合金: 8.4 };
const LIQUID = { '灰铁(HT)': 7.0, '球铁(QT)': 6.9, '铸钢(ZG)': 7.5, '铝合金(Al)': 2.6, '铜合金(Cu)': 8.4 };

function riserSetup(fam) {
  proj.reset();
  proj.set('material.family', fam, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
  proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('process.mcHotspot', 20, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
  proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
  proj.set('hotspots.items', [{ id: 1, mc: 20, confidence: 0.9 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
}

export const tests = [
  {
    name: '28.7-A1 solidDensity 定稿：五材料 riser 表正确（球铁 7.1、铝 2.7，其余保持）',
    fn: () => {
      for (const [mat, expect] of Object.entries(SOLID)) {
        assert(RISER_MATERIALS[mat].rho === expect, `${mat} solidDensity 应 ${expect}（实际 ${RISER_MATERIALS[mat].rho}）`);
      }
    },
  },
  {
    name: '28.7-A2 liquidDensity 保持：五材料 gating 表全部 PHASE 28.6 原值（未误改液态）',
    fn: () => {
      for (const [mat, expect] of Object.entries(LIQUID)) {
        assert(GATING_MATS[mat].rho === expect, `${mat} liquidDensity 应保持 ${expect}（实际 ${GATING_MATS[mat].rho}）`);
      }
    },
  },
  {
    name: '28.7-A3 STL→volume→weightKg 链：净重=体积×solidDensity/1000（单位体系不变）',
    fn: () => {
      proj.reset();
      proj.set('material.solidDensity', 7.1, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
      proj.set('geometry.volumeCm3', 800, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.refreshWeight();
      assert(Math.abs(proj.getV('geometry.netWeightKg') - 800 * 7.1 / 1000) < 1e-6,
        `净重应=体积×固态密度/1000（${proj.getV('geometry.netWeightKg')} vs ${800 * 7.1 / 1000}）`);
      // 毛坯默认同步净重（未手动覆盖）
      assert(Math.abs(proj.getV('geometry.blankWeightKg') - 800 * 7.1 / 1000) < 1e-6, '毛坯默认同步净重');
    },
  },
  {
    name: '28.7-A4 gating 用液态密度（内部表）：材料切换写入 liquidDensity，gating 结果 rho 与液态表一致',
    fn: () => {
      // designCenter 材料切换逻辑（1161 行）：liquidDensity 写 GATING_MATS 值、solidDensity 写 RISER_MATERIALS 值
      for (const [fam, gKey, rKey] of [['球铁', '球铁(QT)', '球铁'], ['铝合金', '铝合金(Al)', '铝合金']]) {
        proj.reset();
        proj.set('material.family', fam, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
        // 模拟 designCenter 同步（同值同源）
        proj.set('material.liquidDensity', GATING_MATS[gKey].rho, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
        proj.set('material.solidDensity', RISER_MATERIALS[rKey].rho, proj.SRC.SCENARIO, proj.CONF.MEDIUM);
        assert(Math.abs(proj.getV('material.liquidDensity') - LIQUID[gKey]) < 1e-9, `${fam} 液态=${LIQUID[gKey]}`);
        assert(Math.abs(proj.getV('material.solidDensity') - SOLID[rKey]) < 1e-9, `${fam} 固态=${SOLID[rKey]}`);
        // gating 计算用液态表（manifest 默认不覆盖 → 内部表）
        proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
        const g = manifestOf('gating').calculate();
        assert(Math.abs(g.rho - LIQUID[gKey]) < 1e-9, `gating rho 应=液态表 ${LIQUID[gKey]}（实际 ${g.rho}）`);
      }
    },
  },
  {
    name: '28.7-A5 riser 用固态密度：五材料 rhoUsed 与定稿 solidDensity 一致',
    fn: () => {
      for (const [fam, expect] of Object.entries(SOLID)) {
        riserSetup(fam);
        const r = manifestOf('riser').calculate();
        assert(r && Math.abs(r.rhoUsed - expect) < 1e-9,
          `${fam} riser rhoUsed 应 ${expect}（实际 ${r?.rhoUsed}）`);
      }
    },
  },
  {
    name: '28.7-A6 USER_OVERRIDE 仍有效：液态/固态密度显式覆盖均生效',
    fn: () => {
      // 液态（28.6-A2 保持）
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('material.liquidDensity', 7.2, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const g = manifestOf('gating').calculate();
      assert(g && Math.abs(g.rho - 7.2) < 1e-9, '液态 USER_OVERRIDE 应生效');
      // 固态
      riserSetup('球铁');
      proj.set('material.solidDensity', 7.3, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const r = manifestOf('riser').calculate();
      assert(r && Math.abs(r.rhoUsed - 7.3) < 1e-9, '固态 USER_OVERRIDE 应生效');
    },
  },
  {
    name: '28.7-A7 fallback + mdFellBack 仍有效：未知材料标记、数值用默认材料定稿值',
    fn: () => {
      const g = runGating({ mat: '未知材料', pw: 10 });
      assert(g.mdFellBack === true, 'gating fallback 标记');
      assert(g.rho === 7.0, 'gating fallback=灰铁 7.0（液态保持）');
      const r = runRiser({ mat: '未知材料', mc_mode: 'direct', mc: 20, cast_wt: 10, shape: 'sphere_head', hd_ratio: 1.0 });
      assert(r && r.mdFellBack === true, 'riser fallback 标记');
      assert(r.rhoUsed === 7.1, 'riser fallback=球铁 7.1（28.7-A 定稿值）');
    },
  },
];
