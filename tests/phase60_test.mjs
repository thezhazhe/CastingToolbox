// ============================================================
// PHASE 60（60.txt 对话指令）：gating 提示卡移到表面组元尺寸区（视图层，calcs 不涉）；
//   激冷片升级为按书中实验规则给参考尺寸（厚度≈5~10%×T、长度≈2×T），T 空不再被拦截
//   T1  激冷片参考尺寸（书 5.1.2 Wright & Campbell 1997 规则换算）
//   T2  激冷片 T 空/为 0：仍返回工程说明（不再被"请填写热节壁厚"拦截）
//   T3  激冷片文案：含尺寸规则 + 出处 + 低导热合金边界 + 防绝对化
//   T4  冷铁既有行为不变（外/内冷铁数值与 57/59 锁定一致）
// ============================================================
import { runChill } from '../calcs/chill.js';
import { CHILL_PAD } from '../data/chill_calc.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

export const tests = [
  {
    name: '60-T1 激冷片参考尺寸：厚 5~10%×T、长 2×T（T=40 → 2~4mm / 80mm）',
    fn: () => {
      const r40 = runChill({ mat: '灰铸铁', type: '激冷片（Chill Pad）', T: 40, chillMat: '铸铁冷铁' });
      assert(r40 && r40.pad && r40.padRef, 'T=40 返回 pad + padRef');
      assert(r40.padRef.thick[0] === 2 && r40.padRef.thick[1] === 4, `厚 5~10%×40（实际 ${r40.padRef.thick}）`);
      assert(r40.padRef.len === 80, `长 2×40（实际 ${r40.padRef.len}）`);
      const r80 = runChill({ mat: '铝合金', type: '激冷片（Chill Pad）', T: 80 });
      assert(r80.padRef.thick[0] === 4 && r80.padRef.thick[1] === 8 && r80.padRef.len === 160, `T=80 换算（实际 ${r80.padRef.thick}/${r80.padRef.len}）`);
      // 不含外冷铁式系数输出（thickness/recommendedMat 不出现）
      assert(r40.thickness == null && r40.recommendedMat == null && r40.deltaText == null, '无外冷铁系数输出');
    },
  },
  {
    name: '60-T2 激冷片 T 空/为 0：仍返回工程说明（不再被 T 校验拦截）',
    fn: () => {
      const r0 = runChill({ mat: '灰铸铁', type: '激冷片（Chill Pad）', T: 0 });
      assert(r0 && r0.pad && !r0.padRef, 'T=0 返回 pad（无参考值）——说明不依赖壁厚');
      const rE = runChill({ mat: '铸钢', type: '激冷片（Chill Pad）' });
      assert(rE && rE.pad && !rE.padRef, 'T 缺省同 T=0');
      // 外冷铁 T=0 仍必须被拦截（既有行为不变）
      assert(runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 0 }) === null, '外冷铁 T=0 → null 不变');
    },
  },
  {
    name: '60-T3 激冷片文案含尺寸规则/出处/低导热合金边界，防绝对化',
    fn: () => {
      const all = CHILL_PAD.tip + CHILL_PAD.source + CHILL_PAD.note + CHILL_PAD.rules.join('');
      assert(all.includes('5%~10%×T') && all.includes('2×T'), '含厚度/长度规则（书实验数据）');
      assert(all.includes('Wright & Campbell 1997'), '含出处');
      assert(all.includes('低导热合金'), '含低导热合金边界提示');
      // 防绝对化：不得出现正面绝对陈述（负面禁止句如"不能…就取消冒口"是规则本身，允许）
      assert(!all.includes('即可代替冒口') && !all.includes('应取消冒口') && !all.includes('无需补缩'), '防绝对化');
    },
  },
  {
    name: '60-T4 冷铁既有行为不变（锁定 57/59 值）',
    fn: () => {
      const ext = runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 40, chillMat: '铸铁冷铁' });
      assert(ext.thickness[0] === 10 && ext.thickness[1] === 20, `外冷铁 0.25~0.5T（实际 ${ext.thickness}）`);
      const int = runChill({ mat: '球墨铸铁', type: '内冷铁', T: 40 });
      assert(int.thickness[0] === 12 && int.thickness[1] === 20, `内冷铁 0.3~0.5T（实际 ${int.thickness}）`);
      const fb = runChill({ mat: '灰铸铁', type: '外冷铁·直接', T: 60, chillMat: '铝冷铁' });
      assert(fb.recommendedMat === '铸铁冷铁' && fb.thickness[0] === 15, `回退推荐材料（实际 ${fb.recommendedMat} ${fb.thickness}）`);
    },
  },
];
