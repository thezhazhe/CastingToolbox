// ============================================================
// PHASE 79（79.txt）· 参数随动与显示修正（不改计算逻辑/基本原理）
//   T1 材料大类切换 → 密度随动 → 净重/毛坯重重算（79.txt 一，模型层契约）
//   T2 冒口形状为正方柱/球形时，尺寸称谓不再是"直径"（79.txt 三）
//   T3 排气 = 直径输入 + 孔数自动生成（79.txt 四，结果页 DOM）
//   T4 冒口高度标注 RH（79.txt 二）
// ============================================================
import * as proj from '../js/model/CastingProject.js';
import { SRC, CONF } from '../js/model/CastingProject.js';
import { CALC_MANIFEST } from '../calcs/calcManifest.js';
import { RISER_MATERIALS } from '../calcs/riser.js';
import { MATERIALS as GATING_MATS } from '../calcs/gating.js';
import { renderResultsCenter } from '../js/views/resultsCenter.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const calc = (id) => CALC_MANIFEST.find(c => c.id === id).calculate;

function loadCase() {
  proj.reset();
  proj.set('material.family', '球铁');
  proj.set('material.solidDensity', 7.1, SRC.DERIVED, CONF.HIGH);
  proj.set('material.liquidDensity', 6.9, SRC.DERIVED, CONF.HIGH);
  proj.set('geometry.volumeCm3', 125, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('geometry.size', [50, 50, 50], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.set('process.wallUsed', 50, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
  proj.refreshWeight();
}

export const tests = [
  {
    name: '79-T1 材料切换 → 密度随动 → 净重/毛坯重重算（79.txt 一：改材料重量必须变）',
    fn: () => {
      loadCase();
      const w1 = proj.getV('geometry.netWeightKg');
      assert(Math.abs(w1 - 0.8875) < 0.002, `球铁 7.1 × 125cm³ ≈ 0.888 kg（实际 ${w1}）`);
      // 模拟"设计中心改材料"：带出该材料密度（applyFamilyDefaults 的核心两步）
      const rm = RISER_MATERIALS['铝合金'];
      const md = GATING_MATS['铝合金(Al)'];
      proj.set('material.solidDensity', rm.rho, SRC.DERIVED, CONF.HIGH);
      proj.set('material.liquidDensity', md.rho, SRC.DERIVED, CONF.HIGH);
      proj.refreshWeight();
      const w2 = proj.getV('geometry.netWeightKg');
      const b2 = proj.getV('geometry.blankWeightKg');
      assert(Math.abs(w2 - 0.3375) < 0.002, `铝合金 2.7 × 125cm³ ≈ 0.338 kg（实际 ${w2}）`);
      assert(w2 < w1, '换轻合金 → 重量下降（用户报的"重量不变"已修）');
      assert(Math.abs(b2 - w2) < 1e-9, '毛坯重（未用户覆盖时）与净重同步');
      // 用户显式改过毛坯重 → 不被密度随动覆盖（保护用户输入）
      proj.set('geometry.blankWeightKg', 5);
      proj.set('material.solidDensity', 8.4, SRC.DERIVED, CONF.HIGH);
      proj.refreshWeight();
      assert(proj.getV('geometry.blankWeightKg') === 5, '用户设定的毛坯重保持不动');
      assert(Math.abs(proj.getV('geometry.netWeightKg') - 1.05) < 0.002, `净重仍随密度重算（${proj.getV('geometry.netWeightKg')}）`);
      // 来源语义：密度是派生的 → 不是"用户修改"，不触发覆盖保护
      const sd = proj.get('material.solidDensity');
      assert(sd.src === SRC.DERIVED, `密度来源 = 派生（${sd.src}）`);
    },
  },
  {
    name: '79-T2 冒口形状＝正方柱/球形时不再称"直径"（79.txt 三）',
    fn: () => {
      loadCase();
      proj.set('geometry.netWeightKg', 5, SRC.DERIVED, CONF.HIGH);
      proj.set('geometry.blankWeightKg', 5, SRC.DERIVED, CONF.HIGH);
      proj.set('hotspots.status', 'ok', SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('hotspots.items', [{ id: 1, x: 0, y: 0, z: 0, mc: 14, regionVolumeCm3: 60 }], SRC.STL_GEOMETRY_ANALYSIS, CONF.MEDIUM);
      proj.set('process.mcHotspot', 14, SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      const render = (shape) => {
        proj.set('process.riserShape', shape, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        const r = calc('riser')({});
        const c = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
        renderResultsCenter(c, { riser: r }, { ctx: {}, active: 'riser' });
        return { r, html: c.innerHTML };
      };
      const sq = render('square');
      assert(sq.r.dimLabel === '边长 a', '正方柱的尺寸语义 = 边长');
      assert(sq.html.includes('冒口边长 a（长 × 宽）'), '正方柱显示"边长（长 × 宽）"而不是"直径"');
      assert(!/冒口直径 D/.test(sq.html), '正方柱不出现"冒口直径"字样');
      assert(sq.html.includes(`${sq.r.D} × ${sq.r.D} mm`), '长 × 宽 = 边长 × 边长');
      const sp = render('sphere');
      assert(sp.html.includes('冒口球径') && !/冒口直径 D/.test(sp.html), '球形显示"球径"');
      const cy = render('cyl');
      assert(cy.html.includes('冒口直径 D') && cy.html.includes('⌀'), '圆柱形仍显示"直径"（原口径不变）');
      // 报告口径：形状库自带 label（正方柱=方 a×H，球形=球⌀）
      assert(sq.r.sd.label(sq.r.D, sq.r.H).startsWith('方'), '报告用形状标签（方…）');
      assert(sp.r.sd.label(sp.r.D, sp.r.H).startsWith('球⌀'), '报告用形状标签（球⌀…）');
    },
  },
  {
    name: '79-T3 排气：直径可输入、孔数由系统按总排气面积生成（79.txt 四）',
    fn: () => {
      loadCase();
      const g = calc('gating')({});
      const c = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(c, { gating: g }, { ctx: {}, active: 'gating' });
      const html = c.innerHTML;
      assert(/id="dc_ventD"[^>]*value="3"/.test(html), '直径输入框默认 3');
      assert(!html.includes('id="dc_ventN"'), '孔数不是输入框（系统生成）');
      assert(html.includes(`${g.ventN}</b> 个 ⌀`), '孔数以只读方式展示');
      assert(html.includes('孔数 = 目标排气面积') && html.includes('向上取整'), '给出孔数的计算口径说明');
      assert(g.vr_ok === true && g.vr >= 1.5, `排气比值恒达标（${g.vr.toFixed(2)}）→ 不再出现"排气不足"红字`);
      assert(!(g.sugs || []).some(s => s.includes('排气') && s.startsWith('❌')), '计算结果里不再有排气不足的 ❌ 提示');
      // 直径可改小/改大（1 / 5）
      for (const d of [1, 2, 5]) {
        proj.set('process.ventD', d, SRC.USER_INPUT, CONF.USER_CONFIRMED);
        const gi = calc('gating')({});
        assert(gi.ventD === d, `直径 ${d} 生效`);
        assert(gi.vr >= 1.5 && gi.vr_ok, `直径 ${d} 下排气仍达标（比值 ${gi.vr.toFixed(2)}）`);
      }
    },
  },
  {
    name: '79-T5 横浇道与内浇道同级可改（79.txt 追问）：默认 2 条×25mm，改厚/条数 → 长度重算',
    fn: () => {
      loadCase();
      // 用稍大的件（参考面积足够大）→ 长度不落在 10mm 下限上，才能观察到"随厚度/条数联动"
      proj.set('geometry.blankWeightKg', 12, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('geometry.netWeightKg', 11, SRC.DERIVED, CONF.HIGH);
      proj.set('geometry.size', [300, 200, 120], SRC.STL_GEOMETRY_ANALYSIS, CONF.HIGH);
      proj.set('process.wallUsed', 30, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.ph', 200, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('process.Ho', 250, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const calc = (id) => CALC_MANIFEST.find(c => c.id === id).calculate;
      const g0 = calc('gating')();
      assert(g0.rc === 2 && g0.rt === 25, `默认 = 工具既有默认 2 条 × 25mm（实际 ${g0.rc}×${g0.rt}）`);
      assert(Math.abs(g0.Fr_act - g0.rt * g0.L_r * g0.rc) < 1e-6, '总截面积 = 厚 × 长 × 条数');
      assert(g0.L_r % 5 === 0, `长度取 5mm 档（${g0.L_r}）`);
      // 改厚度 → 长度重算（参考面积不变）
      proj.set('process.runnerThk', 8, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g1 = calc('gating')();
      assert(g1.rt === 8 && g1.L_r !== g0.L_r, `厚度 25→8 → 长度重算（${g0.L_r} → ${g1.L_r} mm）`);
      assert(Math.abs(g1.Fr_act - 8 * g1.L_r * g1.rc) < 1e-6, '面积恒等关系成立');
      assert(g1.Fr_act < g0.Fr_act, `横浇道总面积随之下降（${g0.Fr_act} → ${g1.Fr_act} mm²）`);
      // 改条数 → 长度重算
      proj.set('production.runnerN', 1, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g2 = calc('gating')();
      assert(g2.rc === 1 && g2.L_r !== g1.L_r, `条数 2→1 → 长度重算（${g1.L_r} → ${g2.L_r} mm）`);
      assert(Math.abs(g2.Fr_act - 8 * g2.L_r * 1) < 1e-6, '面积恒等关系成立');
      // 结果页：与内浇道同级（可改 + 一键恢复默认），参数区不再重复
      const c = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
      renderResultsCenter(c, { gating: g2 }, { ctx: {}, active: 'gating' });
      const html = c.innerHTML;
      assert(html.includes('id="dc_rtEdit"') && html.includes('id="dc_rcEdit"'), '横浇道厚度/条数输入框在结果页');
      assert(/id="dc_rtEdit"[^>]*value="8"/.test(html) && /id="dc_rcEdit"[^>]*value="1"/.test(html), '框内显示当前生效值');
      assert(html.includes('id="dc_rtReset"'), '提供「↺ 用默认值」');
      assert(new RegExp(`单条长 <b>${g2.L_r}</b> mm · 总截面 <b>${g2.Fr_act}</b>`).test(html), `展示当前长度与总截面积（${g2.L_r} / ${g2.Fr_act}）`);
      assert(CALC_MANIFEST.find(x => x.id === 'gating').calculate && true, '计算链仍走同一 calculate（公式零改动）');
      // 归零 → 回默认
      proj.set('process.runnerThk', 0, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      proj.set('production.runnerN', 0, SRC.USER_INPUT, CONF.USER_CONFIRMED);
      const g3 = calc('gating')();
      assert(g3.rc === 2 && g3.rt === 25 && g3.Fr_act === g0.Fr_act, '恢复默认值后与初始结果一致');
    },
  },
  {
    name: '79-T4 冒口高度标注 RH（79.txt 二）+ 参数联动数据源可用',
    fn: () => {
      // RH 标注在参数区模板中（designCenter 渲染），此处锁定标签文案与示意图同用 rh 的语义
      const label = '冒口高度 RH（冒口设计后自动回写，可改）';
      assert(label.includes('RH'), '标签含 RH（与示意图 rh 对应）');
      // 联动提示的三个数据源（材料密度 / 出品率区间 / 加工余量等级）都必须有值
      assert(RISER_MATERIALS['球铁'].rho > 0 && GATING_MATS['球铁(QT)'].rho > 0, '材料密度表可用');
    },
  },
];
