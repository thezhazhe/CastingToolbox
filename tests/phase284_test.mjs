// ============================================================
// PHASE 28.4：验收审计中发现问题的确定性修复回归
// 覆盖（40.txt §九 允许修复范围）：
//   1. RUN_ORDER：riser 前置 gating（Hp 方案 A 回写闭环首轮生效）
//   2. clearStlBoundData 清理 process.riserHeight（替换 STL 旧冒口高不残留）
//   3. riser 无热结时用户显式 mcHotspot 优先（输入不再被静默忽略）
//   4. charge 不支持牌号 → 明确 unsupported 标记（不再 TypeError 被吞静默消失）
//   5. defaultCharge 对未知牌号返回 null（防护，不抛错）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { CALC_MANIFEST, RUN_ORDER } from '../calcs/calcManifest.js';
import { defaultCharge } from '../calcs/charge.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const manifest = (id) => CALC_MANIFEST.find(c => c.id === id);

export const tests = [
  {
    name: '28.4-1 RUN_ORDER：riser 在 gating 前（Hp 方案 A 回写闭环首轮生效）',
    fn: () => {
      const i = (id) => RUN_ORDER.indexOf(id);
      assert(RUN_ORDER.length === 9, `RUN_ORDER 应含 9 项（实际 ${RUN_ORDER.length}）`);
      assert(i('riser') >= 0 && i('gating') >= 0, 'riser/gating 应在顺序中');
      assert(i('riser') < i('gating'), `riser(${i('riser')}) 必须先于 gating(${i('gating')})`);
      assert(i('gating') < i('yield') && i('riser') < i('yield'), 'yield 依赖 gating+riser，必须在其后');
      assert(i('yield') < i('charge'), 'charge 依赖 yield/gating，必须在其后');
      // riser/gating 均不消费 results（无 results 依赖 → 顺序调整不破坏任何计算器）
      assert(manifest('riser').calculate.length === 0, 'riser calculate 不应接收 results');
      assert(manifest('gating').calculate.length === 0, 'gating calculate 不应接收 results');
      // 所有 id 均有 manifest 条目（顺序中无幽灵项）
      assert(RUN_ORDER.every(id => manifest(id)), 'RUN_ORDER 每项都应有 manifest');
    },
  },
  {
    name: '28.4-2 clearStlBoundData 清理 process.riserHeight（CALC_RESULT 清 / USER_INPUT 保留）',
    fn: () => {
      proj.reset();
      proj.set('process.riserHeight', 240, proj.SRC.CALC_RESULT, proj.CONF.HIGH);
      proj.set('geometry.volumeCm3', 1000, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const cleared = proj.clearStlBoundData();
      assert(cleared.includes('process.riserHeight'), `riserHeight(CALC_RESULT) 应被清理（实际清 ${cleared.join(',')}）`);
      assert(proj.getV('process.riserHeight') === 0, 'riserHeight 应归零');
      // USER_INPUT（用户手动填预估）保留
      proj.reset();
      proj.set('process.riserHeight', 180, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.volumeCm3', 1000, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const cleared2 = proj.clearStlBoundData();
      assert(!cleared2.includes('process.riserHeight'), 'USER_INPUT 的 riserHeight 应保留');
      assert(proj.getV('process.riserHeight') === 180, 'USER_INPUT 值不应变');
    },
  },
  {
    name: '28.4-3 riser 无热结时用户显式 mcHotspot 优先（输入不再被静默忽略）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '球铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 10, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      proj.set('process.wallHot', 12, proj.SRC.DERIVED, proj.CONF.MEDIUM);
      // 无热结 + mcHotspot 未填（DEFAULT 0）→ 用 wallHot
      const r1 = manifest('riser').calculate();
      assert(r1 && Math.abs(r1.Mc - 12) < 1e-9, `无热结默认应取 wallHot=12（实际 ${r1?.Mc}）`);
      // 无热结 + 用户显式填 mcHotspot=15（USER_OVERRIDE）→ 用户值优先
      proj.set('process.mcHotspot', 15, proj.SRC.USER_OVERRIDE, proj.CONF.USER_CONFIRMED);
      const r2 = manifest('riser').calculate();
      assert(r2 && Math.abs(r2.Mc - 15) < 1e-9, `无热结+用户显式 mcHotspot 应取 15（实际 ${r2?.Mc}）`);
      // 无热结 + mcHotspot 是自动来源（STL_GEOMETRY_ANALYSIS）→ 仍用 wallHot（自动值不误用）
      proj.set('process.mcHotspot', 30, proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.HIGH);
      const r3 = manifest('riser').calculate();
      assert(r3 && Math.abs(r3.Mc - 12) < 1e-9, `无热结+自动 mcHotspot 仍应取 wallHot=12（实际 ${r3?.Mc}）`);
      // 有热结 → 仍用 mcHotspot（原有语义不变；PHASE 29 门禁要求完整状态 status+items）
      proj.set('hotspots.status', 'ok', proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      proj.set('hotspots.items', [{ id: 1, mc: 30 }], proj.SRC.STL_GEOMETRY_ANALYSIS, proj.CONF.MEDIUM);
      const r4 = manifest('riser').calculate();
      assert(r4 && Math.abs(r4.Mc - 30) < 1e-9, `有热结应取 mcHotspot=30（实际 ${r4?.Mc}）`);
    },
  },
  {
    name: '28.4-4 charge 不支持牌号 → unsupported 标记（不抛错、不静默）',
    fn: () => {
      proj.reset();
      proj.set('material.family', '铸钢', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      proj.set('geometry.blankWeightKg', 100, proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      // 模拟 designCenter 执行链：gating 结果 → charge（results 传入）
      const r = manifest('charge').calculate({ gating: { G: 150 } });
      assert(r && r.unsupported === true, `铸钢应返回 unsupported 标记（实际 ${JSON.stringify(r)}）`);
      assert(typeof r.note === 'string' && r.note.includes('暂不支持'), '应含明确提示文案');
      assert(r.defGrade === 'ZG230', 'defGrade 应保留供 UI 展示');
      // 灰铁（HT200 支持）不受影响
      proj.set('material.family', '灰铁', proj.SRC.USER_INPUT, proj.CONF.USER_CONFIRMED);
      const ok = manifest('charge').calculate({ gating: { G: 150 } });
      assert(ok && ok.unsupported === undefined && ok.allOk !== undefined, `灰铁应正常计算（实际 ${JSON.stringify(ok)?.slice(0, 80)}）`);
    },
  },
  {
    name: '28.4-5 defaultCharge 对未知牌号返回 null（防护，不抛 TypeError）',
    fn: () => {
      assert(defaultCharge('ZG230', 100) === null, 'ZG230 不在数据表 → null');
      assert(defaultCharge('ZL104', 100) === null, 'ZL104 不在数据表 → null');
      assert(defaultCharge('ZCuSn10P1', 100) === null, 'ZCuSn10P1 不在数据表 → null');
      const ht = defaultCharge('HT200', 100);
      assert(ht && ht.grade === 'HT200' && ht.totalWt === 100, 'HT200 正常配方');
    },
  },
];
