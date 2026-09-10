// ============================================================
// 熔炼加料计算 · 逻辑层（纯函数）
// 输入：牌号 + 铁液总重 + 各料成分对象/加入量/吸收率
// 输出：原铁液/成铁成分对照 + CE + 每元素差额 + 补料建议
// ============================================================
import { CHARGE_TARGETS, CHARGE_MATERIALS, CHARGE_DEFAULTS, returnComposition, chargeFamily, carbonEquivalent } from '../data/charge_calc.js';

const ELEMS = ['C', 'Si', 'Mn', 'P', 'S'];

/** 默认配方：按牌号族生成比例 → kg（合金/处理剂为 0）；牌号不在数据表 → null（调用方明确提示，不抛错） */
export function defaultCharge(grade, totalWt = 1000) {
  const d = CHARGE_DEFAULTS[chargeFamily(grade)];
  const t = CHARGE_TARGETS[grade];
  if (!t) return null;
  return {
    grade, totalWt,
    pigKey: d.pig, scrapKey: d.scrap,
    pigPct: d.pigPct, scrapPct: d.scrapPct, retPct: d.retPct,
    feSiKey: 'feSi75', feMnKey: 'feMn65', carbKey: 'carb95',
    feSi: 0, feMn: 0, carb: 0,
    spheroKey: '稀土镁 Mg5.5', inocKey: '75硅铁',
    sphero: t.addons ? +(totalWt * t.addons.sphero / 100).toFixed(1) : 0,
    inoc: t.addons ? +(totalWt * t.addons.inoc / 100).toFixed(1) : 0,
  };
}

/**
 * 运行加料平衡
 * input: {
 *   grade, totalWt,
 *   pig: { content, kg, abs },   // content 含 C/Si/Mn/P/S
 *   scrap: { content, kg, abs },
 *   ret: { content, kg, abs },
 *   feSi/feMn/carb: { content, kg, abs },
 *   sphero: { content, kg, absMg, absRE, absSi },   // 球铁
 *   inoc: { content, kg, absSi },
 * }
 * 返回: { base, final, elems, CE, sugs, allOk, note, grade, totalWt }
 */
export function runCharge(input) {
  const grade = input.grade;
  const totalWt = input.totalWt > 0 ? input.totalWt : 1000;
  const target = CHARGE_TARGETS[grade];
  if (!target) return null;

  const rows = [
    ['pig', input.pig], ['scrap', input.scrap], ['ret', input.ret],
    ['feSi', input.feSi], ['feMn', input.feMn], ['carb', input.carb],
  ]
    .filter(([, r]) => r && r.content && r.kg > 0)
    .map(([name, r]) => ({ name, kg: r.kg, content: r.content, abs: r.abs }));

  // 原铁液成分（%）：Σ(料kg × 元素% × 吸收率) / 总重
  const base = {};
  for (const el of ELEMS) {
    base[el] = rows.reduce((s, r) => s + (r.content[el] || 0) * r.abs * r.kg, 0) / totalWt;
  }

  // 球化/孕育剂带入（球铁，%）：(处理剂kg/总重) × 元素含量% × 吸收率
  const add = {};
  if (target.addons) {
    if (input.sphero && input.sphero.content) {
      const sp = input.sphero.content, spKg = input.sphero.kg || 0;
      add.Mg = spKg / totalWt * (sp.Mg || 0) * (input.sphero.absMg ?? 0.45);
      add.RE = spKg / totalWt * (sp.RE || 0) * (input.sphero.absRE ?? 0.55);
      add.Si = spKg / totalWt * (sp.Si || 0) * (input.sphero.absSi ?? 0.80);
    }
    if (input.inoc && input.inoc.content) {
      const ic = input.inoc.content, icKg = input.inoc.kg || 0;
      add.Si = (add.Si || 0) + icKg / totalWt * (ic.Si || 0) * (input.inoc.absSi ?? 0.85);
    }
  }

  const final = { ...base };
  for (const el of ELEMS) final[el] = base[el] + (add[el] || 0);
  if (target.addons) { final.Mg = add.Mg || 0; final.RE = add.RE || 0; }

  const elems = ELEMS.map(el => ({
    el, name: el,
    target: target[el], base: base[el], final: final[el],
    diff: +(target[el] - base[el]).toFixed(3),   // 差额（正=缺）
  }));

  // 碳当量
  const baseCE = carbonEquivalent(base);
  const targetCE = target.CE ? carbonEquivalent({ C: target.C, Si: target.Si, P: target.P }) : 0;

  // 补料建议：缺 >0.05% 才建议（合金含量 × 吸收率 = 有效）；用当前所选合金规格/吸收率
  const sugs = [];
  const suggest = (el, row, contentField) => {
    const e = elems.find(x => x.el === el);
    if (e && e.diff > 0.05 && row && row.content) {
      const content = row.content[contentField] || 0;
      const abs = row.abs || 0.85;
      const kg = +(e.diff * totalWt / (content * abs)).toFixed(1);
      if (content > 0 && kg > 0.05) sugs.push({ el, label: row.label || row.key, key: row.key || contentField, kg });
    }
  };
  suggest('Si', input.feSi, 'Si');
  suggest('Mn', input.feMn, 'Mn');
  suggest('C', input.carb, 'C');

  const allOk = elems.every(e => Math.abs(e.diff) <= 0.05) && totalWt > 0;
  const note = target.addons
    ? '球铁：原铁液目标已扣除默认球化剂/孕育剂带入的硅；差额对原铁液而言'
    : '灰铁：原铁液目标即成铁目标';

  return { base, final, elems, baseCE, targetCE, sugs, allOk, note, grade, totalWt };
}
